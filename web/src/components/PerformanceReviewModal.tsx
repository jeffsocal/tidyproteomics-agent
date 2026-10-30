import React, { useState, useEffect, useMemo, useRef } from "react";
import {
  X,
  Award,
  Sparkles,
  RefreshCw,
  FileText,
  Copy,
  Check,
  ChevronDown,
  ChevronUp,
  AlertTriangle,
  ExternalLink,
  Edit3,
  Eye,
  Save,
} from "lucide-react";
import { marked } from "marked";
import { PerformanceReviewResult, PerformanceReviewStatus } from "../types";

interface PerformanceReviewModalProps {
  onClose: () => void;
  onOpenFile: (relPath: string) => void;
}

export const PerformanceReviewModal: React.FC<PerformanceReviewModalProps> = ({
  onClose,
  onOpenFile,
}) => {
  const [loadingStatus, setLoadingStatus] = useState(true);
  const [status, setStatus] = useState<PerformanceReviewStatus | null>(null);
  const [content, setContent] = useState<string>("");
  const [isGenerating, setIsGenerating] = useState(false);
  const [customFocus, setCustomFocus] = useState("");
  const [showFocusInput, setShowFocusInput] = useState(false);
  const [copied, setCopied] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [isEditing, setIsEditing] = useState(false);
  const [editBuffer, setEditBuffer] = useState("");
  const [saveNotice, setSaveNotice] = useState(false);

  // Generation step animation
  const [genStep, setGenStep] = useState(0);

  const fetchStatusAndContent = async () => {
    setLoadingStatus(true);
    setErrorMsg(null);
    try {
      const res = await fetch("/api/performance-review/content");
      const data = await res.json();
      if (data.ok) {
        setStatus(data.status);
        if (data.content) {
          setContent(data.content);
          setEditBuffer(data.content);
        }
      } else {
        setErrorMsg(data.error || "Failed to load performance review status");
      }
    } catch (err: any) {
      setErrorMsg(err.message || "Failed to connect to server");
    } finally {
      setLoadingStatus(false);
    }
  };

  useEffect(() => {
    fetchStatusAndContent();
  }, []);

  // Step ticker while generating
  useEffect(() => {
    if (!isGenerating) return;
    const interval = setInterval(() => {
      setGenStep((s) => (s + 1) % 4);
    }, 3200);
    return () => clearInterval(interval);
  }, [isGenerating]);

  const handleGenerate = async () => {
    setIsGenerating(true);
    setErrorMsg(null);
    setGenStep(0);
    try {
      const res = await fetch("/api/performance-review/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ customFocus: customFocus.trim() || undefined }),
      });
      const data: PerformanceReviewResult = await res.json();
      if (data.ok && data.reviewMarkdown) {
        setContent(data.reviewMarkdown);
        setEditBuffer(data.reviewMarkdown);
        await fetchStatusAndContent();
      } else {
        setErrorMsg(data.error || "Performance review generation failed.");
      }
    } catch (err: any) {
      setErrorMsg(err.message || "Network error while generating performance review");
    } finally {
      setIsGenerating(false);
    }
  };

  const handleSaveEdit = async () => {
    try {
      const res = await fetch("/api/performance-review/save", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content: editBuffer }),
      });
      const data = await res.json();
      if (data.ok) {
        setContent(editBuffer);
        setIsEditing(false);
        setSaveNotice(true);
        setTimeout(() => setSaveNotice(false), 2000);
      } else {
        setErrorMsg(data.error || "Failed to save edits");
      }
    } catch (err: any) {
      setErrorMsg(err.message || "Failed to save edits");
    }
  };

  const handleCopy = () => {
    if (!content) return;
    navigator.clipboard.writeText(content);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const renderedHtml = useMemo(() => {
    if (!content) return "";
    try {
      return marked.parse(content, { async: false }) as string;
    } catch {
      return content;
    }
  }, [content]);

  const stepDescriptions = [
    "Auditing workspace logs (logs/pipeline.md, logs/*/chat.md, logs/*/console.log)...",
    "Extracting tool call histories, parameter schemas, and console warning/error traces...",
    "Evaluating biological hypotheses and data grounding in docs/observations.md and docs/manuscript.md...",
    "Tier 3 Reasoner model attributing bugs to LLM, Prompt, or Tools and drafting comprehensive review...",
  ];

  return (
    <div
      style={{
        position: "fixed",
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        background: "rgba(0, 0, 0, 0.78)",
        backdropFilter: "blur(4px)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        zIndex: 1000,
        padding: "24px",
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget && !isGenerating) {
          onClose();
        }
      }}
    >
      <div
        className="card"
        style={{
          width: "100%",
          maxWidth: "1080px",
          height: "92vh",
          display: "flex",
          flexDirection: "column",
          background: "var(--panel-bg)",
          border: "1px solid var(--border)",
          borderRadius: "12px",
          overflow: "hidden",
          boxShadow: "0 25px 60px -15px rgba(0, 0, 0, 0.7)",
        }}
      >
        {/* Modal Header */}
        <div
          style={{
            padding: "16px 22px",
            borderBottom: "1px solid var(--border)",
            background: "#16161b",
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            flexShrink: 0,
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
            <div
              style={{
                width: "32px",
                height: "32px",
                borderRadius: "8px",
                background: "rgba(245, 158, 11, 0.15)",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                border: "1px solid rgba(245, 158, 11, 0.3)",
              }}
            >
              <Award size={18} color="var(--warning)" />
            </div>
            <div>
              <div
                style={{
                  fontSize: "15px",
                  fontWeight: 700,
                  color: "var(--fg-bright)",
                  display: "flex",
                  alignItems: "center",
                  gap: "8px",
                }}
              >
                <span>Autonomous Agent Performance Review</span>
                <span
                  style={{
                    fontSize: "10px",
                    fontWeight: 600,
                    textTransform: "uppercase",
                    padding: "2px 6px",
                    borderRadius: "4px",
                    background: "rgba(59, 130, 246, 0.15)",
                    color: "#60a5fa",
                    border: "1px solid rgba(59, 130, 246, 0.3)",
                  }}
                >
                  Tier-3 Reasoner Audit
                </span>
              </div>
              <div style={{ fontSize: "11.5px", color: "var(--muted)", marginTop: "2px" }}>
                Deep evaluation of tool usage, user interaction, biological hypotheses, and bug attribution (LLM vs. Prompt vs. Tools).
              </div>
            </div>
          </div>

          <button
            type="button"
            className="btn btn-secondary btn-xs"
            onClick={onClose}
            disabled={isGenerating}
            style={{ padding: "6px", borderRadius: "6px" }}
            title="Close (Esc)"
          >
            <X size={15} />
          </button>
        </div>

        {/* Toolbar & Status Bar */}
        <div
          style={{
            padding: "10px 22px",
            borderBottom: "1px solid var(--border)",
            background: "#121216",
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            flexShrink: 0,
            gap: "12px",
            flexWrap: "wrap",
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: "10px", fontSize: "12px" }}>
            {status?.hasReview ? (
              <span
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: "5px",
                  color: "var(--success)",
                  fontSize: "11.5px",
                  fontWeight: 600,
                }}
              >
                <Check size={13} /> Active Audit Ready
                {status.lastGenerated && (
                  <span style={{ color: "var(--muted)", fontWeight: 400 }}>
                    ({new Date(status.lastGenerated).toLocaleString()})
                  </span>
                )}
              </span>
            ) : status?.hasLogs ? (
              <span style={{ color: "var(--muted)", fontSize: "11.5px" }}>
                Logs discovered across {status.phaseCount} phases. Ready for review.
              </span>
            ) : (
              <span style={{ color: "var(--muted)", fontSize: "11.5px" }}>
                No execution logs recorded in workspace yet.
              </span>
            )}

            <button
              type="button"
              className="btn btn-secondary btn-xs"
              style={{ fontSize: "11px", padding: "3px 8px" }}
              onClick={() => setShowFocusInput((prev) => !prev)}
            >
              {showFocusInput ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
              {showFocusInput ? "Hide Custom Directives" : "Custom Directives..."}
            </button>
          </div>

          <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
            {content && !isGenerating && (
              <>
                <button
                  type="button"
                  className="btn btn-secondary btn-xs"
                  onClick={handleCopy}
                  title="Copy review markdown to clipboard"
                  style={{ gap: "4px" }}
                >
                  {copied ? <Check size={12} color="var(--success)" /> : <Copy size={12} />}
                  {copied ? "Copied!" : "Copy"}
                </button>
                <button
                  type="button"
                  className="btn btn-secondary btn-xs"
                  onClick={() => {
                    onOpenFile("docs/performance_review.md");
                    onClose();
                  }}
                  title="Open in center markdown viewer"
                  style={{ gap: "4px" }}
                >
                  <ExternalLink size={12} /> Open in Viewer
                </button>
                <button
                  type="button"
                  className="btn btn-secondary btn-xs"
                  onClick={() => setIsEditing(!isEditing)}
                  style={{ gap: "4px" }}
                >
                  {isEditing ? <Eye size={12} /> : <Edit3 size={12} />}
                  {isEditing ? "View Rendered" : "Edit Raw"}
                </button>
                {isEditing && (
                  <button
                    type="button"
                    className="btn btn-primary btn-xs"
                    onClick={handleSaveEdit}
                    style={{ gap: "4px" }}
                  >
                    <Save size={12} /> {saveNotice ? "Saved!" : "Save"}
                  </button>
                )}
              </>
            )}

            <button
              type="button"
              className="btn btn-primary btn-xs"
              onClick={handleGenerate}
              disabled={isGenerating || !status?.hasLogs}
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: "6px",
                background: "linear-gradient(135deg, #3b82f6, #1d4ed8)",
                padding: "6px 12px",
                fontWeight: 600,
              }}
            >
              {isGenerating ? (
                <>
                  <RefreshCw size={13} className="spin" /> Generating Review...
                </>
              ) : content ? (
                <>
                  <RefreshCw size={13} /> Regenerate Audit
                </>
              ) : (
                <>
                  <Sparkles size={13} /> Run Performance Review
                </>
              )}
            </button>
          </div>
        </div>

        {/* Optional Custom Directives Drawer */}
        {showFocusInput && (
          <div
            style={{
              padding: "12px 22px",
              background: "#18181f",
              borderBottom: "1px solid var(--border)",
              display: "flex",
              flexDirection: "column",
              gap: "6px",
              flexShrink: 0,
            }}
          >
            <div style={{ fontSize: "11px", fontWeight: 600, color: "var(--fg-bright)" }}>
              Custom Evaluation Directives (Optional):
            </div>
            <input
              type="text"
              className="input-field"
              value={customFocus}
              onChange={(e) => setCustomFocus(e.target.value)}
              placeholder="e.g. Focus on Phase 06 hypothesis validity, examine Phase 11 early halt, check normalization benchmark reasoning..."
              style={{ fontSize: "12px", padding: "6px 10px" }}
            />
          </div>
        )}

        {/* Error Banner */}
        {errorMsg && (
          <div
            style={{
              padding: "10px 22px",
              background: "rgba(239, 68, 68, 0.12)",
              borderBottom: "1px solid rgba(239, 68, 68, 0.3)",
              color: "#fca5a5",
              fontSize: "12px",
              display: "flex",
              alignItems: "center",
              gap: "8px",
              flexShrink: 0,
            }}
          >
            <AlertTriangle size={14} color="var(--error)" />
            <span>{errorMsg}</span>
          </div>
        )}

        {/* Main Body */}
        <div style={{ flex: "1 1 auto", overflowY: "auto", padding: "20px 24px", background: "var(--bg)" }}>
          {isGenerating ? (
            <div
              style={{
                display: "flex",
                flexDirection: "column",
                alignItems: "center",
                justifyContent: "center",
                height: "100%",
                gap: "18px",
                maxWidth: "600px",
                margin: "0 auto",
                textAlign: "center",
              }}
            >
              <div
                style={{
                  width: "56px",
                  height: "56px",
                  borderRadius: "50%",
                  background: "rgba(59, 130, 246, 0.12)",
                  border: "2px solid rgba(59, 130, 246, 0.3)",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                }}
              >
                <RefreshCw size={26} color="var(--primary)" className="spin" />
              </div>

              <div>
                <div style={{ fontSize: "16px", fontWeight: 700, color: "var(--fg-bright)", marginBottom: "6px" }}>
                  Autonomous Performance Review in Progress
                </div>
                <div style={{ fontSize: "12.5px", color: "var(--muted)", lineHeight: 1.5 }}>
                  The Tier-3 Reasoner model is parsing multi-phase execution traces, tool arguments, console errors, and biological conclusions.
                </div>
              </div>

              <div
                style={{
                  width: "100%",
                  background: "var(--card-bg)",
                  border: "1px solid var(--border)",
                  borderRadius: "8px",
                  padding: "14px 18px",
                  fontSize: "12px",
                  color: "#60a5fa",
                  fontFamily: "var(--font-mono)",
                  textAlign: "left",
                  display: "flex",
                  alignItems: "center",
                  gap: "10px",
                }}
              >
                <Sparkles size={14} color="var(--primary)" />
                <span>{stepDescriptions[genStep]}</span>
              </div>
            </div>
          ) : content ? (
            isEditing ? (
              <textarea
                value={editBuffer}
                onChange={(e) => setEditBuffer(e.target.value)}
                style={{
                  width: "100%",
                  height: "100%",
                  minHeight: "500px",
                  background: "var(--panel-bg)",
                  border: "1px solid var(--border)",
                  borderRadius: "6px",
                  padding: "16px",
                  color: "var(--fg-bright)",
                  fontFamily: "var(--font-mono)",
                  fontSize: "12px",
                  lineHeight: 1.5,
                  resize: "none",
                }}
              />
            ) : (
              <div
                className="markdown-content"
                style={{
                  fontSize: "13px",
                  lineHeight: 1.65,
                  maxWidth: "920px",
                  margin: "0 auto",
                  color: "var(--fg)",
                }}
                dangerouslySetInnerHTML={{ __html: renderedHtml }}
              />
            )
          ) : (
            <div
              style={{
                display: "flex",
                flexDirection: "column",
                alignItems: "center",
                justifyContent: "center",
                height: "100%",
                gap: "14px",
                textAlign: "center",
                maxWidth: "520px",
                margin: "0 auto",
              }}
            >
              <div
                style={{
                  width: "56px",
                  height: "56px",
                  borderRadius: "50%",
                  background: "rgba(245, 158, 11, 0.12)",
                  border: "1px solid rgba(245, 158, 11, 0.3)",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                }}
              >
                <Award size={26} color="var(--warning)" />
              </div>

              <div>
                <div style={{ fontSize: "16px", fontWeight: 700, color: "var(--fg-bright)", marginBottom: "6px" }}>
                  No Performance Review Generated Yet
                </div>
                <div style={{ fontSize: "12.5px", color: "var(--muted)", lineHeight: 1.55 }}>
                  Click <strong>Run Performance Review</strong> to prompt the Tier-3 Reasoner model to inspect all phase chat logs, evaluate tool usage, assess biological hypotheses, and categorize any bugs encountered into LLM, Prompt, or Tools.
                </div>
              </div>

              <button
                type="button"
                className="btn btn-primary"
                onClick={handleGenerate}
                disabled={!status?.hasLogs}
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: "7px",
                  padding: "8px 18px",
                  marginTop: "6px",
                  fontWeight: 600,
                }}
              >
                <Sparkles size={14} /> Run Performance Review
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

