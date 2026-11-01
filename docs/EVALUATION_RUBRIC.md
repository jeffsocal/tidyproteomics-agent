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

The 3 models are configurable in the Benchmark UI tab or assigned directly from the active provider catalog. By default:
- **OpenRouter (Cross-vendor frontier panel)**:
  1. `anthropic/claude-sonnet-4.5` (Hybrid reasoning & domain synthesis)
  2. `openai/gpt-4o` (Analytical rigor & quantitative consistency)
  3. `google/gemini-2.5-flash` (Independent cross-check & verification)
- **Anthropic Native**: `claude-3-7-sonnet`, `claude-3-5-sonnet`, `claude-3-opus`
- **OpenAI Native**: `o3-mini`, `gpt-4o`, `gpt-4o-mini`
- **Gemini Native**: `gemini-1.5-pro`, `gemini-2.0-flash`, `gemini-1.5-flash`

Consensus dimension score = $\text{median}(\text{Reviewer}_1, \text{Reviewer}_2, \text{Reviewer}_3)$.

- **Robust JSON Escape Parsing**: Automatically repairs unescaped LaTeX symbols (`$|\log_2\text{FC}| \ge 1.0$`) and quote escapes in reviewer evidence passages.
- **Deterministic Offline Fallback**: When LLM reviewers are disabled (`--no-llm`), dimension scores are derived from empirical verifier checks and capped at $\le 7.5$ so an unreviewed run cannot mimic an editor-approved 9–10 manuscript.

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
| **meta/muse-spark-1.3** | 86 | **78** | 81% | 96% | 6.5 / 10 | 83% (38/46) | 7 |
| **google/gemini-3.1-flash-lite** | 89 | **75** | 81% | 95% | 5.7 / 10 | 100% (24/24) | 4 |

*\* Baseline snapshot in 00_benchmark omitted execution logs, correctly reweighted.*

---

## CLI & Testing Utilities

> [!IMPORTANT]
> Always execute commands from inside the repository directory (`cd tidyproteomics-agent`). Running from a parent directory will cause npm to report `ENOENT: could not read package.json`.

### 1. Rescore Suite (Deterministic / Offline Mode)
Fast data-grounded verification with deterministic verifiers (no LLM tokens spent):
```bash
# Rescore all runs in the suite directory:
npm run rescore -- testrun/evaluations

# Or rescore an individual run:
npm run rescore -- testrun/evaluations/01_google_gemini-3_1-flash-lite_iter1
```

### 2. Live 3-Model Reviewer Panel (Frontier LLMs)
Runs full qualitative evaluation across 25 rubric sub-criteria with evidence quote citations:
```bash
# Recommended shortcut:
npm run rescore:llm -- testrun/evaluations

# Using the standard npm flag syntax (note the required '--' separator):
npm run rescore -- testrun/evaluations --use-llm

# Rescore a single run with live reviewers:
npm run rescore:llm -- testrun/evaluations/01_google_gemini-3_1-flash-lite_iter1

# Override default reviewers with custom models:
npm run rescore -- testrun/evaluations --use-llm --reviewers anthropic/claude-sonnet-4.5,openai/gpt-4o
```

### 3. Run Adversarial & Verifier Unit Tests
Runs the 17 deterministic verifier tests (corrupted numbers, sign flips, significance overclaims, fake citations, missing figures):
```bash
npm run test:rubric
```

