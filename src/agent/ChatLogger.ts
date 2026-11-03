import * as fs from "fs/promises";
import * as path from "path";
import { TokenUsage, ToolCall } from "../types";

export class ChatLogger {
  private currentPhaseTag = "";
  private logPath = "";
  private consoleLogPath = "";
  private pipelineLogPath = "";
  private writeQueue: Promise<void> = Promise.resolve();

  constructor(private workspaceRoot: string, initialPhase = "") {
    this.workspaceRoot = workspaceRoot || "";
    if (initialPhase) {
      this.setPhase(initialPhase);
    } else {
      this.pipelineLogPath = this.resolveLogPath("logs/pipeline.md");
    }
  }

  public setWorkspaceRoot(newRoot: string) {
    this.workspaceRoot = newRoot || "";
    if (this.currentPhaseTag) {
      this.setPhase(this.currentPhaseTag);
    } else {
      this.pipelineLogPath = this.resolveLogPath("logs/pipeline.md");
    }
  }

  /**
   * Switches the active logging context to a specific phase directory:
   *   logs/<phaseTag>/chat.md      -> Phase chat & LLM reasoning trace
   *   logs/<phaseTag>/console.log  -> Raw R / command stdout and stderr
   */
  public setPhase(phaseFileNameOrTag: string): void {
    if (!phaseFileNameOrTag) return;
    const tag = path.basename(phaseFileNameOrTag).replace(/\.md$/i, "").toLowerCase();
    this.currentPhaseTag = tag;
    this.logPath = this.resolveLogPath(`logs/${tag}/chat.md`);
    this.consoleLogPath = this.resolveLogPath(`logs/${tag}/console.log`);
    this.pipelineLogPath = this.resolveLogPath("logs/pipeline.md");
  }

  public getPhaseTag(): string {
    return this.currentPhaseTag;
  }

  public getLogPath(): string {
    return this.logPath || this.pipelineLogPath;
  }

  public getConsoleLogPath(): string {
    return this.consoleLogPath;
  }

  public getPipelineLogPath(): string {
    return this.pipelineLogPath;
  }

  private resolveLogPath(fileName: string): string {
    if (path.isAbsolute(fileName)) {
      return fileName;
    }
    if (!this.workspaceRoot) return "";
    return path.join(this.workspaceRoot, fileName);
  }

  private async appendToFile(targetPath: string, text: string): Promise<void> {
    if (!this.workspaceRoot || !targetPath) return;
    this.writeQueue = this.writeQueue.then(async () => {
      try {
        const dir = path.dirname(targetPath);
        await fs.mkdir(dir, { recursive: true });
        await fs.appendFile(targetPath, text + "\n", "utf-8");
      } catch (err) {
        console.error(`[ChatLogger] Failed to write to ${targetPath}:`, err);
      }
    });
    return this.writeQueue;
  }

  /**
   * Flushes any pending asynchronous file write operations.
   */
  public async flush(): Promise<void> {
    await this.writeQueue;
  }

  private async append(text: string): Promise<void> {
    const target = this.logPath || this.pipelineLogPath;
    return this.appendToFile(target, text);
  }

  /**
   * Initializes or updates the master logs/pipeline.md summary table.
   */
  private async ensurePipelineSummaryHeader(): Promise<void> {
    if (!this.workspaceRoot || !this.pipelineLogPath) return;
    try {
      await fs.stat(this.pipelineLogPath);
    } catch {
      const header = [
        "# TidyProteomics Pipeline Execution Summary",
        "",
        "> Master index of autonomous reasoning traces and raw execution logs per phase.",
        "",
        "| Phase | Title | Status | Duration | Total Tokens | Logs |",
        "| :--- | :--- | :--- | :--- | :--- | :--- |",
      ].join("\n");
      await this.appendToFile(this.pipelineLogPath, header);
    }
  }

  /**
   * Logs phase initialization. Documents WHICH prompts were sent into the persistent system frame
   * and dynamic input directives WITHOUT dumping their entire text contents, keeping the log lean.
   */
  public async logPhaseStart(params: {
    phaseTitle: string;
    phaseFileName: string;
    model: string;
    provider: string;
    role?: string;
    systemPromptFiles?: string[];
    inputPromptFiles?: string[];
  }): Promise<void> {
    await this.flush();
    this.setPhase(params.phaseFileName);
    await this.ensurePipelineSummaryHeader();

    const phaseTagUpper = path.basename(params.phaseFileName).replace(/\.md$/i, "").toUpperCase();

    // Touch console.log so it exists immediately on disk
    if (this.consoleLogPath) {
      await this.writeQueue.then(async () => {
        try {
          await fs.mkdir(path.dirname(this.consoleLogPath), { recursive: true });
          await fs.appendFile(
            this.consoleLogPath,
            `Phase: ${phaseTagUpper}\n=== Phase Started: ${params.phaseTitle} [${new Date().toISOString()}] ===\n`,
            "utf-8"
          );
        } catch { }
      });
    }

    const timestamp = new Date().toISOString();
    const systemFiles = params.systemPromptFiles || [
      "agent/PROTOCOL.md",
      "docs/experiment.md",
    ];
    const inputFiles = params.inputPromptFiles || [
      params.phaseFileName.includes("/") ? params.phaseFileName : `analysis/${params.phaseFileName}`,
      "docs/notes.md",
      "docs/llm.md",
    ];

    const lines = [
      "",
      "---",
      "",
      `# Phase: ${phaseTagUpper}`,
      `# [${timestamp}] Phase Start: ${params.phaseTitle}`,
      `- **Phase Directive**: \`${params.phaseFileName}\``,
      `- **Model**: \`${params.model}\` (\`${params.role || "toolRunner"}\`) | **Provider**: \`${params.provider}\``,
      `- **Console Output**: [\`logs/${this.currentPhaseTag}/console.log\`](./console.log)`,
      "",
      "### Persistent System Frame (Sent & Cached Prefix)",
      ...systemFiles.map((f) => `- \`${f}\``),
      "",
      "### Input Prompts & Blackboard Directives (Turn 1)",
      ...inputFiles.map((f) => `- \`${f}\``),
      "",
    ];

    await this.append(lines.join("\n"));
  }

  public async logPhaseResume(params: {
    turn: number;
    newMaxTurns: number;
    additionalTurns: number;
  }): Promise<void> {
    const timestamp = new Date().toISOString();
    const lines = [
      "",
      "---",
      "",
      `### [${timestamp}] Phase Resumed (Continuing Turns ${params.turn + 1} to ${params.newMaxTurns})`,
      `- **Resumed at Turn**: ${params.turn}`,
      `- **Additional Turns Granted**: +${params.additionalTurns}`,
      `- **New Turn Budget**: ${params.newMaxTurns} turns`,
      "",
    ];
    await this.append(lines.join("\n"));

    if (this.consoleLogPath) {
      await this.appendToFile(
        this.consoleLogPath,
        `\n=== Phase Resumed: Turn ${params.turn + 1}/${params.newMaxTurns} (+${params.additionalTurns} turns granted) [${timestamp}] ===\n`
      );
    }
  }

  public async logAssistantResponse(
    turn: number,
    content: string,
    toolCalls?: ToolCall[],
    usage?: TokenUsage
  ): Promise<void> {
    const timestamp = new Date().toISOString();
    const lines = [
      `### [${timestamp}] Agent (Turn ${turn})`,
    ];

    if (content && content.trim().length > 0) {
      lines.push("");
      lines.push(content.trim());
    }

    if (toolCalls && toolCalls.length > 0) {
      lines.push("");
      lines.push("**Tool Calls**:");
      for (const tc of toolCalls) {
        lines.push(`- **\`${tc.name}\`** (id: \`${tc.id}\`)`);
        lines.push("  ```json");
        lines.push(
          JSON.stringify(tc.args, null, 2)
            .split("\n")
            .map((l) => `  ${l}`)
            .join("\n")
        );
        lines.push("  ```");
      }
    }

    if (usage) {
      const cached = usage.cachedPromptTokens || 0;
      lines.push("");
      lines.push(
        `> **Metrics**: Turn Tokens: **${usage.totalTokens.toLocaleString()}** (Prompt: ${usage.promptTokens.toLocaleString()}, Completion: ${usage.completionTokens.toLocaleString()}, Cached: ${cached.toLocaleString()})`
      );
    }

    lines.push("");
    await this.append(lines.join("\n"));
  }

  public async logTruncationWarning(
    turn: number,
    finishReason: string,
    completionTokens: number
  ): Promise<void> {
    const timestamp = new Date().toISOString();
    const lines = [
      `> **WARNING (Turn ${turn})**: Generation hit output token limit (\`finish_reason: "${finishReason}"\`, completion tokens: **${completionTokens.toLocaleString()}**). Response or pending tool calls were truncated mid-stream!`,
      "",
    ];
    await this.append(lines.join("\n"));
  }

  /**
   * Logs tool results. For `execute_command` (especially R scripts), writes the complete, unvarnished
   * stdout and stderr to `logs/<phaseTag>/console.log` while inserting a lean "Execution Card" into `chat.md`.
   */
  public async logToolResult(
    toolName: string,
    callId: string,
    result: string,
    isError?: boolean,
    toolArgs?: Record<string, any>
  ): Promise<void> {
    const timestamp = new Date().toISOString();
    const status = isError ? "FAILED" : "SUCCESS";
    const cleanResult = result ? result.trim() : "(No output)";

    // 1. Special Handling for execute_command: Keeps R console noise OUT of chat.md
    if (toolName === "execute_command") {
      const command = toolArgs?.command || "(command string unavailable)";

      // Prevent recursive log echo chambers:
      // Do not append output of read-only log inspection commands back into console.log
      const isLogSelfInspection = /(?:grep|sed|tail|head|cat|awk|less|more)\b.*logs\/[^\s;&|]+\/console\.log/.test(command);
      if (this.consoleLogPath && !isLogSelfInspection) {
        const consoleEntry = [
          "================================================================================",
          `[${timestamp}] Command: ${command}`,
          `Status: ${status} (id: ${callId})`,
          "================================================================================",
          cleanResult,
          "",
        ].join("\n");
        await this.appendToFile(this.consoleLogPath, consoleEntry);
      }

      // Author lean Execution Card in chat.md
      const relConsole = `./console.log`;
      const lines = [
        `#### [${timestamp}] Tool Result: \`${toolName}\` [${status}] (id: \`${callId}\`)`,
        `- **Command**: \`${command}\``,
        `- **Status**: ${isError ? "❌ Command failed" : "✓ Command executed successfully"}`,
      ];
      if (!isLogSelfInspection) {
        lines.push(`- **Console Output**: Logged to [\`logs/${this.currentPhaseTag}/console.log\`](${relConsole})`);
      }

      if (isError) {
        // Extract up to 10 lines of salient error / traceback so LLM reasoning remains clear
        const rawLines = cleanResult.split("\n");
        const errorLines = rawLines.filter((l) =>
          /error|failed|exception|cannot|fatal/i.test(l)
        );
        const snippetLines = errorLines.length > 0 ? errorLines.slice(-10) : rawLines.slice(-10);
        lines.push("- **Error Excerpt**:");
        lines.push("  ```text");
        for (const el of snippetLines) {
          lines.push(`  ${el.trim()}`);
        }
        lines.push("  ```");
      } else {
        // Highlight any checkpoint pass lines if found
        const passLines = cleanResult
          .split("\n")
          .filter((l) => /CHECKPOINT.*PASS|ALL_CHECKPOINTS_PASSED|PHASE_.*_PASS/i.test(l))
          .slice(0, 3);
        if (passLines.length > 0) {
          for (const pl of passLines) {
            lines.push(`- **Checkpoint Highlight**: \`${pl.trim()}\``);
          }
        } else {
          const lineCount = cleanResult.split("\n").length;
          lines.push(`- **Console Volume**: ${lineCount.toLocaleString()} lines captured in console.log`);
        }
      }

      lines.push("");
      await this.append(lines.join("\n"));
      return;
    }

    // 2. Special Handling for write_file: Keep lean confirmation without echoing file body
    if (toolName === "write_file") {
      const filePath = toolArgs?.filePath || "";
      const lines = [
        `#### [${timestamp}] Tool Result: \`${toolName}\` [${status}] (id: \`${callId}\`)`,
        `- **Target File**: \`${filePath}\``,
        `- **Result**: ${cleanResult}`,
        "",
      ];
      await this.append(lines.join("\n"));
      return;
    }

    // 3. Special Handling for read_file: If large, keep a truncated preview
    if (toolName === "read_file") {
      const filePath = toolArgs?.filePath || "";
      const rawLines = cleanResult.split("\n");
      const lines = [
        `#### [${timestamp}] Tool Result: \`${toolName}\` [${status}] (id: \`${callId}\`)`,
        `- **Inspected File**: \`${filePath}\``,
      ];
      if (rawLines.length > 25) {
        const preview = rawLines.slice(0, 15).join("\n");
        lines.push("```");
        lines.push(preview);
        lines.push(`\n... [${(rawLines.length - 15).toLocaleString()} lines omitted in chat log for economy] ...`);
        lines.push("```");
      } else {
        lines.push("```");
        lines.push(cleanResult);
        lines.push("```");
      }
      lines.push("");
      await this.append(lines.join("\n"));
      return;
    }

    // 4. MCP Tools: Mirror execution trace, parameters, and output to console.log
    if (toolName.startsWith("tpa_")) {
      if (this.consoleLogPath) {
        const consoleEntry = [
          "--------------------------------------------------------------------------------",
          `[${timestamp}] [MCP Tool] ${toolName}(${toolArgs ? JSON.stringify(toolArgs) : ""})`,
          `Status: ${status} (id: ${callId})`,
          "--------------------------------------------------------------------------------",
          cleanResult,
          "",
        ].join("\n");
        await this.appendToFile(this.consoleLogPath, consoleEntry);
      }
    }

    // 5. Default for other tools
    const lines = [
      `#### [${timestamp}] Tool Result: \`${toolName}\` [${status}] (id: \`${callId}\`)`,
      "```",
      cleanResult,
      "```",
      "",
    ];

    await this.append(lines.join("\n"));
  }

  public async logPhaseEnd(params: {
    phaseTitle: string;
    phaseFileName: string;
    success: boolean;
    summary: string;
    durationSeconds: number;
    tokensUsed: TokenUsage;
    turnCount: number;
    statusTextOverride?: "COMPLETED" | "FAILED" | "BLOCKED";
  }): Promise<void> {
    const timestamp = new Date().toISOString();
    const isBlocked = params.statusTextOverride === "BLOCKED" || (!params.success && /human-in-the-loop|hitl|study design gate|checkpoint gate|pre-flight|confirmation required|section 3/i.test(params.summary || ""));
    const statusIcon = isBlocked ? "🛑" : params.success ? "✓" : "❌";
    const statusText = params.statusTextOverride || (isBlocked ? "BLOCKED" : params.success ? "COMPLETED" : "FAILED");
    const cached = params.tokensUsed.cachedPromptTokens || 0;

    let phaseTag = this.currentPhaseTag;
    if (params.phaseFileName) {
      phaseTag = path.basename(params.phaseFileName).replace(/\.md$/i, "").toLowerCase();
    }

    const banner = [
      `### [${timestamp}] ${statusIcon} Phase ${statusText}: ${params.phaseTitle}`,
      `- **Duration**: ${params.durationSeconds}s | **Total Turns**: ${params.turnCount}`,
      `- **Cumulative Tokens**: Total: **${params.tokensUsed.totalTokens.toLocaleString()}** | Prompt: ${params.tokensUsed.promptTokens.toLocaleString()} | Completion: ${params.tokensUsed.completionTokens.toLocaleString()} | Cached: ${cached.toLocaleString()}`,
      `- **Logs**: [\`chat.md\`](./chat.md) | [\`console.log\`](./console.log)`,
      "",
      `**Summary**:`,
      params.summary,
      "",
      "---",
      "",
    ].join("\n");

    const targetChatLog = this.resolveLogPath(`logs/${phaseTag}/chat.md`);
    await this.appendToFile(targetChatLog || this.logPath || this.pipelineLogPath, banner);

    // Update master pipeline.md index table (in place if row already exists, otherwise append)
    if (this.pipelineLogPath) {
      let statusDisplay: string = statusText;
      if (!params.success && params.summary) {
        const firstLine = params.summary.replace(/^[❌⚠️🛑\[\]\s*]+/, "").split("\n")[0].trim();
        const shortReason = firstLine.length > 45 ? `${firstLine.slice(0, 42)}...` : firstLine;
        if (shortReason) {
          statusDisplay = `${statusText}: ${shortReason}`;
        }
      }
      const summaryRow = `| ${statusIcon} **${phaseTag}** | ${params.phaseTitle} | ${statusDisplay} | ${params.durationSeconds}s | ${params.tokensUsed.totalTokens.toLocaleString()} | [Chat](./${phaseTag}/chat.md) \\| [Console](./${phaseTag}/console.log) |`;
      await this.updatePipelineSummaryRow(phaseTag, summaryRow);
    }
    await this.flush();
  }

  private async updatePipelineSummaryRow(phaseTag: string, summaryRow: string): Promise<void> {
    if (!this.pipelineLogPath) return;
    await this.writeQueue.then(async () => {
      try {
        let content = "";
        try {
          content = await fs.readFile(this.pipelineLogPath, "utf-8");
        } catch {
          await this.ensurePipelineSummaryHeader();
          content = await fs.readFile(this.pipelineLogPath, "utf-8");
        }

        const lines = content.split("\n");
        const regex = new RegExp(`^\\|\\s*(?:✓|❌|🛑)?\\s*\\*\\*${phaseTag}\\*\\*\\s*\\|`, "i");
        let foundIndex = -1;
        for (let i = 0; i < lines.length; i++) {
          if (regex.test(lines[i])) {
            foundIndex = i;
            break;
          }
        }

        if (foundIndex !== -1) {
          lines[foundIndex] = summaryRow;
          await fs.writeFile(this.pipelineLogPath, lines.join("\n"), "utf-8");
        } else {
          lines.push(summaryRow);
          await fs.writeFile(this.pipelineLogPath, lines.join("\n"), "utf-8");
        }
      } catch (err) {
        console.warn("[ChatLogger] Error updating pipeline summary row:", err);
      }
    });
  }
}
