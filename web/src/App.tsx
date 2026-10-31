import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  AgentMessage,
  AppConfig,
  ChatSessionSearchResult,
  ChatSessionSummary,
  ExperimentSpec,
  FileTreeNode,
  LiteratureViewState,
  McpStatus,
  PipelineState,
  ViewerTab,
} from "./types";
import { LeftProjectPane } from "./components/LeftProjectPane";
import { CenterViewerPane } from "./components/CenterViewerPane";
import { RightChatPane } from "./components/RightChatPane";
import { PerformanceReviewModal } from "./components/PerformanceReviewModal";

const PINNED_TABS: ViewerTab[] = [
  {
    id: "experiment",
    title: "Experiment Setup",
    kind: "experiment",
    pinned: true,
  },
  {
    id: "progress",
    title: "Pipeline Progress",
    kind: "progress",
    pinned: true,
  },
  {
    id: "evaluation",
    title: "AI Evaluation",
    kind: "evaluation",
    pinned: true,
  },
  {
    id: "settings",
    title: "Settings",
    kind: "settings",
    pinned: false,
  },
];

export const App: React.FC = () => {
  // 15% / 60% / 25% width designation ([project main] / [viewer] / [chat])
  const [leftPct, setLeftPct] = useState<number>(15);
  const [rightPct, setRightPct] = useState<number>(25);
  const draggingSide = useRef<"left" | "right" | null>(null);

  // Core application state
  const [config, setConfig] = useState<AppConfig | undefined>(undefined);
  const [pipelineState, setPipelineState] = useState<PipelineState | undefined>(undefined);
  const [isBenchmarkRunning, setIsBenchmarkRunning] = useState<boolean>(false);
  const [mcpStatus, setMcpStatus] = useState<McpStatus | undefined>(undefined);
  const [literatureState, setLiteratureState] = useState<LiteratureViewState | undefined>(undefined);
  const [fileTree, setFileTree] = useState<FileTreeNode[]>([]);
  const [experimentSpec, setExperimentSpec] = useState<ExperimentSpec | undefined>(undefined);
  const [experimentRaw, setExperimentRaw] = useState<string>("");

  // Agent chat & console logs
  const [messages, setMessages] = useState<AgentMessage[]>([]);
  const [activeChatSessionId, setActiveChatSessionId] = useState<string>("chat_00");
  const [chatSessions, setChatSessions] = useState<ChatSessionSummary[]>([]);
  const [isGenerating, setIsGenerating] = useState<boolean>(false);
  const [streamingText, setStreamingText] = useState<string>("");
  const [logs, setLogs] = useState<string[]>([]);

  // Center viewer tabs
  const [tabs, setTabs] = useState<ViewerTab[]>(PINNED_TABS);
  const [activeTabId, setActiveTabId] = useState<string>("experiment");
  const [focusedPhaseId, setFocusedPhaseId] = useState<string | null>(null);
  const [showPerformanceReviewModal, setShowPerformanceReviewModal] = useState<boolean>(false);

  // Open a workspace file in a tab (or focus if already open)
  const handleOpenFile = useCallback((relPath: string) => {
    const cleanRel = relPath.replace(/^\/+/, "");
    if (cleanRel === "docs/experiment.md") {
      setActiveTabId("experiment");
      return;
    }
    const tabId = `file:${cleanRel}`;
    const fileName = cleanRel.split("/").pop() || cleanRel;
    setTabs((prev) => {
      if (prev.some((t) => t.id === tabId)) return prev;
      return [
        ...prev,
        {
          id: tabId,
          title: fileName,
          kind: "file",
          relPath: cleanRel,
          pinned: false,
        },
      ];
    });
    setActiveTabId(tabId);
  }, []);

  const handleCloseTab = useCallback(
    (tabId: string) => {
      setTabs((prev) => {
        const next = prev.filter((t) => t.id !== tabId);
        if (activeTabId === tabId) {
          const fallback = next[next.length - 1]?.id || "experiment";
          setActiveTabId(fallback);
        }
        return next;
      });
    },
    [activeTabId]
  );

  // Initial state bootstrap
  const fetchInitialState = useCallback(async () => {
    try {
      const res = await fetch("/api/state");
      const data = await res.json();
      if (data.ok) {
        setConfig(data.config);
        setPipelineState(data.pipelineState);
        if (typeof data.isBenchmarkRunning === "boolean") {
          setIsBenchmarkRunning(data.isBenchmarkRunning);
        }
        setMcpStatus(data.mcpStatus);
        if (data.literatureState) setLiteratureState(data.literatureState);
        setFileTree(data.fileTree || []);
        setExperimentSpec(data.experimentSpec);
        setExperimentRaw(data.experimentRaw || "");
        if (data.agentState) {
          setIsGenerating(Boolean(data.agentState.isGenerating));
          setMessages(data.agentState.messages || []);
          if (data.agentState.activeSessionId) {
            setActiveChatSessionId(data.agentState.activeSessionId);
          }
        }
        if (Array.isArray(data.chatSessions)) {
          setChatSessions(data.chatSessions);
        }
        if (Array.isArray(data.logs)) {
          setLogs(data.logs);
        }

        // Pre-populate helpful file tabs (e.g., docs/manuscript.md or docs/notes.md) if present
        const tree: FileTreeNode[] = data.fileTree || [];
        const docsFolder = tree.find((n) => n.name === "docs" && n.type === "directory");
        const hasManuscript = docsFolder?.children?.some((c) => c.name === "manuscript.md");
        const hasNotes = docsFolder?.children?.some((c) => c.name === "notes.md");

        setTabs((prev) => {
          const next = [...prev];
          if (hasManuscript && !next.some((t) => t.id === "file:docs/manuscript.md")) {
            next.push({
              id: "file:docs/manuscript.md",
              title: "manuscript.md",
              kind: "file",
              relPath: "docs/manuscript.md",
              pinned: false,
            });
          }
          if (hasNotes && !next.some((t) => t.id === "file:docs/notes.md")) {
            next.push({
              id: "file:docs/notes.md",
              title: "notes.md",
              kind: "file",
              relPath: "docs/notes.md",
              pinned: false,
            });
          }
          return next;
        });
      }
    } catch (err) {
      console.error("[tidyproteomics-agent] Failed to load initial state:", err);
    }
  }, []);

  useEffect(() => {
    fetchInitialState();
  }, [fetchInitialState]);

  // WebSocket live connection
  useEffect(() => {
    let ws: WebSocket | null = null;
    let reconnectTimer: number | null = null;
    let isUnmounted = false;

    const connectWs = () => {
      if (isUnmounted) return;
      const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
      const wsUrl = `${protocol}//${window.location.host}/ws`;
      ws = new WebSocket(wsUrl);

      ws.onmessage = (event) => {
        try {
          const msg = JSON.parse(event.data);
          switch (msg.type) {
            case "stateUpdate":
              if (msg.state) setPipelineState(msg.state);
              break;
            case "evaluationProgress":
              if (msg.suite) {
                setIsBenchmarkRunning(msg.suite.status === "running");
              }
              break;
            case "mcpStatus":
              if (msg.status) setMcpStatus(msg.status);
              break;
            case "literatureState":
              if (msg.state) setLiteratureState(msg.state);
              break;
            case "log":
              if (typeof msg.text === "string") {
                setLogs((prev) => [...prev.slice(-300), msg.text]);
              }
              break;
            case "agentState":
              setIsGenerating(Boolean(msg.isGenerating));
              if (Array.isArray(msg.messages)) setMessages(msg.messages);
              if (msg.activeSessionId) setActiveChatSessionId(msg.activeSessionId);
              if (msg.isGenerating) setStreamingText("");
              break;
            case "chatSessionsUpdate":
              if (Array.isArray(msg.sessions)) setChatSessions(msg.sessions);
              if (msg.activeSessionId) setActiveChatSessionId(msg.activeSessionId);
              break;
            case "agentChunk":
              if (typeof msg.chunk === "string") {
                setStreamingText((prev) => prev + msg.chunk);
              }
              break;
            case "agentDone":
              setIsGenerating(false);
              setStreamingText("");
              if (Array.isArray(msg.messages)) setMessages(msg.messages);
              break;
            case "agentError":
              setIsGenerating(false);
              setStreamingText("");
              if (msg.error) {
                setLogs((prev) => [...prev.slice(-300), `[Chat Error] ${msg.error}`]);
              }
              break;
            case "experimentUpdate":
              if (msg.spec) setExperimentSpec(msg.spec);
              if (typeof msg.raw === "string") setExperimentRaw(msg.raw);
              break;
            case "fileTreeUpdate":
              if (Array.isArray(msg.fileTree)) setFileTree(msg.fileTree);
              break;
            case "workspaceSwitched":
              if (msg.config) setConfig(msg.config);
              if (msg.state) setPipelineState(msg.state);
              if (msg.literatureState) setLiteratureState(msg.literatureState);
              if (Array.isArray(msg.fileTree)) setFileTree(msg.fileTree);
              if (msg.experimentSpec) setExperimentSpec(msg.experimentSpec);
              if (typeof msg.experimentRaw === "string") setExperimentRaw(msg.experimentRaw);
              setTabs(PINNED_TABS);
              setActiveTabId("experiment");
              break;
            default:
              break;
          }
        } catch (e) {
          console.error("[WS] Parse error:", e);
        }
      };

      ws.onclose = () => {
        if (!isUnmounted) {
          reconnectTimer = window.setTimeout(connectWs, 2000);
        }
      };
    };

    connectWs();

    return () => {
      isUnmounted = true;
      if (reconnectTimer) window.clearTimeout(reconnectTimer);
      if (ws) ws.close();
    };
  }, []);

  // Resizable 20 / 60 / 20 pane drag handlers
  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      if (!draggingSide.current) return;
      const vw = window.innerWidth;
      if (vw <= 0) return;

      if (draggingSide.current === "left") {
        const nextLeft = Math.max(10, Math.min(35, (e.clientX / vw) * 100));
        setLeftPct(Number(nextLeft.toFixed(2)));
      } else if (draggingSide.current === "right") {
        const nextRight = Math.max(14, Math.min(42, ((vw - e.clientX) / vw) * 100));
        setRightPct(Number(nextRight.toFixed(2)));
      }
    };

    const handleMouseUp = () => {
      if (draggingSide.current) {
        draggingSide.current = null;
        document.body.style.cursor = "";
        document.body.style.userSelect = "";
      }
    };

    window.addEventListener("mousemove", handleMouseMove);
    window.addEventListener("mouseup", handleMouseUp);
    return () => {
      window.removeEventListener("mousemove", handleMouseMove);
      window.removeEventListener("mouseup", handleMouseUp);
    };
  }, []);

  const startDragging = (side: "left" | "right") => {
    draggingSide.current = side;
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
  };

  const resetPaneWidths = () => {
    setLeftPct(20);
    setRightPct(20);
  };

  // Action handlers
  const handleUpdateConfig = async (patch: Partial<AppConfig>) => {
    const res = await fetch("/api/config", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(patch),
    });
    const data = await res.json();
    if (data.ok) {
      setConfig(data.config);
      if (data.mcpStatus) setMcpStatus(data.mcpStatus);
    }
  };

  const handleSelectWorkspace = async (workspaceRoot: string) => {
    await fetch("/api/workspace/select", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ workspaceRoot }),
    });
  };

  const handleInitWorkspace = async (
    workspaceRoot: string,
    pipelineId: "differential_expression" | "quality_control_only"
  ) => {
    await fetch("/api/workspace/init", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ workspaceRoot, pipelineId }),
    });
  };

  const handleReconnectMcp = async () => {
    const res = await fetch("/api/mcp/reconnect", { method: "POST" });
    const data = await res.json();
    if (data.status) setMcpStatus(data.status);
  };

  const handleRefreshTree = async () => {
    const res = await fetch("/api/workspace/tree");
    const data = await res.json();
    if (data.ok && Array.isArray(data.fileTree)) {
      setFileTree(data.fileTree);
    }
  };

  const handleSaveExperimentForm = async (patch: Partial<ExperimentSpec>) => {
    const res = await fetch("/api/experiment", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(patch),
    });
    const data = await res.json();
    if (data.ok) {
      setExperimentSpec(data.spec);
      setExperimentRaw(data.raw || "");
    }
  };

  const handleSaveExperimentRaw = async (raw: string) => {
    await fetch("/api/workspace/file", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ path: "docs/experiment.md", content: raw }),
    });
  };

  const handleConfirmAndProceed = async (contrasts?: string[], phaseId?: string) => {
    await fetch("/api/experiment/confirm", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ contrasts, phaseId: phaseId || undefined }),
    });
  };

  const handleStartPipeline = async () => {
    await fetch("/api/pipeline/start", { method: "POST" });
  };

  const handleStopPipeline = async () => {
    await fetch("/api/pipeline/stop", { method: "POST" });
  };

  const handleResetPipeline = async () => {
    await fetch("/api/pipeline/reset", { method: "POST" });
  };

  const handleRunPhase = async (phaseId: string) => {
    await fetch("/api/pipeline/run-phase", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ phaseId }),
    });
  };

  const handleTogglePhase = async (phaseId: string, enabled: boolean) => {
    await fetch("/api/pipeline/toggle-phase", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ phaseId, enabled }),
    });
  };

  const handleSendMessage = async (text: string) => {
    await fetch("/api/chat/send", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text }),
    });
  };

  const handleStopChat = async () => {
    await fetch("/api/chat/stop", { method: "POST" });
  };

  const handleClearChat = async () => {
    await fetch("/api/chat/clear", { method: "POST" });
    setMessages([]);
  };

  const handleNewChat = async () => {
    const res = await fetch("/api/chat/new", { method: "POST" });
    const data = await res.json();
    if (data.ok) {
      if (data.sessionId) setActiveChatSessionId(data.sessionId);
      if (Array.isArray(data.messages)) setMessages(data.messages);
      if (Array.isArray(data.sessions)) setChatSessions(data.sessions);
      setStreamingText("");
    }
  };

  const handleLoadChat = async (sessionId: string) => {
    const res = await fetch("/api/chat/load", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sessionId }),
    });
    const data = await res.json();
    if (data.ok) {
      if (data.sessionId) setActiveChatSessionId(data.sessionId);
      if (Array.isArray(data.messages)) setMessages(data.messages);
      if (Array.isArray(data.sessions)) setChatSessions(data.sessions);
      setStreamingText("");
    }
  };

  const handleSearchChats = async (query: string): Promise<ChatSessionSearchResult[]> => {
    try {
      const res = await fetch(`/api/chat/search?q=${encodeURIComponent(query)}`);
      const data = await res.json();
      if (data.ok && Array.isArray(data.results)) {
        return data.results;
      }
    } catch (_) {}
    return [];
  };

  // Clicking a segment in the SegmentedProgressBar below chat input opens the Pipeline Progress tab and expands that phase
  const handleSelectPhaseSegment = (phaseId: string) => {
    setActiveTabId("progress");
    setFocusedPhaseId(phaseId);
  };

  const handleRefreshLiteratureState = useCallback(async () => {
    try {
      const res = await fetch("/api/literature/state");
      const data = await res.json();
      if (data.ok && data.state) {
        setLiteratureState(data.state);
      }
    } catch (_) {}
  }, []);

  const handleOpenSettings = useCallback(() => {
    if (activeTabId === "settings") {
      handleCloseTab("settings");
      return;
    }
    setTabs((prev) => {
      if (prev.some((t) => t.id === "settings")) return prev;
      return [
        ...prev,
        {
          id: "settings",
          title: "Settings",
          kind: "settings",
          pinned: false,
        },
      ];
    });
    setActiveTabId("settings");
  }, [activeTabId, handleCloseTab]);

  const centerPct = Math.max(30, Number((100 - leftPct - rightPct).toFixed(2)));
  const activeFileTab = tabs.find((t) => t.id === activeTabId && t.kind === "file");

  return (
    <div className="workbench-shell">
      {/* Left 15% (Adjustable) Project Main: Settings at top + Navigable Workspace below */}
      <aside className="board-column pane-left" style={{ width: `${leftPct}%`, flex: `0 0 ${leftPct}%` }}>
        <LeftProjectPane
          config={config}
          mcpStatus={mcpStatus}
          fileTree={fileTree}
          activeFilePath={activeFileTab?.relPath}
          onUpdateConfig={handleUpdateConfig}
          onSelectWorkspace={handleSelectWorkspace}
          onInitWorkspace={handleInitWorkspace}
          onReconnectMcp={handleReconnectMcp}
          onOpenFile={handleOpenFile}
          onOpenExperimentForm={() => setActiveTabId("experiment")}
          onOpenSettings={handleOpenSettings}
          onRefreshTree={handleRefreshTree}
        />
      </aside>

      {/* Left / Center Resizer (double-click resets to 20/60/20) */}
      <div
        className="resize-handle"
        onMouseDown={() => startDragging("left")}
        onDoubleClick={resetPaneWidths}
        title="Drag to resize Project pane • Double-click to reset to 20% / 60% / 20%"
      />

      {/* Center 60% (Adjustable) Tabbed Main Viewer */}
      <main className="board-column pane-center" style={{ width: `${centerPct}%`, flex: `1 1 ${centerPct}%`, minWidth: 0 }}>
        <CenterViewerPane
          tabs={tabs}
          activeTabId={activeTabId}
          onSelectTab={setActiveTabId}
          onCloseTab={handleCloseTab}
          onOpenFile={handleOpenFile}
          experimentSpec={experimentSpec}
          experimentRaw={experimentRaw}
          fileTree={fileTree}
          pipelineState={pipelineState}
          focusedPhaseId={focusedPhaseId}
          isBenchmarkRunning={isBenchmarkRunning}
          config={config}
          mcpStatus={mcpStatus}
          literatureState={literatureState}
          onRefreshLiteratureState={handleRefreshLiteratureState}
          onUpdateConfig={handleUpdateConfig}
          onSelectWorkspace={handleSelectWorkspace}
          onInitWorkspace={handleInitWorkspace}
          onReconnectMcp={handleReconnectMcp}
          onSaveExperimentForm={handleSaveExperimentForm}
          onSaveExperimentRaw={handleSaveExperimentRaw}
          onConfirmAndProceed={handleConfirmAndProceed}
          onRunPhase={handleRunPhase}
          onTogglePhase={handleTogglePhase}
          onStartPipeline={handleStartPipeline}
          onStopPipeline={handleStopPipeline}
          onResetPipeline={handleResetPipeline}
          onOpenPerformanceReview={() => setShowPerformanceReviewModal(true)}
        />
      </main>

      {/* Center / Right Resizer (double-click resets to 20/60/20) */}
      <div
        className="resize-handle"
        onMouseDown={() => startDragging("right")}
        onDoubleClick={resetPaneWidths}
        title="Drag to resize Chat pane • Double-click to reset to 20% / 60% / 20%"
      />

      {/* Right 20% (Adjustable) Agentic Chat + Segmented Progress Bar below input */}
      <aside className="board-column pane-right" style={{ width: `${rightPct}%`, flex: `0 0 ${rightPct}%` }}>
        <RightChatPane
          pipelineState={pipelineState}
          isBenchmarkRunning={isBenchmarkRunning}
          messages={messages}
          activeChatSessionId={activeChatSessionId}
          chatSessions={chatSessions}
          isGenerating={isGenerating}
          streamingText={streamingText}
          logs={logs}
          onSendMessage={handleSendMessage}
          onStopChat={handleStopChat}
          onClearChat={handleClearChat}
          onNewChat={handleNewChat}
          onLoadChat={handleLoadChat}
          onSearchChats={handleSearchChats}
          onStartPipeline={handleStartPipeline}
          onStopPipeline={handleStopPipeline}
          onSelectPhaseSegment={handleSelectPhaseSegment}
          onOpenFile={handleOpenFile}
          onOpenExperimentForm={() => setActiveTabId("experiment")}
        />
      </aside>

      {showPerformanceReviewModal && (
        <PerformanceReviewModal
          onClose={() => setShowPerformanceReviewModal(false)}
          onOpenFile={handleOpenFile}
        />
      )}
    </div>
  );
};

