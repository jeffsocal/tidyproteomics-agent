import React, { useEffect, useRef, useState } from "react";
import {
  Settings,
  FolderOpen,
  Cpu,
  Globe,
  Check,
  RefreshCw,
  Folder,
  Sliders,
  Layers,
  Eye,
  EyeOff,
  Sparkles,
  Award,
  FileText,
  Palette,
  AlertTriangle,
} from "lucide-react";
import { AppConfig, LLMProviderType, LLMTierConfig, McpStatus, PipelineState } from "../types";
import { MultiModelSettingsSection } from "./MultiModelSettingsSection";
import { ThemeToggle } from "./ThemeToggle";

interface SettingsTabProps {
  config?: AppConfig;
  pipelineState?: PipelineState;
  mcpStatus?: McpStatus;
  onUpdateConfig: (patch: Partial<AppConfig>) => Promise<void>;
  onSelectWorkspace: (dir: string) => Promise<void>;
  onInitWorkspace: (
    dir: string,
    pipelineId: "differential_expression" | "quality_control_only"
  ) => Promise<void>;
  onReconnectMcp: () => Promise<void>;
  onOpenPerformanceReview?: () => void;
  initialSection?: "workspace" | "provider" | "mcp";
}

const POWER_OF_TWO_TOKENS = [
  { value: 8192, label: "8K" },
  { value: 16384, label: "16K" },
  { value: 32768, label: "32K" },
  { value: 65536, label: "64K" },
  { value: 131072, label: "128K" },
  { value: 262144, label: "256K" },
  { value: 524288, label: "512K" },
];

export const SettingsTab: React.FC<SettingsTabProps> = ({
  config,
  pipelineState,
  mcpStatus,
  onUpdateConfig,
  onSelectWorkspace,
  onInitWorkspace,
  onReconnectMcp,
  onOpenPerformanceReview,
  initialSection,
}) => {
  const workspaceRef = useRef<HTMLDivElement | null>(null);
  const providerRef = useRef<HTMLDivElement | null>(null);
  const mcpRef = useRef<HTMLDivElement | null>(null);

  // Workspace readiness state
  const hasWorkspace = Boolean(config?.workspaceRoot && config.workspaceRoot.trim().length > 0);
  const needsScaffold =
    hasWorkspace &&
    (Boolean(pipelineState?.isAnalysisMissingOrEmpty) ||
      (pipelineState?.phases || []).length === 0);
  const needsWorkspaceSelect = !hasWorkspace;

  // Provider inputs
  const [provider, setProvider] = useState<LLMProviderType>("anthropic");
  const [model, setModel] = useState("claude-3-7-sonnet-20250219");
  const [apiKey, setApiKey] = useState("");
  const [showApiKey, setShowApiKey] = useState(false);
  const [baseUrl, setBaseUrl] = useState("");
  const [maxTokens, setMaxTokens] = useState<number>(65536);
  const [timeoutSeconds, setTimeoutSeconds] = useState<number>(180);
  const [maxTurns, setMaxTurns] = useState<number>(30);

  // 3-Tier Multi-LLM Role states
  const [multiModelEnabled, setMultiModelEnabled] = useState(true);
  const [tierUtility, setTierUtility] = useState<LLMTierConfig>({ provider: "anthropic", model: "claude-3-5-haiku-20241022" });
  const [tierToolRunner, setTierToolRunner] = useState<LLMTierConfig>({ provider: "anthropic", model: "claude-3-5-sonnet-20241022" });
  const [tierReasoner, setTierReasoner] = useState<LLMTierConfig>({ provider: "anthropic", model: "claude-3-7-sonnet-20250219" });
  const [phaseModels, setPhaseModels] = useState<Record<string, string>>({});

  // MCP & Tools inputs
  const [mcpMode, setMcpMode] = useState<"local" | "docker">("local");
  const [dockerImage, setDockerImage] = useState("jeffsocal/tidyproteomics-mcp:latest");
  const [rscriptPath, setRscriptPath] = useState("Rscript");
  const [searchProvider, setSearchProvider] = useState<"auto" | "tavily" | "brave" | "searxng">("auto");
  const [searchApiKey, setSearchApiKey] = useState("");
  const [searxngUrl, setSearxngUrl] = useState("");

  // Pipeline template selection
  const [pipelineTemplate, setPipelineTemplate] = useState<
    "differential_expression" | "quality_control_only"
  >("differential_expression");

  // Directory browser state
  const dialogRef = useRef<HTMLDialogElement | null>(null);
  const [browseCurrentDir, setBrowseCurrentDir] = useState<string>("");
  const [browseParentDir, setBrowseParentDir] = useState<string>("");
  const [browseFolders, setBrowseFolders] = useState<
    { name: string; fullPath: string; hasPipeline: boolean }[]
  >([]);
  const [browseLoading, setBrowseLoading] = useState(false);
  const [browseError, setBrowseError] = useState<string | null>(null);

  // Feedback states
  const [savedNotice, setSavedNotice] = useState(false);
  const [isInitializing, setIsInitializing] = useState(false);
  const [isReconnecting, setIsReconnecting] = useState(false);

  // Sync state from config prop
  useEffect(() => {
    if (config) {
      setProvider(config.provider || "anthropic");
      setModel(config.model || "claude-3-7-sonnet-20250219");
      setApiKey(config.apiKey || "");
      setBaseUrl(config.baseUrl || "");
      setMaxTokens(config.maxTokens || 65536);
      setTimeoutSeconds(config.timeoutSeconds || 180);
      setMaxTurns(config.maxTurns || 30);
      setMcpMode(config.mcpMode || "local");
      setDockerImage(config.dockerImage || "jeffsocal/tidyproteomics-mcp:latest");
      setRscriptPath(config.rscriptPath || "Rscript");
      setSearchProvider(config.searchProvider || "auto");
      setSearchApiKey(config.searchApiKey || "");
      setSearxngUrl(config.searxngUrl || "");
      setMultiModelEnabled(config.multiModelEnabled ?? true);
      if (config.tierUtility) setTierUtility(config.tierUtility);
      if (config.tierToolRunner) setTierToolRunner(config.tierToolRunner);
      if (config.tierReasoner) setTierReasoner(config.tierReasoner);
      setPhaseModels(config.phaseModels || {});
    }
  }, [config]);

  useEffect(() => {
    if (initialSection === "workspace") {
      workspaceRef.current?.scrollIntoView({ behavior: "smooth" });
    } else if (initialSection === "provider") {
      providerRef.current?.scrollIntoView({ behavior: "smooth" });
    } else if (initialSection === "mcp") {
      mcpRef.current?.scrollIntoView({ behavior: "smooth" });
    }
  }, [initialSection]);

  const handleApplyPreset = (presetKey: string) => {
    switch (presetKey) {
      case "anthropic":
        setProvider("anthropic");
        setModel("claude-3-7-sonnet-20250219");
        setTierUtility({ provider: "anthropic", model: "claude-3-5-haiku-20241022" });
        setTierToolRunner({ provider: "anthropic", model: "claude-3-5-sonnet-20241022" });
        setTierReasoner({ provider: "anthropic", model: "claude-3-7-sonnet-20250219" });
        break;
      case "openai":
        setProvider("openai");
        setModel("o3-mini");
        setTierUtility({ provider: "openai", model: "gpt-4o-mini" });
        setTierToolRunner({ provider: "openai", model: "gpt-4o" });
        setTierReasoner({ provider: "openai", model: "o3-mini" });
        break;
      case "gemini":
        setProvider("gemini");
        setModel("gemini-1.5-pro");
        setTierUtility({ provider: "gemini", model: "gemini-2.0-flash" });
        setTierToolRunner({ provider: "gemini", model: "gemini-2.0-flash" });
        setTierReasoner({ provider: "gemini", model: "gemini-1.5-pro" });
        break;
      case "openrouter":
        setProvider("openrouter");
        setModel("anthropic/claude-3.7-sonnet");
        setTierUtility({ provider: "openrouter", model: "google/gemini-2.0-flash-001" });
        setTierToolRunner({ provider: "openrouter", model: "anthropic/claude-3.5-sonnet" });
        setTierReasoner({ provider: "openrouter", model: "anthropic/claude-3.7-sonnet" });
        break;
      case "ollama":
        setProvider("ollama");
        setModel("deepseek-r1:latest");
        setTierUtility({ provider: "ollama", model: "qwen2.5-coder:7b" });
        setTierToolRunner({ provider: "ollama", model: "qwen2.5-coder:32b" });
        setTierReasoner({ provider: "ollama", model: "deepseek-r1:latest" });
        break;
    }
  };

  const loadBrowseDirectory = async (dir?: string) => {
    setBrowseLoading(true);
    setBrowseError(null);
    try {
      const q = dir ? `?dir=${encodeURIComponent(dir)}` : "";
      const res = await fetch(`/api/workspace/browse${q}`);
      const data = await res.json();
      if (data.ok) {
        setBrowseCurrentDir(data.currentDir);
        setBrowseParentDir(data.parentDir);
        setBrowseFolders(data.folders || []);
      } else {
        setBrowseError(data.error || "Failed to browse host filesystem");
      }
    } catch (err: any) {
      setBrowseError(err.message || "Failed to browse directory");
    } finally {
      setBrowseLoading(false);
    }
  };

  const openWorkspaceModal = () => {
    loadBrowseDirectory(config?.workspaceRoot);
    dialogRef.current?.showModal();
  };

  const handleSaveSettings = async () => {
    await onUpdateConfig({
      provider,
      model,
      apiKey,
      baseUrl,
      maxTokens,
      timeoutSeconds,
      maxTurns,
      mcpMode,
      dockerImage,
      rscriptPath,
      searchProvider,
      searchApiKey,
      searxngUrl,
      multiModelEnabled,
      tierUtility,
      tierToolRunner,
      tierReasoner,
      phaseModels,
    });
    setSavedNotice(true);
    setTimeout(() => setSavedNotice(false), 2500);
  };

  const handleInitPipeline = async () => {
    if (!config?.workspaceRoot) return;
    if (
      !confirm(
        `Initialize ${
          pipelineTemplate === "differential_expression"
            ? "12-Phase Differential Expression"
            : "Quality Control Only"
        } pipeline in "${config.workspaceRoot}"? This configures standard folders (analysis/, code/, data/, docs/) and phase directives.`
      )
    ) {
      return;
    }
    setIsInitializing(true);
    try {
      await onInitWorkspace(config.workspaceRoot, pipelineTemplate);
      setSavedNotice(true);
      setTimeout(() => setSavedNotice(false), 2500);
    } finally {
      setIsInitializing(false);
    }
  };

  const handleReconnect = async () => {
    setIsReconnecting(true);
    try {
      await onReconnectMcp();
    } finally {
      setIsReconnecting(false);
    }
  };

  const defaultModels: Record<LLMProviderType, string[]> = {
    anthropic: ["claude-3-7-sonnet-20250219", "claude-3-5-sonnet-20241022", "claude-3-5-haiku-20241022"],
    gemini: ["gemini-2.0-flash", "gemini-1.5-pro", "gemini-1.5-flash"],
    openai: ["gpt-4o", "gpt-4o-mini", "o3-mini"],
    openrouter: ["anthropic/claude-3.5-sonnet", "google/gemini-2.0-flash-001", "meta-llama/llama-3.3-70b-instruct"],
    ollama: ["llama3.2:latest", "deepseek-r1:latest", "qwen2.5-coder:latest"],
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", overflowY: "auto", background: "var(--bg)" }}>
      {/* Header */}
      <div
        style={{
          padding: "16px 24px",
          borderBottom: "1px solid var(--border)",
          background: "var(--panel-bg)",
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          flexShrink: 0,
        }}
      >
        <div>
          <div style={{ display: "flex", alignItems: "center", gap: "8px", fontSize: "16px", fontWeight: 700, color: "var(--fg-bright)" }}>
            <Settings size={18} color="var(--primary)" />
            <span>Workspace &amp; System Settings</span>
          </div>
          <div style={{ fontSize: "12px", color: "var(--muted)", marginTop: "2px" }}>
            Configure active project workspace, AI inference providers, and persistent MCP R execution environment.
          </div>
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
          <button
            type="button"
            className="btn btn-primary btn-sm"
            onClick={handleSaveSettings}
            style={{ display: "flex", alignItems: "center", gap: "6px" }}
          >
            {savedNotice ? (
              <>
                <Check size={14} /> Saved Successfully!
              </>
            ) : (
              <>
                <Sliders size={14} /> Save All Changes
              </>
            )}
          </button>
        </div>
      </div>

      {/* Main Content Area: Consolidated Single Page */}
      <div style={{ padding: "24px", maxWidth: "960px", width: "100%", margin: "0 auto", display: "flex", flexDirection: "column", gap: "28px" }}>
        {/* SECTION 1: Workspace & Pipeline Template */}
        <div ref={workspaceRef} style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
          <div style={{ display: "flex", alignItems: "center", gap: "8px", borderBottom: "1px solid var(--border)", paddingBottom: "8px" }}>
            <FolderOpen size={16} color="var(--primary)" />
            <h2 style={{ margin: 0, fontSize: "14px", fontWeight: 700, color: "var(--fg-bright)", textTransform: "uppercase", letterSpacing: "0.5px" }}>
              Workspace &amp; Pipeline Template
            </h2>
          </div>

          <div style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
            {/* Theme & Appearance Box */}
            <div className="card" style={{ padding: "16px", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <div>
                <h3 style={{ margin: 0, fontSize: "14px", fontWeight: 700, color: "var(--fg-bright)", display: "flex", alignItems: "center", gap: "6px" }}>
                  <Palette size={15} color="var(--primary)" /> Theme &amp; Color Scheme
                </h3>
                <div style={{ fontSize: "12px", color: "var(--muted)", marginTop: "2px" }}>
                  Select your preferred workspace color mode: Dark, Twilight, Cloudy, Dawn, or Bright.
                </div>
              </div>
              <ThemeToggle />
            </div>

            {/* Active Workspace Box */}
            <div
              className={`card ${needsWorkspaceSelect ? "attention-card-orange" : ""}`}
              style={{
                padding: "16px",
                display: "flex",
                flexDirection: "column",
                gap: "10px",
                border: needsWorkspaceSelect ? undefined : "1px solid var(--border)",
                transition: "all 0.2s ease",
              }}
            >
              {needsWorkspaceSelect && (
                <div
                  className="attention-banner-orange"
                  style={{
                    padding: "8px 12px",
                    display: "flex",
                    alignItems: "center",
                    gap: "8px",
                    fontSize: "12px",
                    color: "var(--attention-orange-light)",
                  }}
                >
                  <AlertTriangle size={15} style={{ flexShrink: 0 }} />
                  <span>
                    <strong>Action Required:</strong> No workspace directory selected. Click <strong>Browse &amp; Switch Directory</strong> to select or create a project folder.
                  </span>
                </div>
              )}

              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <div>
                  <h3 style={{ margin: 0, fontSize: "14px", fontWeight: 700, color: "var(--fg-bright)" }}>
                    Active Project Directory
                  </h3>
                  <div style={{ fontSize: "12px", color: "var(--muted)" }}>
                    Where experimental datasets (<code>data/raw/</code>), pipelines (<code>analysis/</code>), and R scripts reside.
                  </div>
                </div>
                <button
                  type="button"
                  className={`btn ${needsWorkspaceSelect ? "btn-warning" : "btn-secondary"} btn-sm`}
                  onClick={openWorkspaceModal}
                >
                  <FolderOpen size={13} /> Browse &amp; Switch Directory...
                </button>
              </div>

              <div
                style={{
                  background: "var(--bg)",
                  border: "1px solid var(--border)",
                  borderRadius: "6px",
                  padding: "8px 12px",
                  fontFamily: "var(--font-mono)",
                  fontSize: "12px",
                  color: "#60a5fa",
                  wordBreak: "break-all",
                }}
              >
                {config?.workspaceRoot || "(No workspace selected)"}
              </div>
            </div>

            {/* Pipeline Template Setup */}
            <div
              className={`card ${needsScaffold ? "attention-card-orange" : ""}`}
              style={{
                padding: "16px",
                display: "flex",
                flexDirection: "column",
                gap: "14px",
                border: needsScaffold ? undefined : "1px solid var(--border)",
                transition: "all 0.2s ease",
              }}
            >
              {needsScaffold && (
                <div
                  className="attention-banner-orange"
                  style={{
                    padding: "10px 14px",
                    display: "flex",
                    alignItems: "center",
                    gap: "10px",
                    fontSize: "12px",
                    color: "var(--attention-orange-light)",
                  }}
                >
                  <AlertTriangle size={16} style={{ flexShrink: 0 }} />
                  <div>
                    <strong>Action Required: Workspace Uninitialized.</strong> This directory is missing the standard analytical pipeline files. Select a workflow template below and click <strong>Scaffold Template into Project</strong> to generate standard folders (<code>analysis/</code>, <code>code/</code>, <code>data/</code>, <code>docs/</code>) and phase directives.
                  </div>
                </div>
              )}

              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", flexWrap: "wrap", gap: "8px" }}>
                <div>
                  <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                    <h3 style={{ margin: 0, fontSize: "14px", fontWeight: 700, color: "var(--fg-bright)" }}>
                      Pipeline Workflow Template
                    </h3>
                    {needsScaffold && (
                      <span className="badge badge-warning" style={{ fontSize: "10px", fontWeight: 700 }}>
                        ACTION REQUIRED
                      </span>
                    )}
                  </div>
                  <div style={{ fontSize: "12px", color: "var(--muted)", marginTop: "2px" }}>
                    Select an autonomous proteomics analytical protocol to scaffold into this workspace.
                  </div>
                </div>
              </div>

              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "12px" }}>
                <div
                  style={{
                    border: `1px solid ${
                      pipelineTemplate === "differential_expression"
                        ? needsScaffold
                          ? "var(--attention-orange)"
                          : "var(--primary)"
                        : "var(--border)"
                    }`,
                    background:
                      pipelineTemplate === "differential_expression"
                        ? needsScaffold
                          ? "var(--attention-orange-bg)"
                          : "rgba(59, 130, 246, 0.08)"
                        : "var(--card-bg)",
                    borderRadius: "8px",
                    padding: "14px",
                    cursor: "pointer",
                    boxShadow:
                      pipelineTemplate === "differential_expression" && needsScaffold
                        ? "0 0 8px var(--attention-orange-border)"
                        : "none",
                    transition: "all 0.15s ease",
                  }}
                  onClick={() => setPipelineTemplate("differential_expression")}
                >
                  <div style={{ fontWeight: 700, fontSize: "13px", color: "var(--fg-bright)", marginBottom: "4px" }}>
                    🎯 Differential Expression Pipeline
                  </div>
                  <div style={{ fontSize: "11.5px", color: "var(--muted)", lineHeight: 1.45 }}>
                    Full 12-phase pipeline (Phases 00–11): Ingestion, QC, Normalization, Imputation, Linear Modeling, Volcano Plots, Pathway Enrichment, and Manuscript Drafting.
                  </div>
                </div>

                <div
                  style={{
                    border: `1px solid ${
                      pipelineTemplate === "quality_control_only"
                        ? needsScaffold
                          ? "var(--attention-orange)"
                          : "var(--primary)"
                        : "var(--border)"
                    }`,
                    background:
                      pipelineTemplate === "quality_control_only"
                        ? needsScaffold
                          ? "var(--attention-orange-bg)"
                          : "rgba(59, 130, 246, 0.08)"
                        : "var(--card-bg)",
                    borderRadius: "8px",
                    padding: "14px",
                    cursor: "pointer",
                    boxShadow:
                      pipelineTemplate === "quality_control_only" && needsScaffold
                        ? "0 0 8px var(--attention-orange-border)"
                        : "none",
                    transition: "all 0.15s ease",
                  }}
                  onClick={() => setPipelineTemplate("quality_control_only")}
                >
                  <div style={{ fontWeight: 700, fontSize: "13px", color: "var(--fg-bright)", marginBottom: "4px" }}>
                    📊 Quality Control Only Pipeline
                  </div>
                  <div style={{ fontSize: "11.5px", color: "var(--muted)", lineHeight: 1.45 }}>
                    Lean 3-phase inspection protocol (Phases 00–02): Inspect missing values, CV distribution, sample correlations, and produce publication-ready QC figures.
                  </div>
                </div>
              </div>

              <div>
                <button
                  type="button"
                  className={needsScaffold ? "btn btn-warning btn-sm" : "btn btn-success btn-sm"}
                  style={{
                    fontWeight: 700,
                    boxShadow: needsScaffold ? "var(--attention-orange-glow)" : "none",
                  }}
                  onClick={handleInitPipeline}
                  disabled={isInitializing || !config?.workspaceRoot}
                >
                  {isInitializing ? (
                    <>
                      <span className="activity-spinner" style={{ width: 11, height: 11 }} /> Initializing...
                    </>
                  ) : (
                    <>
                      <Sparkles size={13} /> Scaffold Template into Project
                    </>
                  )}
                </button>
              </div>
            </div>
          </div>
        </div>

        {/* SECTION 2: LLM Provider Configuration */}
        <div ref={providerRef} style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
          <div style={{ display: "flex", alignItems: "center", gap: "8px", borderBottom: "1px solid var(--border)", paddingBottom: "8px" }}>
            <Cpu size={16} color="var(--primary)" />
            <h2 style={{ margin: 0, fontSize: "14px", fontWeight: 700, color: "var(--fg-bright)", textTransform: "uppercase", letterSpacing: "0.5px" }}>
              Language Model &amp; Reasoning Provider
            </h2>
          </div>

          <div className="card" style={{ padding: "18px", display: "flex", flexDirection: "column", gap: "16px" }}>
            <div>
              <h3 style={{ margin: 0, fontSize: "14px", fontWeight: 700, color: "var(--fg-bright)" }}>
                Provider &amp; Model Architecture
              </h3>
              <div style={{ fontSize: "12px", color: "var(--muted)" }}>
                Configure the primary inference client and role-specialized models (Utility, Tool Runner, Reasoner).
              </div>
            </div>

            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "14px" }}>
              <div>
                <label className="field-label" style={{ marginBottom: "6px" }}>Provider</label>
                <select
                  className="select"
                  style={{ width: "100%", padding: "7px 10px" }}
                  value={provider}
                  onChange={(e) => {
                    const p = e.target.value as LLMProviderType;
                    setProvider(p);
                    setModel(defaultModels[p][0] || "");
                    setTierUtility((prev) => ({ ...prev, provider: prev.apiKey ? prev.provider : p }));
                    setTierToolRunner((prev) => ({ ...prev, provider: prev.apiKey ? prev.provider : p }));
                    setTierReasoner((prev) => ({ ...prev, provider: prev.apiKey ? prev.provider : p }));
                  }}
                >
                  <option value="anthropic">Anthropic Claude</option>
                  <option value="gemini">Google Gemini</option>
                  <option value="openai">OpenAI</option>
                  <option value="openrouter">OpenRouter</option>
                  <option value="ollama">Ollama (Local)</option>
                </select>
              </div>

              <div>
                <label className="field-label" style={{ marginBottom: "6px" }}>Model Identifier</label>
                <input
                  type="text"
                  className="input"
                  style={{ width: "100%", padding: "7px 10px" }}
                  value={model}
                  onChange={(e) => setModel(e.target.value)}
                  placeholder="e.g. claude-3-7-sonnet-20250219"
                />
                <div style={{ display: "flex", gap: "4px", marginTop: "6px", flexWrap: "wrap" }}>
                  {(defaultModels[provider] || []).map((m) => (
                    <button
                      key={m}
                      type="button"
                      className="file-pill"
                      style={{ fontSize: "10px", padding: "1px 6px" }}
                      onClick={() => setModel(m)}
                    >
                      {m}
                    </button>
                  ))}
                </div>
              </div>
            </div>

            <div>
              <label className="field-label" style={{ marginBottom: "6px" }}>
                API Key {provider === "ollama" ? "(Optional for local Ollama)" : "(Required)"}
              </label>
              <div style={{ display: "flex", gap: "6px" }}>
                <input
                  type={showApiKey ? "text" : "password"}
                  className="input"
                  style={{ flex: 1, padding: "7px 10px" }}
                  placeholder={`Enter your ${provider.toUpperCase()} API Key...`}
                  value={apiKey}
                  onChange={(e) => setApiKey(e.target.value)}
                />
                <button
                  type="button"
                  className="btn btn-secondary btn-sm"
                  onClick={() => setShowApiKey(!showApiKey)}
                  title={showApiKey ? "Hide Key" : "Show Key"}
                >
                  {showApiKey ? <EyeOff size={13} /> : <Eye size={13} />}
                </button>
              </div>
            </div>

            <div>
              <label className="field-label" style={{ marginBottom: "6px" }}>
                Custom Base URL (Optional / Proxies / Local Endpoints)
              </label>
              <input
                type="text"
                className="input"
                style={{ width: "100%", padding: "7px 10px" }}
                placeholder={provider === "ollama" ? "http://localhost:11434" : "https://api.openai.com/v1"}
                value={baseUrl}
                onChange={(e) => setBaseUrl(e.target.value)}
              />
            </div>

            {/* 3-Tier Multi-LLM Role Configuration */}
            <MultiModelSettingsSection
              multiModelEnabled={multiModelEnabled}
              onToggleMultiModel={setMultiModelEnabled}
              tierUtility={tierUtility}
              onUpdateTierUtility={(patch) => setTierUtility((prev) => ({ ...prev, ...patch }))}
              tierToolRunner={tierToolRunner}
              onUpdateTierToolRunner={(patch) => setTierToolRunner((prev) => ({ ...prev, ...patch }))}
              tierReasoner={tierReasoner}
              onUpdateTierReasoner={(patch) => setTierReasoner((prev) => ({ ...prev, ...patch }))}
              primaryProvider={provider}
              onApplyPreset={handleApplyPreset}
              phaseModels={phaseModels}
              onUpdatePhaseModel={(phaseId, model) => {
                setPhaseModels((prev) => {
                  const copy = { ...prev };
                  if (!model) {
                    delete copy[phaseId];
                  } else {
                    copy[phaseId] = model;
                  }
                  return copy;
                });
              }}
            />

            {/* Advanced Tuning Grid */}
            <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: "12px", borderTop: "1px solid var(--border)", paddingTop: "14px" }}>
              <div>
                <label className="field-label" style={{ marginBottom: "6px" }}>Max Output Tokens</label>
                <select
                  className="select"
                  style={{ width: "100%", padding: "7px 10px" }}
                  value={maxTokens}
                  onChange={(e) => setMaxTokens(Number(e.target.value))}
                >
                  {POWER_OF_TWO_TOKENS.map((p) => (
                    <option key={p.value} value={p.value}>
                      {p.label}
                    </option>
                  ))}
                  {!POWER_OF_TWO_TOKENS.some((p) => p.value === maxTokens) && (
                    <option value={maxTokens}>
                      {maxTokens.toLocaleString()}
                    </option>
                  )}
                </select>
              </div>

              <div>
                <label className="field-label" style={{ marginBottom: "6px" }}>Request Timeout (sec)</label>
                <input
                  type="number"
                  className="input"
                  style={{ width: "100%", padding: "7px 10px" }}
                  value={timeoutSeconds}
                  onChange={(e) => setTimeoutSeconds(Number(e.target.value))}
                />
              </div>

              <div>
                <label className="field-label" style={{ marginBottom: "6px" }}>Max Turns Per Phase</label>
                <input
                  type="number"
                  className="input"
                  style={{ width: "100%", padding: "7px 10px" }}
                  value={maxTurns}
                  onChange={(e) => setMaxTurns(Number(e.target.value))}
                />
              </div>
            </div>

            <div style={{ display: "flex", justifyContent: "flex-end", marginTop: "6px" }}>
              <button type="button" className="btn btn-primary btn-sm" onClick={handleSaveSettings}>
                {savedNotice ? (
                  <>
                    <Check size={13} /> Saved!
                  </>
                ) : (
                  "Save Provider Settings"
                )}
              </button>
            </div>
          </div>
        </div>

        {/* SECTION 3: MCP Engine & Web Search */}
        <div ref={mcpRef} style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
          <div style={{ display: "flex", alignItems: "center", gap: "8px", borderBottom: "1px solid var(--border)", paddingBottom: "8px" }}>
            <Layers size={16} color="var(--primary)" />
            <h2 style={{ margin: 0, fontSize: "14px", fontWeight: 700, color: "var(--fg-bright)", textTransform: "uppercase", letterSpacing: "0.5px" }}>
              MCP Engine &amp; Web Search
            </h2>
          </div>

          <div style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
            {/* MCP Section */}
            {(() => {
              const needsMcpReconnect = Boolean(!mcpStatus?.connected);
              return (
                <div
                  className={`card ${needsMcpReconnect ? "attention-card-orange" : ""}`}
                  style={{
                    padding: "18px",
                    display: "flex",
                    flexDirection: "column",
                    gap: "16px",
                    border: needsMcpReconnect ? undefined : "1px solid var(--border)",
                    transition: "all 0.2s ease",
                  }}
                >
                  {needsMcpReconnect && (
                    <div
                      className="attention-banner-orange"
                      style={{
                        padding: "10px 14px",
                        display: "flex",
                        alignItems: "center",
                        gap: "10px",
                        fontSize: "12px",
                        color: "var(--attention-orange-light)",
                      }}
                    >
                      <AlertTriangle size={16} style={{ flexShrink: 0 }} />
                      <div>
                        <strong>Action Required: Model Context Protocol (MCP) R Session Disconnected.</strong> The persistent background R Daemon executing <code>tidyproteomics</code> commands is offline. Click <strong>Reconnect</strong> to initialize or re-bind the MCP engine.
                      </div>
                    </div>
                  )}

                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: "8px" }}>
                    <div>
                      <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                        <h3 style={{ margin: 0, fontSize: "14px", fontWeight: 700, color: "var(--fg-bright)" }}>
                          Model Context Protocol (MCP) R Session
                        </h3>
                        {needsMcpReconnect && (
                          <span className="badge badge-warning" style={{ fontSize: "10px", fontWeight: 700 }}>
                            ACTION REQUIRED
                          </span>
                        )}
                      </div>
                      <div style={{ fontSize: "12px", color: "var(--muted)", marginTop: "2px" }}>
                        In-memory persistent R engine executing tidyproteomics commands.
                      </div>
                    </div>

                    <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                      <span
                        className={`badge ${mcpStatus?.connected ? "badge-completed" : "badge-failed"}`}
                        style={{ fontSize: "10px" }}
                      >
                        {mcpStatus?.connected
                          ? `Connected (${mcpStatus.toolsCount} tools)`
                          : "Disconnected"}
                      </span>
                      <button
                        type="button"
                        className={needsMcpReconnect ? "btn btn-warning btn-xs" : "btn btn-secondary btn-xs"}
                        style={{
                          fontWeight: 700,
                          boxShadow: needsMcpReconnect ? "var(--attention-orange-glow)" : "none",
                        }}
                        onClick={handleReconnect}
                        disabled={isReconnecting}
                      >
                        <RefreshCw size={11} className={isReconnecting ? "activity-spinner" : ""} /> {isReconnecting ? "Reconnecting..." : "Reconnect"}
                      </button>
                    </div>
                  </div>

                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "14px" }}>
                    <div>
                      <label className="field-label" style={{ marginBottom: "6px" }}>Execution Mode</label>
                      <select
                        className="select"
                        style={{ width: "100%", padding: "7px 10px" }}
                        value={mcpMode}
                        onChange={(e) => setMcpMode(e.target.value as "local" | "docker")}
                      >
                        <option value="local">Local Native R Daemon</option>
                        <option value="docker">Docker Container Sandbox</option>
                      </select>
                    </div>

                    {mcpMode === "docker" ? (
                      <div>
                        <label className="field-label" style={{ marginBottom: "6px" }}>Docker Image Tag</label>
                        <input
                          type="text"
                          className="input"
                          style={{ width: "100%", padding: "7px 10px" }}
                          value={dockerImage}
                          onChange={(e) => setDockerImage(e.target.value)}
                        />
                      </div>
                    ) : (
                      <div>
                        <label className="field-label" style={{ marginBottom: "6px" }}>Rscript Executable Path</label>
                        <input
                          type="text"
                          className="input"
                          style={{ width: "100%", padding: "7px 10px" }}
                          value={rscriptPath}
                          onChange={(e) => setRscriptPath(e.target.value)}
                          placeholder="Rscript or /usr/local/bin/Rscript"
                        />
                      </div>
                    )}
                  </div>
                </div>
              );
            })()}

            {/* Web Search Section */}
            <div className="card" style={{ padding: "18px", display: "flex", flexDirection: "column", gap: "16px" }}>
              <div>
                <h3 style={{ margin: 0, fontSize: "14px", fontWeight: 700, color: "var(--fg-bright)" }}>
                  Web Search &amp; Literature Ingestion
                </h3>
                <div style={{ fontSize: "12px", color: "var(--muted)" }}>
                  Enables live retrieval of PubMed, bioRxiv, and proteomics benchmarks.
                </div>
              </div>

              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "14px" }}>
                <div>
                  <label className="field-label" style={{ marginBottom: "6px" }}>Search Provider</label>
                  <select
                    className="select"
                    style={{ width: "100%", padding: "7px 10px" }}
                    value={searchProvider}
                    onChange={(e) => setSearchProvider(e.target.value as any)}
                  >
                    <option value="auto">Auto (PubMed / CrossRef Fallback)</option>
                    <option value="tavily">Tavily AI Search</option>
                    <option value="brave">Brave Search API</option>
                    <option value="searxng">SearXNG (Self-Hosted)</option>
                  </select>
                </div>

                {searchProvider === "searxng" ? (
                  <div>
                    <label className="field-label" style={{ marginBottom: "6px" }}>SearXNG Endpoint URL</label>
                    <input
                      type="text"
                      className="input"
                      style={{ width: "100%", padding: "7px 10px" }}
                      value={searxngUrl}
                      onChange={(e) => setSearxngUrl(e.target.value)}
                      placeholder="http://localhost:8080"
                    />
                  </div>
                ) : (
                  <div>
                    <label className="field-label" style={{ marginBottom: "6px" }}>Search API Key</label>
                    <input
                      type="password"
                      className="input"
                      style={{ width: "100%", padding: "7px 10px" }}
                      value={searchApiKey}
                      onChange={(e) => setSearchApiKey(e.target.value)}
                      placeholder="Optional for PubMed / required for Tavily or Brave"
                    />
                  </div>
                )}
              </div>

              <div style={{ display: "flex", justifyContent: "flex-end" }}>
                <button type="button" className="btn btn-primary btn-sm" onClick={handleSaveSettings}>
                  {savedNotice ? "✓ Saved" : "Apply Engine & Tool Settings"}
                </button>
              </div>
            </div>
          </div>
        </div>

        {/* Bottom Save All Changes Bar */}
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            padding: "16px 20px",
            background: "var(--panel-bg)",
            border: "1px solid var(--border)",
            borderRadius: "8px",
            marginTop: "10px",
          }}
        >
          <div style={{ fontSize: "12px", color: "var(--muted)" }}>
            Review all workspace, LLM model tier, and MCP execution settings above.
          </div>
          <button
            type="button"
            className="btn btn-primary btn-sm"
            onClick={handleSaveSettings}
            style={{ display: "flex", alignItems: "center", gap: "6px" }}
          >
            {savedNotice ? (
              <>
                <Check size={14} /> Saved Successfully!
              </>
            ) : (
              <>
                <Sliders size={14} /> Save All Changes
              </>
            )}
          </button>
        </div>
      </div>

      {/* Directory Browser Modal */}
      <dialog
        ref={dialogRef}
        style={{
          background: "var(--panel-bg)",
          color: "var(--fg)",
          border: "1px solid var(--border-strong)",
          borderRadius: "8px",
          padding: "16px",
          width: "560px",
          maxWidth: "92vw",
          boxShadow: "0 10px 30px rgba(0, 0, 0, 0.7)",
        }}
      >
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "12px" }}>
          <h3 style={{ margin: 0, fontSize: "14px", fontWeight: 700, display: "flex", alignItems: "center", gap: "6px" }}>
            <FolderOpen size={16} /> Select Workspace Directory
          </h3>
          <button type="button" className="btn btn-secondary btn-xs" onClick={() => dialogRef.current?.close()}>
            Close
          </button>
        </div>

        <div style={{ fontSize: "11px", color: "var(--muted)", marginBottom: "8px" }}>
          Current: <code style={{ color: "#60a5fa" }}>{browseCurrentDir}</code>
        </div>

        <div style={{ display: "flex", gap: "6px", marginBottom: "10px" }}>
          {browseParentDir && (
            <button
              type="button"
              className="btn btn-secondary btn-xs"
              onClick={() => loadBrowseDirectory(browseParentDir)}
              disabled={browseLoading}
            >
              ⬆ Up to Parent
            </button>
          )}
          <button
            type="button"
            className="btn btn-primary btn-xs"
            onClick={async () => {
              if (browseCurrentDir) {
                dialogRef.current?.close();
                await onSelectWorkspace(browseCurrentDir);
              }
            }}
          >
            Select Current Folder
          </button>
        </div>

        {browseError && (
          <div style={{ color: "var(--error)", fontSize: "11px", marginBottom: "8px" }}>
            {browseError}
          </div>
        )}

        <div
          style={{
            maxHeight: "260px",
            overflowY: "auto",
            border: "1px solid var(--border)",
            borderRadius: "4px",
            background: "var(--bg)",
          }}
        >
          {browseLoading ? (
            <div style={{ padding: "16px", textAlign: "center", color: "var(--muted)", fontSize: "12px" }}>
              Loading directories...
            </div>
          ) : browseFolders.length === 0 ? (
            <div style={{ padding: "16px", textAlign: "center", color: "var(--muted)", fontSize: "12px" }}>
              No subdirectories found
            </div>
          ) : (
            browseFolders.map((f) => (
              <div
                key={f.fullPath}
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  padding: "6px 10px",
                  borderBottom: "1px solid var(--border)",
                  cursor: "pointer",
                  fontSize: "12px",
                }}
                onClick={() => loadBrowseDirectory(f.fullPath)}
              >
                <span style={{ display: "inline-flex", alignItems: "center", gap: "6px" }}>
                  <Folder size={13} color="var(--primary)" />
                  {f.name}
                </span>
                {f.hasPipeline && (
                  <span className="badge badge-completed" style={{ fontSize: "9px" }}>
                    Pipeline
                  </span>
                )}
              </div>
            ))
          )}
        </div>
      </dialog>
    </div>
  );
};

