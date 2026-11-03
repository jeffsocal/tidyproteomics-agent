---
tools: []
---

### Phase 7: Internal Knowledge Contextualization, De Novo Functional Grouping & First-Layer Conclusions

In this phase, you (the LLM) will ingest the primary data-derived observations from `06_OBSERVATIONS` (`docs/observations.md`; note that `docs/experiment.md` is already provided in your prompt context above—do NOT waste turns re-reading `docs/experiment.md` or `logs/06_observations/console.log`). You will apply your internal domain knowledge (molecular biology, biochemistry, cellular physiology, protein complexes, operons, and signaling cascades) to contextualize the observations, construct statistically tested **de novo functional modules** (especially critical when formal GO/Reactome enrichment was bypassed or sparse in Phase 5), and develop the **first layer of conclusions** and **actionable target roles** (strictly do not hallucinate facts, citations, or unsupported claims).

To ground biological signatures and candidate targets in quantitative data across the entire proteome:
- Write and execute `code/07_knowledge.R` via `execute_command("Rscript code/07_knowledge.R")` against the Phase 6 expression table (`data/table_*_expression_*.tsv`) or `data/tidyproteomics_data.rds` (logged to `logs/07_knowledge/console.log`).
- Group related proteins into coherent **functional modules / complexes / operons** using protein descriptions, gene symbol families, and biochemical roles, and test their coordinate directional shift across the unthresholded dataset (`wilcox.test` rank-sum shift, saving `data/de_novo_modules.tsv`).
- Document all **new** data-derived observations and module statistics in `docs/knowledge.md`.

You will also classify leading candidates into **Actionable Roles** (`Predictive Biomarker`, `Druggable Target`, `Mechanistic Dependency`, `Compensatory Buffer`) and develop a curated list of high-yield keyphrases for downstream web search in Phase 08.
Finally, you will construct `docs/knowledge.md` documenting both the **new** observations and **new** first-layer conclusions.

---

#### 1. Pre-Flight Verification & Inputs Ingestion
Before proceeding:
1. Read `docs/observations.md` in a single turn to ingest verified quantitative data (dimensions, target metrics, top up/down tables, and enrichment summaries).
2. Rely on the `[WORKSPACE MANIFEST]` and `docs/experiment.md` already injected in your prompt above—do NOT waste turns calling `list_directory`, dumping raw tabular rows from `data/table_*_expression_*.tsv` into prompt context, or re-reading `docs/experiment.md`.
3. ⚠️ **Immediate Tool Call Requirement**: Do NOT emit conversational preambles or announcements between reading observations and authoring code (e.g. "Let me create the R script..."). In your very next turn after reading `docs/observations.md`, immediately invoke `write_file("code/07_knowledge.R", ...)` to author the analysis script.

---

#### 2. De Novo Functional Module Discovery & Hypothesis Queries via `code/07_knowledge.R`
Whenever formal ontology enrichment in Phase 5 was bypassed (or to test specific protein complexes, operons, unthresholded co-factors, and pathway partners suggested by the top hits in `docs/observations.md`):
- Author and write `code/07_knowledge.R` via `write_file` (or invoke the pre-installed helper `tools/test_de_novo_modules.R`) and execute it via `execute_command` (output is automatically captured to `logs/07_knowledge/console.log`):
  ```bash
  if [ -f tools/lint_tidyproteomics.R ]; then Rscript tools/lint_tidyproteomics.R code/07_knowledge.R && Rscript code/07_knowledge.R; else Rscript code/07_knowledge.R; fi
  ```
- **Canonical Expression Table Columns**:
  - `tidyproteomics` exports differential expression tables with the following exact column names:
    - `gene_name`, `protein`, `description`, `log2_foldchange` (⚠️ **CRITICAL**: spelled `log2_foldchange` with *no* underscore between 'fold' and 'change'), `p_value`, `adj_p_value`, `foldchange`, `candidate_reliability`, `imputation_bias`.
  - Prefer loading the curated Phase 6 expression table (`data/table_*_expression_*.tsv`) which already has FASTA `GN=` symbols resolved and reliability metrics attached.
- **Constructing & Testing Unbiased De Novo Functional Modules (`data/de_novo_modules.tsv`)**:
  - Rather than relying on isolated top up/down genes, define **2 to 5 biologically coherent functional modules** informed by `description` annotations, shared operon/family prefixes (e.g., `^srfA`, `^rps|^rpl`, `^flg|^fli`, `^col|^mmp`, `^psm|^pma`), or complete macromolecular complex definitions.
  - ⚠️ **Anti-Circularity Rule (No Cherry-Picking)**: Define module membership across the **entire unthresholded expression table** using functional description regexes (`desc_pattern`), gene family prefix regexes (`gene_pattern`), or complete complex/operon subunit lists—**never** cherry-pick individual volcano winners into a custom module just to inflate its Wilcoxon $p$-value.
  - ⚠️ **Script Resiliency & Zero-Exit Rule (DO NOT HALT)**:
    - **NEVER invoke `stop()` or halt execution when a candidate module has 0 members** (e.g., an intentional knockout subunit like `Elp3` absent from the quantified matrix). Module absence is a formal empirical finding (`direction = "ABSENT_FROM_MATRIX"`), not an error.
    - `write_tsv` to `data/de_novo_modules.tsv` **MUST ALWAYS EXECUTE**, even if 0 modules match, so that downstream checkpoint gates pass cleanly without retries or token burn.
  - Test each module's coordinate shift across the **entire unthresholded expression table** using a two-sided Wilcoxon rank-sum test (`wilcox.test` of member `log2_foldchange` vs. non-member background proteins), audit intra-module directional concordance (`pct_concordant`) and dispersion (`iqr_fc`) to detect uniform shifts vs. stoichiometric subunit uncoupling, and save the summary to `data/de_novo_modules.tsv`:
  ```r
  library(tidyproteomics)
  library(dplyr)
  library(readr)

  # Discover expression tables across all contrasts
  exp_files <- list.files("data", pattern = "^table_.*_expression_.*[.](tsv|csv)$", full.names = TRUE)
  exp_files <- exp_files[!grepl("_extract", exp_files)]

  # Fallback to exporting directly from tidyproteomics object if no tables exist
  if (length(exp_files) == 0 && file.exists("data/tidyproteomics_data.rds")) {
    tp_data <- readRDS("data/tidyproteomics_data.rds")
    analyses <- get_analyses(tp_data)
    if (nrow(analyses) > 0) {
      c_str <- analyses$comparison[1]
      exp_tbl <- rlang::inject(export_analysis(tp_data, !!rlang::parse_expr(c_str), .analysis = "expression"))
      write_tsv(exp_tbl, "data/table_proteins_expression_primary.tsv")
      exp_files <- c("data/table_proteins_expression_primary.tsv")
    }
  }

  # 1. Define unbiased functional modules by gene family prefix regex (gene_pattern) and description keywords (desc_pattern):
  module_defs <- list(
    "Ribosomal & Translational Machinery" = list(
      gene_pattern = "^rps|^rpl|^inf|^tsf|^fusA|^eef|^eif",
      desc_pattern = "ribosom|translation|elongation factor|initiation factor|tRNA ligase"
    ),
    "Histones & Chromatin Architecture" = list(
      gene_pattern = "^h1|^h2a|^h2b|^h3|^h4|^hmg",
      desc_pattern = "histone|chromatin|high mobility group"
    ),
    "Proteasome & Protein Quality Control" = list(
      gene_pattern = "^psm|^uba|^ube|^ubc|^rnf",
      desc_pattern = "proteasome|ubiquitin|ubiquitination|ring finger"
    ),
    "Molecular Chaperones & Heat Shock Response" = list(
      gene_pattern = "^hsp|^dna[kj]|^gro[el]|^clp|^htp",
      desc_pattern = "heat shock|chaperone|chaperonin|protease"
    ),
    "Target Perturbation Complex Subunits (e.g. Elongator)" = list(
      gene_pattern = "^elp[1-6]|^ikbkap|^kti12",
      desc_pattern = "elongator complex"
    )
  )

  # 2. Evaluate coordinate rank-sum shifts across unthresholded tables:
  all_rows <- list()
  for (f in exp_files) {
    df <- tryCatch(if (grepl("[.]tsv$", f)) read_tsv(f, show_col_types = FALSE) else read_csv(f, show_col_types = FALSE), error = function(e) NULL)
    if (is.null(df) || nrow(df) == 0) next
    contrast_name <- sub("^table_[^_]+_expression_", "", basename(f))
    contrast_name <- sub("[.](tsv|csv)$", "", contrast_name)

    fc_col <- intersect(c("log2_foldchange", "log2fc", "log2FoldChange"), names(df))[1]
    p_col <- intersect(c("adj_p_value", "padj", "p_value"), names(df))[1]
    gene_col <- intersect(c("gene_name", "protein", "identifier"), names(df))[1]
    desc_col <- intersect(c("description", "fasta_header"), names(df))[1]

    if (is.na(fc_col)) next
    df[[fc_col]] <- suppressWarnings(as.numeric(df[[fc_col]]))
    valid_df <- df[!is.na(df[[fc_col]]), ]
    if (nrow(valid_df) < 5) next

    genes <- if (!is.na(gene_col) && gene_col %in% names(valid_df)) as.character(valid_df[[gene_col]]) else character(nrow(valid_df))
    descs <- if (!is.na(desc_col) && desc_col %in% names(valid_df)) as.character(valid_df[[desc_col]]) else character(nrow(valid_df))

    for (m_name in names(module_defs)) {
      def <- module_defs[[m_name]]
      g_pat <- if (!is.null(def$gene_pattern)) def$gene_pattern else ""
      d_pat <- if (!is.null(def$desc_pattern)) def$desc_pattern else ""
      in_mod <- rep(FALSE, nrow(valid_df))
      if (nzchar(g_pat)) in_mod <- in_mod | grepl(g_pat, genes, ignore.case = TRUE)
      if (nzchar(d_pat)) in_mod <- in_mod | grepl(d_pat, descs, ignore.case = TRUE)

      n_members <- sum(in_mod)
      bg_count <- sum(!in_mod)

      if (n_members == 0) {
        all_rows[[length(all_rows) + 1]] <- tibble(
          term = "de_novo_module", annotation = m_name, contrast = contrast_name,
          size = 0L, enrichment = 0.0, iqr_log2fc = 0.0, pct_concordant = 0.0,
          direction = "ABSENT_FROM_MATRIX", p_value = NA_real_, adj_p_value = NA_real_,
          top_drivers = "None detected (size 0)", gene_names = ""
        )
        next
      }

      mod_fc <- valid_df[[fc_col]][in_mod]
      bg_fc <- valid_df[[fc_col]][!in_mod]
      med_fc <- median(mod_fc, na.rm = TRUE)
      iqr_fc <- IQR(mod_fc, na.rm = TRUE)
      dir_sign <- ifelse(med_fc >= 0, 1, -1)
      pct_concordant <- round(mean(sign(mod_fc) == dir_sign, na.rm = TRUE) * 100, 1)

      p_val <- NA_real_
      if (n_members >= 2 && bg_count >= 3) {
        wt <- suppressWarnings(wilcox.test(mod_fc, bg_fc))
        p_val <- wt$p.value
      }

      all_rows[[length(all_rows) + 1]] <- tibble(
        term = "de_novo_module", annotation = m_name, contrast = contrast_name,
        size = as.integer(n_members), enrichment = round(med_fc, 3), iqr_log2fc = round(iqr_fc, 3),
        pct_concordant = pct_concordant, direction = ifelse(med_fc >= 0, "UP", "DOWN"),
        p_value = p_val, adj_p_value = p_val,
        top_drivers = paste(head(unique(na.omit(genes[in_mod])), 5), collapse = ", "),
        gene_names = paste(unique(na.omit(genes[in_mod])), collapse = ", ")
      )
    }
  }

  canonical_cols <- c("term", "annotation", "contrast", "size", "enrichment", "iqr_log2fc", "pct_concordant", "direction", "p_value", "adj_p_value", "top_drivers", "gene_names")
  if (length(all_rows) == 0) {
    empty_df <- as.data.frame(matrix(ncol = length(canonical_cols), nrow = 0))
    colnames(empty_df) <- canonical_cols
    write_tsv(empty_df, "data/de_novo_modules.tsv")
  } else {
    mod_tbl <- bind_rows(all_rows) %>%
      group_by(contrast) %>%
      mutate(adj_p_value = ifelse(!is.na(p_value), p.adjust(p_value, method = "BH"), NA_real_)) %>%
      ungroup() %>%
      arrange(adj_p_value, p_value)
    print(head(mod_tbl, 15))
    write_tsv(mod_tbl, "data/de_novo_modules.tsv")
  }
  cat("PHASE_7_KNOWLEDGE_CHECKPOINT_PASS\n")
  ```
- Inspect the output and document all newly discovered complex/module trends (with exact member counts, median $\log_2\text{FC}$ shift, IQR dispersion, percent directional concordance, $p$-values, and individual member $\log_2\text{FC}$) as **new observations** in `docs/knowledge.md`.

---

#### 3. Developing First-Layer Biological Conclusions & Actionable Role Framing (Data-First Anchor Rule)
Synthesize your internal biomedical knowledge to explain the observed proteomic remodeling and establish why specific signatures and candidates merit manuscript inclusion, strictly adhering to the Data-First Anchor Rule:

1. **Mandatory Top-Candidate Coverage**:
   - The biological themes and hypotheses formulated in Phase 7 must directly reflect the dataset's strongest quantitative features.
   - **Every protein in the Top 5 Upregulated and Top 5 Downregulated lists** from `docs/observations.md` **must** be assigned to a biological theme/module or explicitly investigated. Never omit or skip the primary statistical drivers of the empirical dataset.
2. **Actionable Candidate Role Classification (Bidirectional)**:
   - Rather than treating top hits as a flat list of fold-changes, explicitly evaluate and classify leading upregulated *and* downregulated candidates into **Actionable Roles** connecting the brief context of `docs/experiment.md` to downstream utility:
     - **`Predictive Biomarker`**: High-magnitude responder (induced or repressed) with `ROBUST_QUANTITATIVE` reliability (or clean all-or-nothing `DETECTION_LIMITED_ON_OFF` switch) that serves as a diagnostic readout or signature of the condition/perturbation.
     - **`Druggable Target`**: Induced enzyme/transporter/receptor whose pharmacological inhibition blocks the phenotype, **OR** a significantly depleted/repressed metabolic bottleneck or survival factor whose loss creates a **synthetic lethal vulnerability** or calls for **agonist / metabolic supplementation rescue**.
     - **`Mechanistic Dependency`**: Direct physical interactor, complex subunit, operon partner, or substrate of the primary perturbation that explains how the signal propagates (including stoichiometric uncoupling where a target subunit drops while adaptors/substrates accumulate).
     - **`Compensatory Buffer`**: Secondary stress-response chaperone, efflux pump, antioxidant, or metabolic bypass induced to buffer cellular toxicity, **OR** a collapsed protective buffer whose depletion sensitizes the cell to damage.
3. **Actionable Biological Archetype Formulation**:
   - Synthesize how the opposing induced vs. repressed functional programs fit together into an overarching **Actionable Model** (e.g., *Metabolic Reallocation & Secondary Metabolite Activation*, *Proteostatic Collapse & Compensatory Chaperone Induction*, *Secretory/ECM Remodeling*, or *Predictive Disease Stratification Panel*).
4. **No Dismissal of Unexpected Hits**:
   - If a leading hit appears biologically unexpected, atypical, or uncharacterized in the studied tissue/organism (e.g., neuronal markers like `SYN1`, epidermal markers like `S100A7`, erythroid markers like `EPB42` or `HBG2`, or uncharacterized `y*` bacterial proteins):
     - **NEVER dismiss them** with a cursory single-sentence dismissal (e.g., "likely artifact" or "uncharacterized").
     - **Formulate testable biological hypotheses** explaining their altered detection: e.g., domain homology, co-transcribed operon neighbor, neuroendocrine differentiation, metaplasia, cell-lineage infiltration, or altered proteolysis/shedding.
     - Pair biological hypotheses with technical and detection-rate audits (checking unique peptide evidence and the Phase 6 `candidate_reliability` / `imputation_bias` tag).
5. **Primary vs. Secondary Perturbations & Complex Contextualization**:
   - Differentiate direct mechanistic consequences of the target perturbation from secondary cellular stress adaptations.
   - Identify multi-protein complexes, operon co-regulation, stoichiometric shifts, or functional modules represented among top altered features and tested in `data/de_novo_modules.tsv`.
6. **Hypothesis Evaluation & Anti-Hallucination Directives**:
   - Compare the observed remodeling directly against the expectations described in `docs/experiment.md`.
   - Strictly ground your conclusions in established biological mechanisms. Do NOT fabricate specific literature citations, author names, DOIs, or PMIDs. Clearly distinguish between established molecular mechanisms and working hypotheses.

---

#### 4. Formulating Downstream Literature Interrogation & Web-Search Keyphrases
Develop a structured set of targeted keyphrases to guide Phase 08 (`08_LITERATURE.md`) and Phase 09 (`09_WEBSEARCH.md`):
- **Entity Pairs & Operon/Complex Partners**: Specific pairs or clusters of altered proteins, prioritizing top empirical drivers (e.g. `"[Target Gene] [Top Dysregulated Gene] proteomics interaction"`).
- **Phenotypic / Pathway Themes**: Disease states, cell stress modalities, or functional cascades tested in `data/de_novo_modules.tsv`.
- **Actionable Target & Biomarker Queries**: Queries testing druggability, biomarker utility, or mechanistic dependency of top candidates in the model organism/tissue (e.g. `"[Candidate Gene] inhibitor vulnerability [Organism/Disease]"` or `"[Candidate Gene] biomarker [Condition]"`).
- **Hypothesis-Testing Queries for Unexpected or Uncharacterized Hits**: Targeted queries investigating unexpected or poorly annotated top candidates in the biological context.

---

#### 5. Direct Construction of `docs/knowledge.md`
Write `docs/knowledge.md` directly, referencing `docs/llm.md` for active model details. Ensure it begins with the standard document header immediately below the title:

```markdown
# Biological Knowledge Contextualization & First-Layer Conclusions

Created: YYYY-MM-DD HH:MM  
Author: PROVIDER | LLM-MODEL  
Agent: TidyProteomicsAgent vX.X.X  
R Package: tidyproteomics vX.X.X  
```

Organize the document strictly into the following structured sections:

1. **Primary Observations Synthesis**:
   - Concise summary of primary findings from `docs/observations.md` (quantified counts, target status, top altered proteins, and key enriched pathways).
2. **De Novo Functional Modules & Follow-Up Data Inquiries (`data/de_novo_modules.tsv`)**:
   - Document the functional modules/complexes constructed and tested in `code/07_knowledge.R`, including a Markdown table reporting each module's Name, Member Count (`size`), Median $\log_2\text{FC}$ Shift (`enrichment`), IQR Dispersion (`iqr_log2fc`), Directional Concordance (`pct_concordant`), Wilcoxon $p$/$q$-value (`p_value`, `adj_p_value`), and Leading Driver Genes (`top_drivers`), plus any specific follow-up candidate queries with exact $\log_2\text{FC}$ and $p$-values. Explicitly note whether modules exhibit coordinate shifts (`pct_concordant >= 65%`) or stoichiometric subunit uncoupling (`pct_concordant < 65%` or high `iqr_log2fc`).
3. **First-Layer Biological Conclusions (Data-First Anchor Rule)**:
   - Mechanistic interpretation of observed alterations based on internal biochemical and physiological knowledge.
   - **Explicit Top-Candidate Accounting**: Dedicated paragraphs or subsections explicitly evaluating **every candidate in the Top 5 Upregulated and Top 5 Downregulated lists**.
   - **Formulated Hypotheses for Unexpected Hits**: Concrete biological hypotheses addressing unexpected or unannotated leading candidates rather than dismissing them.
4. **Actionable Candidate Roles & Emerging Model of Cellular Response**:
   - Structured table and narrative classifying the leading candidate proteins into **Actionable Roles** (`Predictive Biomarker`, `Druggable Target`, `Mechanistic Dependency`, `Compensatory Buffer`), integrating their statistical reliability (`ROBUST_QUANTITATIVE` vs. `DETECTION_LIMITED_ON_OFF`) and functional module membership.
   - Synthesis of the emerging **Actionable Biological Model** (how the induced and repressed programs interact mechanistically in the context of `docs/experiment.md`).
5. **Emerging Hypotheses & Open Questions**:
   - Biological and translational questions raised by the empirical data that warrant external literature corroboration and experimental follow-up.
6. **Curated Keyphrases for Downstream Literature Interrogation & Web Search**:
   - Structured, ranked list of specific keyphrases and search queries to be executed in Phase 08 (Literature Database) and Phase 09 (Live Web Search).

---

#### 6. Phase Completion Gate
- [ ] **Checkpoint Gate**:
  1. `docs/observations.md` successfully ingested.
  2. `code/07_knowledge.R` executed cleanly (`exit 0`) with output logged to `logs/07_knowledge/console.log` (and `data/de_novo_modules.tsv` generated if de novo functional modules were tested).
  3. `docs/knowledge.md` exists on disk with non-zero size, containing first-layer conclusions, de novo module statistics, actionable candidate role classifications, and curated search keyphrases.
- [ ] **Complete Phase**:
  - Invoke `complete_phase(phaseName = "07_KNOWLEDGE", summary = "Internal knowledge contextualization complete in docs/knowledge.md with de novo functional modules, actionable candidate role classifications, and curated literature/web search keyphrases.")`
