import * as fsSync from "fs";
import * as path from "path";

/**
 * Lightweight delimited-table helpers used by the deterministic rubric verifiers.
 * Tables are produced by tidyproteomics exports in `data/` (TSV preferred, CSV fallback).
 */

export type Row = Record<string, string>;

function parseCsvLine(line: string): string[] {
  const out: string[] = [];
  let cur = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQuotes) {
      if (ch === '"' && line[i + 1] === '"') {
        cur += '"';
        i++;
      } else if (ch === '"') {
        inQuotes = false;
      } else {
        cur += ch;
      }
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === ",") {
      out.push(cur);
      cur = "";
    } else {
      cur += ch;
    }
  }
  out.push(cur);
  return out;
}

export function parseDelimited(content: string, delimiter: "\t" | ","): Row[] {
  const lines = content.split(/\r?\n/).filter((l) => l.trim().length > 0);
  if (lines.length < 2) return [];
  const split = (l: string) => (delimiter === "\t" ? l.split("\t") : parseCsvLine(l));
  const header = split(lines[0]).map((h) => h.trim().replace(/^"|"$/g, ""));
  const rows: Row[] = [];
  for (let i = 1; i < lines.length; i++) {
    const cells = split(lines[i]);
    const row: Row = {};
    header.forEach((h, idx) => {
      row[h] = (cells[idx] ?? "").trim().replace(/^"|"$/g, "");
    });
    rows.push(row);
  }
  return rows;
}

/**
 * Loads all tables in `dataDir` whose file name matches `pattern`, preferring TSV over CSV
 * for the same stem so that rows are not double counted.
 */
export function loadTables(dataDir: string, pattern: RegExp): { file: string; rows: Row[] }[] {
  if (!fsSync.existsSync(dataDir)) return [];
  const files = fsSync.readdirSync(dataDir).filter((f) => pattern.test(f));
  const stems = new Map<string, string>();
  for (const f of files) {
    const stem = f.replace(/\.(tsv|csv)$/i, "");
    const existing = stems.get(stem);
    if (!existing || f.toLowerCase().endsWith(".tsv")) stems.set(stem, f);
  }
  const out: { file: string; rows: Row[] }[] = [];
  for (const f of stems.values()) {
    try {
      const raw = fsSync.readFileSync(path.join(dataDir, f), "utf-8");
      const rows = parseDelimited(raw, f.toLowerCase().endsWith(".tsv") ? "\t" : ",");
      if (rows.length > 0) out.push({ file: f, rows });
    } catch {
      /* unreadable table is ignored */
    }
  }
  return out;
}

export function num(v: string | undefined): number | null {
  if (v === undefined || v === null) return null;
  const s = String(v).trim();
  if (!s || /^(na|nan|null|inf|-inf)$/i.test(s)) return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

export interface ExpressionRecord {
  gene: string;
  protein: string;
  log2fc: number | null;
  p: number | null;
  q: number | null;
  normalization?: string;
  contrastFile: string;
}

export interface EnrichmentRecord {
  term: string;
  annotation: string;
  enrichment: number | null;
  p: number | null;
  q: number | null;
  size: number | null;
}

export interface RunTables {
  expression: ExpressionRecord[];
  enrichment: EnrichmentRecord[];
  bySymbol: Map<string, ExpressionRecord[]>;
  expressionFiles: string[];
  enrichmentFiles: string[];
}

export function loadRunTables(runRoot: string): RunTables {
  const dataDir = path.join(runRoot, "data");
  const exprTables = loadTables(dataDir, /^table_proteins_expression_.*\.(tsv|csv)$/i);
  const enrTables = loadTables(dataDir, /^table_proteins_enrichment_.*\.(tsv|csv)$/i);

  const expression: ExpressionRecord[] = [];
  for (const t of exprTables) {
    for (const r of t.rows) {
      expression.push({
        gene: (r.gene_name || r.gene || "").trim(),
        protein: (r.protein || r.accession || "").trim(),
        log2fc: num(r.log2_foldchange ?? r.log2_fold_change ?? r.log2fc),
        p: num(r.p_value),
        q: num(r.adj_p_value ?? r.q_value),
        normalization: r.normalization,
        contrastFile: t.file,
      });
    }
  }

  const enrichment: EnrichmentRecord[] = [];
  for (const t of enrTables) {
    for (const r of t.rows) {
      enrichment.push({
        term: (r.term || "").trim(),
        annotation: (r.annotation || "").trim(),
        enrichment: num(r.enrichment ?? r.score),
        p: num(r.p_value),
        q: num(r.adj_p_value),
        size: num(r.size),
      });
    }
  }

  const bySymbol = new Map<string, ExpressionRecord[]>();
  const add = (k: string, rec: ExpressionRecord) => {
    if (!k || k === "NA") return;
    const key = k.toUpperCase();
    const list = bySymbol.get(key) || [];
    list.push(rec);
    bySymbol.set(key, list);
  };
  for (const rec of expression) {
    add(rec.gene, rec);
    add(rec.protein, rec);
  }

  return {
    expression,
    enrichment,
    bySymbol,
    expressionFiles: exprTables.map((t) => t.file),
    enrichmentFiles: enrTables.map((t) => t.file),
  };
}

