---
tools: [tpa_health, tpa_load, tpa_inspect, tpa_summary, tpa_reassign, tpa_expression, tpa_batch_analysis, tpa_plot, tpa_export_table, tpa_operations, tpa_export_state]
---

### Phase 4: Differential Expression Analysis & Candidate Profiling

Execute this phase using live `tpa_*` MCP tools in memory (or execute `code/04_expression.R` if offline). All tool executions and outputs are automatically recorded to `logs/04_expression/console.log`. Upon satisfying all expression checkpoints, invoke `tpa_export_state` to generate `code/04_expression.R` and save `data/tidyproteomics_data.rds`. You must strictly enforce all checkpoints below.

---

#### Phase 4.1: Contrast Formulation, Sample Recoding & Pre-Flight Verification
- [ ] **In-Memory State Continuity**: The dataset is active in memory from Phase 3. If reloading is needed, call `tpa_load(source = "data/tidyproteomics_data.rds")`.
- [ ] **Verify / Apply Sample Group Renaming & Pooling Map (`docs/experiment.md` Section 3.D)**:
  - Check the Executive Blackboard above (`Active Sample Groups`): if sample groups were already recoded into clean biological cohorts in Phase 2.1b, proceed directly to the Pre-Flight Gate without making redundant `tpa_inspect(what = "samples")` or `tpa_reassign` calls.
  - Only if sample groups have not yet been recoded and Section 3.D has `- **Reassign Sample Names According to Pooling Map**: TRUE`:
    - Apply sample renaming in batch using `tpa_reassign(mapping = { "raw_sample_1": "clean_sample_1", ... })` or regex (`tpa_reassign(condition = "sample %like% 'surfactin'", replace = "surfactin")`).
    - Run `tpa_inspect(what = "samples")` to verify that active sample groups reflect the cleaned biological conditions.
- [ ] **Fast-Path Contrast & Confounding Confirmation Check (`docs/experiment.md` Sections 3.E & 3.F)**:
  - Review Section 3.E (`Target Contrasts`) and Section 3.F (`Confounded Batch & Exploratory Comparison Gate`) in `docs/experiment.md`.
  - **Evaluation & Confirmation Criteria**:
    - If `docs/experiment.md` contains `- **Autonomous Mode**: TRUE` or `- **Auto-Confirm**: TRUE`, ensure Section 3.E (and `3.F` if batch confounding was detected) is set to `TRUE` via `replace_file_content` and proceed immediately without calling `fail_phase`.
    - If Section 3.E lists confirmed target contrast(s) (`- **Confirm Target Contrasts**: TRUE` or `Status: CONFIRMED`) whose `<treatment>/<control>` groups match the active sample groups, AND either no batch confounding exists (`- **Batch Confounding Detected**: FALSE`) or Section 3.F is authorized (`- **Proceed With Potential Batch Confounding**: TRUE` / `- **Confirm Batch Confounding Authorization**: TRUE`), proceed immediately to **Phase 4.2** in the same turn without halting.
    - If target contrasts are unconfirmed (`FALSE`), or if batch confounding is detected and Section 3.F has NOT been authorized (`FALSE`):
      1. Scaffold Section 3.E and 3.F in `docs/experiment.md` with suggested `<treatment>/<control>` contrast pairs and clean visual badges.
      2. Halt execution cleanly via `fail_phase`:
         ```
         fail_phase(
           phaseName = "04_EXPRESSION",
           reason = "Pre-flight Gate: Batch confounding detected between treatment and control cohorts or target contrast confirmation required in Section 3.E/3.F.",
           actionableInsights = "ACTION REQUIRED: Open docs/experiment.md (highlighted in orange outline), verify the target contrast in Section 3.E, authorize Section 3.F if batch confounding was detected, or click '🎯 Confirm Contrast & Proceed' in the sidebar or Live Agent to resume Phase 4."
         )
         ```
      3. Do NOT proceed to calculate linear models until Section 3 has been confirmed by the user.

#### Phase 4.2: Empirical Bayes Differential Expression & Enforced Batch Processing
- [ ] **Differential Expression Calculation (`tpa_expression`)**:
  - Calculate empirical Bayes moderated $t$-statistics for each confirmed target contrast in Section 3.E, passing `comparison` as a `<treatment_group>/<control_group>` string (where positive $\log_2\text{FC} > 0$ indicates higher abundance in `<treatment_group>`):
    `tpa_expression(comparison = "<treatment_group>/<control_group>", method = "limma")`
  - *(Note: If Section 2/3 explicitly specifies non-parametric or repeated-measures mixed-effects testing, pass `method = "wilcoxon"` or `method = "mixed-effects"`. If multiple target contrasts are listed in Section 3.E, invoke `tpa_expression` sequentially for each confirmed contrast).*
- [ ] **Enforced Batch Processing (`tidyproteomics::expression() |> tidyproteomics::analyze_expressions()`)**:
  - Immediately following `tpa_expression`, **execute batch analysis to run `analyze_expressions()`**:
    `tpa_batch_analysis(type = "expressions", labels_column = "gene_name")`
  - This automatically processes all modeled comparisons, generates publication-grade volcano plots with `ggrepel`-labeled significant genes (`data/plot_proteins_volcano_<contrast>.png`), and exports full quantitative expression tables (`data/table_proteins_expression_<contrast>.csv` / `.tsv`).
- [ ] **Checkpoint 4.2**: Confirm from the `tpa_batch_analysis` output that expression tables and volcano plots were generated across all evaluated contrasts.

#### Phase 4.3: Optional Targeted Exploratory Profiling
- [ ] Batch analysis automatically generates the primary volcano plots and expression tables. Only if additional custom table exports or targeted single-protein abundance plots are needed:
  - Export customized tables via `tpa_export_table(type = "analysis", analysis = "expression", comparison = "<treatment_group>/<control_group>", file_name = "data/table_proteins_expression_<contrast>.tsv")`.
  - Generate targeted single-protein profiles via `tpa_plot(type = "protein", protein = "<accession>")`.
  - *(Do NOT dump entire expression tables into LLM context via `tpa_extract` to count rows manually).*

#### Phase 4.4: Object Persistence & Checkpoint Verification
- [ ] Persist the modeled dataset and generate reproducible R script:
  - Invoke `tpa_export_state(rds_path = "data/tidyproteomics_data.rds", script_path = "code/04_expression.R")`.
- [ ] **Checkpoint 4.4**:
  1. `logs/04_expression/console.log` exists on disk with non-zero file size.
  2. `data/tidyproteomics_data.rds` and `code/04_expression.R` exist on disk with non-zero file size.
  3. Expression table (`data/table_*expression_*.tsv` or `.csv`) exists on disk with non-zero file size.
  4. Volcano plot (`data/*volcano_*.png`) exists in `data/` with non-zero file size.
- [ ] **Complete Phase (Automated Blackboard Recording)**:
  - Do NOT manually edit `docs/notes.md` via file tools; the orchestrator automatically records your `complete_phase` summary into `docs/notes.md`.
  - Invoke `complete_phase` with a comprehensive summary including the statistical testing method (`limma`), evaluated contrast(s), significant DE counts ($|\log_2\text{FC}| \ge 1.0, q \le 0.05$, broken down into upregulated and downregulated), and leading regulated candidates:
    `complete_phase(phaseName = "04_EXPRESSION", summary = "Differential expression analysis (<contrast>) completed via limma and batch-processed via analyze_expressions() (<N_sig> significant proteins: <N_up> upregulated, <N_down> downregulated at |log2FC| >= 1, q <= 0.05). Generated volcano plots and expression tables, and persisted data/tidyproteomics_data.rds.")`
