import * as fs from "fs/promises";
import * as fsSync from "fs";
import * as path from "path";
import { ChatMessage, LLMRole, PhaseInfo, PipelineState, TokenUsage, ToolDefinition, ChatSessionSummary, ChatSessionSearchResult } from "../types";
import { ProviderClient } from "../llm/ProviderClient";
import { ExperimentManager, ExperimentSpec } from "./ExperimentManager";

export interface AgentMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  timestamp: string;
  quickChips?: string[];
  type?: "message" | "activity" | "observation" | "milestone";
  badge?: string;
  phaseId?: string;
  phaseTitle?: string;
  phaseTag?: string;
}

export type AdvisorMessage = AgentMessage;

export class AgentService {
  private messages: AgentMessage[] = [];
  private activeSessionId = "chat_00";
  private isBusy = false;
  private abortRequested = false;
  private experimentManager: ExperimentManager;
  private lastHaltedPhaseId?: string;
  private lastSuggestedContrast?: string;
  private phaseEventsPosted = new Set<string>();
  private saveDebounceTimer: NodeJS.Timeout | null = null;

  constructor(
    private workspaceRoot: string,
    private client: ProviderClient,
    private getPipelineState?: () => Promise<PipelineState | undefined>,
    private onStartPipeline?: (phaseId?: string) => Promise<void>,
    private onAgentUpdated?: () => void,
    extensionUriPath?: string,
    private onResumePipeline?: (fromPhaseId?: string) => Promise<void>,
    private onStopPipeline?: () => Promise<void> | void,
    private onRestartPipeline?: () => Promise<void>
  ) {
    this.workspaceRoot = workspaceRoot || "";
    this.experimentManager = new ExperimentManager(this.workspaceRoot, extensionUriPath);
    if (this.workspaceRoot) {
      this.loadLatestSessionOrCreate().catch(() => { });
    }
  }

  private notifyUpdated() {
    this.scheduleSave();
    if (this.onAgentUpdated) this.onAgentUpdated();
  }

  public getActiveSessionId(): string {
    return this.activeSessionId;
  }

  private getLogDir(): string {
    return path.join(this.workspaceRoot || "", "logs", "agent");
  }

  private getSessionFilePath(sessionId: string): string {
    return path.join(this.getLogDir(), `${sessionId}.md`);
  }

  private scheduleSave() {
    if (this.saveDebounceTimer) {
      clearTimeout(this.saveDebounceTimer);
    }
    this.saveDebounceTimer = setTimeout(() => {
      this.saveCurrentSession().catch((err) => {
        console.error("[AgentService] Auto-save error:", err);
      });
    }, 400);
  }

  public async saveCurrentSession(): Promise<void> {
    if (!this.workspaceRoot) return;
    try {
      const logDir = this.getLogDir();
      if (!fsSync.existsSync(logDir)) {
        await fs.mkdir(logDir, { recursive: true });
      }
      const filePath = this.getSessionFilePath(this.activeSessionId);
      const now = new Date().toISOString();

      const lines: string[] = [
        `# TidyProteomics Agent Chat Session: ${this.activeSessionId}`,
        "",
        `- **Session ID**: \`${this.activeSessionId}\``,
        `- **Workspace**: \`${this.workspaceRoot}\``,
        `- **Updated**: ${now}`,
        `- **Message Count**: ${this.messages.length}`,
        "",
        "---",
        "",
      ];

      for (const m of this.messages) {
        if (m.role === "user") {
          lines.push(`### User`);
          lines.push(m.content);
          lines.push("");
        } else if (m.type === "milestone") {
          lines.push(`### Phase Event: ${m.phaseTitle || m.phaseId || "Milestone"}`);
          lines.push(m.content);
          lines.push("");
        } else if (m.type === "observation") {
          lines.push(`### Scientific Observation: ${m.phaseTitle || "Finding"}`);
          lines.push(m.content);
          lines.push("");
        } else if (m.type === "activity") {
          lines.push(`> *Pipeline Activity*: ${m.content}`);
          lines.push("");
        } else {
          lines.push(`### TidyProteomics Agent`);
          lines.push(m.content);
          if (m.quickChips && m.quickChips.length > 0) {
            lines.push("");
            lines.push(`*Suggested Actions*: ${m.quickChips.map((c) => `\`${c}\``).join(", ")}`);
          }
          lines.push("");
        }
      }

      lines.push("---");
      lines.push("");
      lines.push("<!-- TIDYPROTEOMICS_CHAT_SESSION");
      lines.push(
        JSON.stringify(
          {
            sessionId: this.activeSessionId,
            version: 1,
            updatedAt: now,
            messages: this.messages,
          },
          null,
          2
        )
      );
      lines.push("-->");
      lines.push("");

      await fs.writeFile(filePath, lines.join("\n"), "utf-8");
    } catch (err) {
      console.error("[AgentService] Failed to save session:", err);
    }
  }

  public async loadSession(sessionId: string): Promise<boolean> {
    if (!this.workspaceRoot || !sessionId) return false;
    try {
      const filePath = this.getSessionFilePath(sessionId);
      if (!fsSync.existsSync(filePath)) {
        return false;
      }
      const raw = await fs.readFile(filePath, "utf-8");
      const match = raw.match(/<!-- TIDYPROTEOMICS_CHAT_SESSION\s*([\s\S]*?)\s*-->/);
      if (match && match[1]) {
        try {
          const parsed = JSON.parse(match[1]);
          if (Array.isArray(parsed.messages)) {
            this.messages = parsed.messages;
            this.activeSessionId = sessionId;
            if (this.onAgentUpdated) this.onAgentUpdated();
            return true;
          }
        } catch (_) { }
      }

      // Fallback: parse turns from markdown
      const parsedMessages: AgentMessage[] = [];
      const sections = raw.split(/^###\s+/m);
      for (const sec of sections) {
        const trimmed = sec.trim();
        if (!trimmed) continue;
        const firstLineEnd = trimmed.indexOf("\n");
        const header = firstLineEnd > 0 ? trimmed.slice(0, firstLineEnd).trim() : trimmed;
        const body = firstLineEnd > 0 ? trimmed.slice(firstLineEnd).trim() : "";
        if (!body) continue;

        if (/^User/i.test(header)) {
          parsedMessages.push({
            id: `msg_hist_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
            role: "user",
            content: body,
            timestamp: "",
          });
        } else if (/^Scientific Observation/i.test(header)) {
          parsedMessages.push({
            id: `obs_hist_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
            role: "assistant",
            type: "observation",
            content: body,
            timestamp: "",
          });
        } else if (/^Phase Event/i.test(header)) {
          parsedMessages.push({
            id: `mile_hist_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
            role: "assistant",
            type: "milestone",
            content: body,
            timestamp: "",
          });
        } else {
          parsedMessages.push({
            id: `msg_hist_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
            role: "assistant",
            content: body,
            timestamp: "",
          });
        }
      }

      this.messages = parsedMessages;
      this.activeSessionId = sessionId;
      if (this.onAgentUpdated) this.onAgentUpdated();
      return true;
    } catch (err) {
      console.error(`[AgentService] Error loading session ${sessionId}:`, err);
      return false;
    }
  }

  public async startNewSession(): Promise<string> {
    if (!this.workspaceRoot) return "chat_00";
    try {
      const logDir = this.getLogDir();
      let maxNum = -1;
      if (fsSync.existsSync(logDir)) {
        const files = await fs.readdir(logDir);
        for (const f of files) {
          const m = f.match(/^chat_(\d+)\.md$/i);
          if (m) {
            const num = parseInt(m[1], 10);
            if (!isNaN(num) && num > maxNum) maxNum = num;
          }
        }
      }

      const nextNum = maxNum >= 0 ? maxNum + 1 : 0;
      const nextId = `chat_${String(nextNum).padStart(2, "0")}`;
      this.activeSessionId = nextId;
      this.messages = [];
      this.phaseEventsPosted.clear();
      await this.checkAndTriggerOnboarding();
      await this.saveCurrentSession();
      if (this.onAgentUpdated) this.onAgentUpdated();
      return nextId;
    } catch (err) {
      console.error("[AgentService] Error starting new session:", err);
      return this.activeSessionId;
    }
  }

  public async listSessions(): Promise<ChatSessionSummary[]> {
    if (!this.workspaceRoot) return [];
    try {
      const logDir = this.getLogDir();
      if (!fsSync.existsSync(logDir)) {
        return [
          {
            id: this.activeSessionId,
            filename: `${this.activeSessionId}.md`,
            path: `logs/agent/${this.activeSessionId}.md`,
            title: "New Chat",
            messageCount: this.messages.length,
            updatedAt: new Date().toISOString(),
            createdAt: new Date().toISOString(),
            isActive: true,
          },
        ];
      }

      const files = await fs.readdir(logDir);
      const sessionFiles = files
        .filter((f) => /^chat_(\d+)\.md$/i.test(f) || f === "chat.md")
        .sort((a, b) => b.localeCompare(a, undefined, { numeric: true }));

      if (sessionFiles.length === 0) {
        return [
          {
            id: this.activeSessionId,
            filename: `${this.activeSessionId}.md`,
            path: `logs/agent/${this.activeSessionId}.md`,
            title: "New Chat",
            messageCount: this.messages.length,
            updatedAt: new Date().toISOString(),
            createdAt: new Date().toISOString(),
            isActive: true,
          },
        ];
      }

      const summaries: ChatSessionSummary[] = [];
      for (const sf of sessionFiles) {
        const full = path.join(logDir, sf);
        const stat = await fs.stat(full);
        const id = sf.replace(/\.md$/i, "");
        let title = "Chat Session";
        let messageCount = 0;
        let updatedAt = stat.mtime.toISOString();
        let createdAt = stat.birthtime ? stat.birthtime.toISOString() : updatedAt;

        try {
          const raw = await fs.readFile(full, "utf-8");
          const jsonMatch = raw.match(/<!-- TIDYPROTEOMICS_CHAT_SESSION\s*([\s\S]*?)\s*-->/);
          if (jsonMatch && jsonMatch[1]) {
            const parsed = JSON.parse(jsonMatch[1]);
            if (Array.isArray(parsed.messages)) {
              messageCount = parsed.messages.length;
              const firstUser = parsed.messages.find((m: any) => m.role === "user");
              if (firstUser && firstUser.content) {
                title = firstUser.content.slice(0, 60).replace(/\n/g, " ");
              } else if (parsed.messages.length > 0) {
                title = "Assistant Session";
              }
            }
            if (parsed.updatedAt) updatedAt = parsed.updatedAt;
          } else {
            // Check markdown text for first user prompt
            const userMatch = raw.match(/###\s+User\s*\n+([^\n#]+)/i);
            if (userMatch && userMatch[1]) {
              title = userMatch[1].trim().slice(0, 60);
            }
          }
        } catch (_) { }

        summaries.push({
          id,
          filename: sf,
          path: `logs/agent/${sf}`,
          title,
          messageCount,
          updatedAt,
          createdAt,
          isActive: id === this.activeSessionId,
        });
      }

      return summaries;
    } catch (err) {
      console.error("[AgentService] Error listing sessions:", err);
      return [];
    }
  }

  public async searchSessions(query: string): Promise<ChatSessionSearchResult[]> {
    const q = query.trim().toLowerCase();
    if (!q || !this.workspaceRoot) return [];

    try {
      const logDir = this.getLogDir();
      if (!fsSync.existsSync(logDir)) return [];

      const sessions = await this.listSessions();
      const results: ChatSessionSearchResult[] = [];

      for (const s of sessions) {
        const full = path.join(this.workspaceRoot, s.path);
        if (!fsSync.existsSync(full)) continue;
        const text = await fs.readFile(full, "utf-8");
        const lower = text.toLowerCase();

        if (lower.includes(q)) {
          const matches: string[] = [];
          const lines = text.split("\n");
          for (const line of lines) {
            if (line.toLowerCase().includes(q) && !line.includes("<!-- TIDYPROTEOMICS_CHAT_SESSION")) {
              const clean = line.replace(/^[#>*\-\s]+/, "").trim();
              if (clean.length > 0 && !matches.includes(clean)) {
                matches.push(clean.slice(0, 120));
                if (matches.length >= 3) break;
              }
            }
          }

          results.push({
            ...s,
            matches: matches.length > 0 ? matches : [s.title],
          });
        }
      }

      return results;
    } catch (err) {
      console.error("[AgentService] Error searching sessions:", err);
      return [];
    }
  }

  public async loadLatestSessionOrCreate(): Promise<void> {
    if (!this.workspaceRoot) return;
    try {
      const logDir = this.getLogDir();
      if (!fsSync.existsSync(logDir)) {
        await fs.mkdir(logDir, { recursive: true });
        this.activeSessionId = "chat_00";
        await this.checkAndTriggerOnboarding();
        await this.saveCurrentSession();
        return;
      }

      const files = await fs.readdir(logDir);
      const chatFiles = files
        .filter((f) => /^chat_(\d+)\.md$/i.test(f))
        .sort((a, b) => b.localeCompare(a, undefined, { numeric: true }));

      if (chatFiles.length > 0) {
        const latestId = chatFiles[0].replace(/\.md$/i, "");
        const ok = await this.loadSession(latestId);
        if (!ok || this.messages.length === 0) {
          await this.checkAndTriggerOnboarding();
          await this.saveCurrentSession();
        }
      } else if (fsSync.existsSync(path.join(logDir, "chat.md"))) {
        // Migrate legacy chat.md to chat_00.md
        const legacyPath = path.join(logDir, "chat.md");
        const chat00Path = path.join(logDir, "chat_00.md");
        try {
          await fs.copyFile(legacyPath, chat00Path);
        } catch (_) { }
        await this.loadSession("chat_00");
        if (this.messages.length === 0) {
          await this.checkAndTriggerOnboarding();
          await this.saveCurrentSession();
        }
      } else {
        this.activeSessionId = "chat_00";
        await this.checkAndTriggerOnboarding();
        await this.saveCurrentSession();
      }
    } catch (err) {
      console.error("[AgentService] Error in loadLatestSessionOrCreate:", err);
    }
  }

  public async triggerResume(phaseId?: string) {
    if (this.onResumePipeline) {
      await this.onResumePipeline(phaseId);
    } else if (this.onStartPipeline) {
      await this.onStartPipeline(phaseId);
    }
  }

  public async triggerRestart() {
    if (this.onRestartPipeline) {
      await this.onRestartPipeline();
    } else if (this.onStartPipeline) {
      await this.onStartPipeline(undefined);
    }
  }

  public async triggerStop() {
    if (this.onStopPipeline) {
      await this.onStopPipeline();
    }
  }

  public setWorkspaceRoot(newRoot: string) {
    this.workspaceRoot = newRoot || "";
    this.experimentManager.setWorkspaceRoot(this.workspaceRoot);
    this.loadLatestSessionOrCreate().catch(() => { });
  }

  public getExperimentManager(): ExperimentManager {
    return this.experimentManager;
  }

  public getMessages(): AgentMessage[] {
    return [...this.messages];
  }

  public isRunning(): boolean {
    return this.isBusy;
  }

  public cancel() {
    if (this.isBusy) {
      this.abortRequested = true;
    }
  }

  public async clearMessages(): Promise<void> {
    this.messages = [];
    await this.saveCurrentSession();
    this.notifyUpdated();
  }

  private async readFileSafe(relPath: string): Promise<string> {
    try {
      if (!this.workspaceRoot) return "";
      const fullPath = path.isAbsolute(relPath) ? relPath : path.join(this.workspaceRoot, relPath);
      return await fs.readFile(fullPath, "utf-8");
    } catch {
      return "";
    }
  }

  /**
   * Defines agentic tools available to the Agent for configuring experiment.md and driving execution.
   */
  private getAgentTools(): ToolDefinition[] {
    return [
      {
        name: "update_experiment_parameters",
        description: "Updates Section 1 of docs/experiment.md with the dataset file path, search platform, or analyte.",
        parameters: {
          type: "object",
          properties: {
            pathToDataFile: {
              type: "string",
              description: "Filesystem path or HTTP/HTTPS URL to the dataset file (e.g. data/raw/tmt_proteins.xlsx or data/raw/tidyproteomics_data.rds)",
            },
            platform: {
              type: "string",
              description: "Search platform or data type: ProteomeDiscoverer, MaxQuant, DIA-NN, Spectronaut, FragPipe, or tidyproteomics / rds",
            },
            analyte: {
              type: "string",
              description: "Type of analyte measured: 'proteins' or 'peptides'",
            },
          },
          required: [],
        },
      },
      {
        name: "update_experiment_description",
        description: "Updates Section 2 of docs/experiment.md with the study hypothesis, biological model, treatment/control conditions, and key questions.",
        parameters: {
          type: "object",
          properties: {
            description: {
              type: "string",
              description: "Comprehensive scientific hypothesis and experiment design description",
            },
          },
          required: ["description"],
        },
      },
      {
        name: "update_sample_renaming",
        description: "Updates Section 3.D (Sample Group Renaming & Pooling Map) of docs/experiment.md to pool or rename raw sample groups into clean biological cohorts (e.g. mapping batch tags into clean treatment/control groups).",
        parameters: {
          type: "object",
          properties: {
            sampleMapping: {
              type: "object",
              description: "Key-value dictionary mapping raw sample group names to cleaned group names, e.g. { 'active_batch5': 'active', 'healthy_batch8': 'healthy' }",
            },
          },
          required: ["sampleMapping"],
        },
      },
      {
        name: "update_target_contrasts",
        description: "Updates Section 3.E (Target Contrasts) of docs/experiment.md with pairwise contrast comparisons (e.g. ['Disease vs Control']).",
        parameters: {
          type: "object",
          properties: {
            contrasts: {
              type: "array",
              items: { type: "string" },
              description: "Array of pairwise contrasts, e.g. ['Disease vs Control'] or ['Treated vs Untreated']",
            },
          },
          required: ["contrasts"],
        },
      },
      {
        name: "flag_batch_confounding",
        description: "Sets or clears batch confounding detection in Section 3.F of docs/experiment.md. When the LLM determines biological cohorts are correlated with processing batches, call this with detected=true to expose the gate for user authorization.",
        parameters: {
          type: "object",
          properties: {
            detected: {
              type: "boolean",
              description: "Whether batch confounding is detected across treatment/control cohorts",
            },
            rationale: {
              type: "string",
              description: "Scientific explanation of how batches correlate with biological cohorts",
            },
          },
          required: ["detected"],
        },
      },
      {
        name: "authorize_batch_confounding",
        description: "Updates Section 3.F (Confounded Batch & Exploratory Comparison Gate) of docs/experiment.md to authorize Proceed With Potential Batch Confounding (TRUE or FALSE).",
        parameters: {
          type: "object",
          properties: {
            authorized: {
              type: "boolean",
              description: "Whether to authorize proceeding with unadjusted exploratory comparison despite batch confounding",
            },
          },
          required: ["authorized"],
        },
      },
      {
        name: "set_imputation_strategy",
        description: "Updates Section 3.C (Missing Value Imputation Strategy) of docs/experiment.md to configure and confirm the strategy ('randomforest_grouped', 'min_column', 'min_row_grouped', or 'none').",
        parameters: {
          type: "object",
          properties: {
            method: {
              type: "string",
              enum: ["randomforest_grouped", "min_column", "min_row_grouped", "none"],
              description: "Imputation method: 'randomforest_grouped' (MAR default: impute.randomforest, method='matrix', group_by_sample=TRUE), 'min_column' (MNAR/knockout: base::min, method='column'), 'min_row_grouped', or 'none'.",
            },
            confirmed: {
              type: "boolean",
              description: "Whether the user has confirmed the imputation strategy (default TRUE).",
            },
          },
          required: ["confirmed"],
        },
      },
      {
        name: "set_normalization_strategy",
        description: "Updates Section 3.B (Quantitative Normalization Strategy) of docs/experiment.md to configure methods (linear: scaled, median, linear, limma; non-linear: loess, svm, randomforest) and optional sub-population subset_filter.",
        parameters: {
          type: "object",
          properties: {
            methods: {
              type: "string",
              description: "Normalization methods to benchmark: 'default' (scaled, median, linear, limma, loess), 'all' (includes svm and randomforest), or comma-separated list e.g. 'scaled, median, linear, limma, loess, randomforest' or 'scaled, median, linear, svm'.",
            },
            subsetFilter: {
              type: "string",
              description: "Optional sub-population filter expression to train normalization on (e.g. 'description %like% \"Ribosome\"' or 'NONE'). Note: only linear models (scaled, median, linear) and svm can predict beyond the training subset.",
            },
          },
          required: [],
        },
      },
      {
        name: "start_or_resume_pipeline",
        description: "Triggers or resumes execution of the autonomous analysis pipeline when initial configuration is satisfied or when a halted phase's questions have been resolved.",
        parameters: {
          type: "object",
          properties: {
            phaseId: {
              type: "string",
              description: "Optional specific phase ID to rerun/resume, or omit to run the full pipeline",
            },
            reason: {
              type: "string",
              description: "Reason why the pipeline is starting or resuming",
            },
          },
          required: ["reason"],
        },
      },
      {
        name: "resume_pipeline",
        description: "Resumes execution of the autonomous analysis pipeline from the first incomplete phase or a specified phase.",
        parameters: {
          type: "object",
          properties: {
            fromPhase: {
              type: "string",
              description: "Optional specific phase ID to resume from (e.g. '04_expression'), or omit to resume from current checkpoint.",
            },
            reason: {
              type: "string",
              description: "Reason why the pipeline is resuming",
            },
          },
          required: [],
        },
      },
      {
        name: "restart_pipeline",
        description: "Restarts the entire autonomous analysis pipeline from Phase 0 from scratch.",
        parameters: {
          type: "object",
          properties: {
            reason: {
              type: "string",
              description: "Reason for restarting the pipeline",
            },
          },
          required: [],
        },
      },
      {
        name: "stop_pipeline",
        description: "Pauses or stops the currently executing autonomous pipeline.",
        parameters: {
          type: "object",
          properties: {
            reason: {
              type: "string",
              description: "Reason for stopping the pipeline",
            },
          },
          required: [],
        },
      },
      {
        name: "get_pipeline_status",
        description: "Fetches current pipeline execution status, completed phases, and error details.",
        parameters: {
          type: "object",
          properties: {},
          required: [],
        },
      },
    ];
  }

  /**
   * Checks docs/experiment.md and generates proactive onboarding guidance if initial setup is incomplete.
   */
  public async checkAndTriggerOnboarding(): Promise<boolean> {
    if (!this.workspaceRoot) return false;
    const spec = await this.experimentManager.readSpec();

    if (spec.missingInitialFields.length > 0) {
      if (this.messages.length === 0) {
        const promptText = "👋 **Welcome to TidyProteomicsAgent!**\n\nI am your live computational proteomics partner. I configure your study design and execute the 12-phase pipeline autonomously.\n\nTell me about your experiment in your own words (data file location, search platform, analyte, and comparison groups), or select a sample option below to get started!";
        const chips = [
          "data/raw/tidyproteomics_data.rds",
          "ProteomeDiscoverer",
          "DIA-NN",
          "MaxQuant",
          "Review docs/experiment.md ↗"
        ];

        this.messages.push({
          id: "msg_onboard_" + Date.now(),
          role: "assistant",
          content: promptText,
          timestamp: new Date().toLocaleTimeString(),
          quickChips: chips,
          type: "message",
        });

        this.notifyUpdated();
        return true;
      }
    } else if (this.messages.length === 0) {
      // All initial fields satisfied
      this.messages.push({
        id: "msg_ready_" + Date.now(),
        role: "assistant",
        content: "👋 **Welcome back to TidyProteomicsAgent!**\n\nI reviewed `docs/experiment.md` and confirmed that all dataset parameters and your study hypothesis are configured! 🚀\n\n**Ready to start the autonomous analysis pipeline?**",
        timestamp: new Date().toLocaleTimeString(),
        quickChips: ["⚡ Yes, Start Pipeline", "Review docs/experiment.md ↗"],
        type: "message",
      });

      this.notifyUpdated();
      return true;
    }

    return false;
  }

  /**
   * Posts or updates the live, in-progress activity status in the Agent panel.
   * Preserves phrased summaries for each LLM turn step in the stream.
   */
  public handleStageActivity(phase: PhaseInfo, actionText: string): void {
    const cleanAction = String(actionText || "").trim();
    if (!cleanAction) return;

    // Check if the latest activity already has this exact content
    const lastMsg = this.messages[this.messages.length - 1];
    if (lastMsg && lastMsg.type === "activity" && lastMsg.phaseId === phase.id && lastMsg.content === cleanAction) {
      return;
    }

    // Mark previous in-progress activities for this phase as completed
    for (const m of this.messages) {
      if (m.type === "activity" && m.phaseId === phase.id && m.badge === "In Progress") {
        m.badge = "Completed";
      }
    }

    const title = phase.title || phase.fileName;
    const msg: AgentMessage = {
      id: `act_${phase.id}_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`,
      role: "assistant",
      content: cleanAction,
      timestamp: new Date().toLocaleTimeString(),
      type: "activity",
      phaseId: phase.id,
      phaseTitle: title,
      badge: "In Progress",
    };

    this.messages.push(msg);
    this.notifyUpdated();
  }

  /**
   * Appends a structured scientific observation card discovered during phase execution.
   */
  public handleStageObservation(
    phase: PhaseInfo,
    text: string,
    metadata?: { badge?: string; metric?: string }
  ): void {
    const cleanText = String(text || "").trim();
    if (!cleanText) return;

    // Prevent duplicate observations with identical text in the same phase
    const isDuplicate = this.messages.some(
      (m) => m.type === "observation" && m.phaseId === phase.id && m.content === cleanText
    );
    if (isDuplicate) return;

    const title = phase.title || phase.fileName;
    const msg: AgentMessage = {
      id: `obs_${phase.id}_${Date.now()}`,
      role: "assistant",
      content: cleanText,
      timestamp: new Date().toLocaleTimeString(),
      type: "observation",
      phaseId: phase.id,
      phaseTitle: title,
      badge: metadata?.badge || "Observation",
    };

    this.messages.push(msg);
    this.notifyUpdated();
  }

  /**
   * Pushes a real-time activity card into the Agent chat when a phase starts execution.
   */
  public handlePhaseStarted(phase: PhaseInfo): void {
    const key = `started_${phase.id}_${phase.startTime || Date.now()}`;
    if (this.phaseEventsPosted.has(key)) return;
    this.phaseEventsPosted.add(key);

    const phaseTagUpper = path.basename(phase.fileName).replace(/\.md$/i, "").toUpperCase();
    const title = phase.title || phase.fileName;
    const msg: AgentMessage = {
      id: "msg_start_" + phase.id + "_" + Date.now(),
      role: "assistant",
      content: `${phaseTagUpper}`,
      timestamp: new Date().toLocaleTimeString(),
      type: "milestone",
      phaseId: phase.id,
      phaseTitle: title,
      phaseTag: phaseTagUpper,
      badge: "Phase Started",
    };
    this.messages.push(msg);
    this.notifyUpdated();
  }

  /**
   * Called when a phase completes successfully.
   * Marks in-progress turns as completed and pushes a completion summary into Agent chat.
   */
  public async handlePhaseCompleted(phase: PhaseInfo): Promise<boolean> {
    if (this.lastHaltedPhaseId === phase.id) {
      this.lastHaltedPhaseId = undefined;
    }

    // Mark in-progress activities for this phase as completed (preserve turn history)
    for (const m of this.messages) {
      if (m.type === "activity" && m.phaseId === phase.id && m.badge === "In Progress") {
        m.badge = "Completed";
      }
    }

    const key = `completed_${phase.id}_${phase.endTime || Date.now()}`;
    if (!this.phaseEventsPosted.has(key)) {
      this.phaseEventsPosted.add(key);
      const title = phase.title || phase.fileName;
      const dur = phase.durationSeconds ? `${phase.durationSeconds}s` : "completed";
      const tokens = phase.tokenUsage?.totalTokens ? `${phase.tokenUsage.totalTokens.toLocaleString()} tokens` : "";
      const metrics = [dur, tokens].filter(Boolean).join(", ");

      const msg: AgentMessage = {
        id: "msg_done_" + phase.id + "_" + Date.now(),
        role: "assistant",
        content: `✓ **Phase ${phase.id} Complete:** ${title}${metrics ? ` (${metrics})` : ""}`,
        timestamp: new Date().toLocaleTimeString(),
        type: "milestone",
        phaseId: phase.id,
        phaseTitle: title,
        badge: "Phase Completed",
      };
      this.messages.push(msg);
      this.notifyUpdated();
    }

    return true;
  }

  /**
   * Pushes an alert card when the entire pipeline finishes.
   */
  public handlePipelineFinished(state: PipelineState): void {
    this.lastHaltedPhaseId = undefined;
    const key = `pipeline_finished_${state.endTime || Date.now()}`;
    if (this.phaseEventsPosted.has(key)) return;
    this.phaseEventsPosted.add(key);

    const totalToks = state.totalTokens?.totalTokens ? state.totalTokens.totalTokens.toLocaleString() : "0";
    const msg: AgentMessage = {
      id: "msg_finished_" + Date.now(),
      role: "assistant",
      content: `🎉 **Autonomous Pipeline Finished**: All phases completed successfully!\n\n• Total Tokens: **${totalToks}**\n• Final Synthesis & Figures compiled in \`docs/\` and \`data/\``,
      timestamp: new Date().toLocaleTimeString(),
      quickChips: ["Review docs/manuscript.md ↗", "📊 Pipeline Status"],
    };
    this.messages.push(msg);
    this.notifyUpdated();
  }

  private async resolveIncompletePhaseId(fallback = "01"): Promise<string> {
    if (this.lastHaltedPhaseId) return this.lastHaltedPhaseId;
    if (this.getPipelineState) {
      try {
        const state = await this.getPipelineState();
        if (state && Array.isArray(state.phases)) {
          const incomplete = state.phases.find((p) => p.enabled !== false && p.status !== "completed");
          if (incomplete) return incomplete.id;
        }
      } catch { }
    }
    return fallback;
  }

  /**
   * Automatically intercepts a halted or failed pipeline phase and prompts the user in Chat.
   */
  public async handlePhaseHalted(phase: PhaseInfo): Promise<void> {
    const haltKey = `msg_halt_${phase.id}`;
    if (this.lastHaltedPhaseId === phase.id && this.messages.some((m) => m.id === haltKey)) {
      return;
    }
    this.lastHaltedPhaseId = phase.id;
    const errorText = String(phase.error || phase.summary || "").trim();

    let questionPrompt = "";
    let chips: string[] = [];

    const spec = await this.experimentManager.readSpec();
    const isConfounding = Boolean(
      spec.batchConfoundingDetected ||
      /confound|Proceed With Potential Batch Confounding|Authorize Unadjusted Exploratory Comparison/i.test(errorText)
    );
    const isSampleGrouping = /sample group|recoding|pooling|Section 3\.?[DB]|reassign sample names/i.test(errorText);
    const isContrastNeeded = /contrast|target contrast|disease\/control|Section 3\.?[EC]/i.test(errorText);
    const isImputationNeeded = /imputation|Section 3\.?[EC]|Confirm Imputation Strategy|randomforest_grouped|min_column/i.test(errorText);
    const isStudyDesignGate = phase.id === "02" || /Pre-flight Study Design Gate|Human-in-the-loop|Section 3/i.test(errorText);

    if (isStudyDesignGate) {
      questionPrompt = `🛑 **HUMAN-IN-THE-LOOP (HITL) CHECKPOINT: Unified Study Design Gate**\n**Phase**: ${phase.title || phase.fileName} (Phase ${phase.id})\n\n**Reason Execution Paused**:\nMandatory Section 3 subtask confirmation checks are pending in \`docs/experiment.md\`. All unconfirmed subtasks must be verified before normalization benchmarking and replicate variation analysis proceed.\n\n**Specific Required Actions (Mandatory)**:\n1. **3.A Discovered Sample Groups**: Verify detected sample groups and check \`Confirm Discovered Sample Groups: TRUE\`.\n2. **3.B Quantitative Normalization**: Confirm normalization methods (default \`scaled, median, linear, limma, loess\`) and check \`Confirm Normalization Strategy: TRUE\`.\n3. **3.C Missing Value Imputation**: Verify imputation method (\`randomforest_grouped\` for general MAR vs \`min_column\` for knockouts/MNAR) and check \`Confirm Imputation Strategy: TRUE\`.\n4. **3.D Sample Group Renaming & Pooling Map**: Verify raw replicate mapping into clean biological cohorts and check \`Confirm Sample Pooling Map: TRUE\`.\n5. **3.E Target Contrasts**: Verify pairwise comparison pair (e.g. \`Treated vs Control\`) and check \`Confirm Target Contrasts: TRUE\`.\n${isConfounding ? "6. **3.F Confounded Batch Gate**: Review detected batch confounding and check `Proceed With Potential Batch Confounding: TRUE`.\n" : ""}\n👉 *All items needing your confirmation are highlighted with an **orange outline** in the \`docs/experiment.md\` form pane.*`;
      chips = ["🎯 Confirm All Study Design & Proceed", "Use Random Forest Normalization", "Use Column Min (MNAR / Knockout)", "Review docs/experiment.md ↗"];
    } else if (phase.id === "03" || isImputationNeeded) {
      questionPrompt = `🛑 **HUMAN-IN-THE-LOOP (HITL) CHECKPOINT: Imputation Strategy Gate**\n**Phase**: ${phase.title || phase.fileName} (Phase ${phase.id})\n\n**Reason Execution Paused**:\nMissing Value Imputation Strategy confirmation is required in Section 3.C of \`docs/experiment.md\`.\n\n**Specific Required Actions (Mandatory)**:\n1. Review the recommended method in Section 3.C (highlighted in orange outline):\n   • \`randomforest_grouped\` (MAR Default — Karpievitch et al., 2012)\n   • \`min_column\` (LOD minimum for intentional gene knockouts / suppressions)\n2. Check \`Confirm Imputation Strategy: TRUE\` or click a confirmation button below to resume.`;
      chips = ["🎯 Confirm All Study Design & Proceed", "🎯 Confirm Imputation & Proceed", "Use Random Forest (MAR Default)", "Use Column Min (MNAR / Knockout)", "Review docs/experiment.md ↗"];
    } else if (phase.id === "04" && (isConfounding || isContrastNeeded)) {
      questionPrompt = `🛑 **HUMAN-IN-THE-LOOP (HITL) CHECKPOINT: Statistical Contrast & Batch Gate**\n**Phase**: ${phase.title || phase.fileName} (Phase ${phase.id})\n\n**Reason Execution Paused**:\nPhase 4 requires confirmed pairwise target contrasts in Section 3.E and authorization of potential batch confounding in Section 3.F before fitting linear models.\n\n**Specific Required Actions (Mandatory)**:\n1. Verify the primary comparison pair in Section 3.E (e.g. \`Treatment vs Control\`) and check \`Confirm Target Contrasts: TRUE\`.\n${isConfounding ? "2. The LLM detected that biological condition cohorts are confounded with processing batches. Check `Proceed With Potential Batch Confounding: TRUE` in Section 3.F.\n" : ""}3. Click '🎯 Confirm Contrast & Proceed' below or save the form to resume Phase 4.`;
      chips = ["🎯 Confirm All Study Design & Proceed", "🎯 Confirm Contrast & Proceed", "⚡ Authorize Confounding & Resume", "Review docs/experiment.md ↗"];
    } else if (isConfounding) {
      questionPrompt = `🛑 **HUMAN-IN-THE-LOOP (HITL) CHECKPOINT: Batch Confounding Gate**\n**Phase**: ${phase.title || phase.fileName}\n\n**Reason Execution Paused**:\nThe LLM detected that biological condition cohorts correlate with processing batches/runs. Linear models cannot mathematically separate batch variance from biology.\n\n**Specific Required Actions (Mandatory)**:\n1. Review Section 3.F Confounded Batch & Exploratory Comparison Gate in \`docs/experiment.md\` (highlighted in orange outline).\n2. Authorize proceeding with exploratory linear modeling by checking \`Proceed With Potential Batch Confounding: TRUE\`.\n3. Click '⚡ Authorize Confounding & Resume' below.`;
      chips = ["🎯 Confirm All Study Design & Proceed", "⚡ Authorize Confounding & Resume", "Review docs/experiment.md ↗"];
    } else if (isSampleGrouping) {
      questionPrompt = `🛑 **HUMAN-IN-THE-LOOP (HITL) CHECKPOINT: Sample Grouping & Pooling Gate**\n**Phase**: ${phase.title || phase.fileName}\n\n**Reason Execution Paused**:\nRaw sample replicate mapping or pooling confirmation is required in Section 3.D before downstream operations.\n\n**Specific Required Actions (Mandatory)**:\n1. Open \`docs/experiment.md\` Section 3.D (highlighted in orange outline).\n2. Map raw replicate sample labels to clean biological condition cohorts.\n3. Check \`Confirm Sample Pooling Map: TRUE\` and resume execution.`;
      chips = ["🎯 Confirm All Study Design & Proceed", "Review docs/experiment.md ↗"];
    } else if (isContrastNeeded) {
      questionPrompt = `🛑 **HUMAN-IN-THE-LOOP (HITL) CHECKPOINT: Target Contrast Gate**\n**Phase**: ${phase.title || phase.fileName}\n\n**Reason Execution Paused**:\nTarget contrast definition and confirmation are required in Section 3.E before differential expression analysis.\n\n**Specific Required Actions (Mandatory)**:\n1. Open \`docs/experiment.md\` Section 3.E (highlighted in orange outline).\n2. Enter pairwise contrast (e.g. \`Treated vs Control\`).\n3. Check \`Confirm Target Contrasts: TRUE\` and resume.`;
      chips = ["🎯 Confirm All Study Design & Proceed", "🎯 Confirm Contrast & Proceed", "Review docs/experiment.md ↗"];
    } else {
      const firstLine = errorText.split("\n")[0] || "Phase paused.";
      questionPrompt = `🛑 **HUMAN-IN-THE-LOOP (HITL) CHECKPOINT**\n**Phase**: ${phase.title || phase.fileName}\n\n**Reason Execution Paused**:\n${firstLine}\n\n**Specific Required Actions (Mandatory)**:\n1. Inspect highlighted orange fields in \`docs/experiment.md\`.\n2. Resolve configuration or gate requirements and confirm to resume.`;
      chips = ["🎯 Confirm All Study Design & Proceed", "What caused this?", "Review docs/experiment.md ↗"];
    }

    this.messages.push({
      id: haltKey,
      role: "assistant",
      content: questionPrompt,
      timestamp: new Date().toLocaleTimeString(),
      quickChips: chips,
    });

    this.notifyUpdated();
  }

  /**
   * Assembles the live context snapshot from the workspace to empower the agent.
   */
  private async buildSystemPrompt(): Promise<string> {
    const experiment = await this.readFileSafe(path.join("docs", "experiment.md"));
    const notes = await this.readFileSafe(path.join("docs", "notes.md"));
    const llm = await this.readFileSafe(path.join("docs", "llm.md"));

    let pipelineStatusText = "No pipeline state available.";
    if (this.getPipelineState) {
      try {
        const state = await this.getPipelineState();
        if (state && Array.isArray(state.phases) && state.phases.length > 0) {
          pipelineStatusText = state.phases
            .map((p, idx) => {
              const statusStr = (p.status || "pending").toUpperCase();
              let info = `${idx + 1}. [${statusStr}] ${p.title || p.fileName}`;
              if (p.durationSeconds) info += ` (${p.durationSeconds}s)`;
              if (p.error) info += `\n   Error/Warning: ${p.error.slice(0, 300)}`;
              return info;
            })
            .join("\n");
        }
      } catch (err) {
        pipelineStatusText = `Error fetching pipeline state: ${String(err)}`;
      }
    }

    const spec = await this.experimentManager.readSpec();

    return `
You are the **TidyProteomics Agent**, an expert AI computational biologist and mass spectrometry proteomics specialist integrated directly inside VS Code.
You drive the research workflow interactively: you interview the researcher, configure \`docs/experiment.md\` using your tools, answer scientific questions, resolve batch confounding or contrast ambiguities, and start/resume the pipeline.

### CURRENT WORKSPACE STATE & SPECIFICATION:
- **Missing Initial Variables**: ${spec.missingInitialFields.join(", ") || "None (All 4 initialized)"}
- **Data File**: ${spec.pathToDataFile || "Unset"}
- **Platform**: ${spec.platform || "Unset"}
- **Analyte**: ${spec.analyte || "Unset"}
- **Contrasts**: ${spec.targetContrasts.join(", ") || "None defined"}
- **Batch Confounding Authorized**: ${spec.batchConfoundingAuthorized ? "TRUE" : "FALSE"}

#### Active Pipeline Tasks:
\`\`\`text
${pipelineStatusText}
\`\`\`

#### Experimental Specification (docs/experiment.md):
\`\`\`markdown
${experiment || "No docs/experiment.md found."}
\`\`\`

#### Runtime Shared Notes (docs/notes.md):
\`\`\`markdown
${notes ? notes.slice(-3000) : "No runtime notes found."}
\`\`\`

#### Active Model Info (docs/llm.md):
\`\`\`markdown
${llm || "Not specified."}
\`\`\`

#### TidyProteomics Execution Engine:
- **Engine**: Persistent in-memory tidyproteomics R session via Model Context Protocol (MCP).
- **Live In-Memory Workflow**: Automated ingestion (\`tpa_load\`), QC inspection (\`tpa_inspect\`, \`tpa_summary\`), normalization benchmarking (\`tpa_normalize\`), quantitative imputation (\`tpa_impute\`), differential expression (\`tpa_expression\`), pathway enrichment (\`tpa_enrichment\`), and state export (\`tpa_export_state\`).

### AGENT RESPONSIBILITIES & FREE-FORM NATURAL PROMPT RESOLUTION:
1. **Natural Conversational Setup**: The researcher can describe their experiment freely in plain English (e.g. data file location, search platform, analyte, treatment vs control conditions, and biological hypothesis). You MUST parse all stated parameters and immediately invoke the corresponding tools:
   - Call \`update_experiment_parameters({ pathToDataFile, platform, analyte })\` for any dataset path, platform, or analyte mentioned.
   - Call \`update_target_contrasts({ contrasts: [...] })\` for any treatment/control comparisons mentioned (e.g. \`["KO vs WT"]\`).
   - Call \`update_experiment_description({ description })\` for the biological hypothesis, model system, or study goals.
   - If the researcher says to run/start the pipeline, call \`start_or_resume_pipeline\`.
2. **Concise, Professional Paraphrases**: In your conversational response, do NOT ask robotic multi-part questionnaires. Paraphrase what you configured in 1–2 friendly sentences, mention what (if anything) remains to configure, and ask if they are ready to proceed.
3. **Interactive Error & Checkpoint Resolution**:
   - If user provides sample group mappings, call \`update_sample_renaming\`.
   - If user confirms contrast or confounding, call \`update_target_contrasts\` and \`authorize_batch_confounding(authorized = true)\` and resume.
`.trim();
  }

  /**
   * Appends an explicit user response into the message trajectory.
   * Marks previous agent checkpoints / prompts as responded to.
   */
  public addUserMessage(text: string): void {
    const userMsgId = "msg_" + Date.now() + "_u";
    const userTimestamp = new Date().toLocaleTimeString();
    this.messages.push({
      id: userMsgId,
      role: "user",
      content: text,
      timestamp: userTimestamp,
    });
    this.notifyUpdated();
  }

  /**
   * Sends a user query to the agent and streams/returns the response.
   */
  public async sendMessage(
    userText: string,
    onToken?: (chunk: string) => void
  ): Promise<{ reply: string; usage: TokenUsage; role?: LLMRole }> {
    if (this.isBusy) {
      throw new Error("Agent is already generating a response.");
    }

    this.isBusy = true;
    this.abortRequested = false;

    const userMsgId = "msg_" + Date.now() + "_u";
    const userTimestamp = new Date().toLocaleTimeString();
    this.messages.push({
      id: userMsgId,
      role: "user",
      content: userText,
      timestamp: userTimestamp,
    });
    this.notifyUpdated();

    console.log("[AgentService] Received user query:", userText);

    try {
      const trimmed = userText.trim();
      const lower = trimmed.toLowerCase();

      // -------------------------------------------------------------
      // DETERMINISTIC INTENT ROUTER (Tier 1 Fast-Path)
      // -------------------------------------------------------------

      // 1. Stop / Pause Intent
      const isStopIntent =
        /^(?:stop|pause|abort|halt|cancel)(?:\s+(?:the\s+)?pipeline)?$/i.test(trimmed) ||
        /^(?:please\s+)?(?:stop|pause|abort|halt)\b/i.test(trimmed);
      if (isStopIntent) {
        await this.triggerStop();
        const reply = "⏹ **Pipeline Paused**: Execution paused by user.";
        if (onToken) onToken(reply);
        const agentMsg: AgentMessage = {
          id: "msg_" + Date.now() + "_a",
          role: "assistant",
          content: reply,
          timestamp: new Date().toLocaleTimeString(),
          quickChips: ["▶ Resume Pipeline", "📊 Pipeline Status"],
        };
        this.messages.push(agentMsg);
        await this.logAgentTurn(userText, reply);
        this.notifyUpdated();
        return { reply, usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 } };
      }

      // 2. Restart Intent
      const isRestartIntent =
        /^(?:restart|start over|re-run all|run from (?:the )?beginning|run from scratch|restart pipeline)$/i.test(trimmed) ||
        /\b(?:restart|re-run all)\s+(?:the\s+)?pipeline\b/i.test(trimmed);
      if (isRestartIntent) {
        const reply = "🔄 **Restarting Pipeline**: Re-executing all phases from Phase 0...";
        if (onToken) onToken(reply);
        const agentMsg: AgentMessage = {
          id: "msg_" + Date.now() + "_a",
          role: "assistant",
          content: reply,
          timestamp: new Date().toLocaleTimeString(),
        };
        this.messages.push(agentMsg);
        await this.triggerRestart();
        await this.logAgentTurn(userText, reply);
        this.notifyUpdated();
        return { reply, usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 } };
      }

      // 3. Status / Diagnostics Intent
      const isStatusIntent = /^(?:status|pipeline status|how are we doing\??|what phase are we on\??|current status\??)$/i.test(trimmed);
      if (isStatusIntent && this.getPipelineState) {
        const state = await this.getPipelineState();
        let statusReply = "📊 **Autonomous Pipeline Status**:\n\n";
        if (state && Array.isArray(state.phases) && state.phases.length > 0) {
          const phasesList = state.phases.map((p, idx) => {
            const icon = p.status === "completed" ? "✓" : p.status === "failed" ? "❌" : p.status === "running" ? "▶" : "⏳";
            let s = `${icon} **Phase ${p.id}**: ${p.title || p.fileName} (${p.status.toUpperCase()})`;
            if (p.durationSeconds) s += ` - ${p.durationSeconds}s`;
            if (p.error) s += `\n   ↳ *Checkpoint/Error*: ${p.error.split("\n")[0]}`;
            return s;
          }).join("\n");
          statusReply += phasesList;
          const totalToks = state.totalTokens?.totalTokens || 0;
          statusReply += `\n\n**Total Tokens**: ${totalToks.toLocaleString()}`;
        } else {
          statusReply += "No active pipeline phases found.";
        }
        if (onToken) onToken(statusReply);
        const agentMsg: AgentMessage = {
          id: "msg_" + Date.now() + "_a",
          role: "assistant",
          content: statusReply,
          timestamp: new Date().toLocaleTimeString(),
          quickChips: ["▶ Resume Pipeline", "Review docs/experiment.md ↗"],
        };
        this.messages.push(agentMsg);
        await this.logAgentTurn(userText, statusReply);
        this.notifyUpdated();
        return { reply: statusReply, usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 } };
      }

      const isAuthorizeAffirmative = /^(authorize|authorize and resume|authorize confounding|yes,? authorize|yes,? proceed|⚡ authorize confounding & resume)$/i.test(lower);
      const isConfirmStudyDesignAffirmative =
        /^(🎯\s*)?confirm (?:study design|all)(?:\s*(&|and)\s*proceed)?$/i.test(trimmed) ||
        /\bconfirm\s+study\s+design\b/i.test(lower);
      const isUseRfNormAffirmative = /^use random forest normalization$/i.test(trimmed);
      const isConfirmContrastAffirmative =
        isConfirmStudyDesignAffirmative ||
        /^(🎯\s*)?confirm contrast(?:\s*(&|and)\s*proceed)?$/i.test(trimmed) ||
        (/\bconfirm contrast\b/i.test(lower) && /\bproceed\b/i.test(lower)) ||
        /\bconfirm.*contrast.*proceed\b/i.test(lower);
      const isConfirmImputationAffirmative =
        /^(🎯\s*)?confirm imputation(?:\s*(&|and)\s*proceed)?$/i.test(trimmed) ||
        /^use random forest \(mar default\)/i.test(trimmed) ||
        /^use column min/i.test(trimmed) ||
        (/\bconfirm imputation\b/i.test(lower));

      // 4. Fast-path single-token answers for quick chips (e.g. clicking "ProteomeDiscoverer" or "proteins")
      const preSpec = await this.experimentManager.readSpec();
      const isSimpleChipAnswer =
        trimmed.length < 50 &&
        !trimmed.includes("\n") &&
        !trimmed.includes(" ") &&
        (/^(ProteomeDiscoverer|MaxQuant|DIA-NN|Spectronaut|FragPipe|tidyproteomics)$/i.test(trimmed) ||
          /^(proteins|peptides)$/i.test(trimmed) ||
          /^(?:data\/[a-zA-Z0-9_\-./]+\.(?:rds|xlsx|txt|tsv|csv)|[a-zA-Z0-9_\-./]+\.(?:rds|xlsx|txt|tsv|csv))$/i.test(trimmed));

      if (isSimpleChipAnswer && preSpec.missingInitialFields.length > 0) {
        if (/^(ProteomeDiscoverer|MaxQuant|DIA-NN|Spectronaut|FragPipe|tidyproteomics)$/i.test(trimmed)) {
          await this.experimentManager.setParameter("PLATFORM", trimmed);
        } else if (/^(proteins|peptides)$/i.test(trimmed)) {
          await this.experimentManager.setParameter("ANALYTE", trimmed.toLowerCase());
        } else if (/\.(rds|xlsx|txt|tsv|csv)$/i.test(trimmed)) {
          await this.experimentManager.setParameter("PATH_TO_DATA_FILE", trimmed);
        }
      }

      // 5. Direct handling of pipeline halt resolutions
      if (isUseRfNormAffirmative) {
        const normCfg = await this.experimentManager.setNormalizationStrategy("scaled, median, linear, limma, loess, randomforest");
        const confirmed = await this.experimentManager.confirmContrastAndAuthorizeConfounding();
        const contrastLabel = confirmed.length > 0 ? ` (\`${confirmed.join(", ")}\`)` : "";
        const resumeId = await this.resolveIncompletePhaseId("02");
        const reply = `✅ **Enabled Random Forest Normalization & Confirmed Study Design**:\n• Set \`Normalization Methods: ${normCfg.methods}\` in Section 3.B\n• Confirmed discovered groups (3.A), imputation (3.C), sample pooling (3.D), and contrast${contrastLabel} (3.E).\n\nResuming pipeline from Phase ${resumeId}...`;
        if (onToken) onToken(reply);
        const agentMsg: AgentMessage = {
          id: "msg_" + Date.now() + "_a",
          role: "assistant",
          content: reply,
          timestamp: new Date().toLocaleTimeString(),
        };
        this.messages.push(agentMsg);
        this.lastHaltedPhaseId = undefined;
        await this.triggerResume(resumeId);
        await this.logAgentTurn(userText, reply);
        this.notifyUpdated();
        return { reply, usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 } };
      }

      if (isConfirmImputationAffirmative) {
        const chosenMethod = /^use column min/i.test(trimmed)
          ? "min_column"
          : /^use random forest/i.test(trimmed)
            ? "randomforest_grouped"
            : undefined;
        const finalMethod = await this.experimentManager.setImputationStrategy(chosenMethod, true);
        if (this.lastHaltedPhaseId === "02") {
          await this.experimentManager.confirmContrastAndAuthorizeConfounding();
        }
        const resumeId = await this.resolveIncompletePhaseId("03");
        const reply = `✅ **Confirmed Imputation Strategy**: Set \`Imputation Method: ${finalMethod}\` and \`Confirm Imputation Strategy: TRUE\` in Section 3.C of \`docs/experiment.md\`.\n\nResuming pipeline (Phase ${resumeId})...`;
        if (onToken) onToken(reply);
        const agentMsg: AgentMessage = {
          id: "msg_" + Date.now() + "_a",
          role: "assistant",
          content: reply,
          timestamp: new Date().toLocaleTimeString(),
        };
        this.messages.push(agentMsg);
        this.lastHaltedPhaseId = undefined;
        await this.triggerResume(resumeId);
        await this.logAgentTurn(userText, reply);
        this.notifyUpdated();
        return { reply, usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 } };
      }

      if (isConfirmContrastAffirmative || (this.lastHaltedPhaseId && isAuthorizeAffirmative)) {
        const confirmed = await this.experimentManager.confirmContrastAndAuthorizeConfounding();
        const contrastLabel = confirmed.length > 0 ? ` (\`${confirmed.join(", ")}\`)` : "";
        const resumeId = await this.resolveIncompletePhaseId("02");
        const reply = `✅ **Confirmed Study Design & Target Contrast**: Confirmed discovered groups (3.A), normalization (3.B), imputation (3.C), sample pooling (3.D), and target contrast${contrastLabel} (3.E) in \`docs/experiment.md\`.\n\nResuming pipeline (Phase ${resumeId})...`;
        if (onToken) onToken(reply);
        const agentMsg: AgentMessage = {
          id: "msg_" + Date.now() + "_a",
          role: "assistant",
          content: reply,
          timestamp: new Date().toLocaleTimeString(),
        };
        this.messages.push(agentMsg);
        this.lastHaltedPhaseId = undefined;
        this.lastSuggestedContrast = undefined;
        await this.triggerResume(resumeId);
        await this.logAgentTurn(userText, reply);
        this.notifyUpdated();
        return { reply, usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 } };
      }

      if (this.lastHaltedPhaseId) {
        // Contrast input (e.g. "Disease vs Control" or "disease/control" or "Treated vs Vehicle")
        const contrastMatch = trimmed.match(/^([a-zA-Z0-9_-]+)\s*(?:\/|vs\.?|versus)\s*([a-zA-Z0-9_-]+)$/i);
        const isContrastPhase = this.lastHaltedPhaseId.includes("04_expression") || !!this.lastSuggestedContrast;
        if (contrastMatch && isContrastPhase) {
          const contrast = `${contrastMatch[1]} vs ${contrastMatch[2]}`;
          await this.experimentManager.setTargetContrasts([contrast]);
          const reply = `✅ **Configured Target Contrast**: Saved \`- Contrast: ${contrast}\` in \`docs/experiment.md\`.\n\nResuming differential expression analysis now...`;
          if (onToken) onToken(reply);
          const agentMsg: AgentMessage = {
            id: "msg_" + Date.now() + "_a",
            role: "assistant",
            content: reply,
            timestamp: new Date().toLocaleTimeString(),
          };
          this.messages.push(agentMsg);
          const resumeId = this.lastHaltedPhaseId;
          this.lastHaltedPhaseId = undefined;
          this.lastSuggestedContrast = undefined;
          await this.triggerResume(resumeId);
          await this.logAgentTurn(userText, reply);
          this.notifyUpdated();
          return { reply, usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 } };
        }
      }

      // 6. Conversational Start / Resume Affirmative
      const isQuestion = /\?|whats the issue|why did|why is|how do/i.test(lower);
      const isResumeKeyword =
        /^(yes|start|run|proceed|ready|continue|resume|go|go ahead|let'?s go|start pipeline|run pipeline|resume pipeline|yes,? start pipeline|⚡ yes, start pipeline)$/i.test(lower) ||
        /\b(?:please\s+)?(?:proceed|continue)\b/i.test(lower) ||
        /\b(?:start|run|resume)\s+(?:the\s+)?pipeline\b/i.test(lower);

      const isStartAffirmative = !isQuestion && isResumeKeyword;

      if (isStartAffirmative) {
        let state: PipelineState | undefined;
        if (this.getPipelineState) {
          try {
            state = await this.getPipelineState();
          } catch { }
        }

        if (state && Array.isArray(state.phases) && state.phases.length > 0) {
          const activePhases = state.phases.filter((p) => p.enabled !== false);
          const allCompleted = activePhases.length > 0 && activePhases.every((p) => p.status === "completed");
          if (allCompleted) {
            this.lastHaltedPhaseId = undefined;
            const reply = "🎉 All pipeline phases are already completed! To re-run the entire pipeline from scratch, click 'Restart Pipeline' or type 'restart'.";
            if (onToken) onToken(reply);
            const agentMsg: AgentMessage = {
              id: "msg_" + Date.now() + "_a",
              role: "assistant",
              content: reply,
              timestamp: new Date().toLocaleTimeString(),
              quickChips: ["🔄 Restart Pipeline", "Review docs/manuscript.md ↗"],
            };
            this.messages.push(agentMsg);
            await this.logAgentTurn(userText, reply);
            this.notifyUpdated();
            return { reply, usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 } };
          }

          if (this.lastHaltedPhaseId) {
            const haltedPhase = state.phases.find((p) => p.id === this.lastHaltedPhaseId);
            if (haltedPhase && haltedPhase.status === "completed") {
              this.lastHaltedPhaseId = undefined;
            }
          }
        }

        const spec = await this.experimentManager.readSpec();
        if (spec.missingInitialFields.length === 0) {
          const cfg = this.client.getConfig();
          if (cfg.provider !== "ollama" && !cfg.apiKey) {
            const reply = "⚠️ **API Key Required**: Please configure an API Key in the **Provider** tab before launching the autonomous pipeline.";
            if (onToken) onToken(reply);
            const agentMsg: AgentMessage = {
              id: "msg_" + Date.now() + "_a",
              role: "assistant",
              content: reply,
              timestamp: new Date().toLocaleTimeString(),
              quickChips: ["Switch to Provider Tab ↗"],
            };
            this.messages.push(agentMsg);
            this.notifyUpdated();
            return { reply, usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 } };
          }

          let resumeId = this.lastHaltedPhaseId;
          let resumeTitle = "";
          if (state && Array.isArray(state.phases)) {
            if (!resumeId) {
              const incomplete = state.phases.find((p) => p.enabled !== false && p.status !== "completed");
              if (incomplete) {
                resumeId = incomplete.id;
                resumeTitle = incomplete.title;
              } else {
                this.lastHaltedPhaseId = undefined;
                const reply = "🎉 All pipeline phases are already completed! To re-run the entire pipeline from scratch, click 'Restart Pipeline' or type 'restart'.";
                if (onToken) onToken(reply);
                const agentMsg: AgentMessage = {
                  id: "msg_" + Date.now() + "_a",
                  role: "assistant",
                  content: reply,
                  timestamp: new Date().toLocaleTimeString(),
                  quickChips: ["🔄 Restart Pipeline", "Review docs/manuscript.md ↗"],
                };
                this.messages.push(agentMsg);
                await this.logAgentTurn(userText, reply);
                this.notifyUpdated();
                return { reply, usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 } };
              }
            } else {
              const found = state.phases.find((p) => p.id === resumeId);
              if (found) resumeTitle = found.title;
            }
          }

          const targetDisplay = resumeId ? `Phase ${resumeId}${resumeTitle ? ` (${resumeTitle})` : ""}` : "the autonomous pipeline";
          const reply = `🚀 **Resuming Pipeline Execution**: Verification passed. Continuing ${targetDisplay}...`;
          if (onToken) onToken(reply);
          const agentMsg: AgentMessage = {
            id: "msg_" + Date.now() + "_a",
            role: "assistant",
            content: reply,
            timestamp: new Date().toLocaleTimeString(),
          };
          this.messages.push(agentMsg);
          this.lastHaltedPhaseId = undefined;
          this.lastSuggestedContrast = undefined;
          await this.triggerResume(resumeId);
          await this.logAgentTurn(userText, reply);
          this.notifyUpdated();
          return { reply, usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 } };
        }
      }

      // 4. Open-ended conversational or scientific query: verify API key before calling LLM
      const cfg = this.client.getConfig();
      if (cfg.provider !== "ollama" && !cfg.apiKey) {
        const reply = "⚠️ **API Key Required**: To chat with the Live Agent on open-ended scientific topics, please configure an API Key in the **Provider** tab.";
        if (onToken) onToken(reply);
        const agentMsg: AgentMessage = {
          id: "msg_" + Date.now() + "_a",
          role: "assistant",
          content: reply,
          timestamp: new Date().toLocaleTimeString(),
          quickChips: ["Switch to Provider Tab ↗"],
        };
        this.messages.push(agentMsg);
        await this.logAgentTurn(userText, reply);
        this.notifyUpdated();
        return { reply, usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 } };
      }

      const systemPrompt = await this.buildSystemPrompt();

      // Convert conversation history (limit to last 16 turns to keep context snappy)
      const recentMessages = this.messages.slice(-16);
      const chatMessages: ChatMessage[] = recentMessages.map((m) => ({
        role: m.role,
        content: m.content,
      }));

      let accumulatedContent = "";
      const tools = this.getAgentTools();

      const isThinkingQuery =
        /\b(?:reason|synthesize|corroborate|biological mechanism|pathway analysis|deep hypothesis|biochemical insight)\b/i.test(userText) ||
        userText.startsWith("@reasoner") ||
        userText.startsWith("@advisor");

      const isToolActionQuery =
        /\b(?:run|execute|start|resume|trigger|update|set|change|switch|modify|create follow-on|re-run|import|clean|export|write code)\b/i.test(userText) ||
        userText.startsWith("@toolrunner");

      const activeRole: LLMRole = isThinkingQuery
        ? "reasoner"
        : isToolActionQuery
          ? "toolRunner"
          : "utility";
      const chatClient = this.client.forRole(activeRole);

      const activeChatCfg = chatClient.getConfig();
      const roleLabel =
        activeRole === "reasoner"
          ? "Tier 3 Reasoner"
          : activeRole === "toolRunner"
            ? "Tier 2 ToolRunner"
            : "Tier 1 Utility";
      console.log(`[AgentService] Sending query to ${activeChatCfg.provider} (${activeChatCfg.model}) [${roleLabel}]...`);
      const response = await chatClient.chat({
        system: systemPrompt,
        messages: chatMessages,
        tools: tools,
        onToken: (chunk: string) => {
          if (this.abortRequested) return;
          accumulatedContent += chunk;
          if (onToken) onToken(chunk);
        },
      });

      // Execute tool calls if returned
      let executedActionSummary = "";
      let pipelineTriggered = false;
      let resumePhaseId: string | undefined = this.lastHaltedPhaseId;

      if (response.tool_calls && response.tool_calls.length > 0) {
        for (const tc of response.tool_calls) {
          try {
            switch (tc.name) {
              case "update_experiment_parameters": {
                if (tc.args?.pathToDataFile) {
                  await this.experimentManager.setParameter("PATH_TO_DATA_FILE", tc.args.pathToDataFile);
                  executedActionSummary += `\n• Updated \`PATH_TO_DATA_FILE\` to \`${tc.args.pathToDataFile}\``;
                }
                if (tc.args?.platform) {
                  await this.experimentManager.setParameter("PLATFORM", tc.args.platform);
                  executedActionSummary += `\n• Updated \`PLATFORM\` to \`${tc.args.platform}\``;
                }
                if (tc.args?.analyte) {
                  await this.experimentManager.setParameter("ANALYTE", tc.args.analyte);
                  executedActionSummary += `\n• Updated \`ANALYTE\` to \`${tc.args.analyte}\``;
                }
                break;
              }
              case "update_experiment_description": {
                if (tc.args?.description) {
                  await this.experimentManager.setDescription(tc.args.description);
                  executedActionSummary += "\n• Updated Section 2 Experimental Hypothesis & Study Design";
                }
                break;
              }
              case "update_sample_renaming": {
                if (tc.args?.sampleMapping) {
                  await this.experimentManager.setSampleRenamingMap(tc.args.sampleMapping);
                  executedActionSummary += "\n• Configured Sample Group Renaming & Pooling Map in Section 3.D";
                  pipelineTriggered = true;
                }
                break;
              }
              case "update_target_contrasts": {
                if (Array.isArray(tc.args?.contrasts) && tc.args.contrasts.length > 0) {
                  await this.experimentManager.setTargetContrasts(tc.args.contrasts);
                  executedActionSummary += `\n• Configured Target Contrasts: ${tc.args.contrasts.join(", ")} in Section 3.E`;
                  pipelineTriggered = true;
                }
                break;
              }
              case "flag_batch_confounding": {
                await this.experimentManager.setBatchConfoundingDetected(tc.args?.detected !== false, tc.args?.rationale);
                executedActionSummary += `\n• Set Batch Confounding Detected to \`${tc.args?.detected !== false ? "TRUE" : "FALSE"}\` in Section 3.F`;
                pipelineTriggered = true;
                break;
              }
              case "authorize_batch_confounding": {
                await this.experimentManager.setBatchConfounding(tc.args?.authorized !== false);
                executedActionSummary += `\n• Set Proceed With Potential Batch Confounding to \`${tc.args?.authorized !== false ? "TRUE" : "FALSE"}\` in Section 3.F`;
                pipelineTriggered = true;
                break;
              }
              case "set_imputation_strategy": {
                const finalMethod = await this.experimentManager.setImputationStrategy(tc.args?.method, tc.args?.confirmed !== false);
                executedActionSummary += `\n• Configured Imputation Strategy to \`${finalMethod}\` (Confirmed: \`${tc.args?.confirmed !== false ? "TRUE" : "FALSE"}\`) in Section 3.C`;
                pipelineTriggered = true;
                break;
              }
              case "set_normalization_strategy": {
                const normCfg = await this.experimentManager.setNormalizationStrategy(tc.args?.methods, tc.args?.subsetFilter);
                executedActionSummary += `\n• Configured Normalization Strategy to \`${normCfg.methods}\` (Subset Filter: \`${normCfg.subsetFilter}\`) in Section 3.B`;
                pipelineTriggered = true;
                break;
              }
              case "start_or_resume_pipeline":
              case "resume_pipeline": {
                pipelineTriggered = true;
                const chosen = tc.args?.fromPhase || tc.args?.phaseId;
                if (chosen) resumePhaseId = chosen;
                executedActionSummary += `\n• Resuming autonomous pipeline (${tc.args?.reason || "User requested"})`;
                break;
              }
              case "restart_pipeline": {
                await this.triggerRestart();
                executedActionSummary += `\n• Restarted autonomous pipeline from scratch (${tc.args?.reason || "User requested"})`;
                break;
              }
              case "stop_pipeline": {
                await this.triggerStop();
                executedActionSummary += `\n• Paused autonomous pipeline (${tc.args?.reason || "User requested"})`;
                break;
              }
              case "get_pipeline_status": {
                executedActionSummary += `\n• Queried pipeline execution status`;
                break;
              }
            }
          } catch (toolErr) {
            console.error(`[AgentService] Error executing tool ${tc.name}:`, toolErr);
          }
        }
      }

      // Check next onboarding step if missing
      const postSpec = await this.experimentManager.readSpec();
      let followUpQuestion = "";
      let followUpChips: string[] = [];

      if (postSpec.missingInitialFields.length > 0) {
        const nextMissing = postSpec.missingInitialFields[0];
        if (nextMissing === "PLATFORM") {
          followUpQuestion = "\n\nCould you also specify which mass spectrometry search platform generated this data?";
          followUpChips = ["ProteomeDiscoverer", "MaxQuant", "DIA-NN", "Spectronaut", "FragPipe", "tidyproteomics"];
        } else if (nextMissing === "ANALYTE") {
          followUpQuestion = "\n\nIs this dataset measuring `proteins` or `peptides`?";
          followUpChips = ["proteins", "peptides"];
        } else if (nextMissing === "DESCRIPTION") {
          followUpQuestion = "\n\nCould you briefly share your biological hypothesis or comparison model? *(e.g. treatment vs vehicle, knockout vs control)*";
        }
      } else if (executedActionSummary && !pipelineTriggered) {
        followUpQuestion = "\n\n🎉 **All dataset parameters and study description are set up in `docs/experiment.md`!**\n\nReady to start the autonomous analysis pipeline?";
        followUpChips = ["⚡ Yes, Start Pipeline", "Review docs/experiment.md ↗"];
      }

      let finalReply = accumulatedContent;
      if (!finalReply && response.content) {
        finalReply = response.content;
      }
      if (executedActionSummary && !finalReply.includes("docs/experiment.md")) {
        finalReply = (finalReply ? finalReply + "\n\n" : "") + `💾 **Updated \`docs/experiment.md\`:**${executedActionSummary}`;
      }
      if (followUpQuestion && !finalReply.toLowerCase().includes("pipeline?") && !finalReply.toLowerCase().includes("platform")) {
        finalReply += followUpQuestion;
      }

      if (this.abortRequested) {
        finalReply += "\n\n*(Agent response cancelled by user)*";
      }

      const agentMsgId = "msg_" + Date.now() + "_a";
      const agentTimestamp = new Date().toLocaleTimeString();
      const agentMsg: AgentMessage = {
        id: agentMsgId,
        role: "assistant",
        content: finalReply,
        timestamp: agentTimestamp,
        quickChips: followUpChips.length > 0 ? followUpChips : undefined,
      };
      this.messages.push(agentMsg);

      await this.logAgentTurn(userText, finalReply, response.usage);

      if (pipelineTriggered) {
        if (this.getPipelineState) {
          try {
            const state = await this.getPipelineState();
            if (state && Array.isArray(state.phases)) {
              if (resumePhaseId) {
                const phaseObj = state.phases.find((p) => p.id === resumePhaseId);
                if (phaseObj && phaseObj.status === "completed") {
                  const incomplete = state.phases.find((p) => p.enabled !== false && p.status !== "completed");
                  resumePhaseId = incomplete ? incomplete.id : undefined;
                }
              }
            }
          } catch { }
        }
        this.lastHaltedPhaseId = undefined;
        this.lastSuggestedContrast = undefined;
        this.triggerResume(resumePhaseId).catch((err) => {
          console.error("[AgentService] Error running pipeline after agent resolution:", err);
        });
      }

      this.notifyUpdated();

      return {
        reply: finalReply,
        usage: response.usage,
        role: activeRole,
      };
    } finally {
      this.isBusy = false;
      this.abortRequested = false;
    }
  }

  private async logAgentTurn(userText: string, agentReply: string, usage?: TokenUsage): Promise<void> {
    if (!this.workspaceRoot) return;
    try {
      const legacyLogDir = path.join(this.workspaceRoot, "logs", "advisor");
      const logDir = path.join(this.workspaceRoot, "logs", "agent");
      if (fsSync.existsSync(legacyLogDir) && !fsSync.existsSync(logDir)) {
        await fs.rename(legacyLogDir, logDir).catch(() => { });
      }
      if (!fsSync.existsSync(logDir)) {
        await fs.mkdir(logDir, { recursive: true });
      }
      const logFile = path.join(logDir, "chat.md");
      const d = new Date().toISOString();
      const tokensInfo = usage ? ` *(Tokens: ${usage.totalTokens || 0})*` : "";
      const entry = `\n\n### [${d}] User:\n${userText}\n\n### [${d}] Agent${tokensInfo}:\n${agentReply}\n\n---\n`;

      if (!fsSync.existsSync(logFile)) {
        const header = `# TidyProteomics Agent Chat Trace\n\nThis log records consultative dialogues between the user and the TidyProteomics Agent.\n\n---\n`;
        await fs.writeFile(logFile, header + entry, "utf-8");
      } else {
        await fs.appendFile(logFile, entry, "utf-8");
      }
    } catch (err) {
      console.error("[AgentService] Error logging agent turn:", err);
    }
  }

  private logAdvisorTurn = (userText: string, reply: string, usage?: TokenUsage) => this.logAgentTurn(userText, reply, usage);
  private getAdvisorTools = () => this.getAgentTools();
}

export { AgentService as AdvisorService };
