---
tools: [tpa_health, tpa_load, tpa_inspect, tpa_summary, tpa_plot, tpa_export_table, tpa_export_state, tpa_set_workspace]
---

### Phase 4: Cross-Cohort PCA, Batch Diagnostics & Final Export

Execute this phase using live `tpa_*` MCP tools in memory (or execute `code/04_cohort_diagnostics.R` if offline). All tool executions and outputs are automatically recorded to `logs/04_cohort_diagnostics/console.log`. In this final phase of the Multi-Cohort Merge pipeline, you will evaluate unsupervised PCA separation to audit cohort effects versus biological groupings, generate diagnostic heatmaps, and export the unified dataset.

---

#### Phase 4.1: Unsupervised PCA on Merged Dataset
- [ ] **Load Merged State**:
  - The merged dataset is active in memory (or call `tpa_load(source = "data/tidyproteomics_data.rds")`).
- [ ] **Plot PCA**:
  - Call `tpa_plot(type = "pca")` (saving `data/plot_proteins_pca.png`).
  - Examine PC1 vs PC2 variance:
    - Assess whether samples cluster by biological condition or separate along technical cohort boundaries.
    - If strong technical separation remains, note the batch effect in `docs/experiment.md` Section 3.F.
- [ ] **Checkpoint 4.1**: Confirm PCA plot is generated in `data/`.

#### Phase 4.2: Sample Correlation Heatmap
- [ ] **Plot Heatmap**:
  - Call `tpa_plot(type = "heatmap")` (saving `data/plot_proteins_heatmap.png`).
  - Verify pairwise correlation across all combined samples from Cohort A and Cohort B.

#### Phase 4.3: Export Unified Tables & Final State
- [ ] **Export Quantitative Matrix**:
  - Export full quantitative table: `tpa_export_table(type = "quant", file_name = "data/table_proteins_merged_quant.tsv")`.
- [ ] **Persist Final State**:
  - Invoke `tpa_export_state(rds_path = "data/tidyproteomics_data.rds", script_path = "code/04_cohort_diagnostics.R")`.
- [ ] **Complete Phase**:
  - Invoke `complete_phase`:
    `complete_phase(phaseName = "04_COHORT_DIAGNOSTICS", summary = "Multi-cohort integration complete. PCA (data/plot_proteins_pca.png) and sample heatmap (data/plot_proteins_heatmap.png) generated. Exported unified data matrix and persisted data/tidyproteomics_data.rds.")`

