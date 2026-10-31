import React, { useEffect, useState } from "react";
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
  Layers,
  ChevronDown,
  ChevronRight,
  ExternalLink,
  Trash2,
  X,
  Plus,
  RefreshCw,
  Check,
} from "lucide-react";
import {
  BenchmarkSuite,
  EvaluationRunSummary,
  EvaluationScoreBreakdown,
  ModelAggregatedPerformance,
  ModelCatalogEntry,
  PhaseTelemetryMetric,
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

export type AIEvaluationSubTab = "analytics" | "runs" | "benchmark" | "workspace";

const STORAGE_ACTIVE_SUBTAB = "tpa_eval_active_subtab_v1";

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
    if (raw === "analytics" || raw === "runs" || raw === "benchmark" || raw === "workspace") {
      return raw;
    }
    return "analytics";
  } catch {
    return "analytics";
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
}

export const AIEvaluationTab: React.FC<AIEvaluationTabProps> = ({ onOpenFile }) => {

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
  const [availableModels, setAvailableModels] = useState<ModelCatalogEntry[]>([]);
  const [customModels, setCustomModels] = useState<ModelCatalogEntry[]>(loadStoredCustomModels);
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

  // Reference baseline run from current workspace
  const [baselineRun, setBaselineRun] = useState<EvaluationRunSummary | null>(null);

  // Suite & historical benchmarks
  const [suites, setSuites] = useState<BenchmarkSuite[]>([]);
  const [activeSuite, setActiveSuite] = useState<BenchmarkSuite | null>(null);
  const [selectedRunIds, setSelectedRunIds] = useState<string[]>([]);
  const [isDeletingRunId, setIsDeletingRunId] = useState<string | null>(null);

  // Sync selected run IDs when suites load
  useEffect(() => {
    if (suites.length > 0 && suites[0]?.runs) {
      setSelectedRunIds((prev) => {
        const allIds = suites[0].runs.map((r) => r.id);
        if (prev.length === 0) return allIds;
        const valid = new Set(allIds);
        const retained = prev.filter((id) => valid.has(id));
        allIds.forEach((id) => {
          if (!prev.includes(id) && !retained.includes(id)) {
            retained.push(id);
          }
        });
        return retained.length > 0 ? retained : allIds;
      });
    }
  }, [suites]);

  // Expanded runs in details view
  const [expandedRunId, setExpandedRunId] = useState<string | null>(null);

  // Per-model max output tokens overrides for evaluation runs
  const [modelMaxTokens, setModelMaxTokens] = useState<Record<string, number>>({});
  const [telemetryViewMode, setTelemetryViewMode] = useState<
    "time" | "turns" | "inputTokens" | "outputTokens" | "all"
  >("time");

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

  // Fetch models for provider without clobbering user selection or custom models
  useEffect(() => {
    fetchApiJson(`/api/evaluation/models?provider=${selectedProvider}`)
      .then((data) => {
        if (data.ok && Array.isArray(data.models)) {
          setAvailableModels(data.models);

          // Check if user already has saved selections for this provider in localStorage
          const stored = loadStoredSelectedModels(selectedProvider);
          if (stored && stored.length > 0) {
            setSelectedModelIds(stored);
            return;
          }

          // Otherwise default to top recommended models
          setSelectedModelIds((prev) => {
            if (prev.length > 0) return prev;
            const recommended = data.models
              .filter((m: ModelCatalogEntry) => m.isRecommended)
              .map((m: ModelCatalogEntry) => m.id);
            const defaults =
              recommended.length > 0
                ? recommended.slice(0, 3)
                : data.models.slice(0, 2).map((m: ModelCatalogEntry) => m.id);
            try {
              localStorage.setItem(
                `${STORAGE_SELECTED_MODELS_PREFIX}${selectedProvider}`,
                JSON.stringify(defaults)
              );
            } catch (_) {}
            return defaults;
          });
        }
      })
      .catch((err) => console.error("Error fetching models:", err));
  }, [selectedProvider]);

  // Fetch experiments and benchmark suites
  const refreshBenchmarks = () => {
    fetchApiJson("/api/evaluation/benchmarks")
      .then((data) => {
        if (data.ok) {
          setSuites(data.suites || []);
          setActiveSuite(data.activeSuite || null);
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
  };

  useEffect(() => {
    refreshBenchmarks();
    const interval = setInterval(refreshBenchmarks, 4000);
    return () => clearInterval(interval);
  }, []);

  const handleSelectProvider = (providerId: string) => {
    setSelectedProvider(providerId);
    try {
      localStorage.setItem(STORAGE_SELECTED_PROVIDER, providerId);
    } catch (_) {}
    const stored = loadStoredSelectedModels(providerId);
    setSelectedModelIds(stored);
  };

  const handleToggleModel = (modelId: string) => {
    setSelectedModelIds((prev) => {
      const next = prev.includes(modelId) ? prev.filter((id) => id !== modelId) : [...prev, modelId];
      try {
        localStorage.setItem(`${STORAGE_SELECTED_MODELS_PREFIX}${selectedProvider}`, JSON.stringify(next));
      } catch (_) {}
      return next;
    });
  };

  const handleRemoveSelectedModel = (modelId: string) => {
    setSelectedModelIds((prev) => {
      const next = prev.filter((id) => id !== modelId);
      try {
        localStorage.setItem(`${STORAGE_SELECTED_MODELS_PREFIX}${selectedProvider}`, JSON.stringify(next));
      } catch (_) {}
      return next;
    });
  };

  const handleSelectAll = (ids: string[]) => {
    setSelectedModelIds(ids);
    try {
      localStorage.setItem(`${STORAGE_SELECTED_MODELS_PREFIX}${selectedProvider}`, JSON.stringify(ids));
    } catch (_) {}
  };

  const handleClearAll = () => {
    setSelectedModelIds([]);
    try {
      localStorage.setItem(`${STORAGE_SELECTED_MODELS_PREFIX}${selectedProvider}`, JSON.stringify([]));
    } catch (_) {}
  };

  const handleSetIterations = (n: number) => {
    setIterations(n);
    try {
      localStorage.setItem(STORAGE_ITERATIONS, String(n));
    } catch (_) {}
  };

  const handleAddCustomModel = () => {
    const trimmed = customModelInput.trim();
    if (!trimmed) return;

    let updatedCustom = [...customModels];
    const existing = [...availableModels, ...customModels].find((m) => m.id === trimmed);
    if (!existing) {
      const newCustom: ModelCatalogEntry = {
        id: trimmed,
        name: trimmed,
        provider: selectedProvider,
        tier: "T2",
        contextWindow: 128000,
        description: `Custom model ID configured for ${selectedProvider}`,
        isCustom: true,
      };
      updatedCustom = [...customModels, newCustom];
      setCustomModels(updatedCustom);
      try {
        localStorage.setItem(STORAGE_CUSTOM_MODELS, JSON.stringify(updatedCustom));
      } catch (_) {}
    }

    if (!selectedModelIds.includes(trimmed)) {
      const nextSelected = [...selectedModelIds, trimmed];
      setSelectedModelIds(nextSelected);
      try {
        localStorage.setItem(
          `${STORAGE_SELECTED_MODELS_PREFIX}${selectedProvider}`,
          JSON.stringify(nextSelected)
        );
      } catch (_) {}
    }
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

    const nextSelected = selectedModelIds.filter((id) => id !== modelId);
    setSelectedModelIds(nextSelected);
    try {
      localStorage.setItem(
        `${STORAGE_SELECTED_MODELS_PREFIX}${selectedProvider}`,
        JSON.stringify(nextSelected)
      );
    } catch (_) {}

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
    if (selectedModelIds.length === 0) {
      setErrorMsg("Please select at least one LLM to benchmark.");
      return;
    }
    setErrorMsg(null);
    setIsLoading(true);

    try {
      const data = await fetchApiJson("/api/evaluation/start", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          provider: selectedProvider,
          models: selectedModelIds,
          modelMaxTokens: Object.fromEntries(
            Object.entries(modelMaxTokens).filter(([id, val]) => selectedModelIds.includes(id) && Boolean(val))
          ),
          iterations,
          experimentPath: selectedExpPath,
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
      const data = await fetchApiJson("/api/evaluation/score-current", { method: "POST" });
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
      });

      time.push({ name: modelDisplayName, values: timeVals, text: timeTexts, color: modelColor });
      turns.push({ name: modelDisplayName, values: turnVals, text: turnTexts, color: modelColor });
      inTok.push({ name: modelDisplayName, values: inTokVals, text: inTokTexts, color: modelColor });
      outTok.push({ name: modelDisplayName, values: outTokVals, text: outTokTexts, color: modelColor });
    });

    return { timeSeries: time, turnsSeries: turns, inputTokensSeries: inTok, outputTokensSeries: outTok };
  }, [activeAggregated, activeRuns, phaseList]);



  const renderWorkspaceSubTab = () => (
    <div style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
      {/* Header Banner */}
      <div
        style={{
          background: "var(--panel)",
          border: "1px solid var(--border)",
          borderRadius: "8px",
          padding: "16px 20px",
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          flexWrap: "wrap",
          gap: "12px",
        }}
      >
        <div>
          <div style={{ fontSize: "14px", fontWeight: 700, color: "var(--fg-bright)", display: "flex", alignItems: "center", gap: "8px" }}>
            <Award size={16} color="var(--primary)" />
            Active Workspace Live Evaluation &amp; Rubric
          </div>
          <div style={{ fontSize: "11.5px", color: "var(--muted)", marginTop: "2px" }}>
            Score the current workspace's manuscript (<code>docs/manuscript.md</code>) and TidyProteomics MCP tool telemetry on-demand using the 5-dimension publication rubric.
          </div>
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
          {onOpenFile && (
            <>
              <button
                type="button"
                className="btn btn-secondary btn-sm"
                onClick={() => onOpenFile("docs/manuscript.md")}
                style={{ gap: "5px" }}
                title="Open docs/manuscript.md"
              >
                <FileText size={12} /> View Manuscript
              </button>
              <button
                type="button"
                className="btn btn-secondary btn-sm"
                onClick={() => onOpenFile("logs/pipeline.md")}
                style={{ gap: "5px" }}
                title="Open logs/pipeline.md"
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
              Active Workspace Live Evaluation Scores
            </span>
            <button
              type="button"
              className="btn btn-secondary btn-xs"
              onClick={() => setCurrentScoreResult(null)}
            >
              Dismiss
            </button>
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "repeat(4, minmax(0, 1fr))", gap: "10px" }}>
            <div style={{ background: "var(--bg)", border: "1px solid var(--border)", borderRadius: "6px", padding: "10px 12px" }}>
              <div style={{ fontSize: "10.5px", color: "var(--muted)", textTransform: "uppercase", fontWeight: 600 }}>Overall Benchmark Score</div>
              <div style={{ fontSize: "20px", fontWeight: 800, color: "#60a5fa", marginTop: "2px" }}>
                {currentScoreResult.scores.overallBenchmarkScore}<span style={{ fontSize: "12px", color: "var(--muted)" }}>/100</span>
              </div>
            </div>
            <div style={{ background: "var(--bg)", border: "1px solid var(--border)", borderRadius: "6px", padding: "10px 12px" }}>
              <div style={{ fontSize: "10.5px", color: "var(--muted)", textTransform: "uppercase", fontWeight: 600 }}>Overall Manuscript Score</div>
              <div style={{ fontSize: "20px", fontWeight: 800, color: "#34d399", marginTop: "2px" }}>
                {currentScoreResult.scores.overallManuscriptScore}<span style={{ fontSize: "12px", color: "var(--muted)" }}>/10</span>
              </div>
            </div>
            <div style={{ background: "var(--bg)", border: "1px solid var(--border)", borderRadius: "6px", padding: "10px 12px" }}>
              <div style={{ fontSize: "10.5px", color: "var(--muted)", textTransform: "uppercase", fontWeight: 600 }}>TidyProteomics-MCP Tool Score</div>
              <div style={{ fontSize: "20px", fontWeight: 800, color: "#f59e0b", marginTop: "2px" }}>
                {currentScoreResult.scores.mcpToolUseScore}<span style={{ fontSize: "12px", color: "var(--muted)" }}>%</span>
              </div>
            </div>
            <div style={{ background: "var(--bg)", border: "1px solid var(--border)", borderRadius: "6px", padding: "10px 12px" }}>
              <div style={{ fontSize: "10.5px", color: "var(--muted)", textTransform: "uppercase", fontWeight: 600 }}>Bioinformatics Intelligence</div>
              <div style={{ fontSize: "20px", fontWeight: 800, color: "#c084fc", marginTop: "2px" }}>
                {currentScoreResult.scores.bioinformaticsIntelligenceScore}<span style={{ fontSize: "12px", color: "var(--muted)" }}>/100</span>
              </div>
            </div>
          </div>

          {/* 5 Manuscript Dimensions Strip */}
          <div style={{ display: "grid", gridTemplateColumns: "repeat(5, minmax(0, 1fr))", gap: "8px" }}>
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
            background: "var(--panel)",
            border: "1px dashed var(--border)",
            borderRadius: "8px",
            padding: "24px 28px",
            display: "flex",
            flexDirection: "column",
            gap: "16px",
          }}
        >
          <div style={{ fontSize: "13px", color: "var(--fg)", lineHeight: "1.6" }}>
            Evaluate the active workspace outputs on-demand without launching a full multi-model benchmark suite. The scoring engine evaluates the following dimensions:
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: "12px" }}>
            <div style={{ background: "var(--bg)", border: "1px solid var(--border)", borderRadius: "6px", padding: "12px 14px" }}>
              <div style={{ fontSize: "12px", fontWeight: 700, color: "#60a5fa", marginBottom: "4px" }}>
                1. 5-Dimension Manuscript Rubric
              </div>
              <div style={{ fontSize: "11px", color: "var(--muted)" }}>
                Evaluates Insights, Clarity, Scientific Rigor, Bioinformatics Rigor, and Actionable Roadmap in <code>docs/manuscript.md</code>.
              </div>
            </div>

            <div style={{ background: "var(--bg)", border: "1px solid var(--border)", borderRadius: "6px", padding: "12px 14px" }}>
              <div style={{ fontSize: "12px", fontWeight: 700, color: "#34d399", marginBottom: "4px" }}>
                2. TidyProteomics-MCP Tool Telemetry
              </div>
              <div style={{ fontSize: "11px", color: "var(--muted)" }}>
                Measures tool invocation accuracy, parameter compliance, and execution success across analysis phases.
              </div>
            </div>

            <div style={{ background: "var(--bg)", border: "1px solid var(--border)", borderRadius: "6px", padding: "12px 14px" }}>
              <div style={{ fontSize: "12px", fontWeight: 700, color: "#f59e0b", marginBottom: "4px" }}>
                3. Bioinformatics Intelligence
              </div>
              <div style={{ fontSize: "11px", color: "var(--muted)" }}>
                Assesses biological interpretation, statistical thresholds, volcano/heatmap choices, and pathway context.
              </div>
            </div>

            <div style={{ background: "var(--bg)", border: "1px solid var(--border)", borderRadius: "6px", padding: "12px 14px" }}>
              <div style={{ fontSize: "12px", fontWeight: 700, color: "#c084fc", marginBottom: "4px" }}>
                4. Reference Baseline Calibration
              </div>
              <div style={{ fontSize: "11px", color: "var(--muted)" }}>
                Establishes the active project run as the reference baseline against which automated benchmarks compare.
              </div>
            </div>
          </div>

          <div style={{ marginTop: "4px" }}>
            <button
              type="button"
              className="btn btn-primary btn-sm"
              onClick={handleScoreCurrentWorkspace}
              disabled={isScoringCurrent}
              style={{ gap: "6px", padding: "8px 16px", fontSize: "13px" }}
            >
              <Award size={15} />
              {isScoringCurrent ? "Evaluating Workspace Artifacts..." : "Score Current Workspace Now"}
            </button>
          </div>
        </div>
      )}
    </div>
  );


  const renderBenchmarkSubTab = () => (
    <div style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
      {/* Benchmark Suite Configuration Panel */}
      <div
        style={{
          background: "var(--panel)",
          border: "1px solid var(--border)",
          borderRadius: "8px",
          padding: "14px 18px",
          display: "flex",
          flexDirection: "column",
          gap: "14px",
        }}
      >
        <div style={{ fontSize: "13px", fontWeight: 700, color: "var(--fg-bright)", textTransform: "uppercase", letterSpacing: "0.5px", display: "flex", alignItems: "center", gap: "6px" }}>
          <Cpu size={14} color="var(--primary)" />
          Configure New Multi-Model Benchmark Run
        </div>

        {/* Provider Selection Tabs */}
        <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
          <label style={{ fontSize: "11px", fontWeight: 600, color: "var(--muted)", textTransform: "uppercase" }}>
            1. Select LLM Provider (One provider at a time)
          </label>
          <div style={{ display: "flex", gap: "8px", flexWrap: "wrap" }}>
            {[
              { id: "openrouter", label: "OpenRouter (Multi-Model)" },
              { id: "anthropic", label: "Anthropic Claude" },
              { id: "openai", label: "OpenAI" },
              { id: "gemini", label: "Google Gemini" },
              { id: "ollama", label: "Ollama (Local Private)" },
            ].map((p) => (
              <button
                key={p.id}
                type="button"
                className={`btn btn-xs ${selectedProvider === p.id ? "btn-primary" : "btn-secondary"}`}
                onClick={() => handleSelectProvider(p.id)}
                style={{ padding: "6px 12px", fontSize: "11.5px" }}
              >
                {p.label}
              </button>
            ))}
          </div>
        </div>

        {/* Experiment Setup & Iterations Selection */}
        <div style={{ display: "grid", gridTemplateColumns: "2fr 1fr", gap: "12px" }}>
          <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <label style={{ fontSize: "11px", fontWeight: 600, color: "var(--muted)", textTransform: "uppercase" }}>
                2. Benchmark Target: Active Completed Project (No HITL Required)
              </label>
              {predefinedExperiments.length > 1 && (
                <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
                  <span style={{ fontSize: "10.5px", color: "var(--muted)" }}>Preset:</span>
                  <select
                    className="select"
                    style={{ fontSize: "11px", padding: "2px 6px" }}
                    value={selectedExpPath}
                    onChange={(e) => setSelectedExpPath(e.target.value)}
                  >
                    {predefinedExperiments.map((exp) => (
                      <option key={exp.id} value={exp.path}>
                        {exp.title}
                      </option>
                    ))}
                  </select>
                </div>
              )}
            </div>

            {/* Active Completed Project Card */}
            {(() => {
              const currentExp =
                predefinedExperiments.find((e) => e.path === selectedExpPath) ||
                predefinedExperiments.find((e) => e.isCurrentWorkspace) ||
                predefinedExperiments[0];

              const isHitlFree = currentExp?.isHitlFreeReady ?? true;
              const hasDownloadedRaw = currentExp?.hasRawDataDownloaded ?? Boolean(currentExp?.rawDataFile);

              return (
                <div
                  style={{
                    background: "rgba(0, 0, 0, 0.25)",
                    border: `1px solid ${isHitlFree ? "rgba(34, 197, 94, 0.3)" : "rgba(245, 158, 11, 0.3)"}`,
                    borderRadius: "6px",
                    padding: "10px 14px",
                    display: "flex",
                    flexDirection: "column",
                    gap: "6px",
                  }}
                >
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: "6px" }}>
                    <span style={{ fontSize: "12px", fontWeight: 700, color: "var(--fg-bright)", display: "flex", alignItems: "center", gap: "6px" }}>
                      <FileText size={13} color="var(--primary)" />
                      {currentExp?.title || "Active Workspace Project (docs/experiment.md)"}
                    </span>
                    <div style={{ display: "flex", alignItems: "center", gap: "6px", flexWrap: "wrap" }}>
                      {hasDownloadedRaw && (
                        <span
                          style={{
                            fontSize: "10px",
                            fontWeight: 700,
                            padding: "2px 6px",
                            borderRadius: "3px",
                            background: "rgba(59, 130, 246, 0.2)",
                            color: "#60a5fa",
                            display: "inline-flex",
                            alignItems: "center",
                            gap: "3px",
                          }}
                          title="Raw data is downloaded locally in data/raw/ and will be reused without re-downloading"
                        >
                          <CheckCircle2 size={10} />
                          Raw Data Staged ({currentExp?.rawDataFile ? currentExp.rawDataFile.split("/").pop() : "data/raw"})
                        </span>
                      )}
                      {isHitlFree ? (
                        <span
                          style={{
                            fontSize: "10px",
                            fontWeight: 700,
                            padding: "2px 6px",
                            borderRadius: "3px",
                            background: "rgba(34, 197, 94, 0.2)",
                            color: "#4ade80",
                            display: "inline-flex",
                            alignItems: "center",
                            gap: "3px",
                          }}
                          title="All Section 3 subtask gates are confirmed. Ready for autonomous headless benchmarking without HITL pauses."
                        >
                          <CheckCircle2 size={10} />
                          No HITL Required
                        </span>
                      ) : (
                        <span
                          style={{
                            fontSize: "10px",
                            fontWeight: 700,
                            padding: "2px 6px",
                            borderRadius: "3px",
                            background: "rgba(245, 158, 11, 0.2)",
                            color: "#fbbf24",
                          }}
                        >
                          HITL Gates Pending
                        </span>
                      )}
                      {onOpenFile && (
                        <button
                          type="button"
                          className="btn btn-secondary btn-xs"
                          onClick={() => onOpenFile(currentExp?.path || "docs/experiment.md")}
                          title="Open experiment design document"
                          style={{ gap: "3px", padding: "1px 6px", fontSize: "10px" }}
                        >
                          <ExternalLink size={10} /> View
                        </button>
                      )}
                    </div>
                  </div>

                  <div style={{ fontSize: "11px", color: "var(--muted)", lineHeight: 1.35 }}>
                    {currentExp?.summary || "Completed proteomics study design configured for autonomous multi-model evaluation starting from downloaded raw data."}
                  </div>

                  {currentExp?.contrasts && currentExp.contrasts.length > 0 && (
                    <div style={{ display: "flex", gap: "6px", alignItems: "center", marginTop: "2px", flexWrap: "wrap" }}>
                      <span style={{ fontSize: "10px", fontWeight: 700, color: "var(--muted)", textTransform: "uppercase" }}>
                        Confirmed Contrasts:
                      </span>
                      {currentExp.contrasts.map((c, i) => (
                        <span
                          key={i}
                          style={{
                            fontSize: "10.5px",
                            fontFamily: "var(--font-mono)",
                            background: "rgba(59, 130, 246, 0.15)",
                            color: "#60a5fa",
                            padding: "1px 6px",
                            borderRadius: "3px",
                          }}
                        >
                          {c}
                        </span>
                      ))}
                    </div>
                  )}
                </div>
              );
            })()}
          </div>

          <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
            <label style={{ fontSize: "11px", fontWeight: 600, color: "var(--muted)", textTransform: "uppercase" }}>
              3. Iterations per Model (N)
            </label>
            <div style={{ display: "flex", gap: "6px" }}>
              {[1, 2, 3, 5].map((n) => (
                <button
                  key={n}
                  type="button"
                  className={`btn btn-xs ${iterations === n ? "btn-primary" : "btn-secondary"}`}
                  onClick={() => handleSetIterations(n)}
                  style={{ flex: 1, padding: "6px 0", fontSize: "12px", fontWeight: 600 }}
                >
                  {n}x
                </button>
              ))}
            </div>
            <div style={{ fontSize: "10.5px", color: "var(--muted)", marginTop: "4px" }}>
              Autonomous executions will run {iterations} time{iterations > 1 ? "s" : ""} per model starting from downloaded raw data.
            </div>
          </div>
        </div>

        {/* Models List for Selected Provider */}
        {(() => {
          const displayedModels = [
            ...availableModels,
            ...customModels.filter((m) => m.provider === selectedProvider),
          ];

          return (
            <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <label style={{ fontSize: "11px", fontWeight: 600, color: "var(--muted)", textTransform: "uppercase" }}>
                  4. Select Models to Benchmark ({selectedModelIds.length} selected &middot; Total Planned Runs: {selectedModelIds.length * iterations})
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

              {/* Custom Model input (at top of Section 4) */}
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
                    <Plus size={12} /> Add Model
                  </button>
                </div>

                {modelActionFeedback && (
                  <div style={{ fontSize: "11px", color: "#4ade80", fontWeight: 600, display: "flex", alignItems: "center", gap: "4px" }}>
                    <Check size={12} />
                    <span>{modelActionFeedback}</span>
                  </div>
                )}
              </div>

              {/* Selected Models Tray / Confirmation Bar */}
              {selectedModelIds.length > 0 && (
                <div
                  style={{
                    background: "rgba(59, 130, 246, 0.08)",
                    border: "1px solid rgba(59, 130, 246, 0.25)",
                    borderRadius: "6px",
                    padding: "8px 12px",
                    display: "flex",
                    flexDirection: "column",
                    gap: "6px",
                  }}
                >
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                    <span style={{ fontSize: "10.5px", fontWeight: 700, color: "#93c5fd", textTransform: "uppercase", letterSpacing: "0.5px" }}>
                      Queued for Benchmark ({selectedModelIds.length} models &middot; {selectedModelIds.length * iterations} runs)
                    </span>
                    <button
                      type="button"
                      className="btn btn-secondary btn-xs"
                      onClick={handleClearAll}
                      style={{ padding: "1px 6px", fontSize: "10px" }}
                    >
                      Clear Selection
                    </button>
                  </div>

                  <div style={{ display: "flex", gap: "6px", flexWrap: "wrap", alignItems: "center" }}>
                    {selectedModelIds.map((id) => {
                      const entry = displayedModels.find((m) => m.id === id);
                      const displayName = entry ? entry.name : id;
                      return (
                        <span
                          key={id}
                          style={{
                            display: "inline-flex",
                            alignItems: "center",
                            gap: "5px",
                            background: "rgba(15, 23, 42, 0.85)",
                            border: "1px solid var(--primary)",
                            borderRadius: "4px",
                            padding: "3px 8px",
                            fontSize: "11px",
                            color: "var(--fg-bright)",
                            fontFamily: "var(--font-mono)",
                          }}
                        >
                          <CheckCircle2 size={12} color="var(--primary)" />
                          <span title={id}>
                            {displayName.includes("/") ? displayName.split("/")[1] : displayName}
                          </span>
                          <select
                            value={modelMaxTokens[id] || ""}
                            onChange={(e) => {
                              const val = e.target.value ? parseInt(e.target.value, 10) : undefined;
                              setModelMaxTokens((prev) => {
                                const next = { ...prev };
                                if (val) next[id] = val;
                                else delete next[id];
                                return next;
                              });
                            }}
                            title="Max output tokens for this model"
                            style={{
                              background: "rgba(0,0,0,0.6)",
                              border: "1px solid var(--border)",
                              borderRadius: "3px",
                              color: "var(--fg-bright)",
                              fontSize: "10px",
                              padding: "1px 4px",
                              cursor: "pointer",
                            }}
                          >
                            <option value="">Default ({entry?.maxTokens ? `${(entry.maxTokens / 1024).toFixed(0)}k` : "Global"})</option>
                            {BENCHMARK_TOKEN_LIMITS.map((t) => (
                              <option key={t.value} value={t.value}>
                                {t.label}
                              </option>
                            ))}
                          </select>
                          <button
                            type="button"
                            onClick={() => handleRemoveSelectedModel(id)}
                            title={`Remove ${id} from benchmark selection`}
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
                        </span>
                      );
                    })}
                  </div>
                </div>
              )}

              {/* Models List: Row-based with Selectable Token Limits */}
              <div
                style={{
                  display: "flex",
                  flexDirection: "column",
                  gap: "6px",
                }}
              >
                {displayedModels.map((m) => {
                  const isSelected = selectedModelIds.includes(m.id);
                  const currentTokens = modelMaxTokens[m.id];
                  return (
                    <div
                      key={m.id}
                      onClick={() => handleToggleModel(m.id)}
                      style={{
                        background: isSelected ? "rgba(59, 130, 246, 0.10)" : "var(--bg)",
                        border: `1px solid ${isSelected ? "var(--primary)" : "var(--border)"}`,
                        borderRadius: "6px",
                        padding: "8px 12px",
                        cursor: "pointer",
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "space-between",
                        gap: "12px",
                        transition: "all 0.15s ease",
                      }}
                    >
                      {/* Left: Checkbox + Name + Tier Badge + Description */}
                      <div style={{ display: "flex", alignItems: "center", gap: "10px", flex: 1, minWidth: 0 }}>
                        {isSelected ? (
                          <CheckCircle2 size={16} color="var(--primary)" style={{ flexShrink: 0 }} />
                        ) : (
                          <Circle size={16} color="var(--muted)" style={{ flexShrink: 0 }} />
                        )}
                        <div style={{ display: "flex", flexDirection: "column", gap: "2px", minWidth: 0, flex: 1 }}>
                          <div style={{ display: "flex", alignItems: "center", gap: "8px", flexWrap: "wrap" }}>
                            <span style={{ fontSize: "12.5px", fontWeight: 600, color: isSelected ? "var(--fg-bright)" : "var(--fg)" }}>
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
                      </div>

                      {/* Right: Selectable Token Limit + Actions */}
                      <div
                        style={{ display: "flex", alignItems: "center", gap: "8px", flexShrink: 0 }}
                        onClick={(e) => e.stopPropagation()}
                      >
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
                              if (!isSelected) {
                                handleToggleModel(m.id);
                              }
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

                        {m.isCustom && (
                          <button
                            type="button"
                            title="Delete custom model"
                            onClick={(e) => {
                              e.stopPropagation();
                              handleRemoveCustomModel(m.id);
                            }}
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
          );
        })()}

        {/* Launch Button */}
        <div style={{ display: "flex", justifyContent: "flex-end", marginTop: "6px" }}>
          <button
            type="button"
            className="btn btn-primary"
            onClick={handleStartBenchmark}
            disabled={selectedModelIds.length === 0 || isLoading || (activeSuite?.status === "running")}
            style={{ gap: "6px", padding: "8px 20px" }}
          >
            <Play size={13} />
            {isLoading
              ? "Starting..."
              : `Execute Benchmark Suite (${selectedModelIds.length} Models &times; ${iterations} Iterations)`}
          </button>
        </div>
      </div>
    </div>
  );


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

                      {r.scores?.bioinformaticsIntelligenceScore !== undefined && (
                        <div style={{ display: "flex", flexDirection: "column", alignItems: "center" }}>
                          <span style={{ fontSize: "9px", color: "var(--muted)", textTransform: "uppercase" }}>Bioinfo</span>
                          <span style={{ fontSize: "12px", fontWeight: 700, color: (r.scores.bioinformaticsIntelligenceScore ?? 0) >= 80 ? "#4ade80" : "#fbbf24" }}>
                            {r.scores.bioinformaticsIntelligenceScore}%
                          </span>
                        </div>
                      )}

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
              xAxisTitle="Score (0 - 100)"
              xAxisRange={[0, 105]}
              height={380}
            />

            {/* Scientific Rigor Dimensions */}
            <EvaluationBarChart
              title="Scientific & Bioinformatics Rigor Dimensions"
              subtitle="5 core manuscript dimensions evaluated via domain rubric (Scale: 1-10)"
              categories={scientificCategories}
              series={scientificSeries}
              xAxisTitle="Score (1 - 10)"
              xAxisRange={[0, 10.5]}
              height={380}
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
                  xAxisTitle="Time (Seconds)"
                  height={380}
                />
              )}

              {telemetryViewMode === "turns" && (
                <EvaluationBarChart
                  title="Phase Conversational Turns"
                  subtitle="Total LLM conversational iterations and tool reasoning loops per phase (color bar = LLM)"
                  categories={phaseCategories}
                  series={turnsSeries}
                  xAxisTitle="Turn Count"
                  height={380}
                />
              )}

              {telemetryViewMode === "inputTokens" && (
                <EvaluationBarChart
                  title="Input Tokens (Context Window Load) per Phase"
                  subtitle="Cumulative prompt, document, and tool context tokens ingested per phase (color bar = LLM)"
                  categories={phaseCategories}
                  series={inputTokensSeries}
                  xAxisTitle="Input Tokens"
                  height={380}
                />
              )}

              {telemetryViewMode === "outputTokens" && (
                <EvaluationBarChart
                  title="Output Tokens (Model Generation Volume) per Phase"
                  subtitle="Tokens emitted by model for code generation, scientific discourse, and tool payloads (color bar = LLM)"
                  categories={phaseCategories}
                  series={outputTokensSeries}
                  xAxisTitle="Output Tokens"
                  height={380}
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
                    xAxisTitle="Time (Seconds)"
                    height={340}
                  />
                  <EvaluationBarChart
                    title="Phase Conversational Turns"
                    subtitle="Turn count per phase across models"
                    categories={phaseCategories}
                    series={turnsSeries}
                    xAxisTitle="Turn Count"
                    height={340}
                  />
                  <EvaluationBarChart
                    title="Input Tokens per Phase"
                    subtitle="Cumulative prompt context tokens"
                    categories={phaseCategories}
                    series={inputTokensSeries}
                    xAxisTitle="Input Tokens"
                    height={340}
                  />
                  <EvaluationBarChart
                    title="Output Tokens per Phase"
                    subtitle="Generated completion tokens"
                    categories={phaseCategories}
                    series={outputTokensSeries}
                    xAxisTitle="Output Tokens"
                    height={340}
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
                handleSelectSubTab("workspace");
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
              handleSelectSubTab("workspace");
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

      {/* Navigation Sub-Tabs Bar */}
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
          <span>Comparative Analytics</span>
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
          <span>Evaluations Directory</span>
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
          <span>Benchmark Studio</span>
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

        <button
          type="button"
          className="btn btn-sm"
          style={{
            background: activeSubTab === "workspace" ? "var(--primary)" : "transparent",
            color: activeSubTab === "workspace" ? "#fff" : "var(--muted)",
            border: activeSubTab === "workspace" ? "1px solid var(--primary)" : "1px solid var(--border)",
            display: "inline-flex",
            alignItems: "center",
            gap: "6px",
            fontWeight: activeSubTab === "workspace" ? 600 : 500,
          }}
          onClick={() => handleSelectSubTab("workspace")}
        >
          <Award size={14} />
          <span>Workspace Evaluation</span>
          {currentScoreResult && (
            <span
              style={{
                fontSize: "10px",
                padding: "1px 6px",
                borderRadius: "10px",
                background: activeSubTab === "workspace" ? "rgba(255,255,255,0.25)" : "var(--border)",
                color: activeSubTab === "workspace" ? "#fff" : "#60a5fa",
                fontWeight: 700,
              }}
            >
              {currentScoreResult.scores.overallBenchmarkScore}/100
            </span>
          )}
        </button>
      </div>

      {/* Active Benchmark Live Running Progress Bar (Persistent across all sub-tabs) */}
      {/* Active Benchmark Live Running Progress Bar */}
      {activeSuite && activeSuite.status === "running" && (
        <div
          style={{
            background: "linear-gradient(135deg, rgba(245, 158, 11, 0.12), rgba(15, 23, 42, 0.5))",
            border: "1px solid rgba(245, 158, 11, 0.4)",
            borderRadius: "8px",
            padding: "14px 18px",
            display: "flex",
            flexDirection: "column",
            gap: "10px",
          }}
        >
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
              <span className="spinner" style={{ width: "14px", height: "14px", border: "2px solid #f59e0b", borderTopColor: "transparent", borderRadius: "50%" }} />
              <span style={{ fontSize: "13px", fontWeight: 700, color: "var(--fg-bright)" }}>
                Benchmark Suite Active: {activeSuite.title}
              </span>
            </div>
            <button
              type="button"
              className="btn btn-danger btn-xs"
              onClick={handleCancelBenchmark}
              style={{ gap: "4px" }}
            >
              <StopCircle size={12} /> Cancel Suite
            </button>
          </div>

          <div style={{ display: "flex", justifyContent: "space-between", fontSize: "12px", color: "var(--muted)" }}>
            <span>
              Current Target: <b style={{ color: "var(--fg-bright)" }}>{activeSuite.activeRun?.model}</b> (Iteration {activeSuite.activeRun?.iteration} of {activeSuite.iterations})
            </span>
            <span>
              Completed Runs: <b style={{ color: "#34d399" }}>{activeSuite.runs.length}</b> / {activeSuite.models.length * activeSuite.iterations}
            </span>
          </div>

          {/* Progress fill */}
          <div style={{ width: "100%", height: "6px", background: "rgba(255,255,255,0.1)", borderRadius: "3px", overflow: "hidden" }}>
            <div
              style={{
                width: `${Math.round((activeSuite.runs.length / Math.max(1, activeSuite.models.length * activeSuite.iterations)) * 100)}%`,
                height: "100%",
                background: "linear-gradient(90deg, #f59e0b, #10b981)",
                transition: "width 0.3s ease",
              }}
            />
          </div>
        </div>
      )}

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
        {activeSubTab === "analytics" && renderAnalyticsSubTab()}
        {activeSubTab === "runs" && renderRunsSubTab()}
        {activeSubTab === "benchmark" && renderBenchmarkSubTab()}
        {activeSubTab === "workspace" && renderWorkspaceSubTab()}
      </div>
    </div>
  );
};
