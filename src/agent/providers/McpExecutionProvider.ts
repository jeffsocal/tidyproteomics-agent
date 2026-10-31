import * as path from "path";
import * as fs from "fs";
import * as readline from "readline";
import { spawn, ChildProcess } from "child_process";
import { configStore } from "../../config/ConfigStore";
import {
  ExecutionMode,
  ExecutionResult,
  IProteomicsExecutionProvider,
  McpToolDefinition,
} from "../../types/ExecutionProvider";

/**
 * Generic Model Context Protocol (MCP) Execution Provider.
 * Spawns and interacts with the persistent TidyProteomics MCP server over stdio JSON-RPC.
 * Zero hardcoded domain tools — all tools are dynamically discovered via `tools/list`
 * and passed straight to the LLM agent.
 */
export class McpExecutionProvider implements IProteomicsExecutionProvider {
  public readonly mode: ExecutionMode = "mcp";
  private proc: ChildProcess | null = null;
  private rl: readline.Interface | null = null;
  private workspaceRoot: string = "";
  private msgId = 0;
  private pendingRequests = new Map<
    number,
    { resolve: (val: any) => void; reject: (err: any) => void }
  >();
  private tools: McpToolDefinition[] = [];

  public isReady(): boolean {
    return this.proc !== null && this.tools.length > 0;
  }

  async initialize(workspaceRoot: string): Promise<void> {
    this.workspaceRoot = workspaceRoot;
    const mcpMode = configStore.get("mcpMode") || "local";
    let targetWorkspace = workspaceRoot;

    if (mcpMode === "docker") {
      const dockerImage = configStore.get("dockerImage") || "tidyproteomics-mcp:latest";
      targetWorkspace = "/workspace";

      this.proc = spawn(
        "docker",
        [
          "run",
          "-i",
          "--rm",
          "-v",
          `${workspaceRoot}:/workspace`,
          "-e",
          "WORKSPACE=/workspace",
          dockerImage,
        ],
        {
          cwd: workspaceRoot,
          stdio: ["pipe", "pipe", "pipe"],
        }
      );
    } else {
      let serverRelPath =
        configStore.get("mcpServerPath") ||
        path.resolve(__dirname, "../../../mcp/server.py");

      const candidatePaths = [
        path.isAbsolute(serverRelPath) ? serverRelPath : path.resolve(workspaceRoot || process.cwd(), serverRelPath),
        path.resolve(__dirname, "../../../mcp/server.py"),
        path.resolve(process.cwd(), "mcp/server.py"),
        "/app/mcp/server.py",
        path.resolve(workspaceRoot || process.cwd(), "../tidyproteomics/mcp/server.py"),
        path.resolve(workspaceRoot || process.cwd(), "mcp/server.py"),
        path.resolve(process.env.HOME || "", "Local/github/tidyproteomics/mcp/server.py"),
      ];

      let serverPath = "";
      for (const p of candidatePaths) {
        if (fs.existsSync(p)) {
          serverPath = p;
          break;
        }
      }

      if (!serverPath) {
        throw new Error(
          `tidyproteomics MCP server script not found. Checked:\n${candidatePaths.join("\n")}`
        );
      }

      const pythonBin =
        configStore.get("pythonPath") ||
        (fs.existsSync("/opt/homebrew/bin/python3")
          ? "/opt/homebrew/bin/python3"
          : (process.env.PYTHON || "python3"));

      // Spawn server.py with stdio pipes
      this.proc = spawn(pythonBin, [serverPath], {
        cwd: workspaceRoot || process.cwd(),
        stdio: ["pipe", "pipe", "pipe"],
      });
    }

    if (!this.proc.stdout || !this.proc.stdin) {
      throw new Error("Failed to initialize MCP stdio channels.");
    }

    this.proc.on("error", (err) => {
      console.error("[McpExecutionProvider] Process error:", err);
      for (const { reject } of this.pendingRequests.values()) {
        reject(new Error(`MCP server failed to spawn: ${err.message}`));
      }
      this.pendingRequests.clear();
    });

    this.rl = readline.createInterface({
      input: this.proc.stdout,
      terminal: false,
    });

    this.rl.on("line", (line: string) => {
      const trimmed = line.trim();
      if (!trimmed) return;
      try {
        const msg = JSON.parse(trimmed);
        const id = msg.id;
        if (id !== undefined && this.pendingRequests.has(id)) {
          const { resolve, reject } = this.pendingRequests.get(id)!;
          this.pendingRequests.delete(id);
          if (msg.error) {
            reject(new Error(msg.error.message || JSON.stringify(msg.error)));
          } else {
            resolve(msg.result);
          }
        }
      } catch (err) {
        console.error("[McpExecutionProvider] Failed to parse message line:", line, err);
      }
    });

    this.proc.on("exit", (code, signal) => {
      console.warn(`[McpExecutionProvider] Process exited with code ${code}, signal ${signal}`);
      for (const { reject } of this.pendingRequests.values()) {
        reject(new Error(`MCP server exited prematurely (code: ${code})`));
      }
      this.pendingRequests.clear();
    });

    // 1. Handshake: initialize
    await this.sendRequest("initialize", {
      protocolVersion: "2024-11-05",
      clientInfo: { name: "TidyProteomicsAgent", version: "1.0.0" },
      workspaceRoot: targetWorkspace,
      rootPath: targetWorkspace,
    });

    // 2. Notification: initialized
    this.sendNotification("notifications/initialized");

    // 3. Dynamic tool discovery
    const toolsResp = await this.sendRequest("tools/list", {});
    this.tools = toolsResp.tools || [];

    // 4. Synchronize workspace directory with R daemon
    try {
      await this.callTool("tpa_set_workspace", { workspace: targetWorkspace, reset: false });
    } catch (err) {
      console.warn("[McpExecutionProvider] Notice: tpa_set_workspace error:", err);
    }
  }

  private sendRequest(method: string, params: Record<string, any> = {}): Promise<any> {
    return new Promise((resolve, reject) => {
      if (!this.proc || !this.proc.stdin) {
        return reject(new Error("MCP process is not running."));
      }
      const id = ++this.msgId;
      this.pendingRequests.set(id, { resolve, reject });
      const payload = JSON.stringify({ jsonrpc: "2.0", id, method, params }) + "\n";
      this.proc.stdin.write(payload);
    });
  }

  private sendNotification(method: string, params: Record<string, any> = {}): void {
    if (!this.proc || !this.proc.stdin) return;
    const payload = JSON.stringify({ jsonrpc: "2.0", method, params }) + "\n";
    this.proc.stdin.write(payload);
  }

  async dispose(): Promise<void> {
    if (this.rl) {
      this.rl.close();
      this.rl = null;
    }
    if (this.proc) {
      try {
        this.proc.kill("SIGTERM");
      } catch (_) {}
      this.proc = null;
    }
    this.pendingRequests.clear();
  }

  private activePhase: string = "";

  public setWorkspaceRoot(root: string): void {
    this.workspaceRoot = root || "";
  }

  public setActivePhase(phaseName: string): void {
    if (!phaseName) return;
    this.activePhase = path.basename(phaseName).replace(/\.md$/i, "").toLowerCase();
  }

  public getRegisteredTools(): McpToolDefinition[] {
    return this.tools;
  }

  public async executeTool(name: string, args: Record<string, any>): Promise<string> {
    const res = await this.callTool(name, args);
    try {
      this.mirrorOutputToLogs(name, args, res.content);
    } catch (_) {}
    return res.content;
  }

  private mirrorOutputToLogs(toolName: string, args: Record<string, any>, output: string): void {
    if (!this.workspaceRoot) return;
    const logsDir = path.join(this.workspaceRoot, "logs");

    let targetPhase = this.activePhase;
    if (!targetPhase) {
      try {
        if (fs.existsSync(logsDir)) {
          const entries = fs.readdirSync(logsDir, { withFileTypes: true });
          const subdirs = entries
            .filter((e) => e.isDirectory() && !e.name.startsWith("."))
            .map((e) => path.join(logsDir, e.name))
            .sort((a, b) => {
              try {
                return fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs;
              } catch {
                return 0;
              }
            });
          if (subdirs.length > 0) {
            targetPhase = path.basename(subdirs[0]);
          }
        }
      } catch (_) {}
    }

    if (!targetPhase) return;

    try {
      const targetDir = path.join(logsDir, targetPhase);
      if (!fs.existsSync(targetDir)) {
        fs.mkdirSync(targetDir, { recursive: true });
      }
      const targetLogFile = path.join(targetDir, "console.log");
      const timestamp = new Date().toISOString();
      const entry = `\n[${timestamp}] [MCP Tool] ${toolName}(${JSON.stringify(args)})\n${output}\n`;
      fs.appendFileSync(targetLogFile, entry, "utf-8");
    } catch (_) {}
  }

  private async callTool(name: string, args: Record<string, any> = {}): Promise<ExecutionResult> {
    const res = await this.sendRequest("tools/call", { name, arguments: args });
    const content = (res.content || [])
      .filter((c: any) => c.type === "text")
      .map((c: any) => c.text)
      .join("\n");
    const isError = !!res.isError || (typeof content === "string" && (
      content.startsWith("Error:") ||
      content.startsWith("Error in ") ||
      content.startsWith("Tool error:") ||
      content.startsWith("Execution halted") ||
      /Error in [a-zA-Z0-9_]+:/i.test(content.slice(0, 100))
    ));
    return {
      success: !isError,
      content,
      isError,
    };
  }
}
