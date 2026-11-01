import * as fsSync from "fs";
import * as path from "path";
import { RunTables, ExpressionRecord } from "./tables";
import type { VerifierReport, VerifierResult } from "../../types/evaluation";

/**
 * Deterministic, data-grounded verifiers for the TidyProteomics benchmark rubric (v2).
 *
 * Every verifier returns a VerifierResult whose `score` is in [0, 1] (or null when the
 * check is not applicable / not verifiable for this run) together with human-readable
 * `details` explaining any deductions. None of these checks award credit for the mere
 * presence of keywords; they compare manuscript claims against persisted artifacts.
 */

const MINUS = /[\u2212\u2010\u2011\u2012\u2013\u2014]/g;
const NUM_RE = "[+\\-]?\\d+(?:,\\d{3})*(?:\\.\\d+)?(?:[eE][+\\-]?\\d+)?";

function normalizeText(s: string): string {
  return s.replace(MINUS, "-").replace(/₂/g, "2").replace(/\*\*/g, "").replace(/\u00a0/g, " ");
}

function parseNum(s: string): number {
  return Number(s.replace(/,/g, "").replace(/^\+/, ""));
}

/** Half a unit in the last displayed digit, e.g. "3.22e-03" -> 0.005e-3, "0.053" -> 0.0005 */
function displayTolerance(raw: string): number {
  const s = raw.replace(/^[+-]/, "").replace(/,/g, "");
  const m = s.match(/^(\d+)(?:\.(\d+))?(?:[eE]([+-]?\d+))?$/);
  if (!m) return 0;
  const decimals = m[2] ? m[2].length : 0;
  const exp = m[3] ? Number(m[3]) : 0;
  return 0.5 * Math.pow(10, -decimals) * Math.pow(10, exp);
}

function pValueMatches(raw: string, comparator: string, truth: number | null): boolean | null {
  if (truth === null) return null;
  const v = parseNum(raw);
  if (!Number.isFinite(v)) return null;
  if (comparator === "<" || comparator === "≤" || comparator === "<=") return truth <= v * 1.05;
  if (comparator === ">" || comparator === "≥" || comparator === ">=") return truth >= v * 0.95;
  const tol = Math.max(0.05 * Math.abs(truth), displayTolerance(raw));
  return Math.abs(v - truth) <= tol;
}

function log2fcStatus(raw: string, truth: number | null): "match" | "flipped" | "mismatch" | null {
  if (truth === null) return null;
  const v = parseNum(raw);
  if (!Number.isFinite(v)) return null;
  const tol = Math.max(0.05, displayTolerance(raw));
  if (Math.abs(v - truth) <= tol) return "match";
  if (Math.abs(truth) > tol && Math.abs(v + truth) <= tol) return "flipped";
  return "mismatch";
}

export interface ManuscriptClaim {
  symbol: string;
  log2fc?: string;
  p?: { raw: string; cmp: string };
  q?: { raw: string; cmp: string };
  source: "table" | "prose";
  line: number;
  text: string;
}

interface Section {
  title: string;
  level: number;
  start: number;
  end: number;
  body: string;
}

export function splitSections(md: string): Section[] {
  const lines = md.split(/\r?\n/);
  const heads: { title: string; level: number; line: number }[] = [];
  lines.forEach((l, i) => {
    const m = l.match(/^(#{1,6})\s+(.+?)\s*$/);
    if (m) heads.push({ title: m[2], level: m[1].length, line: i });
  });
  return heads.map((h, idx) => {
    let end = lines.length;
    for (let j = idx + 1; j < heads.length; j++) {
      if (heads[j].level <= h.level) {
        end = heads[j].line;
        break;
      }
    }
    return { title: h.title, level: h.level, start: h.line, end, body: lines.slice(h.line + 1, end).join("\n") };
  });
}

function findSection(md: string, re: RegExp): Section | undefined {
  return splitSections(md).find((s) => re.test(s.title.replace(/^[\d.\s]+/, "")));
}

/* ------------------------------------------------------------------ */
/* Claim extraction                                                    */
/* ------------------------------------------------------------------ */

function splitRow(line: string): string[] {
  return line.trim().replace(/^\|/, "").replace(/\|$/, "").split("|").map((c) => c.trim());
}

export function extractClaims(manuscript: string, tables: RunTables): ManuscriptClaim[] {
  const text = normalizeText(manuscript);
  const lines = text.split(/\r?\n/);
  const claims: ManuscriptClaim[] = [];
  const tableLines = new Set<number>();

  // 1. Markdown tables with an explicit log2FC column
  for (let i = 0; i < lines.length - 1; i++) {
    if (!/^\s*\|/.test(lines[i]) || !/^\s*\|?\s*:?-{2,}/.test(lines[i + 1])) continue;
    const header = splitRow(lines[i]).map((h) => h.toLowerCase());
    let j = i + 2;
    const body: { cells: string[]; line: number }[] = [];
    while (j < lines.length && /^\s*\|/.test(lines[j])) {
      body.push({ cells: splitRow(lines[j]), line: j });
      tableLines.add(j);
      j++;
    }
    tableLines.add(i);
    tableLines.add(i + 1);
    const fcIdx = header.findIndex((h) => /log\s*_?2|log2/.test(h) && /fc|fold/.test(h) && !/median|mean|score|iqr/.test(h));
    if (fcIdx < 0) {
      i = j - 1;
      continue;
    }
    const pIdx = header.findIndex((h) => /^p[\s_-]?val|^p$|^p-value|^p value|nominal p/.test(h));
    const qIdx = header.findIndex((h) => /q[\s_-]?val|^q$|adj|fdr|bh/.test(h));
    const idIdx = header
      .map((h, k) => ({ h, k }))
      .filter(({ h }) => /gene|identifier|accession|uniprot|protein|symbol|^id$/.test(h))
      .map(({ k }) => k);

    for (const row of body) {
      let symbol: string | null = null;
      let looksLikeGene = false;
      for (const k of idIdx.length ? idIdx : [0, 1]) {
        const cell = row.cells[k] || "";
        const tokens = cell.match(/[A-Za-z][A-Za-z0-9-]{1,14}/g) || [];
        for (const t of tokens) {
          if (tables.bySymbol.has(t.toUpperCase())) {
            symbol = t.toUpperCase();
            break;
          }
          if (/^[A-Z][A-Z0-9-]{1,11}$/.test(t)) looksLikeGene = true;
        }
        if (symbol) break;
      }
      const fcRaw = (row.cells[fcIdx] || "").match(new RegExp(NUM_RE));
      if (!fcRaw) continue;
      if (!symbol && !looksLikeGene) continue;
      const getP = (idx: number) => {
        if (idx < 0) return undefined;
        const m = (row.cells[idx] || "").match(new RegExp(`(<=|>=|[<>≤≥])?\\s*(${NUM_RE})`));
        return m ? { raw: m[2], cmp: m[1] || "=" } : undefined;
      };
      claims.push({
        symbol: symbol || (row.cells[idIdx[0] ?? 0] || "?").split(/\s/)[0],
        log2fc: fcRaw[0],
        p: getP(pIdx),
        q: getP(qIdx),
        source: "table",
        line: row.line + 1,
        text: lines[row.line].slice(0, 200),
      });
    }
    i = j - 1;
  }

  // 2. Prose claims: SYMBOL ... log2FC = x [, p = y] [, q = z]   or   SYMBOL +0.44
  const proseFc = new RegExp(
    `\\b([A-Z][A-Z0-9-]{1,11})\\b[^|\\n]{0,80}?log\\s*2\\s*(?:FC|fold[ -]?change)\\s*(?:of|=|:)?\\s*(${NUM_RE})`,
    "g"
  );
  const signed = new RegExp(`\\b([A-Z][A-Z0-9-]{1,11})\\s*\\(?\\s*([+-]\\d+\\.\\d+)\\b`, "g");
  lines.forEach((line, idx) => {
    if (tableLines.has(idx) || /^\s*#/.test(line) || /^\s*!\[/.test(line)) return;
    const seen = new Set<string>();
    const pushClaim = (sym: string, fc: string, tail: string) => {
      const key = `${sym}:${fc}`;
      if (seen.has(key)) return;
      seen.add(key);
      const qm = tail.match(new RegExp(`\\b(?:q|FDR|adj\\.?\\s*p)\\s*(<=|>=|[=<>≤≥])\\s*(${NUM_RE})`, "i"));
      const pm = tail.match(new RegExp(`\\bp\\s*(<=|>=|[=<>≤≥])\\s*(${NUM_RE})`));
      claims.push({
        symbol: sym,
        log2fc: fc,
        q: qm ? { raw: qm[2], cmp: qm[1] } : undefined,
        p: pm ? { raw: pm[2], cmp: pm[1] } : undefined,
        source: "prose",
        line: idx + 1,
        text: line.slice(0, 200),
      });
    };
    let m: RegExpExecArray | null;
    proseFc.lastIndex = 0;
    while ((m = proseFc.exec(line))) {
      // Bind the log2FC number to the closest indexed symbol preceding it
      const window = line.slice(m.index, proseFc.lastIndex);
      const syms = (window.match(/\b[A-Z][A-Z0-9-]{1,11}\b/g) || []).filter((s) => tables.bySymbol.has(s));
      const sym = syms.length ? syms[syms.length - 1] : null;
      if (sym) pushClaim(sym, m[2], line.slice(proseFc.lastIndex, proseFc.lastIndex + 60));
    }
    signed.lastIndex = 0;
    while ((m = signed.exec(line))) {
      if (!tables.bySymbol.has(m[1])) continue;
      pushClaim(m[1], m[2], line.slice(signed.lastIndex, signed.lastIndex + 60));
    }
  });

  return claims;
}

/* ------------------------------------------------------------------ */
/* Individual verifiers                                                */
/* ------------------------------------------------------------------ */

function result(score: number | null, summary: string, details: string[] = [], threshold = 0.8): VerifierResult {
  return {
    score: score === null ? null : Math.round(score * 1000) / 1000,
    passed: score === null ? null : score >= threshold,
    summary,
    details: details.slice(0, 25),
  };
}

export function verifyNumericFidelity(claims: ManuscriptClaim[], tables: RunTables) {
  let matched = 0;
  let mismatched = 0;
  let notFound = 0;
  let flipped = 0;
  const details: string[] = [];
  const evaluated: { claim: ManuscriptClaim; row: ExpressionRecord | null; ok: boolean }[] = [];

  for (const c of claims) {
    const rows = tables.bySymbol.get(c.symbol.toUpperCase());
    if (!rows || rows.length === 0) {
      notFound++;
      details.push(`L${c.line}: '${c.symbol}' reported (log2FC ${c.log2fc}) but not present in expression table`);
      evaluated.push({ claim: c, row: null, ok: false });
      continue;
    }
    let best: { row: ExpressionRecord; ok: boolean; flipped: boolean; why: string[] } | null = null;
    for (const r of rows) {
      const why: string[] = [];
      let ok = true;
      let isFlipped = false;
      if (c.log2fc !== undefined) {
        const st = log2fcStatus(c.log2fc, r.log2fc);
        if (st === "flipped") {
          ok = false;
          isFlipped = true;
          why.push(`log2FC sign flipped (${c.log2fc} vs ${r.log2fc?.toFixed(3)})`);
        } else if (st === "mismatch") {
          ok = false;
          why.push(`log2FC ${c.log2fc} vs ${r.log2fc?.toFixed(3)}`);
        }
      }
      if (c.p) {
        const pm = pValueMatches(c.p.raw, c.p.cmp, r.p);
        if (pm === false) {
          ok = false;
          why.push(`p ${c.p.cmp}${c.p.raw} vs ${r.p?.toExponential(2)}`);
        }
      }
      if (c.q) {
        const qm = pValueMatches(c.q.raw, c.q.cmp, r.q);
        if (qm === false) {
          ok = false;
          why.push(`q ${c.q.cmp}${c.q.raw} vs ${r.q?.toExponential(2)}`);
        }
      }
      if (!best || (ok && !best.ok) || (!ok && !best.ok && why.length < best.why.length)) {
        best = { row: r, ok, flipped: isFlipped, why };
      }
      if (ok) break;
    }
    if (best!.ok) {
      matched++;
    } else {
      mismatched++;
      if (best!.flipped) flipped++;
      details.push(`L${c.line}: ${c.symbol} — ${best!.why.join("; ")}`);
    }
    evaluated.push({ claim: c, row: best!.row, ok: best!.ok });
  }

  const total = matched + mismatched + notFound;
  const score = total === 0 ? null : matched / total;
  return {
    result: result(
      score,
      total === 0
        ? "No verifiable protein-level quantitative claims (gene + log2FC) were found in the manuscript."
        : `${matched}/${total} quantitative claims match the expression table (${mismatched} mismatched, ${notFound} not found).`,
      details,
      0.95
    ),
    stats: { matched, mismatched, notFound, flipped, total },
    evaluated,
  };
}

const UP_WORDS = /(increas|elevat|up-?regulat|higher|accumulat|\brose\b|\brise[sn]?\b|induc|gain|enrich(?:ed)? in)/i;
const DOWN_WORDS = /(decreas|reduc|down-?regulat|lower|deplet|\bfell\b|\bfall[s]?\b|loss|declin|suppress|repress)/i;

export function verifyDirectionConsistency(
  manuscript: string,
  tables: RunTables,
  flippedNumeric: number
): VerifierResult {
  const text = normalizeText(manuscript);
  const lines = text.split(/\r?\n/);
  let checked = 0;
  let errors = flippedNumeric;
  checked += flippedNumeric;
  const details: string[] = [];
  if (flippedNumeric > 0) details.push(`${flippedNumeric} numeric log2FC value(s) reported with the wrong sign`);

  // Prose direction words following a clearly regulated protein symbol
  lines.forEach((line, idx) => {
    if (/^\s*\|/.test(line) || /^\s*#/.test(line)) return;
    const re = /\b([A-Z][A-Z0-9-]{1,11})\b/g;
    const hits: { sym: string; start: number; end: number }[] = [];
    let m: RegExpExecArray | null;
    while ((m = re.exec(line))) {
      if (tables.bySymbol.has(m[1])) hits.push({ sym: m[1], start: m.index, end: re.lastIndex });
    }
    hits.forEach((h, k) => {
      const stop = Math.min(h.end + 60, k + 1 < hits.length ? hits[k + 1].start : line.length);
      const window = line.slice(h.end, stop);
      // Ignore enumerations ("PSMC1, PSMC4 and ...") which have no own predicate
      if (/^[\s,;:()]*$/.test(window)) return;
      const up = UP_WORDS.test(window);
      const down = DOWN_WORDS.test(window);
      if (up === down) return;
      const rows = tables.bySymbol.get(h.sym)!;
      const clear = rows.find((r) => r.log2fc !== null && Math.abs(r.log2fc) >= 0.38 && r.q !== null && r.q <= 0.05);
      if (!clear) return;
      checked++;
      if ((up && clear.log2fc! < 0) || (down && clear.log2fc! > 0)) {
        errors++;
        details.push(`L${idx + 1}: ${h.sym} described as ${up ? "increased" : "decreased"} but log2FC = ${clear.log2fc!.toFixed(3)}`);
      }
    });
  });

  // Enrichment tables in the manuscript: sign of the reported enrichment score
  const annIndex = new Map<string, number>();
  for (const e of tables.enrichment) {
    if (e.annotation && e.enrichment !== null) annIndex.set(e.annotation.toLowerCase(), e.enrichment);
  }
  for (let i = 0; i < lines.length - 1; i++) {
    if (!/^\s*\|/.test(lines[i]) || !/^\s*\|?\s*:?-{2,}/.test(lines[i + 1])) continue;
    const header = splitRow(lines[i]).map((h) => h.toLowerCase());
    const scoreIdx = header.findIndex((h) => /enrichment|score|^es$|nes/.test(h) && !/q|p-?val|size/.test(h));
    if (scoreIdx < 0) continue;
    for (let j = i + 2; j < lines.length && /^\s*\|/.test(lines[j]); j++) {
      const cells = splitRow(lines[j]);
      const ann = cells.map((c) => c.toLowerCase()).find((c) => annIndex.has(c));
      if (!ann) continue;
      const m = (cells[scoreIdx] || "").match(new RegExp(NUM_RE));
      if (!m) continue;
      const v = parseNum(m[0]);
      const truth = annIndex.get(ann)!;
      if (Math.abs(truth) < 1e-9 || Math.abs(v) < 1e-9) continue;
      checked++;
      if (Math.sign(v) !== Math.sign(truth)) {
        errors++;
        details.push(`L${j + 1}: enrichment '${ann}' reported ${v} but table enrichment = ${truth.toFixed(4)} (sign error)`);
      }
    }
  }

  const score = checked === 0 ? null : 1 - errors / checked;
  return {
    ...result(score, checked === 0 ? "No directional claims could be checked." : `${checked - errors}/${checked} directional claims consistent with the data (${errors} errors).`, details, 1),
    // expose error count via details length; consumers use stats below
  };
}

export function countDirectionErrors(r: VerifierResult): number {
  return r.details.filter((d) => /sign|described as/.test(d)).reduce((acc, d) => {
    const m = d.match(/^(\d+) numeric/);
    return acc + (m ? Number(m[1]) : 1);
  }, 0);
}

const HEDGE = /(not|non)[\s-]*significan|nominal|tier\s*[23]|exploratory|trend|did not (?:reach|pass)|fail(?:ed)? to reach|relaxed|sub-?threshold|marginal|suggestive/i;

export function verifySignificanceHonesty(manuscript: string, tables: RunTables): { result: VerifierResult; overclaims: number } {
  const text = normalizeText(manuscript);
  const sentences = text.split(/(?<=[.!?])\s+|\n/);
  let overclaims = 0;
  let checked = 0;
  const details: string[] = [];
  for (const s of sentences) {
    if (!/significan/i.test(s) || /^\s*\|/.test(s)) continue;
    if (HEDGE.test(s)) continue;
    const syms = Array.from(new Set((s.match(/\b[A-Z][A-Z0-9-]{1,11}\b/g) || []).filter((t) => tables.bySymbol.has(t))));
    for (const sym of syms) {
      const rows = tables.bySymbol.get(sym)!;
      const minQ = Math.min(...rows.map((r) => (r.q === null ? Infinity : r.q)));
      if (!Number.isFinite(minQ)) continue;
      checked++;
      if (minQ > 0.05) {
        overclaims++;
        details.push(`${sym} called significant without hedging but q = ${minQ.toExponential(2)}: "${s.trim().slice(0, 140)}"`);
      }
    }
  }
  const score = 1 - Math.min(1, overclaims * 0.2);
  return {
    result: result(score, `${overclaims} unhedged significance overclaim(s) among ${checked} checked protein mentions.`, details, 0.8),
    overclaims,
  };
}

export function verifyCountConsistency(manuscript: string, tables: RunTables): VerifierResult {
  const firstFile = tables.expressionFiles[0];
  const rows = tables.expression.filter((r) => r.contrastFile === firstFile);
  if (rows.length === 0) return result(null, "No expression table available to verify counts.");
  const text = normalizeText(manuscript);

  const tiers = [
    { fc: 1.0, q: 0.05, useP: false },
    { fc: 0.38, q: 0.05, useP: false },
    { fc: 0, q: 0.05, useP: true },
    { fc: 1.0, q: 0.05, useP: true },
  ];
  const ups = new Set<number>();
  const downs = new Set<number>();
  const totals = new Set<number>();
  for (const t of tiers) {
    const sig = rows.filter((r) => r.log2fc !== null && Math.abs(r.log2fc) >= t.fc && ((t.useP ? r.p : r.q) ?? 1) <= t.q);
    const u = sig.filter((r) => r.log2fc! > 0).length;
    const d = sig.filter((r) => r.log2fc! < 0).length;
    ups.add(u);
    downs.add(d);
    totals.add(u + d);
  }
  const nTotal = new Set(rows.map((r) => r.protein || r.gene)).size;

  const details: string[] = [];
  let checked = 1;
  let ok = 0;
  const totalRe = new RegExp(`\\b${nTotal.toLocaleString("en-US").replace(/,/g, ",?")}\\b`);
  if (totalRe.test(text)) ok++;
  else details.push(`Total quantified proteins (${nTotal}) is never reported.`);

  const check = (re: RegExp, allowed: Set<number>, label: string) => {
    let m: RegExpExecArray | null;
    re.lastIndex = 0;
    while ((m = re.exec(text))) {
      const v = parseNum(m[1]);
      if (!Number.isFinite(v) || v === nTotal) continue;
      checked++;
      if (allowed.has(v)) ok++;
      else details.push(`'${m[0].trim()}' — ${label} count ${v} not consistent with any threshold tier (${Array.from(allowed).join("/")})`);
    }
  };
  check(/\b(\d[\d,]*)\s+(?:proteins?\s+)?(?:were\s+|are\s+)?(?:significantly\s+)?(?:higher|increased|up-?regulated|elevated)\b/gi, ups, "up");
  check(/\b(\d[\d,]*)\s+(?:proteins?\s+)?(?:were\s+|are\s+)?(?:significantly\s+)?(?:lower|decreased|down-?regulated|reduced|depleted)\b/gi, downs, "down");
  check(/\b(\d[\d,]*)\s+(?:of\s+[\d,]+\s+)?(?:proteins?\s+)?(?:significantly\s+)?(?:altered|changed|passed|qualified|differentially\s+(?:expressed|abundant))\b/gi, totals, "total DE");

  return result(ok / checked, `${ok}/${checked} reported counts consistent with the expression table (n = ${nTotal}).`, details, 0.8);
}

export function verifyFigureIntegrity(manuscript: string, runRoot: string): { result: VerifierResult; missing: number } {
  const dataDir = path.join(runRoot, "data");
  const available = new Set(fsSync.existsSync(dataDir) ? fsSync.readdirSync(dataDir) : []);
  const refs = new Set<string>();
  const imgRe = /!\[[^\]]*\]\(([^)\s]+)\)/g;
  let m: RegExpExecArray | null;
  while ((m = imgRe.exec(manuscript))) refs.add(path.basename(m[1]));
  const pathRe = /data\/([A-Za-z0-9_.-]+\.(?:png|svg|pdf|jpg))/g;
  while ((m = pathRe.exec(manuscript))) refs.add(m[1]);

  if (refs.size === 0) return { result: result(0, "Manuscript does not embed or reference any figure files.", [], 0.9), missing: 0 };

  const missingList = Array.from(refs).filter((r) => !available.has(r));
  const refList = Array.from(refs).join(" ").toLowerCase();
  const core = [
    { k: "volcano", re: /volcano/ },
    { k: "PCA", re: /pca/ },
    { k: "CV/variation", re: /variation|_cv|cv\./ },
    { k: "enrichment", re: /enrichment/ },
  ];
  const coreMissing = core.filter((c) => !c.re.test(refList)).map((c) => c.k);
  const existFrac = (refs.size - missingList.length) / refs.size;
  const coreFrac = (core.length - coreMissing.length) / core.length;
  const details = [
    ...missingList.map((f) => `Referenced figure '${f}' does not exist in data/`),
    ...coreMissing.map((c) => `Core figure not referenced: ${c}`),
  ];
  return {
    result: result(0.7 * existFrac + 0.3 * coreFrac, `${refs.size - missingList.length}/${refs.size} referenced figures exist; ${core.length - coreMissing.length}/4 core figures referenced.`, details, 0.9),
    missing: missingList.length,
  };
}

export function verifyCitationIntegrity(manuscript: string, runRoot: string): VerifierResult {
  const pmids = new Set<string>();
  const dois = new Set<string>();
  let m: RegExpExecArray | null;
  const pmidRe = /PMID[:\s]*(\d{6,9})|pubmed\.ncbi\.nlm\.nih\.gov\/(\d{6,9})/gi;
  while ((m = pmidRe.exec(manuscript))) pmids.add(m[1] || m[2]);
  const doiRe = /\b(10\.\d{4,9}\/[^\s)\]>,;"']+)/g;
  while ((m = doiRe.exec(manuscript))) dois.add(m[1].replace(/[.]+$/, "").toLowerCase());

  const total = pmids.size + dois.size;
  if (total === 0) return result(null, "No PMIDs/DOIs cited; citation traceability not applicable.", []);

  // Evidence corpus: raw tool outputs (console logs) first, then curated docs
  const corpusParts: string[] = [];
  let source = "none";
  const logsDir = path.join(runRoot, "logs");
  if (fsSync.existsSync(logsDir)) {
    for (const d of fsSync.readdirSync(logsDir)) {
      const f = path.join(logsDir, d, "console.log");
      if (fsSync.existsSync(f)) {
        corpusParts.push(fsSync.readFileSync(f, "utf-8"));
        source = "tool logs";
      }
    }
  }
  const docsDir = path.join(runRoot, "docs");
  for (const f of ["literature.md", "websearch.md", "knowledge.md", "literature_candidates.md"]) {
    const p = path.join(docsDir, f);
    if (fsSync.existsSync(p)) {
      corpusParts.push(fsSync.readFileSync(p, "utf-8"));
      if (source === "none") source = "docs";
    }
  }
  if (corpusParts.length === 0) return result(null, `${total} citation(s) found but no tool logs or literature docs available to verify them.`, []);
  const corpus = corpusParts.join("\n").toLowerCase();

  const details: string[] = [];
  let verified = 0;
  for (const p of pmids) {
    if (corpus.includes(p)) verified++;
    else details.push(`PMID ${p} not found in any search/literature output`);
  }
  for (const d of dois) {
    if (corpus.includes(d)) verified++;
    else details.push(`DOI ${d} not found in any search/literature output`);
  }
  return result(verified / total, `${verified}/${total} citations traceable to ${source}.`, details, 0.9);
}

export function verifySectionStructure(manuscript: string): VerifierResult {
  const heads = splitSections(manuscript).map((s) => s.title.replace(/^[\d.\s]+/, "").toLowerCase());
  const required: { k: string; re: RegExp }[] = [
    { k: "Abstract", re: /^abstract|^summary/ },
    { k: "Introduction", re: /^introduction|^background/ },
    { k: "Methods", re: /methods|materials/ },
    { k: "Results", re: /^results/ },
    { k: "Discussion", re: /^discussion/ },
  ];
  const missing = required.filter((r) => !heads.some((h) => r.re.test(h))).map((r) => r.k);
  return result((required.length - missing.length) / required.length, missing.length ? `Missing section headings: ${missing.join(", ")}` : "All core section headings present.", missing.map((s) => `Missing heading: ${s}`), 0.8);
}

export function verifyMethodsReproducibility(manuscript: string, tables: RunTables): VerifierResult {
  const sec = findSection(manuscript, /methods|materials/i);
  if (!sec || sec.body.trim().length < 200) return result(0, "No substantive Methods section found.", ["Methods section missing or < 200 characters"], 0.8);
  const t = normalizeText(sec.body);
  const usedNorm = Array.from(new Set(tables.expression.map((r) => (r.normalization || "").trim().toLowerCase()).filter((x) => x && x !== "na")));
  const items: { k: string; ok: boolean }[] = [
    {
      k: usedNorm.length ? `normalization method actually used (${usedNorm.join("/")})` : "normalization method",
      ok: usedNorm.length ? usedNorm.some((n) => new RegExp(`\\b${n.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i").test(t)) : /normali[sz]/i.test(t),
    },
    { k: "imputation method", ok: /imput/i.test(t) && /(minimum|knn|random\s*forest|minprob|mindet|half|column|zero|mean|median|downshift|perseus|missforest)/i.test(t) },
    { k: "statistical test", ok: /(limma|t-?test|wilcoxon|anova|empirical\s*bayes|mann-?whitney)/i.test(t) },
    { k: "multiple-testing correction", ok: /(benjamini|hochberg|\bBH\b|\bFDR\b|q-?value|bonferroni|storey)/i.test(t) },
    { k: "numeric thresholds (fold-change and q/p)", ok: /(log2?\s*FC|fold[- ]change)[^.\n]{0,30}\d/i.test(t) && /(\bq\b|\bp\b|FDR|adj)[^.\n]{0,12}0?\.\d/i.test(t) },
    { k: "software + version", ok: /tidyproteomics[^.\n]{0,40}\d+\.\d+/i.test(t) || /\bR\s*(?:version\s*)?\d\.\d/i.test(t) },
  ];
  const missing = items.filter((i) => !i.ok).map((i) => i.k);
  return result(
    (items.length - missing.length) / items.length,
    `${items.length - missing.length}/${items.length} reproducibility items stated in Methods.`,
    missing.map((m) => `Methods does not state: ${m}`),
    0.8
  );
}

export function measureRepetition(manuscript: string): VerifierResult {
  const body = manuscript
    .split(/\r?\n/)
    .filter((l) => !/^\s*(\||#|!\[|```)/.test(l))
    .join(" ")
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter(Boolean);
  const n = 8;
  if (body.length < n * 4) return result(null, "Manuscript too short to assess repetition.");
  const counts = new Map<string, number>();
  for (let i = 0; i + n <= body.length; i++) {
    const k = body.slice(i, i + n).join(" ");
    counts.set(k, (counts.get(k) || 0) + 1);
  }
  let dup = 0;
  let total = 0;
  for (const c of counts.values()) {
    total += c;
    if (c > 1) dup += c - 1;
  }
  const ratio = dup / total;
  // score: 1.0 at 0% duplicated 8-grams, 0 at >= 40%
  return {
    ...result(Math.max(0, 1 - ratio / 0.4), `${(ratio * 100).toFixed(1)}% of 8-word shingles are repeated elsewhere in the text.`, [], 0.375),
    value: Math.round(ratio * 1000) / 1000,
  } as VerifierResult;
}

export function abstractWordCount(manuscript: string): number | null {
  const sec = findSection(manuscript, /^abstract|^summary/i);
  if (!sec) return null;
  return sec.body.split(/\s+/).filter(Boolean).length;
}

/* ------------------------------------------------------------------ */
/* Orchestration                                                       */
/* ------------------------------------------------------------------ */

export function runAllVerifiers(manuscript: string, runRoot: string, tables: RunTables): VerifierReport {
  const claims = extractClaims(manuscript, tables);
  const numeric = verifyNumericFidelity(claims, tables);
  const direction = verifyDirectionConsistency(manuscript, tables, numeric.stats.flipped);
  const sig = verifySignificanceHonesty(manuscript, tables);
  const figures = verifyFigureIntegrity(manuscript, runRoot);
  const repetition = measureRepetition(manuscript);

  return {
    numericFidelity: numeric.result,
    directionConsistency: direction,
    significanceHonesty: sig.result,
    countConsistency: verifyCountConsistency(manuscript, tables),
    figureIntegrity: figures.result,
    citationIntegrity: verifyCitationIntegrity(manuscript, runRoot),
    sectionStructure: verifySectionStructure(manuscript),
    methodsReproducibility: verifyMethodsReproducibility(manuscript, tables),
    repetition,
    stats: {
      claimsExtracted: claims.length,
      claimsMatched: numeric.stats.matched,
      claimsMismatched: numeric.stats.mismatched,
      claimsNotFound: numeric.stats.notFound,
      directionErrors: countDirectionErrors(direction),
      overclaims: sig.overclaims,
      missingFigures: figures.missing,
      repetitionRatio: (repetition as any).value ?? null,
      abstractWords: abstractWordCount(manuscript),
      expressionRows: tables.expression.length,
      enrichmentRows: tables.enrichment.length,
      wordCount: manuscript.split(/\s+/).filter(Boolean).length,
    },
  };
}

