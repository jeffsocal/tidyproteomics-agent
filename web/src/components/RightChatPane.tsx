import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  Play,
  Square,
  Send,
  Trash2,
  Sparkles,
  Terminal,
  ChevronDown,
  ChevronRight,
  Bot,
  User,
  CheckCircle2,
  AlertTriangle,
  History,
  Plus,
  Search,
  X,
  Clock,
  ExternalLink,
} from "lucide-react";
import { marked } from "marked";
import {
  AgentMessage,
  ChatSessionSearchResult,
  ChatSessionSummary,
  PipelineState,
  resolvePhaseVisualState,
} from "../types";
import { SegmentedProgressBar } from "./SegmentedProgressBar";

interface RightChatPaneProps {
  pipelineState?: PipelineState;
  messages: AgentMessage[];
  activeChatSessionId?: string;
  chatSessions?: ChatSessionSummary[];
  isGenerating: boolean;
  streamingText: string;
  logs: string[];
  onSendMessage: (text: string) => void;
  onStopChat: () => void;
  onClearChat: () => void;
  onNewChat?: () => void;
  onLoadChat?: (sessionId: string) => void;
  onSearchChats?: (query: string) => Promise<ChatSessionSearchResult[]>;
  onStartPipeline: () => void;
  onStopPipeline: () => void;
  onSelectPhaseSegment: (phaseId: string) => void;
  onOpenFile: (relPath: string) => void;
  onOpenExperimentForm: () => void;
}

export function stripTimestamp(line: string): string {
  if (!line) return "";
  return line
    .replace(/^\[\d{1,2}:\d{2}(?::\d{2})?(?:\s*(?:AM|PM))?\]\s*/i, "")
    .replace(/^\[\d{4}-\d{2}-\d{2}[^\]]+\]\s*/i, "");
}

function parseMarkdownSafe(text: string): string {
  try {
    return marked.parse(text, { breaks: true, gfm: true }) as string;
  } catch {
    return text;
  }
}

interface ExecutionStep {
  id: string;
  raw: string;
  clean: string;
  isCommand: boolean;
  isSuccess: boolean;
  isError: boolean;
  phaseId?: string;
}

export const RightChatPane: React.FC<RightChatPaneProps> = ({
  pipelineState,
  messages,
  activeChatSessionId = "chat_00",
  chatSessions = [],
  isGenerating,
  streamingText,
  logs,
  onSendMessage,
  onStopChat,
  onClearChat,
  onNewChat,
  onLoadChat,
  onSearchChats,
  onStartPipeline,
  onStopPipeline,
  onSelectPhaseSegment,
  onOpenFile,
  onOpenExperimentForm,
}) => {
  const [input, setInput] = useState("");
  const [expandedClusters, setExpandedClusters] = useState<Record<string, boolean>>({});
  const [showHistoryModal, setShowHistoryModal] = useState(false);
  const [historySearchQuery, setHistorySearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState<ChatSessionSearchResult[] | null>(null);
  const [isSearching, setIsSearching] = useState(false);

  const threadRef = useRef<HTMLDivElement | null>(null);

  const phases = pipelineState?.phases || [];
  const anyRunning =
    !!pipelineState?.isRunning || phases.some((p) => p && p.status === "running");
  const runningPhase = phases.find((p) => p && p.status === "running");

  let overallBadge = { label: "IDLE", cls: "badge-completed" };
  if (anyRunning) {
    overallBadge = { label: "RUNNING", cls: "badge-running" };
  } else if (phases.some((p) => resolvePhaseVisualState(p).state === "warning")) {
    overallBadge = { label: "ATTENTION", cls: "badge-warning" };
  } else if (phases.some((p) => p.status === "failed")) {
    overallBadge = { label: "FAILED", cls: "badge-failed" };
  } else if (phases.length > 0 && phases.every((p) => !p.enabled || p.status === "completed")) {
    overallBadge = { label: "COMPLETE", cls: "badge-completed" };
  }

  // Auto-scroll stream to bottom when content changes
  useEffect(() => {
    if (threadRef.current) {
      threadRef.current.scrollTop = threadRef.current.scrollHeight;
    }
  }, [messages, streamingText, isGenerating, logs.length]);

  // Handle history search
  useEffect(() => {
    const q = historySearchQuery.trim();
    if (!q) {
      setSearchResults(null);
      setIsSearching(false);
      return;
    }

    const timer = setTimeout(async () => {
      setIsSearching(true);
      if (onSearchChats) {
        try {
          const res = await onSearchChats(q);
          setSearchResults(res);
        } catch {
          setSearchResults([]);
        } finally {
          setIsSearching(false);
        }
      } else {
        // Fallback client-side filter
        const matched = chatSessions.filter(
          (s) =>
            s.id.toLowerCase().includes(q.toLowerCase()) ||
            s.title.toLowerCase().includes(q.toLowerCase())
        );
        setSearchResults(
          matched.map((s) => ({
            ...s,
            matches: [s.title],
          }))
        );
        setIsSearching(false);
      }
    }, 250);

    return () => clearTimeout(timer);
  }, [historySearchQuery, chatSessions, onSearchChats]);

  const handleSend = (textOverride?: string) => {
    const prompt = (textOverride ?? input).trim();
    if (!prompt || isGenerating) return;
    if (!textOverride) setInput("");
    onSendMessage(prompt);
  };

  const handleChipClick = (chip: string) => {
    if (chip === "Review docs/experiment.md ↗" || chip === "View docs/experiment.md ↗") {
      onOpenExperimentForm();
    } else if (
      chip === "Review docs/manuscript.md ↗" ||
      chip === "View docs/manuscript.md ↗" ||
      chip === "Review docs/scientific_report.md ↗"
    ) {
      onOpenFile("docs/manuscript.md");
    } else {
      handleSend(chip);
    }
  };

  const toggleCluster = (clusterId: string) => {
    setExpandedClusters((prev) => ({
      ...prev,
      [clusterId]: !prev[clusterId],
    }));
  };

  // Group execution logs by phase
  const { phaseExecutionLogs, pipelineExecutionLogs } = useMemo(() => {
    const pLogs: Record<string, ExecutionStep[]> = {};
    const genLogs: ExecutionStep[] = [];

    logs.forEach((raw, idx) => {
      const clean = stripTimestamp(raw);
      if (!clean) return;

      const isCommand = clean.includes("[Command]") || clean.includes("[Execute]");
      const isSuccess =
        clean.includes("✓") || clean.includes("[completed]") || clean.includes("PASS");
      const isError =
        clean.includes("❌") || clean.includes("failed") || clean.includes("[Error]");

      const phaseMatch = clean.match(/(?:Phase\s+(\d+|[a-zA-Z0-9_-]+)|([0-9]{2}_[a-zA-Z0-9_-]+))/i);
      const phaseId = phaseMatch ? phaseMatch[1] || phaseMatch[2] : undefined;

      const step: ExecutionStep = {
        id: `step_${idx}`,
        raw,
        clean,
        isCommand,
        isSuccess,
        isError,
        phaseId,
      };

      if (phaseId) {
        if (!pLogs[phaseId]) pLogs[phaseId] = [];
        pLogs[phaseId].push(step);
      } else {
        genLogs.push(step);
      }
    });

    return { phaseExecutionLogs: pLogs, pipelineExecutionLogs: genLogs };
  }, [logs]);

  // Helper to determine if an assistant message is a Human-In-The-Loop Checkpoint
  const isHitlCheckpoint = (m: AgentMessage) => {
    if (m.role !== "assistant") return false;
    if (m.id.startsWith("msg_halt_")) return true;
    if (
      m.quickChips &&
      m.quickChips.some(
        (c) =>
          c.includes("Confirm") ||
          c.includes("Authorize") ||
          c.includes("Proceed") ||
          c.includes("Review")
      )
    ) {
      return true;
    }
    const txt = m.content.toLowerCase();
    return (
      txt.includes("human in the loop") ||
      txt.includes("action required") ||
      txt.includes("study design review") ||
      txt.includes("pipeline paused") ||
      txt.includes("batch confounding alert") ||
      txt.includes("imputation strategy confirmation")
    );
  };

  // Track rendered phases to avoid duplicate demarcation
  const renderedPhaseDemarcations = new Set<string>();

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", overflow: "hidden", position: "relative" }}>
      {/* Top Header: Session & Agent Status + Pipeline Controls */}
      <div className="pane-header" style={{ position: "relative", zIndex: 10 }}>
        <div style={{ display: "flex", alignItems: "center", gap: "6px", minWidth: 0 }}>
          <span
            style={{
              width: 8,
              height: 8,
              borderRadius: "50%",
              background: isGenerating || anyRunning ? "var(--primary)" : "var(--success)",
              boxShadow:
                isGenerating || anyRunning ? "0 0 8px rgba(59, 130, 246, 0.8)" : "none",
            }}
          />
          <span className="pane-title" style={{ fontSize: "11.5px" }}>
            Agent &amp; Live Pipeline
          </span>
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: "5px" }}>
          {/* History / Search Button */}
          <button
            type="button"
            className={`btn btn-xs ${showHistoryModal ? "btn-secondary" : ""}`}
            style={{ padding: "3px 6px" }}
            onClick={() => setShowHistoryModal(!showHistoryModal)}
            title="Search & Look Back on Past Chat Sessions"
          >
            <History size={11} />
            <span style={{ fontSize: "10px" }}>History</span>
          </button>

          {/* New Chat Button */}
          {onNewChat && (
            <button
              type="button"
              className="btn btn-xs"
              style={{ padding: "3px 6px" }}
              onClick={() => {
                setShowHistoryModal(false);
                onNewChat();
              }}
              title="Start New Agent Chat Session"
            >
              <Plus size={11} />
              <span style={{ fontSize: "10px" }}>New</span>
            </button>
          )}

          {/* Run / Stop Pipeline Button */}
          {anyRunning ? (
            <button type="button" className="btn btn-danger btn-xs" onClick={onStopPipeline}>
              <Square size={11} /> Stop
            </button>
          ) : (
            <button
              type="button"
              className="btn btn-success btn-xs"
              onClick={onStartPipeline}
              disabled={phases.length === 0}
            >
              <Play size={11} /> Run
            </button>
          )}
          <span className={`badge ${overallBadge.cls}`}>{overallBadge.label}</span>
        </div>
      </div>

      {/* 2nd Topmost Item: Pipeline Progress Segmented Bar */}
      <div
        style={{
          padding: "6px 10px 8px 10px",
          borderBottom: "1px solid var(--border)",
          background: "#141418",
          flexShrink: 0,
        }}
      >
        <SegmentedProgressBar
          pipelineState={pipelineState}
          onSelectPhase={onSelectPhaseSegment}
          showLegend={false}
        />
      </div>

      {/* Chat History & Search Popover Overlay */}
      {showHistoryModal && (
        <div className="stream-history-dropdown">
          <div
            style={{
              padding: "8px 10px",
              borderBottom: "1px solid var(--border)",
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              background: "#141418",
            }}
          >
            <div style={{ display: "flex", alignItems: "center", gap: "6px", fontSize: "11px", fontWeight: 700 }}>
              <History size={12} color="var(--primary)" />
              <span>Chat Sessions &amp; History</span>
            </div>
            <button
              type="button"
              className="btn btn-xs"
              style={{ background: "transparent", border: "none", padding: "2px" }}
              onClick={() => setShowHistoryModal(false)}
            >
              <X size={12} />
            </button>
          </div>

          {/* Search bar inside history popover */}
          <div style={{ padding: "6px 8px", borderBottom: "1px solid var(--border)", background: "#16161b" }}>
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: "6px",
                background: "var(--bg)",
                border: "1px solid var(--border-strong)",
                borderRadius: "4px",
                padding: "3px 8px",
              }}
            >
              <Search size={11} color="var(--muted)" />
              <input
                type="text"
                placeholder="Search past conversations & notes..."
                value={historySearchQuery}
                onChange={(e) => setHistorySearchQuery(e.target.value)}
                style={{
                  background: "transparent",
                  border: "none",
                  outline: "none",
                  color: "var(--fg)",
                  fontSize: "11px",
                  width: "100%",
                }}
              />
              {historySearchQuery && (
                <button
                  type="button"
                  style={{ background: "transparent", border: "none", padding: 0, cursor: "pointer", color: "var(--muted)" }}
                  onClick={() => setHistorySearchQuery("")}
                >
                  <X size={11} />
                </button>
              )}
            </div>
          </div>

          {/* Sessions List / Search Results */}
          <div style={{ overflowY: "auto", flex: "1 1 auto", maxHeight: "240px" }}>
            {isSearching && (
              <div style={{ padding: "12px", textAlign: "center", color: "var(--muted)", fontSize: "11px" }}>
                Searching chat history...
              </div>
            )}

            {!isSearching && searchResults !== null && (
              <>
                {searchResults.length === 0 ? (
                  <div style={{ padding: "12px", textAlign: "center", color: "var(--muted)", fontSize: "11px" }}>
                    No matching chat records found for &ldquo;{historySearchQuery}&rdquo;
                  </div>
                ) : (
                  searchResults.map((sr) => (
                    <div
                      key={sr.id}
                      className={`stream-history-item ${sr.id === activeChatSessionId ? "active" : ""}`}
                      onClick={() => {
                        setShowHistoryModal(false);
                        if (onLoadChat) onLoadChat(sr.id);
                      }}
                    >
                      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                        <span style={{ fontWeight: 700, fontSize: "11px", color: "#60a5fa" }}>
                          {sr.filename}
                        </span>
                        {sr.id === activeChatSessionId && (
                          <span className="badge badge-completed" style={{ fontSize: "8.5px" }}>
                            CURRENT
                          </span>
                        )}
                      </div>
                      <div style={{ fontSize: "10.5px", color: "var(--fg-bright)", fontWeight: 500 }}>
                        {sr.title}
                      </div>
                      {sr.matches && sr.matches.length > 0 && (
                        <div style={{ fontSize: "10px", color: "var(--muted)", fontStyle: "italic" }}>
                          &ldquo;{sr.matches[0]}&rdquo;
                        </div>
                      )}
                    </div>
                  ))
                )}
              </>
            )}

            {!isSearching && searchResults === null && (
              <>
                {chatSessions.length === 0 ? (
                  <div style={{ padding: "12px", textAlign: "center", color: "var(--muted)", fontSize: "11px" }}>
                    No saved chats in <code>logs/agent/</code>
                  </div>
                ) : (
                  chatSessions.map((s) => (
                    <div
                      key={s.id}
                      className={`stream-history-item ${s.id === activeChatSessionId ? "active" : ""}`}
                      onClick={() => {
                        setShowHistoryModal(false);
                        if (onLoadChat) onLoadChat(s.id);
                      }}
                    >
                      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                        <span style={{ fontWeight: 700, fontSize: "11px", color: "#60a5fa" }}>
                          {s.filename}
                        </span>
                        <div style={{ display: "flex", alignItems: "center", gap: "4px" }}>
                          <span style={{ fontSize: "9.5px", color: "var(--muted)" }}>
                            {s.messageCount} msg{s.messageCount === 1 ? "" : "s"}
                          </span>
                          {s.id === activeChatSessionId && (
                            <span className="badge badge-completed" style={{ fontSize: "8.5px" }}>
                              ACTIVE
                            </span>
                          )}
                        </div>
                      </div>
                      <div style={{ fontSize: "10.5px", color: "var(--fg)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                        {s.title || "Consultative Chat Session"}
                      </div>
                    </div>
                  ))
                )}
              </>
            )}
          </div>

          {/* History footer: start new session button */}
          <div
            style={{
              padding: "6px 8px",
              borderTop: "1px solid var(--border)",
              background: "#141418",
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
            }}
          >
            <span style={{ fontSize: "9.5px", color: "var(--muted)" }}>
              Saved to <code>logs/agent/chat_XX.md</code>
            </span>
            {onNewChat && (
              <button
                type="button"
                className="btn btn-xs btn-primary"
                style={{ fontSize: "10px", padding: "2px 7px" }}
                onClick={() => {
                  setShowHistoryModal(false);
                  onNewChat();
                }}
              >
                <Plus size={10} /> Start New Chat
              </button>
            )}
          </div>
        </div>
      )}

      {/* Real-Time Reasoning & Execution Stream (The Unified Main Body) */}
      <div
        ref={threadRef}
        className="stream-container"
        style={{
          flex: "1 1 auto",
          overflowY: "auto",
          padding: "8px 10px",
          display: "flex",
          flexDirection: "column",
          gap: "5px",
        }}
      >
        {/* Welcome / Onboarding Card if no messages */}
        {messages.length === 0 && !streamingText && (
          <div className="stream-agent-bubble chat-bubble-pending">
            <div className="stream-bubble-header">
              <span style={{ display: "inline-flex", alignItems: "center", gap: "6px", color: "var(--fg-bright)" }}>
                <Bot size={13} color="#f97316" />
                <span>TidyProteomics Agent</span>
              </span>
              <span className="hitl-highlight-badge" style={{ fontSize: "8.5px" }}>
                SETUP NEEDED
              </span>
            </div>
            <div className="stream-bubble-content">
              Describe your experiment or analysis target in plain English, or configure parameters via the{" "}
              <b>Experiment Setup</b> tab. I will update <code>docs/experiment.md</code> and execute the analytical pipeline with phrased summaries for every turn.
            </div>
          </div>
        )}

        {/* Global / Pipeline Lifecycle execution cluster if any exist before phases */}
        {pipelineExecutionLogs.length > 0 && (
          <div className="stream-execution-cluster">
            <div
              className="stream-cluster-header"
              onClick={() => toggleCluster("pipeline_cluster")}
            >
              <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
                {expandedClusters["pipeline_cluster"] ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
                <Terminal size={11} color="var(--terminal-fg)" />
                <span style={{ fontWeight: 600 }}>
                  Pipeline Orchestrator Stream ({pipelineExecutionLogs.length} {pipelineExecutionLogs.length === 1 ? "action" : "actions"})
                </span>
              </div>
              <span className="badge badge-completed" style={{ fontSize: "8.5px" }}>
                ✓ Logged
              </span>
            </div>
            {expandedClusters["pipeline_cluster"] && (
              <div className="stream-cluster-body">
                {pipelineExecutionLogs.map((st) => (
                  <div key={st.id} className="stream-cluster-line">
                    {st.clean}
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Render Feed Items */}
        {messages.map((m, idx) => {
          const isUser = m.role === "user";

          // 1. Phase Demarcation + Clustered Execution Steps
          if (m.type === "milestone" && (m.content.includes("▶") || m.id.startsWith("msg_start_"))) {
            const phaseId = m.phaseId || "00";
            const phaseTitle = m.phaseTitle || "Pipeline Phase";
            renderedPhaseDemarcations.add(phaseId);
            const clusterKey = `cluster_phase_${phaseId}`;
            const execSteps = phaseExecutionLogs[phaseId] || [];
            const isPhaseRunning = runningPhase?.id === phaseId;
            const isClusterExpanded =
              expandedClusters[clusterKey] !== undefined
                ? expandedClusters[clusterKey]
                : isPhaseRunning;

            return (
              <React.Fragment key={m.id}>
                {/* Horizontal line break indicating new phase */}
                <hr className="stream-phase-divider" />
                {/* Beginning of Phase Demarcation */}
                <div className="stream-phase-demarcation">
                  <span className="stream-phase-pill">PHASE {phaseId}</span>
                  <span className="stream-phase-title">{phaseTitle}</span>
                  {isPhaseRunning ? (
                    <span className="badge badge-running" style={{ fontSize: "8.5px", marginLeft: "auto" }}>
                      RUNNING
                    </span>
                  ) : (
                    <span className="badge badge-completed" style={{ fontSize: "8.5px", marginLeft: "auto" }}>
                      ACTIVE
                    </span>
                  )}
                </div>

                {/* Clustered Execution Steps for this Phase */}
                {execSteps.length > 0 && (
                  <div className="stream-execution-cluster">
                    <div
                      className="stream-cluster-header"
                      onClick={() => toggleCluster(clusterKey)}
                    >
                      <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
                        {isClusterExpanded ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
                        <Terminal size={11} color="var(--terminal-fg)" />
                        <span style={{ fontWeight: 600 }}>
                          Execution Steps ({execSteps.length} {execSteps.length === 1 ? "action" : "actions"})
                        </span>
                      </div>
                      {isPhaseRunning ? (
                        <span className="badge badge-running" style={{ fontSize: "8.5px" }}>
                          Running...
                        </span>
                      ) : (
                        <span className="badge badge-completed" style={{ fontSize: "8.5px" }}>
                          ✓ Complete
                        </span>
                      )}
                    </div>
                    {isClusterExpanded && (
                      <div className="stream-cluster-body">
                        {execSteps.map((st) => (
                          <div key={st.id} className="stream-cluster-line">
                            {st.clean}
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </React.Fragment>
            );
          }

          // 2. Phase Completed Milestone (Clean, unboxed)
          if (m.type === "milestone") {
            const phaseId = m.phaseId;
            const execSteps = phaseId ? phaseExecutionLogs[phaseId] || [] : [];
            const clusterKey = `cluster_phase_${phaseId}`;
            const shouldRenderClusterHere =
              phaseId && !renderedPhaseDemarcations.has(phaseId) && execSteps.length > 0;

            return (
              <React.Fragment key={m.id}>
                {shouldRenderClusterHere && (
                  <div className="stream-execution-cluster">
                    <div
                      className="stream-cluster-header"
                      onClick={() => toggleCluster(clusterKey)}
                    >
                      <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
                        {expandedClusters[clusterKey] ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
                        <Terminal size={11} color="var(--terminal-fg)" />
                        <span style={{ fontWeight: 600 }}>
                          Execution Steps ({execSteps.length} {execSteps.length === 1 ? "action" : "actions"})
                        </span>
                      </div>
                      <span className="badge badge-completed" style={{ fontSize: "8.5px" }}>
                        ✓ Complete
                      </span>
                    </div>
                    {expandedClusters[clusterKey] && (
                      <div className="stream-cluster-body">
                        {execSteps.map((st) => (
                          <div key={st.id} className="stream-cluster-line">
                            {st.clean}
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )}

                <div key={m.id} className="stream-milestone-line">
                  <CheckCircle2 size={13} color="var(--success)" style={{ flexShrink: 0 }} />
                  <span style={{ fontWeight: 600, color: "var(--fg-bright)" }}>
                    {m.content.replace(/^✓\s*\*\*/, "").replace(/\*\*$/, "")}
                  </span>
                  {m.quickChips && m.quickChips.length > 0 && (
                    <div style={{ display: "flex", flexWrap: "wrap", gap: "5px", marginLeft: "auto" }}>
                      {m.quickChips.map((chip) => (
                        <button
                          key={chip}
                          type="button"
                          className="file-pill"
                          style={{ fontSize: "10px" }}
                          onClick={() => handleChipClick(chip)}
                        >
                          {chip}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              </React.Fragment>
            );
          }

          // 3. LLM Turn Phrased Summary (Clean, unboxed)
          if (m.type === "activity") {
            const isTurnRunning = m.badge === "In Progress" && runningPhase?.id === m.phaseId;
            return (
              <div key={m.id} className="stream-turn-line">
                {isTurnRunning ? (
                  <span className="stream-turn-spinner" />
                ) : (
                  <span className="stream-turn-bullet">✓</span>
                )}
                <span className="stream-turn-text">{m.content}</span>
                {m.timestamp && <span className="stream-turn-time">{m.timestamp}</span>}
              </div>
            );
          }

          // 4. Scientific Observation Line (Clean, unboxed)
          if (m.type === "observation") {
            return (
              <div key={m.id} className="stream-observation-line">
                <Sparkles size={12} color="#a855f7" style={{ flexShrink: 0, marginTop: "2px" }} />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div
                    className="stream-observation-text"
                    dangerouslySetInnerHTML={{ __html: parseMarkdownSafe(m.content) }}
                  />
                  {m.quickChips && m.quickChips.length > 0 && (
                    <div style={{ display: "flex", flexWrap: "wrap", gap: "5px", marginTop: "4px" }}>
                      {m.quickChips.map((chip) => (
                        <button
                          key={chip}
                          type="button"
                          className="file-pill"
                          style={{ fontSize: "10px" }}
                          onClick={() => handleChipClick(chip)}
                        >
                          {chip}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            );
          }

          // 5. User Request Card / Chat Bubble
          if (isUser) {
            return (
              <div key={m.id} className="stream-user-bubble">
                <div className="stream-bubble-header">
                  <div style={{ display: "flex", alignItems: "center", gap: "5px" }}>
                    <User size={11} color="#93c5fd" />
                    <span style={{ fontWeight: 700, color: "#93c5fd" }}>You</span>
                  </div>
                  {m.timestamp && <span className="stream-bubble-time">{m.timestamp}</span>}
                </div>
                <div className="stream-bubble-content" style={{ whiteSpace: "pre-wrap" }}>
                  {m.content}
                </div>
              </div>
            );
          }

          // 6. Agent Message Chat Bubble (HITL Checkpoints & Consultative Messages)
          const isHitl = isHitlCheckpoint(m);
          // Check if user has responded to this message
          const hasSubsequentUserMessage = messages.slice(idx + 1).some((other) => other.role === "user");
          const isPhaseDone = m.phaseId
            ? phases.some((p) => p.id === m.phaseId && p.status === "completed")
            : false;
          const hasUserResponded = hasSubsequentUserMessage || isPhaseDone;

          const bubbleCls = hasUserResponded
            ? "stream-agent-bubble chat-bubble-responded"
            : "stream-agent-bubble chat-bubble-pending";

          return (
            <div key={m.id} className={bubbleCls}>
              <div className="stream-bubble-header">
                <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
                  {isHitl ? (
                    <AlertTriangle size={13} color={hasUserResponded ? "var(--muted)" : "#f97316"} />
                  ) : (
                    <Bot size={13} color={hasUserResponded ? "var(--muted)" : "var(--primary)"} />
                  )}
                  <span style={{ fontWeight: 700, color: hasUserResponded ? "var(--fg)" : "var(--fg-bright)" }}>
                    {isHitl ? "HUMAN-IN-THE-LOOP CHECKPOINT" : "TidyProteomics Agent"}
                  </span>
                </div>
                <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
                  {isHitl && (
                    hasUserResponded ? (
                      <span className="badge badge-completed" style={{ fontSize: "8.5px" }}>
                        RESOLVED
                      </span>
                    ) : (
                      <span className="hitl-highlight-badge" style={{ fontSize: "8.5px" }}>
                        ACTION REQUIRED
                      </span>
                    )
                  )}
                  {m.timestamp && <span className="stream-bubble-time">{m.timestamp}</span>}
                </div>
              </div>

              <div
                className="stream-bubble-content"
                dangerouslySetInnerHTML={{ __html: parseMarkdownSafe(m.content) }}
              />

              {m.quickChips && m.quickChips.length > 0 && (
                <div style={{ display: "flex", flexWrap: "wrap", gap: "6px", marginTop: "4px" }}>
                  {m.quickChips.map((chip) => (
                    <button
                      key={chip}
                      type="button"
                      className="btn btn-xs"
                      style={{
                        fontSize: "11px",
                        fontWeight: 600,
                        background:
                          !hasUserResponded && (chip.includes("Confirm") || chip.includes("Authorize") || chip.includes("Proceed") || chip.includes("Yes"))
                            ? "var(--primary)"
                            : "rgba(255, 255, 255, 0.08)",
                        color: "#fff",
                        border: "1px solid var(--border-strong)",
                        opacity: hasUserResponded ? 0.75 : 1,
                      }}
                      onClick={() => handleChipClick(chip)}
                    >
                      {chip}
                    </button>
                  ))}
                </div>
              )}
            </div>
          );
        })}

        {/* Streaming text bubble while agent is speaking */}
        {streamingText && (
          <div className="stream-agent-bubble chat-bubble-pending">
            <div className="stream-bubble-header">
              <span style={{ display: "inline-flex", alignItems: "center", gap: "6px", color: "var(--fg-bright)" }}>
                <Bot size={13} color="#f97316" />
                <span>TidyProteomics Agent • Speaking...</span>
              </span>
              <span className="hitl-highlight-badge" style={{ fontSize: "8.5px" }}>
                GENERATING
              </span>
            </div>
            <div className="stream-bubble-content" style={{ whiteSpace: "pre-wrap" }}>
              {streamingText}▋
            </div>
          </div>
        )}
      </div>

      {/* Bottom Area: Chat Input + Segmented Progress Bar */}
      <div
        style={{
          padding: "8px 10px 10px 10px",
          borderTop: "1px solid var(--border)",
          background: "#16161a",
          display: "flex",
          flexDirection: "column",
          gap: "8px",
          flexShrink: 0,
        }}
      >
        {/* User Chat Input Box */}
        <div
          style={{
            background: "var(--bg)",
            border: "1px solid var(--border-strong)",
            borderRadius: "6px",
            padding: "6px 8px",
            display: "flex",
            flexDirection: "column",
            gap: "6px",
          }}
        >
          <textarea
            style={{
              width: "100%",
              background: "transparent",
              border: "none",
              color: "var(--fg-bright)",
              fontFamily: "inherit",
              fontSize: "12px",
              resize: "none",
              outline: "none",
              minHeight: "42px",
              maxHeight: "110px",
            }}
            placeholder="Ask the agent, configure contrasts, or type instructions... (Enter to send)"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                handleSend();
              }
            }}
          />
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <button
              type="button"
              className="btn btn-secondary btn-xs"
              onClick={onClearChat}
              title="Clear active chat messages"
            >
              <Trash2 size={11} /> Clear
            </button>
            {isGenerating ? (
              <button type="button" className="btn btn-danger btn-xs" onClick={onStopChat}>
                <Square size={11} /> Stop Agent
              </button>
            ) : (
              <button
                type="button"
                className="btn btn-xs"
                onClick={() => handleSend()}
                disabled={!input.trim()}
              >
                <Send size={11} /> Send
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
