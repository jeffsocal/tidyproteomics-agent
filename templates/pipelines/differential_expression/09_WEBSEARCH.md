---
tools: [web_search, pubmed_search, uniprot_search]
---

### Phase 9: Web Search Corroboration, Third-Layer Conclusions & Actionable Synthesis

In this phase, you (the LLM) will use the residual biological gaps and prioritized keyphrases formulated in `08_LITERATURE` (`docs/literature.md`) to conduct targeted live web searches and external database inquiries (PubMed, UniProt, preprints).

You will synthesize:
- `08_LITERATURE` (`docs/literature.md` and `data/actionable_synthesis.json`, which already incorporate primary observations from Phase 6, internal knowledge from Phase 7, and peer-reviewed literature corpus assertions from Phase 8)
- Real-time findings from live web searches, PubMed, and UniProt

to resolve unanswered questions, validate newly discovered interactors, check recent clinical trials and translational updates, develop the **third layer of conclusions**, and finalize the **Actionable Synthesis Contract (`data/actionable_synthesis.json`)**.

If external web findings suggest candidate interactors, orthologs, or pathway regulators that warrant follow-up testing in the empirical dataset:
- Write and execute `code/09_websearch.R` via `execute_command("Rscript code/09_websearch.R")` to query the saved dataset (`data/table_*_expression_*.tsv` / `data/tidyproteomics_data.rds`) directly (logged to `logs/09_websearch/console.log`).
- Document any **new** data-derived observations in `docs/websearch.md`.

Finally, you will construct `docs/websearch.md` and finalize `data/actionable_synthesis.json`.

---

#### 1. Pre-Flight Verification & Inputs Ingestion
Before proceeding:
1. Read `docs/literature.md` in Turn 1 (which contains the Phase 8 literature database findings, candidate classifications, and the prioritized biological gaps for Phase 09). Only read `docs/observations.md` or `docs/knowledge.md` if you need to look up a specific metric not already summarized.
2. Rely on the `[WORKSPACE MANIFEST]` and `docs/experiment.md` already injected in your prompt above.

---

#### 2. Executing Targeted Web Searches
> ⚠️ **Search Budget Discipline**: Execute at most 4–6 targeted search queries focused specifically on the residual gaps and uncharacterized proteins identified in Phase 08. Do NOT repeat broad, generic searches already resolved by the literature database. Transition promptly to finalizing `data/actionable_synthesis.json` and authoring `docs/websearch.md`.

Extract the prioritized search queries from `docs/literature.md` and execute targeted inquiries:
- Use built-in search tools (`pubmed_search`, `uniprot_search`, and `web_search`) directly for fast, rate-limited queries across Europe PMC / PubMed, UniProtKB, and the web.
- If using command-line utilities via `execute_command`, invoke `python3` with rate-limiting (`time.sleep(0.4)`) between NCBI requests.
- In offline or sandboxed environments, synthesize published literature and database knowledge corresponding to the curated keyphrases with strict attribution.
- Search priorities:
  1. Resolving uncharacterized or unexpected top dysregulated proteins that lacked coverage in the local literature database.
  2. Recent (2024–2026) translational advances, active clinical trials, drug approvals, or patent disclosures targeting the primary candidates.
  3. Mechanistic cross-talk among opposing biological signatures to confirm translational feasibility.

---

#### 3. Interactive Data Queries via `tidyproteomics` (Testing Web-Derived Hypotheses)
If external web findings reveal specific interactor candidates or pathway markers:
- Write and execute `code/09_websearch.R` (output is automatically captured to `logs/09_websearch/console.log`):
  ```bash
  if [ -f tools/lint_tidyproteomics.R ]; then Rscript tools/lint_tidyproteomics.R code/09_websearch.R && Rscript code/09_websearch.R; else Rscript code/09_websearch.R; fi
  ```
- Any newly tested targets and their quantitative metrics must be documented as **new observations** in `docs/websearch.md`.

---

#### 4. Developing Third-Layer Biological Conclusions & Finalizing Actionable Synthesis
Synthesize the primary empirical data, literature corpus assertions, and web search evidence:
1. **Evidentiary Distance Tiering**:
   - Classify all external sources into **Tier 1 (Direct Match)**, **Tier 2 (Surrogate Matrix / Proximal Model)**, or **Tier 3 (Distal Context)**.
   - Candidates nominated externally that fail to replicate ($p > 0.05$ or $|\log_2\text{FC}| < 0.5$) must be classified as **"Non-Replicated / Concordance: NONE"** without speculative narrative expansion.
2. **Finalizing the Actionable Synthesis Contract (`data/actionable_synthesis.json`)**:
   Update and persist the definitive `data/actionable_synthesis.json` containing:
   - `primary_archetype`: `"Biomarker Discovery"`, `"Drug Target Identification"`, `"Mechanistic Elucidation"`, or `"Pathway Remodeling"`.
   - `signatures`: Opposing functional programs grounded in formal pathways or *de novo* modules.
   - `candidates`: Role-tagged candidates (`Predictive Biomarker`, `Druggable Target`, `Mechanistic Dependency`, `Compensatory Buffer`) with evidence tiers and mechanistic rationale.
   - `next_steps`: Concrete 3-pillar experimental roadmap (Orthogonal Validation, Functional Perturbation, Translational Expansion).

---

#### 5. Direct Construction of `docs/websearch.md`
Write `docs/websearch.md` directly, referencing `docs/llm.md` for active model details. Ensure it begins with the standard document header immediately below the title:

```markdown
# Web Search Corroboration & Third-Layer Conclusions

Created: YYYY-MM-DD HH:MM  
Author: PROVIDER | LLM-MODEL  
Agent: TidyProteomicsAgent vX.X.X  
R Package: tidyproteomics vX.X.X  
```

Organize the document strictly into the following structured sections:
1. **Executed Search Strategy & Gap-Filling Objectives**: Keyphrases searched, sources consulted, and biological gaps addressed.
2. **Follow-Up Data Inquiries & New Observations**: Any queries run via `code/09_websearch.R` with exact metrics, or statement of verification.
3. **Third-Layer Biological Conclusions (with Evidentiary Tiering)**: Deep biological synthesis integrating primary data, literature database assertions, and real-time web findings.
4. **Actionable Direction: Finalized Signatures, Target Roles & Next Experimental Steps**: Justification of the finalized actionable synthesis persisted to `data/actionable_synthesis.json`.
5. **Documented References**: Complete bibliography with valid DOIs, PMIDs, or URLs. Never fabricate identifiers.

---

#### 6. Phase Completion Gate
- [ ] **Checkpoint Gate**:
  1. `docs/literature.md` successfully ingested.
  2. If follow-up data queries were executed, `code/09_websearch.R` exited with code 0 and output was logged to `logs/09_websearch/console.log`.
  3. `data/actionable_synthesis.json` exists on disk with non-zero size and valid structure.
  4. `docs/websearch.md` exists on disk with non-zero size, containing third-layer conclusions, finalized actionable synthesis, and documented references.
  5. **Non-Empty Summary & Cited-Claim Table Mandate**: When `pubmed_search` or `web_search` is called, `complete_phase` summary must NOT be empty or generic. You must include a concise cited-claim table summarizing queried candidates, retrieved biological mechanisms, and primary PMIDs/DOIs.
- [ ] **Complete Phase**:
  - Invoke `complete_phase(phaseName = "09_WEBSEARCH", summary = "Web search gap-filling corroboration complete in docs/websearch.md with cited-claim findings (<N> queries executed) and finalized actionable synthesis persisted to data/actionable_synthesis.json.")`

