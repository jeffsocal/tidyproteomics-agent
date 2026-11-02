import * as fsSync from "fs";
import * as path from "path";
import type { EvaluationRunSummary } from "../types/evaluation";

/**
 * CLI utility to compare pre-revision baseline metrics (Phases 01-11)
 * with post-revision metrics (Phases 01-13 with Integrity & Critique)
 * across all benchmarked runs.
 *
 * Usage:
 *   npx tsx src/evaluation/compare_benchmark_revisions.ts [evaluations_dir]
 */

interface RunComparison {
  runId: string;
  model: string;
  provider: string;
  // Quality
  scoreBefore: number;
  scoreAfter: number;
  scoreDelta: number;
  fidelityBefore?: number;
  fidelityAfter?: number;
  fidelityDelta?: number;
  dirErrorsBefore?: number;
  dirErrorsAfter?: number;
  dirErrorsDelta?: number;
  manuscriptBefore: number;
  manuscriptAfter: number;
  manuscriptDelta: number;
  // Dimensions
  sciEvalDelta: number;
  bioIntDelta: number;
  insightsDelta: number;
  clarityDelta: number;
  actionDelta: number;
  // Tokens
  tokensBefore: number;
  tokensAfter: number;
  tokensDelta: number;
  tokensPctDelta: number;
  phase12Tokens: number;
  phase13Tokens: number;
  durationDeltaSec: number;
}

function pad(str: string | number, len: number, align: "left" | "right" = "left"): string {
  const s = String(str);
  if (s.length >= len) return s;
  const spaces = " ".repeat(len - s.length);
  return align === "left" ? s + spaces : spaces + s;
}

function fmtSign(n: number, decimals: number = 0): string {
  const rounded = decimals > 0 ? n.toFixed(decimals) : String(Math.round(n));
  return n > 0 ? `+${rounded}` : rounded;
}

async function main() {
  const evalDir = process.argv[2] || "testrun/evaluations";
  const absEvalDir = path.resolve(evalDir);

  if (!fsSync.existsSync(absEvalDir)) {
    console.error(`Evaluations directory does not exist: ${absEvalDir}`);
    process.exit(1);
  }

  const entries = fsSync.readdirSync(absEvalDir, { withFileTypes: true });
  const runDirs = entries
    .filter((e) => e.isDirectory() && /^\d+_/.test(e.name) && !e.name.startsWith("00_benchmark"))
    .map((e) => path.join(absEvalDir, e.name))
    .sort();

  const comparisons: RunComparison[] = [];

  for (const rDir of runDirs) {
    const runId = path.basename(rDir);
    const summaryPath = path.join(rDir, "summary.json");
    const summaryBeforePath = path.join(rDir, "summary_before_revisions.json");

    if (!fsSync.existsSync(summaryPath) || !fsSync.existsSync(summaryBeforePath)) {
      continue;
    }

    try {
      const current: EvaluationRunSummary = JSON.parse(fsSync.readFileSync(summaryPath, "utf-8"));
      const before: EvaluationRunSummary = JSON.parse(fsSync.readFileSync(summaryBeforePath, "utf-8"));

      const sB = before.scores?.overallBenchmarkScore || 0;
      const sA = current.scores?.overallBenchmarkScore || 0;

      const getFidelity = (s?: any) => {
        if (s?.analyticalFidelityScore !== undefined) return s.analyticalFidelityScore;
        const score = s?.verifiers?.numericFidelity?.score;
        return typeof score === "number" ? Math.round(score * 100) : undefined;
      };

      const fB = getFidelity(before.scores);
      const fA = getFidelity(current.scores);

      const deB = before.scores?.verifiers?.stats?.directionErrors;
      const deA = current.scores?.verifiers?.stats?.directionErrors;

      const mB = before.scores?.overallManuscriptScore || 0;
      const mA = current.scores?.overallManuscriptScore || 0;

      const tB = before.tokenUsage?.totalTokens || 0;
      const tA = current.tokenUsage?.totalTokens || 0;
      const tDelta = tA - tB;
      const tPct = tB > 0 ? (tDelta / tB) * 100 : 0;

      const p12 = current.phaseMetrics?.find((p) => p.phaseId === "12" || p.fileName?.includes("12_"))?.tokenUsage?.totalTokens || 0;
      const p13 = current.phaseMetrics?.find((p) => p.phaseId === "13" || p.fileName?.includes("13_"))?.tokenUsage?.totalTokens || 0;

      comparisons.push({
        runId,
        model: current.model,
        provider: current.provider,
        scoreBefore: sB,
        scoreAfter: sA,
        scoreDelta: sA - sB,
        fidelityBefore: fB,
        fidelityAfter: fA,
        fidelityDelta: (fB !== undefined && fA !== undefined) ? (fA - fB) : undefined,
        dirErrorsBefore: deB,
        dirErrorsAfter: deA,
        dirErrorsDelta: (deB !== undefined && deA !== undefined) ? (deA - deB) : undefined,
        manuscriptBefore: mB,
        manuscriptAfter: mA,
        manuscriptDelta: Math.round((mA - mB) * 10) / 10,
        sciEvalDelta: Math.round(((current.scores?.scientificEvaluation || 0) - (before.scores?.scientificEvaluation || 0)) * 10) / 10,
        bioIntDelta: Math.round(((current.scores?.bioinformaticsIntelligence || 0) - (before.scores?.bioinformaticsIntelligence || 0)) * 10) / 10,
        insightsDelta: Math.round(((current.scores?.insights || 0) - (before.scores?.insights || 0)) * 10) / 10,
        clarityDelta: Math.round(((current.scores?.clarity || 0) - (before.scores?.clarity || 0)) * 10) / 10,
        actionDelta: Math.round(((current.scores?.actionableInsights || 0) - (before.scores?.actionableInsights || 0)) * 10) / 10,
        tokensBefore: tB,
        tokensAfter: tA,
        tokensDelta: tDelta,
        tokensPctDelta: Math.round(tPct * 10) / 10,
        phase12Tokens: p12,
        phase13Tokens: p13,
        durationDeltaSec: (current.totalDurationSeconds || 0) - (before.totalDurationSeconds || 0),
      });
    } catch {}
  }

  if (comparisons.length === 0) {
    console.log(`\nNo revised runs found with matching summary_before_revisions.json.`);
    console.log(`To execute revision phases and generate before/after pairs:`);
    console.log(`  npx tsx src/evaluation/run_benchmark_revisions.ts testrun/evaluations\n`);
    return;
  }

  // Print Terminal Summary
  console.log(`\n` + "=".repeat(120));
  console.log(`  BENCHMARK REVISION IMPACT: PHASES 01-11 (BASELINE) VS PHASES 01-13 (+INTEGRITY & CRITIQUE)`);
  console.log("=".repeat(120));

  console.log(
    pad("Model", 32) +
    pad("Overall Score", 20) +
    pad("Fidelity (%)", 18) +
    pad("Dir Errors", 15) +
    pad("Manuscript", 15) +
    pad("Tokens (Δ%)", 20)
  );
  console.log("-".repeat(120));

  let sumScoreDelta = 0;
  let sumFidelityDelta = 0;
  let countFidelity = 0;
  let sumDirErrorsEliminated = 0;
  let sumManuscriptDelta = 0;
  let sumTokenPct = 0;
  let sumP12Tokens = 0;
  let sumP13Tokens = 0;

  for (const c of comparisons) {
    const scoreStr = `${c.scoreBefore} -> ${c.scoreAfter} (${fmtSign(c.scoreDelta)})`;
    const fidStr = (c.fidelityBefore !== undefined && c.fidelityAfter !== undefined)
      ? `${c.fidelityBefore}% -> ${c.fidelityAfter}% (${fmtSign(c.fidelityDelta!)}%)`
      : "-";
    const deStr = (c.dirErrorsBefore !== undefined && c.dirErrorsAfter !== undefined)
      ? `${c.dirErrorsBefore} -> ${c.dirErrorsAfter} (${fmtSign(c.dirErrorsDelta!)})`
      : "-";
    const msStr = `${c.manuscriptBefore} -> ${c.manuscriptAfter} (${fmtSign(c.manuscriptDelta, 1)})`;
    const tokStr = `${(c.tokensBefore / 1e6).toFixed(2)}M -> ${(c.tokensAfter / 1e6).toFixed(2)}M (${fmtSign(c.tokensPctDelta, 1)}%)`;

    console.log(
      pad(c.model, 32) +
      pad(scoreStr, 20) +
      pad(fidStr, 18) +
      pad(deStr, 15) +
      pad(msStr, 15) +
      pad(tokStr, 20)
    );

    sumScoreDelta += c.scoreDelta;
    if (c.fidelityDelta !== undefined) {
      sumFidelityDelta += c.fidelityDelta;
      countFidelity++;
    }
    if (c.dirErrorsDelta !== undefined) {
      sumDirErrorsEliminated += (-c.dirErrorsDelta);
    }
    sumManuscriptDelta += c.manuscriptDelta;
    sumTokenPct += c.tokensPctDelta;
    sumP12Tokens += c.phase12Tokens;
    sumP13Tokens += c.phase13Tokens;
  }

  const n = comparisons.length;
  const avgScoreDelta = (sumScoreDelta / n).toFixed(1);
  const avgFidDelta = countFidelity > 0 ? (sumFidelityDelta / countFidelity).toFixed(1) : "-";
  const avgMsDelta = (sumManuscriptDelta / n).toFixed(1);
  const avgTokPct = (sumTokenPct / n).toFixed(1);
  const avgP12 = Math.round(sumP12Tokens / n);
  const avgP13 = Math.round(sumP13Tokens / n);

  console.log("-".repeat(120));
  console.log(
    pad(`AVERAGE (N=${n})`, 32) +
    pad(`${fmtSign(Number(avgScoreDelta), 1)} pts`, 20) +
    pad(`${fmtSign(Number(avgFidDelta), 1)}%`, 18) +
    pad(`${sumDirErrorsEliminated} eliminated`, 15) +
    pad(`${fmtSign(Number(avgMsDelta), 1)} /10`, 15) +
    pad(`${fmtSign(Number(avgTokPct), 1)}% tokens`, 20)
  );
  console.log("=".repeat(120));
  console.log(`Average Phase 12 (Integrity) tokens: ${avgP12.toLocaleString()} | Average Phase 13 (Critique) tokens: ${avgP13.toLocaleString()}`);

  // Generate Markdown Artifact
  const mdReportPath = path.join(absEvalDir, "BENCHMARK_REVISIONS_COMPARISON.md");
  let md = `# Benchmark Revision Impact Report\n\n`;
  md += `**Evaluation Run Count**: ${n} models\n`;
  md += `**Timestamp**: ${new Date().toISOString()}\n\n`;
  md += `This report compares baseline Phase 01–11 results against Phase 01–13 (+Integrity Defect Correction & Critique Enhancement).\n\n`;

  md += `## Executive Summary\n\n`;
  md += `- **Average Score Improvement**: **${fmtSign(Number(avgScoreDelta), 1)} points** (Overall Benchmark Score)\n`;
  md += `- **Average Numeric Fidelity Gain**: **${fmtSign(Number(avgFidDelta), 1)}%** verified empirical claims\n`;
  md += `- **Direction Errors Eliminated**: **${sumDirErrorsEliminated} errors corrected**\n`;
  md += `- **Average Manuscript Quality Gain**: **${fmtSign(Number(avgMsDelta), 1)} / 10**\n`;
  md += `- **Average Token Overhead**: **+${avgTokPct}%** (+${(avgP12 + avgP13).toLocaleString()} tokens across both phases)\n\n`;

  md += `## Detailed Model Comparison\n\n`;
  md += `| Model | Overall Score | Numeric Fidelity | Direction Errors | Manuscript (/10) | Baseline Tokens | Revised Tokens | Δ Tokens (%) |\n`;
  md += `|:------|:-------------:|:----------------:|:----------------:|:----------------:|:---------------:|:--------------:|:------------:|\n`;

  for (const c of comparisons) {
    const fid = (c.fidelityBefore !== undefined && c.fidelityAfter !== undefined)
      ? `${c.fidelityBefore}% → ${c.fidelityAfter}% (**${fmtSign(c.fidelityDelta!)}%**)`
      : "-";
    const de = (c.dirErrorsBefore !== undefined && c.dirErrorsAfter !== undefined)
      ? `${c.dirErrorsBefore} → ${c.dirErrorsAfter} (**${fmtSign(c.dirErrorsDelta!)}**)`
      : "-";

    md += `| \`${c.model}\` | ${c.scoreBefore} → ${c.scoreAfter} (**${fmtSign(c.scoreDelta)}**) | ${fid} | ${de} | ${c.manuscriptBefore} → ${c.manuscriptAfter} (**${fmtSign(c.manuscriptDelta, 1)}**) | ${(c.tokensBefore).toLocaleString()} | ${(c.tokensAfter).toLocaleString()} | **${fmtSign(c.tokensPctDelta, 1)}%** |\n`;
  }

  md += `\n## Dimension Improvement Breakdown (Average Δ)\n\n`;
  const avgSciEval = (comparisons.reduce((acc, c) => acc + c.sciEvalDelta, 0) / n).toFixed(1);
  const avgBioInt = (comparisons.reduce((acc, c) => acc + c.bioIntDelta, 0) / n).toFixed(1);
  const avgInsights = (comparisons.reduce((acc, c) => acc + c.insightsDelta, 0) / n).toFixed(1);
  const avgClarity = (comparisons.reduce((acc, c) => acc + c.clarityDelta, 0) / n).toFixed(1);
  const avgAction = (comparisons.reduce((acc, c) => acc + c.actionDelta, 0) / n).toFixed(1);

  md += `- **Scientific Evaluation**: ${fmtSign(Number(avgSciEval), 1)}\n`;
  md += `- **Bioinformatics Intelligence**: ${fmtSign(Number(avgBioInt), 1)}\n`;
  md += `- **Biological Insights**: ${fmtSign(Number(avgInsights), 1)}\n`;
  md += `- **Manuscript Clarity**: ${fmtSign(Number(avgClarity), 1)}\n`;
  md += `- **Actionable Next Steps**: ${fmtSign(Number(avgAction), 1)}\n`;

  fsSync.writeFileSync(mdReportPath, md, "utf-8");
  console.log(`\n✓ Detailed Markdown comparison saved to: ${path.relative(process.cwd(), mdReportPath)}\n`);
}

main().catch((err) => {
  console.error("Comparison report failed:", err);
  process.exit(1);
});
