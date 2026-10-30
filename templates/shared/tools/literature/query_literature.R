#!/usr/bin/env Rscript
# ==============================================================================
# Script Name: query_literature.R
# Purpose:     Skill 1 of Two-Way Interrogation. Queries the active DuckDB
#              Literature Database using differentially expressed seed
#              symbols. Performs a graph-hop join across experimental contexts
#              and functional modules to uncover co-regulated proteins, physical
#              interactors, and direct substrates (proteins X, Y, Z) that were
#              not in the initial strict cutoff list.
#
# Usage:
#   Rscript tools/literature/query_literature.R <db_path> <seed_symbols> [pathway_terms] [limit]
#
# Examples:
#   Rscript tools/literature/query_literature.R literature/p97.duckdb "VCP,FAF2" "ERAD" 20
# ==============================================================================

suppressPackageStartupMessages({
  if (!requireNamespace("DBI", quietly = TRUE)) stop("R package 'DBI' is required.")
  if (!requireNamespace("duckdb", quietly = TRUE)) stop("R package 'duckdb' is required.")
  if (!requireNamespace("jsonlite", quietly = TRUE)) stop("R package 'jsonlite' is required.")
})

JSON_MARKER <- "@@LITERATURE_JSON@@"

emit <- function(payload) {
  cat(JSON_MARKER, jsonlite::toJSON(payload, auto_unbox = TRUE, null = "null", na = "null", dataframe = "rows"), "\n", sep = "")
}

fail <- function(msg) {
  emit(list(ok = FALSE, error = as.character(msg)))
  quit(status = 1, save = "no")
}

parse_list <- function(val) {
  if (is.null(val) || !nzchar(trimws(val))) return(character(0))
  trimws(strsplit(val, "[,;\\s]+")[[1]])
}

open_db_readonly <- function(db_path, max_attempts = 5, base_delay_ms = 250) {
  for (attempt in seq_len(max_attempts)) {
    con <- tryCatch(
      DBI::dbConnect(duckdb::duckdb(), dbdir = db_path, read_only = TRUE),
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

main <- function() {
  args <- commandArgs(trailingOnly = TRUE)
  if (length(args) < 2) {
    fail("Usage: query_literature.R <db_path> <seed_symbols> [pathway_terms] [limit]")
  }

  db_path <- args[1]
  if (!file.exists(db_path)) fail(sprintf("Literature database does not exist: %s", db_path))

  seed_symbols <- toupper(parse_list(args[2]))
  if (length(seed_symbols) == 0) fail("No seed symbols provided.")

  pathway_terms <- if (length(args) >= 3) parse_list(args[3]) else character(0)
  limit <- if (length(args) >= 4) max(5L, min(200L, as.integer(args[4]))) else 25L

  con <- tryCatch(
    open_db_readonly(db_path),
    error = function(e) fail(sprintf("Could not connect to DuckDB: %s", conditionMessage(e)))
  )
  on.exit(try(DBI::dbDisconnect(con, shutdown = TRUE), silent = TRUE), add = TRUE)

  # Check tables
  tables <- DBI::dbListTables(con)
  if (!"molecular_assertions" %in% tables) {
    fail("Literature database is missing 'molecular_assertions'. Run 'literature_cli.R init'.")
  }

  seeds_sql <- paste(sprintf("'%s'", seed_symbols), collapse = ", ")

  # 1. Step 1: Find all direct mentions of seed symbols to understand their grounded contexts
  direct_sql <- sprintf("
    SELECT canonical_human_symbol, relationship_type, functional_module,
           organism, model_name, perturbation_target, study_id, title, year,
           evidence_quote, context_id
      FROM v_assertions_full
     WHERE canonical_human_symbol IN (%s)
  ", seeds_sql)
  direct_mentions <- DBI::dbGetQuery(con, direct_sql)

  # 2. Step 2: Graph-Hop Join
  # Find candidates sharing experimental_contexts OR functional_modules with seed proteins,
  # EXCLUDING the seed proteins themselves.
  hop_sql <- sprintf("
    WITH seed_contexts AS (
      SELECT DISTINCT context_id, functional_module
        FROM molecular_assertions
       WHERE canonical_human_symbol IN (%s)
    ),
    hop_candidates AS (
      SELECT a.canonical_human_symbol,
             a.raw_entity_name,
             a.relationship_type,
             a.functional_module,
             a.evidence_quote,
             c.context_id,
             c.model_name,
             c.perturbation_target,
             s.study_id,
             s.title,
             s.year,
             CASE
               WHEN a.context_id IN (SELECT DISTINCT context_id FROM seed_contexts WHERE context_id IS NOT NULL) THEN 3
               WHEN a.functional_module IN (SELECT DISTINCT functional_module FROM seed_contexts WHERE functional_module IS NOT NULL) THEN 2
               ELSE 1
             END AS hop_weight
        FROM molecular_assertions a
        JOIN experimental_contexts c ON a.context_id = c.context_id
        JOIN studies s               ON c.study_id   = s.study_id
       WHERE a.canonical_human_symbol NOT IN (%1$s)
         AND a.canonical_human_symbol IS NOT NULL
         AND (
           a.context_id IN (SELECT DISTINCT context_id FROM seed_contexts WHERE context_id IS NOT NULL)
           OR a.functional_module IN (SELECT DISTINCT functional_module FROM seed_contexts WHERE functional_module IS NOT NULL)
         )
    )
    SELECT canonical_human_symbol,
           COUNT(DISTINCT study_id)::INTEGER AS study_count,
           COUNT(DISTINCT context_id)::INTEGER AS context_count,
           STRING_AGG(DISTINCT relationship_type, ', ') AS reported_relationships,
           STRING_AGG(DISTINCT functional_module, ', ') AS functional_modules,
           MAX(evidence_quote) AS sample_evidence_quote,
           STRING_AGG(DISTINCT study_id, ', ') AS supporting_studies,
           SUM(hop_weight)::INTEGER AS relevance_score
      FROM hop_candidates
     GROUP BY canonical_human_symbol
     ORDER BY relevance_score DESC, study_count DESC, canonical_human_symbol
     LIMIT %d
  ", seeds_sql, limit)

  hop_results <- DBI::dbGetQuery(con, hop_sql)

  # Optional pathway filtering boost if pathway terms specified
  if (length(pathway_terms) > 0 && nrow(hop_results) > 0) {
    p_regex <- paste0("(", paste(pathway_terms, collapse = "|"), ")")
    hop_results$pathway_match <- grepl(p_regex, hop_results$functional_modules, ignore.case = TRUE)
    hop_results <- hop_results[order(-hop_results$pathway_match, -hop_results$relevance_score), ]
    hop_results$pathway_match <- NULL
  }

  candidates_list <- as.character(hop_results$canonical_human_symbol)

  # Generate markdown table for clean logging into docs/notes.md and terminal
  md_table <- ""
  if (nrow(hop_results) > 0) {
    display_df <- hop_results[, c("canonical_human_symbol", "reported_relationships", "functional_modules", "study_count", "supporting_studies")]
    colnames(display_df) <- c("Candidate", "Reported Relationships", "Functional Modules", "Studies", "Study IDs")
    md_table <- paste(knitr::kable(display_df, format = "pipe"), collapse = "\n")
    cat(sprintf("\n### Two-Way Interrogation: %d candidates found for seeds '%s'\n\n", nrow(hop_results), paste(seed_symbols, collapse = ", ")))
    cat(md_table, "\n\n")
  }

  emit(list(
    ok = TRUE,
    db_path = db_path,
    seed_symbols = seed_symbols,
    seed_mentions_count = nrow(direct_mentions),
    candidates_count = nrow(hop_results),
    candidate_symbols = candidates_list,
    candidates = hop_results,
    direct_mentions = head(direct_mentions, 20),
    markdown_table = md_table
  ))
}

tryCatch(main(), error = function(e) fail(conditionMessage(e)))
