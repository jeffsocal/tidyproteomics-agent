import * as fs from "fs/promises";
import * as fsSync from "fs";
import * as path from "path";
import { FolderStatus, LLMRole, ModelTokenUsage, PhaseInfo, PhaseStatus, PipelineState, PromptFileInfo, TokenUsage } from "../types";
import { ContextBuilder } from "../agent/ContextBuilder";
import { AgentLoop, AgentLoopState } from "../agent/AgentLoop";
import { ChatLogger } from "../agent/ChatLogger";
import { ProviderClient } from "../llm/ProviderClient";
import { ToolRegistry } from "../tools/ToolRegistry";
import { writeActiveModelSummaryFile } from "./ModelSummaryWriter";
import { readLiteratureConfig } from "../literature/LiteratureService";
import { configStore } from "../config/ConfigStore";

export class PipelineOrchestrator {
  private phases: PhaseInfo[] = [];
  private auxiliaryTokens: Record<string, ModelTokenUsage> = {};
  private isRunning = false;
  private isStopping = false;
  private isFullPipelineRunning = false;
  private shouldStop = false;
  private suppressNotifications = false;
  private chatLogger: ChatLogger;
  private phaseLoopStates: Map<string, AgentLoopState> = new Map();
  private activeLoop?: AgentLoop;
  private currentRunController?: AbortController;
  private activeRunPromise?: Promise<void>;
  private activeRunId?: symbol;
  private phaseFailureCounts: Map<string, number> = new Map();

  constructor(
    private workspaceRoot: string,
    private client: ProviderClient,
    private tools: ToolRegistry,
    private onStateChange: (state: PipelineState) => void,
    private onLog: (text: string, updateLast?: boolean) => void,
    private extensionVersion: string = "0.1.0",
    private onAgentActivity?: (phase: PhaseInfo, text: string) => void,
    private onAgentObservation?: (phase: PhaseInfo, text: string, metadata?: { badge?: string; metric?: string }) => void,
    private onPhaseStarted?: (phase: PhaseInfo) => void,
    private onPhaseCompleted?: (phase: PhaseInfo) => void,
    private onPipelineFinished?: (state: PipelineState) => void,
    private onPhaseHalted?: (phase: PhaseInfo, reason?: string) => void
  ) {
    this.workspaceRoot = workspaceRoot || "";
    this.chatLogger = new ChatLogger(this.workspaceRoot);
    if (this.workspaceRoot) {
      this.rescanPhases().catch((err) => {
        console.error("[PipelineOrchestrator] Error rescanning phases:", err);
      });
    }
  }

  public setExtensionVersion(version: string) {
    this.extensionVersion = version || "0.1.0";
  }

  public setSuppressNotifications(suppress: boolean) {
    this.suppressNotifications = suppress;
  }

  public getSuppressNotifications(): boolean {
    return this.suppressNotifications;
  }

  public async syncModelSummary(): Promise<string> {
    if (!this.workspaceRoot) return "";
    return await writeActiveModelSummaryFile(this.workspaceRoot, this.client.getConfig(), this.extensionVersion);
  }

  private ts(): string {
    const d = new Date();
    return d.toTimeString().split(" ")[0];
  }

  private logPhase(tag: string, message: string, updateLast = false) {
    const line = `[${this.ts()}] ${tag}: ${message}`;
    this.onLog(this.truncateTo(line, 120), updateLast);
  }

  private logPipeline(message: string, updateLast = false) {
    this.logPhase("Pipeline", message, updateLast);
  }

  private truncateTo(line: string, maxLen = 120): string {
    if (line.length <= maxLen) return line;
    return line.slice(0, maxLen - 3) + "...";
  }

  private formatToolHeader(name: string, args: Record<string, any>): string {
    switch (name) {
      case "execute_command": {
        const cmd = String(args?.command || "").trim().replace(/\s+/g, " ");
        return `[Command] ${cmd}`;
      }
      case "read_file": {
        const filePath = String(args?.filePath || "").trim();
        const range = args?.startLine
          ? ` (lines ${args.startLine}-${Number(args.startLine) + Number(args.maxLines || 0) - 1})`
          : "";
        return `[Read] ${filePath}${range}`;
      }
      case "write_file": {
        const filePath = String(args?.filePath || "").trim();
        const len = typeof args?.content === "string" ? ` (${args.content.length} chars)` : "";
        return `[Write] ${filePath}${len}`;
      }
      case "replace_file_content": {
        const filePath = String(args?.filePath || "").trim();
        return `[Edit] ${filePath}`;
      }
      case "list_directory": {
        const dp = String(args?.dirPath || ".").trim();
        const display = (!dp || dp === "." || dp === "./") ? "directory contents" : dp;
        return `[List] ${display}`;
      }
      case "check_checkpoint_gate": {
        const files = Array.isArray(args?.requiredFiles) ? args.requiredFiles.join(", ") : "";
        return `[Check Gate] ${files}`;
      }
      case "complete_phase": {
        const pName = String(args?.phaseName || "").trim();
        return `[Complete Phase] ${pName}`;
      }
      case "fail_phase": {
        const pName = String(args?.phaseName || "").trim();
        const reason = String(args?.reason || "").trim();
        return `[Halt Phase] ${pName}${reason ? ": " + reason : ""}`;
      }
      case "tpa_load": {
        const src = args?.source || args?.load_local || "";
        const cfg = args?.config ? ` (config: ${path.basename(String(args.config))})` : "";
        return `[MCP Load] ${path.basename(String(src)) || src}${cfg}`;
      }
      case "tpa_import_expression_table": {
        const fp = args?.file_path ? path.basename(String(args.file_path)) : "table";
        const comp = args?.comparison ? ` (${args.comparison})` : "";
        return `[MCP Import Table] ${fp}${comp}`;
      }
      case "tpa_export_config": {
        return `[MCP Export Config] ${args?.platform || "config"}${args?.analyte ? ` (${args.analyte})` : ""}`;
      }
      case "tpa_inspect": {
        return `[MCP Inspect] ${args?.what || "structure"}`;
      }
      case "tpa_summary": {
        return `[MCP Summary] ${args?.by || "summary"}`;
      }
      case "tpa_subset": {
        return `[MCP Subset] ${args?.subset_expression || ""}`;
      }
      case "tpa_normalize": {
        const methods = Array.isArray(args?.methods) ? args.methods.join(", ") : args?.methods || "";
        return `[MCP Normalize] ${methods}`;
      }
      case "tpa_select_normalization": {
        return `[MCP Select Normalization] ${args?.method || ""}`;
      }
      case "tpa_impute": {
        return `[MCP Impute] ${args?.algorithm || args?.method || ""}`;
      }
      case "tpa_expression": {
        return `[MCP Expression] ${args?.comparison || ""}`;
      }
      case "tpa_enrichment": {
        return `[MCP Enrichment] ${args?.comparison || ""} (${args?.term || ""})`;
      }
      case "tpa_query_expression": {
        return `[MCP Query Expression] ${args?.comparison || ""} (min_log2fc: ${args?.min_log2fc ?? 0}, max_adjp: ${args?.max_adjp ?? 1})`;
      }
      case "tpa_query_enrichment": {
        return `[MCP Query Enrichment] ${args?.comparison || ""} (${args?.terms || "all"})`;
      }
      case "tpa_compile_summary": {
        return `[MCP Compile Summary] target: ${args?.target_gene || "untargeted"}`;
      }
      case "tpa_batch_analysis": {
        return `[MCP Batch Analysis] ${args?.type || "analysis"}`;
      }
      case "tpa_plot": {
        return `[MCP Plot] ${args?.type || "plot"}`;
      }
      case "tpa_export_table": {
        return `[MCP Export Table] ${args?.file_name || args?.type || ""}`;
      }
      case "tpa_export_state": {
        return `[MCP Export State] ${path.basename(String(args?.script_path || "pipeline.R"))}`;
      }
      case "tpa_extract": {
        return `[MCP Extract] ${args?.values || "values"}`;
      }
      case "tpa_operations": {
        return `[MCP Audit Operations]`;
      }
      case "tpa_reassign": {
        const target = args?.target || "sample";
        const desc = args?.mapping ? `${Object.keys(args.mapping).length} sample mappings` : (args?.condition ? `${args.condition} -> ${args.replace}` : "");
        return `[MCP Reassign] ${target} (${desc})`;
      }
      case "tpa_health": {
        return `[MCP Health Check]`;
      }
      default: {
        const keys = Object.keys(args || {});
        const summary = keys.length > 0 ? ` (${keys.join(", ")})` : "";
        return `[${name}]${summary}`;
      }
    }
  }

  private formatNaturalActivity(name: string, args: Record<string, any>, phaseTitle: string): string {
    switch (name) {
      case "tpa_load": {
        const src = args?.source || args?.load_local || "";
        const base = path.basename(String(src)) || "dataset";
        return `Loading quantitative dataset from \`${base}\` ...`;
      }
      case "tpa_import_expression_table": {
        const fp = args?.file_path ? path.basename(String(args.file_path)) : "table";
        return `Importing differential expression table from \`${fp}\` into tidyproteomics ...`;
      }
      case "tpa_export_config": {
        const plat = args?.platform || "platform";
        return `Exporting ${plat} import configuration template ...`;
      }
      case "tpa_input_audit": {
        const plat = args?.platform || "platform";
        return `Auditing raw file headers and matching regex patterns against ${plat} ...`;
      }
      case "tpa_ingest_config": {
        const act = args?.action || "configuring";
        return `Customizing ingestion configuration (${act}) for ${args?.platform || "platform"} ...`;
      }
      case "tpa_inspect": {
        const what = String(args?.what || "structure");
        if (what === "overview") return "Examining sample table & dataset topology ...";
        if (what === "samples") return "Examining sample table ...";
        if (what === "operations") return "Checking operations history and normalization status ...";
        return `Inspecting dataset ${what} ...`;
      }
      case "tpa_summary": {
        const by = String(args?.by || args?.what || "sample");
        return `Examining sample table & quality metrics across ${by}s ...`;
      }
      case "tpa_normalize": {
        const methods = Array.isArray(args?.methods)
          ? args.methods.join(", ")
          : args?.methods || args?.method || "algorithms";
        return `Benchmarking normalization (${methods}) ...`;
      }
      case "tpa_select_normalization": {
        return `Selecting ${args?.method || "optimal"} normalization layer ...`;
      }
      case "tpa_impute": {
        const alg = args?.algorithm || args?.method || "configured strategy";
        return `Imputing missing quantitative values (${alg}) ...`;
      }
      case "tpa_expression": {
        const comp = args?.comparison || args?.contrast;
        return comp
          ? `Performing expression analysis (\`${comp}\`) ...`
          : `Performing expression analysis ...`;
      }
      case "tpa_enrichment": {
        const term = args?.term || args?.terms || "pathways";
        return `Running functional enrichment analysis (${term}) ...`;
      }
      case "tpa_query_expression": {
        const comp = args?.comparison ? ` (${args.comparison})` : "";
        return `Querying differential expression candidates${comp} ...`;
      }
      case "tpa_query_enrichment": {
        const term = args?.terms || "pathways";
        return `Querying functional enrichment results (${term}) ...`;
      }
      case "tpa_compile_summary": {
        const tgt = args?.target_gene ? ` for target ${args.target_gene}` : "";
        return `Compiling primary observations summary and exporting code/06_observations.R${tgt} ...`;
      }
      case "tpa_batch_analysis": {
        const type = args?.type || "analysis";
        return `Running batch ${type} pipeline ...`;
      }
      case "tpa_plot": {
        const type = String(args?.type || "diagnostic").toLowerCase();
        if (type.includes("volcano")) return "Plotting expression volcano ...";
        if (type.includes("pca")) return "Plotting PCA dimensionality ...";
        return `Plotting ${type} visualization ...`;
      }
      case "tpa_export_table": {
        const fn = args?.file_name || "table.csv";
        return `Exporting analysis table to \`${fn}\` ...`;
      }
      case "tpa_export_state": {
        return "Exporting reproducible R script and persisting data checkpoint ...";
      }
      case "tpa_extract": {
        return `Extracting ${args?.values || "data values"} from analysis state ...`;
      }
      case "tpa_operations": {
        return "Auditing upstream transformations & operations history ...";
      }
      case "tpa_reassign": {
        const target = args?.target || "sample";
        const count = args?.mapping ? `${Object.keys(args.mapping).length} samples` : args?.replace || "conditions";
        return `Reassigning ${target} groups (${count}) ...`;
      }
      case "tpa_health": {
        return "Verifying MCP server connectivity and runtime health ...";
      }
      case "read_file": {
        const fp = path.basename(String(args?.filePath || "file"));
        if (/result|output|summary|enrichment|expression|diff|quant|stat/i.test(fp)) {
          return `Reading results from \`${fp}\` ...`;
        }
        if (/sample|metadata|design/i.test(fp)) {
          return `Examining sample table \`${fp}\` ...`;
        }
        return `Reading results from \`${fp}\` ...`;
      }
      case "write_file": {
        const fp = path.basename(String(args?.filePath || "file"));
        return `Writing \`${fp}\` ...`;
      }
      case "replace_file_content": {
        const fp = path.basename(String(args?.filePath || "file"));
        return `Updating \`${fp}\` ...`;
      }
      case "execute_command": {
        const cmd = String(args?.command || "").trim();
        if (/Rscript|\.R\b/i.test(cmd)) {
          return "Running R code ...";
        }
        const shortCmd = cmd.length > 50 ? cmd.slice(0, 47) + "..." : cmd;
        return `Running command: \`${shortCmd}\` ...`;
      }
      case "check_checkpoint_gate": {
        return "Verifying quality gates and checkpoint outputs ...";
      }
      case "complete_phase": {
        return "Finalizing phase and recording findings ...";
      }
      case "fail_phase": {
        return "Evaluating phase failure checkpoint ...";
      }
      default: {
        const clean = name.replace(/^tpa_/, "").replace(/_/g, " ");
        return `Executing ${clean} ...`;
      }
    }
  }

  private extractToolObservation(
    name: string,
    args: Record<string, any>,
    result: string
  ): { text: string; badge: string } | null {
    if (!result || typeof result !== "string") return null;
    const res = result.trim();

    if (name === "tpa_load" || (name === "tpa_inspect" && args?.what === "overview")) {
      const sampleMatch = res.match(/(?:samples?|files?)\s*[:=]\s*(\d+)/i) || res.match(/(\d+)\s+samples?/i);
      const proteinMatch = res.match(/(?:proteins?|peptides?|features?)\s*[:=]\s*([\d,]+)/i) || res.match(/([\d,]+)\s+proteins?/i);
      const missingMatch = res.match(/(?:missing(?:ness)?)\s*[:=]\s*([\d\.]+)%/i) || res.match(/([\d\.]+)%\s+missing/i);
      if (sampleMatch || proteinMatch) {
        const parts: string[] = [];
        if (sampleMatch) parts.push(`**${sampleMatch[1]}** samples`);
        if (proteinMatch) parts.push(`**${proteinMatch[1]}** quantified features`);
        if (missingMatch) parts.push(`**${missingMatch[1]}%** missingness`);
        return {
          text: `Dataset topology confirmed: identified ${parts.join(", ")}.`,
          badge: "Topology",
        };
      }
    }

    if (name === "tpa_normalize" || name === "tpa_select_normalization") {
      const cvMatch = res.match(/cv\s*[:=]?\s*([\d\.]+)/i);
      const method = args?.method || (Array.isArray(args?.methods) ? args.methods[0] : args?.methods) || "optimal";
      return {
        text: `Benchmarked normalization candidates. Selected **${method}** normalization${cvMatch ? ` (CV: ${cvMatch[1]})` : ""}.`,
        badge: "Normalization",
      };
    }

    if (name === "tpa_reassign") {
      const reasMatch = res.match(/n_reassigned=(\d+),\s*n_changed=(\d+),\s*n_total=(\d+)/i);
      if (reasMatch) {
        return {
          text: `Reassigned sample groups (${reasMatch[1]} of ${reasMatch[3]} samples mapped; ${reasMatch[2]} changed).`,
          badge: "Pooling",
        };
      }
      return null;
    }

    if (name === "tpa_impute") {
      const schemaMatch = res.match(/\[IMPUTE_SCHEMA:\s*(\{[^\n\r\]]+\})\]/i);
      if (schemaMatch) {
        try {
          const parsed = JSON.parse(schemaMatch[1]);
          const method = parsed.canonical_method || parsed.method || args?.method || args?.algorithm || "configured";
          const nImputed = parsed.n_imputed ?? 0;
          const nObserved = parsed.n_observed ?? 0;
          const nMissing = parsed.n_missing ?? 0;
          const pctPost = parsed.pct_missing_post ?? parsed.pct_missing ?? 0;
          const scope = parsed.scope || "post_impute";
          return {
            text: `Completed missing value imputation using **${method}** strategy (imputed: ${nImputed}, observed: ${nObserved}, missing: ${nMissing}, missingness: ${pctPost}% [scope=${scope}]).`,
            badge: "Imputation",
          };
        } catch {
          // fallback below
        }
      }
      const auditMatch = res.match(/n_imputed\s*=\s*(\d+)\s*\|\s*n_observed\s*=\s*(\d+)\s*\|\s*n_missing\s*=\s*(\d+)\s*\|\s*pct_missing_pre\s*=\s*([\d.]+)%?\s*->\s*pct_missing_post\s*=\s*([\d.]+)%?/i);
      const method = args?.method || args?.algorithm || "configured";
      if (auditMatch) {
        return {
          text: `Completed missing value imputation using **${method}** strategy (imputed: ${auditMatch[1]}, observed: ${auditMatch[2]}, missing: ${auditMatch[3]}, missingness: ${auditMatch[5]}% [scope=post_impute]).`,
          badge: "Imputation",
        };
      }
      return {
        text: `Completed missing value imputation using **${method}** strategy.`,
        badge: "Imputation",
      };
    }

    if (name === "tpa_expression") {
      const sigMatch = res.match(/(\d+)\s*(?:significant|differentially expressed)/i);
      const comp = args?.comparison || args?.contrast || "designated comparison";
      return {
        text: `Differential expression testing complete for \`${comp}\`${sigMatch ? `: detected **${sigMatch[1]}** significant proteins` : ""}.`,
        badge: "Expression",
      };
    }

    if (name === "tpa_enrichment") {
      const term = args?.term || args?.terms || "pathways";
      return {
        text: `Pathway enrichment analysis completed for \`${term}\` ontologies.`,
        badge: "Enrichment",
      };
    }

    if (name === "tpa_batch_analysis") {
      const type = args?.type || "analysis";
      return {
        text: `Completed automated batch ${type} processing across all active contrasts and terms.`,
        badge: "Batch Analysis",
      };
    }

    return null;
  }

  public getIsRunning(): boolean {
    return this.isRunning || this.isStopping;
  }

  public isBusy(): boolean {
    return this.isRunning || this.isStopping;
  }

  public getIsFullPipelineRunning(): boolean {
    return this.isFullPipelineRunning;
  }

  public async setWorkingDirectory(newRoot: string): Promise<void> {
    if (this.isRunning) {
      this.logPipeline("Cannot change working directory while a pipeline or phase is actively running.");
      return;
    }
    this.workspaceRoot = newRoot || "";
    this.auxiliaryTokens = {};
    this.tools.setWorkspaceRoot(this.workspaceRoot);
    this.chatLogger.setWorkspaceRoot(this.workspaceRoot);
    try {
      if (this.tools.hasTool("tpa_set_workspace")) {
        await this.tools.execute("tpa_set_workspace", { workspace: this.workspaceRoot, reset: true });
      }
    } catch (_) { }
    try {
      await this.rescanPhases(true);
    } catch (err) {
      console.error("[PipelineOrchestrator] Error rescanning phases on directory change:", err);
    }
  }

  public getWorkingDirectory(): string {
    return this.workspaceRoot;
  }

  private async loadAuxiliaryTokens(): Promise<void> {
    if (!this.workspaceRoot) return;
    try {
      const auxPath = path.join(this.workspaceRoot, "logs", "auxiliary_tokens.json");
      if (fsSync.existsSync(auxPath)) {
        const raw = await fs.readFile(auxPath, "utf-8");
        const parsed = JSON.parse(raw);
        if (parsed && typeof parsed === "object") {
          this.auxiliaryTokens = parsed;
        }
      }
    } catch (_) { }
  }

  private async saveAuxiliaryTokens(): Promise<void> {
    if (!this.workspaceRoot) return;
    try {
      const logsDir = path.join(this.workspaceRoot, "logs");
      if (!fsSync.existsSync(logsDir)) {
        await fs.mkdir(logsDir, { recursive: true });
      }
      const auxPath = path.join(logsDir, "auxiliary_tokens.json");
      await fs.writeFile(auxPath, JSON.stringify(this.auxiliaryTokens, null, 2), "utf-8");
    } catch (_) { }
  }

  public recordAuxiliaryUsage(role: LLMRole, model: string, provider: string, usage?: TokenUsage): void {
    if (!usage || !usage.totalTokens) return;
    const key = `${role}:${model}`;
    if (!this.auxiliaryTokens[key]) {
      this.auxiliaryTokens[key] = {
        model,
        role,
        provider,
        usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0, cachedPromptTokens: 0 },
      };
    }
    const target = this.auxiliaryTokens[key].usage;
    target.promptTokens += usage.promptTokens || 0;
    target.completionTokens += usage.completionTokens || 0;
    target.totalTokens += usage.totalTokens || 0;
    target.cachedPromptTokens = (target.cachedPromptTokens || 0) + (usage.cachedPromptTokens || 0);

    this.saveAuxiliaryTokens().catch(() => { });
    this.notifyState().catch(() => { });
  }

  /**
   * Dynamically inspects the workspace directory for analysis/*.md phases and agent/INSTRUCT.md
   */
  private async loadNotesRecords(): Promise<
    Map<
      string,
      {
        status: PhaseStatus;
        durationSeconds?: number;
        turnCount?: number;
        tokenUsage?: TokenUsage;
        summary?: string;
        startTime?: string;
        endTime?: string;
        model?: string;
        role?: LLMRole;
        provider?: string;
      }
    >
  > {
    const map = new Map();
    if (!this.workspaceRoot) return map;

    try {
      const notesPath = path.join(this.workspaceRoot, "docs", "notes.md");
      const content = await fs.readFile(notesPath, "utf-8");
      const sections = content.split(/\n(?=###\s+)/);

      for (const section of sections) {
        const fileMatch = section.match(/- \*\*File\*\*:\s*`([^`]+)`/);
        if (!fileMatch) continue;
        const rawFileName = fileMatch[1].trim();

        const durationMatch = section.match(/- \*\*Duration\*\*:\s*(\d+)s/);
        const durationSeconds = durationMatch ? parseInt(durationMatch[1], 10) : undefined;

        const turnsMatch = section.match(/- \*\*Turns\*\*:\s*(\d+)/i);
        let turnCount = turnsMatch ? parseInt(turnsMatch[1], 10) : undefined;

        const startMatch = section.match(/- \*\*Start\*\*:\s*([^\n\r]+)/);
        const startTime = startMatch ? startMatch[1].trim() : undefined;

        const endMatch = section.match(/- \*\*End\*\*:\s*([^\n\r]+)/);
        const endTime = endMatch ? endMatch[1].trim() : undefined;

        const modelMatch = section.match(/- \*\*Model\*\*:\s*`([^`]+)`(?:\s*\(`([^`]+)`(?:\s*\|\s*`([^`]+)`)?\))?/i);
        const model = modelMatch ? modelMatch[1].trim() : undefined;
        const role = modelMatch && modelMatch[2] ? (modelMatch[2].trim() as LLMRole) : undefined;
        const provider = modelMatch && modelMatch[3] ? modelMatch[3].trim() : undefined;

        const tokenMatch = section.match(
          /- \*\*Token Usage\*\*:\s*Total:\s*(\d+|N\/A),\s*Prompt:\s*(\d+|N\/A),\s*Completion:\s*(\d+|N\/A)(?:,\s*Cached:\s*(\d+|N\/A))?/i
        );
        let tokenUsage: TokenUsage | undefined;
        if (tokenMatch) {
          const totalTokens = tokenMatch[1] !== "N/A" ? parseInt(tokenMatch[1], 10) : 0;
          const promptTokens = tokenMatch[2] !== "N/A" ? parseInt(tokenMatch[2], 10) : 0;
          const completionTokens = tokenMatch[3] !== "N/A" ? parseInt(tokenMatch[3], 10) : 0;
          const cachedPromptTokens = tokenMatch[4] && tokenMatch[4] !== "N/A" ? parseInt(tokenMatch[4], 10) : 0;
          tokenUsage = { totalTokens, promptTokens, completionTokens, cachedPromptTokens };
        }

        const isCompleted = section.includes("- COMPLETED");
        const isBlocked = section.includes("- BLOCKED");
        const isFailed = section.includes("- FAILED");
        const status: PhaseStatus = isBlocked ? "awaiting_hitl" : isFailed ? "failed" : isCompleted ? "completed" : "pending";

        const summaryMatch = section.match(/\*\*Summary\*\*:\s*\n([\s\S]*?)(?:\n---|\n###|$)/);
        const summary = summaryMatch ? summaryMatch[1].trim() : undefined;

        // If turnCount wasn't recorded in notes.md yet, check logs/<phase>/chat.md
        if (turnCount === undefined) {
          const phaseSlug = path.basename(rawFileName).replace(/\.md$/i, "").toLowerCase();
          const chatLogPath = path.join(this.workspaceRoot, "logs", phaseSlug, "chat.md");
          if (fsSync.existsSync(chatLogPath)) {
            try {
              const chatContent = fsSync.readFileSync(chatLogPath, "utf-8");
              const allTurnMatches = [...chatContent.matchAll(/\*\*Total Turns\*\*:\s*(\d+)/gi)];
              if (allTurnMatches.length > 0) {
                turnCount = parseInt(allTurnMatches[allTurnMatches.length - 1][1], 10);
              } else {
                const turnHeaderMatches = [...chatContent.matchAll(/####\s+Turn\s+(\d+)/gi)];
                if (turnHeaderMatches.length > 0) {
                  turnCount = parseInt(turnHeaderMatches[turnHeaderMatches.length - 1][1], 10);
                }
              }
            } catch (_) { }
          }
        }

        const record = { status, durationSeconds, turnCount, tokenUsage, summary, startTime, endTime, model, role, provider };
        map.set(rawFileName, record);
        const base = path.basename(rawFileName);
        if (!map.has(base)) {
          map.set(base, record);
        }
      }
    } catch {
      // notes.md not available or readable
    }

    // Secondary fallback: scan logs/pipeline.md master table
    // If docs/notes.md was overwritten or is missing a phase entry, restore telemetry and status from pipeline.md
    try {
      const pipelineLogPath = path.join(this.workspaceRoot, "logs", "pipeline.md");
      const pipelineContent = await fs.readFile(pipelineLogPath, "utf-8");
      const lines = pipelineContent.split("\n");
      for (const line of lines) {
        const match = line.match(
          /\|\s*([✓❌⏳\?🛑])\s*\*\*([^\*]+)\*\*\s*\|\s*([^\|]+)\|\s*([A-Za-z0-9_:\s\.\-\[\]]+?)\s*\|\s*(\d+)s\s*\|\s*([\d,]+)\s*\|/i
        );
        if (match) {
          const rawTag = match[2].trim().toLowerCase();
          const statusCol = match[4].trim().toUpperCase();
          const status: PhaseStatus = statusCol.startsWith("BLOCKED")
            ? "awaiting_hitl"
            : statusCol.startsWith("COMPLETED")
            ? "completed"
            : statusCol.startsWith("FAILED")
            ? "failed"
            : "pending";
          const durationSeconds = parseInt(match[5], 10);
          const totalTokens = parseInt(match[6].replace(/,/g, ""), 10);

          const record = {
            status,
            durationSeconds,
            tokenUsage: { totalTokens, promptTokens: 0, completionTokens: 0, cachedPromptTokens: 0 },
            summary: undefined,
          };

          const existing = map.get(rawTag) || map.get(`${rawTag.toUpperCase()}.md`);
          if (!existing || (existing.status !== "completed" && status === "completed")) {
            map.set(rawTag, record);
            map.set(`${rawTag.toUpperCase()}.md`, record);
            map.set(`${rawTag}.md`, record);
          }
        }
      }
    } catch {
      // logs/pipeline.md not available or readable
    }

    return map;
  }

  public async forceReloadFromDisk(): Promise<void> {
    if (this.isRunning) {
      this.logPipeline("Cannot force reload while an active pipeline run is in flight.");
      return;
    }
    await this.rescanPhases(true);
    this.logPipeline("Reloaded all tasks and progress from disk.");
  }

  public async resetAllState(): Promise<void> {
    if (this.isRunning) {
      this.logPipeline("Cannot reset state while an active run is in flight.");
      return;
    }
    this.auxiliaryTokens = {};
    if (this.workspaceRoot) {
      try {
        const auxPath = path.join(this.workspaceRoot, "logs", "auxiliary_tokens.json");
        if (fsSync.existsSync(auxPath)) {
          await fs.unlink(auxPath);
        }
      } catch (_) { }
    }
    const notesPath = path.join(this.workspaceRoot, "docs", "notes.md");
    try {
      const header = `# Autonomous Proteomics Analysis Notes\nModel: ${this.client.getConfig().model}\n\n`;
      await fs.writeFile(notesPath, header, "utf-8");
    } catch {
      // ignore
    }
    for (const p of this.phases) {
      p.status = "pending";
      p.startTime = undefined;
      p.endTime = undefined;
      p.durationSeconds = undefined;
      p.tokenUsage = undefined;
      p.summary = undefined;
      p.error = undefined;
    }
    await this.rescanPhases(true);
    this.logPipeline("State and runtime blackboard reset to initial state.");
  }

  public resolvePhaseRole(id: string, fileName: string): LLMRole {
    const fn = (fileName || "").toLowerCase();
    const cleanId = (id || "").toLowerCase();

    // Tier 3: Frontier Scientific Reasoner (Internal biomedical hypothesis generation & final synthesis)
    const isReasoning =
      ["07", "11", "12", "13"].includes(cleanId) ||
      cleanId.startsWith("07") ||
      cleanId.startsWith("11") ||
      cleanId.startsWith("12") ||
      cleanId.startsWith("13") ||
      fn.includes("knowledge") ||
      fn.includes("synthesis") ||
      fn.includes("manuscript") ||
      fn.includes("integrity") ||
      fn.includes("critique");
    if (isReasoning) return "reasoner";

    // Tier 1: Fast Utility & Ingestion for mechanical inspection, normalization & imputation
    const isUtility =
      ["01", "02", "03"].includes(cleanId) ||
      cleanId.startsWith("01") ||
      cleanId.startsWith("02") ||
      cleanId.startsWith("03") ||
      fn.includes("inspect") ||
      fn.includes("normalize") ||
      fn.includes("impute");
    if (isUtility) return "utility";

    // Tier 2: Tool Runner & Code Orchestrator for complex data analytics, web search & literature DB query
    return "toolRunner";
  }

  public async rescanPhases(forceReload = false): Promise<void> {
    if (this.isRunning) {
      // Never clobber phases or state while an active run is in flight
      return;
    }

    if (!this.workspaceRoot) {
      this.phases = [];
      await this.notifyState();
      return;
    }

    const notesRecords = await this.loadNotesRecords();
    await this.loadAuxiliaryTokens();
    const existingMap = forceReload ? new Map() : new Map(this.phases.map((p) => [p.fileName, p]));
    const enabledMap = new Map(this.phases.map((p) => [p.fileName, p.enabled]));
    const newPhases: PhaseInfo[] = [];

    // Scan analysis/ directory for markdown phases
    const analysisDir = path.join(this.workspaceRoot, "analysis");

    try {
      const files = await fs.readdir(analysisDir);
      const mdFiles = files.filter((f) => f.endsWith(".md")).sort();

      for (let i = 0; i < mdFiles.length; i++) {
        const fileName = mdFiles[i];

        const prev = existingMap.get(fileName);
        const noteRec =
          notesRecords.get(fileName) ||
          notesRecords.get(path.basename(fileName)) ||
          notesRecords.get(fileName.replace(/\.md$/i, "").toLowerCase());

        let title = prev?.title;
        if (!title) {
          try {
            const content = await fs.readFile(path.join(analysisDir, fileName), "utf-8");
            const firstHeader = content.split("\n").find((l) => l.trim().startsWith("#"));
            if (firstHeader) {
              title = firstHeader.replace(/^#+\s*/, "").trim();
            }
          } catch {
            // fallback
          }
          if (!title) {
            title = fileName.replace(/^[0-9]+[a-zA-Z]?_/, "").replace(/\.md$/, "").replace(/_/g, " ");
            title = `Phase: ${title}`;
          }
        }

        const id = fileName.match(/^([0-9]+[a-zA-Z]?)/)?.[1] || fileName.match(/^([0-9]+)/)?.[1] || String(i + 1).padStart(2, "0");
        const isMaster = fileName.startsWith("00_");

        let resolvedStatus: PhaseStatus = "pending";
        if (prev?.status && prev.status !== "running") {
          resolvedStatus = prev.status;
        } else if (noteRec?.status) {
          resolvedStatus = noteRec.status;
        }

        const isEnabled = enabledMap.has(fileName) ? enabledMap.get(fileName)! : (prev ? prev.enabled : true);
        const summaryText = prev?.summary || noteRec?.summary;

        const defaultRole: LLMRole = this.resolvePhaseRole(id, fileName);
        const { client: phaseClient, source: modelSource } = this.client.forPhase(id, fileName, defaultRole);
        const phaseCfg = phaseClient.getConfig();

        const isCompleted = resolvedStatus === "completed";
        const phaseModel = isCompleted ? (prev?.model || noteRec?.model || phaseCfg.model) : phaseCfg.model;
        const phaseRole = isCompleted ? (prev?.role || noteRec?.role || defaultRole) : defaultRole;
        const phaseProvider = isCompleted ? (prev?.provider || noteRec?.provider || phaseCfg.provider) : phaseCfg.provider;
        const phaseModelSource = isCompleted ? (prev?.modelSource || modelSource) : modelSource;

        const baseMaxTurns = configStore.get("maxTurns") || 30;
        const configuredPhaseTurns = configStore.get("phaseMaxTurns") || {};
        const tagLower = path.basename(fileName).replace(/\.md$/i, "").toLowerCase();
        let phaseMaxTurns = configuredPhaseTurns[id] || configuredPhaseTurns[tagLower] || baseMaxTurns;
        if (!configuredPhaseTurns[id] && !configuredPhaseTurns[tagLower]) {
          if (tagLower.includes("inspect")) {
            phaseMaxTurns = Math.max(baseMaxTurns, 40);
          } else if (tagLower.includes("synthesize") || tagLower.includes("synthesis")) {
            phaseMaxTurns = Math.max(baseMaxTurns, 45);
          } else if (tagLower.includes("normalize")) {
            phaseMaxTurns = Math.max(baseMaxTurns, 30);
          }
        }
        const canContinue = resolvedStatus === "failed";

        newPhases.push({
          id,
          fileName,
          title,
          status: resolvedStatus,
          enabled: isEnabled,
          isMasterSetup: isMaster,
          startTime: prev?.startTime || noteRec?.startTime,
          endTime: prev?.endTime || noteRec?.endTime,
          durationSeconds: prev?.durationSeconds || noteRec?.durationSeconds,
          turnCount: prev?.turnCount ?? noteRec?.turnCount,
          maxTurns: prev?.maxTurns || phaseMaxTurns,
          canContinue: prev?.canContinue ?? canContinue,
          tokenUsage: prev?.tokenUsage || noteRec?.tokenUsage,
          summary: summaryText,
          error: prev?.error || (resolvedStatus === "failed" ? noteRec?.summary : undefined),
          associatedFiles: this.resolveAssociatedFiles(fileName, id, summaryText),
          model: phaseModel,
          role: phaseRole,
          provider: phaseProvider,
          modelSource: phaseModelSource,
        });
      }
    } catch (e) {
      this.logPipeline(`Note: 'analysis' directory not found in ${this.workspaceRoot}`);
    }

    this.phases = newPhases;
    await this.notifyState();
  }

  public async getPromptFiles(): Promise<PromptFileInfo[]> {
    let agentDir = "agent";
    try {
      await fs.stat(path.join(this.workspaceRoot, "agent"));
    } catch {
      agentDir = "prompts";
    }

    const list: { name: string; relPath: string }[] = [
      { name: "Analysis Protocol", relPath: `${agentDir}/PROTOCOL.md` },
      { name: "Experiment & Dataset Spec", relPath: "docs/experiment.md" },
      { name: "Shared Memory", relPath: "docs/notes.md" },
      { name: "Active Model Summary", relPath: "docs/llm.md" },
      { name: "Pipeline Summary", relPath: "logs/pipeline.md" }
    ];

    // Discover per-phase chat.md and console.log files
    try {
      const logsDir = path.join(this.workspaceRoot, "logs");
      const entries = await fs.readdir(logsDir, { withFileTypes: true });
      for (const ent of entries) {
        if (ent.isDirectory()) {
          const phaseDir = ent.name;
          const chatRel = `logs/${phaseDir}/chat.md`;
          const consoleRel = `logs/${phaseDir}/console.log`;
          list.push({ name: `${phaseDir} Chat Trace`, relPath: chatRel });
          list.push({ name: `${phaseDir} Console Log`, relPath: consoleRel });
        }
      }
    } catch { }

    // Backward-compatibility: if legacy logs/llm_chat.md exists
    try {
      await fs.stat(path.join(this.workspaceRoot, "logs/llm_chat.md"));
      list.push({ name: "Legacy LLM Chat Log", relPath: "logs/llm_chat.md" });
    } catch { }

    // If optional BIOLOGY.md exists, include it
    try {
      await fs.stat(path.join(this.workspaceRoot, `${agentDir}/BIOLOGY.md`));
      list.splice(1, 0, { name: "Curated Biological Context", relPath: `${agentDir}/BIOLOGY.md` });
    } catch { }

    // If legacy VARIABLES.md exists, include it
    try {
      await fs.stat(path.join(this.workspaceRoot, `${agentDir}/VARIABLES.md`));
      list.splice(1, 0, { name: "Legacy Dataset Variables", relPath: `${agentDir}/VARIABLES.md` });
    } catch { }

    const result: PromptFileInfo[] = [];
    for (const item of list) {
      let exists = false;
      try {
        await fs.stat(path.join(this.workspaceRoot, item.relPath));
        exists = true;
      } catch {
        exists = false;
      }
      result.push({ ...item, exists });
    }
    return result;
  }

  public getPhases(): PhaseInfo[] {
    return [...this.phases];
  }

  public togglePhase(phaseId: string, enabled: boolean) {
    const phase = this.phases.find((p) => p.id === phaseId);
    if (phase) {
      phase.enabled = enabled;
      this.notifyState();
    }
  }

  public async addPhase(fileName: string, title?: string): Promise<string> {
    const cleanFileName = fileName.endsWith(".md") ? fileName : `${fileName}.md`;
    const analysisDir = path.join(this.workspaceRoot, "analysis");
    await fs.mkdir(analysisDir, { recursive: true });

    const fullPath = path.join(analysisDir, cleanFileName);
    const defaultTitle = title || cleanFileName.replace(/\.md$/, "").replace(/_/g, " ");

    const template = `### Phase: ${defaultTitle}
Construct and execute code for this phase, capturing output to logs.

#### Tasks:
- [ ] Task 1: Initialize step.
- [ ] Task 2: Execute analysis in R or shell.
- [ ] Checkpoint: Verify outputs and log files.
`;
    await fs.writeFile(fullPath, template, "utf-8");
    await this.rescanPhases();
    return fullPath;
  }

  public async removePhase(phaseId: string): Promise<void> {
    const idx = this.phases.findIndex((p) => p.id === phaseId);
    if (idx !== -1) {
      const phase = this.phases[idx];
      if (!phase.isMasterSetup) {
        try {
          await fs.unlink(path.join(this.workspaceRoot, "analysis", phase.fileName));
        } catch {
          // ignore if already deleted
        }
      }
      this.phases.splice(idx, 1);
      await this.notifyState();
    }
  }

  public async getFoldersStatus(): Promise<FolderStatus[]> {
    let agentFolder = "agent";
    try {
      await fs.stat(path.join(this.workspaceRoot, "agent"));
    } catch {
      agentFolder = "prompts";
    }

    const list = [
      { name: "analysis", relPath: "analysis", description: "Phase Prompts (01_INSPECT.md .. 13_CRITIQUE.md)" },
      { name: agentFolder, relPath: agentFolder, description: "Protocol, Variables & Skills (Cached Prefix)" },
      { name: "code", relPath: "code", description: "Generated Analysis Scripts" },
      { name: "tools", relPath: "tools", description: "Linter & Execution Helper Utilities" },
      { name: "docs", relPath: "docs", description: "Shared Memory (notes.md, llm.md) & Experiment Design" },
      { name: "logs", relPath: "logs", description: "Phase Chat Traces & Console Logs (logs/<phase>/)" },
      { name: "data", relPath: "data", description: "Raw Input Proteomics Data" },
    ];

    const result: FolderStatus[] = [];
    if (!this.workspaceRoot) return result;

    for (const item of list) {
      const full = path.join(this.workspaceRoot, item.relPath);
      let exists = false;
      let itemCount = 0;
      try {
        const stat = await fs.stat(full);
        if (stat.isDirectory()) {
          exists = true;
          const files = await fs.readdir(full);
          itemCount = files.filter((f) => !f.startsWith(".")).length;
        }
      } catch {
        exists = false;
      }
      result.push({ ...item, exists, itemCount });
    }
    return result;
  }

  public async getState(): Promise<PipelineState> {
    const config = this.client.getConfig();
    let totalPrompt = 0;
    let totalCompletion = 0;
    let totalTokens = 0;
    let totalCached = 0;

    const tierTokens: Partial<Record<LLMRole, TokenUsage>> = {
      utility: { promptTokens: 0, completionTokens: 0, totalTokens: 0, cachedPromptTokens: 0 },
      toolRunner: { promptTokens: 0, completionTokens: 0, totalTokens: 0, cachedPromptTokens: 0 },
      reasoner: { promptTokens: 0, completionTokens: 0, totalTokens: 0, cachedPromptTokens: 0 },
    };
    const modelTokens: Record<string, ModelTokenUsage> = {};

    for (const p of this.phases) {
      const role: LLMRole = p.role || this.resolvePhaseRole(p.id, p.fileName);
      const { client: clientForPhase } = this.client.forPhase(p.id, p.fileName, role);
      const phaseCfg = clientForPhase.getConfig();
      const modelName = p.model || phaseCfg.model;
      const providerName = p.provider || phaseCfg.provider;

      if (!modelTokens[modelName]) {
        modelTokens[modelName] = {
          model: modelName,
          role,
          provider: providerName,
          usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0, cachedPromptTokens: 0 },
        };
      }

      if (p.tokenUsage) {
        totalPrompt += p.tokenUsage.promptTokens;
        totalCompletion += p.tokenUsage.completionTokens;
        totalTokens += p.tokenUsage.totalTokens;
        totalCached += p.tokenUsage.cachedPromptTokens || 0;

        const tUsage = tierTokens[role]!;
        tUsage.promptTokens += p.tokenUsage.promptTokens;
        tUsage.completionTokens += p.tokenUsage.completionTokens;
        tUsage.totalTokens += p.tokenUsage.totalTokens;
        tUsage.cachedPromptTokens = (tUsage.cachedPromptTokens || 0) + (p.tokenUsage.cachedPromptTokens || 0);

        const mUsage = modelTokens[modelName].usage;
        mUsage.promptTokens += p.tokenUsage.promptTokens;
        mUsage.completionTokens += p.tokenUsage.completionTokens;
        mUsage.totalTokens += p.tokenUsage.totalTokens;
        mUsage.cachedPromptTokens = (mUsage.cachedPromptTokens || 0) + (p.tokenUsage.cachedPromptTokens || 0);
      }
    }

    for (const aux of Object.values(this.auxiliaryTokens)) {
      totalPrompt += aux.usage.promptTokens;
      totalCompletion += aux.usage.completionTokens;
      totalTokens += aux.usage.totalTokens;
      totalCached += aux.usage.cachedPromptTokens || 0;

      const tUsage = aux.role ? tierTokens[aux.role] : undefined;
      if (tUsage) {
        tUsage.promptTokens += aux.usage.promptTokens;
        tUsage.completionTokens += aux.usage.completionTokens;
        tUsage.totalTokens += aux.usage.totalTokens;
        tUsage.cachedPromptTokens = (tUsage.cachedPromptTokens || 0) + (aux.usage.cachedPromptTokens || 0);
      }

      if (!modelTokens[aux.model]) {
        modelTokens[aux.model] = {
          model: aux.model,
          role: aux.role,
          provider: aux.provider,
          usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0, cachedPromptTokens: 0 },
        };
      }
      const mUsage = modelTokens[aux.model].usage;
      mUsage.promptTokens += aux.usage.promptTokens;
      mUsage.completionTokens += aux.usage.completionTokens;
      mUsage.totalTokens += aux.usage.totalTokens;
      mUsage.cachedPromptTokens = (mUsage.cachedPromptTokens || 0) + (aux.usage.cachedPromptTokens || 0);
    }

    const promptFiles = await this.getPromptFiles();
    const folders = await this.getFoldersStatus();

    const analysisFolder = folders.find((f) => f.name === "analysis");
    const isAnalysisMissingOrEmpty =
      !this.workspaceRoot ||
      !analysisFolder ||
      !analysisFolder.exists ||
      (analysisFolder.itemCount || 0) === 0 ||
      this.phases.length === 0;

    return {
      workingDirectory: this.workspaceRoot,
      workspaceName: this.workspaceRoot ? path.basename(this.workspaceRoot) : "No Folder Open",
      model: config.model,
      provider: config.provider,
      startTime: new Date().toISOString(),
      isRunning: this.isRunning || this.isStopping,
      isFullPipelineRunning: this.isFullPipelineRunning,
      currentPhaseIndex: this.phases.findIndex((p) => p.status === "running"),
      phases: this.phases,
      promptFiles,
      folders,
      totalTokens: {
        promptTokens: totalPrompt,
        completionTokens: totalCompletion,
        totalTokens: totalTokens,
        cachedPromptTokens: totalCached,
      },
      tierTokens,
      modelTokens,
      isAnalysisMissingOrEmpty,
      literature: readLiteratureConfig(this.workspaceRoot),
      knowledgeCorpus: readLiteratureConfig(this.workspaceRoot),
    };
  }

  public async notifyState() {
    if (this.suppressNotifications) return;
    try {
      const state = await this.getState();
      this.onStateChange(state);
    } catch (err) {
      console.error("[PipelineOrchestrator] Error in notifyState:", err);
    }
  }

  public async stop(): Promise<void> {
    if (!this.isRunning && !this.isStopping) {
      return;
    }
    this.shouldStop = true;
    this.isStopping = true;
    this.isFullPipelineRunning = false;

    // Immediately abort active run controller & active loop
    if (this.currentRunController) {
      this.currentRunController.abort();
    }
    if (this.activeLoop) {
      this.activeLoop.abort();
    }

    for (const p of this.phases) {
      if (p.status === "running") {
        p.status = "failed";
        p.error = "Stopped by user";
      }
    }
    this.logPipeline("Execution stopping: abort signal dispatched, waiting for active step to exit...");
    await this.notifyState();

    if (this.activeRunPromise) {
      try {
        await this.activeRunPromise;
      } catch {
        // ignore
      }
    }

    this.isRunning = false;
    this.isStopping = false;
    this.shouldStop = false;
    this.currentRunController = undefined;
    this.activeRunPromise = undefined;
    this.activeLoop = undefined;
    this.logPipeline("Execution stopped by user.");
    await this.notifyState();
  }

  /**
   * Prunes records from docs/notes.md for a given phase and all downstream phases.
   * This ensures that restarting a step clears obsolete blackboard context for the LLM.
   */
  public async pruneNotesFromPhase(startIndex: number): Promise<void> {
    if (!this.workspaceRoot) return;
    const targetPhases = this.phases.slice(startIndex);
    if (targetPhases.length === 0) return;

    const filesToRemove = new Set<string>();
    for (const p of targetPhases) {
      if (!p.enabled) continue; // NEVER prune notes for disabled/unchecked completed phases!
      filesToRemove.add(p.fileName);
      filesToRemove.add(path.basename(p.fileName));
      if (p.isMasterSetup) {
        filesToRemove.add("agent/INSTRUCT.md");
        filesToRemove.add("prompts/INSTRUCT.md");
        filesToRemove.add("INSTRUCT.md");
      }
    }

    if (filesToRemove.size === 0) return;

    const notesPath = path.join(this.workspaceRoot, "docs", "notes.md");
    try {
      const content = await fs.readFile(notesPath, "utf-8");
      const sections = content.split(/\n(?=###\s+)/);
      const kept: string[] = [];

      for (const section of sections) {
        const fileMatch = section.match(/- \*\*File\*\*:\s*`([^`]+)`/);
        if (fileMatch) {
          const rawFileName = fileMatch[1].trim();
          const baseName = path.basename(rawFileName);
          if (filesToRemove.has(rawFileName) || filesToRemove.has(baseName)) {
            continue;
          }
        }
        kept.push(section);
      }

      const updated = kept.join("\n").replace(/\n{3,}/g, "\n\n").trim() + "\n";
      await fs.writeFile(notesPath, updated, "utf-8");
    } catch {
      // notes.md may not exist yet
    }
  }

  /**
   * Run a single phase in isolation with automatic cascading reset of downstream phases
   */
  public async runSinglePhase(phaseId: string) {
    if (this.isRunning || this.isStopping) {
      this.logPipeline("Execution busy: A pipeline or phase is already running. Please wait or stop it first.");
      return;
    }
    const phaseIndex = this.phases.findIndex((p) => p.id === phaseId);
    if (phaseIndex === -1) {
      this.logPipeline(`Phase ID '${phaseId}' not found.`);
      return;
    }

    const runController = new AbortController();
    this.currentRunController = runController;
    const runId = Symbol("runId");
    this.activeRunId = runId;

    // Immediately acquire lock before any async awaits
    this.isRunning = true;
    this.isStopping = false;
    this.isFullPipelineRunning = false;
    this.shouldStop = false;

    // Invalidate target phase and all downstream ENABLED phases
    for (let i = phaseIndex; i < this.phases.length; i++) {
      const p = this.phases[i];
      if (i !== phaseIndex && !p.enabled) continue;
      if (i === phaseIndex) {
        p.status = "running";
        p.startTime = new Date().toISOString();
        p.endTime = undefined;
        p.durationSeconds = undefined;
        p.tokenUsage = undefined;
        p.summary = undefined;
        p.error = undefined;
      } else {
        p.status = "pending";
        p.startTime = undefined;
        p.endTime = undefined;
        p.durationSeconds = undefined;
        p.tokenUsage = undefined;
        p.summary = undefined;
        p.error = undefined;
      }
    }

    // Prune blackboard records for this phase and downstream steps
    await this.pruneNotesFromPhase(phaseIndex);

    // Notify UI immediately so downstream tasks visibly clear out to PENDING
    await this.notifyState();

    const runPromise = (async () => {
      try {
        await this.executePhase(phaseIndex, undefined, runController.signal, runId);
      } catch (err: any) {
        this.logPipeline(`Error running phase ${phaseId}: ${err.message}`);
      } finally {
        if (this.activeRunId === runId) {
          this.isRunning = false;
          this.isStopping = false;
          this.isFullPipelineRunning = false;
          this.currentRunController = undefined;
          this.activeRunPromise = undefined;
          this.activeLoop = undefined;
          await this.notifyState();
        }
      }
    })();
    this.activeRunPromise = runPromise;
    await runPromise;
  }

  /**
   * Set custom maximum turn limit for a specific phase
   */
  public setPhaseMaxTurns(phaseId: string, maxTurns: number) {
    const configured = configStore.get("phaseMaxTurns") || {};
    configured[phaseId] = Math.max(1, maxTurns);
    configStore.update({ phaseMaxTurns: configured });
    const p = this.phases.find((ph) => ph.id === phaseId || ph.fileName.includes(phaseId));
    if (p) {
      p.maxTurns = Math.max(1, maxTurns);
      this.notifyState();
    }
  }

  /**
   * Continue a paused, turn-limited, or failed phase with additional turns WITHOUT restarting
   */
  public async continuePhase(phaseId: string, additionalTurns = 10): Promise<boolean> {
    if (this.isRunning || this.isStopping) {
      this.logPipeline("Execution busy: A pipeline or phase is already running. Please wait or stop it first.");
      return false;
    }
    const phaseIndex = this.phases.findIndex((p) => p.id === phaseId || p.fileName.includes(phaseId));
    if (phaseIndex === -1) {
      this.logPipeline(`Phase ID '${phaseId}' not found.`);
      return false;
    }

    const runController = new AbortController();
    this.currentRunController = runController;
    const runId = Symbol("runId");
    this.activeRunId = runId;

    const phase = this.phases[phaseIndex];
    this.isRunning = true;
    this.isStopping = false;
    this.isFullPipelineRunning = false;
    this.shouldStop = false;

    // In continuation, DO NOT prune notes from this phase
    phase.status = "running";
    phase.error = undefined;
    await this.notifyState();

    this.logPipeline(`Continuing Phase ${phase.id} (${phase.title}) with +${additionalTurns} additional turns...`);

    let success = false;
    const runPromise = (async () => {
      try {
        success = await this.executePhase(phaseIndex, additionalTurns, runController.signal, runId);

        // If the continued phase succeeded and wasn't aborted,
        // automatically proceed through the remaining downstream enabled phases
        if (success && !this.shouldStop && !runController.signal.aborted && this.activeRunId === runId) {
          const hasDownstream = this.phases.slice(phaseIndex + 1).some((p) => p.enabled && p.status !== "completed");
          if (hasDownstream) {
            this.isFullPipelineRunning = true;
            this.logPipeline(`Phase ${phase.id} (${phase.title}) completed successfully. Automatically continuing downstream pipeline...`);
            await this.notifyState();

            for (let i = phaseIndex + 1; i < this.phases.length; i++) {
              if (this.shouldStop || runController.signal.aborted || this.activeRunId !== runId) {
                this.logPipeline("Execution stopped by user.");
                break;
              }

              const nextPhase = this.phases[i];
              if (!nextPhase.enabled) {
                this.logPipeline(`Skipping disabled phase: ${nextPhase.title}`);
                continue;
              }

              await this.pruneNotesFromPhase(i);

              const nextSuccess = await this.executePhase(i, undefined, runController.signal, runId);
              if (!nextSuccess || this.shouldStop || runController.signal.aborted || this.activeRunId !== runId) {
                this.logPipeline(`Pipeline paused due to checkpoint failure in ${nextPhase.title}`);
                break;
              }
            }

            if (!this.shouldStop && !runController.signal.aborted && this.activeRunId === runId && this.phases.length > 0 && this.phases.every((p) => !p.enabled || p.status === "completed")) {
              this.logPipeline("All phases completed successfully.");
              if (!this.suppressNotifications) {
                this.onPipelineFinished?.(await this.getState());
              }
            }
          }
        }
      } catch (err: any) {
        this.logPipeline(`Error continuing phase ${phaseId}: ${err.message}`);
      } finally {
        if (this.activeRunId === runId) {
          this.isRunning = false;
          this.isStopping = false;
          this.isFullPipelineRunning = false;
          this.currentRunController = undefined;
          this.activeRunPromise = undefined;
          this.activeLoop = undefined;
          await this.notifyState();
        }
      }
    })();
    this.activeRunPromise = runPromise;
    await runPromise;
    return success;
  }

  /**
   * Intelligently resume execution from the first incomplete/failed phase (or a specified phase),
   * running sequentially through all remaining downstream phases.
   */
  public async resumePipeline(fromPhaseId?: string): Promise<void> {
    if (this.isRunning || this.isStopping) {
      this.logPipeline("Execution busy: A pipeline or phase is already running. Please wait or stop it first.");
      return;
    }
    if (!this.workspaceRoot || this.phases.length === 0) {
      this.logPipeline("No analysis tasks found to execute. Please initialize an analysis pipeline first.");
      return;
    }

    let startIndex = -1;
    if (fromPhaseId) {
      startIndex = this.phases.findIndex((p) => p.id === fromPhaseId || p.fileName.includes(fromPhaseId));
      if (startIndex !== -1 && !this.phases[startIndex].enabled) {
        this.phases[startIndex].enabled = true;
      }
      // Safety check: ensure all upstream enabled phases are completed. If any is pending or failed, start there!
      const firstIncomplete = this.phases.findIndex((p) => p.enabled && p.status !== "completed");
      if (firstIncomplete !== -1 && firstIncomplete < startIndex) {
        this.logPipeline(
          `Upstream task ${this.phases[firstIncomplete].id} (${this.phases[firstIncomplete].title}) is not completed. Running Phase ${this.phases[firstIncomplete].id} before downstream phases.`
        );
        startIndex = firstIncomplete;
      }
    }

    if (startIndex === -1) {
      // Find the first ENABLED phase that is not completed (failed, pending, or running)
      startIndex = this.phases.findIndex((p) => p.enabled && p.status !== "completed");
    }

    if (startIndex === -1) {
      // If all enabled phases are completed, find the first enabled phase to allow re-running
      startIndex = this.phases.findIndex((p) => p.enabled);
    }

    if (startIndex === -1) {
      this.logPipeline("No enabled analysis tasks found to execute. Please enable at least one task in the pipeline list.");
      return;
    }

    const runController = new AbortController();
    this.currentRunController = runController;
    const runId = Symbol("runId");
    this.activeRunId = runId;

    // Immediately acquire lock before any async awaits
    this.isRunning = true;
    this.isStopping = false;
    this.isFullPipelineRunning = true;
    this.shouldStop = false;

    const startPhase = this.phases[startIndex];
    const hasAnyCompleted = this.phases.some((p) => p.status === "completed");
    const resumeVerb = (startIndex === 0 && !hasAnyCompleted) ? "Starting" : "Resuming";
    this.logPipeline(`${resumeVerb} autonomous pipeline at ${new Date().toLocaleTimeString()} from Phase ${startPhase.id} (${startPhase.title})`);
    this.logPipeline(`Working Directory: ${this.workspaceRoot}`);

    // Invalidate target phase and all downstream ENABLED phases so UI shows pending
    for (let i = startIndex; i < this.phases.length; i++) {
      const p = this.phases[i];
      if (!p.enabled) continue; // NEVER invalidate or reset disabled phases!
      p.status = "pending";
      p.startTime = undefined;
      p.endTime = undefined;
      p.durationSeconds = undefined;
      p.tokenUsage = undefined;
      p.summary = undefined;
      p.error = undefined;
    }

    await this.pruneNotesFromPhase(startIndex);
    await this.notifyState();

    const runPromise = (async () => {
      try {
        for (let i = startIndex; i < this.phases.length; i++) {
          if (this.shouldStop || runController.signal.aborted || this.activeRunId !== runId) {
            this.logPipeline("Execution stopped by user.");
            break;
          }

          const phase = this.phases[i];
          if (!phase.enabled) {
            this.logPipeline(`Skipping disabled phase: ${phase.title}`);
            continue;
          }

          await this.pruneNotesFromPhase(i);

          const success = await this.executePhase(i, undefined, runController.signal, runId);
          if (!success || this.shouldStop || runController.signal.aborted || this.activeRunId !== runId) {
            this.logPipeline(`Pipeline paused due to checkpoint failure in ${phase.title}`);
            break;
          }
        }
        if (!this.shouldStop && !runController.signal.aborted && this.activeRunId === runId && this.phases.length > 0 && this.phases.every((p) => !p.enabled || p.status === "completed")) {
          this.logPipeline("All phases completed successfully.");
          if (!this.suppressNotifications) {
            this.onPipelineFinished?.(await this.getState());
          }
        }
      } catch (err: any) {
        this.logPipeline(`Full pipeline error: ${err.message}`);
      } finally {
        if (this.activeRunId === runId) {
          this.isRunning = false;
          this.isStopping = false;
          this.isFullPipelineRunning = false;
          this.shouldStop = false;
          this.currentRunController = undefined;
          this.activeRunPromise = undefined;
          this.activeLoop = undefined;
          await this.notifyState();
        }
      }
    })();
    this.activeRunPromise = runPromise;
    await runPromise;
  }

  /**
   * Force a complete restart of the pipeline from Phase 1
   */
  public async restartPipeline(): Promise<void> {
    return this.runFullPipeline(true);
  }

  /**
   * Run the complete multi-phase pipeline sequentially.
   * If not forced from beginning, automatically resumes from the first incomplete phase.
   */
  public async runFullPipeline(forceFromBeginning = false) {
    if (this.isRunning || this.isStopping) {
      this.logPipeline("Execution busy: A pipeline is already running.");
      return;
    }

    if (!forceFromBeginning) {
      const enabledPhases = this.phases.filter((p) => p.enabled);
      const hasCompleted = this.phases.some((p) => p.status === "completed");
      const hasIncomplete = enabledPhases.some((p) => p.status !== "completed");
      if (hasCompleted || hasIncomplete) {
        return this.resumePipeline();
      }
    }

    if (!this.workspaceRoot || this.phases.length === 0) {
      this.logPipeline("No analysis tasks found to execute. Please initialize an analysis pipeline first.");
      return;
    }

    const runController = new AbortController();
    this.currentRunController = runController;
    const runId = Symbol("runId");
    this.activeRunId = runId;

    // Immediately acquire lock before any async awaits
    this.isRunning = true;
    this.isStopping = false;
    this.isFullPipelineRunning = true;
    this.shouldStop = false;

    // If forcing restart from beginning, reset all enabled phases to pending
    for (const p of this.phases) {
      if (!p.enabled) continue;
      p.status = "pending";
      p.startTime = undefined;
      p.endTime = undefined;
      p.durationSeconds = undefined;
      p.tokenUsage = undefined;
      p.summary = undefined;
      p.error = undefined;
    }
    await this.notifyState();

    this.logPipeline(`Starting autonomous run at ${new Date().toLocaleTimeString()}`);
    this.logPipeline(`Working Directory: ${this.workspaceRoot}`);

    const runPromise = (async () => {
      try {
        for (let i = 0; i < this.phases.length; i++) {
          if (this.shouldStop || runController.signal.aborted || this.activeRunId !== runId) {
            this.logPipeline("Execution stopped by user.");
            break;
          }

          const phase = this.phases[i];
          if (!phase.enabled) {
            this.logPipeline(`Skipping disabled phase: ${phase.title}`);
            continue;
          }

          // Prune any existing note for phase i before executing it
          await this.pruneNotesFromPhase(i);

          const success = await this.executePhase(i, undefined, runController.signal, runId);
          if (!success || this.shouldStop || runController.signal.aborted || this.activeRunId !== runId) {
            this.logPipeline(`Pipeline paused due to checkpoint failure in ${phase.title}`);
            break;
          }
        }
        if (!this.shouldStop && !runController.signal.aborted && this.activeRunId === runId && this.phases.length > 0 && this.phases.every((p) => !p.enabled || p.status === "completed")) {
          this.logPipeline("All phases completed successfully.");
          if (!this.suppressNotifications) {
            this.onPipelineFinished?.(await this.getState());
          }
        }
      } catch (err: any) {
        this.logPipeline(`Full pipeline error: ${err.message}`);
      } finally {
        if (this.activeRunId === runId) {
          this.isRunning = false;
          this.isStopping = false;
          this.isFullPipelineRunning = false;
          this.shouldStop = false;
          this.currentRunController = undefined;
          this.activeRunPromise = undefined;
          this.activeLoop = undefined;
          await this.notifyState();
        }
      }
    })();
    this.activeRunPromise = runPromise;
    await runPromise;
  }

  private async executePhase(
    index: number,
    continuationTurns?: number,
    abortSignal?: AbortSignal,
    runId?: symbol
  ): Promise<boolean> {
    if (this.shouldStop || abortSignal?.aborted || (runId && this.activeRunId !== runId)) {
      return false;
    }
    const targetId = this.phases[index]?.id;
    const getActivePhase = (): PhaseInfo => {
      if (targetId) {
        const found = this.phases.find((p) => p.id === targetId);
        if (found) return found;
      }
      return this.phases[index];
    };

    const phase = getActivePhase();
    if (!phase) return false;

    const normPhase = path.basename(phase.fileName).replace(/\.md$/i, "").toLowerCase();
    const phaseTagUpper = path.basename(phase.fileName).replace(/\.md$/i, "").toUpperCase();
    const phaseTag = phaseTagUpper;
    const cleanTitle = (phase.title || "").replace(/^Phase\s+\d+:\s*/i, "").trim();

    // Guard: Do not allow Phase 2+ to execute if Phase 1 failed or was blocked
    const phase1 = this.phases.find((p) => p.id === "01" || p.fileName.includes("01_inspect"));
    if (phase1 && phase.id !== "00" && phase.id !== "01" && phase1.status !== "completed") {
      const p1Status = (phase1.status || "pending").toUpperCase();
      this.logPhase(phaseTag, `🛑 Pre-flight Gate Enforced: Cannot execute ${cleanTitle} while Phase 01 status is ${p1Status}. Complete Phase 01 study design first.`);
      phase.status = "failed";
      phase.error = `Phase 01 status is ${p1Status}. Human authorization / design completion required before Phase 02.`;
      await this.appendPhaseRecordToNotes(phase);
      await this.notifyState();
      return false;
    }

    // Guard: Cap integrity retries at one (max 2 attempts)
    const prevIntegrityFailures = this.phaseFailureCounts.get(phase.id) || 0;
    if (normPhase.includes("integrity") && prevIntegrityFailures >= 2) {
      this.logPhase(phaseTag, `🛑 Integrity retries capped (already failed ${prevIntegrityFailures} times). Halting pipeline.`);
      phase.status = "failed";
      phase.canContinue = false;
      phase.error = `Phase 12 Integrity retry limit reached (${prevIntegrityFailures} failures). Checkpoint errors logged to docs/notes.md. Halting execution.`;
      await this.appendPhaseRecordToNotes(phase);
      await this.notifyState();
      return false;
    }

    const isContinuing = Boolean(continuationTurns && continuationTurns > 0);
    this.chatLogger.setPhase(phase.fileName);

    phase.status = "running";
    phase.startTime = phase.startTime || new Date().toISOString();
    phase.endTime = undefined;
    phase.error = undefined;
    if (!phase.tokenUsage) {
      phase.tokenUsage = { promptTokens: 0, completionTokens: 0, totalTokens: 0, cachedPromptTokens: 0 };
    }
    const startTimeMs = Date.now();
    await this.notifyState();

    this.onLog(`Phase: ${phaseTagUpper}`);
    if (isContinuing) {
      this.logPhase(phaseTagUpper, `[Continuing] ${cleanTitle} (+${continuationTurns} turns granted)`);
    } else {
      this.logPhase(phaseTagUpper, `[Starting] ${cleanTitle} (${phase.fileName})`);
    }
    if (!this.suppressNotifications) {
      this.onPhaseStarted?.(phase);
    }

    let loop: AgentLoop | undefined;
    try {
      const phaseRole: LLMRole = this.resolvePhaseRole(phase.id, phase.fileName);
      const { client: phaseClient, source: modelSource } = this.client.forPhase(phase.id, phase.fileName, phaseRole);

      const phaseModelCfg = phaseClient.getConfig();
      phase.role = phaseRole;
      phase.model = phaseModelCfg.model;
      phase.provider = phaseModelCfg.provider;
      phase.modelSource = modelSource;

      try {
        const executedPhases = this.phases
          .filter((p) => p.model && (p.status === "completed" || p.id === phase.id))
          .map((p) => ({
            phaseId: p.fileName.replace(/\.md$/i, "").toUpperCase(),
            provider: p.provider || phaseModelCfg.provider,
            model: p.model || phaseModelCfg.model,
          }));
        await writeActiveModelSummaryFile(
          this.workspaceRoot,
          phaseModelCfg,
          this.extensionVersion,
          "mcp",
          {
            activePhaseId: phaseTagUpper,
            executedPhases,
          }
        );
      } catch (err) {
        console.warn("[PipelineOrchestrator] Could not write docs/llm.md before phase execution:", err);
      }

      const contextBuilder = new ContextBuilder(this.workspaceRoot);
      const context = await contextBuilder.buildPhaseContext(phase.fileName);

      let lastToolPendingText = "";
      const roleLabel =
        modelSource === "phase"
          ? `Phase Assignment: ${phaseModelCfg.model}`
          : modelSource === "tier"
            ? (phaseRole === "reasoner"
                ? "Tier 3 (Scientific Reasoner)"
                : phaseRole === "utility"
                  ? "Tier 1 (Fast Utility & Ingestion)"
                  : "Tier 2 (Tool Runner)")
            : "Primary Default";
      this.logPhase(
        phaseTag,
        `Allocated ${roleLabel} (${phaseModelCfg.provider})`
      );

      const baseMaxTurns = configStore.get("maxTurns") || 30;
      const configuredPhaseTurns = configStore.get("phaseMaxTurns") || {};
      const phaseTagLower = phaseTag.toLowerCase();
      let phaseMaxTurns = configuredPhaseTurns[phase.id] || configuredPhaseTurns[phaseTagLower] || baseMaxTurns;

      if (!configuredPhaseTurns[phase.id] && !configuredPhaseTurns[phaseTagLower]) {
        if (phaseTagLower.includes("inspect")) {
          phaseMaxTurns = Math.max(baseMaxTurns, 40);
        } else if (phaseTagLower.includes("synthesize") || phaseTagLower.includes("synthesis")) {
          phaseMaxTurns = Math.max(baseMaxTurns, 45);
        } else if (phaseTagLower.includes("normalize")) {
          phaseMaxTurns = Math.max(baseMaxTurns, 30);
        } else if (phaseTagLower.includes("integrity")) {
          phaseMaxTurns = Math.max(baseMaxTurns, 25);
        }
      }
      phase.maxTurns = phaseMaxTurns;

      let existingState: AgentLoopState | null = null;
      if (isContinuing) {
        existingState = this.phaseLoopStates.get(phase.id) || null;
        if (!existingState) {
          existingState = await AgentLoop.loadCheckpointState(this.workspaceRoot, phase.fileName);
          if (existingState) {
            this.phaseLoopStates.set(phase.id, existingState);
          }
        }
      }

      loop = new AgentLoop(
        phase.fileName,
        phase.title,
        phaseClient,
        this.tools,
        context,
        async (event) => {
          if (event.type === "thought") {
            const raw = String(event.data || "").trim();
            const turnMatch = raw.match(/Starting Turn\s+(\d+)\/(\d+)\.{0,3}/i);
            if (turnMatch) {
              const currentPhase = getActivePhase();
              currentPhase.turnCount = parseInt(turnMatch[1], 10);
              this.logPhase(phaseTag, `Turn ${turnMatch[1]}/${turnMatch[2]} ...`);
              await this.notifyState();
            } else {
              const cleanData = raw.replace(/^[⚠️🔄❌✓💡]\s*/g, "").trim();
              this.logPhase(phaseTag, cleanData);

              const obsMatch = raw.match(/^(?:💡\s*)?(?:Observation|Finding|Key Observation|Discovery):\s*(.+)$/i);
              if (obsMatch) {
                this.onAgentObservation?.(phase, obsMatch[1], { badge: "Observation" });
              }
            }
          } else if (event.type === "text") {
            // Raw context stream is logged to logs/<phase>/chat.md by chatLogger; live terminal feed displays timestamped headers only
          } else if (event.type === "tool_start") {
            const rawHeader = this.formatToolHeader(event.data.name, event.data.args);
            const prefix = `[${this.ts()}] ${phaseTag}: `;
            // Keep total line including completion suffix (" ...  ✓ [completed]" ~ 18 chars) under 100 chars
            const maxBodyLen = Math.max(25, 100 - prefix.length - 18);
            let body = rawHeader;
            if (body.length > maxBodyLen) {
              body = body.slice(0, maxBodyLen - 3).trim();
            }
            if (body.endsWith("...")) {
              body = body.slice(0, -3).trim();
            }
            lastToolPendingText = `${prefix}${body} ...`;
            this.onLog(lastToolPendingText, false);

            // Stream continuous live activity paraphrase to the Agent panel
            const naturalAction = this.formatNaturalActivity(event.data.name, event.data.args, cleanTitle);
            if (!this.suppressNotifications) {
              this.onAgentActivity?.(phase, naturalAction);
            }
          } else if (event.type === "tool_end") {
            const base = lastToolPendingText
              ? lastToolPendingText.replace(/\s*\.{3}$/, "")
              : `[${this.ts()}] ${phaseTag}: [${event.data.name}]`;

            if (event.data.isError) {
              this.onLog(`${base} ... ❌  [failed]`, true);
              let failSnippet = "failed";
              if (event.data.result) {
                const firstLine = String(event.data.result).trim().split("\n")[0].trim();
                if (firstLine && !firstLine.startsWith("{") && firstLine.length < 50) {
                  failSnippet = `failed: ${firstLine.replace(/^Error:\s*/i, "")}`;
                }
              }
              this.logPhase(phaseTag, `❌  ${failSnippet}`, false);
            } else {
              this.onLog(`${base} ...  ✓ [completed]`, true);

              // Extract stage observations and stream to the Agent panel
              if (!this.suppressNotifications) {
                if (event.data.name === "complete_phase") {
                  const summary = event.data.args?.summary || "Phase objectives and quality gates successfully passed.";
                  this.onAgentObservation?.(phase, summary, { badge: `Phase ${phase.id} Complete` });
                } else if (event.data.name === "fail_phase") {
                  const reason = event.data.args?.reason || "Pipeline checkpoint pause.";
                  this.onAgentObservation?.(phase, `⚠️ Halted: ${reason}`, { badge: "Action Required" });
                } else {
                  const obs = this.extractToolObservation(event.data.name, event.data.args, event.data.result);
                  if (obs) {
                    this.onAgentObservation?.(phase, obs.text, { badge: obs.badge });
                  }
                }
              }
            }
            lastToolPendingText = "";
          } else if (event.type === "tokens") {
            const currentPhase = getActivePhase();
            currentPhase.tokenUsage = { ...event.data.totalUsage };
            await this.notifyState();
          }
        },
        this.chatLogger,
        () => this.shouldStop || (abortSignal?.aborted ?? false) || (runId ? this.activeRunId !== runId : false),
        existingState || undefined,
        abortSignal
      );
      this.activeLoop = loop;

      const result = (isContinuing && existingState)
        ? await loop.continue(continuationTurns)
        : await loop.run(phaseMaxTurns);

      this.phaseLoopStates.set(phase.id, loop.getState());
      const durationSeconds = Math.max(1, Math.round((Date.now() - startTimeMs) / 1000));
      const currentPhase = getActivePhase();

      currentPhase.endTime = new Date().toISOString();
      currentPhase.durationSeconds = durationSeconds;
      currentPhase.turnCount = result.turnCount;
      currentPhase.maxTurns = loop.getState().maxTurns;
      currentPhase.tokenUsage = result.tokensUsed;
      currentPhase.summary = result.summary;
      currentPhase.canContinue = !result.success;
      currentPhase.associatedFiles = this.resolveAssociatedFiles(currentPhase.fileName, currentPhase.id, result.summary);

      if (result.success) {
        this.phaseFailureCounts.delete(currentPhase.id);
        currentPhase.status = "completed";
        this.logPhase(
          phaseTag,
          `[Completed] ${cleanTitle} in ${durationSeconds}s (${result.tokensUsed.totalTokens.toLocaleString()} tokens)`
        );

        // Update docs/notes.md with phase record
        await this.appendPhaseRecordToNotes(currentPhase);
        await this.notifyState();
        if (!this.suppressNotifications) {
          this.onPhaseCompleted?.(currentPhase);
        }
        return true;
      } else {
        const failures = (this.phaseFailureCounts.get(currentPhase.id) || 0) + 1;
        this.phaseFailureCounts.set(currentPhase.id, failures);
        const normCurrent = path.basename(currentPhase.fileName).replace(/\.md$/i, "").toLowerCase();
        if (normCurrent.includes("integrity") && failures >= 2) {
          currentPhase.canContinue = false;
        }

        const summaryText = String(result.summary || "Phase failed").trim();
        const isHitl = result.isBlocked || /human-in-the-loop|hitl|study design gate|checkpoint gate|pre-flight|confirmation required|section 3/i.test(
          summaryText
        );
        currentPhase.status = isHitl ? "awaiting_hitl" : "failed";
        currentPhase.error = result.summary;
        const lines = summaryText.split("\n");
        const firstLine = lines[0];
        if (isHitl) {
          this.logPhase(phaseTag, `🛑 [HITL Checkpoint] ${cleanTitle}: ${firstLine}`);
        } else {
          this.logPhase(phaseTag, `❌ [Failed] ${cleanTitle}: ${firstLine}`);
        }
        for (let i = 1; i < lines.length; i++) {
          const line = lines[i].trim();
          if (line) {
            this.logPhase(phaseTag, `  ${line}`);
          }
        }
        await this.appendPhaseRecordToNotes(currentPhase);
        await this.notifyState();
        if (!this.suppressNotifications) {
          this.onPhaseHalted?.(currentPhase, result.summary);
        }
        return false;
      }
    } catch (err: any) {
      const currentPhase = getActivePhase();
      const isHitl = /human-in-the-loop|hitl|study design gate|confirmation required/i.test(err.message || "");
      currentPhase.status = isHitl ? "awaiting_hitl" : "failed";
      currentPhase.canContinue = true;
      currentPhase.error = err.message;
      if (loop && (!currentPhase.tokenUsage || currentPhase.tokenUsage.totalTokens === 0)) {
        currentPhase.tokenUsage = loop.getTotalUsage();
      }
      this.logPhase(phaseTag, `❌ Error in ${cleanTitle}: ${err.message}`);
      await this.notifyState();
      if (!this.suppressNotifications) {
        this.onPhaseHalted?.(currentPhase, err.message);
      }
      return false;
    } finally {
      this.activeLoop = undefined;
    }
  }

  private resolveAssociatedFiles(fileName: string, phaseId: string, summary?: string): string[] {
    if (!this.workspaceRoot) return [];
    const files = new Set<string>();
    const addIfExists = (relPath: string) => {
      const clean = relPath.replace(/^[./\\]+/, "").replace(/[.,;:)\]]+$/, "");
      if (!clean) return;
      try {
        const abs = path.join(this.workspaceRoot, clean);
        if (fsSync.existsSync(abs) && fsSync.statSync(abs).isFile()) {
          files.add(clean);
        }
      } catch (_) { }
    };

    const baseSlug = path.basename(fileName).replace(/\.md$/i, "").toLowerCase();
    // 1. Phase directive
    addIfExists(fileName.includes("/") ? fileName : `analysis/${fileName}`);
    // 2. Phase code script
    addIfExists(`code/${baseSlug}.R`);
    // 3. Phase logs
    addIfExists(`logs/${baseSlug}/chat.md`);
    addIfExists(`logs/${baseSlug}/console.log`);

    // 4. Canonical phase outputs
    if (phaseId === "00") {
      addIfExists("docs/experiment.md");
      addIfExists("docs/notes.md");
    } else if (phaseId === "01" || phaseId === "02" || phaseId === "03") {
      addIfExists("docs/experiment.md");
      addIfExists("docs/data.md");
      addIfExists("data/tidyproteomics_data.rds");
    } else if (phaseId === "06") {
      addIfExists("docs/data.md");
      addIfExists("docs/observations.md");
      addIfExists("docs/observations_summary.md");
      addIfExists("data/observations_summary.md");
    } else if (phaseId === "07") {
      addIfExists("docs/knowledge.md");
      addIfExists("data/de_novo_modules.tsv");
    } else if (phaseId === "08") {
      addIfExists("docs/literature.md");
    } else if (phaseId === "09") {
      addIfExists("docs/websearch.md");
      addIfExists("data/actionable_synthesis.json");
    } else if (phaseId === "10") {
      addIfExists("data/manuscript_digest.json");
      addIfExists("data/plot_discussion_signatures.png");
      addIfExists("data/plot_discussion_candidates.png");
    } else if (phaseId === "11") {
      addIfExists("docs/manuscript.md");
      addIfExists("docs/manuscript_rev_00.md");
    } else if (phaseId === "12") {
      addIfExists("docs/report_integrity.md");
      addIfExists("docs/manuscript_rev_01.md");
      addIfExists("docs/manuscript.md");
    } else if (phaseId === "13") {
      addIfExists("docs/report_critique.md");
      addIfExists("docs/manuscript_rev_02.md");
      addIfExists("docs/manuscript.md");
    }

    // 5. Extract any file path mentioned in summary text (e.g. data/plot_pca.png, code/02_normalize.R)
    if (summary) {
      const pathMatches = summary.matchAll(/\b((?:data|docs|code|logs|analysis|agent)\/[A-Za-z0-9_./-]+\.[A-Za-z0-9]+)\b/g);
      for (const m of pathMatches) {
        addIfExists(m[1]);
      }
    }

    return Array.from(files);
  }

  private async appendPhaseRecordToNotes(phase: PhaseInfo) {
    const notesPath = path.join(this.workspaceRoot, "docs", "notes.md");
    const statusText = phase.status === "awaiting_hitl" ? "BLOCKED" : phase.status === "failed" ? "FAILED" : "COMPLETED";
    const summaryContent = phase.summary || (phase.status === "awaiting_hitl" || phase.status === "failed" ? phase.error || "Phase halted or blocked." : "Phase checkpoints verified.");
    const entry = `
### ${phase.title} - ${statusText}
- **File**: \`${phase.fileName}\`
- **Duration**: ${phase.durationSeconds}s
- **Turns**: ${phase.turnCount || 0}
- **Start**: ${phase.startTime}
- **End**: ${phase.endTime}
- **Model**: \`${phase.model || this.client.getConfig().model}\` (\`${phase.role || "toolRunner"}\`${phase.provider ? ` | \`${phase.provider}\`` : ""})
- **Token Usage**: Total: ${phase.tokenUsage?.totalTokens || "N/A"}, Prompt: ${phase.tokenUsage?.promptTokens || "N/A"}, Completion: ${phase.tokenUsage?.completionTokens || "N/A"}, Cached: ${phase.tokenUsage?.cachedPromptTokens || 0}
- **Summary**:
${summaryContent}

---
`;
    try {
      await fs.mkdir(path.dirname(notesPath), { recursive: true });
      let current = "";
      try {
        current = await fs.readFile(notesPath, "utf-8");
      } catch {
        current = `# Autonomous Proteomics Analysis Notes\nModel: ${this.client.getConfig().model}\n\n`;
      }

      // Standardize note ownership and eliminate duplicate entries:
      // If docs/notes.md already contains an entry for this phase title, replace it so exactly one entry exists.
      const escapeRegExp = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      const titlePattern = new RegExp(
        `(\\n*###\\s*${escapeRegExp(phase.title)}[\\s\\S]*?(?=\\n###|\\n---\\s*\\n###|$)(?:\\n---\\s*\\n)?)`,
        "i"
      );

      if (titlePattern.test(current)) {
        current = current.replace(titlePattern, entry);
      } else {
        current = current.trimEnd() + "\n" + entry;
      }

      await fs.writeFile(notesPath, current, "utf-8");
    } catch (e) {
      this.logPipeline(`Warning: Failed to update docs/notes.md: ${e}`);
    }
  }
}
