---
tools: [tpa_health, tpa_input_audit, tpa_load, tpa_inspect, tpa_summary, tpa_plot, tpa_export_state, tpa_set_workspace]
---

### Phase 1: Dual-Cohort Data Ingestion & Library Inspection

Execute this phase using live `tpa_*` MCP tools in memory (or execute `code/01_ingest_cohorts.R` if offline). All tool executions and outputs are automatically recorded to `logs/01_ingest_cohorts/console.log`. In this initial phase, you will ingest both experimental cohorts into distinct in-memory datasets (`cohort_a` and `cohort_b`), audit their raw topologies, and scaffold Section 3 of `docs/experiment.md`.

---

#### Phase 1.1: Ingest Cohort A and Cohort B
- [ ] **Inspect Experimental Metadata (`docs/experiment.md`)**:
  - Extract the data file paths or identifiers for Cohort A and Cohort B from Section 2.
- [ ] **Ingest Cohort A (`id = "cohort_a"`)**:
  - Ingest the first cohort dataset into memory:
    `tpa_load(source = "{{COHORT_A_PATH}}", platform = "{{PLATFORM}}", analyte = "{{ANALYTE}}", id = "cohort_a")`
  - Review `tpa_inspect(what = "overview", id = "cohort_a")` for quantified protein counts, dynamic range, and sample group names.
- [ ] **Ingest Cohort B (`id = "cohort_b"`)**:
  - Ingest the second cohort dataset into memory:
    `tpa_load(source = "{{COHORT_B_PATH}}", platform = "{{PLATFORM}}", analyte = "{{ANALYTE}}", id = "cohort_b")`
  - Review `tpa_inspect(what = "overview", id = "cohort_b")` for quantified protein counts, dynamic range, and sample group names.
- [ ] **Checkpoint 1.1**: Verify that both `cohort_a` and `cohort_b` are registered in memory.

#### Phase 1.2: Individual Cohort QC & Identification Counts
- [ ] **Cohort A Diagnostic Counts**:
  - Generate identification counts for Cohort A: `tpa_plot(type = "counts", id = "cohort_a")`.
- [ ] **Cohort B Diagnostic Counts**:
  - Generate identification counts for Cohort B: `tpa_plot(type = "counts", id = "cohort_b")`.
- [ ] **Checkpoint 1.2**: Confirm diagnostic plots and sample group summaries are logged.

#### Phase 1.3: Experimental Alignment & Section 3 Scaffolding
- [ ] **Scaffold Section 3 in `docs/experiment.md`**:
  - List discovered sample groups and replicate counts for both cohorts.
  - Suggest a unified sample pooling and harmonization scheme in Section 3.D.
- [ ] **State Persistence & Phase Gate Verification**:
  - Invoke `tpa_export_state(rds_path = "data/tidyproteomics_cohort_a.rds", script_path = "code/01_ingest_cohorts.R", id = "cohort_a")`.
  - Save Cohort B: `tpa_export_state(rds_path = "data/tidyproteomics_cohort_b.rds", script_path = "code/01_ingest_cohorts.R", id = "cohort_b")`.
- [ ] **Complete Phase**:
  - Invoke `complete_phase`:
    `complete_phase(phaseName = "01_INGEST_COHORTS", summary = "Dual-cohort ingestion complete. Cohort A (<NA> proteins) and Cohort B (<NB> proteins) loaded into memory, identification counts generated, and Section 3 study design scaffolded.")`

