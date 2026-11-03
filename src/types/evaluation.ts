import { LLMRole, PhaseStatus, TokenUsage } from "./index";

export type ManuscriptDimension =
  | "scientificEvaluation"
  | "bioinformaticsIntelligence"
  | "insights"
  | "clarity"
  | "actionableInsights";

export interface ManuscriptDimensionScores {
  insights: number;                  // 1-10: novelty & biological relevance of deduced mechanisms
  clarity: number;                   // 1-10: structure, readability, clarity of scientific narrative
  scientificEvaluation: number;      // 1-10: statistical validity, empirical evidence grounding, no hallucination
  bioinformaticsIntelligence: number;// 1-10: analytical rigor, pathway crosstalk, normalization/testing choices
  actionableInsights: number;        // 1-10: translational archetype, target classification, experimental roadmap
  overallManuscriptScore: number;    // 1-10: composite average
}

export interface VerifierResult {
  score: number | null;
  passed: boolean | null;
  summary: string;
  details: string[];
  value?: number | null;
}

export interface VerifierReport {
  numericFidelity: VerifierResult;
  directionConsistency: VerifierResult;
  significanceHonesty: VerifierResult;
  countConsistency: VerifierResult;
  figureIntegrity: VerifierResult;
  citationIntegrity: VerifierResult;
  sectionStructure: VerifierResult;
  methodsReproducibility: VerifierResult;
  candidateReliabilityConsistency?: VerifierResult;
  repetition: VerifierResult;
  stats: {
    claimsExtracted: number;
    claimsMatched: number;
    claimsMismatched: number;
    claimsNotFound: number;
    directionErrors: number;
    overclaims: number;
    missingFigures: number;
    candidateTagMismatches?: number;
    repetitionRatio: number | null;
    abstractWords: number | null;
    expressionRows: number;
    enrichmentRows: number;
    wordCount: number;
  };
}

export interface ToolUseBreakdown {
  score: number;
  coverage: number;
  perCallSuccess: number;
  efficiency: number;
  appropriateness: number;
  totalCalls: number;
  failedCalls: number;
  redundantCalls: number;
  tpaCalls: number;
  searchCalls: number;
  rawExecCalls: number;
  missingToolGroups: string[];
  phasesParsed: number;
}

export interface ReviewerModelRef {
  model: string;
  provider?: string;
  label?: string;
}

export interface ReviewerCriterionScore {
  id: string;
  score: number;
  evidence: string;
}

export interface ReviewerResult {
  model: string;
  provider: string;
  status: "ok" | "failed";
  dimensions?: Record<ManuscriptDimension, number>;
  criteria?: Record<ManuscriptDimension, ReviewerCriterionScore[]>;
  weaknesses?: string[];
  summary?: string;
  missingCriteria?: number;
  error?: string;
  tokenUsage?: {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
  };
  durationSeconds: number;
}

export interface ReviewerPanelSummary {
  status: "complete" | "partial" | "failed" | "skipped";
  requestedModels: string[];
  completedCount: number;
  reviewers: ReviewerResult[];
  dimensionSpread?: Record<ManuscriptDimension, number>;
  consensusWeaknesses?: string[];
}

export interface AppliedCap {
  dimension: ManuscriptDimension | "overall";
  before: number;
  after: number;
  maxAllowed: number;
  reason: string;
}

export interface EvaluationScoreBreakdown extends ManuscriptDimensionScores {
  mcpToolUseScore: number;           // 0-100%: usage of high-level MCP tools vs raw scripts + success rate
  bioinformaticsIntelligenceScore: number; // 0-100%: domain intelligence metric (or analyticalFidelityScore)
  analyticalFidelityScore?: number;  // 0-100%: verifier-grounded empirical fidelity
  overallBenchmarkScore: number;     // 0-100%: master performance composite
  rubricVersion?: string;            // e.g. "2.0"
  rubricNotes?: string;              // Detailed rationale and evaluator commentary
  mcpToolCallsCount: number;
  rawScriptCallsCount: number;
  toolSuccessRate: number;           // 0-1.0
  verifiers?: VerifierReport;
  toolUseBreakdown?: ToolUseBreakdown;
  appliedCaps?: AppliedCap[];
  reviewerPanel?: ReviewerPanelSummary;
  rawManuscriptDimensions?: Record<ManuscriptDimension, number>;
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
  reviewerModels?: string[];
  iterations: number;
  experimentPath: string;
  experimentTitle: string;
  status: "idle" | "running" | "completed" | "cancelled" | "failed";
  activeRun?: {
    model: string;
    iteration: number;
    phaseTitle?: string;
    phaseId?: string;
    elapsedSeconds: number;
  };
  queue?: string[];
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
  reviewerModels?: string[];
  reviewers?: ReviewerModelRef[];
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

export interface TierRecommendation {
  role: "utility" | "toolRunner" | "reasoner";
  tierName: "Tier 1: Fast Utility & Ingestion" | "Tier 2: Tool Runner & Code Orchestrator" | "Tier 3: Frontier Scientific Reasoner";
  phases: string[];
  recommendedModel: string;
  provider: string;
  score: number; // 0-100 suitability score for this tier
  estimatedCostUsd: number;
  rationale: string;
  metrics: {
    completionRate: number;
    avgTurns: number;
    tokensUsed: number;
    fidelityOrSuccessRate: number;
    directionErrors?: number;
  };
}

export interface TierOptimizationProfile {
  id: "quality" | "balanced" | "budget";
  title: string;
  badge: string;
  description: string;
  tierUtility: { model: string; provider?: string };
  tierToolRunner: { model: string; provider?: string };
  tierReasoner: { model: string; provider?: string };
  projectedBenchmarkScore: number;
  projectedCostUsd: number;
  projectedDurationMinutes: number;
  costSavingsPercentVsFrontier: number;
  recommendations: {
    utility: TierRecommendation;
    toolRunner: TierRecommendation;
    reasoner: TierRecommendation;
  };
}

export interface TierSuggestionResult {
  ok: boolean;
  timestamp: string;
  profiles: {
    quality: TierOptimizationProfile;
    balanced: TierOptimizationProfile;
    budget: TierOptimizationProfile;
  };
  modelRankings: {
    tier1: Array<{ model: string; score: number; costUsd: number; note: string }>;
    tier2: Array<{ model: string; score: number; costUsd: number; note: string }>;
    tier3: Array<{ model: string; score: number; costUsd: number; note: string }>;
  };
  totalRunsAnalyzed: number;
  pricingSource: "openrouter_live" | "openrouter_cache";
}

export interface ExplainTierRequest {
  profileId: "quality" | "balanced" | "budget";
  tierUtilityModel?: string;
  tierToolRunnerModel?: string;
  tierReasonerModel?: string;
}

export interface ExplainTierResponse {
  ok: boolean;
  explanation: string;
  profileId: string;
  generatedBy: string;
  tokensUsed?: number;
  error?: string;
}

