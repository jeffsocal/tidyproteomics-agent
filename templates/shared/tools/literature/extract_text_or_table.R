#!/usr/bin/env Rscript
# ==============================================================================
# Script Name: extract_text_or_table.R
# Purpose:     Extracts raw text from scientific literature PDFs (filtering out
#              extraneous reference sections where possible) and reads supplementary
#              data tables (.csv, .tsv, .xlsx). Emits structured JSON.
#
# Usage:
#   Rscript tools/literature/extract_text_or_table.R <input_file> [max_pages_or_rows]
# ==============================================================================

suppressPackageStartupMessages({
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

extract_pdf <- function(file_path, max_pages = 25) {
  text_pages <- NULL

  # 1. Try pdftools if installed
  if (requireNamespace("pdftools", quietly = TRUE)) {
    text_pages <- tryCatch(pdftools::pdf_text(file_path), error = function(e) NULL)
  }

  # 2. Try pdftotext CLI if available
  if (is.null(text_pages)) {
    pdftotext_bin <- Sys.which("pdftotext")
    if (nzchar(pdftotext_bin)) {
      tmp_txt <- tempfile(fileext = ".txt")
      res <- system2(pdftotext_bin, args = c(shQuote(file_path), shQuote(tmp_txt)), stdout = FALSE, stderr = FALSE)
      if (res == 0 && file.exists(tmp_txt)) {
        text_pages <- readLines(tmp_txt, warn = FALSE)
        unlink(tmp_txt)
      }
    }
  }

  if (is.null(text_pages)) {
    fail("PDF extraction requires the R package 'pdftools' (install.packages('pdftools')) or the 'pdftotext' command line tool.")
  }

  total_pages <- length(text_pages)
  if (total_pages > max_pages) {
    text_pages <- text_pages[seq_len(max_pages)]
  }

  # Concatenate and strip excessive whitespace / repetitive headers
  full_text <- paste(text_pages, collapse = "\n--- PAGE BREAK ---\n")

  if (nchar(trimws(full_text)) < 80) {
    fail("PDF contained no readable text (<80 characters). The file may be a scanned image or bitmap without an embedded text/OCR layer.")
  }

  # Optional trimming: If a "REFERENCES" or "LITERATURE CITED" section appears late in the document (>70%),
  # truncate to focus token budget on Results, Figures, and Discussion.
  ref_pos <- regexpr("\n(REFERENCES|LITERATURE CITED|BIBLIOGRAPHY)\r?\n", full_text, ignore.case = TRUE)
  if (ref_pos > 0 && ref_pos > (nchar(full_text) * 0.7)) {
    full_text <- substr(full_text, 1, ref_pos)
  }

  # Limit max characters to ~100,000 (~25,000 tokens) to fit in frontier LLM contexts
  if (nchar(full_text) > 100000) {
    full_text <- substr(full_text, 1, 100000)
  }

  emit(list(
    ok = TRUE,
    kind = "pdf",
    filename = basename(file_path),
    pages_extracted = length(text_pages),
    total_pages = total_pages,
    char_count = nchar(full_text),
    text = full_text
  ))
}

extract_table <- function(file_path, max_rows = 200) {
  ext <- tolower(tools::file_ext(file_path))
  df <- NULL

  if (ext %in% c("csv", "tsv", "txt")) {
    sep <- if (ext == "tsv") "\t" else ","
    df <- tryCatch(
      utils::read.table(file_path, header = TRUE, sep = sep, stringsAsFactors = FALSE, check.names = FALSE, nrows = max_rows),
      error = function(e) NULL
    )
  } else if (ext %in% c("xlsx", "xls")) {
    if (requireNamespace("readxl", quietly = TRUE)) {
      df <- tryCatch(as.data.frame(readxl::read_excel(file_path, n_max = max_rows)), error = function(e) NULL)
    } else {
      fail("Reading Excel files requires the 'readxl' package. install.packages('readxl')")
    }
  }

  if (is.null(df) || nrow(df) == 0) {
    fail(sprintf("Could not read table data from '%s'. Verify file format and column headers.", basename(file_path)))
  }

  # Convert columns to character for clean JSON serialization
  df_clean <- as.data.frame(lapply(df, as.character), stringsAsFactors = FALSE)

  emit(list(
    ok = TRUE,
    kind = "table",
    filename = basename(file_path),
    total_rows = nrow(df_clean),
    columns = colnames(df_clean),
    rows = head(df_clean, max_rows)
  ))
}

main <- function() {
  args <- commandArgs(trailingOnly = TRUE)
  if (length(args) < 1) {
    fail("Usage: extract_text_or_table.R <input_file> [max_pages_or_rows]")
  }
  file_path <- args[1]
  if (!file.exists(file_path)) fail(sprintf("File does not exist: %s", file_path))

  limit <- if (length(args) >= 2) as.integer(args[2]) else 25L

  ext <- tolower(tools::file_ext(file_path))
  if (ext == "pdf") {
    extract_pdf(file_path, max_pages = limit)
  } else if (ext %in% c("csv", "tsv", "xlsx", "xls")) {
    extract_table(file_path, max_rows = max(50L, limit * 10L))
  } else {
    fail(sprintf("Unsupported file extension '%s'. Expected .pdf, .csv, .tsv, or .xlsx.", ext))
  }
}

tryCatch(main(), error = function(e) fail(conditionMessage(e)))
