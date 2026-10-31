---
tools: [tpa_health, tpa_input_audit, tpa_ingest_config, tpa_export_config, tpa_load, tpa_inspect, tpa_summary, tpa_plot, tpa_export_state, tpa_set_workspace]
---

### Phase 1: Data Ingestion & Exploratory Quality Inspection

Execute this phase using live `tpa_*` MCP tools in memory (or execute `code/01_inspect.R` if offline). All tool executions and outputs are automatically recorded to `logs/01_inspect/console.log`. Upon satisfying all exploratory checkpoints, invoke `tpa_export_state` to generate `code/01_inspect.R` and save `data/tidyproteomics_data.rds`. You must strictly enforce all checkpoints below.

---

> [!TIP]
> **Consolidated Inspection Workflow (Fast-Path)**:
> - `tpa_load` automatically prints the dataset `overview` state card (origin platform, analyte, quantified entity count, active assay, missingness %, and operation count) upon loading—do **NOT** call `tpa_inspect(what = "overview")` immediately after `tpa_load`.
> - Because the `overview` state card truncates sample names when `> 6` samples exist and omits the raw file-to-sample mapping table and ontology term list, run `tpa_inspect(what = "experiments")` (to inspect all raw files, sample names, replicates, and batch/donor structure) and `tpa_inspect(what = "annotation_terms")` (to list active functional ontology categories).

#### Phase 1.1: Pre-Ingestion Raw Header Audit & Data Ingestion
> [!NOTE]
> **Advisory Nature of `tpa_input_audit`**: `tpa_input_audit` is an advisory diagnostic tool to help spot MaxLFQ vs raw intensity columns and unmapped annotations. If `tpa_input_audit` encounters format anomalies or reports zero matched columns, proceed directly to `tpa_load()`. A successful `tpa_load()` that imports quantified entities is the definitive proof of dataset ingestion integrity. Phase 1 must NEVER invoke `fail_phase` for header audit warnings or unmapped columns if `tpa_load()` succeeds.

- [ ] **Pre-Ingestion Header & Annotation Audit**:
  - Run `tpa_input_audit(source = "{{PATH_TO_DATA_FILE}}", platform = "{{PLATFORM}}", analyte = "{{ANALYTE}}")` to inspect raw headers against the active platform configuration regexes (remote `http://` or `https://` URLs are automatically staged into `data/raw/`).
  - Review the audit table and actionable suggestions:
    1. **Identifier Check**: Confirm that `identifier_column` (e.g. `Protein IDs`, `Accession`) is matched and properly captures protein/peptide accessions.
    2. **Quantitative Layer & Embedded Annotations Check**: Check whether `quantitative_columns` matches raw `Intensity` or `LFQ intensity`, and whether unmapped annotations (e.g. `Gene names`, `Protein names`, `Fasta headers`) are suggested:
       - If `LFQ intensity` columns are present and Section 2 of `docs/experiment.md` specifies LFQ / MaxLFQ (or if unmapped annotations are suggested), run `tpa_ingest_config(platform = "{{PLATFORM}}", analyte = "{{ANALYTE}}", file_name = "{{PATH_TO_DATA_FILE}}", action = "auto_fix", use_lfq = TRUE)` (or set `use_lfq = FALSE` if raw non-LFQ intensity is explicitly required by Section 2) to auto-configure the quantitative regex and all detected annotation mappings into a local `<platform>_<analyte>.tsv`.
- [ ] **Ingest Quantitative Dataset (`tpa_load`)**:
  - Invoke `tpa_load(source = "{{PATH_TO_DATA_FILE}}", platform = "{{PLATFORM}}", analyte = "{{ANALYTE}}")` substituting concrete values from `docs/experiment.md` (pass `config = "<platform>_<analyte>.tsv"` if a custom configuration was generated).
  - Remote URLs (`http://` or `https://`) are automatically staged to `data/raw/` and imported; `.rds` files (or `platform = "tidyproteomics"` / `"rds"`) are loaded directly into memory.
- [ ] **Ingestion Diagnostics & Custom Mapping Recovery (Self-Healing Fallback)**:
  - If `tpa_load` fails with `"... not retaining values, check import regex"` or missing column errors:
    1. Re-run `tpa_input_audit` to see exact column regex mismatches.
    2. Adjust regex patterns via `tpa_ingest_config(platform = "{{PLATFORM}}", analyte = "{{ANALYTE}}", action = "set", ...)`.
    3. Re-run `tpa_load(source = "<raw_staged_file>", platform = "{{PLATFORM}}", analyte = "{{ANALYTE}}", config = "<platform>_<analyte>.tsv")`.
- [ ] **Full Sample-Table & Annotation Topology Discovery**:
  - Extract core dataset topology (origin platform, analyte, entity count, missingness %, and upstream operation count) directly from the `tpa_load` state card output.
  - Run `tpa_inspect(what = "experiments")` to inspect the complete sample-to-file table (ensuring all sample groups are visible even when `> 6` raw sample columns exist, and identifying replicate structure, paired donors, or batch tags).
  - Run `tpa_inspect(what = "annotation_terms")` (and `tpa_inspect(what = "operations")` if operation count $> 0$) to record available functional ontology categories and any pre-existing normalization/imputation steps.
- [ ] **Checkpoint 1.1**: Verify that the dataset state card, complete `experiments` sample table, and `annotation_terms` are recorded in stdout and `logs/01_inspect/console.log`.

#### Phase 1.2: Sample Quality, Replicate QC & Overlap Profiling
- [ ] Profile sample preparation contaminants using `tpa_summary(contamination = "CRAP")`.
- [ ] Run sample-level quality metrics (quantified counts, quantifiable fraction, and replicate CVs) using `tpa_summary(by = "sample")`.
- [ ] Generate identification counts diagnostic plot using `tpa_plot(type = "counts")` (automatically saved to `data/`).
- [ ] **Qualitative Binary Switch Detection & Feature Overlap Profiling**:
  - If discovered sample groups in `experiments` already reflect clean biological condition cohorts ($\le 5$ groups), inspect condition-unique presence/absence using `tpa_plot(type = "venn")` or `tpa_plot(type = "euler")` (saved to `data/`). If sample names are ungrouped individual sample/batch labels that require pooling in Phase 2.1b, defer `venn`/`euler` plotting to Phase 2.1b after sample recoding.
- [ ] **Checkpoint 1.2**: Verify that contaminant metrics, sample-level replicate CVs, and identification count plots are recorded in `logs/01_inspect/console.log`.

#### Phase 1.3: State Persistence & Phase Gate Verification
- [ ] Persist the imported dataset and generate reproducible R script:
  - Invoke `tpa_export_state(rds_path = "data/tidyproteomics_data.rds", script_path = "code/01_inspect.R")`.
- [ ] **Checkpoint 1.3 (Phase Gate & Log Verification)**:
  1. `logs/01_inspect/console.log` exists on disk with non-zero file size.
  2. `data/tidyproteomics_data.rds` and `code/01_inspect.R` exist on disk with non-zero file size.
  3. Complete sample inventory (`experiments`) and functional annotation terms (`annotation_terms`) are verified in log.
  4. Count diagnostic plot (`data/plot_proteins_counts.png` or `data/plot_peptides_counts.png`) exists in `data/` with non-zero file size (along with optional `data/plot_*_venn.png` or `data/plot_*_euler.png` if generated).

#### Phase 1.4: Experimental Alignment, Contrast Scaffolding & Hypothesis Verification
- [ ] **Inspect User Hypothesis & Parameters (`docs/experiment.md` Sections 1 & 2)**:
  - Extract the working hypothesis, biological model, and investigated target(s) / discovery scope from Sections 1 and 2.
  - **CRITICAL**: Never overwrite, modify, or delete Sections 1 or 2 of `docs/experiment.md` (reserved strictly for researcher input).
- [ ] **Sample Group, Replication & Batch Pattern Audit (`experiments`)**:
  - Inspect the discovered sample names and file mappings from `tpa_inspect(what = "experiments")`.
  - Check whether sample labels contain technical batch suffixes (e.g. `_batch\d+`, `_plate\d+`, `_run\d+`, `_rep\d+`), duplicate technical injections/cuts from the same biological donor (which must be distinguished from independent biological replicates to avoid pseudoreplication), or compound tissue/condition delimiters.
- [ ] **Proactive Section 3 Scaffolding in `docs/experiment.md`**:
  - Inspect Section 3 (`## 3. Bioinformatics Design`) in `docs/experiment.md`.
  - If Section 3 contains `*(Pending Phase 1 data ingestion)*`, is missing, or contains unconfigured tables:
    - **Single-Call Consolidated Edit (Zero Multi-Turn Fragmentation)**: Update the entire Section 3 block (`### A.` through `### F.`) in **one single `replace_file_content` call** (matching from `### A. Discovered Sample Groups in Dataset` through `### F. Confounded Batch & Exploratory Comparison Gate`), rather than splitting into separate edits across multiple turns.
    - **Scaffold Section 3**: Populate Section 3 of `docs/experiment.md` directly using standardized visual badges and enforce confirmation checks for all `3.A`–`3.F` subtasks:
      1. **Section 3.A**: Label with `ℹ️ [AUTO-GENERATED REFERENCE - READ ONLY]:` and list:
         - Discovered biological subjects vs. raw files count (`<N>` unique subjects across `<M>` raw files).
         - Paired donor detection (flagging subjects detected across multiple condition groups).
         - Cross-batch bridge samples (flagging subjects acquired across multiple batches).
         - Technical replicates / cuts (flagging subjects with duplicate injections/cuts within a group so technical duplicates are not confused with independent biological replicates).
         - Discovered sample groups table with raw file counts and unique subject counts.
         - Confirmation toggle: `- **Confirm Discovered Sample Groups**: FALSE`.
      2. **Section 3.B**: Label with `👉 [USER ACTION REQUIRED - CONFIGURE & CONFIRM NORMALIZATION STRATEGY]:` and scaffold the **Quantitative Normalization Strategy**:
         - By default, set `- **Normalization Methods**: default` (which benchmarks linear models `scaled, median, linear, limma` plus `loess`), `- **Normalization Subset Filter**: NONE`, and `- **Confirm Normalization Strategy**: FALSE`.
         - If Section 2 explicitly requests `randomforest` or `svm` normalization, include it in `- **Normalization Methods**`.
         - If Section 2 requests normalizing on a reference sub-population (e.g. ribosomal proteins or non-mitochondrial proteins), set `- **Normalization Subset Filter**: <subset_expression>` and `- **Normalization Methods**: scaled, median, linear, svm`.
      3. **Section 3.C**: Label with `👉 [USER ACTION REQUIRED - CONFIRM IMPUTATION METHOD]:` and scaffold the **Missing Value Imputation Strategy** based on `docs/experiment.md` Section 2 and the Phase 1.2 missingness/overlap audit (per Karpievitch et al., *BMC Bioinformatics* 2012):
         - **Default (`randomforest_grouped`)**: Set `- **Imputation Method**: randomforest_grouped` (`impute.randomforest, method = 'matrix', group_by_sample = TRUE`) and `- **Confirm Imputation Strategy**: FALSE` when missingness is predominantly sporadic across replicates (MAR).
         - **Intentional Knockout / Suppression / MNAR Switch Override (`min_column`)**: If Section 2 describes an intentional gene knockout/knockdown (CRISPR KO, siRNA, degrader/PROTAC), targeted suppression, affinity pull-down (IP-MS), or acute binary switch where condition-exclusive features must be retained in `limma` via replicate LOD, set `- **Imputation Method**: min_column` (`base::min, method = 'column'`) and `- **Confirm Imputation Strategy**: FALSE`.
         - **Complete-Case Bypass (`none`)**: If 0% missing values are detected (or imputation was applied upstream), set `- **Imputation Method**: none` and `- **Confirm Imputation Strategy**: TRUE`.
      4. **Section 3.D**: Label with `👉 [USER REVIEW & EDIT TABLE]:`. If technical batch or replicate prefixes/suffixes are detected (e.g. `st1_0..st3_0`, `st1_surfactin..st3_surfactin`, `m1..m3`, or `active_necrotic granuloma_batch5..9`), provide a complete **Sample Group Renaming & Pooling Map** table mapping every raw sample group to a clean pooled cohort name, and add:
         - `- **Reassign Sample Names According to Pooling Map**: TRUE` (or `FALSE` if raw sample groups are already clean).
         - `- **Confirm Sample Pooling Map**: FALSE` as the scaffolded default awaiting researcher review.
      5. **Section 3.E**: Label with `👉 [USER ACTION REQUIRED - DEFINE & CONFIRM TARGET CONTRASTS]:` and suggest logical **Target Contrasts** structured as `<treatment>/<control>` (so $\log_2\text{FC} > 0$ reflects induction in treatment/perturbation), setting `Status: PENDING` and `- **Confirm Target Contrasts**: FALSE`.
      6. **Section 3.F**: Label with `⚠️ [PRE-FLIGHT GATE DECISION - EXPOSE ONLY IF BATCH CONFOUNDING DETECTED]:`. If disease/treatment condition is confounded with batch across cohorts (e.g. healthy only in batch 8, disease in batches 5/6/9), explicitly document the confounding in HTML comments, set `- **Batch Confounding Detected**: TRUE`, `- **Proceed With Potential Batch Confounding**: FALSE`, and `- **Confirm Batch Confounding Authorization**: FALSE` to expose this gate for researcher review. If NO batch confounding is detected, set `- **Batch Confounding Detected**: FALSE`. Setting these defaults does NOT fail or halt Phase 1.
  - If Section 3 already contains user-customized renaming, contrast definitions, or a confirmed imputation strategy, preserve them exactly!
  - **Enforce Clean Boolean/Enum Values & Badge Preservation**: Keep all configuration lines strictly as clean tokens (`TRUE`, `FALSE`, or the method identifier) without appending conversational notes. Place any rationale inside HTML comments `<!-- ... -->`.
- [ ] **Checkpoint 1.4 (Design Alignment Gate)**:
  - Verify that discovered sample groups, alignment with `docs/experiment.md`, and Section 3 (`3.A`–`3.F`) scaffolding are complete.
  - Phase 1 must NEVER invoke `fail_phase` for pre-ingestion audit warnings, unmapped columns, discovered groups, batch suffixes, or confounding if `tpa_load` loads the data with quantified entities.
- [ ] **Complete Phase (Automated Blackboard Recording)**:
  - Do NOT manually edit `docs/notes.md` via file tools; the orchestrator automatically records your `complete_phase` summary into `docs/notes.md`.
  - Invoke `complete_phase` with a comprehensive summary including quantified entity count, sample inventory, proposed/confirmed contrast groups, baseline quality stats, and detected upstream operations:
    `complete_phase(phaseName = "01_INSPECT", summary = "Data ingestion complete (<N> proteins across <M> samples). Audited operations history (normalization/imputation status) and full experiments table, scaffolded study design in docs/experiment.md Section 3 (3.A-3.F), generated count diagnostic plot, and persisted data/tidyproteomics_data.rds.")`
