import React, { useEffect, useRef } from "react";
import Plotly from "plotly.js-dist-min";

export interface EvaluationSeries {
  name: string;
  values: number[];
  text?: (string | number)[];
  hoverText?: (string | number)[];
  color?: string;
}

export interface EvaluationBarChartProps {
  title: string;
  subtitle?: string;
  categories: string[];
  series: EvaluationSeries[];
  xAxisTitle?: string;
  xAxisRange?: [number, number];
  yAxisTitle?: string;
  yAxisRange?: [number, number];
  height?: number;
  valueFormatter?: (val: number) => string;
}

// Consistent accessible palette for models across benchmark charts
export const MODEL_PALETTE = [
  "#3b82f6", // Blue (primary / baseline)
  "#10b981", // Emerald
  "#f59e0b", // Amber
  "#a855f7", // Purple
  "#ec4899", // Pink
  "#06b6d4", // Cyan
  "#f97316", // Orange
  "#84cc16", // Lime
];

/**
 * Wraps category labels by inserting <br> line breaks to keep x-axis labels
 * horizontal without overlapping or cramping.
 */
export function wrapCategoryLabel(label: string, maxLineLength = 16): string {
  if (!label || label.includes("<br>")) return label;

  const words = label.split(" ");
  if (words.length <= 1) return label;

  const lines: string[] = [];
  let currentLine = "";

  for (const word of words) {
    if (!currentLine) {
      currentLine = word;
    } else if ((currentLine + " " + word).length <= maxLineLength) {
      currentLine += " " + word;
    } else {
      lines.push(currentLine);
      currentLine = word;
    }
  }
  if (currentLine) {
    lines.push(currentLine);
  }

  return lines.join("<br>");
}

export const EvaluationBarChart: React.FC<EvaluationBarChartProps> = ({
  title,
  subtitle,
  categories,
  series,
  xAxisTitle,
  xAxisRange,
  yAxisTitle,
  yAxisRange,
  height = 400,
  valueFormatter,
}) => {
  const containerRef = useRef<HTMLDivElement | null>(null);

  // ResizeObserver for dynamic pane adjustments (created once per mount)
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    const ro = new ResizeObserver(() => {
      if (el) Plotly.Plots.resize(el);
    });
    ro.observe(el);

    return () => {
      ro.disconnect();
    };
  }, []);

  // Cleanup plot on unmount
  useEffect(() => {
    const el = containerRef.current;
    return () => {
      if (el) {
        Plotly.purge(el);
      }
    };
  }, []);

  useEffect(() => {
    const el = containerRef.current;
    if (!el || series.length === 0) return;

    // The value axis is now the vertical y-axis
    const effectiveValueTitle = yAxisTitle || xAxisTitle;
    const effectiveValueRange = yAxisRange || xAxisRange;

    // Wrap x-axis category labels so they stay horizontal without overlapping
    const wrappedCategories = categories.map((c) => wrapCategoryLabel(c, 16));

    const data: any[] = series.map((s, idx) => {
      const color = s.color || MODEL_PALETTE[idx % MODEL_PALETTE.length];
      const textLabels = s.text
        ? s.text
        : s.values.map((v) => (valueFormatter ? valueFormatter(v) : String(v)));
      const hoverLabels = s.hoverText || s.text || textLabels;

      return {
        x: wrappedCategories,
        y: s.values,
        name: s.name,
        type: "bar",
        orientation: "v",
        customdata: hoverLabels,
        marker: {
          color,
          line: {
            color: "rgba(255, 255, 255, 0.2)",
            width: 1,
          },
        },
        text: textLabels,
        textposition: "auto",
        hoverinfo: "x+name",
        hovertemplate: `<b>%{data.name}</b><br>%{x}: <b>%{customdata}</b><extra></extra>`,
      };
    });

    const layout: any = {
      barmode: "group",
      bargap: 0.24,
      bargroupgap: 0.08,
      autosize: true,
      height,
      paper_bgcolor: "transparent",
      plot_bgcolor: "rgba(255, 255, 255, 0.02)",
      font: {
        color: "#e4e4e7",
        family: 'system-ui, -apple-system, BlinkMacSystemFont, "Inter", sans-serif',
        size: 11,
      },
      margin: {
        l: 55,
        r: 25,
        t: 25,
        b: 105,
      },
      // Horizontal legend placed at the bottom, full width of the plot
      legend: {
        orientation: "h",
        yanchor: "top",
        y: -0.25,
        xanchor: "center",
        x: 0.5,
        font: { color: "#e4e4e7", size: 10.5 },
        bgcolor: "rgba(0, 0, 0, 0.35)",
        bordercolor: "rgba(255, 255, 255, 0.12)",
        borderwidth: 1,
      },
      xaxis: {
        tickangle: 0, // Keep metric names strictly horizontal
        tickfont: { color: "#e4e4e7", size: 10.5, weight: 600 },
        gridcolor: "rgba(255, 255, 255, 0.05)",
        linecolor: "rgba(255, 255, 255, 0.18)",
        automargin: true,
      },
      yaxis: {
        title: effectiveValueTitle ? { text: effectiveValueTitle, font: { color: "#a1a1aa", size: 11 } } : undefined,
        range: effectiveValueRange,
        tickfont: { color: "#a1a1aa", size: 10.5 },
        gridcolor: "rgba(255, 255, 255, 0.07)",
        zerolinecolor: "rgba(255, 255, 255, 0.15)",
        linecolor: "rgba(255, 255, 255, 0.18)",
        automargin: true,
      },
    };

    const config: any = {
      responsive: true,
      displayModeBar: true,
      displaylogo: false,
      modeBarButtonsToRemove: [
        "sendDataToCloud",
        "select2d",
        "lasso2d",
        "hoverClosestCartesian",
        "hoverCompareCartesian",
        "toggleSpikelines",
      ],
      toImageButtonOptions: {
        format: "png",
        filename: title.toLowerCase().replace(/[^a-z0-9]+/g, "_"),
        height: 700,
        width: 1200,
        scale: 2,
      },
    };

    Plotly.react(el, data, layout, config);
  }, [categories, series, xAxisTitle, xAxisRange, yAxisTitle, yAxisRange, height, title, valueFormatter]);

  return (
    <div
      style={{
        background: "var(--panel)",
        border: "1px solid var(--border)",
        borderRadius: "8px",
        padding: "16px 18px",
        display: "flex",
        flexDirection: "column",
        gap: "8px",
        width: "100%",
        boxSizing: "border-box",
      }}
    >
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", flexWrap: "wrap", gap: "6px" }}>
        <span
          style={{
            fontSize: "13px",
            fontWeight: 700,
            color: "var(--fg-bright)",
            letterSpacing: "0.3px",
          }}
        >
          {title}
        </span>
        {subtitle && (
          <span style={{ fontSize: "11px", color: "var(--muted)" }}>
            {subtitle}
          </span>
        )}
      </div>
      <div
        ref={containerRef}
        style={{
          width: "100%",
          minHeight: `${height}px`,
          borderRadius: "6px",
          overflow: "hidden",
        }}
      />
    </div>
  );
};

