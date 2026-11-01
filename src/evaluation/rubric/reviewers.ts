import * as fsSync from "fs";
import * as path from "path";
import { ProviderClient } from "../../llm/ProviderClient";
import type { LLMProviderType } from "../../types";
import type {
  ManuscriptDimension,
  ReviewerCriterionScore,
  ReviewerModelRef,
  ReviewerResult,
  VerifierReport,
} from "../../types/evaluation";
import { RunTables } from "./tables";

/**
 * Anchored multi-reviewer LLM panel (rubric v2).
 *
 * Each of the three user-selected reviewer models evaluates the manuscript exactly once,
 * using a 0-2 per-criterion scoring sheet (5 criteria per dimension -> 0-10). The panel
 * consensus per dimension is the median across successful reviewers.
 */

export const MANUSCRIPT_DIMENSIONS: ManuscriptDimension[] = [
  "scientificEvaluation",
  "bioinformaticsIntelligence",
  "insights",
  "clarity",
  "actionableInsights",
];

export const RUBRIC_CRITERIA: Record<ManuscriptDimension, { id: string; text: string }[]> = {
  scientificEvaluation: [
    { id: "SE1", text: "Statistical framing is correct and consistent: test, multiple-testing correction and thresholds are stated AND applied consistently throughout." },
    { id: "SE2", text: "Effect sizes are reported alongside significance, and uncertainty is acknowledged (n per group, variance/CV, imputation burden)." },
    { id: "SE3", text: "Relaxed/nominal (Tier 2/3) findings are labelled honestly; no protein or pathway is presented as significant when the data do not support it." },
    { id: "SE4", text: "Limitations are specific to THIS dataset (e.g., n=3, missingness mechanism, ratio compression, detection-limited proteins), not boilerplate." },
    { id: "SE5", text: "Conclusions follow from the evidence shown; no mechanistic or causal leaps beyond what proteomic abundance data can support." },
  ],
  bioinformaticsIntelligence: [
    { id: "BI1", text: "Normalization and imputation choices are JUSTIFIED with the benchmarking outputs (CV, PCA, missingness pattern MAR vs MNAR), not just named." },
    { id: "BI2", text: "Enrichment is interpreted correctly: sign convention (treatment/control), gene-set size, and redundancy across GO/Reactome terms handled." },
    { id: "BI3", text: "De novo modules / clusters are interpreted from their actual member proteins, not just from labels." },
    { id: "BI4", text: "Pathway and complex biology is mechanistically correct for the perturbation (e.g., p97/VCP cofactors, ERAD, proteasome, autophagy) and consistent with the tables." },
    { id: "BI5", text: "Analytical artefacts are recognised and addressed (contaminants, outlier samples, batch/PCA structure, imputation-driven extreme fold changes)." },
  ],
  insights: [
    { id: "IN1", text: "At least one NON-OBVIOUS hypothesis that integrates two or more independent data lines (expression + enrichment + modules/literature)." },
    { id: "IN2", text: "Known biology (with citations) is clearly separated from novel claims made by this study." },
    { id: "IN3", text: "Alternative explanations are considered, with what observation would discriminate between them." },
    { id: "IN4", text: "Claims are specific to this perturbation and context; generic statements that would be true of any knockout earn no credit." },
    { id: "IN5", text: "Internal consistency: Results, Discussion and Abstract tell the same story with the same numbers." },
  ],
  clarity: [
    { id: "CL1", text: "Real section structure; the Abstract is <= 300 words and contains the key quantitative results." },
    { id: "CL2", text: "Every figure is referenced in the text and is interpretable from its caption/context." },
    { id: "CL3", text: "Information-dense: no padding, no repetition of the same content across sections." },
    { id: "CL4", text: "Precise terminology: units, log base, and contrast direction stated once and used consistently." },
    { id: "CL5", text: "A proteomics PI could follow the full argument without reading the agent logs." },
  ],
  actionableInsights: [
    { id: "AI1", text: "A prioritised target list whose selection rationale is traceable to data (fold change, q, module membership, druggability source)." },
    { id: "AI2", text: "Each proposed experiment names the assay, readout, expected outcome if the hypothesis is true/false, and controls." },
    { id: "AI3", text: "Biomarker/druggability/therapeutic claims are backed by cited evidence actually retrieved in this run (ChEMBL, OpenTargets, literature)." },
    { id: "AI4", text: "Feasibility and sequencing are addressed (cheap, fast, decisive validations first)." },
    { id: "AI5", text: "Recommendations are consistent with the quantitative results (no recommending follow-up on proteins that were not changed)." },
  ],
};

const DIMENSION_LABELS: Record<ManuscriptDimension, string> = {
  scientificEvaluation: "Scientific Evaluation (rigor & fidelity)",
  bioinformaticsIntelligence: "Bioinformatics Intelligence (domain correctness)",
  insights: "Insights (mechanistic depth & novelty)",
  clarity: "Clarity (communication)",
  actionableInsights: "Actionable Insights (translational value)",
};

function readIf(p: string, max: number): string {
  try {
    if (!fsSync.existsSync(p)) return "";
    const raw = fsSync.readFileSync(p, "utf-8");
    return raw.length > max ? raw.slice(0, max) + "\n…[truncated]" : raw;
  } catch {
    return "";
  }
}

function fmt(n: number | null, digits = 3): string {
  if (n === null || n === undefined || !Number.isFinite(n)) return "NA";
  return Math.abs(n) < 1e-3 && n !== 0 ? n.toExponential(2) : n.toFixed(digits);
}

export function buildEvidencePacket(runRoot: string, tables: RunTables, verifiers: VerifierReport): string {
  const expr = [...tables.expression]
    .filter((r) => r.q !== null && r.log2fc !== null)
    .sort((a, b) => (a.q! - b.q!) || Math.abs(b.log2fc!) - Math.abs(a.log2fc!))
    .slice(0, 40)
    .map((r) => `${r.gene || "-"}\t${r.protein}\t${fmt(r.log2fc)}\t${fmt(r.p)}\t${fmt(r.q)}`)
    .join("\n");
  const enr = [...tables.enrichment]
    .filter((e) => e.q !== null)
    .sort((a, b) => a.q! - b.q!)
    .slice(0, 25)
    .map((e) => `${e.term}\t${e.annotation}\t${fmt(e.enrichment, 4)}\t${fmt(e.q)}\t${e.size ?? "NA"}`)
    .join("\n");

  const v = verifiers;
  const vLine = (name: string, r: { score: number | null; summary: string; details: string[] }) =>
    `- ${name}: ${r.score === null ? "n/a" : r.score.toFixed(2)} — ${r.summary}${r.details.length ? "\n    • " + r.details.slice(0, 8).join("\n    • ") : ""}`;

  const experiment = readIf(path.join(runRoot, "docs", "experiment.md"), 4000);
  const actionable = readIf(path.join(runRoot, "data", "actionable_synthesis.json"), 3000);

  return [
    "## A. Experiment design (docs/experiment.md)",
    experiment || "(not available)",
    "",
    "## B. Ground-truth expression table — top 40 by q (gene, accession, log2FC, p, q). Contrast = treatment/control; log2FC > 0 means higher in treatment.",
    "gene\taccession\tlog2FC\tp\tq",
    expr || "(not available)",
    "",
    "## C. Ground-truth enrichment table — top 25 by q (term, annotation, enrichment score, q, size). Positive = induced in treatment.",
    "term\tannotation\tenrichment\tq\tsize",
    enr || "(not available)",
    "",
    "## D. Deterministic verifier results (computed by code against the data — treat as facts)",
    vLine("Numeric fidelity", v.numericFidelity),
    vLine("Direction consistency", v.directionConsistency),
    vLine("Significance honesty", v.significanceHonesty),
    vLine("Count consistency", v.countConsistency),
    vLine("Figure integrity", v.figureIntegrity),
    vLine("Citation traceability", v.citationIntegrity),
    vLine("Section structure", v.sectionStructure),
    vLine("Methods reproducibility", v.methodsReproducibility),
    vLine("Repetition", v.repetition),
    `- Abstract word count: ${v.stats.abstractWords ?? "no abstract"}`,
    "",
    "## E. Agent's actionable synthesis (data/actionable_synthesis.json)",
    actionable || "(not available)",
  ].join("\n");
}

export function buildReviewerPrompt(manuscript: string, evidence: string): { system: string; user: string } {
  const sheet = MANUSCRIPT_DIMENSIONS.map((d) => {
    const items = RUBRIC_CRITERIA[d].map((c) => `   - ${c.id}: ${c.text}`).join("\n");
    return `### ${d} — ${DIMENSION_LABELS[d]}\n${items}`;
  }).join("\n\n");

  const schemaDims = MANUSCRIPT_DIMENSIONS.map((d) => {
    const crit = RUBRIC_CRITERIA[d].map((c) => `{ "id": "${c.id}", "score": null, "evidence": "" }`).join(", ");
    return `    "${d}": { "criteria": [${crit}], "rationale": "" }`;
  }).join(",\n");

  const system = `You are a demanding senior reviewer for a top proteomics journal (e.g., Molecular & Cellular Proteomics). You grade AI-generated manuscripts against a fixed scoring sheet. You are calibrated: most competent manuscripts land in the middle of the scale, and full marks are rare. You output strict JSON only.`;

  const user = `Grade the manuscript below using the scoring sheet. You are also given ground-truth data tables and deterministic verifier results computed by code; treat those as facts and penalise any manuscript claim that contradicts them.

# SCORING SCALE (apply to EVERY criterion)
- 0 = absent, wrong, or contradicted by the data/verifiers.
- 1 = partially met, generic, or asserted without supporting evidence.
- 2 = fully met AND you can quote the specific supporting passage.
Award 2 only when you can cite concrete evidence. If in doubt between two scores, choose the lower one.
A dimension total of 5/10 corresponds to "competent; major revision". 8/10 = "strong; minor revision". 9-10 should be rare.

# HARD RULES
- Keyword presence earns nothing. "Therapeutic", "roadmap", "mechanism", etc. score only when substantiated.
- Any numeric value in the manuscript that disagrees with the ground-truth tables is a factual error (score the relevant criterion 0).
- Generic text that would be equally true for any knockout experiment earns 0 for specificity-related criteria.
- Length is not quality. Do not reward verbosity.
- Evidence fields must contain a short verbatim quote (<= 25 words) or a section reference; use "none" when scoring 0.

# PROCEDURE
1. First list the three most serious weaknesses of the manuscript (in "weaknesses").
2. Then score each criterion 0, 1, or 2 with evidence.
3. Write one sentence of rationale per dimension and a 2-3 sentence overall summary.

# SCORING SHEET
${sheet}

# REQUIRED OUTPUT (strict JSON, no markdown fences, replace nulls with integers 0/1/2)
{
  "weaknesses": ["", "", ""],
  "dimensions": {
${schemaDims}
  },
  "summary": ""
}

# EVIDENCE PACKET
${evidence}

# MANUSCRIPT (full text)
${manuscript.length > 90000 ? manuscript.slice(0, 90000) + "\n…[truncated at 90k characters]" : manuscript}`;

  return { system, user };
}

export function parseReviewerResponse(content: string): {
  dimensions: Record<ManuscriptDimension, number>;
  criteria: Record<ManuscriptDimension, ReviewerCriterionScore[]>;
  weaknesses: string[];
  summary: string;
  missingCriteria: number;
} {
  const cleaned = content.replace(/```(?:json)?/g, "");
  const start = cleaned.indexOf("{");
  const end = cleaned.lastIndexOf("}");
  if (start < 0 || end <= start) throw new Error("Reviewer response contained no JSON object.");
  const parsed = JSON.parse(cleaned.slice(start, end + 1));
  const dims = parsed.dimensions || {};
  const dimensions = {} as Record<ManuscriptDimension, number>;
  const criteria = {} as Record<ManuscriptDimension, ReviewerCriterionScore[]>;
  let missing = 0;
  for (const d of MANUSCRIPT_DIMENSIONS) {
    const list: any[] = Array.isArray(dims?.[d]?.criteria) ? dims[d].criteria : [];
    const scored: ReviewerCriterionScore[] = RUBRIC_CRITERIA[d].map((c) => {
      const hit = list.find((x) => String(x?.id || "").toUpperCase() === c.id);
      const raw = hit ? Number(hit.score) : NaN;
      if (!Number.isFinite(raw)) missing++;
      const score = Number.isFinite(raw) ? Math.max(0, Math.min(2, Math.round(raw))) : 0;
      return { id: c.id, score, evidence: String(hit?.evidence ?? "").slice(0, 300) };
    });
    criteria[d] = scored;
    dimensions[d] = scored.reduce((a, c) => a + c.score, 0);
  }
  if (missing > 5) throw new Error(`Reviewer response omitted ${missing} of 25 criterion scores.`);
  return {
    dimensions,
    criteria,
    weaknesses: Array.isArray(parsed.weaknesses) ? parsed.weaknesses.map((w: any) => String(w)).slice(0, 5) : [],
    summary: String(parsed.summary || ""),
    missingCriteria: missing,
  };
}

/**
 * Builds an independent client for a reviewer model. Reviewer clients are deliberately
 * decoupled from the benchmark's active (model-under-test) configuration, use temperature 0
 * and never route through multi-model tiers.
 */
export function createReviewerClient(base: ProviderClient, ref: ReviewerModelRef): ProviderClient {
  const cfg = base.getConfig();
  let provider: LLMProviderType = (ref.provider as LLMProviderType) || cfg.provider;
  if ((cfg.apiKey || "").startsWith("sk-or-v1")) provider = "openrouter";
  else if (!ref.provider && ref.model.includes("/")) provider = "openrouter";
  return new ProviderClient(
    {
      ...cfg,
      provider,
      model: ref.model,
      temperature: 0,
      maxTokens: 8192,
      multiModelEnabled: false,
      phaseModels: {},
    },
    true
  );
}

export async function runReviewer(
  base: ProviderClient,
  ref: ReviewerModelRef,
  prompt: { system: string; user: string }
): Promise<ReviewerResult> {
  const t0 = Date.now();
  try {
    const client = createReviewerClient(base, ref);
    const resp = await client.chat({ system: prompt.system, messages: [{ role: "user", content: prompt.user }], tools: [] });
    const parsed = parseReviewerResponse(resp.content || "");
    return {
      model: ref.model,
      provider: client.getConfig().provider,
      status: "ok",
      dimensions: parsed.dimensions,
      criteria: parsed.criteria,
      weaknesses: parsed.weaknesses,
      summary: parsed.summary,
      missingCriteria: parsed.missingCriteria,
      tokenUsage: resp.usage
        ? { promptTokens: resp.usage.promptTokens, completionTokens: resp.usage.completionTokens, totalTokens: resp.usage.totalTokens }
        : undefined,
      durationSeconds: Math.round((Date.now() - t0) / 1000),
    };
  } catch (err: any) {
    return {
      model: ref.model,
      provider: ref.provider || "",
      status: "failed",
      error: String(err?.message || err).slice(0, 500),
      durationSeconds: Math.round((Date.now() - t0) / 1000),
    };
  }
}

export async function runReviewerPanel(
  base: ProviderClient,
  reviewers: ReviewerModelRef[],
  manuscript: string,
  evidence: string
): Promise<ReviewerResult[]> {
  const prompt = buildReviewerPrompt(manuscript, evidence);
  return Promise.all(reviewers.map((r) => runReviewer(base, r, prompt)));
}

export function median(xs: number[]): number {
  const s = [...xs].sort((a, b) => a - b);
  const n = s.length;
  if (n === 0) return NaN;
  return n % 2 ? s[(n - 1) / 2] : (s[n / 2 - 1] + s[n / 2]) / 2;
}

