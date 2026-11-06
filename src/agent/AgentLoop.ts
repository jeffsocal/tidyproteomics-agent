import * as fs from "fs/promises";
import * as fsSync from "fs";
import * as path from "path";
import { ChatMessage, TokenUsage, ToolCall } from "../types";
import { ContextBundle } from "./ContextBuilder";
import { ToolRegistry } from "../tools/ToolRegistry";
import { ProviderClient } from "../llm/ProviderClient";
import { ChatLogger } from "./ChatLogger";
import { canonicalizeImputationMethod, verifyWorkspaceMethodIdentity } from "../evaluation/check_integrity";

export interface LoopResult {
  success: boolean;
  isBlocked?: boolean;
  summary: string;
  tokensUsed: TokenUsage;
  phaseName: string;
  turnCount: number;
}

export interface AgentLoopState {
  phaseName: string;
  phaseTitle: string;
  turn: number;
  maxTurns: number;
  messages: ChatMessage[];
  totalUsage: TokenUsage;
  isComplete: boolean;
  completedSummary?: string;
  startTimeMs: number;
}

export class AgentLoop {
  private messages: ChatMessage[] = [];
  private totalUsage: TokenUsage = {
    promptTokens: 0,
    completionTokens: 0,
    totalTokens: 0,
    cachedPromptTokens: 0,
  };
  private currentTurn = 0;
  private currentMaxTurns = 30;
  private startTimeMs = 0;
  private isComplete = false;
  private completedSummary?: string;
  private isExplicitlyAborted = false;

  constructor(
    private phaseName: string,
    private phaseTitle: string,
    private client: ProviderClient,
    private tools: ToolRegistry,
    private context: ContextBundle,
    private onProgress: (event: {
      type: "thought" | "tool_start" | "tool_end" | "text" | "tokens";
      data: any;
    }) => void,
    private chatLogger?: ChatLogger,
    private isCancelled?: () => boolean,
    initialState?: AgentLoopState,
    private abortSignal?: AbortSignal
  ) {
    if (initialState) {
      this.currentTurn = initialState.turn;
      this.currentMaxTurns = initialState.maxTurns;
      this.messages = [...initialState.messages];
      this.totalUsage = { ...initialState.totalUsage };
      this.startTimeMs = initialState.startTimeMs || Date.now();
      this.isComplete = initialState.isComplete;
      this.completedSummary = initialState.completedSummary;
    }
  }

  public getTotalUsage(): TokenUsage {
    return { ...this.totalUsage };
  }

  public getState(): AgentLoopState {
    return {
      phaseName: this.phaseName,
      phaseTitle: this.phaseTitle,
      turn: this.currentTurn,
      maxTurns: this.currentMaxTurns,
      messages: this.messages,
      totalUsage: { ...this.totalUsage },
      isComplete: this.isComplete,
      completedSummary: this.completedSummary,
      startTimeMs: this.startTimeMs,
    };
  }

  public abort() {
    this.isExplicitlyAborted = true;
  }

  public isAborted(): boolean {
    return this.checkCancelled();
  }

  private checkCancelled(): boolean {
    return (
      this.isExplicitlyAborted ||
      (this.abortSignal?.aborted ?? false) ||
      (this.isCancelled ? this.isCancelled() : false)
    );
  }

  private getCheckpointStatePath(): string {
    const wsRoot = this.tools.getWorkspaceRoot() || process.cwd();
    const tag = path.basename(this.phaseName).replace(/\.md$/i, "").toLowerCase();
    return path.join(wsRoot, "logs", tag, "checkpoint_state.json");
  }

  public async saveCheckpointState(isComplete = false, completedSummary?: string): Promise<void> {
    try {
      this.isComplete = isComplete;
      if (completedSummary) this.completedSummary = completedSummary;
      const filePath = this.getCheckpointStatePath();
      await fs.mkdir(path.dirname(filePath), { recursive: true });
      const stateData = this.getState();
      await fs.writeFile(filePath, JSON.stringify(stateData, null, 2), "utf-8");
    } catch (err) {
      console.warn(`[AgentLoop] Failed to save checkpoint state for ${this.phaseName}:`, err);
    }
  }

  public static async loadCheckpointState(wsRoot: string, phaseName: string): Promise<AgentLoopState | null> {
    try {
      const tag = path.basename(phaseName).replace(/\.md$/i, "").toLowerCase();
      const filePath = path.join(wsRoot, "logs", tag, "checkpoint_state.json");
      if (fsSync.existsSync(filePath)) {
        const content = await fs.readFile(filePath, "utf-8");
        return JSON.parse(content) as AgentLoopState;
      }

      // Fallback: Check if logs/<tag>/chat.md exists and parse it to re-hydrate the trajectory
      const chatMdPath = path.join(wsRoot, "logs", tag, "chat.md");
      if (fsSync.existsSync(chatMdPath)) {
        const chatContent = await fs.readFile(chatMdPath, "utf-8");
        const parsed = AgentLoop.parseChatMd(chatContent, phaseName);
        if (parsed) {
          // Persist reconstructed state so subsequent loads are immediate
          try {
            await fs.mkdir(path.dirname(filePath), { recursive: true });
            await fs.writeFile(filePath, JSON.stringify(parsed, null, 2), "utf-8");
          } catch (_) {}
          return parsed;
        }
      }

      return null;
    } catch {
      return null;
    }
  }

  public static parseChatMd(chatContent: string, phaseName: string): AgentLoopState | null {
    if (!chatContent || typeof chatContent !== "string") return null;

    // 1. Phase Title
    let phaseTitle = phaseName;
    const titleMatch = chatContent.match(/Phase (?:Start|FAILED|COMPLETED):\s*([^\n\r]+)/i);
    if (titleMatch) {
      phaseTitle = titleMatch[1].trim();
    }

    // 2. Is Complete & Summary
    const isComplete = /Phase COMPLETED/i.test(chatContent);
    let completedSummary: string | undefined;
    const summaryMatch = chatContent.match(/\*\*Summary\*\*:\s*\n([\s\S]*?)(?:\n---|\n###|$)/i);
    if (summaryMatch) {
      completedSummary = summaryMatch[1].trim();
    }

    // 3. Turns
    let maxTurn = 0;
    const turnMatches = [...chatContent.matchAll(/Agent \(Turn\s+(\d+)\)/gi)];
    for (const tm of turnMatches) {
      const t = parseInt(tm[1], 10);
      if (t > maxTurn) maxTurn = t;
    }
    const totalTurnsMatch = chatContent.match(/\*\*Total Turns\*\*:\s*(\d+)/i);
    if (totalTurnsMatch) {
      const t = parseInt(totalTurnsMatch[1], 10);
      if (t > maxTurn) maxTurn = t;
    }

    // 4. Cumulative Usage
    let totalUsage: TokenUsage = { promptTokens: 0, completionTokens: 0, totalTokens: 0, cachedPromptTokens: 0 };
    const cumMatch = chatContent.match(/(?:Cumulative Tokens|\*\*Cumulative Tokens\*\*):\s*Total:\s*\*\*([\d,]+)\*\*\s*\|\s*Prompt:\s*([\d,]+)\s*\|\s*Completion:\s*([\d,]+)(?:\s*\|\s*Cached:\s*([\d,]+))?/i);
    if (cumMatch) {
      totalUsage = {
        totalTokens: parseInt(cumMatch[1].replace(/,/g, ""), 10),
        promptTokens: parseInt(cumMatch[2].replace(/,/g, ""), 10),
        completionTokens: parseInt(cumMatch[3].replace(/,/g, ""), 10),
        cachedPromptTokens: cumMatch[4] ? parseInt(cumMatch[4].replace(/,/g, ""), 10) : 0,
      };
    }

    // 5. Start Time
    let startTimeMs = Date.now();
    const startMatch = chatContent.match(/\[([\d\-:T\.Z]+)\]\s+Phase Start:/i);
    if (startMatch) {
      const parsed = Date.parse(startMatch[1]);
      if (!isNaN(parsed)) startTimeMs = parsed;
    }

    // 6. Messages
    const messages: ChatMessage[] = [
      {
        role: "user",
        content: `[Phase Directive]: Re-hydrated trajectory for phase ${phaseName}`,
        turn: 0,
      },
    ];

    const turnRegex = /###\s+\[([\d\-:T\.Z]+)\]\s+Agent \(Turn (\d+)\)([\s\S]*?)(?=(?:###\s+\[[\d\-:T\.Z]+\]\s+(?:Agent|Phase)|$))/g;
    let match;
    while ((match = turnRegex.exec(chatContent)) !== null) {
      const turnNum = parseInt(match[2], 10);
      const body = match[3];

      const toolResultSplitIndex = body.search(/####\s+\[/);
      const assistantPart = toolResultSplitIndex !== -1 ? body.slice(0, toolResultSplitIndex) : body;
      const toolResultsPart = toolResultSplitIndex !== -1 ? body.slice(toolResultSplitIndex) : "";

      const toolCalls: ToolCall[] = [];
      const tcRegex = /-\s+\*\*`([^`]+)`\*\*\s*\(id:\s*`([^`]+)`\)\s*```json\s*([\s\S]*?)\s*```/g;
      let tcMatch;
      while ((tcMatch = tcRegex.exec(assistantPart)) !== null) {
        let args = {};
        try {
          args = JSON.parse(tcMatch[3]);
        } catch (_) {}
        toolCalls.push({
          name: tcMatch[1],
          id: tcMatch[2],
          args,
        });
      }

      let assistantText = assistantPart
        .replace(/\*\*Tool Calls\*\*:\s*[\s\S]*?(?=(?:> \*\*Metrics\*\*|$))/i, "")
        .replace(/> \*\*Metrics\*\*:[^\n\r]*/gi, "")
        .trim();

      if (assistantText.length > 0 || toolCalls.length > 0) {
        messages.push({
          role: "assistant",
          content: assistantText,
          tool_calls: toolCalls.length > 0 ? toolCalls : undefined,
          turn: turnNum,
        });
      }

      if (toolResultsPart) {
        const trRegex = /####\s+\[[\d\-:T\.Z]+\]\s+Tool Result:\s*`([^`]+)`\s*\[(SUCCESS|FAILED)\]\s*\(id:\s*`([^`]+)`\)([\s\S]*?)(?=(?:####\s+\[|$))/g;
        let trMatch;
        const seenCallIds = new Set<string>();
        while ((trMatch = trRegex.exec(toolResultsPart)) !== null) {
          const tName = trMatch[1];
          const tCallId = trMatch[3];
          let tResultBody = trMatch[4].trim();

          const codeBlockMatch = tResultBody.match(/^```(?:\w+)?\n([\s\S]*?)\n```$/m);
          if (codeBlockMatch) {
            tResultBody = codeBlockMatch[1];
          }

          seenCallIds.add(tCallId);
          messages.push({
            role: "tool",
            tool_name: tName,
            tool_call_id: tCallId,
            content: tResultBody,
          });
        }

        for (const tc of toolCalls) {
          if (!seenCallIds.has(tc.id)) {
            messages.push({
              role: "tool",
              tool_name: tc.name,
              tool_call_id: tc.id,
              content: `Tool ${tc.name} executed.`,
            });
          }
        }
      } else if (toolCalls.length > 0) {
        for (const tc of toolCalls) {
          messages.push({
            role: "tool",
            tool_name: tc.name,
            tool_call_id: tc.id,
            content: `Tool ${tc.name} executed.`,
          });
        }
      }
    }

    return {
      phaseName,
      phaseTitle,
      turn: maxTurn,
      maxTurns: Math.max(maxTurn, 30),
      messages,
      totalUsage,
      isComplete,
      completedSummary,
      startTimeMs,
    };
  }

  public async run(maxTurns = 30): Promise<LoopResult> {
    this.startTimeMs = Date.now();
    this.currentMaxTurns = maxTurns;
    this.currentTurn = 0;
    this.messages = [];
    this.totalUsage = {
      promptTokens: 0,
      completionTokens: 0,
      totalTokens: 0,
      cachedPromptTokens: 0,
    };

    // Set active phase on tools for log mirroring and phase scoping
    this.tools.setActivePhase(this.phaseName);

    // 1. Initialize the isolated sub-loop conversation with the dynamic phase directive
    this.messages.push({
      role: "user",
      content: this.context.phasePrompt,
      turn: 0,
    });

    if (this.chatLogger) {
      this.chatLogger.setPhase(this.phaseName);
      const cfg = this.client.getConfig();
      await this.chatLogger.logPhaseStart({
        phaseTitle: this.phaseTitle || this.phaseName,
        phaseFileName: this.phaseName,
        model: cfg.model,
        provider: cfg.provider,
        role: cfg.role || "toolRunner",
        systemPromptFiles: [
          "agent/PROTOCOL.md",
        ],
        inputPromptFiles: [
          this.phaseName.includes("/") ? this.phaseName : `analysis/${this.phaseName}`,
          ...(this.context.phaseSkillFiles && this.context.phaseSkillFiles.length > 0
            ? this.context.phaseSkillFiles
            : []),
          "docs/experiment.md",
          "Executive Blackboard (Active State & Prior Summary)",
          "docs/llm.md",
        ],
      });
    }

    return this.executeLoop();
  }

  public async continue(additionalTurns = 10): Promise<LoopResult> {
    const priorTurn = this.currentTurn;
    this.currentMaxTurns = this.currentTurn + Math.max(1, additionalTurns);
    if (!this.startTimeMs) this.startTimeMs = Date.now();

    // If turn 0 was a placeholder from re-hydration, update it with the rich context prompt if available
    if (this.messages.length > 0 && this.messages[0].role === "user" && this.context?.phasePrompt) {
      if (this.messages[0].content.startsWith("[Phase Directive]: Re-hydrated")) {
        this.messages[0].content = this.context.phasePrompt;
      }
    }

    // Set active phase on tools for log mirroring and phase scoping
    this.tools.setActivePhase(this.phaseName);

    if (this.chatLogger) {
      this.chatLogger.setPhase(this.phaseName);
      await this.chatLogger.logPhaseResume({
        turn: priorTurn,
        newMaxTurns: this.currentMaxTurns,
        additionalTurns,
      });
    }

    // Check disk deliverable status to summarize for the model
    const gateErrors = await this.verifyPhaseGateDeliverables(this.phaseName);
    const gateStatusNotice =
      gateErrors.length === 0
        ? "✓ ALL REQUIRED DELIVERABLES ARE ALREADY PRESENT ON DISK AND NON-EMPTY."
        : `Pending deliverables on disk:\n${gateErrors.map((e) => `• ${e}`).join("\n")}`;

    const continuationDirective = [
      `⚠️ [SYSTEM NOTICE - PHASE CONTINUATION]:`,
      `You have been granted ${additionalTurns} additional turns to complete phase '${this.phaseTitle || this.phaseName}'.`,
      `- Resumed at Turn: ${priorTurn}`,
      `- Current Turn Budget: ${priorTurn + 1} to ${this.currentMaxTurns}`,
      `- Gate Status: ${gateStatusNotice}`,
      `Cease open-ended exploratory actions. Verify remaining files or call complete_phase immediately to finalize this phase.`,
    ].join("\n");

    this.messages.push({
      role: "user",
      content: continuationDirective,
      turn: priorTurn,
    });

    this.onProgress({
      type: "thought",
      data: `Resuming phase '${this.phaseName}' at turn ${priorTurn + 1}/${this.currentMaxTurns} (+${additionalTurns} turns granted)...`,
    });

    return this.executeLoop();
  }

  private async executeLoop(): Promise<LoopResult> {
    const startTimeMs = this.startTimeMs || Date.now();
    let completedSummary = "";
    let consecutiveNoToolTurns = 0;
    let consecutiveTransitionAnnouncements = 0;
    let consecutiveEmptyCompletions = 0;
    let consecutiveCommandFailures = 0;
    let lastFailedCommand = "";
    let consecutiveToolFailures = 0;
    let lastFailedToolName = "";
    let consecutiveIdenticalCalls = 0;
    let lastToolCallSignature = "";
    let totalSearchCalls = 0;

    while (this.currentTurn < this.currentMaxTurns) {
      if (this.checkCancelled()) {
        const stopSummary = "Execution stopped by user.";
        await this.saveCheckpointState(false, stopSummary);
        if (this.chatLogger) {
          const durationSeconds = Math.round((Date.now() - startTimeMs) / 1000);
          await this.chatLogger.logPhaseEnd({
            phaseTitle: this.phaseTitle || this.phaseName,
            phaseFileName: this.phaseName,
            success: false,
            summary: stopSummary,
            durationSeconds,
            tokensUsed: this.totalUsage,
            turnCount: this.currentTurn,
          });
        }
        return {
          success: false,
          summary: stopSummary,
          tokensUsed: this.totalUsage,
          phaseName: this.phaseName,
          turnCount: this.currentTurn,
        };
      }

      this.currentTurn++;
      const turn = this.currentTurn;
      const maxTurns = this.currentMaxTurns;
      this.onProgress({ type: "thought", data: `Starting Turn ${turn}/${maxTurns}...` });

      // Low-turn alert when 5 turns remain to guide model to finalize deliverables
      if (turn === maxTurns - 5) {
        this.messages.push({
          role: "user",
          content: `⚠️ [SYSTEM NOTICE - TURN BUDGET]: 5 turns remaining in this phase (${turn}/${maxTurns}). Please cease open-ended exploration, finalize all required files, verify checkpoint gates, and call complete_phase.`,
        });
        this.onProgress({
          type: "thought",
          data: `[Turn Budget Notice]: 5 turns remaining in this phase (${turn}/${maxTurns}).`,
        });
      } else if (turn === maxTurns - 2) {
        this.messages.push({
          role: "user",
          content: `🚨 [CRITICAL TURN BUDGET ALERT]: Only 2 turns remaining (${turn}/${maxTurns}). Immediately write/finalize your report and call complete_phase now.`,
        });
        this.onProgress({
          type: "thought",
          data: `[Critical Budget Alert]: 2 turns remaining (${turn}/${maxTurns}). Finalize and call complete_phase.`,
        });
      }

      // Call LLM with the persistent system prompt (which gets cached) and the local messages
      let response;
      const maxRetries = 2;
      let attempt = 0;
      let lastError: any = null;

      while (attempt <= maxRetries) {
        attempt++;
        if (this.checkCancelled()) {
          break;
        }

        try {
          response = await this.client.chat({
            system: this.context.systemPrompt,
            messages: this.messages,
            tools: this.tools.getDefinitions(this.phaseName, this.context?.phaseContent),
            onToken: (text) => {
              this.onProgress({ type: "text", data: text });
            },
            signal: this.abortSignal,
          });
          lastError = null;
          break; // Success!
        } catch (err: any) {
          lastError = err;
          if (err.isAborted || this.checkCancelled()) {
            break;
          }
          const isRetryable =
            err.isRetryable === true ||
            err.isTimeout === true ||
            err.isNetworkError === true ||
            err.name === "TimeoutError" ||
            (err.status === 429) ||
            (err.status >= 500 && err.status <= 504) ||
            /timeout|ETIMEDOUT|ECONNRESET|ECONNREFUSED|ENOTFOUND|ConnectTimeoutError|fetch failed|rate limit|temporar/i.test(
              err.message || ""
            ) ||
            (err.cause &&
              /timeout|ETIMEDOUT|ECONNRESET|ECONNREFUSED|ENOTFOUND|ConnectTimeoutError/i.test(
                (err.cause.name || "") + " " + (err.cause.code || "") + " " + (err.cause.message || "")
              ));

          if (isRetryable && attempt <= maxRetries && !this.checkCancelled()) {
            const backoffMs = attempt * 3000;
            const shortReason = err.message ? (err.message.length > 80 ? err.message.slice(0, 77) + "..." : err.message) : "Network/API glitch";
            this.onProgress({
              type: "thought",
              data: `Turn ${turn} connection/API glitch on attempt ${attempt}/${maxRetries + 1} (${shortReason}). Retrying in ${backoffMs / 1000}s...`,
            });
            await new Promise((r) => setTimeout(r, backoffMs));
            continue;
          }
          break;
        }
      }

      if (!response) {
        const wasCancelled = this.checkCancelled() || (lastError as any)?.isAborted;
        const errorSummary = wasCancelled
          ? "Execution stopped by user."
          : (lastError ? `LLM API Error during turn ${turn}: ${lastError.message}` : "Execution stopped by user.");
        if (this.chatLogger) {
          const durationSeconds = Math.round((Date.now() - startTimeMs) / 1000);
          await this.chatLogger.logPhaseEnd({
            phaseTitle: this.phaseTitle || this.phaseName,
            phaseFileName: this.phaseName,
            success: false,
            summary: errorSummary,
            durationSeconds,
            tokensUsed: this.totalUsage,
            turnCount: turn,
          });
        }

        return {
          success: false,
          summary: errorSummary,
          tokensUsed: this.totalUsage,
          phaseName: this.phaseName,
          turnCount: turn,
        };
      }

      // Accumulate tokens
      this.totalUsage.promptTokens += response.usage.promptTokens;
      this.totalUsage.completionTokens += response.usage.completionTokens;
      this.totalUsage.totalTokens += response.usage.totalTokens;
      this.totalUsage.cachedPromptTokens =
        (this.totalUsage.cachedPromptTokens || 0) + (response.usage.cachedPromptTokens || 0);

      const trimmedContent = (response.content || "").trim();
      const isEmptyResponse = !trimmedContent && (!response.tool_calls || response.tool_calls.length === 0);

      if (isEmptyResponse) {
        consecutiveEmptyCompletions++;
        if (consecutiveEmptyCompletions >= 4) {
          const emptySummary = `Execution halted: Upstream LLM provider returned empty completions 4 consecutive times without content or tool calls.`;
          await this.saveCheckpointState(false, emptySummary);
          if (this.chatLogger) {
            const durationSeconds = Math.round((Date.now() - startTimeMs) / 1000);
            await this.chatLogger.logPhaseEnd({
              phaseTitle: this.phaseTitle || this.phaseName,
              phaseFileName: this.phaseName,
              success: false,
              summary: emptySummary,
              durationSeconds,
              tokensUsed: this.totalUsage,
              turnCount: this.currentTurn,
            });
          }
          return {
            success: false,
            summary: emptySummary,
            tokensUsed: this.totalUsage,
            phaseName: this.phaseName,
            turnCount: this.currentTurn,
          };
        }
        this.onProgress({
          type: "thought",
          data: `⚠️ [Transient API Glitch]: Upstream provider returned empty completion (attempt ${consecutiveEmptyCompletions}/4). Retrying turn ${this.currentTurn}...`,
        });
        await new Promise((r) => setTimeout(r, 2000 * consecutiveEmptyCompletions));
        // Decrement turn so empty provider response does NOT burn turn budget
        this.currentTurn--;
        continue;
      }
      consecutiveEmptyCompletions = 0;

      // Real-time token notification for UI updates
      this.onProgress({
        type: "tokens",
        data: {
          turn: this.currentTurn,
          turnUsage: response.usage,
          totalUsage: { ...this.totalUsage },
        },
      });

      // Append assistant response to local isolated trajectory
      this.messages.push({
        role: "assistant",
        content: response.content,
        tool_calls: response.tool_calls,
        turn: this.currentTurn,
      });

      // Log assistant response to llm_chat.log
      if (this.chatLogger) {
        await this.chatLogger.logAssistantResponse(
          this.currentTurn,
          response.content,
          response.tool_calls,
          response.usage
        );
      }

      // Persist active trajectory state after each turn
      await this.saveCheckpointState(false);

      // Check for output limit truncation
      if (response.truncationDetected) {
        const warnMsg = `Output limit reached (finish_reason: "${response.finishReason || "length"}", tokens: ${response.usage.completionTokens}). Generation was truncated.`;
        this.onProgress({
          type: "thought",
          data: warnMsg,
        });
        if (this.chatLogger) {
          await this.chatLogger.logTruncationWarning(
            turn,
            response.finishReason || "length",
            response.usage.completionTokens
          );
        }
      }

      // Check if complete_phase or fail_phase tool was called or if finished
      if (response.tool_calls && response.tool_calls.length > 0) {
        consecutiveNoToolTurns = 0;
        consecutiveTransitionAnnouncements = 0;
        for (const tc of response.tool_calls) {
          if (this.checkCancelled()) {
            break;
          }

          // Guard: Reject malformed tool calls whose name is not registered in ToolRegistry (e.g. contrast string 's3/s1')
          if (!this.tools.hasTool(tc.name)) {
            const availableNames = this.tools.getDefinitions().map((t) => t.name).join(", ");
            const invalidMsg = `❌ [REJECTED TOOL INVOCATION]: Tool '${tc.name}' does not exist in the active tool registry. Available tools: ${availableNames}`;
            this.onProgress({
              type: "tool_end",
              data: { name: tc.name, result: invalidMsg, isError: true },
            });
            this.messages.push({
              role: "tool",
              tool_name: tc.name,
              tool_call_id: tc.id,
              content: invalidMsg,
            });
            continue;
          }

          this.onProgress({
            type: "tool_start",
            data: { name: tc.name, args: tc.args },
          });

          // Execute tool
          const result = await this.tools.execute(tc.name, tc.args);

          this.onProgress({
            type: "tool_end",
            data: { name: tc.name, result: result.content, isError: result.isError },
          });

          // Protect conversation context from runaway dumps (preserve full context for intentional file reads)
          let toolMessageContent = truncateWideTabularLines(result.content);
          let maxChars = 24000;
          if (tc.name === "read_file") {
            // read_file is intentional and bounded by startLine/maxLines; give generous headroom
            maxChars = 60000;
          } else if (tc.name === "execute_command") {
            // Guard against runaway stdout while keeping substantial head and tail diagnostics
            maxChars = 32000;
          } else if ([
            "list_directory",
            "check_checkpoint_gate",
            "tpa_health",
            "tpa_operations",
            "tpa_export_state",
            "file_exists",
          ].includes(tc.name)) {
            maxChars = 8000;
          }

          if (toolMessageContent && toolMessageContent.length > maxChars) {
            const headChars = Math.floor(maxChars * 0.55);
            const tailChars = Math.floor(maxChars * 0.35);
            const head = toolMessageContent.slice(0, headChars);
            const tail = toolMessageContent.slice(-tailChars);
            const omitted = toolMessageContent.length - (headChars + tailChars);
            toolMessageContent = `${head}\n\n... [Output truncated: ${omitted.toLocaleString()} characters omitted to preserve context economy. See complete output in workspace/logs/ or inspect with 'read_file'] ...\n\n${tail}`;
          }

          // 1. Loop Detector: Catch identical tool calls repeated endlessly
          const currentCallSig = `${tc.name}:${JSON.stringify(tc.args || {})}`;
          if (currentCallSig === lastToolCallSignature) {
            consecutiveIdenticalCalls++;
            if (consecutiveIdenticalCalls >= 3) {
              toolMessageContent += `\n\n⚠️ [LOOP DETECTOR ADVISORY]: Tool '${tc.name}' has been invoked ${consecutiveIdenticalCalls} consecutive times with identical parameters. DO NOT repeat identical tool calls without changing parameters or progressing the workflow. Advance to the next phase objective or call 'fail_phase' if blocked.`;
            }
            if (consecutiveIdenticalCalls >= 5) {
              const autoFailReason = `Loop Detector Tripped: Tool '${tc.name}' invoked 5 consecutive times with identical parameters without progress. Execution halted to prevent runaway turn exhaustion.`;
              const actionable = `Inspect tool parameters and phase instructions. Do not invoke the identical tool call in a loop.`;
              const failSummary = `[Failed] ${autoFailReason}\n\nActionable Insights:\n${actionable}`;
              const durationSeconds = Math.round((Date.now() - startTimeMs) / 1000);

              if (this.chatLogger) {
                await this.chatLogger.logPhaseEnd({
                  phaseTitle: this.phaseTitle || this.phaseName,
                  phaseFileName: this.phaseName,
                  success: false,
                  summary: failSummary,
                  durationSeconds,
                  tokensUsed: this.totalUsage,
                  turnCount: turn,
                });
              }

              return {
                success: false,
                summary: failSummary,
                tokensUsed: this.totalUsage,
                phaseName: this.phaseName,
                turnCount: turn,
              };
            }
          } else {
            consecutiveIdenticalCalls = 1;
            lastToolCallSignature = currentCallSig;
          }

          // Search budget notice to prevent runaway query loops
          if (["web_search", "pubmed_search", "uniprot_search"].includes(tc.name)) {
            totalSearchCalls++;
            if (totalSearchCalls >= 6) {
              toolMessageContent += `\n\n⚠️ [SEARCH BUDGET NOTICE]: ${totalSearchCalls} external search queries have been completed in this phase. You have acquired sufficient biological context. Please cease further search queries and proceed immediately to synthesize findings, generate deliverables ('data/actionable_synthesis.json' if in Phase 09), and author the phase documentation.`;
            }
          }

          // 2. Generalized Circuit Breaker: Track failures across ANY tool (MCP, execute_command, web search, etc.)
          const isToolFailed =
            result.isError ||
            /Command failed with exit code|Execution halted|Error executing tool|Error in [a-zA-Z0-9_]+:|Tool error:/i.test(
              result.content
            );

          if (isToolFailed) {
            consecutiveToolFailures++;
            lastFailedToolName = tc.name;
            if (consecutiveToolFailures >= 3) {
              toolMessageContent += `\n\n⚠️ [CIRCUIT BREAKER ADVISORY]: Tool '${tc.name}' has failed ${consecutiveToolFailures} consecutive times.
DO NOT repeat the identical failing command/tool call without structural fixes:
1. Inspect the error message above carefully to verify arguments, contrast names, or file paths.
2. If using MCP tools (e.g. tpa_export_table, tpa_expression), ensure valid arguments and contrast formatting (e.g. 'treatment/control').
3. If the command or tool cannot succeed after inspection, halt cleanly via 'fail_phase' with actionable insights instead of exhausting turns.`;
            }

            if (consecutiveToolFailures >= 5) {
              const autoFailReason = `Circuit Breaker Tripped: Tool '${lastFailedToolName}' failed 5 consecutive times. Execution halted to prevent runaway turns and token exhaustion.`;
              const actionable = `Inspect logs/${this.phaseName}/console.log and chat.md for the exact error stack trace and parameters before retrying.`;
              const failSummary = `[Failed] ${autoFailReason}\n\nActionable Insights:\n${actionable}`;
              const durationSeconds = Math.round((Date.now() - startTimeMs) / 1000);

              if (this.chatLogger) {
                await this.chatLogger.logPhaseEnd({
                  phaseTitle: this.phaseTitle || this.phaseName,
                  phaseFileName: this.phaseName,
                  success: false,
                  summary: failSummary,
                  durationSeconds,
                  tokensUsed: this.totalUsage,
                  turnCount: turn,
                });
              }

              return {
                success: false,
                summary: failSummary,
                tokensUsed: this.totalUsage,
                phaseName: this.phaseName,
                turnCount: turn,
              };
            }
          } else {
            consecutiveToolFailures = 0;
            lastFailedToolName = "";
          }

          // Circuit breaker: track consecutive execute_command failures
          if (tc.name === "execute_command") {
            const isFailed = result.isError || /Command failed with exit code|Execution halted|Error executing tool/i.test(result.content);
            if (isFailed) {
              consecutiveCommandFailures++;
              lastFailedCommand = String(tc.args?.command || tc.args?.cmd || "");
              if (consecutiveCommandFailures >= 3 && consecutiveToolFailures < 3) {
                toolMessageContent += `\n\n⚠️ [CIRCUIT BREAKER ADVISORY]: 'execute_command' has failed ${consecutiveCommandFailures} consecutive times.
DO NOT repeat the identical failing command without structural fixes:
1. If executing an R script, check loaded packages (e.g. ensure 'library(dplyr)' is present before using filter/arrange verbs to avoid base 'stats::filter' masking).
2. Check that all referenced column names actually exist in the target dataset using 'head -n 2 <table_path>' before referencing them.
3. If the command cannot succeed after inspection, halt cleanly via 'fail_phase' with actionable insights instead of exhausting turns.`;
              }

              if (consecutiveCommandFailures >= 5) {
                const autoFailReason = `Circuit Breaker Tripped: 'execute_command' failed 5 consecutive times (last command: ${lastFailedCommand.slice(0, 120)}). Execution halted to prevent runaway turns and token exhaustion.`;
                const actionable = `Inspect logs/${this.phaseName}/console.log for the exact error stack trace and data schema before retrying.`;
                const failSummary = `[Failed] ${autoFailReason}\n\nActionable Insights:\n${actionable}`;
                const durationSeconds = Math.round((Date.now() - startTimeMs) / 1000);

                if (this.chatLogger) {
                  await this.chatLogger.logPhaseEnd({
                    phaseTitle: this.phaseTitle || this.phaseName,
                    phaseFileName: this.phaseName,
                    success: false,
                    summary: failSummary,
                    durationSeconds,
                    tokensUsed: this.totalUsage,
                    turnCount: turn,
                  });
                }

                return {
                  success: false,
                  summary: failSummary,
                  tokensUsed: this.totalUsage,
                  phaseName: this.phaseName,
                  turnCount: turn,
                };
              }
            } else {
              consecutiveCommandFailures = 0;
              lastFailedCommand = "";
            }
          }

          // Append tool result to messages
          this.messages.push({
            role: "tool",
            tool_call_id: tc.id,
            tool_name: tc.name,
            content: toolMessageContent,
            turn,
          });

          // Log tool result to phase chat log
          if (this.chatLogger) {
            await this.chatLogger.logToolResult(tc.name, tc.id, result.content, result.isError, tc.args);
          }

          if (tc.name === "fail_phase") {
            const failReason = tc.args.reason || "Phase gate or checkpoint failed";
            const actionable = tc.args.actionableInsights || "";

            // Guard against premature Turn 1 aborts unless there was a prior tool error or explicit HITL gate
            const isHitlHalt = /human-in-the-loop|hitl|confirmation required|section 3|checkpoint gate|study design/i.test(
              failReason + " " + actionable
            );
            const hasPriorToolError = this.messages.some(
              (m) => m.role === "tool" && (m.content.includes("[FAILED]") || m.content.toLowerCase().includes("error"))
            );
            if (turn <= 1 && !isHitlHalt && !hasPriorToolError) {
              this.messages.push({
                role: "user",
                content:
                  "[System Policy]: fail_phase cannot be invoked on Turn 1 without an explicit Human-in-the-Loop gate or prior tool error payload. Please execute initial inspection or data loading tools before deciding to halt.",
              });
              this.onProgress({
                type: "thought",
                data: "Turn 1 fail_phase rejected by system policy: no prior tool error or HITL gate.",
              });
              continue;
            }

            const summary = actionable
              ? `[Failed] Pre-flight Gate / Checkpoint: ${failReason}\n\nActionable Insights:\n${actionable}`
              : `[Failed] Pre-flight Gate / Checkpoint: ${failReason}`;
            const durationSeconds = Math.round((Date.now() - startTimeMs) / 1000);

            if (this.chatLogger) {
              await this.chatLogger.logPhaseEnd({
                phaseTitle: this.phaseTitle || this.phaseName,
                phaseFileName: this.phaseName,
                success: false,
                statusTextOverride: isHitlHalt ? "BLOCKED" : "FAILED",
                summary,
                durationSeconds,
                tokensUsed: this.totalUsage,
                turnCount: turn,
              });
            }

            return {
              success: false,
              isBlocked: isHitlHalt,
              summary,
              tokensUsed: this.totalUsage,
              phaseName: this.phaseName,
              turnCount: turn,
            };
          }

          if (tc.name === "complete_phase") {
            const proposedSummary = String(tc.args?.summary || response.content || "");

            // Guard: Check if search tools were called (Issue 11)
            const searchToolsUsed = this.messages.some(
              (m) => m.role === "tool" && (m.tool_name === "pubmed_search" || m.tool_name === "web_search")
            );
            if (searchToolsUsed && (!proposedSummary || proposedSummary.trim().length < 120 || !/claim|query|search|pmid|finding|citation|result|concordance/i.test(proposedSummary))) {
              const searchSummaryError = `❌ [CHECKPOINT GATE ERROR]: Search tools (pubmed_search/web_search) were invoked during this phase, but the complete_phase summary is empty or missing a cited-claim table. A detailed summary specifying queries executed, hit counts, and external cited claims is mandatory.`;
              this.messages.push({
                role: "user",
                content: searchSummaryError,
              });
              this.onProgress({
                type: "thought",
                data: "Checkpoint gate check failed: complete_phase summary missing cited-claim table after search tool execution.",
              });
              continue;
            }

            // Verify mandatory deliverables before allowing phase completion
            const gateErrors = await this.verifyPhaseGateDeliverables(this.phaseName, proposedSummary);
            if (gateErrors.length > 0) {
              const gateWarning = `❌ [CHECKPOINT GATE ERROR]: Cannot complete phase '${this.phaseName}'. Mandatory deliverables are missing or 0-byte:\n${gateErrors.map((e) => `• ${e}`).join("\n")}\nPlease execute the required tools to generate all required deliverables before invoking complete_phase.`;
              this.messages.push({
                role: "user",
                content: gateWarning,
              });
              this.onProgress({
                type: "thought",
                data: `Checkpoint gate check failed for ${this.phaseName}: ${gateErrors.join(", ")}`,
              });
              continue;
            }

            completedSummary = tc.args.summary || response.content;
            const durationSeconds = Math.round((Date.now() - startTimeMs) / 1000);

            await this.saveCheckpointState(true, completedSummary);

            if (this.chatLogger) {
              await this.chatLogger.logPhaseEnd({
                phaseTitle: this.phaseTitle || this.phaseName,
                phaseFileName: this.phaseName,
                success: true,
                summary: completedSummary,
                durationSeconds,
                tokensUsed: this.totalUsage,
                turnCount: this.currentTurn,
              });
            }

            return {
              success: true,
              summary: completedSummary,
              tokensUsed: this.totalUsage,
              phaseName: this.phaseName,
              turnCount: this.currentTurn,
            };
          }
        }
      } else {
        const trimmedContent = (response.content || "").trim();

        // Detect conversational transition phrasing ("Turn 1 complete. Ready for Turn 2", "Let me create the script", etc.)
        const isTransitionAnnouncement =
          /ready for (?:turn|section|step)\s+\d+/i.test(trimmedContent) ||
          /(?:turn|section|step)\s+\d+\s+complete/i.test(trimmedContent) ||
          /proceeding to (?:turn|section|step)/i.test(trimmedContent) ||
          /moving on to (?:turn|section|step)/i.test(trimmedContent) ||
          /(?:next,?\s+)?(?:i will|we will|i'll|we'll)\s+(?:now\s+)?(?:write|create|author|replace|generate|execute|run|implement)/i.test(trimmedContent) ||
          /(?:let me|let's)\s+(?:now\s+)?(?:write|create|author|replace|generate|execute|run|implement|save)\b/i.test(trimmedContent) ||
          /now (?:i have|i'll|i will|that we have).*(?:let me|i will|i'll)\s+(?:write|create|author|replace|generate|execute|run|implement)/i.test(trimmedContent);

        if (isTransitionAnnouncement && consecutiveTransitionAnnouncements < 2) {
          consecutiveTransitionAnnouncements++;
          // Do not increment consecutiveNoToolTurns for benign progress announcements; immediately nudge tool execution
          consecutiveNoToolTurns = 0;
          this.messages.push({
            role: "user",
            content: "[System Directive]: Do not pause or emit conversational announcements or plans between steps. Execute the required tool call (e.g. write_file, replace_file_content, or execute_command) immediately in this turn.",
          });
        } else {
          consecutiveNoToolTurns++;
          // If model didn't call any tools, check if text indicates completion
          if (response.content.includes("PHASE_COMPLETED") || response.content.includes("CHECKPOINT_PASSED")) {
            const durationSeconds = Math.round((Date.now() - startTimeMs) / 1000);
            await this.saveCheckpointState(true, response.content);
            if (this.chatLogger) {
              await this.chatLogger.logPhaseEnd({
                phaseTitle: this.phaseTitle || this.phaseName,
                phaseFileName: this.phaseName,
                success: true,
                summary: response.content,
                durationSeconds,
                tokensUsed: this.totalUsage,
                turnCount: this.currentTurn,
              });
            }

            return {
              success: true,
              summary: response.content,
              tokensUsed: this.totalUsage,
              phaseName: this.phaseName,
              turnCount: this.currentTurn,
            };
          } else if (this.isPhaseFailureOrHalt(response.content)) {
            // Model output text indicating a pre-flight gate failure, blocked phase, or halt directive
            const durationSeconds = Math.round((Date.now() - startTimeMs) / 1000);
            await this.saveCheckpointState(false, response.content);
            if (this.chatLogger) {
              await this.chatLogger.logPhaseEnd({
                phaseTitle: this.phaseTitle || this.phaseName,
                phaseFileName: this.phaseName,
                success: false,
                summary: response.content,
                durationSeconds,
                tokensUsed: this.totalUsage,
                turnCount: this.currentTurn,
              });
            }

            return {
              success: false,
              summary: response.content,
              tokensUsed: this.totalUsage,
              phaseName: this.phaseName,
              turnCount: this.currentTurn,
            };
          } else if (consecutiveNoToolTurns >= 3) {
            // Model repeatedly returned conversational text without tool actions; halt to avoid burning tokens in a loop
            const summary = `Execution halted: Agent stopped calling tools and provided instructions to user:\n\n${response.content}`;
            const durationSeconds = Math.round((Date.now() - startTimeMs) / 1000);
            await this.saveCheckpointState(false, summary);
            if (this.chatLogger) {
              await this.chatLogger.logPhaseEnd({
                phaseTitle: this.phaseTitle || this.phaseName,
                phaseFileName: this.phaseName,
                success: false,
                summary,
                durationSeconds,
                tokensUsed: this.totalUsage,
                turnCount: this.currentTurn,
              });
            }

            return {
              success: false,
              summary,
              tokensUsed: this.totalUsage,
              phaseName: this.phaseName,
              turnCount: this.currentTurn,
            };
          } else if (response.truncationDetected) {
            // If response was truncated and tool call failed to parse, notify the model explicitly
            this.messages.push({
              role: "user",
              content: `[System Notice]: Your response reached the maximum output token limit (finish_reason: "${response.finishReason || "length"}", completion tokens: ${response.usage.completionTokens}). Any attempted tool call was truncated before completion and could not be parsed. Please write the output in smaller sections or verify that Max Output Tokens in settings is set sufficiently high.`,
            });
          } else {
            // If no tool was called and no completion or failure indicated, prompt the agent to proceed immediately with tools
            this.messages.push({
              role: "user",
              content: "[System Directive]: You provided conversational text without invoking any tool calls. Conversational commentary without tool execution is strictly prohibited in autonomous execution mode. Execute the required tool call (e.g. write_file, replace_file_content, execute_command, or complete_phase) immediately in this turn.",
            });
          }
        }
      }
    }

    const durationSeconds = Math.round((Date.now() - startTimeMs) / 1000);

    // Graceful recovery: If turn limit was reached, check if all required phase deliverables were produced on disk
    const wsRoot = this.tools.getWorkspaceRoot();
    let recoveredSuccess = false;
    let recoveredSummary = "";

    // For review and correction phases (12_integrity, 13_critique), require that deliverables were
    // actually written or modified DURING THIS RUN (mtimeMs >= startTimeMs) to prevent false completion
    // from stale files left over from prior runs or earlier phases.
    if (this.phaseName?.includes("12_") || this.phaseName?.includes("integrity")) {
      const repPath = path.join(wsRoot, "docs", "report_integrity.md");
      const revPath = path.join(wsRoot, "docs", "manuscript_rev_01.md");
      if (fsSync.existsSync(repPath) && fsSync.existsSync(revPath)) {
        try {
          const statRep = fsSync.statSync(repPath);
          const statRev = fsSync.statSync(revPath);
          const { methodMismatches } = verifyWorkspaceMethodIdentity(wsRoot);
          if (
            statRep.size > 500 &&
            statRep.mtimeMs >= startTimeMs &&
            statRev.mtimeMs >= startTimeMs &&
            methodMismatches.length === 0
          ) {
            recoveredSuccess = true;
            recoveredSummary = `Phase completed: Integrity report (docs/report_integrity.md) and corrected manuscript (docs/manuscript_rev_01.md) were successfully finalized on disk before turn budget expired (MATRIX_MATCHES_SPEC).`;
          }
        } catch {}
      }
    } else if (this.phaseName?.includes("13_") || this.phaseName?.includes("critique")) {
      const repPath = path.join(wsRoot, "docs", "report_critique.md");
      const revPath = path.join(wsRoot, "docs", "manuscript_rev_02.md");
      if (fsSync.existsSync(repPath) && fsSync.existsSync(revPath)) {
        try {
          const statRep = fsSync.statSync(repPath);
          const statRev = fsSync.statSync(revPath);
          if (statRep.size > 500 && statRep.mtimeMs >= startTimeMs && statRev.mtimeMs >= startTimeMs) {
            recoveredSuccess = true;
            recoveredSummary = `Phase completed: Report (docs/report_critique.md) and revised manuscript (docs/manuscript_rev_02.md) were successfully finalized on disk before turn budget expired.`;
          }
        } catch {}
      }
    } else {
      const gateErrors = await this.verifyPhaseGateDeliverables(this.phaseName);
      if (gateErrors.length === 0) {
        recoveredSuccess = true;
        recoveredSummary = `Phase completed: All required checkpoint deliverables were successfully generated and verified on disk before turn budget expired.`;
      }
    }

    if (recoveredSuccess) {
      await this.saveCheckpointState(true, recoveredSummary);
      if (this.chatLogger) {
        await this.chatLogger.logPhaseEnd({
          phaseTitle: this.phaseTitle || this.phaseName,
          phaseFileName: this.phaseName,
          success: true,
          summary: recoveredSummary,
          durationSeconds,
          tokensUsed: this.totalUsage,
          turnCount: this.currentTurn,
        });
      }
      return {
        success: true,
        summary: recoveredSummary,
        tokensUsed: this.totalUsage,
        phaseName: this.phaseName,
        turnCount: this.currentTurn,
      };
    }

    const failureSummary = `Turn limit reached (${this.currentMaxTurns} turns) without completing phase checkpoints.`;
    await this.saveCheckpointState(false, failureSummary);

    if (this.chatLogger) {
      await this.chatLogger.logPhaseEnd({
        phaseTitle: this.phaseTitle || this.phaseName,
        phaseFileName: this.phaseName,
        success: false,
        summary: failureSummary,
        durationSeconds,
        tokensUsed: this.totalUsage,
        turnCount: this.currentTurn,
      });
    }

    return {
      success: false,
      summary: failureSummary,
      tokensUsed: this.totalUsage,
      phaseName: this.phaseName,
      turnCount: this.currentTurn,
    };
  }

  private isPhaseFailureOrHalt(content: string): boolean {
    if (!content) return false;
    const lower = content.toLowerCase();

    // Explicit gate failure, blocked phase, or halt keywords
    const failurePatterns = [
      /pre-flight\s+gate\s+fail/i,
      /specification\s+gate\s+fail/i,
      /checkpoint\s+gate\s+fail/i,
      /\bgate\s+failed\b/i,
      /\bphase\s+(?:[0-9a-zA-Z_]+\s+)?(?:is\s+blocked|remains\s+blocked|cannot\s+be\s+completed|is\s+halted)\b/i,
      /\bphase_failed\b/i,
      /\bphase_blocked\b/i,
      /\bphase_halted\b/i,
      /\bblocked_specification_gate\b/i,
      /\bhalt(?:ed)?\s+(?:immediately\s+)?with\s+status\s+`?failed`?/i,
      /\bhalt\s+directive\b/i,
    ];

    if (failurePatterns.some((pattern) => pattern.test(content))) {
      return true;
    }

    if (
      content.includes("❌") &&
      (lower.includes("placeholder") ||
        lower.includes("blocked") ||
        lower.includes("rerun phase") ||
        lower.includes("gate"))
    ) {
      return true;
    }

    return false;
  }

  private async verifyPhaseGateDeliverables(phaseName: string, summary?: string): Promise<string[]> {
    const root = this.tools.getWorkspaceRoot() || process.cwd();
    if (!root) return [];

    const normPhase = path.basename(phaseName).replace(/\.md$/i, "").toLowerCase();
    const missing: string[] = [];

    const checkFile = async (relPathPattern: string): Promise<boolean> => {
      try {
        if (relPathPattern.includes("*")) {
          const dir = path.dirname(path.resolve(root, relPathPattern));
          if (!fsSync.existsSync(dir)) return false;
          const entries = await fs.readdir(dir);
          const basePattern = path.basename(relPathPattern);
          const regexStr = "^" + basePattern.replace(/[.+^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*") + "$";
          const regex = new RegExp(regexStr);
          const matches = entries.filter((e) => regex.test(e));
          for (const m of matches) {
            const stat = await fs.stat(path.join(dir, m));
            if (stat.size > 0) return true;
          }
          return false;
        } else {
          const fullPath = path.resolve(root, relPathPattern);
          if (!fsSync.existsSync(fullPath)) return false;
          const stat = await fs.stat(fullPath);
          return stat.size > 0;
        }
      } catch {
        return false;
      }
    };

    if (normPhase.includes("inspect") || normPhase.includes("ingest") || normPhase.includes("import_table")) {
      const hasRds = await checkFile("data/tidyproteomics_data.rds");
      const hasCounts = await checkFile("data/*counts*.png");
      const hasDataMd = await checkFile("docs/data.md");
      if (!hasRds && !hasCounts) missing.push("data/tidyproteomics_data.rds or data/*counts*.png");
      if (!hasDataMd) missing.push("docs/data.md (dataset overview and ingestion audit document)");
    } else if (normPhase.includes("normalize")) {
      const hasRds = await checkFile("data/tidyproteomics_data.rds");
      if (!hasRds) missing.push("data/tidyproteomics_data.rds");

      // Deterministic check: if docs/experiment.md specifies an explicit normalization method list (not 'default'/'all'),
      // ensure the selected active normalization assay in docs/data.md is in that list.
      try {
        const expPath = path.resolve(root, "docs/experiment.md");
        const dataMdPath = path.resolve(root, "docs/data.md");
        if (fsSync.existsSync(expPath) && fsSync.existsSync(dataMdPath)) {
          const expTxt = await fs.readFile(expPath, "utf-8");
          const dataMdTxt = await fs.readFile(dataMdPath, "utf-8");
          const normMatch = expTxt.match(/-\s*\*\*Normalization Methods\*\*:\s*([^\n\r]+)/i);
          const actMatch = dataMdTxt.match(/-\s*\*\*Active Quantitative Assay\*\*:\s*`?([a-z0-9_]+)`?/i);
          if (normMatch && actMatch) {
            const specNorm = normMatch[1].replace(/<!--[\s\S]*?-->/g, "").trim().toLowerCase();
            const actAssay = actMatch[1].trim().toLowerCase();
            if (specNorm && !["default", "all"].includes(specNorm) && actAssay !== "raw") {
              const allowed = specNorm.split(/[,;\s]+/).map((s) => s.trim()).filter(Boolean);
              if (allowed.length > 0 && !allowed.includes(actAssay)) {
                missing.push(
                  `METHOD_IDENTITY_GATE (Normalization): docs/experiment.md Section 3.B specifies '${specNorm}', but active assay in docs/data.md is '${actAssay}'. Call tpa_select_normalization(normalization = '${allowed[0]}') and tpa_export_state().`
                );
              }
            }
          }
        }
      } catch {}
    } else if (normPhase.includes("impute")) {
      const hasRds = await checkFile("data/tidyproteomics_data.rds");
      if (!hasRds) missing.push("data/tidyproteomics_data.rds");

      // Deterministic Method-Identity Gate (Incidents 1, 3, 4):
      // Compare (1) docs/experiment.md Section 3.C imputation method, (2) last successful tpa_impute argument,
      // (3) operations history in docs/data.md / code/03_impute.R, and (4) complete_phase summary text.
      try {
        const { specImputeRaw, specImputeCanon, executedImputeRaw, executedImputeCanon } =
          verifyWorkspaceMethodIdentity(root);

        // Find last tpa_impute tool call argument in this phase trajectory
        let lastToolArgRaw = "";
        let lastToolArgCanon = "unknown";
        for (let i = this.messages.length - 1; i >= 0; i--) {
          const msg = this.messages[i];
          if (msg.role === "assistant" && Array.isArray(msg.tool_calls)) {
            const impCall = [...msg.tool_calls].reverse().find((tc) => tc.name === "tpa_impute");
            if (impCall) {
              lastToolArgRaw = String(impCall.args?.method || impCall.args?.algorithm || "(default)");
              lastToolArgCanon = canonicalizeImputationMethod(lastToolArgRaw);
              break;
            }
          }
        }

        if (specImputeCanon !== "unknown") {
          const toolMismatch =
            lastToolArgCanon !== "unknown" && lastToolArgCanon !== specImputeCanon;
          const historyMismatch =
            executedImputeCanon !== "unknown" && executedImputeCanon !== specImputeCanon;

          if (toolMismatch || historyMismatch) {
            missing.push(
              `METHOD_IDENTITY_GATE FAILED: Study spec vs executed imputation mismatch! ` +
                `[1] docs/experiment.md Section 3.C: '${specImputeRaw}' (canonical: '${specImputeCanon}') | ` +
                `[2] Last tpa_impute call argument: '${lastToolArgRaw || "none"}' (canonical: '${lastToolArgCanon}') | ` +
                `[3] Operations history / code/03_impute.R: '${executedImputeRaw || "none"}' (canonical: '${executedImputeCanon}'). ` +
                `Re-read Section 3.C of docs/experiment.md immediately, invoke tpa_impute(method = '${specImputeRaw}'), and re-run tpa_export_state(rds_path = 'data/tidyproteomics_data.rds', script_path = 'code/03_impute.R').`
            );
          }

          if (summary && summary.trim().length > 0) {
            const summaryLower = summary.toLowerCase();
            // Check if summary claims a conflicting imputation method
            const claimsRf = /randomforest|random\s*forest/i.test(summary);
            const claimsMinCol = /min_column|base::min.*column|column.*min/i.test(summary);
            if (specImputeCanon === "min_column" && claimsRf && !claimsMinCol) {
              missing.push(
                `SUMMARY_SPEC_MISMATCH: Phase 3 summary claims 'randomforest' imputation, but docs/experiment.md Section 3.C specifies 'Imputation Method: ${specImputeRaw}'. Quote the exact docs/experiment.md Imputation Method ('${specImputeRaw}') in complete_phase(summary = ...).`
              );
            } else if (specImputeCanon === "randomforest_grouped" && claimsMinCol && !claimsRf) {
              missing.push(
                `SUMMARY_SPEC_MISMATCH: Phase 3 summary claims 'min_column' imputation, but docs/experiment.md Section 3.C specifies 'Imputation Method: ${specImputeRaw}'. Quote the exact docs/experiment.md Imputation Method ('${specImputeRaw}') in complete_phase(summary = ...).`
              );
            } else if (!summaryLower.includes(specImputeRaw.toLowerCase()) && !summaryLower.includes(specImputeCanon.toLowerCase())) {
              missing.push(
                `SUMMARY_MISSING_VERBATIM_SPEC: Phase 3 summary must verbatim quote the confirmed docs/experiment.md imputation method ('${specImputeRaw}').`
              );
            }
          }
        }
      } catch {}
    } else if (normPhase.includes("expression")) {
      const hasRds = await checkFile("data/tidyproteomics_data.rds");
      const hasExpr = (await checkFile("data/table_*expression_*.tsv")) || (await checkFile("data/table_*expression_*.csv"));
      const hasVolcano = await checkFile("data/*volcano*.png");
      if (!hasRds) missing.push("data/tidyproteomics_data.rds");
      if (!hasExpr) missing.push("data/table_*expression_*.tsv or .csv");
      if (!hasVolcano) missing.push("data/*volcano*.png");
    } else if (normPhase.includes("enrichment")) {
      const hasRds = await checkFile("data/tidyproteomics_data.rds");
      const hasEnrich = (await checkFile("data/table_*enrichment_*.tsv")) || (await checkFile("data/table_*enrichment_*.csv"));
      if (!hasRds) missing.push("data/tidyproteomics_data.rds");

      // Checkpoint 5.4: enrichment tables are required ONLY if functional terms were analyzed.
      // If formal biological ontology terms are absent, the directive specifies bypassing enrichment
      // and preserving data for Phase 6 observations and Phase 7 de novo functional module testing.
      let isBypassed = Boolean(summary && /bypass|annotation-free|no formal ontology|absence of formal|de novo/i.test(summary));
      if (!isBypassed) {
        try {
          const notesPath = path.resolve(root, "docs/notes.md");
          if (fsSync.existsSync(notesPath)) {
            const notesContent = await fs.readFile(notesPath, "utf-8");
            if (/05_enrichment|phase\s*5/i.test(notesContent) && /bypass|annotation-free|absence of formal/i.test(notesContent)) {
              isBypassed = true;
            }
          }
        } catch {
          // ignore
        }
      }

      if (!hasEnrich && !isBypassed) {
        missing.push("data/table_*enrichment_*.tsv or .csv (or recorded bypass summary matching Checkpoint 5.4)");
      }
    } else if (normPhase.includes("06_observations")) {
      const hasObs = await checkFile("docs/observations.md");
      if (!hasObs) missing.push("docs/observations.md");

      // Verify expression table header matches annotation claims (Issue 7)
      try {
        const dataDirPath = path.resolve(root, "data");
        if (fsSync.existsSync(dataDirPath)) {
          const exprFiles = (await fs.readdir(dataDirPath)).filter(f => /^table_.*expression_.*\.(tsv|csv)$/i.test(f));
          if (exprFiles.length > 0) {
            const firstExpr = path.join(dataDirPath, exprFiles[0]);
            const headLine = (await fs.readFile(firstExpr, "utf-8")).split("\n")[0];
            const hasGeneCol = /gene_name|gene|symbol/i.test(headLine);
            const obsContent = fsSync.existsSync(path.resolve(root, "docs/observations.md"))
              ? await fs.readFile(path.resolve(root, "docs/observations.md"), "utf-8")
              : "";
            if (!hasGeneCol && /symbols attached for 100%|gene symbols and descriptions attached/i.test(obsContent)) {
              missing.push("Expression table header lacks gene symbols; observations summary contradicts export header.");
            }
          }
        }
      } catch {}
    } else if (normPhase.includes("07_knowledge")) {
      const hasKnowledge = await checkFile("docs/knowledge.md");
      if (!hasKnowledge) missing.push("docs/knowledge.md");

      // Verify annotation file provenance claim (Issue 9)
      try {
        const statusJsonPath = path.resolve(root, "data/annotations_uniprot.tsv.status.json");
        const tsvPath = path.resolve(root, "data/annotations_uniprot.tsv");
        let isTsvWritten = fsSync.existsSync(tsvPath) && fsSync.statSync(tsvPath).size > 0;
        if (fsSync.existsSync(statusJsonPath)) {
          try {
            const statusObj = JSON.parse(await fs.readFile(statusJsonPath, "utf-8"));
            if (statusObj.written === false) isTsvWritten = false;
          } catch {}
        }
        const knowContent = fsSync.existsSync(path.resolve(root, "docs/knowledge.md"))
          ? await fs.readFile(path.resolve(root, "docs/knowledge.md"), "utf-8")
          : "";
        if (!isTsvWritten && /resolved from data\/annotations_uniprot\.tsv|from data\/annotations_uniprot\.tsv/i.test(knowContent)) {
          missing.push("data/annotations_uniprot.tsv is absent or marked written:false. docs/knowledge.md must declare symbols came from unverified model memory, not data/annotations_uniprot.tsv.");
        }
      } catch {}
    } else if (normPhase.includes("08_literature") || normPhase.includes("literature")) {
      const hasLit = await checkFile("docs/literature.md");
      const hasActionable = await checkFile("data/actionable_synthesis.json");
      if (!hasLit) missing.push("docs/literature.md");
      if (!hasActionable) missing.push("data/actionable_synthesis.json");
    } else if (normPhase.includes("09_websearch") || normPhase.includes("websearch")) {
      const hasWeb = await checkFile("docs/websearch.md");
      const hasActionable = await checkFile("data/actionable_synthesis.json");
      if (!hasWeb) missing.push("docs/websearch.md");
      if (!hasActionable) missing.push("data/actionable_synthesis.json");
    } else if (normPhase.includes("02_replicate_qc") || normPhase.includes("replicate_qc")) {
      const hasCvs = await checkFile("data/*cvs*.png");
      const hasDynamic = await checkFile("data/*dynamic_range*.png");
      if (!hasCvs && !hasDynamic) missing.push("data/*cvs*.png or data/*dynamic_range*.png");
    } else if (normPhase.includes("03_cohort_diagnostics") || normPhase.includes("cohort_diagnostics")) {
      const hasPca = await checkFile("data/*pca*.png");
      const hasHeatmap = await checkFile("data/*heatmap*.png");
      if (!hasPca && !hasHeatmap) missing.push("data/*pca*.png or data/*heatmap*.png");
    } else if (normPhase.includes("figures")) {
      const hasFig = await checkFile("data/plot_*.png");
      const hasFiguresTsv = await checkFile("data/figures.tsv");
      if (!hasFig) missing.push("data/plot_*.png (at least one publication figure)");
      if (!hasFiguresTsv) missing.push("data/figures.tsv (captions registry: path, generator, caption, what_it_shows)");
    } else if (normPhase.includes("synthesis")) {
      const hasManuscript = (await checkFile("manuscript.md")) || (await checkFile("docs/manuscript.md"));
      if (!hasManuscript) missing.push("manuscript.md or docs/manuscript.md");
    } else if (normPhase.includes("integrity")) {
      const hasRep = (await checkFile("docs/report_integrity.md")) || (await checkFile("report_integrity.md"));
      const hasRev1 = (await checkFile("docs/manuscript_rev_01.md")) || (await checkFile("manuscript_rev_01.md"));
      const hasRev0 = (await checkFile("docs/manuscript_rev_00.md")) || (await checkFile("manuscript_rev_00.md"));
      if (!hasRep) missing.push("docs/report_integrity.md (>500 characters)");
      if (!hasRev1) missing.push("docs/manuscript_rev_01.md");
      if (!hasRev0) missing.push("docs/manuscript_rev_00.md");

      // Deterministic Matrix-Matches-Spec Check (Incident 19):
      // A prose confession of an imputation/normalization contradiction is NOT allowed to close Phase 12.
      try {
        const { methodMismatches } = verifyWorkspaceMethodIdentity(root);
        if (methodMismatches.length > 0) {
          for (const mm of methodMismatches) {
            missing.push(mm);
          }
        }
        const repFullPath = fsSync.existsSync(path.resolve(root, "docs/report_integrity.md"))
          ? path.resolve(root, "docs/report_integrity.md")
          : path.resolve(root, "report_integrity.md");
        if (fsSync.existsSync(repFullPath)) {
          const repTxt = await fs.readFile(repFullPath, "utf-8");
          if (/\bREQUIRES_RERUN\b/.test(repTxt) && !/\bMATRIX_MATCHES_SPEC\b/.test(repTxt)) {
            missing.push(
              "docs/report_integrity.md contains REQUIRES_RERUN. You must re-execute tpa_impute + tpa_expression + tpa_batch_analysis + tpa_export_state so the matrix matches docs/experiment.md and record MATRIX_MATCHES_SPEC in docs/report_integrity.md."
            );
          }
        }
      } catch {}
    } else if (normPhase.includes("critique")) {
      const hasRep = (await checkFile("docs/report_critique.md")) || (await checkFile("report_critique.md"));
      const hasRev2 = (await checkFile("docs/manuscript_rev_02.md")) || (await checkFile("manuscript_rev_02.md"));
      if (!hasRep) missing.push("docs/report_critique.md (>500 characters)");
      if (!hasRev2) missing.push("docs/manuscript_rev_02.md");
    }

    return missing;
  }
}

/**
 * Truncates excessively wide tabular lines (e.g. enrichment TSVs where a single row
 * contains hundreds or thousands of comma-separated gene names) to prevent blowing out
 * the LLM context window while preserving essential biological identifiers and stats.
 */
function truncateWideTabularLines(content: string): string {
  if (!content || content.length < 500) return content;
  const lines = content.split("\n");
  let modified = false;

  const processed = lines.map((line) => {
    // If a single line is excessively long (e.g. > 600 chars)
    if (line.length > 600) {
      if (line.includes("\t")) {
        const cols = line.split("\t");
        const newCols = cols.map((col) => {
          if (col.length > 300 && col.includes(",")) {
            const items = col.split(/,\s*/);
            if (items.length > 8) {
              modified = true;
              return `${items.slice(0, 6).join(", ")} ... [+${items.length - 6} items omitted for context economy]`;
            }
          }
          return col;
        });
        return newCols.join("\t");
      } else if (line.includes(",")) {
        const items = line.split(/,\s*/);
        if (items.length > 12) {
          modified = true;
          return `${items.slice(0, 8).join(", ")} ... [+${items.length - 8} items omitted for context economy]`;
        }
      }
    }
    return line;
  });

  return modified ? processed.join("\n") : content;
}

