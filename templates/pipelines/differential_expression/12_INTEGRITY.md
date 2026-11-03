---
tools: [check_integrity, read_file, write_file, replace_file_content, execute_command, check_checkpoint_gate, complete_phase, fail_phase]
---

### Phase 12: Data-Grounded Integrity Review & Defect Correction

In this phase, you (the LLM) act as an automated scientific auditor. You will inspect deterministic data verifier findings against `docs/manuscript.md` and the underlying experimental tables, correct any confirmed empirical defects (sign-reversed fold changes, mismatched numbers, unhedged p/q-values, missing figure citations, or ungrounded references), and author a comprehensive audit report in `docs/report_integrity.md`.

Target execution budget: **2–3 turns max**.

---

#### Manuscript Versioning & Synchronization Protocol

To ensure full reproducibility and auditable provenance:
1. **Archive Baseline Synthesis**:
   - Check if `docs/manuscript_rev_00.md` exists. If not, copy `docs/manuscript.md` to `docs/manuscript_rev_00.md` to preserve the original, unedited Phase 11 synthesis output.
2. **Target Revision File**:
   - Create `docs/manuscript_rev_01.md` as the target for all Phase 12 defect corrections.
3. **Canonical Synchronization**:
   - Whenever modifying `docs/manuscript_rev_01.md`, also update `docs/manuscript.md` so that the primary document viewer and downstream evaluation consumers remain synchronized with the latest approved text.

---

#### Zero-Exploration Direct Audit Policy

- Do NOT invent or fabricate replacement numbers, fold-changes, or biological findings.
- All empirical ground-truth values exist in `data/table_proteins_expression_*.tsv`, `data/table_proteins_enrichment_*.tsv`, and `data/manuscript_digest.json`.
- Do NOT rewrite entire sections from scratch. Use precision `replace_file_content` edits to correct flawed claims without dropping valid scientific content.

---

#### Execution Schedule (Strictly 2–3 Turns)

#### **Turn 1: Defect Ingestion via `check_integrity` or Pre-Computed Catalog**
1. Invoke the `check_integrity` tool (which scans `docs/manuscript.md` against quantitative tables and persists `data/integrity_defects.json`), or read `data/integrity_defects.json` directly if already present.
2. Review the defects catalog:
   - **Direction Errors**: Contradictions between narrative wording ("decreased", "depleted", "suppressed", "downregulated") and actual table fold-change sign ($log_2\text{FC} > 0$ means accumulated/increased/upregulated; $log_2\text{FC} < 0$ means depleted/decreased/downregulated).
   - **Numeric Mismatches**: Values of fold-changes, p-values, or q-values in text that diverge from table records.
   - **Protein Count Inconsistencies**: Ensure that total quantified protein count across Abstract and Results strictly matches the authoritative post-filter count in `data/manuscript_digest.json:total_quantified` (e.g. 1,941), and that raw ingest counts (e.g. 2,209) are not conflated with the quantified proteome.
   - **Primary Volcano Alignment**: Ensure Section 3.2 embeds the primary contrast volcano plot, not an exploratory or secondary contrast (e.g. `m-control`).
   - **Significance Overclaims**: Proteins asserted as "significant" when $q > 0.05$ without hedging.
   - **Missingness & Denominator Audit**: Verify that stated missingness percentage matches `data/table_feature_accounting.tsv:matrix_missingness_percentage` (e.g. 15.1% true matrix missingness rather than Phase 1 pre-filter 9.1%), and ensure that the experimental design distinguishes raw data files (e.g. 23) from biological condition groups (e.g. 6).
   - **Filter Completeness Audit**: Ensure Methods states the unique-peptide filter (e.g. $\ge 2$ unique peptides) and contaminant filtering.
   - **Missing Figures**: References to figures not present in `data/`.
   - **Ungrounded Citations**: DOIs or PMIDs not present in literature logs.

*Note*: If `data/integrity_defects.json` reports 0 defects, copy `docs/manuscript.md` to `docs/manuscript_rev_01.md`, write `docs/report_integrity.md` confirming zero defects, and invoke `complete_phase`.

#### **Turn 2: Precision Correction of Confirmed Defects**
1. For each reported defect:
   - Cross-reference with `data/table_proteins_expression_*.tsv` or `data/manuscript_digest.json` to verify the true gene symbol, accession, $log_2\text{FC}$, $p$, and $q$ values.
   - Determine whether the finding is a **confirmed defect** (e.g. inverted sign convention) or a **verifier false positive** (e.g. "decreased degradation" of an accumulated protein).
2. Apply targeted edits using `replace_file_content` to `docs/manuscript_rev_01.md` and `docs/manuscript.md`:
   - **Fix Direction Errors**: If a protein has $log_2\text{FC} > 0$, ensure text describes it as *accumulated, increased, elevated, or stabilized*—never "decreased", "depleted", or "downregulated". If $log_2\text{FC} < 0$, describe as *depleted, decreased, or reduced*.
   - **Fix Numeric Discrepancies & Missingness**: Replace incorrect fold-changes, p/q-values, or missingness percentages with true table values.
   - **Fix Denominator Ambiguities**: Ensure text refers to replicate MS files ($n=23$) vs biological condition groups ($n=6$) without conflating them.
   - **Add Hedging**: Add appropriate hedging to any marginal findings ($q > 0.05$).
   - Harmonize any adjacent narrative reasoning or mechanistic conclusions that relied on the inverted direction.

#### **Turn 3: Re-Verification & Audit Report Generation (`docs/report_integrity.md`)**
1. Call `check_integrity` with `manuscriptPath: "docs/manuscript_rev_01.md"` to verify that direction errors have dropped to 0!
2. Author `docs/report_integrity.md` using `write_file` structured as follows:
   - **Executive Summary**: Total defects inspected, confirmed, and corrected; initial vs. post-correction numeric fidelity and direction error count.
   - **Confirmed Corrections Table**:
     | Gene / Item | Section / Context | Original Claim | Corrected Claim | Ground-Truth Table Value | Rationale |
   - **Dismissed Flags**: Any verifier flags determined to be false alarms with biological reasoning.
   - **Citation & Figure Integrity Audit**: List of verified figures and confirmed literature citations.
   - **Manuscript Revision Audit**: Confirmation that `docs/manuscript_rev_00.md` (baseline) and `docs/manuscript_rev_01.md` (corrected) are persisted, and `docs/manuscript.md` is synchronized.
3. Call `complete_phase(phaseName = "12_INTEGRITY", summary = "Completed data-grounded integrity review. Corrected confirmed defects in docs/manuscript_rev_01.md and docs/manuscript.md; authored docs/report_integrity.md.")`.

---

#### Checkpoint Gate Verification

Before calling `complete_phase`, confirm:
1. `docs/report_integrity.md` exists and is non-empty (>500 characters).
2. `docs/manuscript_rev_00.md` exists on disk (preserving baseline Phase 11 synthesis).
3. `docs/manuscript_rev_01.md` exists on disk and has identical content to `docs/manuscript.md`.
4. Zero unaddressed direction errors remain. All confirmed defects have been corrected in `docs/manuscript_rev_01.md` and `docs/manuscript.md`. Any false-positive matcher artifacts (e.g. proximity across clauses or prospective experiment mentions) must be explicitly listed and biologically justified under 'Dismissed Flags' in `docs/report_integrity.md`.
