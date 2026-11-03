import React, { useState, useEffect } from "react";
import {
  Sparkles,
  Zap,
  Cpu,
  Layers,
  Award,
  ShieldCheck,
  TrendingUp,
  X,
  Check,
  RotateCcw,
  AlertCircle,
  HelpCircle,
  Clock,
  ArrowRight,
  BrainCircuit,
  Coins,
} from "lucide-react";
import { marked } from "marked";
import {
  TierSuggestionResult,
  TierOptimizationProfile,
  ExplainTierResponse,
  LLMTierConfig,
} from "../types";
import { MarkdownViewer } from "./MarkdownViewer";

interface TierSuggestionModalProps {
  isOpen: boolean;
  onClose: () => void;
  onApplyConfig: (config: {
    tierUtility: LLMTierConfig;
    tierToolRunner: LLMTierConfig;
    tierReasoner: LLMTierConfig;
  }) => void;
}

export const TierSuggestionModal: React.FC<TierSuggestionModalProps> = ({
  isOpen,
  onClose,
  onApplyConfig,
}) => {
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);
  const [suggestionData, setSuggestionData] = useState<TierSuggestionResult | null>(null);
  const [activeProfileId, setActiveProfileId] = useState<"quality" | "balanced" | "budget">("balanced");

  // LLM Explanation state
  const [explaining, setExplaining] = useState<boolean>(false);
  const [explanation, setExplanation] = useState<string | null>(null);
  const [explanationGeneratedBy, setExplanationGeneratedBy] = useState<string | null>(null);

  useEffect(() => {
    if (!isOpen) return;

    let isMounted = true;
    setLoading(true);
    setError(null);
    setExplanation(null);

    fetch("/api/evaluation/suggest-tiers")
      .then(async (res) => {
        if (!res.ok) {
          const text = await res.text();
          throw new Error(`Failed to load tier suggestions: ${text}`);
        }
        return res.json();
      })
      .then((data: TierSuggestionResult) => {
        if (isMounted) {
          setSuggestionData(data);
          setLoading(false);
        }
      })
      .catch((err: any) => {
        if (isMounted) {
          setError(err.message || "Failed to load benchmark tier data");
          setLoading(false);
        }
      });

    return () => {
      isMounted = false;
    };
  }, [isOpen]);

  if (!isOpen) return null;

  const currentProfile: TierOptimizationProfile | undefined = suggestionData?.profiles[activeProfileId];

  const handleRequestExplanation = async () => {
    if (!currentProfile) return;
    setExplaining(true);
    try {
      const res = await fetch("/api/evaluation/explain-tiers", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          profileId: activeProfileId,
          tierUtilityModel: currentProfile.tierUtility.model,
          tierToolRunnerModel: currentProfile.tierToolRunner.model,
          tierReasonerModel: currentProfile.tierReasoner.model,
        }),
      });
      const data: ExplainTierResponse = await res.json();
      if (data.ok && data.explanation) {
        setExplanation(data.explanation);
        setExplanationGeneratedBy(data.generatedBy);
      } else {
        setExplanation(`⚠️ Failed to generate advisor explanation: ${data.error || "Unknown error"}`);
      }
    } catch (err: any) {
      setExplanation(`⚠️ Error contacting LLM Advisor: ${err.message}`);
    } finally {
      setExplaining(false);
    }
  };

  const handleApply = () => {
    if (!currentProfile) return;
    onApplyConfig({
      tierUtility: {
        model: currentProfile.tierUtility.model,
        provider: (currentProfile.tierUtility.provider as any) || "openrouter",
      },
      tierToolRunner: {
        model: currentProfile.tierToolRunner.model,
        provider: (currentProfile.tierToolRunner.provider as any) || "openrouter",
      },
      tierReasoner: {
        model: currentProfile.tierReasoner.model,
        provider: (currentProfile.tierReasoner.provider as any) || "openrouter",
      },
    });
    onClose();
  };

  return (
    <div
      style={{
        position: "fixed",
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        backgroundColor: "rgba(0, 0, 0, 0.78)",
        backdropFilter: "blur(6px)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        zIndex: 9999,
        padding: "20px",
      }}
      onClick={onClose}
    >
      <div
        style={{
          background: "var(--card-bg, #121217)",
          border: "1px solid var(--border, #2d2d38)",
          borderRadius: "12px",
          width: "100%",
          maxWidth: "880px",
          maxHeight: "90vh",
          display: "flex",
          flexDirection: "column",
          boxShadow: "0 24px 48px rgba(0, 0, 0, 0.6)",
          overflow: "hidden",
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div
          style={{
            padding: "16px 20px",
            borderBottom: "1px solid var(--border, #2d2d38)",
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            background: "linear-gradient(180deg, rgba(255, 255, 255, 0.03) 0%, rgba(255, 255, 255, 0) 100%)",
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
            <div
              style={{
                width: "32px",
                height: "32px",
                borderRadius: "8px",
                background: "linear-gradient(135deg, #3b82f6 0%, #8b5cf6 100%)",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                color: "#fff",
              }}
            >
              <Sparkles size={18} />
            </div>
            <div>
              <div style={{ fontSize: "15px", fontWeight: 700, color: "var(--fg-bright, #fff)" }}>
                Empirical 3-Tier Multi-LLM Role Optimizer
              </div>
              <div style={{ fontSize: "11.5px", color: "var(--muted, #8e8ea0)" }}>
                Suggests optimal T1 (Utility), T2 (Tool Runner), and T3 (Reasoner) models using verified benchmark metrics & OpenRouter pricing.
              </div>
            </div>
          </div>
          <button
            onClick={onClose}
            className="btn btn-secondary btn-xs"
            style={{ padding: "6px", borderRadius: "6px" }}
          >
            <X size={16} />
          </button>
        </div>

        {/* Content Body */}
        <div style={{ padding: "20px", overflowY: "auto", flex: 1, display: "flex", flexDirection: "column", gap: "16px" }}>
          {loading && (
            <div style={{ padding: "40px 20px", textAlign: "center", color: "var(--muted, #8e8ea0)" }}>
              <RotateCcw className="animate-spin" size={24} style={{ margin: "0 auto 12px" }} />
              <div style={{ fontSize: "13px", fontWeight: 600 }}>Analyzing benchmark evaluations & live pricing...</div>
            </div>
          )}

          {error && (
            <div
              style={{
                padding: "16px",
                borderRadius: "8px",
                background: "rgba(239, 68, 68, 0.1)",
                border: "1px solid rgba(239, 68, 68, 0.3)",
                color: "#f87171",
                display: "flex",
                gap: "10px",
                alignItems: "center",
              }}
            >
              <AlertCircle size={18} />
              <div style={{ fontSize: "12px" }}>{error}</div>
            </div>
          )}

          {!loading && !error && currentProfile && (
            <>
              {/* Profile Selector Cards */}
              <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: "10px" }}>
                {[
                  { id: "quality", title: "Frontier Max Quality", badge: "🏆 Highest Score", color: "#8b5cf6" },
                  { id: "balanced", title: "Sweet Spot (Value)", badge: "⚖️ Recommended", color: "#3b82f6" },
                  { id: "budget", title: "High Speed & Budget", badge: "⚡ Cost-Optimized", color: "#10b981" },
                ].map((tab) => {
                  const isActive = activeProfileId === tab.id;
                  const profile = suggestionData?.profiles[tab.id as "quality" | "balanced" | "budget"];
                  return (
                    <button
                      key={tab.id}
                      type="button"
                      onClick={() => {
                        setActiveProfileId(tab.id as any);
                        setExplanation(null);
                      }}
                      style={{
                        padding: "12px 14px",
                        borderRadius: "8px",
                        textAlign: "left",
                        cursor: "pointer",
                        border: isActive ? `2px solid ${tab.color}` : "1px solid var(--border, #2d2d38)",
                        background: isActive ? "rgba(255, 255, 255, 0.04)" : "rgba(255, 255, 255, 0.015)",
                        transition: "all 0.15s ease",
                      }}
                    >
                      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "4px" }}>
                        <span style={{ fontSize: "10.5px", fontWeight: 700, textTransform: "uppercase", color: tab.color }}>
                          {tab.badge}
                        </span>
                        {isActive && <Check size={14} color={tab.color} />}
                      </div>
                      <div style={{ fontSize: "13px", fontWeight: 700, color: "var(--fg-bright, #fff)" }}>
                        {tab.title}
                      </div>
                      <div style={{ fontSize: "11px", color: "var(--muted, #8e8ea0)", marginTop: "4px" }}>
                        Est. Cost: <strong style={{ color: "var(--fg-bright, #fff)" }}>${profile?.projectedCostUsd}</strong> · Score: <strong style={{ color: tab.color }}>{profile?.projectedBenchmarkScore}/100</strong>
                      </div>
                    </button>
                  );
                })}
              </div>

              {/* Profile Overview Banner */}
              <div
                style={{
                  background: "linear-gradient(90deg, rgba(59, 130, 246, 0.08) 0%, rgba(139, 92, 246, 0.08) 100%)",
                  border: "1px solid rgba(59, 130, 246, 0.25)",
                  borderRadius: "8px",
                  padding: "12px 16px",
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                  flexWrap: "wrap",
                  gap: "10px",
                }}
              >
                <div>
                  <div style={{ fontSize: "13px", fontWeight: 700, color: "var(--fg-bright, #fff)" }}>
                    {currentProfile.title}
                  </div>
                  <div style={{ fontSize: "11.5px", color: "var(--muted, #8e8ea0)", marginTop: "2px" }}>
                    {currentProfile.description}
                  </div>
                </div>

                <div style={{ display: "flex", gap: "16px", alignItems: "center" }}>
                  <div style={{ textAlign: "right" }}>
                    <div style={{ fontSize: "10px", textTransform: "uppercase", color: "var(--muted, #8e8ea0)", fontWeight: 700 }}>
                      Projected Score
                    </div>
                    <div style={{ fontSize: "18px", fontWeight: 800, color: "#38bdf8" }}>
                      {currentProfile.projectedBenchmarkScore} <span style={{ fontSize: "11px", fontWeight: 500, color: "var(--muted, #8e8ea0)" }}>/ 100</span>
                    </div>
                  </div>

                  <div style={{ textAlign: "right" }}>
                    <div style={{ fontSize: "10px", textTransform: "uppercase", color: "var(--muted, #8e8ea0)", fontWeight: 700 }}>
                      Est. Total Cost
                    </div>
                    <div style={{ fontSize: "18px", fontWeight: 800, color: "#4ade80" }}>
                      ${currentProfile.projectedCostUsd}
                    </div>
                  </div>

                  {currentProfile.costSavingsPercentVsFrontier > 0 && (
                    <div
                      style={{
                        padding: "4px 8px",
                        borderRadius: "6px",
                        background: "rgba(74, 222, 128, 0.15)",
                        border: "1px solid rgba(74, 222, 128, 0.3)",
                        color: "#4ade80",
                        fontSize: "11.5px",
                        fontWeight: 700,
                      }}
                    >
                      {currentProfile.costSavingsPercentVsFrontier}% Saved
                    </div>
                  )}
                </div>
              </div>

              {/* 3 Tier Role Cards */}
              <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
                {/* Tier 1 Card */}
                <div
                  style={{
                    background: "var(--panel-bg, #16161d)",
                    border: "1px solid var(--border)",
                    borderRadius: "8px",
                    padding: "12px 14px",
                  }}
                >
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: "6px" }}>
                    <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                      <Zap size={15} color="#60a5fa" />
                      <span style={{ fontSize: "12px", fontWeight: 700, color: "var(--fg-bright, #fff)" }}>
                        Tier 1: Fast Utility & Ingestion
                      </span>
                      <span style={{ fontSize: "10px", color: "var(--muted, #8e8ea0)", background: "rgba(255,255,255,0.06)", padding: "2px 6px", borderRadius: "4px" }}>
                        Phases 01–03
                      </span>
                    </div>
                    <span style={{ fontSize: "11.5px", fontWeight: 700, color: "#4ade80" }}>
                      ${currentProfile.recommendations.utility.estimatedCostUsd} est.
                    </span>
                  </div>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: "6px" }}>
                    <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
                      <span style={{ fontSize: "11px", color: "var(--muted, #8e8ea0)" }}>Model:</span>
                      <code style={{ fontSize: "12px", background: "rgba(0,0,0,0.4)", padding: "2px 6px", borderRadius: "4px", color: "#93c5fd" }}>
                        {currentProfile.recommendations.utility.recommendedModel}
                      </code>
                    </div>
                    <div style={{ fontSize: "11px", color: "var(--muted, #8e8ea0)" }}>
                      {currentProfile.recommendations.utility.rationale}
                    </div>
                  </div>
                </div>

                {/* Tier 2 Card */}
                <div
                  style={{
                    background: "var(--panel-bg, #16161d)",
                    border: "1px solid var(--border)",
                    borderRadius: "8px",
                    padding: "12px 14px",
                  }}
                >
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: "6px" }}>
                    <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                      <Layers size={15} color="#a78bfa" />
                      <span style={{ fontSize: "12px", fontWeight: 700, color: "var(--fg-bright, #fff)" }}>
                        Tier 2: Tool Runner & Code Orchestrator
                      </span>
                      <span style={{ fontSize: "10px", color: "var(--muted, #8e8ea0)", background: "rgba(255,255,255,0.06)", padding: "2px 6px", borderRadius: "4px" }}>
                        Phases 04–06, 08–10
                      </span>
                    </div>
                    <span style={{ fontSize: "11.5px", fontWeight: 700, color: "#4ade80" }}>
                      ${currentProfile.recommendations.toolRunner.estimatedCostUsd} est.
                    </span>
                  </div>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: "6px" }}>
                    <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
                      <span style={{ fontSize: "11px", color: "var(--muted, #8e8ea0)" }}>Model:</span>
                      <code style={{ fontSize: "12px", background: "rgba(0,0,0,0.4)", padding: "2px 6px", borderRadius: "4px", color: "#c4b5fd" }}>
                        {currentProfile.recommendations.toolRunner.recommendedModel}
                      </code>
                    </div>
                    <div style={{ fontSize: "11px", color: "var(--muted, #8e8ea0)" }}>
                      {currentProfile.recommendations.toolRunner.rationale}
                    </div>
                  </div>
                </div>

                {/* Tier 3 Card */}
                <div
                  style={{
                    background: "var(--panel-bg, #16161d)",
                    border: "1px solid var(--border)",
                    borderRadius: "8px",
                    padding: "12px 14px",
                  }}
                >
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: "6px" }}>
                    <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                      <BrainCircuit size={15} color="#ec4899" />
                      <span style={{ fontSize: "12px", fontWeight: 700, color: "var(--fg-bright, #fff)" }}>
                        Tier 3: Frontier Scientific Reasoner
                      </span>
                      <span style={{ fontSize: "10px", color: "var(--muted, #8e8ea0)", background: "rgba(255,255,255,0.06)", padding: "2px 6px", borderRadius: "4px" }}>
                        Phases 07, 11–13
                      </span>
                    </div>
                    <span style={{ fontSize: "11.5px", fontWeight: 700, color: "#4ade80" }}>
                      ${currentProfile.recommendations.reasoner.estimatedCostUsd} est.
                    </span>
                  </div>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: "6px" }}>
                    <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
                      <span style={{ fontSize: "11px", color: "var(--muted, #8e8ea0)" }}>Model:</span>
                      <code style={{ fontSize: "12px", background: "rgba(0,0,0,0.4)", padding: "2px 6px", borderRadius: "4px", color: "#f472b6" }}>
                        {currentProfile.recommendations.reasoner.recommendedModel}
                      </code>
                    </div>
                    <div style={{ fontSize: "11px", color: "var(--muted, #8e8ea0)" }}>
                      {currentProfile.recommendations.reasoner.rationale}
                    </div>
                  </div>
                </div>
              </div>

              {/* LLM Biological Advisor Rationale Box */}
              <div
                style={{
                  background: "var(--panel-bg, #141419)",
                  border: "1px solid var(--border)",
                  borderRadius: "8px",
                  padding: "14px",
                }}
              >
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "10px" }}>
                  <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                    <BrainCircuit size={15} color="#3b82f6" />
                    <span style={{ fontSize: "12px", fontWeight: 700, color: "var(--fg-bright, #fff)" }}>
                      Lead Bioinformatician Advisor Review
                    </span>
                  </div>

                  {!explanation && (
                    <button
                      type="button"
                      className="btn btn-secondary btn-xs"
                      onClick={handleRequestExplanation}
                      disabled={explaining}
                      style={{ fontSize: "11px", display: "flex", alignItems: "center", gap: "6px" }}
                    >
                      {explaining ? (
                        <>
                          <RotateCcw className="animate-spin" size={13} />
                          Synthesizing Rationale...
                        </>
                      ) : (
                        <>
                          <Sparkles size={13} />
                          Generate Biological Rationale
                        </>
                      )}
                    </button>
                  )}
                </div>

                {explanation ? (
                  <div style={{ fontSize: "12px", lineHeight: "1.6", color: "#e2e8f0" }}>
                    <div
                      dangerouslySetInnerHTML={{
                        __html: (() => {
                          try {
                            return marked.parse(explanation, { async: false }) as string;
                          } catch {
                            return explanation;
                          }
                        })(),
                      }}
                    />
                    {explanationGeneratedBy && (
                      <div style={{ fontSize: "10.5px", color: "var(--muted, #8e8ea0)", marginTop: "8px" }}>
                        Synthesized by: <code>{explanationGeneratedBy}</code>
                      </div>
                    )}
                  </div>
                ) : (
                  <div style={{ fontSize: "11.5px", color: "var(--muted, #8e8ea0)" }}>
                    Click <strong>Generate Biological Rationale</strong> to have the LLM Advisor evaluate why this multi-model blend protects against directional hallucinations and optimizes mass-spec statistical workflows.
                  </div>
                )}
              </div>
            </>
          )}
        </div>

        {/* Footer Actions */}
        <div
          style={{
            padding: "14px 20px",
            borderTop: "1px solid var(--border, #2d2d38)",
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            background: "rgba(255, 255, 255, 0.015)",
          }}
        >
          <div style={{ fontSize: "11.5px", color: "var(--muted, #8e8ea0)" }}>
            Data source: <strong>{suggestionData?.totalRunsAnalyzed || 0} benchmark runs</strong> ({suggestionData?.pricingSource === "openrouter_live" ? "OpenRouter Live Pricing" : "Cached Pricing"})
          </div>

          <div style={{ display: "flex", gap: "10px" }}>
            <button
              type="button"
              className="btn btn-secondary btn-sm"
              onClick={onClose}
            >
              Cancel
            </button>
            <button
              type="button"
              className="btn btn-primary btn-sm"
              onClick={handleApply}
              disabled={!currentProfile}
              style={{
                display: "flex",
                alignItems: "center",
                gap: "6px",
                fontWeight: 700,
              }}
            >
              <Check size={14} />
              Apply Configuration (1-Click)
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
