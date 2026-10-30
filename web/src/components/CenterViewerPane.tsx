import React from "react";
import { FlaskConical, Activity, FileText, Settings, X, BarChart3 } from "lucide-react";
import { AppConfig, ExperimentSpec, FileTreeNode, LiteratureViewState, McpStatus, PipelineState, ViewerTab } from "../types";
import { ExperimentFormTab } from "./ExperimentFormTab";
import { PipelineProgressTab } from "./PipelineProgressTab";
import { MarkdownViewer } from "./MarkdownViewer";
import { SettingsTab } from "./SettingsTab";
import { AIEvaluationTab } from "./AIEvaluationTab";

interface CenterViewerPaneProps {
  tabs: ViewerTab[];
  activeTabId: string;
  onSelectTab: (tabId: string) => void;
  onCloseTab: (tabId: string) => void;
  onOpenFile: (relPath: string) => void;
  experimentSpec?: ExperimentSpec;
  experimentRaw: string;
  fileTree: FileTreeNode[];
  pipelineState?: PipelineState;
  focusedPhaseId?: string | null;
  config?: AppConfig;
  mcpStatus?: McpStatus;
  literatureState?: LiteratureViewState;
  onRefreshLiteratureState?: () => Promise<void>;
  onUpdateConfig?: (patch: Partial<AppConfig>) => Promise<void>;
  onSelectWorkspace?: (dir: string) => Promise<void>;
  onInitWorkspace?: (
    dir: string,
    pipelineId: "differential_expression" | "quality_control_only"
  ) => Promise<void>;
  onReconnectMcp?: () => Promise<void>;
  onSaveExperimentForm: (patch: Partial<ExperimentSpec>) => Promise<void>;
  onSaveExperimentRaw: (raw: string) => Promise<void>;
  onConfirmAndProceed: (contrasts?: string[], phaseId?: string) => Promise<void>;
  onRunPhase: (phaseId: string) => void;
  onTogglePhase: (phaseId: string, enabled: boolean) => void;
  onStartPipeline: () => void;
  onStopPipeline: () => void;
  onResetPipeline: () => void;
  onOpenPerformanceReview?: () => void;
}

export const CenterViewerPane: React.FC<CenterViewerPaneProps> = ({
  tabs,
  activeTabId,
  onSelectTab,
  onCloseTab,
  onOpenFile,
  experimentSpec,
  experimentRaw,
  fileTree,
  pipelineState,
  focusedPhaseId,
  config,
  mcpStatus,
  literatureState,
  onRefreshLiteratureState,
  onUpdateConfig,
  onSelectWorkspace,
  onInitWorkspace,
  onReconnectMcp,
  onSaveExperimentForm,
  onSaveExperimentRaw,
  onConfirmAndProceed,
  onRunPhase,
  onTogglePhase,
  onStartPipeline,
  onStopPipeline,
  onResetPipeline,
  onOpenPerformanceReview,
}) => {
  const activeTab = tabs.find((t) => t.id === activeTabId) || tabs[0];

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", overflow: "hidden" }}>
      {/* Tab Bar */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          background: "#141418",
          borderBottom: "1px solid var(--border)",
          minHeight: "42px",
          padding: "0 8px",
          gap: "4px",
          overflowX: "auto",
          flexShrink: 0,
        }}
      >
        {tabs.map((tab) => {
          const isActive = tab.id === activeTab?.id;
          return (
            <div
              key={tab.id}
              onClick={() => onSelectTab(tab.id)}
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: "7px",
                padding: "7px 12px",
                borderRadius: "6px 6px 0 0",
                fontSize: "12px",
                fontWeight: isActive ? 700 : 500,
                cursor: "pointer",
                background: isActive ? "var(--panel-bg)" : "transparent",
                color: isActive ? "var(--fg-bright)" : "var(--muted)",
                borderTop: isActive ? "2px solid var(--primary)" : "2px solid transparent",
                borderLeft: isActive ? "1px solid var(--border)" : "1px solid transparent",
                borderRight: isActive ? "1px solid var(--border)" : "1px solid transparent",
                userSelect: "none",
                whiteSpace: "nowrap",
                transition: "all 0.12s ease",
              }}
            >
              {tab.kind === "experiment" ? (
                <FlaskConical size={13} color={isActive ? "var(--primary)" : "currentColor"} />
              ) : tab.kind === "progress" ? (
                <Activity size={13} color={isActive ? "var(--success)" : "currentColor"} />
              ) : tab.kind === "evaluation" ? (
                <BarChart3 size={13} color={isActive ? "#60a5fa" : "currentColor"} />
              ) : tab.kind === "settings" ? (
                <Settings size={13} color={isActive ? "var(--warning)" : "currentColor"} />
              ) : (
                <FileText size={13} color={isActive ? "#60a5fa" : "currentColor"} />
              )}
              <span>{tab.title}</span>
              {!tab.pinned && (
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    onCloseTab(tab.id);
                  }}
                  style={{
                    background: "transparent",
                    border: "none",
                    color: "var(--muted)",
                    padding: "1px",
                    cursor: "pointer",
                    display: "inline-flex",
                    borderRadius: "3px",
                  }}
                  title="Close tab"
                >
                  <X size={12} />
                </button>
              )}
            </div>
          );
        })}
      </div>

      {/* Tab Content Panes (Core workspace tabs preserved in DOM across switching) */}
      <div style={{ flex: "1 1 auto", overflow: "hidden", display: "flex", flexDirection: "column", position: "relative" }}>
        <div style={{ display: activeTab?.kind === "experiment" ? "flex" : "none", height: "100%", width: "100%", flexDirection: "column", overflow: "hidden" }}>
          <ExperimentFormTab
            spec={experimentSpec}
            rawMarkdown={experimentRaw}
            fileTree={fileTree}
            onSaveForm={onSaveExperimentForm}
            onSaveRaw={onSaveExperimentRaw}
            onConfirmAndProceed={onConfirmAndProceed}
          />
        </div>
        <div style={{ display: activeTab?.kind === "progress" ? "flex" : "none", height: "100%", width: "100%", flexDirection: "column", overflow: "hidden" }}>
          <PipelineProgressTab
            pipelineState={pipelineState}
            focusedPhaseId={focusedPhaseId}
            onOpenFile={onOpenFile}
            onOpenExperimentForm={() => onSelectTab("experiment")}
            onRunPhase={onRunPhase}
            onTogglePhase={onTogglePhase}
            onStartPipeline={onStartPipeline}
            onStopPipeline={onStopPipeline}
            onResetPipeline={onResetPipeline}
            onConfirmGateAndResume={(phaseId) => onConfirmAndProceed(undefined, phaseId)}
            onOpenPerformanceReview={onOpenPerformanceReview}
          />
        </div>
        <div style={{ display: activeTab?.kind === "evaluation" ? "flex" : "none", height: "100%", width: "100%", flexDirection: "column", overflow: "hidden" }}>
          <AIEvaluationTab onOpenFile={onOpenFile} />
        </div>
        <div style={{ display: activeTab?.kind === "settings" ? "flex" : "none", height: "100%", width: "100%", flexDirection: "column", overflow: "hidden" }}>
          <SettingsTab
            config={config}
            mcpStatus={mcpStatus}
            literatureState={literatureState}
            onOpenFile={onOpenFile}
            onRefreshLiteratureState={onRefreshLiteratureState}
            onUpdateConfig={onUpdateConfig || (async () => {})}
            onSelectWorkspace={onSelectWorkspace || (async () => {})}
            onInitWorkspace={onInitWorkspace || (async () => {})}
            onReconnectMcp={onReconnectMcp || (async () => {})}
            onOpenPerformanceReview={onOpenPerformanceReview}
          />
        </div>
        {activeTab?.relPath && (
          <div style={{ display: "flex", height: "100%", width: "100%", flexDirection: "column", overflow: "hidden" }}>
            <MarkdownViewer relPath={activeTab.relPath} onOpenFile={onOpenFile} />
          </div>
        )}
      </div>
    </div>
  );
};

