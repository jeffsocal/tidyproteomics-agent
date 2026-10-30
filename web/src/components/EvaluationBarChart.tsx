import React, { useEffect, useRef } from "react";
import Plotly from "plotly.js-dist-min";

export interface EvaluationSeries {
  name: string;
  values: number[];
  text?: (string | number)[];
  color?: string;
}

export interface EvaluationBarChartProps {
  title: string;
  subtitle?: string;
  categories: string[];
  series: EvaluationSeries[];
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

export const EvaluationBarChart: React.FC<EvaluationBarChartProps> = ({
  title,
  subtitle,
  categories,
  series,
  yAxisTitle,
  yAxisRange,
  height = 360,
  valueFormatter,
}) => {
  const containerRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const el = containerRef.current;
    if (!el || series.length === 0) return;

    const data: any[] = series.map((s, idx) => {
      const color = s.color || MODEL_PALETTE[idx % MODEL_PALETTE.length];
      const textLabels = s.text
        ? s.text
        : s.values.map((v) => (valueFormatter ? valueFormatter(v) : String(v)));

      return {
        x: categories,
        y: s.values,
        name: s.name,
        type: "bar",
        marker: {
          color,
          line: {
            color: "rgba(255, 255, 255, 0.2)",
            width: 1,
          },
        },
        text: textLabels,
        textposition: "auto",
        hoverinfo: "x+y+name",
        hovertemplate: `<b>%{data.name}</b><br>%{x}: <b>%{text}</b><extra></extra>`,
      };
    });

    const layout: any = {
      barmode: "group",
      bargap: 0.22,
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
        t: 45,
        b: 70,
      },
      legend: {
        orientation: "h",
        y: 1.18,
        x: 0.5,
        xanchor: "center",
        font: { color: "#e4e4e7", size: 11 },
        bgcolor: "rgba(0, 0, 0, 0.35)",
        bordercolor: "rgba(255, 255, 255, 0.12)",
        borderwidth: 1,
      },
      xaxis: {
        tickfont: { color: "#e4e4e7", size: 11, weight: 600 },
        gridcolor: "rgba(255, 255, 255, 0.05)",
        linecolor: "rgba(255, 255, 255, 0.18)",
        automargin: true,
      },
      yaxis: {
        title: yAxisTitle ? { text: yAxisTitle, font: { color: "#a1a1aa", size: 11 } } : undefined,
        range: yAxisRange,
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

    Plotly.newPlot(el, data, layout, config);

    const ro = new ResizeObserver(() => {
      if (el) Plotly.Plots.resize(el);
    });
    ro.observe(el);

    return () => {
      ro.disconnect();
      if (el) Plotly.purge(el);
    };
  }, [categories, series, yAxisTitle, yAxisRange, height, title, valueFormatter]);

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

