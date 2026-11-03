---
tools: [tpa_health, tpa_load, tpa_inspect, tpa_summary, tpa_plot, tpa_export_state, tpa_set_workspace]
---

### Phase 3: Cohort Diagnostics, Unsupervised PCA & Batch Confounding Audit

Execute this phase using live `tpa_*` MCP tools in memory (or execute `code/03_cohort_diagnostics.R` if offline). All tool executions and outputs are automatically recorded to `logs/03_cohort_diagnostics/console.log`. Upon satisfying all diagnostic checkpoints, invoke `tpa_export_state` to generate `code/03_cohort_diagnostics.R` and save `data/tidyproteomics_data.rds`. You must strictly enforce all checkpoints below.

---

#### Phase 3.1: Unsupervised Dimensionality Reduction (PCA)
- [ ] **In-Memory State Continuity**: The dataset is active in memory from Phase 2. If reloading is needed, call `tpa_load(source = "data/tidyproteomics_data.rds")`.
- [ ] **Principal Component Analysis (PCA)**:
  - Generate the primary unsupervised PCA plot: `tpa_plot(type = "pca")` (automatically saved to `data/plot_proteins_pca.png` or `data/plot_peptides_pca.png`).
  - Examine PC1 and PC2 variance explained:
    - Assess whether biological replicates cluster tightly together within their respective conditions.
    - Check whether biological groups separate along PC1/PC2.
    - If biological replicates fail to cluster, check whether sample separation correlates with run sequence or technical covariates.
- [ ] **Checkpoint 3.1**: Confirm `data/plot_proteins_pca.png` exists in `data/` and prints variance breakdown to stdout.

#### Phase 3.2: Sample-to-Sample Correlation & Hierarchical Clustering
- [ ] **Sample Distance & Correlation Heatmap**:
  - Generate the sample-sample correlation heatmap: `tpa_plot(type = "heatmap")` (automatically saved to `data/plot_proteins_heatmap.png`).
  - Verify that intra-group pairwise correlations are consistently high ($r \ge 0.90$ for technical/biological replicates in quantitative LC-MS/MS).
  - Identify any single outlier sample exhibiting poor pairwise correlation ($r < 0.80$) with its replicate cohort.
- [ ] **Checkpoint 3.2**: Confirm `data/plot_proteins_heatmap.png` exists in `data/`.

#### Phase 3.3: Technical Covariate & Batch Confounding Audit
- [ ] **Evaluate Batch & Run Order Confounding (`docs/experiment.md` Section 3.F)**:
  - Audit sample names and metadata for technical batch indicators (e.g. `_batch1`, `_plate2`, `_run3`, `_day1`).
  - Correlate clustering patterns observed in PCA and heatmap with technical factors:
    1. If treatment cohorts are evenly distributed across batches/plates: Confounding is **RESOLVED** (`Batch Confounding Detected: FALSE`).
    2. If an entire treatment cohort was processed exclusively in Batch 1 and control in Batch 2: Flag **CRITICAL BATCH CONFOUNDING** (`Batch Confounding Detected: TRUE`).
  - Update Section 3.F in `docs/experiment.md` to reflect the final confounding status and recommendations for downstream modeling.
- [ ] **Checkpoint 3.3**: Confirm `docs/experiment.md` Section 3.F reflects the data-driven confounding assessment.

#### Phase 3.4: Comprehensive Quality Report & State Persistence
- [ ] **State Persistence & Reproducible Script**:
  - Invoke `tpa_export_state(rds_path = "data/tidyproteomics_data.rds", script_path = "code/03_cohort_diagnostics.R")`.
- [ ] **Checkpoint 3.4 (Phase Gate & Deliverables Verification)**:
  1. `logs/03_cohort_diagnostics/console.log` exists on disk with non-zero file size.
  2. `data/tidyproteomics_data.rds` and `code/03_cohort_diagnostics.R` exist on disk with non-zero file size.
  3. PCA plot (`data/plot_proteins_pca.png`) exists in `data/`.
  4. Sample heatmap (`data/plot_proteins_heatmap.png`) exists in `data/`.
- [ ] **Complete Phase (Automated Blackboard Recording)**:
  - Invoke `complete_phase` with a definitive summary of the dataset quality status, biological clustering integrity, outlier screening, and batch confounding evaluation:
    `complete_phase(phaseName = "03_COHORT_DIAGNOSTICS", summary = "Cohort diagnostics and batch confounding audit complete. Unsupervised PCA (data/plot_proteins_pca.png) and sample correlation heatmap (data/plot_proteins_heatmap.png) confirm cohort clustering integrity. Evaluated technical covariates, finalized Section 3.F confounding status, and persisted data/tidyproteomics_data.rds.")`

