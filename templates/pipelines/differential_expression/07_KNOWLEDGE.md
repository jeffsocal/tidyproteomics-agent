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
2. Rely on the `[WORKSPACE MANIFEST]` and `docs/experiment.md` already injected in your prompt above—do NOT waste turns calling `list_directory` or re-reading `docs/experiment.md`.

---

#### 2. De Novo Functional Module Discovery & Hypothesis Queries via `code/07_knowledge.R`
Whenever formal ontology enrichment in Phase 5 was bypassed (or to test specific protein complexes, operons, unthresholded co-factors, and pathway partners suggested by the top hits in `docs/observations.md`):
- Write and execute a targeted R script `code/07_knowledge.R` (output is automatically captured to `logs/07_knowledge/console.log`):
  ```bash
  if [ -f tools/lint_tidyproteomics.R ]; then Rscript tools/lint_tidyproteomics.R code/07_knowledge.R && Rscript code/07_knowledge.R; else Rscript code/07_knowledge.R; fi
  ```
- **Canonical Expression Table Columns**:
  - `tidyproteomics` exports differential expression tables with the following exact column names:
    - `gene_name`, `protein`, `description`, `log2_foldchange` (⚠️ **CRITICAL**: spelled `log2_foldchange` with *no* underscore between 'fold' and 'change'), `p_value`, `adj_p_value`, `foldchange`, `candidate_reliability`, `imputation_bias`.
  - Prefer loading the curated Phase 6 expression table (`data/table_*_expression_*.tsv`) which already has FASTA `GN=` symbols resolved and reliability metrics attached.
- **Constructing & Testing Unbiased De Novo Functional Modules (`data/de_novo_modules.tsv`)**:
  - Rather than relying on isolated top up/down genes, define **2 to 4 biologically coherent functional modules** informed by `description` annotations, shared operon/family prefixes (e.g., `^srfA`, `^rps|^rpl`, `^flg|^fli`, `^col|^mmp`, `^psm|^pma`), or complete macromolecular complex definitions.
  - ⚠️ **Anti-Circularity Rule (No Cherry-Picking)**: Define module membership across the **entire unthresholded expression table** using functional description regexes (`desc_pattern`), gene family prefix regexes (`gene_pattern`), or complete complex/operon subunit lists—**never** cherry-pick individual volcano winners into a custom module just to inflate its Wilcoxon $p$-value.
  - Test each module's coordinate shift across the **entire unthresholded expression table** using a two-sided Wilcoxon rank-sum test (`wilcox.test` of member `log2_foldchange` vs. non-member background proteins), audit intra-module directional concordance (`pct_concordant`) and dispersion (`iqr_fc`) to detect uniform shifts vs. stoichiometric subunit uncoupling, and save the summary to `data/de_novo_modules.tsv` so downstream phases (`08_WEBSEARCH`, `10_FIGURES`, `11_SYNTHESIS`) have statistically supported biological signatures:
  ```r
  library(tidyproteomics)
  library(dplyr)
  library(readr)

  # Resolve active contrast and primary identifier from persisted tidyproteomics object
  tp_data <- if (file.exists("data/tidyproteomics_data.rds")) readRDS("data/tidyproteomics_data.rds") else NULL
  analyses <- if (!is.null(tp_data)) get_analyses(tp_data) else data.frame()
  contrast_str <- if (nrow(analyses) > 0) analyses$comparison[1] else "<treatment>/<control>"
  c_clean <- gsub("[^A-Za-z0-9]", ".*", contrast_str)

  # Load curated Phase 6 expression table matched to contrast_str (or fallback to tidyproteomics export)
  exp_files <- list.files("data", pattern = "^table_.*_expression_.*[.](tsv|csv)$", full.names = TRUE)
  exp_files <- exp_files[!grepl("_extract", exp_files)]
  matched_files <- exp_files[grepl(c_clean, basename(exp_files), ignore.case = TRUE)]
  cand_files <- c(matched_files, setdiff(exp_files, matched_files))
  if (length(cand_files) > 0) {
    exp_tbl <- if (grepl("[.]tsv$", cand_files[1])) read_tsv(cand_files[1], show_col_types = FALSE) else read_csv(cand_files[1], show_col_types = FALSE)
  } else {
    exp_tbl <- rlang::inject(export_analysis(tp_data, !!rlang::parse_expr(contrast_str), .analysis = "expression"))
  }

  # 1. Define unbiased functional modules by gene family prefix regex (gene_pattern) and description keywords (desc_pattern):
  # Replace patterns below with biological modules relevant to the dataset & docs/experiment.md!
  module_defs <- list(
    "Module A Name (e.g. Surfactin & Nonribosomal Peptide Synthesis)" = list(
      gene_pattern = "^srfA|^pps|^fen",
      desc_pattern = "surfactin|non-ribosomal|polyketide|siderophore"
    ),
    "Module B Name (e.g. Ribosomal & Translational Machinery)" = list(
      gene_pattern = "^rps|^rpl|^inf|^tsf|^fusA",
      desc_pattern = "ribosomal|translation|elongation factor|tRNA ligase"
    ),
    "Module C Name (e.g. Cell Envelope & Stress Chaperones)" = list(
      gene_pattern = "^dnaK|^groE|^clp|^htpG",
      desc_pattern = "chaperone|heat shock|protease|peptidoglycan|cell wall"
    )
  )

  # 2. Evaluate coordinate rank-sum shifts and directional concordance across the unthresholded proteome:
  mod_rows <- lapply(names(module_defs), function(m_name) {
    def <- module_defs[[m_name]]
    g_pat <- if (!is.null(def$gene_pattern)) def$gene_pattern else ""
    d_pat <- if (!is.null(def$desc_pattern)) def$desc_pattern else ""
    in_mod <- (!is.na(exp_tbl$gene_name) & nzchar(g_pat) & grepl(g_pat, exp_tbl$gene_name, ignore.case = TRUE)) |
              (!is.na(exp_tbl$description) & nzchar(d_pat) & grepl(d_pat, exp_tbl$description, ignore.case = TRUE))
    in_mod <- in_mod & !is.na(exp_tbl$log2_foldchange)
    bg <- !in_mod & !is.na(exp_tbl$log2_foldchange)
    if (sum(in_mod) < 2 || sum(bg) < 5) return(NULL)

    mod_df <- exp_tbl[in_mod, ] %>% arrange(adj_p_value, desc(abs(log2_foldchange)))
    wt <- suppressWarnings(wilcox.test(mod_df$log2_foldchange, exp_tbl$log2_foldchange[bg]))
    med_fc <- median(mod_df$log2_foldchange, na.rm = TRUE)
    iqr_fc <- IQR(mod_df$log2_foldchange, na.rm = TRUE)
    dir_sign <- ifelse(med_fc >= 0, 1, -1)
    pct_concordant <- round(mean(sign(mod_df$log2_foldchange) == dir_sign, na.rm = TRUE) * 100, 1)

    tibble(
      term = "de_novo_module",
      annotation = m_name,
      contrast = contrast_str,
      size = nrow(mod_df),
      enrichment = round(med_fc, 3),
      iqr_log2fc = round(iqr_fc, 3),
      pct_concordant = pct_concordant,
      direction = ifelse(med_fc >= 0, "UP", "DOWN"),
      p_value = wt$p.value,
      adj_p_value = wt$p.value,
      top_drivers = paste(head(unique(na.omit(mod_df$gene_name)), 5), collapse = ", "),
      gene_names = paste(unique(na.omit(mod_df$gene_name)), collapse = ", ")
    )
  })
  mod_tbl <- bind_rows(mod_rows)
  if (nrow(mod_tbl) > 0) {
    mod_tbl <- mod_tbl %>% mutate(adj_p_value = p.adjust(p_value, method = "BH")) %>% arrange(p_value)
    print(mod_tbl)
    write_tsv(mod_tbl, "data/de_novo_modules.tsv")
  }
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

#### 4. Formulating Downstream Web-Search Keyphrases
Develop a structured set of targeted keyphrases to guide Phase 08 (`08_WEBSEARCH.md`):
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
6. **Curated Keyphrases for Downstream Web Search**:
   - Structured, ranked list of specific keyphrases and search queries to be executed in Phase 08.

---

#### 6. Phase Completion Gate
- [ ] **Checkpoint Gate**:
  1. `docs/observations.md` successfully ingested.
  2. `code/07_knowledge.R` executed cleanly (`exit 0`) with output logged to `logs/07_knowledge/console.log` (and `data/de_novo_modules.tsv` generated if de novo functional modules were tested).
  3. `docs/knowledge.md` exists on disk with non-zero size, containing first-layer conclusions, de novo module statistics, actionable candidate role classifications, and curated web search keyphrases.
- [ ] **Complete Phase**:
  - Invoke `complete_phase(phaseName = "07_KNOWLEDGE", summary = "Internal knowledge contextualization complete in docs/knowledge.md with de novo functional modules, actionable candidate role classifications, and curated web search keyphrases.")`
