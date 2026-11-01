# TidyProteomics Evaluation Rubric v2.0

## Overview & Motivation

In Rubric v1.0, benchmark scores for all evaluated models clustered tightly between **86–91/100**, and manuscript dimension scores were nearly identical (e.g. Insights: 10/10, Actionable: 10/10) across models.

Rubric v2.0 introduces:
1. **Deterministic Data Verification Layer**: Pure algorithmic verification against actual persisted experiment tables (`data/table_proteins_expression_*.tsv` and `table_proteins_enrichment_*.tsv`).
2. **Multi-Reviewer LLM Panel**: 3 distinct frontier models independently review the manuscript 1x across 25 rubric sub-criteria with exact quote citations. The dimension consensus is computed as the median score across successful reviewers.
3. **Hard Verifier Caps**: Flawed claims (contradicting table values, inverted log2FC signs, unhedged overclaims for non-significant proteins, missing figures) place an empirical ceiling on relevant dimensions.
4. **Structured Tool Use Metric**: Parses tool-call transcripts across logs to score coverage, per-call success, efficiency, and MCP appropriateness.
5. **Analytical Fidelity Composite Score**: Replaces redundant metrics with a direct measure of empirical alignment between narrative claims and underlying data.

---

## Architecture & Scoring Formula

### Master Overall Benchmark Score (0–100)

$$\text{Overall} = 0.40 \times (\text{Manuscript Mean} \times 10) + 0.35 \times \text{Analytical Fidelity} + 0.25 \times \text{Tool Use}$$

- **Hard Gate**: If Numeric Fidelity $< 70\%$ or the manuscript is missing ($< 300$ chars), the Overall score is capped at $\le 50$.

---

## Deterministic Verifiers

| Verifier | Metric | Formula / Standard | Hard Cap Trigger |
|---|---|---|---|
| **Numeric Fidelity** | Accuracy of reported log2FC, $p$, and $q$ values | Matched / Total extracted protein claims ($\pm 0.05$ or rounding tolerance) | $< 95\% \to \le 7$; $< 85\% \to \le 5$; $< 70\% \to \le 3$ on Scientific Eval |
| **Direction Consistency** | Correct regulation sign convention | Concordance of "up/induced/accumulated" vs "down/depleted" with table sign | Any direction error $\to$ Scientific Eval $\le 6$, Bioinfo $\le 5$ |
| **Significance Honesty** | Valid reporting of statistical significance | Mentions of "significant" when $q > 0.05$ without hedging | $\ge 1 \to \le 7.5$; $\ge 3 \to \le 5$ on Scientific Eval |
| **Count Consistency** | Consistency of aggregate counts | Total quantified proteins and Tier 1/2 DE counts match tables | Discrepancies reduce Count score |
| **Figure Integrity** | Traceability of visual evidence | Referenced figures exist in `data/`; 4 core diagnostic figures referenced | Missing files $\to$ Clarity $\le 7$ |
| **Citation Traceability** | Empirical grounding of PMIDs & DOIs | Cited references trace to actual search outputs in logs / literature docs | $< 70\% \to \le 6$ on Insights & Actionable |
| **Methods Reproducibility** | Reporting of analytical parameters | Stated normalization, imputation, test, multiple testing, thresholds, software | $< 50\% \to \le 6.5$ on Sci Eval & Bioinfo |
| **Repetition Shingles** | Concise academic communication | Deduplicated 8-word shingles across sections | $> 25\% \text{ repetition} \to \text{Clarity} \le 6$ |

---

## 3-Model LLM Reviewer Panel

The panel conducts an anchored qualitative evaluation using 25 sub-criteria scored 0, 1, or 2:
- **0**: Absent, incorrect, or contradicted by data/verifiers.
- **1**: Partially met, generic, or asserted without supporting evidence.
- **2**: Fully met with an exact quote citation ($\le 25$ words).

The 3 models are configurable in the Benchmark tab or assigned directly from the AI Models catalog. By default:
1. `anthropic/claude-3.7-sonnet` (Hybrid reasoning)
2. `openai/gpt-4o` (Analytical rigor)
3. `google/gemini-2.0-flash-001` (Independent verification)

Consensus dimension score = $\text{median}(\text{Reviewer}_1, \text{Reviewer}_2, \text{Reviewer}_3)$.

---

## Calibration Results on Benchmark Runs

Comparison of initial scores vs. Rubric v2.0 rescored:

| Model | v1.0 Overall | v2.0 Overall | v2.0 Fidelity | v2.0 Tool Use | v2.0 Manuscript | Numeric Fidelity | Direction Errors |
|---|:---:|:---:|:---:|:---:|:---:|:---:|:---:|
| **openai/gpt-6-luna (Baseline)** | 89 | **79** | 96% | -* | 6.4 / 10 | 100% (32/32) | 2 |
| **anthropic/claude-sonnet-5.5** | 89 | **84** | 93% | 97% | 6.7 / 10 | 94% (83/88) | 3 |
| **anthropic/claude-haiku-5.5** | 91 | **83** | 92% | 97% | 6.7 / 10 | 98% (43/44) | 4 |
| **x-ai/grok-4.7** | 91 | **82** | 90% | 96% | 6.7 / 10 | 100% (29/29) | 2 |
| **openai/gpt-oss-120b** | 86 | **78** | 79% | 98% | 6.5 / 10 | 100% (30/30) | 0 |
| **google/gemini-3.1-flash-lite** | 89 | **75** | 81% | 95% | 5.7 / 10 | 100% (24/24) | 4 |

*\* Baseline snapshot in 00_benchmark omitted execution logs, correctly reweighted.*

---

## CLI & Testing Utilities

- **Rescore Suite**:
  ```bash
  npm run rescore testrun/evaluations
  ```
- **Run with Live 3-Model Reviewer Panel**:
  ```bash
  npm run rescore testrun/evaluations --use-llm
  ```
- **Run Adversarial & Verifier Unit Tests**:
  ```bash
  npm run test:rubric
  ```

