---
tools: [tpa_health, tpa_load, tpa_inspect, tpa_intersection, tpa_summary, tpa_plot, tpa_export_state, tpa_set_workspace]
---

### Phase 2: Cross-Cohort Feature Intersection & Alignment

Execute this phase using live `tpa_*` MCP tools in memory (or execute `code/02_align_intersect.R` if offline). All tool executions and outputs are automatically recorded to `logs/02_align_intersect/console.log`. In this phase, you will evaluate the overlap between Cohort A and Cohort B, detect cohort-unique identifications, and verify identifier harmonization.

---

#### Phase 2.1: In-Memory Verification & Reloading
- [ ] **Verify Datasets in Memory**:
  - Check that both `cohort_a` and `cohort_b` are loaded.
  - If reloading is needed:
    `tpa_load(source = "data/tidyproteomics_cohort_a.rds", id = "cohort_a")`
    `tpa_load(source = "data/tidyproteomics_cohort_b.rds", id = "cohort_b")`

#### Phase 2.2: Cross-Cohort Feature Intersection (`tpa_intersection`)
- [ ] **Run Feature Intersection**:
  - Run `tpa_intersection(id1 = "cohort_a", id2 = "cohort_b")` to audit shared vs. cohort-unique identifications.
  - Quantify:
    1. Total proteins identified in both cohorts (core shared proteome).
    2. Proteins unique to Cohort A.
    3. Proteins unique to Cohort B.
  - Evaluate whether feature overlap percentage exceeds standard proteomics consistency thresholds ($\ge 65–75\%$ overlap across comparable technical runs).
- [ ] **Checkpoint 2.2**: Log intersection statistics to stdout.

#### Phase 2.3: Cross-Cohort Venn & Euler Diagrams
- [ ] **Plot Feature Overlap**:
  - Generate an intersection diagram: `tpa_plot(type = "venn")` or `tpa_plot(type = "euler")` comparing Cohort A and Cohort B (saving `data/plot_proteins_intersection.png`).
- [ ] **State Persistence & Phase Gate Verification**:
  - Invoke `tpa_export_state(rds_path = "data/tidyproteomics_data.rds", script_path = "code/02_align_intersect.R")`.
- [ ] **Complete Phase**:
  - Invoke `complete_phase`:
    `complete_phase(phaseName = "02_ALIGN_INTERSECT", summary = "Cross-cohort intersection complete. Identified <N_shared> shared proteins across Cohort A and Cohort B (<P_overlap>% overlap). Generated intersection diagram (data/plot_proteins_intersection.png).")`

