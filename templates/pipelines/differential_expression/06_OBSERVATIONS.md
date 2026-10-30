---
tools: []
---

### Phase 6: Primary Data-Derived Observations & Extraction

In this phase, you (the LLM) will construct and execute an extraction script `code/06_observations.R` using the saved `data/tidyproteomics_data.rds` object. This extracts targeted summaries from `tidyproteomics` directly to the terminal and log (`logs/06_observations/console.log`), avoiding token overflows from large CSV files. 

You will summarize the primary quantitative data derived so far across all evaluated contrasts:
- Overall dataset dimensions, quantified identifiers, and quality checkpoint status.
- Target perturbation status (if a specific target gene was defined in `docs/experiment.md`) or untargeted discovery scope.
- Quantitative threshold counts ($|\log_2\text{FC}| \ge 1.0, q \le 0.05$), total upregulated, total downregulated per contrast.
- Top significantly expressed proteins (Markdown tables of top 10 upregulated and top 10 downregulated features with $\log_2\text{FC}$ and $q$-values).
- Top significant pathway enrichments across analyzed annotation categories (GO, Reactome, etc.).

You will then author `docs/observations.md` strictly documenting these primary data-derived observations without premature speculation or external literature synthesis (which will be systematically developed layer-by-layer in subsequent phases: internal knowledge in Phase 7, web search in Phase 8, and literature database interrogation in Phase 9).

---

#### 1. Deterministic Data Extraction via `code/06_observations.R`
> ⚡ **CRITICAL ONE-SHOT WORKFLOW DIRECTIVE**:
> In this phase, do NOT call interactive MCP inspection tools (`tpa_inspect`, `tpa_summary`, `tpa_run_code`, `tpa_export_table`) or burn turns on exploratory queries. Proceed deterministically in 3 concise turns:
> 1. Author `code/06_observations.R` using the complete extraction script template below.
> 2. Execute `code/06_observations.R` via `execute_command`: `if [ -f tools/lint_tidyproteomics.R ]; then Rscript tools/lint_tidyproteomics.R code/06_observations.R && Rscript code/06_observations.R; else Rscript code/06_observations.R; fi`. (Output is logged to `logs/06_observations/console.log` and formatted Markdown tables are automatically written to `data/observations_summary.md`).
> 3. Populate `docs/observations.md` in a single step (`execute_command: cp data/observations_summary.md docs/observations.md` or a single `read_file` + `write_file`). **Do NOT burn turns reading `data/observations_summary.md` in small repetitive chunks.** Verify checkpoint passing (`PHASE_6_EXTRACTION_CHECKPOINT_PASS`) and immediately invoke `complete_phase`.

Rather than reading massive CSV or TSV files into context, write and execute `code/06_observations.R`. The script extracts exact metrics, resolves pathway names, generates clean markdown tables, and writes `data/observations_summary.md` directly.

Use `tidyproteomics`, `dplyr`, and `knitr` to extract exact numbers, target verification (or untargeted scope), top biomarkers, and pathway summaries across all evaluated contrasts:
```r
library(tidyproteomics)
library(dplyr)
library(knitr)
library(readr)

# 1. Load persisted tidyproteomics data object from data/
tp_data <- readRDS("data/tidyproteomics_data.rds")

# Helper to resolve Reactome IDs to human-readable pathway names
resolve_reactome_ids <- function(ids) {
  if (length(ids) == 0) return(character(0))
  resolved <- as.character(ids)
  reactome_idx <- which(grepl("^R-[A-Z]{3}-[0-9]+", resolved))
  if (length(reactome_idx) == 0) return(resolved)

  unique_reactome <- unique(resolved[reactome_idx])
  name_map <- list()

  tsv_paths <- c(
    "tools/reactome_pathways.tsv",
    "data/reactome_pathways.tsv",
    "extension/templates/shared/tools/reactome_pathways.tsv"
  )
  for (tp in tsv_paths) {
    if (file.exists(tp)) {
      tryCatch({
        df <- read.delim(tp, header = FALSE, stringsAsFactors = FALSE, sep = "\t")
        if (ncol(df) >= 2) {
          sub_df <- df[df[[1]] %in% unique_reactome, ]
          if (nrow(sub_df) > 0) {
            for (i in seq_len(nrow(sub_df))) name_map[[sub_df[i, 1]]] <- sub_df[i, 2]
          }
        }
      }, error = function(e) NULL)
      break
    }
  }

  unresolved <- setdiff(unique_reactome, names(name_map))
  if (length(unresolved) > 0) {
    old_to <- getOption("timeout")
    on.exit(options(timeout = old_to), add = TRUE)
    options(timeout = 5)
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

# Helper to preserve precision on statistical columns using scientific notation (< 1e-4)
format_stats <- function(df) {
  df %>% mutate(across(any_of(c("p_value", "adj_p_value")), ~ ifelse(!is.na(.) & . < 1e-4, sprintf("%.2e", .), sprintf("%.4f", .))))
}

# Accumulator for structured observations summary markdown file
md_out <- character(0)
emit_md <- function(...) {
  lines <- paste0(...)
  md_out <<- c(md_out, lines)
  cat(lines, sep = "\n")
}
emit_table <- function(df, format = "pipe") {
  tbl_lines <- knitr::kable(df, format = format)
  md_out <<- c(md_out, tbl_lines, "")
  cat(tbl_lines, sep = "\n")
  cat("\n")
}

# 2. Checkpoint & dataset dimension summary
cat("=== OBJECT SUMMARY ===\n")
print(tp_data)

analyte_name <- if (!is.null(tp_data[["analyte"]])) tp_data[["analyte"]] else "proteins"
id_col <- if (!is.null(tp_data[["identifier"]])) tp_data[["identifier"]][1] else if (identical(analyte_name, "peptides")) "peptide" else "protein"
available_terms <- get_annotation_terms(tp_data, format = "vector")

completed_analyses <- get_analyses(tp_data)
contrast_names <- unique(completed_analyses$comparison)
cat(sprintf("\nAvailable contrasts in object: %s\n", paste(contrast_names, collapse = ", ")))

# Target check (if a specific target gene/protein was specified in docs/experiment.md; otherwise NULL):
target_gene <- "<decided_target_gene_or_NULL>"         # e.g., "MYC" or NULL
target_uniprot <- "<decided_target_uniprot_or_NULL>"   # e.g., "P01106" or NULL

emit_md("# Primary Observations Summary (Data-Derived)")
emit_md("")
emit_md(sprintf("- **Generated**: %s", format(Sys.time(), "%Y-%m-%d %H:%M:%S")))
emit_md(sprintf("- **Analyte**: `%s` (Primary ID: `%s`)", analyte_name, id_col))
emit_md(sprintf("- **Available Contrasts**: %s", paste(contrast_names, collapse = ", ")))
emit_md("")

contrast_sig_sets <- list()

for (c_name in contrast_names) {
  c_parts <- strsplit(c_name, "/")[[1]]
  treatment_group <- c_parts[1]
  control_group <- c_parts[2]
  contrast_str <- paste0(treatment_group, "/", control_group)
  contrast_tag <- paste0(treatment_group, "-", control_group)

  emit_md(sprintf("## Contrast: %s vs %s", treatment_group, control_group))
  emit_md("")

  exp_tbl <- rlang::inject(export_analysis(tp_data, !!rlang::parse_expr(contrast_str), .analysis = "expression"))
  row_id_col <- if (id_col %in% names(exp_tbl)) id_col else if ("protein" %in% names(exp_tbl)) "protein" else if ("peptide" %in% names(exp_tbl)) "peptide" else names(exp_tbl)[1]

  c_clean <- gsub("[^A-Za-z0-9]", ".*", contrast_str)
  exp_files <- list.files("data", pattern = sprintf("^table_%s_expression_.*%s.*[.](tsv|csv)$", analyte_name, c_clean), full.names = TRUE, ignore.case = TRUE)
  if (length(exp_files) == 0) {
    exp_files <- list.files("data", pattern = sprintf("^table_.*_expression_.*%s.*[.](tsv|csv)$", c_clean), full.names = TRUE, ignore.case = TRUE)
  }
  if (length(exp_files) == 0) {
    exp_files <- list.files("data", pattern = "^table_.*_expression_.*[.](tsv|csv)$", full.names = TRUE, ignore.case = TRUE)
  }

  # Missing gene symbol fallback and delimiter sanitation (extract GN= from FASTA description)
  desc_gn <- if ("description" %in% names(exp_tbl)) {
    ifelse(grepl("\\bGN=([A-Za-z0-9_-]+)", exp_tbl$description),
           sub("^.*\\bGN=([A-Za-z0-9_-]+).*$", "\\1", exp_tbl$description),
           NA_character_)
  } else NA_character_

  id_fallback <- as.character(exp_tbl[[row_id_col]])
  exp_tbl <- exp_tbl %>%
    mutate(
      gene_name = coalesce(
        if ("gene_name" %in% names(.)) ifelse(is.na(gene_name) | !nzchar(trimws(gene_name)), NA_character_, gene_name) else NA_character_,
        desc_gn,
        if ("protein" %in% names(.)) as.character(protein) else NA_character_,
        id_fallback
      ),
      gene_name = gsub(";[[:space:]]+", "; ", gsub(";+", "; ", trimws(gene_name))),
      gene_name = gsub("^[; ]+|[; ]+$", "", gene_name)
    )

  # Imputation Risk & LOD Flagging
  g1_imp <- paste0("imputed_", treatment_group)
  g2_imp <- paste0("imputed_", control_group)
  exp_tbl <- exp_tbl %>%
    mutate(
      imputed_total = if ("imputed_total" %in% names(.)) imputed_total else if ("imputed" %in% names(.)) imputed else NA_real_,
      imputation_bias = if ("imputation_bias" %in% names(.) && any(!is.na(imputation_bias))) imputation_bias else case_when(
        pmax(if (g1_imp %in% names(.)) get(g1_imp) else 0,
             if (g2_imp %in% names(.)) get(g2_imp) else 0, na.rm = TRUE) > 0.5 ~ "HIGH",
        pmax(if (g1_imp %in% names(.)) get(g1_imp) else 0,
             if (g2_imp %in% names(.)) get(g2_imp) else 0, na.rm = TRUE) >= 0.2 ~ "MODERATE",
        TRUE ~ "LOW"
      ),
      candidate_reliability = if ("candidate_reliability" %in% names(.) && any(!is.na(candidate_reliability))) candidate_reliability else case_when(
        imputation_bias == "LOW" ~ "ROBUST_QUANTITATIVE",
        imputation_bias == "HIGH" ~ "DETECTION_LIMITED_ON_OFF",
        TRUE ~ "HIGH_UNCERTAINTY"
      ),
      imputation_delta = if ("imputation_delta" %in% names(.)) imputation_delta else if (g1_imp %in% names(.) && g2_imp %in% names(.)) round(get(g1_imp) - get(g2_imp), 3) else NA_real_
    )

  # Persist augmented expression table with reliability and imputation metrics for downstream phases (e.g. 10_FIGURES)
  out_tsv <- sprintf("data/table_%s_expression_%s.tsv", analyte_name, gsub("[^A-Za-z0-9]", "_", contrast_str))
  readr::write_tsv(exp_tbl, out_tsv)
  if (length(exp_files) > 0 && file.exists(exp_files[1])) {
    if (grepl("[.]tsv$", exp_files[1], ignore.case = TRUE)) {
      readr::write_tsv(exp_tbl, exp_files[1])
    } else {
      readr::write_csv(exp_tbl, exp_files[1])
    }
  }

  # Target perturbation / biomarker check (if targeted):
  emit_md("### Target Status")
  if (!is.null(target_gene) && target_gene != "" && !grepl("<decided_", target_gene)) {
    target_cols <- intersect(
      c("gene_name", "gene_symbol", "symbol", "gene", "protein", "accession", "peptide", "uniprot", "uniprot_id"),
      colnames(exp_tbl)
    )
    target_rows <- if (length(target_cols) > 0) {
      exp_tbl %>% filter(if_any(all_of(target_cols), ~ .x %in% c(target_gene, target_uniprot)))
    } else {
      exp_tbl[0, ]
    }
    if ("foldchange" %in% colnames(target_rows) && nrow(target_rows) > 0) {
      target_rows <- target_rows %>% mutate(percent_change = (foldchange - 1) * 100)
    }

    target_display <- target_rows %>% select(any_of(c(
      target_cols, "log2_foldchange", "foldchange", "p_value",
      "adj_p_value", "imputation_bias", "candidate_reliability", "percent_change", "description", "name"
    ))) %>% format_stats()
    emit_table(target_display)
  } else {
    emit_md("Untargeted / Discovery Screen (No single target gene specified).")
    emit_md("")
  }

  emit_md("### Quantitative Threshold Counts")
  sig_all <- exp_tbl %>% filter(!is.na(adj_p_value), adj_p_value <= 0.05, abs(log2_foldchange) >= 1)
  sig_up <- exp_tbl %>% filter(!is.na(adj_p_value), adj_p_value <= 0.05, log2_foldchange >= 1)
  sig_down <- exp_tbl %>% filter(!is.na(adj_p_value), adj_p_value <= 0.05, log2_foldchange <= -1)

  # Tier 2 (Relaxed FDR / Ratio-Compressed: q <= 0.05, |log2FC| >= 0.38 [~1.3-fold]) & Tier 3 (Nominal p <= 0.05)
  sig_relaxed_all <- exp_tbl %>% filter(!is.na(adj_p_value), adj_p_value <= 0.05, abs(log2_foldchange) >= 0.38)
  sig_relaxed_up <- exp_tbl %>% filter(!is.na(adj_p_value), adj_p_value <= 0.05, log2_foldchange >= 0.38)
  sig_relaxed_down <- exp_tbl %>% filter(!is.na(adj_p_value), adj_p_value <= 0.05, log2_foldchange <= -0.38)
  sig_nom_up <- exp_tbl %>% filter(!is.na(p_value), p_value <= 0.05, log2_foldchange > 0)
  sig_nom_down <- exp_tbl %>% filter(!is.na(p_value), p_value <= 0.05, log2_foldchange < 0)

  total_vars <- get_unique_variables(tp_data, id_col, format = "vector")
  total_features <- length(total_vars)
  modeled_features <- nrow(exp_tbl)
  unmodeled_count <- total_features - modeled_features
  emit_md(sprintf("- **Total Features in Dataset (%s)**: %d", analyte_name, total_features))
  emit_md(sprintf("- **Features Modeled in Contrast (%s)**: %d (unmodeled: %d due to all-missing values or condition-exclusive absence)", analyte_name, modeled_features, unmodeled_count))
  if (unmodeled_count > 0) {
    unmod_ids <- setdiff(total_vars, exp_tbl[[row_id_col]])
    df_unmod <- tryCatch(as.data.frame(tp_data, shape = "long") %>% filter(.data[[id_col]] %in% unmod_ids, sample %in% c(treatment_group, control_group)), error = function(e) NULL)
    if (!is.null(df_unmod) && nrow(df_unmod) > 0) {
      q_cols <- grep("^abundance_", names(df_unmod), value = TRUE)
      q_col <- if (length(q_cols) > 0) tail(q_cols, 1) else NA_character_
      if (!is.na(q_col)) {
        sw_summary <- df_unmod %>%
          group_by(.data[[id_col]], across(any_of(c("gene_name", "description")))) %>%
          summarise(
            n_treat = sum(!is.na(.data[[q_col]][sample == treatment_group])),
            n_ctrl = sum(!is.na(.data[[q_col]][sample == control_group])),
            .groups = "drop"
          )
        treat_only <- sw_summary %>% filter(n_treat >= 2, n_ctrl == 0)
        ctrl_only <- sw_summary %>% filter(n_ctrl >= 2, n_treat == 0)
        if (nrow(treat_only) > 0 || nrow(ctrl_only) > 0) {
          emit_md(sprintf("- **Unmodeled Qualitative Condition-Exclusive Switches (>= 2 replicates vs 0)**: %d `%s`-exclusive, %d `%s`-exclusive", nrow(treat_only), treatment_group, nrow(ctrl_only), control_group))
        }
      }
    }
  }
  emit_md(sprintf("- **Total Significant (Strict Tier 1: |log2FC| >= 1, q <= 0.05)**: %d (%d upregulated, %d downregulated)", nrow(sig_all), nrow(sig_up), nrow(sig_down)))
  if (nrow(sig_up) < 3 || nrow(sig_down) < 3) {
    emit_md(sprintf("- **Relaxed FDR Significant (Tier 2: |log2FC| >= 0.38, q <= 0.05)**: %d (%d upregulated, %d downregulated)", nrow(sig_relaxed_all), nrow(sig_relaxed_up), nrow(sig_relaxed_down)))
    emit_md(sprintf("- **Nominal Significant (Tier 3: p <= 0.05)**: %d (%d upregulated, %d downregulated)", nrow(sig_nom_up) + nrow(sig_nom_down), nrow(sig_nom_up), nrow(sig_nom_down)))
  }
  emit_md("")

  # Record per-contrast significant sets for Multi-Contrast Cross-Comparison
  active_sig_up <- if (nrow(sig_up) > 0) sig_up else if (nrow(sig_relaxed_up) > 0) sig_relaxed_up else sig_nom_up
  active_sig_down <- if (nrow(sig_down) > 0) sig_down else if (nrow(sig_relaxed_down) > 0) sig_relaxed_down else sig_nom_down
  contrast_sig_sets[[contrast_str]] <- list(
    strict_total = nrow(sig_all),
    strict_up = nrow(sig_up),
    strict_down = nrow(sig_down),
    relaxed_total = nrow(sig_relaxed_all),
    up_genes = unique(na.omit(active_sig_up$gene_name)),
    down_genes = unique(na.omit(active_sig_down$gene_name))
  )

  # Clean, readable display columns for tables (omit broad multi-pathway annotations to preserve table clarity)
  display_columns <- unique(intersect(
    c("gene_name", row_id_col, "protein", "peptide", "description", "log2_foldchange", "p_value", "adj_p_value", "imputation_bias", "candidate_reliability", "imputation_delta"),
    colnames(exp_tbl)
  ))

  # Tiered Candidate Selection (prevents empty tables on ratio-compressed TMT or low-power clinical datasets)
  up_tier_label <- "Tier 1 (Strict: |log2FC| >= 1, q <= 0.05)"
  cand_pool_up <- sig_up
  if (nrow(cand_pool_up) < 3 && nrow(sig_relaxed_up) >= nrow(cand_pool_up) && nrow(sig_relaxed_up) > 0) {
    cand_pool_up <- sig_relaxed_up
    up_tier_label <- "Tier 2 Fallback (Relaxed FDR: log2FC >= 0.38, q <= 0.05)"
  }
  if (nrow(cand_pool_up) < 3 && nrow(sig_nom_up) > 0) {
    cand_pool_up <- sig_nom_up
    up_tier_label <- "Tier 3 Fallback (Nominal: p <= 0.05, log2FC > 0)"
  }
  if (nrow(cand_pool_up) == 0) {
    cand_pool_up <- exp_tbl %>% filter(!is.na(log2_foldchange), log2_foldchange > 0)
    up_tier_label <- "Tier 4 Fallback (Unthresholded Top Positive Fold-Change)"
  }

  down_tier_label <- "Tier 1 (Strict: |log2FC| >= 1, q <= 0.05)"
  cand_pool_down <- sig_down
  if (nrow(cand_pool_down) < 3 && nrow(sig_relaxed_down) >= nrow(cand_pool_down) && nrow(sig_relaxed_down) > 0) {
    cand_pool_down <- sig_relaxed_down
    down_tier_label <- "Tier 2 Fallback (Relaxed FDR: log2FC <= -0.38, q <= 0.05)"
  }
  if (nrow(cand_pool_down) < 3 && nrow(sig_nom_down) > 0) {
    cand_pool_down <- sig_nom_down
    down_tier_label <- "Tier 3 Fallback (Nominal: p <= 0.05, log2FC < 0)"
  }
  if (nrow(cand_pool_down) == 0) {
    cand_pool_down <- exp_tbl %>% filter(!is.na(log2_foldchange), log2_foldchange < 0)
    down_tier_label <- "Tier 4 Fallback (Unthresholded Top Negative Fold-Change)"
  }

  emit_md(sprintf("### Top 10 Upregulated %s (%s)", toupper(analyte_name), up_tier_label))
  top_up <- cand_pool_up %>% arrange(desc(log2_foldchange), adj_p_value, p_value) %>% head(10)
  emit_table(top_up %>% select(any_of(display_columns)) %>% format_stats())

  emit_md(sprintf("### Top 10 Downregulated %s (%s)", toupper(analyte_name), down_tier_label))
  top_down <- cand_pool_down %>% arrange(log2_foldchange, adj_p_value, p_value) %>% head(10)
  emit_table(top_down %>% select(any_of(display_columns)) %>% format_stats())

  # Top robust candidates ranked by volcano pi-score: |log2FC| * -log10(adj_p_value)
  pi_pool <- if (nrow(sig_all) >= 5) sig_all else if (nrow(sig_relaxed_all) >= 5) sig_relaxed_all else exp_tbl %>% filter(!is.na(log2_foldchange), !is.na(p_value))
  emit_md(sprintf("### Top 10 Balanced Candidates (Volcano Pi-Score) for %s", contrast_tag))
  top_pi <- pi_pool %>%
    mutate(pi_score = abs(log2_foldchange) * -log10(pmax(coalesce(adj_p_value, p_value), 1e-10))) %>%
    arrange(desc(pi_score)) %>%
    head(10)
  top_pi_display <- top_pi %>%
    select(any_of(c(display_columns, "pi_score"))) %>%
    format_stats()
  emit_table(top_pi_display)

  # Extract enrichment results across all analyzed categories for this contrast
  enr_files <- list.files("data", pattern = paste0("^table_.*_enrichment_.*", c_clean, ".*[.](tsv|csv)$"), full.names = TRUE, ignore.case = TRUE)
  enr_tbl <- NULL
  if (length(enr_files) > 0) {
    enr_tbl <- dplyr::bind_rows(lapply(enr_files, function(f) {
      tbl <- tryCatch(
        if (grepl("[.]tsv$", f, ignore.case = TRUE)) readr::read_tsv(f, show_col_types = FALSE) else readr::read_csv(f, show_col_types = FALSE),
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
    if (is.null(enr_tbl) || nrow(enr_tbl) == 0 || !"annotation" %in% names(enr_tbl)) {
      enr_tbl <- NULL
    }
  }
  if (is.null(enr_tbl) || nrow(enr_tbl) == 0) {
    enriched_terms <- if (nrow(completed_analyses) > 0) {
      completed_analyses %>%
        filter(comparison == contrast_str, analysis == "enrichment") %>%
        pull(term)
    } else {
      available_terms
    }

    enr_tbl <- dplyr::bind_rows(lapply(enriched_terms, function(t) {
      tryCatch(
        rlang::inject(export_analysis(tp_data, !!rlang::parse_expr(contrast_str), .analysis = "enrichment", .term = t)) %>%
          dplyr::mutate(term = t, .before = 1),
        error = function(e) NULL
      )
    }))
  }

  if (!is.null(enr_tbl) && nrow(enr_tbl) > 0 && "annotation" %in% names(enr_tbl)) {
    emit_md(sprintf("### Multi-Category Enrichment for %s", contrast_tag))
    enr_summary <- enr_tbl %>% group_by(term) %>% summarise(
      terms_count = n(),
      sig_terms = sum(adj_p_value <= 0.05, na.rm = TRUE),
      .groups = "drop"
    )
    emit_table(enr_summary)

    emit_md(sprintf("### Top Significant Pathways for %s", contrast_tag))
    sig_enr <- enr_tbl %>%
      filter(!is.na(adj_p_value), adj_p_value <= 0.05) %>%
      arrange(adj_p_value) %>%
      head(15) %>%
      dplyr::mutate(annotation = resolve_reactome_ids(annotation))

    if ("gene_names" %in% names(sig_enr) && any(!is.na(sig_enr$gene_names))) {
      sig_enr <- sig_enr %>%
        mutate(top_drivers = sapply(strsplit(as.character(gene_names), ",\\s*"), function(x) paste(head(unique(na.omit(trimws(x))), 4), collapse = ", ")))
    } else if ("member_genes" %in% names(sig_enr) && any(!is.na(sig_enr$member_genes))) {
      sig_enr <- sig_enr %>%
        mutate(top_drivers = sapply(strsplit(as.character(member_genes), ",\\s*"), function(x) paste(head(unique(na.omit(trimws(x))), 4), collapse = ", ")))
    } else if ("member_proteins" %in% names(sig_enr)) {
      sig_enr <- sig_enr %>%
        mutate(top_drivers = sapply(strsplit(as.character(member_proteins), ",\\s*"), function(x) paste(head(unique(na.omit(trimws(x))), 4), collapse = ", ")))
    } else if (nrow(sig_enr) > 0) {
      # Derive top driving member genes directly from exp_tbl annotations if available
      sig_enr$top_drivers <- sapply(seq_len(nrow(sig_enr)), function(i) {
        ann <- sig_enr$annotation[i]
        if (is.na(ann) || !nzchar(ann)) return(NA_character_)
        matching_genes <- sig_all %>%
          filter(if_any(any_of(c("biological_process", "cellular_component", "molecular_function", "reactome_pathway", "wiki_pathway", "annotation")), ~ grepl(ann, .x, fixed = TRUE))) %>%
          arrange(desc(abs(log2_foldchange))) %>%
          pull(gene_name)
        if (length(matching_genes) == 0) {
          matching_genes <- exp_tbl %>%
            filter(if_any(any_of(c("biological_process", "cellular_component", "molecular_function", "reactome_pathway", "wiki_pathway", "annotation")), ~ grepl(ann, .x, fixed = TRUE))) %>%
            arrange(adj_p_value, p_value, desc(abs(log2_foldchange))) %>%
            pull(gene_name)
        }
        if (length(matching_genes) > 0) paste(head(unique(na.omit(matching_genes)), 4), collapse = ", ") else NA_character_
      })
    }

    enr_cols <- intersect(c("term", "annotation", "enrichment", "size", "p_value", "adj_p_value", "top_drivers", "gene_names", "member_genes", "member_proteins", "leading_edge_count"), names(sig_enr))
    emit_table(sig_enr %>% select(any_of(enr_cols)) %>% format_stats())
  }
}

# Multi-Contrast Cross-Comparison (if >= 2 contrasts evaluated)
if (length(contrast_names) >= 2 && length(contrast_sig_sets) >= 2) {
  emit_md("## Multi-Contrast Cross-Comparison Summary")
  emit_md(sprintf("Total contrasts evaluated: %d. Summary of shared vs. contrast-specific regulated features:", length(contrast_names)))
  emit_md("")

  all_up_lists <- lapply(contrast_sig_sets, `[[`, "up_genes")
  all_down_lists <- lapply(contrast_sig_sets, `[[`, "down_genes")
  shared_up <- Reduce(intersect, all_up_lists)
  shared_down <- Reduce(intersect, all_down_lists)
  union_up <- unique(unlist(all_up_lists))
  union_down <- unique(unlist(all_down_lists))
  discordant_genes <- intersect(union_up, union_down)

  mc_df <- dplyr::bind_rows(lapply(names(contrast_sig_sets), function(cn) {
    cs <- contrast_sig_sets[[cn]]
    other_cns <- setdiff(names(contrast_sig_sets), cn)
    other_genes <- unique(unlist(lapply(other_cns, function(oc) c(contrast_sig_sets[[oc]]$up_genes, contrast_sig_sets[[oc]]$down_genes))))
    my_genes <- unique(c(cs$up_genes, cs$down_genes))
    tibble(
      contrast = cn,
      strict_sig_total = cs$strict_total,
      strict_up = cs$strict_up,
      strict_down = cs$strict_down,
      relaxed_sig_total = cs$relaxed_total,
      shared_with_other_contrasts = length(intersect(my_genes, other_genes)),
      contrast_unique = length(setdiff(my_genes, other_genes))
    )
  }))
  emit_table(mc_df)
  emit_md(sprintf("- **Pan-Contrast Concordant Upregulated (%d)**: %s", length(shared_up), if (length(shared_up) > 0) paste(head(shared_up, 10), collapse = ", ") else "None"))
  emit_md(sprintf("- **Pan-Contrast Concordant Downregulated (%d)**: %s", length(shared_down), if (length(shared_down) > 0) paste(head(shared_down, 10), collapse = ", ") else "None"))
  emit_md(sprintf("- **Discordantly Regulated Across Contrasts (%d)**: %s", length(discordant_genes), if (length(discordant_genes) > 0) paste(head(discordant_genes, 10), collapse = ", ") else "None"))
  emit_md("")
}

# Write summary markdown directly to disk
writeLines(md_out, "data/observations_summary.md")
cat("Structured markdown summary saved to: data/observations_summary.md\n")

# Checkpoints
cat("\n=== CHECKPOINTS ===\n")
cat("Artifact tidyproteomics_data.rds exists in data/:", file.exists("data/tidyproteomics_data.rds"), "\n")
expr_tables <- list.files("data", pattern = "^table_.*_expression_.*\\.(csv|tsv)$", ignore.case = TRUE)
cat("Expression tables found in data/:", length(expr_tables), "\n")
stopifnot("Expression data extraction failed" = length(expr_tables) > 0)
stopifnot("Observations summary file missing" = file.exists("data/observations_summary.md"))
cat("PHASE_6_EXTRACTION_CHECKPOINT_PASS\n")
```

- **Summary Transfer**: `code/06_observations.R` automatically outputs pre-formatted markdown tables and quantitative statistics to `data/observations_summary.md`. Inspect `data/observations_summary.md` via `read_file(filePath = "data/observations_summary.md")` to assemble `docs/observations.md` in a single clean turn without scraping raw console logs.

---

#### 2. Direct Construction of `docs/observations.md`
Write the file `docs/observations.md` directly, referencing `docs/llm.md` for active model details. Ensure it begins with the standard document header immediately below the title:

```markdown
# Primary Data-Derived Observations

Created: YYYY-MM-DD HH:MM  
Author: PROVIDER | LLM-MODEL  
Agent: TidyProteomicsAgent vX.X.X  
R Package: tidyproteomics vX.X.X  
```

Organize the document strictly into the following structured sections:

1. **Analysis Checkpoint & Dataset Dimensions Summary**:
   - Status (PASS/FAIL) for Target Perturbation (if targeted; or "NOT APPLICABLE - UNTARGETED DISCOVERY SCREEN") and Artifact Verification (`data/tidyproteomics_data.rds`, tables in `data/`, plots in `data/`).
   - Summary of dataset dimensions: total features in dataset (`proteins` or `peptides`), modeled identifiers in contrast (noting any unmodeled features due to all-missing values or condition-exclusive dropouts), total significantly altered ($|\log_2\text{FC}| \ge 1.0$, $q \le 0.05$), count upregulated, count downregulated per contrast.
2. **Target Efficacy / Leading Perturbation Status**:
   - Quantitative breakdown of the primary target (if targeted) or leading master regulator / key functional hub (if untargeted screening): Gene Symbol / Accession, $\log_2\text{FC}$, fold change, $p$-value, $q$-value, imputation risk tag, and percent change.
   - Comparison with experimental expectations stated in `docs/experiment.md`.
3. **Top Significantly Upregulated Proteins**:
   - Structured markdown table: Rank, Identifier (Gene Symbol / Accession), Description, $\log_2\text{FC}$, $q$-value, Imputation Risk (`imputation_bias`: HIGH, MODERATE, LOW), Candidate Reliability (`candidate_reliability`: ROBUST_QUANTITATIVE, DETECTION_LIMITED_ON_OFF, HIGH_UNCERTAINTY), and $\Delta$ (`imputation_delta`). (Directly copy pre-formatted markdown table from `data/observations_summary.md`). Prominently tag candidates like `HBG2` or `SYN1` so detection/missingness-driven shifts are distinguished from continuous shifts.
4. **Top Significantly Downregulated Proteins**:
   - Structured markdown table: Rank, Identifier (Gene Symbol / Accession), Description, $\log_2\text{FC}$, $q$-value, Imputation Risk (`imputation_bias`: HIGH, MODERATE, LOW), Candidate Reliability (`candidate_reliability`: ROBUST_QUANTITATIVE, DETECTION_LIMITED_ON_OFF, HIGH_UNCERTAINTY), and $\Delta$ (`imputation_delta`). (Directly copy pre-formatted markdown table from `data/observations_summary.md`).
5. **Top Significant Pathway Enrichments**:
   - Summary table of significant terms across analyzed annotation categories (Category/Term, Annotation Name, Direction / Enrichment Score, $q$-value, Leading Driver Genes [top 3–5 member gene symbols from `member_genes`, falling back to `member_proteins` if symbols are absent], Leading-Edge Count). (Directly copy pre-formatted markdown table from `data/observations_summary.md`).
   - Primary biological themes identified across contrasts based directly on statistical enrichment and driven by specific leading-edge member genes. Note that in tidyproteomics, Wilcoxon score sign indicates direction relative to background: positive (+) = shifted higher in treatment; negative (-) = shifted lower in treatment.

6. **Primary Empirical Data Summary**:
   - Objective, factual synthesis of data-derived observations directly grounded in the quantitative tables and figures.
   - Detection-rate sensitivity discussion: explicitly evaluate whether top candidates are driven by continuous abundance changes (LOW imputation bias) or limit-of-detection presence/absence shifts (HIGH imputation bias).
   - Pure empirical observation: no premature speculation or external literature synthesis (this is developed systematically in Phases 7, 8, and 9).

---

#### 3. Critical Constraints
- **Absolute Data Grounding**: Every numerical value ($\log_2\text{FC}$, $p$-value, $q$-value, feature count, pathway score) MUST strictly match `data/observations_summary.md` and the exported CSV/TSV tables. Never fabricate or extrapolate numbers.
- **Scientific Precision Formatting (No Exact Zeros)**: Format all statistical significance columns ($p$-value, $q$-value) smaller than $1 \times 10^{-4}$ using scientific notation (e.g., `3.99e-10` rather than `0.0000000` or `0.0e+00`). Tables must never report misleading "exact zero" values.
- **Human-Readable Pathway Resolution**: Resolve bare Reactome accession IDs (e.g., `R-HSA-977606`, `R-HSA-166663`) to human-readable biological pathway names (e.g., `Regulation of Complement cascade`, `Initial triggering of complement`) via `resolve_reactome_ids()`. Never report `"identifier unresolved in export"`.
- **Sanitized Delimiters & Missing Identifier Fallback**: Strip redundant delimiter characters (avoid `;;` or trailing semicolons) and provide sensible fallbacks for unmapped gene symbols (e.g., fallback to the first word of the protein description or canonical accession rather than `NA`).
- **Pure Empirical Scope**: Do not synthesize external literature in this phase. Document what the mass spectrometry data directly demonstrates.

---

#### 4. Phase Completion Gate
- [ ] **Checkpoint Gate**:
  1. `code/06_observations.R` executed with status code 0 and output logged to `logs/06_observations/console.log`.
  2. `logs/06_observations/console.log` ends with `PHASE_6_EXTRACTION_CHECKPOINT_PASS`.
  3. `data/observations_summary.md` exists on disk with non-zero size containing formatted tables.
  4. `docs/observations.md` exists on disk with non-zero size and conforms to the structure above.
- [ ] **Complete Phase**:
  - Invoke `complete_phase(phaseName = "06_OBSERVATIONS", summary = "Primary data-derived observations extracted and compiled in docs/observations.md with verified biomarker metrics, markdown tables, and pathway enrichment summaries.")`
