export * from "./evaluation";

export interface ToolCall {
  id: string;
  name: string;
  args: Record<string, any>;
}

export interface ToolResult {
  tool_call_id: string;
  content: string;
  isError?: boolean;
}

export interface ChatMessage {
  role: "system" | "user" | "assistant" | "tool";
  content: string;
  tool_calls?: ToolCall[];
  tool_call_id?: string;
  tool_name?: string;
  turn?: number;
}

export interface TokenUsage {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  cachedPromptTokens?: number;
}

export interface LLMResponse {
  content: string;
  tool_calls?: ToolCall[];
  usage: TokenUsage;
  finishReason?: string;
  truncationDetected?: boolean;
}

export type LLMProviderType = "anthropic" | "gemini" | "openai" | "openrouter" | "ollama";

export type LLMRole = "utility" | "toolRunner" | "reasoner";

export interface LLMTierConfig {
  provider?: LLMProviderType;
  model: string;
  apiKey?: string;
  baseUrl?: string;
  maxTokens?: number;
  temperature?: number;
}

export interface LLMConfig {
  provider: LLMProviderType;
  model: string;
  apiKey: string;
  baseUrl?: string;
  temperature?: number;
  maxTokens?: number;
  timeoutSeconds?: number;
  multiModelEnabled?: boolean;
  tierUtility?: LLMTierConfig;
  tierToolRunner?: LLMTierConfig;
  tierReasoner?: LLMTierConfig;
  phaseModels?: Record<string, string>;
}

export type PhaseStatus = "pending" | "running" | "completed" | "failed";

export interface PhaseInfo {
  id: string;
  fileName: string;
  title: string;
  status: PhaseStatus;
  enabled: boolean;
  isMasterSetup?: boolean;
  startTime?: string;
  endTime?: string;
  durationSeconds?: number;
  turnCount?: number;
  tokenUsage?: TokenUsage;
  summary?: string;
  error?: string;
  associatedFiles?: string[];
  model?: string;
  role?: LLMRole;
  provider?: string;
  modelSource?: "phase" | "tier" | "default";
}

export interface ModelTokenUsage {
  model: string;
  role?: LLMRole;
  provider?: string;
  usage: TokenUsage;
}

export interface ChatSessionSummary {
  id: string; // e.g. "chat_00"
  filename: string; // "chat_00.md"
  path: string; // "logs/agent/chat_00.md"
  title: string;
  messageCount: number;
  updatedAt: string;
  createdAt: string;
  isActive: boolean;
}

export interface ChatSessionSearchResult extends ChatSessionSummary {
  matches: string[];
}

export interface PromptFileInfo {
  name: string;
  relPath: string;
  exists: boolean;
}

export interface FolderStatus {
  name: string;
  relPath: string;
  description: string;
  exists: boolean;
  itemCount?: number;
}

export interface PipelineState {
  workingDirectory: string;
  workspaceName?: string;
  model: string;
  provider: string;
  startTime: string;
  endTime?: string;
  isRunning?: boolean;
  isFullPipelineRunning?: boolean;
  currentPhaseIndex: number;
  phases: PhaseInfo[];
  promptFiles?: PromptFileInfo[];
  folders?: FolderStatus[];
  totalTokens: TokenUsage;
  tierTokens?: Partial<Record<LLMRole, TokenUsage>>;
  modelTokens?: Record<string, ModelTokenUsage>;
  isAnalysisMissingOrEmpty?: boolean;
  literature?: LiteratureConfig;
  /** @deprecated Backwards compatibility alias */
  knowledgeCorpus?: LiteratureConfig;
}

// ---------------------------------------------------------------------------
// Literature Database (DuckDB)
// ---------------------------------------------------------------------------

/** Persisted in <workspace>/literature/literature_config.json and read by ContextBuilder. */
export interface LiteratureConfig {
  /** File name of the active database inside literature/ (e.g. "p97_vcp_ko.duckdb"). */
  activeLiterature?: string;
  /** When true, the active literature path is injected into prompt-phasing context. */
  useInSynthesis: boolean;
  updatedAt?: string;
  /** @deprecated Backwards compatibility alias for activeLiterature */
  activeCorpus?: string;
}

export interface LiteratureInfo {
  name: string;
  fileName: string;
  relPath: string;
  absPath: string;
  sizeBytes: number;
  modified: string;
}

export type IngestStage =
  | "queued"
  | "parsing_pdf"
  | "llm_extraction"
  | "normalization"
  | "indexed"
  | "failed"
  | "skipped";

export interface IngestQueueItem {
  id: string;
  fileName: string;
  absPath: string;
  relPath: string;
  kind: "pdf" | "table";
  sizeBytes: number;
  stage: IngestStage;
  message?: string;
}

export interface LiteratureViewState {
  workspaceRoot: string;
  literatureDir: string;
  databases: LiteratureInfo[];
  literature?: LiteratureInfo[];
  config: LiteratureConfig;
  activeLiterature?: string;
  useInSynthesis?: boolean;
  activeLiteratureInfo?: LiteratureInfo;
  ingestFolder?: string;
  queue: IngestQueueItem[];
  ingestionAvailable: boolean;
  busy?: string;
  isIngesting?: boolean;
  stats?: any;

  // Backwards-compatibility aliases
  corporaDir?: string;
  corpora?: LiteratureInfo[];
  activeCorpus?: string;
  activeCorpusInfo?: LiteratureInfo;
}

export type CorpusConfig = LiteratureConfig;
export type CorpusInfo = LiteratureInfo;
export type CorpusViewState = LiteratureViewState;

export interface ToolDefinition {
  name: string;
  description: string;
  parameters: {
    type: "object";
    properties: Record<string, {
      type: string;
      description: string;
      enum?: string[];
      items?: any;
      properties?: Record<string, any>;
      required?: string[];
    }>;
    required: string[];
  };
}

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

export interface PerformanceReviewStatus {
  hasReview: boolean;
  hasLogs: boolean;
  phaseCount: number;
  lastGenerated?: string;
  reviewRelPath: string;
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

