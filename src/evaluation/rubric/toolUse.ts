import * as fsSync from "fs";
import * as path from "path";
import type { ToolUseBreakdown } from "../../types/evaluation";

/**
 * Structured tool-use analysis (rubric v2).
 *
 * Parses the per-phase `logs/<phase>/chat.md` transcripts, which record each tool call as
 *   - **`tool_name`** (id: `...`)  followed by a ```json args``` block
 * and each result as
 *   #### [ts] Tool Result: `tool_name` [SUCCESS|FAILED|...] (id: `...`)
 *
 * Components (each 0-1):
 *   coverage        (30%) required pipeline tool groups actually invoked
 *   perCallSuccess  (30%) successful results / all results (every failure counts)
 *   efficiency      (20%) penalises identical repeated calls (same tool + args)
 *   appropriateness (20%) MCP analysis tools vs raw Rscript/python execution
 */

export const REQUIRED_TOOL_GROUPS: { name: string; tools: RegExp }[] = [
  { name: "data load", tools: /^tpa_(load|ingest_config|input_audit)$/ },
  { name: "normalization", tools: /^tpa_(normalize|select_normalization|normalization_sensitivity)$/ },
  { name: "imputation", tools: /^tpa_impute$/ },
  { name: "differential expression", tools: /^tpa_(expression|batch_analysis)$/ },
  { name: "enrichment", tools: /^tpa_enrichment$/ },
  { name: "plotting", tools: /^tpa_plot$/ },
  { name: "table/state export", tools: /^tpa_(export_table|export_state)$/ },
  { name: "external evidence search", tools: /^(web_search|pubmed_search|uniprot_search|literature_.*|tpa_literature.*)$/ },
];

const ORCHESTRATION = new Set(["complete_phase", "check_checkpoint_gate"]);
const SEARCH = /^(web_search|pubmed_search|uniprot_search)$/;

export function analyzeToolUse(runRoot: string): ToolUseBreakdown | null {
  const logsDir = path.join(runRoot, "logs");
  if (!fsSync.existsSync(logsDir)) return null;

  const callCounts = new Map<string, number>();
  const toolsSeen = new Set<string>();
  let totalCalls = 0;
  let results = 0;
  let failures = 0;
  let tpaCalls = 0;
  let searchCalls = 0;
  let rawExecCalls = 0;
  let phasesParsed = 0;

  const callRe = /^- \*\*`([A-Za-z0-9_]+)`\*\* \(id: `[^`]*`\)\s*\n\s*```json\s*\n([\s\S]*?)\n\s*```/gm;
  const resultRe = /Tool Result: `([A-Za-z0-9_]+)` \[([A-Z_]+)\]/g;

  for (const d of fsSync.readdirSync(logsDir, { withFileTypes: true })) {
    if (!d.isDirectory() || d.name === "agent") continue;
    const chat = path.join(logsDir, d.name, "chat.md");
    if (!fsSync.existsSync(chat)) continue;
    phasesParsed++;
    const content = fsSync.readFileSync(chat, "utf-8");

    let m: RegExpExecArray | null;
    callRe.lastIndex = 0;
    while ((m = callRe.exec(content))) {
      const name = m[1];
      const args = m[2].replace(/\s+/g, " ").trim();
      totalCalls++;
      toolsSeen.add(name);
      if (name.startsWith("tpa_")) tpaCalls++;
      if (SEARCH.test(name)) searchCalls++;
      if (name === "execute_command" && /(Rscript|python3?|\bR\s+-e|\bR\s+--)/.test(args)) rawExecCalls++;
      if (!ORCHESTRATION.has(name)) {
        const key = `${name}|${args}`;
        callCounts.set(key, (callCounts.get(key) || 0) + 1);
      }
    }

    resultRe.lastIndex = 0;
    while ((m = resultRe.exec(content))) {
      results++;
      if (m[2] !== "SUCCESS") failures++;
    }
  }

  if (phasesParsed === 0) return null;

  let redundant = 0;
  for (const c of callCounts.values()) if (c > 1) redundant += c - 1;

  const missingToolGroups = REQUIRED_TOOL_GROUPS.filter((g) => !Array.from(toolsSeen).some((t) => g.tools.test(t))).map((g) => g.name);
  const coverage = (REQUIRED_TOOL_GROUPS.length - missingToolGroups.length) / REQUIRED_TOOL_GROUPS.length;
  const perCallSuccess = results > 0 ? (results - failures) / results : 0;
  const efficiency = totalCalls > 0 ? Math.max(0, 1 - (2 * redundant) / totalCalls) : 0;
  const analysisCalls = tpaCalls + rawExecCalls;
  const mcpShare = analysisCalls > 0 ? tpaCalls / analysisCalls : 0;
  // Full credit at >= 60% MCP share of analysis calls, linear to zero at 20%.
  const appropriateness = Math.max(0, Math.min(1, (mcpShare - 0.2) / 0.4));

  const score = Math.round((coverage * 0.3 + perCallSuccess * 0.3 + efficiency * 0.2 + appropriateness * 0.2) * 100);

  const r3 = (x: number) => Math.round(x * 1000) / 1000;
  return {
    score,
    coverage: r3(coverage),
    perCallSuccess: r3(perCallSuccess),
    efficiency: r3(efficiency),
    appropriateness: r3(appropriateness),
    totalCalls,
    failedCalls: failures,
    redundantCalls: redundant,
    tpaCalls,
    searchCalls,
    rawExecCalls,
    missingToolGroups,
    phasesParsed,
  };
}

