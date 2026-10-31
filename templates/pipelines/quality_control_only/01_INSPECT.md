---
tools: [tpa_health, tpa_input_audit, tpa_ingest_config, tpa_export_config, tpa_load, tpa_inspect, tpa_summary, tpa_plot, tpa_export_state, tpa_set_workspace]
---

### Phase 1: Data Ingestion & Exploratory Quality Inspection

Execute this phase using live `tpa_*` MCP tools in memory (or execute `code/01_inspect.R` if offline). All tool executions and outputs are automatically recorded to `logs/01_inspect/console.log`. Upon satisfying all exploratory checkpoints, invoke `tpa_export_state` to generate `code/01_inspect.R` and save `data/tidyproteomics_data.rds`. You must strictly enforce all checkpoints below.

---

> [!TIP]
> **Consolidated Inspection Workflow (Fast-Path)**:
> Ingest data with `tpa_load` and immediately run `tpa_inspect(what = "overview")`.
> In tidyproteomics, `overview` returns the complete dataset topology in a single call: file count, sample group names, total protein counts, dynamic range, percent missingness, operations history (normalization/imputation status), and all functional annotation terms.
> **DO NOT** make redundant exploratory calls for `operations`, `quant_names`, `sample_names`, or `annotation_terms` — `overview` already supplies all of them.

#### Phase 1.1: Pre-Ingestion Raw Header Audit & Data Ingestion
> [!NOTE]
> **Advisory Nature of `tpa_input_audit`**: `tpa_input_audit` is an advisory diagnostic tool to help spot MaxLFQ vs raw intensity columns and unmapped annotations. If `tpa_input_audit` encounters format anomalies or reports zero matched columns, proceed directly to `tpa_load()`. A successful `tpa_load()` that imports quantified entities is the definitive proof of dataset ingestion integrity. Phase 1 must NEVER invoke `fail_phase` for header audit warnings or unmapped columns if `tpa_load()` succeeds.

- [ ] **Pre-Ingestion Header & Annotation Audit**:
  - Run `tpa_input_audit(source = "{{PATH_TO_DATA_FILE}}", platform = "{{PLATFORM}}", analyte = "{{ANALYTE}}")` to inspect raw headers against the active platform configuration regexes (remote `http://` or `https://` URLs are automatically staged into `data/raw/`).
  - Review the audit table and actionable suggestions:
    1. **Identifier Check**: Confirm that `identifier_column` (e.g. `Protein IDs`, `Accession`) is matched and properly captures protein accessions.
    2. **Quantitative Layer & Embedded Annotations Check**: Check whether `quantitative_columns` matches raw `Intensity` or `LFQ intensity`, and whether unmapped annotations (e.g. `Gene names`, `Protein names`, `Fasta headers`) are suggested:
       - If `LFQ intensity` columns are present and Section 2 of `docs/experiment.md` specifies LFQ / MaxLFQ (or if unmapped annotations are suggested), run `tpa_ingest_config(platform = "{{PLATFORM}}", analyte = "{{ANALYTE}}", file_name = "{{PATH_TO_DATA_FILE}}", action = "auto_fix", use_lfq = TRUE)` (or set `use_lfq = FALSE` if raw non-LFQ intensity is explicitly required by Section 2) to auto-configure the quantitative regex and all detected annotation mappings into a local `<platform>_<analyte>.tsv`.
- [ ] Ingest the quantitative dataset using `tpa_load`:
  - Provide `source = "{{PATH_TO_DATA_FILE}}"`, `platform = "{{PLATFORM}}"`, and `analyte = "{{ANALYTE}}"` substituting actual values from `docs/experiment.md`.
  - If a tailored configuration was created (`<platform>_<analyte>.tsv`), pass `config = "<platform>_<analyte>.tsv"` (or rely on automatic local config discovery).
  - If `source` is a remote URL (starts with `http://` or `https://`), `tpa_load` automatically stages the file to `data/raw/` and imports it.
  - If `source` is an `.rds` file (or `platform` is `"tidyproteomics"` / `"rds"`), `tpa_load` ingests the pre-processed R data object directly into memory.
- [ ] **Ingestion Diagnostics & Custom Mapping Recovery (Self-Healing Fallback)**:
  - If `tpa_load` fails with `"... not retaining values, check import regex"` or missing column errors:
    1. Re-run `tpa_input_audit` to see exact column regex mismatches.
    2. Adjust regex patterns via `tpa_ingest_config(platform = "{{PLATFORM}}", analyte = "{{ANALYTE}}", action = "set", ...)`.
    3. Re-run `tpa_load(source = "<raw_staged_file>", platform = "{{PLATFORM}}", analyte = "{{ANALYTE}}", config = "<platform>_<analyte>.tsv")`.
- [ ] **Consolidated Topology & Operations Discovery**:
  - Run `tpa_inspect(what = "overview")` to verify core object state in stdout and log.
  - Extract all essential topology metrics directly from the `overview` printout:
    - Origin platform and analyte.
    - Composition: raw file count and sample groups (`ctl`, `treatment`, etc.).
    - Quantitation: protein/peptide counts, dynamic range, and percent missingness.
    - Upstream operations: detected normalization (`*normalized`) and imputation (`*imputed`) status.
    - Functional annotations: all active ontology categories.
  - *(Note: Running `overview` fulfills operations audit, quant names, sample group discovery, and annotation terms simultaneously. Do NOT run separate single-property calls).*
- [ ] **Checkpoint 1.1**: Verify that `overview` prints the complete quantitative data object topology to stdout.

#### Phase 1.2: Sample Quality, Replicate QC & Overlap Profiling
- [ ] Profile sample preparation contaminants using `tpa_summary(contamination = "CRAP")`.
- [ ] Run sample-level quality metrics using `tpa_summary(by = "sample")`.
- [ ] Generate identification counts diagnostic plot using `tpa_plot(type = "counts")` (automatically saved to `data/`).
- [ ] **Qualitative Binary Switch Detection & Feature Overlap Profiling**:
  - Inspect condition-unique presence/absence (proteins detected exclusively in one biological group vs another prior to imputation) using `tpa_plot(type = "venn")` or `tpa_plot(type = "euler")` (automatically saved to `data/`).
- [ ] **Checkpoint 1.2**: Verify that replicate counts, quantifiable fractions, replicate CV distributions, missingness metrics, and feature overlap / binary switch profiles are printed to stdout and recorded in `logs/01_inspect/console.log`.

#### Phase 1.3: State Persistence & Phase Gate Verification
- [ ] Persist the imported dataset and generate reproducible R script:
  - Invoke `tpa_export_state(rds_path = "data/tidyproteomics_data.rds", script_path = "code/01_inspect.R")`.
- [ ] **Checkpoint 1.3 (Phase Gate & Log Verification)**:
  1. `logs/01_inspect/console.log` exists on disk with non-zero file size.
  2. `data/tidyproteomics_data.rds` and `code/01_inspect.R` exist on disk with non-zero file size.
  3. `overview` confirms exact sample groups (`ctl`, treatment cohorts) and functional annotation terms.
  4. Count diagnostic plot (`data/plot_proteins_counts.png` or `data/plot_peptides_counts.png`) exists in `data/` with non-zero file size (along with optional `data/plot_*_venn.png` or `data/plot_*_euler.png` if generated).

#### Phase 1.4: Experimental Alignment, Contrast Scaffolding & Hypothesis Verification
- [ ] **Inspect User Hypothesis & Parameters (`docs/experiment.md` Sections 1 & 2)**:
  - Extract the working hypothesis, biological model, and investigated target(s) / discovery scope from Sections 1 and 2.
  - **CRITICAL**: Never overwrite, modify, or delete Sections 1 or 2 of `docs/experiment.md` (reserved strictly for researcher input).
- [ ] **Sample Group & Batch Pattern Audit (`sample_names`)**:
  - Inspect the discovered `sample_names` output from Phase 1.3.
  - Check whether `sample_names` contain technical batch suffixes (e.g. `_batch\d+`, `_plate\d+`, `_run\d+`, `_rep\d+`), multiple technical replicates, or compound delimiters.
- [ ] **Proactive Section 3 Scaffolding in `docs/experiment.md`**:
  - Inspect Section 3 (`## 3. Bioinformatics Design`) in `docs/experiment.md`.
  - If Section 3 contains `*(Pending Phase 1 data ingestion)*`, is missing, or contains unconfigured tables:
    - *Targeting Edits*: Target concise unique anchor lines (e.g. replacing `- *(Pending Phase 1 data ingestion)*` in Section 3.A) rather than replacing large multi-paragraph comment blocks, ensuring `replace_file_content` succeeds reliably without whitespace mismatches.
    - **Scaffold Section 3**: Update Section 3 of `docs/experiment.md` directly using standardized visual badges:
      1. Section 3.A: Label with `ℹ️ [AUTO-GENERATED REFERENCE - READ ONLY]:` and list all discovered sample groups with replicate counts, setting `- **Confirm Discovered Sample Groups**: FALSE`.
      2. Section 3.B: Label with `👉 [USER ACTION REQUIRED - CONFIGURE & CONFIRM NORMALIZATION STRATEGY]:`, setting `- **Normalization Methods**: default`, `- **Normalization Subset Filter**: NONE`, and `- **Confirm Normalization Strategy**: FALSE`.
      3. Section 3.C: Label with `👉 [USER ACTION REQUIRED - CONFIRM IMPUTATION METHOD]:`, setting `- **Imputation Method**: randomforest_grouped` (or `none` if complete-case) and `- **Confirm Imputation Strategy**: FALSE`.
      4. Section 3.D: Label with `👉 [USER REVIEW & EDIT TABLE]:`. If technical batch or replicate suffixes are detected, provide a suggested **Sample Group Renaming & Pooling Map** table proposing clean biological names, setting `- **Reassign Sample Names According to Pooling Map**: TRUE` and `- **Confirm Sample Pooling Map**: FALSE`.
      5. Section 3.E: Label with `👉 [USER ACTION REQUIRED - DEFINE & CONFIRM TARGET CONTRASTS]:` and suggest logical **Target Contrasts**, setting `Status: PENDING` and `- **Confirm Target Contrasts**: FALSE`.
      6. Section 3.F: Label with `⚠️ [PRE-FLIGHT GATE DECISION - EXPOSE ONLY IF BATCH CONFOUNDING DETECTED]:`. If batch confounding is detected across cohorts, set `- **Batch Confounding Detected**: TRUE`, `- **Proceed With Potential Batch Confounding**: FALSE`, and `- **Confirm Batch Confounding Authorization**: FALSE` to expose this gate for researcher review. If no confounding exists, set `- **Batch Confounding Detected**: FALSE`.
  - If Section 3 already contains user-customized renaming or contrast definitions, preserve them exactly!
  - **Enforce Clean Boolean Values & Badge Preservation**: Preserve visual badges (`ℹ️ [AUTO-GENERATED REFERENCE]`, `👉 [USER ACTION REQUIRED]`, `⚠️ [PRE-FLIGHT GATE DECISION]`) and keep all boolean configuration toggles (`- **Reassign Sample Names According to Pooling Map**: TRUE` and `- **Proceed With Potential Batch Confounding**: FALSE`) strictly as clean booleans without appending conversational notes or explanations. Any notes must be placed in markdown comments `<!-- ... -->`.
- [ ] **Checkpoint 1.4 (Design Alignment Gate)**: 
  - Verify that `sample_names` are confirmed, alignment with `docs/experiment.md` is verified, and Section 3 is scaffolded with discovered sample groups.
  - Setting `- **Proceed With Potential Batch Confounding**: FALSE` is the scaffolded default awaiting researcher review and does NOT fail or halt Phase 1. Phase 1 must NEVER invoke `fail_phase` for pre-ingestion audit warnings, unmapped columns, discovered groups, batch suffixes, or confounding if `tpa_load` loads the data with quantified entities.
- [ ] **Complete Phase (Automated Blackboard Recording)**:
  - Do NOT manually edit `docs/notes.md` via file tools; the orchestrator automatically records your `complete_phase` summary into `docs/notes.md`.
  - Once `docs/experiment.md` Section 3 is scaffolded and QC plots are generated, invoke `complete_phase` with a comprehensive summary including quantified protein count, sample inventory, baseline quality stats, and detected upstream operations:
    `complete_phase(phaseName = "01_INSPECT", summary = "Data ingestion complete (<N> proteins across <M> samples). Audited operations history (normalization and imputation status), verified sample groups in sample_names, scaffolded sample grouping and contrast template in docs/experiment.md Section 3, generated count diagnostic plot, and persisted data/tidyproteomics_data.rds.")`
