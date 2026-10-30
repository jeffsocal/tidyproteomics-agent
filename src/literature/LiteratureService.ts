import * as fs from "fs";
import * as path from "path";
import { execFile } from "child_process";
import { LiteratureConfig, LiteratureInfo, LiteratureViewState, IngestQueueItem } from "../types";

/**
 * LiteratureService
 *
 * Manages DuckDB literature databases stored at <workspace>/literature/*.duckdb.
 * All database access is delegated to R (DBI + duckdb) via tools/literature/literature_cli.R so
 * that the extension does not need a native Node DuckDB binding and so that the
 * UI and the agent share a single code path.
 *
 * This module intentionally does NOT import "vscode" so it can be reused by
 * ContextBuilder / PipelineOrchestrator.
 */

export const LITERATURE_REL_DIR = "literature";
export const LITERATURE_CONFIG_FILE = "literature_config.json";
export const LITERATURE_EXT = ".duckdb";
export const LITERATURE_SCRIPTS_REL_DIR = path.join("tools", "literature");
const JSON_MARKER = "@@LITERATURE_JSON@@";
const LEGACY_JSON_MARKER = "@@CORPUS_JSON@@";

// Backward compatibility constants
export const CORPORA_REL_DIR = LITERATURE_REL_DIR;
export const CORPUS_CONFIG_FILE = LITERATURE_CONFIG_FILE;
export const CORPUS_EXT = LITERATURE_EXT;
export const CORPUS_SCRIPTS_REL_DIR = LITERATURE_SCRIPTS_REL_DIR;

const PDF_EXTS = new Set([".pdf"]);
const TABLE_EXTS = new Set([".csv", ".tsv", ".xlsx", ".xls"]);
const MAX_SCAN_DEPTH = 3;
const MAX_QUEUE_FILES = 500;

export function getLiteratureDir(workspaceRoot: string): string {
  return path.join(workspaceRoot, LITERATURE_REL_DIR);
}
export const getCorporaDir = getLiteratureDir;

/**
 * Checks for existing legacy .vscode/corpora/ folder and migrates it to ./literature/ if needed.
 */
function autoMigrateLegacyCorpora(workspaceRoot: string): void {
  if (!workspaceRoot) return;
  const legacyDir = path.join(workspaceRoot, ".vscode", "corpora");
  const newDir = path.join(workspaceRoot, LITERATURE_REL_DIR);
  if (fs.existsSync(legacyDir) && !fs.existsSync(newDir)) {
    try {
      fs.mkdirSync(newDir, { recursive: true });
      const entries = fs.readdirSync(legacyDir);
      for (const entry of entries) {
        const oldPath = path.join(legacyDir, entry);
        if (entry.toLowerCase().endsWith(LITERATURE_EXT)) {
          fs.copyFileSync(oldPath, path.join(newDir, entry));
        } else if (entry === "corpus_config.json") {
          try {
            const raw = fs.readFileSync(oldPath, "utf-8");
            const parsed = JSON.parse(raw);
            const active = parsed.activeLiterature || parsed.activeCorpus;
            const migrated = {
              activeLiterature: active,
              activeCorpus: active,
              useInSynthesis: !!parsed.useInSynthesis,
              updatedAt: parsed.updatedAt || new Date().toISOString(),
            };
            fs.writeFileSync(path.join(newDir, LITERATURE_CONFIG_FILE), JSON.stringify(migrated, null, 2) + "\n", "utf-8");
          } catch {}
        }
      }
    } catch (err) {
      console.warn("[LiteratureService] Auto-migration from .vscode/corpora failed:", err);
    }
  }
}

/** Synchronous, dependency-free reader used by ContextBuilder and the orchestrator. */
export function readLiteratureConfig(workspaceRoot: string): LiteratureConfig {
  const fallback: LiteratureConfig = { useInSynthesis: false };
  if (!workspaceRoot) return fallback;
  autoMigrateLegacyCorpora(workspaceRoot);
  try {
    const configPath = path.join(getLiteratureDir(workspaceRoot), LITERATURE_CONFIG_FILE);
    let raw = "";
    if (fs.existsSync(configPath)) {
      raw = fs.readFileSync(configPath, "utf-8");
    } else {
      // Legacy fallback
      const legacyPath = path.join(workspaceRoot, ".vscode", "corpora", "corpus_config.json");
      if (fs.existsSync(legacyPath)) {
        raw = fs.readFileSync(legacyPath, "utf-8");
      } else {
        return fallback;
      }
    }
    const parsed = JSON.parse(raw);
    const active =
      (typeof parsed.activeLiterature === "string" && parsed.activeLiterature) ||
      (typeof parsed.activeCorpus === "string" && parsed.activeCorpus) ||
      undefined;

    return {
      activeLiterature: active,
      activeCorpus: active,
      useInSynthesis: !!parsed.useInSynthesis,
      updatedAt: typeof parsed.updatedAt === "string" ? parsed.updatedAt : undefined,
    };
  } catch {
    return fallback;
  }
}
export const readCorpusConfig = readLiteratureConfig;

/**
 * Returns the workspace-relative path of the active literature database if it exists AND the
 * synthesis toggle is enabled; otherwise undefined.
 */
export function getActiveSynthesisLiterature(workspaceRoot: string): { relPath: string; absPath: string } | undefined {
  const cfg = readLiteratureConfig(workspaceRoot);
  const active = cfg.activeLiterature || cfg.activeCorpus;
  if (!cfg.useInSynthesis || !active) return undefined;

  const litDir = getLiteratureDir(workspaceRoot);
  let absPath = path.join(litDir, active);
  if (!fs.existsSync(absPath)) {
    // Check legacy dir
    const legacyPath = path.join(workspaceRoot, ".vscode", "corpora", active);
    if (fs.existsSync(legacyPath)) {
      absPath = legacyPath;
    } else {
      return undefined;
    }
  }
  return { relPath: path.join(LITERATURE_REL_DIR, active).replace(/\\/g, "/"), absPath };
}
export const getActiveSynthesisCorpus = getActiveSynthesisLiterature;

export function sanitizeLiteratureName(raw: string): string {
  return String(raw || "")
    .trim()
    .replace(/\.duckdb$/i, "")
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 64);
}
export const sanitizeCorpusName = sanitizeLiteratureName;

interface RResult<T = any> {
  ok: boolean;
  error?: string;
  data?: T;
  stderr?: string;
  stats?: any;
  results?: any[];
  rows?: any[];
  query?: string;
}

export class LiteratureService {
  private queue: IngestQueueItem[] = [];
  private ingestFolder?: string;
  private writeChain: Promise<unknown> = Promise.resolve();
  private cachedRscript?: string;
  private cachedStats = new Map<string, any>();

  constructor(
    private workspaceRoot: string,
    private readonly extensionPath: string,
    private readonly getRscriptOverride: () => string | undefined = () => undefined
  ) {}

  public setWorkspaceRoot(root: string) {
    if (root !== this.workspaceRoot) {
      this.workspaceRoot = root || "";
      this.queue = [];
      this.ingestFolder = undefined;
    }
  }

  public getWorkspaceRoot(): string {
    return this.workspaceRoot;
  }

  private requireRoot(): string {
    if (!this.workspaceRoot) {
      throw new Error("No active workspace directory. Open or choose an analysis folder first.");
    }
    return this.workspaceRoot;
  }

  // -------------------------------------------------------------------------
  // Literature database listing / configuration
  // -------------------------------------------------------------------------

  public listDatabases(): LiteratureInfo[] {
    if (!this.workspaceRoot) return [];
    autoMigrateLegacyCorpora(this.workspaceRoot);
    const dir = getLiteratureDir(this.workspaceRoot);
    if (!fs.existsSync(dir)) return [];
    const out: LiteratureInfo[] = [];
    for (const f of fs.readdirSync(dir)) {
      if (!f.toLowerCase().endsWith(LITERATURE_EXT)) continue;
      const abs = path.join(dir, f);
      try {
        const st = fs.statSync(abs);
        if (!st.isFile()) continue;
        out.push({
          name: f.slice(0, -LITERATURE_EXT.length),
          fileName: f,
          relPath: path.join(LITERATURE_REL_DIR, f).replace(/\\/g, "/"),
          absPath: abs,
          sizeBytes: st.size,
          modified: st.mtime.toISOString(),
        });
      } catch {
        // skip unreadable entries
      }
    }
    return out.sort((a, b) => a.name.localeCompare(b.name));
  }

  public listCorpora(): LiteratureInfo[] {
    return this.listDatabases();
  }

  public getConfig(): LiteratureConfig {
    return readLiteratureConfig(this.workspaceRoot);
  }

  private writeConfig(cfg: LiteratureConfig) {
    const dir = getLiteratureDir(this.requireRoot());
    fs.mkdirSync(dir, { recursive: true });
    const active = cfg.activeLiterature || cfg.activeCorpus;
    const payload: LiteratureConfig = {
      ...cfg,
      activeLiterature: active,
      activeCorpus: active,
      updatedAt: new Date().toISOString(),
    };
    fs.writeFileSync(path.join(dir, LITERATURE_CONFIG_FILE), JSON.stringify(payload, null, 2) + "\n", "utf-8");
  }

  public getViewState(busy?: string): LiteratureViewState {
    const databases = this.listDatabases();
    let config = this.getConfig();
    const active = config.activeLiterature || config.activeCorpus;
    // Drop a stale active pointer if the file was deleted out from under us
    if (active && !databases.some((c) => c.fileName === active)) {
      config = { ...config, activeLiterature: undefined, activeCorpus: undefined };
    }
    const activeInfo = databases.find((c) => c.fileName === active);
    const dir = this.workspaceRoot ? getLiteratureDir(this.workspaceRoot) : "";
    const stats = active ? this.cachedStats.get(path.basename(active)) : undefined;

    return {
      workspaceRoot: this.workspaceRoot,
      literatureDir: dir,
      corporaDir: dir,
      databases,
      literature: databases,
      corpora: databases,
      config,
      activeLiterature: active,
      activeCorpus: active,
      useInSynthesis: !!config.useInSynthesis,
      activeLiteratureInfo: activeInfo,
      activeCorpusInfo: activeInfo,
      ingestFolder: this.ingestFolder,
      queue: [...this.queue],
      ingestionAvailable: true,
      busy,
      isIngesting: busy === "ingesting",
      stats,
    };
  }

  public async createDatabase(rawName: string): Promise<LiteratureInfo> {
    const root = this.requireRoot();
    const name = sanitizeLiteratureName(rawName);
    if (!name) throw new Error("Literature database name must contain at least one letter or number.");
    const fileName = `${name}${LITERATURE_EXT}`;
    const dir = getLiteratureDir(root);
    fs.mkdirSync(dir, { recursive: true });
    const abs = path.join(dir, fileName);
    if (fs.existsSync(abs)) throw new Error(`A literature database named '${fileName}' already exists.`);

    const res = await this.runCli("init", [abs, rawName.trim() || name], true);
    if (!res.ok) throw new Error(res.error || "Failed to initialize literature database.");

    this.cachedStats.set(fileName, {
      study_count: 0,
      context_count: 0,
      assertion_count: 0,
      unique_symbols: 0,
      organism_count: 0,
      perturbation_count: 0,
      studies: 0,
      contexts: 0,
      assertions: 0,
      symbols: 0,
      organisms: 0,
      perturbations: 0,
    });

    this.syncWorkspaceScripts();
    const cfg = this.getConfig();
    this.writeConfig({ ...cfg, activeLiterature: fileName, activeCorpus: fileName });
    const info = this.listDatabases().find((c) => c.fileName === fileName);
    if (!info) throw new Error("Literature database was initialized but could not be found on disk.");
    return info;
  }

  public async createCorpus(rawName: string): Promise<LiteratureInfo> {
    return this.createDatabase(rawName);
  }

  public setActiveLiterature(fileName: string | undefined) {
    const root = this.requireRoot();
    if (fileName) {
      const abs = path.join(getLiteratureDir(root), path.basename(fileName));
      if (!fs.existsSync(abs)) throw new Error(`Literature database '${fileName}' not found in ${LITERATURE_REL_DIR}.`);
    }
    const cfg = this.getConfig();
    const base = fileName ? path.basename(fileName) : undefined;
    this.writeConfig({ ...cfg, activeLiterature: base, activeCorpus: base });
    this.syncWorkspaceScripts();
  }

  public setActiveCorpus(fileName: string | undefined) {
    this.setActiveLiterature(fileName);
  }

  public setUseInSynthesis(enabled: boolean) {
    const cfg = this.getConfig();
    this.writeConfig({ ...cfg, useInSynthesis: !!enabled });
    if (enabled) this.syncWorkspaceScripts();
  }

  /** Ensures the active literature schema is current (idempotent). */
  public async ensureSchema(fileName: string): Promise<void> {
    const abs = this.resolveLiteraturePath(fileName);
    const res = await this.runCli("init", [abs], true);
    if (!res.ok) throw new Error(res.error || "Failed to migrate literature schema.");
  }

  public async getStats(fileName?: string): Promise<RResult> {
    const cfg = this.getConfig();
    const target = fileName || cfg.activeLiterature || cfg.activeCorpus;
    if (!target) return { ok: false, error: "No active literature database selected." };
    const res = await this.runCli("stats", [this.resolveLiteraturePath(target)], false);
    if (res.ok && res.data) {
      const raw = res.data.totals || res.data.stats || res.data;
      const normalizedStats = {
        study_count: Number(raw.study_count ?? raw.studies ?? 0),
        context_count: Number(raw.context_count ?? raw.contexts ?? 0),
        assertion_count: Number(raw.assertion_count ?? raw.assertions ?? 0),
        unique_symbols: Number(raw.unique_symbols ?? raw.symbols ?? 0),
        organism_count: Number(raw.organism_count ?? raw.organisms ?? 0),
        perturbation_count: Number(raw.perturbation_count ?? raw.perturbations ?? 0),
        studies: Number(raw.studies ?? raw.study_count ?? 0),
        contexts: Number(raw.contexts ?? raw.context_count ?? 0),
        assertions: Number(raw.assertions ?? raw.assertion_count ?? 0),
        symbols: Number(raw.symbols ?? raw.unique_symbols ?? 0),
        organisms: Number(raw.organisms ?? raw.organism_count ?? 0),
        perturbations: Number(raw.perturbations ?? raw.perturbation_count ?? 0),
      };
      this.cachedStats.set(path.basename(target), normalizedStats);
      return {
        ...res,
        stats: normalizedStats,
        data: {
          ...res.data,
          stats: normalizedStats,
          totals: {
            ...(res.data.totals || {}),
            ...normalizedStats,
          },
        },
      };
    }
    return res;
  }

  public async search(query: string, limit = 50, fileName?: string): Promise<RResult> {
    const cfg = this.getConfig();
    const target = fileName || cfg.activeLiterature || cfg.activeCorpus;
    if (!target) return { ok: false, error: "No active literature database selected." };
    const q = String(query || "").trim();
    if (!q) return { ok: false, error: "Enter a protein symbol, alias, functional module, or perturbation." };
    const res = await this.runCli("search", [this.resolveLiteraturePath(target), q, String(limit)], false);
    if (res.ok && res.data) {
      const rows = res.data.rows || res.data.results || [];
      return {
        ...res,
        results: rows,
        rows,
        query: q,
        data: {
          ...res.data,
          rows,
          results: rows,
        },
      };
    }
    return res;
  }

  public async generateReport(fileName?: string, outputRelativePath = "docs/literature_database.md"): Promise<RResult> {
    const cfg = this.getConfig();
    const target = fileName || cfg.activeLiterature || cfg.activeCorpus;
    if (!target) return { ok: false, error: "No active literature database selected." };
    const dbPath = this.resolveLiteraturePath(target);
    const outPath = path.isAbsolute(outputRelativePath)
      ? outputRelativePath
      : path.join(this.requireRoot(), outputRelativePath);
    return await this.runCli("report", [dbPath, outPath], true);
  }

  private resolveLiteraturePath(fileName: string): string {
    const base = path.basename(fileName);
    const withExt = base.toLowerCase().endsWith(LITERATURE_EXT) ? base : `${base}${LITERATURE_EXT}`;
    const primary = path.join(getLiteratureDir(this.requireRoot()), withExt);
    if (fs.existsSync(primary)) return primary;
    if (this.workspaceRoot) {
      const legacy = path.join(this.workspaceRoot, ".vscode", "corpora", withExt);
      if (fs.existsSync(legacy)) return legacy;
    }
    return primary;
  }

  // -------------------------------------------------------------------------
  // Ingestion queue (discovery only; processing is handled by the ingestion runner)
  // -------------------------------------------------------------------------

  public scanIngestFolder(folder: string): IngestQueueItem[] {
    if (!folder || !fs.existsSync(folder) || !fs.statSync(folder).isDirectory()) {
      throw new Error(`Folder not found: ${folder}`);
    }
    const existingByPath = new Map(this.queue.map((item) => [item.absPath, item]));
    const found: IngestQueueItem[] = [];
    const walk = (dir: string, depth: number) => {
      if (depth > MAX_SCAN_DEPTH || found.length >= MAX_QUEUE_FILES) return;
      let entries: fs.Dirent[] = [];
      try {
        entries = fs.readdirSync(dir, { withFileTypes: true });
      } catch {
        return;
      }
      entries.sort((a, b) => a.name.localeCompare(b.name));
      for (const e of entries) {
        if (e.name.startsWith(".") || e.name.startsWith("~$")) continue;
        const abs = path.join(dir, e.name);
        if (e.isDirectory()) {
          walk(abs, depth + 1);
          continue;
        }
        const ext = path.extname(e.name).toLowerCase();
        const kind = PDF_EXTS.has(ext) ? "pdf" : TABLE_EXTS.has(ext) ? "table" : undefined;
        if (!kind) continue;
        let size = 0;
        try {
          size = fs.statSync(abs).size;
        } catch {}
        const prev = existingByPath.get(abs);
        found.push({
          id: prev?.id || `q_${Date.now()}_${found.length + 1}`,
          fileName: e.name,
          absPath: abs,
          relPath: path.relative(folder, abs).replace(/\\/g, "/"),
          kind,
          sizeBytes: size,
          stage: prev?.stage === "indexed" ? "indexed" : "queued",
          message: prev?.stage === "indexed" ? prev.message : undefined,
        });
        if (found.length >= MAX_QUEUE_FILES) return;
      }
    };
    walk(folder, 0);
    this.ingestFolder = folder;
    this.queue = found;
    return [...found];
  }

  /**
   * Enqueues only the specified imported file paths without rescanning the entire
   * target directory on disk. Completed items ('indexed'/'skipped'/'failed') from
   * a previous ingestion batch are pruned when new files are imported, while any
   * still-pending ('queued') items in the current batch are preserved.
   */
  public enqueueFiles(filePaths: string[], baseDir?: string): IngestQueueItem[] {
    const pendingQueue = this.queue.filter(
      (item) =>
        item.stage === "queued" ||
        item.stage === "parsing_pdf" ||
        item.stage === "llm_extraction" ||
        item.stage === "normalization"
    );
    const byPath = new Map<string, IngestQueueItem>(pendingQueue.map((item) => [item.absPath, item]));

    let seq = 1;
    for (const rawPath of filePaths) {
      if (!rawPath || !fs.existsSync(rawPath)) continue;
      let st: fs.Stats;
      try {
        st = fs.statSync(rawPath);
        if (!st.isFile()) continue;
      } catch {
        continue;
      }
      const fileName = path.basename(rawPath);
      const ext = path.extname(fileName).toLowerCase();
      const kind = PDF_EXTS.has(ext) ? "pdf" : TABLE_EXTS.has(ext) ? "table" : undefined;
      if (!kind) continue;

      const folder = baseDir || path.dirname(rawPath);
      const existing = byPath.get(rawPath);
      if (existing) {
        existing.sizeBytes = st.size;
        existing.stage = "queued";
        existing.message = undefined;
      } else {
        byPath.set(rawPath, {
          id: `q_${Date.now()}_${seq++}`,
          fileName,
          absPath: rawPath,
          relPath: path.relative(folder, rawPath).replace(/\\/g, "/"),
          kind,
          sizeBytes: st.size,
          stage: "queued",
        });
      }
    }

    if (baseDir) {
      this.ingestFolder = baseDir;
    }
    this.queue = Array.from(byPath.values()).slice(0, MAX_QUEUE_FILES);
    return [...this.queue];
  }

  public clearQueue() {
    this.queue = [];
    this.ingestFolder = undefined;
  }

  public updateQueueItem(id: string, patch: Partial<IngestQueueItem>) {
    const item = this.queue.find((q) => q.id === id);
    if (item) Object.assign(item, patch);
  }

  // -------------------------------------------------------------------------
  // R plumbing
  // -------------------------------------------------------------------------

  /** Copies tools/literature/*.R from extension templates into the workspace so phases can call them. */
  public syncWorkspaceScripts(): void {
    if (!this.workspaceRoot) return;
    const srcDir = this.findTemplateScriptsDir();
    if (!srcDir) return;
    const destDir = path.join(this.workspaceRoot, LITERATURE_SCRIPTS_REL_DIR);
    try {
      fs.mkdirSync(destDir, { recursive: true });
      for (const f of fs.readdirSync(srcDir)) {
        if (f.endsWith(".R")) fs.copyFileSync(path.join(srcDir, f), path.join(destDir, f));
      }
    } catch (err) {
      console.warn("[LiteratureService] Could not sync literature scripts into workspace:", err);
    }
  }

  private findTemplateScriptsDir(): string | undefined {
    const candidates = [
      path.join(this.extensionPath, "templates", "shared", "tools", "literature"),
      path.join(this.extensionPath, "extension", "templates", "shared", "tools", "literature"),
      path.join(__dirname, "..", "templates", "shared", "tools", "literature"),
      path.join(__dirname, "..", "..", "templates", "shared", "tools", "literature"),
      // Fallback to legacy
      path.join(this.extensionPath, "templates", "shared", "tools", "corpus"),
      path.join(this.extensionPath, "extension", "templates", "shared", "tools", "corpus"),
      path.join(__dirname, "..", "templates", "shared", "tools", "corpus"),
      path.join(__dirname, "..", "..", "templates", "shared", "tools", "corpus"),
    ];
    return candidates.find((p) => fs.existsSync(path.join(p, "literature_cli.R")) || fs.existsSync(path.join(p, "corpus_cli.R")));
  }

  private findCliScript(): string {
    const tplDir = this.findTemplateScriptsDir();
    if (tplDir) {
      const lit = path.join(tplDir, "literature_cli.R");
      if (fs.existsSync(lit)) return lit;
      const corp = path.join(tplDir, "corpus_cli.R");
      if (fs.existsSync(corp)) return corp;
    }
    if (this.workspaceRoot) {
      const wsLit = path.join(this.workspaceRoot, LITERATURE_SCRIPTS_REL_DIR, "literature_cli.R");
      if (fs.existsSync(wsLit)) return wsLit;
      const wsCorp = path.join(this.workspaceRoot, "tools", "corpus", "corpus_cli.R");
      if (fs.existsSync(wsCorp)) return wsCorp;
    }
    throw new Error("literature_cli.R not found in extension templates or workspace tools/literature/.");
  }

  /**
   * Resolves an Rscript binary. VS Code launched from the macOS Dock often has a
   * minimal PATH, so common install locations are probed explicitly.
   */
  public resolveRscript(): string {
    const override = (this.getRscriptOverride() || "").trim();
    if (override) return override;
    if (this.cachedRscript) return this.cachedRscript;
    const candidates = [
      "/usr/local/bin/Rscript",
      "/opt/homebrew/bin/Rscript",
      "/Library/Frameworks/R.framework/Resources/bin/Rscript",
      "/usr/bin/Rscript",
    ];
    const pathDirs = (process.env.PATH || "").split(path.delimiter).filter(Boolean);
    const exe = process.platform === "win32" ? "Rscript.exe" : "Rscript";
    for (const d of pathDirs) candidates.unshift(path.join(d, exe));
    const hit = candidates.find((c) => {
      try {
        return fs.statSync(c).isFile();
      } catch {
        return false;
      }
    });
    this.cachedRscript = hit || "Rscript";
    return this.cachedRscript;
  }

  /**
   * Runs literature_cli.R. Operations are queued sequentially through writeChain
   * because DuckDB limits concurrent multi-process access to a single file.
   */
  private runCli(cmd: string, args: string[], _isWrite = true, timeoutMs = 120000): Promise<RResult> {
    const exec = () => this.execR(this.findCliScript(), [cmd, ...args], timeoutMs);
    const next = this.writeChain.then(exec, exec);
    this.writeChain = next.catch(() => undefined);
    return next;
  }

  private execR(script: string, args: string[], timeoutMs: number): Promise<RResult> {
    return new Promise((resolve) => {
      let rscript: string;
      try {
        rscript = this.resolveRscript();
      } catch (e: any) {
        resolve({ ok: false, error: e.message });
        return;
      }
      execFile(
        rscript,
        [script, ...args],
        { cwd: this.workspaceRoot || undefined, timeout: timeoutMs, maxBuffer: 20 * 1024 * 1024 },
        (error, stdout, stderr) => {
          const lines = String(stdout || "").split(/\r?\n/);
          const line = lines.find((l) => l.startsWith(JSON_MARKER) || l.startsWith(LEGACY_JSON_MARKER));
          if (line) {
            try {
              const marker = line.startsWith(JSON_MARKER) ? JSON_MARKER : LEGACY_JSON_MARKER;
              const payload = JSON.parse(line.slice(marker.length));
              if (payload && payload.ok) {
                resolve({ ok: true, data: payload, stderr: String(stderr || "") });
              } else {
                resolve({ ok: false, error: payload?.error || "Unknown R error", stderr: String(stderr || "") });
              }
              return;
            } catch (parseErr: any) {
              resolve({ ok: false, error: `Could not parse R output: ${parseErr.message}`, stderr: String(stderr || "") });
              return;
            }
          }
          const errCode = (error as any)?.code;
          let msg: string;
          if (errCode === "ENOENT") {
            msg = `Rscript not found ('${rscript}'). Install R or set 'tidyproteomicsagent.rscriptPath' in Settings.`;
          } else if ((error as any)?.killed) {
            msg = `R process timed out after ${Math.round(timeoutMs / 1000)}s.`;
          } else {
            const tail = String(stderr || error?.message || "").trim().split(/\r?\n/).slice(-6).join("\n");
            msg = tail || "R process exited without output.";
          }
          resolve({ ok: false, error: msg, stderr: String(stderr || "") });
        }
      );
    });
  }
}

export { LiteratureService as KnowledgeCorpusService };
