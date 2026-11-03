import express from "express";
import * as http from "http";
import * as path from "path";
import * as fs from "fs";
import * as fsPromises from "fs/promises";
import * as os from "os";
import { spawn } from "child_process";
import { WebSocketServer, WebSocket } from "ws";
import { configStore, AppConfig } from "./config/ConfigStore";
import { ProviderClient } from "./llm/ProviderClient";
import { ToolRegistry } from "./tools/ToolRegistry";
import { ExecutionManager } from "./agent/providers/ExecutionManager";
import { PipelineOrchestrator } from "./orchestrator/PipelineOrchestrator";
import { writeActiveModelSummaryFile } from "./orchestrator/ModelSummaryWriter";
import { AgentService } from "./agent/AgentService";
import { LiteratureService } from "./literature/LiteratureService";
import { IngestionRunner } from "./literature/IngestionRunner";
import { FollowonPhaseService } from "./agent/FollowonPhaseService";
import { PerformanceReviewService } from "./agent/PerformanceReviewService";
import { EvaluationService } from "./evaluation/EvaluationService";
import { TierOptimizer } from "./evaluation/TierOptimizer";
import { LLMConfig, PipelineId, PipelineState } from "./types";

export interface FileTreeNode {
  name: string;
  relPath: string;
  type: "file" | "directory";
  sizeBytes?: number;
  modifiedAt?: string;
  children?: FileTreeNode[];
}

const APP_ROOT = path.resolve(__dirname, "..");
const VERSION = "1.0.0";

async function startServer() {
  const app = express();
  app.use(express.json({ limit: "50mb" }));
  app.use(express.urlencoded({ limit: "50mb", extended: true }));

  const server = http.createServer(app);
  const wss = new WebSocketServer({ server, path: "/ws" });
  wss.on("error", () => {
    // Handled by server.on("error")
  });

  const clients = new Set<WebSocket>();
  const broadcast = (payload: Record<string, any>) => {
    const str = JSON.stringify(payload);
    for (const ws of clients) {
      if (ws.readyState === WebSocket.OPEN) {
        try {
          ws.send(str);
        } catch (_) { }
      }
    }
  };

  let logBuffer: string[] = [];
  const appendLog = (text: string, updateLast = false) => {
    console.log(text);
    if (updateLast && logBuffer.length > 0) {
      logBuffer[logBuffer.length - 1] = text;
    } else {
      logBuffer.push(text);
      if (logBuffer.length > 500) {
        logBuffer = logBuffer.slice(-500);
      }
    }
    broadcast({ type: "log", text, updateLast });
  };

  const cfg = configStore.getAll();
  let workspaceRoot = cfg.workspaceRoot;

  const llmConfig: LLMConfig = {
    provider: cfg.provider,
    model: cfg.model,
    apiKey: cfg.apiKey,
    baseUrl: cfg.baseUrl,
    maxTokens: cfg.maxTokens,
    timeoutSeconds: cfg.timeoutSeconds,
    multiModelEnabled: cfg.multiModelEnabled,
    tierUtility: cfg.tierUtility,
    tierToolRunner: cfg.tierToolRunner,
    tierReasoner: cfg.tierReasoner,
    phaseModels: cfg.phaseModels,
  };

  const client = new ProviderClient(llmConfig);
  const followonPhaseService = new FollowonPhaseService(client);
  const performanceReviewService = new PerformanceReviewService(client);
  const evaluationService = new EvaluationService(client, configStore, APP_ROOT);
  const tools = new ToolRegistry(workspaceRoot);
  const executionManager = new ExecutionManager(workspaceRoot, tools);
  const literatureService = new LiteratureService(
    workspaceRoot,
    APP_ROOT,
    () => configStore.get("rscriptPath") || undefined
  );

  let agentService: AgentService;
  const orchestrator = new PipelineOrchestrator(
    workspaceRoot,
    client,
    tools,
    async (state: PipelineState) => {
      broadcast({ type: "stateUpdate", state });
      broadcastExperimentSpec().catch(() => { });
      broadcastFileTree().catch(() => { });
    },
    (log, updateLast) => appendLog(log, updateLast),
    VERSION,
    (phase, text) => agentService?.handleStageActivity(phase, text),
    (phase, text, meta) => agentService?.handleStageObservation(phase, text, meta),
    (phase) => {
      agentService?.handlePhaseStarted(phase);
      evaluationService.handlePhaseStarted(phase);
    },
    (phase) => {
      agentService?.handlePhaseCompleted(phase);
      evaluationService.handlePhaseCompleted(phase);
    },
    (state) => agentService?.handlePipelineFinished(state),
    (phase, reason) => {
      agentService?.handlePhaseHalted(phase);
    }
  );

  const ingestionRunner = new IngestionRunner(
    literatureService,
    client,
    APP_ROOT,
    (ev) => {
      broadcast({
        type: "literatureState",
        state: literatureService.getViewState(ingestionRunner.getIsRunning() ? "ingesting" : undefined),
        event: ev,
      });
    },
    (log, updateLast) => appendLog(log, updateLast)
  );

  const broadcastLiteratureState = (extra?: any) => {
    broadcast({
      type: "literatureState",
      state: literatureService.getViewState(ingestionRunner.getIsRunning() ? "ingesting" : undefined),
      ...extra,
    });
  };

  evaluationService.setProgressCallback((suite) => {
    broadcast({ type: "evaluationProgress", suite });
  });

  agentService = new AgentService(
    workspaceRoot,
    client,
    async () => orchestrator.getState(),
    async (phaseId?: string) => {
      if (orchestrator.isBusy()) return;
      await syncModelSummary();
      if (phaseId) {
        orchestrator.resumePipeline(phaseId).catch((err) => appendLog(`[Error] ${err.message}`));
      } else {
        orchestrator.resumePipeline().catch((err) => appendLog(`[Error] ${err.message}`));
      }
    },
    () => {
      broadcast({
        type: "agentState",
        isGenerating: agentService.isRunning(),
        messages: agentService.getMessages(),
        activeSessionId: agentService.getActiveSessionId(),
      });
      broadcastExperimentSpec().catch(() => { });
    },
    APP_ROOT,
    async (fromPhaseId?: string) => {
      if (orchestrator.isBusy()) return;
      await syncModelSummary();
      await orchestrator.resumePipeline(fromPhaseId);
    },
    async () => {
      await orchestrator.stop();
    },
    async () => {
      if (orchestrator.isBusy()) return;
      await syncModelSummary();
      await orchestrator.restartPipeline();
    }
  );

  agentService.setStatusProvider(async () => {
    return {
      config: configStore.getAll(),
      mcpStatus: executionManager.getStatus(),
      literatureState: literatureService.getViewState(ingestionRunner.getIsRunning() ? "ingesting" : undefined),
      pipelineState: await orchestrator.getState(),
      experimentSpec: await agentService.getExperimentManager().readSpec(),
    };
  });

  async function syncModelSummary() {
    if (!workspaceRoot) return;
    try {
      await writeActiveModelSummaryFile(workspaceRoot, client.getConfig(), VERSION, "mcp");
    } catch (_) { }
  }

  // Initialize MCP connection in background
  if (workspaceRoot) {
    executionManager
      .initialize()
      .then(() => {
        broadcast({ type: "mcpStatus", status: executionManager.getStatus() });
      })
      .catch(() => { });
    syncModelSummary().catch(() => { });
  }

  async function buildWorkspaceFileTree(rootDir: string): Promise<FileTreeNode[]> {
    if (!rootDir || !fs.existsSync(rootDir)) return [];
    const ignored = new Set(["node_modules", ".git", ".DS_Store", "__pycache__", ".venv"]);

    async function walk(currentDir: string, depth: number): Promise<FileTreeNode[]> {
      if (depth > 4) return [];
      let entries: fs.Dirent[] = [];
      try {
        entries = await fsPromises.readdir(currentDir, { withFileTypes: true });
      } catch {
        return [];
      }

      const nodes: FileTreeNode[] = [];
      for (const ent of entries) {
        if (ignored.has(ent.name)) continue;
        if (ent.name.startsWith(".") && ent.name !== ".gitignore") continue;

        const fullPath = path.join(currentDir, ent.name);
        const relPath = path.relative(rootDir, fullPath).replace(/\\/g, "/");

        if (ent.isDirectory()) {
          const children = await walk(fullPath, depth + 1);
          nodes.push({
            name: ent.name,
            relPath,
            type: "directory",
            children,
          });
        } else if (ent.isFile()) {
          let sizeBytes = 0;
          let modifiedAt = "";
          try {
            const st = await fsPromises.stat(fullPath);
            sizeBytes = st.size;
            modifiedAt = st.mtime.toISOString();
          } catch (_) { }
          nodes.push({
            name: ent.name,
            relPath,
            type: "file",
            sizeBytes,
            modifiedAt,
          });
        }
      }

      // Sort directories first (prioritizing docs, analysis, data, code, logs, agent), then files alphabetically
      const dirPriority: Record<string, number> = {
        docs: 1,
        analysis: 2,
        data: 3,
        code: 4,
        logs: 5,
        agent: 6,
        tools: 7,
        literature: 8,
      };
      nodes.sort((a, b) => {
        if (a.type !== b.type) return a.type === "directory" ? -1 : 1;
        if (a.type === "directory") {
          const pa = dirPriority[a.name] || 99;
          const pb = dirPriority[b.name] || 99;
          if (pa !== pb) return pa - pb;
        }
        return a.name.localeCompare(b.name, undefined, { numeric: true });
      });
      return nodes;
    }

    return walk(rootDir, 0);
  }

  async function broadcastFileTree() {
    if (!workspaceRoot) return;
    const fileTree = await buildWorkspaceFileTree(workspaceRoot);
    broadcast({ type: "fileTreeUpdate", fileTree });
  }

  async function broadcastExperimentSpec() {
    if (!workspaceRoot) return;
    try {
      const expMgr = agentService.getExperimentManager();
      const spec = await expMgr.readSpec();
      const expPath = expMgr.getExperimentPath();
      const raw = fs.existsSync(expPath) ? await fsPromises.readFile(expPath, "utf-8") : "";
      broadcast({ type: "experimentUpdate", spec, raw });
    } catch (_) { }
  }

  // Lightweight periodic fs watcher for external file edits
  let watchTimer: NodeJS.Timeout | null = null;
  let lastNotesMtime = 0;
  let lastExpMtime = 0;
  setInterval(async () => {
    if (!workspaceRoot || !fs.existsSync(workspaceRoot)) return;
    try {
      const notesPath = path.join(workspaceRoot, "docs", "notes.md");
      if (fs.existsSync(notesPath)) {
        const st = fs.statSync(notesPath);
        if (st.mtimeMs !== lastNotesMtime) {
          lastNotesMtime = st.mtimeMs;
          if (!orchestrator.getIsRunning()) {
            await orchestrator.rescanPhases(true);
          }
        }
      }
      const expPath = path.join(workspaceRoot, "docs", "experiment.md");
      if (fs.existsSync(expPath)) {
        const st = fs.statSync(expPath);
        if (st.mtimeMs !== lastExpMtime) {
          lastExpMtime = st.mtimeMs;
          await broadcastExperimentSpec();
        }
      }
    } catch (_) { }
  }, 2500);

  async function switchWorkspace(newRoot: string): Promise<void> {
    if (!newRoot) return;
    if (!fs.existsSync(newRoot)) {
      fs.mkdirSync(newRoot, { recursive: true });
    }
    const realRoot = fs.realpathSync(newRoot);
    workspaceRoot = realRoot;
    configStore.update({ workspaceRoot: realRoot });

    tools.setWorkspaceRoot(realRoot);
    literatureService.setWorkspaceRoot(realRoot);
    agentService.setWorkspaceRoot(realRoot);
    executionManager.setWorkspaceRoot(realRoot);
    await orchestrator.setWorkingDirectory(realRoot);
    await syncModelSummary();

    executionManager
      .initialize()
      .then(() => {
        broadcast({ type: "mcpStatus", status: executionManager.getStatus() });
      })
      .catch(() => { });

    const state = await orchestrator.getState();
    const fileTree = await buildWorkspaceFileTree(realRoot);
    const expMgr = agentService.getExperimentManager();
    const spec = await expMgr.readSpec();
    const expPath = expMgr.getExperimentPath();
    const raw = fs.existsSync(expPath) ? await fsPromises.readFile(expPath, "utf-8") : "";
    const sessions = await agentService.listSessions();

    broadcast({
      type: "workspaceSwitched",
      workspaceRoot: realRoot,
      config: configStore.getAll(),
      state,
      fileTree,
      experimentSpec: spec,
      experimentRaw: raw,
    });
    broadcast({
      type: "agentState",
      isGenerating: agentService.isRunning(),
      messages: agentService.getMessages(),
      activeSessionId: agentService.getActiveSessionId(),
    });
    broadcast({
      type: "chatSessionsUpdate",
      sessions,
      activeSessionId: agentService.getActiveSessionId(),
    });
    broadcastLiteratureState();
  }

  async function initializeWorkspaceWithPipeline(
    targetRoot: string,
    pipelineId: PipelineId = "differential_expression"
  ): Promise<boolean> {
    if (!targetRoot) return false;
    if (!fs.existsSync(targetRoot)) {
      fs.mkdirSync(targetRoot, { recursive: true });
    }

    const templateBase = path.join(APP_ROOT, "templates");
    if (!fs.existsSync(templateBase)) {
      throw new Error(`Templates directory not found at ${templateBase}`);
    }

    const standardDirs = ["analysis", "agent", "code", "data", path.join("data", "raw"), "docs", "reference", "logs", "tools", "literature"];
    for (const d of standardDirs) {
      const fullDir = path.join(targetRoot, d);
      if (!fs.existsSync(fullDir)) {
        fs.mkdirSync(fullDir, { recursive: true });
      }
    }

    const copyFileSafe = (src: string, dest: string, overwrite = false) => {
      if (fs.existsSync(src)) {
        if (overwrite || !fs.existsSync(dest)) {
          fs.mkdirSync(path.dirname(dest), { recursive: true });
          fs.copyFileSync(src, dest);
        }
      }
    };

    const sharedDir = path.join(templateBase, "shared");
    if (fs.existsSync(sharedDir)) {
      copyFileSafe(path.join(sharedDir, "tools", "lint_tidyproteomics.R"), path.join(targetRoot, "tools", "lint_tidyproteomics.R"), true);
      copyFileSafe(path.join(sharedDir, "tools", "reactome_pathways.tsv"), path.join(targetRoot, "tools", "reactome_pathways.tsv"), true);
      const agentTemplatesDir = path.join(sharedDir, "agent");
      if (fs.existsSync(agentTemplatesDir)) {
        for (const af of fs.readdirSync(agentTemplatesDir)) {
          if (af.endsWith(".md")) {
            copyFileSafe(path.join(agentTemplatesDir, af), path.join(targetRoot, "agent", af), true);
          }
        }
      }
      const docsTemplatesDir = path.join(sharedDir, "docs");
      if (fs.existsSync(docsTemplatesDir)) {
        for (const df of fs.readdirSync(docsTemplatesDir)) {
          if (df.endsWith(".md")) {
            copyFileSafe(path.join(docsTemplatesDir, df), path.join(targetRoot, "docs", df), false);
          }
        }
      }
      const referenceTemplatesDir = path.join(sharedDir, "reference");
      if (fs.existsSync(referenceTemplatesDir)) {
        for (const rf of fs.readdirSync(referenceTemplatesDir)) {
          if (rf.endsWith(".md")) {
            copyFileSafe(path.join(referenceTemplatesDir, rf), path.join(targetRoot, "reference", rf), true);
          }
        }
      }
      copyFileSafe(path.join(sharedDir, ".gitignore"), path.join(targetRoot, ".gitignore"), false);
      copyFileSafe(path.join(sharedDir, "logs", ".gitkeep"), path.join(targetRoot, "logs", ".gitkeep"), false);
      copyFileSafe(path.join(sharedDir, "data", "raw", ".gitkeep"), path.join(targetRoot, "data", "raw", ".gitkeep"), false);

      const literatureToolsDir = path.join(sharedDir, "tools", "literature");
      if (fs.existsSync(literatureToolsDir)) {
        for (const lf of fs.readdirSync(literatureToolsDir).filter((f) => f.endsWith(".R"))) {
          copyFileSafe(path.join(literatureToolsDir, lf), path.join(targetRoot, "tools", "literature", lf), true);
        }
      }
    }

    let pipelineDir = path.join(templateBase, "pipelines", pipelineId);
    if (!fs.existsSync(pipelineDir)) {
      pipelineDir = path.join(templateBase, "pipelines", "differential_expression");
    }
    if (fs.existsSync(pipelineDir)) {
      // Clear old analysis/*.md files when re-initializing
      const analysisOut = path.join(targetRoot, "analysis");
      if (fs.existsSync(analysisOut)) {
        for (const f of fs.readdirSync(analysisOut)) {
          if (f.endsWith(".md")) {
            try {
              fs.unlinkSync(path.join(analysisOut, f));
            } catch (_) { }
          }
        }
      }
      for (const pf of fs.readdirSync(pipelineDir).filter((f) => f.endsWith(".md"))) {
        copyFileSafe(path.join(pipelineDir, pf), path.join(targetRoot, "analysis", pf), true);
      }
    }

    await switchWorkspace(targetRoot);
    return true;
  }

  // ============================================================================
  // REST API ROUTES
  // ============================================================================

  // 1. Full initial bootstrap state
  app.get("/api/state", async (_req, res) => {
    try {
      const pipelineState = await orchestrator.getState();
      const fileTree = await buildWorkspaceFileTree(workspaceRoot);
      const expMgr = agentService.getExperimentManager();
      const experimentSpec = await expMgr.readSpec();
      const expPath = expMgr.getExperimentPath();
      const experimentRaw = fs.existsSync(expPath) ? await fsPromises.readFile(expPath, "utf-8") : "";

      res.json({
        ok: true,
        config: configStore.getAll(),
        pipelineState,
        isBenchmarkRunning: evaluationService.getActiveSuite()?.status === "running",
        activeBenchmarkSuite: evaluationService.getActiveSuite(),
        mcpStatus: executionManager.getStatus(),
        literatureState: literatureService.getViewState(ingestionRunner.getIsRunning() ? "ingesting" : undefined),
        agentState: {
          isGenerating: agentService.isRunning(),
          messages: agentService.getMessages(),
          activeSessionId: agentService.getActiveSessionId(),
        },
        chatSessions: await agentService.listSessions(),
        experimentSpec,
        experimentRaw,
        fileTree,
        logs: logBuffer.slice(-200),
      });
    } catch (err: any) {
      res.status(500).json({ ok: false, error: err.message });
    }
  });

  // 2. Update configuration (Provider, Model, API Key, MCP, Search, etc.)
  app.post("/api/config", async (req, res) => {
    try {
      const patch: Partial<AppConfig> = req.body || {};
      const updated = configStore.update(patch);

      client.updateConfig({
        provider: updated.provider,
        model: updated.model,
        apiKey: updated.apiKey,
        baseUrl: updated.baseUrl,
        maxTokens: updated.maxTokens,
        timeoutSeconds: updated.timeoutSeconds,
        multiModelEnabled: updated.multiModelEnabled,
        tierUtility: updated.tierUtility,
        tierToolRunner: updated.tierToolRunner,
        tierReasoner: updated.tierReasoner,
        phaseModels: updated.phaseModels,
      });

      let latestState: any = undefined;
      if (patch.workspaceRoot && patch.workspaceRoot !== workspaceRoot) {
        await switchWorkspace(patch.workspaceRoot);
      } else {
        await syncModelSummary();
        await orchestrator.rescanPhases(true);
        latestState = await orchestrator.getState();
        broadcast({ type: "stateUpdate", state: latestState });
      }

      if (patch.mcpMode || patch.mcpServerPath || patch.dockerImage) {
        executionManager.initialize().then(() => {
          broadcast({ type: "mcpStatus", status: executionManager.getStatus() });
        });
      }

      res.json({ ok: true, config: updated, mcpStatus: executionManager.getStatus(), state: latestState });
    } catch (err: any) {
      res.status(500).json({ ok: false, error: err.message });
    }
  });

  // 3. Browse directories on host/container filesystem for workspace picker
  app.get("/api/workspace/browse", async (req, res) => {
    try {
      const requestedDir = String(req.query.dir || workspaceRoot || os.homedir()).trim();
      const resolvedDir = path.resolve(requestedDir);
      if (!fs.existsSync(resolvedDir) || !fs.statSync(resolvedDir).isDirectory()) {
        return res.status(400).json({ ok: false, error: `Directory does not exist: ${resolvedDir}` });
      }

      const entries = await fsPromises.readdir(resolvedDir, { withFileTypes: true });
      const folders = entries
        .filter((e) => e.isDirectory() && !e.name.startsWith("."))
        .map((e) => ({
          name: e.name,
          fullPath: path.join(resolvedDir, e.name),
          hasPipeline: fs.existsSync(path.join(resolvedDir, e.name, "analysis")),
        }))
        .sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));

      res.json({
        ok: true,
        currentDir: resolvedDir,
        parentDir: path.dirname(resolvedDir),
        folders,
      });
    } catch (err: any) {
      res.status(500).json({ ok: false, error: err.message });
    }
  });

  // 4. Switch or create workspace directory
  app.post("/api/workspace/select", async (req, res) => {
    try {
      const targetPath = String(req.body?.workspaceRoot || "").trim();
      if (!targetPath) {
        return res.status(400).json({ ok: false, error: "workspaceRoot is required" });
      }
      await switchWorkspace(targetPath);
      res.json({ ok: true, workspaceRoot });
    } catch (err: any) {
      res.status(500).json({ ok: false, error: err.message });
    }
  });

  // 5. Initialize workspace with pipeline template
  app.post("/api/workspace/init", async (req, res) => {
    try {
      const targetRoot = String(req.body?.workspaceRoot || workspaceRoot).trim();
      const validPipelines: PipelineId[] = [
        "differential_expression",
        "rapid_expression",
        "quality_control_only",
        "multi_cohort_merge",
        "biological_synthesis",
        "peptide_analysis",
      ];
      const reqPipelineId = req.body?.pipelineId as PipelineId;
      const pipelineId: PipelineId = validPipelines.includes(reqPipelineId)
        ? reqPipelineId
        : "differential_expression";
      if (!targetRoot) {
        return res.status(400).json({ ok: false, error: "No workspace directory selected." });
      }
      await initializeWorkspaceWithPipeline(targetRoot, pipelineId);
      const state = await orchestrator.getState();
      const fileTree = await buildWorkspaceFileTree(workspaceRoot);
      res.json({ ok: true, workspaceRoot, state, fileTree });
    } catch (err: any) {
      res.status(500).json({ ok: false, error: err.message });
    }
  });

  // 6. Get file tree
  app.get("/api/workspace/tree", async (_req, res) => {
    try {
      const fileTree = await buildWorkspaceFileTree(workspaceRoot);
      res.json({ ok: true, fileTree });
    } catch (err: any) {
      res.status(500).json({ ok: false, error: err.message });
    }
  });

  // 7. Read a workspace file (text/markdown/code/tsv)
  app.get("/api/workspace/file", async (req, res) => {
    try {
      const relPath = String(req.query.path || "").trim();
      if (!relPath || !workspaceRoot) {
        return res.status(400).json({ ok: false, error: "File path is required" });
      }
      const fullPath = path.isAbsolute(relPath) ? relPath : path.resolve(workspaceRoot, relPath);
      if (!fs.existsSync(fullPath) || !fs.statSync(fullPath).isFile()) {
        return res.status(404).json({ ok: false, error: `File not found: ${relPath}` });
      }

      const ext = path.extname(fullPath).toLowerCase();
      const isImage = [".png", ".jpg", ".jpeg", ".svg", ".gif", ".webp"].includes(ext);
      const isBinary = [".rds", ".duckdb", ".xlsx", ".pdf", ".zip"].includes(ext);
      const stat = fs.statSync(fullPath);

      if (isImage || isBinary) {
        return res.json({
          ok: true,
          relPath: path.relative(workspaceRoot, fullPath).replace(/\\/g, "/"),
          isImage,
          isBinary,
          sizeBytes: stat.size,
          rawUrl: `/api/workspace/raw?path=${encodeURIComponent(path.relative(workspaceRoot, fullPath))}&t=${stat.mtimeMs}`,
        });
      }

      // Limit text reading to 2MB for safety in browser viewer
      const maxReadBytes = 2 * 1024 * 1024;
      let content = "";
      let truncated = false;
      if (stat.size > maxReadBytes) {
        const fd = fs.openSync(fullPath, "r");
        const buf = Buffer.alloc(maxReadBytes);
        fs.readSync(fd, buf, 0, maxReadBytes, 0);
        fs.closeSync(fd);
        content = buf.toString("utf-8");
        truncated = true;
      } else {
        content = await fsPromises.readFile(fullPath, "utf-8");
      }

      res.json({
        ok: true,
        relPath: path.relative(workspaceRoot, fullPath).replace(/\\/g, "/"),
        isImage: false,
        isBinary: false,
        sizeBytes: stat.size,
        truncated,
        content,
      });
    } catch (err: any) {
      res.status(500).json({ ok: false, error: err.message });
    }
  });

  // 7b. Serve built-in application documentation & scientific guides
  app.get("/api/docs/:guideId", async (req, res) => {
    try {
      const { guideId } = req.params;
      const cleanId = String(guideId || "").toLowerCase();

      let targetFile = "";
      let title = "";

      if (cleanId === "operations" || cleanId === "operations_guide" || cleanId === "readme_operations" || cleanId === "howto" || cleanId === "guides") {
        const candidates = [
          workspaceRoot ? path.join(workspaceRoot, "reference", "operations.md") : "",
          path.join(APP_ROOT, "reference", "operations.md"),
          path.join(APP_ROOT, "templates", "shared", "reference", "operations.md"),
        ].filter(Boolean);
        targetFile = candidates.find((f) => fs.existsSync(f)) || candidates[0];
        title = "Operations Guide & Application Manual";
      } else if (cleanId === "scientific" || cleanId === "scientific_guide" || cleanId === "readme_scientific") {
        const candidates = [
          workspaceRoot ? path.join(workspaceRoot, "reference", "scientific.md") : "",
          path.join(APP_ROOT, "reference", "scientific.md"),
          path.join(APP_ROOT, "templates", "shared", "reference", "scientific.md"),
        ].filter(Boolean);
        targetFile = candidates.find((f) => fs.existsSync(f)) || candidates[0];
        title = "Scientific Guide: Quantitative Analysis & Methodology";
      } else {
        return res.status(404).json({ ok: false, error: `Unknown documentation guide '${guideId}'` });
      }

      if (!fs.existsSync(targetFile)) {
        return res.status(404).json({ ok: false, error: `Guide file not found on server at ${targetFile}` });
      }

      const content = fs.readFileSync(targetFile, "utf-8");
      const stat = fs.statSync(targetFile);

      return res.json({
        ok: true,
        guideId: cleanId.startsWith("sci") ? "scientific" : "operations",
        title,
        content,
        sizeBytes: stat.size,
        lastModified: stat.mtime.toISOString(),
      });
    } catch (err: any) {
      return res.status(500).json({ ok: false, error: err.message || "Failed to load documentation" });
    }
  });

  // 8. Serve raw file (for embedded images in Markdown, Plot tabs, and downloads)
  app.get("/api/workspace/raw", (req, res) => {
    try {
      const relPath = String(req.query.path || "").trim();
      if (!relPath || !workspaceRoot) {
        return res.status(400).send("Path required");
      }
      const fullPath = path.isAbsolute(relPath) ? relPath : path.resolve(workspaceRoot, relPath);
      if (!fs.existsSync(fullPath) || !fs.statSync(fullPath).isFile()) {
        return res.status(404).send("File not found");
      }
      res.sendFile(fullPath);
    } catch (err: any) {
      res.status(500).send(err.message);
    }
  });

  // 8.B Plotly JSON endpoint (disabled - plotly plot creation dropped)
  app.get("/api/workspace/plot/plotly", async (_req, res) => {
    return res.status(404).json({ ok: false, error: "Plotly plot generation disabled" });
  });

  // 9. Write/Save a workspace file
  app.post("/api/workspace/file", async (req, res) => {
    try {
      const relPath = String(req.body?.path || "").trim();
      const content = String(req.body?.content ?? "");
      if (!relPath || !workspaceRoot) {
        return res.status(400).json({ ok: false, error: "File path is required" });
      }
      const fullPath = path.isAbsolute(relPath) ? relPath : path.resolve(workspaceRoot, relPath);
      await fsPromises.mkdir(path.dirname(fullPath), { recursive: true });
      await fsPromises.writeFile(fullPath, content, "utf-8");

      if (relPath.endsWith("experiment.md")) {
        await broadcastExperimentSpec();
      }
      if (relPath.startsWith("analysis/") || relPath.endsWith("notes.md")) {
        await orchestrator.rescanPhases(true);
      }
      await broadcastFileTree();
      res.json({ ok: true });
    } catch (err: any) {
      res.status(500).json({ ok: false, error: err.message });
    }
  });

  // 10. Structured Experiment Form API (get & update docs/experiment.md)
  app.get("/api/experiment", async (_req, res) => {
    try {
      const expMgr = agentService.getExperimentManager();
      const spec = await expMgr.readSpec();
      const expPath = expMgr.getExperimentPath();
      const raw = fs.existsSync(expPath) ? await fsPromises.readFile(expPath, "utf-8") : "";
      res.json({ ok: true, spec, raw });
    } catch (err: any) {
      res.status(500).json({ ok: false, error: err.message });
    }
  });

  app.post("/api/experiment", async (req, res) => {
    try {
      const expMgr = agentService.getExperimentManager();
      const { spec, raw } = await expMgr.updateFromForm(req.body || {});
      broadcast({ type: "experimentUpdate", spec, raw });
      res.json({ ok: true, spec, raw });
    } catch (err: any) {
      res.status(500).json({ ok: false, error: err.message });
    }
  });

  app.post("/api/experiment/confirm", async (req, res) => {
    try {
      const expMgr = agentService.getExperimentManager();
      const contrasts = Array.isArray(req.body?.contrasts) ? req.body.contrasts : undefined;
      const resumePhaseId = req.body?.phaseId;
      const confirmedContrasts = await expMgr.confirmContrastAndAuthorizeConfounding(contrasts);
      await broadcastExperimentSpec();

      // Record user confirmation in agent stream so pending checkpoints transition to neutral grey
      const detail = confirmedContrasts && confirmedContrasts.length > 0
        ? `Confirmed target contrasts (${confirmedContrasts.join(", ")}) & authorized study design parameters in docs/experiment.md`
        : "Confirmed study design & parameters in docs/experiment.md";
      agentService.addUserMessage(detail);

      if (orchestrator.isBusy()) {
        return res.status(409).json({ ok: false, error: "A pipeline or phase is currently running or stopping. Please wait or stop it first." });
      }
      await syncModelSummary();
      if (resumePhaseId) {
        orchestrator.resumePipeline(String(resumePhaseId)).catch((err) => appendLog(`[Error] ${err.message}`));
      } else {
        orchestrator.resumePipeline().catch((err) => appendLog(`[Error] ${err.message}`));
      }

      res.json({ ok: true, confirmedContrasts });
    } catch (err: any) {
      res.status(500).json({ ok: false, error: err.message });
    }
  });

  // 11. Pipeline Execution Controls
  app.post("/api/pipeline/start", async (_req, res) => {
    try {
      if (evaluationService.getActiveSuite()?.status === "running") {
        return res.status(409).json({ ok: false, error: "Cannot start pipeline: AI Evaluation benchmark is actively running." });
      }
      if (orchestrator.isBusy()) {
        return res.status(409).json({ ok: false, error: "A pipeline or phase is already running or stopping. Please wait or stop it first." });
      }
      await syncModelSummary();
      orchestrator.runFullPipeline(false).catch((err) => appendLog(`[Pipeline Error] ${err.message}`));
      res.json({ ok: true });
    } catch (err: any) {
      res.status(500).json({ ok: false, error: err.message });
    }
  });

  app.post("/api/pipeline/restart", async (_req, res) => {
    try {
      if (evaluationService.getActiveSuite()?.status === "running") {
        return res.status(409).json({ ok: false, error: "Cannot restart pipeline: AI Evaluation benchmark is actively running." });
      }
      if (orchestrator.isBusy()) {
        return res.status(409).json({ ok: false, error: "A pipeline or phase is already running or stopping. Please wait or stop it first." });
      }
      await syncModelSummary();
      orchestrator.restartPipeline().catch((err) => appendLog(`[Pipeline Error] ${err.message}`));
      res.json({ ok: true });
    } catch (err: any) {
      res.status(500).json({ ok: false, error: err.message });
    }
  });

  app.post("/api/pipeline/resume", async (req, res) => {
    try {
      if (evaluationService.getActiveSuite()?.status === "running") {
        return res.status(409).json({ ok: false, error: "Cannot resume pipeline: AI Evaluation benchmark is actively running." });
      }
      if (orchestrator.isBusy()) {
        return res.status(409).json({ ok: false, error: "A pipeline or phase is already running or stopping. Please wait or stop it first." });
      }
      const phaseId = req.body?.phaseId ? String(req.body.phaseId) : undefined;
      await syncModelSummary();
      orchestrator.resumePipeline(phaseId).catch((err) => appendLog(`[Pipeline Error] ${err.message}`));
      res.json({ ok: true });
    } catch (err: any) {
      res.status(500).json({ ok: false, error: err.message });
    }
  });

  app.post("/api/pipeline/run-phase", async (req, res) => {
    try {
      if (evaluationService.getActiveSuite()?.status === "running") {
        return res.status(409).json({ ok: false, error: "Cannot run phase: AI Evaluation benchmark is actively running." });
      }
      if (orchestrator.isBusy()) {
        return res.status(409).json({ ok: false, error: "A pipeline or phase is already running or stopping. Please wait or stop it first." });
      }
      const phaseId = String(req.body?.phaseId || "").trim();
      if (!phaseId) return res.status(400).json({ ok: false, error: "phaseId required" });
      await syncModelSummary();
      orchestrator.runSinglePhase(phaseId).catch((err) => appendLog(`[Phase Error] ${err.message}`));
      res.json({ ok: true });
    } catch (err: any) {
      res.status(500).json({ ok: false, error: err.message });
    }
  });

  app.post("/api/pipeline/continue-phase", async (req, res) => {
    try {
      if (evaluationService.getActiveSuite()?.status === "running") {
        return res.status(409).json({ ok: false, error: "Cannot continue phase: AI Evaluation benchmark is actively running." });
      }
      if (orchestrator.isBusy()) {
        return res.status(409).json({ ok: false, error: "A pipeline or phase is already running or stopping. Please wait or stop it first." });
      }
      const phaseId = String(req.body?.phaseId || "").trim();
      const additionalTurns = Number(req.body?.additionalTurns || 10);
      if (!phaseId) return res.status(400).json({ ok: false, error: "phaseId required" });
      await syncModelSummary();
      orchestrator.continuePhase(phaseId, additionalTurns).catch((err) => appendLog(`[Phase Continuation Error] ${err.message}`));
      res.json({ ok: true });
    } catch (err: any) {
      res.status(500).json({ ok: false, error: err.message });
    }
  });

  app.post("/api/pipeline/phase-turns", async (req, res) => {
    try {
      const phaseId = String(req.body?.phaseId || "").trim();
      const maxTurns = Number(req.body?.maxTurns || 30);
      if (!phaseId) return res.status(400).json({ ok: false, error: "phaseId required" });
      orchestrator.setPhaseMaxTurns(phaseId, maxTurns);
      res.json({ ok: true });
    } catch (err: any) {
      res.status(500).json({ ok: false, error: err.message });
    }
  });

  app.post("/api/pipeline/stop", async (_req, res) => {
    try {
      await orchestrator.stop();
      res.json({ ok: true });
    } catch (err: any) {
      res.status(500).json({ ok: false, error: err.message });
    }
  });

  app.post("/api/pipeline/toggle-phase", async (req, res) => {
    const phaseId = String(req.body?.phaseId || "");
    const enabled = Boolean(req.body?.enabled);
    orchestrator.togglePhase(phaseId, enabled);
    res.json({ ok: true });
  });

  app.post("/api/pipeline/reset", async (_req, res) => {
    try {
      if (evaluationService.getActiveSuite()?.status === "running") {
        return res.status(409).json({ ok: false, error: "Cannot reset pipeline: AI Evaluation benchmark is actively running." });
      }
      await orchestrator.resetAllState();
      res.json({ ok: true });
    } catch (err: any) {
      res.status(500).json({ ok: false, error: err.message });
    }
  });

  // 11.B Follow-on Analysis Phase Generation & Customization
  app.get("/api/pipeline/followon/info", async (_req, res) => {
    try {
      const phaseInfo = await followonPhaseService.getNextPhaseInfo(workspaceRoot);
      const manuscriptInfo = await followonPhaseService.getManuscriptRevisionInfo(workspaceRoot);
      res.json({ ok: true, phaseInfo, manuscriptInfo });
    } catch (err: any) {
      res.status(500).json({ ok: false, error: err.message });
    }
  });

  app.post("/api/pipeline/followon/draft", async (req, res) => {
    try {
      const description = String(req.body?.description || "").trim();
      if (!description && !req.body?.feedback) {
        return res.status(400).json({ ok: false, error: "Description or feedback is required" });
      }
      const existingMarkdown = req.body?.existingMarkdown ? String(req.body.existingMarkdown) : undefined;
      const feedback = req.body?.feedback ? String(req.body.feedback) : undefined;
      const suggestedFileName = req.body?.suggestedFileName ? String(req.body.suggestedFileName) : undefined;
      const manuscriptOption = (req.body?.manuscriptOption as any) || (req.body?.updateManuscript === false ? "none" : "append");

      const draft = await followonPhaseService.generateDraft({
        description,
        existingMarkdown,
        feedback,
        suggestedFileName,
        manuscriptOption,
        workspaceRoot,
      });

      if (draft.tokenUsage && draft.model) {
        const role = draft.role || "reasoner";
        const clientCfg = client.forRole(role).getConfig();
        orchestrator.recordAuxiliaryUsage(
          role,
          draft.model,
          clientCfg.provider,
          draft.tokenUsage
        );
      }

      res.json({ ok: true, draft });
    } catch (err: any) {
      console.error("[Followon Draft Error]", err);
      res.status(500).json({ ok: false, error: err.message });
    }
  });

  app.post("/api/pipeline/followon/save", async (req, res) => {
    try {
      const fileName = String(req.body?.fileName || "").trim();
      const content = String(req.body?.content || "").trim();
      const runNow = Boolean(req.body?.runNow);
      const manuscriptOption = (req.body?.manuscriptOption as any) || "none";

      if (!fileName || !content) {
        return res.status(400).json({ ok: false, error: "fileName and content are required" });
      }

      const saveResult = await followonPhaseService.savePhase(workspaceRoot, fileName, content, manuscriptOption);
      await orchestrator.rescanPhases(true);

      const match = fileName.match(/^([0-9]+[a-zA-Z]?)/);
      const phaseId = match ? match[1] : undefined;

      if (runNow && phaseId) {
        await syncModelSummary();
        orchestrator.runSinglePhase(phaseId).catch((err) => appendLog(`[Phase Error] ${err.message}`));
      }

      broadcastFileTree().catch(() => { });

      res.json({ ok: true, fileName, phaseId, runStarted: runNow });
    } catch (err: any) {
      console.error("[Followon Save Error]", err);
      res.status(500).json({ ok: false, error: err.message });
    }
  });

  // 11.C Performance Review System & Autonomous Log Audit
  app.get("/api/performance-review/status", async (_req, res) => {
    try {
      const status = await performanceReviewService.getReviewStatus(workspaceRoot);
      res.json({ ok: true, status });
    } catch (err: any) {
      res.status(500).json({ ok: false, error: err.message });
    }
  });

  app.get("/api/performance-review/content", async (_req, res) => {
    try {
      const content = await performanceReviewService.getExistingReview(workspaceRoot);
      const status = await performanceReviewService.getReviewStatus(workspaceRoot);
      res.json({ ok: true, content, status });
    } catch (err: any) {
      res.status(500).json({ ok: false, error: err.message });
    }
  });

  app.post("/api/performance-review/generate", async (req, res) => {
    try {
      const customFocus = req.body?.customFocus ? String(req.body.customFocus).trim() : undefined;
      appendLog(`[Performance Review] Initiating autonomous audit across pipeline logs with Tier-3 Reasoner...`);

      const result = await performanceReviewService.generateReview({
        workspaceRoot,
        customFocus,
      });

      if (result.ok && result.tokenUsage && result.model) {
        const role = result.role || "reasoner";
        const clientCfg = client.forRole(role).getConfig();
        orchestrator.recordAuxiliaryUsage(
          role,
          result.model,
          clientCfg.provider,
          result.tokenUsage
        );
      }

      if (result.ok) {
        appendLog(`[Performance Review] Successfully generated audit report -> docs/report_performance_review.md`);
      } else {
        appendLog(`[Performance Review Error] ${result.error || "Generation failed"}`);
      }

      broadcastFileTree().catch(() => { });
      res.json(result);
    } catch (err: any) {
      console.error("[Performance Review Generate Error]", err);
      appendLog(`[Performance Review Error] ${err.message}`);
      res.status(500).json({ ok: false, error: err.message });
    }
  });

  app.post("/api/performance-review/save", async (req, res) => {
    try {
      const content = String(req.body?.content || "").trim();
      if (!content) {
        return res.status(400).json({ ok: false, error: "Content is required" });
      }
      const docsTarget = path.join(workspaceRoot, "docs", "report_performance_review.md");
      const logsTarget = path.join(workspaceRoot, "logs", "report_performance_review.md");
      await fsPromises.mkdir(path.dirname(docsTarget), { recursive: true });
      await fsPromises.writeFile(docsTarget, content, "utf-8");
      await fsPromises.mkdir(path.dirname(logsTarget), { recursive: true });
      await fsPromises.writeFile(logsTarget, content, "utf-8");
      broadcastFileTree().catch(() => { });
      res.json({ ok: true, filePath: "docs/report_performance_review.md" });
    } catch (err: any) {
      res.status(500).json({ ok: false, error: err.message });
    }
  });

  // 11.D AI Evaluation & Headless Benchmark Studio
  app.get("/api/evaluation/models", (req, res) => {
    try {
      const provider = req.query.provider ? String(req.query.provider) : undefined;
      const models = evaluationService.getAvailableModels(provider);
      const defaultReviewers = evaluationService.getDefaultReviewers(provider);
      res.json({ ok: true, models, defaultReviewers });
    } catch (err: any) {
      res.status(500).json({ ok: false, error: err.message });
    }
  });

  app.get("/api/evaluation/experiments", async (_req, res) => {
    try {
      const experiments = await evaluationService.getPredefinedExperiments(workspaceRoot, APP_ROOT);
      res.json({ ok: true, experiments });
    } catch (err: any) {
      res.status(500).json({ ok: false, error: err.message });
    }
  });

  app.post("/api/evaluation/experiments/import-current", async (req, res) => {
    try {
      const customTitle = req.body?.title ? String(req.body.title).trim() : undefined;
      const imported = await evaluationService.importCurrentWorkspaceExperiment(workspaceRoot, customTitle);
      const experiments = await evaluationService.getPredefinedExperiments(workspaceRoot, APP_ROOT);
      res.json({ ok: true, imported, experiments });
    } catch (err: any) {
      res.status(500).json({ ok: false, error: err.message });
    }
  });

  app.post("/api/evaluation/experiments/save", async (req, res) => {
    try {
      const fileName = String(req.body?.fileName || "").trim();
      const content = String(req.body?.content || "").trim();
      if (!fileName || !content) {
        return res.status(400).json({ ok: false, error: "fileName and content are required" });
      }
      const saved = await evaluationService.savePredefinedExperiment(workspaceRoot, fileName, content);
      const experiments = await evaluationService.getPredefinedExperiments(workspaceRoot, APP_ROOT);
      res.json({ ok: true, saved, experiments });
    } catch (err: any) {
      res.status(500).json({ ok: false, error: err.message });
    }
  });

  app.get("/api/evaluation/benchmarks", async (_req, res) => {
    try {
      const suites = await evaluationService.getBenchmarkSuites(workspaceRoot);
      const activeSuite = evaluationService.getActiveSuite();
      res.json({ ok: true, suites, activeSuite });
    } catch (err: any) {
      res.status(500).json({ ok: false, error: err.message });
    }
  });

  app.post("/api/evaluation/start", async (req, res) => {
    try {
      const { provider, models, modelMaxTokens, iterations, experimentPath, predefinedExperimentId, reviewerModels, reviewers } = req.body || {};
      if (!provider || !models || !Array.isArray(models) || models.length === 0) {
        return res.status(400).json({ ok: false, error: "Provider and at least one model are required." });
      }
      appendLog(`[AI Evaluation] Starting headless multi-model benchmark suite for ${models.length} models (${iterations || 1} iterations)...`);

      const suite = await evaluationService.startBenchmarkSuite(
        workspaceRoot,
        {
          provider,
          models,
          modelMaxTokens,
          iterations: Number(iterations) || 1,
          experimentPath,
          predefinedExperimentId,
          reviewerModels,
          reviewers,
        },
        orchestrator,
        agentService
      );

      res.json({ ok: true, suite });
    } catch (err: any) {
      console.error("[Evaluation Start Error]", err);
      appendLog(`[AI Evaluation Error] ${err.message}`);
      res.status(500).json({ ok: false, error: err.message });
    }
  });

  app.post("/api/evaluation/cancel", (_req, res) => {
    try {
      evaluationService.cancelBenchmark(orchestrator);
      orchestrator.stop();
      appendLog(`[AI Evaluation] Benchmark suite cancellation requested.`);
      res.json({ ok: true });
    } catch (err: any) {
      res.status(500).json({ ok: false, error: err.message });
    }
  });

  app.post("/api/evaluation/queue/add", (req, res) => {
    try {
      const { models, modelMaxTokens } = req.body || {};
      if (!models || !Array.isArray(models) || models.length === 0) {
        return res.status(400).json({ ok: false, error: "models array is required" });
      }
      const result = evaluationService.enqueueModels(models, modelMaxTokens);
      appendLog(`[AI Evaluation] Enqueued ${models.length} model(s) to benchmark queue: ${models.join(", ")}`);
      res.json(result);
    } catch (err: any) {
      res.status(400).json({ ok: false, error: err.message });
    }
  });

  app.post("/api/evaluation/queue/remove", (req, res) => {
    try {
      const { model } = req.body || {};
      if (!model) {
        return res.status(400).json({ ok: false, error: "model is required" });
      }
      const result = evaluationService.dequeueModel(model);
      appendLog(`[AI Evaluation] Removed model '${model}' from benchmark queue.`);
      res.json(result);
    } catch (err: any) {
      res.status(400).json({ ok: false, error: err.message });
    }
  });

  app.post("/api/evaluation/runs/delete", async (req, res) => {
    try {
      const { runId } = req.body || {};
      if (!runId) {
        return res.status(400).json({ ok: false, error: "runId is required." });
      }
      appendLog(`[AI Evaluation] Deleting evaluation run '${runId}'...`);
      const suite = await evaluationService.deleteRun(workspaceRoot, runId);
      res.json({ ok: true, suite });
    } catch (err: any) {
      res.status(500).json({ ok: false, error: err.message });
    }
  });

  app.get("/api/evaluation/baseline", async (_req, res) => {
    try {
      const baseline = await evaluationService.scoreCurrentWorkspaceRun(workspaceRoot, orchestrator);
      res.json({ ok: true, baseline });
    } catch (err: any) {
      res.status(500).json({ ok: false, error: err.message });
    }
  });

  app.post("/api/evaluation/score-current", async (req, res) => {
    try {
      const { reviewerModels, useLLM } = req.body || {};
      appendLog(`[AI Evaluation] Scoring current workspace outputs (manuscript + MCP tool usage)...`);
      const resolvedReviewers = reviewerModels && Array.isArray(reviewerModels) && reviewerModels.length > 0
        ? evaluationService.resolveReviewers(reviewerModels)
        : undefined;
      const baseline = await evaluationService.scoreCurrentWorkspaceRun(
        workspaceRoot,
        orchestrator,
        undefined,
        resolvedReviewers,
        useLLM !== false
      );
      res.json({ ok: true, scores: baseline.scores, telemetry: { totalDurationSeconds: baseline.totalDurationSeconds, totalTurns: baseline.totalTurns, tokenUsage: baseline.tokenUsage, phaseMetrics: baseline.phaseMetrics }, baseline });
    } catch (err: any) {
      res.status(500).json({ ok: false, error: err.message });
    }
  });

  app.get("/api/evaluation/suggest-tiers", async (req, res) => {
    try {
      const evalPath = req.query.evalDir ? String(req.query.evalDir) : path.join(APP_ROOT, "testrun", "evaluations");
      const optimizer = new TierOptimizer(evalPath);
      const suggestions = await optimizer.suggestTiers();
      res.json(suggestions);
    } catch (err: any) {
      res.status(500).json({ ok: false, error: err.message });
    }
  });

  app.post("/api/evaluation/explain-tiers", async (req, res) => {
    try {
      const { profileId, tierUtilityModel, tierToolRunnerModel, tierReasonerModel } = req.body || {};
      const evalPath = path.join(APP_ROOT, "testrun", "evaluations");
      const optimizer = new TierOptimizer(evalPath);
      const explanation = await optimizer.explainTierConfiguration(
        {
          profileId: profileId || "balanced",
          tierUtilityModel,
          tierToolRunnerModel,
          tierReasonerModel,
        },
        client
      );
      res.json(explanation);
    } catch (err: any) {
      res.status(500).json({ ok: false, error: err.message });
    }
  });

  // 12. Agentic Chat Controls
  app.post("/api/chat/send", async (req, res) => {
    try {
      const text = String(req.body?.text || "").trim();
      if (!text) return res.status(400).json({ ok: false, error: "Message text required" });

      res.json({ ok: true });

      broadcast({
        type: "agentState",
        isGenerating: true,
        messages: agentService.getMessages(),
      });

      const result = await agentService.sendMessage(text, (chunk: string) => {
        broadcast({ type: "agentChunk", chunk });
      });

      if (result.usage && result.usage.totalTokens > 0) {
        const role = result.role || "toolRunner";
        const roleCfg = client.forRole(role).getConfig();
        orchestrator.recordAuxiliaryUsage(
          role,
          roleCfg.model,
          roleCfg.provider,
          result.usage
        );
      }

      broadcast({
        type: "agentDone",
        reply: result.reply,
        usage: result.usage,
        messages: agentService.getMessages(),
      });
      await broadcastExperimentSpec();
    } catch (err: any) {
      broadcast({
        type: "agentError",
        error: err.message || String(err),
      });
    }
  });

  app.post("/api/chat/stop", (_req, res) => {
    agentService.cancel();
    broadcast({
      type: "agentState",
      isGenerating: false,
      messages: agentService.getMessages(),
    });
    res.json({ ok: true });
  });

  app.post("/api/chat/clear", async (_req, res) => {
    await agentService.clearMessages();
    broadcast({
      type: "agentState",
      isGenerating: false,
      messages: agentService.getMessages(),
      activeSessionId: agentService.getActiveSessionId(),
    });
    res.json({ ok: true });
  });

  app.get("/api/chat/sessions", async (_req, res) => {
    try {
      const sessions = await agentService.listSessions();
      res.json({ ok: true, sessions, activeSessionId: agentService.getActiveSessionId() });
    } catch (err: any) {
      res.status(500).json({ ok: false, error: err.message });
    }
  });

  app.post("/api/chat/new", async (_req, res) => {
    try {
      const sessionId = await agentService.startNewSession();
      const sessions = await agentService.listSessions();
      broadcast({
        type: "agentState",
        isGenerating: false,
        messages: agentService.getMessages(),
        activeSessionId: sessionId,
      });
      broadcast({
        type: "chatSessionsUpdate",
        sessions,
        activeSessionId: sessionId,
      });
      res.json({ ok: true, sessionId, messages: agentService.getMessages(), sessions });
    } catch (err: any) {
      res.status(500).json({ ok: false, error: err.message });
    }
  });

  app.post("/api/chat/load", async (req, res) => {
    try {
      const sessionId = String(req.body?.sessionId || "").trim();
      if (!sessionId) return res.status(400).json({ ok: false, error: "sessionId required" });
      const ok = await agentService.loadSession(sessionId);
      if (!ok) return res.status(404).json({ ok: false, error: "Session not found" });
      const sessions = await agentService.listSessions();
      broadcast({
        type: "agentState",
        isGenerating: false,
        messages: agentService.getMessages(),
        activeSessionId: sessionId,
      });
      broadcast({
        type: "chatSessionsUpdate",
        sessions,
        activeSessionId: sessionId,
      });
      res.json({ ok: true, sessionId, messages: agentService.getMessages(), sessions });
    } catch (err: any) {
      res.status(500).json({ ok: false, error: err.message });
    }
  });

  app.get("/api/chat/search", async (req, res) => {
    try {
      const q = String(req.query.q || "").trim();
      const results = await agentService.searchSessions(q);
      res.json({ ok: true, results });
    } catch (err: any) {
      res.status(500).json({ ok: false, error: err.message });
    }
  });

  // 13. MCP Reconnect / Status
  app.post("/api/mcp/reconnect", async (_req, res) => {
    try {
      const result = await executionManager.toggleEngine();
      const status = executionManager.getStatus();
      broadcast({ type: "mcpStatus", status });
      res.json({ ok: true, result, status });
    } catch (err: any) {
      res.status(500).json({ ok: false, error: err.message });
    }
  });

  // 14. Literature Library & PDF Ingestion API
  app.get("/api/literature/state", (_req, res) => {
    try {
      res.json({
        ok: true,
        state: literatureService.getViewState(ingestionRunner.getIsRunning() ? "ingesting" : undefined),
      });
    } catch (err: any) {
      res.status(500).json({ ok: false, error: err.message });
    }
  });

  app.post("/api/literature/select", async (req, res) => {
    try {
      const fileName = req.body?.fileName;
      literatureService.setActiveLiterature(fileName);
      broadcastLiteratureState();
      res.json({ ok: true, state: literatureService.getViewState() });
    } catch (err: any) {
      res.status(500).json({ ok: false, error: err.message });
    }
  });

  app.post("/api/literature/create", async (req, res) => {
    try {
      const name = String(req.body?.name || "").trim();
      if (!name) return res.status(400).json({ ok: false, error: "Database name required" });
      const created = await literatureService.createDatabase(name);
      broadcastLiteratureState();
      broadcastFileTree().catch(() => { });
      res.json({ ok: true, database: created, state: literatureService.getViewState() });
    } catch (err: any) {
      res.status(500).json({ ok: false, error: err.message });
    }
  });

  app.post("/api/literature/toggle-synthesis", (req, res) => {
    try {
      const enabled = Boolean(req.body?.enabled);
      literatureService.setUseInSynthesis(enabled);
      broadcastLiteratureState();
      res.json({ ok: true, state: literatureService.getViewState() });
    } catch (err: any) {
      res.status(500).json({ ok: false, error: err.message });
    }
  });

  app.post("/api/literature/toggle-bypass", (req, res) => {
    try {
      const bypass = Boolean(req.body?.bypass);
      literatureService.setBypassLiterature(bypass);
      broadcastLiteratureState();
      res.json({ ok: true, state: literatureService.getViewState() });
    } catch (err: any) {
      res.status(500).json({ ok: false, error: err.message });
    }
  });

  app.get("/api/literature/stats", async (req, res) => {
    try {
      const fileName = req.query.fileName ? String(req.query.fileName) : undefined;
      const statsRes = await literatureService.getStats(fileName);
      res.json(statsRes);
    } catch (err: any) {
      res.status(500).json({ ok: false, error: err.message });
    }
  });

  app.get("/api/literature/search", async (req, res) => {
    try {
      const query = String(req.query.query || "").trim();
      const limit = req.query.limit ? Number(req.query.limit) : 50;
      const fileName = req.query.fileName ? String(req.query.fileName) : undefined;
      const searchRes = await literatureService.search(query, limit, fileName);
      res.json(searchRes);
    } catch (err: any) {
      res.status(500).json({ ok: false, error: err.message });
    }
  });

  app.post("/api/literature/scan-folder", (req, res) => {
    try {
      const folderPath = String(req.body?.folderPath || "").trim();
      if (!folderPath) return res.status(400).json({ ok: false, error: "folderPath required" });
      const targetDir = path.isAbsolute(folderPath) ? folderPath : path.join(workspaceRoot, folderPath);
      if (!fs.existsSync(targetDir) || !fs.statSync(targetDir).isDirectory()) {
        return res.status(400).json({ ok: false, error: `Directory not found: ${targetDir}` });
      }
      literatureService.scanIngestFolder(targetDir);
      broadcastLiteratureState();
      res.json({ ok: true, state: literatureService.getViewState() });
    } catch (err: any) {
      res.status(500).json({ ok: false, error: err.message });
    }
  });

  app.post("/api/literature/import-files", async (req, res) => {
    try {
      const incomingFiles = req.body?.files;
      if (!Array.isArray(incomingFiles) || incomingFiles.length === 0) {
        return res.status(400).json({ ok: false, error: "No files provided." });
      }
      const targetDocsDir = path.join(workspaceRoot, "literature", "documents");
      if (!fs.existsSync(targetDocsDir)) {
        fs.mkdirSync(targetDocsDir, { recursive: true });
      }

      const savedPaths: string[] = [];
      for (const f of incomingFiles) {
        if (!f.name || !f.contentBase64) continue;
        const safeName = path.basename(f.name);
        const filePath = path.join(targetDocsDir, safeName);
        const buf = Buffer.from(f.contentBase64, "base64");
        await fsPromises.writeFile(filePath, buf);
        savedPaths.push(filePath);
      }

      literatureService.enqueueFiles(savedPaths, targetDocsDir);
      broadcastLiteratureState();
      broadcastFileTree().catch(() => { });
      res.json({ ok: true, state: literatureService.getViewState() });
    } catch (err: any) {
      res.status(500).json({ ok: false, error: err.message });
    }
  });

  app.post("/api/literature/clear-queue", (_req, res) => {
    try {
      literatureService.clearQueue();
      broadcastLiteratureState();
      res.json({ ok: true, state: literatureService.getViewState() });
    } catch (err: any) {
      res.status(500).json({ ok: false, error: err.message });
    }
  });

  app.post("/api/literature/start-ingest", async (req, res) => {
    try {
      const currentCfg = configStore.getAll();
      if (currentCfg.provider !== "ollama" && !currentCfg.apiKey) {
        return res.status(400).json({
          ok: false,
          error: "Please configure an API key in LLM Provider settings before running literature extraction.",
        });
      }
      const activeDb =
        req.body?.fileName ||
        literatureService.getConfig().activeLiterature ||
        literatureService.getConfig().activeCorpus;
      if (!activeDb) {
        return res.status(400).json({
          ok: false,
          error: "Please select or create an active literature database first.",
        });
      }
      if (ingestionRunner.getIsRunning()) {
        return res.status(400).json({ ok: false, error: "Ingestion pipeline is already running." });
      }

      broadcastLiteratureState();
      // Run ingestion asynchronously in background with real-time events
      ingestionRunner
        .runIngestion(activeDb)
        .then(async () => {
          await literatureService.getStats(activeDb).catch(() => { });
          broadcastLiteratureState();
          broadcastFileTree().catch(() => { });
        })
        .catch((err) => {
          broadcastLiteratureState();
          appendLog(`[Literature Ingestion Error] ${err.message}`);
        });

      res.json({ ok: true, message: "Ingestion pipeline started." });
    } catch (err: any) {
      res.status(500).json({ ok: false, error: err.message });
    }
  });

  app.post("/api/literature/abort-ingest", (_req, res) => {
    try {
      ingestionRunner.abort();
      broadcastLiteratureState();
      res.json({ ok: true, message: "Ingestion abort requested." });
    } catch (err: any) {
      res.status(500).json({ ok: false, error: err.message });
    }
  });

  app.post("/api/literature/generate-report", async (req, res) => {
    try {
      const activeDb =
        req.body?.fileName ||
        literatureService.getConfig().activeLiterature ||
        literatureService.getConfig().activeCorpus;
      if (!activeDb) {
        return res.status(400).json({ ok: false, error: "No active database selected." });
      }
      const reportRes = await literatureService.generateReport(activeDb);
      broadcastFileTree().catch(() => { });
      res.json(reportRes);
    } catch (err: any) {
      res.status(500).json({ ok: false, error: err.message });
    }
  });

  // WebSocket connection handling
  wss.on("connection", async (ws) => {
    clients.add(ws);
    ws.on("close", () => clients.delete(ws));

    try {
      const state = await orchestrator.getState();
      const sessions = await agentService.listSessions();
      ws.send(JSON.stringify({ type: "stateUpdate", state }));
      ws.send(
        JSON.stringify({
          type: "agentState",
          isGenerating: agentService.isRunning(),
          messages: agentService.getMessages(),
          activeSessionId: agentService.getActiveSessionId(),
        })
      );
      ws.send(
        JSON.stringify({
          type: "chatSessionsUpdate",
          sessions,
          activeSessionId: agentService.getActiveSessionId(),
        })
      );
      ws.send(JSON.stringify({ type: "mcpStatus", status: executionManager.getStatus() }));
      ws.send(
        JSON.stringify({
          type: "literatureState",
          state: literatureService.getViewState(ingestionRunner.getIsRunning() ? "ingesting" : undefined),
        })
      );
    } catch (_) { }
  });

  // Serve compiled frontend static files in production
  const publicDir = path.join(APP_ROOT, "dist", "public");
  if (fs.existsSync(publicDir)) {
    app.use(express.static(publicDir));
    app.get("*", (req, res, next) => {
      if (req.path.startsWith("/api/") || req.path.startsWith("/ws")) return next();
      res.sendFile(path.join(publicDir, "index.html"));
    });
  }

  const port = Number(process.env.PORT || 3000);
  let retriedPort = false;

  server.on("error", (err: NodeJS.ErrnoException) => {
    if (err.code === "EADDRINUSE" && !retriedPort) {
      retriedPort = true;
      console.warn(`[tidyproteomics-agent] Port ${port} is currently in use by a previous instance. Stopping stale process and retrying...`);
      try {
        const { execSync } = require("child_process");
        const pids = execSync(`lsof -ti tcp:${port}`, { encoding: "utf-8" })
          .split(/\s+/)
          .map((s: string) => Number(s.trim()))
          .filter((n: number) => n > 0 && n !== process.pid);
        for (const pid of pids) {
          try {
            process.kill(pid, "SIGKILL");
          } catch (_) { }
        }
      } catch (_) { }
      setTimeout(() => {
        server.listen(port, "0.0.0.0");
      }, 600);
      return;
    }
    console.error(`[tidyproteomics-agent] Server error on port ${port}:`, err.message);
    process.exit(1);
  });

  server.listen(port, "0.0.0.0", () => {
    console.log(`\n=============================================================`);
    console.log(`🚀 tidyproteomics-agent Web Studio running at http://localhost:${port}`);
    console.log(`📁 Active Workspace: ${workspaceRoot || "(None selected)"}`);
    console.log(`=============================================================\n`);
  });
}

startServer().catch((err) => {
  console.error("[tidyproteomics-agent] Fatal server startup error:", err);
  process.exit(1);
});

