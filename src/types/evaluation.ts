import { LLMRole, PhaseStatus, TokenUsage } from "./index";

export interface ManuscriptDimensionScores {
  insights: number;                  // 1-10: novelty & biological relevance of deduced mechanisms
  clarity: number;                   // 1-10: structure, readability, clarity of scientific narrative
  scientificEvaluation: number;      // 1-10: statistical validity, empirical evidence grounding, no hallucination
  bioinformaticsIntelligence: number;// 1-10: analytical rigor, pathway crosstalk, normalization/testing choices
  actionableInsights: number;        // 1-10: translational archetype, target classification, experimental roadmap
  overallManuscriptScore: number;    // 1-10: composite average
}

export interface EvaluationScoreBreakdown extends ManuscriptDimensionScores {
  mcpToolUseScore: number;           // 0-100%: usage of high-level MCP tools vs raw scripts + success rate
  bioinformaticsIntelligenceScore: number; // 0-100%: domain intelligence metric
  overallBenchmarkScore: number;     // 0-100%: master performance composite
  rubricNotes?: string;              // Detailed rationale and evaluator commentary
  mcpToolCallsCount: number;
  rawScriptCallsCount: number;
  toolSuccessRate: number;           // 0-1.0
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

export interface BenchmarkStartRequest {
  provider: string;
  models: string[];
  modelMaxTokens?: Record<string, number>;
  iterations: number;
  experimentPath?: string;
  predefinedExperimentId?: string;
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
