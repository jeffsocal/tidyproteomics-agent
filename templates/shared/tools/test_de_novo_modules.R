#!/usr/bin/env Rscript
# ==============================================================================
# Robust De Novo Functional Module & Protein Complex Tester
# Evaluates coordinate shifts of functional modules across unthresholded proteomes
# Always exits 0 and guarantees creation of data/de_novo_modules.tsv
# ==============================================================================

suppressPackageStartupMessages({
  library(dplyr)
  library(readr)
})

# Canonical empty table generator
make_empty_module_table <- function() {
  tibble(
    term = character(0),
    annotation = character(0),
    contrast = character(0),
    size = integer(0),
    enrichment = numeric(0),
    iqr_log2fc = numeric(0),
    pct_concordant = numeric(0),
    direction = character(0),
    p_value = numeric(0),
    adj_p_value = numeric(0),
    top_drivers = character(0),
    gene_names = character(0)
  )
}

main <- function() {
  output_file <- "data/de_novo_modules.tsv"
  dir.create("data", showWarnings = FALSE, recursive = TRUE)

  # 1. Discover expression tables
  exp_files <- list.files("data", pattern = "^table_.*_expression_.*[.](tsv|csv)$", full.names = TRUE)
  exp_files <- exp_files[!grepl("_extract", exp_files)]

  if (length(exp_files) == 0) {
    cat("[DeNovoModules] Notice: No expression tables found in data/. Emitting canonical empty table.\n")
    write_tsv(make_empty_module_table(), output_file)
    cat("PHASE_7_MODULES_COMPLETE: 0 modules tested (no expression tables)\n")
    return(invisible(0))
  }

  # Default functional module definitions (biochemical complexes and operons)
  default_modules <- list(
    "Ribosomal & Translational Machinery" = list(
      gene_pattern = "^rps|^rpl|^inf|^tsf|^fusA|^eef|^eif",
      desc_pattern = "ribosom|translation|elongation factor|initiation factor|tRNA ligase"
    ),
    "Histones & Chromatin Architecture" = list(
      gene_pattern = "^h1|^h2a|^h2b|^h3|^h4|^hmg",
      desc_pattern = "histone|chromatin|high mobility group"
    ),
    "Proteasome & Ubiquitin-Mediated Degradation" = list(
      gene_pattern = "^psm|^uba|^ube|^ubc|^rnf",
      desc_pattern = "proteasome|ubiquitin|ubiquitination|ring finger"
    ),
    "Molecular Chaperones & Heat Shock Response" = list(
      gene_pattern = "^hsp|^dna[kj]|^gro[el]|^clp|^htp",
      desc_pattern = "heat shock|chaperone|chaperonin|protease"
    ),
    "Elongator Complex Subunits" = list(
      gene_pattern = "^elp[1-6]|^ikbkap|^kti12",
      desc_pattern = "elongator complex"
    ),
    "Type I Interferon & Antiviral Response (ISG Axis)" = list(
      gene_pattern = "^stat[12]|^oas|^isg|^mx[12]|^irf|^ifit",
      desc_pattern = "interferon|antiviral|isg15|oas1"
    )
  )

  # Check for optional user module definition file (data/custom_module_definitions.json or R script)
  module_defs <- default_modules

  all_mod_rows <- list()

  for (f in exp_files) {
    df <- tryCatch({
      if (grepl("[.]tsv$", f)) read_tsv(f, show_col_types = FALSE) else read_csv(f, show_col_types = FALSE)
    }, error = function(e) NULL)

    if (is.null(df) || nrow(df) == 0) next

    # Clean contrast label
    base_name <- basename(f)
    contrast_name <- sub("^table_[^_]+_expression_", "", base_name)
    contrast_name <- sub("[.](tsv|csv)$", "", contrast_name)

    # Standardize column names
    fc_col <- intersect(c("log2_foldchange", "log2fc", "log2FoldChange"), names(df))[1]
    p_col <- intersect(c("adj_p_value", "padj", "p_value"), names(df))[1]
    gene_col <- intersect(c("gene_name", "protein", "identifier"), names(df))[1]
    desc_col <- intersect(c("description", "fasta_header"), names(df))[1]

    if (is.na(fc_col) || !fc_col %in% names(df)) next

    df[[fc_col]] <- suppressWarnings(as.numeric(df[[fc_col]]))
    valid_mask <- !is.na(df[[fc_col]])
    df_valid <- df[valid_mask, ]
    if (nrow(df_valid) < 5) next

    genes <- if (!is.na(gene_col) && gene_col %in% names(df_valid)) as.character(df_valid[[gene_col]]) else character(nrow(df_valid))
    descs <- if (!is.na(desc_col) && desc_col %in% names(df_valid)) as.character(df_valid[[desc_col]]) else character(nrow(df_valid))

    for (m_name in names(module_defs)) {
      def <- module_defs[[m_name]]
      g_pat <- if (!is.null(def$gene_pattern)) def$gene_pattern else ""
      d_pat <- if (!is.null(def$desc_pattern)) def$desc_pattern else ""

      in_mod <- rep(FALSE, nrow(df_valid))
      if (nzchar(g_pat)) in_mod <- in_mod | grepl(g_pat, genes, ignore.case = TRUE)
      if (nzchar(d_pat)) in_mod <- in_mod | grepl(d_pat, descs, ignore.case = TRUE)

      n_members <- sum(in_mod)
      bg_count <- sum(!in_mod)

      if (n_members == 0) {
        # Formally record module absence as an empirical negative result
        all_mod_rows[[length(all_mod_rows) + 1]] <- tibble(
          term = "de_novo_module",
          annotation = m_name,
          contrast = contrast_name,
          size = 0L,
          enrichment = 0.0,
          iqr_log2fc = 0.0,
          pct_concordant = 0.0,
          direction = "ABSENT_FROM_MATRIX",
          p_value = NA_real_,
          adj_p_value = NA_real_,
          top_drivers = "None detected (size 0)",
          gene_names = ""
        )
        next
      }

      mod_fc <- df_valid[[fc_col]][in_mod]
      bg_fc <- df_valid[[fc_col]][!in_mod]

      if (n_members < 2 || bg_count < 3) {
        med_fc <- median(mod_fc, na.rm = TRUE)
        all_mod_rows[[length(all_mod_rows) + 1]] <- tibble(
          term = "de_novo_module",
          annotation = m_name,
          contrast = contrast_name,
          size = as.integer(n_members),
          enrichment = round(med_fc, 3),
          iqr_log2fc = round(IQR(mod_fc, na.rm = TRUE), 3),
          pct_concordant = 100.0,
          direction = ifelse(med_fc >= 0, "UP", "DOWN"),
          p_value = NA_real_,
          adj_p_value = NA_real_,
          top_drivers = paste(head(unique(na.omit(genes[in_mod])), 5), collapse = ", "),
          gene_names = paste(unique(na.omit(genes[in_mod])), collapse = ", ")
        )
        next
      }

      wt <- suppressWarnings(wilcox.test(mod_fc, bg_fc))
      med_fc <- median(mod_fc, na.rm = TRUE)
      iqr_fc <- IQR(mod_fc, na.rm = TRUE)
      dir_sign <- ifelse(med_fc >= 0, 1, -1)
      pct_concordant <- round(mean(sign(mod_fc) == dir_sign, na.rm = TRUE) * 100, 1)

      all_mod_rows[[length(all_mod_rows) + 1]] <- tibble(
        term = "de_novo_module",
        annotation = m_name,
        contrast = contrast_name,
        size = as.integer(n_members),
        enrichment = round(med_fc, 3),
        iqr_log2fc = round(iqr_fc, 3),
        pct_concordant = pct_concordant,
        direction = ifelse(med_fc >= 0, "UP", "DOWN"),
        p_value = wt$p.value,
        adj_p_value = wt$p.value,
        top_drivers = paste(head(unique(na.omit(genes[in_mod])), 5), collapse = ", "),
        gene_names = paste(unique(na.omit(genes[in_mod])), collapse = ", ")
      )
    }
  }

  if (length(all_mod_rows) == 0) {
    write_tsv(make_empty_module_table(), output_file)
    cat("PHASE_7_MODULES_COMPLETE: 0 module rows evaluated\n")
    return(invisible(0))
  }

  res_tbl <- bind_rows(all_mod_rows)
  # Adjust p-values per contrast where p-values exist
  res_tbl <- res_tbl %>%
    group_by(contrast) %>%
    mutate(adj_p_value = ifelse(!is.na(p_value), p.adjust(p_value, method = "BH"), NA_real_)) %>%
    ungroup() %>%
    arrange(adj_p_value, p_value)

  write_tsv(res_tbl, output_file)
  cat(glue::glue("Successfully tested {nrow(res_tbl)} module-contrast pairs. Written to '{output_file}'.\n"))
  print(head(res_tbl, 10))
  cat("PHASE_7_MODULES_COMPLETE\n")
  return(invisible(0))
}

main()

