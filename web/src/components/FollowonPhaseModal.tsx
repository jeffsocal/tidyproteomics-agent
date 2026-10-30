import React, { useState, useEffect } from "react";
import {
  X,
  Sparkles,
  Play,
  Save,
  RefreshCw,
  FileCode,
  FileText,
  Send,
  Cpu,
  Layers,
  ArrowRight,
  GitBranch,
} from "lucide-react";
import { PipelineState } from "../types";

export type ManuscriptOption = "none" | "append" | "rewrite";

interface FollowonPhaseModalProps {
  pipelineState?: PipelineState;
  onClose: () => void;
  onRunPhase?: (phaseId: string) => void;
}

export const FollowonPhaseModal: React.FC<FollowonPhaseModalProps> = ({
  pipelineState,
  onClose,
  onRunPhase,
}) => {
  const phases = pipelineState?.phases || [];
  // Calculate default next index
  let maxIdx = 0;
  phases.forEach((p) => {
    const m = p.fileName.match(/^(\d+)/);
    if (m) {
      const val = parseInt(m[1], 10);
      if (val > maxIdx) maxIdx = val;
    }
  });
  const nextNum = maxIdx > 0 ? maxIdx + 1 : 12;
  const nextId = String(nextNum).padStart(2, "0");

  const [description, setDescription] = useState("");
  const [manuscriptOption, setManuscriptOption] = useState<ManuscriptOption>("append");
  const [manuscriptInfo, setManuscriptInfo] = useState<{
    hasBaseManuscript: boolean;
    latestRev: number | null;
    nextRevId: string;
    sourceFile: string;
    targetFile: string;
  } | null>(null);
  const [isGenerating, setIsGenerating] = useState(false);
  const [draftFileName, setDraftFileName] = useState(`${nextId}_CUSTOM.md`);
  const [draftTitle, setDraftTitle] = useState("");
  const [draftContent, setDraftContent] = useState("");
  const [revisionFeedback, setRevisionFeedback] = useState("");
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [saveBanner, setSaveBanner] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/pipeline/followon/info")
      .then((r) => r.json())
      .then((data) => {
        if (data.ok && data.manuscriptInfo) {
          setManuscriptInfo(data.manuscriptInfo);
        }
      })
      .catch(() => {});
  }, []);

  const sampleIdeas = [
    "Volcano plot & candidate analysis focusing strictly on ERAD co-factors and p97 adaptors",
    "Targeted kinase-substrate phosphorylation network enrichment and signaling pathways",
    "Subcellular organelle compartmentalization analysis (Mitochondria vs Golgi vs ER)",
    "Hierarchical cluster heatmap of top 50 differentially expressed proteins with replicate z-scores",
  ];

  const handleGenerateDraft = async () => {
    const trimmed = description.trim();
    if (!trimmed) {
      setErrorMsg("Please describe what analysis or plot you want to create.");
      return;
    }

    setIsGenerating(true);
    setErrorMsg(null);

    try {
      const res = await fetch("/api/pipeline/followon/draft", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ description: trimmed, manuscriptOption }),
      });
      const data = await res.json();
      if (!data.ok) throw new Error(data.error || "Failed to generate phase specification");

      const draft = data.draft;
      setDraftFileName(draft.fileName || `${nextId}_CUSTOM.md`);
      setDraftTitle(draft.title || `Phase ${nextNum}: Follow-on Analysis`);
      setDraftContent(draft.content || "");
    } catch (err: any) {
      setErrorMsg(err.message || "Failed to contact LLM Reasoner");
    } finally {
      setIsGenerating(false);
    }
  };

  const handleReviseDraft = async () => {
    const trimmed = revisionFeedback.trim();
    if (!trimmed) return;

    setIsGenerating(true);
    setErrorMsg(null);

    try {
      const res = await fetch("/api/pipeline/followon/draft", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          description: description.trim(),
          existingMarkdown: draftContent,
          feedback: trimmed,
          suggestedFileName: draftFileName,
          manuscriptOption,
        }),
      });
      const data = await res.json();
      if (!data.ok) throw new Error(data.error || "Failed to revise phase specification");

      const draft = data.draft;
      if (draft.fileName) setDraftFileName(draft.fileName);
      if (draft.title) setDraftTitle(draft.title);
      if (draft.content) setDraftContent(draft.content);
      setRevisionFeedback("");
    } catch (err: any) {
      setErrorMsg(err.message || "Failed to revise draft");
    } finally {
      setIsGenerating(false);
    }
  };

  const handleSaveAndRun = async (runNow: boolean) => {
    const fName = draftFileName.trim();
    const content = draftContent.trim();
    if (!fName || !content) {
      setErrorMsg("Filename and content cannot be empty.");
      return;
    }

    setIsGenerating(true);
    setErrorMsg(null);

    try {
      const res = await fetch("/api/pipeline/followon/save", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          fileName: fName,
          content,
          runNow,
          manuscriptOption,
        }),
      });
      const data = await res.json();
      if (!data.ok) throw new Error(data.error || "Failed to save phase");

      setSaveBanner(runNow ? "Phase added and started!" : "Phase added to pipeline!");

      setTimeout(() => {
        onClose();
        if (runNow && data.phaseId && onRunPhase) {
          onRunPhase(data.phaseId);
        }
      }, 700);
    } catch (err: any) {
      setErrorMsg(err.message || "Failed to save phase");
    } finally {
      setIsGenerating(false);
    }
  };

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(0, 0, 0, 0.75)",
        backdropFilter: "blur(4px)",
        zIndex: 9999,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: "20px",
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget && !isGenerating) onClose();
      }}
    >
      <div
        style={{
          background: "var(--card-bg, #121217)",
          border: "1px solid var(--border)",
          borderRadius: "10px",
          width: "95vw",
          maxWidth: "960px",
          height: "90vh",
          maxHeight: "840px",
          display: "flex",
          flexDirection: "column",
          boxShadow: "0 20px 50px rgba(0, 0, 0, 0.7)",
          overflow: "hidden",
        }}
      >
        {/* Header */}
        <div
          style={{
            padding: "14px 18px",
            borderBottom: "1px solid var(--border)",
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            background: "rgba(255, 255, 255, 0.02)",
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
            <Sparkles size={16} color="var(--primary)" />
            <h2 style={{ margin: 0, fontSize: "14px", fontWeight: 700, color: "var(--fg-bright)" }}>
              Create Follow-on Analysis Phase
            </h2>
            <span
              style={{
                fontSize: "10px",
                padding: "2px 6px",
                background: "rgba(59, 130, 246, 0.15)",
                color: "#93c5fd",
                borderRadius: "4px",
                border: "1px solid rgba(59, 130, 246, 0.3)",
                fontFamily: "var(--font-mono)",
              }}
            >
              Phase {nextNum} ({nextId}_*.md)
            </span>
          </div>

          <button
            type="button"
            className="btn-icon"
            onClick={onClose}
            disabled={isGenerating}
            style={{ color: "var(--muted)", background: "transparent", border: "none", cursor: "pointer" }}
            title="Close"
          >
            <X size={16} />
          </button>
        </div>

        {/* Notifications */}
        {saveBanner && (
          <div style={{ background: "rgba(16, 185, 129, 0.2)", color: "#34d399", padding: "8px 16px", fontSize: "12px", fontWeight: 600, borderBottom: "1px solid rgba(16, 185, 129, 0.3)" }}>
            ✓ {saveBanner}
          </div>
        )}
        {errorMsg && (
          <div style={{ background: "rgba(239, 68, 68, 0.2)", color: "#f87171", padding: "8px 16px", fontSize: "12px", borderBottom: "1px solid rgba(239, 68, 68, 0.3)" }}>
            ⚠️ {errorMsg}
          </div>
        )}

        {/* Body */}
        <div style={{ flex: "1 1 auto", display: "flex", flexDirection: "column", overflow: "hidden", padding: "16px", gap: "12px" }}>
          {!draftContent ? (
            /* STEP 1: Describe What to Do */
            <div style={{ display: "flex", flexDirection: "column", gap: "14px", height: "100%", justifyContent: "center", maxWidth: "680px", margin: "0 auto", width: "100%" }}>
              <div>
                <h3 style={{ margin: 0, fontSize: "15px", color: "var(--fg-bright)", fontWeight: 600 }}>
                  What analysis, plot, or deep-dive would you like to run next?
                </h3>
                <div style={{ fontSize: "12px", color: "var(--muted)", marginTop: "4px", lineHeight: "1.4" }}>
                  Describe your objective in plain English. The Tier-3 Frontier Reasoner will construct a complete, reproducible R phase specification following the standardized TidyProteomics checkpoint format.
                </div>
              </div>

              <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
                <textarea
                  className="textarea"
                  style={{
                    height: "120px",
                    padding: "10px 12px",
                    fontSize: "13px",
                    fontFamily: "var(--font-sans)",
                    resize: "none",
                  }}
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  placeholder="e.g. Perform targeted volcano and kinase-substrate enrichment analysis on downregulated proteins, generate a publication-ready volcano plot saved to data/, and export candidate tables..."
                  autoFocus
                />

                {/* Synthesis & Documentation Directives */}
                <div style={{ display: "flex", flexDirection: "column", gap: "10px", background: "rgba(255, 255, 255, 0.03)", padding: "12px 14px", borderRadius: "8px", border: "1px solid var(--border)" }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                    <div style={{ fontSize: "11px", fontWeight: 700, color: "var(--fg-bright)", letterSpacing: "0.4px", textTransform: "uppercase" }}>
                      Documentation & Manuscript Synthesis
                    </div>
                    <div style={{ display: "flex", alignItems: "center", gap: "5px", fontSize: "11px", color: "#34d399", fontWeight: 600 }}>
                      <span>✓</span>
                      <span>docs/{nextId}_*.md report mandatory</span>
                    </div>
                  </div>

                  <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
                    <div style={{ fontSize: "12px", color: "var(--muted)" }}>
                      Choose how follow-on discoveries should update the study manuscript:
                    </div>

                    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: "8px" }}>
                      {/* Option 1: Append */}
                      <label
                        style={{
                          display: "flex",
                          flexDirection: "column",
                          gap: "4px",
                          padding: "8px 10px",
                          borderRadius: "6px",
                          border: `1px solid ${manuscriptOption === "append" ? "var(--primary)" : "var(--border)"}`,
                          background: manuscriptOption === "append" ? "rgba(59, 130, 246, 0.08)" : "transparent",
                          cursor: "pointer",
                        }}
                      >
                        <div style={{ display: "flex", alignItems: "center", gap: "6px", fontSize: "12px", fontWeight: 600, color: "var(--fg-bright)" }}>
                          <input
                            type="radio"
                            name="manuscriptOption"
                            value="append"
                            checked={manuscriptOption === "append"}
                            onChange={() => setManuscriptOption("append")}
                          />
                          <span>Append Section</span>
                        </div>
                        <div style={{ fontSize: "11px", color: "var(--muted)", lineHeight: "1.3" }}>
                          Add follow-on results &amp; discussion section while preserving prior text.
                        </div>
                      </label>

                      {/* Option 2: Rewrite */}
                      <label
                        style={{
                          display: "flex",
                          flexDirection: "column",
                          gap: "4px",
                          padding: "8px 10px",
                          borderRadius: "6px",
                          border: `1px solid ${manuscriptOption === "rewrite" ? "var(--primary)" : "var(--border)"}`,
                          background: manuscriptOption === "rewrite" ? "rgba(59, 130, 246, 0.08)" : "transparent",
                          cursor: "pointer",
                        }}
                      >
                        <div style={{ display: "flex", alignItems: "center", gap: "6px", fontSize: "12px", fontWeight: 600, color: "var(--fg-bright)" }}>
                          <input
                            type="radio"
                            name="manuscriptOption"
                            value="rewrite"
                            checked={manuscriptOption === "rewrite"}
                            onChange={() => setManuscriptOption("rewrite")}
                          />
                          <span>Rewrite Manuscript</span>
                        </div>
                        <div style={{ fontSize: "11px", color: "var(--muted)", lineHeight: "1.3" }}>
                          Holistically re-synthesize abstract, results, and discussion with findings.
                        </div>
                      </label>

                      {/* Option 3: None */}
                      <label
                        style={{
                          display: "flex",
                          flexDirection: "column",
                          gap: "4px",
                          padding: "8px 10px",
                          borderRadius: "6px",
                          border: `1px solid ${manuscriptOption === "none" ? "var(--primary)" : "var(--border)"}`,
                          background: manuscriptOption === "none" ? "rgba(59, 130, 246, 0.08)" : "transparent",
                          cursor: "pointer",
                        }}
                      >
                        <div style={{ display: "flex", alignItems: "center", gap: "6px", fontSize: "12px", fontWeight: 600, color: "var(--fg-bright)" }}>
                          <input
                            type="radio"
                            name="manuscriptOption"
                            value="none"
                            checked={manuscriptOption === "none"}
                            onChange={() => setManuscriptOption("none")}
                          />
                          <span>Do Not Modify</span>
                        </div>
                        <div style={{ fontSize: "11px", color: "var(--muted)", lineHeight: "1.3" }}>
                          Keep manuscript untouched; report only in docs/{nextId}_*.md.
                        </div>
                      </label>
                    </div>

                    {manuscriptOption !== "none" && (
                      <div style={{ display: "flex", alignItems: "center", gap: "6px", fontSize: "11px", color: "var(--muted)", background: "rgba(0,0,0,0.2)", padding: "6px 10px", borderRadius: "4px" }}>
                        <GitBranch size={12} color="var(--primary)" />
                        <span>
                          Version lineage:{" "}
                          <code>{manuscriptInfo?.sourceFile || "manuscript.md"}</code> →{" "}
                          <code>{manuscriptInfo?.targetFile || `docs/manuscript_rev_${nextId}.md`}</code> (and sync to <code>docs/manuscript.md</code>)
                        </span>
                      </div>
                    )}
                  </div>
                </div>

                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                  <div style={{ display: "flex", alignItems: "center", gap: "6px", fontSize: "11px", color: "var(--muted)" }}>
                    <Cpu size={12} color="var(--primary)" />
                    <span>Orchestrated by <b>Tier-3 Scientific Reasoner</b></span>
                  </div>

                  <button
                    type="button"
                    className="btn btn-primary btn-sm"
                    disabled={isGenerating || !description.trim()}
                    onClick={handleGenerateDraft}
                    style={{ gap: "6px" }}
                  >
                    {isGenerating ? (
                      <>
                        <RefreshCw size={12} className="spin" /> Generating Phase {nextNum}...
                      </>
                    ) : (
                      <>
                        <Sparkles size={12} /> Generate Phase Specification <ArrowRight size={12} />
                      </>
                    )}
                  </button>
                </div>
              </div>

              {/* Sample Prompts */}
              <div style={{ borderTop: "1px solid var(--border)", paddingTop: "12px" }}>
                <div style={{ fontSize: "11px", fontWeight: 600, color: "var(--muted)", textTransform: "uppercase", letterSpacing: "0.4px", marginBottom: "8px" }}>
                  Sample Directives
                </div>
                <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
                  {sampleIdeas.map((idea, i) => (
                    <button
                      key={i}
                      type="button"
                      className="btn btn-secondary btn-xs"
                      style={{ textAlign: "left", justifyContent: "flex-start", padding: "6px 10px", fontSize: "11.5px", color: "var(--fg)" }}
                      onClick={() => setDescription(idea)}
                    >
                      💡 {idea}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          ) : (
            /* STEP 2: Review, Edit & Revise Draft */
            <div style={{ display: "flex", flexDirection: "column", height: "100%", gap: "10px", overflow: "hidden" }}>
              {/* Top Meta Bar */}
              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "180px 1fr",
                  gap: "10px",
                  alignItems: "center",
                  background: "var(--bg)",
                  padding: "8px 12px",
                  borderRadius: "6px",
                  border: "1px solid var(--border)",
                }}
              >
                <div>
                  <label className="field-label" style={{ margin: "0 0 2px 0", fontSize: "10px" }}>Phase Filename</label>
                  <input
                    type="text"
                    className="input"
                    style={{ padding: "4px 8px", fontSize: "11px", fontFamily: "var(--font-mono)" }}
                    value={draftFileName}
                    onChange={(e) => setDraftFileName(e.target.value)}
                  />
                </div>
                <div>
                  <label className="field-label" style={{ margin: "0 0 2px 0", fontSize: "10px" }}>Phase Title</label>
                  <input
                    type="text"
                    className="input"
                    style={{ padding: "4px 8px", fontSize: "11px" }}
                    value={draftTitle}
                    onChange={(e) => setDraftTitle(e.target.value)}
                  />
                </div>
              </div>

              {/* Editable Markdown Content Area */}
              <div style={{ flex: "1 1 auto", display: "flex", flexDirection: "column", minHeight: 0 }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "4px" }}>
                  <span style={{ fontSize: "11px", color: "var(--muted)", display: "flex", alignItems: "center", gap: "4px" }}>
                    <FileCode size={12} /> Markdown Specification (Directly Editable)
                  </span>
                  <span style={{ fontSize: "10px", color: "var(--muted)" }}>
                    {draftContent.split("\n").length} lines
                  </span>
                </div>
                <textarea
                  className="textarea"
                  style={{
                    flex: "1 1 auto",
                    width: "100%",
                    fontFamily: "var(--font-mono)",
                    fontSize: "11.5px",
                    lineHeight: "1.5",
                    padding: "10px 12px",
                    resize: "none",
                    background: "rgba(0, 0, 0, 0.35)",
                  }}
                  value={draftContent}
                  onChange={(e) => setDraftContent(e.target.value)}
                />
              </div>

              {/* Iterative Revision Chat Bar */}
              <div
                style={{
                  background: "var(--bg)",
                  border: "1px solid var(--border)",
                  borderRadius: "6px",
                  padding: "8px 12px",
                  display: "flex",
                  flexDirection: "column",
                  gap: "6px",
                }}
              >
                <div style={{ fontSize: "10.5px", fontWeight: 600, color: "var(--muted)", textTransform: "uppercase", letterSpacing: "0.3px", display: "flex", alignItems: "center", gap: "4px" }}>
                  <Sparkles size={11} color="var(--primary)" /> Revise Phase Specification with LLM
                </div>
                <div style={{ display: "flex", gap: "8px" }}>
                  <input
                    type="text"
                    className="input"
                    style={{ flex: "1 1 auto", padding: "6px 10px", fontSize: "12px" }}
                    placeholder="e.g. Change the significance cutoff to |log2FC| >= 1.5, add a heatmap of top 30 proteins, or use Wilcoxon test..."
                    value={revisionFeedback}
                    onChange={(e) => setRevisionFeedback(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" && !e.shiftKey && !isGenerating && revisionFeedback.trim()) {
                        e.preventDefault();
                        handleReviseDraft();
                      }
                    }}
                    disabled={isGenerating}
                  />
                  <button
                    type="button"
                    className="btn btn-secondary btn-sm"
                    onClick={handleReviseDraft}
                    disabled={isGenerating || !revisionFeedback.trim()}
                    style={{ gap: "4px", padding: "6px 12px" }}
                  >
                    {isGenerating ? (
                      <RefreshCw size={12} className="spin" />
                    ) : (
                      <>
                        <Send size={12} /> Revise
                      </>
                    )}
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Footer Actions */}
        <div
          style={{
            padding: "12px 18px",
            borderTop: "1px solid var(--border)",
            background: "rgba(255, 255, 255, 0.02)",
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
          }}
        >
          {draftContent ? (
            <button
              type="button"
              className="btn btn-secondary btn-xs"
              onClick={() => {
                setDraftContent("");
                setErrorMsg(null);
              }}
              disabled={isGenerating}
            >
              ← Start Over
            </button>
          ) : (
            <div />
          )}

          <div style={{ display: "flex", gap: "8px", alignItems: "center" }}>
            <button
              type="button"
              className="btn btn-secondary btn-sm"
              onClick={onClose}
              disabled={isGenerating}
            >
              Cancel
            </button>

            {draftContent && (
              <>
                <button
                  type="button"
                  className="btn btn-secondary btn-sm"
                  onClick={() => handleSaveAndRun(false)}
                  disabled={isGenerating}
                  style={{ gap: "5px" }}
                >
                  <Save size={12} /> Save &amp; Add to Pipeline
                </button>
                <button
                  type="button"
                  className="btn btn-success btn-sm"
                  onClick={() => handleSaveAndRun(true)}
                  disabled={isGenerating}
                  style={{ gap: "5px" }}
                >
                  <Play size={12} /> Save &amp; Run Phase Now
                </button>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

