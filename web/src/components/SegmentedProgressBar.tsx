import React from "react";
import { PhaseInfo, PipelineState, resolvePhaseVisualState } from "../types";

interface SegmentedProgressBarProps {
  pipelineState?: PipelineState;
  onSelectPhase?: (phaseId: string) => void;
  showLegend?: boolean;
}

export const SegmentedProgressBar: React.FC<SegmentedProgressBarProps> = ({
  pipelineState,
  onSelectPhase,
  showLegend = false,
}) => {
  const phases: PhaseInfo[] = pipelineState?.phases || [];
  const anyRunning =
    !!pipelineState?.isRunning || phases.some((p) => p && p.status === "running");
  const runningIndex =
    typeof pipelineState?.currentPhaseIndex === "number" && pipelineState.currentPhaseIndex >= 0
      ? pipelineState.currentPhaseIndex
      : phases.findIndex((p) => p && p.status === "running");

  if (phases.length === 0) {
    return (
      <div className="pipeline-progress-container" title="No pipeline phases initialized">
        <div className="progress-bar-track">
          <div className="progress-segment segment-pending" style={{ opacity: 0.35 }} />
        </div>
      </div>
    );
  }

  const completedCount = phases.filter((p) => p.status === "completed").length;

  return (
    <div className="pipeline-progress-container">
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          fontSize: "10px",
          color: "var(--muted)",
          marginBottom: "4px",
        }}
      >
        <span style={{ fontWeight: 600, letterSpacing: "0.3px" }}>
          PIPELINE PROGRESS ({completedCount}/{phases.length})
        </span>
        {anyRunning && runningIndex >= 0 && phases[runningIndex] ? (
          <span style={{ color: "#60a5fa", fontWeight: 600 }}>
            ▶ {phases[runningIndex].fileName.replace(/\.md$/i, "")}
            {phases[runningIndex].turnCount ? ` (Turn ${phases[runningIndex].turnCount})` : ""}
          </span>
        ) : (
          <span>Click segment for details</span>
        )}
      </div>
      <div className="progress-bar-track" role="progressbar" aria-valuemin={0} aria-valuemax={phases.length} aria-valuenow={completedCount}>
        {phases.map((p, idx) => {
          const { state, label } = resolvePhaseVisualState(
            p,
            pipelineState?.isFullPipelineRunning,
            anyRunning,
            runningIndex,
            idx
          );

          let taskName = p.fileName || `Task ${idx + 1}`;
          if (taskName.includes("/")) taskName = taskName.substring(taskName.lastIndexOf("/") + 1);
          if (taskName.toLowerCase().endsWith(".md")) taskName = taskName.slice(0, -3);

          const dur = p.durationSeconds ? ` • ${p.durationSeconds}s` : "";
          const turns = p.turnCount ? ` • ${p.turnCount} turns` : "";
          const tokens = p.tokenUsage?.totalTokens
            ? ` • ${p.tokenUsage.totalTokens.toLocaleString()} tok`
            : "";
          const tooltip = `${taskName} [${label}]${dur}${turns}${tokens}`;

          return (
            <button
              key={p.id}
              type="button"
              className={`progress-segment segment-${state}`}
              title={tooltip}
              aria-label={tooltip}
              onClick={() => onSelectPhase && onSelectPhase(p.id)}
            />
          );
        })}
      </div>
      {showLegend && (
        <div
          style={{
            display: "flex",
            gap: "12px",
            marginTop: "6px",
            fontSize: "10px",
            color: "var(--muted)",
            flexWrap: "wrap",
          }}
        >
          <span style={{ display: "inline-flex", alignItems: "center", gap: "4px" }} title="Phase completed successfully">
            <span style={{ width: 8, height: 8, borderRadius: 2, background: "#10b981" }} /> Completed
          </span>
          <span style={{ display: "inline-flex", alignItems: "center", gap: "4px" }} title="Phase currently running">
            <span style={{ width: 8, height: 8, borderRadius: 2, background: "#3b82f6" }} /> Running
          </span>
          <span style={{ display: "inline-flex", alignItems: "center", gap: "4px" }} title="Needs researcher confirmation or input">
            <span style={{ width: 8, height: 8, borderRadius: 2, background: "#f59e0b" }} /> Needs Attention
          </span>
          <span style={{ display: "inline-flex", alignItems: "center", gap: "4px" }} title="Phase failed or encountered an error">
            <span style={{ width: 8, height: 8, borderRadius: 2, background: "#ef4444" }} /> Failed
          </span>
          <span style={{ display: "inline-flex", alignItems: "center", gap: "4px" }} title="Queued to execute automatically in active pipeline sequence">
            <span style={{ width: 8, height: 8, borderRadius: 2, background: "#a855f7" }} /> Queued
          </span>
          <span style={{ display: "inline-flex", alignItems: "center", gap: "4px" }} title="Idle unstarted phase">
            <span style={{ width: 8, height: 8, borderRadius: 2, background: "#52525b" }} /> Pending
          </span>
        </div>
      )}
    </div>
  );
};

