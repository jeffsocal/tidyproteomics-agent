import React, { useEffect, useRef, useState } from "react";
import {
  Database,
  BookOpen,
  Plus,
  Play,
  Square,
  RefreshCw,
  Search,
  Upload,
  FolderOpen,
  Trash2,
  FileText,
  FileSpreadsheet,
  ExternalLink,
  Check,
  AlertCircle,
  FileUp,
} from "lucide-react";
import { LiteratureViewState, LiteratureStats } from "../types";

interface LibrarySettingsSectionProps {
  workspaceRoot?: string;
  literatureState?: LiteratureViewState;
  onOpenFile?: (relPath: string) => void;
  onRefreshState?: () => Promise<void>;
}

export const LibrarySettingsSection: React.FC<LibrarySettingsSectionProps> = ({
  workspaceRoot,
  literatureState,
  onOpenFile,
  onRefreshState,
}) => {
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  // New database input
  const [newDbName, setNewDbName] = useState("");
  const [isCreatingDb, setIsCreatingDb] = useState(false);
  const [dbError, setDbError] = useState<string | null>(null);

  // Folder scan input / modal
  const [showFolderInput, setShowFolderInput] = useState(false);
  const [customFolderPath, setCustomFolderPath] = useState("");
  const [isScanningFolder, setIsScanningFolder] = useState(false);

  // Search state
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState<any[] | null>(null);
  const [isSearching, setIsSearching] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);

  // Ingestion feedback
  const [isUploadingFiles, setIsUploadingFiles] = useState(false);
  const [uploadProgress, setUploadProgress] = useState<string | null>(null);
  const [isDraggingOver, setIsDraggingOver] = useState(false);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);

  // Stats cache
  const [liveStats, setLiveStats] = useState<LiteratureStats | null>(null);
  const [isRefreshingStats, setIsRefreshingStats] = useState(false);

  useEffect(() => {
    if (literatureState?.stats) {
      setLiveStats(literatureState.stats);
    }
  }, [literatureState?.stats]);

  // Active database resolution
  const databases = literatureState?.databases || [];
  const activeDb = literatureState?.activeLiterature || literatureState?.config?.activeLiterature || "";
  const isIngesting = Boolean(literatureState?.isIngesting);
  const queue = literatureState?.queue || [];
  const useInSynthesis = Boolean(literatureState?.useInSynthesis ?? literatureState?.config?.useInSynthesis);

  // Helper to show temporary status messages
  const flashStatus = (msg: string) => {
    setStatusMessage(msg);
    setTimeout(() => setStatusMessage(null), 3500);
  };

  // 1. Select Active Database
  const handleSelectDatabase = async (fileName: string) => {
    try {
      setDbError(null);
      const res = await fetch("/api/literature/select", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ fileName: fileName || undefined }),
      });
      const data = await res.json();
      if (!data.ok) {
        setDbError(data.error || "Failed to switch active database");
      } else {
        flashStatus(fileName ? `Switched active database to ${fileName}` : "Cleared active database");
        if (fileName) {
          fetchStats(fileName);
        } else {
          setLiveStats(null);
        }
      }
    } catch (err: any) {
      setDbError(err.message || "Failed to select database");
    }
  };

  // 2. Create New Database
  const handleCreateDatabase = async () => {
    const trimmed = newDbName.trim();
    if (!trimmed) return;
    setIsCreatingDb(true);
    setDbError(null);
    try {
      const res = await fetch("/api/literature/create", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: trimmed }),
      });
      const data = await res.json();
      if (data.ok) {
        setNewDbName("");
        flashStatus(`Created literature database: ${data.database?.fileName || trimmed}`);
        if (data.database?.fileName) {
          fetchStats(data.database.fileName);
        }
      } else {
        setDbError(data.error || "Failed to create database");
      }
    } catch (err: any) {
      setDbError(err.message || "Failed to create database");
    } finally {
      setIsCreatingDb(false);
    }
  };

  // 3. Toggle Use in Synthesis
  const handleToggleSynthesis = async (enabled: boolean) => {
    try {
      await fetch("/api/literature/toggle-synthesis", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ enabled }),
      });
      flashStatus(enabled ? "Enabled database for Phase 09 synthesis" : "Disabled database in synthesis");
    } catch (err: any) {
      setDbError(err.message || "Failed to toggle synthesis mode");
    }
  };

  // 4. Fetch Stats
  const fetchStats = async (fileName?: string) => {
    const target = fileName || activeDb;
    if (!target) return;
    setIsRefreshingStats(true);
    try {
      const res = await fetch(`/api/literature/stats?fileName=${encodeURIComponent(target)}`);
      const data = await res.json();
      if (data.ok && data.stats) {
        setLiveStats(data.stats);
      }
    } catch (_) {
    } finally {
      setIsRefreshingStats(false);
    }
  };

  // 5. Assertion Search
  const handleSearch = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    const q = searchQuery.trim();
    if (!q) return;
    if (!activeDb) {
      setSearchError("Please select an active literature database first.");
      return;
    }
    setIsSearching(true);
    setSearchError(null);
    try {
      const res = await fetch(`/api/literature/search?query=${encodeURIComponent(q)}&fileName=${encodeURIComponent(activeDb)}`);
      const data = await res.json();
      if (data.ok) {
        const rows = data.results || data.rows || data.data?.results || [];
        setSearchResults(rows);
      } else {
        setSearchError(data.error || "Search failed");
        setSearchResults([]);
      }
    } catch (err: any) {
      setSearchError(err.message || "Failed to execute search");
      setSearchResults([]);
    } finally {
      setIsSearching(false);
    }
  };

  // 6. Import / Upload PDFs directly into queue
  const handleFilesSelected = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;
    await processUploadedFiles(Array.from(files));
    e.target.value = "";
  };

  const processUploadedFiles = async (fileList: File[]) => {
    setIsUploadingFiles(true);
    setUploadProgress(`Reading ${fileList.length} file(s)...`);
    try {
      const payload: { name: string; contentBase64: string }[] = [];
      for (let i = 0; i < fileList.length; i++) {
        const f = fileList[i];
        setUploadProgress(`Processing ${f.name} (${i + 1}/${fileList.length})...`);
        const b64 = await readFileAsBase64(f);
        payload.push({ name: f.name, contentBase64: b64 });
      }

      setUploadProgress("Uploading and scanning files into queue...");
      const res = await fetch("/api/literature/import-files", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ files: payload }),
      });
      const data = await res.json();
      if (data.ok) {
        flashStatus(`Successfully imported ${payload.length} document(s) to queue!`);
      } else {
        setDbError(data.error || "Failed to import files");
      }
    } catch (err: any) {
      setDbError(err.message || "Failed to upload documents");
    } finally {
      setIsUploadingFiles(false);
      setUploadProgress(null);
    }
  };

  const readFileAsBase64 = (file: File): Promise<string> => {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => {
        const res = reader.result as string;
        // strip data:application/pdf;base64, prefix
        const base64 = res.split(",")[1] || "";
        resolve(base64);
      };
      reader.onerror = (error) => reject(error);
      reader.readAsDataURL(file);
    });
  };

  // 7. Drag and Drop handlers
  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDraggingOver(true);
  };

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDraggingOver(false);
  };

  const handleDrop = async (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDraggingOver(false);
    const droppedFiles = e.dataTransfer.files;
    if (droppedFiles && droppedFiles.length > 0) {
      const accepted = Array.from(droppedFiles).filter((f) => {
        const ext = f.name.toLowerCase();
        return ext.endsWith(".pdf") || ext.endsWith(".xlsx") || ext.endsWith(".csv") || ext.endsWith(".tsv") || ext.endsWith(".xls");
      });
      if (accepted.length > 0) {
        await processUploadedFiles(accepted);
      } else {
        flashStatus("No supported PDF or table files (.pdf, .xlsx, .csv, .tsv) found in drop.");
      }
    }
  };

  // 8. Scan Host Folder
  const handleScanFolder = async () => {
    const targetFolder = customFolderPath.trim() || workspaceRoot || "";
    if (!targetFolder) return;
    setIsScanningFolder(true);
    try {
      const res = await fetch("/api/literature/scan-folder", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ folderPath: targetFolder }),
      });
      const data = await res.json();
      if (data.ok) {
        flashStatus(`Folder scanned: ${data.state?.queue?.length || 0} document(s) in queue.`);
        setShowFolderInput(false);
      } else {
        setDbError(data.error || "Failed to scan folder");
      }
    } catch (err: any) {
      setDbError(err.message || "Failed to scan folder");
    } finally {
      setIsScanningFolder(false);
    }
  };

  // 9. Clear Queue
  const handleClearQueue = async () => {
    try {
      await fetch("/api/literature/clear-queue", { method: "POST" });
      flashStatus("Cleared ingestion queue.");
    } catch (err: any) {
      setDbError(err.message || "Failed to clear queue");
    }
  };

  // 10. Start / Abort Ingestion
  const handleStartIngest = async () => {
    if (!activeDb) {
      setDbError("Please select or create an active literature database first.");
      return;
    }
    if (queue.length === 0) {
      setDbError("No files in the ingestion queue. Import PDFs first.");
      return;
    }
    setDbError(null);
    try {
      const res = await fetch("/api/literature/start-ingest", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ fileName: activeDb }),
      });
      const data = await res.json();
      if (data.ok) {
        flashStatus("Ingestion pipeline started! Check logs & status below.");
      } else {
        setDbError(data.error || "Failed to start ingestion");
      }
    } catch (err: any) {
      setDbError(err.message || "Failed to start ingestion");
    }
  };

  const handleAbortIngest = async () => {
    try {
      await fetch("/api/literature/abort-ingest", { method: "POST" });
      flashStatus("Abort requested. Pipeline stopping...");
    } catch (err: any) {
      setDbError(err.message || "Failed to abort ingestion");
    }
  };

  // 11. Generate Report
  const handleGenerateReport = async () => {
    if (!activeDb) return;
    try {
      flashStatus("Regenerating docs/literature_database.md...");
      const res = await fetch("/api/literature/generate-report", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ fileName: activeDb }),
      });
      const data = await res.json();
      if (data.ok) {
        flashStatus("✓ Updated docs/literature_database.md");
        if (onOpenFile) {
          onOpenFile("docs/literature_database.md");
        }
      } else {
        setDbError(data.error || "Failed to generate report");
      }
    } catch (err: any) {
      setDbError(err.message || "Failed to generate report");
    }
  };

  // Current stats display
  const effectiveStats = liveStats || literatureState?.stats;

  const formatBytes = (bytes?: number) => {
    if (!bytes || bytes <= 0) return "0 B";
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  };

  return (
    <div style={{ padding: "24px", maxWidth: "1080px", margin: "0 auto", width: "100%", boxSizing: "border-box" }}>
      {/* Hidden file input for importing PDFs */}
      <input
        type="file"
        ref={fileInputRef}
        onChange={handleFilesSelected}
        multiple
        accept=".pdf,.xlsx,.csv,.tsv,.xls"
        style={{ display: "none" }}
      />

      {/* Section Header */}
      <div style={{ marginBottom: "20px" }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: "10px" }}>
          <div>
            <h3 style={{ margin: 0, fontSize: "16px", fontWeight: 700, color: "var(--fg-bright)", display: "flex", alignItems: "center", gap: "8px" }}>
              <BookOpen size={18} color="var(--primary)" />
              Literature Library &amp; PDF Ingestion
            </h3>
            <p style={{ margin: "4px 0 0 0", fontSize: "12px", color: "var(--muted)" }}>
              Manage DuckDB perturbation knowledge databases, import scientific PDFs / supplementary tables, and corroborate findings across published studies.
            </p>
          </div>
          <div>
            {activeDb ? (
              <span className="badge badge-completed" style={{ fontSize: "11px", padding: "4px 8px" }}>
                ACTIVE: {activeDb}
              </span>
            ) : (
              <span className="badge badge-idle" style={{ fontSize: "11px", padding: "4px 8px" }}>
                NO ACTIVE DATABASE
              </span>
            )}
          </div>
        </div>
      </div>

      {/* Status Notifications */}
      {statusMessage && (
        <div
          style={{
            marginBottom: "16px",
            padding: "8px 14px",
            borderRadius: "6px",
            background: "rgba(34, 197, 94, 0.15)",
            border: "1px solid rgba(34, 197, 94, 0.4)",
            color: "var(--success)",
            fontSize: "12px",
            display: "flex",
            alignItems: "center",
            gap: "8px",
          }}
        >
          <Check size={14} />
          <span>{statusMessage}</span>
        </div>
      )}

      {dbError && (
        <div
          style={{
            marginBottom: "16px",
            padding: "8px 14px",
            borderRadius: "6px",
            background: "rgba(239, 68, 68, 0.15)",
            border: "1px solid rgba(239, 68, 68, 0.4)",
            color: "var(--error)",
            fontSize: "12px",
            display: "flex",
            alignItems: "center",
            gap: "8px",
          }}
        >
          <AlertCircle size={14} />
          <span>{dbError}</span>
        </div>
      )}

      {/* Grid: Database Selector + Synthesis Toggle */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "16px", marginBottom: "16px" }}>
        {/* Database Picker & Creator Card */}
        <div className="card" style={{ padding: "16px", background: "var(--card-bg)", borderRadius: "8px", border: "1px solid var(--border)" }}>
          <div style={{ display: "flex", alignItems: "center", gap: "6px", marginBottom: "10px" }}>
            <Database size={14} color="var(--primary)" />
            <span style={{ fontSize: "12px", fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.5px", color: "var(--fg-bright)" }}>
              Active Knowledge Database
            </span>
          </div>

          <label style={{ fontSize: "11px", color: "var(--muted)", display: "block", marginBottom: "6px" }}>
            Select database from <code>literature/*.duckdb</code>:
          </label>
          <select
            value={activeDb}
            onChange={(e) => handleSelectDatabase(e.target.value)}
            style={{
              width: "100%",
              padding: "7px 10px",
              fontSize: "12px",
              background: "#18181f",
              color: "var(--fg)",
              border: "1px solid var(--border)",
              borderRadius: "6px",
              outline: "none",
              marginBottom: "12px",
            }}
          >
            <option value="">(No database selected)</option>
            {databases.map((db) => (
              <option key={db.fileName} value={db.fileName}>
                {db.fileName} ({formatBytes(db.sizeBytes)})
              </option>
            ))}
          </select>

          {/* Create New DB input */}
          <div style={{ display: "flex", gap: "6px" }}>
            <input
              type="text"
              placeholder="New database name (e.g. p97_vcp)..."
              value={newDbName}
              onChange={(e) => setNewDbName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") handleCreateDatabase();
              }}
              style={{
                flex: 1,
                padding: "6px 10px",
                fontSize: "12px",
                background: "#18181f",
                color: "var(--fg)",
                border: "1px solid var(--border)",
                borderRadius: "6px",
                outline: "none",
              }}
            />
            <button
              type="button"
              className="btn btn-primary btn-sm"
              onClick={handleCreateDatabase}
              disabled={isCreatingDb || !newDbName.trim()}
              style={{ display: "inline-flex", alignItems: "center", gap: "4px", whiteSpace: "nowrap" }}
            >
              <Plus size={13} /> {isCreatingDb ? "Creating..." : "Create"}
            </button>
          </div>
        </div>

        {/* Synthesis Configuration Card */}
        <div className="card" style={{ padding: "16px", background: "var(--card-bg)", borderRadius: "8px", border: "1px solid var(--border)" }}>
          <div style={{ display: "flex", alignItems: "center", gap: "6px", marginBottom: "10px" }}>
            <RefreshCw size={14} color="var(--primary)" />
            <span style={{ fontSize: "12px", fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.5px", color: "var(--fg-bright)" }}>
              Synthesis Orchestration
            </span>
          </div>

          <p style={{ fontSize: "11.5px", color: "var(--muted)", margin: "0 0 12px 0", lineHeight: 1.45 }}>
            When enabled, the active database is linked to the 12-Phase pipeline. Phase 09 (Literature Corroboration &amp; Synthesis) performs two-way R DBI queries against this corpus to validate differentially abundant proteins against published literature evidence.
          </p>

          <label
            style={{
              display: "flex",
              alignItems: "center",
              gap: "10px",
              cursor: activeDb ? "pointer" : "not-allowed",
              padding: "10px 12px",
              background: "#18181f",
              border: "1px solid var(--border)",
              borderRadius: "6px",
              opacity: activeDb ? 1 : 0.6,
            }}
          >
            <input
              type="checkbox"
              checked={useInSynthesis}
              disabled={!activeDb}
              onChange={(e) => handleToggleSynthesis(e.target.checked)}
              style={{ width: "16px", height: "16px", cursor: activeDb ? "pointer" : "not-allowed" }}
            />
            <div>
              <div style={{ fontSize: "12px", fontWeight: 600, color: "var(--fg-bright)" }}>
                Use Active Database in Synthesis
              </div>
              <div style={{ fontSize: "10.5px", color: "var(--muted)" }}>
                Injects <code>literature/{activeDb || "none"}</code> into prompt context &amp; execution
              </div>
            </div>
          </label>
        </div>
      </div>

      {/* Metrics Card Grid */}
      <div className="card" style={{ padding: "16px", background: "var(--card-bg)", borderRadius: "8px", border: "1px solid var(--border)", marginBottom: "16px" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "10px" }}>
          <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
            <span style={{ fontSize: "12px", fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.5px", color: "var(--fg-bright)" }}>
              Corpus Knowledge Metrics
            </span>
            <span style={{ fontSize: "11px", color: "var(--muted)" }}>
              ({activeDb || "No Database"})
            </span>
          </div>

          <div style={{ display: "flex", gap: "6px" }}>
            <button
              type="button"
              className="btn btn-secondary btn-xs"
              onClick={() => fetchStats()}
              disabled={isRefreshingStats || !activeDb}
              title="Refresh counts from DuckDB"
            >
              <RefreshCw size={12} className={isRefreshingStats ? "spin" : ""} /> Refresh
            </button>
            <button
              type="button"
              className="btn btn-secondary btn-xs"
              onClick={() => {
                if (onOpenFile) onOpenFile("docs/literature_database.md");
              }}
              title="Open accounting markdown report in viewer"
            >
              <FileText size={12} /> Open Report
            </button>
            <button
              type="button"
              className="btn btn-secondary btn-xs"
              onClick={handleGenerateReport}
              disabled={!activeDb}
              title="Regenerate docs/literature_database.md from active DuckDB"
            >
              <RefreshCw size={12} /> Regenerate Report
            </button>
          </div>
        </div>

        <div className="metric-grid">
          <div className="metric-card">
            <div className="metric-num">{effectiveStats?.studies ?? effectiveStats?.study_count ?? 0}</div>
            <div className="metric-label">Studies</div>
          </div>
          <div className="metric-card">
            <div className="metric-num">{effectiveStats?.contexts ?? effectiveStats?.context_count ?? 0}</div>
            <div className="metric-label">Contexts</div>
          </div>
          <div className="metric-card">
            <div className="metric-num">{effectiveStats?.assertions ?? effectiveStats?.assertion_count ?? 0}</div>
            <div className="metric-label">Assertions</div>
          </div>
          <div className="metric-card">
            <div className="metric-num">{effectiveStats?.symbols ?? effectiveStats?.unique_symbols ?? 0}</div>
            <div className="metric-label">Symbols</div>
          </div>
          <div className="metric-card">
            <div className="metric-num">{effectiveStats?.organisms ?? effectiveStats?.organism_count ?? 0}</div>
            <div className="metric-label">Organisms</div>
          </div>
          <div className="metric-card">
            <div className="metric-num">{effectiveStats?.perturbations ?? effectiveStats?.perturbation_count ?? 0}</div>
            <div className="metric-label">Perturbations</div>
          </div>
        </div>
      </div>

      {/* PDF & Supplementary Table Ingestion Queue Card */}
      <div className="card" style={{ padding: "16px", background: "var(--card-bg)", borderRadius: "8px", border: "1px solid var(--border)", marginBottom: "16px" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "12px", flexWrap: "wrap", gap: "8px" }}>
          <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
            <FileUp size={16} color="var(--primary)" />
            <span style={{ fontSize: "13px", fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.5px", color: "var(--fg-bright)" }}>
              PDF &amp; Supplementary Table Ingestion Queue
            </span>
            <span className="badge badge-queued" style={{ fontSize: "10px" }}>
              {queue.length} {queue.length === 1 ? "FILE" : "FILES"}
            </span>
            {isIngesting && (
              <span className="badge badge-running" style={{ fontSize: "10px" }}>
                INGESTING...
              </span>
            )}
          </div>

          <div style={{ display: "flex", gap: "6px" }}>
            <button
              type="button"
              className="btn btn-primary btn-sm"
              onClick={() => fileInputRef.current?.click()}
              disabled={isUploadingFiles || isIngesting}
              style={{ display: "inline-flex", alignItems: "center", gap: "6px" }}
            >
              <Upload size={13} /> Import PDFs / Tables...
            </button>
            <button
              type="button"
              className="btn btn-secondary btn-sm"
              onClick={() => setShowFolderInput((prev) => !prev)}
              disabled={isIngesting}
              style={{ display: "inline-flex", alignItems: "center", gap: "6px" }}
            >
              <FolderOpen size={13} /> Scan Host Folder
            </button>
            <button
              type="button"
              className="btn btn-secondary btn-sm"
              onClick={handleClearQueue}
              disabled={queue.length === 0 || isIngesting}
              title="Clear pending queue"
              style={{ display: "inline-flex", alignItems: "center", gap: "4px" }}
            >
              <Trash2 size={13} /> Clear
            </button>
          </div>
        </div>

        {/* Upload status banner */}
        {uploadProgress && (
          <div style={{ padding: "8px 12px", background: "#1c1c24", borderRadius: "6px", marginBottom: "12px", fontSize: "11.5px", color: "var(--primary)" }}>
            {uploadProgress}
          </div>
        )}

        {/* Host folder scanner input form */}
        {showFolderInput && (
          <div style={{ display: "flex", gap: "6px", marginBottom: "12px", padding: "10px", background: "#18181f", borderRadius: "6px", border: "1px solid var(--border)" }}>
            <input
              type="text"
              placeholder={`Folder path (e.g. ${workspaceRoot || "/path/to/papers"})...`}
              value={customFolderPath}
              onChange={(e) => setCustomFolderPath(e.target.value)}
              style={{
                flex: 1,
                padding: "6px 10px",
                fontSize: "12px",
                background: "#121216",
                color: "var(--fg)",
                border: "1px solid var(--border)",
                borderRadius: "4px",
                outline: "none",
              }}
            />
            <button
              type="button"
              className="btn btn-primary btn-sm"
              onClick={handleScanFolder}
              disabled={isScanningFolder}
            >
              {isScanningFolder ? "Scanning..." : "Scan Directory"}
            </button>
          </div>
        )}

        {/* Drag & Drop Import Box */}
        <div
          className={`dropzone-container ${isDraggingOver ? "active" : ""}`}
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
          onDrop={handleDrop}
          onClick={() => fileInputRef.current?.click()}
          style={{ marginBottom: "14px" }}
        >
          <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: "6px" }}>
            <Upload size={22} color={isDraggingOver ? "var(--primary)" : "var(--muted)"} />
            <div style={{ fontSize: "12px", fontWeight: 600, color: isDraggingOver ? "var(--fg-bright)" : "var(--fg)" }}>
              Drag &amp; drop scientific PDFs or supplementary tables here
            </div>
            <div style={{ fontSize: "10.5px", color: "var(--muted)" }}>
              Supports <code>.pdf</code>, <code>.xlsx</code>, <code>.csv</code>, and <code>.tsv</code> documents. Click to browse.
            </div>
          </div>
        </div>

        {/* Queue Items List */}
        <div style={{ maxHeight: "260px", overflowY: "auto", marginBottom: "14px" }}>
          {queue.length === 0 ? (
            <div style={{ color: "var(--muted)", fontSize: "11px", textAlign: "center", padding: "20px 0" }}>
              No documents in ingestion queue.
              <br />
              Import PDF papers or select a literature folder above to extract assertions.
            </div>
          ) : (
            queue.map((item) => {
              const isPdf = item.kind === "pdf" || item.fileName.toLowerCase().endsWith(".pdf");
              let badgeClass = "badge-idle";
              if (item.stage === "indexed") badgeClass = "badge-indexed";
              else if (item.stage === "failed") badgeClass = "badge-failed";
              else if (item.stage === "skipped") badgeClass = "badge-skipped";
              else if (item.stage === "parsing_pdf") badgeClass = "badge-parsing_pdf";
              else if (item.stage === "llm_extraction") badgeClass = "badge-llm_extraction";
              else if (item.stage === "normalization") badgeClass = "badge-normalization";

              return (
                <div key={item.id} className="queue-item">
                  <div style={{ display: "flex", alignItems: "center", gap: "8px", minWidth: 0, flex: "1 1 auto" }}>
                    {isPdf ? (
                      <FileText size={16} color="#60a5fa" style={{ flexShrink: 0 }} />
                    ) : (
                      <FileSpreadsheet size={16} color="#34d399" style={{ flexShrink: 0 }} />
                    )}
                    <div className="queue-item-left">
                      <div className="queue-item-title" title={item.absPath}>
                        {item.fileName}
                      </div>
                      <div className="queue-item-sub">
                        {formatBytes(item.sizeBytes)}
                        {item.pageCount ? ` • ${item.pageCount} pages` : ""}
                        {item.message ? ` • ${item.message}` : ""}
                      </div>
                    </div>
                  </div>

                  <span className={`badge ${badgeClass}`} style={{ fontSize: "9.5px", flexShrink: 0 }}>
                    {item.stage.toUpperCase().replace("_", " ")}
                  </span>
                </div>
              );
            })
          )}
        </div>

        {/* Ingestion Action Buttons */}
        <div style={{ display: "flex", gap: "10px", alignItems: "center" }}>
          {!isIngesting ? (
            <button
              type="button"
              className="btn btn-primary"
              onClick={handleStartIngest}
              disabled={queue.length === 0 || !activeDb}
              style={{
                flex: 1,
                padding: "8px 14px",
                display: "inline-flex",
                alignItems: "center",
                justifyContent: "center",
                gap: "8px",
                fontWeight: 600,
                fontSize: "12.5px",
              }}
            >
              <Play size={14} /> Run Ingestion Pipeline
            </button>
          ) : (
            <button
              type="button"
              className="btn btn-danger"
              onClick={handleAbortIngest}
              style={{
                flex: 1,
                padding: "8px 14px",
                display: "inline-flex",
                alignItems: "center",
                justifyContent: "center",
                gap: "8px",
                fontWeight: 600,
                fontSize: "12.5px",
                background: "var(--error)",
                color: "#fff",
              }}
            >
              <Square size={14} /> Abort Ingestion
            </button>
          )}
        </div>
      </div>

      {/* Assertion Search Card */}
      <div className="card" style={{ padding: "16px", background: "var(--card-bg)", borderRadius: "8px", border: "1px solid var(--border)" }}>
        <div style={{ display: "flex", alignItems: "center", gap: "6px", marginBottom: "10px" }}>
          <Search size={14} color="var(--primary)" />
          <span style={{ fontSize: "12px", fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.5px", color: "var(--fg-bright)" }}>
            Corpus Assertion Search
          </span>
        </div>

        <form onSubmit={handleSearch} style={{ display: "flex", gap: "8px", marginBottom: "12px" }}>
          <input
            type="text"
            placeholder="Search gene, alias, or module (e.g. VCP, ERAD, UFD1, UBXN7)..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            disabled={!activeDb}
            style={{
              flex: 1,
              padding: "7px 12px",
              fontSize: "12px",
              background: "#18181f",
              color: "var(--fg)",
              border: "1px solid var(--border)",
              borderRadius: "6px",
              outline: "none",
            }}
          />
          <button
            type="submit"
            className="btn btn-secondary btn-sm"
            disabled={isSearching || !searchQuery.trim() || !activeDb}
            style={{ display: "inline-flex", alignItems: "center", gap: "6px" }}
          >
            <Search size={13} /> {isSearching ? "Searching..." : "Search"}
          </button>
        </form>

        {searchError && (
          <div style={{ color: "var(--error)", fontSize: "11px", marginBottom: "10px" }}>
            {searchError}
          </div>
        )}

        {/* Search Results Display */}
        <div
          style={{
            maxHeight: "280px",
            overflowY: "auto",
            border: "1px solid var(--border)",
            borderRadius: "6px",
            padding: "8px 12px",
            background: "#141418",
            fontSize: "11px",
          }}
        >
          {searchResults === null ? (
            <div style={{ color: "var(--muted)", textAlign: "center", padding: "16px 0" }}>
              Enter a gene, alias, or biological term above to search assertions in <code>{activeDb || "active database"}</code>.
            </div>
          ) : searchResults.length === 0 ? (
            <div style={{ color: "var(--muted)", textAlign: "center", padding: "16px 0" }}>
              No matching assertions found for &quot;{searchQuery}&quot;.
            </div>
          ) : (
            <div>
              <div style={{ marginBottom: "8px", fontWeight: 600, color: "var(--muted)", fontSize: "10.5px" }}>
                Found {searchResults.length} assertion(s):
              </div>
              {searchResults.map((r, i) => {
                const symbol = r.canonical_human_symbol || r.raw_entity_name || "Unknown";
                const rel = r.relationship_type || "";
                const mod = r.functional_module ? ` • ${r.functional_module}` : "";
                const ctx = `${r.model_name || ""}${r.perturbation_target ? ` (${r.perturbation_target})` : ""}`;

                return (
                  <div
                    key={i}
                    style={{
                      borderBottom: i < searchResults.length - 1 ? "1px solid var(--border)" : "none",
                      padding: "8px 0",
                    }}
                  >
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
                      <span style={{ fontWeight: 700, color: "var(--fg-bright)", fontSize: "12px" }}>
                        {symbol}
                      </span>
                      {rel && (
                        <span className="badge badge-idle" style={{ fontSize: "9px" }}>
                          {rel}
                        </span>
                      )}
                    </div>
                    <div style={{ color: "var(--fg)", fontSize: "11px", marginTop: "2px" }}>
                      {ctx}
                      {mod}
                    </div>
                    {r.evidence_quote && (
                      <div style={{ fontStyle: "italic", color: "var(--muted)", fontSize: "10.5px", marginTop: "4px" }}>
                        &quot;{r.evidence_quote}&quot;
                      </div>
                    )}
                    {r.title && (
                      <div style={{ color: "var(--primary)", fontSize: "10px", marginTop: "4px" }}>
                        Ref: {r.title}
                        {r.year ? ` (${r.year})` : ""}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

