import React, { useEffect, useState, useMemo } from "react";
import {
  Save,
  Sparkles,
  Plus,
  Trash2,
  CheckCircle2,
  AlertCircle,
  FileCode,
  Sliders,
  Columns,
  RefreshCw,
} from "lucide-react";
import { ExperimentSpec, FileTreeNode } from "../types";

interface ExperimentFormTabProps {
  spec?: ExperimentSpec;
  rawMarkdown: string;
  fileTree: FileTreeNode[];
  onSaveForm: (patch: Partial<ExperimentSpec>) => Promise<void>;
  onSaveRaw: (raw: string) => Promise<void>;
  onConfirmAndProceed: (contrasts?: string[], phaseId?: string) => Promise<void>;
}

const PLATFORMS = [
  "MaxQuant",
  "DIA-NN",
  "Spectronaut",
  "FragPipe",
  "ProteomeDiscoverer",
  "tidyproteomics",
  "rds",
];

const IMPUTATION_METHODS = [
  { value: "randomforest_grouped", label: "Random Forest Grouped (MAR Default — Karpievitch 2012)" },
  { value: "min_column", label: "Column Minimum LOD (MNAR / Knockout / Targeted Suppression)" },
  { value: "min_row_grouped", label: "Row Minimum Grouped" },
  { value: "none", label: "None (Pass-through / Unimputed)" },
];

const NORMALIZATION_MODELS = [
  "scaled",
  "median",
  "linear",
  "limma",
  "loess",
  "svm",
  "randomforest",
];

export const ExperimentFormTab: React.FC<ExperimentFormTabProps> = ({
  spec,
  rawMarkdown,
  fileTree,
  onSaveForm,
  onSaveRaw,
  onConfirmAndProceed,
}) => {
  const [viewMode, setViewMode] = useState<"form" | "split" | "raw">("form");
  const [pathToDataFile, setPathToDataFile] = useState("");
  const [platform, setPlatform] = useState("MaxQuant");
  const [analyte, setAnalyte] = useState<"proteins" | "peptides">("proteins");
  const [description, setDescription] = useState("");

  // Section 3 state
  const [discoveredGroupsConfirmed, setDiscoveredGroupsConfirmed] = useState(false);
  const [poolingRows, setPoolingRows] = useState<Array<{ raw: string; clean: string }>>([]);
  const [reassignSampleNames, setReassignSampleNames] = useState(true);
  const [samplePoolingConfirmed, setSamplePoolingConfirmed] = useState(false);
  const [contrastRows, setContrastRows] = useState<Array<{ treatment: string; control: string }>>([
    { treatment: "", control: "" },
  ]);
  const [contrastConfirmed, setContrastConfirmed] = useState(false);
  const [batchConfoundingDetected, setBatchConfoundingDetected] = useState(false);
  const [batchConfoundingAuthorized, setBatchConfoundingAuthorized] = useState(false);
  const [batchConfoundingConfirmed, setBatchConfoundingConfirmed] = useState(false);
  const [imputationMethod, setImputationMethod] = useState("randomforest_grouped");
  const [imputationConfirmed, setImputationConfirmed] = useState(false);
  const [normalizationMethods, setNormalizationMethods] = useState("default");
  const [normalizationSubsetFilter, setNormalizationSubsetFilter] = useState("NONE");
  const [normalizationConfirmed, setNormalizationConfirmed] = useState(false);

  // 3.G Annotation Strategy state
  const [annotationSource, setAnnotationSource] = useState("uniprot");
  const [annotationFilePath, setAnnotationFilePath] = useState("NONE");
  const [annotationTaxonId, setAnnotationTaxonId] = useState("(Pending Phase 1 target organism identification)");
  const [annotationOntologies, setAnnotationOntologies] = useState("biological_process, cellular_component, molecular_function, reactome_pathway");
  const [annotationValidationStatus, setAnnotationValidationStatus] = useState("PENDING");
  const [annotationConfirmed, setAnnotationConfirmed] = useState(false);

  const [rawText, setRawText] = useState(rawMarkdown || "");
  const [saveBanner, setSaveBanner] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);

  // Sync incoming spec into local form controls
  useEffect(() => {
    if (!spec) return;
    setPathToDataFile(spec.pathToDataFile || "");
    setPlatform(spec.platform || "MaxQuant");
    setAnalyte(spec.analyte === "peptides" ? "peptides" : "proteins");
    setDescription(spec.description || "");
    setDiscoveredGroupsConfirmed(!!spec.discoveredGroupsConfirmed);
    setReassignSampleNames(spec.reassignSampleNames !== false);
    setSamplePoolingConfirmed(!!spec.samplePoolingConfirmed);
    setContrastConfirmed(!!spec.contrastConfirmed);
    setBatchConfoundingDetected(!!spec.batchConfoundingDetected);
    setBatchConfoundingAuthorized(!!spec.batchConfoundingAuthorized);
    setBatchConfoundingConfirmed(!!spec.batchConfoundingConfirmed);
    setImputationMethod(spec.imputationMethod || "randomforest_grouped");
    setImputationConfirmed(!!spec.imputationConfirmed);
    setNormalizationMethods(spec.normalizationMethods || "default");
    setNormalizationSubsetFilter(spec.normalizationSubsetFilter || "NONE");
    setNormalizationConfirmed(!!spec.normalizationConfirmed);
    setAnnotationSource(spec.annotationSource || "uniprot");
    setAnnotationFilePath(spec.annotationFilePath || "NONE");
    setAnnotationTaxonId(spec.annotationTaxonId || "(Pending Phase 1 target organism identification)");
    setAnnotationOntologies(spec.annotationOntologies || "biological_process, cellular_component, molecular_function, reactome_pathway");
    setAnnotationValidationStatus(spec.annotationValidationStatus || "PENDING");
    setAnnotationConfirmed(!!spec.annotationConfirmed);

    const mapEntries = Object.entries(spec.sampleRenamingMap || {}).map(([raw, clean]) => ({
      raw,
      clean,
    }));
    if (mapEntries.length > 0) {
      setPoolingRows(mapEntries);
    } else if (spec.rawSampleGroups && spec.rawSampleGroups.length > 0) {
      setPoolingRows(
        spec.rawSampleGroups.map((r) => ({
          raw: r,
          clean: r.replace(/^st\d+_/, "").replace(/[_\-]\d+$/, ""),
        }))
      );
    } else {
      setPoolingRows([]);
    }

    if (spec.targetContrasts && spec.targetContrasts.length > 0) {
      const parsed = spec.targetContrasts.map((c) => {
        const clean = c.replace(/[`'"]/g, "").trim();
        const parts = clean.split(/\s*(?:\/|vs\.?|versus)\s*/i);
        return {
          treatment: parts[0] || "",
          control: parts[1] || "",
        };
      });
      setContrastRows(parsed);
    } else {
      setContrastRows([{ treatment: "", control: "" }]);
    }
  }, [spec]);

  useEffect(() => {
    setRawText(rawMarkdown || "");
  }, [rawMarkdown]);

  // Discover candidate data files in data/, data/raw/, or root of linked local folder for quick dropdown selection
  const dataFileCandidates: string[] = [];
  const excludedPrefixes = ["docs/", "logs/", "tools/", "agent/", "reference/", "analysis/", "code/", "literature/"];
  const collectDataFiles = (nodes: FileTreeNode[]) => {
    for (const n of nodes) {
      if (n.type === "file" && /\.(xlsx|tsv|txt|csv|parquet|rds)$/i.test(n.name)) {
        if (!excludedPrefixes.some((p) => n.relPath.startsWith(p))) {
          dataFileCandidates.push(n.relPath);
        }
      } else if (n.children) {
        collectDataFiles(n.children);
      }
    }
  };
  collectDataFiles(fileTree || []);

  // Candidate group names for contrast builder dropdowns (derived after 3.d grouping & pooling)
  const availableGroups = useMemo(() => {
    const cleanFromPooling = Array.from(
      new Set(poolingRows.map((r) => r.clean.trim()).filter(Boolean))
    );
    if (cleanFromPooling.length > 0) {
      return cleanFromPooling;
    }
    const raw =
      spec?.rawSampleGroups && spec.rawSampleGroups.length > 0
        ? spec.rawSampleGroups
        : spec?.discoveredGroups || [];
    return Array.from(new Set(raw.filter(Boolean)));
  }, [poolingRows, spec?.rawSampleGroups, spec?.discoveredGroups]);

  const buildPatch = (): Partial<ExperimentSpec> => {
    const sampleRenamingMap: Record<string, string> = {};
    for (const r of poolingRows) {
      if (r.raw.trim() && r.clean.trim()) {
        sampleRenamingMap[r.raw.trim()] = r.clean.trim();
      }
    }
    const targetContrasts = contrastRows
      .filter((c) => c.treatment.trim() && c.control.trim())
      .map((c) => `${c.treatment.trim()} / ${c.control.trim()}`);

    return {
      pathToDataFile: pathToDataFile.trim(),
      platform: platform.trim(),
      analyte,
      description: description.trim(),
      discoveredGroupsConfirmed,
      normalizationMethods: normalizationMethods.trim() || "default",
      normalizationSubsetFilter: normalizationSubsetFilter.trim() || "NONE",
      normalizationConfirmed,
      imputationMethod,
      imputationConfirmed,
      sampleRenamingMap,
      reassignSampleNames,
      samplePoolingConfirmed,
      targetContrasts,
      contrastConfirmed,
      batchConfoundingDetected,
      batchConfoundingAuthorized,
      batchConfoundingConfirmed,
      annotationSource,
      annotationFilePath,
      annotationTaxonId,
      annotationOntologies,
      annotationValidationStatus,
      annotationConfirmed,
    };
  };

  const handleSaveStructured = async () => {
    setIsSaving(true);
    try {
      await onSaveForm(buildPatch());
      setSaveBanner("Saved changes to docs/experiment.md");
      setTimeout(() => setSaveBanner(null), 2500);
    } finally {
      setIsSaving(false);
    }
  };

  const handleSaveRawMarkdown = async () => {
    setIsSaving(true);
    try {
      await onSaveRaw(rawText);
      setSaveBanner("Saved raw docs/experiment.md");
      setTimeout(() => setSaveBanner(null), 2500);
    } finally {
      setIsSaving(false);
    }
  };

  const handleConfirmAllAndProceed = async () => {
    setIsSaving(true);
    try {
      const patch = buildPatch();
      patch.discoveredGroupsConfirmed = true;
      patch.normalizationConfirmed = true;
      patch.imputationConfirmed = true;
      patch.samplePoolingConfirmed = true;
      patch.contrastConfirmed = true;
      patch.annotationConfirmed = true;
      if (spec?.batchConfoundingDetected || batchConfoundingDetected || patch.batchConfoundingAuthorized) {
        patch.batchConfoundingAuthorized = true;
        patch.batchConfoundingConfirmed = true;
      }
      await onSaveForm(patch);
      await onConfirmAndProceed(patch.targetContrasts);
      setSaveBanner("Confirmed all study design subtasks & resumed pipeline!");
      setTimeout(() => setSaveBanner(null), 3000);
    } finally {
      setIsSaving(false);
    }
  };

  const toggleNormModel = (model: string) => {
    if (normalizationMethods === "default") {
      setNormalizationMethods(model);
      return;
    }
    if (normalizationMethods === "all") {
      setNormalizationMethods(NORMALIZATION_MODELS.filter((m) => m !== model).join(", "));
      return;
    }
    const current = normalizationMethods
      .split(",")
      .map((s) => s.trim().toLowerCase())
      .filter(Boolean);
    if (current.includes(model)) {
      const next = current.filter((m) => m !== model);
      setNormalizationMethods(next.length > 0 ? next.join(", ") : "default");
    } else {
      setNormalizationMethods([...current, model].join(", "));
    }
  };

  const isBatchConfoundingIssue = Boolean(
    spec?.batchConfoundingDetected ||
    batchConfoundingDetected ||
    (rawMarkdown && /-\s*\*\*Batch Confounding Detected\*\*:\s*TRUE/i.test(rawMarkdown))
  );

  const hasPreliminaryData = Boolean(
    (spec?.rawSampleGroups && spec.rawSampleGroups.length > 0) ||
    (spec?.discoveredGroups && spec.discoveredGroups.length > 0)
  );

  // Exact bits needing input in the experiment.md form (highlighted in orange outline)
  const needsDataFile = !pathToDataFile.trim() || pathToDataFile.includes("[REQUIRED") || spec?.missingInitialFields?.includes("PATH_TO_DATA_FILE");
  const needsPlatform = !platform.trim() || spec?.missingInitialFields?.includes("PLATFORM");
  const needsAnalyte = !analyte || spec?.missingInitialFields?.includes("ANALYTE");
  const needsDescription = !description.trim() || description.trim().length < 10 || description.includes("[REQUIRED") || spec?.missingInitialFields?.includes("DESCRIPTION");

  // Section 3 sub-tasks needing confirmation / input:
  // 3.d and 3.e only need to be engaged as an Action Required after preliminary data inspection and/or ingestion.
  // 3.g only needs to be engaged as a HITL stopping point after target organism has been identified.
  const needs3A = hasPreliminaryData && !discoveredGroupsConfirmed;
  const needs3B = !normalizationConfirmed;
  const needs3C = !imputationConfirmed;
  const needs3D = hasPreliminaryData && !samplePoolingConfirmed;
  const hasValidContrast = contrastRows.some((c) => c.treatment.trim() && c.control.trim());
  const needs3E = hasPreliminaryData && (!contrastConfirmed || !hasValidContrast);
  const needs3F = isBatchConfoundingIssue && !batchConfoundingAuthorized;

  const isOrganismPending =
    !annotationTaxonId ||
    /pending|unknown|none|required|^$/i.test(annotationTaxonId.trim()) ||
    annotationTaxonId.includes("(") ||
    annotationTaxonId.includes("<");

  const hasTargetOrganism = Boolean(hasPreliminaryData && !isOrganismPending);

  const needs3G = annotationSource === "none"
    ? false
    : annotationSource === "file"
      ? (hasPreliminaryData && !annotationConfirmed)
      : (hasTargetOrganism && !annotationConfirmed);

  const hitlActionCount = [
    needsDataFile,
    needsPlatform,
    needsAnalyte,
    needsDescription,
    needs3A,
    needs3B,
    needs3C,
    needs3D,
    needs3E,
    needs3F,
    needs3G,
  ].filter(Boolean).length;

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", overflow: "hidden" }}>
      {/* Top Toolbar */}
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          padding: "10px 20px",
          borderBottom: "1px solid var(--border)",
          background: "var(--tabbar-bg)",
          flexShrink: 0,
          gap: "12px",
          flexWrap: "wrap",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
          <span style={{ fontWeight: 700, fontSize: "13.5px", color: "var(--fg-bright)" }}>
            Experiment &amp; Dataset Specification (`docs/experiment.md`)
          </span>
          {hitlActionCount === 0 ? (
            <span className="badge badge-completed">
              <CheckCircle2 size={11} /> Ready
            </span>
          ) : (
            <span className="hitl-highlight-badge">
              <AlertCircle size={11} /> {hitlActionCount} {hitlActionCount === 1 ? "Action" : "Actions"} Required
            </span>
          )}
          {saveBanner && (
            <span style={{ color: "var(--success)", fontSize: "11.5px", fontWeight: 600 }}>
              ✓ {saveBanner}
            </span>
          )}
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
          {/* View Mode Switcher */}
          <div
            style={{
              display: "inline-flex",
              background: "var(--bg)",
              border: "1px solid var(--border-strong)",
              borderRadius: "6px",
              padding: "2px",
            }}
          >
            <button
              type="button"
              className="btn btn-xs"
              style={{
                background: viewMode === "form" ? "var(--primary)" : "transparent",
                color: viewMode === "form" ? "#fff" : "var(--muted)",
              }}
              onClick={() => setViewMode("form")}
            >
              <Sliders size={11} /> Form
            </button>
            <button
              type="button"
              className="btn btn-xs"
              style={{
                background: viewMode === "split" ? "var(--primary)" : "transparent",
                color: viewMode === "split" ? "#fff" : "var(--muted)",
              }}
              onClick={() => setViewMode("split")}
            >
              <Columns size={11} /> Split
            </button>
            <button
              type="button"
              className="btn btn-xs"
              style={{
                background: viewMode === "raw" ? "var(--primary)" : "transparent",
                color: viewMode === "raw" ? "#fff" : "var(--muted)",
              }}
              onClick={() => setViewMode("raw")}
            >
              <FileCode size={11} /> Raw Markdown
            </button>
          </div>

          {viewMode !== "raw" && (
            <>
              <button
                type="button"
                className="btn btn-xs"
                onClick={handleSaveStructured}
                disabled={isSaving}
              >
                <Save size={12} /> Save Form
              </button>
              <button
                type="button"
                className="btn btn-success btn-xs"
                onClick={handleConfirmAllAndProceed}
                disabled={isSaving}
                title="Save all fields, mark all Section 3 subtasks confirmed, and resume pipeline"
              >
                <Sparkles size={12} /> Confirm All Study Design &amp; Proceed
              </button>
            </>
          )}
          {viewMode === "raw" && (
            <button
              type="button"
              className="btn btn-xs"
              onClick={handleSaveRawMarkdown}
              disabled={isSaving}
            >
              <Save size={12} /> Save Raw Markdown
            </button>
          )}
        </div>
      </div>

      {/* Main Content Area */}
      <div
        style={{
          flex: "1 1 auto",
          display: "grid",
          gridTemplateColumns:
            viewMode === "split" ? "minmax(0, 1fr) minmax(0, 1fr)" : "minmax(0, 1fr)",
          overflow: "hidden",
        }}
      >
        {/* Interactive Form Pane */}
        {(viewMode === "form" || viewMode === "split") && (
          <div
            style={{
              overflowY: "auto",
              padding: "18px 22px",
              display: "flex",
              flexDirection: "column",
              gap: "16px",
              borderRight: viewMode === "split" ? "1px solid var(--border)" : "none",
            }}
          >
            {/* SECTION 1: Input Dataset Parameters */}
            <section
              style={{
                background: "var(--card-bg)",
                border: "1px solid var(--border)",
                borderRadius: "8px",
                padding: "14px 16px",
              }}
            >
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "12px" }}>
                <h3 style={{ margin: 0, fontSize: "13px", color: "var(--fg-bright)" }}>
                  1. Input Dataset Parameters
                </h3>
                {(needsDataFile || needsPlatform || needsAnalyte) && (
                  <span className="hitl-highlight-badge">
                    <AlertCircle size={10} /> Action Required
                  </span>
                )}
              </div>

              <div style={{ display: "grid", gridTemplateColumns: "2fr 1fr 1fr", gap: "12px" }}>
                <div>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                    <label className="field-label">Path or URL to Data File</label>
                    {needsDataFile && (
                      <span className="hitl-highlight-badge" style={{ fontSize: "9px", padding: "1px 5px" }}>
                        Required
                      </span>
                    )}
                  </div>
                  <div style={{ display: "flex", gap: "6px" }}>
                    <input
                      type="text"
                      className={`input ${needsDataFile ? "hitl-highlight-orange" : ""}`}
                      value={pathToDataFile}
                      onChange={(e) => setPathToDataFile(e.target.value)}
                      placeholder="e.g. data/raw/proteinGroups.txt or https://ftp.pride.ebi.ac.uk/..."
                      list="workspace-data-files"
                    />
                    <datalist id="workspace-data-files">
                      {dataFileCandidates.map((f) => (
                        <option key={f} value={f} />
                      ))}
                    </datalist>
                  </div>
                </div>

                <div>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                    <label className="field-label">Search Platform</label>
                    {needsPlatform && (
                      <span className="hitl-highlight-badge" style={{ fontSize: "9px", padding: "1px 5px" }}>
                        Required
                      </span>
                    )}
                  </div>
                  <select
                    className={`select ${needsPlatform ? "hitl-highlight-orange" : ""}`}
                    value={platform}
                    onChange={(e) => setPlatform(e.target.value)}
                  >
                    {PLATFORMS.map((p) => (
                      <option key={p} value={p}>
                        {p}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                    <label className="field-label">Analyte</label>
                    {needsAnalyte && (
                      <span className="hitl-highlight-badge" style={{ fontSize: "9px", padding: "1px 5px" }}>
                        Required
                      </span>
                    )}
                  </div>
                  <select
                    className={`select ${needsAnalyte ? "hitl-highlight-orange" : ""}`}
                    value={analyte}
                    onChange={(e) => setAnalyte(e.target.value as "proteins" | "peptides")}
                  >
                    <option value="proteins">proteins</option>
                    <option value="peptides">peptides</option>
                  </select>
                </div>
              </div>
            </section>

            {/* SECTION 2: Experimental Hypothesis & Study Design */}
            <section
              style={{
                background: "var(--card-bg)",
                border: "1px solid var(--border)",
                borderRadius: "8px",
                padding: "14px 16px",
              }}
            >
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "8px" }}>
                <h3 style={{ margin: 0, fontSize: "13px", color: "var(--fg-bright)" }}>
                  2. Experimental Hypothesis &amp; Study Design
                </h3>
                {needsDescription && (
                  <span className="hitl-highlight-badge">
                    <AlertCircle size={10} /> Action Required
                  </span>
                )}
              </div>
              <p style={{ margin: "0 0 8px 0", fontSize: "11.5px", color: "var(--muted)" }}>
                Describe the biological system, perturbation/treatment conditions, control cohorts, and primary scientific questions.
              </p>
              <textarea
                className={`textarea ${needsDescription ? "hitl-highlight-orange" : ""}`}
                rows={12}
                style={{ minHeight: "220px", resize: "vertical", lineHeight: 1.5 }}
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="Describe your experimental hypothesis, model organism/cell line, treatment groups, and key biological questions..."
              />
            </section>

            {/* SECTION 3: Bioinformatics Design */}
            <section
              style={{
                background: "var(--card-bg)",
                border: "1px solid var(--border)",
                borderRadius: "8px",
                padding: "14px 16px",
                display: "flex",
                flexDirection: "column",
                gap: "16px",
              }}
            >
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <h3 style={{ margin: 0, fontSize: "13px", color: "var(--fg-bright)" }}>
                  3. Bioinformatics Design
                </h3>
                <span className={`badge ${!needs3A && !needs3B && !needs3C && !needs3D && !needs3E && !needs3F ? "badge-completed" : "badge-warning"}`}>
                  {!needs3A && !needs3B && !needs3C && !needs3D && !needs3E && !needs3F ? "ALL SUBTASKS CONFIRMED" : "PENDING CONFIRMATION"}
                </span>
              </div>

              {/* 3.A Discovered Sample Groups in Dataset */}
              <div
                style={{
                  background: "var(--bg)",
                  border: "1px solid var(--border)",
                  borderRadius: "6px",
                  padding: "12px 14px",
                }}
                className={needs3A ? "hitl-highlight-orange" : ""}
              >
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "6px" }}>
                  <label className="field-label" style={{ margin: 0 }}>
                    3.A Discovered Sample Groups in Dataset (Auto-Generated in Phase 1)
                  </label>
                  {needs3A && (
                    <span className="hitl-highlight-badge">
                      <AlertCircle size={10} /> Action Required
                    </span>
                  )}
                </div>
                <div style={{ display: "flex", flexWrap: "wrap", gap: "6px", marginTop: "4px" }}>
                  {spec?.rawSampleGroups && spec.rawSampleGroups.length > 0 ? (
                    spec.rawSampleGroups.map((g) => (
                      <span
                        key={g}
                        style={{
                          padding: "3px 8px",
                          borderRadius: "4px",
                          background: "var(--card-bg)",
                          border: "1px solid var(--border-strong)",
                          fontFamily: "var(--font-mono)",
                          fontSize: "11px",
                        }}
                      >
                        {g}
                      </span>
                    ))
                  ) : (
                    <span style={{ fontSize: "11.5px", color: "var(--muted)", fontStyle: "italic" }}>
                      Pending Phase 1 data ingestion...
                    </span>
                  )}
                </div>
                <label style={{ display: "inline-flex", alignItems: "center", gap: "8px", fontSize: "12px", cursor: "pointer", marginTop: "10px" }}>
                  <input
                    type="checkbox"
                    checked={discoveredGroupsConfirmed}
                    onChange={(e) => setDiscoveredGroupsConfirmed(e.target.checked)}
                    style={{ accentColor: "var(--primary)" }}
                  />
                  <span style={{ fontWeight: 500 }}>
                    Confirm Discovered Sample Groups (<code>Confirm Discovered Sample Groups: TRUE</code>)
                  </span>
                </label>
              </div>

              {/* 3.B Quantitative Normalization Strategy (formerly 3.F) */}
              <div
                style={{
                  background: "var(--bg)",
                  border: "1px solid var(--border)",
                  borderRadius: "6px",
                  padding: "12px 14px",
                }}
                className={needs3B ? "hitl-highlight-orange" : ""}
              >
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "6px" }}>
                  <label className="field-label" style={{ margin: 0 }}>
                    3.B Quantitative Normalization Strategy
                  </label>
                  {needs3B && (
                    <span className="hitl-highlight-badge">
                      <AlertCircle size={10} /> Action Required
                    </span>
                  )}
                </div>
                <div style={{ display: "flex", flexWrap: "wrap", gap: "5px", marginBottom: "8px" }}>
                  <button
                    type="button"
                    className="btn btn-xs"
                    style={{
                      background: normalizationMethods === "default" ? "var(--primary)" : "var(--card-bg)",
                      border: "1px solid var(--border-strong)",
                    }}
                    onClick={() => setNormalizationMethods("default")}
                  >
                    default (linear + loess)
                  </button>
                  <button
                    type="button"
                    className="btn btn-xs"
                    style={{
                      background: normalizationMethods === "all" ? "var(--primary)" : "var(--card-bg)",
                      border: "1px solid var(--border-strong)",
                    }}
                    onClick={() => setNormalizationMethods("all")}
                  >
                    all (7 models)
                  </button>
                  {NORMALIZATION_MODELS.map((m) => {
                    const active =
                      normalizationMethods === "all" ||
                      normalizationMethods
                        .split(",")
                        .map((s) => s.trim().toLowerCase())
                        .includes(m);
                    return (
                      <button
                        key={m}
                        type="button"
                        className="btn btn-xs"
                        style={{
                          background: active ? "rgba(59, 130, 246, 0.25)" : "var(--card-bg)",
                          borderColor: active ? "var(--primary)" : "var(--border-strong)",
                          color: active ? "#93c5fd" : "var(--muted)",
                        }}
                        onClick={() => toggleNormModel(m)}
                      >
                        {m}
                      </button>
                    );
                  })}
                </div>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "10px", marginBottom: "10px" }}>
                  <div>
                    <span style={{ fontSize: "10px", color: "var(--muted)", display: "block", marginBottom: "3px" }}>Selected Methods String:</span>
                    <input
                      type="text"
                      className="input"
                      value={normalizationMethods}
                      onChange={(e) => setNormalizationMethods(e.target.value)}
                    />
                  </div>
                  <div>
                    <span style={{ fontSize: "10px", color: "var(--muted)", display: "block", marginBottom: "3px" }}>Subset Filter (Optional):</span>
                    <input
                      type="text"
                      className="input"
                      value={normalizationSubsetFilter}
                      placeholder="NONE or e.g. description %like% 'ribosom'"
                      onChange={(e) => setNormalizationSubsetFilter(e.target.value)}
                    />
                  </div>
                </div>
                <label style={{ display: "inline-flex", alignItems: "center", gap: "8px", fontSize: "12px", cursor: "pointer" }}>
                  <input
                    type="checkbox"
                    checked={normalizationConfirmed}
                    onChange={(e) => setNormalizationConfirmed(e.target.checked)}
                    style={{ accentColor: "var(--primary)" }}
                  />
                  <span style={{ fontWeight: 500 }}>
                    Confirm Normalization Strategy (<code>Confirm Normalization Strategy: TRUE</code>)
                  </span>
                </label>
              </div>

              {/* 3.C Missing Value Imputation Strategy (formerly 3.E) */}
              <div
                style={{
                  background: "var(--bg)",
                  border: "1px solid var(--border)",
                  borderRadius: "6px",
                  padding: "12px 14px",
                }}
                className={needs3C ? "hitl-highlight-orange" : ""}
              >
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "6px" }}>
                  <label className="field-label" style={{ margin: 0 }}>
                    3.C Missing Value Imputation Strategy
                  </label>
                  {needs3C && (
                    <span className="hitl-highlight-badge">
                      <AlertCircle size={10} /> Action Required
                    </span>
                  )}
                </div>
                <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
                  <select
                    className="select"
                    value={imputationMethod}
                    onChange={(e) => setImputationMethod(e.target.value)}
                    style={{ maxWidth: "400px" }}
                  >
                    {IMPUTATION_METHODS.map((m) => (
                      <option key={m.value} value={m.value}>
                        {m.label}
                      </option>
                    ))}
                  </select>
                  <label style={{ display: "inline-flex", alignItems: "center", gap: "8px", fontSize: "12px", cursor: "pointer" }}>
                    <input
                      type="checkbox"
                      checked={imputationConfirmed}
                      onChange={(e) => setImputationConfirmed(e.target.checked)}
                      style={{ accentColor: "var(--primary)" }}
                    />
                    <span style={{ fontWeight: 500 }}>
                      Confirm Imputation Strategy (<code>Confirm Imputation Strategy: TRUE</code>)
                    </span>
                  </label>
                </div>
              </div>

              {/* 3.D Sample Group Renaming & Pooling Map */}
              <div
                style={{
                  background: "var(--bg)",
                  border: "1px solid var(--border)",
                  borderRadius: "6px",
                  padding: "12px 14px",
                }}
                className={needs3D ? "hitl-highlight-orange" : ""}
              >
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "8px" }}>
                  <div>
                    <label className="field-label" style={{ margin: 0 }}>
                      3.D Sample Group Renaming &amp; Pooling Map
                    </label>
                    <div style={{ fontSize: "11px", color: "var(--muted)" }}>
                      Maps current sample names to cleaned biological replicate cohorts prior to Phase 2 PCA/CV &amp; Normalization.
                    </div>
                  </div>
                  <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
                    {needs3D && (
                      <span className="hitl-highlight-badge">
                        <AlertCircle size={10} /> Action Required
                      </span>
                    )}
                    <label style={{ display: "inline-flex", alignItems: "center", gap: "6px", fontSize: "11.5px", cursor: "pointer" }}>
                      <input
                        type="checkbox"
                        checked={reassignSampleNames}
                        onChange={(e) => setReassignSampleNames(e.target.checked)}
                        style={{ accentColor: "var(--primary)" }}
                      />
                      Reassign Sample Names
                    </label>
                    {hasPreliminaryData && (spec?.rawSampleGroups?.length || 0) > 0 && (
                      <button
                        type="button"
                        className="btn btn-secondary btn-xs"
                        onClick={() => {
                          const rawGroups = spec?.rawSampleGroups || [];
                          setPoolingRows(
                            rawGroups.map((r) => ({
                              raw: r,
                              clean: r.replace(/^st\d+_/, "").replace(/[_\-]\d+$/, ""),
                            }))
                          );
                        }}
                        title="Populate table with current sample names"
                      >
                        <RefreshCw size={11} /> Populate Current Names
                      </button>
                    )}
                    <button
                      type="button"
                      className="btn btn-secondary btn-xs"
                      onClick={() => setPoolingRows([...poolingRows, { raw: "", clean: "" }])}
                    >
                      <Plus size={11} /> Add Row
                    </button>
                  </div>
                </div>

                {spec?.rawSampleGroups && spec.rawSampleGroups.length > 0 ? (
                  <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: "6px", marginBottom: "10px" }}>
                    <span style={{ fontSize: "11px", color: "var(--muted)", fontWeight: 600 }}>Current Sample Names:</span>
                    {spec.rawSampleGroups.map((g) => (
                      <span
                        key={g}
                        style={{
                          padding: "2px 7px",
                          borderRadius: "4px",
                          background: "var(--card-bg)",
                          border: "1px solid var(--border-strong)",
                          fontFamily: "var(--font-mono)",
                          fontSize: "11px",
                        }}
                      >
                        {g}
                      </span>
                    ))}
                  </div>
                ) : (
                  <div style={{ fontSize: "11.5px", color: "var(--muted)", fontStyle: "italic", marginBottom: "8px" }}>
                    Pending preliminary data inspection &amp; ingestion in Phase 1... Current sample names will be loaded here to allow grouping and reassignment.
                  </div>
                )}

                {poolingRows.length > 0 && (
                  <div
                    style={{
                      display: "grid",
                      gridTemplateColumns: "1fr 1fr 32px",
                      gap: "6px",
                      background: "var(--card-bg)",
                      padding: "10px",
                      borderRadius: "6px",
                      border: "1px solid var(--border)",
                      marginBottom: "10px",
                    }}
                  >
                    <div style={{ fontSize: "10px", fontWeight: 700, color: "var(--muted)", textTransform: "uppercase" }}>
                      Raw Sample Group (Current Name)
                    </div>
                    <div style={{ fontSize: "10px", fontWeight: 700, color: "var(--muted)", textTransform: "uppercase" }}>
                      Cleaned Cohort Name
                    </div>
                    <div />
                    {poolingRows.map((row, idx) => (
                      <React.Fragment key={idx}>
                        {spec?.rawSampleGroups && spec.rawSampleGroups.length > 0 ? (
                          <select
                            className="select"
                            value={row.raw}
                            onChange={(e) => {
                              const next = [...poolingRows];
                              next[idx] = { ...next[idx], raw: e.target.value };
                              setPoolingRows(next);
                            }}
                          >
                            <option value="">Select current sample name...</option>
                            {spec.rawSampleGroups.map((g) => (
                              <option key={g} value={g}>{g}</option>
                            ))}
                            {row.raw && !spec.rawSampleGroups.includes(row.raw) && (
                              <option value={row.raw}>{row.raw}</option>
                            )}
                          </select>
                        ) : (
                          <input
                            type="text"
                            className="input"
                            value={row.raw}
                            placeholder="e.g. st1_0"
                            onChange={(e) => {
                              const next = [...poolingRows];
                              next[idx] = { ...next[idx], raw: e.target.value };
                              setPoolingRows(next);
                            }}
                          />
                        )}
                        <input
                          type="text"
                          className="input"
                          value={row.clean}
                          placeholder="e.g. control"
                          onChange={(e) => {
                            const next = [...poolingRows];
                            next[idx] = { ...next[idx], clean: e.target.value };
                            setPoolingRows(next);
                          }}
                        />
                        <button
                          type="button"
                          className="btn btn-secondary btn-xs"
                          onClick={() => setPoolingRows(poolingRows.filter((_, i) => i !== idx))}
                          title="Remove mapping row"
                        >
                          <Trash2 size={12} />
                        </button>
                      </React.Fragment>
                    ))}
                  </div>
                )}
                <label style={{ display: "inline-flex", alignItems: "center", gap: "8px", fontSize: "12px", cursor: "pointer" }}>
                  <input
                    type="checkbox"
                    checked={samplePoolingConfirmed}
                    onChange={(e) => setSamplePoolingConfirmed(e.target.checked)}
                    style={{ accentColor: "var(--primary)" }}
                  />
                  <span style={{ fontWeight: 500 }}>
                    Confirm Sample Pooling Map (<code>Confirm Sample Pooling Map: TRUE</code>)
                  </span>
                </label>
              </div>

              {/* 3.E Target Contrasts (Treatment / Control) */}
              <div
                style={{
                  background: "var(--bg)",
                  border: "1px solid var(--border)",
                  borderRadius: "6px",
                  padding: "12px 14px",
                }}
                className={needs3E ? "hitl-highlight-orange" : ""}
              >
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "8px" }}>
                  <div>
                    <label className="field-label" style={{ margin: 0 }}>
                      3.E Target Contrasts (Treatment / Control)
                    </label>
                    <div style={{ fontSize: "11px", color: "var(--muted)" }}>
                      Define pairwise statistical contrasts to compare in Phase 4 differential expression analysis.
                    </div>
                  </div>
                  <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
                    {needs3E && (
                      <span className="hitl-highlight-badge">
                        <AlertCircle size={10} /> Action Required
                      </span>
                    )}
                    <button
                      type="button"
                      className="btn btn-secondary btn-xs"
                      onClick={() => setContrastRows([...contrastRows, { treatment: "", control: "" }])}
                    >
                      <Plus size={11} /> Add Contrast
                    </button>
                  </div>
                </div>

                {!hasPreliminaryData && (
                  <div style={{ fontSize: "11.5px", color: "var(--muted)", fontStyle: "italic", marginBottom: "8px" }}>
                    Pending preliminary data inspection &amp; ingestion in Phase 1... Group names from 3.D will populate dropdowns here to assign contrasts.
                  </div>
                )}

                <div style={{ display: "flex", flexDirection: "column", gap: "8px", marginBottom: "10px" }}>
                  {contrastRows.map((c, idx) => (
                    <div key={idx} style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                      {availableGroups.length > 0 ? (
                        <select
                          className="select"
                          value={c.treatment}
                          onChange={(e) => {
                            const next = [...contrastRows];
                            next[idx] = { ...next[idx], treatment: e.target.value };
                            setContrastRows(next);
                          }}
                          style={{ flex: 1 }}
                        >
                          <option value="">Select Treatment...</option>
                          {availableGroups.map((g) => (
                            <option key={g} value={g}>{g}</option>
                          ))}
                          {c.treatment && !availableGroups.includes(c.treatment) && (
                            <option value={c.treatment}>{c.treatment}</option>
                          )}
                        </select>
                      ) : (
                        <input
                          type="text"
                          className="input"
                          placeholder="Treatment (e.g. surfactin)"
                          value={c.treatment}
                          onChange={(e) => {
                            const next = [...contrastRows];
                            next[idx] = { ...next[idx], treatment: e.target.value };
                            setContrastRows(next);
                          }}
                          style={{ flex: 1 }}
                        />
                      )}
                      <span style={{ fontWeight: 700, color: "var(--muted)", fontSize: "11px" }}>vs</span>
                      {availableGroups.length > 0 ? (
                        <select
                          className="select"
                          value={c.control}
                          onChange={(e) => {
                            const next = [...contrastRows];
                            next[idx] = { ...next[idx], control: e.target.value };
                            setContrastRows(next);
                          }}
                          style={{ flex: 1 }}
                        >
                          <option value="">Select Control...</option>
                          {availableGroups.map((g) => (
                            <option key={g} value={g}>{g}</option>
                          ))}
                          {c.control && !availableGroups.includes(c.control) && (
                            <option value={c.control}>{c.control}</option>
                          )}
                        </select>
                      ) : (
                        <input
                          type="text"
                          className="input"
                          placeholder="Control (e.g. control)"
                          value={c.control}
                          onChange={(e) => {
                            const next = [...contrastRows];
                            next[idx] = { ...next[idx], control: e.target.value };
                            setContrastRows(next);
                          }}
                          style={{ flex: 1 }}
                        />
                      )}
                      {contrastRows.length > 1 && (
                        <button
                          type="button"
                          className="btn btn-secondary btn-xs"
                          onClick={() => setContrastRows(contrastRows.filter((_, i) => i !== idx))}
                          title="Remove contrast pair"
                        >
                          <Trash2 size={12} />
                        </button>
                      )}
                    </div>
                  ))}
                </div>
                <label style={{ display: "inline-flex", alignItems: "center", gap: "8px", fontSize: "12px", cursor: "pointer" }}>
                  <input
                    type="checkbox"
                    checked={contrastConfirmed}
                    onChange={(e) => setContrastConfirmed(e.target.checked)}
                    style={{ accentColor: "var(--primary)" }}
                  />
                  <span style={{ fontWeight: 500 }}>
                    Confirm Target Contrasts (<code>Confirm Target Contrasts: TRUE</code>)
                  </span>
                </label>
              </div>

              {/* 3.F Confounded Batch & Exploratory Comparison Gate */}
              {/* Only exposed if the LLM determines this to be an issue! */}
              {isBatchConfoundingIssue ? (
                <div
                  style={{
                    background: "var(--bg)",
                    border: "1px solid var(--border)",
                    borderRadius: "6px",
                    padding: "12px 14px",
                  }}
                  className={needs3F ? "hitl-highlight-orange" : ""}
                >
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "6px" }}>
                    <label className="field-label" style={{ margin: 0, color: "var(--attention-orange)" }}>
                      ⚠️ 3.F Confounded Batch &amp; Exploratory Comparison Gate
                    </label>
                    {needs3F && (
                      <span className="hitl-highlight-badge">
                        <AlertCircle size={10} /> Action Required
                      </span>
                    )}
                  </div>
                  <div
                    className="attention-banner-orange"
                    style={{
                      padding: "12px 14px",
                    }}
                  >
                    <label style={{ display: "flex", alignItems: "flex-start", gap: "10px", cursor: "pointer", fontSize: "12px" }}>
                      <input
                        type="checkbox"
                        checked={batchConfoundingAuthorized}
                        onChange={(e) => {
                          setBatchConfoundingAuthorized(e.target.checked);
                          setBatchConfoundingConfirmed(e.target.checked);
                        }}
                        style={{ marginTop: "3px", accentColor: "var(--primary)" }}
                      />
                      <div>
                        <div style={{ fontWeight: 600, color: "var(--fg-bright)" }}>
                          Proceed With Potential Batch Confounding
                        </div>
                        <div style={{ fontSize: "11px", color: "var(--muted)", marginTop: "3px", lineHeight: "1.4" }}>
                          The LLM detected that biological condition cohorts are correlated with processing batches or runs. Authorizes unadjusted exploratory comparison in Phase 4.
                        </div>
                      </div>
                    </label>
                  </div>
                </div>
              ) : null}

              {/* 3.G Functional Annotation Strategy */}
              <div
                style={{
                  background: "var(--bg)",
                  border: "1px solid var(--border)",
                  borderRadius: "6px",
                  padding: "12px 14px",
                  marginBottom: "14px",
                }}
                className={needs3G ? "hitl-highlight-orange" : ""}
              >
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "6px" }}>
                  <label className="field-label" style={{ margin: 0 }}>
                    🧬 3.G Functional Annotation Strategy
                  </label>
                  {needs3G && (
                    <span className="hitl-highlight-badge">
                      <AlertCircle size={10} /> Action Required
                    </span>
                  )}
                </div>

                <div style={{ fontSize: "11px", color: "var(--muted)", marginBottom: "10px", lineHeight: "1.4" }}>
                  Choose whether to autonomously fetch Gene Ontology (GO) and pathway annotations from UniProt KB, provide a custom annotation table, or bypass enrichment.
                </div>

                {/* Source Selection Radiogroup */}
                <div style={{ display: "flex", gap: "16px", marginBottom: "12px", flexWrap: "wrap" }}>
                  <label style={{ display: "flex", alignItems: "center", gap: "6px", cursor: "pointer", fontSize: "12px" }}>
                    <input
                      type="radio"
                      name="annotSource"
                      value="uniprot"
                      checked={annotationSource === "uniprot"}
                      onChange={() => setAnnotationSource("uniprot")}
                      style={{ accentColor: "var(--primary)" }}
                    />
                    <span style={{ fontWeight: 600, color: "var(--fg-bright)" }}>
                      🌐 Autonomous Remote Fetch (UniProt KB)
                    </span>
                  </label>

                  <label style={{ display: "flex", alignItems: "center", gap: "6px", cursor: "pointer", fontSize: "12px" }}>
                    <input
                      type="radio"
                      name="annotSource"
                      value="file"
                      checked={annotationSource === "file"}
                      onChange={() => setAnnotationSource("file")}
                      style={{ accentColor: "var(--primary)" }}
                    />
                    <span style={{ fontWeight: 600, color: "var(--fg-bright)" }}>
                      📁 Custom Annotation File (Local TSV / CSV)
                    </span>
                  </label>

                  <label style={{ display: "flex", alignItems: "center", gap: "6px", cursor: "pointer", fontSize: "12px" }}>
                    <input
                      type="radio"
                      name="annotSource"
                      value="none"
                      checked={annotationSource === "none"}
                      onChange={() => setAnnotationSource("none")}
                      style={{ accentColor: "var(--primary)" }}
                    />
                    <span style={{ fontWeight: 600, color: "var(--fg-bright)" }}>
                      ⚡ Bypass Pathway Enrichment
                    </span>
                  </label>
                </div>

                {/* Source == 'uniprot' parameters */}
                {annotationSource === "uniprot" && (
                  <div style={{ background: "var(--panel-bg)", border: "1px solid var(--border)", borderRadius: "6px", padding: "10px", marginBottom: "12px" }}>
                    <div style={{ display: "grid", gridTemplateColumns: "1fr 2fr", gap: "12px", alignItems: "center" }}>
                      <div>
                        <span style={{ fontSize: "11px", fontWeight: 600, color: "var(--fg)" }}>Organism / Taxon ID</span>
                        <select
                          className="input"
                          style={{ marginTop: "4px", fontSize: "11.5px" }}
                          value={annotationTaxonId}
                          onChange={(e) => setAnnotationTaxonId(e.target.value)}
                        >
                          {isOrganismPending && (
                            <option value={annotationTaxonId}>
                              ⏳ (Pending Phase 1 organism identification)
                            </option>
                          )}
                          <option value="9606">9606 - Homo sapiens (Human)</option>
                          <option value="10090">10090 - Mus musculus (Mouse)</option>
                          <option value="10116">10116 - Rattus norvegicus (Rat)</option>
                          <option value="559292">559292 - S. cerevisiae (Yeast)</option>
                          <option value="7227">7227 - Drosophila melanogaster</option>
                          <option value="6239">6239 - C. elegans</option>
                          {!["9606", "10090", "10116", "559292", "7227", "6239"].includes(annotationTaxonId) && !isOrganismPending && (
                            <option value={annotationTaxonId}>{annotationTaxonId} (Custom Taxon)</option>
                          )}
                        </select>
                        {isOrganismPending && (
                          <div style={{ fontSize: "10.5px", color: "var(--muted)", marginTop: "4px" }}>
                            Target organism will be automatically identified during Phase 1 from FASTA headers and protein accessions.
                          </div>
                        )}
                      </div>
                      <div>
                        <span style={{ fontSize: "11px", fontWeight: 600, color: "var(--fg)" }}>Target Ontologies</span>
                        <input
                          type="text"
                          className="input"
                          style={{ marginTop: "4px", fontSize: "11.5px" }}
                          value={annotationOntologies}
                          onChange={(e) => setAnnotationOntologies(e.target.value)}
                          placeholder="biological_process, cellular_component, molecular_function, reactome_pathway"
                        />
                      </div>
                    </div>
                  </div>
                )}

                {/* Source == 'file' parameters */}
                {annotationSource === "file" && (
                  <div style={{ background: "var(--panel-bg)", border: "1px solid var(--border)", borderRadius: "6px", padding: "10px", marginBottom: "12px" }}>
                    <div>
                      <span style={{ fontSize: "11px", fontWeight: 600, color: "var(--fg)" }}>Local Annotation File Path</span>
                      <input
                        type="text"
                        className="input"
                        style={{ marginTop: "4px", fontSize: "11.5px" }}
                        value={annotationFilePath === "NONE" ? "" : annotationFilePath}
                        onChange={(e) => setAnnotationFilePath(e.target.value || "NONE")}
                        placeholder="e.g. data/annotations.tsv"
                      />
                    </div>
                  </div>
                )}

                {/* Confirmation Checkbox */}
                <label style={{ display: "flex", alignItems: "center", gap: "8px", cursor: "pointer", fontSize: "12px" }}>
                  <input
                    type="checkbox"
                    checked={annotationConfirmed}
                    onChange={(e) => setAnnotationConfirmed(e.target.checked)}
                    style={{ accentColor: "var(--primary)" }}
                  />
                  <span style={{ fontWeight: 500, color: annotationConfirmed ? "var(--fg-bright)" : needs3G ? "var(--attention-orange)" : "var(--muted)" }}>
                    Confirm Functional Annotation Strategy (<code>Confirm Functional Annotation Strategy: TRUE</code>)
                    {!hasTargetOrganism && annotationSource === "uniprot" && (
                      <span style={{ fontSize: "11px", marginLeft: "6px", color: "var(--muted)" }}>
                        (HITL stopping point after target organism is identified)
                      </span>
                    )}
                  </span>
                </label>
              </div>
            </section>
          </div>
        )}

        {/* Raw Markdown Pane */}
        {(viewMode === "raw" || viewMode === "split") && (
          <div style={{ display: "flex", flexDirection: "column", height: "100%", overflow: "hidden", padding: "14px" }}>
            <div style={{ fontSize: "11px", color: "var(--muted)", marginBottom: "6px", display: "flex", justifyContent: "space-between" }}>
              <span>Raw `docs/experiment.md`</span>
              {viewMode === "split" && (
                <button type="button" className="btn btn-secondary btn-xs" onClick={handleSaveRawMarkdown}>
                  <Save size={11} /> Save Raw Edits
                </button>
              )}
            </div>
            <textarea
              className="textarea"
              style={{
                flex: "1 1 auto",
                fontFamily: "var(--font-mono)",
                fontSize: "12px",
                lineHeight: 1.55,
                resize: "none",
              }}
              value={rawText}
              onChange={(e) => setRawText(e.target.value)}
            />
          </div>
        )}
      </div>
    </div>
  );
};

