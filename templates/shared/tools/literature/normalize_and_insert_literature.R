#!/usr/bin/env Rscript
# ==============================================================================
# Script Name: normalize_and_insert_literature.R
# Purpose:     Ingests extracted study, context, and assertion data into a DuckDB
#              literature database with biological entity normalization (human aliases via
#              curated dictionary + limma::alias2Symbol, and cross-species
#              orthologs via babelgene::orthologs).
#
# Usage:
#   Rscript tools/literature/normalize_and_insert_literature.R <json_input_file_or_dash> [db_path]
# ==============================================================================

suppressPackageStartupMessages({
  if (!requireNamespace("DBI", quietly = TRUE)) stop("R package 'DBI' is required.")
  if (!requireNamespace("duckdb", quietly = TRUE)) stop("R package 'duckdb' is required.")
  if (!requireNamespace("jsonlite", quietly = TRUE)) stop("R package 'jsonlite' is required.")
})

JSON_MARKER <- "@@LITERATURE_JSON@@"

emit <- function(payload) {
  cat(JSON_MARKER, jsonlite::toJSON(payload, auto_unbox = TRUE, null = "null", na = "null"), "\n", sep = "")
}

fail <- function(msg) {
  emit(list(ok = FALSE, error = as.character(msg)))
  quit(status = 1, save = "no")
}

# ------------------------------------------------------------------------------
# Curated High-Confidence Alias Dictionary (Proteomics / Organelle / ERAD / RQC)
# ------------------------------------------------------------------------------
CURATED_HUMAN_ALIASES <- list(
  # p97 / VCP complex and adapters
  "P97"    = "VCP",
  "P47"    = "NSFL1C",
  "UBXD8"  = "FAF2",
  "UBXD1"  = "UBXN6",
  "UBXD2"  = "ERAS",
  "UBXD7"  = "UBXN7",
  "UFD1"   = "UFD1",
  "UFD1L"  = "UFD1",
  "NPL4"   = "NPLOC4",
  "VMS1"   = "ANKZF1",
  "NPLOC4" = "NPLOC4",
  "FAF1"   = "FAF1",
  "FAF2"   = "FAF2",
  "SVIP"   = "SVIP",
  "DERLIN-1" = "DERL1",
  "DERLIN-2" = "DERL2",
  "DERLIN-3" = "DERL3",
  "HRD1"   = "SYVN1",
  "GP78"   = "AMFR",
  "DOA10"  = "MARCH6",
  "MARCH6" = "MARCH6",
  "OS-9"   = "OS9",
  "SEL1L"  = "SEL1L",
  "HERP"   = "HERPUD1",
  "HERPUD1" = "HERPUD1",
  "BAG6"   = "BAG6",
  "UBL4A"  = "UBL4A",
  "SGTA"   = "SGTA",
  "TRAM1"  = "TRAM1",
  "SEC61"  = "SEC61A1",
  "SEC61A" = "SEC61A1",
  "BIP"    = "HSPA5",
  "GRP78"  = "HSPA5",
  "CHOP"   = "DDIT3",
  "ATF4"   = "ATF4",
  "ATF6"   = "ATF6",
  "XBP1"   = "XBP1",
  "IRE1"   = "ERN1",
  "PERK"   = "EIF2AK3",
  # Model organism direct mappings
  "CDC48"  = "VCP",
  "UFD2"   = "UBE4B",
  "NPL4P"  = "NPLOC4",
  "DOA1"   = "PLAA"
)

# Canonical species aliases recognized by babelgene
resolve_babel_species <- function(raw_org) {
  if (is.null(raw_org) || !nzchar(trimws(raw_org))) return(NULL)
  o <- tolower(trimws(raw_org))
  if (grepl("sapiens|human", o)) return("human")
  if (grepl("musculus|mouse", o)) return("mouse")
  if (grepl("norvegicus|rat", o)) return("rat")
  if (grepl("cerevisiae|yeast", o)) return("yeast")
  if (grepl("melanogaster|fly|fruitfly", o)) return("fly")
  if (grepl("elegans|worm|c\\. elegans", o)) return("worm")
  if (grepl("rerio|zebrafish", o)) return("zebrafish")
  NULL
}

normalize_symbol <- function(raw_name, organism = "Homo sapiens") {
  clean <- trimws(raw_name %||% "")
  if (!nzchar(clean)) return(NULL)

  upper <- toupper(clean)

  # 1. Curated high-confidence dictionary lookup
  if (upper %in% names(CURATED_HUMAN_ALIASES)) {
    return(CURATED_HUMAN_ALIASES[[upper]])
  }

  babel_sp <- resolve_babel_species(organism)

  # 2. Non-human cross-species ortholog mapping (via babelgene if installed)
  if (!is.null(babel_sp) && babel_sp != "human") {
    if (requireNamespace("babelgene", quietly = TRUE)) {
      mapped <- tryCatch({
        res <- babelgene::orthologs(genes = clean, species = babel_sp, human = TRUE)
        if (!is.null(res) && nrow(res) > 0 && "human_symbol" %in% colnames(res)) {
          toupper(trimws(res$human_symbol[1]))
        } else {
          NULL
        }
      }, error = function(e) NULL)
      if (!is.null(mapped) && nzchar(mapped)) return(mapped)
    }
  }

  # 3. Human alias to symbol (via limma::alias2Symbol + org.Hs.eg.db)
  if (requireNamespace("limma", quietly = TRUE) && requireNamespace("org.Hs.eg.db", quietly = TRUE)) {
    limma_sym <- tryCatch({
      s <- limma::alias2Symbol(clean, species = "Hs")
      if (length(s) > 0 && nzchar(s[1])) toupper(s[1]) else NULL
    }, error = function(e) NULL)
    if (!is.null(limma_sym)) return(limma_sym)
  }

  # 4. Fallback: if looks like a standard HGNC symbol, uppercase it
  if (grepl("^[A-Za-z0-9_-]{2,15}$", clean)) {
    return(upper)
  }

  NULL
}

`%||%` <- function(a, b) if (is.null(a) || length(a) == 0 || is.na(a[1])) b else a

VALID_RELATIONSHIPS <- c(
  "ACCUMULATES_UP", "DEPLETED_DOWN", "PHYSICAL_INTERACTOR",
  "DIRECT_SUBSTRATE", "COMPENSATORY_PATHWAY", "NO_CHANGE"
)

main <- function() {
  args <- commandArgs(trailingOnly = TRUE)
  if (length(args) < 1) {
    fail("Usage: normalize_and_insert_literature.R <json_input_file_or_dash> [db_path]")
  }

  input_src <- args[1]
  raw_json <- if (input_src == "-") {
    readLines(file("stdin"), warn = FALSE)
  } else {
    if (!file.exists(input_src)) fail(sprintf("Input JSON file not found: %s", input_src))
    readLines(input_src, warn = FALSE)
  }
  payload <- jsonlite::fromJSON(paste(raw_json, collapse = "\n"), simplifyVector = FALSE)

  db_path <- if (length(args) >= 2) args[2] else payload$db_path
  if (is.null(db_path) || !nzchar(db_path)) fail("No 'db_path' specified in args or JSON payload.")

  if (!file.exists(db_path)) fail(sprintf("Literature database does not exist: %s", db_path))

  study <- payload$study
  if (is.null(study) || is.null(study$study_id) || !nzchar(study$study_id)) {
    fail("Payload must contain study object with a non-empty 'study_id'.")
  }
  study_id <- as.character(study$study_id)

  # Connect to DuckDB with retry
  con <- tryCatch({
    for (i in 1:5) {
      c_res <- tryCatch(DBI::dbConnect(duckdb::duckdb(), dbdir = db_path, read_only = FALSE), error = function(e) e)
      if (!inherits(c_res, "error")) break
      Sys.sleep(0.3 * (2 ^ (i - 1)))
    }
    if (inherits(c_res, "error")) stop(c_res)
    c_res
  }, error = function(e) fail(sprintf("Could not connect to DuckDB: %s", conditionMessage(e))))
  on.exit(try(DBI::dbDisconnect(con, shutdown = TRUE), silent = TRUE), add = TRUE)

  # Check if migration to v2 (removing foreign keys) is needed
  cur_ver <- tryCatch({
    m <- DBI::dbGetQuery(con, "SELECT value FROM literature_meta WHERE key = 'schema_version'")
    if (nrow(m) > 0) m$value[1] else "1"
  }, error = function(e) "1")

  if (cur_ver != "2") {
    old_studies <- tryCatch(DBI::dbGetQuery(con, "SELECT * FROM studies"), error = function(e) data.frame())
    old_contexts <- tryCatch(DBI::dbGetQuery(con, "SELECT * FROM experimental_contexts"), error = function(e) data.frame())
    old_assertions <- tryCatch(DBI::dbGetQuery(con, "SELECT * FROM molecular_assertions"), error = function(e) data.frame())

    try(DBI::dbExecute(con, "DROP VIEW IF EXISTS v_assertions_full"), silent = TRUE)
    try(DBI::dbExecute(con, "DROP TABLE IF EXISTS molecular_assertions"), silent = TRUE)
    try(DBI::dbExecute(con, "DROP TABLE IF EXISTS experimental_contexts"), silent = TRUE)
    try(DBI::dbExecute(con, "DROP TABLE IF EXISTS studies"), silent = TRUE)

    DBI::dbExecute(con, "CREATE TABLE IF NOT EXISTS studies (study_id VARCHAR PRIMARY KEY, filename VARCHAR, title VARCHAR, year INTEGER, core_thesis TEXT, ingested_at TIMESTAMP DEFAULT current_timestamp)")
    DBI::dbExecute(con, "CREATE TABLE IF NOT EXISTS experimental_contexts (context_id VARCHAR PRIMARY KEY, study_id VARCHAR NOT NULL, system_category VARCHAR, organism VARCHAR, model_name VARCHAR, perturbation_type VARCHAR, perturbation_target VARCHAR, assay_modality VARCHAR, context_metadata TEXT)")
    rel_check <- paste0("'", VALID_RELATIONSHIPS, "'", collapse = ", ")
    DBI::dbExecute(con, sprintf("CREATE TABLE IF NOT EXISTS molecular_assertions (assertion_id VARCHAR PRIMARY KEY, context_id VARCHAR NOT NULL, raw_entity_name VARCHAR NOT NULL, canonical_human_symbol VARCHAR, relationship_type VARCHAR CHECK (relationship_type IN (%s)), functional_module VARCHAR, quantitative_note TEXT, evidence_quote TEXT)", rel_check))
    DBI::dbExecute(con, "CREATE INDEX IF NOT EXISTS idx_ctx_study ON experimental_contexts(study_id)")
    DBI::dbExecute(con, "CREATE INDEX IF NOT EXISTS idx_assert_ctx ON molecular_assertions(context_id)")
    DBI::dbExecute(con, "CREATE INDEX IF NOT EXISTS idx_assert_symbol ON molecular_assertions(canonical_human_symbol)")
    DBI::dbExecute(con, "CREATE INDEX IF NOT EXISTS idx_assert_module ON molecular_assertions(functional_module)")
    DBI::dbExecute(con, "CREATE OR REPLACE VIEW v_assertions_full AS SELECT a.assertion_id, a.raw_entity_name, a.canonical_human_symbol, a.relationship_type, a.functional_module, a.quantitative_note, a.evidence_quote, c.context_id, c.system_category, c.organism, c.model_name, c.perturbation_type, c.perturbation_target, c.assay_modality, c.context_metadata, s.study_id, s.filename, s.title, s.year, s.core_thesis FROM molecular_assertions a JOIN experimental_contexts c ON a.context_id = c.context_id JOIN studies s ON c.study_id = s.study_id")

    if (nrow(old_studies) > 0) try(DBI::dbWriteTable(con, "studies", old_studies, append = TRUE), silent = TRUE)
    if (nrow(old_contexts) > 0) try(DBI::dbWriteTable(con, "experimental_contexts", old_contexts, append = TRUE), silent = TRUE)
    if (nrow(old_assertions) > 0) try(DBI::dbWriteTable(con, "molecular_assertions", old_assertions, append = TRUE), silent = TRUE)

    DBI::dbExecute(con, "CREATE TABLE IF NOT EXISTS literature_meta (key VARCHAR PRIMARY KEY, value VARCHAR)")
    DBI::dbExecute(con, "INSERT OR REPLACE INTO literature_meta (key, value) VALUES ('schema_version', '2')")
  }

  # Begin transaction
  DBI::dbBegin(con)
  on.exit(try(if (DBI::dbIsValid(con)) DBI::dbRollback(con), silent = TRUE), add = TRUE)

  # 1. Clean existing records for this study_id (idempotent re-ingestion)
  existing_ctx <- DBI::dbGetQuery(con, "SELECT context_id FROM experimental_contexts WHERE study_id = ?", params = list(study_id))
  if (nrow(existing_ctx) > 0) {
    ctx_ids <- paste(sprintf("'%s'", gsub("'", "''", existing_ctx$context_id)), collapse = ", ")
    DBI::dbExecute(con, sprintf("DELETE FROM molecular_assertions WHERE context_id IN (%s)", ctx_ids))
    DBI::dbExecute(con, "DELETE FROM experimental_contexts WHERE study_id = ?", params = list(study_id))
  }
  DBI::dbExecute(con, "DELETE FROM studies WHERE study_id = ?", params = list(study_id))

  # 2. Insert study
  DBI::dbExecute(con,
    "INSERT INTO studies (study_id, filename, title, year, core_thesis) VALUES (?, ?, ?, ?, ?)",
    params = list(
      study_id,
      study$filename %||% NA_character_,
      study$title %||% NA_character_,
      if (!is.null(study$year)) as.integer(study$year) else NA_integer_,
      study$core_thesis %||% NA_character_
    )
  )

  # 3. Insert experimental contexts with globally unique IDs scoped to this study
  study_hash <- substr(digest::digest(study_id), 1, 8)
  contexts_list <- payload$experimental_contexts %||% list()
  ctx_organism_map <- list()
  ctx_id_map <- list()

  if (length(contexts_list) == 0) {
    contexts_list <- list(list(
      context_id = "c1",
      system_category = "cell_line",
      organism = "Homo sapiens",
      model_name = "unspecified",
      perturbation_type = "unspecified",
      perturbation_target = "unspecified",
      assay_modality = "proteomics",
      context_metadata = "general"
    ))
  }

  for (i in seq_along(contexts_list)) {
    ctx <- contexts_list[[i]]
    raw_cid <- as.character(ctx$context_id %||% sprintf("c%d", i))
    scoped_cid <- sprintf("ctx_%s_%s", study_hash, raw_cid)
    ctx_id_map[[raw_cid]] <- scoped_cid
    org <- ctx$organism %||% "Homo sapiens"
    ctx_organism_map[[scoped_cid]] <- org

    DBI::dbExecute(con,
      "INSERT INTO experimental_contexts (context_id, study_id, system_category, organism, model_name, perturbation_type, perturbation_target, assay_modality, context_metadata)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
      params = list(
        scoped_cid, study_id,
        ctx$system_category %||% NA_character_,
        org,
        ctx$model_name %||% NA_character_,
        ctx$perturbation_type %||% NA_character_,
        ctx$perturbation_target %||% NA_character_,
        ctx$assay_modality %||% NA_character_,
        ctx$context_metadata %||% NA_character_
      )
    )
  }

  # 4. Normalize and insert molecular assertions
  assertions_list <- payload$molecular_assertions %||% list()
  norm_count <- 0
  inserted_assertions <- 0
  default_scoped_cid <- if (length(ctx_id_map) > 0) ctx_id_map[[1]] else sprintf("ctx_%s_c1", study_hash)

  for (idx in seq_along(assertions_list)) {
    a <- assertions_list[[idx]]
    aid <- sprintf("ast_%s_%d", study_hash, idx)
    raw_cid <- as.character(a$context_id %||% "")
    scoped_cid <- if (nzchar(raw_cid) && !is.null(ctx_id_map[[raw_cid]])) {
      ctx_id_map[[raw_cid]]
    } else {
      default_scoped_cid
    }

    raw_entity <- trimws(a$raw_entity_name %||% "")
    if (!nzchar(raw_entity)) next

    org_for_ctx <- ctx_organism_map[[scoped_cid]] %||% "Homo sapiens"
    canon_sym <- normalize_symbol(raw_entity, org_for_ctx)
    if (!is.null(canon_sym) && nzchar(canon_sym)) {
      norm_count <- norm_count + 1
    }

    rel <- toupper(trimws(a$relationship_type %||% "NO_CHANGE"))
    if (!rel %in% VALID_RELATIONSHIPS) rel <- "NO_CHANGE"

    DBI::dbExecute(con,
      "INSERT INTO molecular_assertions (assertion_id, context_id, raw_entity_name, canonical_human_symbol, relationship_type, functional_module, quantitative_note, evidence_quote)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
      params = list(
        aid, scoped_cid, raw_entity,
        canon_sym %||% NA_character_,
        rel,
        a$functional_module %||% NA_character_,
        a$quantitative_note %||% NA_character_,
        a$evidence_quote %||% NA_character_
      )
    )
    inserted_assertions <- inserted_assertions + 1
  }

  # Commit transaction
  DBI::dbCommit(con)

  emit(list(
    ok = TRUE,
    study_id = study_id,
    contexts_inserted = length(contexts_list),
    assertions_inserted = inserted_assertions,
    symbols_normalized = norm_count
  ))
}

tryCatch(main(), error = function(e) fail(conditionMessage(e)))
