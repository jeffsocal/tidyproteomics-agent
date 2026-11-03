---
tools: [tpa_health, tpa_load, tpa_inspect, tpa_summary, tpa_subset, tpa_reassign, tpa_normalize, tpa_select_normalization, tpa_plot, tpa_operations, tpa_export_state, tpa_normalization_sensitivity]
---

### Phase 2: Contaminant Filtering & Multi-Method Normalization Benchmarking

Execute this phase using live `tpa_*` MCP tools in memory (or execute `code/02_normalize.R` if offline). All tool executions and outputs are automatically recorded to `logs/02_normalize/console.log`. Upon satisfying all normalization checkpoints, invoke `tpa_export_state` to generate `code/02_normalize.R` and save `data/tidyproteomics_data.rds`. You must strictly enforce all checkpoints below.

---

#### Phase 2.1: Contaminant & Confidence Filtering
- [ ] **In-Memory State Continuity**: The dataset is active in memory from Phase 1. If reloading is needed, call `tpa_load(source = "data/tidyproteomics_data.rds")`.
- [ ] **Filter Contaminants & Low-Confidence Identifications** (skipping if already recorded in the Executive Blackboard operations history from a prior Phase 2 pre-gate run):
  - Use `tpa_subset(expression = "!protein %like% 'CON__|REV__' & !description %like% 'CRAP|Trypsin'")` to remove search contaminants, decoys, and proteolysis reagents.
  - If analyte is `proteins` and `num_unique_peptides` is present in the dataset's accounting columns (verify via the Phase 1 header audit or `tpa_inspect(what = "accountings")` if uncertain), retain multi-peptide identifications using `tpa_subset(expression = "num_unique_peptides >= 2")`.
- [ ] **Checkpoint 2.1**: Note that `tpa_subset` automatically prints the updated state card (`overview`) showing the post-filter entity count and updated missingness percentage (do NOT make a redundant `tpa_inspect(what = "overview")` call right after `tpa_subset`). *(Scientific Note: Filtering out single-peptide `num_unique_peptides == 1` identifications removes sparse Match-Between-Runs / noise-floor rows and often lowers overall missingness compared to raw Phase 1 ingestion; record both pre- and post-filter missingness).*

#### Phase 2.1b: Unified Study Design Gate, Sample Grouping & Biological Condition Recoding
- [ ] Inspect Section 3 (`3.A` Discovered Groups, `3.B` Quantitative Normalization, `3.C` Imputation Strategy, `3.D` Sample Group Renaming & Pooling Map, `3.E` Target Contrasts, and `3.F` Confounded Batch Gate) in `docs/experiment.md`:
  - **Rigid Human-in-the-Loop (HITL) Study Design Gate Check**:
    - Verify whether ALL Section 3 subtasks have their confirmation checks set to `TRUE`:
      1. **3.A Discovered Sample Groups**: `- **Confirm Discovered Sample Groups**: TRUE`.
      2. **3.B Quantitative Normalization Strategy**: `- **Confirm Normalization Strategy**: TRUE`.
      3. **3.C Missing Value Imputation Strategy**: `- **Confirm Imputation Strategy**: TRUE`.
         - ⚠️ **Strategy Lock & Knockout Integrity**: If Section 3.C is already confirmed with an intentional imputation strategy (e.g. `min_column` for genetic knockouts/knockdowns/pull-downs, or `randomforest_grouped` for MAR), **NEVER mutate or downgrade the confirmed strategy to `none`** based on apparent post-filter 0% missingness (in tidyproteomics, sparse tables omit unquantified rows rather than carrying explicit `NA` cells). Preserve the confirmed imputation strategy.
      4. **3.D Sample Group Renaming & Pooling Map**: `- **Confirm Sample Pooling Map**: TRUE` (and `- **Reassign Sample Names According to Pooling Map**: TRUE` if raw replicates map into cohorts).
      5. **3.E Target Contrasts**: `- **Confirm Target Contrasts**: TRUE` or `Status: CONFIRMED` (with non-empty `<treatment>/<control>` contrast).
      6. **3.F Confounded Batch Gate**: If batch confounding was detected (`- **Batch Confounding Detected**: TRUE`), verify `- **Proceed With Potential Batch Confounding**: TRUE` and `- **Confirm Batch Confounding Authorization**: TRUE`. **CRITICAL**: If `- **Batch Confounding Detected**: FALSE`, Section 3.F is completely unexposed, inactive, and SATISFIED. Do NOT treat `FALSE` for batch confounding detection as an unconfirmed gate or blocker.
      7. **3.G Functional Annotation Strategy**: If the target organism has been identified (i.e. `- **Taxon / Organism ID**` is populated with an identified organism/taxon ID and is not pending or unknown), verify `- **Confirm Functional Annotation Strategy**: TRUE` (specifying `uniprot` default, custom file path, or bypass). **CRITICAL**: If the target organism has NOT yet been identified (e.g. Taxon / Organism ID is PENDING or awaiting Phase 1 detection), Section 3.G is NOT a blocking gate and does NOT halt Phase 2 pre-flight execution.
    - **Mandatory Pre-Flight HITL Halt Check**:
      - If ANY required confirmation check (3.A Discovered Groups, 3.B Normalization, 3.C Imputation, 3.D Sample Pooling, 3.E Target Contrasts, or 3.G Annotation Strategy once target organism has been identified) is `FALSE`:
        - Ensure Section 3 subtasks (`3.A` through `3.E`, `3.G` if target organism identified, and `3.F` if detected) are cleanly populated with standard analytical defaults in `docs/experiment.md`, keeping `Confirm ...: FALSE`.
        - **DO NOT self-confirm gates**: Autonomous agents are strictly prohibited from editing `Confirm ...: FALSE` to `TRUE`.
        - Halt execution cleanly via a single `fail_phase` call listing ALL unconfirmed items so the researcher can review and confirm all items in one click:
          ```
          fail_phase(
            phaseName = "02_NORMALIZE_PEPTIDES",
            reason = "Pre-flight Study Design Gate: Human-in-the-loop (HITL) confirmation required for Section 3 subtasks (3.A Discovered Groups, 3.B Normalization, 3.C Imputation, 3.D Sample Pooling, 3.E Target Contrasts, and 3.G Annotation Strategy if organism identified) in docs/experiment.md.",
            actionableInsights = "ACTION REQUIRED: Open docs/experiment.md (highlighted in orange outline), verify each Section 3 subtask confirmation check, and click '🎯 Confirm All Study Design & Proceed' in the sidebar or Live Agent to resume Phases 02–11 uninterrupted."
          )
          ```
  - **Execute Sample Pooling & Condition Recoding**:
    - Once confirmed (`Reassign Sample Names According to Pooling Map: TRUE` and a non-empty mapping table exists in Section 3.D):
      - Apply sample reassignment for **all** rows in Section 3.D's mapping table in a single batch call using `tpa_reassign(mapping = { "raw_sample_1": "clean_group_1", ... })` before normalization benchmarking and variation analysis (never leave secondary cohorts ungrouped as $n=1$ singletons if mapped in Section 3.D).
      - Verify from the returned `experiments` table that samples are assigned to biological condition cohorts with replicates ($n \ge 2$) and that no cohort was accidentally collapsed.
      - Regenerate the identification counts plot using `tpa_plot(type = "counts", file_name = "data/plot_proteins_counts.png")` so `data/plot_proteins_counts.png` displays replicate counts grouped by biological condition rather than ungrouped raw sample columns.
      - Generate (or update) condition-level feature overlap plot using `tpa_plot(type = "venn")` (or `tpa_plot(type = "euler")`) so `data/plot_*_venn.png` reflects cleaned biological cohorts and contaminant-filtered proteins.
  - *Scientific Rationale for Pooling at Phase 2.1b*: Confirming Section 3 and pooling replicates into condition cohorts before Phase 2.2 ensures:
    1. `plot_counts()`, `plot_variation_cv()`, and `tpa_summary(by = "sample")` compute replicate CV distributions across biological condition groups rather than $n=1$ raw sample names.
    2. `plot_pca()` clusters and colors samples by biological condition rather than disparate raw file labels.
    3. Downstream condition-specific imputation (`group_by_sample = TRUE` in Phase 3) and differential expression (`limma` in Phase 4) run seamlessly without halting a second or third time.

#### Phase 2.2: Multi-Method Normalization Benchmarking & Sub-Population Support
- [ ] Check if normalization has already been applied in upstream operations (using the operations history in the Executive Blackboard or state card — do NOT make redundant `tpa_operations()` or `tpa_inspect(what = "quants")` calls):
  - If normalization is already present, preserve upstream normalization to prevent double-scaling and variance distortion. Run `tpa_summary(by = "normalization")` to verify.
  - If unnormalized, inspect Section 3.B (`### B. Quantitative Normalization Strategy`) in `docs/experiment.md`:
    - **Default Benchmarking (Linear Models + Loess)**: When `Normalization Methods` is `default` and `Normalization Subset Filter` is `NONE`, invoke `tpa_normalize(methods = ["scaled", "median", "linear", "limma", "loess"])`.
    - **Compute-Intensive Non-Linear Models (`randomforest`, `svm`)**: If Section 3.B specifies `randomforest`, `svm`, `all`, or a custom list, pass the requested methods to `tpa_normalize(methods = [...])`.
    - **Sub-Population Training (`subset_filter`)**: If Section 3.B specifies a `Normalization Subset Filter` other than `NONE` (e.g. `description %like% "Ribosome"` or `!description %like% "mitochondrial"`), pass `subset_filter = "<filter>"` and `methods = ["scaled", "median", "linear", "svm"]` to `tpa_normalize(...)`. *(Note: Only `scaled`, `median`, `linear`, and `svm` can extrapolate normalization factors beyond the training subset; `limma`, `randomforest`, and `loess` cannot extrapolate out-of-sample).*
    - **Automatic Selection vs. Manual Override**: `tpa_normalize` automatically selects the optimal method via `select_normalization()` (minimizing median replicate CV), activates it as the current assay in memory, and returns the full `summary(data, "normalization")` benchmark table!
      - **DO NOT call `tpa_select_normalization()` if accepting the automatically selected method** (doing so with empty arguments or repeating the active selection is a redundant no-op that wastes turns).
      - Only invoke `tpa_select_normalization(normalization = "<method>")` if explicitly overriding automatic selection with a different algorithm.
      - When the top two candidate methods differ by $< 5\%$ in median replicate CV or when `subset_filter` is applied, optionally invoke `tpa_normalization_sensitivity(comparison = "<treatment>/<control>")` to verify that top regulated candidates are invariant to the choice of scaling algorithm.
- [ ] **Checkpoint 2.2**: Verify that normalized abundances are confirmed in stdout and log (displaying replicate CV and PC1 metrics for benchmarked candidates or confirming pre-existing normalized state).

#### Phase 2.3: Quantitative Variation Benchmarking & CV Reduction Verification
- [ ] Benchmark quantitative variation across normalization candidates:
  - Generate CV variation plot using `tpa_plot(type = "variation_cv")` (when multiple quantitative layers exist, automatically saved to `data/`).
  - Generate PCA scores plot using `tpa_plot(type = "pca")` (automatically saved to `data/`).
  - Optionally generate unsupervised sample clustering heatmap using `tpa_plot(type = "heatmap")`.
- [ ] **Variation & Clustering Audit Check**:
  - Confirm from the normalization summary that the selected method minimized median replicate CV relative to raw abundance.
  - Confirm biological replicate clustering and condition separation along PC1/PC2.

#### Phase 2.4: Object Persistence, Authoritative Accounting & Checkpoint Verification
- [ ] **Authoritative Feature Accounting & Discrepancy Prevention**:
  - Run `tpa_inspect(what = "protein_accounting")` (or `accounting`) to review the authoritative feature counts breakdown.
  - Understand the accounting metric distinction:
    - `tpa_subset` reports the *total entities retained in the data object* (e.g. 1,941 proteins).
    - `tidyproteomics::summary(by = "global")` reports *quantifiable entities with at least one non-missing abundance across samples* (e.g. 1,908 proteins; 33 proteins have all-NA abundance in the active raw/normalized assay and are not quantifiable).
  - In your phase summary and reports, explicitly cite both metrics: e.g., *"1,941 total proteins retained after contaminant and 2-peptide filtering; 1,908 quantifiable proteins with observed abundance (33 background entities have 0 quantifiable values)"*. Never leave this as an unexplained discrepancy across phases.
  - **Tool Discipline**: Do NOT call redundant inspection tools (`tpa_inspect(what = "experiments")`, `tpa_inspect(what = "operations")`) right after passing `check_checkpoint_gate` or right before calling `complete_phase`.
- [ ] Persist the normalized dataset and generate reproducible R script:
  - Invoke `tpa_export_state(rds_path = "data/tidyproteomics_data.rds", script_path = "code/02_normalize.R")`.
- [ ] **Checkpoint 2.4**:
  1. `logs/02_normalize/console.log` exists on disk with non-zero file size.
  2. `data/tidyproteomics_data.rds` and `code/02_normalize.R` exist on disk with non-zero file size and contain normalized abundance layers.
  3. PCA score plot (`data/plot_*_pca_PC1PC2.png`) exists on disk with non-zero file size.
  4. If multiple quantitative layers exist, variation plot (`data/plot_*_normalizated_variation.png`) exists on disk (along with optional `data/plot_*_heatmap.png` if generated).
- [ ] **Complete Phase (Automated Blackboard Recording)**:
  - Do NOT manually edit `docs/notes.md` via file tools; the orchestrator automatically records your `complete_phase` summary into `docs/notes.md`.
  - Invoke `complete_phase` with a comprehensive summary including the selected normalization method (e.g., `loess`, `limma`, `median`), replicate CV statistics demonstrating variance minimization, PCA clustering observations (PC1/PC2 variance explained and replicate tightness), and reconciled feature accounting:
    `complete_phase(phaseName = "02_NORMALIZE", summary = "Normalization benchmarking/verification completed (<selected_method> selected; <N_total> retained proteins, <N_quant> quantifiable). Confirmed replicate CV reduction (<raw_cv>% -> <norm_cv>%), verified replicate clustering on PCA (PC1 <X>%, PC2 <Y>%), generated diagnostic plots, and persisted data/tidyproteomics_data.rds.")`
