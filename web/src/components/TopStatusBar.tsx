import React, { useEffect, useState } from "react";
import { Clock, Folder, FlaskConical, BookOpen, Bot, Cpu, Sparkles, AlertCircle } from "lucide-react";
import { AppConfig, ExperimentSpec, FileTreeNode, LiteratureViewState, McpStatus, PipelineState } from "../types";
import { SegmentedProgressBar } from "./SegmentedProgressBar";

export interface TopStatusBarProps {
  pipelineState?: PipelineState;
  config?: AppConfig;
  mcpStatus?: McpStatus;
  experimentSpec?: ExperimentSpec;
  literatureState?: LiteratureViewState;
  fileTree?: FileTreeNode[];
  onSelectPhaseSegment: (phaseId: string) => void;
  onSendMessage?: (text: string) => void;
  onOpenSettings: (section?: "workspace" | "provider" | "mcp") => void;
  onOpenLibrary: () => void;
  onOpenExperiment: () => void;
}

export const TopStatusBar: React.FC<TopStatusBarProps> = ({
  pipelineState,
  config,
  mcpStatus,
  experimentSpec,
  literatureState,
  fileTree,
  onSelectPhaseSegment,
  onSendMessage,
  onOpenSettings,
  onOpenLibrary,
  onOpenExperiment,
}) => {
  const phases = pipelineState?.phases || [];
  const anyRunning =
    Boolean(pipelineState?.isRunning) || phases.some((p) => p && p.status === "running");

  // Live timer tick for total pipeline time while any phase is active
  const [nowMs, setNowMs] = useState<number>(Date.now());
  useEffect(() => {
    if (!anyRunning) return;
    setNowMs(Date.now());
    const interval = setInterval(() => setNowMs(Date.now()), 1000);
    return () => clearInterval(interval);
  }, [anyRunning]);

  // Real-time active total duration: completed phase durations + active elapsed seconds of currently running phase
  const totalDuration = phases.reduce((acc, p) => {
    if (p.status === "running") {
      const activeElapsed = p.startTime
        ? Math.max(0, Math.round((nowMs - new Date(p.startTime).getTime()) / 1000))
        : (p.durationSeconds || 0);
      return acc + activeElapsed;
    }
    return acc + (p.durationSeconds || 0);
  }, 0);

  const formatDuration = (sec?: number) => {
    if (sec === undefined || sec === null || sec < 0) return "0s";
    if (sec < 60) return `${sec}s`;
    const m = Math.floor(sec / 60);
    const s = sec % 60;
    return `${m}m ${s}s`;
  };

  // Readiness Calculations
  // 1. Workspace: Configured and contains analysis directory / files
  const isWorkspaceReady = Boolean(
    config?.workspaceRoot &&
    config.workspaceRoot.trim() !== "" &&
    !pipelineState?.isAnalysisMissingOrEmpty
  );
  const workspaceTooltip = isWorkspaceReady
    ? `Workspace Ready: ${config?.workspaceRoot || "Configured"} • Click to view settings`
    : `Workspace Attention: ${!config?.workspaceRoot ? "No directory selected" : "Analysis directory uninitialized"} • Click to configure`;

  // 2. Experiments: docs/experiment.md exists with data file, no missing initial fields, and no pending HITL checkpoints
  const isExperimentInitialReady = Boolean(
    experimentSpec?.exists &&
    experimentSpec.pathToDataFile &&
    experimentSpec.pathToDataFile.trim() !== "" &&
    (!experimentSpec.missingInitialFields || experimentSpec.missingInitialFields.length === 0)
  );

  const hasPreliminaryData = Boolean(
    (experimentSpec?.rawSampleGroups && experimentSpec.rawSampleGroups.length > 0) ||
    (experimentSpec?.discoveredGroups && experimentSpec.discoveredGroups.length > 0)
  );

  const isBatchConfoundingIssue = Boolean(
    experimentSpec?.batchConfoundingDetected
  );

  // Section 3 study design subtasks needing confirmation / input
  const needs3A = hasPreliminaryData && !experimentSpec?.discoveredGroupsConfirmed;
  const needs3B = !experimentSpec?.normalizationConfirmed;
  const needs3C = !experimentSpec?.imputationConfirmed;
  const needs3D = hasPreliminaryData && !experimentSpec?.samplePoolingConfirmed;
  const hasValidContrast = Boolean(
    experimentSpec?.targetContrasts &&
    experimentSpec.targetContrasts.length > 0 &&
    experimentSpec.contrastConfirmed
  );
  const needs3E = hasPreliminaryData && (!experimentSpec?.contrastConfirmed || !hasValidContrast);
  const needs3F = isBatchConfoundingIssue && !experimentSpec?.batchConfoundingAuthorized;

  const isOrganismPending =
    !experimentSpec?.annotationTaxonId ||
    /pending|unknown|none|required|^$/i.test(experimentSpec.annotationTaxonId.trim()) ||
    experimentSpec.annotationTaxonId.includes("(") ||
    experimentSpec.annotationTaxonId.includes("<");

  const hasTargetOrganism = Boolean(hasPreliminaryData && !isOrganismPending);

  const needs3G = experimentSpec?.annotationSource === "none"
    ? false
    : experimentSpec?.annotationSource === "file"
      ? (hasPreliminaryData && !experimentSpec?.annotationConfirmed)
      : (hasTargetOrganism && !experimentSpec?.annotationConfirmed);

  const hitlHaltedPhase = phases.find((p) => {
    if (!p) return false;
    if (p.status === "awaiting_hitl") return true;
    const errText = String(p.error || p.summary || "").trim();
    return /human-in-the-loop|hitl|study design gate|confirmation required|section 3/i.test(errText);
  });

  const pendingHitlItems: string[] = [];
  if (needs3A) pendingHitlItems.push("3.A Discovered Groups");
  if (needs3B) pendingHitlItems.push("3.B Normalization");
  if (needs3C) pendingHitlItems.push("3.C Imputation");
  if (needs3D) pendingHitlItems.push("3.D Sample Pooling");
  if (needs3E) pendingHitlItems.push("3.E Contrasts");
  if (needs3F) pendingHitlItems.push("3.F Batch Confounding");
  if (needs3G) pendingHitlItems.push("3.G Annotation Strategy");

  const isHitlEngaged = Boolean(
    pendingHitlItems.length > 0 && (hitlHaltedPhase || hasPreliminaryData)
  );

  const isExperimentReady = isExperimentInitialReady && !isHitlEngaged;

  const experimentTooltip = !isExperimentInitialReady
    ? `Experiments Incomplete: ${!experimentSpec?.exists
      ? "docs/experiment.md missing"
      : !experimentSpec?.pathToDataFile
        ? "Missing data file path"
        : "Missing fields: " + (experimentSpec.missingInitialFields || []).join(", ")
    } • Click to configure`
    : isHitlEngaged
      ? `HITL Checkpoint Active: Human-in-the-loop confirmation required in docs/experiment.md (${pendingHitlItems.join(", ") || hitlHaltedPhase?.fileName || "Study Design Gate"}) • Click to review & confirm`
      : `Experiments Ready: Data file defined (${experimentSpec?.pathToDataFile}) • All study design parameters confirmed • Click to view setup`;

  // Local bypass state synchronization
  const [localBypass, setLocalBypass] = useState<boolean>(() => {
    try {
      return localStorage.getItem("tpa-literature-bypass") === "true";
    } catch (_) {
      return false;
    }
  });

  useEffect(() => {
    const handleBypassChange = (e: Event) => {
      const customEvent = e as CustomEvent<{ bypass: boolean }>;
      if (typeof customEvent.detail?.bypass === "boolean") {
        setLocalBypass(customEvent.detail.bypass);
      }
    };
    window.addEventListener("tpa-literature-bypass-change", handleBypassChange);
    return () => window.removeEventListener("tpa-literature-bypass-change", handleBypassChange);
  }, []);

  // 3. Literature: Has indexed literature database or studies, or explicitly bypassed
  const isLiteratureBypassed = Boolean(
    literatureState?.bypassLiterature ||
    literatureState?.config?.bypassLiterature ||
    localBypass
  );
  const hasStudies = Boolean(
    literatureState?.stats &&
    ((literatureState.stats.studies ?? 0) > 0 ||
      (literatureState.stats.study_count ?? 0) > 0 ||
      (literatureState.stats.assertions ?? 0) > 0)
  );
  const hasDatabases = Boolean(literatureState?.databases && literatureState.databases.length > 0);
  const hasActiveDb = Boolean(literatureState?.activeLiterature);
  const isLiteratureReady = Boolean(hasActiveDb && (hasStudies || hasDatabases));

  const literatureTooltip = isLiteratureBypassed
    ? `Literature Corroboration Bypassed: Pipeline proceeds without literature corpus (Non-blocking) • Click to open Library`
    : isLiteratureReady
      ? `Literature Ready: Database '${literatureState?.activeLiterature}' active & engaged for Phase 11 synthesis • Click to view library`
      : `Literature Attention: No active literature database or papers indexed. Either ingest papers or toggle 'Bypass' in Library • Click to configure`;

  // 4. LLM Provider: Provider selected, model chosen, API key present (or ollama)
  const isProviderOllama = config?.provider === "ollama";
  const hasApiKey = Boolean(config?.apiKey && config.apiKey.trim().length > 0);
  const hasModel = Boolean(config?.model && config.model.trim().length > 0);
  const isLlmProviderReady = Boolean(
    config?.provider && hasModel && (isProviderOllama || hasApiKey)
  );
  const providerTooltip = isLlmProviderReady
    ? `LLM Ready: ${config?.provider} (${config?.model}) • Click to view settings`
    : `LLM Attention: ${!config?.provider
      ? "No provider selected"
      : !hasModel
        ? "No model selected"
        : "API key required"
    } • Click to configure`;

  // 5. MCP Engine: Connected and tools loaded
  const isMcpReady = Boolean(mcpStatus?.connected && (mcpStatus.toolsCount ?? 0) > 0);
  const mcpTooltip = isMcpReady
    ? `MCP Ready: Connected (${mcpStatus?.toolsCount} tools loaded) • Click to view settings`
    : `MCP Disconnected: ${mcpStatus?.error || "tidyproteomics MCP offline"} • Click to reconnect`;

  // Click Handlers (directly navigates to respective UI section without chat prompting)
  const handleWorkspaceClick = () => {
    onOpenSettings("workspace");
  };

  const handleExperimentClick = () => {
    onOpenExperiment();
  };

  const handleLiteratureClick = () => {
    onOpenLibrary();
  };

  const handleProviderClick = () => {
    onOpenSettings("provider");
  };

  const handleMcpClick = () => {
    onOpenSettings("mcp");
  };

  return (
    <div
      className="top-pipeline-status-bar"
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        background: "var(--card-bg)",
        borderBottom: "1px solid var(--border)",
        padding: "8px 16px",
        gap: "14px",
        flexShrink: 0,
        minHeight: "46px",
        overflowX: "auto",
        width: "100%",
        boxSizing: "border-box",
      }}
    >
      {/* 1. App Title Brand */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: "8px",
          paddingRight: "14px",
          borderRight: "1px solid var(--border)",
          flexShrink: 0,
        }}
      >
        <Sparkles size={16} color="var(--primary)" />
        <span
          style={{
            fontWeight: 800,
            fontSize: "13.5px",
            color: "var(--fg-bright)",
            letterSpacing: "0.2px",
          }}
        >
          tidyproteomics-agent
        </span>
        <span
          style={{
            fontSize: "9.5px",
            color: "var(--muted)",
            background: "rgba(255, 255, 255, 0.05)",
            padding: "1px 5px",
            borderRadius: "3px",
            border: "1px solid var(--border)",
            fontWeight: 600,
          }}
        >
          v1.0
        </span>
      </div>

      {/* 2. Status Indicators [Workspace] [Experiments] [Literature] [LLM] [MCP] */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: "6px",
          flexShrink: 0,
          paddingRight: "14px",
          borderRight: "1px solid var(--border)",
        }}
      >
        {/* [Workspace] */}
        <button
          type="button"
          onClick={handleWorkspaceClick}
          title={workspaceTooltip}
          aria-label={workspaceTooltip}
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: "5px",
            padding: "4px 8px",
            borderRadius: "5px",
            border: isWorkspaceReady ? "1px solid var(--border)" : "1px solid var(--attention-orange-border)",
            background: isWorkspaceReady ? "rgba(255, 255, 255, 0.03)" : "var(--attention-orange-bg)",
            color: "var(--fg-bright)",
            fontSize: "11px",
            fontWeight: 600,
            cursor: "pointer",
            transition: "all 0.15s ease",
            whiteSpace: "nowrap",
          }}
          className="status-indicator-btn"
        >
          <span
            style={{
              width: "7px",
              height: "7px",
              borderRadius: "50%",
              backgroundColor: isWorkspaceReady ? "#10b981" : "var(--attention-orange)",
              boxShadow: isWorkspaceReady
                ? "0 0 5px rgba(16, 185, 129, 0.6)"
                : "0 0 5px var(--attention-orange)",
              flexShrink: 0,
            }}
          />
          <Folder size={12} color="var(--muted)" />
          <span>Workspace</span>
        </button>

        {/* [Experiments] */}
        <button
          type="button"
          onClick={handleExperimentClick}
          title={experimentTooltip}
          aria-label={experimentTooltip}
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: "5px",
            padding: "4px 8px",
            borderRadius: "5px",
            border: isExperimentReady
              ? "1px solid var(--border)"
              : isHitlEngaged
                ? "1.5px solid var(--attention-orange)"
                : "1px solid var(--attention-orange-border)",
            background: isExperimentReady ? "rgba(255, 255, 255, 0.03)" : "var(--attention-orange-bg)",
            color: isHitlEngaged ? "var(--attention-orange-light)" : "var(--fg-bright)",
            fontSize: "11px",
            fontWeight: 600,
            cursor: "pointer",
            transition: "all 0.15s ease",
            whiteSpace: "nowrap",
            boxShadow: isHitlEngaged ? "0 0 8px rgba(249, 115, 22, 0.35)" : "none",
          }}
          className={`status-indicator-btn ${isHitlEngaged ? "hitl-highlight-orange" : ""}`}
        >
          <span
            style={{
              width: "7px",
              height: "7px",
              borderRadius: "50%",
              backgroundColor: isExperimentReady ? "#10b981" : "var(--attention-orange)",
              boxShadow: isExperimentReady
                ? "0 0 5px rgba(16, 185, 129, 0.6)"
                : "0 0 7px var(--attention-orange)",
              flexShrink: 0,
            }}
          />
          {isHitlEngaged ? (
            <AlertCircle size={12} color="var(--attention-orange)" />
          ) : (
            <FlaskConical size={12} color="var(--muted)" />
          )}
          <span>{isHitlEngaged ? "Experiments (HITL Action Required)" : "Experiments"}</span>
          {isHitlEngaged && pendingHitlItems.length > 0 && (
            <span
              style={{
                fontSize: "9px",
                background: "var(--attention-orange)",
                color: "#fff",
                padding: "1px 5px",
                borderRadius: "10px",
                fontWeight: 800,
                marginLeft: "2px",
              }}
            >
              {pendingHitlItems.length}
            </span>
          )}
        </button>

        {/* [Literature] */}
        <button
          type="button"
          onClick={handleLiteratureClick}
          title={literatureTooltip}
          aria-label={literatureTooltip}
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: "5px",
            padding: "4px 8px",
            borderRadius: "5px",
            border: isLiteratureBypassed
              ? "1px solid var(--border)"
              : isLiteratureReady
                ? "1px solid var(--border)"
                : "1px solid var(--attention-orange-border)",
            background: isLiteratureBypassed
              ? "rgba(255, 255, 255, 0.02)"
              : isLiteratureReady
                ? "rgba(255, 255, 255, 0.03)"
                : "var(--attention-orange-bg)",
            color: isLiteratureBypassed ? "var(--muted)" : "var(--fg-bright)",
            fontSize: "11px",
            fontWeight: 600,
            cursor: "pointer",
            transition: "all 0.15s ease",
            whiteSpace: "nowrap",
          }}
          className="status-indicator-btn"
        >
          <span
            style={{
              width: "7px",
              height: "7px",
              borderRadius: "50%",
              backgroundColor: isLiteratureBypassed
                ? "#71717a"
                : isLiteratureReady
                  ? "#10b981"
                  : "var(--attention-orange)",
              boxShadow: isLiteratureBypassed
                ? "none"
                : isLiteratureReady
                  ? "0 0 5px rgba(16, 185, 129, 0.6)"
                  : "0 0 5px var(--attention-orange)",
              flexShrink: 0,
            }}
          />
          <BookOpen size={12} color="var(--muted)" />
          <span>{isLiteratureBypassed ? "Literature (Bypassed)" : "Literature"}</span>
        </button>

        {/* [LLM] */}
        <button
          type="button"
          onClick={handleProviderClick}
          title={providerTooltip}
          aria-label={providerTooltip}
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: "5px",
            padding: "4px 8px",
            borderRadius: "5px",
            border: isLlmProviderReady ? "1px solid var(--border)" : "1px solid var(--attention-orange-border)",
            background: isLlmProviderReady ? "rgba(255, 255, 255, 0.03)" : "var(--attention-orange-bg)",
            color: "var(--fg-bright)",
            fontSize: "11px",
            fontWeight: 600,
            cursor: "pointer",
            transition: "all 0.15s ease",
            whiteSpace: "nowrap",
          }}
          className="status-indicator-btn"
        >
          <span
            style={{
              width: "7px",
              height: "7px",
              borderRadius: "50%",
              backgroundColor: isLlmProviderReady ? "#10b981" : "var(--attention-orange)",
              boxShadow: isLlmProviderReady
                ? "0 0 5px rgba(16, 185, 129, 0.6)"
                : "0 0 5px var(--attention-orange)",
              flexShrink: 0,
            }}
          />
          <Bot size={12} color="var(--muted)" />
          <span>LLM</span>
        </button>

        {/* [MCP] */}
        <button
          type="button"
          onClick={handleMcpClick}
          title={mcpTooltip}
          aria-label={mcpTooltip}
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: "5px",
            padding: "4px 8px",
            borderRadius: "5px",
            border: isMcpReady ? "1px solid var(--border)" : "1px solid var(--attention-orange-border)",
            background: isMcpReady ? "rgba(255, 255, 255, 0.03)" : "var(--attention-orange-bg)",
            color: "var(--fg-bright)",
            fontSize: "11px",
            fontWeight: 600,
            cursor: "pointer",
            transition: "all 0.15s ease",
            whiteSpace: "nowrap",
          }}
          className="status-indicator-btn"
        >
          <span
            style={{
              width: "7px",
              height: "7px",
              borderRadius: "50%",
              backgroundColor: isMcpReady ? "#10b981" : "var(--attention-orange)",
              boxShadow: isMcpReady
                ? "0 0 5px rgba(16, 185, 129, 0.6)"
                : "0 0 5px var(--attention-orange)",
              flexShrink: 0,
            }}
          />
          <Cpu size={12} color="var(--muted)" />
          <span>MCP</span>
        </button>
      </div>

      {/* 3. Middle: Visual PIPELINE PROGRESS Segmented Bar */}
      <div
        style={{
          flex: "1 1 auto",
          minWidth: "180px",
          display: "flex",
          flexDirection: "column",
          justifyContent: "center",
        }}
      >
        <SegmentedProgressBar
          pipelineState={pipelineState}
          onSelectPhase={onSelectPhaseSegment}
          showLegend={false}
          isHitlPending={isHitlEngaged}
        />
      </div>

      {/* 4. Total Time */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: "8px",
          flexShrink: 0,
          paddingLeft: "12px",
          borderLeft: "1px solid var(--border)",
        }}
        title={`Total pipeline execution duration across all phases: ${formatDuration(totalDuration)}`}
      >
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            width: "28px",
            height: "28px",
            borderRadius: "6px",
            background: anyRunning
              ? "rgba(59, 130, 246, 0.12)"
              : isHitlEngaged
                ? "var(--attention-orange-bg)"
                : "rgba(255, 255, 255, 0.04)",
            border: anyRunning
              ? "1px solid rgba(59, 130, 246, 0.35)"
              : isHitlEngaged
                ? "1px solid var(--attention-orange-border)"
                : "1px solid var(--border)",
            color: anyRunning
              ? "var(--primary)"
              : isHitlEngaged
                ? "var(--attention-orange)"
                : "var(--muted)",
          }}
        >
          <Clock size={14} />
        </div>
        <div style={{ display: "flex", flexDirection: "column", lineHeight: 1.15 }}>
          <span
            style={{
              fontSize: "9.5px",
              color: isHitlEngaged ? "var(--attention-orange)" : "var(--muted)",
              textTransform: "uppercase",
              fontWeight: 700,
              letterSpacing: "0.4px",
            }}
          >
            {isHitlEngaged ? "Paused (HITL)" : "Total Time"}
          </span>
          <span
            style={{
              fontSize: "13px",
              fontWeight: 700,
              color: anyRunning
                ? "var(--primary)"
                : isHitlEngaged
                  ? "var(--attention-orange)"
                  : "var(--fg-bright)",
              fontVariantNumeric: "tabular-nums",
            }}
          >
            {formatDuration(totalDuration)}
          </span>
        </div>
      </div>
    </div>
  );
};

