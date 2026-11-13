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

type DraftTarget = "phase11" | "phase13" | "both";

interface CLIOptions {
  evalDir: string;
  modelFilter?: string;
  useLLM: boolean;
  force: boolean;
  dryRun: boolean;
  rescoreOnly: boolean;
  draft: DraftTarget;
  customReviewers?: ReviewerModelRef[];
}

function normalizeDraftTarget(val: string): DraftTarget {
  const v = val.toLowerCase().trim();
  if (v === "phase11" || v === "11" || v === "rev00" || v === "before") return "phase11";
  if (v === "phase13" || v === "13" || v === "rev02" || v === "after" || v === "final") return "phase13";
  return "both";
}

function parseArgs(): CLIOptions {
  const args = process.argv.slice(2);
  let evalDir = "testrun/evaluations";
  let modelFilter: string | undefined = undefined;
  let useLLM = true;
  let force = false;
  let dryRun = false;
  let rescoreOnly = false;
  let draft: DraftTarget = "both";
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
    } else if (a === "--rescore-only" || a === "--rescore") {
      rescoreOnly = true;
    } else if (a.startsWith("--draft=")) {
      draft = normalizeDraftTarget(a.slice("--draft=".length));
    } else if (a === "--draft" && args[i + 1]) {
      draft = normalizeDraftTarget(args[++i]);
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

  return { evalDir, modelFilter, useLLM, force, dryRun, rescoreOnly, draft, customReviewers };
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

    const rawModelName = existingSummary?.model || runId;
    const modelName = rawModelName.replace(/\s*\(baseline\)/i, "").trim();
    let providerName = existingSummary?.provider || "openrouter";
    if (!providerName || providerName === "-") {
      providerName = "openrouter";
    }

    console.log(`\n-----------------------------------------------------------------------------`);
    console.log(`[${idx + 1}/${runDirs.length}] Run: ${runId}`);
    console.log(`Target Model : ${modelName} (${providerName})`);

    // Check if reports already exist
    const reportIntegrity = path.join(rDir, "docs", "report_integrity.md");
    const reportCritique = path.join(rDir, "docs", "report_critique.md");
    const alreadyCompleted = fsSync.existsSync(reportIntegrity) && fsSync.existsSync(reportCritique);

    if (opts.rescoreOnly) {
      console.log(`  ▶ Rescore-only mode: Evaluating current outputs on disk.`);
    } else if (alreadyCompleted && !opts.force) {
      console.log(`  ℹ Phase 12 & 13 reports already exist. Skipping execution. (Use --force to re-execute, or --rescore-only to re-evaluate).`);
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

    await fs.mkdir(path.join(rDir, "docs"), { recursive: true });

    if (fsSync.existsSync(activeManuscriptPath) && !fsSync.existsSync(manuscriptRev00)) {
      fsSync.copyFileSync(activeManuscriptPath, manuscriptRev00);
      console.log(`  ✓ Preserved baseline manuscript: docs/manuscript_rev_00.md`);
    }

    if (!fsSync.existsSync(manuscriptDoc) && fsSync.existsSync(manuscriptRoot)) {
      fsSync.copyFileSync(manuscriptRoot, manuscriptDoc);
      console.log(`  ✓ Synced root manuscript to docs/manuscript.md`);
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

    // Ensure phases 01-11 templates exist in analysis/
    const templatePipelineDir = path.join(projectRoot, "templates", "pipelines", "differential_expression");
    if (fsSync.existsSync(templatePipelineDir)) {
      const templateFiles = fsSync.readdirSync(templatePipelineDir);
      for (const tf of templateFiles) {
        if (/^\d\d_.*\.md$/.test(tf)) {
          const destFile = path.join(targetAnalysisDir, tf);
          if (!fsSync.existsSync(destFile)) {
            fsSync.copyFileSync(path.join(templatePipelineDir, tf), destFile);
          }
        }
      }
    }

    const experimentDoc = path.join(rDir, "docs", "experiment.md");
    if (!fsSync.existsSync(experimentDoc)) {
      const sampleExp = path.join(absEvalDir, "01_google_gemini-3_1-flash-lite_iter1", "docs", "experiment.md");
      if (fsSync.existsSync(sampleExp)) {
        fsSync.copyFileSync(sampleExp, experimentDoc);
      }
    }

    const notesDoc = path.join(rDir, "docs", "notes.md");
    if (!fsSync.existsSync(notesDoc) && existingSummary?.phaseMetrics) {
      let notesContent = `# Autonomous Proteomics Analysis Notes\nModel: ${modelName}\n\n`;
      for (const pm of existingSummary.phaseMetrics) {
        notesContent += `### ${pm.phaseTitle || `Phase ${pm.phaseId}`} - COMPLETED\n`;
        notesContent += `- **File**: \`${pm.fileName || `${pm.phaseId}.md`}\`\n`;
        notesContent += `- **Duration**: ${pm.durationSeconds || 0}s\n`;
        notesContent += `- **Turns**: ${pm.turns || 1}\n`;
        notesContent += `- **Token Usage**: Total: ${pm.tokenUsage?.totalTokens || 0}, Prompt: ${pm.tokenUsage?.promptTokens || 0}, Completion: ${pm.tokenUsage?.completionTokens || 0}\n\n---\n\n`;
      }
      fsSync.writeFileSync(notesDoc, notesContent, "utf-8");
    }

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

    let elapsedSec = 0;
    if (!opts.rescoreOnly) {
      console.log(`  ▶ Resuming pipeline from Phase 12 (Integrity)...`);
      const startTimeMs = Date.now();

      try {
        await orchestrator.resumePipeline("12");
      } catch (execErr: any) {
        console.error(`  ❌ Pipeline execution error: ${execErr.message}`);
      }

      elapsedSec = Math.round((Date.now() - startTimeMs) / 1000);

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
    } else {
      console.log(`  ✓ Skipping pipeline execution (evaluating existing artifacts on disk).`);
    }

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

    // If existingSummary has phase metrics for 01-11 that orchestrator didn't track in memory, merge them
    if (existingSummary?.phaseMetrics) {
      const priorPhases = existingSummary.phaseMetrics.filter((p) => {
        const idNum = parseInt(p.phaseId, 10);
        return !isNaN(idNum) && idNum < 12;
      });
      for (const prior of priorPhases) {
        const existingIdx = telemetry.phaseMetrics.findIndex((p) => p.phaseId === prior.phaseId);
        if (existingIdx >= 0) {
          const cur = telemetry.phaseMetrics[existingIdx];
          if ((cur.tokenUsage?.totalTokens || 0) === 0 && (prior.tokenUsage?.totalTokens || 0) > 0) {
            telemetry.phaseMetrics[existingIdx] = prior;
          }
        } else {
          telemetry.phaseMetrics.unshift(prior);
        }
      }
      // Sort phase metrics in numeric order
      telemetry.phaseMetrics.sort((a, b) => parseInt(a.phaseId, 10) - parseInt(b.phaseId, 10));

      // Re-sum total tokens and turns
      let promptT = 0, compT = 0, totalT = 0, turnsT = 0, durT = 0;
      for (const p of telemetry.phaseMetrics) {
        promptT += p.tokenUsage?.promptTokens || 0;
        compT += p.tokenUsage?.completionTokens || 0;
        totalT += p.tokenUsage?.totalTokens || 0;
        turnsT += p.turns || 0;
        durT += p.durationSeconds || 0;
      }
      telemetry.tokenUsage = { promptTokens: promptT, completionTokens: compT, totalTokens: totalT };
      telemetry.totalTurns = turnsT;
      telemetry.totalDurationSeconds = durT;
    }

    // Step 6a: Score Phase 11 baseline draft (docs/manuscript_rev_00.md) if requested
    if ((opts.draft === "phase11" || opts.draft === "both") && fsSync.existsSync(manuscriptRev00)) {
      let existingBefore: any = null;
      if (fsSync.existsSync(summaryBeforePath)) {
        try {
          existingBefore = JSON.parse(fsSync.readFileSync(summaryBeforePath, "utf-8"));
        } catch {}
      }
      const hasValidRev00Scores =
        !opts.force && existingBefore?.evaluatedManuscript === "docs/manuscript_rev_00.md";
      const existingRev00Reviewers = hasValidRev00Scores
        ? existingBefore?.scores?.reviewerPanel?.reviewers
        : undefined;

      console.log(`  ▶ Scoring Phase 11 draft (docs/manuscript_rev_00.md, Rubric v${RUBRIC_VERSION})...`);
      const rev00Scores = await scoreRunV2({
        runRoot: rDir,
        manuscriptPath: manuscriptRev00,
        client,
        reviewers: activeReviewers,
        useLLM: opts.useLLM,
        existingReviewerResults: existingRev00Reviewers,
      });

      let rev00Words = 0;
      try {
        rev00Words = fsSync.readFileSync(manuscriptRev00, "utf-8").split(/\s+/).filter(Boolean).length;
      } catch {}

      const phases01To11 = telemetry.phaseMetrics.filter((p) => {
        const idNum = parseInt(p.phaseId, 10);
        return !isNaN(idNum) && idNum <= 11;
      });
      let p11Prompt = 0, p11Comp = 0, p11Total = 0, p11Turns = 0, p11Dur = 0;
      for (const p of phases01To11) {
        p11Prompt += p.tokenUsage?.promptTokens || 0;
        p11Comp += p.tokenUsage?.completionTokens || 0;
        p11Total += p.tokenUsage?.totalTokens || 0;
        p11Turns += p.turns || 0;
        p11Dur += p.durationSeconds || 0;
      }

      const beforeSummaryObj = {
        ...(existingBefore || existingSummary || {}),
        id: runId,
        suiteId: existingSummary?.suiteId || "unified_evaluations",
        model: modelName,
        provider: providerName,
        timestamp: new Date().toISOString(),
        status: rev00Words >= 100 ? "completed" : "failed",
        evaluatedManuscript: "docs/manuscript_rev_00.md",
        totalDurationSeconds: p11Dur,
        totalTurns: p11Turns,
        tokenUsage: { promptTokens: p11Prompt, completionTokens: p11Comp, totalTokens: p11Total },
        phaseMetrics: phases01To11,
        scores: rev00Scores,
        manuscriptWordCount: rev00Words,
        outputPath: path.relative(absEvalDir, rDir),
      };
      fsSync.writeFileSync(summaryBeforePath, JSON.stringify(beforeSummaryObj, null, 2), "utf-8");
      console.log(
        `  ✓ Updated summary_before_revisions.json (Phase 11 Score: ${rev00Scores.overallBenchmarkScore}/100, Panel: ${rev00Scores.reviewerPanel?.status || "n/a"})`
      );
    }

    // Step 6b: Rescore Phase 13 revised output (docs/manuscript.md)
    let newScores = existingSummary?.scores;
    if (opts.draft === "phase13" || opts.draft === "both" || !newScores) {
      const existingRev02Reviewers = !opts.force
        ? existingSummary?.scores?.reviewerPanel?.reviewers
        : undefined;
      console.log(`  ▶ Scoring Phase 13 revised output (docs/manuscript.md, Rubric v${RUBRIC_VERSION})...`);
      newScores = await scoreRunV2({
        runRoot: rDir,
        manuscriptPath: manuscriptDoc,
        client,
        reviewers: activeReviewers,
        useLLM: opts.useLLM,
        existingReviewerResults: existingRev02Reviewers,
      });
    }

    // Word count calculation
    let wordCount = 0;
    if (fsSync.existsSync(manuscriptDoc)) {
      try {
        const msText = fsSync.readFileSync(manuscriptDoc, "utf-8");
        wordCount = msText.split(/\s+/).filter(Boolean).length;
      } catch {}
    }

    const hasFailedPhase = telemetry.phaseMetrics.some((p) => p.status === "failed");
    const hasPendingPhase = telemetry.phaseMetrics.some((p) => p.status === "pending");
    const runStatus: "completed" | "failed" =
      hasFailedPhase || hasPendingPhase || wordCount < 100 ? "failed" : "completed";

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

