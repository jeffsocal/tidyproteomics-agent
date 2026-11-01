import React, { useEffect, useState, useRef } from "react";
import {
  Award,
  BarChart3,
  CheckCircle2,
  Circle,
  Clock,
  Cpu,
  FileText,
  Play,
  RotateCcw,
  Sparkles,
  StopCircle,
  TrendingUp,
  Wrench,
  Terminal,
  AlertCircle,
  AlertTriangle,
  Square,
  Layers,
  ChevronDown,
  ChevronUp,
  ChevronRight,
  ExternalLink,
  Trash2,
  X,
  Plus,
  RefreshCw,
  Check,
  Copy,
  Edit3,
  Eye,
  Save,
} from "lucide-react";
import { marked } from "marked";
import {
  BenchmarkSuite,
  EvaluationRunSummary,
  EvaluationScoreBreakdown,
  ExperimentSpec,
  ModelAggregatedPerformance,
  ModelCatalogEntry,
  PerformanceReviewResult,
  PerformanceReviewStatus,
  PhaseTelemetryMetric,
  PipelineState,
  PredefinedExperimentEntry,
} from "../types";
import { EvaluationBarChart, EvaluationSeries, MODEL_PALETTE } from "./EvaluationBarChart";

/**
 * Safe JSON fetch utility that prevents unhandled HTML 404/500 parser crashes.
 */
async function fetchApiJson(url: string, options?: RequestInit): Promise<any> {
  const res = await fetch(url, options);
  const text = await res.text();
  let data: any;
  try {
    data = JSON.parse(text);
  } catch {
    if (!res.ok) {
      throw new Error(`Server returned HTTP ${res.status}: ${res.statusText || "Endpoint not found or error"}`);
    }
    throw new Error(`Invalid JSON response: ${text.slice(0, 120)}`);
  }
  return data;
}

// LocalStorage persistence helpers for evaluation state
const STORAGE_CUSTOM_MODELS = "tpa_eval_custom_models_v2";
const STORAGE_SELECTED_PROVIDER = "tpa_eval_provider_v2";
const STORAGE_SELECTED_MODELS_PREFIX = "tpa_eval_selected_models_v2_";
const STORAGE_ITERATIONS = "tpa_eval_iterations_v2";
const STORAGE_BENCHMARK_REVIEWERS = "tpa_eval_benchmark_reviewers_v2";

const DEFAULT_REVIEWER_IDS = [
  "anthropic/claude-3.7-sonnet",
  "openai/gpt-4o",
  "google/gemini-2.0-flash-001",
];

function loadStoredReviewers(): string[] {
  try {
    const raw = localStorage.getItem(STORAGE_BENCHMARK_REVIEWERS);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed) && parsed.length === 3 && parsed.every((s) => typeof s === "string" && s.trim())) {
        return parsed;
      }
    }
  } catch (_) {}
  return DEFAULT_REVIEWER_IDS;
}

function saveStoredReviewers(reviewers: string[]): void {
  try {
    localStorage.setItem(STORAGE_BENCHMARK_REVIEWERS, JSON.stringify(reviewers));
  } catch (_) {}
}

export type AIEvaluationSubTab = "review" | "runs" | "analytics" | "benchmark";

const STORAGE_ACTIVE_SUBTAB = "tpa_eval_active_subtab_v2";

const BENCHMARK_TOKEN_LIMITS = [
  { value: "4096", label: "4k" },
  { value: "8192", label: "8k" },
  { value: "16384", label: "16k" },
  { value: "32768", label: "32k" },
  { value: "65536", label: "64k" },
  { value: "131072", label: "128k" },
  { value: "262144", label: "256k" },
  { value: "524288", label: "512k" },
];

function loadStoredActiveSubTab(): AIEvaluationSubTab {
  try {
    const raw = localStorage.getItem(STORAGE_ACTIVE_SUBTAB);
    if (raw === "review" || raw === "workspace") {
      return "review";
    }
    if (raw === "runs" || raw === "analytics" || raw === "benchmark") {
      return raw;
    }
    return "review";
  } catch {
    return "review";
  }
}

function loadStoredCustomModels(): ModelCatalogEntry[] {
  try {
    const raw = localStorage.getItem(STORAGE_CUSTOM_MODELS);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

function loadStoredSelectedModels(provider: string): string[] {
  try {
    const raw = localStorage.getItem(`${STORAGE_SELECTED_MODELS_PREFIX}${provider}`);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

const STORAGE_BENCHMARK_QUEUE = "tpa_benchmark_queue_v2";

function loadStoredQueue(): string[] {
  try {
    const raw = localStorage.getItem(STORAGE_BENCHMARK_QUEUE);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed) && parsed.length > 0) return parsed;
    }
  } catch (_) {}
  return [];
}

function saveStoredQueue(queue: string[]): void {
  try {
    localStorage.setItem(STORAGE_BENCHMARK_QUEUE, JSON.stringify(queue));
  } catch (_) {}
}

function loadStoredProvider(): string {
  try {
    return localStorage.getItem(STORAGE_SELECTED_PROVIDER) || "openrouter";
  } catch {
    return "openrouter";
  }
}

function loadStoredIterations(): number {
  try {
    const raw = localStorage.getItem(STORAGE_ITERATIONS);
    return raw ? Number(raw) || 1 : 1;
  } catch {
    return 1;
  }
}

interface AIEvaluationTabProps {
  onOpenFile?: (relPath: string) => void;
  onSelectTab?: (tabId: string) => void;
  experimentSpec?: ExperimentSpec;
  pipelineState?: PipelineState;
}

export const AIEvaluationTab: React.FC<AIEvaluationTabProps> = ({
  onOpenFile,
  onSelectTab,
  experimentSpec,
  pipelineState,
}) => {

  // Active sub-tab state backed by localStorage
  const [activeSubTab, setActiveSubTab] = useState<AIEvaluationSubTab>(loadStoredActiveSubTab);

  const handleSelectSubTab = (tab: AIEvaluationSubTab) => {
    setActiveSubTab(tab);
    try {
      localStorage.setItem(STORAGE_ACTIVE_SUBTAB, tab);
    } catch (_) {}
  };
  // Config state backed by localStorage
  const [selectedProvider, setSelectedProvider] = useState<string>(loadStoredProvider);
  const [selectedProviderFilter, setSelectedProviderFilter] = useState<string>("all");
  const [availableModels, setAvailableModels] = useState<ModelCatalogEntry[]>([]);
  const [customModels, setCustomModels] = useState<ModelCatalogEntry[]>(loadStoredCustomModels);
  const [queuedModelIds, setQueuedModelIds] = useState<string[]>(() => {
    const stored = loadStoredQueue();
    if (stored.length > 0) return stored;
    const prev = loadStoredSelectedModels(loadStoredProvider());
    if (prev.length > 0) return prev;
    return [];
  });
  const [selectedModelIds, setSelectedModelIds] = useState<string[]>(() =>
    loadStoredSelectedModels(loadStoredProvider())
  );
  const [customModelInput, setCustomModelInput] = useState<string>("");
  const [modelActionFeedback, setModelActionFeedback] = useState<string | null>(null);
  const [iterations, setIterations] = useState<number>(loadStoredIterations);
  const [predefinedExperiments, setPredefinedExperiments] = useState<PredefinedExperimentEntry[]>([]);
  const [selectedExpPath, setSelectedExpPath] = useState<string>("docs/experiment.md");
  const [isImportingExp, setIsImportingExp] = useState<boolean>(false);
  const [importSuccessMsg, setImportSuccessMsg] = useState<string | null>(null);
  const [localExperimentSpec, setLocalExperimentSpec] = useState<ExperimentSpec | null>(null);
  const [selectedReviewerIds, setSelectedReviewerIds] = useState<string[]>(loadStoredReviewers);

  const handleSetReviewerSlot = (slotIdx: number, modelId: string) => {
    setSelectedReviewerIds((prev) => {
      const next = [...prev];
      while (next.length < 3) next.push("");
      next[slotIdx] = modelId;
      saveStoredReviewers(next);
      return next;
    });
  };

  const handleResetDefaultReviewers = () => {
    setSelectedReviewerIds(DEFAULT_REVIEWER_IDS);
    saveStoredReviewers(DEFAULT_REVIEWER_IDS);
  };

  const handleToggleReviewerInCatalog = (modelId: string) => {
    setSelectedReviewerIds((prev) => {
      const idx = prev.indexOf(modelId);
      if (idx >= 0) {
        const next = [...prev];
        next.splice(idx, 1);
        while (next.length < 3) {
          const fallback = DEFAULT_REVIEWER_IDS.find((f) => !next.includes(f)) || "anthropic/claude-3.7-sonnet";
          next.push(fallback);
        }
        saveStoredReviewers(next);
        return next;
      } else {
        const next = [...prev];
        if (next.length < 3) {
          next.push(modelId);
        } else {
          next[2] = modelId;
        }
        saveStoredReviewers(next);
        return next;
      }
    });
  };

  // Reference baseline run from current workspace
  const [baselineRun, setBaselineRun] = useState<EvaluationRunSummary | null>(null);

  // Suite & historical benchmarks
  const [suites, setSuites] = useState<BenchmarkSuite[]>([]);
  const [activeSuite, setActiveSuite] = useState<BenchmarkSuite | null>(null);
  const [selectedRunIds, setSelectedRunIds] = useState<string[]>([]);
  const [isDeletingRunId, setIsDeletingRunId] = useState<string | null>(null);

  // Construct baseline preview suite if no multi-model benchmark suite has run yet
  const baselinePreviewSuite: BenchmarkSuite | null = baselineRun
    ? {
        id: "suite_workspace_baseline",
        title: `Workspace Baseline Run: ${baselineRun.model}`,
        createdAt: baselineRun.timestamp,
        provider: baselineRun.provider,
        models: [baselineRun.model],
        iterations: 1,
        experimentPath: "docs/experiment.md",
        experimentTitle: baselineRun.manuscriptTitle || "Active Completed Project",
        status: "completed",
        runs: [baselineRun],
        aggregated: [
          {
            model: baselineRun.model,
            provider: baselineRun.provider,
            isBaseline: true,
            completedRuns: 1,
            failedRuns: 0,
            meanDurationSeconds: baselineRun.totalDurationSeconds,
            meanTurns: baselineRun.totalTurns,
            meanPromptTokens: baselineRun.tokenUsage.promptTokens,
            meanCompletionTokens: baselineRun.tokenUsage.completionTokens,
            meanTotalTokens: baselineRun.tokenUsage.totalTokens,
            meanOverallScore: baselineRun.scores.overallBenchmarkScore,
            meanManuscriptScore: baselineRun.scores.overallManuscriptScore,
            meanMcpToolUseScore: baselineRun.scores.mcpToolUseScore,
            meanBioinformaticsIntelligence: baselineRun.scores.bioinformaticsIntelligenceScore,
            dimensionAverages: {
              insights: baselineRun.scores.insights,
              clarity: baselineRun.scores.clarity,
              scientificEvaluation: baselineRun.scores.scientificEvaluation,
              bioinformaticsIntelligence: baselineRun.scores.bioinformaticsIntelligence,
              actionableInsights: baselineRun.scores.actionableInsights,
            },
            runs: [baselineRun],
          },
        ],
      }
    : null;

  const currentDisplaySuite = activeSuite || suites[0] || baselinePreviewSuite;

  const lastSuiteIdRef = useRef<string | null>(null);
  const knownRunIdsRef = useRef<Set<string>>(new Set());

  // Sync selected run IDs when suite loads or changes, or when runs are added/removed
  useEffect(() => {
    if (!currentDisplaySuite || !currentDisplaySuite.runs || currentDisplaySuite.runs.length === 0) {
      return;
    }

    const currentRuns = currentDisplaySuite.runs;
    const currentRunIds = currentRuns.map((r) => r.id);
    const suiteId = currentDisplaySuite.id;

    if (suiteId !== lastSuiteIdRef.current) {
      // First load or user switched suites: select all runs in this suite
      lastSuiteIdRef.current = suiteId;
      knownRunIdsRef.current = new Set(currentRunIds);
      setSelectedRunIds(currentRunIds);
    } else {
      // Same suite: check if runs were added or removed
      const currentIdSet = new Set(currentRunIds);
      const newlyDiscovered = currentRunIds.filter((id) => !knownRunIdsRef.current.has(id));
      const hasDeleted = Array.from(knownRunIdsRef.current).some((id: string) => !currentIdSet.has(id));

      if (newlyDiscovered.length > 0 || hasDeleted) {
        knownRunIdsRef.current = currentIdSet;
        setSelectedRunIds((prev) => {
          const retained = prev.filter((id) => currentIdSet.has(id));
          return [...retained, ...newlyDiscovered];
        });
      }
    }
  }, [currentDisplaySuite?.id, currentDisplaySuite?.runs]);

  // Expanded runs in details view
  const [expandedRunId, setExpandedRunId] = useState<string | null>(null);

  // Per-model max output tokens overrides for evaluation runs
  const [modelMaxTokens, setModelMaxTokens] = useState<Record<string, number>>({});
  const [telemetryViewMode, setTelemetryViewMode] = useState<
    "time" | "turns" | "inputTokens" | "outputTokens" | "all"
  >("time");

  // AI Audit (Autonomous Performance Review) state
  const [auditStatus, setAuditStatus] = useState<PerformanceReviewStatus | null>(null);
  const [auditContent, setAuditContent] = useState<string>("");
  const [isGeneratingAudit, setIsGeneratingAudit] = useState<boolean>(false);
  const [customAuditFocus, setCustomAuditFocus] = useState<string>("");
  const [showAuditFocusInput, setShowAuditFocusInput] = useState<boolean>(false);
  const [auditCopied, setAuditCopied] = useState<boolean>(false);
  const [isEditingAudit, setIsEditingAudit] = useState<boolean>(false);
  const [auditEditBuffer, setAuditEditBuffer] = useState<string>("");
  const [auditSaveNotice, setAuditSaveNotice] = useState<boolean>(false);
  const [auditGenStep, setAuditGenStep] = useState<number>(0);
  const [isAuditExpanded, setIsAuditExpanded] = useState<boolean>(true);

  const fetchAuditStatusAndContent = async () => {
    try {
      const res = await fetch("/api/performance-review/content");
      const data = await res.json();
      if (data.ok) {
        setAuditStatus(data.status);
        if (data.content) {
          setAuditContent(data.content);
          setAuditEditBuffer(data.content);
        }
      }
    } catch (err: any) {
      console.warn("Notice: AI Audit status fetch:", err.message);
    }
  };

  useEffect(() => {
    fetchAuditStatusAndContent();
  }, []);

  useEffect(() => {
    if (!isGeneratingAudit) return;
    const interval = setInterval(() => {
      setAuditGenStep((s) => (s + 1) % 4);
    }, 3200);
    return () => clearInterval(interval);
  }, [isGeneratingAudit]);

  const handleGenerateAudit = async () => {
    setIsGeneratingAudit(true);
    setErrorMsg(null);
    setAuditGenStep(0);
    try {
      const res = await fetch("/api/performance-review/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ customFocus: customAuditFocus.trim() || undefined }),
      });
      const data: PerformanceReviewResult = await res.json();
      if (data.ok && data.reviewMarkdown) {
        setAuditContent(data.reviewMarkdown);
        setAuditEditBuffer(data.reviewMarkdown);
        setIsAuditExpanded(true);
        await fetchAuditStatusAndContent();
      } else {
        setErrorMsg(data.error || "AI Audit generation failed.");
      }
    } catch (err: any) {
      setErrorMsg(err.message || "Network error while generating AI Audit");
    } finally {
      setIsGeneratingAudit(false);
    }
  };

  const handleSaveAuditEdit = async () => {
    try {
      const res = await fetch("/api/performance-review/save", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content: auditEditBuffer }),
      });
      const data = await res.json();
      if (data.ok) {
        setAuditContent(auditEditBuffer);
        setIsEditingAudit(false);
        setAuditSaveNotice(true);
        setTimeout(() => setAuditSaveNotice(false), 2000);
      } else {
        setErrorMsg(data.error || "Failed to save AI Audit edits");
      }
    } catch (err: any) {
      setErrorMsg(err.message || "Failed to save edits");
    }
  };

  const handleCopyAudit = () => {
    if (!auditContent) return;
    navigator.clipboard.writeText(auditContent);
    setAuditCopied(true);
    setTimeout(() => setAuditCopied(false), 2000);
  };

  const renderedAuditHtml = React.useMemo(() => {
    if (!auditContent) return "";
    try {
      return marked.parse(auditContent, { async: false }) as string;
    } catch {
      return auditContent;
    }
  }, [auditContent]);

  const auditStepDescriptions = [
    "Auditing workspace logs (logs/pipeline.md, logs/*/chat.md, logs/*/console.log)...",
    "Extracting tool call histories, parameter schemas, and console warning/error traces...",
    "Evaluating biological hypotheses and data grounding in docs/observations.md and docs/manuscript.md...",
    "Tier-3 Reasoner model attributing bugs to [LLM], [Prompt], or [Tools] and drafting comprehensive audit...",
  ];

  // Scoring current workspace state on-demand
  const [isScoringCurrent, setIsScoringCurrent] = useState<boolean>(false);
  const [currentScoreResult, setCurrentScoreResult] = useState<{
    scores: EvaluationScoreBreakdown;
    telemetry: {
      totalDurationSeconds: number;
      totalTurns: number;
      tokenUsage: { promptTokens: number; completionTokens: number; totalTokens: number };
      phaseMetrics: PhaseTelemetryMetric[];
    };
  } | null>(null);

  // Loading & error
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  // Load baseline run on mount
  const loadBaseline = () => {
    fetchApiJson("/api/evaluation/baseline")
      .then((data) => {
        if (data.ok && data.baseline) {
          setBaselineRun(data.baseline);
        }
      })
      .catch((err) => console.warn("Notice: Baseline run fetch:", err.message));
  };

  useEffect(() => {
    loadBaseline();
  }, []);

  // Fetch models across providers
  useEffect(() => {
    fetchApiJson("/api/evaluation/models")
      .then((data) => {
        if (data.ok && Array.isArray(data.models)) {
          setAvailableModels(data.models);
        }
      })
      .catch((err) => console.error("Error fetching models:", err));
  }, []);

  // Fetch experiments and benchmark suites
  const prevBenchmarksRef = useRef<string>("");
  const refreshBenchmarks = () => {
    fetchApiJson("/api/evaluation/benchmarks")
      .then((data) => {
        if (data.ok) {
          const serialized = JSON.stringify({ suites: data.suites, activeSuite: data.activeSuite });
          if (serialized !== prevBenchmarksRef.current) {
            prevBenchmarksRef.current = serialized;
            setSuites(data.suites || []);
            setActiveSuite(data.activeSuite || null);
          }
        }
      })
      .catch((err) => console.error("Error fetching benchmarks:", err));

    fetchApiJson("/api/evaluation/experiments")
      .then((data) => {
        if (data.ok && Array.isArray(data.experiments)) {
          setPredefinedExperiments(data.experiments);
          if (data.experiments.length > 0) {
            setSelectedExpPath((prev) => {
              const stillExists = data.experiments.some((e: PredefinedExperimentEntry) => e.path === prev);
              return stillExists ? prev : data.experiments[0].path;
            });
          }
        }
      })
      .catch((err) => console.error("Error fetching experiments:", err));

    fetchApiJson("/api/experiment")
      .then((data) => {
        if (data && data.ok && data.spec) {
          setLocalExperimentSpec(data.spec);
        }
      })
      .catch(() => {});
  };

  useEffect(() => {
    refreshBenchmarks();
    const interval = setInterval(refreshBenchmarks, 3000);
    return () => clearInterval(interval);
  }, []);

  const runningQueue =
    activeSuite && activeSuite.status === "running"
      ? Array.from(
          new Set([
            ...(activeSuite.activeRun?.model ? [activeSuite.activeRun.model] : []),
            ...(activeSuite.queue || []),
          ])
        )
      : [];

  const effectiveQueue =
    activeSuite && activeSuite.status === "running" ? runningQueue : queuedModelIds;

  const handleAddToQueue = async (modelId: string) => {
    const trimmed = modelId.trim();
    if (!trimmed) return;
    setQueuedModelIds((prev) => {
      if (prev.includes(trimmed)) return prev;
      const next = [...prev, trimmed];
      saveStoredQueue(next);
      return next;
    });

    if (activeSuite && activeSuite.status === "running") {
      try {
        const tokens = modelMaxTokens[trimmed];
        const res = await fetchApiJson("/api/evaluation/queue/add", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            models: [trimmed],
            modelMaxTokens: tokens ? { [trimmed]: tokens } : undefined,
          }),
        });
        if (res.ok && Array.isArray(res.queue)) {
          setActiveSuite((prev) => (prev ? { ...prev, queue: res.queue } : null));
        }
      } catch (err) {
        console.error("Error adding model to running queue:", err);
      }
    }
    setModelActionFeedback(`✓ Added to Queue: "${trimmed}"`);
    setTimeout(() => setModelActionFeedback(null), 3000);
  };

  const handleRemoveFromQueue = async (modelId: string) => {
    setQueuedModelIds((prev) => {
      const next = prev.filter((id) => id !== modelId);
      saveStoredQueue(next);
      return next;
    });

    if (activeSuite && activeSuite.status === "running") {
      try {
        const res = await fetchApiJson("/api/evaluation/queue/remove", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ model: modelId }),
        });
        if (res.ok && Array.isArray(res.queue)) {
          setActiveSuite((prev) => (prev ? { ...prev, queue: res.queue } : null));
        }
      } catch (err) {
        console.error("Error removing model from running queue:", err);
      }
    }
  };

  const handleSelectAll = async (ids: string[]) => {
    setQueuedModelIds((prev) => {
      const next = Array.from(new Set([...prev, ...ids]));
      saveStoredQueue(next);
      return next;
    });

    if (activeSuite && activeSuite.status === "running") {
      const currentQueue = activeSuite.queue || [];
      const toAdd = ids.filter((id) => !currentQueue.includes(id) && activeSuite.activeRun?.model !== id);
      if (toAdd.length > 0) {
        try {
          const res = await fetchApiJson("/api/evaluation/queue/add", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              models: toAdd,
              modelMaxTokens,
            }),
          });
          if (res.ok && Array.isArray(res.queue)) {
            setActiveSuite((prev) => (prev ? { ...prev, queue: res.queue } : null));
          }
        } catch (err) {
          console.error("Error enqueuing models:", err);
        }
      }
    }
  };

  const handleClearAll = async () => {
    setQueuedModelIds([]);
    saveStoredQueue([]);

    if (activeSuite && activeSuite.status === "running" && activeSuite.queue) {
      for (const m of activeSuite.queue) {
        try {
          await fetchApiJson("/api/evaluation/queue/remove", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ model: m }),
          });
        } catch (_) {}
      }
      setActiveSuite((prev) => (prev ? { ...prev, queue: [] } : null));
    }
  };

  const handleSetIterations = (n: number) => {
    setIterations(n);
    try {
      localStorage.setItem(STORAGE_ITERATIONS, String(n));
    } catch (_) {}
  };

  const handleAddCustomModel = async () => {
    const trimmed = customModelInput.trim();
    if (!trimmed) return;

    let updatedCustom = [...customModels];
    const existing = [...availableModels, ...customModels].find((m) => m.id === trimmed);
    if (!existing) {
      const inferredProvider = trimmed.includes("/")
        ? "openrouter"
        : selectedProviderFilter !== "all"
        ? selectedProviderFilter
        : "openrouter";
      const newCustom: ModelCatalogEntry = {
        id: trimmed,
        name: trimmed.includes("/") ? trimmed.split("/")[1] : trimmed,
        provider: inferredProvider,
        tier: "T2",
        contextWindow: 128000,
        description: `Custom model ID configured for ${inferredProvider}`,
        isCustom: true,
      };
      updatedCustom = [...customModels, newCustom];
      setCustomModels(updatedCustom);
      try {
        localStorage.setItem(STORAGE_CUSTOM_MODELS, JSON.stringify(updatedCustom));
      } catch (_) {}
    }

    await handleAddToQueue(trimmed);
    setCustomModelInput("");
    setModelActionFeedback(`✓ Added and queued model: "${trimmed}"`);
    setTimeout(() => setModelActionFeedback(null), 3500);
  };

  const handleRemoveCustomModel = (modelId: string) => {
    const updatedCustom = customModels.filter((m) => m.id !== modelId);
    setCustomModels(updatedCustom);
    try {
      localStorage.setItem(STORAGE_CUSTOM_MODELS, JSON.stringify(updatedCustom));
    } catch (_) {}

    handleRemoveFromQueue(modelId);
    setModelActionFeedback(`Removed custom model: "${modelId}"`);
    setTimeout(() => setModelActionFeedback(null), 3500);
  };

  const handleImportCurrentWorkspace = async () => {
    setIsImportingExp(true);
    setErrorMsg(null);
    try {
      const data = await fetchApiJson("/api/evaluation/experiments/import-current", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
      });
      if (data.ok && Array.isArray(data.experiments)) {
        setPredefinedExperiments(data.experiments);
        if (data.imported) {
          setSelectedExpPath(data.imported.path);
          setImportSuccessMsg(`✓ Successfully imported workspace study design: "${data.imported.title}"`);
          setTimeout(() => setImportSuccessMsg(null), 4000);
        }
      } else {
        setErrorMsg(data.error || "Failed to import current workspace design.");
      }
    } catch (err: any) {
      setErrorMsg(err.message || "Failed to import current workspace design.");
    } finally {
      setIsImportingExp(false);
    }
  };

  const handleStartBenchmark = async () => {
    if (effectiveQueue.length === 0) {
      setErrorMsg("Please add at least one LLM to the queue before running.");
      return;
    }
    setErrorMsg(null);
    setIsLoading(true);

    try {
      const allCatalog = [...availableModels, ...customModels];
      const primaryProvider =
        allCatalog.find((m) => m.id === effectiveQueue[0])?.provider ||
        (selectedProviderFilter !== "all" ? selectedProviderFilter : "openrouter");

      const data = await fetchApiJson("/api/evaluation/start", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          provider: primaryProvider,
          models: effectiveQueue,
          modelMaxTokens: Object.fromEntries(
            Object.entries(modelMaxTokens).filter(([id, val]) => effectiveQueue.includes(id) && Boolean(val))
          ),
          iterations,
          experimentPath: selectedExpPath || "docs/experiment.md",
          reviewerModels: selectedReviewerIds,
        }),
      });
      if (!data.ok) {
        setErrorMsg(data.error || "Failed to launch benchmark suite.");
      } else {
        setActiveSuite(data.suite);
        refreshBenchmarks();
      }
    } catch (err: any) {
      setErrorMsg(err.message || "Network error launching benchmark.");
    } finally {
      setIsLoading(false);
    }
  };

  const handleCancelBenchmark = async () => {
    try {
      await fetchApiJson("/api/evaluation/cancel", { method: "POST" });
      refreshBenchmarks();
    } catch (err: any) {
      console.error("Cancel benchmark error:", err);
    }
  };

  const handleScoreCurrentWorkspace = async () => {
    setIsScoringCurrent(true);
    setErrorMsg(null);
    try {
      const data = await fetchApiJson("/api/evaluation/score-current", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          reviewerModels: selectedReviewerIds,
          useLLM: true,
        }),
      });
      if (data.ok) {
        setCurrentScoreResult({
          scores: data.scores,
          telemetry: data.telemetry,
        });
        if (data.baseline) {
          setBaselineRun(data.baseline);
        }
      } else {
        setErrorMsg(data.error || "Failed to evaluate current workspace.");
      }
    } catch (err: any) {
      setErrorMsg(err.message || "Failed to score current workspace.");
    } finally {
      setIsScoringCurrent(false);
    }
  };

  const handleDeleteRun = async (runId: string) => {
    if (!window.confirm("Are you sure you want to permanently delete this evaluation run and its files from disk?")) {
      return;
    }
    setIsDeletingRunId(runId);
    setErrorMsg(null);
    try {
      const data = await fetchApiJson("/api/evaluation/runs/delete", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ runId }),
      });
      if (data.ok && data.suite) {
        setSuites([data.suite]);
        setSelectedRunIds((prev) => prev.filter((id) => id !== runId));
        if (expandedRunId === runId) setExpandedRunId(null);
      }
    } catch (err: any) {
      setErrorMsg(err.message || "Failed to delete evaluation run.");
    } finally {
      setIsDeletingRunId(null);
    }
  };

  // Active runs selected by the user for comparison
  const activeRuns = React.useMemo(() => {
    if (!currentDisplaySuite || !currentDisplaySuite.runs) return [];
    if (selectedRunIds.length === 0) return [];
    return currentDisplaySuite.runs.filter((r) => selectedRunIds.includes(r.id));
  }, [currentDisplaySuite, selectedRunIds]);

  // Aggregated model metrics computed dynamically from selected runs
  const activeAggregated = React.useMemo(() => {
    if (activeRuns.length === 0) return [];
    const groups = new Map<string, EvaluationRunSummary[]>();
    activeRuns.forEach((r) => {
      const key = `${r.provider}::${r.model}`;
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key)!.push(r);
    });

    const res: ModelAggregatedPerformance[] = [];
    groups.forEach((modelRuns, key) => {
      const [provider, model] = key.split("::");
      const completed = modelRuns.filter((r) => r.status === "completed");
      const failed = modelRuns.filter((r) => r.status === "failed");
      const n = Math.max(1, completed.length);

      const meanDur = completed.reduce((acc, r) => acc + r.totalDurationSeconds, 0) / n;
      const meanTurns = completed.reduce((acc, r) => acc + r.totalTurns, 0) / n;
      const meanPrompt = completed.reduce((acc, r) => acc + r.tokenUsage.promptTokens, 0) / n;
      const meanCompl = completed.reduce((acc, r) => acc + r.tokenUsage.completionTokens, 0) / n;
      const meanTotal = completed.reduce((acc, r) => acc + r.tokenUsage.totalTokens, 0) / n;

      const meanOverall = completed.reduce((acc, r) => acc + r.scores.overallBenchmarkScore, 0) / n;
      const meanManuscript = completed.reduce((acc, r) => acc + r.scores.overallManuscriptScore, 0) / n;
      const meanMcp = completed.reduce((acc, r) => acc + r.scores.mcpToolUseScore, 0) / n;
      const meanBio = completed.reduce((acc, r) => acc + r.scores.bioinformaticsIntelligenceScore, 0) / n;

      const dimAvg = {
        insights: Math.round((completed.reduce((acc, r) => acc + r.scores.insights, 0) / n) * 10) / 10,
        clarity: Math.round((completed.reduce((acc, r) => acc + r.scores.clarity, 0) / n) * 10) / 10,
        scientificEvaluation: Math.round((completed.reduce((acc, r) => acc + r.scores.scientificEvaluation, 0) / n) * 10) / 10,
        bioinformaticsIntelligence: Math.round((completed.reduce((acc, r) => acc + r.scores.bioinformaticsIntelligence, 0) / n) * 10) / 10,
        actionableInsights: Math.round((completed.reduce((acc, r) => acc + r.scores.actionableInsights, 0) / n) * 10) / 10,
      };

      res.push({
        model,
        provider,
        isBaseline: modelRuns.some((r) => r.isBaseline),
        completedRuns: completed.length,
        failedRuns: failed.length,
        meanDurationSeconds: Math.round(meanDur),
        meanTurns: Math.round(meanTurns),
        meanPromptTokens: Math.round(meanPrompt),
        meanCompletionTokens: Math.round(meanCompl),
        meanTotalTokens: Math.round(meanTotal),
        meanOverallScore: Math.round(meanOverall),
        meanManuscriptScore: Math.round(meanManuscript * 10) / 10,
        meanMcpToolUseScore: Math.round(meanMcp),
        meanBioinformaticsIntelligence: Math.round(meanBio),
        dimensionAverages: dimAvg,
        runs: modelRuns,
      });
    });

    res.sort((a, b) => {
      if (a.isBaseline && !b.isBaseline) return -1;
      if (!a.isBaseline && b.isBaseline) return 1;
      return b.meanOverallScore - a.meanOverallScore;
    });

    return res;
  }, [activeRuns]);

  // Extract ordered phases across selected active runs (or all runs if none selected)
  const phaseList = React.useMemo(() => {
    const runsSource = activeRuns.length > 0 ? activeRuns : (currentDisplaySuite?.runs || []);
    const map = new Map<string, { id: string; label: string; title: string }>();

    runsSource.forEach((r) => {
      (r.phaseMetrics || []).forEach((pm) => {
        if (!map.has(pm.phaseId)) {
          let label = pm.phaseId;
          if (pm.fileName) {
            const clean = pm.fileName.replace(/\.md$/i, "").replace(/^[0-9]+_/, "");
            label = `${pm.phaseId}: ${clean.charAt(0).toUpperCase() + clean.slice(1).toLowerCase()}`;
          } else if (pm.phaseTitle) {
            const m = pm.phaseTitle.match(/Phase\s*(\d+)[:\s-]*(.*)/i);
            if (m) {
              const short = m[2].split("&")[0].split(":")[0].trim();
              label = `P${m[1]}: ${short.slice(0, 14)}`;
            } else {
              label = `Phase ${pm.phaseId}`;
            }
          }
          map.set(pm.phaseId, { id: pm.phaseId, label, title: pm.phaseTitle || pm.phaseId });
        }
      });
    });

    return Array.from(map.values()).sort((a, b) => {
      const numA = parseInt(a.id, 10);
      const numB = parseInt(b.id, 10);
      if (!isNaN(numA) && !isNaN(numB)) return numA - numB;
      return a.id.localeCompare(b.id);
    });
  }, [activeRuns, currentDisplaySuite]);

  const phaseCategories = React.useMemo(() => phaseList.map((p) => p.label), [phaseList]);

  // Overall categories:
  // [Overall Benchmark Score, Overall Manuscript Score, TidyProteomics-MCP Tool Score, Bioinformatics Intelligence]
  const overallCategories = React.useMemo(
    () => [
      "Overall Benchmark Score",
      "Overall Manuscript Score",
      "TidyProteomics-MCP Tool Score",
      "Bioinformatics Intelligence",
    ],
    []
  );

  // Scientific categories:
  // [Insights, Clarity, Scientific Rigor, Bioinfo Rigor, Actionable Roadmap]
  const scientificCategories = React.useMemo(
    () => ["Insights", "Clarity", "Scientific Rigor", "Bioinfo Rigor", "Actionable Roadmap"],
    []
  );

  const overallSeries: EvaluationSeries[] = React.useMemo(() => {
    if (activeAggregated.length === 0) return [];
    return activeAggregated.map((agg, idx) => {
      const modelDisplayName = agg.isBaseline
        ? `${agg.model.includes("/") ? agg.model.split("/")[1] : agg.model} (Baseline)`
        : agg.model.includes("/") ? agg.model.split("/")[1] : agg.model;
      const modelColor = MODEL_PALETTE[idx % MODEL_PALETTE.length];
      const scaledManuscript = Math.round(agg.meanManuscriptScore * 10);

      return {
        name: modelDisplayName,
        color: modelColor,
        values: [
          agg.meanOverallScore,
          scaledManuscript,
          agg.meanMcpToolUseScore,
          agg.meanBioinformaticsIntelligence,
        ],
        text: [
          agg.meanOverallScore > 0 ? String(agg.meanOverallScore) : "",
          scaledManuscript > 0 ? `${scaledManuscript}%` : "",
          agg.meanMcpToolUseScore > 0 ? `${agg.meanMcpToolUseScore}%` : "",
          agg.meanBioinformaticsIntelligence > 0 ? String(agg.meanBioinformaticsIntelligence) : "",
        ],
        hoverText: [
          `${agg.meanOverallScore} / 100`,
          `${agg.meanManuscriptScore} / 10 (${scaledManuscript}%)`,
          `${agg.meanMcpToolUseScore}%`,
          `${agg.meanBioinformaticsIntelligence} / 100`,
        ],
      };
    });
  }, [activeAggregated]);

  const scientificSeries: EvaluationSeries[] = React.useMemo(() => {
    if (activeAggregated.length === 0) return [];
    return activeAggregated.map((agg, idx) => {
      const modelDisplayName = agg.isBaseline
        ? `${agg.model.includes("/") ? agg.model.split("/")[1] : agg.model} (Baseline)`
        : agg.model.includes("/") ? agg.model.split("/")[1] : agg.model;
      const modelColor = MODEL_PALETTE[idx % MODEL_PALETTE.length];

      return {
        name: modelDisplayName,
        color: modelColor,
        values: [
          agg.dimensionAverages.insights,
          agg.dimensionAverages.clarity,
          agg.dimensionAverages.scientificEvaluation,
          agg.dimensionAverages.bioinformaticsIntelligence,
          agg.dimensionAverages.actionableInsights,
        ],
        text: [
          String(agg.dimensionAverages.insights),
          String(agg.dimensionAverages.clarity),
          String(agg.dimensionAverages.scientificEvaluation),
          String(agg.dimensionAverages.bioinformaticsIntelligence),
          String(agg.dimensionAverages.actionableInsights),
        ],
        hoverText: [
          `${agg.dimensionAverages.insights} / 10`,
          `${agg.dimensionAverages.clarity} / 10`,
          `${agg.dimensionAverages.scientificEvaluation} / 10`,
          `${agg.dimensionAverages.bioinformaticsIntelligence} / 10`,
          `${agg.dimensionAverages.actionableInsights} / 10`,
        ],
      };
    });
  }, [activeAggregated]);

  // Compute telemetry series per model across phases
  const { timeSeries, turnsSeries, inputTokensSeries, outputTokensSeries } = React.useMemo(() => {
    const time: EvaluationSeries[] = [];
    const turns: EvaluationSeries[] = [];
    const inTok: EvaluationSeries[] = [];
    const outTok: EvaluationSeries[] = [];

    if (activeAggregated.length === 0 || phaseList.length === 0) {
      return { timeSeries: time, turnsSeries: turns, inputTokensSeries: inTok, outputTokensSeries: outTok };
    }

    activeAggregated.forEach((agg, idx) => {
      const modelDisplayName = agg.isBaseline
        ? `${agg.model.includes("/") ? agg.model.split("/")[1] : agg.model} (Baseline)`
        : agg.model.includes("/") ? agg.model.split("/")[1] : agg.model;
      const modelColor = MODEL_PALETTE[idx % MODEL_PALETTE.length];
      const modelRuns = activeRuns.filter((r) => r.model === agg.model);

      const timeVals: number[] = [];
      const turnVals: number[] = [];
      const inTokVals: number[] = [];
      const outTokVals: number[] = [];

      const timeTexts: string[] = [];
      const turnTexts: string[] = [];
      const inTokTexts: string[] = [];
      const outTokTexts: string[] = [];

      const timeHoverTexts: string[] = [];
      const turnHoverTexts: string[] = [];
      const inTokHoverTexts: string[] = [];
      const outTokHoverTexts: string[] = [];

      phaseList.forEach((p) => {
        let durSum = 0;
        let turnSum = 0;
        let inTokSum = 0;
        let outTokSum = 0;
        let count = 0;

        modelRuns.forEach((r) => {
          const pm = (r.phaseMetrics || []).find((m) => m.phaseId === p.id);
          if (pm) {
            durSum += pm.durationSeconds || 0;
            turnSum += pm.turns || 0;
            inTokSum += pm.tokenUsage?.promptTokens || 0;
            outTokSum += pm.tokenUsage?.completionTokens || 0;
            count++;
          }
        });

        const n = count > 0 ? count : 1;
        const avgDur = Math.round(durSum / n);
        const avgTurns = Math.round(turnSum / n);
        const avgInTok = Math.round(inTokSum / n);
        const avgOutTok = Math.round(outTokSum / n);

        timeVals.push(avgDur);
        turnVals.push(avgTurns);
        inTokVals.push(avgInTok);
        outTokVals.push(avgOutTok);

        timeTexts.push(`${avgDur}s`);
        turnTexts.push(`${avgTurns}`);
        inTokTexts.push(`${avgInTok.toLocaleString()}`);
        outTokTexts.push(`${avgOutTok.toLocaleString()}`);

        timeHoverTexts.push(avgDur < 60 ? `${avgDur}s` : `${Math.floor(avgDur / 60)}m ${avgDur % 60}s`);
        turnHoverTexts.push(`${avgTurns} turns`);
        inTokHoverTexts.push(`${avgInTok.toLocaleString()} input tokens`);
        outTokHoverTexts.push(`${avgOutTok.toLocaleString()} output tokens`);
      });

      time.push({ name: modelDisplayName, values: timeVals, text: timeTexts, hoverText: timeHoverTexts, color: modelColor });
      turns.push({ name: modelDisplayName, values: turnVals, text: turnTexts, hoverText: turnHoverTexts, color: modelColor });
      inTok.push({ name: modelDisplayName, values: inTokVals, text: inTokTexts, hoverText: inTokHoverTexts, color: modelColor });
      outTok.push({ name: modelDisplayName, values: outTokVals, text: outTokTexts, hoverText: outTokHoverTexts, color: modelColor });
    });

    return { timeSeries: time, turnsSeries: turns, inputTokensSeries: inTok, outputTokensSeries: outTok };
  }, [activeAggregated, activeRuns, phaseList]);



  const renderReviewSubTab = () => (
    <div style={{ display: "flex", flexDirection: "column", gap: "20px" }}>
      {/* ======================================================== */}
      {/* 1. TOP SECTION: [AI Audit] (formerly Performance Review) */}
      {/* ======================================================== */}
      <div
        style={{
          background: "var(--panel)",
          border: "1px solid var(--border)",
          borderRadius: "8px",
          padding: "18px 20px",
          display: "flex",
          flexDirection: "column",
          gap: "14px",
        }}
      >
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", flexWrap: "wrap", gap: "12px" }}>
          <div style={{ display: "flex", flexDirection: "column", gap: "4px" }}>
            <div style={{ fontSize: "15px", fontWeight: 700, color: "var(--fg-bright)", display: "flex", alignItems: "center", gap: "8px" }}>
              <Sparkles size={17} color="var(--warning)" />
              <span>AI Audit</span>
              <span
                style={{
                  fontSize: "10px",
                  fontWeight: 600,
                  textTransform: "uppercase",
                  padding: "2px 7px",
                  borderRadius: "4px",
                  background: "rgba(245, 158, 11, 0.15)",
                  color: "#f59e0b",
                  border: "1px solid rgba(245, 158, 11, 0.3)",
                }}
              >
                Autonomous Agent Performance Review
              </span>
            </div>
            <div style={{ fontSize: "12px", color: "var(--muted)", maxWidth: "750px", lineHeight: 1.5 }}>
              Prompt the Tier-3 Reasoner model to audit all pipeline execution traces, evaluate MCP tool usage schemas, assess empirical grounding of biological hypotheses, and attribute bugs across <strong>[LLM]</strong>, <strong>[Prompt]</strong>, and <strong>[Tools]</strong>.
            </div>
          </div>

          <div style={{ display: "flex", alignItems: "center", gap: "8px", flexWrap: "wrap" }}>
            <button
              type="button"
              className="btn btn-secondary btn-xs"
              onClick={() => setShowAuditFocusInput((prev) => !prev)}
              style={{ gap: "4px" }}
              title="Add custom focus instruction for review generation"
            >
              <Edit3 size={11} /> {showAuditFocusInput ? "Hide Custom Focus" : "Custom Focus"}
            </button>

            {onOpenFile && (
              <button
                type="button"
                className="btn btn-secondary btn-xs"
                onClick={() => onOpenFile("docs/performance_review.md")}
                style={{ gap: "4px" }}
                title="Open docs/performance_review.md in editor"
              >
                <FileText size={11} /> View docs/performance_review.md
              </button>
            )}

            {auditContent && (
              <>
                <button
                  type="button"
                  className="btn btn-secondary btn-xs"
                  onClick={handleCopyAudit}
                  style={{ gap: "4px" }}
                  title="Copy markdown content to clipboard"
                >
                  {auditCopied ? <Check size={11} color="var(--success)" /> : <Copy size={11} />}
                  {auditCopied ? "Copied" : "Copy"}
                </button>

                <button
                  type="button"
                  className="btn btn-secondary btn-xs"
                  onClick={() => setIsEditingAudit((prev) => !prev)}
                  style={{ gap: "4px" }}
                  title={isEditingAudit ? "Switch to formatted view" : "Edit review markdown directly"}
                >
                  {isEditingAudit ? <Eye size={11} /> : <Edit3 size={11} />}
                  {isEditingAudit ? "Preview" : "Edit"}
                </button>

                {isEditingAudit && (
                  <button
                    type="button"
                    className="btn btn-secondary btn-xs"
                    onClick={handleSaveAuditEdit}
                    style={{ gap: "4px", color: "var(--success)" }}
                  >
                    <Save size={11} /> {auditSaveNotice ? "Saved!" : "Save"}
                  </button>
                )}
              </>
            )}

            <button
              type="button"
              className="btn btn-primary btn-sm"
              onClick={handleGenerateAudit}
              disabled={isGeneratingAudit}
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: "6px",
                background: "linear-gradient(135deg, #f59e0b, #d97706)",
                borderColor: "#b45309",
                color: "#fff",
                fontWeight: 600,
              }}
            >
              <Sparkles size={13} />
              {isGeneratingAudit ? "Auditing Pipeline..." : auditContent ? "Re-run AI Audit" : "Run AI Audit"}
            </button>
          </div>
        </div>

        {/* Custom Focus Prompt Input */}
        {showAuditFocusInput && (
          <div
            style={{
              background: "rgba(0,0,0,0.25)",
              border: "1px solid var(--border)",
              borderRadius: "6px",
              padding: "10px 14px",
              display: "flex",
              flexDirection: "column",
              gap: "8px",
            }}
          >
            <div style={{ fontSize: "11px", fontWeight: 600, color: "var(--fg-bright)" }}>
              Optional Custom Audit Directives:
            </div>
            <div style={{ display: "flex", gap: "8px" }}>
              <input
                type="text"
                className="input input-sm"
                placeholder="e.g. Scrutinize volcano plot p-value cutoffs and inspect Phase 4 tool retry loops"
                value={customAuditFocus}
                onChange={(e) => setCustomAuditFocus(e.target.value)}
                style={{ flex: 1, fontSize: "12px" }}
                disabled={isGeneratingAudit}
              />
              {customAuditFocus && (
                <button
                  type="button"
                  className="btn btn-secondary btn-xs"
                  onClick={() => setCustomAuditFocus("")}
                >
                  Clear
                </button>
              )}
            </div>
          </div>
        )}

        {/* Active Generation Progress Banner */}
        {isGeneratingAudit && (
          <div
            style={{
              background: "linear-gradient(135deg, rgba(245, 158, 11, 0.12), rgba(15, 23, 42, 0.6))",
              border: "1px solid rgba(245, 158, 11, 0.4)",
              borderRadius: "8px",
              padding: "14px 18px",
              display: "flex",
              alignItems: "center",
              gap: "12px",
            }}
          >
            <span
              className="spinner"
              style={{
                width: "16px",
                height: "16px",
                border: "2px solid #f59e0b",
                borderTopColor: "transparent",
                borderRadius: "50%",
                flexShrink: 0,
              }}
            />
            <div style={{ display: "flex", flexDirection: "column", gap: "2px", minWidth: 0 }}>
              <span style={{ fontSize: "12.5px", fontWeight: 700, color: "var(--fg-bright)" }}>
                AI Audit in Progress
              </span>
              <span style={{ fontSize: "11.5px", color: "#f59e0b" }}>
                {auditStepDescriptions[auditGenStep]}
              </span>
            </div>
          </div>
        )}

        {/* Status Strip & 3 Pillars Overview */}
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: "8px", fontSize: "11.5px" }}>
          <div>
            {auditStatus?.hasReview ? (
              <span style={{ display: "inline-flex", alignItems: "center", gap: "5px", color: "var(--success)", fontWeight: 600 }}>
                <Check size={13} /> Active Audit Ready
                {auditStatus.lastGenerated && (
                  <span style={{ color: "var(--muted)", fontWeight: 400 }}>
                    &middot; Generated {new Date(auditStatus.lastGenerated).toLocaleString()}
                  </span>
                )}
              </span>
            ) : auditStatus?.hasLogs ? (
              <span style={{ color: "var(--muted)" }}>
                Logs discovered across {auditStatus.phaseCount} phases. Ready for AI audit.
              </span>
            ) : (
              <span style={{ color: "var(--muted)" }}>
                No execution logs recorded in workspace yet.
              </span>
            )}
          </div>

          {auditContent && (
            <button
              type="button"
              className="btn btn-secondary btn-xs"
              onClick={() => setIsAuditExpanded((prev) => !prev)}
              style={{ gap: "4px" }}
            >
              {isAuditExpanded ? <ChevronUp size={11} /> : <ChevronDown size={11} />}
              {isAuditExpanded ? "Collapse Report" : "Expand Report"}
            </button>
          )}
        </div>

        {/* 3 Audit Pillars Grid */}
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))", gap: "10px" }}>
          <div style={{ background: "var(--bg)", border: "1px solid var(--border)", borderRadius: "6px", padding: "12px 14px", display: "flex", flexDirection: "column", gap: "4px" }}>
            <div style={{ fontWeight: 700, fontSize: "12px", color: "#60a5fa" }}>
              🛠️ Pillar 1: Tools &amp; Reasoning
            </div>
            <div style={{ fontSize: "11px", color: "var(--muted)", lineHeight: 1.45 }}>
              Evaluates parameterization of MCP tools (<code>tpa_*</code>), wide tabular schemas, user HITL gates, and reasoning loop efficiency.
            </div>
          </div>

          <div style={{ background: "var(--bg)", border: "1px solid var(--border)", borderRadius: "6px", padding: "12px 14px", display: "flex", flexDirection: "column", gap: "4px" }}>
            <div style={{ fontWeight: 700, fontSize: "12px", color: "#34d399" }}>
              🧬 Pillar 2: Scientific Hypotheses
            </div>
            <div style={{ fontSize: "11px", color: "var(--muted)", lineHeight: 1.45 }}>
              Assesses empirical grounding of biological claims in volcano plots, fold changes, and GO enrichments vs. speculative leaps.
            </div>
          </div>

          <div style={{ background: "var(--bg)", border: "1px solid var(--border)", borderRadius: "6px", padding: "12px 14px", display: "flex", flexDirection: "column", gap: "4px" }}>
            <div style={{ fontWeight: 700, fontSize: "12px", color: "#f87171" }}>
              🐞 Pillar 3: Bug Attribution
            </div>
            <div style={{ fontSize: "11px", color: "var(--muted)", lineHeight: 1.45 }}>
              Audits errors, retry loops, and unexpected halts, strictly attributing issues to <strong>[LLM]</strong>, <strong>[Prompt]</strong>, or <strong>[Tools]</strong>.
            </div>
          </div>
        </div>

        {/* Content Box: Formatted Markdown or Edit Textarea */}
        {auditContent && isAuditExpanded && (
          <div
            style={{
              background: "var(--bg)",
              border: "1px solid var(--border)",
              borderRadius: "8px",
              padding: isEditingAudit ? "12px" : "18px 24px",
              maxHeight: "550px",
              overflowY: "auto",
            }}
          >
            {isEditingAudit ? (
              <textarea
                className="input"
                value={auditEditBuffer}
                onChange={(e) => setAuditEditBuffer(e.target.value)}
                style={{
                  width: "100%",
                  minHeight: "360px",
                  fontFamily: 'SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace',
                  fontSize: "12px",
                  lineHeight: 1.5,
                  background: "transparent",
                  color: "var(--fg)",
                  border: "none",
                  resize: "vertical",
                  boxSizing: "border-box",
                }}
              />
            ) : (
              <div
                className="markdown-body"
                dangerouslySetInnerHTML={{ __html: renderedAuditHtml }}
                style={{
                  fontSize: "12.5px",
                  lineHeight: 1.65,
                  color: "var(--fg)",
                }}
              />
            )}
          </div>
        )}

        {!auditContent && !isGeneratingAudit && (
          <div
            style={{
              background: "var(--bg)",
              border: "1px dashed var(--border)",
              borderRadius: "6px",
              padding: "20px",
              textAlign: "center",
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              gap: "8px",
            }}
          >
            <div style={{ fontSize: "12px", color: "var(--muted)" }}>
              No AI Audit generated yet for this workspace. Click <strong>Run AI Audit</strong> to inspect execution logs, tool parameters, and hypothesis grounding.
            </div>
            <button
              type="button"
              className="btn btn-secondary btn-xs"
              onClick={handleGenerateAudit}
              style={{ gap: "5px", color: "var(--warning)" }}
            >
              <Sparkles size={12} /> Run AI Audit Now
            </button>
          </div>
        )}
      </div>

      {/* ====================================================================== */}
      {/* 2. BOTTOM SECTION: [Scientific Audit] (formerly Workspace Evaluation) */}
      {/* ====================================================================== */}
      <div
        style={{
          background: "var(--panel)",
          border: "1px solid var(--border)",
          borderRadius: "8px",
          padding: "18px 20px",
          display: "flex",
          flexDirection: "column",
          gap: "14px",
        }}
      >
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: "12px" }}>
          <div>
            <div style={{ fontSize: "15px", fontWeight: 700, color: "var(--fg-bright)", display: "flex", alignItems: "center", gap: "8px" }}>
              <Award size={17} color="var(--primary)" />
              <span>Scientific Audit</span>
              <span
                style={{
                  fontSize: "10px",
                  fontWeight: 600,
                  textTransform: "uppercase",
                  padding: "2px 7px",
                  borderRadius: "4px",
                  background: "rgba(59, 130, 246, 0.15)",
                  color: "#60a5fa",
                  border: "1px solid rgba(59, 130, 246, 0.3)",
                }}
              >
                Manuscript &amp; Tool Rubric
              </span>
            </div>
            <div style={{ fontSize: "12px", color: "var(--muted)", marginTop: "2px" }}>
              Score the active workspace manuscript (<code>docs/manuscript.md</code>) and TidyProteomics MCP tool telemetry on-demand using the 5-dimension publication rubric.
            </div>
          </div>

          <div style={{ display: "flex", alignItems: "center", gap: "8px", flexWrap: "wrap" }}>
            {onOpenFile && (
              <>
                <button
                  type="button"
                  className="btn btn-secondary btn-sm"
                  onClick={() => onOpenFile("docs/manuscript.md")}
                  style={{ gap: "5px" }}
                  title="Open docs/manuscript.md in viewer"
                >
                  <FileText size={12} /> View Manuscript
                </button>
                <button
                  type="button"
                  className="btn btn-secondary btn-sm"
                  onClick={() => onOpenFile("logs/pipeline.md")}
                  style={{ gap: "5px" }}
                  title="Open logs/pipeline.md in viewer"
                >
                  <Terminal size={12} /> View Logs
                </button>
              </>
            )}
            <button
              type="button"
              className="btn btn-primary btn-sm"
              onClick={handleScoreCurrentWorkspace}
              disabled={isScoringCurrent}
              style={{ gap: "6px" }}
            >
              <Award size={13} />
              {isScoringCurrent ? "Evaluating Workspace..." : "Score Current Workspace"}
            </button>
          </div>
        </div>

        {/* On-Demand Workspace Score Card */}
        {currentScoreResult && (
          <div
            style={{
              background: "linear-gradient(180deg, rgba(59, 130, 246, 0.08) 0%, rgba(15, 23, 42, 0.4) 100%)",
              border: "1px solid rgba(59, 130, 246, 0.3)",
              borderRadius: "8px",
              padding: "14px 18px",
              display: "flex",
              flexDirection: "column",
              gap: "12px",
            }}
          >
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <span style={{ fontSize: "12.5px", fontWeight: 700, color: "var(--fg-bright)", display: "flex", alignItems: "center", gap: "6px" }}>
                <Award size={15} color="#60a5fa" />
                Active Workspace Evaluation Scores
              </span>
              <button
                type="button"
                className="btn btn-secondary btn-xs"
                onClick={() => setCurrentScoreResult(null)}
              >
                Dismiss
              </button>
            </div>

            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: "10px" }}>
              <div style={{ background: "var(--bg)", border: "1px solid var(--border)", borderRadius: "6px", padding: "10px 12px" }}>
                <div style={{ fontSize: "10px", color: "var(--muted)", textTransform: "uppercase", fontWeight: 600 }}>Overall Benchmark Score</div>
                <div style={{ fontSize: "20px", fontWeight: 800, color: "#60a5fa", marginTop: "2px" }}>
                  {currentScoreResult.scores.overallBenchmarkScore}<span style={{ fontSize: "12px", color: "var(--muted)" }}>/100</span>
                </div>
              </div>
              <div style={{ background: "var(--bg)", border: "1px solid var(--border)", borderRadius: "6px", padding: "10px 12px" }}>
                <div style={{ fontSize: "10px", color: "var(--muted)", textTransform: "uppercase", fontWeight: 600 }}>Overall Manuscript Score</div>
                <div style={{ fontSize: "20px", fontWeight: 800, color: "#34d399", marginTop: "2px" }}>
                  {currentScoreResult.scores.overallManuscriptScore}<span style={{ fontSize: "12px", color: "var(--muted)" }}>/10</span>
                </div>
              </div>
              <div style={{ background: "var(--bg)", border: "1px solid var(--border)", borderRadius: "6px", padding: "10px 12px" }}>
                <div style={{ fontSize: "10px", color: "var(--muted)", textTransform: "uppercase", fontWeight: 600 }}>TidyProteomics-MCP Tool Score</div>
                <div style={{ fontSize: "20px", fontWeight: 800, color: "#f59e0b", marginTop: "2px" }}>
                  {currentScoreResult.scores.mcpToolUseScore}<span style={{ fontSize: "12px", color: "var(--muted)" }}>%</span>
                </div>
              </div>
              <div style={{ background: "var(--bg)", border: "1px solid var(--border)", borderRadius: "6px", padding: "10px 12px" }}>
                <div style={{ fontSize: "10px", color: "var(--muted)", textTransform: "uppercase", fontWeight: 600 }}>Bioinformatics Intelligence</div>
                <div style={{ fontSize: "20px", fontWeight: 800, color: "#c084fc", marginTop: "2px" }}>
                  {currentScoreResult.scores.bioinformaticsIntelligenceScore}<span style={{ fontSize: "12px", color: "var(--muted)" }}>/100</span>
                </div>
              </div>
            </div>

            {/* 5 Manuscript Dimensions Strip */}
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(130px, 1fr))", gap: "8px" }}>
              {[
                { label: "Insights", val: currentScoreResult.scores.insights },
                { label: "Clarity", val: currentScoreResult.scores.clarity },
                { label: "Scientific Rigor", val: currentScoreResult.scores.scientificEvaluation },
                { label: "Bioinfo Rigor", val: currentScoreResult.scores.bioinformaticsIntelligence },
                { label: "Actionable Insights", val: currentScoreResult.scores.actionableInsights },
              ].map((d) => (
                <div key={d.label} style={{ background: "rgba(0,0,0,0.25)", border: "1px solid var(--border)", borderRadius: "6px", padding: "6px 8px", textAlign: "center" }}>
                  <div style={{ fontSize: "9.5px", color: "var(--muted)", textTransform: "uppercase" }}>{d.label}</div>
                  <div style={{ fontSize: "13px", fontWeight: 700, color: "var(--fg-bright)" }}>{d.val}/10</div>
                </div>
              ))}
            </div>

            {currentScoreResult.scores.rubricNotes && (
              <div style={{ fontSize: "11.5px", color: "var(--muted)", fontStyle: "italic", background: "rgba(0,0,0,0.2)", padding: "6px 10px", borderRadius: "4px" }}>
                Feedback: {currentScoreResult.scores.rubricNotes}
              </div>
            )}
          </div>
        )}

        {!currentScoreResult && (
          <div
            style={{
              background: "var(--bg)",
              border: "1px dashed var(--border)",
              borderRadius: "8px",
              padding: "20px 24px",
              display: "flex",
              flexDirection: "column",
              gap: "14px",
            }}
          >
            <div style={{ fontSize: "12.5px", color: "var(--fg)", lineHeight: "1.6" }}>
              Evaluate the active workspace outputs on-demand without launching a full multi-model benchmark suite. The scoring engine evaluates the following dimensions:
            </div>

            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(210px, 1fr))", gap: "10px" }}>
              <div style={{ background: "var(--panel)", border: "1px solid var(--border)", borderRadius: "6px", padding: "10px 12px" }}>
                <div style={{ fontSize: "11.5px", fontWeight: 700, color: "#60a5fa", marginBottom: "3px" }}>
                  1. 5-Dimension Manuscript Rubric
                </div>
                <div style={{ fontSize: "11px", color: "var(--muted)" }}>
                  Evaluates Insights, Clarity, Scientific Rigor, Bioinformatics Rigor, and Actionable Roadmap in <code>docs/manuscript.md</code>.
                </div>
              </div>

              <div style={{ background: "var(--panel)", border: "1px solid var(--border)", borderRadius: "6px", padding: "10px 12px" }}>
                <div style={{ fontSize: "11.5px", fontWeight: 700, color: "#34d399", marginBottom: "3px" }}>
                  2. TidyProteomics-MCP Telemetry
                </div>
                <div style={{ fontSize: "11px", color: "var(--muted)" }}>
                  Measures tool invocation accuracy, parameter compliance, and execution success across analysis phases.
                </div>
              </div>

              <div style={{ background: "var(--panel)", border: "1px solid var(--border)", borderRadius: "6px", padding: "10px 12px" }}>
                <div style={{ fontSize: "11.5px", fontWeight: 700, color: "#f59e0b", marginBottom: "3px" }}>
                  3. Bioinformatics Intelligence
                </div>
                <div style={{ fontSize: "11px", color: "var(--muted)" }}>
                  Assesses biological interpretation, statistical thresholds, volcano/heatmap choices, and pathway context.
                </div>
              </div>

              <div style={{ background: "var(--panel)", border: "1px solid var(--border)", borderRadius: "6px", padding: "10px 12px" }}>
                <div style={{ fontSize: "11.5px", fontWeight: 700, color: "#c084fc", marginBottom: "3px" }}>
                  4. Baseline Calibration
                </div>
                <div style={{ fontSize: "11px", color: "var(--muted)" }}>
                  Establishes the active project run as the baseline against which automated benchmarks compare.
                </div>
              </div>
            </div>

            <div>
              <button
                type="button"
                className="btn btn-primary btn-sm"
                onClick={handleScoreCurrentWorkspace}
                disabled={isScoringCurrent}
                style={{ gap: "6px", padding: "6px 14px", fontSize: "12px" }}
              >
                <Award size={14} />
                {isScoringCurrent ? "Evaluating Workspace Artifacts..." : "Score Current Workspace Now"}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );


  const renderBenchmarkSubTab = () => {
    const allCatalog = [...availableModels, ...customModels];
    const displayedModels =
      selectedProviderFilter === "all"
        ? allCatalog
        : allCatalog.filter((m) => m.provider === selectedProviderFilter);

    const currentExp =
      predefinedExperiments.find((e) => e.path === selectedExpPath) ||
      predefinedExperiments.find((e) => e.isCurrentWorkspace) ||
      predefinedExperiments[0];

    const effectiveSpec = experimentSpec || localExperimentSpec;

    const isExperimentReady: boolean = (() => {
      if (effectiveSpec) {
        if (!effectiveSpec.exists) return false;
        if (effectiveSpec.missingInitialFields && effectiveSpec.missingInitialFields.length > 0) return false;
        const dataFile = effectiveSpec.pathToDataFile?.trim();
        if (!dataFile || dataFile.includes("[REQUIRED") || dataFile.startsWith("<") || dataFile.includes("Enter URL")) return false;
        const platform = effectiveSpec.platform?.trim();
        if (!platform || platform.includes("[REQUIRED") || platform.startsWith("<") || platform.includes("Enter search platform")) return false;
        const analyte = effectiveSpec.analyte?.trim();
        if (!analyte || analyte.includes("[REQUIRED") || analyte.startsWith("<") || analyte.includes("proteins or peptides")) return false;
        const desc = effectiveSpec.description?.trim();
        if (!desc || desc.includes("[REQUIRED") || desc.length < 10) return false;
        return true;
      }
      if (currentExp && typeof currentExp.isHitlFreeReady === "boolean") {
        return currentExp.isHitlFreeReady;
      }
      return false;
    })();

    // Calculate pipeline progress metrics
    const isRunning = activeSuite?.status === "running";
    const currentModel = activeSuite?.activeRun?.model || (isRunning ? "Evaluating..." : null);
    const runningPhaseObj = pipelineState?.phases?.find((p) => p.status === "running");
    const currentPhase =
      activeSuite?.activeRun?.phaseTitle ||
      runningPhaseObj?.title ||
      runningPhaseObj?.fileName ||
      (isRunning ? "Running pipeline" : "Idle");

    const enabledPhases = pipelineState?.phases?.filter((p) => p.enabled) || [];
    const totalPhaseCount = enabledPhases.length || 7;
    const completedPhaseCount = enabledPhases.filter((p) => p.status === "completed").length;
    const runningPhaseIdx = enabledPhases.findIndex((p) => p.status === "running");

    // Only show full 100% progress when completely finished with the task (not while running the last phase)
    const isTaskCompleted = !isRunning && (activeSuite?.status === "completed" || (completedPhaseCount === totalPhaseCount && totalPhaseCount > 0));

    let phaseProgressPct = 0;
    if (isTaskCompleted) {
      phaseProgressPct = 100;
    } else if (isRunning) {
      const activeIdx = runningPhaseIdx >= 0 ? runningPhaseIdx : completedPhaseCount;
      const progressFraction = (activeIdx + 0.3) / totalPhaseCount;
      // Cap at 95% while in-progress so it never shows 100% until the task completes
      phaseProgressPct = Math.min(95, Math.max(5, Math.round(progressFraction * 100)));
    } else if (completedPhaseCount > 0) {
      phaseProgressPct = Math.min(95, Math.round((completedPhaseCount / totalPhaseCount) * 100));
    }

    return (
      <div style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
        {/* Benchmark Suite Configuration Panel */}
        <div
          style={{
            background: "var(--panel)",
            border: "1px solid var(--border)",
            borderRadius: "8px",
            padding: "16px 20px",
            display: "flex",
            flexDirection: "column",
            gap: "18px",
          }}
        >
          {/* 1. Workspace indicator */}
          <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
            <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
              <span style={{ fontSize: "11px", fontWeight: 700, color: "var(--muted)", textTransform: "uppercase", letterSpacing: "0.5px" }}>
                1. Workspace
              </span>
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: "10px", flexWrap: "wrap" }}>
              {isExperimentReady ? (
                <div
                  style={{
                    display: "inline-flex",
                    alignItems: "center",
                    gap: "8px",
                    padding: "6px 14px",
                    borderRadius: "6px",
                    background: "rgba(34, 197, 94, 0.15)",
                    border: "1px solid rgba(34, 197, 94, 0.4)",
                    color: "#4ade80",
                    fontSize: "12px",
                    fontWeight: 600,
                  }}
                >
                  <CheckCircle2 size={14} color="#4ade80" />
                  <span>Ready</span>
                  <span style={{ fontSize: "11px", color: "rgba(74, 222, 128, 0.7)", fontWeight: 400 }}>
                    (docs/experiment.md)
                  </span>
                  <button
                    type="button"
                    onClick={() => {
                      if (onSelectTab) onSelectTab("experiment");
                      else if (onOpenFile) onOpenFile("docs/experiment.md");
                    }}
                    style={{
                      background: "transparent",
                      border: "none",
                      color: "#4ade80",
                      padding: "0 2px",
                      cursor: "pointer",
                      display: "inline-flex",
                      alignItems: "center",
                      gap: "3px",
                      fontSize: "11px",
                      textDecoration: "underline",
                      marginLeft: "4px",
                    }}
                    title="View or edit experiment design"
                  >
                    View <ExternalLink size={10} />
                  </button>
                </div>
              ) : (
                <div
                  style={{
                    display: "inline-flex",
                    alignItems: "center",
                    gap: "10px",
                    padding: "6px 12px",
                    borderRadius: "6px",
                    background: "rgba(245, 158, 11, 0.15)",
                    border: "1px solid rgba(245, 158, 11, 0.45)",
                    color: "#fbbf24",
                    fontSize: "12px",
                    fontWeight: 600,
                    flexWrap: "wrap",
                  }}
                >
                  <AlertTriangle size={14} color="#fbbf24" style={{ flexShrink: 0 }} />
                  <span>The Experiment document requires valid input for all fields</span>
                  <button
                    type="button"
                    onClick={() => {
                      if (onSelectTab) onSelectTab("experiment");
                      else if (onOpenFile) onOpenFile("docs/experiment.md");
                    }}
                    style={{
                      background: "rgba(245, 158, 11, 0.25)",
                      border: "1px solid rgba(245, 158, 11, 0.5)",
                      borderRadius: "4px",
                      color: "#fef3c7",
                      padding: "2px 8px",
                      fontSize: "11px",
                      fontWeight: 700,
                      cursor: "pointer",
                      display: "inline-flex",
                      alignItems: "center",
                      gap: "4px",
                    }}
                    title="Open experiment design document"
                  >
                    Configure <ExternalLink size={11} />
                  </button>
                </div>
              )}
            </div>
          </div>

          {/* 2. Run Benchmarking Evaluations */}
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              gap: "12px",
              background: "rgba(0, 0, 0, 0.18)",
              border: "1px solid var(--border)",
              borderRadius: "8px",
              padding: "14px 16px",
            }}
          >
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: "10px" }}>
              <div style={{ fontSize: "11px", fontWeight: 700, color: "var(--muted)", textTransform: "uppercase", letterSpacing: "0.5px" }}>
                2. Run Benchmarking Evaluations
              </div>

              {/* Iterations dropdown + RUN button */}
              <div style={{ display: "flex", alignItems: "center", gap: "10px", flexWrap: "wrap" }}>
                <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
                  <label style={{ fontSize: "11px", fontWeight: 600, color: "var(--muted)", textTransform: "uppercase" }}>
                    Iterations:
                  </label>
                  <select
                    className="select"
                    value={iterations}
                    onChange={(e) => handleSetIterations(Number(e.target.value))}
                    style={{ fontSize: "12px", padding: "4px 8px", minWidth: "60px", cursor: "pointer" }}
                  >
                    {[1, 2, 3, 4, 5].map((n) => (
                      <option key={n} value={n}>
                        {n}
                      </option>
                    ))}
                  </select>
                </div>

                <button
                  type="button"
                  className="btn btn-primary"
                  onClick={handleStartBenchmark}
                  disabled={effectiveQueue.length === 0 || isLoading || isRunning}
                  style={{ gap: "6px", padding: "6px 18px", fontWeight: 700 }}
                  title={effectiveQueue.length === 0 ? "Add models to queue below before running" : "Run benchmark evaluations"}
                >
                  <Play size={12} fill="currentColor" />
                  {isLoading ? "Starting..." : isRunning ? "RUNNING" : "> RUN"}
                </button>

                {isRunning && (
                  <button
                    type="button"
                    className="btn btn-secondary btn-sm"
                    onClick={handleCancelBenchmark}
                    style={{ gap: "4px", color: "#f87171", borderColor: "rgba(239, 68, 68, 0.4)" }}
                    title="Cancel active benchmark suite"
                  >
                    <Square size={11} fill="currentColor" /> Cancel
                  </button>
                )}
              </div>
            </div>

            {/* Queue display */}
            <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
              <div style={{ fontSize: "11px", fontWeight: 700, color: "var(--muted)", textTransform: "uppercase" }}>
                Queue ({effectiveQueue.length} {effectiveQueue.length === 1 ? "model" : "models"} &middot; {effectiveQueue.length * iterations} runs planned):
              </div>
              {effectiveQueue.length === 0 ? (
                <div style={{ fontSize: "11.5px", color: "var(--muted)", fontStyle: "italic", padding: "4px 0" }}>
                  No models in queue. Add models from the catalog below.
                </div>
              ) : (
                <div style={{ display: "flex", gap: "6px", flexWrap: "wrap", alignItems: "center" }}>
                  {effectiveQueue.map((id) => {
                    const entry = allCatalog.find((m) => m.id === id);
                    const displayName = entry ? entry.name : (id.includes("/") ? id.split("/")[1] : id);
                    const isCurrentlyRunning = isRunning && activeSuite?.activeRun?.model === id;
                    const currentTokens = modelMaxTokens[id];

                    return (
                      <span
                        key={id}
                        style={{
                          display: "inline-flex",
                          alignItems: "center",
                          gap: "6px",
                          background: isCurrentlyRunning ? "rgba(59, 130, 246, 0.2)" : "rgba(15, 23, 42, 0.85)",
                          border: `1px solid ${isCurrentlyRunning ? "#60a5fa" : "var(--primary)"}`,
                          borderRadius: "4px",
                          padding: "3px 8px",
                          fontSize: "11px",
                          color: "var(--fg-bright)",
                          fontFamily: "var(--font-mono)",
                        }}
                      >
                        {isCurrentlyRunning ? (
                          <span
                            className="spinner"
                            style={{
                              width: "10px",
                              height: "10px",
                              border: "2px solid #60a5fa",
                              borderTopColor: "transparent",
                              borderRadius: "50%",
                            }}
                          />
                        ) : (
                          <CheckCircle2 size={12} color="var(--primary)" />
                        )}
                        <span title={id} style={{ fontWeight: isCurrentlyRunning ? 700 : 500 }}>
                          {displayName}
                        </span>
                        {currentTokens && (
                          <span style={{ fontSize: "9.5px", color: "var(--muted)", background: "rgba(0,0,0,0.4)", padding: "1px 4px", borderRadius: "2px" }}>
                            {currentTokens >= 1024 ? `${Math.round(currentTokens / 1024)}k` : `${currentTokens}`}
                          </span>
                        )}
                        {isCurrentlyRunning ? (
                          <span style={{ fontSize: "9px", fontWeight: 700, color: "#60a5fa", textTransform: "uppercase" }}>Running</span>
                        ) : (
                          <button
                            type="button"
                            onClick={() => handleRemoveFromQueue(id)}
                            title={`Remove ${id} from queue`}
                            style={{
                              background: "transparent",
                              border: "none",
                              color: "var(--muted)",
                              cursor: "pointer",
                              padding: "0 2px",
                              display: "flex",
                              alignItems: "center",
                            }}
                            onMouseEnter={(e) => (e.currentTarget.style.color = "#f87171")}
                            onMouseLeave={(e) => (e.currentTarget.style.color = "var(--muted)")}
                          >
                            <X size={12} />
                          </button>
                        )}
                      </span>
                    );
                  })}
                </div>
              )}
            </div>

            {/* Progress display */}
            <div
              style={{
                background: "rgba(0, 0, 0, 0.25)",
                border: "1px solid rgba(255, 255, 255, 0.08)",
                borderRadius: "6px",
                padding: "8px 12px",
                display: "flex",
                flexDirection: "column",
                gap: "8px",
              }}
            >
              <div style={{ display: "flex", alignItems: "center", gap: "8px", flexWrap: "wrap", fontSize: "11.5px" }}>
                <span style={{ fontWeight: 700, color: "var(--muted)", textTransform: "uppercase" }}>
                  Progress:
                </span>
                {currentModel ? (
                  <span
                    style={{
                      padding: "2px 8px",
                      borderRadius: "4px",
                      background: "rgba(59, 130, 246, 0.15)",
                      border: "1px solid rgba(59, 130, 246, 0.4)",
                      color: "#60a5fa",
                      fontWeight: 600,
                      fontFamily: "var(--font-mono)",
                    }}
                  >
                    [ {currentModel} {activeSuite?.activeRun?.iteration ? `(Iter ${activeSuite.activeRun.iteration}/${activeSuite.iterations})` : ""} ]
                  </span>
                ) : (
                  <span
                    style={{
                      padding: "2px 8px",
                      borderRadius: "4px",
                      background: "rgba(255, 255, 255, 0.05)",
                      border: "1px solid var(--border)",
                      color: "var(--muted)",
                    }}
                  >
                    [ Idle ]
                  </span>
                )}

                <span
                  style={{
                    padding: "2px 8px",
                    borderRadius: "4px",
                    background: isRunning ? "rgba(168, 85, 247, 0.15)" : "rgba(255, 255, 255, 0.05)",
                    border: `1px solid ${isRunning ? "rgba(168, 85, 247, 0.4)" : "var(--border)"}`,
                    color: isRunning ? "#c084fc" : "var(--muted)",
                    fontWeight: isRunning ? 600 : 400,
                  }}
                >
                  [ {currentPhase} ]
                </span>
              </div>

              {/* Progress Bar track */}
              <div style={{ width: "100%", height: "4px", background: "rgba(255, 255, 255, 0.08)", borderRadius: "2px", overflow: "hidden" }}>
                <div
                  style={{
                    width: `${phaseProgressPct}%`,
                    height: "100%",
                    background: isRunning ? "linear-gradient(90deg, #3b82f6, #10b981)" : (phaseProgressPct === 100 ? "#10b981" : "transparent"),
                    transition: "width 0.3s ease",
                  }}
                />
              </div>
            </div>
          </div>

          {/* 3. Reviewer Panel (3 Reviewers Required for Multi-Model Panel) */}
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              gap: "10px",
              background: "rgba(168, 85, 247, 0.05)",
              border: "1px solid rgba(168, 85, 247, 0.3)",
              borderRadius: "8px",
              padding: "14px 16px",
            }}
          >
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: "10px" }}>
              <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                <Award size={15} color="#c084fc" />
                <span style={{ fontSize: "11.5px", fontWeight: 700, color: "#c084fc", textTransform: "uppercase", letterSpacing: "0.5px" }}>
                  LLM Reviewer Panel (3 Distinct Reviewer Models)
                </span>
                <span
                  style={{
                    fontSize: "9.5px",
                    fontWeight: 700,
                    padding: "1px 6px",
                    borderRadius: "3px",
                    background: "rgba(168, 85, 247, 0.2)",
                    color: "#e9d5ff",
                  }}
                >
                  RUNS 1x PER MODEL ON EVERY BENCHMARK
                </span>
              </div>

              <button
                type="button"
                className="btn btn-secondary btn-xs"
                onClick={handleResetDefaultReviewers}
                style={{ fontSize: "10.5px", padding: "2px 8px" }}
                title="Reset to recommended cross-vendor frontier reviewer models"
              >
                Reset to Defaults
              </button>
            </div>

            <div style={{ fontSize: "11px", color: "var(--muted)", lineHeight: 1.4 }}>
              Instead of running one reviewer 3x, each evaluated manuscript is independently audited 1x by these 3 separate models
              across 25 rubric sub-criteria with exact quote citations. Select 3 models below or assign directly from the AI Models table.
            </div>

            {/* 3 Reviewer Model Slots */}
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))", gap: "10px" }}>
              {[0, 1, 2].map((slotIdx) => {
                const currentReviewerId = selectedReviewerIds[slotIdx] || "";
                const entry = allCatalog.find((m) => m.id === currentReviewerId);
                const slotLabel = `Reviewer ${slotIdx + 1}`;

                return (
                  <div
                    key={slotIdx}
                    style={{
                      background: "rgba(0, 0, 0, 0.35)",
                      border: "1px solid rgba(168, 85, 247, 0.25)",
                      borderRadius: "6px",
                      padding: "8px 10px",
                      display: "flex",
                      flexDirection: "column",
                      gap: "4px",
                    }}
                  >
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                      <span style={{ fontSize: "10px", fontWeight: 700, color: "#c084fc", textTransform: "uppercase" }}>
                        {slotLabel}
                      </span>
                      {entry && (
                        <span style={{ fontSize: "9px", color: "var(--muted)", textTransform: "uppercase" }}>
                          {entry.provider}
                        </span>
                      )}
                    </div>

                    <select
                      value={currentReviewerId}
                      onChange={(e) => handleSetReviewerSlot(slotIdx, e.target.value)}
                      className="select"
                      style={{
                        fontSize: "11.5px",
                        padding: "4px 8px",
                        background: "rgba(15, 23, 42, 0.8)",
                        borderColor: currentReviewerId ? "rgba(168, 85, 247, 0.4)" : "var(--border)",
                        color: "var(--fg-bright)",
                        cursor: "pointer",
                      }}
                    >
                      <option value="">-- Select Reviewer Model --</option>
                      {allCatalog.map((m) => (
                        <option key={m.id} value={m.id}>
                          {m.name} ({m.provider})
                        </option>
                      ))}
                    </select>

                    <span style={{ fontSize: "10px", color: "var(--muted)", fontFamily: "var(--font-mono)" }}>
                      {currentReviewerId || "No model assigned"}
                    </span>
                  </div>
                );
              })}
            </div>
          </div>

          {/* 4. AI Models */}
          <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: "8px" }}>
              <label style={{ fontSize: "11px", fontWeight: 700, color: "var(--muted)", textTransform: "uppercase", letterSpacing: "0.5px" }}>
                4. AI Models ({displayedModels.length} models available)
              </label>
              <div style={{ display: "flex", gap: "8px" }}>
                <button
                  type="button"
                  className="btn btn-secondary btn-xs"
                  onClick={() => handleSelectAll(displayedModels.map((m) => m.id))}
                >
                  Select All ({displayedModels.length})
                </button>
                <button
                  type="button"
                  className="btn btn-secondary btn-xs"
                  onClick={handleClearAll}
                >
                  Clear All
                </button>
              </div>
            </div>

            {/* Custom Model Input */}
            <div style={{ display: "flex", flexDirection: "column", gap: "4px" }}>
              <div style={{ display: "flex", gap: "8px" }}>
                <input
                  type="text"
                  className="input"
                  style={{ flex: 1, padding: "6px 10px", fontSize: "11.5px" }}
                  placeholder="Enter custom model ID (e.g. meta-llama/llama-3.3-70b-instruct or openai/gpt-4.5-preview)"
                  value={customModelInput}
                  onChange={(e) => setCustomModelInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") handleAddCustomModel();
                  }}
                />
                <button
                  type="button"
                  className="btn btn-secondary btn-sm"
                  onClick={handleAddCustomModel}
                  disabled={!customModelInput.trim()}
                  style={{ gap: "4px" }}
                >
                  <Plus size={12} /> ADD
                </button>
              </div>

              {modelActionFeedback && (
                <div style={{ fontSize: "11px", color: "#4ade80", fontWeight: 600, display: "flex", alignItems: "center", gap: "4px" }}>
                  <Check size={12} />
                  <span>{modelActionFeedback}</span>
                </div>
              )}
            </div>

            {/* Provider Filter Tabs */}
            <div style={{ display: "flex", gap: "6px", flexWrap: "wrap", alignItems: "center" }}>
              {[
                { id: "all", label: "All Providers" },
                { id: "openrouter", label: "OpenRouter" },
                { id: "anthropic", label: "Anthropic" },
                { id: "openai", label: "OpenAI" },
                { id: "gemini", label: "Gemini" },
                { id: "ollama", label: "Ollama" },
              ].map((p) => (
                <button
                  key={p.id}
                  type="button"
                  className={`btn btn-xs ${selectedProviderFilter === p.id ? "btn-primary" : "btn-secondary"}`}
                  onClick={() => setSelectedProviderFilter(p.id)}
                  style={{ padding: "4px 10px", fontSize: "11px" }}
                >
                  {p.label}
                </button>
              ))}
            </div>

            {/* Model rows */}
            <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
              {displayedModels.map((m) => {
                const isQueued = effectiveQueue.includes(m.id);
                const currentTokens = modelMaxTokens[m.id];
                return (
                  <div
                    key={m.id}
                    style={{
                      background: isQueued ? "rgba(59, 130, 246, 0.08)" : "var(--bg)",
                      border: `1px solid ${isQueued ? "rgba(59, 130, 246, 0.35)" : "var(--border)"}`,
                      borderRadius: "6px",
                      padding: "8px 12px",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "space-between",
                      gap: "12px",
                      transition: "all 0.15s ease",
                    }}
                  >
                    {/* Left: Name + Tier + Provider + ID + Description */}
                    <div style={{ display: "flex", flexDirection: "column", gap: "2px", minWidth: 0, flex: 1 }}>
                      <div style={{ display: "flex", alignItems: "center", gap: "8px", flexWrap: "wrap" }}>
                        <span style={{ fontSize: "12.5px", fontWeight: 600, color: isQueued ? "var(--fg-bright)" : "var(--fg)" }}>
                          {m.name}
                        </span>
                        {m.isCustom ? (
                          <span
                            style={{
                              fontSize: "9px",
                              fontWeight: 700,
                              padding: "2px 5px",
                              borderRadius: "3px",
                              background: "rgba(245, 158, 11, 0.2)",
                              color: "#fbbf24",
                            }}
                          >
                            CUSTOM
                          </span>
                        ) : (
                          <span
                            style={{
                              fontSize: "9.5px",
                              fontWeight: 700,
                              padding: "1px 5px",
                              borderRadius: "3px",
                              background: m.tier === "T3" ? "rgba(168, 85, 247, 0.2)" : m.tier === "T2" ? "rgba(59, 130, 246, 0.2)" : "rgba(34, 197, 94, 0.2)",
                              color: m.tier === "T3" ? "#c084fc" : m.tier === "T2" ? "#60a5fa" : "#4ade80",
                            }}
                          >
                            {m.tier}
                          </span>
                        )}
                        <span
                          style={{
                            fontSize: "9.5px",
                            fontWeight: 600,
                            padding: "1px 5px",
                            borderRadius: "3px",
                            background: "rgba(255, 255, 255, 0.06)",
                            color: "var(--muted)",
                            textTransform: "uppercase",
                          }}
                        >
                          {m.provider}
                        </span>
                        {selectedReviewerIds.includes(m.id) && (
                          <span
                            style={{
                              fontSize: "9px",
                              fontWeight: 700,
                              padding: "1px 6px",
                              borderRadius: "3px",
                              background: "rgba(168, 85, 247, 0.25)",
                              border: "1px solid rgba(168, 85, 247, 0.5)",
                              color: "#e9d5ff",
                            }}
                          >
                            REVIEWER {selectedReviewerIds.indexOf(m.id) + 1}
                          </span>
                        )}
                        <span style={{ fontSize: "10.5px", color: "var(--muted)", fontFamily: "var(--font-mono)" }}>
                          {m.id}
                        </span>
                      </div>
                      {m.description && (
                        <div
                          style={{
                            fontSize: "11px",
                            color: "var(--muted)",
                            whiteSpace: "nowrap",
                            overflow: "hidden",
                            textOverflow: "ellipsis",
                          }}
                          title={m.description}
                        >
                          {m.description}
                        </div>
                      )}
                    </div>

                    {/* Right: Selectable Token Limit + Add to Queue Button */}
                    <div style={{ display: "flex", alignItems: "center", gap: "8px", flexShrink: 0 }}>
                      <div style={{ display: "flex", alignItems: "center", gap: "5px" }}>
                        <span style={{ fontSize: "10.5px", color: "var(--muted)", textTransform: "uppercase", fontWeight: 600 }}>
                          Tokens:
                        </span>
                        <select
                          value={currentTokens || ""}
                          onChange={(e) => {
                            const val = e.target.value ? parseInt(e.target.value, 10) : undefined;
                            setModelMaxTokens((prev) => {
                              const next = { ...prev };
                              if (val) next[m.id] = val;
                              else delete next[m.id];
                              return next;
                            });
                          }}
                          title={`Max output token limit for ${m.name}`}
                          style={{
                            background: "rgba(0,0,0,0.5)",
                            border: `1px solid ${currentTokens ? "var(--primary)" : "var(--border)"}`,
                            borderRadius: "4px",
                            color: currentTokens ? "var(--fg-bright)" : "var(--fg)",
                            fontSize: "11px",
                            padding: "3px 6px",
                            cursor: "pointer",
                          }}
                        >
                          <option value="">Default ({m.maxTokens ? `${(m.maxTokens / 1024).toFixed(0)}k` : "Global"})</option>
                          {BENCHMARK_TOKEN_LIMITS.map((t) => (
                            <option key={t.value} value={t.value}>
                              {t.label}
                            </option>
                          ))}
                        </select>
                      </div>

                      <button
                        type="button"
                        className={`btn btn-xs ${isQueued ? "btn-secondary" : "btn-primary"}`}
                        onClick={() => (isQueued ? handleRemoveFromQueue(m.id) : handleAddToQueue(m.id))}
                        style={{ gap: "4px", padding: "4px 10px", fontSize: "11px" }}
                        title={isQueued ? "Remove from queue" : "Add to benchmark queue"}
                      >
                        {isQueued ? <Check size={11} color="var(--primary)" /> : <Plus size={11} />}
                        {isQueued ? "In Queue" : "Add to Queue"}
                      </button>

                      {/* Reviewer toggle */}
                      {selectedReviewerIds.includes(m.id) ? (
                        <button
                          type="button"
                          className="btn btn-xs"
                          onClick={() => handleToggleReviewerInCatalog(m.id)}
                          style={{
                            padding: "4px 8px",
                            fontSize: "11px",
                            background: "rgba(168, 85, 247, 0.25)",
                            border: "1px solid rgba(168, 85, 247, 0.6)",
                            color: "#c084fc",
                            fontWeight: 700,
                            gap: "3px",
                          }}
                          title={`Assigned to Reviewer slot ${selectedReviewerIds.indexOf(m.id) + 1}. Click to unassign.`}
                        >
                          <Award size={11} /> Rev {selectedReviewerIds.indexOf(m.id) + 1}
                        </button>
                      ) : (
                        <button
                          type="button"
                          className="btn btn-secondary btn-xs"
                          onClick={() => handleToggleReviewerInCatalog(m.id)}
                          style={{
                            padding: "4px 8px",
                            fontSize: "11px",
                            color: "var(--muted)",
                          }}
                          title="Assign this model to the 3-model reviewer panel"
                        >
                          + Reviewer
                        </button>
                      )}

                      {m.isCustom && (
                        <button
                          type="button"
                          title="Delete custom model"
                          onClick={() => handleRemoveCustomModel(m.id)}
                          style={{
                            background: "transparent",
                            border: "none",
                            color: "var(--muted)",
                            cursor: "pointer",
                            padding: "3px",
                            display: "flex",
                            alignItems: "center",
                          }}
                          onMouseEnter={(e) => (e.currentTarget.style.color = "#f87171")}
                          onMouseLeave={(e) => (e.currentTarget.style.color = "var(--muted)")}
                        >
                          <Trash2 size={13} />
                        </button>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      </div>
    );
  };


  const renderRunsSubTab = () => (
    <div style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
      {(!currentDisplaySuite || currentDisplaySuite.runs.length === 0) ? (
        <div
          style={{
            background: "var(--panel)",
            border: "1px dashed var(--border)",
            borderRadius: "8px",
            padding: "36px 24px",
            textAlign: "center",
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            gap: "12px",
          }}
        >
          <Layers size={36} color="var(--primary)" style={{ opacity: 0.8 }} />
          <div style={{ fontSize: "15px", fontWeight: 700, color: "var(--fg-bright)" }}>
            Evaluations Directory is Empty
          </div>
          <div style={{ fontSize: "12px", color: "var(--muted)", maxWidth: "500px", lineHeight: "1.5" }}>
            No benchmark evaluation runs have been recorded in this workspace yet. You can launch multi-model benchmarks in the Benchmark Studio or score your current workspace outputs.
          </div>
          <button
            type="button"
            className="btn btn-primary btn-sm"
            onClick={() => handleSelectSubTab("benchmark")}
            style={{ gap: "6px", marginTop: "8px" }}
          >
            <Cpu size={14} /> Configure Benchmark Run
          </button>
        </div>
      ) : (
        <>
          {/* Evaluations Directory & Comparison Selection Panel */}
      {currentDisplaySuite && currentDisplaySuite.runs.length > 0 && (
        <div
          style={{
            background: "var(--panel)",
            border: "1px solid var(--border)",
            borderRadius: "8px",
            padding: "14px 18px",
            display: "flex",
            flexDirection: "column",
            gap: "12px",
          }}
        >
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: "8px" }}>
            <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
              <span style={{ fontSize: "13px", fontWeight: 700, color: "var(--fg-bright)", textTransform: "uppercase", letterSpacing: "0.5px", display: "flex", alignItems: "center", gap: "6px" }}>
                <Layers size={15} color="var(--primary)" />
                Evaluations Directory ({currentDisplaySuite.runs.length} Runs in Workspace)
              </span>
              <span style={{ fontSize: "11px", color: "var(--muted)" }}>
                &middot; {selectedRunIds.length} of {currentDisplaySuite.runs.length} selected for comparison
              </span>
            </div>

            <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
              <button
                type="button"
                className="btn btn-secondary btn-xs"
                onClick={() => setSelectedRunIds(currentDisplaySuite.runs.map((r) => r.id))}
                disabled={selectedRunIds.length === currentDisplaySuite.runs.length}
              >
                Select All
              </button>
              <button
                type="button"
                className="btn btn-secondary btn-xs"
                onClick={() => setSelectedRunIds([])}
                disabled={selectedRunIds.length === 0}
              >
                Deselect All
              </button>
            </div>
          </div>

          {/* Consolidated List of Evaluation Runs */}
          <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
            {currentDisplaySuite.runs.map((r) => {
              const isSelected = selectedRunIds.includes(r.id);
              const isDeleting = isDeletingRunId === r.id;
              const isExpanded = expandedRunId === r.id;

              return (
                <div
                  key={r.id}
                  style={{
                    background: r.isBaseline ? "rgba(59, 130, 246, 0.05)" : isSelected ? "rgba(59, 130, 246, 0.08)" : "var(--bg)",
                    border: `1px solid ${r.isBaseline ? "rgba(59, 130, 246, 0.4)" : isSelected ? "rgba(59, 130, 246, 0.4)" : "var(--border)"}`,
                    borderRadius: "6px",
                    overflow: "hidden",
                    transition: "all 0.15s ease",
                  }}
                >
                  {/* Single Row: Expand Chevron + Checkbox + Model Info & Telemetry + Score Values + Action Buttons */}
                  <div
                    onClick={() => setExpandedRunId(isExpanded ? null : r.id)}
                    style={{
                      display: "flex",
                      justifyContent: "space-between",
                      alignItems: "center",
                      padding: "8px 12px",
                      cursor: "pointer",
                      gap: "12px",
                      background: isExpanded ? "rgba(59, 130, 246, 0.08)" : "transparent",
                    }}
                  >
                    {/* Left: Expand Chevron, Checkbox & Model Telemetry */}
                    <div style={{ display: "flex", alignItems: "center", gap: "8px", minWidth: 0, flex: 1 }}>
                      <span
                        style={{ color: "var(--muted)", display: "flex", alignItems: "center", flexShrink: 0 }}
                        title={isExpanded ? "Collapse phase telemetry" : "Expand phase telemetry"}
                      >
                        {isExpanded ? <ChevronDown size={15} color="var(--primary)" /> : <ChevronRight size={15} />}
                      </span>

                      <input
                        type="checkbox"
                        checked={isSelected}
                        onClick={(e) => e.stopPropagation()}
                        onChange={() =>
                          setSelectedRunIds((prev) =>
                            prev.includes(r.id) ? prev.filter((id) => id !== r.id) : [...prev, r.id]
                          )
                        }
                        style={{ cursor: "pointer", width: "15px", height: "15px", flexShrink: 0 }}
                        title="Include / Exclude from comparative plots and table"
                      />

                      <div style={{ display: "flex", flexDirection: "column", gap: "2px", minWidth: 0 }}>
                        <div style={{ display: "flex", alignItems: "center", gap: "6px", flexWrap: "wrap" }}>
                          <span style={{ fontSize: "12px", fontWeight: 700, color: isSelected ? "var(--fg-bright)" : "var(--fg)" }}>
                            {r.isBaseline && "⭐ "}
                            {r.model}
                          </span>
                          {r.isBaseline && (
                            <span style={{ fontSize: "9px", fontWeight: 700, padding: "1px 5px", borderRadius: "3px", background: "rgba(59, 130, 246, 0.25)", color: "#60a5fa" }}>
                              BASELINE
                            </span>
                          )}
                          <span style={{ fontSize: "10px", color: "var(--muted)" }}>
                            ({r.iteration ? `Iter ${r.iteration}` : "Run"})
                          </span>
                        </div>
                        <div style={{ fontSize: "10.5px", color: "var(--muted)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                          {new Date(r.timestamp).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" })} &middot; {r.totalDurationSeconds}s &middot; {r.totalTurns} turns &middot; {r.tokenUsage?.totalTokens ? r.tokenUsage.totalTokens.toLocaleString() : 0} tokens
                        </div>
                      </div>
                    </div>

                    {/* Middle: Key Scores Preview */}
                    <div
                      style={{ display: "flex", alignItems: "center", gap: "12px", flexShrink: 0 }}
                      onClick={(e) => e.stopPropagation()}
                    >
                      <div style={{ display: "flex", flexDirection: "column", alignItems: "center" }}>
                        <span style={{ fontSize: "9px", color: "var(--muted)", textTransform: "uppercase" }}>Overall</span>
                        <span style={{ fontSize: "12px", fontWeight: 800, color: (r.scores?.overallBenchmarkScore ?? 0) >= 80 ? "#60a5fa" : "#c084fc" }}>
                          {r.scores?.overallBenchmarkScore ?? "-"}<span style={{ fontSize: "9.5px", color: "var(--muted)" }}>/100</span>
                        </span>
                      </div>

                      <div style={{ display: "flex", flexDirection: "column", alignItems: "center" }}>
                        <span style={{ fontSize: "9px", color: "var(--muted)", textTransform: "uppercase" }}>Manuscript</span>
                        <span style={{ fontSize: "12px", fontWeight: 700, color: "var(--fg-bright)" }}>
                          {r.scores?.overallManuscriptScore ?? "-"}<span style={{ fontSize: "9.5px", color: "var(--muted)" }}>/10</span>
                        </span>
                      </div>

                      <div style={{ display: "flex", flexDirection: "column", alignItems: "center" }}>
                        <span style={{ fontSize: "9px", color: "var(--muted)", textTransform: "uppercase" }}>MCP Tool</span>
                        <span style={{ fontSize: "12px", fontWeight: 700, color: (r.scores?.mcpToolUseScore ?? 0) >= 80 ? "#4ade80" : "#fbbf24" }}>
                          {r.scores?.mcpToolUseScore ?? "-"}%
                        </span>
                      </div>

                      {r.scores?.analyticalFidelityScore !== undefined ? (
                        <div style={{ display: "flex", flexDirection: "column", alignItems: "center" }}>
                          <span style={{ fontSize: "9px", color: "var(--muted)", textTransform: "uppercase" }}>Fidelity</span>
                          <span style={{ fontSize: "12px", fontWeight: 700, color: (r.scores.analyticalFidelityScore ?? 0) >= 80 ? "#4ade80" : "#fbbf24" }}>
                            {r.scores.analyticalFidelityScore}%
                          </span>
                        </div>
                      ) : r.scores?.bioinformaticsIntelligenceScore !== undefined ? (
                        <div style={{ display: "flex", flexDirection: "column", alignItems: "center" }}>
                          <span style={{ fontSize: "9px", color: "var(--muted)", textTransform: "uppercase" }}>Bioinfo</span>
                          <span style={{ fontSize: "12px", fontWeight: 700, color: (r.scores.bioinformaticsIntelligenceScore ?? 0) >= 80 ? "#4ade80" : "#fbbf24" }}>
                            {r.scores.bioinformaticsIntelligenceScore}%
                          </span>
                        </div>
                      ) : null}

                      <span
                        style={{
                          fontSize: "9.5px",
                          fontWeight: 700,
                          padding: "2px 6px",
                          borderRadius: "3px",
                          background: r.status === "completed" ? "rgba(34, 197, 94, 0.15)" : "rgba(239, 68, 68, 0.15)",
                          color: r.status === "completed" ? "#4ade80" : "#f87171",
                          textTransform: "uppercase",
                        }}
                      >
                        {r.status}
                      </span>
                    </div>

                    {/* Right: Actions (Manuscript, Logs, Delete) */}
                    <div
                      style={{ display: "flex", alignItems: "center", gap: "6px", flexShrink: 0 }}
                      onClick={(e) => e.stopPropagation()}
                    >
                      {onOpenFile && (
                        <button
                          type="button"
                          className="btn btn-secondary btn-xs"
                          onClick={() => {
                            const p = r.outputPath ? `${r.outputPath}/manuscript.md` : (r.isBaseline ? "docs/manuscript.md" : "");
                            if (p) onOpenFile(p);
                          }}
                          style={{ gap: "4px" }}
                          title="Open generated manuscript draft"
                        >
                          <FileText size={11} /> Manuscript
                        </button>
                      )}

                      {onOpenFile && (
                        <button
                          type="button"
                          className="btn btn-secondary btn-xs"
                          onClick={() => {
                            const path = r.outputPath ? `${r.outputPath}/logs/pipeline.md` : (r.isBaseline ? "logs/pipeline.md" : "");
                            if (path) onOpenFile(path);
                          }}
                          style={{ gap: "4px" }}
                          title="Open run execution logs summary"
                        >
                          <Terminal size={11} /> Logs
                        </button>
                      )}

                      <button
                        type="button"
                        className="btn btn-secondary btn-xs"
                        onClick={() => handleDeleteRun(r.id)}
                        disabled={isDeleting}
                        style={{
                          gap: "4px",
                          color: "#f87171",
                          borderColor: "rgba(239, 68, 68, 0.3)",
                        }}
                        title="Permanently delete this evaluation run and remove files from disk"
                      >
                        <Trash2 size={11} /> {isDeleting ? "..." : "Delete"}
                      </button>
                    </div>
                  </div>

                  {/* Expanded Telemetry Details (Phase breakdown & notes) */}
                  {isExpanded && (
                    <div style={{ padding: "12px 16px", borderTop: "1px solid var(--border)", display: "flex", flexDirection: "column", gap: "12px", background: "rgba(0, 0, 0, 0.15)" }}>
                      {/* Phase Telemetry Table */}
                      <table className="pipeline-table" style={{ fontSize: "11px" }}>
                        <thead>
                          <tr>
                            <th>Phase</th>
                            <th style={{ textAlign: "right" }}>Time</th>
                            <th style={{ textAlign: "right" }}>Turns</th>
                            <th style={{ textAlign: "right" }}>Input Tokens</th>
                            <th style={{ textAlign: "right" }}>Output Tokens</th>
                            <th style={{ textAlign: "center" }}>MCP Tools</th>
                            <th style={{ textAlign: "center" }}>Status</th>
                            {onOpenFile && <th style={{ textAlign: "center" }}>LLM Logs</th>}
                          </tr>
                        </thead>
                        <tbody>
                          {r.phaseMetrics.map((pm) => {
                            const phaseSlug = pm.fileName ? pm.fileName.replace(/\.md$/i, "").toLowerCase() : `phase_${pm.phaseId}`;
                            const chatPath = r.outputPath ? `${r.outputPath}/logs/${phaseSlug}/chat.md` : (r.isBaseline ? `logs/${phaseSlug}/chat.md` : "");
                            const consolePath = r.outputPath ? `${r.outputPath}/logs/${phaseSlug}/console.log` : (r.isBaseline ? `logs/${phaseSlug}/console.log` : "");

                            return (
                              <tr key={pm.phaseId}>
                                <td>{pm.phaseTitle}</td>
                                <td style={{ textAlign: "right", fontVariantNumeric: "tabular-nums" }}>{pm.durationSeconds}s</td>
                                <td style={{ textAlign: "right", fontVariantNumeric: "tabular-nums" }}>{pm.turns}</td>
                                <td style={{ textAlign: "right", fontVariantNumeric: "tabular-nums", color: "#60a5fa" }}>{pm.tokenUsage.promptTokens.toLocaleString()}</td>
                                <td style={{ textAlign: "right", fontVariantNumeric: "tabular-nums", color: "#34d399" }}>{pm.tokenUsage.completionTokens.toLocaleString()}</td>
                                <td style={{ textAlign: "center" }}>{pm.mcpToolCalls}</td>
                                <td style={{ textAlign: "center" }}>
                                  <span style={{ color: pm.status === "completed" ? "#34d399" : "#f87171", textTransform: "uppercase", fontSize: "10px", fontWeight: 700 }}>
                                    {pm.status}
                                  </span>
                                </td>
                                {onOpenFile && (
                                  <td style={{ textAlign: "center" }}>
                                    <div style={{ display: "inline-flex", gap: "4px" }}>
                                      <button
                                        type="button"
                                        className="btn btn-secondary btn-xs"
                                        onClick={() => onOpenFile(chatPath)}
                                        style={{ padding: "1px 5px", fontSize: "9.5px", gap: "3px" }}
                                        title={`Open LLM Reasoning Trace (${chatPath})`}
                                      >
                                        <FileText size={10} /> Chat
                                      </button>
                                      <button
                                        type="button"
                                        className="btn btn-secondary btn-xs"
                                        onClick={() => onOpenFile(consolePath)}
                                        style={{ padding: "1px 5px", fontSize: "9.5px", gap: "3px" }}
                                        title={`Open Console Log (${consolePath})`}
                                      >
                                        <Terminal size={10} /> Console
                                      </button>
                                    </div>
                                  </td>
                                )}
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>

                      {/* Rigor & Deterministic Verifiers (Rubric v2) */}
                      {r.scores?.verifiers && (
                        <div style={{ display: "flex", flexDirection: "column", gap: "6px", background: "rgba(0,0,0,0.25)", border: "1px solid var(--border)", borderRadius: "6px", padding: "10px 12px" }}>
                          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                            <span style={{ fontSize: "10.5px", fontWeight: 700, color: "var(--fg-bright)", textTransform: "uppercase" }}>
                              Analytical Rigor & Deterministic Verifiers (v{r.scores.rubricVersion || "2.0"})
                            </span>
                            <span style={{ fontSize: "11px", fontWeight: 800, color: (r.scores.analyticalFidelityScore ?? 0) >= 80 ? "#4ade80" : "#fbbf24" }}>
                              Fidelity Score: {r.scores.analyticalFidelityScore ?? r.scores.bioinformaticsIntelligenceScore}/100
                            </span>
                          </div>

                          <div style={{ display: "flex", gap: "8px", flexWrap: "wrap", fontSize: "11px" }}>
                            <span style={{ background: "rgba(255,255,255,0.06)", padding: "2px 6px", borderRadius: "3px" }}>
                              Numeric Fidelity: <b>{r.scores.verifiers.numericFidelity.score !== null ? `${(r.scores.verifiers.numericFidelity.score * 100).toFixed(0)}%` : "N/A"}</b> ({r.scores.verifiers.stats.claimsMatched}/{r.scores.verifiers.stats.claimsExtracted} claims)
                            </span>
                            <span style={{ background: r.scores.verifiers.stats.directionErrors > 0 ? "rgba(239, 68, 68, 0.2)" : "rgba(34, 197, 94, 0.15)", padding: "2px 6px", borderRadius: "3px", color: r.scores.verifiers.stats.directionErrors > 0 ? "#f87171" : "#4ade80" }}>
                              Direction Errors: <b>{r.scores.verifiers.stats.directionErrors}</b>
                            </span>
                            <span style={{ background: r.scores.verifiers.stats.overclaims > 0 ? "rgba(245, 158, 11, 0.2)" : "rgba(255,255,255,0.06)", padding: "2px 6px", borderRadius: "3px", color: r.scores.verifiers.stats.overclaims > 0 ? "#fbbf24" : "var(--fg)" }}>
                              Overclaims (q&gt;0.05): <b>{r.scores.verifiers.stats.overclaims}</b>
                            </span>
                            <span style={{ background: "rgba(255,255,255,0.06)", padding: "2px 6px", borderRadius: "3px" }}>
                              Figures Verified: <b>{r.scores.verifiers.stats.missingFigures === 0 ? "100%" : `${r.scores.verifiers.stats.missingFigures} missing`}</b>
                            </span>
                          </div>

                          {/* Applied Caps */}
                          {r.scores.appliedCaps && r.scores.appliedCaps.length > 0 && (
                            <div style={{ marginTop: "4px", fontSize: "10.5px", color: "#fbbf24", display: "flex", flexDirection: "column", gap: "2px" }}>
                              <span style={{ fontWeight: 700 }}>Caps Triggered:</span>
                              {r.scores.appliedCaps.map((c, i) => (
                                <div key={i} style={{ paddingLeft: "8px" }}>
                                  &bull; <b>{c.dimension}</b> capped at &le;{c.maxAllowed} ({c.reason})
                                </div>
                              ))}
                            </div>
                          )}
                        </div>
                      )}

                      {/* Reviewer Panel (if present) */}
                      {r.scores?.reviewerPanel && r.scores.reviewerPanel.reviewers?.length > 0 && (
                        <div style={{ display: "flex", flexDirection: "column", gap: "6px", background: "rgba(168, 85, 247, 0.08)", border: "1px solid rgba(168, 85, 247, 0.25)", borderRadius: "6px", padding: "10px 12px" }}>
                          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                            <span style={{ fontSize: "10.5px", fontWeight: 700, color: "#c084fc", textTransform: "uppercase" }}>
                              LLM Reviewer Panel ({r.scores.reviewerPanel.completedCount}/{r.scores.reviewerPanel.requestedModels.length} Completed)
                            </span>
                          </div>
                          {r.scores.reviewerPanel.consensusWeaknesses && r.scores.reviewerPanel.consensusWeaknesses.length > 0 && (
                            <div style={{ fontSize: "11px", color: "var(--fg-bright)" }}>
                              <b>Consensus Weaknesses:</b>
                              <ul style={{ margin: "4px 0 0 16px", padding: 0 }}>
                                {r.scores.reviewerPanel.consensusWeaknesses.map((w, idx) => (
                                  <li key={idx}>{w}</li>
                                ))}
                              </ul>
                            </div>
                          )}
                        </div>
                      )}

                      {/* Evaluator Notes */}
                      {r.scores?.rubricNotes && (
                        <div style={{ fontSize: "11.5px", color: "var(--muted)", background: "rgba(0,0,0,0.3)", padding: "8px 12px", borderRadius: "4px" }}>
                          <b>Evaluator Assessment:</b> {r.scores.rubricNotes}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}
        </>
      )}
    </div>
  );


  const renderAnalyticsSubTab = () => (
    <div style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
      {/* Quick Run Filter / Selector Bar */}
      {currentDisplaySuite && currentDisplaySuite.runs.length > 0 && (
        <div
          style={{
            background: "var(--panel)",
            border: "1px solid var(--border)",
            borderRadius: "8px",
            padding: "12px 16px",
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            flexWrap: "wrap",
            gap: "10px",
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: "8px", flexWrap: "wrap" }}>
            <span style={{ fontSize: "11px", fontWeight: 700, color: "var(--fg-bright)", textTransform: "uppercase", letterSpacing: "0.5px" }}>
              Comparing ({selectedRunIds.length} of {currentDisplaySuite.runs.length} runs):
            </span>
            <div style={{ display: "flex", gap: "6px", flexWrap: "wrap", alignItems: "center" }}>
              {currentDisplaySuite.runs.map((r) => {
                const isSelected = selectedRunIds.includes(r.id);
                return (
                  <button
                    key={r.id}
                    type="button"
                    onClick={() =>
                      setSelectedRunIds((prev) =>
                        prev.includes(r.id) ? prev.filter((id) => id !== r.id) : [...prev, r.id]
                      )
                    }
                    style={{
                      background: isSelected ? "rgba(59, 130, 246, 0.2)" : "rgba(0,0,0,0.2)",
                      border: `1px solid ${isSelected ? "var(--primary)" : "var(--border)"}`,
                      borderRadius: "4px",
                      padding: "3px 8px",
                      fontSize: "11px",
                      color: isSelected ? "var(--fg-bright)" : "var(--muted)",
                      cursor: "pointer",
                      display: "inline-flex",
                      alignItems: "center",
                      gap: "5px",
                      fontWeight: isSelected ? 600 : 400,
                    }}
                    title={`Toggle ${r.model} (Iteration ${r.iteration}) in comparative charts`}
                  >
                    <input
                      type="checkbox"
                      checked={isSelected}
                      readOnly
                      style={{ cursor: "pointer", width: "12px", height: "12px", pointerEvents: "none" }}
                    />
                    <span>{r.model.includes("/") ? r.model.split("/")[1] : r.model}</span>
                    {r.isBaseline && <span style={{ color: "#60a5fa", fontSize: "10px" }}>⭐</span>}
                    <span style={{ fontSize: "9.5px", opacity: 0.7 }}>
                      {r.iteration ? `i${r.iteration}` : ""}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>

          <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
            <button
              type="button"
              className="btn btn-secondary btn-xs"
              onClick={() => setSelectedRunIds(currentDisplaySuite.runs.map((r) => r.id))}
              disabled={selectedRunIds.length === currentDisplaySuite.runs.length}
            >
              Select All
            </button>
            <button
              type="button"
              className="btn btn-secondary btn-xs"
              onClick={() => setSelectedRunIds([])}
              disabled={selectedRunIds.length === 0}
            >
              Deselect All
            </button>
            <button
              type="button"
              className="btn btn-secondary btn-xs"
              onClick={() => handleSelectSubTab("runs")}
              style={{ gap: "4px", color: "var(--primary)" }}
              title="Open full evaluations directory with file management and logs"
            >
              <Layers size={11} /> Manage Directory &rarr;
            </button>
          </div>
        </div>
      )}

      {/* Empty Selection Banner */}
      {currentDisplaySuite && currentDisplaySuite.runs.length > 0 && activeAggregated.length === 0 && (
        <div
          style={{
            background: "var(--panel)",
            border: "1px dashed var(--border)",
            borderRadius: "8px",
            padding: "24px",
            textAlign: "center",
            color: "var(--muted)",
            fontSize: "12px",
          }}
        >
          No evaluations currently selected for comparison. Check one or more runs in the Evaluations Directory above to render comparative plots and metrics.
        </div>
      )}

      {/* Comparative Performance Summary Table */}
      {activeAggregated.length > 0 && (
        <div
          style={{
            background: "var(--panel)",
            border: "1px solid var(--border)",
            borderRadius: "8px",
            padding: "14px 18px",
            display: "flex",
            flexDirection: "column",
            gap: "12px",
          }}
        >
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <span style={{ fontSize: "13px", fontWeight: 700, color: "var(--fg-bright)", textTransform: "uppercase", letterSpacing: "0.5px", display: "flex", alignItems: "center", gap: "6px" }}>
              <TrendingUp size={14} color="var(--primary)" />
              Summary of Selected Models Comparison
            </span>
            <span style={{ fontSize: "11px", color: "var(--muted)" }}>
              Computed across {activeRuns.length} selected evaluation run(s)
            </span>
          </div>

          <div className="table-wrapper" style={{ overflowX: "auto" }}>
            <table className="pipeline-table">
              <thead>
                <tr>
                  <th style={{ width: "20%" }}>Model</th>
                  <th style={{ width: "6%", textAlign: "center" }}>Runs</th>
                  <th style={{ width: "8%", textAlign: "right" }}>Avg Time</th>
                  <th style={{ width: "7%", textAlign: "right" }}>Avg Turns</th>
                  <th style={{ width: "11%", textAlign: "right" }}>Avg In Tokens</th>
                  <th style={{ width: "11%", textAlign: "right" }}>Avg Out Tokens</th>
                  <th style={{ width: "9%", textAlign: "center" }}>Manuscript</th>
                  <th style={{ width: "9%", textAlign: "center" }}>MCP Tool Score</th>
                  <th style={{ width: "9%", textAlign: "center" }}>Bioinfo Intel</th>
                  <th style={{ width: "10%", textAlign: "center" }}>Overall Benchmark</th>
                </tr>
              </thead>
              <tbody>
                {activeAggregated.map((agg) => (
                  <tr
                    key={agg.model}
                    style={{
                      background: agg.isBaseline ? "rgba(59, 130, 246, 0.08)" : undefined,
                      borderLeft: agg.isBaseline ? "3px solid #60a5fa" : undefined,
                    }}
                  >
                    <td>
                      <div style={{ fontWeight: 600, color: "var(--fg-bright)", display: "flex", alignItems: "center", gap: "6px", flexWrap: "wrap" }}>
                        {agg.model.includes("/") ? agg.model.split("/")[1] : agg.model}
                        {agg.isBaseline && (
                          <span
                            style={{
                              fontSize: "9.5px",
                              fontWeight: 700,
                              padding: "1px 6px",
                              borderRadius: "3px",
                              background: "rgba(59, 130, 246, 0.25)",
                              color: "#60a5fa",
                              display: "inline-flex",
                              alignItems: "center",
                              gap: "3px",
                            }}
                          >
                            ⭐ BASELINE (CURRENT RUN)
                          </span>
                        )}
                      </div>
                      <div style={{ fontSize: "10px", color: "var(--muted)", textTransform: "uppercase" }}>
                        {agg.provider}
                      </div>
                    </td>
                    <td style={{ textAlign: "center" }}>
                      <span style={{ color: agg.completedRuns > 0 ? "#34d399" : "var(--muted)" }}>
                        {agg.completedRuns}
                      </span>
                      {agg.failedRuns > 0 && <span style={{ color: "#f87171" }}> ({agg.failedRuns} fail)</span>}
                    </td>
                    <td style={{ textAlign: "right", fontVariantNumeric: "tabular-nums" }}>
                      {agg.meanDurationSeconds < 60 ? `${agg.meanDurationSeconds}s` : `${Math.floor(agg.meanDurationSeconds / 60)}m ${agg.meanDurationSeconds % 60}s`}
                    </td>
                    <td style={{ textAlign: "right", fontVariantNumeric: "tabular-nums", color: "var(--primary)" }}>
                      {agg.meanTurns}
                    </td>
                    <td style={{ textAlign: "right", fontVariantNumeric: "tabular-nums", color: "#60a5fa" }}>
                      {agg.meanPromptTokens.toLocaleString()}
                    </td>
                    <td style={{ textAlign: "right", fontVariantNumeric: "tabular-nums", color: "#34d399" }}>
                      {agg.meanCompletionTokens.toLocaleString()}
                    </td>
                    <td style={{ textAlign: "center" }}>
                      <span
                        style={{
                          fontSize: "11px",
                          fontWeight: 700,
                          padding: "2px 8px",
                          borderRadius: "4px",
                          background: "rgba(59, 130, 246, 0.15)",
                          color: "#60a5fa",
                        }}
                      >
                        {agg.meanManuscriptScore} / 10
                      </span>
                    </td>
                    <td style={{ textAlign: "center" }}>
                      <span
                        style={{
                          fontSize: "11px",
                          fontWeight: 700,
                          padding: "2px 8px",
                          borderRadius: "4px",
                          background: agg.meanMcpToolUseScore >= 80 ? "rgba(34, 197, 94, 0.15)" : "rgba(245, 158, 11, 0.15)",
                          color: agg.meanMcpToolUseScore >= 80 ? "#4ade80" : "#fbbf24",
                        }}
                      >
                        {agg.meanMcpToolUseScore}%
                      </span>
                    </td>
                    <td style={{ textAlign: "center" }}>
                      <span
                        style={{
                          fontSize: "11px",
                          fontWeight: 700,
                          padding: "2px 8px",
                          borderRadius: "4px",
                          background: agg.meanBioinformaticsIntelligence >= 80 ? "rgba(168, 85, 247, 0.15)" : "rgba(245, 158, 11, 0.15)",
                          color: agg.meanBioinformaticsIntelligence >= 80 ? "#c084fc" : "#fbbf24",
                        }}
                      >
                        {agg.meanBioinformaticsIntelligence} / 100
                      </span>
                    </td>
                    <td style={{ textAlign: "center" }}>
                      <span
                        style={{
                          fontSize: "12px",
                          fontWeight: 800,
                          padding: "3px 10px",
                          borderRadius: "4px",
                          background: agg.meanOverallScore >= 80 ? "rgba(59, 130, 246, 0.2)" : "rgba(168, 85, 247, 0.2)",
                          color: agg.meanOverallScore >= 80 ? "#60a5fa" : "#c084fc",
                        }}
                      >
                        {agg.meanOverallScore} / 100
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Visual Comparative Grouped Bar Charts */}
      {activeAggregated.length > 0 && (
        <div style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
          {/* Section Header */}
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              flexWrap: "wrap",
              gap: "8px",
            }}
          >
            <div
              style={{
                fontSize: "13px",
                fontWeight: 700,
                color: "var(--fg-bright)",
                textTransform: "uppercase",
                letterSpacing: "0.5px",
                display: "flex",
                alignItems: "center",
                gap: "6px",
              }}
            >
              <BarChart3 size={15} color="var(--primary)" />
              Comparative Multi-Model Benchmark Visualizations
            </div>
            <span style={{ fontSize: "11px", color: "var(--muted)" }}>
              All models clustered per metric &middot; Color bar = LLM
            </span>
          </div>

          {/* Metric Charts Grid: Overall Performance & Scientific Rigor */}
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fit, minmax(460px, 1fr))",
              gap: "16px",
            }}
          >
            {/* Overall Benchmark Metrics */}
            <EvaluationBarChart
              title="Overall Performance Comparison"
              subtitle="Composite metrics across LLMs (Manuscript scaled to % for uniform comparison)"
              categories={overallCategories}
              series={overallSeries}
              yAxisTitle="Score (0 - 100)"
              yAxisRange={[0, 105]}
              height={400}
            />

            {/* Scientific Rigor Dimensions */}
            <EvaluationBarChart
              title="Scientific & Bioinformatics Rigor Dimensions"
              subtitle="5 core manuscript dimensions evaluated via domain rubric (Scale: 1-10)"
              categories={scientificCategories}
              series={scientificSeries}
              yAxisTitle="Score (1 - 10)"
              yAxisRange={[0, 10.5]}
              height={400}
            />
          </div>

          {/* Phase-by-Phase Telemetry Analytics */}
          {phaseCategories.length > 0 && (
            <div
              style={{
                background: "var(--panel)",
                border: "1px solid var(--border)",
                borderRadius: "8px",
                padding: "16px 18px",
                display: "flex",
                flexDirection: "column",
                gap: "14px",
              }}
            >
              <div
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                  flexWrap: "wrap",
                  gap: "10px",
                }}
              >
                <div style={{ display: "flex", flexDirection: "column", gap: "2px" }}>
                  <div
                    style={{
                      fontSize: "13px",
                      fontWeight: 700,
                      color: "var(--fg-bright)",
                      textTransform: "uppercase",
                      letterSpacing: "0.5px",
                      display: "flex",
                      alignItems: "center",
                      gap: "6px",
                    }}
                  >
                    <Clock size={15} color="var(--primary)" />
                    Phase Telemetry Analytics: Model Comparison
                  </div>
                  <span style={{ fontSize: "11px", color: "var(--muted)" }}>
                    Time, Turns, Input Tokens, and Output Tokens plotted with each model for each phase
                  </span>
                </div>

                {/* Sub-tab Telemetry Mode Buttons */}
                <div
                  style={{
                    display: "flex",
                    gap: "4px",
                    background: "rgba(0,0,0,0.35)",
                    padding: "3px",
                    borderRadius: "6px",
                    border: "1px solid var(--border)",
                    flexWrap: "wrap",
                  }}
                >
                  {[
                    { id: "time" as const, label: "⏱ Time (s)" },
                    { id: "turns" as const, label: "🔄 Turns" },
                    { id: "inputTokens" as const, label: "📥 Input Tokens" },
                    { id: "outputTokens" as const, label: "📤 Output Tokens" },
                    { id: "all" as const, label: "📊 All 4 Telemetry Charts" },
                  ].map((m) => {
                    const isActive = telemetryViewMode === m.id;
                    return (
                      <button
                        key={m.id}
                        type="button"
                        onClick={() => setTelemetryViewMode(m.id)}
                        style={{
                          background: isActive ? "rgba(59, 130, 246, 0.25)" : "transparent",
                          color: isActive ? "#93c5fd" : "var(--muted)",
                          border: `1px solid ${isActive ? "var(--primary)" : "transparent"}`,
                          borderRadius: "4px",
                          padding: "4px 10px",
                          fontSize: "11.5px",
                          fontWeight: isActive ? 600 : 500,
                          cursor: "pointer",
                          transition: "all 0.15s ease",
                        }}
                      >
                        {m.label}
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Individual or Grid Telemetry Plots */}
              {telemetryViewMode === "time" && (
                <EvaluationBarChart
                  title="Phase Execution Time (Seconds)"
                  subtitle="Wall-clock duration per pipeline phase across models (color bar = LLM)"
                  categories={phaseCategories}
                  series={timeSeries}
                  yAxisTitle="Time (Seconds)"
                  height={400}
                />
              )}

              {telemetryViewMode === "turns" && (
                <EvaluationBarChart
                  title="Phase Conversational Turns"
                  subtitle="Total LLM conversational iterations and tool reasoning loops per phase (color bar = LLM)"
                  categories={phaseCategories}
                  series={turnsSeries}
                  yAxisTitle="Turn Count"
                  height={400}
                />
              )}

              {telemetryViewMode === "inputTokens" && (
                <EvaluationBarChart
                  title="Input Tokens (Context Window Load) per Phase"
                  subtitle="Cumulative prompt, document, and tool context tokens ingested per phase (color bar = LLM)"
                  categories={phaseCategories}
                  series={inputTokensSeries}
                  yAxisTitle="Input Tokens"
                  height={400}
                />
              )}

              {telemetryViewMode === "outputTokens" && (
                <EvaluationBarChart
                  title="Output Tokens (Model Generation Volume) per Phase"
                  subtitle="Tokens emitted by model for code generation, scientific discourse, and tool payloads (color bar = LLM)"
                  categories={phaseCategories}
                  series={outputTokensSeries}
                  yAxisTitle="Output Tokens"
                  height={400}
                />
              )}

              {telemetryViewMode === "all" && (
                <div
                  style={{
                    display: "grid",
                    gridTemplateColumns: "repeat(auto-fit, minmax(460px, 1fr))",
                    gap: "16px",
                  }}
                >
                  <EvaluationBarChart
                    title="Phase Execution Time (Seconds)"
                    subtitle="Duration per phase across models"
                    categories={phaseCategories}
                    series={timeSeries}
                    yAxisTitle="Time (Seconds)"
                    height={380}
                  />
                  <EvaluationBarChart
                    title="Phase Conversational Turns"
                    subtitle="Turn count per phase across models"
                    categories={phaseCategories}
                    series={turnsSeries}
                    yAxisTitle="Turn Count"
                    height={380}
                  />
                  <EvaluationBarChart
                    title="Input Tokens per Phase"
                    subtitle="Cumulative prompt context tokens"
                    categories={phaseCategories}
                    series={inputTokensSeries}
                    yAxisTitle="Input Tokens"
                    height={380}
                  />
                  <EvaluationBarChart
                    title="Output Tokens per Phase"
                    subtitle="Generated completion tokens"
                    categories={phaseCategories}
                    series={outputTokensSeries}
                    yAxisTitle="Output Tokens"
                    height={380}
                  />
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* Empty Workspace State */}
      {(!currentDisplaySuite || currentDisplaySuite.runs.length === 0) && (
        <div
          style={{
            background: "var(--panel)",
            border: "1px dashed var(--border)",
            borderRadius: "8px",
            padding: "36px 24px",
            textAlign: "center",
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            gap: "12px",
          }}
        >
          <BarChart3 size={36} color="var(--primary)" style={{ opacity: 0.8 }} />
          <div style={{ fontSize: "15px", fontWeight: 700, color: "var(--fg-bright)" }}>
            No Comparative Evaluations Available Yet
          </div>
          <div style={{ fontSize: "12px", color: "var(--muted)", maxWidth: "520px", lineHeight: "1.5" }}>
            Comparative analytics require completed benchmark runs or an active workspace baseline evaluation. Configure and launch a multi-model benchmark suite, or evaluate the current workspace to generate comparative metrics.
          </div>
          <div style={{ display: "flex", gap: "10px", marginTop: "8px" }}>
            <button
              type="button"
              className="btn btn-primary btn-sm"
              onClick={() => handleSelectSubTab("benchmark")}
              style={{ gap: "6px" }}
            >
              <Cpu size={14} /> Open Benchmark Studio
            </button>
            <button
              type="button"
              className="btn btn-secondary btn-sm"
              onClick={() => {
                handleSelectSubTab("review");
                handleScoreCurrentWorkspace();
              }}
              disabled={isScoringCurrent}
              style={{ gap: "6px" }}
            >
              <Award size={14} /> Score Active Workspace
            </button>
          </div>
        </div>
      )}
    </div>
  );


  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        height: "100%",
        overflow: "hidden",
        background: "var(--bg)",
      }}
    >
      {/* Header Banner */}
      <div
        style={{
          background: "var(--panel)",
          borderBottom: "1px solid var(--border)",
          padding: "12px 20px",
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          flexWrap: "wrap",
          gap: "12px",
          flexShrink: 0,
        }}
      >
        <div>
          <h2
            style={{
              margin: 0,
              fontSize: "15px",
              fontWeight: 700,
              color: "var(--fg-bright)",
              display: "flex",
              alignItems: "center",
              gap: "8px",
            }}
          >
            <BarChart3 size={17} color="var(--primary)" />
            AI Evaluation &amp; Multi-Model Benchmark Studio
          </h2>
          <div style={{ fontSize: "11.5px", color: "var(--muted)", marginTop: "2px" }}>
            Autonomous benchmarking across iterations, manuscript scoring rubric, TidyProteomics-MCP telemetry, and comparative plots.
          </div>
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
          <button
            type="button"
            className="btn btn-secondary btn-sm"
            onClick={() => {
              handleSelectSubTab("review");
              handleScoreCurrentWorkspace();
            }}
            disabled={isScoringCurrent}
            title="Score current workspace outputs (manuscript + MCP tool usage) on-demand"
            style={{ gap: "6px" }}
          >
            <Award size={13} color="var(--primary)" />
            {isScoringCurrent ? "Scoring Workspace..." : "Score Current Workspace"}
          </button>
        </div>
      </div>

      {/* Navigation Sub-Tabs Bar: [ Review | Evaluations | Analytics | Benchmarking ] */}
      <div
        style={{
          padding: "8px 20px",
          borderBottom: "1px solid var(--border)",
          background: "var(--tabbar-bg)",
          display: "flex",
          gap: "8px",
          flexShrink: 0,
          alignItems: "center",
          overflowX: "auto",
        }}
      >
        {/* 1. Review Tab (AI Audit + Scientific Audit) */}
        <button
          type="button"
          className="btn btn-sm"
          style={{
            background: activeSubTab === "review" ? "var(--primary)" : "transparent",
            color: activeSubTab === "review" ? "#fff" : "var(--muted)",
            border: activeSubTab === "review" ? "1px solid var(--primary)" : "1px solid var(--border)",
            display: "inline-flex",
            alignItems: "center",
            gap: "6px",
            fontWeight: activeSubTab === "review" ? 600 : 500,
          }}
          onClick={() => handleSelectSubTab("review")}
        >
          <Award size={14} />
          <span>Review</span>
          {currentScoreResult && (
            <span
              style={{
                fontSize: "10px",
                padding: "1px 6px",
                borderRadius: "10px",
                background: activeSubTab === "review" ? "rgba(255,255,255,0.25)" : "var(--border)",
                color: activeSubTab === "review" ? "#fff" : "#60a5fa",
                fontWeight: 700,
              }}
            >
              {currentScoreResult.scores.overallBenchmarkScore}/100
            </span>
          )}
        </button>

        {/* 2. Evaluations Tab */}
        <button
          type="button"
          className="btn btn-sm"
          style={{
            background: activeSubTab === "runs" ? "var(--primary)" : "transparent",
            color: activeSubTab === "runs" ? "#fff" : "var(--muted)",
            border: activeSubTab === "runs" ? "1px solid var(--primary)" : "1px solid var(--border)",
            display: "inline-flex",
            alignItems: "center",
            gap: "6px",
            fontWeight: activeSubTab === "runs" ? 600 : 500,
          }}
          onClick={() => handleSelectSubTab("runs")}
        >
          <Layers size={14} />
          <span>Evaluations</span>
          {(currentDisplaySuite?.runs?.length ?? 0) > 0 && (
            <span
              style={{
                fontSize: "10px",
                padding: "1px 6px",
                borderRadius: "10px",
                background: activeSubTab === "runs" ? "rgba(255,255,255,0.25)" : "var(--border)",
                color: activeSubTab === "runs" ? "#fff" : "var(--fg)",
                fontWeight: 700,
              }}
            >
              {currentDisplaySuite?.runs?.length}
            </span>
          )}
        </button>

        {/* 3. Analytics Tab */}
        <button
          type="button"
          className="btn btn-sm"
          style={{
            background: activeSubTab === "analytics" ? "var(--primary)" : "transparent",
            color: activeSubTab === "analytics" ? "#fff" : "var(--muted)",
            border: activeSubTab === "analytics" ? "1px solid var(--primary)" : "1px solid var(--border)",
            display: "inline-flex",
            alignItems: "center",
            gap: "6px",
            fontWeight: activeSubTab === "analytics" ? 600 : 500,
          }}
          onClick={() => handleSelectSubTab("analytics")}
        >
          <BarChart3 size={14} />
          <span>Analytics</span>
          {activeRuns.length > 0 && (
            <span
              style={{
                fontSize: "10px",
                padding: "1px 6px",
                borderRadius: "10px",
                background: activeSubTab === "analytics" ? "rgba(255,255,255,0.25)" : "var(--border)",
                color: activeSubTab === "analytics" ? "#fff" : "var(--fg)",
                fontWeight: 700,
              }}
            >
              {activeRuns.length}
            </span>
          )}
        </button>

        {/* 4. Benchmarking Tab */}
        <button
          type="button"
          className="btn btn-sm"
          style={{
            background: activeSubTab === "benchmark" ? "var(--primary)" : "transparent",
            color: activeSubTab === "benchmark" ? "#fff" : "var(--muted)",
            border: activeSubTab === "benchmark" ? "1px solid var(--primary)" : "1px solid var(--border)",
            display: "inline-flex",
            alignItems: "center",
            gap: "6px",
            fontWeight: activeSubTab === "benchmark" ? 600 : 500,
          }}
          onClick={() => handleSelectSubTab("benchmark")}
        >
          <Cpu size={14} />
          <span>Benchmarking</span>
          {activeSuite && activeSuite.status === "running" && (
            <span
              style={{
                fontSize: "10px",
                padding: "1px 6px",
                borderRadius: "10px",
                background: "#f59e0b",
                color: "#000",
                fontWeight: 800,
              }}
            >
              RUNNING
            </span>
          )}
        </button>
      </div>

      {/* Active Benchmark Live Running Progress Bar (Persistent across all sub-tabs) */}
      {activeSuite && activeSuite.status === "running" && (() => {
        const totalRuns = Math.max(1, activeSuite.models.length * activeSuite.iterations);
        const completedRuns = activeSuite.runs.length;
        const currentRunNumber = Math.min(totalRuns, completedRuns + 1);
        const suiteProgressPct = Math.round((completedRuns / totalRuns) * 100);
        const activeModelId = activeSuite.activeRun?.model || "";
        const allCatalog = [...availableModels, ...customModels];
        const activeCatalogEntry = allCatalog.find((m) => m.id === activeModelId);
        const activeModelName =
          activeCatalogEntry?.name ||
          (activeModelId.includes("/") ? activeModelId.split("/")[1] : activeModelId) ||
          "Evaluating...";

        const runningPhaseObj = pipelineState?.phases?.find((p) => p.status === "running");
        const activePhaseName =
          activeSuite.activeRun?.phaseTitle ||
          runningPhaseObj?.title ||
          runningPhaseObj?.fileName ||
          "Running pipeline";

        return (
          <div
            style={{
              margin: "12px 20px 0 20px",
              background: "linear-gradient(135deg, rgba(15, 23, 42, 0.95) 0%, rgba(24, 33, 56, 0.88) 100%)",
              border: "1px solid rgba(59, 130, 246, 0.35)",
              boxShadow: "0 6px 24px rgba(0, 0, 0, 0.4), 0 0 1px rgba(59, 130, 246, 0.3)",
              borderRadius: "10px",
              padding: "16px 20px",
              display: "flex",
              flexDirection: "column",
              gap: "14px",
            }}
          >
            {/* Top row: Status Badge, Run Counter & Actions */}
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: "10px" }}>
              <div style={{ display: "flex", alignItems: "center", gap: "10px", flexWrap: "wrap" }}>
                <span
                  style={{
                    display: "inline-flex",
                    alignItems: "center",
                    gap: "7px",
                    background: "rgba(59, 130, 246, 0.15)",
                    border: "1px solid rgba(59, 130, 246, 0.4)",
                    borderRadius: "20px",
                    padding: "3px 12px",
                    fontSize: "11px",
                    fontWeight: 700,
                    color: "#60a5fa",
                    textTransform: "uppercase",
                    letterSpacing: "0.6px",
                  }}
                >
                  <span
                    className="spinner"
                    style={{
                      width: "10px",
                      height: "10px",
                      border: "2px solid #60a5fa",
                      borderTopColor: "transparent",
                      borderRadius: "50%",
                    }}
                  />
                  Benchmark In Progress
                </span>

                <span
                  style={{
                    display: "inline-flex",
                    alignItems: "center",
                    gap: "6px",
                    padding: "3px 10px",
                    borderRadius: "6px",
                    background: "rgba(255, 255, 255, 0.05)",
                    border: "1px solid rgba(255, 255, 255, 0.1)",
                    fontSize: "11.5px",
                    color: "var(--fg-bright)",
                  }}
                >
                  <Layers size={13} color="#94a3b8" />
                  <span>
                    Run <strong style={{ color: "#60a5fa" }}>{currentRunNumber}</strong> of {totalRuns}
                  </span>
                </span>
              </div>

              <button
                type="button"
                className="btn btn-danger btn-xs"
                onClick={handleCancelBenchmark}
                style={{
                  gap: "5px",
                  padding: "5px 12px",
                  fontSize: "11.5px",
                  fontWeight: 600,
                  background: "rgba(239, 68, 68, 0.15)",
                  border: "1px solid rgba(239, 68, 68, 0.4)",
                  color: "#fca5a5",
                }}
                title="Halt active benchmark suite safely"
              >
                <StopCircle size={13} /> Cancel Benchmark
              </button>
            </div>

            {/* Metrics cards grid */}
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))",
                gap: "10px",
              }}
            >
              {/* Card 1: Active Target Model */}
              <div
                style={{
                  background: "rgba(0, 0, 0, 0.25)",
                  border: "1px solid rgba(255, 255, 255, 0.07)",
                  borderRadius: "6px",
                  padding: "10px 12px",
                  display: "flex",
                  flexDirection: "column",
                  gap: "4px",
                }}
              >
                <div style={{ fontSize: "10px", fontWeight: 700, color: "var(--muted)", textTransform: "uppercase", letterSpacing: "0.5px" }}>
                  Active Model
                </div>
                <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
                  <Cpu size={14} color="#60a5fa" style={{ flexShrink: 0 }} />
                  <span
                    style={{
                      fontFamily: "var(--font-mono)",
                      fontSize: "12px",
                      fontWeight: 700,
                      color: "var(--fg-bright)",
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                      whiteSpace: "nowrap",
                    }}
                    title={activeModelId}
                  >
                    {activeModelName}
                  </span>
                </div>
                {activeCatalogEntry?.provider && (
                  <div style={{ fontSize: "10px", color: "var(--muted)", textTransform: "capitalize" }}>
                    Provider: {activeCatalogEntry.provider}
                  </div>
                )}
              </div>

              {/* Card 2: Current Pipeline Stage */}
              <div
                style={{
                  background: "rgba(0, 0, 0, 0.25)",
                  border: "1px solid rgba(255, 255, 255, 0.07)",
                  borderRadius: "6px",
                  padding: "10px 12px",
                  display: "flex",
                  flexDirection: "column",
                  gap: "4px",
                }}
              >
                <div style={{ fontSize: "10px", fontWeight: 700, color: "var(--muted)", textTransform: "uppercase", letterSpacing: "0.5px" }}>
                  Current Phase
                </div>
                <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
                  <span
                    style={{
                      display: "inline-block",
                      width: "8px",
                      height: "8px",
                      borderRadius: "50%",
                      background: "#c084fc",
                      boxShadow: "0 0 6px #c084fc",
                    }}
                  />
                  <span
                    style={{
                      fontSize: "12px",
                      fontWeight: 600,
                      color: "#c084fc",
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                      whiteSpace: "nowrap",
                    }}
                  >
                    {activePhaseName}
                  </span>
                </div>
                <div style={{ fontSize: "10px", color: "var(--muted)" }}>
                  Iteration {activeSuite.activeRun?.iteration || 1} of {activeSuite.iterations}
                </div>
              </div>

              {/* Card 3: Suite Queue & Completed Runs */}
              <div
                style={{
                  background: "rgba(0, 0, 0, 0.25)",
                  border: "1px solid rgba(255, 255, 255, 0.07)",
                  borderRadius: "6px",
                  padding: "10px 12px",
                  display: "flex",
                  flexDirection: "column",
                  gap: "4px",
                }}
              >
                <div style={{ fontSize: "10px", fontWeight: 700, color: "var(--muted)", textTransform: "uppercase", letterSpacing: "0.5px" }}>
                  Suite Queue
                </div>
                <div style={{ fontSize: "12px", fontWeight: 600, color: "var(--fg-bright)" }}>
                  <strong style={{ color: "#34d399" }}>{completedRuns}</strong> / {totalRuns} Runs Complete
                </div>
                <div style={{ fontSize: "10px", color: "var(--muted)" }}>
                  {activeSuite.queue && activeSuite.queue.length > 0
                    ? `${activeSuite.queue.length} model(s) waiting in queue`
                    : "Final model in progress"}
                </div>
              </div>
            </div>

            {/* Overall Suite Progress Bar */}
            <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", fontSize: "11px" }}>
                <span style={{ color: "var(--muted)", fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.5px" }}>
                  Overall Suite Completion
                </span>
                <span style={{ color: "var(--fg-bright)", fontFamily: "var(--font-mono)", fontWeight: 700 }}>
                  {suiteProgressPct}%
                </span>
              </div>
              <div
                style={{
                  width: "100%",
                  height: "7px",
                  background: "rgba(255, 255, 255, 0.08)",
                  borderRadius: "4px",
                  overflow: "hidden",
                }}
              >
                <div
                  style={{
                    width: `${suiteProgressPct}%`,
                    height: "100%",
                    background: "linear-gradient(90deg, #3b82f6, #10b981)",
                    borderRadius: "4px",
                    transition: "width 0.4s ease",
                  }}
                />
              </div>
            </div>
          </div>
        );
      })()}

      {/* Feedback Alerts */}
      {importSuccessMsg && (
        <div
          style={{
            margin: "10px 20px 0 20px",
            background: "rgba(34, 197, 94, 0.12)",
            border: "1px solid rgba(34, 197, 94, 0.35)",
            borderRadius: "6px",
            padding: "10px 14px",
            fontSize: "12px",
            color: "#4ade80",
            display: "flex",
            alignItems: "center",
            gap: "8px",
          }}
        >
          <CheckCircle2 size={15} />
          <span>{importSuccessMsg}</span>
        </div>
      )}

      {errorMsg && (
        <div
          style={{
            margin: "10px 20px 0 20px",
            background: "rgba(239, 68, 68, 0.12)",
            border: "1px solid rgba(239, 68, 68, 0.35)",
            borderRadius: "6px",
            padding: "10px 14px",
            fontSize: "12px",
            color: "#f87171",
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
            <AlertCircle size={15} />
            <span>{errorMsg}</span>
          </div>
          <button
            type="button"
            className="btn btn-secondary btn-xs"
            onClick={() => setErrorMsg(null)}
          >
            Dismiss
          </button>
        </div>
      )}

      {/* Scrollable Sub-Tab Content Area */}
      <div
        style={{
          flex: 1,
          overflowY: "auto",
          padding: "16px 20px",
          display: "flex",
          flexDirection: "column",
          gap: "16px",
        }}
      >
        {activeSubTab === "review" && renderReviewSubTab()}
        {activeSubTab === "runs" && renderRunsSubTab()}
        {activeSubTab === "analytics" && renderAnalyticsSubTab()}
        {activeSubTab === "benchmark" && renderBenchmarkSubTab()}
      </div>
    </div>
  );
};
