---
tools: [tpa_health, tpa_load, tpa_inspect, tpa_summary, tpa_impute, tpa_plot, tpa_operations, tpa_extract, tpa_export_state]
---

### Phase 3: Missingness Assessment & Quantitative Imputation

Execute this phase using live `tpa_*` MCP tools in memory (or execute `code/03_impute.R` if offline). All tool executions and outputs are automatically recorded to `logs/03_impute/console.log`. Upon satisfying all imputation checkpoints, invoke `tpa_export_state` to generate `code/03_impute.R` and save `data/tidyproteomics_data.rds`. You must strictly enforce all checkpoints below.

---

#### Phase 3.1: Missing Value Distribution, Mechanism Audit & Confirmation Gate
- [ ] **In-Memory State Continuity**: The dataset is active in memory from Phase 2. If reloading is needed, call `tpa_load(source = "data/tidyproteomics_data.rds")`.
- [ ] **Quantify Missing Values Per Sample Cohort**:
  - Check overall missingness in the Executive Blackboard above, and run `tpa_summary(by = "sample")` to inspect per-condition missingness and replicate coverage (do NOT make a redundant `tpa_inspect(what = "overview")` call if overall missingness is already shown in the Executive Blackboard).
  - ⚠️ **Imputation Slot Notice**: In `tidyproteomics`, header summaries may display `Imputed: Yes` due to internal accounting slot initialization. Always consult the operations history in the Executive Blackboard (or `tpa_operations()`) as the single source of truth: if no `impute` step is recorded in operations history, the dataset contains un-imputed missing values.
- [ ] **Scientific Imputation Strategy & Downstream `limma` Modeling Trade-Off (Karpievitch et al., *BMC Bioinformatics* 2012)**:
  Evaluate the biological mechanism of missingness from `docs/experiment.md` Section 2 and the sample missingness distribution:
  1. **Default — Random Forest Within Sample Groups (`randomforest_grouped` / MAR)**:
     - *Literature & Statistical Rationale*: Random Forest imputation (`impute.randomforest, method = 'matrix', group_by_sample = TRUE`) predicts sporadic Missing At Random (MAR) replicate dropouts from within-condition replicate correlation structure without artificially collapsing variance or dragging partial observations down to the noise floor.
     - *Behavior on Condition-Exclusive Dropouts*: Because `group_by_sample = TRUE` imputes strictly within each biological condition, proteins that are **100% missing across all replicates of a condition** remain `NA` in that condition. Consequently, those 100%-absent condition-exclusive proteins will not be imputed with synthetic values, and in Phase 4 (`limma`) they will be tracked as unmodeled qualitative presence/absence switches (`unmodeled_condition_exclusive`) rather than entering the continuous linear model.
     - *Recommended Tool Call*: `tpa_impute(method = "impute.randomforest, method = 'matrix', group_by_sample = TRUE")`.
  2. **Intentional Knockout, Gene Suppression, or Binary Switch Override — Column-Wise Minimum (`min_column` / MNAR)**:
     - *Literature & Statistical Rationale*: When an experiment involves an **intentional gene knockout/knockdown (CRISPR KO, siRNA, shRNA, degrader/PROTAC), targeted pathway suppression, affinity pull-down (IP-MS), or acute binary on/off switch**, complete absence across all replicates of one condition represents left-censored Missing Not At Random (MNAR) biology. Column-wise minimum imputation (`base::min, method = 'column'`) is unbiased with respect to condition labels and fills every missing value—including 100% condition-exclusive dropouts—with that MS replicate's empirical Limit of Detection (LOD), retaining condition-exclusive proteins in `limma` differential expression modeling (where they will be tagged `DETECTION_LIMITED_ON_OFF` in Phase 6).
     - *Recommended Tool Call*: `tpa_impute(method = "base::min, method = 'column'")`.
  3. **No Imputation / Complete-Case Bypass (`none`)**:
     - *Characteristics*: Complete-case dataset (e.g. single TMT plex), `0%` missing values detected, or pre-existing imputation already recorded in operations history. Bypass imputation to preserve empirical ground truth.
- [ ] **Fast-Path Imputation Confirmation Check (`docs/experiment.md` Section 3.C)**:
  - If pre-existing imputation is recorded in operations history OR true matrix missingness is confirmed 0% across all sample replicates, proceed autonomously (pass-through / bypass) without halting.
  - If Section 3.C was already confirmed during the Phase 2.1b Unified Study Design Gate (`- **Confirm Imputation Strategy**: TRUE`), proceed immediately to **Phase 3.2** in the same turn without halting. Do NOT mutate confirmed `min_column` or `randomforest_grouped` methods to `none`.
  - If `- **Confirm Imputation Strategy**: FALSE`:
    1. Ensure Section 3.C in `docs/experiment.md` is populated with the recommended `- **Imputation Method**: <randomforest_grouped|min_column>` and a concise HTML comment `<!-- Agent Imputation Rationale: ... -->`, keeping `Confirm Imputation Strategy: FALSE`.
    2. **DO NOT self-confirm**: Autonomous agents are strictly prohibited from changing `Confirm Imputation Strategy: FALSE` to `TRUE`.
    3. Halt execution cleanly via `fail_phase`:
       ```
       fail_phase(
         phaseName = "03_IMPUTE",
         reason = "Pre-flight Imputation Gate: Human-in-the-loop (HITL) confirmation required for Missing Value Imputation Strategy in Section 3.C of docs/experiment.md.",
         actionableInsights = "ACTION REQUIRED: Open docs/experiment.md (highlighted in orange outline), review the recommended Imputation Method in Section 3.C ('randomforest_grouped' default vs 'min_column' for knockouts/MNAR), check 'Confirm Imputation Strategy: TRUE', or click '🎯 Confirm Imputation & Proceed' in the sidebar or Live Agent to resume Phase 3."
       )
       ```

#### Phase 3.2: Imputation Execution & Complete-Case / Pre-Imputed Safeguard
- [ ] Execute the confirmed strategy:
  - If pre-existing imputation is recorded in operations history: preserve upstream imputed values to prevent variance distortion.
  - If total missing is `0%` or `- **Imputation Method**: none`: bypass imputation to preserve empirical ground truth.
  - If `- **Imputation Method**: randomforest_grouped` (default): invoke `tpa_impute(method = "impute.randomforest, method = 'matrix', group_by_sample = TRUE")`.
  - If `- **Imputation Method**: min_column`: invoke `tpa_impute(method = "base::min, method = 'column'")`.
  - If `- **Imputation Method**: min_row_grouped`: invoke `tpa_impute(method = "base::min, method = 'row', group_by_sample = TRUE")`.
- [ ] **Checkpoint 3.2**: Verify from the `tpa_impute` return summary that imputation executed successfully. *(Note: `tpa_impute` automatically returns the updated dataset summary; do NOT make a redundant `tpa_inspect(what = "overview")` call if `tpa_impute` just printed the updated state. Under `randomforest_grouped` or `min_row_grouped`, residual missing values correspond to 100%-absent condition-exclusive dropouts and do NOT require 0% residual missingness; under `min_column`, all missing values are imputed at each replicate's column LOD).*

#### Phase 3.3: Post-Imputation Distribution & Accounting Plot Update
- [ ] Update `tpa_plot(type = "counts", file_name = "data/plot_proteins_counts.png")` so the identification accounting plot reflects both observed replicate identifications and post-imputation (`mbr`/imputed) totals per biological cohort.
- [ ] If extracting quantitative abundances for optional distribution auditing via `tpa_extract`:
  - Set `values` to the specific normalization layer selected in Phase 2 (e.g. `tpa_extract(values = "loess")`, `"median"`, `"linear"`, `"limma"`, or `"raw"` — never pass `"normalized"`).
  - **Directory Hygiene Requirement**: If supplying `save_csv`, always prefix the filepath with `data/` (e.g. `tpa_extract(values = "loess", na_rm = FALSE, save_csv = "data/03_loess_full_matrix.csv")`).

#### Phase 3.4: Object Persistence & Checkpoint Verification
- [ ] Persist the imputed dataset and generate reproducible R script:
  - Invoke `tpa_export_state(rds_path = "data/tidyproteomics_data.rds", script_path = "code/03_impute.R")`.
- [ ] **Checkpoint 3.4**:
  1. `logs/03_impute/console.log` exists on disk with non-zero file size.
  2. `data/tidyproteomics_data.rds` and `code/03_impute.R` exist on disk with non-zero file size, and operations history confirms `impute` (or verified complete-case bypass / pre-imputed pass-through).
- [ ] **Complete Phase (Automated Blackboard Recording)**:
  - Do NOT manually edit `docs/notes.md` via file tools; the orchestrator automatically records your `complete_phase` summary into `docs/notes.md`.
  - Invoke `complete_phase` with a comprehensive summary including pre-imputation missingness percentage, confirmed imputation method and rationale (`impute.randomforest` MAR default vs. `base::min` column LOD for knockouts/MNAR vs. complete-case bypass per Karpievitch et al. 2012), and post-imputation completeness / residual condition-exclusive dropout counts:
    `complete_phase(phaseName = "03_IMPUTE", summary = "Missingness audit (<pre_missing>% pre-imputation missing) and confirmed imputation (<selected_imputation_method>) completed. Confirmed post-imputation dynamic range (<post_missing>% residual condition-exclusive missing), updated counts plot, and persisted data/tidyproteomics_data.rds.")`
