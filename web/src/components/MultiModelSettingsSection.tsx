import React, { useState } from "react";
import {
  Cpu,
  Zap,
  Layers,
  Sparkles,
  ChevronDown,
  ChevronRight,
  ShieldCheck,
  Globe,
  Sliders,
  Check,
  RotateCcw,
} from "lucide-react";
import { LLMProviderType, LLMTierConfig } from "../types";
import { TierSuggestionModal } from "./TierSuggestionModal";

export interface PhaseDefinitionInfo {
  id: string;
  name: string;
  description: string;
  defaultTier: "utility" | "toolRunner" | "reasoner";
}

export const STANDARD_PHASES: PhaseDefinitionInfo[] = [
  { id: "01", name: "01_INSPECT", description: "Data Ingestion & Exploratory Quality Inspection", defaultTier: "utility" },
  { id: "02", name: "02_NORMALIZE", description: "Quantitative Normalization & Batch Inspection", defaultTier: "utility" },
  { id: "03", name: "03_IMPUTE", description: "Missing Value Imputation Strategy", defaultTier: "utility" },
  { id: "04", name: "04_EXPRESSION", description: "Differential Expression Analytics & Linear Modeling", defaultTier: "toolRunner" },
  { id: "05", name: "05_ENRICHMENT", description: "Functional Pathway Enrichment Analysis", defaultTier: "toolRunner" },
  { id: "06", name: "06_OBSERVATIONS", description: "Data-Derived Observations & Candidate Extraction", defaultTier: "toolRunner" },
  { id: "07", name: "07_KNOWLEDGE", description: "Biomedical Knowledge Integration & Literature Queries", defaultTier: "reasoner" },
  { id: "08", name: "08_LITERATURE", description: "Scientific Literature Retrieval", defaultTier: "toolRunner" },
  { id: "09", name: "09_WEBSEARCH", description: "Targeted Web Search & Ontology Cross-Check", defaultTier: "toolRunner" },
  { id: "10", name: "10_FIGURES", description: "Publication-Grade Visualization & Figure Generation", defaultTier: "toolRunner" },
  { id: "11", name: "11_SYNTHESIS", description: "Final Manuscript Synthesis & Reproducibility Audit", defaultTier: "reasoner" },
  { id: "12", name: "12_INTEGRITY", description: "Data-Grounded Integrity Review & Defect Correction", defaultTier: "reasoner" },
  { id: "13", name: "13_CRITIQUE", description: "Scientific Critique & Argument Strengthening", defaultTier: "reasoner" },
];

interface MultiModelSettingsSectionProps {
  multiModelEnabled: boolean;
  onToggleMultiModel: (enabled: boolean) => void;
  tierUtility: LLMTierConfig;
  onUpdateTierUtility: (patch: Partial<LLMTierConfig>) => void;
  tierToolRunner: LLMTierConfig;
  onUpdateTierToolRunner: (patch: Partial<LLMTierConfig>) => void;
  tierReasoner: LLMTierConfig;
  onUpdateTierReasoner: (patch: Partial<LLMTierConfig>) => void;
  primaryProvider: LLMProviderType;
  onApplyPreset: (presetKey: string) => void;
  phaseModels?: Record<string, string>;
  onUpdatePhaseModel?: (phaseId: string, model: string | null) => void;
}

const TIER_SUGGESTIONS: Record<
  "utility" | "toolRunner" | "reasoner",
  Record<LLMProviderType, string[]>
> = {
  utility: {
    anthropic: ["claude-3-5-haiku-20241022", "claude-3-haiku-20240307"],
    openai: ["gpt-4o-mini", "gpt-3.5-turbo"],
    gemini: ["gemini-2.0-flash", "gemini-1.5-flash"],
    openrouter: [
      "openai/gpt-oss-120b",
      "google/gemini-2.0-flash-001",
      "anthropic/claude-haiku-5.5",
      "meta-llama/llama-3.3-70b-instruct",
    ],
    ollama: ["qwen2.5-coder:7b", "llama3.2:latest"],
  },
  toolRunner: {
    anthropic: ["claude-3-5-sonnet-20241022", "claude-3-7-sonnet-20250219"],
    openai: ["gpt-4o", "gpt-4o-2024-11-20"],
    gemini: ["gemini-2.0-flash", "gemini-1.5-pro"],
    openrouter: [
      "anthropic/claude-haiku-5.5",
      "anthropic/claude-3.5-sonnet",
      "openai/gpt-4o",
      "google/gemini-2.0-flash-001",
    ],
    ollama: ["qwen2.5-coder:32b", "qwen2.5-coder:latest"],
  },
  reasoner: {
    anthropic: ["claude-3-7-sonnet-20250219", "claude-3-opus-20240229"],
    openai: ["o3-mini", "o1", "gpt-4o"],
    gemini: ["gemini-1.5-pro", "gemini-2.0-flash-thinking-exp"],
    openrouter: [
      "x-ai/grok-4.3",
      "anthropic/claude-3.7-sonnet",
      "openai/o3-mini",
      "deepseek/deepseek-r1",
    ],
    ollama: ["deepseek-r1:latest", "deepseek-r1:32b"],
  },
};

export const MultiModelSettingsSection: React.FC<MultiModelSettingsSectionProps> = ({
  multiModelEnabled,
  onToggleMultiModel,
  tierUtility,
  onUpdateTierUtility,
  tierToolRunner,
  onUpdateTierToolRunner,
  tierReasoner,
  onUpdateTierReasoner,
  primaryProvider,
  onApplyPreset,
  phaseModels,
  onUpdatePhaseModel,
}) => {
  const [expandedTier, setExpandedTier] = useState<"utility" | "toolRunner" | "reasoner" | null>(null);
  const [showPhaseOverrides, setShowPhaseOverrides] = useState<boolean>(false);
  const [showSuggestModal, setShowSuggestModal] = useState<boolean>(false);

  const toggleExpand = (tier: "utility" | "toolRunner" | "reasoner") => {
    setExpandedTier((prev) => (prev === tier ? null : tier));
  };

  const effectiveUtilityProvider = tierUtility.apiKey ? (tierUtility.provider || primaryProvider) : primaryProvider;
  const effectiveToolRunnerProvider = tierToolRunner.apiKey ? (tierToolRunner.provider || primaryProvider) : primaryProvider;
  const effectiveReasonerProvider = tierReasoner.apiKey ? (tierReasoner.provider || primaryProvider) : primaryProvider;

  const providerModels = Array.from(
    new Set([
      ...(TIER_SUGGESTIONS.utility[primaryProvider] || []),
      ...(TIER_SUGGESTIONS.toolRunner[primaryProvider] || []),
      ...(TIER_SUGGESTIONS.reasoner[primaryProvider] || []),
      ...(tierUtility.model ? [tierUtility.model] : []),
      ...(tierToolRunner.model ? [tierToolRunner.model] : []),
      ...(tierReasoner.model ? [tierReasoner.model] : []),
    ])
  );

  const activeOverrideCount = Object.values(phaseModels || {}).filter((v) => v && typeof v === "string" && v.trim() && v !== "default").length;

  return (
    <div
      style={{
        border: "1px solid var(--border)",
        borderRadius: "8px",
        background: "rgba(255, 255, 255, 0.015)",
        padding: "16px",
        display: "flex",
        flexDirection: "column",
        gap: "14px",
      }}
    >
      {/* Header and Toggle */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: "10px" }}>
        <div>
          <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
            <Cpu size={16} color="var(--primary)" />
            <span style={{ fontSize: "13px", fontWeight: 700, color: "var(--fg-bright)" }}>
              3-Tier Multi-LLM Role Routing
            </span>
            <span style={{ fontSize: "11px", color: "var(--muted)", fontWeight: 400 }}>
              (Cost Optimizer)
            </span>
          </div>
          <div style={{ fontSize: "11.5px", color: "var(--muted)", marginTop: "2px" }}>
            Allocate specialized models for fast text extraction, rigid R tool execution, and high-end biological reasoning.
          </div>
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
          <button
            type="button"
            className="btn btn-secondary btn-xs"
            onClick={() => setShowSuggestModal(true)}
            style={{
              fontSize: "11px",
              fontWeight: 600,
              display: "flex",
              alignItems: "center",
              gap: "5px",
              borderColor: "rgba(59, 130, 246, 0.4)",
              color: "#93c5fd",
              background: "rgba(59, 130, 246, 0.08)",
            }}
            title="Suggest optimal T1, T2, T3 configuration based on benchmark runs"
          >
            <Sparkles size={12} color="#60a5fa" />
            Auto-Suggest Tiers
          </button>

          <label style={{ display: "flex", alignItems: "center", gap: "8px", cursor: "pointer" }}>
            <input
              type="checkbox"
              checked={multiModelEnabled}
              onChange={(e) => onToggleMultiModel(e.target.checked)}
              style={{ width: "16px", height: "16px", cursor: "pointer" }}
            />
            <span style={{ fontSize: "12px", fontWeight: 600, color: multiModelEnabled ? "var(--fg-bright)" : "var(--muted)" }}>
              {multiModelEnabled ? "Multi-Model Active" : "Disabled (Single Model)"}
            </span>
          </label>
        </div>
      </div>

      {multiModelEnabled && (
        <>
          {/* Empirical Benchmark Optimizer Banner */}
          <div
            style={{
              background: "linear-gradient(135deg, rgba(37, 99, 235, 0.12) 0%, rgba(124, 58, 237, 0.12) 100%)",
              border: "1px solid rgba(59, 130, 246, 0.35)",
              borderRadius: "8px",
              padding: "12px 14px",
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              flexWrap: "wrap",
              gap: "10px",
            }}
          >
            <div>
              <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
                <Sparkles size={14} color="#60a5fa" />
                <span style={{ fontSize: "12.5px", fontWeight: 700, color: "var(--fg-bright)" }}>
                  Benchmark-Driven Tier Suggestions
                </span>
                <span
                  style={{
                    fontSize: "10px",
                    fontWeight: 700,
                    background: "rgba(59, 130, 246, 0.25)",
                    color: "#93c5fd",
                    padding: "1px 6px",
                    borderRadius: "4px",
                  }}
                >
                  Empirical
                </span>
              </div>
              <div style={{ fontSize: "11.5px", color: "var(--muted)", marginTop: "2px" }}>
                Compute optimal T1, T2, T3 allocations based on 10+ benchmark runs, verified fidelity, and OpenRouter pricing.
              </div>
            </div>

            <button
              type="button"
              className="btn btn-primary btn-sm"
              onClick={() => setShowSuggestModal(true)}
              style={{
                fontSize: "11.5px",
                fontWeight: 700,
                display: "flex",
                alignItems: "center",
                gap: "6px",
                background: "linear-gradient(135deg, #2563eb 0%, #7c3aed 100%)",
                border: "none",
                boxShadow: "0 2px 8px rgba(37, 99, 235, 0.35)",
                cursor: "pointer",
              }}
            >
              <Zap size={13} />
              Suggest Optimal T1/T2/T3
            </button>
          </div>

          {/* Quick 1-Click Presets */}
          <div style={{ background: "#15151a", border: "1px solid var(--border)", borderRadius: "6px", padding: "10px 12px" }}>
            <div style={{ fontSize: "10.5px", fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.5px", color: "var(--muted)", marginBottom: "8px" }}>
              Quick Presets
            </div>
            <div style={{ display: "flex", gap: "6px", flexWrap: "wrap" }}>
              <button
                type="button"
                className="btn btn-secondary btn-xs"
                onClick={() => onApplyPreset("anthropic")}
                style={{ fontSize: "11px" }}
              >
                Anthropic (Haiku / 3.5 Sonnet / 3.7 Sonnet)
              </button>
              <button
                type="button"
                className="btn btn-secondary btn-xs"
                onClick={() => onApplyPreset("openai")}
                style={{ fontSize: "11px" }}
              >
                OpenAI (4o-mini / 4o / o3-mini)
              </button>
              <button
                type="button"
                className="btn btn-secondary btn-xs"
                onClick={() => onApplyPreset("openrouter")}
                style={{ fontSize: "11px" }}
              >
                OpenRouter (Gemini Flash / Claude Sonnet / Claude 3.7)
              </button>
              <button
                type="button"
                className="btn btn-secondary btn-xs"
                onClick={() => onApplyPreset("gemini")}
                style={{ fontSize: "11px" }}
              >
                Google Gemini (Flash / Flash / 1.5 Pro)
              </button>
              <button
                type="button"
                className="btn btn-secondary btn-xs"
                onClick={() => onApplyPreset("ollama")}
                style={{ fontSize: "11px" }}
              >
                Local Ollama (Qwen 7B / Qwen 32B / DeepSeek R1)
              </button>
            </div>
          </div>

          {/* Tier 1 Card: Fast Utility & Ingestion */}
          <div
            style={{
              background: "#16161d",
              border: "1px solid var(--border)",
              borderRadius: "6px",
              padding: "12px 14px",
            }}
          >
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: "8px" }}>
              <div>
                <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
                  <Zap size={14} color="#60a5fa" />
                  <span style={{ fontSize: "12px", fontWeight: 700, color: "var(--fg-bright)" }}>
                    Tier 1: Fast Utility &amp; Extractor
                  </span>
                  <span style={{ fontSize: "11px", color: "var(--muted)", fontWeight: 400 }}>
                    (Ingestion &amp; Digests)
                  </span>
                </div>
                <div style={{ fontSize: "11px", color: "var(--muted)", marginTop: "2px" }}>
                  Powers PDF paper extraction, supplementary table structuring, PubMed &amp; web search digests, and chat session summaries.
                </div>
              </div>
              <button
                type="button"
                className="btn-icon"
                onClick={() => toggleExpand("utility")}
                style={{ fontSize: "11px", color: "var(--muted)", background: "transparent", border: "none", cursor: "pointer", display: "inline-flex", alignItems: "center", gap: "2px" }}
              >
                {expandedTier === "utility" ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                <span style={{ fontSize: "10px" }}>Advanced</span>
              </button>
            </div>

            <div style={{ display: "grid", gridTemplateColumns: "1fr", gap: "6px" }}>
              <input
                type="text"
                className="input"
                style={{ width: "100%", padding: "6px 10px", fontSize: "12px" }}
                value={tierUtility.model || ""}
                onChange={(e) => onUpdateTierUtility({ model: e.target.value })}
                placeholder="e.g. claude-3-5-haiku-20241022 or gpt-4o-mini"
              />

              <div style={{ display: "flex", gap: "4px", flexWrap: "wrap", alignItems: "center" }}>
                <span style={{ fontSize: "9.5px", color: "var(--muted)", marginRight: "4px" }}>Suggestions:</span>
                {(TIER_SUGGESTIONS.utility[effectiveUtilityProvider] || []).map((m) => (
                  <button
                    key={m}
                    type="button"
                    className="file-pill"
                    style={{ fontSize: "9.5px", padding: "1px 6px" }}
                    onClick={() => onUpdateTierUtility({ model: m })}
                  >
                    {m}
                  </button>
                ))}
              </div>
            </div>

            {expandedTier === "utility" && (
              <div style={{ marginTop: "10px", paddingTop: "10px", borderTop: "1px dashed var(--border)", display: "grid", gridTemplateColumns: "1fr 1fr", gap: "10px" }}>
                <div>
                  <label className="field-label" style={{ marginBottom: "4px" }}>Provider Override</label>
                  <select
                    className="select"
                    style={{ width: "100%", padding: "5px 8px", fontSize: "11px" }}
                    value={tierUtility.provider || ""}
                    onChange={(e) => onUpdateTierUtility({ provider: (e.target.value as LLMProviderType) || undefined })}
                  >
                    <option value="">Inherit Default ({primaryProvider.toUpperCase()})</option>
                    <option value="anthropic">Anthropic</option>
                    <option value="gemini">Google Gemini</option>
                    <option value="openai">OpenAI</option>
                    <option value="openrouter">OpenRouter</option>
                    <option value="ollama">Ollama (Local)</option>
                  </select>
                </div>
                <div>
                  <label className="field-label" style={{ marginBottom: "4px" }}>API Key Override</label>
                  <input
                    type="password"
                    className="input"
                    style={{ width: "100%", padding: "5px 8px", fontSize: "11px" }}
                    placeholder="Leave blank to use primary key"
                    value={tierUtility.apiKey || ""}
                    onChange={(e) => onUpdateTierUtility({ apiKey: e.target.value })}
                  />
                </div>
              </div>
            )}
          </div>

          {/* Tier 2 Card: Tool Runner & Code Orchestrator */}
          <div
            style={{
              background: "#16161d",
              border: "1px solid var(--border)",
              borderRadius: "6px",
              padding: "12px 14px",
            }}
          >
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: "8px" }}>
              <div>
                <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
                  <Layers size={14} color="#a78bfa" />
                  <span style={{ fontSize: "12px", fontWeight: 700, color: "var(--fg-bright)" }}>
                    Tier 2: Tool Runner &amp; Code Orchestrator
                  </span>
                  <span style={{ fontSize: "11px", color: "var(--muted)", fontWeight: 400 }}>
                    (Phases 00–08 &amp; MCP R)
                  </span>
                </div>
                <div style={{ fontSize: "11px", color: "var(--muted)", marginTop: "2px" }}>
                  Workhorse model for MCP R tool execution (QC, normalization, imputation, differential expression) and standard chat turns.
                </div>
              </div>
              <button
                type="button"
                className="btn-icon"
                onClick={() => toggleExpand("toolRunner")}
                style={{ fontSize: "11px", color: "var(--muted)", background: "transparent", border: "none", cursor: "pointer", display: "inline-flex", alignItems: "center", gap: "2px" }}
              >
                {expandedTier === "toolRunner" ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                <span style={{ fontSize: "10px" }}>Advanced</span>
              </button>
            </div>

            <div style={{ display: "grid", gridTemplateColumns: "1fr", gap: "6px" }}>
              <input
                type="text"
                className="input"
                style={{ width: "100%", padding: "6px 10px", fontSize: "12px" }}
                value={tierToolRunner.model || ""}
                onChange={(e) => onUpdateTierToolRunner({ model: e.target.value })}
                placeholder="e.g. claude-3-5-sonnet-20241022 or gpt-4o"
              />

              <div style={{ display: "flex", gap: "4px", flexWrap: "wrap", alignItems: "center" }}>
                <span style={{ fontSize: "9.5px", color: "var(--muted)", marginRight: "4px" }}>Suggestions:</span>
                {(TIER_SUGGESTIONS.toolRunner[effectiveToolRunnerProvider] || []).map((m) => (
                  <button
                    key={m}
                    type="button"
                    className="file-pill"
                    style={{ fontSize: "9.5px", padding: "1px 6px" }}
                    onClick={() => onUpdateTierToolRunner({ model: m })}
                  >
                    {m}
                  </button>
                ))}
              </div>
            </div>

            {expandedTier === "toolRunner" && (
              <div style={{ marginTop: "10px", paddingTop: "10px", borderTop: "1px dashed var(--border)", display: "grid", gridTemplateColumns: "1fr 1fr", gap: "10px" }}>
                <div>
                  <label className="field-label" style={{ marginBottom: "4px" }}>Provider Override</label>
                  <select
                    className="select"
                    style={{ width: "100%", padding: "5px 8px", fontSize: "11px" }}
                    value={tierToolRunner.provider || ""}
                    onChange={(e) => onUpdateTierToolRunner({ provider: (e.target.value as LLMProviderType) || undefined })}
                  >
                    <option value="">Inherit Default ({primaryProvider.toUpperCase()})</option>
                    <option value="anthropic">Anthropic</option>
                    <option value="gemini">Google Gemini</option>
                    <option value="openai">OpenAI</option>
                    <option value="openrouter">OpenRouter</option>
                    <option value="ollama">Ollama (Local)</option>
                  </select>
                </div>
                <div>
                  <label className="field-label" style={{ marginBottom: "4px" }}>API Key Override</label>
                  <input
                    type="password"
                    className="input"
                    style={{ width: "100%", padding: "5px 8px", fontSize: "11px" }}
                    placeholder="Leave blank to use primary key"
                    value={tierToolRunner.apiKey || ""}
                    onChange={(e) => onUpdateTierToolRunner({ apiKey: e.target.value })}
                  />
                </div>
              </div>
            )}
          </div>

          {/* Tier 3 Card: Frontier Scientific Reasoner */}
          <div
            style={{
              background: "#16161d",
              border: "1px solid var(--border)",
              borderRadius: "6px",
              padding: "12px 14px",
            }}
          >
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: "8px" }}>
              <div>
                <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
                  <Sparkles size={14} color="#f59e0b" />
                  <span style={{ fontSize: "12px", fontWeight: 700, color: "var(--fg-bright)" }}>
                    Tier 3: Frontier Scientific Reasoner
                  </span>
                  <span style={{ fontSize: "11px", color: "var(--muted)", fontWeight: 400 }}>
                    (Phases 09–11 &amp; Synthesis)
                  </span>
                </div>
                <div style={{ fontSize: "11px", color: "var(--muted)", marginTop: "2px" }}>
                  High-capacity reasoning model for literature corroboration, causal mechanism interpretation, and scientific manuscript composition.
                </div>
              </div>
              <button
                type="button"
                className="btn-icon"
                onClick={() => toggleExpand("reasoner")}
                style={{ fontSize: "11px", color: "var(--muted)", background: "transparent", border: "none", cursor: "pointer", display: "inline-flex", alignItems: "center", gap: "2px" }}
              >
                {expandedTier === "reasoner" ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                <span style={{ fontSize: "10px" }}>Advanced</span>
              </button>
            </div>

            <div style={{ display: "grid", gridTemplateColumns: "1fr", gap: "6px" }}>
              <input
                type="text"
                className="input"
                style={{ width: "100%", padding: "6px 10px", fontSize: "12px" }}
                value={tierReasoner.model || ""}
                onChange={(e) => onUpdateTierReasoner({ model: e.target.value })}
                placeholder="e.g. claude-3-7-sonnet-20250219 or o3-mini"
              />

              <div style={{ display: "flex", gap: "4px", flexWrap: "wrap", alignItems: "center" }}>
                <span style={{ fontSize: "9.5px", color: "var(--muted)", marginRight: "4px" }}>Suggestions:</span>
                {(TIER_SUGGESTIONS.reasoner[effectiveReasonerProvider] || []).map((m) => (
                  <button
                    key={m}
                    type="button"
                    className="file-pill"
                    style={{ fontSize: "9.5px", padding: "1px 6px" }}
                    onClick={() => onUpdateTierReasoner({ model: m })}
                  >
                    {m}
                  </button>
                ))}
              </div>
            </div>

            {expandedTier === "reasoner" && (
              <div style={{ marginTop: "10px", paddingTop: "10px", borderTop: "1px dashed var(--border)", display: "grid", gridTemplateColumns: "1fr 1fr", gap: "10px" }}>
                <div>
                  <label className="field-label" style={{ marginBottom: "4px" }}>Provider Override</label>
                  <select
                    className="select"
                    style={{ width: "100%", padding: "5px 8px", fontSize: "11px" }}
                    value={tierReasoner.provider || ""}
                    onChange={(e) => onUpdateTierReasoner({ provider: (e.target.value as LLMProviderType) || undefined })}
                  >
                    <option value="">Inherit Default ({primaryProvider.toUpperCase()})</option>
                    <option value="anthropic">Anthropic</option>
                    <option value="gemini">Google Gemini</option>
                    <option value="openai">OpenAI</option>
                    <option value="openrouter">OpenRouter</option>
                    <option value="ollama">Ollama (Local)</option>
                  </select>
                </div>
                <div>
                  <label className="field-label" style={{ marginBottom: "4px" }}>API Key Override</label>
                  <input
                    type="password"
                    className="input"
                    style={{ width: "100%", padding: "5px 8px", fontSize: "11px" }}
                    placeholder="Leave blank to use primary key"
                    value={tierReasoner.apiKey || ""}
                    onChange={(e) => onUpdateTierReasoner({ apiKey: e.target.value })}
                  />
                </div>
              </div>
            )}
          </div>

          {/* Phase-Specific Model Assignments (Granular Overrides) */}
          <div
            style={{
              background: "#15151a",
              border: "1px solid var(--border)",
              borderRadius: "6px",
              overflow: "hidden",
              display: "flex",
              flexDirection: "column",
            }}
          >
            <div
              onClick={() => setShowPhaseOverrides(!showPhaseOverrides)}
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                padding: "10px 14px",
                cursor: "pointer",
                background: showPhaseOverrides ? "rgba(255, 255, 255, 0.04)" : "transparent",
                transition: "background 0.2s ease",
              }}
            >
              <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                {showPhaseOverrides ? <ChevronDown size={14} color="var(--primary)" /> : <ChevronRight size={14} color="var(--muted)" />}
                <span style={{ fontSize: "12px", fontWeight: 700, color: "var(--fg-bright)" }}>
                  Per-Phase LLM Assignments (Optional)
                </span>
                {activeOverrideCount > 0 ? (
                  <span
                    style={{
                      fontSize: "10px",
                      padding: "1px 7px",
                      borderRadius: "10px",
                      background: "rgba(59, 130, 246, 0.2)",
                      border: "1px solid rgba(59, 130, 246, 0.4)",
                      color: "#60a5fa",
                      fontWeight: 700,
                    }}
                  >
                    {activeOverrideCount} Custom Phase Override{activeOverrideCount === 1 ? "" : "s"}
                  </span>
                ) : (
                  <span style={{ fontSize: "10px", color: "var(--muted)" }}>
                    (All phases currently inheriting role tiers)
                  </span>
                )}
              </div>
              <span style={{ fontSize: "11px", color: "var(--muted)" }}>
                {showPhaseOverrides ? "Collapse Table" : "Configure per-phase models"}
              </span>
            </div>

            {showPhaseOverrides && (
              <div style={{ padding: "12px 14px", display: "flex", flexDirection: "column", gap: "10px", borderTop: "1px solid var(--border)" }}>
                <div
                  style={{
                    fontSize: "11.5px",
                    color: "var(--muted)",
                    background: "rgba(59, 130, 246, 0.08)",
                    border: "1px solid rgba(59, 130, 246, 0.2)",
                    borderRadius: "6px",
                    padding: "8px 12px",
                    display: "flex",
                    alignItems: "flex-start",
                    gap: "8px",
                    lineHeight: 1.45,
                  }}
                >
                  <Sparkles size={14} color="#60a5fa" style={{ flexShrink: 0, marginTop: "2px" }} />
                  <span>
                    Each phase can be hardwired to a specific model from your active provider (<strong>{primaryProvider.toUpperCase()}</strong>). Phases set to <em>(Inherit Tier Default)</em> dynamically receive models from Tier 1, 2, or 3. If multi-model routing is turned off, all phases fall back to the Primary Model.
                  </span>
                </div>

                <div
                  style={{
                    display: "flex",
                    flexDirection: "column",
                    gap: "6px",
                    marginTop: "4px",
                  }}
                >
                  {STANDARD_PHASES.map((phase) => {
                    const assignedVal = (phaseModels && phaseModels[phase.id]) || "";
                    const tierName =
                      phase.defaultTier === "utility"
                        ? "Tier 1: Utility"
                        : phase.defaultTier === "toolRunner"
                        ? "Tier 2: Tool Runner"
                        : "Tier 3: Reasoner";
                    const tierModel =
                      phase.defaultTier === "utility"
                        ? tierUtility.model || "default"
                        : phase.defaultTier === "toolRunner"
                        ? tierToolRunner.model || "default"
                        : tierReasoner.model || "default";
                    const isCustom = Boolean(assignedVal && assignedVal.trim() && assignedVal !== "default");

                    const tierColor =
                      phase.defaultTier === "utility"
                        ? "#10b981"
                        : phase.defaultTier === "toolRunner"
                        ? "#3b82f6"
                        : "#a855f7";

                    return (
                      <div
                        key={phase.id}
                        style={{
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "space-between",
                          padding: "6px 10px",
                          borderRadius: "4px",
                          background: isCustom ? "rgba(59, 130, 246, 0.07)" : "rgba(255, 255, 255, 0.02)",
                          border: `1px solid ${isCustom ? "rgba(59, 130, 246, 0.3)" : "rgba(255, 255, 255, 0.05)"}`,
                          gap: "10px",
                          flexWrap: "wrap",
                        }}
                      >
                        <div style={{ display: "flex", alignItems: "center", gap: "8px", minWidth: "220px", flex: "1 1 220px" }}>
                          <span style={{ fontFamily: "var(--font-mono)", fontSize: "11.5px", fontWeight: 700, color: "var(--fg-bright)" }}>
                            {phase.id}
                          </span>
                          <span style={{ fontSize: "11.5px", fontWeight: 600, color: "var(--fg)" }}>
                            {phase.name}
                          </span>
                          <span
                            style={{
                              fontSize: "9.5px",
                              padding: "1px 6px",
                              borderRadius: "4px",
                              background: "rgba(0, 0, 0, 0.4)",
                              border: `1px solid ${tierColor}44`,
                              color: tierColor,
                              fontWeight: 600,
                            }}
                          >
                            {tierName}
                          </span>
                        </div>

                        <div style={{ display: "flex", alignItems: "center", gap: "6px", flex: "0 0 auto" }}>
                          <select
                            className="select"
                            value={isCustom ? assignedVal : ""}
                            onChange={(e) => {
                              if (onUpdatePhaseModel) {
                                const val = e.target.value;
                                onUpdatePhaseModel(phase.id, val ? val : null);
                              }
                            }}
                            style={{
                              fontSize: "11.5px",
                              padding: "4px 8px",
                              minWidth: "230px",
                              fontFamily: "var(--font-mono)",
                              color: isCustom ? "#60a5fa" : "var(--muted)",
                              fontWeight: isCustom ? 700 : 400,
                            }}
                          >
                            <option value="">(Inherit {tierName} - {tierModel.includes("/") ? tierModel.split("/")[1] : tierModel})</option>
                            {providerModels.map((m) => (
                              <option key={m} value={m}>
                                {m}
                              </option>
                            ))}
                          </select>

                          {isCustom && (
                            <button
                              type="button"
                              className="btn btn-secondary btn-xs"
                              onClick={() => {
                                if (onUpdatePhaseModel) {
                                  onUpdatePhaseModel(phase.id, null);
                                }
                              }}
                              title="Reset to Inherit Tier Default"
                              style={{ padding: "3px 6px" }}
                            >
                              <RotateCcw size={11} />
                            </button>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </div>
        </>
      )}

      {/* Suggestion Modal */}
      <TierSuggestionModal
        isOpen={showSuggestModal}
        onClose={() => setShowSuggestModal(false)}
        onApplyConfig={(cfg) => {
          onUpdateTierUtility(cfg.tierUtility);
          onUpdateTierToolRunner(cfg.tierToolRunner);
          onUpdateTierReasoner(cfg.tierReasoner);
          if (!multiModelEnabled) {
            onToggleMultiModel(true);
          }
        }}
      />
    </div>
  );
};

