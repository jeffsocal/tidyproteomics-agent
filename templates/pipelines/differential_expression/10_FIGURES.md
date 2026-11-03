---
tools: [tpa_load, tpa_inspect, tpa_summary, tpa_query_expression, tpa_query_enrichment]
---

### Phase 10: Generation of Hypothesis-Driven Discussion Figures & Statistical Digest

In this focused phase, you will author and execute an R analysis script (`code/10_figures.R`) to extract specific discussion metrics, generate four publication-grade discussion figures, and compile a structured JSON statistical digest (`data/manuscript_digest.json`).

Target execution budget: **2–3 turns max**.

> 💡 **HYBRID MCP & DETERMINISTIC SCRIPT EXECUTION WORKFLOW**:
> While `code/10_figures.R` serves as the authoritative, reproducible execution script for generating the four discussion figures and `data/manuscript_digest.json`, MCP tools (`tpa_inspect`, `tpa_summary`, `tpa_query_expression`, `tpa_load`) are enabled for pre-flight schema confirmation and diagnostic fallback. Proceed with a tight turn budget:
> - **Turn 1 (Authoring & Optional Schema Check)**: If needed, confirm active analyses or overview state via `tpa_inspect(what = "analyses")` or `tpa_inspect(what = "overview")`. Author `code/10_figures.R` in a single pass using `write_file` following the canonical script template below.
> - **Turn 2 (Lint & Execute)**: Execute via `execute_command("if [ -f tools/lint_tidyproteomics.R ]; then Rscript tools/lint_tidyproteomics.R code/10_figures.R && Rscript code/10_figures.R; else Rscript code/10_figures.R; fi")`. Upon successful execution, verify outputs and invoke `complete_phase`.
> - **Turn 3 (Diagnostic Fallback — Only if Script Errors)**: If script execution fails, do NOT blindly guess or loop with shell greps. Call `tpa_inspect` or `tpa_query_expression` to diagnose the exact column schema or contrast mismatch, patch `code/10_figures.R`, and re-run.

---

#### Objectives & Tasks

1. **Author and execute `code/10_figures.R`**:
   - Execute via `Rscript code/10_figures.R` (output is automatically captured to `logs/10_figures/console.log` by the harness).
   - Ensure the script runs non-interactively, checks for data existence, and exits with code 0.
   - **Load Expression & Imputation Data Stably**:
     - Locate the expression table dynamically via `expr_files <- list.files("data", pattern = "^table_.*_expression_.*[.](tsv|csv)$", full.names = TRUE)`.
     - Load `tp_data <- readRDS("data/tidyproteomics_data.rds")`.
     - Access `candidate_reliability` (`ROBUST_QUANTITATIVE`, `DETECTION_LIMITED_ON_OFF`, `HIGH_UNCERTAINTY`), `imputation_bias` (`HIGH`, `MODERATE`, `LOW`), and `imputation_delta` directly from the Phase 6-persisted expression table if present.
   - **TidyProteomics Discussion Plotting Rules**:
     - Discussion figures use canonical `tidyproteomics` plotting functions with `tag`, `destination = "png"`, and `path = "data"`.
     - ⚠️ **CRITICAL CONTRAST SYNTAX**: Always pass contrast as a literal string (e.g. `"p97_kd/ctl"`), NOT as an unevaluated R variable name, so `tidyproteomics_quo` evaluates cleanly.
     - Direct S3 list slot access (`tp_data$quantitative`, etc.) remains strictly forbidden.
   - **Locate Volcano & QC Plots**: Check `data/` for the publication volcano plot (`data/plot_proteins_volcano_<contrast>.png`), PCA plot (`data/plot_pca.png`), and heatmap (`data/plot_heatmap.png`) to record their relative paths in `manuscript_digest.json`.

2. **Generate the 4 Multi-Panel Publication-Grade Discussion Figures in `data/`**:
   - **Biological Module Heatmap**:
     - Subset `tp_data` to the signature/candidate/top DE proteins (`hm_genes`) first so individual gene names are clearly legible, then call:
     - Native Call: `tp_data |> subset(gene_name %in% hm_genes) |> plot_heatmap(row_names = "gene_name", tag = "module_<name>", destination = "png", path = "data")`
     - File Output: `data/plot_proteins_<quant>_heatmap_module_<name>.png` (copy or alias to `data/plot_discussion_module_<name>.png`).
   - **Biological Signatures (Program Dichotomy)**:
     - Native Call: `tp_data |> plot_signatures("<contrast>", signatures = list("<Signature A>" = c(...), "<Signature B>" = c(...)), labels_column = "gene_name", tag = "dichotomy_<name>", destination = "png", path = "data")`
     - File Output: `data/plot_proteins_<quant>_signatures_<contrast>_dichotomy_<name>.png` (copy or alias to `data/plot_discussion_dichotomy_<name>.png`).
   - **Candidate Targets / Effect Sizes**:
     - Native Call: `tp_data |> plot_candidates("<contrast>", candidates = candidate_genes, status = status_map, labels_column = "gene_name", tag = "literature", destination = "png", path = "data")`
     - File Output: `data/plot_proteins_<quant>_candidates_<contrast>_literature.png` (copy or alias to `data/plot_discussion_literature_forest.png`).
   - **Imputation Diagnostic / Individual Gene Expression Plot**:
     - Native Call: `tp_data |> plot_expression("<contrast>", imputed_only = TRUE, labels_column = "gene_name", tag = "imputation_diagnostic", destination = "png", path = "data", top_n = 10)`
     - File Output: `data/plot_proteins_<quant>_expression_<contrast>_imputation_diagnostic.png` (copy or alias to `data/plot_discussion_imputation_diagnostic.png`).

3. **Canonical Script Template for `code/10_figures.R`**:
   ```r
   #!/usr/bin/env Rscript
   suppressPackageStartupMessages({
     library(tidyproteomics)
     library(jsonlite)
     library(dplyr)
   })

   # 1. Load Data Objects
   stopifnot(file.exists("data/tidyproteomics_data.rds"))
   tp_data <- readRDS("data/tidyproteomics_data.rds")

   # Extract contrast and analyte identifier from data or filename
   analyses <- get_analyses(tp_data)
   all_contrasts <- if (nrow(analyses) > 0) unique(analyses$comparison) else "p97_kd/ctl"
   contrast_str <- all_contrasts[1]
   c_clean <- gsub("[^A-Za-z0-9]", ".*", contrast_str)
   analyte_name <- if (!is.null(tp_data[["analyte"]])) tp_data[["analyte"]] else "proteins"
   id_col <- if (!is.null(tp_data[["identifier"]])) tp_data[["identifier"]][1] else if (identical(analyte_name, "peptides")) "peptide" else "protein"

   expr_files <- list.files("data", pattern = "^table_.*_expression_.*[.](tsv|csv)$", full.names = TRUE)
   # Exclude quantitative extract abundance matrices (which lack log2_foldchange and test statistics)
   expr_files <- expr_files[!grepl("_extract", expr_files)]
   stopifnot(length(expr_files) > 0)
   read_de_table <- function(f) {
     if (grepl("\\.csv$", f)) read.csv(f, check.names = FALSE) else read.delim(f, check.names = FALSE)
   }
   matched_files <- expr_files[grepl(c_clean, basename(expr_files), ignore.case = TRUE)]
   cand_files <- c(matched_files, setdiff(expr_files, matched_files))
   # Prioritize CSV tables as they retain all test statistics
   csv_files <- cand_files[grepl("\\.csv$", cand_files)]
   cand_files <- c(csv_files, setdiff(cand_files, csv_files))
   de_file <- cand_files[1]
   for (f in cand_files) {
     hdr <- names(read_de_table(f)[0, , drop = FALSE])
     if (any(c("log2_foldchange", "log2FC", "logFC") %in% hdr)) { de_file <- f; break }
   }
   expr <- read_de_table(de_file)
   row_id_col <- if (id_col %in% names(expr)) id_col else if ("protein" %in% names(expr)) "protein" else if ("peptide" %in% names(expr)) "peptide" else names(expr)[1]

   # Defensive Column Resolution for Statistical Columns
   resolve_stat_col <- function(df, candidates, default = candidates[1]) {
     for (c in candidates) {
       if (c %in% names(df)) return(c)
     }
     default
   }
   adj_col <- resolve_stat_col(expr, c("adj_p_value", "q_value", "q-value", "adj.P.Val", "p_value"))
   p_col <- resolve_stat_col(expr, c("p_value", "p-value", "P.Value"), default = "p_value")
   fc_col <- resolve_stat_col(expr, c("log2_foldchange", "log2FC", "logFC"), default = "log2_foldchange")

   # Ensure standard column aliases are bound in expr
   if (!"adj_p_value" %in% names(expr) && adj_col %in% names(expr)) expr$adj_p_value <- expr[[adj_col]]
   if (!"p_value" %in% names(expr) && p_col %in% names(expr)) expr$p_value <- expr[[p_col]]
   if (!"log2_foldchange" %in% names(expr) && fc_col %in% names(expr)) expr$log2_foldchange <- expr[[fc_col]]

   # 2. Load Actionable Synthesis (from Phase 8/9) & Derive Biological Program Signatures with Tiered Fallback
   valid <- !is.na(expr$gene_name) & !is.na(expr$adj_p_value) & !is.na(expr$log2_foldchange)
   strict_up <- expr[valid & expr$adj_p_value <= 0.05 & expr$log2_foldchange >= 1, , drop = FALSE]
   strict_down <- expr[valid & expr$adj_p_value <= 0.05 & expr$log2_foldchange <= -1, , drop = FALSE]
   relaxed_up <- expr[valid & expr$adj_p_value <= 0.05 & expr$log2_foldchange >= 0.38, , drop = FALSE]
   relaxed_down <- expr[valid & expr$adj_p_value <= 0.05 & expr$log2_foldchange <= -0.38, , drop = FALSE]
   nom_valid <- !is.na(expr$gene_name) & !is.na(expr$p_value) & !is.na(expr$log2_foldchange)
   nom_up <- expr[nom_valid & expr$p_value <= 0.05 & expr$log2_foldchange > 0, , drop = FALSE]
   nom_down <- expr[nom_valid & expr$p_value <= 0.05 & expr$log2_foldchange < 0, , drop = FALSE]

   candidate_selection_tier <- "Tier 1 (Strict: |log2FC| >= 1, q <= 0.05)"
   up <- strict_up
   down <- strict_down
   if (nrow(up) < 3) {
     if (nrow(relaxed_up) > 0) {
       up <- relaxed_up
       candidate_selection_tier <- "Tier 2 Fallback (Relaxed FDR: |log2FC| >= 0.38, q <= 0.05)"
     } else if (nrow(nom_up) > 0) {
       up <- nom_up
       candidate_selection_tier <- "Tier 3 Fallback (Nominal: p <= 0.05)"
     } else {
       up <- expr[!is.na(expr$gene_name) & !is.na(expr$log2_foldchange) & expr$log2_foldchange > 0, , drop = FALSE]
       candidate_selection_tier <- "Tier 4 Fallback (Unthresholded Directional Rank)"
     }
   }
   if (nrow(down) < 3) {
     if (nrow(relaxed_down) > 0) {
       down <- relaxed_down
       if (grepl("^Tier 1", candidate_selection_tier)) candidate_selection_tier <- "Tier 2 Fallback (Relaxed FDR: |log2FC| >= 0.38, q <= 0.05)"
     } else if (nrow(nom_down) > 0) {
       down <- nom_down
       if (grepl("^Tier [12]", candidate_selection_tier)) candidate_selection_tier <- "Tier 3 Fallback (Nominal: p <= 0.05)"
     } else {
       down <- expr[!is.na(expr$gene_name) & !is.na(expr$log2_foldchange) & expr$log2_foldchange < 0, , drop = FALSE]
       candidate_selection_tier <- "Tier 4 Fallback (Unthresholded Directional Rank)"
     }
   }
   up <- up[order(-up$log2_foldchange, up$adj_p_value, up$p_value), , drop = FALSE]
   down <- down[order(down$log2_foldchange, down$adj_p_value, down$p_value), , drop = FALSE]

   act_syn <- if (file.exists("data/actionable_synthesis.json")) {
     tryCatch(fromJSON("data/actionable_synthesis.json", simplifyVector = FALSE), error = function(e) NULL)
   } else NULL

   # Biological Program Signatures:
   # Priority 1: Validated functional programs from data/actionable_synthesis.json
   sig_list <- list()
   if (!is.null(act_syn) && !is.null(act_syn$signatures) && is.list(act_syn$signatures)) {
     for (s_nm in names(act_syn$signatures)) {
       g_cand <- unique(as.character(unlist(act_syn$signatures[[s_nm]])))
       g_match <- intersect(g_cand, unique(na.omit(c(expr$gene_name, expr[[row_id_col]]))))
       if (length(g_match) >= 2) {
         sig_list[[ substr(s_nm, 1, 48) ]] <- head(g_match, 8)
       }
     }
   }

   # Priority 2: Formal pathway enrichment tables + Phase 7 de novo functional modules (data/de_novo_modules.tsv)
   pathway_files <- list.files("data", pattern = "^(table_.*_enrichment_.*|enrichment_.*|de_novo_modules)[.](tsv|csv)$", full.names = TRUE)
   parsed_pathways <- list()
   enr_all <- list()
   for (pf in pathway_files) {
     ptab <- tryCatch(if (grepl("\\.csv$", pf)) read.csv(pf, check.names = FALSE) else read.delim(pf, check.names = FALSE), error = function(e) NULL)
     if (!is.null(ptab) && nrow(ptab) > 0) {
       if (!"enrichment" %in% names(ptab) && "median_log2fc" %in% names(ptab)) {
         ptab$enrichment <- as.numeric(ptab$median_log2fc)
       }
       parsed_pathways[[pf]] <- ptab
       if (all(c("annotation", "adj_p_value", "enrichment") %in% names(ptab))) {
         enr_all[[length(enr_all) + 1L]] <- ptab
       }
     }
   }

   if (length(sig_list) < 2 && length(enr_all) > 0) {
     enr_combined <- dplyr::bind_rows(enr_all)
     sig_enr <- enr_combined %>% filter(!is.na(adj_p_value), adj_p_value <= 0.05)
     if (nrow(sig_enr) == 0) sig_enr <- enr_combined %>% filter(!is.na(p_value), p_value <= 0.05)
     up_pathways <- sig_enr %>% filter(enrichment > 0) %>% arrange(adj_p_value)
     down_pathways <- sig_enr %>% filter(enrichment < 0) %>% arrange(adj_p_value)

     get_program_members <- function(ann, pathways_df, target_dir) {
       for (col_cand in c("gene_names", "member_genes", "top_drivers")) {
         if (col_cand %in% names(pathways_df)) {
           row <- pathways_df %>% filter(annotation == ann)
           if (nrow(row) > 0 && !is.na(row[[col_cand]][1]) && nzchar(as.character(row[[col_cand]][1]))) {
             m <- trimws(unlist(strsplit(as.character(row[[col_cand]][1]), ",")))
             m_sub <- expr %>% filter(gene_name %in% m)
             if (target_dir == "UP") m_sub <- m_sub %>% filter(log2_foldchange > 0) else m_sub <- m_sub %>% filter(log2_foldchange < 0)
             m_sub <- m_sub %>% arrange(adj_p_value, desc(abs(log2_foldchange)))
             if (nrow(m_sub) >= 2) return(head(unique(na.omit(m_sub$gene_name)), 8))
           }
         }
       }
       m_expr <- expr %>%
         filter(if_any(any_of(c("biological_process", "cellular_component", "molecular_function", "reactome_pathway", "wiki_pathway", "description")), ~ grepl(ann, .x, fixed = TRUE)))
       if (target_dir == "UP") m_expr <- m_expr %>% filter(log2_foldchange > 0) else m_expr <- m_expr %>% filter(log2_foldchange < 0)
       m_expr <- m_expr %>% arrange(adj_p_value, desc(abs(log2_foldchange)))
       head(unique(na.omit(m_expr$gene_name)), 8)
     }

     if (nrow(up_pathways) > 0) {
       best_up_ann <- up_pathways$annotation[1]
       m_up <- get_program_members(best_up_ann, up_pathways, "UP")
       if (length(m_up) >= 2) sig_list[[paste0("Induced: ", substr(best_up_ann, 1, 35))]] <- m_up
     }
     if (nrow(down_pathways) > 0) {
       best_down_ann <- down_pathways$annotation[1]
       m_down <- get_program_members(best_down_ann, down_pathways, "DOWN")
       if (length(m_down) >= 2) sig_list[[paste0("Repressed: ", substr(best_down_ann, 1, 35))]] <- m_down
     }
   }

   # Priority 3: Fallback with description-derived functional labels if needed
   if (length(sig_list) == 0) {
     prog_a <- head(unique(na.omit(up$gene_name)), 8)
     prog_b <- head(unique(na.omit(down$gene_name)), 8)
     if (!length(prog_b)) prog_b <- head(expr$gene_name[!is.na(expr$gene_name)], 5)
     if (length(prog_a) > 0) sig_list[["Induced Empirical Signature"]] <- prog_a
     if (length(prog_b) > 0) sig_list[["Repressed Empirical Signature"]] <- prog_b
   }

   # 3. Generate Discussion Figures
   # Heatmap (subset to module/signature and top DE genes so gene_name row labels are clearly legible)
   hm_genes <- unique(na.omit(c(unlist(sig_list), head(up$gene_name, 10), head(down$gene_name, 10))))
   hm_genes <- head(hm_genes[nzchar(hm_genes)], 30)
   if (length(hm_genes) >= 2) {
     tp_data |> subset(gene_name %in% hm_genes) |> plot_heatmap(row_names = "gene_name", tag = "module_discussion", destination = "png", path = "data")
   } else {
     tp_data |> plot_heatmap(row_names = FALSE, tag = "module_discussion", destination = "png", path = "data")
   }

   # Signatures Dichotomy
   plot_signatures(data = tp_data, contrast_str,
     signatures = sig_list,
     labels_column = "gene_name", tag = "dichotomy_discussion", destination = "png", path = "data")

   # Candidate Targets (Role-Classified from actionable_synthesis.json or Literature DB)
   has_lit <- file.exists("docs/literature_candidates.md") && file.info("docs/literature_candidates.md")$size > 100
   lit_candidates <- character(0)
   if (has_lit) {
     lit_lines <- readLines("docs/literature_candidates.md")
     pipe_lines <- lit_lines[grepl("\\|", lit_lines)]
     cells <- unlist(lapply(pipe_lines, function(l) strsplit(l, "|", fixed = TRUE)[[1]]))
     cells <- trimws(cells)
     cands_flat <- unique(cells[grepl("^[A-Za-z0-9_.-]+$", cells)])
     lit_candidates <- intersect(cands_flat, expr$gene_name)
   }

   act_cands <- character(0)
   act_roles <- character(0)
   if (!is.null(act_syn) && !is.null(act_syn$candidates) && is.list(act_syn$candidates)) {
     for (c_item in act_syn$candidates) {
       g_nm <- if (!is.null(c_item$gene)) as.character(c_item$gene)[1] else NA_character_
       r_nm <- if (!is.null(c_item$role) && nzchar(as.character(c_item$role)[1])) as.character(c_item$role)[1] else "Prioritized Candidate"
       if (!is.na(g_nm) && g_nm %in% c(expr$gene_name, expr[[row_id_col]])) {
         act_cands <- c(act_cands, g_nm)
         act_roles[g_nm] <- r_nm
       }
     }
   }

   if (length(act_cands) >= 2) {
     candidate_genes <- head(unique(act_cands), 8)
     status_map <- act_roles[candidate_genes]
     tag_used <- if (has_lit && length(lit_candidates) >= 2) "literature" else "candidates"
     plot_candidates(data = tp_data, contrast_str, candidates = candidate_genes, status = status_map,
       labels_column = "gene_name", tag = tag_used, destination = "png", path = "data")
     forest_target <- if (tag_used == "literature") "plot_discussion_literature_forest.png" else "plot_discussion_candidates.png"
   } else if (length(lit_candidates) >= 2) {
     candidate_genes <- head(lit_candidates, 8)
     status_map <- setNames(ifelse(candidate_genes %in% up$gene_name, "Upregulated", 
                            ifelse(candidate_genes %in% down$gene_name, "Downregulated", "Observed")), candidate_genes)
     plot_candidates(data = tp_data, contrast_str, candidates = candidate_genes, status = status_map,
       labels_column = "gene_name", tag = "literature", destination = "png", path = "data")
     forest_target <- "plot_discussion_literature_forest.png"
   } else {
     candidate_genes <- head(unique(na.omit(c(head(up$gene_name, 3), head(down$gene_name, 3)))), 6)
     status_map <- setNames(ifelse(candidate_genes %in% up$gene_name, "Induced Biomarker", "Repressed Biomarker"), candidate_genes)
     plot_candidates(data = tp_data, contrast_str, candidates = candidate_genes, status = status_map,
       labels_column = "gene_name", tag = "candidates", destination = "png", path = "data")
     forest_target <- "plot_discussion_candidates.png"
   }


   # Imputation Diagnostic (using native plot_expression on imputed features)
   tp_data |> plot_expression(contrast_str, imputed_only = TRUE, labels_column = "gene_name",
     tag = "imputation_diagnostic", destination = "png", path = "data", top_n = 10)

   # 4. Standardize Discussion Figure Paths
   find_plot <- function(pattern) {
     f <- list.files("data", pattern = pattern, full.names = TRUE, ignore.case = TRUE)
     f <- f[file.info(f)$size > 0]
     if (length(f)) f[which.max(file.info(f)$mtime)] else NA_character_
   }
   plot_specs <- list(
     module = c("module_.*[.]png$", "plot_discussion_module.png"),
     dichotomy = c("(dichotomy|signatures|programs).*[.]png$", "plot_discussion_dichotomy.png"),
     forest = c("(candidates|forest).*[.]png$", if (exists("forest_target")) forest_target else "plot_discussion_candidates.png"),
     imputation = c("(imputation_diagnostic|expression.*imputation).*[.]png$", "plot_discussion_imputation_diagnostic.png")
   )
   discussion_figures <- list()
   for (nm in names(plot_specs)) {
     src <- find_plot(plot_specs[[nm]][1])
     if (!is.na(src)) {
       dst <- file.path("data", plot_specs[[nm]][2])
       if (normalizePath(src, mustWork = FALSE) != normalizePath(dst, mustWork = FALSE)) {
         file.copy(src, dst, overwrite = TRUE)
         file.remove(src)
       }
       discussion_figures[[nm]] <- dst
     }
   }

   # 5. Extract Candidate Records
   format_candidate <- function(r) {
     rel <- if ("candidate_reliability" %in% names(r) && !is.na(r$candidate_reliability)) as.character(r$candidate_reliability) else NA_character_
     bias <- if ("imputation_bias" %in% names(r) && !is.na(r$imputation_bias)) as.character(r$imputation_bias) else NA_character_
     risk <- if (!is.na(rel) && nzchar(rel)) {
       paste(rel, if (!is.na(bias) && nzchar(bias)) paste0("; bias ", bias) else "")
     } else "Not reported in expression table"
     list(
       gene = as.character(r$gene_name),
       accession = as.character(r[[row_id_col]]),
       log2fc = unname(as.numeric(r$log2_foldchange)),
       p_value = format(as.numeric(r$p_value), scientific = TRUE, digits = 3),
       q_value = format(as.numeric(r$adj_p_value), scientific = TRUE, digits = 3),
       imputation_risk = risk,
       candidate_reliability = if (is.na(rel)) NULL else rel,
       imputation_bias = if (is.na(bias)) NULL else bias,
       `function` = if ("description" %in% names(r) && !is.na(r$description)) as.character(r$description) else NA_character_
     )
   }

   # 6. Extract Top Pathways & De Novo Functional Modules (reusing parsed_pathways)
   resolve_reactome_ids <- function(ids) {
     if (length(ids) == 0) return(character(0))
     resolved <- as.character(ids)
     reactome_idx <- which(grepl("^R-[A-Z]{3}-[0-9]+", resolved))
     if (length(reactome_idx) == 0) return(resolved)
     tsv_paths <- c("tools/reactome_pathways.tsv", "data/reactome_pathways.tsv", "extension/templates/shared/tools/reactome_pathways.tsv")
     for (tp in tsv_paths) {
       if (file.exists(tp)) {
         tryCatch({
           df <- read.delim(tp, header = FALSE, stringsAsFactors = FALSE, sep = "\t")
           if (ncol(df) >= 2) {
             m <- setNames(df[[2]], df[[1]])
             for (i in reactome_idx) if (!is.na(m[resolved[i]]) && nzchar(m[resolved[i]])) resolved[i] <- unname(m[resolved[i]])
           }
         }, error = function(e) NULL)
         break
       }
     }
     resolved
   }
   pathways <- list()
   for (f in names(parsed_pathways)) {
     tab <- parsed_pathways[[f]]
     if (is.null(tab) || !any(c("adj_p_value", "p_value") %in% names(tab))) next
     sig_col <- if ("adj_p_value" %in% names(tab)) "adj_p_value" else "p_value"
     term_col <- if ("annotation" %in% names(tab)) "annotation" else if ("term" %in% names(tab)) "term" else names(tab)[1]
     score_col <- if ("enrichment" %in% names(tab)) "enrichment" else if ("enrichment_score" %in% names(tab)) "enrichment_score" else if ("median_log2fc" %in% names(tab)) "median_log2fc" else NA_character_
     domain <- if (grepl("de_novo_modules", basename(f))) "de_novo_module" else sub("^[a-z_]*enrichment_", "", sub("[.](tsv|csv)$", "", basename(f)))
     tab_sig <- tab[!is.na(tab[[sig_col]]) & tab[[sig_col]] <= 0.05, , drop = FALSE]
     if (!nrow(tab_sig) && "p_value" %in% names(tab)) {
       tab_sig <- tab[!is.na(tab$p_value) & tab$p_value <= 0.05, , drop = FALSE]
     }
     if (!nrow(tab_sig)) next
     tab_sig <- tab_sig[order(tab_sig[[sig_col]]), , drop = FALSE]
     tab_sig[[term_col]] <- resolve_reactome_ids(tab_sig[[term_col]])
     for (i in seq_len(min(5, nrow(tab_sig)))) {
       score_val <- if (!is.na(score_col) && score_col %in% names(tab_sig)) as.numeric(tab_sig[[score_col]][i]) else 0
       dir_val <- if ("direction" %in% names(tab_sig) && !is.na(tab_sig$direction[i]) && nzchar(as.character(tab_sig$direction[i]))) {
         toupper(as.character(tab_sig$direction[i]))
       } else if (score_val >= 0) "UP" else "DOWN"
       drv <- if ("top_drivers" %in% names(tab_sig) && !is.na(tab_sig$top_drivers[i])) {
         trimws(unlist(strsplit(as.character(tab_sig$top_drivers[i]), ",")))
       } else if ("gene_names" %in% names(tab_sig) && !is.na(tab_sig$gene_names[i])) {
         head(trimws(unlist(strsplit(as.character(tab_sig$gene_names[i]), ","))), 5)
       } else character()
       pathways[[length(pathways) + 1L]] <- list(
         domain = domain, term = as.character(tab_sig[[term_col]][i]),
         direction = dir_val,
         q_value = format(tab_sig[[sig_col]][i], scientific = TRUE, digits = 3),
         enrichment_score = score_val, driver_proteins = drv
       )
     }
   }

   # 7. Compile Digest
   all_png <- list.files("data", pattern = "[.]png$", full.names = TRUE)
   existing_path <- function(pattern, exclude = NULL) {
     x <- all_png[grepl(pattern, basename(all_png), ignore.case = TRUE)]
     if (!is.null(exclude)) x <- x[!grepl(exclude, basename(x), ignore.case = TRUE)]
     if (length(x)) x[1] else NA_character_
   }
   # Contrast-Specific Resolver: guarantees primary contrast figures are prioritized
   contrast_path <- function(pattern, c_str, exclude = NULL) {
     c_clean <- gsub("[^A-Za-z0-9]", "[-_]", c_str)
     patt <- paste0(pattern, ".*", c_clean)
     x <- all_png[grepl(patt, basename(all_png), ignore.case = TRUE)]
     if (!is.null(exclude)) x <- x[!grepl(exclude, basename(x), ignore.case = TRUE)]
     if (length(x)) return(x[1])
     existing_path(pattern, exclude)
   }
   total_quant <- get_unique_variables(tp_data, id_col, format = "vector")
   qn <- get_quant_names(tp_data)
   active_sel <- if (is.data.frame(qn) && "selected" %in% names(qn)) qn$quant_name[qn$selected] else character(0)
   active_assay <- if (length(active_sel) > 0) active_sel[1] else tail(get_quant_names(tp_data, format = "vector"), 1)
   ops_txt <- paste(capture.output(operations(tp_data), type = "message"), collapse = " ")
   imputation_status <- if (grepl("impute", ops_txt, ignore.case = TRUE)) "imputed" else "unimputed"
   imputation_method <- if (grepl("randomforest", ops_txt, ignore.case = TRUE)) {
     "impute.randomforest (method = 'matrix', group_by_sample = TRUE)"
   } else if (grepl("by 'column'", ops_txt, ignore.case = TRUE)) {
     "base::min (method = 'column')"
   } else if (grepl("by 'row'", ops_txt, ignore.case = TRUE)) {
     "base::min (method = 'row', group_by_sample = TRUE)"
   } else if (imputation_status == "imputed") {
     "imputed (custom/upstream)"
   } else {
     "none (unimputed)"
   }

   # Automated Accounting for Unmodeled Features
   unmodeled_prots <- setdiff(total_quant, expr[[row_id_col]])
   quant_col <- paste0("abundance_", active_assay)
   df_long <- if (length(unmodeled_prots) > 0) as.data.frame(tp_data, shape = "long") else data.frame()
   long_unmod <- if (nrow(df_long) > 0 && id_col %in% names(df_long)) df_long[df_long[[id_col]] %in% unmodeled_prots, ] else data.frame()

   zero_quant <- 0
   condition_dropout <- 0
   dropout_detail <- list()

   if (nrow(long_unmod) > 0 && quant_col %in% names(long_unmod)) {
     obs_per_prot <- tapply(!is.na(long_unmod[[quant_col]]), long_unmod[[id_col]], sum)
     zero_quant <- sum(obs_per_prot == 0)
     condition_dropout <- sum(obs_per_prot > 0)

     if (condition_dropout > 0 && "sample" %in% names(long_unmod)) {
       sub_dropout <- long_unmod[long_unmod[[id_col]] %in% names(which(obs_per_prot > 0)), ]
       contrast_parts <- trimws(unlist(strsplit(contrast_str, "/")))
       sample_groups <- unique(sub_dropout$sample)
       if (length(contrast_parts) == 2 && all(contrast_parts %in% unique(df_long$sample))) {
         g1 <- contrast_parts[1]
         g2 <- contrast_parts[2]
         prots_d <- unique(sub_dropout[[id_col]])
         n_g1 <- vapply(prots_d, function(p) sum(!is.na(sub_dropout[[quant_col]][sub_dropout[[id_col]] == p & sub_dropout$sample == g1])), integer(1))
         n_g2 <- vapply(prots_d, function(p) sum(!is.na(sub_dropout[[quant_col]][sub_dropout[[id_col]] == p & sub_dropout$sample == g2])), integer(1))
         dropout_detail[[paste0(g1, "_exclusive")]] <- sum(n_g1 > 0 & n_g2 == 0)
         dropout_detail[[paste0(g2, "_exclusive")]] <- sum(n_g2 > 0 & n_g1 == 0)
         absent_both <- sum(n_g1 == 0 & n_g2 == 0)
         if (absent_both > 0) dropout_detail[["absent_in_both_contrast_groups"]] <- absent_both
         insuff_reps <- sum(n_g1 > 0 & n_g2 > 0)
         if (insuff_reps > 0) dropout_detail[["insufficient_replicates_in_contrast"]] <- insuff_reps
       } else {
         by_cond <- lapply(sample_groups, function(grp) {
           sub_g <- sub_dropout[sub_dropout$sample == grp, ]
           tapply(!is.na(sub_g[[quant_col]]), sub_g[[id_col]], sum)
         })
         names(by_cond) <- sample_groups
         for (grp in sample_groups) {
           other_grps <- setdiff(sample_groups, grp)
           grp_detected <- by_cond[[grp]] > 0
           others_missing <- if (length(other_grps) > 0) {
             Reduce(`&`, lapply(other_grps, function(og) by_cond[[og]] == 0))
           } else rep(TRUE, length(grp_detected))
           dropout_detail[[paste0(grp, "_exclusive")]] <- sum(grp_detected & others_missing)
         }
       }
     }
   }

   feature_retention <- list(
     total_quantified = length(total_quant),
     modeled_in_expression = nrow(expr),
     unmodeled_total = length(unmodeled_prots),
     unmodeled_zero_quant = zero_quant,
     unmodeled_condition_exclusive = condition_dropout,
     unmodeled_condition_exclusive_breakdown = dropout_detail
   )

   # Multi-Contrast Summary across all evaluated contrasts
   contrasts_summary <- lapply(all_contrasts, function(cs) {
     cs_clean <- gsub("[^A-Za-z0-9]", ".*", cs)
     cs_files <- expr_files[grepl(cs_clean, basename(expr_files), ignore.case = TRUE)]
     cs_df <- if (length(cs_files) > 0) tryCatch(read_de_table(cs_files[1]), error = function(e) NULL) else NULL
     if (is.null(cs_df) || !any(c("log2_foldchange", "log2FC", "logFC") %in% names(cs_df))) {
       cs_df <- tryCatch(rlang::inject(export_analysis(tp_data, !!rlang::parse_expr(cs), .analysis = "expression")), error = function(e) NULL)
     }
     if (!is.null(cs_df) && any(c("log2_foldchange", "log2FC", "logFC") %in% names(cs_df))) {
       cs_adj_col <- resolve_stat_col(cs_df, c("adj_p_value", "q_value", "q-value", "adj.P.Val", "p_value"))
       cs_fc_col <- resolve_stat_col(cs_df, c("log2_foldchange", "log2FC", "logFC"))
       cs_adj <- if (!is.null(cs_adj_col) && cs_adj_col %in% names(cs_df)) cs_df[[cs_adj_col]] else rep(NA_real_, nrow(cs_df))
       cs_fc <- cs_df[[cs_fc_col]]
       v <- !is.na(cs_adj) & !is.na(cs_fc)
       list(
         contrast = cs,
         modeled_rows = nrow(cs_df),
         strict_significant = sum(v & cs_adj <= 0.05 & abs(cs_fc) >= 1),
         strict_up = sum(v & cs_adj <= 0.05 & cs_fc >= 1),
         strict_down = sum(v & cs_adj <= 0.05 & cs_fc <= -1),
         relaxed_significant = sum(v & cs_adj <= 0.05 & abs(cs_fc) >= 0.38)
       )
     } else {
       list(contrast = cs)
     }
   })

   digest <- list(
     study_title = paste0("Differential Proteomics Analysis: ", paste(all_contrasts, collapse = "; ")),
     contrast = contrast_str,
     contrasts_evaluated = contrasts_summary,
     analyte = analyte_name,
     identifier_column = id_col,
     total_quantified = length(total_quant),
     expression_table_rows = nrow(expr),
     feature_retention = feature_retention,
     active_assay = if (length(active_assay)) active_assay else "normalized",
     imputation_status = imputation_status,
     imputation_method = imputation_method,
     literature_status = if (exists("has_lit") && isTRUE(has_lit) && length(lit_candidates) >= 2) "ACTIVE" else "SKIPPED",
     actionable_synthesis = act_syn,

     de_counts = list(
       total_significant = nrow(strict_up) + nrow(strict_down),
       upregulated = nrow(strict_up),
       downregulated = nrow(strict_down),
       relaxed_significant = nrow(relaxed_up) + nrow(relaxed_down),
       relaxed_upregulated = nrow(relaxed_up),
       relaxed_downregulated = nrow(relaxed_down),
       candidate_selection_tier = candidate_selection_tier,
       threshold_log2fc = 1.0,
       threshold_qvalue = 0.05
     ),
     top_candidates_up = lapply(seq_len(min(10, nrow(up))), function(i) format_candidate(up[i, ])),
     top_candidates_down = lapply(seq_len(min(10, nrow(down))), function(i) format_candidate(down[i, ])),
     top_pathways = pathways,
     figures = list(
       counts = existing_path("counts"),
       venn = existing_path("venn|euler"),
       variation_cv = existing_path("variation"),
       pca = existing_path("pca"),
       heatmap = if (!is.na(existing_path("heatmap", exclude = "module|discussion"))) existing_path("heatmap", exclude = "module|discussion") else discussion_figures[["module"]],
       volcano = contrast_path("volcano", contrast_str),
       enrichment = contrast_path("enrichment", contrast_str)
     ),
     discussion_figures = discussion_figures
   )
   write_json(digest, "data/manuscript_digest.json", auto_unbox = TRUE, pretty = TRUE, null = "null")
   cat("Wrote data/manuscript_digest.json successfully.\n")

   # Persist authoritative figure caption contract for Phase 11 manuscript
   fig_meta <- tibble::tibble(
     path = c(
       existing_path("counts"),
       existing_path("pca"),
       contrast_path("volcano", contrast_str),
       discussion_figures[["module"]],
       discussion_figures[["dichotomy"]],
       discussion_figures[["forest"]],
       discussion_figures[["imputation"]]
     ),
     generator = "code/10_figures.R",
     caption = c(
       "Identification counts across sample groups",
       "Principal Component Analysis (PCA) scores plot showing sample clustering and condition separation",
       paste0("Volcano plot of differential expression for ", contrast_str),
       "Functional module abundance heatmap showing coordinate regulation of candidate protein programs",
       paste0("Biological program dichotomy signatures for ", contrast_str),
       paste0("Candidate targets and literature effect sizes for ", contrast_str),
       paste0("Imputation diagnostic and individual protein abundance for ", contrast_str)
     ),
     what_it_shows = c(
       "Protein identification count per sample group",
       "Replicate variance and cohort separation on PC1 vs PC2",
       "Statistical significance (q-value) vs log2 fold change",
       "Relative abundance pattern across biological modules (NOT an abundance correlation heatmap)",
       "Coordinate shift of opposing functional gene signatures",
       "Estimated fold change and confidence bounds for key candidates",
       "Observed vs imputed abundance distributions for top candidates"
     )
   ) %>% dplyr::filter(!is.na(path), nzchar(path))
   readr::write_tsv(fig_meta, "data/figures.tsv")
   cat("Wrote data/figures.tsv successfully.\n")
   ```

4. **Emit Pre-Compiled Statistical Digest (`data/manuscript_digest.json`) & Figure Registry (`data/figures.tsv`)**:
   - The script must write a clean JSON file compiling all primary statistics, sample counts, differential expression tallies, feature retention breakdown (`feature_retention`: modeled vs unmodeled entities, accounting for zero-quantification background vs condition-exclusive dropouts), top candidates, pathway enrichments, and figure paths so Phase 11 can author the manuscript directly without running exploratory bash or R commands.
   - The script must write `data/figures.tsv` documenting `path`, `generator`, `caption`, and `what_it_shows` for every generated figure. Caption headings MUST match the actual file generated (e.g. `plot_discussion_module.png` is a module heatmap, NEVER titled as an abundance correlation heatmap).
   > ⚠️ **R Syntax Note for Reserved Keyword `function`**:
   > In R, `function` is a reserved language keyword. When constructing named list elements for JSON serialization, always quote or backtick it (e.g. `list(gene = ..., \`function\` = as.character(r$description))` or `"function" = ...`) to prevent critical parser syntax errors (`unexpected '=' in "..., function="`).

---

#### Checkpoint Gate & Phase Completion

- [ ] **Checkpoint Gate**:
  1. `code/10_figures.R` executed with status code 0 and output logged to `logs/10_figures/console.log`.
  2. Four discussion figures exist in `data/` with non-zero file sizes (`*module*.png`, `*signatures*.png` or `*programs*.png` or `*dichotomy*.png`, `*candidates*.png` or `*forest*.png`, `*expression*imputation*.png` or `*imputation*.png`).
  3. `data/manuscript_digest.json` exists on disk with non-zero file size, `discussion_figures` lists the 4 generated figure paths, and `feature_retention` details unmodeled feature statistics.
  4. `data/figures.tsv` exists on disk with non-zero file size, specifying exact captions and descriptions for each figure.
  5. (Optional validation command): Verify digest schema cleanly:
     ```bash
     Rscript -e 'x <- jsonlite::fromJSON("data/manuscript_digest.json", simplifyVector = FALSE); stopifnot(length(x$top_candidates_up) > 0, length(x$discussion_figures) == 4, !is.null(x$feature_retention)); cat("Digest validation PASS\n")'
     ```
- [ ] **Complete Phase**:
  - Invoke `complete_phase(phaseName = "10_FIGURES", summary = "Generated 4 hypothesis-driven discussion figures in data/, compiled data/figures.tsv figure contract, and compiled statistical digest with feature retention accounting in data/manuscript_digest.json.")`.
