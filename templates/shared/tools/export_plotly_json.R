#!/usr/bin/env Rscript
# ==============================================================================
# export_plotly_json.R
# Converts tidyproteomics plots and tables into interactive Plotly JSON widgets.
# ==============================================================================

suppressPackageStartupMessages({
  if (!requireNamespace("jsonlite", quietly = TRUE)) stop("jsonlite required")
  library(jsonlite)
})

clean_for_json <- function(obj) {
  if (is.null(obj)) return(NULL)
  if (is.expression(obj) || inherits(obj, "call")) return(as.character(obj))
  if (is.list(obj)) return(lapply(obj, clean_for_json))
  obj
}

save_plotly_json <- function(p, out_path) {
  tryCatch({
    suppressPackageStartupMessages(library(plotly))
    ply <- ggplotly(p)

    cleaned_data <- clean_for_json(ply$x$data)
    cleaned_layout <- clean_for_json(ply$x$layout)

    # Consolidate faceted duplicate traces into clean unified legend groups
    # e.g., "(surfactin,1)", "(surfactin,2)" -> "surfactin"
    seen_groups <- character(0)
    for (i in seq_along(cleaned_data)) {
      t_name <- cleaned_data[[i]]$name
      if (!is.null(t_name) && is.character(t_name)) {
        clean_name <- sub("^[(]([^,]+),[0-9 ]+[)]$", "\\1", t_name)
        if (nzchar(clean_name) && clean_name != t_name) {
          cleaned_data[[i]]$legendgroup <- clean_name
          if (!clean_name %in% seen_groups) {
            cleaned_data[[i]]$name <- clean_name
            cleaned_data[[i]]$showlegend <- TRUE
            seen_groups <- c(seen_groups, clean_name)
          } else {
            cleaned_data[[i]]$name <- clean_name
            cleaned_data[[i]]$showlegend <- FALSE
          }
        }
      }

      # Protect coordinate and text arrays from jsonlite auto_unbox
      # auto_unbox = TRUE turns length-1 vectors into scalars, breaking Plotly.js data_array loops
      if (!is.null(cleaned_data[[i]]$x)) cleaned_data[[i]]$x <- I(cleaned_data[[i]]$x)
      if (!is.null(cleaned_data[[i]]$y)) cleaned_data[[i]]$y <- I(cleaned_data[[i]]$y)
      if (!is.null(cleaned_data[[i]]$z)) cleaned_data[[i]]$z <- I(cleaned_data[[i]]$z)
      if (!is.null(cleaned_data[[i]]$mode) && grepl("text", cleaned_data[[i]]$mode)) {
        if (!is.null(cleaned_data[[i]]$text)) cleaned_data[[i]]$text <- I(cleaned_data[[i]]$text)
      }
    }

    if (length(seen_groups) > 0) {
      cleaned_layout$showlegend <- TRUE
      cleaned_layout$legend <- list(
        orientation = "h",
        x = 0.5,
        xanchor = "center",
        y = 1.06,
        yanchor = "bottom",
        bgcolor = "rgba(255, 255, 255, 0.9)",
        bordercolor = "#e5e7eb",
        borderwidth = 1
      )
      if (is.null(cleaned_layout$margin$t) || cleaned_layout$margin$t < 60) {
        cleaned_layout$margin$t <- 65
      }
    }

    widget_data <- list(
      data = cleaned_data,
      layout = cleaned_layout,
      config = list(responsive = TRUE, displayModeBar = TRUE)
    )
    json_str <- toJSON(widget_data, auto_unbox = TRUE, null = "null", dataframe = "rows")
    writeLines(json_str, out_path)
    cat("Generated Plotly JSON:", out_path, "(", file.info(out_path)$size, "bytes )\n")
    return(TRUE)
  }, error = function(e) {
    cat("ggplotly fallback needed for", out_path, ":", conditionMessage(e), "\n")
    return(FALSE)
  })
}

main <- function() {
  args <- commandArgs(trailingOnly = TRUE)
  target_file <- if (length(args) >= 1 && nzchar(args[1])) args[1] else NULL

  rds_path <- "data/tidyproteomics_data.rds"
  has_rds <- file.exists(rds_path)
  data <- if (has_rds) {
    suppressPackageStartupMessages(library(tidyproteomics))
    readRDS(rds_path)
  } else NULL

  comp <- "p97_kd/ctl"
  if (!is.null(data) && !is.null(data$analysis) && length(data$analysis) > 0) {
    comp <- names(data$analysis)[1]
  }

  out_dir <- "data"

  generate_single <- function(base_name) {
    out_json <- file.path(out_dir, paste0(sub("\\.png$", "", base_name), ".plotly.json"))

    # 1. PCA
    if (grepl("pca", base_name, ignore.case = TRUE) && !is.null(data)) {
      p <- data %>% plot_pca(destination = "plot")
      save_plotly_json(p, out_json)
      return()
    }

    # 2. Counts
    if (grepl("counts", base_name, ignore.case = TRUE) && !is.null(data)) {
      p <- data %>% plot_counts(destination = "plot")
      save_plotly_json(p, out_json)
      return()
    }

    # 3. Volcano (Differential expression) with rich gene labels & ggrepel-style callouts
    if (grepl("volcano", base_name, ignore.case = TRUE)) {
      ed <- NULL
      if (!is.null(data)) {
        ed <- tryCatch(export_analysis(data, comp, .analysis = "expression"), error = function(e) NULL)
      }
      if (is.null(ed)) {
        expr_tbl <- list.files(out_dir, pattern = "table_.*_expression_.*\\.(tsv|csv)$", full.names = TRUE)[1]
        if (!is.na(expr_tbl) && file.exists(expr_tbl)) {
          ed <- if (grepl("\\.csv$", expr_tbl)) read.csv(expr_tbl) else read.delim(expr_tbl)
        }
      }
      if (!is.null(ed) && all(c("log2_foldchange", "p_value") %in% names(ed))) {
        ed <- ed[!is.na(ed$log2_foldchange) & !is.na(ed$p_value), ]
        label_col <- if ("gene_name" %in% names(ed)) "gene_name" else if ("protein" %in% names(ed)) "protein" else names(ed)[1]
        prot_col <- if ("protein" %in% names(ed)) "protein" else label_col
        adj_col <- if ("adj_p_value" %in% names(ed)) "adj_p_value" else "p_value"
        
        neg_log10_p <- -log10(pmax(ed$p_value, 1e-300))
        sig_up <- (ed[[adj_col]] <= 0.05) & (ed$log2_foldchange >= 1.0)
        sig_down <- (ed[[adj_col]] <= 0.05) & (ed$log2_foldchange <= -1.0)
        
        # Color convention matching tidyproteomics (dodgerblue positive, firebrick negative)
        colors <- ifelse(sig_up, "#1e90ff", ifelse(sig_down, "#ff3030", "rgba(156, 163, 175, 0.45)"))
        sizes <- ifelse(sig_up | sig_down, 8, 5)
        
        hover_txt <- paste0(
          "<b>", ed[[label_col]], "</b> (", ed[[prot_col]], ")<br>",
          "log2FC: ", round(ed$log2_foldchange, 2), "<br>",
          "p-value: ", sprintf("%.2e", ed$p_value),
          if (adj_col == "adj_p_value") paste0("<br>adj. p: ", sprintf("%.2e", ed[[adj_col]])) else ""
        )
        
        scatter_trace <- list(
          type = "scatter",
          mode = "markers",
          x = ed$log2_foldchange,
          y = neg_log10_p,
          text = hover_txt,
          hoverinfo = "text",
          marker = list(
            size = sizes,
            color = colors,
            line = list(width = ifelse(sig_up | sig_down, 1, 0), color = "#ffffff")
          ),
          showlegend = FALSE
        )
        
        # Build ggrepel-style callout annotations for top significant proteins
        sig_df <- ed[sig_up | sig_down, ]
        annotations <- list()
        if (nrow(sig_df) > 0) {
          sig_df$neg_log10_p <- -log10(pmax(sig_df$p_value, 1e-300))
          # Top up
          up_hits <- sig_df[sig_df$log2_foldchange > 0, ]
          if (nrow(up_hits) > 0) {
            up_hits <- head(up_hits[order(up_hits[[adj_col]], -up_hits$log2_foldchange), ], 8)
          }
          # Top down
          down_hits <- sig_df[sig_df$log2_foldchange < 0, ]
          if (nrow(down_hits) > 0) {
            down_hits <- head(down_hits[order(down_hits[[adj_col]], down_hits$log2_foldchange), ], 8)
          }
          top_annot <- rbind(up_hits, down_hits)
          if (nrow(top_annot) > 0) {
            for (i in 1:nrow(top_annot)) {
              row_i <- top_annot[i, ]
              is_pos <- row_i$log2_foldchange > 0
              annotations[[length(annotations) + 1L]] <- list(
                x = row_i$log2_foldchange,
                y = row_i$neg_log10_p,
                text = paste0("<b>", row_i[[label_col]], "</b>"),
                showarrow = TRUE,
                arrowhead = 2,
                arrowsize = 0.8,
                arrowwidth = 1.2,
                arrowcolor = "#4b5563",
                ax = if (is_pos) (30 + (i %% 3) * 15) else (-30 - (i %% 3) * 15),
                ay = -25 - ((i + 1) %% 4) * 12,
                font = list(size = 10, color = "#111827", family = "system-ui, -apple-system, sans-serif"),
                bgcolor = "rgba(255, 255, 255, 0.9)",
                bordercolor = "#d1d5db",
                borderwidth = 1
              )
            }
          }
        }
        
        layout <- list(
          title = list(
            text = paste0("Volcano Plot: ", gsub("[` ]", "", comp)),
            font = list(size = 15, color = "#111827", family = "system-ui, -apple-system, sans-serif")
          ),
          xaxis = list(
            title = "Expression Difference (log2 Fold Change)",
            zeroline = TRUE,
            zerolinecolor = "#d1d5db",
            gridcolor = "#f3f4f6",
            linecolor = "#9ca3af"
          ),
          yaxis = list(
            title = "Significance (-log10 P-Value)",
            zeroline = TRUE,
            zerolinecolor = "#d1d5db",
            gridcolor = "#f3f4f6",
            linecolor = "#9ca3af"
          ),
          paper_bgcolor = "#ffffff",
          plot_bgcolor = "#ffffff",
          font = list(color = "#111827", family = "system-ui, -apple-system, sans-serif"),
          margin = list(l = 65, r = 35, t = 45, b = 45),
          annotations = annotations
        )
        
        writeLines(toJSON(list(data = list(scatter_trace), layout = layout, config = list(responsive = TRUE)), auto_unbox = TRUE), out_json)
        cat("Generated Volcano Plotly JSON with callout annotations:", out_json, "\n")
        return()
      }
    }

    # 4. Enrichment
    for (ont in c("biological_process", "cellular_component", "molecular_function", "reactome_pathway", "wiki_pathway")) {
      if (grepl(paste0("enrichment.*", ont), base_name, ignore.case = TRUE) && !is.null(data)) {
        p <- data %>% plot_enrichment(comp, .term = ont, destination = "plot")
        if (save_plotly_json(p, out_json)) return()
      }
    }

    # 5. Imputation Diagnostic
    if (grepl("imputation", base_name, ignore.case = TRUE) && !is.null(data)) {
      p <- data %>% plot_expression(comp, imputed_only = TRUE, destination = "plot", top_n = 10)
      if (save_plotly_json(p, out_json)) return()
    }

    # 6. Literature Candidate Forest Plot (from literature_candidate_expression.csv or candidates table)
    if (grepl("(forest|candidates)", base_name, ignore.case = TRUE)) {
      f_csv <- file.path(out_dir, "literature_candidate_expression.csv")
      if (!file.exists(f_csv)) {
        f_csv <- list.files(out_dir, pattern = "table_.*candidates.*\\.tsv", full.names = TRUE)[1]
      }
      if (file.exists(f_csv)) {
        df <- if (grepl("\\.csv$", f_csv)) read.csv(f_csv) else read.delim(f_csv)
        if ("log2_foldchange" %in% names(df)) {
          df <- df[order(df$log2_foldchange), ]
          label_col <- if ("gene_name" %in% names(df)) "gene_name" else if ("protein" %in% names(df)) "protein" else names(df)[1]
          trace <- list(
            type = "scatter",
            mode = "markers+lines",
            x = df$log2_foldchange,
            y = as.character(df[[label_col]]),
            text = paste0("<b>", df[[label_col]], "</b><br>log2FC: ", round(df$log2_foldchange, 3),
                          if ("adj_p_value" %in% names(df)) paste0("<br>adj.p: ", sprintf("%.2e", df$adj_p_value)) else ""),
            hoverinfo = "text",
            marker = list(
              size = 12,
              color = ifelse(df$log2_foldchange > 0, "#ef4444", "#3b82f6"),
              line = list(width = 1.5, color = "#ffffff")
            )
          )
          layout <- list(
            title = list(text = "Prioritized Candidate Biomarkers & Effect Sizes"),
            xaxis = list(title = "log2 Fold Change", zeroline = TRUE, zerolinecolor = "#d1d5db", gridcolor = "#f3f4f6"),
            yaxis = list(title = "", automargin = TRUE, gridcolor = "#f3f4f6"),
            paper_bgcolor = "#ffffff",
            plot_bgcolor = "#ffffff",
            font = list(color = "#111827", family = "system-ui, -apple-system, sans-serif"),
            margin = list(l = 110, r = 40, t = 45, b = 45)
          )
          writeLines(toJSON(list(data = list(trace), layout = layout, config = list(responsive = TRUE)), auto_unbox = TRUE), out_json)
          cat("Generated Forest Plotly JSON:", out_json, "\n")
          return()
        }
      }
    }

    # 7. Dichotomy / Signatures Plot (from de_novo_modules.tsv)
    if (grepl("(dichotomy|signatures|programs)", base_name, ignore.case = TRUE)) {
      mod_file <- file.path(out_dir, "de_novo_modules.tsv")
      if (file.exists(mod_file)) {
        mdf <- read.delim(mod_file)
        if (nrow(mdf) > 0 && "median_log2fc" %in% names(mdf)) {
          mdf <- mdf[order(mdf$median_log2fc), ]
          trace <- list(
            type = "bar",
            x = mdf$median_log2fc,
            y = mdf$annotation,
            orientation = "h",
            text = paste0("<b>", mdf$annotation, "</b><br>Median log2FC: ", round(mdf$median_log2fc, 2),
                          "<br>Size: ", mdf$size, " proteins<br>Top drivers: ", mdf$top_drivers),
            hoverinfo = "text",
            marker = list(
              color = ifelse(mdf$median_log2fc > 0, "#ef4444", "#3b82f6")
            )
          )
          layout <- list(
            title = list(text = "Functional Program Dichotomy (De Novo Modules)"),
            xaxis = list(title = "Median log2 Fold Change", zeroline = TRUE, zerolinecolor = "#d1d5db", gridcolor = "#f3f4f6"),
            yaxis = list(title = "", automargin = TRUE, gridcolor = "#f3f4f6"),
            paper_bgcolor = "#ffffff",
            plot_bgcolor = "#ffffff",
            font = list(color = "#111827", family = "system-ui, -apple-system, sans-serif"),
            margin = list(l = 180, r = 40, t = 45, b = 45)
          )
          writeLines(toJSON(list(data = list(trace), layout = layout, config = list(responsive = TRUE)), auto_unbox = TRUE), out_json)
          cat("Generated Dichotomy Plotly JSON:", out_json, "\n")
          return()
        }
      }
    }

    # 8. Heatmap / Biological Module (from quantitative extract or candidate expression)
    if (grepl("(heatmap|module)", base_name, ignore.case = TRUE) && !is.null(data)) {
      expr_tbl <- list.files(out_dir, pattern = "table_.*_expression_.*\\.tsv", full.names = TRUE)[1]
      top_genes <- character(0)
      if (!is.na(expr_tbl) && file.exists(expr_tbl)) {
        ed <- read.delim(expr_tbl)
        if ("log2_foldchange" %in% names(ed)) {
          ed <- ed[order(abs(ed$log2_foldchange), decreasing = TRUE), ]
          top_genes <- head(unique(na.omit(ed$gene_name)), 25)
        }
      }

      ex <- tryCatch(extract(data), error = function(e) NULL)
      if (!is.null(ex) && length(top_genes) > 0) {
        gene_ann <- data$annotation[data$annotation$term == "gene_name", c("protein", "annotation")]
        names(gene_ann)[2] <- "gene_name"
        ex <- merge(ex, gene_ann, by.x = "identifier", by.y = "protein", all.x = TRUE)
        ex$gene_display <- ifelse(!is.na(ex$gene_name) & nzchar(ex$gene_name), ex$gene_name, ex$identifier)
        ex$sample_label <- paste(ex$sample, ex$replicate, sep = "_")

        sub_ex <- ex[ex$gene_display %in% top_genes, ]
        mat <- tapply(sub_ex$abundance, list(sub_ex$gene_display, sub_ex$sample_label), mean)
        mat_log <- log10(mat + 1)
        mat_scaled <- t(scale(t(mat_log)))
        mat_scaled[is.na(mat_scaled)] <- 0

        trace <- list(
          type = "heatmap",
          z = unname(apply(mat_scaled, 1, as.list)),
          x = colnames(mat_scaled),
          y = rownames(mat_scaled),
          colorscale = "RdBu",
          reversescale = TRUE,
          colorbar = list(title = "Z-Score")
        )
        layout <- list(
          title = list(text = "Biological Module Expression Heatmap"),
          xaxis = list(title = "Sample Replicates", automargin = TRUE),
          yaxis = list(title = "", automargin = TRUE),
          paper_bgcolor = "#ffffff",
          plot_bgcolor = "#ffffff",
          font = list(color = "#111827", family = "system-ui, -apple-system, sans-serif"),
          margin = list(l = 100, r = 40, t = 45, b = 60)
        )
        writeLines(toJSON(list(data = list(trace), layout = layout, config = list(responsive = TRUE)), auto_unbox = TRUE), out_json)
        cat("Generated Module Heatmap Plotly JSON:", out_json, "\n")
        return()
      } else if (!is.na(expr_tbl) && file.exists(expr_tbl)) {
        ed <- read.delim(expr_tbl)
        if ("log2_foldchange" %in% names(ed)) {
          ed <- ed[order(abs(ed$log2_foldchange), decreasing = TRUE), ]
          top_cands <- head(ed, 25)
          label_col <- if ("gene_name" %in% names(top_cands)) "gene_name" else "protein"
          z_vals <- matrix(top_cands$log2_foldchange, ncol = 1)
          trace <- list(
            type = "heatmap",
            z = z_vals,
            x = list(comp),
            y = as.character(top_cands[[label_col]]),
            colorscale = "RdBu",
            reversescale = TRUE,
            colorbar = list(title = "log2FC")
          )
          layout <- list(
            title = list(text = "Top Candidate Biomarkers Heatmap"),
            xaxis = list(title = "", automargin = TRUE),
            yaxis = list(title = "", automargin = TRUE),
            paper_bgcolor = "#ffffff",
            plot_bgcolor = "#ffffff",
            font = list(color = "#111827", family = "system-ui, -apple-system, sans-serif"),
            margin = list(l = 100, r = 40, t = 45, b = 45)
          )
          writeLines(toJSON(list(data = list(trace), layout = layout, config = list(responsive = TRUE)), auto_unbox = TRUE), out_json)
          cat("Generated Heatmap Plotly JSON (fallback):", out_json, "\n")
          return()
        }
      }
    }

    # 9. Generic Volcano from Expression Table if RDS plot failed
    if (grepl("volcano", base_name, ignore.case = TRUE)) {
      expr_tbl <- list.files(out_dir, pattern = "table_.*_expression_.*\\.tsv", full.names = TRUE)[1]
      if (!is.na(expr_tbl) && file.exists(expr_tbl)) {
        ed <- read.delim(expr_tbl)
        if (all(c("log2_foldchange", "adj_p_value") %in% names(ed))) {
          ed <- ed[!is.na(ed$log2_foldchange) & !is.na(ed$adj_p_value), ]
          label_col <- if ("gene_name" %in% names(ed)) "gene_name" else "protein"
          neg_log10_p <- -log10(pmax(ed$adj_p_value, 1e-300))
          sig_up <- ed$adj_p_value <= 0.05 & ed$log2_foldchange >= 1
          sig_down <- ed$adj_p_value <= 0.05 & ed$log2_foldchange <= -1
          colors <- ifelse(sig_up, "#ef4444", ifelse(sig_down, "#3b82f6", "#71717a"))
          trace <- list(
            type = "scattergl",
            mode = "markers",
            x = ed$log2_foldchange,
            y = neg_log10_p,
            text = paste0("<b>", ed[[label_col]], "</b><br>log2FC: ", round(ed$log2_foldchange, 2), "<br>adj.p: ", sprintf("%.2e", ed$adj_p_value)),
            hoverinfo = "text",
            marker = list(size = 6, color = colors, opacity = 0.75)
          )
          layout <- list(
            title = list(text = paste0("Volcano Plot: ", comp)),
            xaxis = list(title = "log2 Fold Change", zeroline = TRUE, zerolinecolor = "#d1d5db", gridcolor = "#f3f4f6"),
            yaxis = list(title = "-Log10 Adjusted P-Value", gridcolor = "#f3f4f6"),
            paper_bgcolor = "#ffffff",
            plot_bgcolor = "#ffffff",
            font = list(color = "#111827", family = "system-ui, -apple-system, sans-serif"),
            margin = list(l = 60, r = 30, t = 45, b = 45)
          )
          writeLines(toJSON(list(data = list(trace), layout = layout, config = list(responsive = TRUE)), auto_unbox = TRUE), out_json)
          cat("Generated Table Volcano Plotly JSON:", out_json, "\n")
          return()
        }
      }
    }
  }

  if (!is.null(target_file)) {
    generate_single(basename(target_file))
  } else {
    png_files <- list.files("data", pattern = "^plot_.*\\.png$", full.names = FALSE)
    for (pf in png_files) {
      generate_single(pf)
    }
  }
}

main()
