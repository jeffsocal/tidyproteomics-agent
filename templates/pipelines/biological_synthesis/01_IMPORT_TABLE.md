---
tools: [tpa_health, tpa_import_expression_table, tpa_inspect, tpa_query_expression, tpa_plot, tpa_export_state, tpa_set_workspace]
---

### Phase 1: Pre-Computed Differential Table Ingestion & Scaffolding

Execute this phase using live `tpa_*` MCP tools in memory (or execute `code/01_import_table.R` if offline). All tool executions and outputs are automatically recorded to `logs/01_import_table/console.log`. In this initial phase of the Post-DE Biological Synthesis pipeline, you will ingest a pre-computed differential expression table (CSV/TSV from MaxQuant, MSstats, Perseus, or Limma), convert it into a persistent in-memory tidyproteomics object, and scaffold Section 3 of `docs/experiment.md`.

---

#### Phase 1.1: Ingest Differential Expression Table
- [ ] **Locate External Expression Table (`docs/experiment.md`)**:
  - Extract the differential expression table path from `docs/experiment.md` Section 2 (or search `data/` or `data/raw/` for `*.csv` or `*.tsv` containing fold change or p-values).
- [ ] **Import Table via `tpa_import_expression_table`**:
  - Ingest the table directly:
    `tpa_import_expression_table(file_path = "{{PATH_TO_DE_TABLE}}", comparison = "{{COMPARISON}}")`
  - The tool auto-detects column names for protein accession (`id_col`), gene symbol (`gene_name_col`), log2 fold-change (`log2fc_col`), p-value (`pvalue_col`), and adjusted p-value/FDR (`padj_col`).
  - Verify from the tool response that proteins are imported and significant counts are reported.
- [ ] **Checkpoint 1.1**: Verify that the dataset topology is registered in memory.

#### Phase 1.2: Candidate Profiling & Volcano Diagnostic
- [ ] **Profile Top Regulated Candidates**:
  - Query top candidates via `tpa_query_expression(log2fc_min = 1.0, significance_max = 0.05, top_n = 20)`.
- [ ] **Generate Primary Volcano Plot**:
  - Call `tpa_plot(type = "volcano")` (saving `data/plot_proteins_volcano.png`).
- [ ] **Checkpoint 1.2**: Confirm volcano plot is generated in `data/`.

#### Phase 1.3: Experimental Alignment & Section 3 Scaffolding
- [ ] **Scaffold Section 3 in `docs/experiment.md`**:
  - Scaffold Section 3.A with the imported comparison and protein counts.
  - Set Section 3.E (`Target Contrasts`) to the imported comparison.
  - Set Section 3.G (`Functional Annotation Strategy`) to remote fetch via UniProt KB REST API.
- [ ] **State Persistence & Phase Gate Verification**:
  - Invoke `tpa_export_state(rds_path = "data/tidyproteomics_data.rds", script_path = "code/01_import_table.R")`.
- [ ] **Checkpoint 1.3 (Phase Gate Verification)**:
  1. `data/tidyproteomics_data.rds` and `code/01_import_table.R` exist on disk.
  2. Volcano plot (`data/plot_proteins_volcano.png` or `data/*volcano*.png`) exists in `data/`.
- [ ] **Complete Phase**:
  - Invoke `complete_phase`:
    `complete_phase(phaseName = "01_IMPORT_TABLE", summary = "Pre-computed expression table successfully ingested into tidyproteomics (<N> proteins, <N_sig> significant). Generated volcano plot and scaffolded study design.")`

