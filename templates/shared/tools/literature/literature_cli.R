#!/usr/bin/env Rscript
# ==============================================================================
# Script Name: literature_cli.R
# Purpose:     Command-line interface for the TidyProteomicsAgent Literature
#              Database (DuckDB). Used by both the VS Code "Literature" tab
#              and by the agent during prompt phases.
#
# Usage:
#   Rscript tools/literature/literature_cli.R init   <db_path> [database_label]
#   Rscript tools/literature/literature_cli.R stats  <db_path>
#   Rscript tools/literature/literature_cli.R search <db_path> <query> [limit]
#
# Output contract:
#   A single line prefixed with "@@LITERATURE_JSON@@" followed by a JSON payload is
#   written to stdout. All diagnostics go to stderr. Exit status is non-zero on
#   failure, and the JSON payload then contains {"ok": false, "error": "..."}.
#
# Schema: Generic, premise-agnostic "Perturbation-Centric" schema:
#   studies -> experimental_contexts -> molecular_assertions
# ==============================================================================

suppressPackageStartupMessages({
  if (!requireNamespace("DBI", quietly = TRUE)) stop("R package 'DBI' is required. install.packages('DBI')")
  if (!requireNamespace("duckdb", quietly = TRUE)) stop("R package 'duckdb' is required. install.packages('duckdb')")
  if (!requireNamespace("jsonlite", quietly = TRUE)) stop("R package 'jsonlite' is required. install.packages('jsonlite')")
})

LITERATURE_SCHEMA_VERSION <- "2"
JSON_MARKER <- "@@LITERATURE_JSON@@"

RELATIONSHIP_TYPES <- c(
  "ACCUMULATES_UP", "DEPLETED_DOWN", "PHYSICAL_INTERACTOR",
  "DIRECT_SUBSTRATE", "COMPENSATORY_PATHWAY", "NO_CHANGE"
)

emit <- function(payload) {
  cat(JSON_MARKER, jsonlite::toJSON(payload, auto_unbox = TRUE, null = "null", na = "null", dataframe = "rows"), "\n", sep = "")
}

fail <- function(msg) {
  emit(list(ok = FALSE, error = as.character(msg)))
  quit(status = 1, save = "no")
}

# ------------------------------------------------------------------------------
# Schema DDL
# ------------------------------------------------------------------------------
schema_ddl <- function() {
  rel_check <- paste0("'", RELATIONSHIP_TYPES, "'", collapse = ", ")
  c(
    "CREATE TABLE IF NOT EXISTS literature_meta (
       key   VARCHAR PRIMARY KEY,
       value VARCHAR
     )",

    # 1. studies: one row per curated publication (DOI or file hash as PK)
    "CREATE TABLE IF NOT EXISTS studies (
       study_id     VARCHAR PRIMARY KEY,   -- DOI or SHA-256 file hash
       filename     VARCHAR,
       title        VARCHAR,
       year         INTEGER,
       core_thesis  TEXT,                  -- 2-3 sentence summary of primary biological conclusions
       ingested_at  TIMESTAMP DEFAULT current_timestamp
     )",

    # 2. experimental_contexts: system x perturbation x assay within a study
    "CREATE TABLE IF NOT EXISTS experimental_contexts (
       context_id           VARCHAR PRIMARY KEY,
       study_id             VARCHAR NOT NULL,
       system_category      VARCHAR,       -- cell_line | primary_cells | in_vivo_animal | human_clinical
       organism             VARCHAR,       -- e.g. Homo sapiens, Mus musculus, Saccharomyces cerevisiae
       model_name           VARCHAR,       -- e.g. HeLa, U2OS, C57BL/6
       perturbation_type    VARCHAR,       -- e.g. CRISPR_KO, siRNA_KD, chemical_inhibitor, infection
       perturbation_target  VARCHAR,       -- e.g. VCP / p97, CB-5083, M. tuberculosis H37Rv
       assay_modality       VARCHAR,       -- e.g. whole_cell_proteomics, AP-MS, diGly_ubiquitinomics, RNA_seq
       context_metadata     TEXT           -- timepoints, doses, host metadata
     )",

    # 3. molecular_assertions: knowledge-graph edges (context -> entity)
    sprintf("CREATE TABLE IF NOT EXISTS molecular_assertions (
       assertion_id            VARCHAR PRIMARY KEY,
       context_id              VARCHAR NOT NULL,
       raw_entity_name         VARCHAR NOT NULL,   -- exact name used in paper (p97, p47, UBXD8, Cdc48)
       canonical_human_symbol  VARCHAR,            -- normalized HGNC symbol (VCP, NSFL1C, FAF2)
       relationship_type       VARCHAR CHECK (relationship_type IN (%s)),
       functional_module       VARCHAR,            -- e.g. ERAD, RQC, Mitophagy, Proteasome Bounce-back
       quantitative_note       TEXT,               -- fold change / statistic if mentioned
       evidence_quote          TEXT                -- verbatim sentence or table reference
     )", rel_check),

    "CREATE INDEX IF NOT EXISTS idx_ctx_study      ON experimental_contexts(study_id)",
    "CREATE INDEX IF NOT EXISTS idx_assert_ctx     ON molecular_assertions(context_id)",
    "CREATE INDEX IF NOT EXISTS idx_assert_symbol  ON molecular_assertions(canonical_human_symbol)",
    "CREATE INDEX IF NOT EXISTS idx_assert_module  ON molecular_assertions(functional_module)",

    # Convenience denormalized view used by search and graph-hop queries
    "CREATE OR REPLACE VIEW v_assertions_full AS
       SELECT a.assertion_id, a.raw_entity_name, a.canonical_human_symbol,
              a.relationship_type, a.functional_module, a.quantitative_note, a.evidence_quote,
              c.context_id, c.system_category, c.organism, c.model_name,
              c.perturbation_type, c.perturbation_target, c.assay_modality, c.context_metadata,
              s.study_id, s.filename, s.title, s.year, s.core_thesis
         FROM molecular_assertions a
         JOIN experimental_contexts c ON a.context_id = c.context_id
         JOIN studies s               ON c.study_id   = s.study_id"
  )
}

open_db <- function(db_path, read_only = FALSE, max_attempts = 5, base_delay_ms = 250) {
  for (attempt in seq_len(max_attempts)) {
    con <- tryCatch(
      DBI::dbConnect(duckdb::duckdb(), dbdir = db_path, read_only = read_only),
      error = function(e) e
    )
    if (!inherits(con, "error")) return(con)
    msg <- conditionMessage(con)
    if (grepl("lock|conflict|busy|resource temporarily unavailable", msg, ignore.case = TRUE) && attempt < max_attempts) {
      Sys.sleep((base_delay_ms * (2 ^ (attempt - 1))) / 1000)
    } else {
      stop(con)
    }
  }
}

close_db <- function(con) {
  try(DBI::dbDisconnect(con, shutdown = TRUE), silent = TRUE)
}

# ------------------------------------------------------------------------------
# Subcommands
# ------------------------------------------------------------------------------
cmd_init <- function(db_path, label = NULL) {
  dir.create(dirname(db_path), recursive = TRUE, showWarnings = FALSE)
  existed <- file.exists(db_path)
  con <- open_db(db_path)
  on.exit(close_db(con), add = TRUE)

  # Check if migration from v1 (with foreign keys) to v2 (without foreign keys) is needed
  existing_tables <- DBI::dbListTables(con)
  if (all(c("studies", "experimental_contexts", "molecular_assertions") %in% existing_tables)) {
    cur_ver <- tryCatch({
      m <- DBI::dbGetQuery(con, "SELECT value FROM literature_meta WHERE key = 'schema_version'")
      if (nrow(m) > 0) m$value[1] else "1"
    }, error = function(e) "1")

    if (cur_ver != LITERATURE_SCHEMA_VERSION) {
      old_studies <- tryCatch(DBI::dbGetQuery(con, "SELECT * FROM studies"), error = function(e) data.frame())
      old_contexts <- tryCatch(DBI::dbGetQuery(con, "SELECT * FROM experimental_contexts"), error = function(e) data.frame())
      old_assertions <- tryCatch(DBI::dbGetQuery(con, "SELECT * FROM molecular_assertions"), error = function(e) data.frame())

      try(DBI::dbExecute(con, "DROP VIEW IF EXISTS v_assertions_full"), silent = TRUE)
      try(DBI::dbExecute(con, "DROP TABLE IF EXISTS molecular_assertions"), silent = TRUE)
      try(DBI::dbExecute(con, "DROP TABLE IF EXISTS experimental_contexts"), silent = TRUE)
      try(DBI::dbExecute(con, "DROP TABLE IF EXISTS studies"), silent = TRUE)

      for (stmt in schema_ddl()) DBI::dbExecute(con, stmt)

      if (nrow(old_studies) > 0) try(DBI::dbWriteTable(con, "studies", old_studies, append = TRUE), silent = TRUE)
      if (nrow(old_contexts) > 0) try(DBI::dbWriteTable(con, "experimental_contexts", old_contexts, append = TRUE), silent = TRUE)
      if (nrow(old_assertions) > 0) try(DBI::dbWriteTable(con, "molecular_assertions", old_assertions, append = TRUE), silent = TRUE)
    }
  }

  for (stmt in schema_ddl()) DBI::dbExecute(con, stmt)

  upsert_meta <- function(k, v) {
    DBI::dbExecute(con, "INSERT OR REPLACE INTO literature_meta (key, value) VALUES (?, ?)", params = list(k, v))
  }
  upsert_meta("schema_version", LITERATURE_SCHEMA_VERSION)
  if (!existed) upsert_meta("created_at", format(Sys.time(), "%Y-%m-%dT%H:%M:%S%z"))
  if (!is.null(label) && nzchar(label)) upsert_meta("label", label)

  emit(list(
    ok = TRUE,
    action = "init",
    db_path = normalizePath(db_path, mustWork = FALSE),
    created = !existed,
    schema_version = LITERATURE_SCHEMA_VERSION,
    tables = DBI::dbListTables(con)
  ))
}

count_tbl <- function(con, sql) {
  as.list(DBI::dbGetQuery(con, sql))
}

cmd_stats <- function(db_path) {
  if (!file.exists(db_path)) fail(sprintf("Literature database not found: %s", db_path))
  con <- open_db(db_path, read_only = TRUE)
  on.exit(close_db(con), add = TRUE)

  tables <- DBI::dbListTables(con)
  required <- c("studies", "experimental_contexts", "molecular_assertions")
  missing <- setdiff(required, tables)
  if (length(missing) > 0) {
    fail(sprintf("Literature database is missing tables (%s). Re-run 'init'.", paste(missing, collapse = ", ")))
  }

  scalar <- function(sql) DBI::dbGetQuery(con, sql)[[1]][1]
  top_n <- function(col, tbl, n = 8) {
    DBI::dbGetQuery(con, sprintf(
      "SELECT COALESCE(NULLIF(TRIM(%1$s), ''), '(unspecified)') AS label, COUNT(*)::INTEGER AS n
         FROM %2$s GROUP BY 1 ORDER BY n DESC, label LIMIT %3$d", col, tbl, n
    ))
  }

  meta <- tryCatch(
    DBI::dbGetQuery(con, "SELECT key, value FROM literature_meta"),
    error = function(e) {
      tryCatch(DBI::dbGetQuery(con, "SELECT key, value FROM corpus_meta"), error = function(e2) data.frame(key = character(), value = character()))
    }
  )
  meta_list <- stats::setNames(as.list(meta$value), meta$key)

  totals_list <- list(
    studies = as.integer(scalar("SELECT COUNT(*) FROM studies")),
    study_count = as.integer(scalar("SELECT COUNT(*) FROM studies")),
    contexts = as.integer(scalar("SELECT COUNT(*) FROM experimental_contexts")),
    context_count = as.integer(scalar("SELECT COUNT(*) FROM experimental_contexts")),
    assertions = as.integer(scalar("SELECT COUNT(*) FROM molecular_assertions")),
    assertion_count = as.integer(scalar("SELECT COUNT(*) FROM molecular_assertions")),
    unique_symbols = as.integer(scalar("SELECT COUNT(DISTINCT canonical_human_symbol) FROM molecular_assertions WHERE canonical_human_symbol IS NOT NULL")),
    symbols = as.integer(scalar("SELECT COUNT(DISTINCT canonical_human_symbol) FROM molecular_assertions WHERE canonical_human_symbol IS NOT NULL")),
    unmapped_entities = as.integer(scalar("SELECT COUNT(*) FROM molecular_assertions WHERE canonical_human_symbol IS NULL OR TRIM(canonical_human_symbol) = ''")),
    organisms = as.integer(scalar("SELECT COUNT(DISTINCT organism) FROM experimental_contexts")),
    organism_count = as.integer(scalar("SELECT COUNT(DISTINCT organism) FROM experimental_contexts")),
    models = as.integer(scalar("SELECT COUNT(DISTINCT model_name) FROM experimental_contexts")),
    model_count = as.integer(scalar("SELECT COUNT(DISTINCT model_name) FROM experimental_contexts")),
    perturbations = as.integer(scalar("SELECT COUNT(DISTINCT perturbation_target) FROM experimental_contexts")),
    perturbation_count = as.integer(scalar("SELECT COUNT(DISTINCT perturbation_target) FROM experimental_contexts"))
  )

  emit(list(
    ok = TRUE,
    action = "stats",
    db_path = normalizePath(db_path, mustWork = FALSE),
    file_size_bytes = unname(file.info(db_path)$size),
    meta = meta_list,
    totals = totals_list,
    stats = totals_list,
    breakdown = list(
      organisms = top_n("organism", "experimental_contexts"),
      models = top_n("model_name", "experimental_contexts"),
      perturbation_types = top_n("perturbation_type", "experimental_contexts"),
      assay_modalities = top_n("assay_modality", "experimental_contexts"),
      relationship_types = top_n("relationship_type", "molecular_assertions"),
      functional_modules = top_n("functional_module", "molecular_assertions", 10)
    ),
    recent_studies = DBI::dbGetQuery(con,
      "SELECT study_id, title, year, filename FROM studies ORDER BY ingested_at DESC NULLS LAST LIMIT 5")
  ))
}

cmd_search <- function(db_path, query, limit = 50L) {
  if (!file.exists(db_path)) fail(sprintf("Literature database not found: %s", db_path))
  query <- trimws(query %||% "")
  if (!nzchar(query)) fail("Search query is empty.")
  limit <- max(1L, min(500L, as.integer(limit)))

  con <- open_db(db_path, read_only = TRUE)
  on.exit(close_db(con), add = TRUE)

  # Support batch querying if query contains comma- or semicolon-separated tokens
  tokens <- trimws(unlist(strsplit(query, "[,;]+")))
  tokens <- tokens[nzchar(tokens)]
  if (length(tokens) > 1) {
    placeholders <- paste(rep("?", length(tokens)), collapse = ", ")
    batch_limit <- limit * length(tokens)
    rows <- DBI::dbGetQuery(con, sprintf(
      "SELECT canonical_human_symbol, raw_entity_name, relationship_type, functional_module,
              quantitative_note, evidence_quote, organism, model_name, perturbation_type,
              perturbation_target, assay_modality, study_id, title, year, context_id, assertion_id
         FROM v_assertions_full
        WHERE UPPER(canonical_human_symbol) IN (%s)
           OR UPPER(raw_entity_name) IN (%s)
        ORDER BY canonical_human_symbol, year DESC NULLS LAST
        LIMIT %d", placeholders, placeholders, batch_limit),
      params = c(as.list(toupper(tokens)), as.list(toupper(tokens)))
    )
    print_search_table(rows, query)
    emit(list(ok = TRUE, action = "search", query = query, count = nrow(rows), limit = batch_limit, rows = rows, results = rows))
    return()
  }

  # Single-query: exact symbol / alias matches rank first, then substring matches on entity,
  # functional module, or perturbation target.
  pattern <- paste0("%", query, "%")
  rows <- DBI::dbGetQuery(con, sprintf(
    "SELECT canonical_human_symbol, raw_entity_name, relationship_type, functional_module,
            quantitative_note, evidence_quote, organism, model_name, perturbation_type,
            perturbation_target, assay_modality, study_id, title, year, context_id, assertion_id,
            CASE
              WHEN UPPER(canonical_human_symbol) = UPPER(?) THEN 0
              WHEN UPPER(raw_entity_name)        = UPPER(?) THEN 1
              ELSE 2
            END AS match_rank
       FROM v_assertions_full
      WHERE canonical_human_symbol ILIKE ?
         OR raw_entity_name        ILIKE ?
         OR functional_module      ILIKE ?
         OR perturbation_target    ILIKE ?
      ORDER BY match_rank, canonical_human_symbol, year DESC NULLS LAST
      LIMIT %d", limit),
    params = list(query, query, pattern, pattern, pattern, pattern)
  )
  rows$match_rank <- NULL

  print_search_table(rows, query)
  emit(list(ok = TRUE, action = "search", query = query, count = nrow(rows), limit = limit, rows = rows, results = rows))
}

print_search_table <- function(rows, query) {
  if (is.null(rows) || nrow(rows) == 0) {
    cat(sprintf("\n(No literature assertions matched '%s')\n\n", query))
    return()
  }
  cat(sprintf("\n### Literature Search: %d assertion(s) matched '%s'\n\n", nrow(rows), query))
  disp_rows <- head(rows, 40)
  quotes <- ifelse(is.na(disp_rows$evidence_quote) | !nzchar(disp_rows$evidence_quote), "-",
    ifelse(nchar(disp_rows$evidence_quote) > 80,
      paste0(substr(disp_rows$evidence_quote, 1, 77), "..."),
      disp_rows$evidence_quote))
  quotes <- gsub("[\\r\\n]+", " ", quotes)
  quotes <- gsub("\\|", "/", quotes)

  disp_df <- data.frame(
    Symbol = disp_rows$canonical_human_symbol %||% "-",
    Relationship = disp_rows$relationship_type %||% "-",
    Module = disp_rows$functional_module %||% "-",
    Target = disp_rows$perturbation_target %||% "-",
    Study = disp_rows$study_id %||% "-",
    Quote = quotes,
    stringsAsFactors = FALSE
  )
  header <- paste0("| ", paste(colnames(disp_df), collapse = " | "), " |")
  sep <- paste0("| ", paste(rep(":---", ncol(disp_df)), collapse = " | "), " |")
  r_lines <- apply(disp_df, 1, function(r) paste0("| ", paste(r, collapse = " | "), " |"))
  cat(paste(c(header, sep, r_lines), collapse = "\n"), "\n\n")
}

cmd_report <- function(db_path, out_file = "docs/literature_database.md") {
  if (!file.exists(db_path)) fail(sprintf("Literature database not found: %s", db_path))
  con <- open_db(db_path, read_only = TRUE)
  on.exit(close_db(con), add = TRUE)

  meta <- tryCatch(
    DBI::dbGetQuery(con, "SELECT key, value FROM literature_meta"),
    error = function(e) data.frame(key = character(), value = character())
  )
  meta_map <- stats::setNames(as.list(meta$value), meta$key)
  db_label <- meta_map$label %||% tools::file_path_sans_ext(basename(db_path))
  created_at <- meta_map$created_at %||% format(file.info(db_path)$ctime, "%Y-%m-%d %H:%M:%S")

  studies <- DBI::dbGetQuery(con, "SELECT * FROM studies ORDER BY year ASC, study_id ASC")
  contexts <- DBI::dbGetQuery(con, "SELECT * FROM experimental_contexts")
  assertions <- DBI::dbGetQuery(con, "SELECT * FROM molecular_assertions")

  last_updated <- if (nrow(studies) > 0 && "ingested_at" %in% names(studies)) {
    as.character(max(studies$ingested_at, na.rm = TRUE))
  } else {
    format(file.info(db_path)$mtime, "%Y-%m-%d %H:%M:%S")
  }

  total_studies <- nrow(studies)
  total_contexts <- nrow(contexts)
  total_assertions <- nrow(assertions)

  scalar <- function(sql) DBI::dbGetQuery(con, sql)[[1]][1]
  unique_human_symbols <- as.integer(scalar("SELECT COUNT(DISTINCT canonical_human_symbol) FROM molecular_assertions WHERE canonical_human_symbol IS NOT NULL AND TRIM(canonical_human_symbol) != ''"))
  unmapped_entities <- as.integer(scalar("SELECT COUNT(*) FROM molecular_assertions WHERE canonical_human_symbol IS NULL OR TRIM(canonical_human_symbol) = ''"))
  unique_organisms <- as.integer(scalar("SELECT COUNT(DISTINCT organism) FROM experimental_contexts"))
  unique_models <- as.integer(scalar("SELECT COUNT(DISTINCT model_name) FROM experimental_contexts"))
  unique_perturbations <- as.integer(scalar("SELECT COUNT(DISTINCT perturbation_target) FROM experimental_contexts"))

  top_n <- function(col, tbl, n = 8) {
    DBI::dbGetQuery(con, sprintf(
      "SELECT COALESCE(NULLIF(TRIM(%1$s), ''), '(unspecified)') AS label, COUNT(*)::INTEGER AS n
         FROM %2$s GROUP BY 1 ORDER BY n DESC, label LIMIT %3$d", col, tbl, n
    ))
  }

  rel_counts <- top_n("relationship_type", "molecular_assertions", 10)
  mod_counts <- top_n("functional_module", "molecular_assertions", 10)
  org_counts <- top_n("organism", "experimental_contexts", 10)
  modality_counts <- top_n("assay_modality", "experimental_contexts", 10)

  lines <- c()
  add <- function(...) lines <<- c(lines, paste0(...))

  title_display <- sprintf("%s Knowledge Database", gsub("_", " ", tools::toTitleCase(db_label)))
  add("# ", title_display)
  add("")
  add("> **Accounting & Provenance Report**: Comprehensive structured index of molecular assertions, experimental contexts, and biomedical sources ingested into the active literature knowledge database.")
  add("")
  add("---")
  add("")
  add("## 1. Database Title & Metadata")
  add("")
  add("- **Database Title**: ", title_display)
  add("- **Database Label**: `", db_label, "`")
  add("- **Storage Engine**: DuckDB (Columnar Analytical Database Engine)")
  add("- **Schema Version**: `v2` (Generic Perturbation-Centric Knowledge Graph: `studies` -> `experimental_contexts` -> `molecular_assertions`)")
  add("- **Active File Path**: `", basename(db_path), "` (", format(file.info(db_path)$size, big.mark = ","), " bytes)")
  add("- **Date Created**: `", created_at, "`")
  add("- **Last Date Updated**: `", last_updated, "`")
  add("- **Accounting Verified**: `", format(Sys.time(), "%Y-%m-%d %H:%M %z"), "`")
  add("")
  add("---")
  add("")
  add("## 2. Executive Summary")
  add("")
  add(sprintf("The **%s** is a curated, perturbation-centric molecular knowledge graph constructed to contextualize high-resolution mass spectrometry and whole-cell proteomics workflows. The database captures the multidimensional molecular dynamics across %d peer-reviewed publications and data sources spanning %d to %d.",
              title_display, total_studies, if (total_studies > 0) min(studies$year, na.rm = TRUE) else 0, if (total_studies > 0) max(studies$year, na.rm = TRUE) else 0))
  add("")
  add("Within the **TidyProteomicsAgent** pipeline architecture, this database serves as the automated reasoning foundation for **Phase 09 (Literature Knowledge Database Interrogation)** and **Phase 10 (Scientific Manuscript Synthesis)**. It enables two-way programmatic graph-hops via `tools/literature/query_literature.R` to retrieve literature-asserted co-factors, physical interactors, and downstream targets, which are subsequently reverse-interrogated against unthresholded experimental proteomics datasets (`data/tidyproteomics_data.rds` via `tools/literature/interrogate_unthresholded_proteomics.R`). This empowers the agent to identify coordinated sub-threshold shifts and resolve biological mechanisms that fall below strict single-protein statistical cutoffs.")
  add("")
  add("---")
  add("")
  add("## 3. Database Content & Statistical Accounting")
  add("")
  add("### 3.1 Primary Corpus Totals")
  add("")
  add("| Metric | Count | Description |")
  add("|:---|:---:|:---|")
  add(sprintf("| **Indexed Sources / Files** | **%d** | Full-text peer-reviewed papers and supplementary datasets parsed and indexed |", total_studies))
  add(sprintf("| **Experimental Contexts** | **%d** | Distinct biological conditions, host models, tissue types, and perturbation regimens |", total_contexts))
  add(sprintf("| **Molecular Assertions** | **%d** | Discrete subject-predicate-object knowledge edges extracted with verbatim evidence |", total_assertions))
  add(sprintf("| **Canonical Human Symbols** | **%d** | Unique normalized HGNC / Ensembl human gene and protein identifiers |", unique_human_symbols))
  add(sprintf("| **Pathogen / Unmapped Entities** | **%d** | Unique organism-specific locus tags, antigens, and unmapped entities |", unmapped_entities))
  add(sprintf("| **Represented Organisms** | **%d** | Distinct species across experimental contexts |", unique_organisms))
  add(sprintf("| **Biological Model Systems** | **%d** | Cell lines, primary tissues, biofluids, and in vivo models |", unique_models))
  add(sprintf("| **Perturbation Regimens** | **%d** | Unique perturbation targets, infections, treatments, and cohorts |", unique_perturbations))
  add("")
  add("### 3.2 Breakdown by Knowledge Relationship Type")
  add("")
  add("| Relationship Type | Assertions | % of Total |")
  add("|:---|:---:|:---:|")
  for (r in seq_len(nrow(rel_counts))) {
    pct <- round(100 * rel_counts$n[r] / max(1, total_assertions), 1)
    add(sprintf("| `%s` | %d | %.1f%% |", rel_counts$label[r], rel_counts$n[r], pct))
  }
  add("")
  add("### 3.3 Breakdown by Assay Modality")
  add("")
  add("| Assay Modality | Contexts |")
  add("|:---|:---:|")
  for (m in seq_len(nrow(modality_counts))) {
    add(sprintf("| %s | %d |", modality_counts$label[m], modality_counts$n[m]))
  }
  add("")
  add("### 3.4 Top Functional Modules Represented")
  add("")
  add("| Functional Module | Assertions |")
  add("|:---|:---:|")
  for (fm in seq_len(nrow(mod_counts))) {
    add(sprintf("| %s | %d |", mod_counts$label[fm], mod_counts$n[fm]))
  }
  add("")
  add("---")
  add("")
  add("## 4. Ingested Sources Index")
  add("")
  add("The table below lists all peer-reviewed studies and data sources currently indexed in the active knowledge database, sorted chronologically:")
  add("")
  add("| # | Year | Study / Publication | Organism & Model | Modality | Assertions | Key Asserted Genes & Modules |")
  add("|:---:|:---:|:---|:---|:---|:---:|:---|")

  for (i in seq_len(total_studies)) {
    sid <- studies$study_id[i]
    st_ctx <- contexts[contexts$study_id == sid, ]
    cids <- st_ctx$context_id
    st_ass <- assertions[assertions$context_id %in% cids, ]

    syms <- unique(na.omit(st_ass$canonical_human_symbol))
    syms <- syms[nzchar(trimws(syms))]

    raws <- unique(na.omit(st_ass$raw_entity_name))
    raws <- raws[nzchar(trimws(raws))]

    doi_url <- if (grepl("^10\\.", sid)) sprintf("https://doi.org/%s", sid) else ""
    title_text <- studies$title[i]
    title_clean <- gsub("\\|", "-", title_text)
    
    study_link <- if (nzchar(doi_url)) {
      sprintf("[%s](%s)", title_clean, doi_url)
    } else {
      title_clean
    }

    org_str <- paste(unique(na.omit(st_ctx$organism)), collapse = ", ")
    mod_str <- paste(unique(na.omit(st_ctx$model_name)), collapse = ", ")
    sys_str <- if (nzchar(org_str) && nzchar(mod_str)) sprintf("%s (%s)", org_str, mod_str) else paste0(org_str, mod_str)
    sys_str <- gsub("\\|", "-", sys_str)

    assay_str <- gsub("\\|", "-", paste(unique(na.omit(st_ctx$assay_modality)), collapse = ", "))

    top_syms <- if (length(syms) > 0) head(syms, 6) else head(raws, 6)
    genes_summary <- paste(top_syms, collapse = ", ")
    if (length(syms) > 6) {
      genes_summary <- sprintf("%s *(+%d more)*", genes_summary, length(syms) - 6)
    }

    mods <- na.omit(st_ass$functional_module)
    mods <- mods[nzchar(trimws(mods))]
    if (length(mods) > 0) {
      top_mod <- names(sort(table(mods), decreasing = TRUE))[1]
      genes_summary <- sprintf("%s `[%s]`", genes_summary, top_mod)
    }

    add(sprintf("| %d | %d | %s | %s | %s | %d | %s |",
                i,
                studies$year[i] %||% 0,
                study_link,
                if (nzchar(sys_str)) sys_str else "-",
                if (nzchar(assay_str)) assay_str else "-",
                nrow(st_ass),
                if (nzchar(genes_summary)) genes_summary else "-"))
  }

  add("")
  add("---")
  add("")
  add("## 5. Programmatic & Dynamic Interrogation")
  add("")
  add("To explore specific assertions, physical interactors, or evidence quotes for any gene or module, use the dedicated query interfaces:")
  add("")
  add("```bash")
  add(sprintf("# Search assertions by gene symbol, alias, or module:\nRscript tools/literature/literature_cli.R search %s \"<symbol>\"", basename(db_path)))
  add("")
  add(sprintf("# Two-way graph-hop interrogation for pipeline synthesis:\nRscript tools/literature/query_literature.R %s \"<seed_genes>\" \"<pathway_terms>\" 20", basename(db_path)))
  add("```")
  add("")
  add("> **Tip**: Granular assertion details, experimental condition parameters, and verbatim evidence quotes remain indexed in DuckDB for zero-token-overhead programmatic analysis.")
  add("")

  dir.create(dirname(out_file), recursive = TRUE, showWarnings = FALSE)
  writeLines(lines, out_file)

  emit(list(
    ok = TRUE,
    action = "report",
    db_path = normalizePath(db_path, mustWork = FALSE),
    output_path = normalizePath(out_file, mustWork = FALSE),
    total_studies = total_studies,
    total_contexts = total_contexts,
    total_assertions = total_assertions
  ))
}

`%||%` <- function(a, b) if (is.null(a) || length(a) == 0 || is.na(a[1])) b else a

# ------------------------------------------------------------------------------
# Dispatcher
# ------------------------------------------------------------------------------
main <- function() {
  args <- commandArgs(trailingOnly = TRUE)
  if (length(args) < 2) {
    fail("Usage: literature_cli.R <init|stats|search|report> <db_path> [args...]")
  }
  cmd <- tolower(args[1])
  db_path <- args[2]

  switch(cmd,
    init   = cmd_init(db_path, if (length(args) >= 3) args[3] else NULL),
    stats  = cmd_stats(db_path),
    search = cmd_search(db_path, if (length(args) >= 3) args[3] else "", if (length(args) >= 4) args[4] else 50L),
    report = cmd_report(db_path, if (length(args) >= 3) args[3] else "docs/literature_database.md"),
    fail(sprintf("Unknown subcommand '%s'. Expected one of: init, stats, search, report.", cmd))
  )
}

tryCatch(invisible(main()), error = function(e) fail(conditionMessage(e)))
