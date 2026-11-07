import React, { useEffect, useMemo, useRef, useState } from "react";
import { Marked } from "marked";
import {
  BookOpen,
  Compass,
  FlaskConical,
  Search,
  X,
  RefreshCw,
  Printer,
} from "lucide-react";
import { renderBlockquoteWithAlerts } from "../utils/markdownAlerts";

export interface GuidesTabProps {
  initialGuide?: "howto" | "operations" | "scientific";
}

function slugifyHeading(text: string): string {
  return text
    .toLowerCase()
    .replace(/<[^>]+>/g, "")
    .replace(/[^\w\s-]/g, "")
    .trim()
    .replace(/\s+/g, (match) => "-".repeat(match.length));
}

const customMarked = new Marked({
  gfm: true,
  breaks: false,
});

customMarked.use({
  renderer: {
    heading({ tokens, depth, text }) {
      const slug = slugifyHeading(text);
      const innerHtml = this.parser ? this.parser.parseInline(tokens) : text;
      return `<h${depth} id="${slug}">${innerHtml}</h${depth}>\n`;
    },
    blockquote(token: any) {
      return renderBlockquoteWithAlerts(token, this.parser);
    },
  },
});

export const GuidesTab: React.FC<GuidesTabProps> = ({ initialGuide = "howto" }) => {
  const [selectedGuide, setSelectedGuide] = useState<"howto" | "operations" | "scientific">(initialGuide);
  const [guideLoading, setGuideLoading] = useState(false);
  const [guideError, setGuideError] = useState<string | null>(null);
  const [guideContent, setGuideContent] = useState<string>("");
  const [guideTitle, setGuideTitle] = useState<string>("");
  const [guideSearchQuery, setGuideSearchQuery] = useState<string>("");
  const guideContainerRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (initialGuide) {
      setSelectedGuide(initialGuide);
    }
  }, [initialGuide]);

  const fetchGuide = async (guideId: "howto" | "operations" | "scientific") => {
    setGuideLoading(true);
    setGuideError(null);
    try {
      const resp = await fetch(`/api/docs/${guideId}`);
      const data = await resp.json();
      if (!data.ok) {
        setGuideError(data.error || "Failed to load guide");
      } else {
        setGuideContent(data.content || "");
        setGuideTitle(data.title || "");
      }
    } catch (err: any) {
      setGuideError(err.message || "Failed to fetch guide from server");
    } finally {
      setGuideLoading(false);
    }
  };

  useEffect(() => {
    fetchGuide(selectedGuide);
  }, [selectedGuide]);

  const guideRenderedHtml = useMemo(() => {
    if (!guideContent) return "";
    return customMarked.parse(guideContent) as string;
  }, [guideContent]);

  const { guideDisplayHtml, guideMatchCount } = useMemo(() => {
    if (!guideRenderedHtml) return { guideDisplayHtml: "", guideMatchCount: 0 };
    const query = guideSearchQuery.trim();
    if (!query) return { guideDisplayHtml: guideRenderedHtml, guideMatchCount: 0 };

    const escaped = query.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    let count = 0;
    const parts = guideRenderedHtml.split(/(<[^>]+>)/g);
    const regex = new RegExp(`(${escaped})`, "gi");
    const highlightedParts = parts.map((part) => {
      if (part.startsWith("<") && part.endsWith(">")) {
        return part;
      }
      const matches = part.match(regex);
      if (matches) {
        count += matches.length;
        return part.replace(
          regex,
          '<mark style="background: #fde047; color: #0f172a; border-radius: 2px; padding: 0 2px; font-weight: 600;">$1</mark>'
        );
      }
      return part;
    });

    return { guideDisplayHtml: highlightedParts.join(""), guideMatchCount: count };
  }, [guideRenderedHtml, guideSearchQuery]);

  useEffect(() => {
    if (guideSearchQuery.trim() && guideMatchCount > 0) {
      const firstMark = guideContainerRef.current?.querySelector("mark");
      if (firstMark) {
        firstMark.scrollIntoView({ behavior: "smooth", block: "center" });
      }
    }
  }, [guideSearchQuery, guideMatchCount]);

  const handleContainerClick = (e: React.MouseEvent<HTMLDivElement>) => {
    const target = e.target as HTMLElement;
    const anchor = target.closest("a");
    if (!anchor) return;
    const href = anchor.getAttribute("href");
    if (!href) return;

    if (href.startsWith("#")) {
      e.preventDefault();
      const rawTargetId = href.slice(1);
      if (!rawTargetId) return;

      const targetId = decodeURIComponent(rawTargetId);

      let targetElem: HTMLElement | null = null;
      try {
        targetElem =
          guideContainerRef.current?.querySelector(`[id="${CSS.escape(rawTargetId)}"]`) ||
          guideContainerRef.current?.querySelector(`[id="${CSS.escape(targetId)}"]`) ||
          null;
      } catch {
        // Fallback below
      }

      if (!targetElem && guideContainerRef.current) {
        const headings = guideContainerRef.current.querySelectorAll("h1, h2, h3, h4, h5, h6");
        const normTarget = targetId.toLowerCase().replace(/[^a-z0-9]/g, "");
        for (const h of Array.from(headings)) {
          const hId = (h.getAttribute("id") || "").toLowerCase().replace(/[^a-z0-9]/g, "");
          if (hId === normTarget) {
            targetElem = h as HTMLElement;
            break;
          }
        }
      }

      if (targetElem) {
        targetElem.scrollIntoView({ behavior: "smooth", block: "start" });
        try {
          window.history.replaceState(null, "", `#${rawTargetId}`);
        } catch {
          // ignore
        }
      }
    } else if (href.startsWith("http://") || href.startsWith("https://")) {
      e.preventDefault();
      window.open(href, "_blank", "noopener,noreferrer");
    }
  };

  const handlePrintGuide = () => {
    const printWindow = window.open("", "_blank", "width=900,height=1000");
    if (!printWindow) {
      alert("Pop-up blocker detected. Please allow pop-ups to print/export documentation.");
      return;
    }
    printWindow.document.write(`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <title>${guideTitle || "TidyProteomics Guides"}</title>
  <style>
    @page { size: A4 portrait; margin: 20mm 18mm; }
    body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; font-size: 11pt; line-height: 1.6; color: #111827; background: #fff; padding: 24px 32px; }
    h1 { font-size: 20pt; font-weight: 700; margin-bottom: 12pt; color: #000; }
    h2 { font-size: 14pt; font-weight: 700; margin-top: 20pt; border-bottom: 1.5px solid #e5e7eb; padding-bottom: 4pt; }
    h3 { font-size: 12pt; font-weight: 600; margin-top: 14pt; }
    table { width: 100%; border-collapse: collapse; margin: 14pt 0; font-size: 9pt; }
    th, td { border: 1px solid #d1d5db; padding: 5pt 7pt; text-align: left; }
    th { background: #f3f4f6; font-weight: 600; }
    pre, code { font-family: monospace; font-size: 9.5pt; }
    pre { background: #f3f4f6; padding: 10pt; border-radius: 4px; overflow-x: auto; }
    blockquote { border-left: 3.5px solid #3b82f6; margin: 12pt 0; padding-left: 12pt; color: #4b5563; }
    @media print { .no-print { display: none !important; } }
  </style>
</head>
<body>
  <div class="no-print" style="margin-bottom: 16px; padding: 8px 12px; background: #f3f4f6; border-radius: 4px; display: flex; justify-content: space-between; align-items: center;">
    <strong>${guideTitle}</strong>
    <button onclick="window.print()" style="padding: 6px 14px; background: #2563eb; color: #fff; border: none; border-radius: 4px; cursor: pointer; font-weight: 600;">🖨 Print / Save PDF</button>
  </div>
  <div class="markdown-body">
    ${guideRenderedHtml}
  </div>
  <script>window.addEventListener('load', () => setTimeout(() => window.print(), 400));<\/script>
</body>
</html>`);
    printWindow.document.close();
  };

  return (
    <div style={{ flex: "1 1 auto", overflow: "auto", padding: "20px 28px", display: "flex", flexDirection: "column", gap: "16px" }}>
      {/* Top Controls Sub-Bar */}
      <div
        className="card"
        style={{
          padding: "12px 18px",
          display: "flex",
          flexWrap: "wrap",
          alignItems: "center",
          justifyContent: "space-between",
          gap: "12px",
          background: "var(--tabbar-bg)",
        }}
      >
        {/* Left Guide Selector Buttons */}
        <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
          <button
            type="button"
            className={`btn btn-sm ${selectedGuide === "howto" ? "btn-primary" : "btn-secondary"}`}
            onClick={() => setSelectedGuide("howto")}
            style={{ display: "inline-flex", alignItems: "center", gap: "6px" }}
            title="Quick How-To Guide: Getting Started, Studio Components & Architecture"
          >
            <Compass size={13} /> 🚀 Quick "How-To" Guide
          </button>
          <button
            type="button"
            className={`btn btn-sm ${selectedGuide === "operations" ? "btn-primary" : "btn-secondary"}`}
            onClick={() => setSelectedGuide("operations")}
            style={{ display: "inline-flex", alignItems: "center", gap: "6px" }}
          >
            <BookOpen size={13} /> 📖 Operations Manual
          </button>
          <button
            type="button"
            className={`btn btn-sm ${selectedGuide === "scientific" ? "btn-primary" : "btn-secondary"}`}
            onClick={() => setSelectedGuide("scientific")}
            style={{ display: "inline-flex", alignItems: "center", gap: "6px" }}
            title="Scientific Guide: Normalization, Imputation, Expression & Enrichment"
          >
            <FlaskConical size={13} /> 🔬 Scientific Guide
          </button>
        </div>

        {/* Right Toolbar: Search, Refresh, Print */}
        <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
          <div style={{ position: "relative", display: "flex", alignItems: "center" }}>
            <Search size={12} style={{ position: "absolute", left: "8px", color: "var(--muted)" }} />
            <input
              type="text"
              className="input"
              style={{
                paddingLeft: "24px",
                paddingRight: guideSearchQuery ? "22px" : "8px",
                width: "190px",
                height: "28px",
                fontSize: "11.5px",
              }}
              placeholder="Search in guide..."
              value={guideSearchQuery}
              onChange={(e) => setGuideSearchQuery(e.target.value)}
            />
            {guideSearchQuery && (
              <button
                type="button"
                onClick={() => setGuideSearchQuery("")}
                style={{
                  position: "absolute",
                  right: "4px",
                  background: "none",
                  border: "none",
                  cursor: "pointer",
                  padding: "2px",
                  display: "flex",
                  alignItems: "center",
                  color: "var(--muted)",
                }}
                title="Clear search"
              >
                <X size={11} />
              </button>
            )}
          </div>

          {guideSearchQuery.trim() && (
            <span
              style={{
                fontSize: "11px",
                whiteSpace: "nowrap",
                color: guideMatchCount > 0 ? "var(--fg-bright)" : "var(--muted)",
                fontWeight: 600,
              }}
            >
              {guideMatchCount > 0 ? `${guideMatchCount} found` : "No matches"}
            </span>
          )}

          <button
            type="button"
            className="btn btn-secondary btn-xs"
            onClick={() => fetchGuide(selectedGuide)}
            title="Reload guide from disk"
          >
            <RefreshCw size={11} className={guideLoading ? "spin" : ""} /> Reload
          </button>

          <button
            type="button"
            className="btn btn-secondary btn-xs"
            onClick={handlePrintGuide}
            title="Print or export formatted guide to PDF"
            style={{ display: "inline-flex", alignItems: "center", gap: "4px" }}
          >
            <Printer size={11} /> Print / PDF
          </button>
        </div>
      </div>

      {/* Guide Content Display */}
      <div
        className="card"
        style={{
          padding: "28px 36px",
          minHeight: "500px",
          maxWidth: "1080px",
          width: "100%",
          margin: "0 auto",
          background: "var(--panel-bg)",
        }}
      >
        {guideLoading ? (
          <div style={{ padding: "40px", textAlign: "center", color: "var(--muted)" }}>
            <RefreshCw size={18} className="spin" style={{ marginBottom: "8px" }} />
            <div>
              Loading{" "}
              {selectedGuide === "howto"
                ? "Quick How-To Guide"
                : selectedGuide === "operations"
                  ? "Operations Guide"
                  : "Scientific Guide"}
              ...
            </div>
          </div>
        ) : guideError ? (
          <div style={{ padding: "30px", textAlign: "center", color: "var(--error)" }}>
            <p>{guideError}</p>
            <button
              type="button"
              className="btn btn-secondary btn-sm"
              onClick={() => fetchGuide(selectedGuide)}
              style={{ marginTop: "8px" }}
            >
              Retry Loading
            </button>
          </div>
        ) : (
          <div
            ref={guideContainerRef}
            className="markdown-body"
            onClick={handleContainerClick}
            dangerouslySetInnerHTML={{ __html: guideDisplayHtml }}
          />
        )}
      </div>
    </div>
  );
};

