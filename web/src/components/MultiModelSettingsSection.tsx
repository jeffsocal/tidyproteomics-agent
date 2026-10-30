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
} from "lucide-react";
import { LLMProviderType, LLMTierConfig } from "../types";

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
}) => {
  const [expandedTier, setExpandedTier] = useState<"utility" | "toolRunner" | "reasoner" | null>(null);

  const toggleExpand = (tier: "utility" | "toolRunner" | "reasoner") => {
    setExpandedTier((prev) => (prev === tier ? null : tier));
  };

  const effectiveUtilityProvider = tierUtility.apiKey ? (tierUtility.provider || primaryProvider) : primaryProvider;
  const effectiveToolRunnerProvider = tierToolRunner.apiKey ? (tierToolRunner.provider || primaryProvider) : primaryProvider;
  const effectiveReasonerProvider = tierReasoner.apiKey ? (tierReasoner.provider || primaryProvider) : primaryProvider;

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

      {multiModelEnabled && (
        <>
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
        </>
      )}
    </div>
  );
};

