export type ExecutionMode = "mcp";

export interface ExecutionResult {
  success: boolean;
  content: string;
  filesCreated?: string[];
  isError?: boolean;
}

export interface McpToolSchema {
  type: string;
  properties?: Record<string, any>;
  required?: string[];
}

export interface McpToolDefinition {
  name: string;
  description: string;
  inputSchema: McpToolSchema;
}

export interface IProteomicsExecutionProvider {
  readonly mode: ExecutionMode;

  initialize(workspaceRoot: string): Promise<void>;
  dispose(): Promise<void>;

  // Tool integration for agent loops
  getRegisteredTools(): McpToolDefinition[];
  executeTool(name: string, args: Record<string, any>): Promise<string>;
  isReady(): boolean;
  setActivePhase?(phaseName: string): void;
}
