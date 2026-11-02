import * as fs from "fs/promises";
import * as fsSync from "fs";
import * as path from "path";
import { ChatMessage, TokenUsage } from "../types";
import { ContextBundle } from "./ContextBuilder";
import { ToolRegistry } from "../tools/ToolRegistry";
import { ProviderClient } from "../llm/ProviderClient";
import { ChatLogger } from "./ChatLogger";

export interface LoopResult {
  success: boolean;
  summary: string;
  tokensUsed: TokenUsage;
  phaseName: string;
  turnCount: number;
}

export class AgentLoop {
  private messages: ChatMessage[] = [];
  private totalUsage: TokenUsage = {
    promptTokens: 0,
    completionTokens: 0,
    totalTokens: 0,
    cachedPromptTokens: 0,
  };

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
    private isCancelled?: () => boolean
  ) {}

  public getTotalUsage(): TokenUsage {
    return { ...this.totalUsage };
  }

  public async run(maxTurns = 30): Promise<LoopResult> {
    const startTimeMs = Date.now();

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

    let turn = 0;
    let completedSummary = "";
    let consecutiveNoToolTurns = 0;
    let consecutiveTransitionAnnouncements = 0;
    let consecutiveCommandFailures = 0;
    let lastFailedCommand = "";
    let consecutiveToolFailures = 0;
    let lastFailedToolName = "";
    let consecutiveIdenticalCalls = 0;
    let lastToolCallSignature = "";
    let totalSearchCalls = 0;

    while (turn < maxTurns) {
      if (this.isCancelled && this.isCancelled()) {
        const stopSummary = "Execution stopped by user.";
        if (this.chatLogger) {
          const durationSeconds = Math.round((Date.now() - startTimeMs) / 1000);
          await this.chatLogger.logPhaseEnd({
            phaseTitle: this.phaseTitle || this.phaseName,
            phaseFileName: this.phaseName,
            success: false,
            summary: stopSummary,
            durationSeconds,
            tokensUsed: this.totalUsage,
            turnCount: turn,
          });
        }
        return {
          success: false,
          summary: stopSummary,
          tokensUsed: this.totalUsage,
          phaseName: this.phaseName,
          turnCount: turn,
        };
      }

      turn++;
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
        if (this.isCancelled && this.isCancelled()) {
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
          });
          lastError = null;
          break; // Success!
        } catch (err: any) {
          lastError = err;
          const isRetryable =
            err.isRetryable === true ||
            err.isTimeout === true ||
            err.isNetworkError === true ||
            err.name === "TimeoutError" ||
            err.name === "AbortError" ||
            (err.status === 429) ||
            (err.status >= 500 && err.status <= 504) ||
            /timeout|aborted|ETIMEDOUT|ECONNRESET|ECONNREFUSED|ENOTFOUND|ConnectTimeoutError|fetch failed|rate limit|temporar/i.test(
              err.message || ""
            ) ||
            (err.cause &&
              /timeout|aborted|ETIMEDOUT|ECONNRESET|ECONNREFUSED|ENOTFOUND|ConnectTimeoutError/i.test(
                (err.cause.name || "") + " " + (err.cause.code || "") + " " + (err.cause.message || "")
              ));

          if (isRetryable && attempt <= maxRetries && (!this.isCancelled || !this.isCancelled())) {
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
        const errorSummary = lastError
          ? `LLM API Error during turn ${turn}: ${lastError.message}`
          : "Execution stopped by user.";
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

      // Real-time token notification for UI updates
      this.onProgress({
        type: "tokens",
        data: {
          turn,
          turnUsage: response.usage,
          totalUsage: { ...this.totalUsage },
        },
      });

      // Append assistant response to local isolated trajectory
      this.messages.push({
        role: "assistant",
        content: response.content,
        tool_calls: response.tool_calls,
        turn,
      });

      // Log assistant response to llm_chat.log
      if (this.chatLogger) {
        await this.chatLogger.logAssistantResponse(
          turn,
          response.content,
          response.tool_calls,
          response.usage
        );
      }

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
            const summary = actionable
              ? `[Failed] Pre-flight Gate / Checkpoint: ${failReason}\n\nActionable Insights:\n${actionable}`
              : `[Failed] Pre-flight Gate / Checkpoint: ${failReason}`;
            const durationSeconds = Math.round((Date.now() - startTimeMs) / 1000);

            if (this.chatLogger) {
              await this.chatLogger.logPhaseEnd({
                phaseTitle: this.phaseTitle || this.phaseName,
                phaseFileName: this.phaseName,
                success: false,
                summary,
                durationSeconds,
                tokensUsed: this.totalUsage,
                turnCount: turn,
              });
            }

            return {
              success: false,
              summary,
              tokensUsed: this.totalUsage,
              phaseName: this.phaseName,
              turnCount: turn,
            };
          }

          if (tc.name === "complete_phase") {
            const proposedSummary = String(tc.args?.summary || response.content || "");
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

            if (this.chatLogger) {
              await this.chatLogger.logPhaseEnd({
                phaseTitle: this.phaseTitle || this.phaseName,
                phaseFileName: this.phaseName,
                success: true,
                summary: completedSummary,
                durationSeconds,
                tokensUsed: this.totalUsage,
                turnCount: turn,
              });
            }

            return {
              success: true,
              summary: completedSummary,
              tokensUsed: this.totalUsage,
              phaseName: this.phaseName,
              turnCount: turn,
            };
          }
        }
      } else {
        const trimmedContent = (response.content || "").trim();
        const isEmptyResponse = !trimmedContent && (!response.tool_calls || response.tool_calls.length === 0);

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
        } else if (isEmptyResponse) {
          // Do not penalize transient blank API completions as intentional user halts
          this.messages.push({
            role: "user",
            content: "[System Directive]: Upstream provider returned an empty completion without tool calls. Please proceed with the required tool calls (e.g. replace_file_content or write_file) to complete this phase.",
          });
        } else {
          consecutiveNoToolTurns++;
          // If model didn't call any tools, check if text indicates completion
          if (response.content.includes("PHASE_COMPLETED") || response.content.includes("CHECKPOINT_PASSED")) {
            const durationSeconds = Math.round((Date.now() - startTimeMs) / 1000);
            if (this.chatLogger) {
              await this.chatLogger.logPhaseEnd({
                phaseTitle: this.phaseTitle || this.phaseName,
                phaseFileName: this.phaseName,
                success: true,
                summary: response.content,
                durationSeconds,
                tokensUsed: this.totalUsage,
                turnCount: turn,
              });
            }

            return {
              success: true,
              summary: response.content,
              tokensUsed: this.totalUsage,
              phaseName: this.phaseName,
              turnCount: turn,
            };
          } else if (this.isPhaseFailureOrHalt(response.content)) {
            // Model output text indicating a pre-flight gate failure, blocked phase, or halt directive
            const durationSeconds = Math.round((Date.now() - startTimeMs) / 1000);
            if (this.chatLogger) {
              await this.chatLogger.logPhaseEnd({
                phaseTitle: this.phaseTitle || this.phaseName,
                phaseFileName: this.phaseName,
                success: false,
                summary: response.content,
                durationSeconds,
                tokensUsed: this.totalUsage,
                turnCount: turn,
              });
            }

            return {
              success: false,
              summary: response.content,
              tokensUsed: this.totalUsage,
              phaseName: this.phaseName,
              turnCount: turn,
            };
          } else if (consecutiveNoToolTurns >= 3) {
            // Model repeatedly returned conversational text without tool actions; halt to avoid burning tokens in a loop
            const summary = `Execution halted: Agent stopped calling tools and provided instructions to user:\n\n${response.content}`;
            const durationSeconds = Math.round((Date.now() - startTimeMs) / 1000);
            if (this.chatLogger) {
              await this.chatLogger.logPhaseEnd({
                phaseTitle: this.phaseTitle || this.phaseName,
                phaseFileName: this.phaseName,
                success: false,
                summary,
                durationSeconds,
                tokensUsed: this.totalUsage,
                turnCount: turn,
              });
            }

            return {
              success: false,
              summary,
              tokensUsed: this.totalUsage,
              phaseName: this.phaseName,
              turnCount: turn,
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

    // Graceful recovery: If turn limit was reached, check if the phase's primary report artifact was produced
    const wsRoot = this.tools.getWorkspaceRoot();
    let recoveredSuccess = false;
    let recoveredSummary = "";
    if (this.phaseName?.includes("13_") || this.phaseName?.includes("critique")) {
      const repPath = path.join(wsRoot, "docs", "report_critique.md");
      const revPath = path.join(wsRoot, "docs", "manuscript_rev_02.md");
      if (fsSync.existsSync(repPath) && fsSync.statSync(repPath).size > 500 && fsSync.existsSync(revPath)) {
        recoveredSuccess = true;
        recoveredSummary = `Phase completed: Report (docs/report_critique.md) and revised manuscript (docs/manuscript_rev_02.md) were successfully finalized on disk before turn budget expired.`;
      }
    } else if (this.phaseName?.includes("12_") || this.phaseName?.includes("integrity")) {
      const repPath = path.join(wsRoot, "docs", "report_integrity.md");
      const revPath = path.join(wsRoot, "docs", "manuscript_rev_01.md");
      if (fsSync.existsSync(repPath) && fsSync.statSync(repPath).size > 500 && fsSync.existsSync(revPath)) {
        recoveredSuccess = true;
        recoveredSummary = `Phase completed: Integrity report (docs/report_integrity.md) and corrected manuscript (docs/manuscript_rev_01.md) were successfully finalized on disk before turn budget expired.`;
      }
    }

    if (recoveredSuccess) {
      if (this.chatLogger) {
        await this.chatLogger.logPhaseEnd({
          phaseTitle: this.phaseTitle || this.phaseName,
          phaseFileName: this.phaseName,
          success: true,
          summary: recoveredSummary,
          durationSeconds,
          tokensUsed: this.totalUsage,
          turnCount: maxTurns,
        });
      }
      return {
        success: true,
        summary: recoveredSummary,
        tokensUsed: this.totalUsage,
        phaseName: this.phaseName,
        turnCount: maxTurns,
      };
    }

    const failureSummary = `Turn limit reached (${maxTurns} turns) without completing phase checkpoints.`;

    if (this.chatLogger) {
      await this.chatLogger.logPhaseEnd({
        phaseTitle: this.phaseTitle || this.phaseName,
        phaseFileName: this.phaseName,
        success: false,
        summary: failureSummary,
        durationSeconds,
        tokensUsed: this.totalUsage,
        turnCount: maxTurns,
      });
    }

    return {
      success: false,
      summary: failureSummary,
      tokensUsed: this.totalUsage,
      phaseName: this.phaseName,
      turnCount: maxTurns,
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

    if (normPhase.includes("01_inspect")) {
      const hasRds = await checkFile("data/tidyproteomics_data.rds");
      const hasCounts = await checkFile("data/*counts*.png");
      if (!hasRds && !hasCounts) missing.push("data/tidyproteomics_data.rds or data/*counts*.png");
    } else if (normPhase.includes("02_normalize")) {
      const hasRds = await checkFile("data/tidyproteomics_data.rds");
      if (!hasRds) missing.push("data/tidyproteomics_data.rds");
    } else if (normPhase.includes("03_impute")) {
      const hasRds = await checkFile("data/tidyproteomics_data.rds");
      if (!hasRds) missing.push("data/tidyproteomics_data.rds");
    } else if (normPhase.includes("04_expression")) {
      const hasRds = await checkFile("data/tidyproteomics_data.rds");
      const hasExpr = (await checkFile("data/table_*expression_*.tsv")) || (await checkFile("data/table_*expression_*.csv"));
      const hasVolcano = await checkFile("data/*volcano*.png");
      if (!hasRds) missing.push("data/tidyproteomics_data.rds");
      if (!hasExpr) missing.push("data/table_*expression_*.tsv or .csv");
      if (!hasVolcano) missing.push("data/*volcano*.png");
    } else if (normPhase.includes("05_enrichment")) {
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
    } else if (normPhase.includes("07_knowledge")) {
      const hasKnowledge = await checkFile("docs/knowledge.md");
      if (!hasKnowledge) missing.push("docs/knowledge.md");
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
    } else if (normPhase.includes("10_figures")) {
      const hasFig = await checkFile("data/plot_*.png");
      if (!hasFig) missing.push("data/plot_*.png (at least one discussion figure)");
    } else if (normPhase.includes("11_synthesis")) {
      const hasManuscript = (await checkFile("manuscript.md")) || (await checkFile("docs/manuscript.md"));
      if (!hasManuscript) missing.push("manuscript.md or docs/manuscript.md");
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

