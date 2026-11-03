import * as fs from "fs/promises";
import * as fsSync from "fs";
import * as path from "path";
import { ProviderClient } from "../llm/ProviderClient";
import { LLMRole, TokenUsage } from "../types";

export interface PerformanceReviewStatus {
  hasReview: boolean;
  hasLogs: boolean;
  phaseCount: number;
  lastGenerated?: string;
  reviewRelPath: string;
}

export interface PerformanceReviewRequest {
  workspaceRoot: string;
  customFocus?: string;
}

export interface PerformanceReviewResult {
  ok: boolean;
  reviewMarkdown: string;
  filePath: string;
  lastGenerated: string;
  model?: string;
  role?: LLMRole;
  tokenUsage?: TokenUsage;
  error?: string;
}

export class PerformanceReviewService {
  constructor(private client: ProviderClient) {}

  /**
   * Checks whether performance review exists and how many phase logs are present.
   */
  public async getReviewStatus(workspaceRoot: string): Promise<PerformanceReviewStatus> {
    const reportDocsPath = path.join(workspaceRoot, "docs", "report_performance_review.md");
    const reportLogsPath = path.join(workspaceRoot, "logs", "report_performance_review.md");
    const legacyDocsPath = path.join(workspaceRoot, "docs", "performance_review.md");
    const legacyLogsPath = path.join(workspaceRoot, "logs", "performance_review.md");
    let relPath = "docs/report_performance_review.md";

    let hasReview = false;
    let lastGenerated: string | undefined = undefined;

    if (fsSync.existsSync(reportDocsPath)) {
      hasReview = true;
      relPath = "docs/report_performance_review.md";
      try {
        const stat = await fs.stat(reportDocsPath);
        lastGenerated = stat.mtime.toISOString();
      } catch {}
    } else if (fsSync.existsSync(reportLogsPath)) {
      hasReview = true;
      relPath = "logs/report_performance_review.md";
      try {
        const stat = await fs.stat(reportLogsPath);
        lastGenerated = stat.mtime.toISOString();
      } catch {}
    } else if (fsSync.existsSync(legacyDocsPath)) {
      hasReview = true;
      relPath = "docs/performance_review.md";
      try {
        const stat = await fs.stat(legacyDocsPath);
        lastGenerated = stat.mtime.toISOString();
      } catch {}
    } else if (fsSync.existsSync(legacyLogsPath)) {
      hasReview = true;
      relPath = "logs/performance_review.md";
      try {
        const stat = await fs.stat(legacyLogsPath);
        lastGenerated = stat.mtime.toISOString();
      } catch {}
    }

    let phaseCount = 0;
    let hasLogs = false;
    const logsDir = path.join(workspaceRoot, "logs");
    if (fsSync.existsSync(logsDir)) {
      try {
        const entries = await fs.readdir(logsDir, { withFileTypes: true });
        for (const entry of entries) {
          if (entry.isDirectory() && entry.name !== "agent") {
            phaseCount++;
          }
        }
        hasLogs = phaseCount > 0 || fsSync.existsSync(path.join(logsDir, "pipeline.md"));
      } catch {}
    }

    return {
      hasReview,
      hasLogs,
      phaseCount,
      lastGenerated,
      reviewRelPath: relPath,
    };
  }

  /**
   * Reads existing performance review content if available.
   */
  public async getExistingReview(workspaceRoot: string): Promise<string | null> {
    const reportDocsPath = path.join(workspaceRoot, "docs", "report_performance_review.md");
    if (fsSync.existsSync(reportDocsPath)) {
      return await fs.readFile(reportDocsPath, "utf-8");
    }
    const reportLogsPath = path.join(workspaceRoot, "logs", "report_performance_review.md");
    if (fsSync.existsSync(reportLogsPath)) {
      return await fs.readFile(reportLogsPath, "utf-8");
    }
    const legacyDocsPath = path.join(workspaceRoot, "docs", "performance_review.md");
    if (fsSync.existsSync(legacyDocsPath)) {
      return await fs.readFile(legacyDocsPath, "utf-8");
    }
    const legacyLogsPath = path.join(workspaceRoot, "logs", "performance_review.md");
    if (fsSync.existsSync(legacyLogsPath)) {
      return await fs.readFile(legacyLogsPath, "utf-8");
    }
    return null;
  }

  /**
   * Gathers and summarizes pipeline logs, console errors, user chat interactions,
   * and scientific outputs across all phases into an information-dense audit digest.
   */
  public async gatherLogsDigest(workspaceRoot: string): Promise<string> {
    const sections: string[] = [];

    // 1. Pipeline Summary Master Table (logs/pipeline.md)
    const pipelineLogPath = path.join(workspaceRoot, "logs", "pipeline.md");
    if (fsSync.existsSync(pipelineLogPath)) {
      try {
        const raw = await fs.readFile(pipelineLogPath, "utf-8");
        sections.push(`### Master Pipeline Execution Table (logs/pipeline.md)\n\n${raw.trim()}`);
      } catch {}
    }

    // 2. Study Design & Experiment Parameters (docs/experiment.md)
    const expPath = path.join(workspaceRoot, "docs", "experiment.md");
    if (fsSync.existsSync(expPath)) {
      try {
        const expRaw = await fs.readFile(expPath, "utf-8");
        const cleanExp = expRaw
          .split("\n")
          .filter((l) => !l.startsWith("<!--") && !l.startsWith("👉"))
          .slice(0, 50)
          .join("\n")
          .trim();
        sections.push(`### Experiment Setup & Study Design (docs/experiment.md)\n\n${cleanExp}`);
      } catch {}
    }

    // 3. Per-Phase Chat Traces and Console Error Diagnostics
    const logsDir = path.join(workspaceRoot, "logs");
    if (fsSync.existsSync(logsDir)) {
      try {
        const entries = await fs.readdir(logsDir, { withFileTypes: true });
        const phaseDirs = entries
          .filter((e) => e.isDirectory() && e.name !== "agent")
          .map((e) => e.name)
          .sort();

        for (const phaseDir of phaseDirs) {
          const phaseDigest = await this.extractPhaseDigest(path.join(logsDir, phaseDir), phaseDir);
          if (phaseDigest) {
            sections.push(phaseDigest);
          }
        }
      } catch (err) {
        console.error("[PerformanceReviewService] Error reading phase logs:", err);
      }
    }

    // 4. Interactive Agent Chat Traces (logs/agent/*.md)
    const agentLogsDir = path.join(logsDir, "agent");
    if (fsSync.existsSync(agentLogsDir)) {
      try {
        const agentFiles = await fs.readdir(agentLogsDir);
        const mdFiles = agentFiles.filter((f) => f.endsWith(".md")).sort();
        const chatExtracts: string[] = [];

        for (const file of mdFiles.slice(-3)) { // inspect up to 3 most recent sessions
          const content = await fs.readFile(path.join(agentLogsDir, file), "utf-8");
          // Extract conversational user and agent turns with their verbatim content
          const turns = content.split(/(?=###\s+(?:User|Agent|Assistant|TidyProteomics Agent))/i);
          const meaningfulTurns = turns
            .map((t) => t.trim())
            .filter((t) => /^###\s+(?:User|Agent|Assistant|TidyProteomics Agent)/i.test(t))
            .slice(-12);
          if (meaningfulTurns.length > 0) {
            chatExtracts.push(`Session ${file}:\n${meaningfulTurns.join("\n\n")}`);
          }
        }

        if (chatExtracts.length > 0) {
          sections.push(`### Interactive User/Agent Dialogues (logs/agent/)\n\n${chatExtracts.join("\n\n")}`);
        }
      } catch {}
    }

    // 5. Scientific Findings & Hypotheses Documentation
    const docFiles = [
      { name: "docs/data.md", label: "Dataset Overview & Ingestion Audit (Phase 01+)" },
      { name: "docs/observations.md", label: "Primary Observations & Inferences (Phase 06)" },
      { name: "docs/knowledge.md", label: "Biological Knowledge & Module Deductions (Phase 07)" },
      { name: "docs/manuscript.md", label: "Scientific Manuscript (Phase 11 Synthesis)" },
      { name: "docs/notes.md", label: "Runtime Blackboard Notes" },
    ];

    for (const doc of docFiles) {
      const fullPath = path.join(workspaceRoot, doc.name);
      if (fsSync.existsSync(fullPath)) {
        try {
          const raw = await fs.readFile(fullPath, "utf-8");
          // Extract headers and key summary sections (first ~100 lines)
          const lines = raw.split("\n");
          const excerpt = lines.slice(0, 120).join("\n").trim();
          sections.push(`### Scientific Document: ${doc.label} (${doc.name})\n\n${excerpt}`);
        } catch {}
      }
    }

    return sections.join("\n\n---\n\n");
  }

  /**
   * Extracts compact, high-value signals from a phase directory:
   * - Phase objectives and starting directives
   * - Tool calls & summarized parameters
   * - Tool errors & exception details
   * - Agent thinking summaries
   * - Console stdout/stderr errors and warnings
   * - Completion or failure markers
   */
  private async extractPhaseDigest(phaseDirPath: string, phaseName: string): Promise<string | null> {
    const chatPath = path.join(phaseDirPath, "chat.md");
    const consolePath = path.join(phaseDirPath, "console.log");

    const linesOut: string[] = [];
    linesOut.push(`#### Phase Execution: [${phaseName}]`);

    // Parse chat.md
    if (fsSync.existsSync(chatPath)) {
      try {
        const chatRaw = await fs.readFile(chatPath, "utf-8");
        const chatLines = chatRaw.split("\n");

        // Identify Directive, Model, Tools, and Errors
        const toolCalls: string[] = [];
        const errors: string[] = [];
        const thoughts: string[] = [];
        let outcome = "Outcome: Unknown";

        for (let i = 0; i < chatLines.length; i++) {
          const line = chatLines[i];

          if (line.startsWith("- **Tool Calls**:") || line.startsWith("**Tool Calls**:")) {
            for (let j = i + 1; j < chatLines.length; j++) {
              const cl = chatLines[j];
              if (cl.startsWith("### [") || cl.startsWith("#### [") || cl.startsWith("### Phase") || cl.startsWith("✓ Phase") || cl.startsWith("❌ Phase")) break;
              if (cl.includes("- **`")) {
                const match = cl.match(/- \*\*`([A-Za-z0-9_]+)`\*\*/);
                if (match) toolCalls.push(match[1]);
              }
            }
          }

          if (line.includes("Tool Result: `")) {
            const m = line.match(/Tool Result:\s*`([A-Za-z0-9_]+)`/);
            if (m) toolCalls.push(m[1]);
          }

          if (line.includes("[ERROR]") || line.includes("Execution halted") || line.includes("❌ Phase FAILED")) {
            const contextSnippet = chatLines.slice(Math.max(0, i - 1), Math.min(chatLines.length, i + 4)).join(" ");
            errors.push(contextSnippet.trim());
          }

          if (line.includes("### Phase COMPLETED") || line.includes("✓ Phase COMPLETED")) {
            outcome = "Outcome: COMPLETED";
            // Grab following lines for summary
            const summ = chatLines.slice(i, i + 6).join("\n");
            outcome += `\n${summ}`;
          } else if (line.includes("Phase FAILED")) {
            outcome = "Outcome: FAILED";
            const summ = chatLines.slice(i, i + 6).join("\n");
            outcome += `\n${summ}`;
          }

          if (line.startsWith("💭 **Thinking Process**") || line.startsWith("Agent Thought:")) {
            const snippet = chatLines.slice(i + 1, i + 4).join(" ").trim();
            if (snippet) thoughts.push(snippet.slice(0, 200));
          }
        }

        linesOut.push(`- **Tools Invoked**: ${toolCalls.length > 0 ? Array.from(new Set(toolCalls)).join(", ") : "None"}`);
        if (thoughts.length > 0) {
          linesOut.push(`- **Key Reasoning Excerpts**: ${thoughts.slice(0, 3).map((t) => `"${t}"`).join(" | ")}`);
        }
        if (errors.length > 0) {
          linesOut.push(`- **Errors Detected in Chat Trace**:\n${errors.slice(0, 4).map((e) => `  * ${e}`).join("\n")}`);
        }
        linesOut.push(`- **Status**: ${outcome}`);
      } catch (err) {
        linesOut.push(`- Note: Error reading chat.md: ${String(err)}`);
      }
    } else {
      linesOut.push(`- No chat.md recorded.`);
    }

    // Parse console.log for errors and warnings
    if (fsSync.existsSync(consolePath)) {
      try {
        const consoleRaw = await fs.readFile(consolePath, "utf-8");
        const cLines = consoleRaw.split("\n");
        const consoleErrors: string[] = [];

        for (const cl of cLines) {
          const lower = cl.toLowerCase();
          if (
            lower.includes("error:") ||
            lower.includes("fatal error") ||
            lower.includes("execution halted") ||
            lower.includes("traceback (most recent call last)") ||
            lower.includes("cannot open file") ||
            lower.includes("subscript out of bounds") ||
            lower.includes("object not found") ||
            lower.includes("warning:")
          ) {
            consoleErrors.push(cl.trim());
          }
        }

        if (consoleErrors.length > 0) {
          linesOut.push(`- **Raw Console Diagnostics (Errors/Warnings)**:\n${consoleErrors.slice(0, 6).map((e) => `  * \`${e.slice(0, 160)}\``).join("\n")}`);
        }
      } catch {}
    }

    return linesOut.join("\n");
  }

  /**
   * Generates a comprehensive, publication-grade Performance Review using Tier 3 (Reasoner).
   * Assesses tool usage, user interaction, reasoning depth, scientific hypotheses,
   * and attributes all bugs to LLM, Prompt, or Tools.
   */
  public async generateReview(req: PerformanceReviewRequest): Promise<PerformanceReviewResult> {
    const { workspaceRoot, customFocus } = req;
    const logsDigest = await this.gatherLogsDigest(workspaceRoot);

    if (!logsDigest || logsDigest.trim().length === 0) {
      return {
        ok: false,
        reviewMarkdown: "",
        filePath: "docs/report_performance_review.md",
        lastGenerated: new Date().toISOString(),
        error: "No execution logs or pipeline traces found in this workspace.",
      };
    }

    const reasonerClient = this.client.forRole("reasoner");
    const roleConfig = reasonerClient.getConfig();

    const systemPrompt = `You are an Elite Bioinformatics AI Systems Auditor, Senior Proteomics Data Scientist, and LLM Agent Evaluator.

Your objective is to conduct a rigorous, evidence-based "Performance Review" of the autonomous TidyProteomics AI Agent based on complete execution traces, console logs, user interactions, and scientific outputs.

You must thoroughly evaluate the run across THREE MANDATORY EVALUATION PILLARS:

======================================================================
PILLAR 1: Tool Usage, User Interaction & Step-by-Step Reasoning
======================================================================
1. Tool Usage:
   - How well did the agent select, parameterize, and sequence tools (e.g. tpa_*, read_file, write_file, edit_file, execute_command)?
   - Did the agent understand output schemas, manage wide tabular outputs without overflow, and handle data layer transitions (e.g. raw -> normalized -> imputed -> limma)?
   - Were there redundant, inefficient, or looping tool invocations?
2. User Interaction:
   - How effectively did the agent interact with the user (e.g., Human-in-the-Loop gates, sample group confirmations, contrast verification)?
   - Was the agent clear, transparent, and proactive when asking questions or presenting options?
3. Reasoning & Logic:
   - Did the agent exhibit disciplined chain-of-thought reasoning?
   - When encountering obstacles or unexpected data distributions, did it diagnose root causes or flail?

======================================================================
PILLAR 2: Scientific Hypotheses & Biological Rigor
======================================================================
1. Data-Derived Hypotheses:
   - Did the agent develop well-founded, biologically plausible hypotheses about the quantitative proteomics data?
   - Were hypotheses grounded in empirical statistical evidence (fold changes, volcano p-values, PCA separation, GO/Reactome pathway enrichments)?
2. Biological Accuracy & Depth:
   - Did it connect data points across phases coherently (e.g., from QC anomalies -> normalization decisions -> differential candidates -> pathway themes -> literature synthesis)?
   - Did it avoid speculative leaps or unsupported hallucinations?

======================================================================
PILLAR 3: Comprehensive Bug & Anomaly Attribution Registry
======================================================================
You must identify EVERY error, warning, crash, unexpected halt, retry, or glitch that occurred across the phases.
For EVERY bug/anomaly identified, you MUST explicitly attribute it to EXACTLY ONE of these three categories:
- 🤖 [LLM]: Hallucinated parameters, invalid JSON/syntax, malformed tool arguments, looping without tools, premature halting, failing to call complete_phase.
- 📝 [Prompt]: Ambiguous phase instructions, missing directives, missing schema specifications, contradictory guidelines, lack of error-handling advice in the phase markdown.
- 🔧 [Tools]: MCP tool crashes, R runtime/package errors, timeout issues, unhandled data types, missing script dependencies, environment limitations.

Provide for each bug:
- Incident / Phase: (e.g. Phase 02 Normalization, Phase 11 Synthesis)
- What Happened: (factual description with log quotes/evidence)
- Root Cause Attribution: ([LLM] or [Prompt] or [Tools])
- Impact on Run: (minor retry vs. pipeline block)
- Recommended Fix: (exact instruction to fix prompt, tool code, or model behavior)

======================================================================
OUTPUT STRUCTURE REQUIRED:
======================================================================
Format your entire review in clean, publication-grade GitHub-style Markdown:

# Autonomous Agent Performance Review & System Audit

> **Evaluator**: ${roleConfig.model || "Tier-3 Reasoner"} (${roleConfig.provider || "System"})
> **Date**: ${new Date().toISOString().replace("T", " ").slice(0, 19)} UTC
> **Workspace**: \`${workspaceRoot}\`

## 1. Executive Summary & Performance Scorecard
(Provide a concise executive appraisal and a markdown scorecard table with letter grades [A+, A, B, C, F] for Tool Execution, User Interaction, Reasoning & Hypothesis Quality, and Autonomous Robustness).

## 2. Pillar 1: Tool Usage, User Interaction & Reasoning Assessment
### 2.1 Tool Execution & API Proficiency
### 2.2 Human-in-the-Loop & User Interaction
### 2.3 Step-by-Step Reasoning & Error Recovery

## 3. Pillar 2: Scientific Hypotheses & Biological Rigor
### 3.1 Empirical Foundation of Formulated Hypotheses
### 3.2 Biological Contextualization & Pathway Coherence
### 3.3 Synthesis & Translation Quality

## 4. Pillar 3: Bug & Anomaly Attribution Registry
(Provide a structured summary table attributing each issue to [LLM], [Prompt], or [Tools], followed by detailed case-by-case autopsies).

| # | Phase / Component | Issue Description | Attribution | Severity | Recommended Fix |
|---|---|---|---|---|---|
...

### Detailed Incident Analysis & Root Causes
(Breakdown of each incident with evidence from the logs)

## 5. Actionable Recommendations for Engineering & Prompt Architecture
(Concrete improvements to prompt directives, MCP tool definitions, and agent loop policies)

Be rigorous, frank, and specific. Quote exact tool names, error strings, and file names from the logs.

======================================================================
CRITICAL GENERATION REQUIREMENTS:
======================================================================
- You MUST output the ENTIRE Markdown performance review report in your response, beginning directly with the header:
  # Autonomous Agent Performance Review & System Audit
- Do NOT output conversational preambles, acknowledgments, or preliminary plans (e.g. "I will audit...").
- Do NOT ask questions or request additional logs—conduct the full audit immediately using the comprehensive Blackboard digest provided.
- Fill out all five sections with complete analysis, detailed scorecard, and evidence from the traces.`;

    const userPrompt = `Please evaluate the following execution logs and workspace artifacts to generate the comprehensive Performance Review:

${customFocus ? `Researcher's Custom Focus Area / Specific Questions:\n${customFocus}\n\n` : ""}
EXECUTION LOGS & RUNTIME BLACKBOARD DIGEST:
${logsDigest}

Generate the complete, publication-grade Performance Review report now following the required structure, starting directly with "# Autonomous Agent Performance Review & System Audit".`;

    const isValidReport = (text: string): boolean => {
      const trimmed = (text || "").trim();
      return (
        trimmed.length >= 800 &&
        (trimmed.includes("# Autonomous Agent Performance Review") ||
          trimmed.includes("## 1. Executive Summary") ||
          trimmed.includes("Executive Summary") ||
          trimmed.includes("Scorecard") ||
          trimmed.includes("Pillar 1"))
      );
    };

    try {
      let response = await reasonerClient.chat({
        system: systemPrompt,
        messages: [{ role: "user", content: userPrompt }],
        tools: [],
      });

      let reviewMarkdown = response.content?.trim() || "";

      // If response is a conversational prelude or incomplete stub, perform an autonomous recovery turn
      if (!isValidReport(reviewMarkdown)) {
        console.warn(
          `[PerformanceReviewService] Initial reasoner response was insufficient (${reviewMarkdown.length} chars). Executing recovery follow-up turn...`
        );
        const recoveryResponse = await reasonerClient.chat({
          system: systemPrompt,
          messages: [
            { role: "user", content: userPrompt },
            {
              role: "assistant",
              content:
                reviewMarkdown ||
                "I will audit the phase traces, console errors, and scientific artifacts.",
            },
            {
              role: "user",
              content:
                "Please proceed immediately with generating the complete, comprehensive Markdown audit report following the required format starting with '# Autonomous Agent Performance Review & System Audit'. Do not stop or ask questions; provide the full report now.",
            },
          ],
          tools: [],
        });

        if (recoveryResponse.content && isValidReport(recoveryResponse.content)) {
          reviewMarkdown = recoveryResponse.content.trim();
          response = recoveryResponse;
        }
      }

      if (!isValidReport(reviewMarkdown)) {
        return {
          ok: false,
          reviewMarkdown: reviewMarkdown || "",
          filePath: "docs/report_performance_review.md",
          lastGenerated: new Date().toISOString(),
          error: `Reasoner model returned incomplete or conversational audit text (${reviewMarkdown.length} chars) instead of the full performance review report. Please try generating again.`,
        };
      }

      // Write to docs/report_performance_review.md
      const docsDir = path.join(workspaceRoot, "docs");
      const docsTarget = path.join(docsDir, "report_performance_review.md");
      const logsTarget = path.join(workspaceRoot, "logs", "report_performance_review.md");

      await fs.mkdir(docsDir, { recursive: true });
      await fs.writeFile(docsTarget, reviewMarkdown, "utf-8");

      // Also mirror in logs/report_performance_review.md
      const logsDir = path.join(workspaceRoot, "logs");
      await fs.mkdir(logsDir, { recursive: true });
      await fs.writeFile(logsTarget, reviewMarkdown, "utf-8");

      return {
        ok: true,
        reviewMarkdown,
        filePath: "docs/report_performance_review.md",
        lastGenerated: new Date().toISOString(),
        model: roleConfig.model,
        role: "reasoner",
        tokenUsage: response.usage,
      };
    } catch (err: any) {
      console.error("[PerformanceReviewService] Review generation error:", err);
      return {
        ok: false,
        reviewMarkdown: "",
        filePath: "docs/report_performance_review.md",
        lastGenerated: new Date().toISOString(),
        error: err.message || "Failed to generate performance review",
      };
    }
  }
}

