import React, { useEffect, useRef, useState } from "react";
import Plotly from "plotly.js-dist-min";
import { Sparkles, Image as ImageIcon, RotateCcw, Maximize2, Minimize2, Download } from "lucide-react";

interface PlotlyPlotProps {
  plotRelPath: string;
  altText?: string;
  rawImageUrl: string;
}

export const PlotlyPlot: React.FC<PlotlyPlotProps> = ({ plotRelPath, altText, rawImageUrl }) => {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [viewMode, setViewMode] = useState<"plotly" | "static">("plotly");
  const [loading, setLoading] = useState(true);
  const [hasPlotlyData, setHasPlotlyData] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [plotlySpec, setPlotlySpec] = useState<any>(null);

  useEffect(() => {
    let isCancelled = false;
    setLoading(true);

    fetch(`/api/workspace/plot/plotly?file=${encodeURIComponent(plotRelPath)}`)
      .then((res) => res.json())
      .then((data) => {
        if (isCancelled) return;
        if (data.ok && data.plotly) {
          setPlotlySpec(data.plotly);
          setHasPlotlyData(true);
          setViewMode("plotly");
        } else {
          setHasPlotlyData(false);
          setViewMode("static");
        }
      })
      .catch(() => {
        if (!isCancelled) {
          setHasPlotlyData(false);
          setViewMode("static");
        }
      })
      .finally(() => {
        if (!isCancelled) setLoading(false);
      });

    return () => {
      isCancelled = true;
    };
  }, [plotRelPath]);

  // Render Plotly chart when container and spec are ready
  useEffect(() => {
    if (viewMode !== "plotly" || !containerRef.current || !plotlySpec) return;

    const el = containerRef.current;
    const rawData = plotlySpec.data || [];
    const rawLayout = plotlySpec.layout || {};

    // Normalize data traces: ensure x, y, and text data arrays are proper Arrays
    // (guards against R auto_unbox: true turning length-1 coordinate vectors into scalars, which breaks Plotly.js data_array loops)
    const cleanData = rawData.map((trace: any) => {
      const t = { ...trace };
      if (t.x !== undefined && t.x !== null && !Array.isArray(t.x)) t.x = [t.x];
      if (t.y !== undefined && t.y !== null && !Array.isArray(t.y)) t.y = [t.y];
      if (t.z !== undefined && t.z !== null && !Array.isArray(t.z)) t.z = [t.z];
      if (t.text !== undefined && t.text !== null && !Array.isArray(t.text) && typeof t.mode === "string" && t.mode.includes("text")) {
        t.text = [t.text];
      }
      return t;
    });

    // Apply clean publication-grade white theme
    const styledLayout = {
      ...rawLayout,
      autosize: true,
      paper_bgcolor: "#ffffff",
      plot_bgcolor: "#ffffff",
      font: {
        color: "#111827",
        family: "system-ui, -apple-system, sans-serif",
        size: 11.5,
        ...(rawLayout.font || {}),
      },
      margin: {
        l: 65,
        r: 30,
        t: 40,
        b: 55,
        ...(rawLayout.margin || {}),
      },
      xaxis: {
        gridcolor: "#f3f4f6",
        zerolinecolor: "#e5e7eb",
        linecolor: "#9ca3af",
        tickfont: { color: "#374151", size: 10 },
        ...(rawLayout.xaxis || {}),
      },
      yaxis: {
        gridcolor: "#f3f4f6",
        zerolinecolor: "#e5e7eb",
        linecolor: "#9ca3af",
        tickfont: { color: "#374151", size: 10 },
        ...(rawLayout.yaxis || {}),
      },
    };

    const config = {
      responsive: true,
      displayModeBar: true,
      displaylogo: false,
      modeBarButtonsToRemove: ["sendDataToCloud"],
      toImageButtonOptions: {
        format: "png",
        filename: (altText || "plot").replace(/[^a-zA-Z0-9_-]/g, "_"),
        height: 700,
        width: 1000,
        scale: 2,
      },
      ...(plotlySpec.config || {}),
    };

    Plotly.newPlot(el, cleanData, styledLayout, config);

    const handleResize = () => {
      if (el) Plotly.Plots.resize(el);
    };
    window.addEventListener("resize", handleResize);

    return () => {
      window.removeEventListener("resize", handleResize);
      Plotly.purge(el);
    };
  }, [viewMode, plotlySpec, isFullscreen]);

  const handleResetAxes = () => {
    if (containerRef.current) {
      Plotly.relayout(containerRef.current, {
        "xaxis.autorange": true,
        "yaxis.autorange": true,
      } as any);
    }
  };

  const handleDownloadPng = () => {
    if (viewMode === "plotly" && containerRef.current) {
      Plotly.downloadImage(containerRef.current, {
        format: "png",
        filename: (altText || "plot").replace(/[^a-zA-Z0-9_-]/g, "_"),
        height: 800,
        width: 1200,
        scale: 2,
      });
    } else {
      const a = document.createElement("a");
      a.href = rawImageUrl;
      a.download = plotRelPath.split("/").pop() || "plot.png";
      a.click();
    }
  };

  return (
    <figure
      className={`interactive-figure ${isFullscreen ? "fullscreen-plot" : ""}`}
      style={{
        margin: "24px 0",
        border: "1px solid var(--border)",
        borderRadius: "8px",
        overflow: "hidden",
        background: "var(--bg-card)",
        boxShadow: "0 4px 14px rgba(0, 0, 0, 0.25)",
        ...(isFullscreen
          ? {
              position: "fixed",
              top: 0,
              left: 0,
              width: "100vw",
              height: "100vh",
              zIndex: 9999,
              borderRadius: 0,
              margin: 0,
            }
          : {}),
      }}
    >
      {/* Figure Control Header */}
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          padding: "8px 14px",
          background: "rgba(255, 255, 255, 0.03)",
          borderBottom: "1px solid var(--border)",
          fontSize: "12px",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
          {altText && (
            <span style={{ fontWeight: 600, color: "var(--fg-bright)" }}>
              {altText}
            </span>
          )}
          {hasPlotlyData && (
            <span
              style={{
                fontSize: "10px",
                padding: "2px 6px",
                borderRadius: "4px",
                background: viewMode === "plotly" ? "rgba(16, 185, 129, 0.15)" : "rgba(255, 255, 255, 0.05)",
                color: viewMode === "plotly" ? "#34d399" : "var(--muted)",
                display: "flex",
                alignItems: "center",
                gap: "4px",
                fontWeight: 600,
              }}
            >
              <Sparkles size={10} />
              {viewMode === "plotly" ? "Interactive Plotly" : "Static Image"}
            </span>
          )}
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
          {/* Mode Switcher */}
          {hasPlotlyData && (
            <div
              style={{
                display: "flex",
                background: "rgba(0, 0, 0, 0.3)",
                padding: "2px",
                borderRadius: "5px",
                border: "1px solid var(--border)",
              }}
            >
              <button
                type="button"
                className={`btn btn-xs ${viewMode === "plotly" ? "btn-primary" : "btn-secondary"}`}
                style={{ padding: "2px 7px", fontSize: "10.5px", gap: "4px" }}
                onClick={() => setViewMode("plotly")}
                title="Interactive Plotly view with zoom, pan, and hover metrics"
              >
                <Sparkles size={10} /> Interactive
              </button>
              <button
                type="button"
                className={`btn btn-xs ${viewMode === "static" ? "btn-primary" : "btn-secondary"}`}
                style={{ padding: "2px 7px", fontSize: "10.5px", gap: "4px" }}
                onClick={() => setViewMode("static")}
                title="Original publication-rendered static PNG"
              >
                <ImageIcon size={10} /> Static
              </button>
            </div>
          )}

          {viewMode === "plotly" && hasPlotlyData && (
            <button
              type="button"
              className="btn btn-secondary btn-xs"
              style={{ padding: "3px 6px" }}
              onClick={handleResetAxes}
              title="Reset Zoom & Pan"
            >
              <RotateCcw size={11} />
            </button>
          )}

          <button
            type="button"
            className="btn btn-secondary btn-xs"
            style={{ padding: "3px 6px" }}
            onClick={handleDownloadPng}
            title="Download PNG figure"
          >
            <Download size={11} />
          </button>

          <button
            type="button"
            className="btn btn-secondary btn-xs"
            style={{ padding: "3px 6px" }}
            onClick={() => setIsFullscreen(!isFullscreen)}
            title={isFullscreen ? "Exit Fullscreen" : "Fullscreen View"}
          >
            {isFullscreen ? <Minimize2 size={11} /> : <Maximize2 size={11} />}
          </button>
        </div>
      </div>

      {/* Plot Canvas / Image Area */}
      <div
        style={{
          width: "100%",
          height: isFullscreen ? "calc(100vh - 45px)" : "460px",
          position: "relative",
          background: "#ffffff",
          display: "flex",
          justifyContent: "center",
          alignItems: "center",
        }}
      >
        {loading && (
          <div
            style={{
              position: "absolute",
              top: 0,
              left: 0,
              right: 0,
              bottom: 0,
              display: "flex",
              justifyContent: "center",
              alignItems: "center",
              color: "#4b5563",
              fontSize: "12px",
              background: "rgba(255, 255, 255, 0.8)",
              zIndex: 2,
            }}
          >
            Loading interactive Plotly visualization...
          </div>
        )}

        {viewMode === "plotly" && hasPlotlyData ? (
          <div
            ref={containerRef}
            style={{
              width: "100%",
              height: "100%",
            }}
          />
        ) : (
          <div
            style={{
              width: "100%",
              height: "100%",
              display: "flex",
              justifyContent: "center",
              alignItems: "center",
              padding: "16px",
            }}
          >
            <img
              src={rawImageUrl}
              alt={altText || plotRelPath}
              style={{
                maxWidth: "100%",
                maxHeight: "100%",
                objectFit: "contain",
                background: "#ffffff",
                borderRadius: "6px",
                padding: "8px",
              }}
            />
          </div>
        )}
      </div>

      {/* Caption footer */}
      {altText && (
        <figcaption
          style={{
            padding: "8px 14px",
            fontSize: "11px",
            color: "var(--muted)",
            borderTop: "1px solid var(--border)",
            background: "rgba(0, 0, 0, 0.2)",
            fontStyle: "italic",
          }}
        >
          Figure: {altText} {hasPlotlyData && "— Interactive zoom, pan, and hover metrics enabled."}
        </figcaption>
      )}
    </figure>
  );
};
