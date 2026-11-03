import React, { useEffect, useRef, useState } from "react";
import {
  Settings,
  FolderOpen,
  Folder,
  FileText,
  Image as ImageIcon,
  FileCode,
  Database,
  ChevronRight,
  ChevronDown,
  RefreshCw,
  ArrowUp,
  Plus,
  BookOpen,
  BarChart3,
  AlertTriangle,
} from "lucide-react";
import { AppConfig, FileTreeNode, McpStatus, PipelineId, PipelineState } from "../types";

interface LeftProjectPaneProps {
  config?: AppConfig;
  pipelineState?: PipelineState;
  mcpStatus?: McpStatus;
  fileTree: FileTreeNode[];
  activeFilePath?: string;
  onUpdateConfig: (patch: Partial<AppConfig>) => Promise<void>;
  onSelectWorkspace: (workspaceRoot: string) => Promise<void>;
  onInitWorkspace: (
    workspaceRoot: string,
    pipelineId: PipelineId
  ) => Promise<void>;
  onReconnectMcp: () => Promise<void>;
  onOpenFile: (relPath: string) => void;
  onOpenExperimentForm: () => void;
  onOpenSettings?: () => void;
  onOpenLibrary?: () => void;
  onOpenEvaluation?: () => void;
  onOpenGuides?: (guide?: "operations" | "scientific") => void;
  onOpenHowto?: (guide?: "operations" | "scientific") => void;
  onOpenDocumentation?: (guide: "operations" | "scientific") => void;
  onRefreshTree: () => void;
}

export const LeftProjectPane: React.FC<LeftProjectPaneProps> = ({
  config,
  pipelineState,
  fileTree,
  activeFilePath,
  onSelectWorkspace,
  onOpenFile,
  onOpenExperimentForm,
  onOpenSettings,
  onOpenLibrary,
  onOpenEvaluation,
  onOpenGuides,
  onOpenHowto,
  onOpenDocumentation,
  onRefreshTree,
}) => {
  // Expanded folders in file tree
  const [expandedDirs, setExpandedDirs] = useState<Record<string, boolean>>({
    docs: true,
    reference: true,
    analysis: true,
    data: true,
    code: false,
    logs: false,
  });

  // Workspace Browser Modal (<dialog closedby="any"> per modern-web-guidance `light-dismiss-a-dialog`)
  const dialogRef = useRef<HTMLDialogElement | null>(null);
  const [browseDir, setBrowseDir] = useState("");
  const [browseParent, setBrowseParent] = useState("");
  const [browseFolders, setBrowseFolders] = useState<
    Array<{ name: string; fullPath: string; hasPipeline: boolean }>
  >([]);
  const [newFolderName, setNewFolderName] = useState("");

  // Fallback for browsers without <dialog closedby> support per modern-web-guidance `light-dismiss-a-dialog`
  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (!("closedBy" in HTMLDialogElement.prototype)) {
      const handleBackdropClick = (event: MouseEvent) => {
        if (event.target !== dialog) return;
        const rect = dialog.getBoundingClientRect();
        const isDialogContent =
          rect.top <= event.clientY &&
          event.clientY <= rect.top + rect.height &&
          rect.left <= event.clientX &&
          event.clientX <= rect.left + rect.width;
        if (isDialogContent) return;
        dialog.close();
      };
      dialog.addEventListener("click", handleBackdropClick);
      return () => dialog.removeEventListener("click", handleBackdropClick);
    }
  }, []);

  const loadBrowseDirectory = async (dirPath?: string) => {
    try {
      const q = dirPath ? `?dir=${encodeURIComponent(dirPath)}` : "";
      const resp = await fetch(`/api/workspace/browse${q}`);
      const data = await resp.json();
      if (data.ok) {
        setBrowseDir(data.currentDir);
        setBrowseParent(data.parentDir);
        setBrowseFolders(data.folders || []);
      }
    } catch (_) {}
  };

  const openWorkspaceModal = () => {
    loadBrowseDirectory(config?.workspaceRoot);
    dialogRef.current?.showModal();
  };

  const toggleDirectory = (relPath: string) => {
    setExpandedDirs((prev) => ({
      ...prev,
      [relPath]: !prev[relPath],
    }));
  };

  const getFileIcon = (fileName: string) => {
    const ext = fileName.split(".").pop()?.toLowerCase();
    if (ext === "md") return <FileText size={13} color="var(--primary)" />;
    if (ext === "r" || ext === "rscript") return <FileCode size={13} color="#22c55e" />;
    if (ext === "tsv" || ext === "csv" || ext === "rds" || ext === "duckdb") {
      return <Database size={13} color="#f59e0b" />;
    }
    if (["png", "jpg", "jpeg", "svg", "webp"].includes(ext || "")) {
      return <ImageIcon size={13} color="#8b5cf6" />;
    }
    return <FileText size={13} color="var(--muted)" />;
  };

  const renderTreeNodes = (nodes: FileTreeNode[], depth = 0) => {
    return nodes.map((node) => {
      if (node.type === "directory") {
        const isExpanded = expandedDirs[node.relPath] ?? depth === 0;
        return (
          <div key={node.relPath} className="tree-node">
            <div
              className="tree-row tree-dir-row"
              style={{ paddingLeft: `${8 + depth * 12}px` }}
              onClick={() => toggleDirectory(node.relPath)}
            >
              <span className="tree-arrow">
                {isExpanded ? <ChevronDown size={11} /> : <ChevronRight size={11} />}
              </span>
              <Folder size={13} color="#60a5fa" />
              <span className="tree-label dir-name">{node.name}</span>
            </div>
            {isExpanded && node.children && node.children.length > 0 && (
              <div className="tree-children">{renderTreeNodes(node.children, depth + 1)}</div>
            )}
          </div>
        );
      }

      const isActive = activeFilePath === node.relPath;
      const isExperimentDoc = node.relPath === "docs/experiment.md";

      return (
        <div
          key={node.relPath}
          className={`tree-row tree-file-row ${isActive ? "active" : ""}`}
          style={{ paddingLeft: `${22 + depth * 12}px` }}
          onClick={() => {
            if (isExperimentDoc) {
              onOpenExperimentForm();
            } else {
              onOpenFile(node.relPath);
            }
          }}
          title={node.relPath}
        >
          {getFileIcon(node.name)}
          <span className="tree-label file-name">{node.name}</span>
          {isExperimentDoc && (
            <span
              className="badge badge-running"
              style={{ fontSize: "8.5px", padding: "1px 4px", marginLeft: "auto" }}
            >
              FORM
            </span>
          )}
        </div>
      );
    });
  };

  const wsName = config?.workspaceRoot ? config.workspaceRoot.split("/").pop() : "No Workspace";
  const isWorkspaceUninitialized = Boolean(
    config?.workspaceRoot &&
      (pipelineState?.isAnalysisMissingOrEmpty || fileTree.length === 0)
  );

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", overflow: "hidden" }}>
      {/* High-Level Tab Exposure Buttons at Top of Left Panel */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "1fr 1fr",
          gap: "6px",
          padding: "10px",
          borderBottom: "1px solid var(--border)",
          background: "var(--tabbar-bg)",
          flexShrink: 0,
        }}
      >
        <button
          type="button"
          className="btn btn-secondary btn-xs"
          onClick={onOpenSettings}
          style={{
            justifyContent: "center",
            gap: "5px",
            padding: "5px 6px",
            border: isWorkspaceUninitialized ? "1px solid var(--attention-orange-border)" : undefined,
            background: isWorkspaceUninitialized ? "var(--attention-orange-bg)" : undefined,
          }}
          title={
            isWorkspaceUninitialized
              ? "Workspace uninitialized • Open Settings to scaffold template"
              : "Open Settings in Center Workspace"
          }
        >
          {isWorkspaceUninitialized ? (
            <span
              style={{
                width: 6,
                height: 6,
                borderRadius: "50%",
                background: "var(--attention-orange)",
                boxShadow: "0 0 5px var(--attention-orange)",
                flexShrink: 0,
              }}
            />
          ) : (
            <Settings size={12} color="var(--warning)" />
          )}
          <span>Settings</span>
        </button>
        <button
          type="button"
          className="btn btn-secondary btn-xs"
          onClick={onOpenLibrary}
          style={{ justifyContent: "center", gap: "5px", padding: "5px 6px" }}
          title="Open Literature Library in Center Workspace"
        >
          <Database size={12} color="#a855f7" /> Library
        </button>
        <button
          type="button"
          className="btn btn-secondary btn-xs"
          onClick={onOpenEvaluation}
          style={{ justifyContent: "center", gap: "5px", padding: "5px 6px" }}
          title="Open AI Evaluation in Center Workspace"
        >
          <BarChart3 size={12} color="#60a5fa" /> Evaluation
        </button>
        <button
          type="button"
          className="btn btn-secondary btn-xs"
          onClick={() => {
            if (onOpenGuides) {
              onOpenGuides("operations");
            } else if (onOpenHowto) {
              onOpenHowto("operations");
            } else if (onOpenDocumentation) {
              onOpenDocumentation("operations");
            }
          }}
          style={{ justifyContent: "center", gap: "5px", padding: "5px 6px" }}
          title="Open Guides & Scientific Reference"
        >
          <BookOpen size={12} color="#38bdf8" /> Guides
        </button>
      </div>

      {/* Workspace Bar: Active Path + Switch & Refresh */}
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          padding: "7px 10px",
          borderBottom: "1px solid var(--border)",
          background: "var(--tabbar-bg)",
          flexShrink: 0,
        }}
      >
        <span
          style={{
            fontSize: "10.5px",
            fontWeight: 700,
            textTransform: "uppercase",
            letterSpacing: "0.5px",
            color: "var(--muted)",
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
            maxWidth: "75%",
          }}
          title={config?.workspaceRoot}
        >
          {wsName}
        </span>
        <div style={{ display: "flex", alignItems: "center", gap: "4px" }}>
          <button
            type="button"
            className="btn btn-secondary btn-xs"
            style={{ padding: "2px 5px" }}
            onClick={openWorkspaceModal}
            title="Switch Workspace Directory"
          >
            <FolderOpen size={11} />
          </button>
          <button
            type="button"
            className="btn btn-secondary btn-xs"
            style={{ padding: "2px 5px" }}
            onClick={onRefreshTree}
            title="Refresh workspace files"
          >
            <RefreshCw size={11} />
          </button>
        </div>
      </div>

      {/* Navigable Workspace File Tree */}
      <div style={{ flex: "1 1 auto", overflowY: "auto", overflowX: "auto", padding: "6px" }}>
        {fileTree.length === 0 ? (
          <div
            className="attention-banner-orange"
            style={{
              padding: "14px 10px",
              margin: "8px 4px",
              textAlign: "center",
              display: "flex",
              flexDirection: "column",
              gap: "8px",
            }}
          >
            <div
              style={{
                fontWeight: 700,
                color: "var(--attention-orange-light)",
                fontSize: "11.5px",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                gap: "5px",
              }}
            >
              <AlertTriangle size={13} />
              <span>Workspace Uninitialized</span>
            </div>
            <div style={{ color: "var(--muted)", fontSize: "11px", lineHeight: 1.4 }}>
              This directory is missing analytical pipeline templates.
            </div>
            <button
              type="button"
              className="btn btn-warning btn-xs"
              onClick={() => onOpenSettings && onOpenSettings()}
              style={{ alignSelf: "center", marginTop: "2px", fontWeight: 700 }}
            >
              Scaffold Template
            </button>
          </div>
        ) : (
          renderTreeNodes(fileTree)
        )}
      </div>

      {/* Light-Dismiss Modal Dialog for Selecting / Creating Workspace Directory */}
      <dialog
        ref={dialogRef}
        closedby="any"
        style={{
          background: "var(--card-bg)",
          color: "var(--fg)",
          border: "1px solid var(--border-strong)",
          borderRadius: "8px",
          padding: "16px",
          width: "480px",
          maxWidth: "90vw",
          boxShadow: "0 8px 30px rgba(0, 0, 0, 0.7)",
        }}
      >
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            marginBottom: "10px",
          }}
        >
          <h3 style={{ margin: 0, fontSize: "14px", fontWeight: 700 }}>Select Workspace Directory</h3>
          <button
            type="button"
            className="btn btn-secondary btn-xs"
            onClick={() => dialogRef.current?.close()}
          >
            Cancel
          </button>
        </div>

        <div style={{ fontSize: "11px", color: "var(--muted)", marginBottom: "8px", wordBreak: "break-all" }}>
          Path: <code>{browseDir || "/"}</code>
        </div>

        <div
          style={{
            display: "flex",
            gap: "5px",
            marginBottom: "10px",
          }}
        >
          {browseParent && (
            <button
              type="button"
              className="btn btn-secondary btn-xs"
              onClick={() => loadBrowseDirectory(browseParent)}
            >
              <ArrowUp size={11} /> Up One Level
            </button>
          )}
          <button
            type="button"
            className="btn btn-success btn-xs"
            onClick={async () => {
              dialogRef.current?.close();
              if (browseDir) await onSelectWorkspace(browseDir);
            }}
          >
            Choose This Folder
          </button>
        </div>

        {/* Sub-folder List */}
        <div
          style={{
            maxHeight: "220px",
            overflowY: "auto",
            border: "1px solid var(--border)",
            borderRadius: "4px",
            background: "var(--bg)",
            marginBottom: "10px",
          }}
        >
          {browseFolders.length === 0 ? (
            <div style={{ padding: "10px", color: "var(--muted)", fontSize: "11px" }}>
              (No child folders found)
            </div>
          ) : (
            browseFolders.map((f) => (
              <div
                key={f.fullPath}
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  padding: "5px 8px",
                  fontSize: "11.5px",
                  cursor: "pointer",
                  borderBottom: "1px solid var(--border)",
                }}
                onClick={() => loadBrowseDirectory(f.fullPath)}
              >
                <span style={{ display: "inline-flex", alignItems: "center", gap: "6px" }}>
                  <Folder size={12} color="#60a5fa" />
                  {f.name}
                </span>
                {f.hasPipeline && (
                  <span className="badge badge-completed" style={{ fontSize: "8.5px" }}>
                    Pipeline
                  </span>
                )}
              </div>
            ))
          )}
        </div>

        {/* Create new folder inside browseDir */}
        <div style={{ display: "flex", gap: "5px" }}>
          <input
            type="text"
            className="input"
            style={{ fontSize: "11px", padding: "4px 8px", flex: 1 }}
            placeholder="New folder name..."
            value={newFolderName}
            onChange={(e) => setNewFolderName(e.target.value)}
          />
          <button
            type="button"
            className="btn btn-xs"
            onClick={async () => {
              const name = newFolderName.trim();
              if (!name || !browseDir) return;
              const target = `${browseDir.replace(/\/+$/, "")}/${name}`;
              setNewFolderName("");
              dialogRef.current?.close();
              await onSelectWorkspace(target);
            }}
            disabled={!newFolderName.trim()}
          >
            <Plus size={11} /> Create &amp; Open
          </button>
        </div>
      </dialog>
    </div>
  );
};
