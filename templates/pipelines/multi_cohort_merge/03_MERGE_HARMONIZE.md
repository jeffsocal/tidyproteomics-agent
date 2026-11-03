---
tools: [tpa_health, tpa_load, tpa_inspect, tpa_merge, tpa_normalize, tpa_summary, tpa_export_state, tpa_set_workspace]
---

### Phase 3: Cohort Harmonization & Dataset Merging

Execute this phase using live `tpa_*` MCP tools in memory (or execute `code/03_merge_harmonize.R` if offline). All tool executions and outputs are automatically recorded to `logs/03_merge_harmonize/console.log`. In this phase, you will merge the two distinct datasets into a single cohesive tidyproteomics object, reconcile sample names, and evaluate cross-cohort normalization.

---

#### Phase 3.1: Execute Dataset Merge (`tpa_merge`)
- [ ] **Merge Datasets**:
  - Run `tpa_merge(id1 = "cohort_a", id2 = "cohort_b", new_id = "merged_data")`.
  - Confirm the return message indicates successful joining of quantitative matrices and experiment tables.
- [ ] **Inspect Merged Topology**:
  - Run `tpa_inspect(what = "overview", id = "merged_data")` to evaluate:
    - Combined file count and sample groups.
    - Total quantified entities.
    - Resulting missingness percentage across the combined matrix.
- [ ] **Checkpoint 3.1**: Confirm merged topology is printed to stdout.

#### Phase 3.2: Cross-Cohort Normalization Benchmarking
- [ ] **Evaluate Cross-Cohort Normalization**:
  - Because Cohort A and Cohort B may have systematic intensity shifts (e.g. instrument sensitivity drift, separate digestion batches), perform normalization:
    `tpa_normalize(methods = ["median", "linear", "loess"], id = "merged_data")`
  - Evaluate CV reduction across combined samples using `tpa_summary(by = "sample", id = "merged_data")`.
- [ ] **Checkpoint 3.2**: Confirm post-merge normalization minimizes inter-cohort batch variation.

#### Phase 3.3: State Persistence & Phase Gate Verification
- [ ] **Persist Merged State**:
  - Invoke `tpa_export_state(rds_path = "data/tidyproteomics_data.rds", script_path = "code/03_merge_harmonize.R", id = "merged_data")`.
- [ ] **Complete Phase**:
  - Invoke `complete_phase`:
    `complete_phase(phaseName = "03_MERGE_HARMONIZE", summary = "Dataset merge complete. Successfully unified Cohort A and Cohort B into merged_data (<N> proteins across <M> total files). Evaluated cross-cohort normalization and persisted data/tidyproteomics_data.rds.")`

