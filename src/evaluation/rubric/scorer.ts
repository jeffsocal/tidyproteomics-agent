import * as fsSync from "fs";
import * as path from "path";
import { ProviderClient } from "../../llm/ProviderClient";
import type {
  AppliedCap,
  EvaluationScoreBreakdown,
  ManuscriptDimension,
  ReviewerModelRef,
  ReviewerPanelSummary,
  VerifierReport,
} from "../../types/evaluation";
import { loadRunTables } from "./tables";
import { runAllVerifiers } from "./verifiers";
import { analyzeToolUse } from "./toolUse";
import {
  buildEvidencePacket,
  getDefaultReviewers,
  MANUSCRIPT_DIMENSIONS,
  median,
  runReviewerPanel,
} from "./reviewers";

export const RUBRIC_VERSION = "2.0";

const FIDELITY_WEIGHTS: { key: keyof Omit<VerifierReport, "stats">; weight: number }[] = [
  { key: "numericFidelity", weight: 0.35 },
  { key: "directionConsistency", weight: 0.2 },
  { key: "significanceHonesty", weight: 0.15 },
  { key: "citationIntegrity", weight: 0.15 },
  { key: "countConsistency", weight: 0.1 },
  { key: "figureIntegrity", weight: 0.05 },
];

export function computeAnalyticalFidelityScore(v: VerifierReport): number {
  let num = 0;
  let den = 0;
  for (const w of FIDELITY_WEIGHTS) {
    const s = v[w.key].score;
    if (s !== null) {
      num += s * w.weight;
      den += w.weight;
    }
  }
  return den === 0 ? 0 : Math.round((num / den) * 100);
}

/**
 * Deterministic fallback scores when the LLM reviewer panel is disabled or unavailable.
 * Unlike v1 (which started at 4-5 and added points for keyword presence), these scores
 * are derived strictly from the verifier checks and are capped at 7.5 so an unreviewed
 * run can never look like an editor-approved 9-10.
 */
export function deterministicDimensionFallback(v: VerifierReport): Record<ManuscriptDimension, number> {
  const s = (x: number | null, d = 0.5) => (x === null ? d : x);
  const r1 = (x: number) => Math.round(Math.max(1, Math.min(7.5, x)) * 10) / 10;
  return {
    scientificEvaluation: r1(
      10 *
        (0.4 * s(v.numericFidelity.score, 0.3) +
          0.25 * s(v.significanceHonesty.score) +
          0.2 * s(v.countConsistency.score) +
          0.15 * s(v.methodsReproducibility.score))
    ),
    bioinformaticsIntelligence: r1(
      10 *
        (0.45 * s(v.directionConsistency.score) +
          0.35 * s(v.methodsReproducibility.score) +
          0.2 * s(v.countConsistency.score))
    ),
    insights: r1(
      10 *
        (0.45 * s(v.citationIntegrity.score, 0.4) +
          0.35 * s(v.numericFidelity.score, 0.3) +
          0.2 * s(v.directionConsistency.score))
    ),
    clarity: r1(
      10 *
        (0.35 * s(v.sectionStructure.score) +
          0.35 * s(v.figureIntegrity.score) +
          0.3 * s(v.repetition.score, 0.7))
    ),
    actionableInsights: r1(
      10 *
        (0.5 * s(v.citationIntegrity.score, 0.4) +
          0.3 * s(v.numericFidelity.score, 0.3) +
          0.2 * s(v.methodsReproducibility.score))
    ),
  };
}

export function applyVerifierCaps(
  raw: Record<ManuscriptDimension, number>,
  v: VerifierReport
): { scores: Record<ManuscriptDimension, number>; caps: AppliedCap[] } {
  const scores = { ...raw };
  const caps: AppliedCap[] = [];
  const cap = (dim: ManuscriptDimension, max: number, reason: string) => {
    if (scores[dim] > max) {
      caps.push({ dimension: dim, before: scores[dim], after: max, maxAllowed: max, reason });
      scores[dim] = max;
    }
  };

  const nf = v.numericFidelity.score;
  if (nf === null || v.stats.claimsExtracted < 3) {
    cap("scientificEvaluation", 6, "Fewer than 3 verifiable protein-level quantitative claims in the manuscript.");
  } else if (nf < 0.7) {
    cap("scientificEvaluation", 3, `Numeric fidelity is ${(nf * 100).toFixed(0)}% (< 70%).`);
  } else if (nf < 0.85) {
    cap("scientificEvaluation", 5, `Numeric fidelity is ${(nf * 100).toFixed(0)}% (< 85%).`);
  } else if (nf < 0.95) {
    cap("scientificEvaluation", 7, `Numeric fidelity is ${(nf * 100).toFixed(0)}% (< 95%).`);
  }

  if (v.stats.directionErrors > 0) {
    cap("scientificEvaluation", 6, `${v.stats.directionErrors} fold-change / enrichment direction error(s).`);
    cap("bioinformaticsIntelligence", 5, `${v.stats.directionErrors} direction/sign convention error(s).`);
  }

  if (v.stats.overclaims >= 3) {
    cap("scientificEvaluation", 5, `${v.stats.overclaims} unhedged significance overclaims (q > 0.05).`);
  } else if (v.stats.overclaims >= 1) {
    cap("scientificEvaluation", 7.5, `${v.stats.overclaims} unhedged significance overclaim(s) (q > 0.05).`);
  }

  if ((v.methodsReproducibility.score ?? 0) < 0.5) {
    cap("scientificEvaluation", 6.5, "Methods section omits more than half of the required reproducibility items.");
    cap("bioinformaticsIntelligence", 6.5, "Methods section does not justify/specify core bioinformatics choices.");
  }

  if (v.stats.missingFigures > 0 || (v.figureIntegrity.score ?? 0) < 0.7) {
    cap("clarity", 7, v.stats.missingFigures > 0 ? `${v.stats.missingFigures} referenced figure file(s) do not exist in data/.` : "Core diagnostic figures not referenced.");
  }
  if ((v.sectionStructure.score ?? 0) < 0.8) {
    cap("clarity", 6.5, v.sectionStructure.summary);
  }
  if ((v.stats.repetitionRatio ?? 0) > 0.25) {
    cap("clarity", 6, `High cross-section repetition (${((v.stats.repetitionRatio ?? 0) * 100).toFixed(0)}% repeated 8-grams).`);
  }

  if (v.citationIntegrity.score !== null && v.citationIntegrity.score < 0.7) {
    cap("insights", 6, `Only ${(v.citationIntegrity.score * 100).toFixed(0)}% of cited PMIDs/DOIs trace to retrieved search outputs.`);
    cap("actionableInsights", 6, `Cited PMIDs/DOIs are not backed by retrieved evidence (${(v.citationIntegrity.score * 100).toFixed(0)}% verified).`);
  }

  for (const d of MANUSCRIPT_DIMENSIONS) {
    scores[d] = Math.round(Math.max(1, Math.min(10, scores[d])) * 10) / 10;
  }
  return { scores, caps };
}

export async function scoreRunV2(params: {
  runRoot: string;
  manuscriptPath?: string;
  client: ProviderClient;
  reviewers?: ReviewerModelRef[];
  useLLM?: boolean;
}): Promise<EvaluationScoreBreakdown> {
  const docPath =
    params.manuscriptPath ||
    (fsSync.existsSync(path.join(params.runRoot, "docs", "manuscript.md"))
      ? path.join(params.runRoot, "docs", "manuscript.md")
      : path.join(params.runRoot, "manuscript.md"));
  const manuscript = fsSync.existsSync(docPath) ? fsSync.readFileSync(docPath, "utf-8") : "";

  const tables = loadRunTables(params.runRoot);
  const verifiers = runAllVerifiers(manuscript, params.runRoot, tables);
  const toolBreakdown = analyzeToolUse(params.runRoot);
  const analyticalFidelityScore = manuscript.trim().length < 300 ? 0 : computeAnalyticalFidelityScore(verifiers);

  const requestedReviewers = (
    params.reviewers && params.reviewers.length > 0
      ? params.reviewers
      : params.useLLM !== false
      ? getDefaultReviewers(params.client.getConfig().provider)
      : []
  ).filter((r) => r && r.model && r.model.trim());
  const shouldRunPanel = params.useLLM !== false && requestedReviewers.length > 0 && manuscript.trim().length >= 500;

  let rawDims = deterministicDimensionFallback(verifiers);
  let panelSummary: ReviewerPanelSummary = {
    status: params.useLLM === false || requestedReviewers.length === 0 ? "skipped" : "failed",
    requestedModels: requestedReviewers.map((r) => r.model),
    completedCount: 0,
    reviewers: [],
  };

  if (shouldRunPanel) {
    const evidence = buildEvidencePacket(params.runRoot, tables, verifiers);
    const results = await runReviewerPanel(params.client, requestedReviewers, manuscript, evidence);
    const ok = results.filter((r) => r.status === "ok" && r.dimensions);
    const spread = {} as Record<ManuscriptDimension, number>;
    if (ok.length > 0) {
      for (const d of MANUSCRIPT_DIMENSIONS) {
        const vals = ok.map((r) => r.dimensions![d]);
        rawDims[d] = Math.round(median(vals) * 10) / 10;
        spread[d] = Math.round((Math.max(...vals) - Math.min(...vals)) * 10) / 10;
      }
    }
    panelSummary = {
      status: ok.length === requestedReviewers.length ? "complete" : ok.length > 0 ? "partial" : "failed",
      requestedModels: requestedReviewers.map((r) => r.model),
      completedCount: ok.length,
      reviewers: results,
      dimensionSpread: ok.length > 0 ? spread : undefined,
      consensusWeaknesses: Array.from(new Set(ok.flatMap((r) => r.weaknesses || []))).slice(0, 6),
    };
  }

  let { scores: cappedDims, caps } =
    manuscript.trim().length < 300
      ? {
          scores: {
            scientificEvaluation: 1,
            bioinformaticsIntelligence: 1,
            insights: 1,
            clarity: 1,
            actionableInsights: 1,
          } as Record<ManuscriptDimension, number>,
          caps: [{ dimension: "overall" as const, before: 0, after: 0, maxAllowed: 0, reason: "Manuscript missing or < 300 chars." }],
        }
      : applyVerifierCaps(rawDims, verifiers);

  const overallManuscriptScore =
    Math.round(
      ((cappedDims.scientificEvaluation +
        cappedDims.bioinformaticsIntelligence +
        cappedDims.insights +
        cappedDims.clarity +
        cappedDims.actionableInsights) /
        5) *
        10
    ) / 10;

  // Tool use: null when logs are absent (e.g. a bare snapshot); in that case reweight 40/35 -> 53/47
  const mcpToolUseScore = toolBreakdown ? toolBreakdown.score : 0;
  let overallBenchmarkScore = toolBreakdown
    ? Math.round(overallManuscriptScore * 10 * 0.4 + analyticalFidelityScore * 0.35 + mcpToolUseScore * 0.25)
    : Math.round((overallManuscriptScore * 10 * 0.4 + analyticalFidelityScore * 0.35) / 0.75);

  // Hard gates
  const nf = verifiers.numericFidelity.score;
  if (manuscript.trim().length < 300) {
    overallBenchmarkScore = Math.min(overallBenchmarkScore, 15);
  } else if (nf !== null && nf < 0.7) {
    if (overallBenchmarkScore > 50) {
      caps.push({
        dimension: "overall",
        before: overallBenchmarkScore,
        after: 50,
        maxAllowed: 50,
        reason: `Hard gate: numeric fidelity ${(nf * 100).toFixed(0)}% < 70%.`,
      });
      overallBenchmarkScore = 50;
    }
  }

  const notesParts: string[] = [];
  if (panelSummary.status === "complete" || panelSummary.status === "partial") {
    const models = panelSummary.reviewers
      .filter((r) => r.status === "ok")
      .map((r) => r.model)
      .join(", ");
    notesParts.push(`Reviewed by ${panelSummary.completedCount}/${panelSummary.requestedModels.length} LLM reviewer(s) (${models}).`);
    for (const r of panelSummary.reviewers) {
      if (r.status === "ok" && r.summary) notesParts.push(`[${r.model}] ${r.summary}`);
      else if (r.status === "failed") notesParts.push(`[${r.model} FAILED] ${r.error}`);
    }
  } else if (panelSummary.status === "failed") {
    const errs = panelSummary.reviewers.map((r) => `${r.model}: ${r.error}`).join("; ");
    notesParts.push(`LLM reviewer panel failed (${errs}); manuscript dimensions use capped deterministic verifier fallback.`);
  } else {
    notesParts.push("Scored in deterministic verifier mode (no LLM reviewer panel invoked; manuscript dimensions capped at 7.5).");
  }
  if (caps.length > 0) {
    notesParts.push(`Caps applied: ${caps.map((c) => `${c.dimension} -> <=${c.maxAllowed} (${c.reason})`).join("; ")}`);
  }

  return {
    insights: cappedDims.insights,
    clarity: cappedDims.clarity,
    scientificEvaluation: cappedDims.scientificEvaluation,
    bioinformaticsIntelligence: cappedDims.bioinformaticsIntelligence,
    actionableInsights: cappedDims.actionableInsights,
    overallManuscriptScore,
    mcpToolUseScore,
    // Keep legacy property populated with the new Analytical Fidelity Score so all existing UI/CSV consumers remain valid
    bioinformaticsIntelligenceScore: analyticalFidelityScore,
    analyticalFidelityScore,
    overallBenchmarkScore,
    rubricVersion: RUBRIC_VERSION,
    rubricNotes: notesParts.join(" "),
    mcpToolCallsCount: toolBreakdown ? toolBreakdown.tpaCalls + toolBreakdown.searchCalls : 0,
    rawScriptCallsCount: toolBreakdown ? toolBreakdown.rawExecCalls : 0,
    toolSuccessRate: toolBreakdown ? toolBreakdown.perCallSuccess : 0,
    verifiers,
    toolUseBreakdown: toolBreakdown || undefined,
    appliedCaps: caps,
    reviewerPanel: panelSummary,
    rawManuscriptDimensions: rawDims,
  };
}

