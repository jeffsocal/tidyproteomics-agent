---
tools: [tpa_load, tpa_inspect, tpa_collapse, tpa_protein_map, tpa_plot, tpa_export_table, tpa_export_state, tpa_set_workspace]
---

### Phase 5: Peptide-to-Protein Roll-Up & Sequence Coverage Mapping

Execute this phase using live `tpa_*` MCP tools in memory (or execute `code/05_collapse_map.R` if offline). All tool executions and outputs are automatically recorded to `logs/05_collapse_map/console.log`. In this final phase of the Peptide Resolution pipeline, you will roll up quantified peptides into protein-level abundance using razor-local assignment, map peptide sequence coordinates against protein sequences, and compare peptide vs. protein-level fold changes.

---

#### Phase 5.1: Peptide-to-Protein Roll-Up (`tpa_collapse`)
- [ ] **Load Peptide State**:
  - The peptide dataset is active in memory (or call `tpa_load(source = "data/tidyproteomics_data.rds", analyte = "peptides")`).
- [ ] **Execute Peptide-to-Protein Roll-Up**:
  - Roll up peptides to protein abundance:
    `tpa_collapse(collapse_to = "protein", assign_by = "razor-local")`
  - Review the collapsed state card: note the number of resulting quantified proteins and updated dynamic range.
- [ ] **Checkpoint 5.1**: Confirm that the dataset analyte transitioned from `peptides` to `protein` in memory.

#### Phase 5.2: Protein Sequence Mapping (`tpa_protein_map`)
- [ ] **Map Peptides to Sequences**:
  - If a FASTA file is available in `reference/` or `data/`:
    `tpa_protein_map(fasta_path = "{{FASTA_PATH}}")`
  - Verify that peptide start/end coordinates are mapped to protein accessions.
- [ ] **Generate Protein Sequence Coverage Plot**:
  - Generate a sequence coverage plot for top candidates: `tpa_plot(type = "protein", protein = "<top_protein_accession>")`.
- [ ] **Checkpoint 5.2**: Confirm sequence coverage plots are generated in `data/`.

#### Phase 5.3: Export Collapsed Tables & Final State
- [ ] **Export Collapsed Protein Table**:
  - Export quantitative matrix: `tpa_export_table(type = "quant", file_name = "data/table_proteins_collapsed.tsv")`.
- [ ] **Persist State**:
  - Invoke `tpa_export_state(rds_path = "data/tidyproteomics_data.rds", script_path = "code/05_collapse_map.R")`.
- [ ] **Complete Phase**:
  - Invoke `complete_phase`:
    `complete_phase(phaseName = "05_COLLAPSE_MAP", summary = "Peptide roll-up complete. Successfully collapsed quantified peptides into <N> proteins via razor-local assignment. Mapped sequence coordinates and persisted data/tidyproteomics_data.rds.")`

