---
tools: [check_integrity, read_file, write_file, replace_file_content, execute_command, check_checkpoint_gate, complete_phase, fail_phase]
---

### Phase 13: Rigorous Scientific Critique & Argument Strengthening

In this phase, you (the LLM) act as a demanding senior peer reviewer for a premier proteomics journal (e.g., *Molecular & Cellular Proteomics*). You will evaluate the scientific reasoning, biological deduction, and translation value of `docs/manuscript.md`, apply targeted narrative refinements to strengthen arguments, qualify mechanistic leaps, and eliminate generic statements, and author a formal peer-review report in `docs/report_critique.md`.

Target execution budget: **2–3 turns max**.

---

#### Manuscript Versioning & Synchronization Protocol

To ensure seamless version provenance across the pipeline:
1. **Source Version Continuity**:
   - Verify that `docs/manuscript_rev_01.md` exists (the integrity-corrected version from Phase 12). If missing, copy `docs/manuscript.md` to `docs/manuscript_rev_01.md`.
2. **Target Revision File**:
   - Create `docs/manuscript_rev_02.md` as the target for all Phase 13 critique refinements.
3. **Canonical Synchronization**:
   - Whenever updating `docs/manuscript_rev_02.md`, also update `docs/manuscript.md` so that the canonical manuscript viewer always reflects the refined, publication-grade text.

---

#### Strict Guardrails on Critique Refinements

- **Strengthen, Hedge, and Contextualize (Allowed)**:
  - Add explicit dataset-specific limitations ($n=3$, ratio compression, label-free detection thresholds, imputation assumptions).
  - Clarify causal leaps: remind the reader that steady-state abundance changes do not directly prove altered enzymatic activity or ubiquitination flux without functional assays.
  - Provide alternative biological explanations for observed pathway alterations.
  - Refine proposed validation experiments: name specific assays, expected readouts, controls, and decisive outcomes.
  - Eliminate generic padding or repetitive phrasing.
- **Negative Rule (Strictly Prohibited)**:
  - Do NOT alter empirical numeric values, $p$-values, or fold-change signs.
  - Do NOT fabricate ungrounded biological claims, unmeasured phenotype rescues, or fake citations. All claims must trace to `data/*.tsv`, `docs/observations.md`, `docs/knowledge.md`, or `docs/literature.md`.
  - Use targeted `replace_file_content` edits. Do NOT rewrite entire files from scratch.

---

#### Execution Schedule (Strictly 2–3 Turns)

#### **Turn 1: Comprehensive Multi-Dimensional Peer Review**
1. Read `docs/manuscript.md` and review it against the 5 publication rubric dimensions:
   - **Dimension 1: Scientific Evaluation**: Is multiple-testing correction framed consistently? Are effect sizes reported alongside uncertainty? Are limitations tailored to THIS study rather than boilerplate?
   - **Dimension 2: Bioinformatics Intelligence**: Are normalization/imputation choices grounded in CV/PCA benchmarking outputs? Are functional complex members interpreted accurately?
   - **Dimension 3: Insights & Novelty**: Is known biology (with literature citations) clearly decoupled from novel discoveries? Are alternative interpretations considered?
   - **Dimension 4: Clarity & Information Density**: Is the abstract $\le 300$ words with quantitative key findings? Are all figures interpretable and cited? Is there padding or repetition?
   - **Dimension 5: Actionable Insights**: Is there a prioritised target list whose selection rationale is traceable to data? Does each proposed experiment name assay, readout, controls, and discriminative outcomes?
2. Formulate the top 3–5 critical weaknesses and targeted revisions needed in the Abstract, Discussion, Limitations, and Recommendations.

#### **Turn 2: Precision Manuscript Refinement**
1. Copy `docs/manuscript.md` to `docs/manuscript_rev_02.md`.
2. Apply targeted refinements to `docs/manuscript_rev_02.md` and `docs/manuscript.md` via `replace_file_content`:
   - Refine the **Discussion** to qualify causal assertions and add alternative mechanistic explanations.
   - Refine **Limitations** to explicitly address study-specific constraints (e.g. $n=3$ replicates, whole-cell lysate vs. subcellular fractions, steady-state vs. dynamic flux).
   - Strengthen **Translational Recommendations** by providing specific experimental validation schemes (e.g., cycloheximide chase assays for protein stability, ubiquitination immunoprecipitation, or CRISPR target knockout).
   - Ensure the **Abstract** and **Conclusions** align with these strengthened qualifications.
3. Re-verify that no new numeric or direction errors were introduced:
   ```bash
   npm run verify:integrity -- .
   ```

#### **Turn 3: Formal Peer-Review Report Generation (`docs/report_critique.md`)**
1. Author `docs/report_critique.md` using `write_file` structured as follows:
   - **Reviewer Evaluation & Scoring Matrix**:
     | Dimension | Score (1–10) | Evaluation Rationale | Applied Strengthening Edits |
     | Scientific Evaluation | X/10 | ... | ... |
     | Bioinformatics Intelligence | X/10 | ... | ... |
     | Insights & Novelty | X/10 | ... | ... |
     | Clarity & Communication | X/10 | ... | ... |
     | Actionable Insights | X/10 | ... | ... |
   - **Key Manuscript Weaknesses Identified**: Detailed analysis of logical gaps, causal leaps, or generic statements.
   - **Applied Revisions Summary**: Exact sections updated, quotes of original vs. strengthened text, and rationale.
   - **Recommended Follow-On Investigations**: Proposed follow-on analysis modules (e.g. specialized pathway modeling, kinase networks, or organelle compartmentalization) that can be enacted via the Follow-on Phase framework.
   - **Manuscript Version Provenance**: Summary of `docs/manuscript_rev_00.md` (baseline), `docs/manuscript_rev_01.md` (integrity-fixed), and `docs/manuscript_rev_02.md` (critique-refined).
2. Call `complete_phase(phaseName = "13_CRITIQUE", summary = "Completed scientific critique and argument strengthening. Refined discussion, limitations, and actionable recommendations in docs/manuscript_rev_02.md and docs/manuscript.md; authored docs/report_critique.md.")`.

---

#### Checkpoint Gate Verification

Before calling `complete_phase`, confirm:
1. `docs/report_critique.md` exists and is non-empty (>500 characters).
2. `docs/manuscript_rev_02.md` exists on disk and matches `docs/manuscript.md`.
3. Deterministic integrity check passes cleanly without regressions.

