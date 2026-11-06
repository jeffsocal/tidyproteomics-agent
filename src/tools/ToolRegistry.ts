import * as fs from "fs/promises";
import * as fsSync from "fs";
import * as readline from "readline";
import * as path from "path";
import { exec } from "child_process";
import { promisify } from "util";
import { ToolDefinition, ToolResult } from "../types";
import { createWebSearchToolHandlers } from "./WebSearchTools";

const execAsync = promisify(exec);

export interface IToolHandler {
  definition: ToolDefinition;
  execute(args: Record<string, any>): Promise<string>;
}

/**
 * Parses tool definitions from YAML frontmatter in phase markdown content.
 * Supports:
 * - inline array: tools: [tpa_health, tpa_load, ...]
 * - quoted array: tools: ["tpa_health", "tpa_load"]
 * - yaml list:
 *     tools:
 *       - tpa_health
 *       - tpa_load
 * - all tools: tools: all, tools: "*", tools: "all"
 *
 * Returns:
 * - string[]: Array of allowed MCP tool names
 * - "all": Wildcard allowing all MCP tools
 * - undefined: If no frontmatter or tools key is present (defaults to all)
 */
export function parseToolsFromFrontmatter(content: string): string[] | "all" | undefined {
  if (!content) {
    return undefined;
  }

  let frontmatter: string | undefined;
  const startFmMatch = content.match(/^\s*---\r?\n([\s\S]*?)\r?\n---/);
  if (startFmMatch) {
    frontmatter = startFmMatch[1];
  } else {
    const embeddedFmMatch = content.match(/(?:^|\n)---\r?\n([\s\S]*?tools:\s*[\s\S]*?)\r?\n---/);
    if (embeddedFmMatch) {
      frontmatter = embeddedFmMatch[1];
    }
  }

  if (!frontmatter) {
    return undefined;
  }

  // 1. Wildcard / All tools: tools: all | tools: "*" | tools: 'all'
  if (/tools:\s*["']?(?:\*|all|ALL)["']?\s*(?:$|\r?\n)/m.test(frontmatter)) {
    return "all";
  }

  // 2. Inline bracketed list: tools: [tool1, tool2]
  const inlineMatch = frontmatter.match(/tools:\s*\[([\s\S]*?)\]/);
  if (inlineMatch) {
    return inlineMatch[1]
      .split(",")
      .map((s) => s.trim().replace(/^['"]|['"]$/g, ""))
      .filter((s) => s.length > 0);
  }

  // 3. YAML list style:
  // tools:
  //   - tool1
  //   - tool2
  const listMatch = frontmatter.match(/tools:\s*\r?\n((?:\s*-\s*[^\r\n]+\r?\n?)+)/);
  if (listMatch) {
    return listMatch[1]
      .split(/\r?\n/)
      .map((line) => line.replace(/^\s*-\s*/, "").trim().replace(/^['"]|['"]$/g, ""))
      .filter((s) => s.length > 0);
  }

  // 4. Single unbracketed tool name (e.g. tools: tpa_health)
  const singleMatch = frontmatter.match(/tools:\s*([a-zA-Z0-9_-]+)\s*(?:$|\r?\n)/m);
  if (singleMatch) {
    const val = singleMatch[1].trim();
    if (val.toLowerCase() === "all" || val === "*") {
      return "all";
    }
    return [val];
  }

  return undefined;
}

export class ToolRegistry {
  private tools = new Map<string, IToolHandler>();
  private mcpToolNames = new Set<string>();
  private mcpPhaseListener?: (phaseName: string) => void;

  constructor(private workspaceRoot: string) {
    this.workspaceRoot = workspaceRoot || "";
    this.registerDefaultTools();
  }

  public setWorkspaceRoot(newRoot: string) {
    this.workspaceRoot = newRoot || "";
  }

  public getWorkspaceRoot(): string {
    return this.workspaceRoot || "";
  }

  public setMcpPhaseListener(listener: (phaseName: string) => void) {
    this.mcpPhaseListener = listener;
  }

  public setActivePhase(phaseName: string) {
    if (this.mcpPhaseListener) {
      this.mcpPhaseListener(phaseName);
    }
  }

  public getDefinitions(phaseFileName?: string, phaseContent?: string): ToolDefinition[] {
    const allDefs = Array.from(this.tools.values()).map((t) => t.definition);
    if (!phaseFileName && !phaseContent) {
      return allDefs;
    }

    let rawContent = phaseContent;
    if (!rawContent && phaseFileName) {
      const candidatePaths = [
        path.isAbsolute(phaseFileName) ? phaseFileName : "",
        this.workspaceRoot ? path.join(this.workspaceRoot, "analysis", phaseFileName.endsWith(".md") ? phaseFileName : `${phaseFileName}.md`) : "",
        this.workspaceRoot ? path.join(this.workspaceRoot, phaseFileName.endsWith(".md") ? phaseFileName : `${phaseFileName}.md`) : "",
        this.workspaceRoot ? path.join(this.workspaceRoot, phaseFileName) : "",
        this.workspaceRoot ? path.join(this.workspaceRoot, "extension", "templates", "pipelines", "differential_expression", phaseFileName.endsWith(".md") ? phaseFileName : `${phaseFileName}.md`) : "",
        this.workspaceRoot ? path.join(this.workspaceRoot, "extension", "templates", "pipelines", "rapid_expression", phaseFileName.endsWith(".md") ? phaseFileName : `${phaseFileName}.md`) : "",
        this.workspaceRoot ? path.join(this.workspaceRoot, "extension", "templates", "pipelines", "quality_control_only", phaseFileName.endsWith(".md") ? phaseFileName : `${phaseFileName}.md`) : "",
        this.workspaceRoot ? path.join(this.workspaceRoot, "extension", "templates", "pipelines", "multi_cohort_merge", phaseFileName.endsWith(".md") ? phaseFileName : `${phaseFileName}.md`) : "",
        this.workspaceRoot ? path.join(this.workspaceRoot, "extension", "templates", "pipelines", "biological_synthesis", phaseFileName.endsWith(".md") ? phaseFileName : `${phaseFileName}.md`) : "",
        this.workspaceRoot ? path.join(this.workspaceRoot, "extension", "templates", "pipelines", "peptide_analysis", phaseFileName.endsWith(".md") ? phaseFileName : `${phaseFileName}.md`) : "",
      ].filter(Boolean);

      for (const p of candidatePaths) {
        if (fsSync.existsSync(p)) {
          try {
            rawContent = fsSync.readFileSync(p, "utf-8");
            break;
          } catch {
            // ignore read error and try next candidate
          }
        }
      }
    }

    const allowedMcpTools = rawContent ? parseToolsFromFrontmatter(rawContent) : undefined;

    // If no frontmatter or tools: all / "*", expose all tools
    if (allowedMcpTools === undefined || allowedMcpTools === "all") {
      return allDefs;
    }

    const allowedSet = new Set(allowedMcpTools);
    return allDefs.filter((def) => {
      // Core built-in tools are ALWAYS preserved
      if (!this.mcpToolNames.has(def.name)) {
        return true;
      }
      return allowedSet.has(def.name);
    });
  }

  public hasTool(name: string): boolean {
    return this.tools.has(name);
  }

  public async execute(name: string, args: Record<string, any>): Promise<ToolResult> {
    const handler = this.tools.get(name);
    if (!handler) {
      return {
        tool_call_id: "",
        content: `Error: Tool '${name}' not found. Available tools: ${Array.from(this.tools.keys()).join(", ")}`,
        isError: true,
      };
    }

    try {
      const output = await handler.execute(args);
      const isErr = typeof output === "string" && (
        output.startsWith("Error:") ||
        output.startsWith("Error in ") ||
        output.startsWith("Tool error:") ||
        output.startsWith("Execution halted") ||
        /Error in [a-zA-Z0-9_]+:/i.test(output.slice(0, 100))
      );
      return {
        tool_call_id: "",
        content: output,
        isError: isErr,
      };
    } catch (err: any) {
      return {
        tool_call_id: "",
        content: `Error executing tool '${name}': ${err.message || String(err)}`,
        isError: true,
      };
    }
  }

  private resolvePath(filePath: string): string {
    const root = this.workspaceRoot || "";
    if (!root) {
      throw new Error("No active workspace directory set.");
    }
    const resolved = path.isAbsolute(filePath) ? path.resolve(filePath) : path.resolve(root, filePath);
    const normalizedRoot = path.resolve(root);
    if (resolved !== normalizedRoot && !resolved.startsWith(normalizedRoot + path.sep)) {
      throw new Error(`Security restriction: access to '${filePath}' outside workspace root is denied.`);
    }
    return resolved;
  }

  private assertNotProtected(filePath: string): void {
    const root = this.workspaceRoot || "";
    const resolved = path.isAbsolute(filePath) ? path.resolve(filePath) : path.resolve(root, filePath);
    const normalizedRel = root ? path.relative(path.resolve(root), resolved).replace(/\\/g, "/") : filePath.replace(/\\/g, "/");

    const isProtected = ["docs/llm.md", "agent/PROTOCOL.md", "agent/VARIABLES.md"].some(
      (p) => normalizedRel === p || normalizedRel.endsWith("/" + p)
    );

    if (isProtected) {
      throw new Error(
        `Security Policy Violation: '${filePath}' is a protected user or extension specification file and cannot be modified by the agent. Record runtime logs in 'docs/notes.md' and biological findings across docs/ (observations.md, knowledge.md, websearch.md, literature.md).`
      );
    }
  }

  private async assertNotSelfConfirmingGate(filePath: string, targetContent?: string, replacementContent?: string): Promise<void> {
    const root = this.workspaceRoot || "";
    const resolved = path.isAbsolute(filePath) ? path.resolve(filePath) : path.resolve(root, filePath);
    const normalizedRel = root ? path.relative(path.resolve(root), resolved).replace(/\\/g, "/") : filePath.replace(/\\/g, "/");

    const isExperimentMd = normalizedRel === "docs/experiment.md" || normalizedRel.endsWith("/docs/experiment.md");
    if (!isExperimentMd || !replacementContent) return;

    // Check if targetContent is explicitly trying to replace FALSE with TRUE
    if (targetContent && /\b(?:Confirm\s+[A-Za-z0-9\s&]+|Proceed\s+With\s+Potential\s+Batch\s+Confounding)\s*:\s*FALSE\b/i.test(targetContent)) {
      if (/\b(?:Confirm\s+[A-Za-z0-9\s&]+|Proceed\s+With\s+Potential\s+Batch\s+Confounding)\s*:\s*TRUE\b/i.test(replacementContent)) {
        throw new Error(
          `Security Policy Violation: Autonomous agents are strictly prohibited from self-confirming Human-in-the-Loop (HITL) gates in '${filePath}'. Changing 'Confirm ...: FALSE' to 'TRUE' must be performed by the human researcher via interactive chat action chips or the Experiment Setup tab. Please scaffold suggested settings into Section 3 with 'Confirm ...: FALSE' and invoke 'fail_phase' to pause for human verification.`
        );
      }
    }

    // For write_file or general replacement: check if existing file on disk has FALSE and new content flips it to TRUE
    try {
      if (fsSync.existsSync(resolved)) {
        const existing = await fs.readFile(resolved, "utf-8");
        const gateKeys = [
          "Confirm Discovered Sample Groups",
          "Confirm Normalization Strategy",
          "Confirm Imputation Strategy",
          "Confirm Sample Pooling Map",
          "Confirm Target Contrasts",
          "Confirm Batch Confounding Authorization",
          "Proceed With Potential Batch Confounding",
          "Confirm Functional Annotation Strategy",
        ];
        for (const key of gateKeys) {
          const falseRegex = new RegExp(`-\\s*\\*\\*${key}\\*\\*\\s*:\\s*FALSE`, "i");
          const trueRegex = new RegExp(`-\\s*\\*\\*${key}\\*\\*\\s*:\\s*TRUE`, "i");
          if (falseRegex.test(existing) && trueRegex.test(replacementContent)) {
            throw new Error(
              `Security Policy Violation: Autonomous agents are strictly prohibited from self-confirming Human-in-the-Loop (HITL) gates in '${filePath}'. Changing '${key}: FALSE' to 'TRUE' must be performed by the human researcher via interactive chat action chips or the Experiment Setup tab. Please scaffold suggested settings into Section 3 with 'FALSE' and invoke 'fail_phase' to pause for human verification.`
            );
          }
        }
      }
    } catch (err: any) {
      if (err.message?.includes("Security Policy Violation")) {
        throw err;
      }
    }
  }

  private registerDefaultTools() {
    // 1. execute_command
    this.tools.set("execute_command", {
      definition: {
        name: "execute_command",
        description: "Executes a shell command in the workspace directory (e.g. running Rscript code/01_inspect_dataset.R). Captures stdout and stderr.",
        parameters: {
          type: "object",
          properties: {
            command: {
              type: "string",
              description: "The shell command line to run",
            },
            timeoutMs: {
              type: "number",
              description: "Optional execution timeout in milliseconds (default: 600000ms / 10m)",
            },
          },
          required: ["command"],
        },
      },
      execute: async (args) => {
        const timeout = args.timeoutMs || 600000;
        try {
          const effectiveCwd = this.workspaceRoot;
          if (!effectiveCwd) {
            throw new Error("Cannot execute command: No active workspace directory is configured.");
          }
          const defaultShell = process.platform === "win32"
            ? undefined
            : (fsSync.existsSync("/bin/bash")
                ? "/bin/bash"
                : (process.env.SHELL && fsSync.existsSync(process.env.SHELL)
                    ? process.env.SHELL
                    : "/bin/sh"));

          // Prevent log desynchronization & truncation:
          // Strip redundant shell redirections or pipes to console.log (the harness automatically records all output)
          let commandToRun = String(args.command || "").trim();
          if (/^(?:true|:|\/bin\/true|echo\s*)$/i.test(commandToRun)) {
            throw new Error(
              "NO_OP_COMMAND_REJECTED: Do not invoke execute_command with 'true' or a no-op placeholder. Write the target script directly via write_file or invoke the required tool immediately."
            );
          }
          if (/(?:\bawk\b|\bsplit\b).*manuscript.*(?:_msplit|\/l\d+)/i.test(commandToRun)) {
            throw new Error(
              "MANUSCRIPT_SPLIT_REJECTED: Do not split manuscript.md into temporary files using awk or split. Use read_file(filePath, heading = '...', startChar, maxChars) to inspect specific sections or character ranges directly."
            );
          }
          commandToRun = commandToRun
            .replace(/(?:\s*2>&1)?\s*(?:>|>>|\|\s*tee(?:\s+-a)?)\s+logs\/[^\s;&|]+\/console\.log/g, "")
            .replace(/;\s*test\s+["']?(?:\$\{?PIPESTATUS\[0\]\}?|\$\?)["']?\s+-eq\s+0/g, "");

          const { stdout, stderr } = await execAsync(commandToRun, {
            cwd: effectiveCwd,
            timeout,
            maxBuffer: 10 * 1024 * 1024,
            shell: defaultShell,
          });
          let result = "";
          if (stdout) result += `STDOUT:\n${stdout}\n`;
          if (stderr) result += `STDERR:\n${stderr}\n`;
          return result.trim() || "Command executed successfully with no console output.";
        } catch (error: any) {
          let errOutput = `Command failed with exit code ${error.code ?? "unknown"}\n`;
          if (error.stdout) errOutput += `STDOUT:\n${error.stdout}\n`;
          if (error.stderr) errOutput += `STDERR:\n${error.stderr}\n`;
          if (error.message) errOutput += `Error message: ${error.message}\n`;
          throw new Error(errOutput.trim());
        }
      },
    });

    // 2. read_file
    this.tools.set("read_file", {
      definition: {
        name: "read_file",
        description:
          "Reads file content from the workspace with optional line range (startLine, maxLines), markdown section lookup (heading), or character windowing (startChar, maxChars) for long lines/paragraphs.",
        parameters: {
          type: "object",
          properties: {
            filePath: {
              type: "string",
              description: "Relative or absolute path to the file to read",
            },
            startLine: {
              type: "number",
              description: "Optional 1-based start line number",
            },
            maxLines: {
              type: "number",
              description: "Optional maximum lines to read (prevents dumping large logs or tables)",
            },
            heading: {
              type: "string",
              description: "Optional markdown heading text or substring (e.g. '2.3 Bioinformatics' or '4. Discussion') to read only that section without scanning the entire file",
            },
            startChar: {
              type: "number",
              description: "Optional 0-based character offset (or within the selected line/section range) for reading long paragraphs",
            },
            maxChars: {
              type: "number",
              description: "Optional maximum number of characters to return (useful for long single-line markdown sections)",
            },
          },
          required: ["filePath"],
        },
      },
      execute: async (args) => {
        const fullPath = this.resolvePath(args.filePath);

        // If heading or character windowing is requested, read via full text and slice by heading/chars
        if (args.heading || args.startChar !== undefined || args.maxChars !== undefined) {
          const rawText = await fs.readFile(fullPath, "utf-8");
          const allLines = rawText.split(/\r?\n/);
          let startIdx = Math.max(0, (args.startLine || 1) - 1);
          let endIdx = args.maxLines ? Math.min(allLines.length, startIdx + Math.max(1, args.maxLines)) : allLines.length;

          if (args.heading && String(args.heading).trim()) {
            const q = String(args.heading).trim().replace(/^#+\s*/, "").toLowerCase();
            let foundStart = -1;
            let foundLevel = 0;
            for (let i = 0; i < allLines.length; i++) {
              const hm = allLines[i].match(/^(#{1,6})\s+(.*)$/);
              if (hm && hm[2].toLowerCase().includes(q)) {
                foundStart = i;
                foundLevel = hm[1].length;
                break;
              }
            }
            if (foundStart >= 0) {
              startIdx = foundStart;
              endIdx = allLines.length;
              for (let j = foundStart + 1; j < allLines.length; j++) {
                const nhm = allLines[j].match(/^(#{1,6})\s+/);
                if (nhm && nhm[1].length <= foundLevel) {
                  endIdx = j;
                  break;
                }
              }
              if (args.maxLines) {
                endIdx = Math.min(endIdx, startIdx + Math.max(1, args.maxLines));
              }
            }
          }

          const numberedSlice = allLines
            .slice(startIdx, endIdx)
            .map((line, idx) => `${startIdx + idx + 1}: ${line}`)
            .join("\n");

          const cStart = Math.max(0, Number(args.startChar || 0));
          const cMax = args.maxChars !== undefined ? Math.max(1, Number(args.maxChars)) : numberedSlice.length;
          const charSlice = numberedSlice.slice(cStart, cStart + cMax);
          const charNotice =
            args.startChar !== undefined || args.maxChars !== undefined
              ? `, Chars ${cStart}-${Math.min(numberedSlice.length, cStart + cMax)} of ${numberedSlice.length}`
              : "";
          return `File: ${args.filePath} (Lines ${startIdx + 1}-${endIdx} of ${allLines.length}${charNotice}):\n${charSlice}`;
        }

        const start = Math.max(1, args.startLine || 1);
        const max = Math.max(1, args.maxLines || 2000);

        const fileStream = fsSync.createReadStream(fullPath, { encoding: "utf-8" });
        const rl = readline.createInterface({ input: fileStream, crlfDelay: Infinity });

        const selected: string[] = [];
        let lineIdx = 0;
        let totalLines = 0;

        for await (const line of rl) {
          lineIdx++;
          totalLines = lineIdx;
          if (lineIdx >= start && selected.length < max) {
            selected.push(`${lineIdx}: ${line}`);
          }
        }

        const endLine = selected.length > 0 ? start + selected.length - 1 : start;
        return `File: ${args.filePath} (Lines ${start}-${endLine} of ${totalLines}):\n${selected.join("\n")}`;
      },
    });

    // 3. write_file
    this.tools.set("write_file", {
      definition: {
        name: "write_file",
        description: "Creates or overwrites a file in the workspace with new content.",
        parameters: {
          type: "object",
          properties: {
            filePath: {
              type: "string",
              description: "Relative path to the file to write",
            },
            content: {
              type: "string",
              description: "Complete text content to write into the file",
            },
          },
          required: ["filePath", "content"],
        },
      },
      execute: async (args) => {
        this.assertNotProtected(args.filePath);
        await this.assertNotSelfConfirmingGate(args.filePath, undefined, args.content);
        const fullPath = this.resolvePath(args.filePath);
        await fs.mkdir(path.dirname(fullPath), { recursive: true });
        await fs.writeFile(fullPath, args.content, "utf-8");
        return `Successfully wrote ${args.content.length} characters to ${args.filePath}`;
      },
    });

    // 4. replace_file_content
    this.tools.set("replace_file_content", {
      definition: {
        name: "replace_file_content",
        description: "Replaces an exact target substring with replacement content in an existing file. Note: For analysis scripts and files under 150 lines, prefer 'write_file' to overwrite the complete file cleanly and avoid whitespace mismatch errors. Ensure targetContent matches exact indentation, line prefixes, and bullet/number formatting in the target file, and issue multiple edits to the same file serially across turns.",
        parameters: {
          type: "object",
          properties: {
            filePath: {
              type: "string",
              description: "Relative path to the file to edit",
            },
            targetContent: {
              type: "string",
              description: "Exact substring to find and replace",
            },
            replacementContent: {
              type: "string",
              description: "New content to replace the target substring with",
            },
          },
          required: ["filePath", "targetContent", "replacementContent"],
        },
      },
      execute: async (args) => {
        this.assertNotProtected(args.filePath);
        await this.assertNotSelfConfirmingGate(args.filePath, args.targetContent, args.replacementContent);
        const fullPath = this.resolvePath(args.filePath);
        const content = await fs.readFile(fullPath, "utf-8");

        let replacement = args.replacementContent;
        const targetTrimmed = args.targetContent.trim();
        if (/^<!--\s*SECTION:\s*[A-Z0-9_]+\s*-->$/.test(targetTrimmed)) {
          const escapedAnchor = targetTrimmed.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
          replacement = replacement
            .replace(new RegExp(`^\\s*${escapedAnchor}\\s*\\n?`), "")
            .replace(new RegExp(`\\n?\\s*${escapedAnchor}\\s*$`), "");
        }

        if (content.includes(args.targetContent)) {
          const updated = content.replace(args.targetContent, () => replacement);
          await fs.writeFile(fullPath, updated, "utf-8");
          return `Successfully replaced content in ${args.filePath}`;
        }

        // Fallback: trailing-whitespace-insensitive line matching (handles trailing spaces inside markdown comments)
        const contentLines = content.split(/\r?\n/);
        const targetLines = args.targetContent.split(/\r?\n/).map((l: string) => l.replace(/[ \t]+$/, ""));
        let matchStart = -1;
        if (targetLines.length > 0) {
          for (let i = 0; i <= contentLines.length - targetLines.length; i++) {
            let matches = true;
            for (let j = 0; j < targetLines.length; j++) {
              if (contentLines[i + j].replace(/[ \t]+$/, "") !== targetLines[j]) {
                matches = false;
                break;
              }
            }
            if (matches) {
              matchStart = i;
              break;
            }
          }
        }

        if (matchStart !== -1) {
          const eol = content.includes("\r\n") ? "\r\n" : "\n";
          const updatedLines = [
            ...contentLines.slice(0, matchStart),
            ...replacement.split(/\r?\n/),
            ...contentLines.slice(matchStart + targetLines.length),
          ];
          await fs.writeFile(fullPath, updatedLines.join(eol), "utf-8");
          return `Successfully replaced content in ${args.filePath}`;
        }

        throw new Error(`Target content was not found in ${args.filePath}. Ensure exact whitespace and line match.`);
      },
    });

    // 5. list_directory
    this.tools.set("list_directory", {
      definition: {
        name: "list_directory",
        description: "Lists files and folders inside a given workspace directory.",
        parameters: {
          type: "object",
          properties: {
            dirPath: {
              type: "string",
              description: "Relative path to directory to inspect (e.g. 'data', 'logs', 'code')",
            },
          },
          required: ["dirPath"],
        },
      },
      execute: async (args) => {
        const fullPath = this.resolvePath(args.dirPath || ".");
        const entries = await fs.readdir(fullPath, { withFileTypes: true });
        const list = entries.map((e) => `${e.isDirectory() ? "[DIR]" : "[FILE]"} ${e.name}`).join("\n");
        return `Directory '${args.dirPath}':\n${list || "(empty)"}`;
      },
    });

    // 6. check_checkpoint_gate
    this.tools.set("check_checkpoint_gate", {
      definition: {
        name: "check_checkpoint_gate",
        description: "Checks whether required checkpoint files exist, are non-empty, and optionally verifies that a log file contains an expected checkpoint marker string.",
        parameters: {
          type: "object",
          properties: {
            requiredFiles: {
              type: "array",
              description: "Array of relative paths to files that must exist (e.g. ['logs/01_data_quality.log', 'data/tidyproteomics_data.rds'])",
              items: { type: "string" },
            },
            requiredLogMarker: {
              type: "object",
              description: "Optional verification that a log file contains an expected checkpoint marker string (e.g. 'PHASE_6_EXTRACTION_CHECKPOINT_PASS').",
              properties: {
                logFile: { type: "string", description: "Relative path to log file (e.g. 'logs/06_observations/console.log')" },
                marker: { type: "string", description: "Expected marker substring (e.g. 'PHASE_6_EXTRACTION_CHECKPOINT_PASS')" },
              },
              required: ["logFile", "marker"],
            },
          },
          required: ["requiredFiles"],
        },
      },
      execute: async (args) => {
        const results: string[] = [];
        let allPassed = true;
        for (const file of args.requiredFiles) {
          const fullPath = this.resolvePath(file);
          if (file.includes("*")) {
            const dir = path.dirname(fullPath);
            const basePattern = path.basename(file);
            try {
              const entries = await fs.readdir(dir);
              const regexStr = "^" + basePattern.replace(/[.+^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*") + "$";
              const regex = new RegExp(regexStr);
              const matched = entries.filter((e) => regex.test(e));
              if (matched.length > 0) {
                let anyValid = false;
                for (const m of matched) {
                  const s = await fs.stat(path.join(dir, m));
                  if (s.size > 0) {
                    anyValid = true;
                    results.push(`PASS: ${path.join(path.dirname(file), m)} (size: ${s.size} bytes)`);
                  }
                }
                if (!anyValid) {
                  results.push(`FAIL: ${file} matched files but all had 0 bytes`);
                  allPassed = false;
                }
              } else {
                results.push(`FAIL: ${file} matched 0 files in directory`);
                allPassed = false;
              }
            } catch {
              results.push(`FAIL: Directory for ${file} does not exist`);
              allPassed = false;
            }
          } else {
            try {
              const stat = await fs.stat(fullPath);
              if (stat.size > 0) {
                results.push(`PASS: ${file} (size: ${stat.size} bytes)`);
              } else {
                results.push(`FAIL: ${file} exists but has 0 bytes`);
                allPassed = false;
              }
            } catch {
              results.push(`FAIL: ${file} does not exist`);
              allPassed = false;
            }
          }
        }

        if (args.requiredLogMarker && args.requiredLogMarker.logFile && args.requiredLogMarker.marker) {
          const logPath = this.resolvePath(args.requiredLogMarker.logFile);
          try {
            if (fsSync.existsSync(logPath)) {
              const logContent = await fs.readFile(logPath, "utf-8");
              if (logContent.includes(args.requiredLogMarker.marker)) {
                results.push(`PASS: Log marker '${args.requiredLogMarker.marker}' confirmed in ${args.requiredLogMarker.logFile}`);
              } else {
                results.push(`FAIL: Log marker '${args.requiredLogMarker.marker}' NOT found in ${args.requiredLogMarker.logFile}`);
                allPassed = false;
              }
            } else {
              results.push(`FAIL: Log file ${args.requiredLogMarker.logFile} does not exist`);
              allPassed = false;
            }
          } catch {
            results.push(`FAIL: Error reading ${args.requiredLogMarker.logFile}`);
            allPassed = false;
          }
        }

        return `Checkpoint Gate Status: ${allPassed ? "ALL CHECKPOINTS PASSED" : "GATE FAILED"}\n${results.join("\n")}`;
      },
    });

    // 7. complete_phase
    this.tools.set("complete_phase", {
      definition: {
        name: "complete_phase",
        description: "Signals that the current phase's objectives, code execution, and quality gates have completed successfully.",
        parameters: {
          type: "object",
          properties: {
            phaseName: {
              type: "string",
              description: "The name or filename of the completed phase",
            },
            summary: {
              type: "string",
              description: "Structured summary of findings, verified outputs, and gate status to update notes.md",
            },
          },
          required: ["phaseName", "summary"],
        },
      },
      execute: async (args) => {
        return `PHASE_COMPLETED: ${args.phaseName}\nSummary:\n${args.summary}`;
      },
    });

    // 8. fail_phase
    this.tools.set("fail_phase", {
      definition: {
        name: "fail_phase",
        description: "Halts execution and marks the current phase as failed when an immutable specification gate, mandatory prerequisite, or unrecoverable error occurs. Use this to exit the phase loop immediately and provide actionable insights for the user to resolve before rerunning.",
        parameters: {
          type: "object",
          properties: {
            phaseName: {
              type: "string",
              description: "The name or filename of the phase (e.g. '01_INSPECT', '02_NORMALIZE')",
            },
            reason: {
              type: "string",
              description: "Concise summary of why the phase failed or was halted (e.g. 'Pre-flight Gate Failed: docs/experiment.md contains unconfigured placeholders')",
            },
            actionableInsights: {
              type: "string",
              description: "Specific, actionable instructions for the researcher explaining what to edit, configure, or verify to resolve the blocker before rerunning the phase.",
            },
          },
          required: ["phaseName", "reason", "actionableInsights"],
        },
      },
      execute: async (args) => {
        return `PHASE_HALTED_FAILED: ${args.phaseName}\nReason: ${args.reason}\nActionable Insights:\n${args.actionableInsights}`;
      },
    });

    // 9. check_integrity
    this.tools.set("check_integrity", {
      definition: {
        name: "check_integrity",
        description:
          "Runs deterministic data-grounded verification against docs/manuscript.md (or specified revision) and data/*.tsv tables. Saves data/integrity_defects.json and returns a structured defect catalog with direction errors, numeric mismatches, and figure references.",
        parameters: {
          type: "object",
          properties: {
            manuscriptPath: {
              type: "string",
              description: "Optional relative path to manuscript file (defaults to docs/manuscript.md or docs/manuscript_rev_01.md)",
            },
          },
          required: [],
        },
      },
      execute: async (args) => {
        try {
          const effectiveCwd = this.workspaceRoot || process.cwd();
          let mPath = args.manuscriptPath;
          if (!mPath) {
            if (fsSync.existsSync(path.join(effectiveCwd, "docs", "manuscript_rev_01.md"))) {
              mPath = "docs/manuscript_rev_01.md";
            } else if (fsSync.existsSync(path.join(effectiveCwd, "docs", "manuscript.md"))) {
              mPath = "docs/manuscript.md";
            } else {
              mPath = "manuscript.md";
            }
          }
          const { runIntegrityCheck } = await import("../evaluation/check_integrity");
          const res = runIntegrityCheck(effectiveCwd, mPath);
          return JSON.stringify(res, null, 2);
        } catch (err: any) {
          return `Error running check_integrity: ${err.message}`;
        }
      },
    });
    this.mcpToolNames.add("check_integrity");

    // 10. Built-in Web & Scientific Literature Search tools (scoped via frontmatter or available in Phase 08)
    for (const handler of createWebSearchToolHandlers()) {
      this.tools.set(handler.definition.name, handler);
      this.mcpToolNames.add(handler.definition.name);
    }
  }

  public registerMcpTools(
    tools: ToolDefinition[],
    executor: (name: string, args: Record<string, any>) => Promise<string>
  ) {
    this.unregisterMcpTools();
    for (const def of tools) {
      this.tools.set(def.name, {
        definition: def,
        execute: (args) => executor(def.name, args),
      });
      this.mcpToolNames.add(def.name);
    }
  }

  public unregisterMcpTools() {
    const builtInScoped = new Set(["web_search", "pubmed_search", "uniprot_search"]);
    for (const name of Array.from(this.mcpToolNames)) {
      if (builtInScoped.has(name)) continue;
      this.tools.delete(name);
      this.mcpToolNames.delete(name);
    }
  }
}
