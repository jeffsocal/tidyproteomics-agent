---
tools: [tpa_health, tpa_load, tpa_inspect, tpa_summary, tpa_plot, tpa_export_state, tpa_set_workspace]
---

### Phase 2: Technical Replicate Precision, Dynamic Range & Feature Overlap

Execute this phase using live `tpa_*` MCP tools in memory (or execute `code/02_replicate_qc.R` if offline). All tool executions and outputs are automatically recorded to `logs/02_replicate_qc/console.log`. Upon satisfying all replicate QC checkpoints, invoke `tpa_export_state` to generate `code/02_replicate_qc.R` and save `data/tidyproteomics_data.rds`. You must strictly enforce all checkpoints below.

---

#### Phase 2.1: Replicate Precision & Coefficient of Variation (CV) Analysis
- [ ] **In-Memory State Continuity**: The dataset is active in memory from Phase 1. If reloading is needed, call `tpa_load(source = "data/tidyproteomics_data.rds")`.
- [ ] **Sample-Level Quality & Replicate Variance**:
  - Run `tpa_summary(by = "sample")` to assess sample-level quantifiable fractions, median CVs, and replicate missingness rates.
  - Evaluate intra-cohort variance: high-quality proteomics workflows typically show median replicate CVs $\le 15–20\%$. Flag any replicate outlier exhibiting abnormally elevated variance or low quantitative yield.
- [ ] **Replicate CV Distribution Plot**:
  - Generate the CV distribution diagnostic plot: `tpa_plot(type = "cvs")` (automatically saved to `data/plot_proteins_cvs.png` or `data/plot_peptides_cvs.png`).
  - Confirm the plot visualizes the cumulative CV distribution across all biological conditions.
- [ ] **Checkpoint 2.1**: Confirm that sample-level summary statistics and CV distribution plots are generated and logged.

#### Phase 2.2: Quantitative Dynamic Range & Signal Uniformity
- [ ] **Dynamic Range Profiling**:
  - Generate the dynamic range curve: `tpa_plot(type = "dynamic_range")` (automatically saved to `data/plot_proteins_dynamic_range.png` or `data/plot_peptides_dynamic_range.png`).
  - Inspect the orders of magnitude spanned by quantified proteins (typically 4–6 orders of magnitude in deep proteomes).
  - Check for dynamic range compression, signal drop-off at the noise floor, or extreme abundance saturation.
- [ ] **Checkpoint 2.2**: Confirm `data/plot_proteins_dynamic_range.png` exists in `data/` with non-zero file size.

#### Phase 2.3: Qualitative Feature Overlap & Binary Switch Detection
- [ ] **Condition Overlap & Shared Proteome**:
  - Generate a feature overlap diagram: `tpa_plot(type = "venn")` or `tpa_plot(type = "euler")` across biological conditions (saved to `data/plot_proteins_venn.png` or `data/plot_proteins_euler.png`).
  - Identify condition-exclusive identifications (proteins detected exclusively in one condition and absent in others prior to imputation).
  - Note whether missingness patterns are predominantly Missing Completely At Random (MCAR, random dropouts in low abundance) or Missing Not At Random (MNAR, condition-specific biological on/off switches).
- [ ] **Checkpoint 2.3**: Verify feature overlap diagrams and condition-exclusive protein counts are logged to stdout.

#### Phase 2.4: State Persistence & Phase Gate Verification
- [ ] **Persist State & Reproducible Script**:
  - Invoke `tpa_export_state(rds_path = "data/tidyproteomics_data.rds", script_path = "code/02_replicate_qc.R")`.
- [ ] **Checkpoint 2.4 (Phase Gate & Log Verification)**:
  1. `logs/02_replicate_qc/console.log` exists on disk with non-zero file size.
  2. `data/tidyproteomics_data.rds` and `code/02_replicate_qc.R` exist on disk with non-zero file size.
  3. Replicate CV distribution plot (`data/plot_proteins_cvs.png` or `data/plot_peptides_cvs.png`) exists in `data/`.
  4. Dynamic range plot (`data/plot_proteins_dynamic_range.png` or `data/plot_peptides_dynamic_range.png`) exists in `data/`.
- [ ] **Complete Phase (Automated Blackboard Recording)**:
  - Invoke `complete_phase` with a quantitative evaluation of replicate precision, median CVs, dynamic range span, and feature overlap:
    `complete_phase(phaseName = "02_REPLICATE_QC", summary = "Replicate precision and dynamic range QC complete. Evaluated sample CV distributions (median CV = <X>%, plot saved to data/plot_proteins_cvs.png), dynamic range spanning <Y> orders of magnitude (data/plot_proteins_dynamic_range.png), feature overlap profiled, and persisted data/tidyproteomics_data.rds.")`

