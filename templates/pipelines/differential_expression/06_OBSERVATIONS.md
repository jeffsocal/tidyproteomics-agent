---
tools: [tpa_compile_summary, tpa_query_expression, tpa_query_enrichment, tpa_inspect, tpa_summary, read_file, write_file, edit_file, execute_command, complete_phase, fail_phase]
---

### Phase 6: Primary Data-Derived Observations & Extraction

In this phase, you (the LLM) will extract and synthesize the primary empirical observations from the analyzed dataset across all evaluated contrasts.

Proceed deterministically in 3 concise turns using the MCP toolset:

---

#### 1. Deterministic Extraction via `tpa_compile_summary`
> ⚡ **CRITICAL ONE-SHOT WORKFLOW DIRECTIVE**:
> In this phase, do NOT write massive R scripts from scratch or burn turns guessing column headers. Proceed deterministically:
> 1. **Turn 1 (Deterministic Compilation)**: Invoke `tpa_compile_summary(target_gene = "<TARGET>")` (e.g. `target_gene = "VCP"` or omit if untargeted).
>    - This tool automatically extracts dataset dimensions, quality checkpoint status, target perturbation efficacy, strict/relaxed threshold counts, top 10 upregulated and top 10 downregulated candidates with imputation-risk classification (`imputation_bias`, `candidate_reliability`, `imputation_delta`), and multi-category pathway enrichments with resolved Reactome names.
>    - It saves pre-formatted markdown tables directly to `docs/observations_summary.md`.
>    - It automatically exports the authoritative, reproducible R script `code/06_observations.R`.
>    - *(Optional query)*: If specific biomarker candidates or functional pathways require deeper inspection, query them directly via `tpa_query_expression` or `tpa_query_enrichment`.
> 2. **Turn 2 (Assemble `docs/observations.md`)**: Inspect `docs/observations_summary.md` via `read_file(filePath = "docs/observations_summary.md")` and construct `docs/observations.md` in a single pass following the document structure below.
>    - **Expression Header Verification**: Inspect the first 2 lines of exported expression data (e.g. `read_file(filePath = "data/table_expression_*.tsv", EndLine = 2)`) to confirm available columns (`gene_name`, `description`). Never claim symbols or descriptions are attached if these columns are missing or blank.
>    - **Contrast Completeness Mandate**: The summary for EVERY evaluated contrast must be copied in full from `tpa_compile_summary` (Strict, Relaxed, and Nominal counts for each contrast, e.g. `s3/s1`). Never omit threshold tiers or contrasts; if a metric is absent from tool output, explicitly tag it `TOOL_OUTPUT_MISSING`.
> 3. **Turn 3 (Phase Gate Verification)**: Verify checkpoint artifacts (`code/06_observations.R`, `docs/observations_summary.md`, `docs/observations.md`), verify `Rscript code/06_observations.R` passes with `PHASE_6_EXTRACTION_CHECKPOINT_PASS`, and invoke `complete_phase`.

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
   - **Authoritative Feature Accounting**: Quote numbers strictly matching `data/table_feature_accounting.tsv` or `tpa_inspect(what = "accounting")`:
     - Total retained features in dataset (e.g. 1,941 proteins).
     - Quantifiable features with $\ge 1$ observed abundance across samples (e.g. 1,908 proteins).
     - Zero-quantification background features (e.g. 33 proteins with 0 intensity across all samples).
     - Modeled identifiers in each evaluated contrast (e.g. 1,640 modeled in `surfactin/control`).
     - Unmodeled features breakdown: zero-quant background vs condition-exclusive dropouts.
     - *(Single-Truth Policy: Raw ingest rows e.g. 2,209 are mentioned only in Methods when describing contaminant filters; all other sections quote the post-filter total 1,941).*
2. **Target Efficacy / Leading Perturbation Status**:
   - Quantitative breakdown of the primary target (if targeted) or leading master regulator / key functional hub (if untargeted screening): Gene Symbol / Accession, $\log_2\text{FC}$, fold change, nominal $p$-value, adjusted $q$-value, imputation risk tag, and percent change.
   - Comparison with experimental expectations stated in `docs/experiment.md`.
3. **Top Significantly Upregulated Proteins**:
   - Structured markdown table: Rank, Identifier (Gene Symbol / Accession), Protein, Description, $\log_2\text{FC}$, nominal $p$-value, adjusted $q$-value, Imputation Risk (`imputation_bias`: HIGH, MODERATE, LOW), Candidate Reliability (`candidate_reliability`: ROBUST_QUANTITATIVE, DETECTION_LIMITED_ON_OFF, HIGH_UNCERTAINTY), and $\Delta$ (`imputation_delta`). (Directly copy pre-formatted markdown table from `docs/observations_summary.md`, which includes both $p$-value and $q$-value). Prominently tag candidates so detection/missingness-driven shifts are distinguished from continuous shifts.
4. **Top Significantly Downregulated Proteins**:
   - Structured markdown table: Rank, Identifier (Gene Symbol / Accession), Protein, Description, $\log_2\text{FC}$, nominal $p$-value, adjusted $q$-value, Imputation Risk (`imputation_bias`: HIGH, MODERATE, LOW), Candidate Reliability (`candidate_reliability`: ROBUST_QUANTITATIVE, DETECTION_LIMITED_ON_OFF, HIGH_UNCERTAINTY), and $\Delta$ (`imputation_delta`). (Directly copy pre-formatted markdown table from `docs/observations_summary.md`, which includes both $p$-value and $q$-value).
5. **Top Significant Pathway Enrichments**:
   - Summary table of significant terms across analyzed annotation categories (Category/Term, Annotation Name, Direction / Enrichment Score, $q$-value, Leading Driver Genes [top 3–5 member gene symbols from `member_genes`, falling back to `member_proteins` if symbols are absent], Leading-Edge Count). (Directly copy pre-formatted markdown table from `docs/observations_summary.md`).
   - Primary biological themes identified across contrasts based directly on statistical enrichment and driven by specific leading-edge member genes. Note that in tidyproteomics, Wilcoxon score sign indicates direction relative to background: positive (+) = shifted higher in treatment; negative (-) = shifted lower in treatment.
6. **Primary Empirical Data Summary**:
   - Objective, factual synthesis of data-derived observations directly grounded in the quantitative tables and figures.
   - Detection-rate sensitivity discussion: explicitly evaluate whether top candidates are driven by continuous abundance changes (LOW imputation bias) or limit-of-detection presence/absence shifts (HIGH imputation bias).
   - Pure empirical observation: no premature speculation or external literature synthesis (this is developed systematically in Phases 7, 8, and 9).

---

#### 3. Critical Constraints
- **Absolute Data Grounding**: Every numerical value ($\log_2\text{FC}$, $p$-value, $q$-value, feature count, pathway score) MUST strictly match `docs/observations_summary.md` and the exported CSV/TSV tables. Never fabricate or extrapolate numbers.
- **Scientific Precision Formatting (No Exact Zeros)**: Format all statistical significance columns ($p$-value, $q$-value) smaller than $1 \times 10^{-4}$ using scientific notation (e.g., `3.99e-10` rather than `0.0000000` or `0.0e+00`). Tables must never report misleading "exact zero" values.
- **Human-Readable Pathway Resolution**: Resolve bare Reactome accession IDs (e.g., `R-HSA-977606`, `R-HSA-166663`) to human-readable biological pathway names (e.g., `Regulation of Complement cascade`, `Initial triggering of complement`) via `resolve_reactome_ids()`. Never report `"identifier unresolved in export"`.
- **Sanitized Delimiters & Missing Identifier Fallback**: Strip redundant delimiter characters (avoid `;;` or trailing semicolons) and provide sensible fallbacks for unmapped gene symbols (e.g., fallback to the first word of the protein description or canonical accession rather than `NA`).
- **Pure Empirical Scope**: Do not synthesize external literature in this phase. Document what the mass spectrometry data directly demonstrates.

---

#### 4. Phase Completion Gate
- [ ] **Checkpoint Gate**:
  1. `code/06_observations.R` executed with status code 0 and output logged to `logs/06_observations/console.log`.
  2. `logs/06_observations/console.log` ends with `PHASE_6_EXTRACTION_CHECKPOINT_PASS`.
  3. `docs/observations_summary.md` exists on disk with non-zero size containing formatted tables.
  4. `docs/observations.md` exists on disk with non-zero size and conforms to the structure above.
- [ ] **Complete Phase**:
  - Invoke `complete_phase(phaseName = "06_OBSERVATIONS", summary = "Primary data-derived observations extracted and compiled in docs/observations.md with verified biomarker metrics, markdown tables, and pathway enrichment summaries.")`
