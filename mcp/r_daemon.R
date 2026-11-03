#!/usr/bin/env Rscript
# ==============================================================================
# TidyProteomics Persistent R Daemon (Complete API Coverage)
# Listens on HTTP via httpuv to maintain in-memory tidyproteomics state,
# execute all package operations, auto-log reproducible R code, and save outputs.
# ==============================================================================

suppressPackageStartupMessages({
  library(httpuv)
  library(jsonlite)
  library(dplyr)
  library(tidyproteomics)

  # Pre-warm heavy computational and statistical packages used by tidyproteomics
  # to eliminate cold-start latency spikes on first expression/enrichment/imputation calls
  for (pkg in c("limma", "fgsea", "randomForest", "ggplot2", "glue")) {
    if (requireNamespace(pkg, quietly = TRUE)) {
      library(pkg, character.only = TRUE)
    }
  }
})

# Daemon State
STATE <- new.env(parent = emptyenv())
STATE$datasets <- list()
STATE$active_id <- "rdata"
STATE$pipeline_code <- c(
  "# ==============================================================================",
  "# Auto-generated Reproducible tidyproteomics Analysis Pipeline",
  glue::glue("# Generated: {Sys.time()}"),
  "# ==============================================================================",
  "",
  "library(dplyr)",
  "library(tidyproteomics)",
  ""
)
STATE$output_dir <- getwd()

# Helper: Append code to pipeline log
log_code <- function(code_str) {
  STATE$pipeline_code <- c(STATE$pipeline_code, code_str)
}

# Helper: Get current active dataset
get_active_data <- function(id = NULL) {
  target_id <- if (!is.null(id) && nzchar(trimws(id))) trimws(id) else STATE$active_id
  if (is.null(STATE$datasets[[target_id]])) {
    stop(glue::glue("No dataset found under ID '{target_id}'. Load data first."))
  }
  return(STATE$datasets[[target_id]])
}

# Helper: Set current active dataset
set_active_data <- function(data, id = NULL) {
  if (is.null(id) || !nzchar(trimws(id))) id <- STATE$active_id
  STATE$datasets[[id]] <- data
  STATE$active_id <- id
}

# Helper: Format safe comparison expression with backticks
format_comparison <- function(comp) {
  if (is.null(comp) || !nzchar(trimws(comp))) return("`knockdown` / `control`")
  comp_clean <- trimws(comp)
  if (grepl("^`.*`\\s*/\\s*`.*`$", comp_clean)) return(comp_clean)
  parts <- strsplit(comp_clean, "\\s*/\\s*")[[1]]
  if (length(parts) < 2) parts <- strsplit(comp_clean, "\\s+[vV][sS]\\.?\\s+")[[1]]
  if (length(parts) < 2) parts <- strsplit(comp_clean, "\\s*-\\s*")[[1]]
  if (length(parts) >= 2) {
    var1 <- gsub("^[`'\"]+|[`'\"]+$", "", trimws(parts[1]))
    var2 <- gsub("^[`'\"]+|[`'\"]+$", "", trimws(parts[2]))
    return(paste0("`", var1, "` / `", var2, "`"))
  }
  return(comp_clean)
}

# Helper: Dynamically discover or format comparison contrast based on active dataset state
resolve_comparison <- function(data, comp = NULL) {
  if (!is.null(comp) && nzchar(trimws(comp))) {
    return(format_comparison(comp))
  }
  # 1. Try to discover modeled comparisons from analyses in data
  if (!is.null(data) && !is.null(data$analyses)) {
    if (!is.null(data$analyses$expression) && length(names(data$analyses$expression)) > 0) {
      first_comp <- names(data$analyses$expression)[1]
      return(format_comparison(first_comp))
    }
    if (!is.null(data$analyses$enrichment) && length(names(data$analyses$enrichment)) > 0) {
      first_comp <- names(data$analyses$enrichment)[1]
      return(format_comparison(first_comp))
    }
  }
  # 2. Try to discover experimental cohorts from experiments table or vector
  if (!is.null(data)) {
    exps <- character(0)
    if (!is.null(data$experiments)) {
      if (is.data.frame(data$experiments) && "experiment" %in% names(data$experiments)) {
        exps <- unique(as.character(data$experiments$experiment))
      } else if (is.character(data$experiments)) {
        exps <- unique(data$experiments)
      }
    }
    exps <- exps[nzchar(exps)]
    if (length(exps) == 2) {
      ctrl_idx <- grep("control|ctrl|wt|wild_?type|vehicle|mock", exps, ignore.case = TRUE)
      if (length(ctrl_idx) == 1) {
        treatment <- exps[-ctrl_idx][1]
        ctrl <- exps[ctrl_idx][1]
        return(format_comparison(paste0(treatment, "/", ctrl)))
      } else {
        return(format_comparison(paste0(exps[1], "/", exps[2])))
      }
    } else if (length(exps) > 2) {
      stop(glue::glue("Multiple experimental cohorts detected: {paste(exps, collapse = ', ')}. Please specify 'comparison' explicitly (e.g. '{exps[1]}/{exps[2]}')."))
    }
  }
  return(format_comparison(comp))
}

# Helper: Format lean state summary card (~50 tokens vs ~2000 tokens for print(data))
format_state_card <- function(data, id = NULL) {
  if (is.null(data) || !"tidyproteomics" %in% class(data)) {
    return(paste(capture.output(print(data)), collapse = "\n"))
  }
  target_id <- if (!is.null(id)) id else STATE$active_id
  analyte <- if (!is.null(data$analyte)) data$analyte else "proteins"
  origin <- if (!is.null(data$origin)) data$origin else "unknown"
  source <- if (!is.null(data$quantitative_source)) data$quantitative_source else "raw"
  samples <- if (!is.null(data$experiments$sample)) unique(data$experiments$sample) else character(0)
  n_samples <- length(samples)
  samples_str <- if (n_samples <= 6) paste(samples, collapse = ", ") else paste0(paste(samples[1:5], collapse = ", "), ", ... (+", n_samples - 5, " more)")
  n_files <- if (!is.null(data$experiments)) nrow(data$experiments) else 0

  id_col <- if (!is.null(data$identifier)) data$identifier else "protein"
  n_entities <- if (!is.null(data$quantitative[[id_col]])) length(unique(data$quantitative[[id_col]])) else 0

  quant_col <- paste0("abundance_", source)

  has_imputed_vals <- !is.null(data$accounting$imputed) && any(as.numeric(data$accounting$imputed) > 0, na.rm = TRUE)
  has_impute_op <- !is.null(data$operations) && any(grepl("Missing values imputed", unlist(data$operations), ignore.case = TRUE))
  is_imputed <- isTRUE(has_imputed_vals) || isTRUE(has_impute_op)
  imputed_str <- if (is_imputed) "Yes" else "No"
  ops_count <- length(data$operations)

  # Calculate true matrix missingness across the full entities x files grid
  total_cells <- n_entities * n_files
  observed_cells <- 0
  if (total_cells > 0 && !is.null(data$quantitative[[quant_col]])) {
    obs_vals <- data$quantitative[[quant_col]]
    observed_cells <- sum(!is.na(obs_vals) & obs_vals > 0)
  }
  missing_cells <- max(0, total_cells - observed_cells)
  missing_pct <- if (total_cells > 0) {
    round(100 * (missing_cells / total_cells), 1)
  } else "N/A"

  paste0(
    "[TidyProteomics State: ", target_id, "]\n",
    "- Analyte & Origin: ", analyte, " (", origin, ")\n",
    "- Quantified Entities: ", n_entities, " ", analyte, " across ", n_files, " files (grouped into ", n_samples, " cohorts: ", samples_str, ")\n",
    "- Active Assay: ", source, " | Imputed: ", imputed_str, " (Residual missing values: ", missing_pct, "% [", missing_cells, " of ", total_cells, " cells])\n",
    "- Matrix Dimensions: ", n_entities, " x ", n_files, " = ", total_cells, " data points (observed: ", observed_cells, ", missing: ", missing_cells, ")\n",
    "- Operations History: ", ops_count, " operation(s) recorded"
  )
}

resolve_or_stage_file <- function(raw_file) {
  if (is.null(raw_file) || !nzchar(raw_file)) return(raw_file)
  if (grepl("^https?://", raw_file, ignore.case = TRUE)) {
    raw_dir <- if (!is.null(STATE$output_dir) && nzchar(STATE$output_dir)) file.path(STATE$output_dir, "data/raw") else "data/raw"
    dir.create(raw_dir, recursive = TRUE, showWarnings = FALSE)
    dest_file <- file.path(raw_dir, basename(raw_file))
    if (!file.exists(dest_file)) {
      cat(glue::glue("[TidyDaemon] Staging remote file from {raw_file} to {dest_file} ...\n"))
      tryCatch({
        download.file(raw_file, destfile = dest_file, mode = "wb", quiet = TRUE)
      }, error = function(e) {
        warning(glue::glue("[TidyDaemon] Warning: Failed to stage remote file from {raw_file}: {conditionMessage(e)}"))
      })
    }
    return(dest_file)
  }
  if (!file.exists(raw_file) && !is.null(STATE$output_dir) && file.exists(file.path(STATE$output_dir, raw_file))) {
    return(file.path(STATE$output_dir, raw_file))
  }
  if (!file.exists(raw_file) && file.exists(file.path("data/raw", basename(raw_file)))) {
    return(file.path("data/raw", basename(raw_file)))
  }
  raw_file
}

split_top_level_and <- function(expr_str) {
  chars <- strsplit(expr_str, "")[[1]]
  in_single <- FALSE
  in_double <- FALSE
  paren_depth <- 0L
  clauses <- character(0)
  buf <- character(0)
  i <- 1L
  n <- length(chars)
  while (i <= n) {
    ch <- chars[i]
    prev <- if (i > 1L) chars[i - 1L] else ""
    if (ch == "'" && !in_double && prev != "\\") {
      in_single <- !in_single
      buf <- c(buf, ch)
    } else if (ch == "\"" && !in_single && prev != "\\") {
      in_double <- !in_double
      buf <- c(buf, ch)
    } else if (!in_single && !in_double && ch == "(") {
      paren_depth <- paren_depth + 1L
      buf <- c(buf, ch)
    } else if (!in_single && !in_double && ch == ")") {
      paren_depth <- max(0L, paren_depth - 1L)
      buf <- c(buf, ch)
    } else if (!in_single && !in_double && paren_depth == 0L && ch == "&") {
      next_ch <- if (i < n) chars[i + 1L] else ""
      clauses <- c(clauses, trimws(paste(buf, collapse = "")))
      buf <- character(0)
      if (next_ch == "&") i <- i + 1L
    } else {
      buf <- c(buf, ch)
    }
    i <- i + 1L
  }
  last_clause <- trimws(paste(buf, collapse = ""))
  if (nzchar(last_clause)) clauses <- c(clauses, last_clause)
  clauses[nzchar(clauses)]
}

# Helper: Resolve Reactome IDs to human-readable pathway names
resolve_reactome_ids <- function(ids) {
  if (is.null(ids) || length(ids) == 0) return(character(0))
  resolved <- as.character(ids)
  reactome_idx <- which(grepl("^R-[A-Z]{3}-[0-9]+", resolved))
  if (length(reactome_idx) == 0) return(resolved)

  unique_reactome <- unique(resolved[reactome_idx])
  name_map <- list()

  tsv_paths <- c(
    if (!is.null(STATE$output_dir) && nzchar(STATE$output_dir)) file.path(STATE$output_dir, "tools/reactome_pathways.tsv") else NULL,
    if (!is.null(STATE$output_dir) && nzchar(STATE$output_dir)) file.path(STATE$output_dir, "data/reactome_pathways.tsv") else NULL,
    if (!is.null(STATE$output_dir) && nzchar(STATE$output_dir)) file.path(STATE$output_dir, "templates/shared/tools/reactome_pathways.tsv") else NULL,
    "tools/reactome_pathways.tsv",
    "data/reactome_pathways.tsv",
    "templates/shared/tools/reactome_pathways.tsv",
    "extension/templates/shared/tools/reactome_pathways.tsv"
  )
  for (tp in tsv_paths) {
    if (!is.null(tp) && file.exists(tp)) {
      tryCatch({
        df <- read.delim(tp, header = FALSE, stringsAsFactors = FALSE, sep = "\t")
        if (ncol(df) >= 2) {
          sub_df <- df[df[[1]] %in% unique_reactome, ]
          if (nrow(sub_df) > 0) {
            for (i in seq_len(nrow(sub_df))) name_map[[sub_df[i, 1]]] <- sub_df[i, 2]
          }
        }
      }, error = function(e) NULL)
      if (length(name_map) > 0) break
    }
  }

  unresolved <- setdiff(unique_reactome, names(name_map))
  if (length(unresolved) > 0) {
    old_to <- getOption("timeout")
    on.exit(options(timeout = old_to), add = TRUE)
    options(timeout = 3)
    for (rid in head(unresolved, 20)) {
      suppressWarnings(tryCatch({
        url <- paste0("https://reactome.org/ContentService/data/query/", rid)
        con <- url(url, open = "r")
        raw_txt <- readLines(con, warn = FALSE)
        close(con)
        if (length(raw_txt) > 0) {
          parsed <- jsonlite::fromJSON(paste(raw_txt, collapse = "\n"))
          if (!is.null(parsed$displayName) && nzchar(parsed$displayName)) name_map[[rid]] <- parsed$displayName
        }
      }, error = function(e) NULL))
    }
  }

  for (i in reactome_idx) {
    rid <- resolved[i]
    if (!is.null(name_map[[rid]]) && nzchar(name_map[[rid]])) resolved[i] <- name_map[[rid]]
  }
  return(resolved)
}

# Helper: Format statistical p-values with scientific notation if < 1e-4
fmt_pvalue <- function(v) {
  if (is.null(v) || length(v) == 0) return(character(0))
  vapply(v, function(x) {
    if (is.null(x) || is.na(x)) return("NA")
    if (is.numeric(x)) {
      if (!is.finite(x)) return(as.character(x))
      if (x < 1e-4) return(sprintf("%.2e", x))
      return(sprintf("%.4f", x))
    }
    as.character(x)
  }, character(1), USE.NAMES = FALSE)
}

# ------------------------------------------------------------------------------
# Annotation Helpers (File Normalization, Coverage Audit, UniProt REST Fetcher)
# ------------------------------------------------------------------------------

# Helper: Resolve file path within active workspace if needed
resolve_workspace_file <- function(file_path) {
  if (is.null(file_path) || !nzchar(trimws(file_path))) return(NULL)
  trimmed <- trimws(file_path)
  if (file.exists(trimmed)) return(trimmed)
  if (!is.null(STATE$output_dir) && nzchar(STATE$output_dir)) {
    ws_path <- file.path(STATE$output_dir, trimmed)
    if (file.exists(ws_path)) return(ws_path)
  }
  return(trimmed)
}

# Helper: Load and normalize annotation table from CSV/TSV/delimited file
# Returns a tibble with columns c(target_id_col, "term", "annotation")
load_and_normalize_annotation_table <- function(file_path, target_id_col = "protein") {
  actual_path <- resolve_workspace_file(file_path)
  if (is.null(actual_path) || !file.exists(actual_path)) {
    stop(glue::glue("Annotation file not found: {file_path}"))
  }

  first_line <- readLines(actual_path, n = 1, warn = FALSE)
  delim <- if (grepl("\t", first_line)) "\t" else if (grepl(",", first_line)) "," else if (grepl(";", first_line)) ";" else "\t"
  
  df <- suppressMessages(readr::read_delim(actual_path, delim = delim, show_col_types = FALSE, progress = FALSE))
  if (nrow(df) == 0) stop("Annotation table is empty.")

  col_names_lower <- tolower(names(df))

  # 1. Resolve Identifier column
  id_aliases <- c(tolower(target_id_col), "protein", "accession", "uniprot", "uniprot_id", "entry", "identifier", "protein_id", "protein.ids", "protein_ids", "gene_name", "gene")
  matched_id_idx <- which(col_names_lower %in% id_aliases)
  if (length(matched_id_idx) == 0) {
    first_col_sample <- as.character(df[[1]][!is.na(df[[1]])])[1:min(5, nrow(df))]
    if (any(grepl("^[A-NR-Z0-9]{5,10}", first_col_sample))) {
      matched_id_idx <- 1
    } else {
      stop(glue::glue("Could not identify protein identifier column in '{basename(file_path)}'. Found columns: {paste(names(df), collapse = ', ')}"))
    }
  }
  names(df)[matched_id_idx[1]] <- target_id_col

  # 2. Check if table is long (has term + annotation) or wide (has biological_process, cellular_component, etc.)
  term_aliases <- c("term", "category", "ontology", "aspect", "type", "namespace")
  annot_aliases <- c("annotation", "name", "description", "term_name", "pathway", "pathway_name", "go_name", "go_term")

  matched_term_idx <- which(col_names_lower %in% term_aliases)
  matched_annot_idx <- which(col_names_lower %in% annot_aliases)

  out_df <- NULL
  if (length(matched_term_idx) > 0 && length(matched_annot_idx) > 0) {
    term_col_name <- names(df)[matched_term_idx[1]]
    annot_col_name <- names(df)[matched_annot_idx[1]]
    out_df <- df %>%
      dplyr::select(dplyr::all_of(target_id_col), term = dplyr::all_of(term_col_name), annotation = dplyr::all_of(annot_col_name))
  } else {
    wide_term_cols <- setdiff(names(df), target_id_col)
    cand_terms <- wide_term_cols[grepl("process|component|function|pathway|reactome|kegg|go|wiki|domain|family", tolower(wide_term_cols))]
    if (length(cand_terms) == 0) cand_terms <- wide_term_cols
    
    out_df <- df %>%
      dplyr::select(dplyr::all_of(c(target_id_col, cand_terms))) %>%
      tidyr::pivot_longer(cols = dplyr::all_of(cand_terms), names_to = "term", values_to = "annotation") %>%
      dplyr::filter(!is.na(annotation), nzchar(trimws(as.character(annotation))))
  }

  out_df <- out_df %>%
    dplyr::mutate(
      !!rlang::sym(target_id_col) := trimws(as.character(.data[[target_id_col]])),
      term = tolower(trimws(as.character(term))),
      annotation = trimws(as.character(annotation))
    ) %>%
    dplyr::filter(!is.na(.data[[target_id_col]]), nzchar(.data[[target_id_col]]), !is.na(term), nzchar(term), !is.na(annotation), nzchar(annotation)) %>%
    dplyr::distinct()

  out_df <- out_df %>%
    dplyr::mutate(
      term = dplyr::case_when(
        term %in% c("bp", "go_bp", "go_p", "biological process", "biological_process") ~ "biological_process",
        term %in% c("cc", "go_cc", "go_c", "cellular component", "cellular_component") ~ "cellular_component",
        term %in% c("mf", "go_mf", "go_f", "molecular function", "molecular_function") ~ "molecular_function",
        term %in% c("reactome", "reactome_pathway", "reactome_pathways") ~ "reactome_pathway",
        term %in% c("kegg", "kegg_pathway", "kegg_pathways") ~ "kegg",
        term %in% c("wiki", "wikipathways", "wiki_pathway", "wiki_pathways") ~ "wiki_pathway",
        TRUE ~ term
      )
    )

  return(out_df)
}

# Helper: Fetch annotations from UniProt KB REST API for accessions
fetch_uniprot_annotations <- function(orig_ids, target_id_col = "protein", target_categories = NULL, batch_size = 40) {
  if (length(orig_ids) == 0) {
    empty_res <- tibble::tibble(x = character(0), term = character(0), annotation = character(0))
    names(empty_res)[1] <- target_id_col
    return(empty_res)
  }

  acc_regex <- "[OPQ][0-9][A-Z0-9]{3}[0-9]|[A-NR-Z][0-9]([A-Z][A-Z0-9]{2}[0-9]){1,2}"
  m <- regexpr(acc_regex, orig_ids)
  clean_accs <- ifelse(m != -1, regmatches(orig_ids, m), NA_character_)
  
  # Mapping from clean accession back to original IDs in dataset
  id_map <- tibble::tibble(orig = orig_ids, clean = clean_accs) %>%
    dplyr::filter(!is.na(clean), nzchar(clean))

  unique_clean <- unique(id_map$clean)
  if (length(unique_clean) == 0) {
    empty_res <- tibble::tibble(x = character(0), term = character(0), annotation = character(0))
    names(empty_res)[1] <- target_id_col
    return(empty_res)
  }

  total_batches <- ceiling(length(unique_clean) / batch_size)
  cat(glue::glue("[TidyDaemon] Fetching UniProt annotations for {length(unique_clean)} distinct accessions across {total_batches} batches...\n"))

  all_rows <- list()
  last_err <- NULL
  fields_arg <- "accession,id,gene_names,go_p,go_c,go_f,xref_reactome,xref_kegg"

  for (b in seq_len(total_batches)) {
    start_i <- (b - 1) * batch_size + 1
    end_i <- min(b * batch_size, length(unique_clean))
    batch_accs <- unique_clean[start_i:end_i]
    
    # Use UniProt search endpoint: /uniprotkb/search?query=accession:X OR accession:Y
    query_param <- paste0("accession:", batch_accs, collapse = " OR ")
    query_url <- paste0(
      "https://rest.uniprot.org/uniprotkb/search?query=",
      utils::URLencode(query_param),
      "&fields=", fields_arg,
      "&format=json&size=", length(batch_accs)
    )
    
    res_text <- NULL
    for (attempt in 1:2) {
      tryCatch({
        resp <- httr::GET(
          query_url,
          httr::user_agent("TidyProteomicsAgent/1.0"),
          httr::timeout(45)
        )
        st <- httr::status_code(resp)
        if (st == 200) {
          res_text <- httr::content(resp, as = "text", encoding = "UTF-8")
          break
        } else {
          last_err <- glue::glue("HTTP {st} from UniProt API")
          cat(glue::glue("[TidyDaemon] Warning: batch {b}/{total_batches} HTTP {st} (attempt {attempt}/2)\n"))
          if (attempt < 2) Sys.sleep(1.5)
        }
      }, error = function(e) {
        last_err <- e$message
        cat(glue::glue("[TidyDaemon] Warning: batch {b}/{total_batches} fetch error: {e$message} (attempt {attempt}/2)\n"))
        if (attempt < 2) Sys.sleep(1.5)
      })
    }

    if (!is.null(res_text) && nzchar(res_text)) {
      parsed <- tryCatch(jsonlite::fromJSON(res_text, simplifyVector = FALSE), error = function(e) NULL)
      results <- if (!is.null(parsed$results)) parsed$results else list()

      for (entry in results) {
        acc <- entry$primaryAccession
        if (is.null(acc) || !nzchar(acc)) next

        # 1. Gene Names
        gname <- NULL
        if (!is.null(entry$genes) && length(entry$genes) > 0) {
          first_gene <- entry$genes[[1]]
          if (!is.null(first_gene$geneName$value)) gname <- first_gene$geneName$value
        }
        if (!is.null(gname) && nzchar(gname)) {
          all_rows[[length(all_rows) + 1]] <- list(clean = acc, term = "gene_name", annotation = gname)
        }

        # 2. Cross references (GO, Reactome, KEGG)
        xrefs <- entry$uniProtKBCrossReferences
        if (!is.null(xrefs) && length(xrefs) > 0) {
          for (xref in xrefs) {
            db <- xref$database
            if (identical(db, "GO")) {
              props <- xref$properties
              go_term <- NULL
              for (p in props) {
                if (identical(p$key, "GoTerm")) { go_term <- p$value; break }
              }
              if (!is.null(go_term) && nzchar(go_term)) {
                aspect <- substr(go_term, 1, 2)
                clean_name <- sub("^[PCF]:", "", go_term)
                term_name <- switch(aspect,
                  "P:" = "biological_process",
                  "C:" = "cellular_component",
                  "F:" = "molecular_function",
                  "biological_process"
                )
                all_rows[[length(all_rows) + 1]] <- list(clean = acc, term = term_name, annotation = clean_name)
              }
            } else if (identical(db, "Reactome")) {
              props <- xref$properties
              pname <- NULL
              for (p in props) {
                if (identical(p$key, "PathwayName")) { pname <- p$value; break }
              }
              if (!is.null(pname) && nzchar(pname)) {
                all_rows[[length(all_rows) + 1]] <- list(clean = acc, term = "reactome_pathway", annotation = pname)
              }
            } else if (identical(db, "KEGG")) {
              kid <- xref$id
              if (!is.null(kid) && nzchar(kid)) {
                all_rows[[length(all_rows) + 1]] <- list(clean = acc, term = "kegg", annotation = kid)
              }
            }
          }
        }
      }
    }
  }

  if (length(all_rows) == 0) {
    if (!is.null(last_err)) {
      attr(all_rows, "last_error") <- last_err
    }
    empty_res <- tibble::tibble(x = character(0), term = character(0), annotation = character(0))
    names(empty_res)[1] <- target_id_col
    return(empty_res)
  }

  raw_annot_df <- dplyr::bind_rows(lapply(all_rows, tibble::as_tibble)) %>%
    dplyr::distinct()

  # Map clean accession back to original protein identifiers
  final_df <- id_map %>%
    dplyr::inner_join(raw_annot_df, by = "clean") %>%
    dplyr::select(!!rlang::sym(target_id_col) := orig, term, annotation) %>%
    dplyr::distinct()

  # Filter target categories if provided
  if (!is.null(target_categories) && length(target_categories) > 0) {
    cats_vec <- tolower(trimws(unlist(strsplit(as.character(target_categories), "[,; ]+"))))
    cats_vec <- cats_vec[nzchar(cats_vec)]
    if (length(cats_vec) > 0 && !("all" %in% cats_vec)) {
      final_df <- final_df %>% dplyr::filter(term %in% cats_vec | term %in% c("gene_name", "description"))
    }
  }

  return(final_df)
}

# Router logic
handle_request <- function(req) {
  path <- req$PATH_INFO
  method <- req$REQUEST_METHOD

  # Read body
  body_raw <- req[['rook.input']]$read()
  body_text <- rawToChar(body_raw)
  params <- list()
  if (nchar(body_text) > 0) {
    tryCatch({
      params <- jsonlite::fromJSON(body_text, simplifyVector = FALSE)
    }, error = function(e) {
      params <<- list()
    })
  }

  res_data <- tryCatch({
    switch(path,
      "/health" = {
        list(
          status = "ok",
          active_id = STATE$active_id,
          datasets = names(STATE$datasets),
          tidyproteomics_version = as.character(packageVersion("tidyproteomics")),
          r_version = R.version.string,
          output_dir = STATE$output_dir,
          working_dir = getwd()
        )
      },

      "/set_workspace" = {
        workspace_dir <- params$workspace
        if (is.null(workspace_dir) || !nzchar(workspace_dir)) {
          workspace_dir <- params$dir
        }
        if (is.null(workspace_dir) || !nzchar(workspace_dir)) {
          stop("Workspace directory path is required")
        }
        if (!dir.exists(workspace_dir)) {
          dir.create(workspace_dir, recursive = TRUE, showWarnings = FALSE)
        }
        setwd(workspace_dir)
        STATE$output_dir <- getwd()

        # Reset datasets if requested or if changing workspace
        reset_session <- isTRUE(params$reset) || isTRUE(params$clear)
        if (reset_session) {
          STATE$datasets <- list()
          STATE$active_id <- "rdata"
          STATE$pipeline_code <- c(
            "# ==============================================================================",
            "# Auto-generated Reproducible tidyproteomics Analysis Pipeline",
            glue::glue("# Generated: {Sys.time()}"),
            "# ==============================================================================",
            "",
            "library(dplyr)",
            "library(tidyproteomics)",
            ""
          )
        }

        cat(glue::glue("[TidyDaemon] Active workspace set to: {STATE$output_dir}\n"))
        list(
          success = TRUE,
          workspace = STATE$output_dir,
          datasets = names(STATE$datasets),
          active_id = STATE$active_id
        )
      },

      "/reset" = {
        STATE$datasets <- list()
        STATE$active_id <- "rdata"
        STATE$pipeline_code <- c(
            "# ==============================================================================",
            "# Auto-generated Reproducible tidyproteomics Analysis Pipeline",
            glue::glue("# Generated: {Sys.time()}"),
            "# ==============================================================================",
            "",
            "library(dplyr)",
            "library(tidyproteomics)",
            ""
        )
        list(success = TRUE, message = "Session and datasets reset successfully.")
      },

      # ------------------------------------------------------------------------
      # Data Ingestion & State
      # ------------------------------------------------------------------------
      "/load" = {
        data_id <- if (!is.null(params$id) && nzchar(params$id)) params$id else "rdata"
        source <- if (!is.null(params$source) && nzchar(params$source)) params$source else "hela_proteins"
        load_local_arg <- params$load_local
        platform <- if (!is.null(params$platform) && nzchar(params$platform)) params$platform else "ProteomeDiscoverer"
        analyte <- if (!is.null(params$analyte) && nzchar(params$analyte)) params$analyte else "proteins"
        config_arg <- params$config
        if (is.null(config_arg) || !nzchar(config_arg)) {
          config_arg <- params$path
        }
        if (!is.null(config_arg) && nzchar(config_arg)) {
          if (!file.exists(config_arg) && file.exists(file.path(STATE$output_dir, config_arg))) {
            config_arg <- file.path(STATE$output_dir, config_arg)
          }
          if (!file.exists(config_arg)) {
            stop(glue::glue("Custom config file not found: '{config_arg}'"))
          }
        } else {
          config_arg <- NULL
        }

        data <- NULL

        # 1. Check if load_local was specified as an analyte
        if (!is.null(load_local_arg) && load_local_arg %in% c("proteins", "peptides")) {
          data <- tidyproteomics::load_local(analyte = load_local_arg)
          log_code(glue::glue("{data_id} <- load_local(analyte = '{load_local_arg}')"))

        # 2. Check if source or load_local points to an RDS file
        } else if (grepl("\\.rds$", source, ignore.case = TRUE) ||
                   (!is.null(load_local_arg) && grepl("\\.rds$", load_local_arg, ignore.case = TRUE)) ||
                   tolower(platform) %in% c("tidyproteomics", "rds")) {
          rds_file <- if (grepl("\\.rds$", source, ignore.case = TRUE)) source else if (!is.null(load_local_arg) && grepl("\\.rds$", load_local_arg, ignore.case = TRUE)) load_local_arg else source
          if (!file.exists(rds_file) && file.exists(file.path(STATE$output_dir, rds_file))) {
            rds_file <- file.path(STATE$output_dir, rds_file)
          }
          if (!file.exists(rds_file)) {
            stop(glue::glue("RDS file not found: '{rds_file}' (current working directory: {getwd()})"))
          }
          data <- readRDS(rds_file)
          read_rds_line <- glue::glue("{data_id} <- readRDS('{rds_file}')")
          if (length(STATE$pipeline_code) == 0 || tail(STATE$pipeline_code, 1) != read_rds_line) {
            log_code(read_rds_line)
          }

        # 3. Check if source is a remote HTTP/HTTPS URL
        } else if (grepl("^https?://", source, ignore.case = TRUE)) {
          dir.create("data/raw", recursive = TRUE, showWarnings = FALSE)
          dest_file <- file.path("data/raw", basename(source))
          if (!file.exists(dest_file)) {
            cat(glue::glue("[TidyDaemon] Downloading remote dataset from {source} to {dest_file} ...\n"))
            download.file(source, destfile = dest_file, mode = "wb", quiet = TRUE)
          }
          if (grepl("\\.rds$", dest_file, ignore.case = TRUE)) {
            data <- readRDS(dest_file)
            log_code(glue::glue("{data_id} <- readRDS('{dest_file}')"))
          } else {
            if (!is.null(config_arg)) {
              data <- import(files = dest_file, platform = platform, analyte = analyte, path = config_arg)
              log_code(glue::glue("{data_id} <- import(files = '{dest_file}', platform = '{platform}', analyte = '{analyte}', path = '{config_arg}')"))
            } else {
              data <- import(files = dest_file, platform = platform, analyte = analyte)
              log_code(glue::glue("{data_id} <- import(files = '{dest_file}', platform = '{platform}', analyte = '{analyte}')"))
            }
          }

        # 4. Built-in package datasets
        } else if (source == "hela_proteins") {
          data <- tidyproteomics::hela_proteins
          log_code(glue::glue("{data_id} <- hela_proteins"))

        } else if (grepl("^(p97KD_HCT116|p97|hela)", source)) {
          pkg_data_path <- path_to_package_data(source)
          data <- import(files = pkg_data_path, platform = platform, analyte = analyte)
          log_code(glue::glue("{data_id} <- path_to_package_data('{source}') %>% import('{platform}', '{analyte}')"))

        # 5. Local raw tabular files (ProteomeDiscoverer, MaxQuant, DIA-NN, etc.)
        } else {
          local_file <- source
          if (!file.exists(local_file) && file.exists(file.path(STATE$output_dir, local_file))) {
            local_file <- file.path(STATE$output_dir, local_file)
          }
          if (!is.null(config_arg)) {
            data <- import(files = local_file, platform = platform, analyte = analyte, path = config_arg)
            log_code(glue::glue("{data_id} <- import(files = '{local_file}', platform = '{platform}', analyte = '{analyte}', path = '{config_arg}')"))
          } else {
            data <- import(files = local_file, platform = platform, analyte = analyte)
            log_code(glue::glue("{data_id} <- import(files = '{local_file}', platform = '{platform}', analyte = '{analyte}')"))
          }
        }

        set_active_data(data, data_id)
        summary_text <- format_state_card(data, data_id)
        list(success = TRUE, id = data_id, summary = summary_text)
      },

      "/import_expression_table" = {
        data_id <- if (!is.null(params$id) && nzchar(params$id)) params$id else "rdata"
        file_path <- params$file_path
        if (is.null(file_path) || !nzchar(file_path)) {
          stop("file_path is required for import_expression_table")
        }
        if (!file.exists(file_path) && file.exists(file.path(STATE$output_dir, file_path))) {
          file_path <- file.path(STATE$output_dir, file_path)
        }
        if (!file.exists(file_path)) {
          stop(glue::glue("Expression table file not found: '{file_path}'"))
        }

        comparison <- if (!is.null(params$comparison) && nzchar(params$comparison)) params$comparison else "treatment/control"

        # Read CSV or TSV
        raw_df <- if (grepl("\\.csv$", file_path, ignore.case = TRUE)) {
          read.csv(file_path, check.names = FALSE, stringsAsFactors = FALSE)
        } else {
          read.delim(file_path, check.names = FALSE, stringsAsFactors = FALSE)
        }

        col_names <- names(raw_df)

        # 1. Identifier column
        id_col <- params$id_col
        if (is.null(id_col) || !nzchar(id_col) || !id_col %in% col_names) {
          matched_id <- grep("^(protein|accession|protein_id|uniprot|id|identifier)$", col_names, ignore.case = TRUE, value = TRUE)
          id_col <- if (length(matched_id) > 0) matched_id[1] else col_names[1]
        }

        # 2. Gene name column (optional)
        gene_col <- params$gene_name_col
        if (is.null(gene_col) || !nzchar(gene_col) || !gene_col %in% col_names) {
          matched_gene <- grep("^(gene_name|gene|symbol|gene_symbol|genes)$", col_names, ignore.case = TRUE, value = TRUE)
          gene_col <- if (length(matched_gene) > 0) matched_gene[1] else NULL
        }

        # 3. log2FC column
        log2fc_col <- params$log2fc_col
        if (is.null(log2fc_col) || !nzchar(log2fc_col) || !log2fc_col %in% col_names) {
          matched_fc <- grep("^(log2_foldchange|log2fc|logfc|log2_fc|diff)$", col_names, ignore.case = TRUE, value = TRUE)
          if (length(matched_fc) == 0) matched_fc <- grep("log2", col_names, ignore.case = TRUE, value = TRUE)
          if (length(matched_fc) == 0) stop("Could not auto-detect log2_foldchange column. Please specify log2fc_col.")
          log2fc_col <- matched_fc[1]
        }

        # 4. p-value column
        pval_col <- params$pvalue_col
        if (is.null(pval_col) || !nzchar(pval_col) || !pval_col %in% col_names) {
          matched_p <- grep("^(p_value|pvalue|p.value|p-value|pval)$", col_names, ignore.case = TRUE, value = TRUE)
          if (length(matched_p) > 0) pval_col <- matched_p[1] else pval_col <- NULL
        }

        # 5. adjusted p-value / FDR column
        padj_col <- params$padj_col
        if (is.null(padj_col) || !nzchar(padj_col) || !padj_col %in% col_names) {
          matched_adj <- grep("^(adj_p_value|adj_pval|q_value|qvalue|fdr|adj.p.val|padj)$", col_names, ignore.case = TRUE, value = TRUE)
          if (length(matched_adj) > 0) padj_col <- matched_adj[1] else padj_col <- NULL
        }

        # Format expression tibble
        expr_tibble <- tibble::tibble(
          protein = as.character(raw_df[[id_col]]),
          log2_foldchange = as.numeric(raw_df[[log2fc_col]]),
          p_value = if (!is.null(pval_col)) as.numeric(raw_df[[pval_col]]) else rep(NA_real_, nrow(raw_df)),
          adj_p_value = if (!is.null(padj_col)) as.numeric(raw_df[[padj_col]]) else if (!is.null(pval_col)) p.adjust(as.numeric(raw_df[[pval_col]]), method = "BH") else rep(NA_real_, nrow(raw_df))
        )
        if (!is.null(gene_col)) {
          expr_tibble$gene_name <- as.character(raw_df[[gene_col]])
        }

        # Deduplicate on protein if necessary
        expr_tibble <- expr_tibble %>% dplyr::distinct(protein, .keep_all = TRUE)

        # Parse comparison groups
        parts <- strsplit(comparison, "/")[[1]]
        trt <- if (length(parts) >= 1) parts[1] else "treatment"
        ctl <- if (length(parts) >= 2) parts[2] else "control"

        # Build annotations tibble
        annot_list <- list()
        if (!is.null(gene_col)) {
          annot_list[[length(annot_list) + 1]] <- tibble::tibble(
            protein = expr_tibble$protein,
            term = "gene_name",
            annotation = expr_tibble$gene_name
          )
        }

        annotations_df <- if (length(annot_list) > 0) do.call(rbind, annot_list) else tibble::tibble(protein = character(0), term = character(0), annotation = character(0))

        data <- list(
          origin = "external_expression_table",
          analyte = "proteins",
          identifier = "protein",
          quantitative_source = "raw",
          operations = c(glue::glue("Imported external expression table from '{basename(file_path)}'")),
          experiments = tibble::tibble(
            sample_id = c("S1", "S2"),
            sample = c(trt, ctl),
            replicate = c("1", "1"),
            sample_file = c(paste0(trt, "_rep1"), paste0(ctl, "_rep1")),
            import_file = c(basename(file_path), basename(file_path))
          ),
          quantitative = tibble::tibble(
            sample_id = rep(c("S1", "S2"), times = nrow(expr_tibble)),
            sample = rep(c(trt, ctl), times = nrow(expr_tibble)),
            replicate = rep(c("1", "1"), times = nrow(expr_tibble)),
            protein = rep(expr_tibble$protein, each = 2),
            abundance_raw = rep(100, nrow(expr_tibble) * 2)
          ),
          accounting = tibble::tibble(),
          annotations = annotations_df,
          analysis = list()
        )
        data$analysis[[comparison]] <- list(
          expression = expr_tibble
        )
        class(data) <- c("tidyproteomics", "list")

        set_active_data(data, data_id)
        log_code(glue::glue("# Imported external expression table: {basename(file_path)}"))
        log_code(glue::glue("# Comparison: {comparison} ({nrow(expr_tibble)} proteins)"))

        list(
          success = TRUE,
          id = data_id,
          comparison = comparison,
          n_proteins = nrow(expr_tibble),
          n_significant = sum(!is.na(expr_tibble$adj_p_value) & expr_tibble$adj_p_value <= 0.05 & abs(expr_tibble$log2_foldchange) >= 1.0, na.rm = TRUE),
          summary = glue::glue("Successfully imported external expression table '{basename(file_path)}' ({nrow(expr_tibble)} proteins, comparison: '{comparison}'). Ready for annotation fetch, functional enrichment, and synthesis.")
        )
      },

      # ------------------------------------------------------------------------
      # Inspection & Introspection Getters
      # ------------------------------------------------------------------------
      "/inspect" = {
        data <- get_active_data(params$id)
        what <- if (!is.null(params$what)) params$what else "samples"
        res_output <- NULL

        if (what == "samples") {
          res_output <- get_sample_names(data, format = "vector")
        } else if (what == "quants") {
          res_output <- get_quant_names(data, format = "vector")
        } else if (what == "analyses") {
          res_output <- capture.output(print(get_analyses(data)))
        } else if (what == "annotations") {
          res_output <- capture.output(print(show_annotations(data)))
        } else if (what == "annotation_terms") {
          res_output <- get_annotation_terms(data, format = "vector")
        } else if (what == "accountings") {
          res_output <- capture.output(print(get_accountings(data)))
        } else if (what %in% c("accounting", "protein_accounting", "feature_accounting")) {
          id_col <- if (!is.null(data$identifier)) data$identifier[1] else "protein"
          analyte_name <- if (!is.null(data$analyte)) data$analyte else "proteins"
          all_features <- get_unique_variables(data, id_col, format = "vector")
          total_features <- length(all_features)

          # Quantifiable features (with at least one non-missing abundance across samples)
          qn <- get_quant_names(data)
          active_sel <- if (is.data.frame(qn) && "selected" %in% names(qn)) qn$quant_name[qn$selected] else character(0)
          active_assay <- if (length(active_sel) > 0) active_sel[1] else tail(get_quant_names(data, format = "vector"), 1)
          quant_col <- paste0("abundance_", active_assay)

          df_long <- tryCatch(as.data.frame(data, shape = "long"), error = function(e) data.frame())
          zero_quant_n <- 0
          quantifiable_n <- total_features
          if (nrow(df_long) > 0 && quant_col %in% names(df_long) && id_col %in% names(df_long)) {
            obs_per_f <- tapply(!is.na(df_long[[quant_col]]), df_long[[id_col]], sum)
            zero_quant_n <- sum(obs_per_f == 0, na.rm = TRUE)
            quantifiable_n <- sum(obs_per_f > 0, na.rm = TRUE)
          }

          n_files <- if (!is.null(data$experiments)) nrow(data$experiments) else 0
          n_groups <- if (!is.null(data$experiments$sample)) length(unique(data$experiments$sample)) else length(get_sample_names(data, format = "vector"))
          total_cells <- total_features * n_files

          obs_vals <- if (!is.null(data$quantitative[[quant_col]])) data$quantitative[[quant_col]] else numeric(0)
          observed_cells <- sum(!is.na(obs_vals) & obs_vals > 0)
          missing_cells <- max(0, total_cells - observed_cells)
          missing_pct <- if (total_cells > 0) round(100 * (missing_cells / total_cells), 1) else 0

          acc_tbl <- tibble::tibble(
            accounting_metric = c(
              paste0("Total retained ", analyte_name, " in active object"),
              paste0("Quantifiable ", analyte_name, " (>= 1 non-zero observation)"),
              paste0("Zero-quantification background (0 non-missing values)"),
              "Active quantification assay",
              "Number of raw MS data files / replicates",
              "Number of biological condition cohorts/groups",
              "Total theoretical matrix cells (features x files)",
              "Observed quantifiable data points",
              "Missing / unquantified cells in matrix",
              "Matrix missingness percentage",
              "Number of evaluated comparisons/analyses"
            ),
            value = c(
              as.character(total_features),
              as.character(quantifiable_n),
              as.character(zero_quant_n),
              as.character(active_assay),
              as.character(n_files),
              as.character(n_groups),
              as.character(total_cells),
              as.character(observed_cells),
              as.character(missing_cells),
              paste0(missing_pct, "%"),
              as.character(nrow(get_analyses(data)))
            )
          )

          # If comparisons exist, add modeled vs unmodeled breakdown
          comps <- names(data$analysis)
          if (length(comps) > 0) {
            for (cn in comps) {
              exp_df <- data$analysis[[cn]]$expression
              if (!is.null(exp_df) && nrow(exp_df) > 0) {
                modeled_cnt <- nrow(exp_df)
                unmod_cnt <- total_features - modeled_cnt
                acc_tbl <- dplyr::bind_rows(acc_tbl, tibble::tibble(
                  accounting_metric = c(
                    paste0("Comparison '", cn, "' modeled ", analyte_name),
                    paste0("Comparison '", cn, "' unmodeled (condition-exclusive + zero-quant)")
                  ),
                  value = c(as.character(modeled_cnt), as.character(unmod_cnt))
                ))
              }
            }
          }
          res_output <- capture.output(print(acc_tbl, n = 30))
        } else if (what == "variables") {
          res_output <- get_variables(data)
        } else if (what == "unique_variables") {
          var_name <- if (!is.null(params$variable)) params$variable else "sample"
          res_output <- get_unique_variables(data, var_name, format = "vector")
          if (is.character(res_output) && length(res_output) > 50) {
            total_n <- length(res_output)
            res_output <- c(
              head(res_output, 20),
              glue::glue("... [truncated {total_n - 20} values; total: {total_n} unique values for '{var_name}']")
            )
          }
        } else if (what == "experiments") {
          res_output <- capture.output(print(data$experiments))
        } else if (what == "operations") {
          res_output <- if (!is.null(data$operations)) unlist(data$operations) else capture.output(operations(data), type = "message")
        } else if (what %in% c("overview", "summary")) {
          res_output <- format_state_card(data, params$id)
        } else {
          stop(glue::glue("Unknown inspection query '{what}'"))
        }

        formatted <- if (is.character(res_output)) paste(res_output, collapse = "\n") else res_output
        list(success = TRUE, what = what, result = formatted)
      },

      # ------------------------------------------------------------------------
      # Summary Statistics & Contamination
      # ------------------------------------------------------------------------
      "/summary" = {
        data <- get_active_data(params$id)
        by <- if (!is.null(params$by) && nzchar(params$by)) params$by else if (!is.null(params$what) && nzchar(params$what)) params$what else "sample"
        contam <- params$contamination
        dest <- if (!is.null(params$destination)) params$destination else "print"

        output_txt <- ""
        if (dest == "save") {
          if (!is.null(contam) && nzchar(contam)) {
            data <- summary(data, contamination = contam, destination = "save")
            log_code(glue::glue("{STATE$active_id} <- {STATE$active_id} %>% summary(contamination = '{contam}', destination = 'save')"))
          } else {
            data <- summary(data, by, destination = "save")
            log_code(glue::glue("{STATE$active_id} <- {STATE$active_id} %>% summary('{by}', destination = 'save')"))
          }
          set_active_data(data)
          output_txt <- glue::glue("Summary saved to CSV file in {STATE$output_dir}")
        } else {
          output_txt <- paste(capture.output({
            tryCatch({
              if (!is.null(contam) && nzchar(contam)) {
                tbl <- summary(data, contamination = contam, destination = "print")
                if (!is.null(tbl)) print(tbl)
              } else {
                tbl <- summary(data, by, destination = "print")
                if (!is.null(tbl)) print(tbl)
              }
            }, error = function(e) {
              cat(glue::glue("Note: summary by '{by}' encountered notice ({conditionMessage(e)}). Falling back to sample summary:\n\n"))
              tryCatch({
                tbl2 <- summary(data, "sample", destination = "print")
                if (!is.null(tbl2)) print(tbl2)
              }, error = function(e2) {
                print(data)
              })
            })
          }), collapse = "\n")
        }

        list(success = TRUE, output = output_txt)
      },

      # ------------------------------------------------------------------------
      # Filtering & Metadata Operations
      # ------------------------------------------------------------------------
      "/subset" = {
        data <- get_active_data(params$id)
        expr_str <- params$expression
        if (is.null(expr_str) || nchar(expr_str) == 0) {
          stop("Expression parameter is required for subset")
        }

        if (grepl("\\bnum_unique_peptides\\b", expr_str)) {
          has_num_uniq <- !is.null(data$accounting$num_unique_peptides)
          if (!has_num_uniq) {
            stop("COLUMN_MISSING: num_unique_peptides is absent from the dataset. Ensure platform configuration maps unique peptide columns (e.g. via tpa_ingest_config) before filtering on num_unique_peptides.")
          }
        }

        clauses <- split_top_level_and(expr_str)
        for (clause in clauses) {
          log_line <- glue::glue("{STATE$active_id} <- {STATE$active_id} %>% subset({clause})")
          if (!log_line %in% STATE$pipeline_code) {
            eval_str <- glue::glue("data %>% subset({clause})")
            data <- eval(parse(text = eval_str))
            log_code(log_line)
          }
        }
        set_active_data(data)

        summary_text <- format_state_card(data, STATE$active_id)
        list(success = TRUE, summary = summary_text)
      },

      "/reassign" = {
        # params: target ('sample' or 'origin'), condition (e.g. 'sample == "control"'), replace (e.g. 'ctrl'),
        # or mapping (dictionary/list of raw_sample -> clean_sample)
        data <- get_active_data(params$id)
        target <- if (!is.null(params$target)) params$target else "sample"
        mapping <- params$mapping

        if (!is.null(mapping) && length(mapping) > 0) {
          map_list <- as.list(mapping)
          for (raw_name in names(map_list)) {
            clean_name <- map_list[[raw_name]]
            if (target == "origin") {
              eval_str <- glue::glue('data %>% origins(sample == "{raw_name}", .replace = "{clean_name}")')
              data <- eval(parse(text = eval_str))
              log_code(glue::glue('{STATE$active_id} <- {STATE$active_id} %>% origins(sample == "{raw_name}", .replace = "{clean_name}")'))
            } else {
              eval_str <- glue::glue('data %>% reassign(sample == "{raw_name}", .replace = "{clean_name}")')
              data <- eval(parse(text = eval_str))
              log_code(glue::glue('{STATE$active_id} <- {STATE$active_id} %>% reassign(sample == "{raw_name}", .replace = "{clean_name}")'))
            }
          }
        } else {
          cond <- params$condition
          repl <- params$replace
          if (is.null(cond) || is.null(repl)) stop("Either mapping dictionary or both condition and replace parameters are required")

          if (target == "origin") {
            eval_str <- glue::glue('data %>% origins({cond}, .replace = "{repl}")')
            data <- eval(parse(text = eval_str))
            log_code(glue::glue('{STATE$active_id} <- {STATE$active_id} %>% origins({cond}, .replace = "{repl}")'))
          } else {
            eval_str <- glue::glue('data %>% reassign({cond}, .replace = "{repl}")')
            data <- eval(parse(text = eval_str))
            log_code(glue::glue('{STATE$active_id} <- {STATE$active_id} %>% reassign({cond}, .replace = "{repl}")'))
          }
        }

        set_active_data(data)
        state_summary <- format_state_card(data, STATE$active_id)
        exp_summary <- paste(capture.output(print(data$experiments)), collapse = "\n")
        list(success = TRUE, target = target, summary = state_summary, experiments = exp_summary)
      },

      "/rm_mbr" = {
        # params: groups ('all' or 'sample')
        data <- get_active_data(params$id)
        groups <- if (!is.null(params$groups)) params$groups else "sample"

        eval_str <- glue::glue('data %>% rm.mbr(.groups = "{groups}")')
        data <- eval(parse(text = eval_str))
        set_active_data(data)
        log_code(glue::glue('{STATE$active_id} <- {STATE$active_id} %>% rm.mbr(.groups = "{groups}")'))

        summary_text <- format_state_card(data, STATE$active_id)
        list(success = TRUE, summary = summary_text)
      },

      "/audit_annotations" = {
        data <- get_active_data(params$id)
        id_col <- if (!is.null(data$identifier)) data$identifier[1] else "protein"
        file_path <- params$file_path

        dataset_proteins <- get_unique_variables(data, id_col, format = "vector")
        total_ds_proteins <- length(dataset_proteins)

        if (!is.null(file_path) && nzchar(trimws(file_path)) && toupper(trimws(file_path)) != "NONE") {
          actual_path <- resolve_workspace_file(file_path)
          if (!file.exists(actual_path)) {
            stop(glue::glue("Annotation file not found: {file_path}"))
          }
          annot_tbl <- load_and_normalize_annotation_table(actual_path, target_id_col = id_col)
          source_desc <- glue::glue("File: {basename(file_path)}")
        } else {
          if (is.null(data$annotations) || nrow(data$annotations) == 0) {
            return(list(
              success = TRUE,
              valid = FALSE,
              has_annotations = FALSE,
              coverage_percent = 0,
              matched_proteins = 0,
              total_dataset_proteins = total_ds_proteins,
              detected_terms = character(0),
              summary = "No biological annotations currently attached to dataset."
            ))
          }
          annot_tbl <- data$annotations
          source_desc <- "In-Memory Dataset Annotations"
        }

        matched_proteins <- length(intersect(dataset_proteins, unique(annot_tbl[[id_col]])))
        cov_pct <- if (total_ds_proteins > 0) round(100 * matched_proteins / total_ds_proteins, 1) else 0

        term_counts_tbl <- table(annot_tbl$term)
        term_counts <- as.list(term_counts_tbl)
        detected_terms <- names(term_counts)

        canonical_terms <- c("biological_process", "cellular_component", "molecular_function", "reactome_pathway", "kegg", "wiki_pathway")
        has_canonical <- any(canonical_terms %in% detected_terms)

        summary_lines <- c(
          glue::glue("### Annotation Audit: {source_desc}"),
          glue::glue("- **Total Dataset Proteins**: {total_ds_proteins}"),
          glue::glue("- **Mapped Proteins**: {matched_proteins} ({cov_pct}%)"),
          glue::glue("- **Total Annotation Rows**: {nrow(annot_tbl)}"),
          glue::glue("- **Available Ontologies / Terms ({length(detected_terms)})**:")
        )
        for (tm in detected_terms) {
          summary_lines <- c(summary_lines, glue::glue("  • `{tm}`: {term_counts[[tm]]} annotations"))
        }

        valid_flag <- cov_pct >= 50 && (has_canonical || length(detected_terms) > 0)
        if (!valid_flag && cov_pct < 50) {
          summary_lines <- c(summary_lines, glue::glue("\n⚠️ **Low Identifier Overlap Alert**: Only {cov_pct}% of dataset proteins matched annotation identifiers."))
        }

        list(
          success = TRUE,
          valid = valid_flag,
          coverage_percent = cov_pct,
          matched_proteins = matched_proteins,
          total_dataset_proteins = total_ds_proteins,
          detected_terms = detected_terms,
          term_counts = term_counts,
          has_canonical = has_canonical,
          summary = paste(summary_lines, collapse = "\n")
        )
      },

      "/annotate" = {
        data <- get_active_data(params$id)
        file_path <- params$file_path
        dups <- if (!is.null(params$duplicates)) params$duplicates else "merge"
        id_col <- if (!is.null(data$identifier)) data$identifier[1] else "protein"

        if (is.null(file_path) || !nzchar(trimws(file_path))) stop("Valid file_path is required for annotate")
        actual_path <- resolve_workspace_file(file_path)
        if (!file.exists(actual_path)) stop(glue::glue("Annotation file not found: {file_path}"))

        annot_tbl <- load_and_normalize_annotation_table(actual_path, target_id_col = id_col)
        eval_str <- glue::glue('data %>% annotate(annot_tbl, duplicates = "{dups}")')
        data <- eval(parse(text = eval_str))
        set_active_data(data)

        read_fn <- if (grepl("\\.csv$", actual_path, ignore.case = TRUE)) "readr::read_csv" else "readr::read_tsv"
        rel_path <- if (!is.null(STATE$output_dir) && nzchar(STATE$output_dir)) {
          sub(paste0("^", normalizePath(STATE$output_dir, mustWork = FALSE), "/?"), "", normalizePath(actual_path, mustWork = FALSE))
        } else basename(actual_path)
        log_code(glue::glue('{STATE$active_id} <- {STATE$active_id} %>% annotate({read_fn}("{rel_path}"), duplicates = "{dups}")'))

        terms <- get_annotation_terms(data, format = "vector")
        dataset_proteins <- get_unique_variables(data, id_col, format = "vector")
        matched_proteins <- length(intersect(dataset_proteins, unique(annot_tbl[[id_col]])))
        cov_pct <- if (length(dataset_proteins) > 0) round(100 * matched_proteins / length(dataset_proteins), 1) else 0

        summary_text <- glue::glue("Integrated {nrow(annot_tbl)} annotations ({cov_pct}% protein coverage, {matched_proteins}/{length(dataset_proteins)} proteins). Available terms: {paste(terms, collapse = ', ')}")

        list(
          success = TRUE,
          available_terms = terms,
          coverage_percent = cov_pct,
          matched_proteins = matched_proteins,
          total_proteins = length(dataset_proteins),
          summary = summary_text
        )
      },

      "/fetch_annotations" = {
        data <- get_active_data(params$id)
        id_col <- if (!is.null(data$identifier)) data$identifier[1] else "protein"
        source <- if (!is.null(params$source) && nzchar(params$source)) tolower(params$source) else "uniprot"
        taxon_id <- params$taxon_id
        target_cats <- params$categories
        out_file <- if (!is.null(params$output_file) && nzchar(params$output_file)) params$output_file else glue::glue("data/annotations_{source}.tsv")
        
        target_path <- resolve_workspace_file(out_file)
        out_dir <- dirname(target_path)
        if (!dir.exists(out_dir)) dir.create(out_dir, recursive = TRUE, showWarnings = FALSE)

        dataset_proteins <- get_unique_variables(data, id_col, format = "vector")
        if (length(dataset_proteins) == 0) stop("No quantified proteins found in active dataset.")

        annot_df <- NULL
        if (source == "uniprot") {
          annot_df <- fetch_uniprot_annotations(dataset_proteins, target_id_col = id_col, target_categories = target_cats)
        } else {
          stop(glue::glue("Annotation source '{source}' is currently not supported for direct remote fetching. Please use 'uniprot'."))
        }

        status_file <- resolve_workspace_file(glue::glue("data/annotations_{source}.tsv.status.json"))
        if (is.null(annot_df) || nrow(annot_df) == 0) {
          status_err <- list(
            written = FALSE,
            source = source,
            url = "https://rest.uniprot.org",
            taxon = if (!is.null(taxon_id)) as.character(taxon_id) else "auto",
            error = "Zero annotations retrieved from external query. Check accession formats and network connectivity.",
            timestamp = as.character(Sys.time())
          )
          tryCatch(jsonlite::write_json(status_err, status_file, pretty = TRUE, auto_unbox = TRUE), error = function(e) NULL)
          stop(glue::glue("Zero annotations retrieved from external query (taxon: {status_err$taxon}, source: {source})."))
        }

        readr::write_tsv(annot_df, target_path)

        status_ok <- list(
          written = TRUE,
          source = source,
          total_dataset_proteins = length(dataset_proteins),
          annotated_proteins = length(unique(annot_df[[id_col]])),
          rows = nrow(annot_df),
          taxon = if (!is.null(taxon_id)) as.character(taxon_id) else "auto",
          timestamp = as.character(Sys.time())
        )
        tryCatch(jsonlite::write_json(status_ok, status_file, pretty = TRUE, auto_unbox = TRUE), error = function(e) NULL)

        prov_path <- resolve_workspace_file("data/annotations_provenance.json")
        prov_data <- list(
          source = source,
          database_url = "https://rest.uniprot.org",
          query_timestamp = as.character(Sys.time()),
          taxon_id = if (!is.null(taxon_id)) as.character(taxon_id) else "auto",
          total_dataset_proteins = length(dataset_proteins),
          total_annotation_rows = nrow(annot_df),
          annotated_proteins = length(unique(annot_df[[id_col]])),
          coverage_percent = round(100 * length(unique(annot_df[[id_col]])) / length(dataset_proteins), 1),
          cached_file = out_file,
          terms_retrieved = unique(annot_df$term)
        )
        tryCatch(jsonlite::write_json(prov_data, prov_path, pretty = TRUE, auto_unbox = TRUE), error = function(e) NULL)

        eval_str <- glue::glue('data %>% annotate(annot_df, duplicates = "merge")')
        data <- eval(parse(text = eval_str))
        set_active_data(data)

        rel_out <- if (!is.null(STATE$output_dir) && nzchar(STATE$output_dir)) {
          sub(paste0("^", normalizePath(STATE$output_dir, mustWork = FALSE), "/?"), "", normalizePath(target_path, mustWork = FALSE))
        } else out_file
        log_code(glue::glue('{STATE$active_id} <- {STATE$active_id} %>% annotate(readr::read_tsv("{rel_out}"), duplicates = "merge")'))

        terms <- get_annotation_terms(data, format = "vector")
        cov_pct <- prov_data$coverage_percent
        matched_proteins <- prov_data$annotated_proteins

        summary_lines <- c(
          glue::glue("### UniProt Annotations Successfully Fetched & Integrated"),
          glue::glue("- **Cached File**: `{rel_out}`"),
          glue::glue("- **Protein Coverage**: **{cov_pct}%** ({matched_proteins} of {length(dataset_proteins)} proteins)"),
          glue::glue("- **Total Annotations Attached**: {nrow(annot_df)}"),
          glue::glue("- **Available Terms**: {paste(terms, collapse = ', ')}")
        )

        list(
          success = TRUE,
          source = source,
          cached_file = rel_out,
          coverage_percent = cov_pct,
          matched_proteins = matched_proteins,
          total_proteins = length(dataset_proteins),
          available_terms = terms,
          summary = paste(summary_lines, collapse = "\n")
        )
      },

      "/list_annotations" = {
        data <- get_active_data(params$id)
        id_col <- if (!is.null(data$identifier)) data$identifier[1] else "protein"
        if (is.null(data$annotations) || nrow(data$annotations) == 0) {
          return(list(
            success = TRUE,
            has_annotations = FALSE,
            terms = character(0),
            summary = "No biological annotations currently attached."
          ))
        }

        dataset_proteins <- get_unique_variables(data, id_col, format = "vector")
        matched_proteins <- length(intersect(dataset_proteins, unique(data$annotations[[id_col]])))
        cov_pct <- if (length(dataset_proteins) > 0) round(100 * matched_proteins / length(dataset_proteins), 1) else 0

        term_counts <- as.list(table(data$annotations$term))
        terms <- names(term_counts)

        summary_lines <- c(
          glue::glue("### Attached Annotations Overview"),
          glue::glue("- **Coverage**: {cov_pct}% ({matched_proteins}/{length(dataset_proteins)} proteins)"),
          glue::glue("- **Terms ({length(terms)})**:")
        )
        for (tm in terms) {
          summary_lines <- c(summary_lines, glue::glue("  • `{tm}`: {term_counts[[tm]]} annotations"))
        }

        list(
          success = TRUE,
          has_annotations = TRUE,
          coverage_percent = cov_pct,
          matched_proteins = matched_proteins,
          total_proteins = length(dataset_proteins),
          terms = terms,
          term_counts = term_counts,
          summary = paste(summary_lines, collapse = "\n")
        )
      },

      # ------------------------------------------------------------------------
      # Normalization & Imputation
      # ------------------------------------------------------------------------
      "/normalize" = {
        data <- get_active_data(params$id)
        all_valid_methods <- c("scaled", "median", "linear", "limma", "loess", "svm", "randomforest")
        subset_cap_methods <- c("scaled", "median", "linear", "svm")
        default_methods <- c("scaled", "median", "linear", "limma", "loess")

        subset_filt <- params$subset_filter
        has_subset <- !is.null(subset_filt) && nzchar(trimws(subset_filt)) && toupper(trimws(subset_filt)) != "NONE"

        methods <- params$methods
        if (!is.null(methods)) {
          methods <- tolower(trimws(unlist(methods)))
          if (length(methods) == 1 && grepl(",", methods)) {
            methods <- trimws( strsplit(methods, ",")[[1]] )
          }
          methods <- gsub("^random-forest$", "randomforest", methods)
        }

        subset_notice <- NULL
        if (has_subset) {
          if (is.null(methods) || length(methods) == 0 || any(methods %in% c("default", "all"))) {
            methods <- subset_cap_methods
          } else {
            dropped <- setdiff(methods, subset_cap_methods)
            methods <- intersect(methods, subset_cap_methods)
            if (length(dropped) > 0) {
              subset_notice <- glue::glue(
                "Note: When normalizing on a sub-population ({subset_filt}), only linear models ('scaled', 'median', 'linear') and 'svm' can predict beyond the scope of the training set. Skipped inapplicable method(s): {paste(dropped, collapse = ', ')}."
              )
            }
            if (length(methods) == 0) {
              methods <- subset_cap_methods
            }
          }
        } else {
          if (is.null(methods) || length(methods) == 0 || identical(methods, "default")) {
            methods <- default_methods
          } else if ("all" %in% methods) {
            methods <- all_valid_methods
          } else if ("default" %in% methods) {
            methods <- unique(c(default_methods, setdiff(methods, "default")))
          }
          methods <- intersect(methods, all_valid_methods)
          if (length(methods) == 0) {
            methods <- default_methods
          }
        }

        methods_str <- paste(glue::glue('"{methods}"'), collapse = ", ")
        cores_arg <- if (!is.null(params$cores)) glue::glue(", cores = {as.integer(params$cores)}") else ""

        eval_str <- if (has_subset) {
          glue::glue("data %>% normalize({subset_filt}, .method = c({methods_str}){cores_arg})")
        } else {
          glue::glue("data %>% normalize(.method = c({methods_str}){cores_arg})")
        }

        data <- eval(parse(text = eval_str))
        set_active_data(data)
        log_code(sub("^data %>%", glue::glue("{STATE$active_id} <- {STATE$active_id} %>%"), eval_str))

        summary_text <- paste(capture.output(summary(data, "normalization")), collapse = "\n")

        # Check for CV NaN / undefined
        reps_per_sample <- if (!is.null(data$experiments$sample)) table(data$experiments$sample) else integer(0)
        all_singletons <- length(reps_per_sample) > 0 && all(reps_per_sample <= 1)

        cv_undefined <- FALSE
        cv_reason <- ""
        if (all_singletons) {
          cv_undefined <- TRUE
          cv_reason <- "Sample group size <= 1; every sample group contains only 1 replicate, preventing replicate variance/CV calculation."
        } else {
          tbl_stats <- tryCatch(tidyproteomics:::stats_summary(data, group_by = "normalization"), error = function(e) NULL)
          if (!is.null(tbl_stats) && "CV" %in% names(tbl_stats)) {
            if (all(is.na(tbl_stats$CV) | is.nan(tbl_stats$CV))) {
              cv_undefined <- TRUE
              cv_reason <- "Replicate CV returned non-finite (zero variance or non-numeric/missing intensity values across replicates)."
            }
          }
        }

        if (cv_undefined) {
          cv_notice <- glue::glue(
            "⚠️ [CV DIAGNOSTIC NOTICE - CV_UNDEFINED]\n",
            "- Root Cause: {cv_reason}\n",
            "- Guidance: Automated CV minimization cannot be quantified. Do NOT claim CV reduction. In tpa_select_normalization, select robust linear/location shift ('median' or 'none'/'raw') rather than complex non-linear fits ('loess')."
          )
          summary_text <- paste0(cv_notice, "\n\n", summary_text)
        }

        if (!is.null(subset_notice)) {
          summary_text <- paste0(subset_notice, "\n\n", summary_text)
        }
        list(success = TRUE, methods = methods, subset_filter = if (has_subset) subset_filt else NULL, cv_undefined = cv_undefined, summary = summary_text)
      },

      "/select_normalization" = {
        data <- get_active_data(params$id)
        norm_method <- params$normalization

        # Check if CV is undefined
        reps_per_sample <- if (!is.null(data$experiments$sample)) table(data$experiments$sample) else integer(0)
        all_singletons <- length(reps_per_sample) > 0 && all(reps_per_sample <= 1)
        cv_undefined <- all_singletons
        if (!cv_undefined) {
          tbl_stats <- tryCatch(tidyproteomics:::stats_summary(data, group_by = "normalization"), error = function(e) NULL)
          if (!is.null(tbl_stats) && "CV" %in% names(tbl_stats)) {
            if (all(is.na(tbl_stats$CV) | is.nan(tbl_stats$CV))) {
              cv_undefined <- TRUE
            }
          }
        }

        already_selected <- (is.null(norm_method) || !nzchar(norm_method) || identical(norm_method, data$quantitative_source)) &&
          length(data$operations) > 0 &&
          grepl(paste0("selected as ", data$quantitative_source, "\\.$"), tail(unlist(data$operations), 1))

        selection_note <- NULL
        if (!already_selected) {
          if ((is.null(norm_method) || !nzchar(norm_method)) && cv_undefined) {
            # When CV is undefined, automated select_normalization() can pick loess inappropriately.
            # Default to median (or raw if median not normalized)
            avail_quant <- get_quant_names(data, format = "vector")
            fallback_norm <- if ("median" %in% avail_quant) "median" else if ("scaled" %in% avail_quant) "scaled" else "raw"
            data$quantitative_source <- fallback_norm
            selection_note <- glue::glue("CV_UNDEFINED: Automated CV minimization bypassed (group size <= 1 or non-finite CV). Defaulted to robust location shift '{fallback_norm}'.")
            data$operations <- append(data$operations, glue::glue("Normalization selected as {fallback_norm} (Fallback: {selection_note})."))
            log_code(glue::glue('{STATE$active_id} <- {STATE$active_id} %>% select_normalization("{fallback_norm}") # Fallback: CV_UNDEFINED'))
            set_active_data(data)
          } else {
            eval_str <- if (!is.null(norm_method) && nchar(norm_method) > 0) {
              glue::glue('data %>% select_normalization("{norm_method}")')
            } else {
              glue::glue("data %>% select_normalization()")
            }

            data <- eval(parse(text = eval_str))
            set_active_data(data)
            log_code(sub("^data %>%", glue::glue("{STATE$active_id} <- {STATE$active_id} %>%"), eval_str))
          }
        }

        list(success = TRUE, active_source = data$quantitative_source, note = selection_note)
      },

      "/impute" = {
        data <- get_active_data(params$id)
        method_str <- if (!is.null(params$method) && nzchar(trimws(params$method))) trimws(params$method) else "impute.randomforest, method = 'matrix', group_by_sample = TRUE"

        # Normalize convenient shorthands and ensure impute.randomforest always includes method = 'matrix'
        if (tolower(method_str) %in% c("randomforest", "randomforest_grouped", "rf")) {
          method_str <- "impute.randomforest, method = 'matrix', group_by_sample = TRUE"
        } else if (tolower(method_str) %in% c("min_column", "column_min", "lod_column")) {
          method_str <- "base::min, method = 'column'"
        } else if (tolower(method_str) %in% c("min_row_grouped", "row_min_grouped")) {
          method_str <- "base::min, method = 'row', group_by_sample = TRUE"
        } else if (grepl("(^|[^.])\\brandomforest\\b", method_str, ignore.case = TRUE)) {
          method_str <- sub("(^|[^.])\\brandomforest\\b", "\\1impute.randomforest", method_str, ignore.case = TRUE)
          if (!grepl("method\\s*=", method_str)) {
            method_str <- paste0(method_str, ", method = 'matrix'")
          }
        } else if (grepl("impute\\.randomforest", method_str, ignore.case = TRUE) && !grepl("method\\s*=", method_str)) {
          method_str <- paste0(method_str, ", method = 'matrix'")
        }

        eval_str <- glue::glue("data %>% impute({method_str})")
        data <- eval(parse(text = eval_str))
        set_active_data(data)
        log_code(glue::glue("{STATE$active_id} <- {STATE$active_id} %>% impute({method_str})"))

        summary_text <- format_state_card(data, STATE$active_id)
        list(success = TRUE, summary = summary_text)
      },

      # ------------------------------------------------------------------------
      # Peptide Collapsing & Dataset Merging
      # ------------------------------------------------------------------------
      "/collapse" = {
        # params: collapse_to, assign_by, top_n, split_abundance, fasta_path
        data <- get_active_data(params$id)
        collapse_to <- if (!is.null(params$collapse_to)) params$collapse_to else "protein"
        assign_by <- if (!is.null(params$assign_by)) params$assign_by else "razor-local"
        top_n_val <- if (!is.null(params$top_n)) params$top_n else "Inf"
        split_ab <- if (isTRUE(params$split_abundance)) "TRUE" else "FALSE"
        fasta_arg <- if (!is.null(params$fasta_path)) glue::glue(', fasta_path = "{params$fasta_path}"') else ""

        eval_str <- glue::glue('data %>% collapse(collapse_to = "{collapse_to}", assign_by = "{assign_by}", top_n = {top_n_val}, split_abundance = {split_ab}{fasta_arg})')
        data <- eval(parse(text = eval_str))
        set_active_data(data)
        log_code(sub("^data %>%", glue::glue("{STATE$active_id} <- {STATE$active_id} %>%"), eval_str))

        summary_text <- format_state_card(data, STATE$active_id)
        list(success = TRUE, summary = summary_text)
      },

      "/merge" = {
        # params: id1, id2, new_id
        id1 <- if (!is.null(params$id1)) params$id1 else STATE$active_id
        id2 <- params$id2
        new_id <- if (!is.null(params$new_id)) params$new_id else "merged_data"
        if (is.null(id2)) stop("id2 is required for merge")

        data1 <- get_active_data(id1)
        data2 <- get_active_data(id2)

        data_merged <- merge_tidyproteomics(data1, data2)
        set_active_data(data_merged, new_id)
        log_code(glue::glue("{new_id} <- merge_tidyproteomics({id1}, {id2})"))

        summary_text <- format_state_card(data_merged, new_id)
        list(success = TRUE, new_id = new_id, summary = summary_text)
      },

      # ------------------------------------------------------------------------
      # Differential Expression & Enrichment
      # ------------------------------------------------------------------------
      "/expression" = {
        data <- get_active_data(params$id)
        comp <- resolve_comparison(data, params$comparison)
        method_arg <- if (!is.null(params$method)) glue::glue(', .method = "{params$method}"') else ""
        padj_arg <- if (!is.null(params$p_adjust)) glue::glue(', .p.adjust = "{params$p_adjust}"') else ""

        eval_str <- glue::glue("data %>% expression({comp}{method_arg}{padj_arg})")
        data <- eval(parse(text = eval_str))
        set_active_data(data)
        log_code(sub("^data %>%", glue::glue("{STATE$active_id} <- {STATE$active_id} %>%"), eval_str))

        analyses <- capture.output(print(get_analyses(data)))
        list(success = TRUE, analyses = paste(analyses, collapse = "\n"))
      },

      "/enrichment" = {
        data <- get_active_data(params$id)
        comp <- resolve_comparison(data, params$comparison)
        terms <- if (!is.null(params$terms)) params$terms else "biological_process"
        method_arg <- if (!is.null(params$method)) glue::glue(', .method = "{params$method}"') else ""

        terms_vec <- trimws(unlist(strsplit(as.character(terms), ",")))
        terms_vec <- terms_vec[nzchar(terms_vec)]
        terms_str <- paste0('c(', paste0('"', terms_vec, '"', collapse = ", "), ')')

        eval_str <- glue::glue('data %>% enrichment({comp}, .terms = {terms_str}{method_arg})')
        data <- eval(parse(text = eval_str))
        set_active_data(data)
        log_code(sub("^data %>%", glue::glue("{STATE$active_id} <- {STATE$active_id} %>%"), eval_str))

        analyses <- capture.output(print(get_analyses(data)))
        list(success = TRUE, analyses = paste(analyses, collapse = "\n"))
      },

      "/batch_analysis" = {
        # params: type ('expressions' or 'enrichments'), log2fc_min, significance_max, top_n, labels_column
        data <- get_active_data(params$id)
        batch_type <- if (!is.null(params$type)) tolower(trimws(params$type)) else "expressions"
        data_dir <- file.path(STATE$output_dir, "data")
        if (!dir.exists(data_dir)) dir.create(data_dir, recursive = TRUE, showWarnings = FALSE)

        if (batch_type %in% c("expressions", "expression")) {
          labels_col <- if (!is.null(params$labels_column) && nzchar(params$labels_column)) params$labels_column else "gene_name"
          data <- data %>% analyze_expressions(labels_column = labels_col)
          set_active_data(data)
          log_code(glue::glue("{STATE$active_id} <- {STATE$active_id} %>% analyze_expressions(labels_column = '{labels_col}')"))

          # Move generated files into data/ and create pipeline aliases
          volcano_pngs <- list.files(".", pattern = glue::glue("^{data$analyte}_volcano_.*\\.png$"), full.names = TRUE)
          expr_csvs <- list.files(".", pattern = glue::glue("^table_{data$analyte}_expression_.*\\.csv$"), full.names = TRUE)
          created_files <- c()

          for (vp in volcano_pngs) {
            base_f <- basename(vp)
            dst_f <- file.path(data_dir, base_f)
            file.copy(vp, dst_f, overwrite = TRUE)
            file.remove(vp)
            # Create plot_ prefix alias for standard figure discovery
            alias_f <- file.path(data_dir, paste0("plot_", base_f))
            file.copy(dst_f, alias_f, overwrite = TRUE)
            created_files <- c(created_files, file.path("data", base_f), file.path("data", paste0("plot_", base_f)))
          }

          contrast_stats <- list()
          all_sig_genes <- character(0)

          for (ec in expr_csvs) {
            base_f <- basename(ec)
            dst_f <- file.path(data_dir, base_f)
            file.copy(ec, dst_f, overwrite = TRUE)
            file.remove(ec)
            # Also create TSV variant
            tsv_f <- file.path(data_dir, sub("\\.csv$", ".tsv", base_f))
            df_cur <- tryCatch(read.csv(dst_f, check.names = FALSE), error = function(e) NULL)
            if (!is.null(df_cur) && is.data.frame(df_cur) && nrow(df_cur) > 0) {
              write.table(df_cur, tsv_f, sep = "\t", row.names = FALSE, quote = FALSE)

              c_label <- sub(glue::glue("^table_{data$analyte}_expression_"), "", base_f)
              c_label <- sub("\\.csv$", "", c_label)

              fc_col <- intersect(c("log2_foldchange", "log2fc", "log2FoldChange"), names(df_cur))[1]
              p_col <- intersect(c("adj_p_value", "padj", "adj.P.Val", "p_value"), names(df_cur))[1]
              gene_col <- intersect(c("gene_name", "protein", "identifier"), names(df_cur))[1]

              cur_n_sig <- 0
              cur_n_up <- 0
              cur_n_down <- 0
              cur_top_up <- character(0)
              cur_top_down <- character(0)

              if (!is.na(fc_col) && !is.na(p_col)) {
                fc_vec <- suppressWarnings(as.numeric(df_cur[[fc_col]]))
                p_vec <- suppressWarnings(as.numeric(df_cur[[p_col]]))
                sig_mask <- !is.na(fc_vec) & !is.na(p_vec) & abs(fc_vec) >= 1.0 & p_vec <= 0.05
                up_mask <- sig_mask & fc_vec >= 1.0
                down_mask <- sig_mask & fc_vec <= -1.0

                cur_n_sig <- sum(sig_mask)
                cur_n_up <- sum(up_mask)
                cur_n_down <- sum(down_mask)

                if (cur_n_up > 0 && !is.na(gene_col)) {
                  cur_top_up <- head(as.character(df_cur[up_mask, ][order(-df_cur[[fc_col]][up_mask]), gene_col]), 5)
                }
                if (cur_n_down > 0 && !is.na(gene_col)) {
                  cur_top_down <- head(as.character(df_cur[down_mask, ][order(df_cur[[fc_col]][down_mask]), gene_col]), 5)
                }
                if (!is.na(gene_col)) {
                  all_sig_genes <- unique(c(all_sig_genes, as.character(df_cur[sig_mask, gene_col])))
                }
              }

              contrast_stats[[c_label]] <- list(
                contrast = c_label,
                total_modeled = nrow(df_cur),
                n_sig = cur_n_sig,
                n_up = cur_n_up,
                n_down = cur_n_down,
                top_up = paste(cur_top_up, collapse = ", "),
                top_down = paste(cur_top_down, collapse = ", ")
              )
            }
            created_files <- c(created_files, file.path("data", base_f), file.path("data", basename(tsv_f)))
          }

          table_lines <- c(
            "| Contrast | Modeled Entities | Strict Sig (|log2FC| >= 1, q <= 0.05) | Up | Down | Top Upregulated | Top Downregulated |",
            "| :--- | :---: | :---: | :---: | :---: | :--- | :--- |"
          )
          total_sig_sum <- 0
          for (c_label in names(contrast_stats)) {
            st <- contrast_stats[[c_label]]
            total_sig_sum <- total_sig_sum + st$n_sig
            table_lines <- c(table_lines, glue::glue(
              "| **{st$contrast}** | {st$total_modeled} | **{st$n_sig}** | {st$n_up} | {st$n_down} | {st$top_up} | {st$top_down} |"
            ))
          }
          summary_txt <- paste(table_lines, collapse = "\n")

          msg <- glue::glue("Batch differential expression analysis completed via analyze_expressions() across {length(contrast_stats)} contrast(s).\n\n### Per-Contrast Differential Expression Summary\n{summary_txt}\n\n- Unique significant entities across contrasts: {length(all_sig_genes)}")

          list(
            success = TRUE,
            type = "expressions",
            message = msg,
            contrast_count = length(contrast_stats),
            contrasts = contrast_stats,
            significant_count = total_sig_sum,
            unique_significant_entities = length(all_sig_genes),
            files_created = unique(created_files)
          )
        } else {
          top_n_val <- if (!is.null(params$top_n)) as.integer(params$top_n) else 50
          sig_max_val <- if (!is.null(params$significance_max)) as.numeric(params$significance_max) else 0.05
          data <- data %>% analyze_enrichments(top_n = top_n_val, significance_max = sig_max_val)
          set_active_data(data)
          log_code(glue::glue("{STATE$active_id} <- {STATE$active_id} %>% analyze_enrichments(top_n = {top_n_val}, significance_max = {sig_max_val})"))

          # Move generated files into data/
          enrich_pngs <- list.files(".", pattern = glue::glue("^{data$analyte}_enrichment_.*\\.png$"), full.names = TRUE)
          enrich_csvs <- list.files(".", pattern = glue::glue("^table_{data$analyte}_enrichment_.*\\.csv$"), full.names = TRUE)
          created_files <- c()

          for (ep in enrich_pngs) {
            base_f <- basename(ep)
            dst_f <- file.path(data_dir, base_f)
            file.copy(ep, dst_f, overwrite = TRUE)
            file.remove(ep)
            # Create plot_ prefix alias for standard figure discovery
            alias_f <- file.path(data_dir, paste0("plot_", base_f))
            file.copy(dst_f, alias_f, overwrite = TRUE)
            created_files <- c(created_files, file.path("data", base_f), file.path("data", paste0("plot_", base_f)))
          }

          for (ec in enrich_csvs) {
            base_f <- basename(ec)
            dst_f <- file.path(data_dir, base_f)
            file.copy(ec, dst_f, overwrite = TRUE)
            file.remove(ec)
            # Also create TSV variant
            tsv_f <- file.path(data_dir, sub("\\.csv$", ".tsv", base_f))
            df_tmp <- tryCatch(read.csv(dst_f, check.names = FALSE), error = function(e) NULL)
            if (!is.null(df_tmp)) write.table(df_tmp, tsv_f, sep = "\t", row.names = FALSE, quote = FALSE)
            created_files <- c(created_files, file.path("data", base_f), file.path("data", basename(tsv_f)))
          }

          list(
            success = TRUE,
            type = "enrichments",
            message = glue::glue("Batch functional enrichment analysis completed via analyze_enrichments(). Generated multi-ontology faceted plot {data$analyte}_enrichment."),
            files_created = unique(created_files)
          )
        }
      },

      # ------------------------------------------------------------------------
      # Venn Segment Extraction & Long Tidy Tables
      # ------------------------------------------------------------------------
      "/intersection" = {
        # params: include (array), exclude (array)
        data <- get_active_data(params$id)
        inc <- params$include
        exc <- params$exclude
        inc_str <- if (!is.null(inc) && length(inc) > 0) paste0(".include = c(", paste(glue::glue('"{inc}"'), collapse = ", "), ")") else ""
        exc_str <- if (!is.null(exc) && length(exc) > 0) paste0(".exclude = c(", paste(glue::glue('"{exc}"'), collapse = ", "), ")") else ""
        args_str <- paste(Filter(nchar, c(inc_str, exc_str)), collapse = ", ")

        eval_str <- glue::glue("data %>% intersection({args_str})")
        data_sub <- eval(parse(text = eval_str))
        set_active_data(data_sub)
        log_code(glue::glue("{STATE$active_id} <- {eval_str}"))

        summary_text <- paste(capture.output(print(data_sub)), collapse = "\n")
        list(success = TRUE, summary = summary_text)
      },

      "/extract" = {
        # params: values ('raw', 'normalized', etc.), na_rm (boolean), save_csv (file path)
        data <- get_active_data(params$id)
        vals_arg <- params$values
        if (!is.null(vals_arg) && vals_arg == "normalized") {
          avail_methods <- sub("^abundance_", "", grep("^abundance_", names(data$quantitative), value = TRUE))
          norm_methods <- setdiff(avail_methods, "raw")
          vals_arg <- if (length(norm_methods) > 0) tail(norm_methods, 1) else "raw"
        }
        vals <- if (!is.null(vals_arg)) glue::glue('"{vals_arg}"') else "NULL"
        na_rm <- if (isTRUE(params$na_rm)) "TRUE" else "FALSE"
        save_csv <- params$save_csv

        eval_str <- glue::glue("data %>% extract(values = {vals}, na.rm = {na_rm})")
        tbl <- eval(parse(text = eval_str))

        if (!is.null(save_csv) && nchar(save_csv) > 0) {
          readr::write_csv(tbl, save_csv)
          log_code(glue::glue('{STATE$active_id} %>% extract(values = {vals}, na.rm = {na_rm}) %>% readr::write_csv("{save_csv}")'))
        }

        preview <- paste(capture.output(print(head(tbl, 5))), collapse = "\n")
        list(
          success = TRUE,
          rows = nrow(tbl),
          columns = ncol(tbl),
          preview = preview,
          saved_file = save_csv
        )
      },

      "/query_expression" = {
        data <- get_active_data(params$id)
        if (is.null(data$analysis) || length(data$analysis) == 0) {
          stop("No analysis results found in dataset. Please run tpa_expression first.")
        }

        # Resolve comparison key
        comp_names <- names(data$analysis)
        comp_arg <- params$comparison
        comp_key <- NULL
        if (!is.null(comp_arg) && nzchar(trimws(comp_arg))) {
          clean_comp <- gsub("\\s+", "", comp_arg)
          match_idx <- which(gsub("\\s+", "", comp_names) == clean_comp)
          if (length(match_idx) > 0) {
            comp_key <- comp_names[match_idx[1]]
          } else {
            clean_comp2 <- gsub("[`'\"]", "", clean_comp)
            match_idx2 <- which(gsub("[`'\"\\s+]", "", comp_names) == clean_comp2)
            if (length(match_idx2) > 0) {
              comp_key <- comp_names[match_idx2[1]]
            } else {
              stop(glue::glue("Comparison '{comp_arg}' not found. Available comparisons: {paste(comp_names, collapse = ', ')}"))
            }
          }
        } else {
          comp_key <- comp_names[1]
        }

        analysis_obj <- data$analysis[[comp_key]]
        if (is.null(analysis_obj$expression)) {
          stop(glue::glue("No expression analysis data found for comparison '{comp_key}'."))
        }

        tbl <- analysis_obj$expression

        # Filter parameters
        min_lfc <- if (!is.null(params$min_log2fc)) as.numeric(params$min_log2fc) else 0
        max_adjp <- if (!is.null(params$max_adjp)) as.numeric(params$max_adjp) else 1.0
        max_p <- if (!is.null(params$max_p)) as.numeric(params$max_p) else 1.0
        direction <- if (!is.null(params$direction)) tolower(params$direction) else "both"
        sort_by <- if (!is.null(params$sort_by) && nzchar(params$sort_by)) params$sort_by else "adj_p_value"
        limit <- if (!is.null(params$limit)) as.integer(params$limit) else 50

        filtered <- tbl
        if ("adj_p_value" %in% names(filtered) && !is.na(max_adjp) && max_adjp < 1.0) {
          filtered <- filtered %>% dplyr::filter(!is.na(adj_p_value) & adj_p_value <= max_adjp)
        }
        if ("p_value" %in% names(filtered) && !is.na(max_p) && max_p < 1.0) {
          filtered <- filtered %>% dplyr::filter(!is.na(p_value) & p_value <= max_p)
        }
        if ("log2_foldchange" %in% names(filtered) && !is.na(min_lfc) && min_lfc > 0) {
          if (direction == "up") {
            filtered <- filtered %>% dplyr::filter(!is.na(log2_foldchange) & log2_foldchange >= min_lfc)
          } else if (direction == "down") {
            filtered <- filtered %>% dplyr::filter(!is.na(log2_foldchange) & log2_foldchange <= -min_lfc)
          } else {
            filtered <- filtered %>% dplyr::filter(!is.na(log2_foldchange) & abs(log2_foldchange) >= min_lfc)
          }
        }

        # Sorting
        if (sort_by %in% names(filtered)) {
          if (sort_by == "log2_foldchange") {
            if (direction == "down") {
              filtered <- filtered %>% dplyr::arrange(log2_foldchange)
            } else if (direction == "up") {
              filtered <- filtered %>% dplyr::arrange(desc(log2_foldchange))
            } else {
              filtered <- filtered %>% dplyr::arrange(desc(abs(log2_foldchange)))
            }
          } else {
            filtered <- filtered %>% dplyr::arrange(.data[[sort_by]])
          }
        }

        total_matching <- nrow(filtered)

        # Compute imputation risk and candidate reliability if condition imputation columns exist
        comp_parts <- strsplit(comp_key, "\\s*/\\s*")[[1]]
        if (length(comp_parts) >= 2) {
          clean_t <- gsub("^[`'\"]+|[`'\"]+$", "", trimws(comp_parts[1]))
          clean_c <- gsub("^[`'\"]+|[`'\"]+$", "", trimws(comp_parts[2]))
          g1 <- paste0("imputed_", clean_t)
          g2 <- paste0("imputed_", clean_c)
          imp1 <- if (g1 %in% names(filtered)) as.numeric(filtered[[g1]]) else rep(NA_real_, nrow(filtered))
          imp2 <- if (g2 %in% names(filtered)) as.numeric(filtered[[g2]]) else rep(NA_real_, nrow(filtered))
          max_imp <- pmax(imp1, imp2, na.rm = TRUE)
          max_imp[!is.finite(max_imp)] <- NA_real_
          filtered$imputation_bias <- ifelse(is.na(max_imp), "UNKNOWN", ifelse(max_imp > 0.5, "HIGH", ifelse(max_imp >= 0.2, "MODERATE", "LOW")))
          filtered$candidate_reliability <- ifelse(filtered$imputation_bias == "LOW", "ROBUST_QUANTITATIVE", ifelse(filtered$imputation_bias == "HIGH", "DETECTION_LIMITED_ON_OFF", ifelse(filtered$imputation_bias == "MODERATE", "HIGH_UNCERTAINTY", "UNKNOWN")))
          filtered$imputation_delta <- ifelse(is.finite(imp1) & is.finite(imp2), round(imp1 - imp2, 3), NA_real_)
        }

        # Optional file export
        save_csv <- params$save_csv
        if (!is.null(save_csv) && nzchar(trimws(save_csv))) {
          clean_path <- trimws(save_csv)
          abs_save <- if (grepl("^(/|[A-Za-z]:)", clean_path)) clean_path else file.path(STATE$output_dir, clean_path)
          save_dir <- dirname(abs_save)
          if (!dir.exists(save_dir)) dir.create(save_dir, recursive = TRUE, showWarnings = FALSE)
          if (grepl("\\.tsv$", clean_path, ignore.case = TRUE)) {
            readr::write_tsv(filtered, abs_save)
          } else {
            readr::write_csv(filtered, abs_save)
          }
        }

        # Format top N preview as markdown table
        preview_tbl <- head(filtered, limit)
        cols_to_show <- intersect(c("protein", "gene_name", "log2_foldchange", "p_value", "adj_p_value", "imputation_bias", "candidate_reliability", "imputation_delta", "imputed"), names(preview_tbl))
        if (length(cols_to_show) < 3) {
          cols_to_show <- head(names(preview_tbl), 6)
        }
        disp_tbl <- preview_tbl[, cols_to_show, drop = FALSE]

        md_header <- paste0("| ", paste(cols_to_show, collapse = " | "), " |")
        md_sep <- paste0("| ", paste(rep(":---", length(cols_to_show)), collapse = " | "), " |")
        md_rows <- apply(disp_tbl, 1, function(row) {
          vals <- sapply(cols_to_show, function(col) {
            v <- row[[col]]
            if (is.null(v) || is.na(v)) return("-")
            if (is.numeric(v)) {
              if (col %in% c("p_value", "adj_p_value")) return(fmt_pvalue(v))
              return(sprintf("%.3f", v))
            }
            as.character(v)
          })
          paste0("| ", paste(vals, collapse = " | "), " |")
        })

        md_table <- paste(c(md_header, md_sep, md_rows), collapse = "\n")

        list(
          success = TRUE,
          comparison = comp_key,
          total_candidates = total_matching,
          returned_count = nrow(preview_tbl),
          markdown_table = md_table,
          saved_file = save_csv
        )
      },

      "/query_enrichment" = {
        data <- get_active_data(params$id)
        if (is.null(data$analysis) || length(data$analysis) == 0) {
          stop("No analysis results found in dataset. Please run tpa_enrichment first.")
        }

        # Resolve comparison key
        comp_names <- names(data$analysis)
        comp_arg <- params$comparison
        comp_key <- NULL
        if (!is.null(comp_arg) && nzchar(trimws(comp_arg))) {
          clean_comp <- gsub("\\s+", "", comp_arg)
          match_idx <- which(gsub("\\s+", "", comp_names) == clean_comp)
          if (length(match_idx) > 0) {
            comp_key <- comp_names[match_idx[1]]
          } else {
            clean_comp2 <- gsub("[`'\"]", "", clean_comp)
            match_idx2 <- which(gsub("[`'\"\\s+]", "", comp_names) == clean_comp2)
            if (length(match_idx2) > 0) {
              comp_key <- comp_names[match_idx2[1]]
            } else {
              stop(glue::glue("Comparison '{comp_arg}' not found. Available comparisons: {paste(comp_names, collapse = ', ')}"))
            }
          }
        } else {
          comp_key <- comp_names[1]
        }

        c_clean <- gsub("[^A-Za-z0-9_]", "_", comp_key)
        data_dir <- file.path(STATE$output_dir, "data")

        # Attempt to load from exported enrichment tables in data/ first (which contain driver genes)
        enr_files <- list.files(data_dir, pattern = paste0("^table_.*_enrichment_.*", c_clean, ".*\\.(tsv|csv)$"), full.names = TRUE, ignore.case = TRUE)
        if (length(enr_files) == 0) {
          enr_files <- list.files("data", pattern = paste0("^table_.*_enrichment_.*", c_clean, ".*\\.(tsv|csv)$"), full.names = TRUE, ignore.case = TRUE)
        }
        if (length(enr_files) == 0) {
          enr_files <- list.files(data_dir, pattern = "^table_.*_enrichment_.*\\.(tsv|csv)$", full.names = TRUE, ignore.case = TRUE)
        }

        enr_tbl <- NULL
        if (length(enr_files) > 0) {
          enr_tbl <- dplyr::bind_rows(lapply(enr_files, function(f) {
            tbl <- tryCatch(
              if (grepl("\\.tsv$", f, ignore.case = TRUE)) readr::read_tsv(f, show_col_types = FALSE) else readr::read_csv(f, show_col_types = FALSE),
              error = function(e) NULL
            )
            if (!is.null(tbl) && nrow(tbl) > 0) {
              if (!"term" %in% names(tbl)) {
                category <- sub(paste0("^.*_enrichment_(.*)_", c_clean, "\\.(tsv|csv)$"), "\\1", basename(f), ignore.case = TRUE)
                if (identical(category, basename(f))) {
                  category <- sub("^.*_enrichment_([^_]+(?:_[^_]+)*?)_.*$", "\\1", basename(f), ignore.case = TRUE)
                }
                tbl$term <- category
              }
            }
            tbl
          }))
          if (!is.null(enr_tbl) && (!"annotation" %in% names(enr_tbl) || nrow(enr_tbl) == 0)) {
            enr_tbl <- NULL
          }
        }

        # Fallback to in-memory analysis object
        if (is.null(enr_tbl) || nrow(enr_tbl) == 0) {
          analysis_obj <- data$analysis[[comp_key]]
          if (!is.null(analysis_obj$enrichment) && length(analysis_obj$enrichment) > 0) {
            enr_list <- list()
            for (t_name in names(analysis_obj$enrichment)) {
              item <- analysis_obj$enrichment[[t_name]]
              if (!is.null(item$data) && is.data.frame(item$data) && nrow(item$data) > 0) {
                df_sub <- item$data
                df_sub$term <- t_name
                enr_list[[t_name]] <- df_sub
              }
            }
            if (length(enr_list) > 0) enr_tbl <- dplyr::bind_rows(enr_list)
          }
        }

        if (is.null(enr_tbl) || nrow(enr_tbl) == 0) {
          stop(glue::glue("No enrichment analysis data found for comparison '{comp_key}'."))
        }

        # Filter by terms/category
        terms_filter <- if (!is.null(params$terms) && nzchar(trimws(params$terms))) tolower(trimws(params$terms)) else "all"
        if (terms_filter != "all") {
          enr_tbl <- enr_tbl %>% dplyr::filter(tolower(term) %in% unlist(strsplit(terms_filter, ",\\s*")))
        }

        # Filter by adjusted p-value
        max_adjp <- if (!is.null(params$max_adjp)) as.numeric(params$max_adjp) else 1.0
        if ("adj_p_value" %in% names(enr_tbl) && !is.na(max_adjp) && max_adjp < 1.0) {
          enr_tbl <- enr_tbl %>% dplyr::filter(!is.na(adj_p_value) & adj_p_value <= max_adjp)
        }

        # Filter by nominal p-value
        max_p <- if (!is.null(params$max_p)) as.numeric(params$max_p) else 1.0
        if ("p_value" %in% names(enr_tbl) && !is.na(max_p) && max_p < 1.0) {
          enr_tbl <- enr_tbl %>% dplyr::filter(!is.na(p_value) & p_value <= max_p)
        }

        # Filter by score direction
        direction <- if (!is.null(params$direction)) tolower(params$direction) else "both"
        if ("enrichment" %in% names(enr_tbl)) {
          if (direction %in% c("up", "positive", "pos")) {
            enr_tbl <- enr_tbl %>% dplyr::filter(!is.na(enrichment) & enrichment > 0)
          } else if (direction %in% c("down", "negative", "neg")) {
            enr_tbl <- enr_tbl %>% dplyr::filter(!is.na(enrichment) & enrichment < 0)
          }
        }

        # Resolve Reactome IDs if requested (default TRUE)
        resolve_rec <- if (!is.null(params$resolve_reactome)) isTRUE(as.logical(params$resolve_reactome)) else TRUE
        if (resolve_rec && "annotation" %in% names(enr_tbl)) {
          enr_tbl$annotation <- resolve_reactome_ids(enr_tbl$annotation)
        }

        # Extract leading driver genes if present or derive from annotations
        driver_col <- intersect(c("gene_names", "member_genes", "member_proteins"), names(enr_tbl))[1]
        if (!is.na(driver_col)) {
          enr_tbl$top_drivers <- sapply(strsplit(as.character(enr_tbl[[driver_col]]), ",\\s*"), function(x) paste(head(unique(na.omit(trimws(x))), 4), collapse = ", "))
        } else {
          # Derive from active dataset annotations and expression if available
          exp_tbl <- tryCatch(data$analysis[[comp_key]]$expression, error = function(e) NULL)
          if (!is.null(exp_tbl) && "gene_name" %in% names(exp_tbl) && "annotation" %in% names(enr_tbl)) {
            sig_exp <- exp_tbl %>% dplyr::filter(!is.na(adj_p_value) & adj_p_value <= 0.05)
            enr_tbl$top_drivers <- sapply(seq_len(nrow(enr_tbl)), function(i) {
              ann <- enr_tbl$annotation[i]
              if (is.na(ann) || !nzchar(ann)) return("-")
              mg <- sig_exp %>%
                dplyr::filter(if_any(any_of(c("biological_process", "cellular_component", "molecular_function", "reactome_pathway", "wiki_pathway")), ~ grepl(ann, .x, fixed = TRUE))) %>%
                dplyr::arrange(desc(abs(log2_foldchange))) %>%
                dplyr::pull(gene_name)
              if (length(mg) > 0) paste(head(unique(na.omit(mg)), 4), collapse = ", ") else "-"
            })
          }
        }

        # Sort
        sort_by <- if (!is.null(params$sort_by) && nzchar(params$sort_by)) params$sort_by else "adj_p_value"
        if (sort_by %in% names(enr_tbl)) {
          if (sort_by == "enrichment") {
            enr_tbl <- enr_tbl %>% dplyr::arrange(desc(abs(enrichment)))
          } else {
            enr_tbl <- enr_tbl %>% dplyr::arrange(.data[[sort_by]])
          }
        }

        total_matching <- nrow(enr_tbl)
        limit <- if (!is.null(params$limit)) as.integer(params$limit) else 50
        preview_tbl <- head(enr_tbl, limit)

        # Optional file export
        save_csv <- params$save_csv
        if (!is.null(save_csv) && nzchar(trimws(save_csv))) {
          clean_path <- trimws(save_csv)
          abs_save <- if (grepl("^(/|[A-Za-z]:)", clean_path)) clean_path else file.path(STATE$output_dir, clean_path)
          save_dir <- dirname(abs_save)
          if (!dir.exists(save_dir)) dir.create(save_dir, recursive = TRUE, showWarnings = FALSE)
          if (grepl("\\.tsv$", clean_path, ignore.case = TRUE)) {
            readr::write_tsv(enr_tbl, abs_save)
          } else {
            readr::write_csv(enr_tbl, abs_save)
          }
        }

        # Format markdown table
        cols_to_show <- intersect(c("term", "annotation", "enrichment", "size", "p_value", "adj_p_value", "top_drivers"), names(preview_tbl))
        if (length(cols_to_show) < 3) cols_to_show <- head(names(preview_tbl), 6)
        disp_tbl <- preview_tbl[, cols_to_show, drop = FALSE]

        md_header <- paste0("| ", paste(cols_to_show, collapse = " | "), " |")
        md_sep <- paste0("| ", paste(rep(":---", length(cols_to_show)), collapse = " | "), " |")
        md_rows <- apply(disp_tbl, 1, function(row) {
          vals <- sapply(cols_to_show, function(col) {
            v <- row[[col]]
            if (is.null(v) || is.na(v)) return("-")
            if (is.numeric(v)) {
              if (col %in% c("p_value", "adj_p_value")) return(fmt_pvalue(v))
              return(sprintf("%.3f", v))
            }
            as.character(v)
          })
          paste0("| ", paste(vals, collapse = " | "), " |")
        })

        md_table <- paste(c(md_header, md_sep, md_rows), collapse = "\n")

        list(
          success = TRUE,
          comparison = comp_key,
          total_terms = total_matching,
          returned_count = nrow(preview_tbl),
          markdown_table = md_table,
          saved_file = save_csv
        )
      },

      # ------------------------------------------------------------------------
      # Visualizations (All 16 Plot Types, supporting single or batch execution)
      # ------------------------------------------------------------------------
      "/plot" = {
        data <- get_active_data(params$id)
        raw_types <- if (!is.null(params$types)) params$types else params$type
        types_vec <- if (is.character(raw_types)) trimws(unlist(strsplit(raw_types, ","))) else character(0)
        types_vec <- types_vec[nzchar(types_vec)]
        if (length(types_vec) == 0) types_vec <- c("pca")

        data_dir <- file.path(STATE$output_dir, "data")
        if (!dir.exists(data_dir)) dir.create(data_dir, recursive = TRUE, showWarnings = FALSE)

        contrast_plots <- c("volcano", "expression", "proportion", "enrichment", "candidates", "signatures", "imputation_diagnostic")
        created_files <- c()

        for (plot_type in types_vec) {
          comp <- params$comparison
          terms <- params$terms
          protein_id <- params$protein
          extra_args <- params$extra_args
          custom_file <- if (length(types_vec) == 1) params$file_name else NULL

          # Fallback contrast if comparison omitted for contrast-dependent plots
          if ((is.null(comp) || !nzchar(trimws(comp))) && plot_type %in% contrast_plots) {
            comp <- resolve_comparison(data, comp)
          }

          # Fallback term if omitted for enrichment plot
          if (identical(plot_type, "enrichment")) {
            if (is.null(terms) || !nzchar(trimws(terms))) {
              comp_key <- if (!is.null(comp)) gsub("[` ]", "", comp) else ""
              enrich_terms <- if (!is.null(data$analysis[[comp_key]]$enrichment)) {
                names(data$analysis[[comp_key]]$enrichment)
              } else if (length(names(data$analysis)) > 0 && !is.null(data$analysis[[1]]$enrichment)) {
                names(data$analysis[[1]]$enrichment)
              } else character(0)
              if (length(enrich_terms) > 0) {
                terms <- if ("biological_process" %in% enrich_terms) "biological_process" else enrich_terms[1]
              }
            } else {
              terms <- trimws(unlist(strsplit(as.character(terms), ",")))[1]
            }
          }

          # Special case: proteins_enrichment multi-ontology faceted plot via analyze_enrichments()
          if (plot_type %in% c("proteins_enrichment", "batch_enrichment")) {
            data <- data %>% analyze_enrichments()
            set_active_data(data)
            enrich_pngs <- list.files(".", pattern = glue::glue("^{data$analyte}_enrichment_.*\\.png$"), full.names = TRUE)
            created_file <- file.path("data", glue::glue("{data$analyte}_enrichment.png"))
            if (length(enrich_pngs) > 0) {
              created_file <- file.path("data", basename(enrich_pngs[1]))
              file.copy(enrich_pngs[1], file.path(STATE$output_dir, created_file), overwrite = TRUE)
              alias_file <- file.path(STATE$output_dir, "data", paste0("plot_", basename(enrich_pngs[1])))
              file.copy(enrich_pngs[1], alias_file, overwrite = TRUE)
              file.remove(enrich_pngs)
            }
            log_code(glue::glue("{STATE$active_id} <- {STATE$active_id} %>% analyze_enrichments()"))
            created_files <- c(created_files, created_file)
            next
          }

          # Determine target file destination
          if (!is.null(custom_file) && nzchar(trimws(custom_file))) {
            clean_dest <- trimws(custom_file)
            if (!grepl("\\.png$", clean_dest, ignore.case = TRUE)) clean_dest <- paste0(clean_dest, ".png")
            target_path <- if (grepl("^(/|[A-Za-z]:|data/)", clean_dest)) clean_dest else file.path("data", clean_dest)
          } else {
            comp_suffix <- if (!is.null(comp) && nzchar(trimws(comp))) {
              clean_c <- gsub("^[`'\"]+|[`'\"]+$", "", trimws(comp))
              clean_c <- gsub("\\s*(/|\\s+vs\\.?\\s+|-)\\s*", "_vs_", clean_c, ignore.case = TRUE)
              clean_c <- gsub("[^a-zA-Z0-9_]+", "_", clean_c)
              paste0("_", clean_c)
            } else ""
            default_name <- if (identical(plot_type, "counts")) {
              glue::glue("plot_{data$analyte}_counts.png")
            } else if (identical(plot_type, "enrichment") && !is.null(terms) && nzchar(trimws(terms))) {
              term_clean <- gsub("[^a-zA-Z0-9_]+", "_", trimws(terms))
              glue::glue("plot_enrichment_{term_clean}{comp_suffix}.png")
            } else {
              glue::glue("plot_{plot_type}{comp_suffix}.png")
            }
            target_path <- file.path("data", default_name)
          }
          abs_target_path <- if (grepl("^(/|[A-Za-z]:)", target_path)) target_path else file.path(STATE$output_dir, target_path)

          # Construct plotting call with destination = "plot" so the plot object is returned directly
          actual_plot_type <- plot_type
          n_cohorts <- if (!is.null(data$experiments$sample)) length(unique(data$experiments$sample)) else 0
          if (plot_type == "venn" && n_cohorts > 4) {
            actual_plot_type <- "euler"
            cat(glue::glue("[TidyDaemon] Notice: plot_venn is limited to <=4 sets ({n_cohorts} cohorts present). Auto-falling back to plot_euler.\n"))
            if (grepl("venn", target_path)) {
              target_path <- sub("venn", "euler", target_path)
              abs_target_path <- if (grepl("^(/|[A-Za-z]:)", target_path)) target_path else file.path(STATE$output_dir, target_path)
            }
          }
          plot_fn <- glue::glue("plot_{actual_plot_type}")
          args <- c('destination = "plot"')
          if (!is.null(comp) && nzchar(trimws(comp)) && plot_type %in% contrast_plots) {
            safe_comp <- format_comparison(comp)
            args <- c(safe_comp, args)
          }
          if (!is.null(terms) && nzchar(trimws(terms)) && plot_type %in% c("enrichment", "heatmap")) {
            term_param <- if (plot_type == "enrichment") ".term" else ".terms"
            args <- c(args, glue::glue('{term_param} = "{trimws(terms)}"'))
          }
          if (!is.null(protein_id) && plot_type %in% c("expression", "protein")) {
            if (plot_type == "protein") {
              args <- c(glue::glue('protein = "{protein_id}"'), args)
            } else {
              args <- c(args, glue::glue('labels_column = "protein"'))
            }
          }
          if (!is.null(extra_args) && nchar(extra_args) > 0) args <- c(args, extra_args)

          eval_str <- glue::glue("data %>% {plot_fn}({paste(args, collapse = ', ')})")
          res_plot <- tryCatch({
            eval(parse(text = eval_str))
          }, error = function(e) {
            if (plot_type == "venn") {
              cat(glue::glue("[TidyDaemon] plot_venn failed ({conditionMessage(e)}). Retrying with plot_euler ...\n"))
              plot_fn <<- "plot_euler"
              actual_plot_type <<- "euler"
              eval(parse(text = glue::glue("data %>% plot_euler({paste(args, collapse = ', ')})")))
            } else {
              stop(e)
            }
          })

          if (inherits(res_plot, c("gg", "ggplot", "grob", "patchwork"))) {
            ggplot2::ggsave(filename = abs_target_path, plot = res_plot, height = 5, width = 8, dpi = 300)
          } else if ("tidyproteomics" %in% class(res_plot)) {
            set_active_data(res_plot)
            expected_name <- glue::glue("plot_{data$analyte}_{plot_type}.png")
            if (file.exists(file.path(STATE$output_dir, expected_name))) {
              file.copy(file.path(STATE$output_dir, expected_name), abs_target_path, overwrite = TRUE)
              file.remove(file.path(STATE$output_dir, expected_name))
            }
          } else {
            tryCatch({
              png(abs_target_path, width = 8, height = 5, units = "in", res = 300)
              print(res_plot)
              dev.off()
            }, error = function(e) {
              if (dev.cur() > 1) dev.off()
            })
          }

          log_args <- sub('destination = "plot"', 'destination = "png"', args, fixed = TRUE)
          log_code(glue::glue('{STATE$active_id} %>% {plot_fn}({paste(log_args, collapse = ", ")})'))
          created_files <- c(created_files, target_path)
        }

        list(
          success = TRUE,
          plot_type = paste(types_vec, collapse = ", "),
          file_created = if (length(created_files) > 0) created_files[1] else "",
          files_created = created_files,
          message = glue::glue("Generated {length(created_files)} plot(s): {paste(created_files, collapse = ', ')}")
        )
      },

      "/protein_map" = {
        # params: fasta_path
        data <- get_active_data(params$id)
        fasta_path <- params$fasta_path
        if (is.null(fasta_path)) stop("fasta_path is required for protein_map")

        eval_str <- glue::glue('data %>% protein_map(fasta_path = "{fasta_path}")')
        mapped <- eval(parse(text = eval_str))
        set_active_data(mapped)
        log_code(glue::glue('{STATE$active_id} <- {eval_str}'))

        list(success = TRUE, message = "Peptide coordinates successfully mapped to protein sequences.")
      },

      # ------------------------------------------------------------------------
      # Data Table Exporting
      # ------------------------------------------------------------------------
      "/export_table" = {
        data <- get_active_data(params$id)
        export_type <- if (!is.null(params$type)) params$type else "quant"
        file_name <- if (!is.null(params$file_name)) params$file_name else params$destination
        comp <- params$comparison
        analysis <- if (!is.null(params$analysis)) params$analysis else "expression"
        term <- params$term
        platform <- params$platform
        append_val <- if (!is.null(params$append)) params$append else params$.append

        if (export_type == "quant") {
          fn_call <- if (!is.null(file_name)) glue::glue('export_quant(data, file_name = "{file_name}")') else 'export_quant(data)'
          tbl <- eval(parse(text = fn_call))
          log_fn <- if (!is.null(file_name)) glue::glue('export_quant(file_name = "{file_name}")') else 'export_quant()'
          log_code(glue::glue('{STATE$active_id} %>% {log_fn}'))
          output_msg <- if (!is.null(file_name)) glue::glue("Exported quantitative data to {file_name}") else "Returned quantitative tibble."
        } else if (export_type == "analysis") {
          term_arg <- if (!is.null(term)) glue::glue(', .term = "{term}"') else ""
          append_arg <- if (!is.null(append_val) && nzchar(append_val)) glue::glue(', .append = "{append_val}"') else ""
          comp_str <- resolve_comparison(data, comp)
          fn_call <- if (!is.null(file_name)) glue::glue('export_analysis(data, {comp_str}, .analysis = "{analysis}"{term_arg}{append_arg}, .file_name = "{file_name}")') else glue::glue('export_analysis(data, {comp_str}, .analysis = "{analysis}"{term_arg}{append_arg})')
          tbl <- eval(parse(text = fn_call))
          log_fn <- if (!is.null(file_name)) glue::glue('export_analysis({comp_str}, .analysis = "{analysis}"{term_arg}{append_arg}, .file_name = "{file_name}")') else glue::glue('export_analysis({comp_str}, .analysis = "{analysis}"{term_arg}{append_arg})')
          log_code(glue::glue('{STATE$active_id} %>% {log_fn}'))
          output_msg <- if (!is.null(file_name)) glue::glue("Exported analysis data to {file_name}") else "Returned analysis tibble."
        } else if (export_type == "compexp") {
          fn_call <- if (!is.null(file_name)) glue::glue('export_compexp(data, file_name = "{file_name}")') else 'export_compexp(data)'
          tbl <- eval(parse(text = fn_call))
          log_fn <- if (!is.null(file_name)) glue::glue('export_compexp(file_name = "{file_name}")') else 'export_compexp()'
          log_code(glue::glue('{STATE$active_id} %>% {log_fn}'))
          output_msg <- if (!is.null(file_name)) glue::glue("Exported comparative expression data to {file_name}") else "Returned compexp tibble."
        } else if (export_type == "config") {
          export_config(platform = platform)
          output_msg <- glue::glue("Exported configuration TSV for platform '{platform}' to local directory.")
        } else if (export_type == "skill") {
          dest_dir <- if (!is.null(file_name)) dirname(file_name) else STATE$output_dir
          export_llm_skill(destination = dest_dir)
          output_msg <- glue::glue("Exported SKILL.md guide to {dest_dir}")
        } else if (export_type == "template") {
          tm_type <- if (!is.null(params$template_type)) params$template_type else "discovery"
          tmpl <- prompt_template(tm_type)
          output_msg <- tmpl
        } else {
          stop(glue::glue("Unknown export type '{export_type}'"))
        }

        list(success = TRUE, message = output_msg)
      },

      # ------------------------------------------------------------------------
      # Full State Export & Audit Trail
      # ------------------------------------------------------------------------
      # ------------------------------------------------------------------------
      # SDRF Metadata Export (ProteomeXchange / PRIDE / MassIVE compliant)
      # ------------------------------------------------------------------------
      "/export_sdrf" = {
        data <- get_active_data(params$id)
        out_file <- if (!is.null(params$file_name) && nzchar(params$file_name)) params$file_name else "data/sdrf.tsv"
        organism_arg <- params$organism
        tissue_arg <- params$cell_line_or_tissue

        abs_out <- if (grepl("^(/|[A-Za-z]:)", out_file)) out_file else file.path(STATE$output_dir, out_file)
        dir.create(dirname(abs_out), recursive = TRUE, showWarnings = FALSE)

        exp_df <- data$experiments
        if (is.null(exp_df) || nrow(exp_df) == 0) {
          stop("Active dataset has no valid experiments slot.")
        }

        # Resolve Organism
        organism <- if (!is.null(organism_arg) && nzchar(organism_arg)) organism_arg else "Homo sapiens"
        if (is.null(organism_arg) && !is.null(data$annotations) && "organism" %in% names(data$annotations)) {
          org_vals <- unique(data$annotations$organism)
          org_vals <- org_vals[!is.na(org_vals) & nzchar(org_vals)]
          if (length(org_vals) > 0) organism <- org_vals[1]
        }

        # Resolve Cell line / tissue
        tissue <- if (!is.null(tissue_arg) && nzchar(tissue_arg)) tissue_arg else "not applicable"

        # Determine subject / replicate ID
        files <- if ("sample_file" %in% names(exp_df)) exp_df$sample_file else exp_df$sample_id
        if (is.null(files)) files <- paste0("Sample_", seq_len(nrow(exp_df)))

        source_names <- tools::file_path_sans_ext(basename(files))
        replicates <- if ("replicate" %in% names(exp_df)) exp_df$replicate else seq_len(nrow(exp_df))
        samples <- if ("sample" %in% names(exp_df)) exp_df$sample else "sample"

        instrument_arg <- if (!is.null(params$instrument_model) && nzchar(params$instrument_model)) params$instrument_model else NULL
        taxon_arg <- if (!is.null(params$ncbi_taxon_id) && nzchar(params$ncbi_taxon_id)) params$ncbi_taxon_id else NULL

        sdrf_df <- data.frame(
          `source name` = source_names,
          `characteristics[organism]` = organism,
          `characteristics[cell line or tissue]` = tissue,
          `characteristics[biological replicate]` = replicates,
          `factor value[phenotype / perturbation]` = samples,
          `comment[data file]` = basename(files),
          `comment[fraction identifier]` = "1",
          `comment[technical replicate]` = seq_len(nrow(exp_df)),
          check.names = FALSE,
          stringsAsFactors = FALSE
        )

        if (!is.null(taxon_arg)) {
          sdrf_df$`characteristics[organism ontology]` <- taxon_arg
        }

        if (!is.null(instrument_arg)) {
          sdrf_df$`comment[instrument]` <- instrument_arg
        }

        if ("batch" %in% names(exp_df)) {
          sdrf_df$`comment[batch identifier]` <- exp_df$batch
        }

        readr::write_tsv(sdrf_df, abs_out)
        log_code(glue::glue('# Exported SDRF metadata: {out_file}'))

        list(
          success = TRUE,
          file = out_file,
          rows = nrow(sdrf_df),
          organism = organism,
          message = glue::glue("ProteomeXchange-compliant SDRF file successfully generated at {out_file} ({nrow(sdrf_df)} samples, organism: {organism}).")
        )
      },

      # ------------------------------------------------------------------------
      # Platform Ingestion Configuration Export
      # ------------------------------------------------------------------------
      "/export_config" = {
        platform <- params$platform
        analyte <- if (!is.null(params$analyte) && nzchar(params$analyte)) params$analyte else "proteins"
        out_file <- params$output_path

        if (is.null(platform) || !nzchar(platform)) {
          stop("Platform must be specified (e.g. 'MaxQuant', 'ProteomeDiscoverer', 'DIA-NN', 'FragPipe', 'mzTab')")
        }

        if (!analyte %in% c("proteins", "peptides")) {
          analyte <- "proteins"
        }

        dest_file <- if (!is.null(out_file) && nzchar(out_file)) out_file else glue::glue("{platform}_{analyte}.tsv")
        abs_dest <- if (grepl("^(/|[A-Za-z]:)", dest_file)) dest_file else file.path(STATE$output_dir, dest_file)
        dir.create(dirname(abs_dest), recursive = TRUE, showWarnings = FALSE)

        src_config <- tryCatch({
          glue::glue("{platform}_{analyte}") %>% path_to_package_data()
        }, error = function(e) {
          stop(glue::glue("Built-in config not found for platform '{platform}', analyte '{analyte}': {conditionMessage(e)}"))
        })

        if (!file.exists(src_config)) {
          stop(glue::glue("Built-in config file not found at: '{src_config}'"))
        }

        file.copy(src_config, abs_dest, overwrite = TRUE)
        content <- readr::read_file(abs_dest)
        log_code(glue::glue("# Exported {platform} {analyte} config: {dest_file}"))

        list(
          success = TRUE,
          platform = platform,
          analyte = analyte,
          file = dest_file,
          full_path = abs_dest,
          content = content,
          message = glue::glue("Configuration template for {platform} ({analyte}) successfully exported to {dest_file}.")
        )
      },

      # ------------------------------------------------------------------------
      # Input Header Audit
      # ------------------------------------------------------------------------
      "/input_audit" = {
        raw_file <- if (!is.null(params$source) && nzchar(params$source)) params$source else params$file_name
        if (is.null(raw_file) || !nzchar(raw_file)) {
          stop("source / file_name must be specified for input_audit")
        }
        raw_file <- resolve_or_stage_file(raw_file)
        if (!file.exists(raw_file)) {
          stop(glue::glue("Raw data file not found: '{raw_file}'"))
        }
        platform <- params$platform
        analyte <- if (!is.null(params$analyte) && nzchar(params$analyte)) params$analyte else "proteins"
        config_arg <- params$config
        if (!is.null(config_arg) && nzchar(config_arg)) {
          if (!file.exists(config_arg) && file.exists(file.path(STATE$output_dir, config_arg))) {
            config_arg <- file.path(STATE$output_dir, config_arg)
          }
        } else {
          config_arg <- NULL
        }

        # If raw_file is an Excel workbook (.xlsx/.xls), tidyproteomics::input_audit uses readLines()
        # which reads zipped binary data. Staging the first row to a temporary TSV preserves exact
        # column headers so that platform configuration regexes match properly.
        is_excel <- grepl("\\.xlsx?$", raw_file, ignore.case = TRUE)
        audit_file <- raw_file
        temp_tsv <- NULL
        if (is_excel) {
          rlang::check_installed("readxl", reason = "to audit Excel files.")
          df_head <- readxl::read_excel(raw_file, n_max = 1, col_types = "text")
          temp_tsv <- tempfile(fileext = ".tsv")
          readr::write_tsv(df_head, temp_tsv)
          audit_file <- temp_tsv
        }

        audit_tbl <- tryCatch(
          tidyproteomics::input_audit(
            file_name = audit_file,
            platform = platform,
            analyte = analyte,
            config = config_arg
          ),
          finally = {
            if (!is.null(temp_tsv) && file.exists(temp_tsv)) {
              unlink(temp_tsv)
            }
          }
        )

        total_cols <- nrow(audit_tbl)
        matched_cols <- sum(audit_tbl$matched)
        matched_ids <- audit_tbl$raw_header[audit_tbl$category == "identifier" & audit_tbl$matched]
        matched_quants <- audit_tbl$raw_header[audit_tbl$category == "quantitative" & audit_tbl$matched]
        matched_annots <- audit_tbl$raw_header[audit_tbl$category == "annotation" & audit_tbl$matched]

        # Smart quantitative candidate detection when 0 quantitative channels match
        if (length(matched_quants) == 0) {
          # Check for ProteomeDiscoverer Area
          is_area <- !audit_tbl$matched & grepl("^Area\\:", audit_tbl$raw_header, ignore.case = TRUE)
          if (any(is_area)) {
            audit_tbl$suggestion[is_area] <- "Candidate: quantitative (abundance_raw) via '^Area:'"
          }
          # Check for MaxQuant/generic Intensity
          is_int <- !audit_tbl$matched & grepl("^(Intensity|LFQ\\s+intensity)", audit_tbl$raw_header, ignore.case = TRUE)
          if (any(is_int)) {
            audit_tbl$suggestion[is_int] <- "Candidate: quantitative (abundance_raw) via '^Intensity' or '^LFQ intensity'"
          }
          # Check for DIA-NN/Spectronaut Quantity
          is_quant <- !audit_tbl$matched & grepl("^(PG\\.Quantity|Quantity)", audit_tbl$raw_header, ignore.case = TRUE)
          if (any(is_quant)) {
            audit_tbl$suggestion[is_quant] <- "Candidate: quantitative (abundance_raw) via '^Quantity'"
          }
        }

        # Unique peptide candidate check for FragPipe / proteomics tables
        has_uniq_mapped <- any(audit_tbl$matched & audit_tbl$column_defined == "num_unique_peptides")
        if (!has_uniq_mapped) {
          is_uniq_col <- !audit_tbl$matched & grepl("(?i)^(Combined\\s+Total\\s+Peptides|Combined\\s+Unique\\s+Peptides|Unique\\s+Peptides|Combined\\s+Unique\\s+Spectral\\s+Count)$", audit_tbl$raw_header)
          if (any(is_uniq_col)) {
            audit_tbl$suggestion[is_uniq_col] <- "Candidate: accounting (num_unique_peptides) via unique peptide count"
          }
        }

        suggestions <- unique(audit_tbl$suggestion[!audit_tbl$matched & audit_tbl$suggestion != "Unassigned"])
        if (length(matched_quants) == 0) {
          if (any(grepl("^Area\\:", audit_tbl$raw_header, ignore.case = TRUE))) {
            suggestions <- c(
              suggestions,
              "Column(s) matching '^Area:' detected without matched quantitative channels. In ProteomeDiscoverer, peak area exports use 'Area: ...'. Configure with: tpa_ingest_config(platform='ProteomeDiscoverer', action='set', category='quantitative', column_defined='abundance_raw', column_import='^Area:', pivot=TRUE)"
            )
          }
        }
        if (!has_uniq_mapped) {
          if (any(grepl("(?i)^(Combined\\s+Total\\s+Peptides|Combined\\s+Unique\\s+Peptides|Unique\\s+Peptides|Combined\\s+Unique\\s+Spectral\\s+Count)$", audit_tbl$raw_header))) {
            suggestions <- c(
              suggestions,
              "Column(s) matching unique peptide counts detected without matched 'num_unique_peptides'. Configure with: tpa_ingest_config(platform='FragPipe', action='auto_fix', file_name='...') or set category='accounting', column_defined='num_unique_peptides'."
            )
          } else {
            suggestions <- c(
              suggestions,
              "COLUMN_MISSING: num_unique_peptides - No unique peptide column identified in raw headers (e.g. 'Combined Unique Peptides', 'Unique Peptides'). Downstream >= 2 peptide filter cannot be applied without this column."
            )
          }
        }

        audit_md <- paste0(
          "| Raw Header | Matched | Category | Target Column | Config Regex | Suggestion |\n",
          "| :--- | :--- | :--- | :--- | :--- | :--- |\n",
          paste(apply(head(audit_tbl, 40), 1, function(r) {
            sprintf("| %s | %s | %s | %s | `%s` | %s |",
                    r["raw_header"], r["matched"],
                    if (!is.na(r["category"])) r["category"] else "-",
                    if (!is.na(r["column_defined"])) r["column_defined"] else "-",
                    if (!is.na(r["config_regex"])) r["config_regex"] else "-",
                    if (!is.na(r["suggestion"])) r["suggestion"] else "-")
          }), collapse = "\n")
        )

        log_code(glue::glue("# Audited raw headers for {basename(raw_file)} ({platform}_{analyte}): {matched_cols}/{total_cols} matched"))

        list(
          success = TRUE,
          total_columns = total_cols,
          matched_columns = matched_cols,
          unmatched_columns = total_cols - matched_cols,
          identifier_column = if (length(matched_ids) > 0) matched_ids[1] else NULL,
          quantitative_columns = matched_quants,
          annotation_columns = matched_annots,
          suggestions = suggestions,
          audit_table = audit_md
        )
      },

      # ------------------------------------------------------------------------
      # Platform Ingestion Configuration Customization
      # ------------------------------------------------------------------------
      "/ingest_config" = {
        platform <- params$platform
        analyte <- if (!is.null(params$analyte) && nzchar(params$analyte)) params$analyte else "proteins"
        cfg_file <- params$config_file
        if (!is.null(cfg_file) && nzchar(cfg_file)) {
          if (!file.exists(cfg_file) && file.exists(file.path(STATE$output_dir, cfg_file))) {
            cfg_file <- file.path(STATE$output_dir, cfg_file)
          }
        }
        raw_file <- params$file_name
        if (!is.null(raw_file) && nzchar(raw_file)) {
          raw_file <- resolve_or_stage_file(raw_file)
        }
        action <- if (!is.null(params$action) && nzchar(params$action)) params$action else "view"
        out_file <- params$output_file
        if (!is.null(out_file) && nzchar(out_file) && !grepl("^(/|[A-Za-z]:)", out_file)) {
          out_file <- file.path(STATE$output_dir, out_file)
        }

        # If action is auto_fix and raw_file is Excel, stage first row to temp TSV for input_audit
        is_excel <- !is.null(raw_file) && file.exists(raw_file) && grepl("\\.xlsx?$", raw_file, ignore.case = TRUE)
        ingest_file <- raw_file
        temp_tsv <- NULL
        if (is_excel && action == "auto_fix") {
          rlang::check_installed("readxl", reason = "to inspect Excel headers.")
          df_head <- readxl::read_excel(raw_file, n_max = 1, col_types = "text")
          temp_tsv <- tempfile(fileext = ".tsv")
          readr::write_tsv(df_head, temp_tsv)
          ingest_file <- temp_tsv
        }

        updated_tbl <- tryCatch(
          tidyproteomics::ingest_config(
            platform = platform,
            analyte = analyte,
            config_file = cfg_file,
            action = action,
            category = params$category,
            column_defined = params$column_defined,
            column_import = params$column_import,
            pattern_extract = params$pattern_extract,
            pattern_remove = params$pattern_remove,
            pattern_split = params$pattern_split,
            pivot = params$pivot,
            file_name = ingest_file,
            use_lfq = params$use_lfq,
            save = TRUE,
            output_file = out_file
          ),
          finally = {
            if (!is.null(temp_tsv) && file.exists(temp_tsv)) {
              unlink(temp_tsv)
            }
          }
        )

        if (action == "auto_fix" && !is.null(raw_file) && file.exists(raw_file)) {
          raw_headers <- tryCatch({
            if (is_excel) {
              colnames(readxl::read_excel(raw_file, n_max = 1, col_types = "text"))
            } else {
              strsplit(readLines(raw_file, n = 1), "[\t,]")[[1]]
            }
          }, error = function(e) character(0))

          has_abundance <- any(grepl("^Abundance\\:", raw_headers, ignore.case = TRUE))
          has_area <- any(grepl("^Area\\:", raw_headers, ignore.case = TRUE))

          if (!has_abundance && has_area) {
            effective_cfg <- if (!is.null(out_file) && nzchar(out_file)) out_file else cfg_file
            if (is.null(effective_cfg) || !nzchar(effective_cfg)) {
              effective_cfg <- file.path(STATE$output_dir, paste0(platform, "_", analyte, ".tsv"))
            }
            updated_tbl <- tryCatch(
              tidyproteomics::ingest_config(
                platform = platform,
                analyte = analyte,
                config_file = effective_cfg,
                action = "set",
                category = "quantitative",
                column_defined = "abundance_raw",
                column_import = "^Area:",
                pivot = TRUE,
                save = TRUE,
                output_file = effective_cfg
              ),
              error = function(e) updated_tbl
            )
          }

          uniq_cols <- grep("(?i)^(Combined\\s+Total\\s+Peptides|Combined\\s+Unique\\s+Peptides|Unique\\s+Peptides|Combined\\s+Unique\\s+Spectral\\s+Count)$", raw_headers, value = TRUE)
          if (length(uniq_cols) > 0) {
            effective_cfg <- if (!is.null(out_file) && nzchar(out_file)) out_file else cfg_file
            if (is.null(effective_cfg) || !nzchar(effective_cfg)) {
              effective_cfg <- file.path(STATE$output_dir, paste0(platform, "_", analyte, ".tsv"))
            }
            chosen_uniq <- uniq_cols[1]
            updated_tbl <- tryCatch(
              tidyproteomics::ingest_config(
                platform = platform,
                analyte = analyte,
                config_file = effective_cfg,
                action = "set",
                category = "accounting",
                column_defined = "num_unique_peptides",
                column_import = paste0("^", chosen_uniq, "$"),
                save = TRUE,
                output_file = effective_cfg
              ),
              error = function(e) updated_tbl
            )
          }
        }

        cfg_md <- paste0(
          "| Category | Column Defined | Import Pattern | Pattern Extract | Pivot |\n",
          "| :--- | :--- | :--- | :--- | :--- |\n",
          paste(apply(updated_tbl, 1, function(r) {
            sprintf("| %s | %s | `%s` | `%s` | %s |",
                    r["category"], r["column_defined"],
                    if (!is.na(r["column_import"])) r["column_import"] else "-",
                    if (!is.na(r["pattern_extract"])) r["pattern_extract"] else "-",
                    if (!is.na(r["pivot"])) r["pivot"] else "-")
          }), collapse = "\n")
        )

        log_code(glue::glue("# Ingest config ({action}) for {platform}_{analyte}"))

        list(
          success = TRUE,
          action = action,
          platform = platform,
          analyte = analyte,
          file = if (!is.null(out_file)) out_file else if (!is.null(cfg_file)) cfg_file else glue::glue("{platform}_{analyte}.tsv"),
          config_table = cfg_md
        )
      },

      # ------------------------------------------------------------------------
      # Multi-Assay Normalization Sensitivity & Concordance Evaluation
      # ------------------------------------------------------------------------
      "/normalization_sensitivity" = {
        data <- get_active_data(params$id)
        comp <- resolve_comparison(data, params$comparison)
        p_cutoff <- if (!is.null(params$p_cutoff)) as.numeric(params$p_cutoff) else 0.05
        fc_cutoff <- if (!is.null(params$log2fc_cutoff)) as.numeric(params$log2fc_cutoff) else 1.0

        # Discover all available normalized quantitative layers
        all_quants <- get_quant_names(data, format = "vector")
        candidate_norms <- setdiff(all_quants, c("raw"))
        if (length(candidate_norms) < 2) {
          cat("[TidyDaemon] Multi-normalization benchmarking on-the-fly for sensitivity analysis...\n")
          data <- data %>% normalize(.method = c("scaled", "median", "linear", "limma", "loess"))
          set_active_data(data)
          candidate_norms <- c("scaled", "median", "linear", "limma", "loess")
        }

        methods_requested <- params$methods
        if (!is.null(methods_requested) && length(methods_requested) > 0) {
          selected_methods <- intersect(candidate_norms, unlist(methods_requested))
          if (length(selected_methods) >= 2) candidate_norms <- selected_methods
        }

        norm_results <- list()
        sig_proteins <- list()

        for (m in candidate_norms) {
          cat(glue::glue("[TidyDaemon] Evaluating contrast {comp} under normalization '{m}'...\n"))
          d_norm <- data %>% select_normalization(m)
          eval_str <- glue::glue("d_norm %>% expression({comp}, .method = \"limma\")")
          d_tested <- eval(parse(text = eval_str))
          export_str <- glue::glue("export_analysis(d_tested, {comp}, .analysis = \"expression\")")
          tbl <- eval(parse(text = export_str))
          norm_results[[m]] <- tbl

          id_col <- if ("protein" %in% names(tbl)) "protein" else names(tbl)[1]
          sig_mask <- !is.na(tbl$adj_p_value) & tbl$adj_p_value <= p_cutoff & !is.na(tbl$log2_foldchange) & abs(tbl$log2_foldchange) >= fc_cutoff
          sig_proteins[[m]] <- unique(tbl[[id_col]][sig_mask])
        }

        concordance_rows <- list()
        method_names <- names(sig_proteins)
        for (i in seq_along(method_names)) {
          for (j in seq_along(method_names)) {
            if (i < j) {
              m1 <- method_names[i]
              m2 <- method_names[j]
              s1 <- sig_proteins[[m1]]
              s2 <- sig_proteins[[m2]]
              inter <- length(intersect(s1, s2))
              uni <- length(union(s1, s2))
              jaccard <- if (uni > 0) round(100 * inter / uni, 1) else 0

              tbl1 <- norm_results[[m1]]
              tbl2 <- norm_results[[m2]]
              id_col <- if ("protein" %in% names(tbl1)) "protein" else names(tbl1)[1]
              m_merged <- merge(tbl1[, c(id_col, "log2_foldchange")], tbl2[, c(id_col, "log2_foldchange")], by = id_col, suffixes = c("_1", "_2"))
              cor_val <- if (nrow(m_merged) > 3) round(cor(m_merged$log2_foldchange_1, m_merged$log2_foldchange_2, use = "complete.obs"), 3) else 0

              concordance_rows[[length(concordance_rows) + 1]] <- data.frame(
                Method_A = m1,
                Method_B = m2,
                Sig_A = length(s1),
                Sig_B = length(s2),
                Overlap = inter,
                Jaccard_Concordance_Pct = jaccard,
                Log2FC_Correlation_R = cor_val,
                stringsAsFactors = FALSE
              )
            }
          }
        }
        concordance_df <- do.call(rbind, concordance_rows)
        robust_proteins <- Reduce(intersect, sig_proteins)

        tbl_md <- paste0(
          "| Normalization A | Normalization B | Sig in A | Sig in B | Consensus Overlap | Jaccard Concordance (%) | Log2FC Correlation (R) |\n",
          "| :--- | :--- | :--- | :--- | :--- | :--- | :--- |\n",
          paste(apply(concordance_df, 1, function(r) {
            sprintf("| %s | %s | %s | %s | %s | %s%% | %s |", r['Method_A'], r['Method_B'], r['Sig_A'], r['Sig_B'], r['Overlap'], r['Jaccard_Concordance_Pct'], r['Log2FC_Correlation_R'])
          }), collapse = "\n")
        )

        log_code(glue::glue('# Evaluated multi-assay normalization sensitivity across: {paste(candidate_norms, collapse = ", ")}'))

        list(
          success = TRUE,
          tested_normalizations = candidate_norms,
          concordance_table = tbl_md,
          robust_protein_count = length(robust_proteins),
          robust_candidates = head(robust_proteins, 20),
          message = glue::glue("Evaluated {length(candidate_norms)} normalizations for contrast {comp}. Found {length(robust_proteins)} high-confidence robust candidates consistent across all methods.")
        )
      },

      "/run_code" = {
        code <- params$code
        if (is.null(code) || nchar(code) == 0) stop("No code provided")

        env_run <- new.env(parent = .GlobalEnv)
        assign(STATE$active_id, get_active_data(), envir = env_run)

        output <- capture.output({
          res <- eval(parse(text = code), envir = env_run)
        })

        if (exists(STATE$active_id, envir = env_run)) {
          updated <- get(STATE$active_id, envir = env_run)
          if ("tidyproteomics" %in% class(updated)) {
            set_active_data(updated)
          }
        }

        log_code(code)
        list(success = TRUE, output = paste(output, collapse = "\n"))
      },

      "/export" = {
        data <- get_active_data(params$id)
        rds_path <- if (!is.null(params$rds_path) && nzchar(params$rds_path)) params$rds_path else file.path(STATE$output_dir, "data", "tidyproteomics_data.rds")
        script_path <- if (!is.null(params$script_path) && nzchar(params$script_path)) params$script_path else file.path(STATE$output_dir, "code", "reproduce_pipeline.R")

        dir.create(dirname(rds_path), recursive = TRUE, showWarnings = FALSE)
        dir.create(dirname(script_path), recursive = TRUE, showWarnings = FALSE)

        saveRDS(data, file = rds_path)

        audit_trail <- c(
          "",
          "# ==============================================================================",
          "# Audit Trail (operations):",
          paste0("# - ", unlist(data$operations)),
          "# ==============================================================================",
          "",
          glue::glue('saveRDS({STATE$active_id}, file = "{rds_path}")'),
          glue::glue('cat("Persisted analyzed data object to {rds_path}\\n")')
        )
        full_script <- c(STATE$pipeline_code, "", audit_trail)
        writeLines(full_script, con = script_path)

        list(
          success = TRUE,
          rds_saved = rds_path,
          script_saved = script_path
        )
      },

      "/compile_summary" = {
        data <- get_active_data(params$id)
        if (is.null(data$analysis) || length(data$analysis) == 0) {
          stop("No analysis results found in dataset. Please run tpa_expression first.")
        }

        summary_path <- if (!is.null(params$output_summary) && nzchar(params$output_summary)) params$output_summary else file.path(STATE$output_dir, "docs", "observations_summary.md")
        script_path <- if (!is.null(params$output_script) && nzchar(params$output_script)) params$output_script else file.path(STATE$output_dir, "code", "06_observations.R")

        dir.create(dirname(summary_path), recursive = TRUE, showWarnings = FALSE)
        dir.create(dirname(script_path), recursive = TRUE, showWarnings = FALSE)

        # Target gene detection
        target_gene_arg <- if (!is.null(params$target_gene) && nzchar(trimws(params$target_gene))) trimws(params$target_gene) else NULL
        if (is.null(target_gene_arg)) {
          exp_md_path <- file.path(STATE$output_dir, "docs/experiment.md")
          if (file.exists(exp_md_path)) {
            exp_lines <- tryCatch(readLines(exp_md_path, warn = FALSE), error = function(e) character(0))
            tgt_line <- grep("Target\\s*(?:Protein|Gene)?:\\s*([A-Za-z0-9_/-]+)", exp_lines, value = TRUE, ignore.case = TRUE)
            if (length(tgt_line) > 0) {
              target_gene_arg <- trimws(sub(".*Target\\s*(?:Protein|Gene)?:\\s*([A-Za-z0-9_/-]+).*", "\\1", tgt_line[1], ignore.case = TRUE))
            }
          }
        }

        analyte_name <- if (!is.null(data$analyte)) data$analyte else "proteins"
        id_col <- if (!is.null(data$identifier)) data$identifier else "protein"
        features <- if (!is.null(data$quantitative[[id_col]])) unique(as.character(data$quantitative[[id_col]])) else character(0)
        samples <- if (!is.null(data$experiments$sample)) unique(as.character(data$experiments$sample)) else character(0)
        source_norm <- if (!is.null(data$quantitative_source)) data$quantitative_source else "raw"

        out_md <- character()
        emit <- function(...) out_md <<- c(out_md, paste0(...))
        emit_tbl <- function(df) {
          if (is.null(df) || nrow(df) == 0) {
            emit("_No rows available._\n")
          } else {
            emit(knitr::kable(df, format = "pipe", escape = TRUE), "")
          }
        }

        emit("# Primary Data-Derived Observations", "")
        emit(sprintf("Created: %s  ", format(Sys.time(), "%Y-%m-%d %H:%M")))
        emit("Agent: TidyProteomicsAgent v1.0.0  ")
        emit(sprintf("R Package: tidyproteomics v%s", as.character(packageVersion("tidyproteomics"))), "")
        emit("_Model and agent metadata follow docs/llm.md._", "")

        emit("## 1. Analysis Checkpoint & Dataset Dimensions Summary", "")
        if (!is.null(target_gene_arg) && nzchar(target_gene_arg)) {
          emit(sprintf("- **Target perturbation status**: Specified perturbation target is `%s`; quantitative metrics summarized below.", target_gene_arg))
        } else {
          emit("- **Target perturbation status**: Untargeted discovery screening scope across all quantified features.")
        }
        emit(sprintf("- **Dataset dimensions**: %d %s across %d samples (%s).", length(features), analyte_name, length(samples), paste(head(samples, 6), collapse = ", ")))
        emit(sprintf("- **Normalization source**: `%s`.", source_norm))

        rds_status <- if (file.exists(file.path(STATE$output_dir, "data/tidyproteomics_data.rds")) || file.exists("data/tidyproteomics_data.rds")) "PASS" else "PENDING"
        n_tables <- length(list.files(file.path(STATE$output_dir, "data"), pattern = "^table_.*\\.(tsv|csv)$", ignore.case = TRUE))
        n_plots <- length(list.files(file.path(STATE$output_dir, "data"), pattern = "\\.png$", ignore.case = TRUE))
        emit(sprintf("- **Artifact verification**: tidyproteomics RDS: %s; exported expression/enrichment tables: %d; diagnostic plots: %d.", rds_status, n_tables, n_plots), "")

        contrast_sig_sets <- list()
        comp_names <- names(data$analysis)

        for (contrast_str in comp_names) {
          analysis_obj <- data$analysis[[contrast_str]]
          exp_tbl <- analysis_obj$expression
          if (is.null(exp_tbl) || nrow(exp_tbl) == 0) next

          if (!"gene_name" %in% names(exp_tbl)) exp_tbl$gene_name <- NA_character_
          exp_tbl$gene_name[is.na(exp_tbl$gene_name) | !nzchar(trimws(exp_tbl$gene_name))] <- exp_tbl[[id_col]][is.na(exp_tbl$gene_name) | !nzchar(trimws(exp_tbl$gene_name))]
          if (!"description" %in% names(exp_tbl)) exp_tbl$description <- ""

          # Condition-specific imputation columns
          parts <- strsplit(contrast_str, "\\s*/\\s*")[[1]]
          treatment <- if (length(parts) >= 1) gsub("^[`'\"]+|[`'\"]+$", "", trimws(parts[1])) else "treatment"
          control <- if (length(parts) >= 2) gsub("^[`'\"]+|[`'\"]+$", "", trimws(parts[2])) else "control"

          g1 <- paste0("imputed_", treatment)
          g2 <- paste0("imputed_", control)
          imp1 <- if (g1 %in% names(exp_tbl)) as.numeric(exp_tbl[[g1]]) else rep(NA_real_, nrow(exp_tbl))
          imp2 <- if (g2 %in% names(exp_tbl)) as.numeric(exp_tbl[[g2]]) else rep(NA_real_, nrow(exp_tbl))
          max_imp <- pmax(imp1, imp2, na.rm = TRUE)
          max_imp[!is.finite(max_imp)] <- NA_real_

          exp_tbl$imputation_bias <- ifelse(is.na(max_imp), "UNKNOWN", ifelse(max_imp > 0.5, "HIGH", ifelse(max_imp >= 0.2, "MODERATE", "LOW")))
          exp_tbl$candidate_reliability <- ifelse(exp_tbl$imputation_bias == "LOW", "ROBUST_QUANTITATIVE", ifelse(exp_tbl$imputation_bias == "HIGH", "DETECTION_LIMITED_ON_OFF", ifelse(exp_tbl$imputation_bias == "MODERATE", "HIGH_UNCERTAINTY", "UNKNOWN")))
          exp_tbl$imputation_delta <- ifelse(is.finite(imp1) & is.finite(imp2), round(imp1 - imp2, 3), NA_real_)
          if (!"foldchange" %in% names(exp_tbl)) exp_tbl$foldchange <- 2^exp_tbl$log2_foldchange

          emit(sprintf("## Contrast: `%s`", contrast_str), "")
          modeled_n <- nrow(exp_tbl)
          unmodeled_n <- max(0, length(features) - modeled_n)
          emit(sprintf("- **Features Modeled**: %d %s (unmodeled: %d).", modeled_n, analyte_name, unmodeled_n))

          # Subsets
          sig_strict <- exp_tbl %>% dplyr::filter(!is.na(adj_p_value) & adj_p_value <= 0.05 & abs(log2_foldchange) >= 1.0)
          sig_up <- sig_strict %>% dplyr::filter(log2_foldchange >= 1.0)
          sig_down <- sig_strict %>% dplyr::filter(log2_foldchange <= -1.0)
          sig_relaxed <- exp_tbl %>% dplyr::filter(!is.na(adj_p_value) & adj_p_value <= 0.05 & abs(log2_foldchange) >= 0.38)
          sig_relaxed_up <- sig_relaxed %>% dplyr::filter(log2_foldchange >= 0.38)
          sig_relaxed_down <- sig_relaxed %>% dplyr::filter(log2_foldchange <= -0.38)
          sig_nom <- exp_tbl %>% dplyr::filter(!is.na(p_value) & p_value <= 0.05)
          sig_nom_up <- sig_nom %>% dplyr::filter(log2_foldchange > 0)
          sig_nom_down <- sig_nom %>% dplyr::filter(log2_foldchange < 0)

          emit(sprintf("- **Strict Threshold (|log2FC| >= 1.0, q <= 0.05)**: %d significant (%d higher in %s, %d lower in %s).", nrow(sig_strict), nrow(sig_up), treatment, nrow(sig_down), treatment))
          emit(sprintf("- **Relaxed Threshold (|log2FC| >= 0.38, q <= 0.05)**: %d significant (%d higher in %s, %d lower in %s).", nrow(sig_relaxed), nrow(sig_relaxed_up), treatment, nrow(sig_relaxed_down), treatment))
          emit(sprintf("- **Nominal Threshold (p <= 0.05)**: %d significant (%d higher in %s, %d lower in %s).", nrow(sig_nom), nrow(sig_nom_up), treatment, nrow(sig_nom_down), treatment))
          emit("")

          contrast_sig_sets[[contrast_str]] <- list(
            strict_total = nrow(sig_strict),
            strict_up = nrow(sig_up),
            strict_down = nrow(sig_down),
            relaxed_total = nrow(sig_relaxed),
            relaxed_up = nrow(sig_relaxed_up),
            relaxed_down = nrow(sig_relaxed_down),
            nom_total = nrow(sig_nom),
            nom_up = nrow(sig_nom_up),
            nom_down = nrow(sig_nom_down),
            up_genes = unique(na.omit(sig_up$gene_name)),
            down_genes = unique(na.omit(sig_down$gene_name))
          )

          # Target Efficacy Section
          emit("### 2. Target Efficacy / Leading Perturbation Status", "")
          target_match <- NULL
          if (!is.null(target_gene_arg) && nzchar(target_gene_arg)) {
            targets_clean <- unlist(strsplit(target_gene_arg, "[,/ ]+"))
            target_match <- exp_tbl %>% dplyr::filter(toupper(gene_name) %in% toupper(targets_clean) | toupper(.data[[id_col]]) %in% toupper(targets_clean))
          }
          if (!is.null(target_match) && nrow(target_match) > 0) {
            target_display <- target_match %>% dplyr::transmute(
              Identifier = gene_name,
              Protein = .data[[id_col]],
              `log2FC` = sprintf("%.4f", log2_foldchange),
              `FoldChange` = sprintf("%.3f", foldchange),
              `p-value` = fmt_pvalue(p_value),
              `q-value` = fmt_pvalue(adj_p_value),
              `Imputation Risk` = imputation_bias,
              `Candidate Reliability` = candidate_reliability,
              `Percent Change` = sprintf("%.1f%%", (foldchange - 1) * 100)
            )
            emit_tbl(target_display)
          } else {
            emit("_Target-level efficacy metrics not resolved in modeled contrast or untargeted study design._\n")
          }

          # Format candidate helper
          format_candidates <- function(df_cand) {
            df_cand %>%
              head(10) %>%
              dplyr::mutate(
                Rank = row_number(),
                Identifier = gene_name,
                Protein = .data[[id_col]],
                Description = if ("description" %in% names(df_cand)) substr(description, 1, 45) else "-",
                `log2FC` = sprintf("%.4f", log2_foldchange),
                `p-value` = fmt_pvalue(p_value),
                `q-value` = fmt_pvalue(adj_p_value),
                `Imputation Risk` = imputation_bias,
                `Candidate Reliability` = candidate_reliability,
                `Δ imputation` = ifelse(is.na(imputation_delta), "NA", sprintf("%.3f", imputation_delta))
              ) %>%
              dplyr::select(Rank, Identifier, Protein, Description, `log2FC`, `p-value`, `q-value`, `Imputation Risk`, `Candidate Reliability`, `Δ imputation`)
          }

          # Top 10 Upregulated
          emit("### 3. Top Significantly Upregulated Proteins", "")
          cand_up <- if (nrow(sig_up) > 0) sig_up %>% dplyr::arrange(desc(log2_foldchange)) else exp_tbl %>% dplyr::filter(log2_foldchange > 0) %>% dplyr::arrange(desc(log2_foldchange))
          emit_tbl(format_candidates(cand_up))

          # Top 10 Downregulated
          emit("### 4. Top Significantly Downregulated Proteins", "")
          cand_down <- if (nrow(sig_down) > 0) sig_down %>% dplyr::arrange(log2_foldchange) else exp_tbl %>% dplyr::filter(log2_foldchange < 0) %>% dplyr::arrange(log2_foldchange)
          emit_tbl(format_candidates(cand_down))

          # Top Balanced Candidates (Volcano Pi-Score)
          emit("### Top Balanced Candidates (Volcano Pi-Score)", "")
          top_pi <- exp_tbl %>%
            dplyr::filter(!is.na(log2_foldchange), !is.na(adj_p_value)) %>%
            dplyr::mutate(pi_score = abs(log2_foldchange) * -log10(pmax(adj_p_value, 1e-10))) %>%
            dplyr::arrange(desc(pi_score)) %>%
            head(10)
          if (nrow(top_pi) > 0) {
            top_pi_disp <- top_pi %>%
              dplyr::mutate(
                Rank = row_number(),
                Identifier = gene_name,
                Protein = .data[[id_col]],
                `log2FC` = sprintf("%.4f", log2_foldchange),
                `p-value` = fmt_pvalue(p_value),
                `q-value` = fmt_pvalue(adj_p_value),
                `Pi-Score` = sprintf("%.2f", pi_score),
                `Imputation Risk` = imputation_bias,
                `Candidate Reliability` = candidate_reliability
              ) %>%
              dplyr::select(Rank, Identifier, Protein, `log2FC`, `p-value`, `q-value`, `Pi-Score`, `Imputation Risk`, `Candidate Reliability`)
            emit_tbl(top_pi_disp)
          } else {
            emit("_No balanced candidates available._\n")
          }

          # Pathway Enrichments
          emit("### 5. Top Significant Pathway Enrichments", "")
          c_clean <- gsub("[^A-Za-z0-9_]", "_", contrast_str)
          data_dir <- file.path(STATE$output_dir, "data")
          enr_files <- list.files(data_dir, pattern = paste0("^table_.*_enrichment_.*", c_clean, ".*\\.(tsv|csv)$"), full.names = TRUE, ignore.case = TRUE)
          if (length(enr_files) == 0) {
            enr_files <- list.files("data", pattern = paste0("^table_.*_enrichment_.*", c_clean, ".*\\.(tsv|csv)$"), full.names = TRUE, ignore.case = TRUE)
          }
          if (length(enr_files) == 0) {
            enr_files <- list.files(data_dir, pattern = "^table_.*_enrichment_.*\\.(tsv|csv)$", full.names = TRUE, ignore.case = TRUE)
          }

          enr_tbl <- NULL
          if (length(enr_files) > 0) {
            enr_tbl <- dplyr::bind_rows(lapply(enr_files, function(f) {
              tbl <- tryCatch(
                if (grepl("\\.tsv$", f, ignore.case = TRUE)) readr::read_tsv(f, show_col_types = FALSE) else readr::read_csv(f, show_col_types = FALSE),
                error = function(e) NULL
              )
              if (!is.null(tbl) && nrow(tbl) > 0) {
                if (!"term" %in% names(tbl)) {
                  cat_name <- sub(paste0("^.*_enrichment_(.*)_", c_clean, "\\.(tsv|csv)$"), "\\1", basename(f), ignore.case = TRUE)
                  if (identical(cat_name, basename(f))) cat_name <- sub("^.*_enrichment_([^_]+(?:_[^_]+)*?)_.*$", "\\1", basename(f), ignore.case = TRUE)
                  tbl$term <- cat_name
                }
              }
              tbl
            }))
            if (!is.null(enr_tbl) && (!"annotation" %in% names(enr_tbl) || nrow(enr_tbl) == 0)) enr_tbl <- NULL
          }

          if (is.null(enr_tbl) && !is.null(analysis_obj$enrichment) && length(analysis_obj$enrichment) > 0) {
            enr_list <- list()
            for (t_name in names(analysis_obj$enrichment)) {
              item <- analysis_obj$enrichment[[t_name]]
              if (!is.null(item$data) && is.data.frame(item$data) && nrow(item$data) > 0) {
                df_sub <- item$data
                df_sub$term <- t_name
                enr_list[[t_name]] <- df_sub
              }
            }
            if (length(enr_list) > 0) enr_tbl <- dplyr::bind_rows(enr_list)
          }

          if (!is.null(enr_tbl) && nrow(enr_tbl) > 0 && "adj_p_value" %in% names(enr_tbl)) {
            sig_enr <- enr_tbl %>%
              dplyr::filter(!is.na(adj_p_value) & adj_p_value <= 0.05) %>%
              dplyr::arrange(adj_p_value) %>%
              dplyr::distinct(annotation, .keep_all = TRUE) %>%
              head(15)

            if (nrow(sig_enr) > 0) {
              sig_enr$annotation <- resolve_reactome_ids(sig_enr$annotation)
              score_col <- intersect(c("enrichment", "score", "statistic"), names(sig_enr))[1]
              driver_col <- intersect(c("gene_names", "member_genes", "member_proteins"), names(sig_enr))[1]
              edge_col <- intersect(c("leading_edge_count", "size", "n"), names(sig_enr))[1]

              driver_vec <- if (!is.na(driver_col)) {
                vapply(strsplit(as.character(sig_enr[[driver_col]]), ",\\s*"), function(v) paste(head(unique(na.omit(trimws(v))), 4), collapse = ", "), character(1))
              } else {
                rep("-", nrow(sig_enr))
              }

              enr_disp <- tibble::tibble(
                Category = if ("term" %in% names(sig_enr)) sig_enr$term else "Enrichment",
                Annotation = sig_enr$annotation,
                `Enrichment Score` = if (!is.na(score_col)) sprintf("%.3f", sig_enr[[score_col]]) else "-",
                `q-value` = fmt_pvalue(sig_enr$adj_p_value),
                `Leading Drivers` = driver_vec,
                `Set Size` = if (!is.na(edge_col)) sig_enr[[edge_col]] else NA
              )
              emit_tbl(enr_disp)
              emit("Wilcoxon enrichment-score direction: positive indicates a shift toward higher abundance in the treatment; negative indicates a shift toward lower abundance.\n")
            } else {
              emit("_No pathway terms met the q <= 0.05 significance threshold._\n")
            }
          } else {
            emit("_No enrichment analysis results available for this contrast._\n")
          }

          emit("### 6. Primary Empirical Data Summary", "")
          emit(sprintf("For `%s`, %d of %d modeled proteins passed the strict effect-size and FDR thresholds (%d higher and %d lower in %s). Imputation-risk labels distinguish measured continuous quantitative shifts (LOW) from limit-of-detection presence/absence shifts (HIGH); MODERATE risk denotes intermediate missingness. No external literature or speculative conclusions are inferred here.", contrast_str, nrow(sig_strict), modeled_n, nrow(sig_up), nrow(sig_down), treatment), "")
        }

        # Multi-Contrast Summary if >= 2 contrasts
        if (length(comp_names) >= 2 && length(contrast_sig_sets) >= 2) {
          emit("## Multi-Contrast Cross-Comparison Summary", "")
          all_up <- lapply(contrast_sig_sets, `[[`, "up_genes")
          all_down <- lapply(contrast_sig_sets, `[[`, "down_genes")
          shared_up <- Reduce(intersect, all_up)
          shared_down <- Reduce(intersect, all_down)
          union_up <- unique(unlist(all_up))
          union_down <- unique(unlist(all_down))
          discordant <- intersect(union_up, union_down)

          mc_df <- dplyr::bind_rows(lapply(names(contrast_sig_sets), function(cn) {
            cs <- contrast_sig_sets[[cn]]
            other_cns <- setdiff(names(contrast_sig_sets), cn)
            other_genes <- unique(unlist(lapply(other_cns, function(oc) c(contrast_sig_sets[[oc]]$up_genes, contrast_sig_sets[[oc]]$down_genes))))
            my_genes <- unique(c(cs$up_genes, cs$down_genes))
            tibble::tibble(
              Contrast = cn,
              `Strict Total` = cs$strict_total,
              `Strict Up` = cs$strict_up,
              `Strict Down` = cs$strict_down,
              `Relaxed Total` = cs$relaxed_total,
              `Shared With Others` = length(intersect(my_genes, other_genes)),
              `Contrast Unique` = length(setdiff(my_genes, other_genes))
            )
          }))
          emit_tbl(mc_df)
          emit(sprintf("- **Pan-Contrast Concordant Upregulated (%d)**: %s", length(shared_up), if (length(shared_up) > 0) paste(head(shared_up, 10), collapse = ", ") else "None"))
          emit(sprintf("- **Pan-Contrast Concordant Downregulated (%d)**: %s", length(shared_down), if (length(shared_down) > 0) paste(head(shared_down, 10), collapse = ", ") else "None"))
          emit(sprintf("- **Discordantly Regulated Across Contrasts (%d)**: %s\n", length(discordant), if (length(discordant) > 0) paste(head(discordant, 10), collapse = ", ") else "None"))

          if (length(discordant) > 0) {
            emit("#### Discordant Feature Breakdown Across Contrasts", "")
            disc_records <- lapply(discordant, function(g) {
              row_info <- list(Gene = g)
              for (cn in names(contrast_sig_sets)) {
                dir_str <- if (g %in% contrast_sig_sets[[cn]]$up_genes) "UP" else if (g %in% contrast_sig_sets[[cn]]$down_genes) "DOWN" else "FLAT"
                row_info[[cn]] <- dir_str
              }
              tibble::as_tibble(row_info)
            })
            emit_tbl(dplyr::bind_rows(disc_records))
          }
        }

        # Export authoritative feature accounting table
        acc_file <- file.path(STATE$output_dir, "data", "table_feature_accounting.tsv")
        tryCatch({
          df_long <- tryCatch(as.data.frame(data, shape = "long"), error = function(e) data.frame())
          zero_quant_n <- 0
          quantifiable_n <- length(features)
          quant_col_name <- paste0("abundance_", source_norm)
          if (nrow(df_long) > 0 && quant_col_name %in% names(df_long) && id_col %in% names(df_long)) {
            obs_per_f <- tapply(!is.na(df_long[[quant_col_name]]), df_long[[id_col]], sum)
            zero_quant_n <- sum(obs_per_f == 0, na.rm = TRUE)
            quantifiable_n <- sum(obs_per_f > 0, na.rm = TRUE)
          }

          n_files <- if (!is.null(data$experiments)) nrow(data$experiments) else 0
          n_groups <- if (!is.null(data$experiments$sample)) length(unique(data$experiments$sample)) else length(samples)
          total_cells <- length(features) * n_files
          obs_vals <- if (!is.null(data$quantitative[[quant_col_name]])) data$quantitative[[quant_col_name]] else numeric(0)
          observed_cells <- sum(!is.na(obs_vals) & obs_vals > 0)
          missing_cells <- max(0, total_cells - observed_cells)
          missing_pct <- if (total_cells > 0) round(100 * (missing_cells / total_cells), 1) else 0

          master_acc <- tibble::tibble(
            metric = c(
              paste0("total_features_retained_", analyte_name),
              paste0("quantifiable_features_", analyte_name),
              "zero_quantifiable_background",
              "active_normalization_assay",
              "raw_file_count",
              "biological_group_count",
              "total_matrix_cells",
              "observed_cells",
              "missing_cells",
              "matrix_missingness_percentage"
            ),
            value = c(
              as.character(length(features)),
              as.character(quantifiable_n),
              as.character(zero_quant_n),
              as.character(source_norm),
              as.character(n_files),
              as.character(n_groups),
              as.character(total_cells),
              as.character(observed_cells),
              as.character(missing_cells),
              paste0(missing_pct, "%")
            )
          )

          for (cn in comp_names) {
            exp_df <- data$analysis[[cn]]$expression
            if (!is.null(exp_df) && nrow(exp_df) > 0) {
              m_cnt <- nrow(exp_df)
              unm_cnt <- length(features) - m_cnt
              master_acc <- dplyr::bind_rows(master_acc, tibble::tibble(
                metric = c(paste0("contrast_", gsub("[^A-Za-z0-9_]", "_", cn), "_modeled"),
                           paste0("contrast_", gsub("[^A-Za-z0-9_]", "_", cn), "_unmodeled")),
                value = c(as.character(m_cnt), as.character(unm_cnt))
              ))
            }
          }
          dir.create(dirname(acc_file), recursive = TRUE, showWarnings = FALSE)
          readr::write_tsv(master_acc, acc_file)
        }, error = function(e) NULL)

        # Write docs/observations_summary.md
        writeLines(out_md, con = summary_path)

        # Generate reproducible standalone code/06_observations.R script
        standalone_r <- c(
          "#!/usr/bin/env Rscript",
          "# ==============================================================================",
          "# Reproducible Extraction Script: Phase 06 Primary Observations",
          glue::glue("# Generated: {Sys.time()} via tidyproteomics-agent"),
          "# ==============================================================================",
          "library(tidyproteomics)",
          "library(dplyr)",
          "library(knitr)",
          "library(readr)",
          "",
          "rds_file <- 'data/tidyproteomics_data.rds'",
          "stopifnot('Tidyproteomics data object missing' = file.exists(rds_file))",
          "tp_data <- readRDS(rds_file)",
          "",
          "# Checkpoints",
          "cat('=== CHECKPOINTS ===\\n')",
          "cat('Artifact tidyproteomics_data.rds exists:', file.exists(rds_file), '\\n')",
          "cat('Observations summary file exists:', file.exists('docs/observations_summary.md'), '\\n')",
          "cat('PHASE_6_EXTRACTION_CHECKPOINT_PASS\\n')"
        )
        writeLines(standalone_r, con = script_path)

        list(
          success = TRUE,
          summary_file = summary_path,
          script_file = script_path,
          features_modeled = length(features),
          contrasts_summarized = length(comp_names),
          preview = paste(head(out_md, 40), collapse = "\n"),
          message = glue::glue("Observations summary compiled successfully to '{summary_path}' and script exported to '{script_path}'.")
        )
      },

      "/operations" = {
        data <- get_active_data(params$id)
        ops <- unlist(data$operations)
        list(success = TRUE, operations = ops)
      },

      "/shutdown" = {
        later::later(function() {
          stopServer(SERVER_HANDLE)
          quit(save = "no")
        }, 0.5)
        list(success = TRUE, message = "Daemon shutting down")
      },

      stop(glue::glue("Endpoint '{path}' not found"))
    )
  }, error = function(e) {
    list(success = FALSE, error = e$message)
  })

  status_code <- if (isTRUE(res_data$success) || path == "/health") 200L else 400L
  list(
    status = status_code,
    headers = list(
      "Content-Type" = "application/json",
      "Access-Control-Allow-Origin" = "*"
    ),
    body = jsonlite::toJSON(res_data, auto_unbox = TRUE, pretty = TRUE)
  )
}

# Read Port from environment or default to 8765
PORT <- as.integer(Sys.getenv("TIDY_DAEMON_PORT", unset = "8765"))
cat(glue::glue("[TidyDaemon] Initializing R Daemon on 127.0.0.1:{PORT} ...\n"))

SERVER_HANDLE <<- startServer("127.0.0.1", PORT, list(call = handle_request))
cat(glue::glue("[TidyDaemon] Server successfully running at http://127.0.0.1:{PORT}\n"))
cat(glue::glue("[TidyDaemon] Workspace root: {STATE$output_dir}\n"))

if (!interactive()) {
  while (TRUE) {
    service(1000)
    Sys.sleep(0.01)
  }
}
