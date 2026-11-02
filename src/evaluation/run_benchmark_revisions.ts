import * as fsSync from "fs";
import * as fs from "fs/promises";
import * as path from "path";
import { ConfigStore } from "../config/ConfigStore";
import { ProviderClient } from "../llm/ProviderClient";
import { ToolRegistry } from "../tools/ToolRegistry";
import { PipelineOrchestrator } from "../orchestrator/PipelineOrchestrator";
import { EvaluationService } from "./EvaluationService";
import { runIntegrityCheck } from "./check_integrity";
import { scoreRunV2, RUBRIC_VERSION } from "./rubric/scorer";
import { getDefaultReviewers } from "./rubric/reviewers";
import type {
  EvaluationRunSummary,
  BenchmarkSuite,
  ReviewerModelRef,
} from "../types/evaluation";

/**
 * Headless CLI runner to execute Phase 12 (Integrity) and Phase 13 (Critique)
 * across benchmarked models in testrun/evaluations, preserving before/after metrics.
 *
 * Usage:
 *   npx tsx src/evaluation/run_benchmark_revisions.ts [evaluations_dir] [options]
 *
 * Options:
 *   --model <name>       Filter by run directory name or substring (e.g. 01_google or gemini-3_1)
 *   --use-llm            Run LLM 3-critic evaluation after revision phases (default: true if API key present)
 *   --no-llm             Skip LLM reviewers and only run deterministic verification during scoring
 *   --force              Re-run phases 12 and 13 even if report files already exist
 *   --dry-run            Inspect targets and verify setup without executing LLM phase calls
 */

interface CLIOptions {
  evalDir: string;
  modelFilter?: string;
  useLLM: boolean;
  force: boolean;
  dryRun: boolean;
  customReviewers?: ReviewerModelRef[];
}

function parseArgs(): CLIOptions {
  const args = process.argv.slice(2);
  let evalDir = "testrun/evaluations";
  let modelFilter: string | undefined = undefined;
  let useLLM = true;
  let force = false;
  let dryRun = false;
  let customReviewers: ReviewerModelRef[] | undefined = undefined;

  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === "--use-llm" || a === "--llm") {
      useLLM = true;
    } else if (a === "--no-llm" || a === "--skip-llm") {
      useLLM = false;
    } else if (a === "--force") {
      force = true;
    } else if (a === "--dry-run") {
      dryRun = true;
    } else if (a.startsWith("--model=")) {
      modelFilter = a.slice("--model=".length).trim();
    } else if (a === "--model" && args[i + 1]) {
      modelFilter = args[++i].trim();
    } else if (a.startsWith("--reviewers=")) {
      const models = a.slice("--reviewers=".length).split(",").map((s) => s.trim()).filter(Boolean);
      customReviewers = models.map((m) => ({
        model: m,
        provider: m.includes("/") ? "openrouter" : "anthropic",
      }));
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

  return { evalDir, modelFilter, useLLM, force, dryRun, customReviewers };
}

async function main() {
  const opts = parseArgs();
  const absEvalDir = path.resolve(opts.evalDir);
  const projectRoot = process.cwd();

  if (!fsSync.existsSync(absEvalDir)) {
    console.error(`Evaluations directory does not exist: ${absEvalDir}`);
    process.exit(1);
  }

  const templatePhase12 = path.join(projectRoot, "templates", "pipelines", "differential_expression", "12_INTEGRITY.md");
  const templatePhase13 = path.join(projectRoot, "templates", "pipelines", "differential_expression", "13_CRITIQUE.md");

  if (!fsSync.existsSync(templatePhase12) || !fsSync.existsSync(templatePhase13)) {
    console.error("Required revision phase templates (12_INTEGRITY.md, 13_CRITIQUE.md) not found in templates directory.");
    process.exit(1);
  }

  const configStore = ConfigStore.getInstance();
  const apiKey = configStore.get("apiKey") || process.env.OPENROUTER_API_KEY || "";
  if (!apiKey && opts.useLLM && !opts.dryRun) {
    console.warn("⚠️  No OPENROUTER_API_KEY found in config or environment. Falling back to deterministic verification only (--no-llm).");
    opts.useLLM = false;
  }

  const client = new ProviderClient({
    provider: (configStore.get("provider") as any) || "openrouter",
    model: configStore.get("model") || "anthropic/claude-sonnet-4.5",
    apiKey,
    baseUrl: configStore.get("baseUrl") || "",
  });

  const evalService = new EvaluationService(client, configStore, projectRoot);
  const activeReviewers = opts.customReviewers || getDefaultReviewers(client.getConfig().provider);

  // Check OpenRouter key balance / limit pre-flight
  if (apiKey && apiKey.startsWith("sk-or-") && !opts.dryRun) {
    try {
      const authRes = await fetch("https://openrouter.ai/api/v1/auth/key", {
        headers: { Authorization: `Bearer ${apiKey}` },
      });
      if (authRes.ok) {
        const keyInfo: any = await authRes.json();
        const budget = keyInfo.data?.effective_budget;
        if (budget && typeof budget.remaining_usd === "number" && budget.remaining_usd <= 0) {
          console.error(`\n❌ OpenRouter API Key Usage Limit Reached:`);
          console.error(`   Spend: $${budget.spend_usd.toFixed(2)} against limit of $${budget.limit_usd.toFixed(2)}`);
          console.error(`   Remaining: $${budget.remaining_usd.toFixed(2)}`);
          console.error(`   Please raise or remove the limit on this key at: https://openrouter.ai/settings/keys\n`);
          process.exit(1);
        } else if (budget) {
          console.log(`✓ OpenRouter Key Validated: $${budget.remaining_usd.toFixed(2)} remaining ($${budget.spend_usd.toFixed(2)} / $${budget.limit_usd.toFixed(2)} spent)`);
        }
      }
    } catch (_) {}
  }

  // Discover candidate run directories
  const entries = fsSync.readdirSync(absEvalDir, { withFileTypes: true });
  let runDirs = entries
    .filter((e) => e.isDirectory() && /^\d+_/.test(e.name))
    .map((e) => path.join(absEvalDir, e.name))
    .sort();

  // Exclude 00_benchmark unless explicitly targeted
  if (!opts.modelFilter || !opts.modelFilter.includes("00_benchmark")) {
    runDirs = runDirs.filter((d) => !path.basename(d).startsWith("00_benchmark"));
  }

  if (opts.modelFilter) {
    const f = opts.modelFilter.toLowerCase();
    runDirs = runDirs.filter((d) => path.basename(d).toLowerCase().includes(f));
  }

  console.log(`\n=============================================================================`);
  console.log(`  TidyProteomics Benchmark Revision Runner: Phases 12 & 13`);
  console.log(`=============================================================================`);
  console.log(`Evaluations Root : ${absEvalDir}`);
  console.log(`Target Runs      : ${runDirs.length} run(s) matched`);
  console.log(`LLM Rescoring    : ${opts.useLLM ? `ENABLED (${activeReviewers.map((r) => r.model).join(", ")})` : "DISABLED (Deterministic verifiers only)"}`);
  console.log(`Execution Mode   : ${opts.dryRun ? "DRY RUN (Inspection only, no LLM execution)" : "LIVE EXECUTION"}`);
  console.log(`Force Re-run     : ${opts.force ? "YES" : "NO (Skips if reports already generated)"}`);
  console.log(`=============================================================================\n`);

  if (runDirs.length === 0) {
    console.log("No matching run directories found. Check your --model filter or evaluation path.");
    return;
  }

  // Backup suite.json once before runs start
  const suitePath = path.join(absEvalDir, "suite.json");
  const suiteBeforePath = path.join(absEvalDir, "suite_before_revisions.json");
  if (fsSync.existsSync(suitePath) && !fsSync.existsSync(suiteBeforePath)) {
    fsSync.copyFileSync(suitePath, suiteBeforePath);
    console.log(`✓ Preserved baseline suite metadata -> ${path.basename(suiteBeforePath)}`);
  }

  let suiteData: BenchmarkSuite | null = null;
  if (fsSync.existsSync(suitePath)) {
    try {
      suiteData = JSON.parse(fsSync.readFileSync(suitePath, "utf-8"));
    } catch {}
  }

  let processedCount = 0;
  for (let idx = 0; idx < runDirs.length; idx++) {
    const rDir = runDirs[idx];
    const runId = path.basename(rDir);
    const summaryPath = path.join(rDir, "summary.json");
    const summaryBeforePath = path.join(rDir, "summary_before_revisions.json");

    let existingSummary: EvaluationRunSummary | null = null;
    if (fsSync.existsSync(summaryPath)) {
      try {
        existingSummary = JSON.parse(fsSync.readFileSync(summaryPath, "utf-8"));
      } catch {}
    }

    const modelName = existingSummary?.model || runId;
    const providerName = existingSummary?.provider || "openrouter";

    console.log(`\n-----------------------------------------------------------------------------`);
    console.log(`[${idx + 1}/${runDirs.length}] Run: ${runId}`);
    console.log(`Target Model : ${modelName} (${providerName})`);

    // Check if reports already exist
    const reportIntegrity = path.join(rDir, "docs", "report_integrity.md");
    const reportCritique = path.join(rDir, "docs", "report_critique.md");
    const alreadyCompleted = fsSync.existsSync(reportIntegrity) && fsSync.existsSync(reportCritique);

    if (alreadyCompleted && !opts.force) {
      console.log(`  ℹ Phase 12 & 13 reports already exist. Skipping execution. (Use --force to re-execute).`);
      continue;
    }

    // Step 1: Snapshot baseline manuscript & summary
    if (!fsSync.existsSync(summaryBeforePath) && fsSync.existsSync(summaryPath)) {
      fsSync.copyFileSync(summaryPath, summaryBeforePath);
      console.log(`  ✓ Preserved baseline telemetry: summary_before_revisions.json`);
    }

    const manuscriptDoc = path.join(rDir, "docs", "manuscript.md");
    const manuscriptRoot = path.join(rDir, "manuscript.md");
    const activeManuscriptPath = fsSync.existsSync(manuscriptDoc) ? manuscriptDoc : manuscriptRoot;
    const manuscriptRev00 = path.join(rDir, "docs", "manuscript_rev_00.md");

    if (fsSync.existsSync(activeManuscriptPath) && !fsSync.existsSync(manuscriptRev00)) {
      await fs.mkdir(path.join(rDir, "docs"), { recursive: true });
      fsSync.copyFileSync(activeManuscriptPath, manuscriptRev00);
      console.log(`  ✓ Preserved baseline manuscript: docs/manuscript_rev_00.md`);
    }

    if (opts.force) {
      // Cleanly reset manuscript and phase logs to baseline state for re-run
      if (fsSync.existsSync(manuscriptRev00)) {
        if (fsSync.existsSync(manuscriptDoc)) fsSync.copyFileSync(manuscriptRev00, manuscriptDoc);
        if (fsSync.existsSync(manuscriptRoot)) fsSync.copyFileSync(manuscriptRev00, manuscriptRoot);
      }
      const filesToReset = [
        path.join(rDir, "docs", "manuscript_rev_01.md"),
        path.join(rDir, "docs", "manuscript_rev_02.md"),
        path.join(rDir, "docs", "report_integrity.md"),
        path.join(rDir, "docs", "report_critique.md"),
      ];
      for (const f of filesToReset) {
        if (fsSync.existsSync(f)) fsSync.unlinkSync(f);
      }
    }

    // Step 2: Inject Phase 12 & 13 into run's analysis directory
    const targetAnalysisDir = path.join(rDir, "analysis");
    await fs.mkdir(targetAnalysisDir, { recursive: true });
    fsSync.copyFileSync(templatePhase12, path.join(targetAnalysisDir, "12_INTEGRITY.md"));
    fsSync.copyFileSync(templatePhase13, path.join(targetAnalysisDir, "13_CRITIQUE.md"));
    console.log(`  ✓ Injected 12_INTEGRITY.md & 13_CRITIQUE.md into analysis/`);

    // Step 2b: Pre-generate data/integrity_defects.json so the LLM has exact defect coordinates in Turn 1
    try {
      const preFlightReport = runIntegrityCheck(rDir, "docs/manuscript.md");
      console.log(
        `  ✓ Pre-flight integrity scan: ${preFlightReport.totalDefectCount} defect(s) detected ` +
        `(${preFlightReport.defects.directionErrors.length} direction errors, ${preFlightReport.defects.numericMismatches.length} numeric mismatches).`
      );
      console.log(`    Wrote defect catalog -> data/integrity_defects.json`);
    } catch (verErr: any) {
      console.warn(`  ⚠️ Could not pre-compute integrity scan: ${verErr.message}`);
    }

    if (opts.dryRun) {
      console.log(`  [DRY RUN] Would execute Phases 12 & 13 for ${modelName} and rescore.`);
      continue;
    }

    // Step 3: Configure model & orchestrator for this run sandbox
    client.updateConfig({
      model: modelName,
      provider: providerName as any,
      multiModelEnabled: false,
    });
    configStore.update({
      model: modelName,
      provider: providerName as any,
      multiModelEnabled: false,
    });

    const tools = new ToolRegistry(rDir);
    const orchestrator = new PipelineOrchestrator(
      rDir,
      client,
      tools,
      () => {},
      (log) => {
        // Log key phase transitions to stdout
        if (log.includes("[Starting]") || log.includes("Phase:") || log.includes("completed") || log.includes("error")) {
          console.log(`    [Pipeline] ${log}`);
        }
      },
      "1.0.0"
    );

    await orchestrator.setWorkingDirectory(rDir);
    await orchestrator.rescanPhases(true);

    if (opts.force) {
      // Prune downstream phase records from notes.md
      await orchestrator.pruneNotesFromPhase(11);
      await orchestrator.rescanPhases(true);
    }

    // Safeguard: Ensure all phases 01-11 are marked completed in-memory so resumePipeline starts at 12
    for (const p of orchestrator.getPhases()) {
      const idNum = parseInt(p.id, 10);
      if (!isNaN(idNum) && idNum < 12) {
        p.status = "completed";
      }
    }

    console.log(`  ▶ Resuming pipeline from Phase 12 (Integrity)...`);
    const startTimeMs = Date.now();

    try {
      await orchestrator.resumePipeline("12");
    } catch (execErr: any) {
      console.error(`  ❌ Pipeline execution error: ${execErr.message}`);
    }

    const elapsedSec = Math.round((Date.now() - startTimeMs) / 1000);

    // Verify whether Phase 12 and 13 actually succeeded
    const activePhases = orchestrator.getPhases();
    const phase12 = activePhases.find((p) => p.id === "12");
    const phase13 = activePhases.find((p) => p.id === "13");

    if (phase12?.status === "failed" || phase13?.status === "failed") {
      console.error(`  ❌ Pipeline did not complete revision phases: Phase 12=${phase12?.status}, Phase 13=${phase13?.status}`);
      if (phase12?.error) console.error(`     Phase 12 error: ${phase12.error}`);
      if (phase13?.error) console.error(`     Phase 13 error: ${phase13.error}`);
      console.log(`  Skipping rescoring for incomplete run ${runId}.`);
      continue;
    }

    console.log(`  ✓ Phase 12 & 13 execution finished in ${elapsedSec}s.`);

    // Step 4: Ensure canonical manuscript synchronization
    const rev02Path = path.join(rDir, "docs", "manuscript_rev_02.md");
    const rev01Path = path.join(rDir, "docs", "manuscript_rev_01.md");
    if (fsSync.existsSync(rev02Path)) {
      fsSync.copyFileSync(rev02Path, manuscriptDoc);
      fsSync.copyFileSync(rev02Path, manuscriptRoot);
    } else if (fsSync.existsSync(rev01Path)) {
      fsSync.copyFileSync(rev01Path, manuscriptDoc);
      fsSync.copyFileSync(rev01Path, manuscriptRoot);
    }

    // Step 4b: Post-flight integrity check
    try {
      const postFlightReport = runIntegrityCheck(rDir, "docs/manuscript.md");
      console.log(
        `  ✓ Post-flight integrity scan: ${postFlightReport.totalDefectCount} defect(s) remaining ` +
        `(${postFlightReport.defects.directionErrors.length} direction errors, ${postFlightReport.defects.numericMismatches.length} numeric mismatches).`
      );
    } catch (_) {}

    // Step 5: Collect telemetry across all 13 phases
    const telemetry = await evalService.collectTelemetry(rDir, orchestrator);

    // Step 6: Rescore revised output
    console.log(`  ▶ Rescoring revised outputs (Rubric v${RUBRIC_VERSION})...`);
    const newScores = await scoreRunV2({
      runRoot: rDir,
      client,
      reviewers: activeReviewers,
      useLLM: opts.useLLM,
    });

    // Word count calculation
    let wordCount = 0;
    if (fsSync.existsSync(manuscriptDoc)) {
      try {
        const msText = fsSync.readFileSync(manuscriptDoc, "utf-8");
        wordCount = msText.split(/\s+/).filter(Boolean).length;
      } catch {}
    }

    const hasFailedPhase = telemetry.phaseMetrics.some((p) => p.status === "failed");
    const runStatus: "completed" | "failed" = hasFailedPhase ? "failed" : "completed";

    // Step 7: Update summary.json with 13-phase data
    const updatedSummary: EvaluationRunSummary = {
      ...(existingSummary || {
        id: runId,
        suiteId: "unified_evaluations",
        model: modelName,
        provider: providerName,
        iteration: 1,
        outputPath: path.relative(absEvalDir, rDir),
      }),
      id: runId,
      model: modelName,
      provider: providerName,
      timestamp: new Date().toISOString(),
      status: runStatus,
      totalDurationSeconds: (existingSummary?.totalDurationSeconds || 0) + elapsedSec,
      totalTurns: telemetry.totalTurns,
      tokenUsage: telemetry.tokenUsage,
      phaseMetrics: telemetry.phaseMetrics,
      scores: newScores,
      manuscriptWordCount: wordCount,
      outputPath: path.relative(absEvalDir, rDir),
    };

    fsSync.writeFileSync(summaryPath, JSON.stringify(updatedSummary, null, 2), "utf-8");
    console.log(`  ✓ Updated summary.json (Total tokens: ${telemetry.tokenUsage.totalTokens.toLocaleString()})`);

    // Report immediate score delta if before summary exists
    if (fsSync.existsSync(summaryBeforePath)) {
      try {
        const before: EvaluationRunSummary = JSON.parse(fsSync.readFileSync(summaryBeforePath, "utf-8"));
        const scoreDelta = (newScores.overallBenchmarkScore - (before.scores?.overallBenchmarkScore || 0));
        const tokenDelta = telemetry.tokenUsage.totalTokens - (before.tokenUsage?.totalTokens || 0);
        const sign = scoreDelta >= 0 ? "+" : "";
        console.log(`  📊 Score Delta : ${before.scores?.overallBenchmarkScore} -> ${newScores.overallBenchmarkScore} (${sign}${scoreDelta} pts)`);
        console.log(`  🪙 Token Delta : +${tokenDelta.toLocaleString()} tokens (+${((tokenDelta / (before.tokenUsage?.totalTokens || 1)) * 100).toFixed(1)}%)`);
      } catch {}
    }

    // Update in-memory suite
    if (suiteData && suiteData.runs) {
      const sIdx = suiteData.runs.findIndex((r) => r.id === runId);
      if (sIdx >= 0) {
        suiteData.runs[sIdx] = updatedSummary;
      } else {
        suiteData.runs.push(updatedSummary);
      }
      suiteData.aggregated = evalService.aggregatePerformance(suiteData.runs);
      fsSync.writeFileSync(suitePath, JSON.stringify(suiteData, null, 2), "utf-8");
    }

    processedCount++;
  }

  console.log(`\n=============================================================================`);
  console.log(`✓ Benchmark Revision Execution Complete. (${processedCount} run(s) updated)`);
  console.log(`Run comparison analysis: npm run benchmark:compare`);
  console.log(`=============================================================================\n`);
}

main().catch((err) => {
  console.error("Fatal revision runner error:", err);
  process.exit(1);
});

