---
tools: []
---

### Phase 9: Literature Knowledge Database Interrogation & Third-Layer Conclusions

In this phase, you (the LLM) will use the literature search strategy formulated in `08_WEBSEARCH` (`docs/websearch.md`) to interrogate the "Literature Knowledge Database" (the active DuckDB literature database). 

You will synthesize evidence across:
- `08_WEBSEARCH` (`docs/websearch.md` and `data/actionable_synthesis.json`, which already synthesize the primary observations and internal knowledge from Phases 6–8)
- The retrieved molecular assertions, graph-hop evidence, and reverse-interrogation results

to further contextualize the observations and develop the **third layer of conclusions**.

If new hypotheses or candidate networks emerge from the literature assertions:
- Run `tools/literature/interrogate_unthresholded_proteomics.R` or custom scripts in `code/09_literature.R` via `execute_command` (logged to `logs/09_literature/console.log`).
- Document any **new** data-derived observations in `docs/literature.md`.

Finally, you will construct `docs/literature.md` documenting both the **new** observations and **new** third-layer conclusions, with all references documented.

---

> [!IMPORTANT]
> **Turn Budget & Batched Execution Directive**:
> - **Fast-Path When Literature DB is DISABLED (2 Turns Total)**: If `### ACTIVE LITERATURE DATABASE` in the runtime blackboard above is `DISABLED` (or absent):
>   - **Turn 1**: Read `docs/websearch.md` (do NOT waste turns re-reading `docs/observations.md` or `docs/knowledge.md`, or running shell/R scripts).
>   - **Turn 2**: Author `docs/literature.md` with `literature_status: SKIPPED (NO_LOCAL_LITERATURE_DB)` in the header, synthesizing the Tier 1/2/3 literature calibration and `data/actionable_synthesis.json` roadmap, and immediately call `complete_phase` in the same or next turn. Do NOT manually edit `docs/notes.md`.
> - **When Literature DB is ENABLED (4–6 Turns Total)**:
>   1. Run literature graph queries in batch across all candidate seeds/pathways in one command.
>   2. Run reverse interrogation across nominated candidates in batch with `interrogate_unthresholded_proteomics.R`.
>   3. **Never run Python one-liner parsing scripts or inspect candidates one by one**: `interrogate_unthresholded_proteomics.R` automatically formats ready-to-use markdown tables and FGSEA statistics directly in stdout and writes `docs/literature_candidates.md` (and `data/literature_candidate_expression.csv`).
>   4. Ingest `docs/literature_candidates.md` or the stdout markdown directly, author `docs/literature.md` completely in 1–2 turns, verify required checkpoints, and call `complete_phase` promptly.

#### 1. Pre-Flight Verification & Inputs Ingestion
Before proceeding:
1. Check the runtime blackboard above for `### ACTIVE LITERATURE DATABASE`.
2. Read `docs/websearch.md` in Turn 1 (which already integrates Phase 6–8 findings, `seed_symbols`, `pathway_terms`, and the `data/actionable_synthesis.json` summary). Do NOT re-read `docs/observations.md` or `docs/knowledge.md` unless a specific unquoted number is needed.

---

#### 2. Interrogating the Literature Knowledge Database

##### Strategy A: When DuckDB Literature Database is ENABLED (Two-Way R Interrogation Loop)
Execute the iterative graph interrogation loop:
`R_proteomic_data + user_insight >> query_literature >> llm_rationalize_candidates >> interrogate_unthresholded_proteomics >> compile_observations`

1. **Step 2A: Query Literature via `tools/literature/query_literature.R`**:
   - Extract the `seed_symbols` and `pathway_terms` defined in `docs/websearch.md`.
   - Execute the graph-hop query skill:
     ```bash
     Rscript tools/literature/query_literature.R <literature_db_path> "<seed_symbols>" "<pathway_terms>" 20
     ```
   - This hops across `context_id` and `functional_module` to return candidate co-factors, physical interactors, and direct substrates `[X, Y, Z]` reported in the literature that may have missed strict volcano plot thresholds.
   - If querying multiple specific candidate symbols directly via `tools/literature/literature_cli.R search`, supply them as a comma-separated list in a single batch call (e.g. `Rscript tools/literature/literature_cli.R search <literature_db_path> "HERPUD1,ATF6,EDEM1,EEA1,NSFL1C,RACGAP1" 5`) rather than running iterative single-gene bash loops.

2. **Step 2B: LLM Rationalization of Retrieved Candidates & Evidentiary Distance Tiering**:
   - Review the retrieved assertions, supporting `study_id` references, and `evidence_quote` notes.
   - **Assign Evidentiary Tiers**:
     - **Tier 1 (Direct Match):** Same species, same tissue/cell type, same condition (e.g., human lung granuloma tissue proteomics or spatial transcriptomics).
     - **Tier 2 (Surrogate Matrix / Proximal Model):** Human peripheral biofluids (plasma, serum) or in vitro human primary cell models. Must be explicitly labeled as *surrogate context*, not tissue validation.
     - **Tier 3 (Distal Context):** Animal models (e.g., mouse, rabbit) or transformed cell lines.
   - Select the most biologically compelling candidate genes or functional modules hypothesized to exhibit coordinate sub-threshold regulation in the empirical tissue.

3. **Step 2C: Reverse-Interrogate Unthresholded Proteomics Data**:
   - Execute the reverse-interrogation skill in a single batch against `data/tidyproteomics_data.rds`:
     ```bash
     Rscript tools/literature/interrogate_unthresholded_proteomics.R "<candidate_symbols>" "<module_name>" data/tidyproteomics_data.rds
     ```
   - **Zero-Turn Direct Ingestion**:
     - The script automatically outputs complete Markdown summary tables and FGSEA metrics (`NES`, `pval`, `leadingEdge`) directly to stdout AND saves `docs/literature_candidates.md`.
     - Do NOT write Python or shell scripts to extract fields from JSON or temporary files. Ingest `docs/literature_candidates.md` or copy the stdout table directly into `docs/literature.md`.
   - **Audit Concordance & Non-Replicated Literature Candidates**:
     - Candidates showing coordinated nominal shifts ($p < 0.05$) or concordant directional drift are flagged as **"Corroborated / Concordance: WEAK/MODERATE/STRONG"**.
     - Candidates showing no change ($p > 0.05$ or $|\log_2\text{FC}| < 0.5$, such as `COL15A1` or `MMP2` in tissue when nominated from plasma) must be explicitly classified as **"Non-Replicated / Concordance: NONE"**.
     - **Prohibition on Speculative Hijacking**: Do NOT generate multi-paragraph speculative hypotheses explaining away non-replicated literature genes. Document their lack of replication concisely (1–2 sentences) as empirical divergence between local tissue pathology and surrogate matrices.
   - Any identified sub-threshold shifts must be recorded as **new observations** in `docs/literature.md`.

##### Strategy B: When Literature Database is DISABLED (2-Turn Fast-Path Fallback)
If no active DuckDB literature database is configured (e.g. `ACTIVE LITERATURE DATABASE` is `DISABLED` or `literature/` lacks `.duckdb` files):
- Record `literature_status: SKIPPED (NO_LOCAL_LITERATURE_DB)` in the report header of `docs/literature.md` and in the `complete_phase` summary (do NOT manually edit `docs/notes.md`).
- Target & Biomarker Corroboration: In `docs/literature.md`, synthesize known biological literature for the system based on web search (`docs/websearch.md`) and baseline annotations, explicitly applying Evidentiary Distance Tiering (Tier 1 vs. Tier 2 vs. Tier 3).
- **No Synthetic Candidate Forcing**: Do NOT generate artificial or duplicate DE entries in `docs/literature_candidates.md` or `data/literature_candidate_expression.csv` if no external literature database exists. Leave literature candidates empty so downstream phases know literature validation was skipped.
- Cite standard literature by Author (Year). Never invent or hallucinate numerical PMIDs or DOIs.

---

#### 3. Interactive Data Queries via `tidyproteomics query tools (tpa_extract, tpa_run_code, or Rscript)` (Pursuing Literature Hypotheses)
If the literature database assertions point to additional protein families, isoform differences, or pathway branches:
- Write and execute `code/09_literature.R` (output is automatically captured to `logs/09_literature/console.log`):
  ```bash
  if [ -f tools/lint_tidyproteomics.R ]; then Rscript tools/lint_tidyproteomics.R code/09_literature.R && Rscript code/09_literature.R; else Rscript code/09_literature.R; fi
  ```
- Use canonical `tidyproteomics` methods per `tidyproteomics query tools (tpa_extract, tpa_run_code, or Rscript)` to extract unthresholded metrics or verify target-interactor relationships.
- Document any **new** data-derived findings in `docs/literature.md`.

---

#### 4. Developing Third-Layer Biological Conclusions & Actionable Target Calibration (Data-First Literature Calibration)
Synthesize all prior layers into a deep mechanistic framework, ensuring the primary empirical data remains the driving narrative:
1. **Calibration by Evidentiary Distance**:
   - Give primary interpretive weight to Tier 1 (direct tissue/organism) evidence.
   - Treat Tier 2 (surrogate plasma/biofluid) studies strictly as comparative contrasts, not surrogate truth.
2. **Integration of Literature Assertions & Experimental Shifts**:
   - Reconcile the primary data with molecular assertions from the literature database.
   - Ground functional interpretations with verbatim quotes (`evidence_quote`) and verified study IDs.
3. **Sub-Threshold Coordinated Regulation vs. Non-Replication**:
   - Differentiate genuine sub-threshold complexes (concordant directional drift among multiple subunits) from isolated non-replicated literature candidates (`Concordance: NONE`).
4. **Refining the Actionable Synthesis (`data/actionable_synthesis.json`)**:
   - Verify that `data/actionable_synthesis.json` (created in Phase 8) exists on disk. If Phase 9 literature interrogation revealed additional corroborated complex members or refined the role classification of any candidate (`Predictive Biomarker`, `Druggable Target`, `Mechanistic Dependency`, `Compensatory Buffer`), update `data/actionable_synthesis.json` accordingly (or create it now following the Phase 8 JSON schema if it was not yet written).
5. **Reconciliation with Experimental Hypothesis & Actionable Next Steps**:
   - Point-by-point reconciliation with `docs/experiment.md`:
     - Which hypothesized effects are definitively supported by the integrated evidence?
     - What compensatory or secondary pathways are newly revealed?
     - What concrete next experimental steps (orthogonal validation, epistatic/pharmacological perturbation, translational cohort/time-course testing) directly test the derived model?

---

#### 5. Direct Construction of `docs/literature.md`
Write `docs/literature.md` directly, referencing `docs/llm.md` for active model details. Ensure it begins with the standard document header immediately below the title:

```markdown
# Literature Knowledge Database Interrogation & Third-Layer Conclusions

Created: YYYY-MM-DD HH:MM  
Author: PROVIDER | LLM-MODEL  
Agent: TidyProteomicsAgent vX.X.X  
R Package: tidyproteomics vX.X.X  
```

Organize the document strictly into the following structured sections:

1. **Literature Database Interrogation Status & Search Parameters**:
   - Status (ENABLED / DISABLED), database path, query seed symbols (`seed_symbols`), and pathway terms (`pathway_terms`) used.
2. **Retrieved Molecular Assertions & Evidence Subgraph**:
   - Markdown table of candidate proteins retrieved: Candidate Symbol, Relationship Type (`interacts_with`, `regulates`, `substrate_of`), Functional Module, Study ID, Evidentiary Tier (Tier 1/2/3), and verbatim `evidence_quote`.
3. **Reverse-Interrogation & Sub-Threshold Proteomics Dynamics**:
   - Quantitative results from `interrogate_unthresholded_proteomics.R`: Candidate Gene Symbol, observed $\log_2\text{FC}$, nominal $p$-value, directional trend, custom pathway `fgsea` enrichment statistics (`NES`, `pval`), and **Concordance Status** (`STRONG`, `MODERATE`, `WEAK`, or `NONE - Non-Replicated`).
   - Concise summary of non-replicated candidates (1–2 sentences) documenting divergence between tissue and surrogate models.
4. **Follow-Up Data Inquiries & New Observations**:
   - If targeted queries were run via `code/09_literature.R`, document hypotheses tested, candidate proteins queried, and **new data-derived observations**.
5. **Third-Layer Biological Conclusions (Data-First Integration)**:
   - Deep mechanistic synthesis integrating literature assertions with observed remodeling.
   - Dissection of coordinated complex dynamics, direct vs. indirect regulatory cascades, and cellular adaptations.
   - Primary empirical findings MUST lead the discussion; external literature must calibrate rather than hijack the narrative.
6. **Experimental Hypothesis Reconciliation & Actionable Next Steps**:
   - Comprehensive point-by-point evaluation against the working hypothesis in `docs/experiment.md`.
   - Finalized summary of the **Actionable Archetype**, **Validated Biological Signatures**, **Role-Classified Candidate Targets**, and prioritized **"What To Do Next" Experimental Roadmap** (`data/actionable_synthesis.json`).
7. **Documented Literature References**:
   - Formatted list of all cited studies: Study ID, Author, Year, Title, Evidentiary Tier (Tier 1/2/3), and verified PMID/DOI. Include verbatim quotes where appropriate.

---

#### 6. Phase Completion Gate
- [ ] **Checkpoint Gate**:
  1. `docs/websearch.md`, `docs/knowledge.md`, and `docs/observations.md` successfully ingested.
  2. Literature query scripts (`query_literature.R`, `interrogate_unthresholded_proteomics.R`, or `code/09_literature.R`) executed cleanly with output logged to `logs/09_literature/console.log` (or `logs/09_literature.log`).
  3. `data/actionable_synthesis.json` verified present on disk with valid JSON structure.
  4. `docs/literature.md` exists on disk with non-zero size, containing third-layer conclusions, actionable next-step synthesis, sub-threshold dynamics, and documented references.
- [ ] **Complete Phase**:
  - Invoke `complete_phase(phaseName = "09_LITERATURE", summary = "Literature database interrogation complete in docs/literature.md with third-layer conclusions, finalized actionable synthesis in data/actionable_synthesis.json, and grounded citations.")`
