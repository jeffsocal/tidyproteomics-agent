import { ExecutionMode, IProteomicsExecutionProvider } from "../../types/ExecutionProvider";
import { McpExecutionProvider } from "./McpExecutionProvider";
import { ToolRegistry } from "../../tools/ToolRegistry";

export class ExecutionManager {
  private currentProvider: McpExecutionProvider;
  private connected: boolean = false;
  private lastError?: string;

  constructor(
    private workspaceRoot: string,
    private toolRegistry?: ToolRegistry
  ) {
    this.currentProvider = new McpExecutionProvider();
  }

  public setWorkspaceRoot(newRoot: string) {
    this.workspaceRoot = newRoot || "";
    this.currentProvider.setWorkspaceRoot(this.workspaceRoot);
  }

  public async initialize(): Promise<void> {
    try {
      await this.currentProvider.dispose();
      this.currentProvider = new McpExecutionProvider();
      await this.currentProvider.initialize(this.workspaceRoot);
      this.syncToolRegistry();
      this.connected = true;
      this.lastError = undefined;
    } catch (err: any) {
      console.warn(`[ExecutionManager] Failed to initialize MCP provider:`, err);
      this.connected = false;
      this.lastError = err.message || String(err);
    }
  }

  public getStatus(): { connected: boolean; toolsCount: number; error?: string; mode: string } {
    const ready = this.currentProvider.isReady();
    return {
      connected: ready,
      toolsCount: this.currentProvider.getRegisteredTools().length,
      error: this.lastError,
      mode: "mcp",
    };
  }

  public get provider(): IProteomicsExecutionProvider {
    return this.currentProvider;
  }

  public get mode(): ExecutionMode {
    return "mcp";
  }

  public async setMode(_newMode: string): Promise<void> {
    await this.initialize();
  }

  public async toggleEngine(): Promise<{ connected: boolean; toolsCount: number; message: string }> {
    const ready = this.currentProvider.isReady();
    if (ready) {
      const toolsCount = this.currentProvider.getRegisteredTools().length;
      return {
        connected: true,
        toolsCount,
        message: `TidyProteomics MCP Engine active (${toolsCount} tools registered in memory).`,
      };
    } else {
      await this.initialize();
      const toolsCount = this.currentProvider.getRegisteredTools().length;
      return {
        connected: this.currentProvider.isReady(),
        toolsCount,
        message: this.currentProvider.isReady()
          ? `TidyProteomics MCP Engine reconnected (${toolsCount} tools).`
          : `MCP connection failed: ${this.lastError || "Unknown error"}`,
      };
    }
  }

  private syncToolRegistry() {
    if (!this.toolRegistry) return;

    const mcpTools = this.currentProvider.getRegisteredTools();
    const toolDefs = mcpTools.map((t) => ({
      name: t.name,
      description: t.description,
      parameters: {
        type: "object" as const,
        properties: t.inputSchema?.properties || {},
        required: t.inputSchema?.required || [],
      },
    }));

    this.toolRegistry.registerMcpTools(toolDefs, (name, args) => {
      return this.currentProvider.executeTool(name, args);
    });
    this.toolRegistry.setMcpPhaseListener((phase) => {
      this.setActivePhase(phase);
    });
  }

  public setActivePhase(phaseName: string): void {
    if (this.currentProvider.setActivePhase) {
      this.currentProvider.setActivePhase(phaseName);
    }
  }

  public async dispose(): Promise<void> {
    await this.currentProvider.dispose();
  }
}
