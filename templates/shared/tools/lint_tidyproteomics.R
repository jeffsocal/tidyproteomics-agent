#!/usr/bin/env Rscript
# ==============================================================================
# tidyproteomics Code Quality & Data Encapsulation AST Linter
# Uses base R lexical parsing (getParseData) to detect internal slot access ($)
# and raw ggplot2 calls without false positives on strings or comments.
# ==============================================================================

args <- commandArgs(trailingOnly = TRUE)
if (length(args) == 0) {
  cat("Usage: Rscript tools/lint_tidyproteomics.R <path_to_script.R>\n")
  quit(status = 0)
}

script_path <- args[1]
if (!file.exists(script_path)) {
  cat(sprintf("Error: File not found: %s\n", script_path), file = stderr())
  quit(status = 1)
}

# 1. Parse the R script
parsed <- tryCatch(
  parse(script_path, keep.source = TRUE),
  error = function(e) {
    cat(sprintf("CRITICAL SYNTAX ERROR: Could not parse %s:\n%s\n", script_path, e$message), file = stderr())
    quit(status = 1)
  }
)

pd <- utils::getParseData(parsed)
if (is.null(pd) || nrow(pd) == 0) {
  cat(sprintf("[LINT PASS] %s is empty or contains no tokens.\n", basename(script_path)))
  quit(status = 0)
}

violations <- character()
raw_lines <- readLines(script_path, warn = FALSE)

# 2. Check for forbidden internal slot access: obj$slot or obj[["slot"]]
forbidden_slots <- c(
  "quantitative", "annotations", "accounting", "experiments",
  "operations", "analysis", "quantitative_source"
)

# Look for '$' operator followed by forbidden slot symbol
dollar_indices <- which(pd$token == "'$'")
for (idx in dollar_indices) {
  # Next terminal token should be the slot symbol
  sub_pd <- pd[(idx + 1):nrow(pd), ]
  terminal_tokens <- sub_pd[sub_pd$terminal, ]
  if (nrow(terminal_tokens) > 0) {
    next_token <- terminal_tokens[1, ]
    if (next_token$text %in% forbidden_slots) {
      line_num <- pd$line1[idx]
      line_text <- trimws(raw_lines[line_num])
      violations <- c(violations, sprintf(
        "Line %d: Direct internal slot access '$%s' detected:\n    %s\n  --> FORBIDDEN: Do not access internal S3 list slots.\n  --> CANONICAL TIDYPROTEOMICS ACCESSORS:\n      * Abundance / data frames: tp_data |> subset(...) |> as.data.frame() or export_quant()\n      * Analysis tables:         tp_data |> export_analysis(...)\n      * Metadata & annotations:  get_sample_names(tp_data), get_annotation_terms(tp_data), get_quant_names(tp_data)",
        line_num, next_token$text, line_text
      ))
    }
  }
}

# Look for '[[' indexing with string constant matching forbidden slots
double_bracket_indices <- which(pd$token == "LBB") # '[[' is token 'LBB'
for (idx in double_bracket_indices) {
  sub_pd <- pd[(idx + 1):nrow(pd), ]
  terminal_tokens <- sub_pd[sub_pd$terminal, ]
  if (nrow(terminal_tokens) > 0) {
    next_token <- terminal_tokens[1, ]
    # Stripped quote string
    str_val <- gsub("^[\"']|[\"']$", "", next_token$text)
    if (str_val %in% forbidden_slots) {
      line_num <- pd$line1[idx]
      line_text <- trimws(raw_lines[line_num])
      violations <- c(violations, sprintf(
        "Line %d: Direct internal slot access '[[\"%s\"]]' detected:\n    %s\n  --> FORBIDDEN: Do not index internal S3 list slots.\n  --> CANONICAL TIDYPROTEOMICS ACCESSORS:\n      * Abundance / data frames: tp_data |> subset(...) |> as.data.frame() or export_quant()\n      * Analysis tables:         tp_data |> export_analysis(...)",
        line_num, str_val, line_text
      ))
    }
  }
}

is_10_figures <- grepl("(^|/)10_figures\\.R$", script_path)

# 3. Check for raw ggplot() or ggplot2::ggplot() function calls (exempted for Phase 10 discussion figures)
if (!is_10_figures) {
  ggplot_calls <- which(pd$token == "SYMBOL_FUNCTION_CALL" & pd$text == "ggplot")
  if (length(ggplot_calls) > 0) {
    for (idx in ggplot_calls) {
      line_num <- pd$line1[idx]
      line_text <- trimws(raw_lines[line_num])
      violations <- c(violations, sprintf(
        "Line %d: Raw ggplot() call detected:\n    %s\n  --> FORBIDDEN: Do not construct custom ggplot graphs.\n  --> USE CANONICAL PLOTTING METHODS with built-in saving:\n      * tp_data |> plot_counts(destination = 'png')\n      * tp_data |> plot_pca(destination = 'png')\n      * tp_data |> plot_volcano(destination = 'png')\n      * tp_data |> plot_heatmap(..., destination = 'png')\n      * tp_data |> plot_expression(..., destination = 'png')\n      * tp_data |> plot_signatures(..., destination = 'png')\n      * tp_data |> plot_candidates(..., destination = 'png')\n      * tp_data |> plot_imputation_diagnostic(..., destination = 'png')",
        line_num, line_text
      ))
    }
  }

  # 4. Check for ggsave() calls
  ggsave_calls <- which(pd$token == "SYMBOL_FUNCTION_CALL" & pd$text == "ggsave")
  if (length(ggsave_calls) > 0) {
    for (idx in ggsave_calls) {
      line_num <- pd$line1[idx]
      line_text <- trimws(raw_lines[line_num])
      violations <- c(violations, sprintf(
        "Line %d: ggsave() call detected:\n    %s\n  --> FORBIDDEN: Do not use ggsave(). tidyproteomics plot functions save internally via destination = 'png'.\n  --> When destination = 'png', plot functions return the tidyproteomics data object, not a ggplot object.",
        line_num, line_text
      ))
    }
  }
}

# 5. Check for dplyr verbs called without library(dplyr) or dplyr:: qualification
has_dplyr_lib <- any(grepl("library\\s*\\(\\s*[\"']?dplyr[\"']?\\s*\\)", raw_lines))
dplyr_verbs <- c("filter", "arrange", "mutate", "group_by", "summarise", "summarize")
term_pd <- pd[pd$terminal, ]
for (verb in dplyr_verbs) {
  verb_indices <- which(term_pd$token == "SYMBOL_FUNCTION_CALL" & term_pd$text == verb)
  if (length(verb_indices) > 0 && !has_dplyr_lib) {
    for (idx in verb_indices) {
      is_qualified <- (idx >= 3 && term_pd$token[idx - 1] == "NS_GET" && term_pd$text[idx - 2] == "dplyr")
      if (!is_qualified) {
        line_num <- term_pd$line1[idx]
        line_text <- trimws(raw_lines[line_num])
        violations <- c(violations, sprintf(
          "Line %d: Unqualified '%s()' call detected without library(dplyr):\n    %s\n  --> CRITICAL NAMESPACE RISK: Without library(dplyr), '%s()' dispatches to base R (e.g. stats::%s), causing silent failures or 'object not found' errors.\n  --> FIX: Add 'library(dplyr)' at top of script, or use 'dplyr::%s()'.",
          line_num, verb, line_text, verb, verb, verb
        ))
      }
    }
  }
}

# Output report
if (length(violations) > 0) {
  cat("\n================================================================================\n", file = stderr())
  cat("CRITICAL QUALITY GATE ERROR: tidyproteomics Encapsulation Violation(s)\n", file = stderr())
  cat("================================================================================\n\n", file = stderr())
  cat(paste(violations, collapse = "\n\n"), "\n\n", file = stderr())
  cat("Action Required: Refactor the code to use official tidyproteomics pipeline methods.\n", file = stderr())
  cat("================================================================================\n", file = stderr())
  quit(status = 1)
} else {
  cat(sprintf("[LINT PASS] %s adheres strictly to tidyproteomics encapsulation.\n", basename(script_path)))
  quit(status = 0)
}
