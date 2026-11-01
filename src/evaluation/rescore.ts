import * as fsSync from "fs";
import * as path from "path";
import { ConfigStore } from "../config/ConfigStore";
import { ProviderClient } from "../llm/ProviderClient";
import { scoreRunV2, RUBRIC_VERSION } from "./rubric/scorer";
import type {
  EvaluationRunSummary,
  BenchmarkSuite,
  ReviewerModelRef,
  ModelAggregatedPerformance,
} from "../types/evaluation";

/**
 * Offline & online rescore utility for TidyProteomics benchmarks.
 * Usage:
 *   npx tsx src/evaluation/rescore.ts [evaluations_dir] [--use-llm] [--reviewers m1,m2,m3]
 */

function aggregatePerformance(runs: EvaluationRunSummary[]): ModelAggregatedPerformance[] {
  const completed = runs.filter((r) => r.status === "completed");
  const byModel = new Map<string, EvaluationRunSummary[]>();
  for (const r of runs) {
    const list = byModel.get(r.model) || [];
    list.push(r);
    byModel.set(r.model, list);
  }

  const out: ModelAggregatedPerformance[] = [];
  for (const [model, mRuns] of byModel.entries()) {
    const comp = mRuns.filter((r) => r.status === "completed");
    const n = comp.length || 1;
    const meanOverall = comp.reduce((acc, r) => acc + r.scores.overallBenchmarkScore, 0) / n;
    const meanManuscript = comp.reduce((acc, r) => acc + r.scores.overallManuscriptScore, 0) / n;
    const meanMcp = comp.reduce((acc, r) => acc + r.scores.mcpToolUseScore, 0) / n;
    const meanBio = comp.reduce((acc, r) => acc + (r.scores.analyticalFidelityScore ?? r.scores.bioinformaticsIntelligenceScore), 0) / n;

    out.push({
      model,
      provider: mRuns[0]?.provider || "-",
      isBaseline: mRuns.some((r) => r.isBaseline),
      completedRuns: comp.length,
      failedRuns: mRuns.length - comp.length,
      meanDurationSeconds: Math.round(mRuns.reduce((acc, r) => acc + r.totalDurationSeconds, 0) / (mRuns.length || 1)),
      meanTurns: Math.round(mRuns.reduce((acc, r) => acc + r.totalTurns, 0) / (mRuns.length || 1)),
      meanPromptTokens: Math.round(mRuns.reduce((acc, r) => acc + r.tokenUsage.promptTokens, 0) / (mRuns.length || 1)),
      meanCompletionTokens: Math.round(mRuns.reduce((acc, r) => acc + r.tokenUsage.completionTokens, 0) / (mRuns.length || 1)),
      meanTotalTokens: Math.round(mRuns.reduce((acc, r) => acc + r.tokenUsage.totalTokens, 0) / (mRuns.length || 1)),
      meanOverallScore: Math.round(meanOverall),
      meanManuscriptScore: Math.round(meanManuscript * 10) / 10,
      meanMcpToolUseScore: Math.round(meanMcp),
      meanBioinformaticsIntelligence: Math.round(meanBio),
      dimensionAverages: {
        insights: Math.round((comp.reduce((acc, r) => acc + r.scores.insights, 0) / n) * 10) / 10,
        clarity: Math.round((comp.reduce((acc, r) => acc + r.scores.clarity, 0) / n) * 10) / 10,
        scientificEvaluation: Math.round((comp.reduce((acc, r) => acc + r.scores.scientificEvaluation, 0) / n) * 10) / 10,
        bioinformaticsIntelligence: Math.round((comp.reduce((acc, r) => acc + r.scores.bioinformaticsIntelligence, 0) / n) * 10) / 10,
        actionableInsights: Math.round((comp.reduce((acc, r) => acc + r.scores.actionableInsights, 0) / n) * 10) / 10,
      },
      runs: mRuns,
    });
  }

  out.sort((a, b) => {
    if (a.isBaseline && !b.isBaseline) return -1;
    if (!a.isBaseline && b.isBaseline) return 1;
    return b.meanOverallScore - a.meanOverallScore;
  });
  return out;
}

async function main() {
  const args = process.argv.slice(2);
  let evalDir = "testrun/evaluations";
  let useLLM = false;
  let customReviewers: ReviewerModelRef[] | undefined = undefined;

  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === "--use-llm") {
      useLLM = true;
    } else if (a === "--no-llm") {
      useLLM = false;
    } else if (a === "--reviewers" && args[i + 1]) {
      const models = args[++i].split(",").map((s) => s.trim()).filter(Boolean);
      customReviewers = models.map((m) => ({
        model: m,
        provider: m.includes("/") ? "openrouter" : "anthropic",
      }));
    } else if (!a.startsWith("-")) {
      evalDir = a;
    }
  }

  const absEvalDir = path.resolve(evalDir);
  if (!fsSync.existsSync(absEvalDir)) {
    console.error(`Evaluations directory does not exist: ${absEvalDir}`);
    process.exit(1);
  }

  console.log(`\n============================================================`);
  console.log(`  TidyProteomics Rubric v${RUBRIC_VERSION} Rescoring Engine`);
  console.log(`============================================================`);
  console.log(`Target Directory: ${absEvalDir}`);
  console.log(`LLM Reviewer Panel: ${useLLM ? "ENABLED (3 models)" : "DISABLED (Deterministic Verifier Mode)"}`);
  if (customReviewers) {
    console.log(`Custom Reviewers: ${customReviewers.map((r) => r.model).join(", ")}`);
  }

  const configStore = ConfigStore.getInstance();
  const baseClient = new ProviderClient({
    provider: (configStore.get("provider") as any) || "openrouter",
    model: configStore.get("model") || "anthropic/claude-3.7-sonnet",
    apiKey: configStore.get("apiKey") || process.env.OPENROUTER_API_KEY || "",
    baseUrl: configStore.get("baseUrl") || "",
  });

  const entries = fsSync.readdirSync(absEvalDir, { withFileTypes: true });
  const runDirs = entries
    .filter((e) => e.isDirectory() && (e.name === "00_benchmark" || /^\d+_/.test(e.name)))
    .map((e) => path.join(absEvalDir, e.name))
    .sort();

  console.log(`Found ${runDirs.length} run directories to rescore.\n`);

  const updatedRuns: EvaluationRunSummary[] = [];

  for (const rDir of runDirs) {
    const dirName = path.basename(rDir);
    const summaryPath = path.join(rDir, "summary.json");
    let existingSummary: EvaluationRunSummary | null = null;
    if (fsSync.existsSync(summaryPath)) {
      try {
        existingSummary = JSON.parse(fsSync.readFileSync(summaryPath, "utf-8"));
      } catch {}
    }

    const modelName = existingSummary?.model || dirName;
    console.log(`------------------------------------------------------------`);
    console.log(`Rescoring: [${dirName}] ${modelName}`);

    const oldScores = existingSummary?.scores;

    const newScores = await scoreRunV2({
      runRoot: rDir,
      client: baseClient,
      reviewers: customReviewers,
      useLLM,
    });

    console.log(`  OLD: Overall ${oldScores?.overallBenchmarkScore ?? "-"} | Manuscript ${oldScores?.overallManuscriptScore ?? "-"} | Tool ${oldScores?.mcpToolUseScore ?? "-"}% | Bio ${oldScores?.bioinformaticsIntelligenceScore ?? "-"}`);
    console.log(
      `  NEW: Overall ${newScores.overallBenchmarkScore}/100 | Manuscript ${newScores.overallManuscriptScore}/10 | Fidelity ${newScores.analyticalFidelityScore}/100 | Tool ${newScores.mcpToolUseScore}/100`
    );
    console.log(
      `       Dimensions -> SciEval: ${newScores.scientificEvaluation} | BioInt: ${newScores.bioinformaticsIntelligence} | Insights: ${newScores.insights} | Clarity: ${newScores.clarity} | Action: ${newScores.actionableInsights}`
    );

    if (newScores.verifiers) {
      const v = newScores.verifiers;
      console.log(
        `       Verifiers  -> NumFidelity: ${v.numericFidelity.score !== null ? (v.numericFidelity.score * 100).toFixed(0) + "%" : "n/a"} (${v.stats.claimsMatched}/${v.stats.claimsExtracted} claims)` +
          ` | DirErrors: ${v.stats.directionErrors}` +
          ` | Overclaims: ${v.stats.overclaims}` +
          ` | FigMissing: ${v.stats.missingFigures}`
      );
    }

    if (newScores.appliedCaps && newScores.appliedCaps.length > 0) {
      console.log(`       Caps Applied: ${newScores.appliedCaps.map((c) => `${c.dimension} -> <=${c.maxAllowed}`).join(", ")}`);
    }

    const updatedSummary: EvaluationRunSummary = existingSummary
      ? {
          ...existingSummary,
          scores: newScores,
        }
      : {
          id: dirName,
          suiteId: "unified_evaluations",
          model: modelName,
          provider: "openrouter",
          iteration: 1,
          timestamp: new Date().toISOString(),
          status: "completed",
          isBaseline: dirName === "00_benchmark" || dirName.startsWith("00_"),
          totalDurationSeconds: 0,
          totalTurns: 0,
          tokenUsage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
          phaseMetrics: [],
          scores: newScores,
          outputPath: path.relative(path.dirname(absEvalDir), rDir),
        };

    fsSync.writeFileSync(summaryPath, JSON.stringify(updatedSummary, null, 2), "utf-8");
    updatedRuns.push(updatedSummary);
  }

  // Update suite.json
  const suitePath = path.join(absEvalDir, "suite.json");
  if (fsSync.existsSync(suitePath)) {
    try {
      const suite: BenchmarkSuite = JSON.parse(fsSync.readFileSync(suitePath, "utf-8"));
      suite.runs = updatedRuns;
      suite.aggregated = aggregatePerformance(updatedRuns);
      fsSync.writeFileSync(suitePath, JSON.stringify(suite, null, 2), "utf-8");
      console.log(`\n✓ Successfully updated suite.json with v${RUBRIC_VERSION} scores and aggregated metrics.`);
    } catch (e: any) {
      console.warn("Could not update suite.json:", e.message);
    }
  }

  console.log(`\n============================================================`);
  console.log(`Summary of v${RUBRIC_VERSION} Rescored Runs:`);
  console.log(`============================================================`);
  console.log(
    `Model`.padEnd(32) +
      `Overall`.padStart(9) +
      `Fidelity`.padStart(10) +
      `ToolUse`.padStart(9) +
      `Manuscript`.padStart(12) +
      `SciEval`.padStart(9) +
      `NumFid%`.padStart(9)
  );
  console.log("-".repeat(90));
  for (const r of updatedRuns) {
    const s = r.scores;
    const nf = s.verifiers?.numericFidelity.score;
    console.log(
      r.model.slice(0, 30).padEnd(32) +
        `${s.overallBenchmarkScore}/100`.padStart(9) +
        `${s.analyticalFidelityScore}/100`.padStart(10) +
        `${s.mcpToolUseScore}%`.padStart(9) +
        `${s.overallManuscriptScore}/10`.padStart(12) +
        `${s.scientificEvaluation}`.padStart(9) +
        `${nf !== null && nf !== undefined ? (nf * 100).toFixed(0) + "%" : "n/a"}`.padStart(9)
    );
  }
  console.log("============================================================\n");
}

main().catch((err) => {
  console.error("Rescoring error:", err);
  process.exit(1);
});

