---
tools: [tpa_health, tpa_load, tpa_inspect, tpa_audit_annotations, tpa_integrate_annotations, tpa_fetch_annotations, tpa_list_annotations, tpa_enrichment, tpa_batch_analysis, tpa_query_enrichment, tpa_plot, tpa_export_table, tpa_operations, tpa_export_state]
---

### Phase 5: Functional Annotation Assessment & Pathway Enrichment

Execute this phase using live `tpa_*` MCP tools in memory (or execute `code/05_enrichment.R` if offline). All tool executions and outputs are automatically recorded to `logs/05_enrichment/console.log`. Upon satisfying all enrichment checkpoints, invoke `tpa_export_state` to generate `code/05_enrichment.R` and save `data/tidyproteomics_data.rds`. You must strictly enforce all checkpoints below.

---

#### Phase 5.1: Functional Annotation Assessment Gate & Integration
- [ ] **In-Memory State Continuity**: The dataset is active in memory from Phase 4. If reloading is needed, call `tpa_load(source = "data/tidyproteomics_data.rds")`.
- [ ] **Extract & Audit Functional Annotation Categories**:
  - Run `tpa_inspect(what = "annotation_terms")`.
  - Check whether canonical biological ontology terms (`biological_process`, `cellular_component`, `molecular_function`, `reactome_pathway`, `kegg`) are already attached.
- [ ] **Execute Configured Annotation Strategy (Section 3.G of `docs/experiment.md`)**:
  - Inspect Section 3.G (`### G. Functional Annotation Strategy`) in `docs/experiment.md`:
    1. **Remote UniProt KB Fetch (`Annotation Source: uniprot`)**:
       - If canonical ontology categories are absent in memory, execute remote fetching:
         `tpa_fetch_annotations(source = "uniprot", categories = "biological_process, cellular_component, molecular_function, reactome_pathway")`
       - This queries UniProt KB REST API in batches, caches the annotations table to `data/annotations_uniprot.tsv`, records provenance in `data/annotations_provenance.json`, attaches the terms to the dataset, and logs reproducible R code.
    2. **Local Annotation Table (`Annotation Source: file`)**:
       - If a local file path is configured, audit and attach:
         `tpa_audit_annotations(file_path = "<file_path>")`
         `tpa_integrate_annotations(file_path = "<file_path>", duplicates = "merge")`
    3. **Bypass Mode (`Annotation Source: none`)**:
       - If Section 3.G specifies `none` or bypass, preserve existing state and proceed to Phase 6 and Phase 7.
- [ ] **Annotation Adequacy & Autonomous Continuation Mandate**:
  - If canonical ontology categories (`biological_process`, `cellular_component`, `molecular_function`, `reactome_pathway`) are present (either from ingestion or fetched/integrated):
    - Proceed immediately to **Phase 5.2**.
  - If NO biological ontology categories or grouping annotations exist (e.g., only `gene_name` and free-text `description` are present):
    1. **Gene Symbol & Annotation Resolution Obligation**:
       - Verify whether `gene_name` or `description` are populated across rows. If identifiers are bare accessions but `fasta_header` is present in the object annotations, parse `GN=` gene symbols and protein titles into `gene_name` and `description` (e.g., via `tpa_run_code` or `tpa_integrate_annotations`), ensuring downstream Phase 6 expression tables and volcano labels are not accession-only.
       - **Annotation Attachment Verification Rule**: You may claim that gene symbols or descriptions are attached/populated ONLY if you quote the verbatim output of `tpa_inspect(what = "annotation_terms")`. If `tpa_fetch_annotations` failed or `data/annotations_uniprot.tsv.status.json` has `written: false`, explicitly record `ANNOTATION_UNAVAILABLE` with the tool error and do NOT claim that external database annotations were written.
       - If external ontology mapping is impossible or bypassed, document `ANNOTATION_UNAVAILABLE` as a formal empirical finding (empty ontologies are a valid negative analytical result, never an error).
    2. **CRITICAL AUTONOMOUS CONTINUATION MANDATE (DO NOT HALT)**:
       - **NEVER halt execution, stop calling tools, or invoke `fail_phase` when formal ontology terms are absent or bypassed.**
       - Do NOT manually edit `docs/notes.md` via file tools; the orchestrator automatically records your `complete_phase` summary into `docs/notes.md`.
       - Invoke `tpa_export_state(rds_path = "data/tidyproteomics_data.rds", script_path = "code/05_enrichment.R")`.
       - **Invoke `complete_phase(phaseName = "05_ENRICHMENT", summary = "Standard pathway enrichment bypassed due to absence or bypass of formal biological ontology annotations (GO/Reactome/KEGG); gene symbols and descriptions verified/attached, and data preserved for Phase 6 observations and Phase 7 de novo functional module testing.")`** so the pipeline autonomously advances to Phase 6 and Phase 7.

#### Phase 5.2: Multi-Category Pathway Enrichment Testing & Enforced Batch Processing
- [ ] If functional ontology terms are available:
  - Calculate multi-category pathway enrichment across all available ontology terms for each evaluated contrast (multiple terms may be supplied comma-separated in a single call per contrast):
    `tpa_enrichment(comparison = "<treatment>/<control>", terms = "<term_1>,<term_2>,...", method = "wilcoxon")`
- [ ] **Batch Export & Faceted Plotting (`tidyproteomics::enrichment() |> tidyproteomics::analyze_enrichments()`)**:
  - Immediately following `tpa_enrichment`, **execute `tpa_batch_analysis(type = "enrichments", top_n = 50)`**:
  - This aggregates all tested ontologies across comparisons, annotates member-set hashes (`set_md5`), statistic IDs (`statistic_id`), and tie groups (`score_tie_group`), generates the multi-ontology faceted `proteins_enrichment` summary plot (`data/plot_proteins_enrichment_<contrast>.png`), and exports the master enrichment table (`data/table_proteins_enrichment_<contrast>.csv` / `.tsv`). *(Note: When `n_contrasts == 1`, explicitly note that `analyze_enrichments()` is a faceted plot and table export of the modeled enrichment, not a second statistical test).*
- [ ] **Enrichment Score Sign Convention & Tied-Score Family Rule**:
  - In `tidyproteomics`, the Wilcoxon rank-sum enrichment score represents the median/rank shift of member $\log_2\text{FC}$ values relative to background proteins. For a contrast structured as `<treatment>/<control>` (where $\log_2\text{FC} > 0$ means higher abundance in treatment):
    - **Positive (`+`) score**: The pathway/term is shifted toward upregulated proteins (accumulated/induced in treatment).
    - **Negative (`-`) score**: The pathway/term is shifted toward downregulated proteins (depleted/repressed in treatment).
  - **Tied Enrichment Scores (`score_tie_group`)**: If $\ge 3$ terms share an identical enrichment score and $q$-value at unequal or overlapping set sizes (flagged by `[ENRICHMENT TIE / OVERLAP WARNING]` or `score_tie_group = TIE_GROUP_*`), **describe them as one tied ubiquitin/proteasome (or shared-driver) pathway family, NOT as independent pathway hits.**
  - Explicitly apply this definitive sign convention and tied-family rule in your phase summary and downstream reports.
- [ ] **Checkpoint 5.2**: Confirm from the `tpa_batch_analysis` output that enrichment plots and tables were generated.

#### Phase 5.3: Optional Member-Gene Annotated Exports
- [ ] Batch analysis automatically generates the master `proteins_enrichment` plot and table. If individual ontology tables with attached member gene symbols are desired for leading-driver resolution:
  - `tpa_export_table(type = "analysis", analysis = "enrichment", comparison = "<treatment>/<control>", term = "<term>", append = "gene_name", file_name = "data/table_proteins_enrichment_<term>_<contrast>.tsv")`

#### Phase 5.4: Object Persistence & Checkpoint Verification
- [ ] Persist the enriched (or preserved) dataset and generate reproducible R script:
  - Invoke `tpa_export_state(rds_path = "data/tidyproteomics_data.rds", script_path = "code/05_enrichment.R")`.
- [ ] **Checkpoint 5.4**:
  1. `logs/05_enrichment/console.log` exists on disk with non-zero file size.
  2. `data/tidyproteomics_data.rds` and `code/05_enrichment.R` exist on disk with non-zero file size.
  3. If functional terms were analyzed: enrichment tables (`data/table_*enrichment_*.tsv` or `.csv`) and enrichment plots (`data/*enrichment_*.png`) exist in `data/` with non-zero file sizes.
- [ ] **Complete Phase (Automated Blackboard Recording)**:
  - Do NOT manually edit `docs/notes.md` via file tools; the orchestrator automatically records your `complete_phase` summary into `docs/notes.md`.
  - Invoke `complete_phase` with a comprehensive summary including the functional ontology categories tested (or bypass notice), top significant pathways ($q \le 0.05$) with direction (`+` induced / `-` repressed), and key driving member genes:
    `complete_phase(phaseName = "05_ENRICHMENT", summary = "Functional annotation assessment and pathway enrichment completed across <terms> and batch-analyzed via analyze_enrichments(). Exported proteins_enrichment plot and enrichment tables, and persisted data/tidyproteomics_data.rds.")`
  - **CRITICAL AUTONOMY MANDATE**: You MUST invoke `complete_phase` to advance the pipeline. Never halt execution or wait for user instructions when ontology terms are absent.
