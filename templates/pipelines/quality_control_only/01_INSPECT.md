---
tools: [tpa_health, tpa_input_audit, tpa_ingest_config, tpa_export_config, tpa_load, tpa_inspect, tpa_summary, tpa_plot, tpa_export_state, tpa_set_workspace]
---

### Phase 1: Data Ingestion & Library Quality Inspection

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
       - **ProteomeDiscoverer Note**: ProteomeDiscoverer exports often quantify peak areas with `Area: ...` instead of `Abundance: ...`. If `tpa_input_audit` reports 0 quantitative channels and raw headers match `Area:`, set the quantitative pattern: `tpa_ingest_config(platform = "ProteomeDiscoverer", analyte = "proteins", action = "set", category = "quantitative", column_defined = "abundance_raw", column_import = "^Area:", pivot = TRUE)`.
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

#### Phase 1.2: Contaminant Audit & Identification Depth
- [ ] **Profile Sample Preparation Contaminants**:
  - Run `tpa_summary(contamination = "CRAP")` to detect common laboratory background contaminants (e.g. keratin, trypsin, serum albumin, heat shock proteins).
  - Record the fraction of total spectral or quantitative intensity attributed to contaminants.
- [ ] **Identification Counts Diagnostic Plot**:
  - Generate the primary identification depth plot: `tpa_plot(type = "counts")` (automatically saved to `data/plot_proteins_counts.png` or `data/plot_peptides_counts.png`).
  - Verify that each sample exhibits adequate protein depth according to the experimental design.
- [ ] **Checkpoint 1.2**: Verify that identification counts and contaminant fractions are recorded in stdout and logged to `logs/01_inspect/console.log`.

#### Phase 1.3: Experimental Alignment & Section 3 Scaffolding
- [ ] **Inspect User Hypothesis & Parameters (`docs/experiment.md` Sections 1 & 2)**:
  - Extract the working hypothesis, biological model, and investigated cohorts from Sections 1 and 2.
  - **CRITICAL**: Never overwrite, modify, or delete Sections 1 or 2 of `docs/experiment.md` (reserved strictly for researcher input).
- [ ] **Proactive Section 3 Scaffolding in `docs/experiment.md`**:
  - Inspect Section 3 (`## 3. Bioinformatics Design`) in `docs/experiment.md`.
  - If Section 3 contains `*(Pending Phase 1 data ingestion)*`, is missing, or contains unconfigured tables:
    - Scaffold Section 3 with discovered sample groups:
      1. Section 3.A: Label with `ℹ️ [AUTO-GENERATED REFERENCE - READ ONLY]:` and list all discovered sample groups with replicate counts, setting `- **Confirm Discovered Sample Groups**: FALSE`.
      2. Section 3.B: Set `- **Confirm Normalization Strategy**: FALSE`.
      3. Section 3.C: Set `- **Confirm Imputation Strategy**: FALSE`.
      4. Section 3.D: Scaffold suggested **Sample Group Renaming & Pooling Map** table if batch/technical suffixes are present.
      5. Section 3.E: Scaffold suggested **Target Contrasts**.
      6. Section 3.F: Set `- **Batch Confounding Detected**: FALSE` (or `TRUE` if severe confounding is evident).
- [ ] **State Persistence & Phase Gate Verification**:
  - Invoke `tpa_export_state(rds_path = "data/tidyproteomics_data.rds", script_path = "code/01_inspect.R")`.
- [ ] **Checkpoint 1.3 (Phase Gate & Log Verification)**:
  1. `logs/01_inspect/console.log` exists on disk with non-zero file size.
  2. `data/tidyproteomics_data.rds` and `code/01_inspect.R` exist on disk with non-zero file size.
  3. Count diagnostic plot (`data/plot_proteins_counts.png` or `data/plot_peptides_counts.png`) exists in `data/`.
- [ ] **Complete Phase (Automated Blackboard Recording)**:
  - Invoke `complete_phase` with a summary of data ingestion, total proteins/samples, contaminant fraction, and scaffolded groups:
    `complete_phase(phaseName = "01_INSPECT", summary = "Data ingestion and library quality inspection complete (<N> proteins across <M> samples). Ingestion topology verified, contaminant levels profiled (<C>% CRAP), identification counts plotted (data/plot_proteins_counts.png), and persisted data/tidyproteomics_data.rds.")`
