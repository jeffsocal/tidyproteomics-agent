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

export interface AppConfig {
  provider: LLMProviderType;
  model: string;
  apiKey: string;
  baseUrl: string;
  maxTokens: number;
  timeoutSeconds: number;
  maxTurns: number;
  promptsDir: string;
  analysisDir: string;
  engine: "mcp";
  mcpServerPath: string;
  mcpMode: "local" | "docker";
  dockerImage: string;
  rscriptPath: string;
  pythonPath: string;
  searchProvider: "auto" | "tavily" | "brave" | "searxng";
  searchApiKey: string;
  searxngUrl: string;
  workspaceRoot: string;
  recentWorkspaces: string[];
  multiModelEnabled?: boolean;
  tierUtility?: LLMTierConfig;
  tierToolRunner?: LLMTierConfig;
  tierReasoner?: LLMTierConfig;
}

export interface TokenUsage {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  cachedPromptTokens?: number;
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
}

export interface ModelTokenUsage {
  model: string;
  role?: LLMRole;
  provider?: string;
  usage: TokenUsage;
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
  totalTokens: TokenUsage;
  tierTokens?: Partial<Record<LLMRole, TokenUsage>>;
  modelTokens?: Record<string, ModelTokenUsage>;
  isAnalysisMissingOrEmpty?: boolean;
}

export interface ExperimentSpec {
  exists: boolean;
  pathToDataFile: string | null;
  platform: string | null;
  analyte: string | null;
  description: string | null;
  rawSampleGroups: string[];
  discoveredGroups: string[];
  discoveredGroupsConfirmed: boolean;
  normalizationMethods: string;
  normalizationSubsetFilter: string;
  normalizationConfirmed: boolean;
  imputationMethod: string;
  imputationConfirmed: boolean;
  sampleRenamingMap: Record<string, string>;
  reassignSampleNames: boolean;
  samplePoolingConfirmed: boolean;
  targetContrasts: string[];
  contrastConfirmed: boolean;
  batchConfoundingDetected: boolean;
  batchConfoundingAuthorized: boolean;
  batchConfoundingConfirmed: boolean;
  batchConfoundingRationale?: string;
  missingInitialFields: ("PATH_TO_DATA_FILE" | "PLATFORM" | "ANALYTE" | "DESCRIPTION")[];
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

export interface FileTreeNode {
  name: string;
  relPath: string;
  type: "file" | "directory";
  sizeBytes?: number;
  modifiedAt?: string;
  children?: FileTreeNode[];
}

export interface McpStatus {
  connected: boolean;
  toolsCount: number;
  error?: string;
  mode: string;
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

export interface ViewerTab {
  id: string;
  title: string;
  kind: "experiment" | "progress" | "file" | "settings" | "evaluation";
  relPath?: string;
  pinned?: boolean;
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
  pageCount?: number;
}

export interface LiteratureInfo {
  name: string;
  fileName: string;
  relPath: string;
  absPath: string;
  sizeBytes: number;
  modified: string;
}

export interface LiteratureConfig {
  activeLiterature?: string;
  useInSynthesis: boolean;
  updatedAt?: string;
}

export interface LiteratureStats {
  studies: number;
  contexts: number;
  assertions: number;
  symbols: number;
  organisms: number;
  perturbations: number;
  study_count?: number;
  context_count?: number;
  assertion_count?: number;
  unique_symbols?: number;
  organism_count?: number;
  perturbation_count?: number;
}

export interface LiteratureViewState {
  workspaceRoot: string;
  literatureDir: string;
  databases: LiteratureInfo[];
  config: LiteratureConfig;
  activeLiterature?: string;
  useInSynthesis?: boolean;
  activeLiteratureInfo?: LiteratureInfo;
  ingestFolder?: string;
  queue: IngestQueueItem[];
  ingestionAvailable: boolean;
  busy?: string;
  isIngesting?: boolean;
  stats?: LiteratureStats;
}

export type ResolvedSegmentState = "pending" | "running" | "completed" | "failed" | "warning" | "queued";

export function resolvePhaseVisualState(
  p: PhaseInfo,
  isFullPipelineRunning?: boolean,
  anyRunning?: boolean,
  runningIndex?: number,
  idx?: number
): { state: ResolvedSegmentState; label: string; isAttention: boolean } {
  const rawStatus = (p.status || "pending").toLowerCase();
  const errText = String(p.error || p.summary || "").trim();
  const isContrastNeeded = /Section 3\.?[EC]|suggested contrast|unconfirmed.*contrast|target contrast/i.test(errText);
  const isConfounding = /Section 3\.?[FD]|confound|Proceed With Potential Batch Confounding|Authorize Unadjusted Exploratory Comparison/i.test(errText);
  const isImputationNeeded = /imputation|Section 3\.?[EC]|Confirm Imputation Strategy|randomforest_grouped|min_column/i.test(errText);
  const isStudyDesignNeeded = /Section 3|Pre-flight Study Design Gate|Human-in-the-loop|HITL|Study Design.*Review/i.test(errText);
  const isAttention =
    isContrastNeeded ||
    isConfounding ||
    isImputationNeeded ||
    isStudyDesignNeeded ||
    /attention|action required|confirm.*proceed/i.test(errText) ||
    rawStatus === "warning" ||
    rawStatus === "needs_attention";

  if (rawStatus === "running") {
    return { state: "running", label: "RUNNING", isAttention: false };
  }
  if (rawStatus === "completed" || rawStatus === "cached") {
    return { state: "completed", label: "COMPLETED", isAttention: false };
  }
  if (isAttention) {
    return { state: "warning", label: "ATTENTION", isAttention: true };
  }
  if (rawStatus === "failed" || rawStatus === "error") {
    return { state: "failed", label: "FAILED", isAttention: false };
  }
  if (
    isFullPipelineRunning &&
    anyRunning &&
    p.enabled !== false &&
    runningIndex !== undefined &&
    runningIndex !== -1 &&
    idx !== undefined &&
    idx > runningIndex
  ) {
    return { state: "queued", label: "QUEUED", isAttention: false };
  }
  return { state: "pending", label: "PENDING", isAttention: false };
}

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

export interface ManuscriptDimensionScores {
  insights: number;
  clarity: number;
  scientificEvaluation: number;
  bioinformaticsIntelligence: number;
  actionableInsights: number;
  overallManuscriptScore: number;
}

export interface EvaluationScoreBreakdown extends ManuscriptDimensionScores {
  mcpToolUseScore: number;
  bioinformaticsIntelligenceScore: number;
  overallBenchmarkScore: number;
  rubricNotes?: string;
  mcpToolCallsCount: number;
  rawScriptCallsCount: number;
  toolSuccessRate: number;
}

export interface PhaseTelemetryMetric {
  phaseId: string;
  phaseTitle: string;
  fileName?: string;
  durationSeconds: number;
  turns: number;
  tokenUsage: {
    promptTokens: number;
    completionTokens: number;
    cachedTokens?: number;
    totalTokens: number;
  };
  mcpToolCalls: number;
  rawScriptCalls: number;
  status: PhaseStatus | "skipped";
}

export interface EvaluationRunSummary {
  id: string;
  suiteId: string;
  model: string;
  provider: string;
  iteration: number;
  timestamp: string;
  status: "completed" | "failed" | "running" | "queued" | "pending";
  isBaseline?: boolean;
  totalDurationSeconds: number;
  totalTurns: number;
  tokenUsage: {
    promptTokens: number;
    completionTokens: number;
    cachedTokens?: number;
    totalTokens: number;
  };
  phaseMetrics: PhaseTelemetryMetric[];
  scores: EvaluationScoreBreakdown;
  manuscriptWordCount?: number;
  manuscriptTitle?: string;
  outputPath: string;
  error?: string;
}

export interface ModelAggregatedPerformance {
  model: string;
  provider: string;
  isBaseline?: boolean;
  completedRuns: number;
  failedRuns: number;
  meanDurationSeconds: number;
  meanTurns: number;
  meanPromptTokens: number;
  meanCompletionTokens: number;
  meanTotalTokens: number;
  meanOverallScore: number;
  meanManuscriptScore: number;
  meanMcpToolUseScore: number;
  meanBioinformaticsIntelligence: number;
  dimensionAverages: {
    insights: number;
    clarity: number;
    scientificEvaluation: number;
    bioinformaticsIntelligence: number;
    actionableInsights: number;
  };
  runs: EvaluationRunSummary[];
}

export interface BenchmarkSuite {
  id: string;
  title: string;
  createdAt: string;
  provider: string;
  models: string[];
  iterations: number;
  experimentPath: string;
  experimentTitle: string;
  status: "idle" | "running" | "completed" | "cancelled" | "failed";
  activeRun?: {
    model: string;
    iteration: number;
    phaseTitle?: string;
    elapsedSeconds: number;
  };
  runs: EvaluationRunSummary[];
  aggregated: ModelAggregatedPerformance[];
  error?: string;
}

export interface PredefinedExperimentEntry {
  id: string;
  title: string;
  path: string;
  summary: string;
  contrasts?: string[];
  hypothesis?: string;
  isCurrentWorkspace?: boolean;
  rawDataFile?: string;
  hasRawDataDownloaded?: boolean;
  isHitlFreeReady?: boolean;
}

export interface ModelCatalogEntry {
  id: string;
  name: string;
  provider: string;
  tier: "T1" | "T2" | "T3";
  contextWindow: number;
  maxTokens?: number;
  costPerMillionPromptUsd?: number;
  costPerMillionCompletionUsd?: number;
  description: string;
  isRecommended?: boolean;
  isCustom?: boolean;
}


