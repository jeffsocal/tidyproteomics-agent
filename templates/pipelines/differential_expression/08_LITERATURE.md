---
tools: []
---

### Phase 8: Literature Knowledge Database Interrogation & Second-Layer Conclusions

In this phase, you (the LLM) will use the candidate seed symbols, functional modules, and biological themes formulated in `07_KNOWLEDGE` (`docs/knowledge.md`) to interrogate the "Literature Knowledge Database" (the active DuckDB literature database). 

You will synthesize evidence across:
- `07_KNOWLEDGE` (`docs/knowledge.md` and `data/de_novo_modules.tsv`, which already synthesize the primary observations from `docs/observations.md`)
- The retrieved molecular assertions, graph-hop evidence, and reverse-interrogation results from the curated literature database

to further contextualize the observations, develop the **second layer of conclusions**, and emit the initial **Actionable Synthesis Contract (`data/actionable_synthesis.json`)** translating the empirical findings into validated signatures, role-classified candidates, and experimental next steps.

Crucially, as you interrogate the peer-reviewed corpus, you will identify **unresolved mechanistic questions, uncharacterized candidates, and biological knowledge gaps** to formulate a prioritized, surgical **Web Search Strategy** for Phase 09 (`09_WEBSEARCH.md`).

If new hypotheses or candidate networks emerge from the literature assertions:
- Run `tools/literature/interrogate_unthresholded_proteomics.R` or custom scripts in `code/08_literature.R` via `execute_command` (logged to `logs/08_literature/console.log`).
- Document any **new** data-derived observations in `docs/literature.md`.

Finally, you will construct `docs/literature.md` and persist `data/actionable_synthesis.json`.

---

> [!IMPORTANT]
> **Turn Budget & Batched Execution Directive**:
> - **Fast-Path When Literature DB is DISABLED (2 Turns Total)**: If `### ACTIVE LITERATURE DATABASE` in the runtime blackboard above is `DISABLED` (or absent):
>   - **Turn 1**: Read `docs/knowledge.md` (do NOT waste turns re-reading `docs/observations.md`, or running shell/R scripts).
>   - **Turn 2**: Author `docs/literature.md` with `literature_status: SKIPPED (NO_LOCAL_LITERATURE_DB)` in the header, initialize `data/actionable_synthesis.json`, formulate targeted web search terms for Phase 09, and immediately call `complete_phase`. Do NOT manually edit `docs/notes.md`.
> - **When Literature DB is ENABLED (4–6 Turns Total)**:
>   1. Run literature graph queries in batch across all candidate seeds/pathways in one command.
>   2. Run reverse interrogation across nominated candidates in batch with `interrogate_unthresholded_proteomics.R`.
>   3. **Never run Python one-liner parsing scripts or inspect candidates one by one**: `interrogate_unthresholded_proteomics.R` automatically formats ready-to-use markdown tables and FGSEA statistics directly in stdout and writes `docs/literature_candidates.md` (and `data/literature_candidate_expression.csv`).
>   4. Ingest `docs/literature_candidates.md` or the stdout markdown directly, author `docs/literature.md`, persist `data/actionable_synthesis.json`, verify required checkpoints, and call `complete_phase` promptly.

---

#### 1. Pre-Flight Verification & Inputs Ingestion
Before proceeding:
1. Check the runtime blackboard above for `### ACTIVE LITERATURE DATABASE`.
2. Read `docs/knowledge.md` in Turn 1 (which already integrates Phase 6 observations, Phase 7 de novo modules, and candidate seed symbols). Do NOT re-read `docs/observations.md` unless a specific unquoted number is needed.

---

#### 2. Interrogating the Literature Knowledge Database

##### Strategy A: When DuckDB Literature Database is ENABLED (Two-Way R Interrogation Loop)
Execute the iterative graph interrogation loop:
`R_proteomic_data + user_insight >> query_literature >> llm_rationalize_candidates >> interrogate_unthresholded_proteomics >> compile_observations`

1. **Step 2A: Query Literature via `tools/literature/query_literature.R`**:
   - Extract candidate seeds and pathway terms from `docs/knowledge.md`.
   - Execute the graph-hop query skill:
     ```bash
     Rscript tools/literature/query_literature.R <literature_db_path> "<seed_symbols>" "<pathway_terms>" 20
     ```
   - This hops across `context_id` and `functional_module` to return candidate co-factors, physical interactors, and direct substrates `[X, Y, Z]` reported in the literature that may have missed strict volcano plot thresholds.
   - If querying multiple specific candidate symbols directly via `tools/literature/literature_cli.R search`, supply them as a comma-separated list in a single batch call (e.g. `Rscript tools/literature/literature_cli.R search <literature_db_path> "HERPUD1,ATF6,EDEM1,EEA1,NSFL1C,RACGAP1" 5`) rather than running iterative single-gene bash loops.

2. **Step 2B: LLM Rationalization of Retrieved Candidates & Evidentiary Distance Tiering**:
   - Review the retrieved assertions, supporting `study_id` references, and `evidence_quote` notes.
   - **Assign Evidentiary Tiers**:
     - **Tier 1 (Direct Match):** Same species, same tissue/cell type, same condition (e.g., human disease tissue proteomics or spatial transcriptomics).
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
     - Ingest `docs/literature_candidates.md` or copy the stdout table directly into `docs/literature.md`.
   - **Audit Concordance & Non-Replicated Literature Candidates**:
     - Candidates showing coordinated nominal shifts ($p < 0.05$) or concordant directional drift are flagged as **"Corroborated / Concordance: WEAK/MODERATE/STRONG"**.
     - Candidates showing no change ($p > 0.05$ or $|\log_2\text{FC}| < 0.5$) must be explicitly classified as **"Non-Replicated / Concordance: NONE"**.
     - **Prohibition on Speculative Hijacking**: Do NOT generate multi-paragraph speculative hypotheses explaining away non-replicated literature genes. Document their lack of replication concisely (1–2 sentences) as empirical divergence between local pathology and surrogate matrices.
   - Any identified sub-threshold shifts must be recorded as **new observations** in `docs/literature.md`.

##### Strategy B: When Literature Database is DISABLED (2-Turn Fast-Path Fallback)
If no active DuckDB literature database is configured (e.g. `ACTIVE LITERATURE DATABASE` is `DISABLED` or `literature/` lacks `.duckdb` files):
- Record `literature_status: SKIPPED (NO_LOCAL_LITERATURE_DB)` in the report header of `docs/literature.md` and in the `complete_phase` summary (do NOT manually edit `docs/notes.md`).
- Synthesize baseline biological literature for the system based on `docs/knowledge.md` and standard annotations, applying Evidentiary Distance Tiering.
- **No Synthetic Candidate Forcing**: Do NOT generate artificial or duplicate DE entries in `docs/literature_candidates.md` or `data/literature_candidate_expression.csv`. Leave literature candidates empty so downstream phases know literature validation was skipped.
- Formulate targeted search terms to guide Phase 09 web search in addressing the core biological questions.
- Cite standard literature by Author (Year). Never invent or hallucinate numerical PMIDs or DOIs.

---

#### 3. Authoring Reproducible Execution Script (`code/08_literature.R`)
- **Mandatory Reproducibility Requirement**: Whenever the literature database is active or reverse interrogation is performed, you MUST author and execute `code/08_literature.R` (output is automatically captured to `logs/08_literature/console.log`):
  ```bash
  if [ -f tools/lint_tidyproteomics.R ]; then Rscript tools/lint_tidyproteomics.R code/08_literature.R && Rscript code/08_literature.R; else Rscript code/08_literature.R; fi
  ```
- **Prohibition on Temporary Scripts**: NEVER run patched scripts from `/tmp` or execute one-off bash commands without persisting them in `code/08_literature.R`.
- Document any **new** data-derived findings in `docs/literature.md`.

---

#### 4. Developing Second-Layer Biological Conclusions & Actionable Synthesis
Synthesize the primary observations, internal knowledge, and literature database evidence:
1. **Calibration by Evidentiary Distance**: Weight assertions strictly by Tier 1 (direct) vs. Tier 2 (surrogate) vs. Tier 3 (distal).
2. **Actionable Direction: Actionable Synthesis Contract (`data/actionable_synthesis.json`)**:
   Persist a valid JSON file to `data/actionable_synthesis.json` specifying:
   - `primary_archetype`: One of `"Biomarker Discovery"`, `"Drug Target Identification"`, `"Mechanistic Elucidation"`, `"Pathway Remodeling"`.
   - `signatures`: Array of paired opposing functional programs (e.g. `UP_REGULATED` vs. `DOWN_REGULATED`).
   - `candidates`: Array of key candidates with `role` (`"Predictive Biomarker"`, `"Druggable Target"`, `"Mechanistic Dependency"`, `"Compensatory Buffer"`), `evidence_tier`, and rationale.
   - `next_steps`: 3-pillar experimental roadmap (Orthogonal Validation, Functional Perturbation, Translational Expansion).
3. **Identification of Residual Biological Gaps for Phase 09**:
   - Identify uncharacterized candidates with strong expression shifts that lack representation in the local literature database.
   - Formulate specific, high-priority search keyphrases for Phase 09 (`09_WEBSEARCH.md`) to resolve these gaps via live PubMed, UniProt, and preprint exploration.

---

#### 5. Direct Construction of `docs/literature.md`
Write `docs/literature.md` directly, referencing `docs/llm.md` for active model details. Ensure it begins with the standard document header immediately below the title:

```markdown
# Literature Knowledge Database Interrogation & Second-Layer Conclusions

Created: YYYY-MM-DD HH:MM  
Author: PROVIDER | LLM-MODEL  
Agent: TidyProteomicsAgent vX.X.X  
R Package: tidyproteomics vX.X.X  
Literature Database: ACTIVE | SKIPPED (NO_LOCAL_LITERATURE_DB)  
```

Organize the document strictly into the following structured sections:
1. **Literature Interrogation Strategy & Graph Queries**: Summary of seed symbols, pathway terms, and DuckDB queries executed.
2. **Retrieved Literature Assertions & Evidentiary Distance Calibration**: Table/summary of retrieved assertions with assigned Tier 1/2/3 labels and study IDs.
3. **Reverse-Interrogation Results & Sub-Threshold Observations**: Markdown tables from `docs/literature_candidates.md` documenting sub-threshold shifts and non-replicated external candidates.
4. **Second-Layer Biological Conclusions**: Mechanistic conclusions grounded in empirical data and literature assertions.
5. **Actionable Direction: Signatures, Target Roles & Next Steps**: Actionable synthesis roadmap persisted to `data/actionable_synthesis.json`.
6. **Residual Biological Gaps & Web Search Strategy for Phase 09**: Specific unanswered questions, uncharacterized proteins, and targeted keyphrases to guide Phase 09.
7. **Documented References**: Bibliography of study IDs, DOIs/PMIDs, and citations.

---

#### 6. Phase Completion Gate
- [ ] **Checkpoint Gate**:
  1. `docs/knowledge.md` successfully ingested.
  2. If follow-up queries were executed, `code/08_literature.R` exited with code 0 and output was logged to `logs/08_literature/console.log`.
  3. `data/actionable_synthesis.json` exists on disk with valid structure.
  4. `docs/literature.md` exists on disk with non-zero size, containing second-layer conclusions, actionable synthesis, and the Phase 09 web search strategy.
- [ ] **Complete Phase**:
  - Invoke `complete_phase(phaseName = "08_LITERATURE", summary = "Literature database interrogation complete in docs/literature.md with second-layer conclusions, actionable synthesis in data/actionable_synthesis.json, and prioritized search terms for Phase 09.")`

