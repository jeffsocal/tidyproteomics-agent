import React, { useEffect, useState } from "react";
import {
  Play,
  Square,
  RotateCcw,
  ChevronDown,
  ChevronRight,
  FileText,
  Terminal,
  MessageSquare,
  CheckCircle2,
  AlertTriangle,
  Sparkles,
  Clock,
  Cpu,
  Award,
} from "lucide-react";
import { PhaseInfo, PipelineState, resolvePhaseVisualState } from "../types";
import { SegmentedProgressBar } from "./SegmentedProgressBar";
import { FollowonPhaseModal } from "./FollowonPhaseModal";

interface PipelineProgressTabProps {
  pipelineState?: PipelineState;
  focusedPhaseId?: string | null;
  onOpenFile: (relPath: string) => void;
  onOpenExperimentForm: () => void;
  onRunPhase: (phaseId: string) => void;
  onTogglePhase: (phaseId: string, enabled: boolean) => void;
  onStartPipeline: () => void;
  onStopPipeline: () => void;
  onResetPipeline: () => void;
  onConfirmGateAndResume: (phaseId: string) => void;
  onOpenPerformanceReview?: () => void;
}

export const PipelineProgressTab: React.FC<PipelineProgressTabProps> = ({
  pipelineState,
  focusedPhaseId,
  onOpenFile,
  onOpenExperimentForm,
  onRunPhase,
  onTogglePhase,
  onStartPipeline,
  onStopPipeline,
  onResetPipeline,
  onConfirmGateAndResume,
  onOpenPerformanceReview,
}) => {
  const [expandedPhases, setExpandedPhases] = useState<Record<string, boolean>>({});
  const [showFollowonModal, setShowFollowonModal] = useState(false);
  const [nowMs, setNowMs] = useState<number>(Date.now());

  const phases: PhaseInfo[] = pipelineState?.phases || [];
  const anyRunning =
    !!pipelineState?.isRunning || phases.some((p) => p && p.status === "running");
  const runningIndex =
    typeof pipelineState?.currentPhaseIndex === "number" && pipelineState.currentPhaseIndex >= 0
      ? pipelineState.currentPhaseIndex
      : phases.findIndex((p) => p && p.status === "running");

  // Auto-expand focused phase when user clicks a segment in the progress bar
  useEffect(() => {
    if (focusedPhaseId) {
      setExpandedPhases((prev) => ({ ...prev, [focusedPhaseId]: true }));
      const el = document.getElementById(`phase-row-${focusedPhaseId}`);
      if (el) {
        el.scrollIntoView({ behavior: "smooth", block: "center" });
      }
    }
  }, [focusedPhaseId]);

  // Live 1s timer when any phase is running
  useEffect(() => {
    if (!anyRunning) return;
    const timer = setInterval(() => setNowMs(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [anyRunning]);

  const toggleExpand = (phaseId: string) => {
    setExpandedPhases((prev) => ({ ...prev, [phaseId]: !prev[phaseId] }));
  };

  const expandAll = () => {
    const allOpen = phases.every((p) => expandedPhases[p.id]);
    if (allOpen) {
      setExpandedPhases({});
    } else {
      const next: Record<string, boolean> = {};
      phases.forEach((p) => (next[p.id] = true));
      setExpandedPhases(next);
    }
  };

  const totalDuration = phases.reduce((acc, p) => acc + (p.durationSeconds || 0), 0);
  const totalTurns = phases.reduce((acc, p) => acc + (p.turnCount || 0), 0);
  const totalInputTokens = pipelineState?.totalTokens?.promptTokens || 0;
  const totalCachedTokens = pipelineState?.totalTokens?.cachedPromptTokens || 0;
  const totalOutputTokens = pipelineState?.totalTokens?.completionTokens || 0;

  const formatDuration = (sec?: number) => {
    if (sec === undefined || sec === null) return "—";
    if (sec < 60) return `${sec}s`;
    const m = Math.floor(sec / 60);
    const s = sec % 60;
    return `${m}m ${s}s`;
  };

  return (
    <div style={{ padding: "16px 20px", display: "flex", flexDirection: "column", gap: "14px", height: "100%", overflow: "hidden" }}>
      {/* Top Summary Banner & Segmented Progress Bar */}
      <div
        style={{
          background: "var(--card-bg)",
          border: "1px solid var(--border)",
          borderRadius: "8px",
          padding: "12px 16px",
          display: "flex",
          flexDirection: "column",
          gap: "12px",
          flexShrink: 0,
        }}
      >
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: "10px" }}>
          <div>
            <h2 style={{ margin: 0, fontSize: "15px", fontWeight: 700, color: "var(--fg-bright)", display: "flex", alignItems: "center", gap: "8px" }}>
              <Cpu size={16} color="var(--primary)" />
              Analytical Pipeline Execution &amp; Telemetry
            </h2>
            <div style={{ fontSize: "11.5px", color: "var(--muted)", marginTop: "2px" }}>
              Click any phase row to expand its summary, quality gate status, and associated output files.
            </div>
          </div>

          <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
            <button type="button" className="btn btn-secondary btn-xs" onClick={expandAll}>
              {phases.every((p) => expandedPhases[p.id]) ? "Collapse All" : "Expand All"}
            </button>
            <button
              type="button"
              className="btn btn-secondary btn-xs"
              onClick={() => onOpenFile("docs/notes.md")}
              title="Open full runtime notes blackboard"
            >
              <FileText size={12} /> docs/notes.md
            </button>
            <button
              type="button"
              className="btn btn-secondary btn-xs"
              onClick={() => onOpenFile("logs/pipeline.md")}
              title="Open master pipeline execution log"
            >
              <Terminal size={12} /> logs/pipeline.md
            </button>
            {anyRunning ? (
              <button type="button" className="btn btn-danger btn-xs" onClick={onStopPipeline}>
                <Square size={12} /> Stop Pipeline
              </button>
            ) : (
              <button
                type="button"
                className="btn btn-success btn-xs"
                onClick={onStartPipeline}
                disabled={phases.length === 0}
              >
                <Play size={12} /> Run / Resume Pipeline
              </button>
            )}
            <button
              type="button"
              className="btn btn-secondary btn-xs"
              onClick={onResetPipeline}
              disabled={anyRunning}
              title="Reset all phases to pending"
            >
              <RotateCcw size={12} /> Reset
            </button>
          </div>
        </div>

        {/* Full-Width Segmented Progress Bar with Legend */}
        <SegmentedProgressBar
          pipelineState={pipelineState}
          onSelectPhase={(phaseId) => toggleExpand(phaseId)}
          showLegend={true}
        />

        {/* Aggregate Telemetry Strip */}
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(5, minmax(0, 1fr))",
            gap: "8px",
            borderTop: "1px solid var(--border)",
            paddingTop: "10px",
          }}
        >
          <div style={{ background: "var(--bg)", padding: "6px 10px", borderRadius: "6px", border: "1px solid var(--border)" }}>
            <div style={{ fontSize: "10px", color: "var(--muted)", textTransform: "uppercase", fontWeight: 600 }}>Total Time</div>
            <div style={{ fontSize: "14px", fontWeight: 700, color: "var(--fg-bright)", fontVariantNumeric: "tabular-nums" }}>
              {formatDuration(totalDuration)}
            </div>
          </div>
          <div style={{ background: "var(--bg)", padding: "6px 10px", borderRadius: "6px", border: "1px solid var(--border)" }}>
            <div style={{ fontSize: "10px", color: "var(--muted)", textTransform: "uppercase", fontWeight: 600 }}>Total Turns</div>
            <div style={{ fontSize: "14px", fontWeight: 700, color: "var(--primary)", fontVariantNumeric: "tabular-nums" }}>
              {totalTurns.toLocaleString()}
            </div>
          </div>
          <div style={{ background: "var(--bg)", padding: "6px 10px", borderRadius: "6px", border: "1px solid var(--border)" }}>
            <div style={{ fontSize: "10px", color: "var(--muted)", textTransform: "uppercase", fontWeight: 600 }}>Input Tokens</div>
            <div style={{ fontSize: "14px", fontWeight: 700, color: "#60a5fa", fontVariantNumeric: "tabular-nums" }}>
              {totalInputTokens.toLocaleString()}
            </div>
          </div>
          <div style={{ background: "var(--bg)", padding: "6px 10px", borderRadius: "6px", border: "1px solid var(--border)" }}>
            <div style={{ fontSize: "10px", color: "var(--muted)", textTransform: "uppercase", fontWeight: 600, display: "flex", alignItems: "center", gap: "4px" }}>
              Cached Tokens <Sparkles size={10} color="var(--cached)" />
            </div>
            <div style={{ fontSize: "14px", fontWeight: 700, color: "var(--cached)", fontVariantNumeric: "tabular-nums" }}>
              {totalCachedTokens.toLocaleString()}
            </div>
          </div>
          <div style={{ background: "var(--bg)", padding: "6px 10px", borderRadius: "6px", border: "1px solid var(--border)" }}>
            <div style={{ fontSize: "10px", color: "var(--muted)", textTransform: "uppercase", fontWeight: 600 }}>Output Tokens</div>
            <div style={{ fontSize: "14px", fontWeight: 700, color: "#34d399", fontVariantNumeric: "tabular-nums" }}>
              {totalOutputTokens.toLocaleString()}
            </div>
          </div>
        </div>

        {/* Multi-Model Token Accounting Breakdown */}
        {pipelineState?.modelTokens && Object.keys(pipelineState.modelTokens).length > 0 && (
          <div
            style={{
              borderTop: "1px dashed var(--border)",
              paddingTop: "10px",
              display: "flex",
              flexDirection: "column",
              gap: "6px",
            }}
          >
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <span style={{ fontSize: "10.5px", fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.4px", color: "var(--muted)", display: "flex", alignItems: "center", gap: "5px" }}>
                <Cpu size={12} color="var(--primary)" /> Multi-Model Token Accounting
              </span>
              <span style={{ fontSize: "10px", color: "var(--muted)" }}>
                Aggregated per model &amp; operational tier
              </span>
            </div>
            <div style={{ display: "grid", gridTemplateColumns: `repeat(${Math.max(1, Math.min(Object.keys(pipelineState.modelTokens).length, 3))}, minmax(0, 1fr))`, gap: "8px" }}>
              {Object.entries(pipelineState.modelTokens).map(([mName, item]) => (
                <div
                  key={mName}
                  style={{
                    background: "var(--bg)",
                    border: "1px solid var(--border)",
                    borderRadius: "6px",
                    padding: "6px 10px",
                    display: "flex",
                    flexDirection: "column",
                    gap: "3px",
                  }}
                >
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                    <span style={{ fontSize: "11px", fontWeight: 600, color: "var(--fg-bright)", fontFamily: "var(--font-mono)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={mName}>
                      {mName.includes("/") ? mName.split("/")[1] : mName}
                    </span>
                    <span style={{ fontSize: "9px", color: "var(--muted)", textTransform: "uppercase", letterSpacing: "0.3px" }}>
                      {item.role === "toolRunner" ? "Tool Runner (T2)" : item.role === "reasoner" ? "Reasoner (T3)" : "Utility (T1)"}
                    </span>
                  </div>
                  <div style={{ display: "flex", justifyContent: "space-between", fontSize: "10.5px", marginTop: "1px" }}>
                    <span style={{ color: "var(--muted)" }}>Total: <b style={{ color: "var(--fg-bright)", fontVariantNumeric: "tabular-nums" }}>{item.usage.totalTokens.toLocaleString()}</b></span>
                    <span style={{ color: "var(--muted)" }}>In: <span style={{ color: "#60a5fa" }}>{item.usage.promptTokens.toLocaleString()}</span></span>
                    <span style={{ color: "var(--muted)" }}>Out: <span style={{ color: "#34d399" }}>{item.usage.completionTokens.toLocaleString()}</span></span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Action Bar just above Phase Table */}
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          flexShrink: 0,
          padding: "0 2px",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
          <span style={{ fontSize: "12.5px", fontWeight: 700, color: "var(--fg-bright)", textTransform: "uppercase", letterSpacing: "0.5px" }}>
            Phase Table
          </span>
          <span style={{ fontSize: "11px", color: "var(--muted)" }}>
            ({phases.length} phases)
          </span>
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
          {onOpenPerformanceReview && (
            <button
              type="button"
              className="btn btn-primary btn-xs"
              onClick={onOpenPerformanceReview}
              title="Run autonomous LLM audit of tool usage, hypotheses, and bug attribution across all phases"
              style={{
                gap: "5px",
                background: "linear-gradient(135deg, #f59e0b, #d97706)",
                borderColor: "#b45309",
                color: "#fff",
              }}
            >
              <Award size={11} /> Performance Review
            </button>
          )}
          <button
            type="button"
            className="btn btn-primary btn-xs"
            onClick={() => setShowFollowonModal(true)}
            title="Create a new follow-on analysis phase with Tier-3 Reasoner"
            style={{ gap: "5px" }}
          >
            <Sparkles size={11} /> + Follow-on Phase
          </button>
        </div>
      </div>

      {/* Responsive Semantic Table per modern-web-guidance `responsive-table` */}
      <div
        tabIndex={0}
        role="region"
        aria-labelledby="pipeline-table-caption"
        className="table-wrapper"
        style={{ flex: "1 1 auto" }}
      >
        <table className="pipeline-table">
          <caption id="pipeline-table-caption">
            TidyProteomics Analytical Pipeline Phases, Status, Duration, Turns, Token Telemetry, and Outputs
          </caption>
          <thead>
            <tr>
              <th style={{ width: "36%" }}>Phase</th>
              <th style={{ width: "12%" }}>Status</th>
              <th style={{ width: "10%", textAlign: "right" }}>Time</th>
              <th style={{ width: "9%", textAlign: "right" }}>Turns</th>
              <th style={{ width: "13%", textAlign: "right" }}>Input Tokens</th>
              <th style={{ width: "12%", textAlign: "right" }}>Output Tokens</th>
              <th style={{ width: "8%", textAlign: "right" }}>Actions</th>
            </tr>
          </thead>
          <tbody>
            {phases.map((p, idx) => {
              const { state, label, isAttention } = resolvePhaseVisualState(
                p,
                pipelineState?.isFullPipelineRunning,
                anyRunning,
                runningIndex,
                idx
              );

              const isExpanded = !!expandedPhases[p.id];
              let shortFileName = p.fileName || `0${idx}_PHASE.md`;
              if (shortFileName.includes("/")) shortFileName = shortFileName.substring(shortFileName.lastIndexOf("/") + 1);
              if (shortFileName.toLowerCase().endsWith(".md")) shortFileName = shortFileName.slice(0, -3);

              const phaseSlug = shortFileName.toLowerCase().replace(/[^a-z0-9_]/g, "_");

              // Compute live or final duration
              let durationStr = "—";
              if (state === "running" && p.startTime) {
                const elapsed = Math.max(0, Math.round((nowMs - new Date(p.startTime).getTime()) / 1000));
                durationStr = formatDuration(elapsed);
              } else if (p.durationSeconds !== undefined) {
                durationStr = formatDuration(p.durationSeconds);
              }

              const inputTok = p.tokenUsage?.promptTokens;
              const cachedTok = p.tokenUsage?.cachedPromptTokens || 0;
              const outputTok = p.tokenUsage?.completionTokens;

              // Status color bar on left edge of row
              const statusColorMap: Record<string, string> = {
                completed: "#10b981",
                running: "#3b82f6",
                warning: "#f59e0b",
                failed: "#ef4444",
                queued: "#a855f7",
                pending: "#52525b",
              };
              const indicatorColor = statusColorMap[state] || "#52525b";

              const rowClass = `phase-row ${
                state === "running"
                  ? "row-running"
                  : state === "failed"
                  ? "row-failed"
                  : state === "warning"
                  ? "row-warning"
                  : ""
              }`;

              const assocFiles = p.associatedFiles && p.associatedFiles.length > 0
                ? p.associatedFiles
                : [
                    `analysis/${p.fileName}`,
                    `logs/${phaseSlug}/chat.md`,
                    `logs/${phaseSlug}/console.log`,
                  ];

              return (
                <React.Fragment key={p.id}>
                  <tr
                    id={`phase-row-${p.id}`}
                    className={rowClass}
                    onClick={() => toggleExpand(p.id)}
                  >
                    <th scope="row" style={{ borderLeft: `4px solid ${indicatorColor}` }}>
                      <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                        <span style={{ color: "var(--muted)", display: "inline-flex" }}>
                          {isExpanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                        </span>
                        <input
                          type="checkbox"
                          checked={p.enabled !== false}
                          disabled={anyRunning}
                          onClick={(e) => e.stopPropagation()}
                          onChange={(e) => onTogglePhase(p.id, e.target.checked)}
                          title="Include phase in pipeline execution"
                          style={{ cursor: "pointer", accentColor: "var(--primary)" }}
                        />
                        <div style={{ minWidth: 0 }}>
                          <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
                            <span style={{ fontFamily: "var(--font-mono)", fontSize: "12px", fontWeight: 700, color: "var(--fg-bright)" }}>
                              {shortFileName}
                            </span>
                            {p.model && (
                              <span
                                style={{
                                  fontSize: "9.5px",
                                  color: "var(--muted)",
                                  fontFamily: "var(--font-mono)",
                                  background: "rgba(255, 255, 255, 0.05)",
                                  padding: "1px 5px",
                                  borderRadius: "3px",
                                  border: "1px solid var(--border)",
                                }}
                                title={`Executed with ${p.model} (${p.role || "standard"})`}
                              >
                                {p.model.includes("/") ? p.model.split("/")[1] : p.model}
                              </span>
                            )}
                          </div>
                          <div style={{ fontSize: "11px", color: "var(--muted)", fontWeight: 400, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", maxWidth: "380px" }}>
                            {p.title.replace(/^Phase\s+\d+[a-z]?:\s*/i, "")}
                          </div>
                        </div>
                      </div>
                    </th>

                    <td>
                      <span className={`badge badge-${state}`}>{label}</span>
                    </td>

                    <td style={{ textAlign: "right", fontFamily: "var(--font-mono)", color: state === "running" ? "#60a5fa" : "var(--fg)" }}>
                      {durationStr}
                    </td>

                    <td style={{ textAlign: "right", fontFamily: "var(--font-mono)" }}>
                      {p.turnCount !== undefined ? p.turnCount : "—"}
                    </td>

                    <td style={{ textAlign: "right", fontFamily: "var(--font-mono)" }}>
                      {inputTok !== undefined ? (
                        <div>
                          <span>{inputTok.toLocaleString()}</span>
                          {cachedTok > 0 && (
                            <div style={{ fontSize: "9.5px", color: "#c084fc" }}>
                              ({cachedTok.toLocaleString()} cached)
                            </div>
                          )}
                        </div>
                      ) : (
                        "—"
                      )}
                    </td>

                    <td style={{ textAlign: "right", fontFamily: "var(--font-mono)" }}>
                      {outputTok !== undefined ? outputTok.toLocaleString() : "—"}
                    </td>

                    <td style={{ textAlign: "right" }} onClick={(e) => e.stopPropagation()}>
                      <div style={{ display: "inline-flex", alignItems: "center", gap: "4px" }}>
                        <button
                          type="button"
                          className="btn btn-secondary btn-xs"
                          title={`Open chat trace (logs/${phaseSlug}/chat.md)`}
                          onClick={() => onOpenFile(`logs/${phaseSlug}/chat.md`)}
                        >
                          <MessageSquare size={11} />
                        </button>
                        <button
                          type="button"
                          className="btn btn-secondary btn-xs"
                          title={`Open console log (logs/${phaseSlug}/console.log)`}
                          onClick={() => onOpenFile(`logs/${phaseSlug}/console.log`)}
                        >
                          <Terminal size={11} />
                        </button>
                        <button
                          type="button"
                          className="btn btn-secondary btn-xs"
                          disabled={anyRunning}
                          title={`Run ${shortFileName} in isolation`}
                          onClick={() => onRunPhase(p.id)}
                        >
                          <Play size={11} />
                        </button>
                      </div>
                    </td>
                  </tr>

                  {/* Expandable Detail Row: Summary + Clickable Associated Files */}
                  {isExpanded && (
                    <tr>
                      <td
                        colSpan={7}
                        style={{
                          background: "#151519",
                          padding: "14px 18px",
                          borderLeft: `4px solid ${indicatorColor}`,
                          borderBottom: "1px solid var(--border-strong)",
                        }}
                      >
                        <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
                          {/* Phase Summary or Gate Alert */}
                          <div>
                            <div
                              style={{
                                fontSize: "10.5px",
                                fontWeight: 700,
                                textTransform: "uppercase",
                                letterSpacing: "0.4px",
                                color: isAttention
                                  ? "var(--warning)"
                                  : state === "failed"
                                  ? "var(--error)"
                                  : "var(--muted)",
                                marginBottom: "6px",
                                display: "flex",
                                alignItems: "center",
                                gap: "6px",
                              }}
                            >
                              {isAttention ? (
                                <>
                                  <AlertTriangle size={13} color="var(--warning)" /> Human-in-the-Loop Gate / Action Required
                                </>
                              ) : state === "completed" ? (
                                <>
                                  <CheckCircle2 size={13} color="var(--success)" /> Phase Execution Summary
                                </>
                              ) : (
                                <>
                                  <Clock size={13} /> Phase Details
                                </>
                              )}
                            </div>

                            <div
                              style={{
                                background: isAttention
                                  ? "rgba(245, 158, 11, 0.08)"
                                  : state === "failed"
                                  ? "rgba(239, 68, 68, 0.08)"
                                  : "var(--card-bg)",
                                border: `1px solid ${
                                  isAttention
                                    ? "rgba(245, 158, 11, 0.35)"
                                    : state === "failed"
                                    ? "rgba(239, 68, 68, 0.35)"
                                    : "var(--border)"
                                }`,
                                borderRadius: "6px",
                                padding: "10px 12px",
                                fontSize: "12.5px",
                                lineHeight: 1.55,
                                color: "var(--fg)",
                                whiteSpace: "pre-wrap",
                              }}
                            >
                              {p.summary ||
                                p.error ||
                                (state === "running"
                                  ? "Phase is currently executing..."
                                  : "Phase has not been executed yet. Click Run to start.")}

                              {(isAttention || state === "failed") && (
                                <div style={{ display: "flex", gap: "8px", marginTop: "10px", flexWrap: "wrap" }}>
                                  {isAttention && (
                                    <button
                                      type="button"
                                      className="btn btn-success btn-xs"
                                      onClick={() => onConfirmGateAndResume(p.id)}
                                    >
                                      <Sparkles size={12} /> Confirm Study Design &amp; Proceed
                                    </button>
                                  )}
                                  <button
                                    type="button"
                                    className="btn btn-secondary btn-xs"
                                    onClick={onOpenExperimentForm}
                                  >
                                    Edit Experiment Form (docs/experiment.md) ↗
                                  </button>
                                  <button
                                    type="button"
                                    className="btn btn-secondary btn-xs"
                                    disabled={anyRunning}
                                    onClick={() => onRunPhase(p.id)}
                                  >
                                    <RotateCcw size={12} /> Retry Phase
                                  </button>
                                </div>
                              )}
                            </div>
                          </div>

                          {/* Associated Files to Click */}
                          <div>
                            <div
                              style={{
                                fontSize: "10.5px",
                                fontWeight: 700,
                                textTransform: "uppercase",
                                letterSpacing: "0.4px",
                                color: "var(--muted)",
                                marginBottom: "6px",
                              }}
                            >
                              Associated Phase Files (Click to Open in Viewer)
                            </div>
                            <div style={{ display: "flex", flexWrap: "wrap", gap: "6px" }}>
                              {assocFiles.map((fileRel) => (
                                <button
                                  key={fileRel}
                                  type="button"
                                  className="file-pill"
                                  onClick={() => onOpenFile(fileRel)}
                                  title={`Open ${fileRel} in Main Viewer`}
                                >
                                  <FileText size={12} />
                                  {fileRel}
                                </button>
                              ))}
                            </div>
                          </div>

                          {/* Last Phase Callout: Performance Review */}
                          {idx === phases.length - 1 && onOpenPerformanceReview && (
                            <div
                              style={{
                                marginTop: "12px",
                                padding: "12px 14px",
                                background: "rgba(245, 158, 11, 0.08)",
                                border: "1px solid rgba(245, 158, 11, 0.3)",
                                borderRadius: "8px",
                                display: "flex",
                                justifyContent: "space-between",
                                alignItems: "center",
                                gap: "12px",
                              }}
                            >
                              <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
                                <Award size={20} color="var(--warning)" />
                                <div>
                                  <div style={{ fontSize: "12.5px", fontWeight: 700, color: "var(--fg-bright)" }}>
                                    Pipeline Performance Review
                                  </div>
                                  <div style={{ fontSize: "11px", color: "var(--muted)", marginTop: "2px" }}>
                                    Prompt Tier-3 Reasoner to audit all logs: evaluate tool execution, user interaction, biological hypotheses, and attribute bugs to LLM, Prompt, or Tools.
                                  </div>
                                </div>
                              </div>
                              <button
                                type="button"
                                className="btn btn-primary btn-xs"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  onOpenPerformanceReview();
                                }}
                                style={{
                                  display: "inline-flex",
                                  alignItems: "center",
                                  gap: "6px",
                                  background: "linear-gradient(135deg, #f59e0b, #d97706)",
                                  borderColor: "#b45309",
                                  color: "#fff",
                                  fontWeight: 600,
                                  flexShrink: 0,
                                }}
                              >
                                <Award size={12} /> Performance Review
                              </button>
                            </div>
                          )}
                        </div>
                      </td>
                    </tr>
                  )}
                </React.Fragment>
              );
            })}
          </tbody>
        </table>
      </div>

      {showFollowonModal && (
        <FollowonPhaseModal
          pipelineState={pipelineState}
          onClose={() => setShowFollowonModal(false)}
          onRunPhase={(phaseId) => {
            if (onRunPhase) onRunPhase(phaseId);
          }}
        />
      )}
    </div>
  );
};

