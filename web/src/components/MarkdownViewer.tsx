import React, { useEffect, useMemo, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { marked } from "marked";
import { Edit3, Eye, Save, Download, RefreshCw, Search, Printer } from "lucide-react";
import { PlotlyPlot } from "./PlotlyPlot";

interface MarkdownViewerProps {
  relPath: string;
  onOpenFile: (relPath: string) => void;
}

function resolveRelativeWorkspacePath(baseFileRelPath: string, targetHref: string): string {
  if (!targetHref || targetHref.startsWith("http://") || targetHref.startsWith("https://") || targetHref.startsWith("data:")) {
    return targetHref;
  }
  const cleanHref = targetHref.split("#")[0].split("?")[0];
  if (cleanHref.startsWith("data/") || cleanHref.startsWith("docs/") || cleanHref.startsWith("code/") || cleanHref.startsWith("logs/")) {
    return cleanHref;
  }
  const baseParts = baseFileRelPath.split("/");
  baseParts.pop(); // remove filename
  const relParts = cleanHref.split("/");
  for (const part of relParts) {
    if (!part || part === ".") continue;
    if (part === "..") {
      baseParts.pop();
    } else {
      baseParts.push(part);
    }
  }
  return baseParts.join("/");
}

export const MarkdownViewer: React.FC<MarkdownViewerProps> = ({ relPath, onOpenFile }) => {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [content, setContent] = useState("");
  const [isImage, setIsImage] = useState(false);
  const [isBinary, setIsBinary] = useState(false);
  const [rawUrl, setRawUrl] = useState("");
  const [sizeBytes, setSizeBytes] = useState(0);
  const [isEditing, setIsEditing] = useState(false);
  const [editBuffer, setEditBuffer] = useState("");
  const [saveMsg, setSaveMsg] = useState<string | null>(null);
  const [tableFilter, setTableFilter] = useState("");

  const ext = relPath.split(".").pop()?.toLowerCase() || "";
  const isMarkdown = ext === "md";
  const isTabular = ext === "tsv" || ext === "csv";

  const fetchFile = async () => {
    setLoading(true);
    setError(null);
    try {
      const resp = await fetch(`/api/workspace/file?path=${encodeURIComponent(relPath)}`);
      const data = await resp.json();
      if (!data.ok) {
        setError(data.error || "Failed to load file");
      } else {
        setIsImage(!!data.isImage);
        setIsBinary(!!data.isBinary);
        setRawUrl(data.rawUrl || `/api/workspace/raw?path=${encodeURIComponent(relPath)}`);
        setSizeBytes(data.sizeBytes || 0);
        setContent(data.content || "");
        setEditBuffer(data.content || "");
      }
    } catch (err: any) {
      setError(err.message || "Error fetching file");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    setIsEditing(false);
    fetchFile();
  }, [relPath]);

  const handleSave = async () => {
    try {
      const resp = await fetch("/api/workspace/file", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ path: relPath, content: editBuffer }),
      });
      const data = await resp.json();
      if (data.ok) {
        setContent(editBuffer);
        setIsEditing(false);
        setSaveMsg("Saved!");
        setTimeout(() => setSaveMsg(null), 2000);
      }
    } catch (_) {}
  };

  const contentContainerRef = useRef<HTMLDivElement | null>(null);

  const renderedHtml = useMemo(() => {
    if (!isMarkdown || !content) return "";
    // Rewrite relative image paths so plots render as interactive Plotly widgets
    const processed = content.replace(
      /!\[([^\]]*)\]\(([^)]+)\)/g,
      (_match, alt, src) => {
        const trimmedSrc = String(src).trim();
        const resolved = resolveRelativeWorkspacePath(relPath, trimmedSrc);
        const isPlot = /plot_.*\.png$/i.test(trimmedSrc) || /data\/plot_/i.test(resolved) || /plot_.*\.plotly\.json$/i.test(trimmedSrc);
        if (isPlot) {
          const rawUrl = `/api/workspace/raw?path=${encodeURIComponent(resolved)}`;
          return `<div class="interactive-plot-placeholder" data-plot-rel="${resolved}" data-alt="${alt || ""}" data-raw="${rawUrl}"></div>`;
        }
        if (trimmedSrc.startsWith("http://") || trimmedSrc.startsWith("https://") || trimmedSrc.startsWith("/api/")) {
          return `![${alt}](${trimmedSrc})`;
        }
        return `![${alt}](/api/workspace/raw?path=${encodeURIComponent(resolved)})`;
      }
    );
    return marked.parse(processed, { async: false }) as string;
  }, [content, isMarkdown, relPath]);

  // Mount interactive Plotly components into placeholders
  useEffect(() => {
    if (!contentContainerRef.current) return;
    const placeholders = contentContainerRef.current.querySelectorAll<HTMLDivElement>(".interactive-plot-placeholder");
    const roots: { root: any; el: HTMLElement }[] = [];

    placeholders.forEach((el) => {
      const plotRel = el.getAttribute("data-plot-rel") || "";
      const alt = el.getAttribute("data-alt") || "";
      const raw = el.getAttribute("data-raw") || "";
      if (plotRel) {
        const root = createRoot(el);
        root.render(<PlotlyPlot plotRelPath={plotRel} altText={alt} rawImageUrl={raw} />);
        roots.push({ root, el });
      }
    });

    return () => {
      roots.forEach(({ root }) => {
        try {
          root.unmount();
        } catch (_) {}
      });
    };
  }, [renderedHtml, isEditing]);

  const handleExportPdf = () => {
    const printWindow = window.open("", "_blank", "width=900,height=1000");
    if (!printWindow) {
      alert("Pop-up blocker detected. Please allow pop-ups for this site to export PDF.");
      return;
    }

    const origin = window.location.origin;
    let printableContent = renderedHtml.replace(
      /src=["'](\/api\/[^"']+)["']/g,
      `src="${origin}$1"`
    );

    // Replace plot placeholders with clean printable figures for PDF (attribute-order agnostic)
    printableContent = printableContent.replace(
      /<div class="interactive-plot-placeholder"([^>]*)><\/div>/g,
      (_m, attrs) => {
        const rawMatch = attrs.match(/data-raw="([^"]+)"/);
        const altMatch = attrs.match(/data-alt="([^"]*)"/);
        const rawUrl = rawMatch ? rawMatch[1] : "";
        const alt = altMatch ? altMatch[1] : "";
        const fullUrl = rawUrl.startsWith("http") ? rawUrl : `${origin}${rawUrl}`;
        return `<figure style="page-break-inside: avoid; break-inside: avoid; margin: 20pt 0; text-align: center;">
          <img src="${fullUrl}" alt="${alt}" style="max-width: 100%; max-height: 480px; object-fit: contain; border: 1px solid #e5e7eb; border-radius: 4px; padding: 6px;" />
          ${alt ? `<figcaption style="font-size: 9.5pt; color: #4b5563; font-style: italic; margin-top: 6pt;">Figure: ${alt}</figcaption>` : ""}
        </figure>`;
      }
    );

    const docTitle = relPath.split("/").pop() || "manuscript.pdf";

    printWindow.document.write(`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <title>${docTitle}</title>
  <style>
    @page {
      size: A4 portrait;
      margin: 20mm 18mm 20mm 18mm;
    }
    body {
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
      font-size: 11pt;
      line-height: 1.6;
      color: #111827;
      background: #ffffff;
      margin: 0;
      padding: 24px 32px;
    }
    h1 { font-size: 20pt; font-weight: 700; margin-bottom: 12pt; color: #000000; break-after: avoid; }
    h2 { font-size: 14pt; font-weight: 700; margin-top: 20pt; margin-bottom: 8pt; border-bottom: 1.5px solid #e5e7eb; padding-bottom: 4pt; break-after: avoid; }
    h3 { font-size: 12pt; font-weight: 600; margin-top: 14pt; margin-bottom: 6pt; break-after: avoid; }
    p { margin-bottom: 10pt; text-align: justify; }
    table { width: 100%; border-collapse: collapse; margin: 14pt 0; font-size: 9pt; page-break-inside: avoid; break-inside: avoid; }
    th, td { border: 1px solid #d1d5db; padding: 5pt 7pt; text-align: left; }
    th { background-color: #f3f4f6; font-weight: 600; }
    tr:nth-child(even) { background-color: #f9fafb; }
    figure, img { page-break-inside: avoid; break-inside: avoid; max-width: 100%; }
    code, pre { font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace; font-size: 9.5pt; }
    pre { background: #f3f4f6; padding: 10pt; border-radius: 4px; overflow-x: auto; page-break-inside: avoid; break-inside: avoid; }
    blockquote { border-left: 3.5px solid #3b82f6; margin: 12pt 0; padding-left: 12pt; color: #4b5563; font-style: italic; }
    hr { border: none; border-top: 1px solid #e5e7eb; margin: 18pt 0; }
    .print-header-bar {
      display: flex;
      justifyContent: space-between;
      align-items: center;
      background: #f8fafc;
      padding: 10pt 16pt;
      margin-bottom: 20pt;
      border: 1px solid #e2e8f0;
      border-radius: 6pt;
    }
    @media print {
      .print-header-bar { display: none !important; }
      body { padding: 0 !important; }
    }
  </style>
</head>
<body>
  <div class="print-header-bar">
    <div>
      <span style="font-weight: 600; color: #0f172a; font-size: 13pt;">${docTitle}</span>
      <span style="font-size: 10pt; color: #64748b; margin-left: 10pt;">Publication Manuscript Export</span>
    </div>
    <button onclick="window.print()" style="background: #2563eb; color: #ffffff; border: none; padding: 6pt 14pt; border-radius: 4pt; font-weight: 600; cursor: pointer; font-size: 10pt;">
      🖨 Print / Save as PDF
    </button>
  </div>
  <main class="markdown-body">
    ${printableContent}
  </main>
  <script>
    window.addEventListener('load', () => {
      setTimeout(() => {
        window.print();
      }, 500);
    });
  <\/script>
</body>
</html>`);
    printWindow.document.close();
  };

  // Parse TSV/CSV preview (up to 150 rows)
  const parsedTable = useMemo(() => {
    if (!isTabular || !content) return null;
    const sep = ext === "tsv" ? "\t" : ",";
    const lines = content.split(/\r?\n/).filter((l) => l.trim().length > 0);
    if (lines.length === 0) return null;
    const headers = lines[0].split(sep).map((h) => h.replace(/^"|"$/g, ""));
    const rows = lines.slice(1, 300).map((line) => line.split(sep).map((c) => c.replace(/^"|"$/g, "")));
    const filtered = tableFilter.trim()
      ? rows.filter((r) => r.some((cell) => cell.toLowerCase().includes(tableFilter.toLowerCase())))
      : rows;
    return {
      headers,
      rows: filtered.slice(0, 150),
      totalRows: lines.length - 1,
    };
  }, [content, isTabular, ext, tableFilter]);

  if (loading) {
    return (
      <div style={{ padding: "32px", color: "var(--muted)", textAlign: "center" }}>
        Loading `{relPath}`...
      </div>
    );
  }

  if (error) {
    return (
      <div style={{ padding: "32px", color: "var(--error)", textAlign: "center" }}>
        {error}
      </div>
    );
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", overflow: "hidden" }}>
      {/* File Sub-Toolbar */}
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          padding: "8px 18px",
          borderBottom: "1px solid var(--border)",
          background: "#16161a",
          flexShrink: 0,
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
          <span style={{ fontFamily: "var(--font-mono)", fontSize: "12px", fontWeight: 700, color: "var(--fg-bright)" }}>
            {relPath}
          </span>
          <span style={{ fontSize: "11px", color: "var(--muted)" }}>
            ({(sizeBytes / 1024).toFixed(1)} KB)
          </span>
          {saveMsg && <span style={{ color: "var(--success)", fontSize: "11px", fontWeight: 600 }}>✓ {saveMsg}</span>}
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
          {isTabular && !isEditing && (
            <div style={{ position: "relative", display: "flex", alignItems: "center" }}>
              <Search size={12} style={{ position: "absolute", left: "8px", color: "var(--muted)" }} />
              <input
                type="text"
                className="input"
                style={{ paddingLeft: "24px", width: "190px", height: "26px", fontSize: "11px" }}
                placeholder="Filter rows (gene/protein)..."
                value={tableFilter}
                onChange={(e) => setTableFilter(e.target.value)}
              />
            </div>
          )}

          <button type="button" className="btn btn-secondary btn-xs" onClick={fetchFile} title="Reload from disk">
            <RefreshCw size={11} /> Reload
          </button>

          {!isImage && !isBinary && (
            <>
              <button
                type="button"
                className="btn btn-secondary btn-xs"
                onClick={() => setIsEditing(!isEditing)}
              >
                {isEditing ? (
                  <>
                    <Eye size={11} /> Preview
                  </>
                ) : (
                  <>
                    <Edit3 size={11} /> Edit
                  </>
                )}
              </button>
              {isEditing && (
                <button type="button" className="btn btn-xs" onClick={handleSave}>
                  <Save size={11} /> Save
                </button>
              )}
            </>
          )}

          <a
            href={`/api/workspace/raw?path=${encodeURIComponent(relPath)}`}
            download={relPath.split("/").pop()}
            className="btn btn-secondary btn-xs"
            style={{ textDecoration: "none" }}
          >
            <Download size={11} /> Download
          </a>

          {isMarkdown && !isEditing && (
            <button
              type="button"
              className="btn btn-secondary btn-xs"
              onClick={handleExportPdf}
              title="Export formatted manuscript to publication-grade PDF"
              style={{ gap: "4px" }}
            >
              <Printer size={11} /> Export PDF
            </button>
          )}
        </div>
      </div>

      {/* Viewer Body */}
      <div style={{ flex: "1 1 auto", overflow: "auto", padding: isEditing ? "12px" : "20px 28px" }}>
        {isImage ? (
          <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: "12px" }}>
            <img
              src={rawUrl}
              alt={relPath}
              style={{
                maxWidth: "100%",
                maxHeight: "calc(100vh - 170px)",
                objectFit: "contain",
                background: "#ffffff",
                borderRadius: "8px",
                padding: "8px",
                border: "1px solid var(--border-strong)",
              }}
            />
          </div>
        ) : isBinary ? (
          <div style={{ textAlign: "center", padding: "40px", color: "var(--muted)" }}>
            <p>Binary file (`{relPath}` — {(sizeBytes / 1024).toFixed(1)} KB).</p>
            <a
              href={`/api/workspace/raw?path=${encodeURIComponent(relPath)}`}
              download={relPath.split("/").pop()}
              className="btn"
              style={{ textDecoration: "none", marginTop: "8px" }}
            >
              <Download size={14} /> Download File
            </a>
          </div>
        ) : isEditing ? (
          <textarea
            className="textarea"
            style={{
              width: "100%",
              height: "100%",
              fontFamily: "var(--font-mono)",
              fontSize: "12.5px",
              lineHeight: 1.55,
              resize: "none",
            }}
            value={editBuffer}
            onChange={(e) => setEditBuffer(e.target.value)}
          />
        ) : isMarkdown ? (
          <div
            ref={contentContainerRef}
            className="markdown-body"
            onClick={(e) => {
              const target = e.target as HTMLElement;
              const anchor = target.closest("a");
              if (anchor) {
                const href = anchor.getAttribute("href") || "";
                if (href && !href.startsWith("http://") && !href.startsWith("https://") && !href.startsWith("#")) {
                  e.preventDefault();
                  const resolved = resolveRelativeWorkspacePath(relPath, href);
                  onOpenFile(resolved);
                }
              }
            }}
            dangerouslySetInnerHTML={{ __html: renderedHtml }}
          />
        ) : isTabular && parsedTable ? (
          <div>
            <div style={{ fontSize: "11px", color: "var(--muted)", marginBottom: "8px" }}>
              Showing {parsedTable.rows.length} of {parsedTable.totalRows.toLocaleString()} rows
            </div>
            <div className="table-wrapper" tabIndex={0} role="region" aria-label={`Data table ${relPath}`}>
              <table className="pipeline-table">
                <thead>
                  <tr>
                    {parsedTable.headers.map((h, i) => (
                      <th key={i}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {parsedTable.rows.map((r, rIdx) => (
                    <tr key={rIdx} className="phase-row">
                      {r.map((cell, cIdx) => (
                        <td
                          key={cIdx}
                          style={{
                            fontFamily: "var(--font-mono)",
                            fontSize: "11.5px",
                            whiteSpace: "nowrap",
                            maxWidth: "280px",
                            overflow: "hidden",
                            textOverflow: "ellipsis",
                          }}
                          title={cell}
                        >
                          {cell}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        ) : (
          <pre
            style={{
              margin: 0,
              padding: "14px 16px",
              background: "#0d0d10",
              border: "1px solid var(--border)",
              borderRadius: "8px",
              fontFamily: "var(--font-mono)",
              fontSize: "12px",
              lineHeight: 1.55,
              color: "#e4e4e7",
              overflowX: "auto",
              whiteSpace: "pre-wrap",
              wordBreak: "break-word",
            }}
          >
            {content}
          </pre>
        )}
      </div>
    </div>
  );
};

