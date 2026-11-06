import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import { LLMProviderType, LLMTierConfig } from "../types";

export interface AppConfig {
  provider: LLMProviderType;
  model: string;
  apiKey: string;
  baseUrl: string;
  maxTokens: number;
  timeoutSeconds: number;
  maxTurns: number;
  promptsDir: string;
  analysisDir: string;
  engine: "mcp";
  mcpServerPath: string;
  mcpMode: "local" | "docker";
  dockerImage: string;
  rscriptPath: string;
  pythonPath: string;
  searchProvider: "auto" | "tavily" | "brave" | "searxng";
  searchApiKey: string;
  searxngUrl: string;
  workspaceRoot: string;
  recentWorkspaces: string[];
  multiModelEnabled?: boolean;
  tierUtility?: LLMTierConfig;
  tierToolRunner?: LLMTierConfig;
  tierReasoner?: LLMTierConfig;
  phaseModels?: Record<string, string>;
  phaseMaxTurns?: Record<string, number>;
}

export function getDefaultTiersForProvider(provider: LLMProviderType): {
  utility: LLMTierConfig;
  toolRunner: LLMTierConfig;
  reasoner: LLMTierConfig;
} {
  switch (provider) {
    case "anthropic":
      return {
        utility: { provider: "anthropic", model: "claude-3-5-haiku-20241022" },
        toolRunner: { provider: "anthropic", model: "claude-3-5-sonnet-20241022" },
        reasoner: { provider: "anthropic", model: "claude-3-7-sonnet-20250219" },
      };
    case "openai":
      return {
        utility: { provider: "openai", model: "gpt-4o-mini" },
        toolRunner: { provider: "openai", model: "gpt-4o" },
        reasoner: { provider: "openai", model: "o3-mini" },
      };
    case "gemini":
      return {
        utility: { provider: "gemini", model: "gemini-2.0-flash" },
        toolRunner: { provider: "gemini", model: "gemini-2.0-flash" },
        reasoner: { provider: "gemini", model: "gemini-1.5-pro" },
      };
    case "openrouter":
      return {
        utility: { provider: "openrouter", model: "google/gemini-2.0-flash-001" },
        toolRunner: { provider: "openrouter", model: "anthropic/claude-3.5-sonnet-20241022" },
        reasoner: { provider: "openrouter", model: "anthropic/claude-3.7-sonnet" },
      };
    case "ollama":
      return {
        utility: { provider: "ollama", model: "qwen2.5-coder:7b" },
        toolRunner: { provider: "ollama", model: "qwen2.5-coder:32b" },
        reasoner: { provider: "ollama", model: "deepseek-r1:latest" },
      };
  }
}

const DEFAULT_CONFIG: AppConfig = {
  provider: "anthropic",
  model: "claude-3-7-sonnet-20250219",
  apiKey: process.env.ANTHROPIC_API_KEY || process.env.OPENAI_API_KEY || process.env.GEMINI_API_KEY || process.env.OPENROUTER_API_KEY || "",
  baseUrl: "",
  maxTokens: 32768,
  timeoutSeconds: 600,
  maxTurns: 30,
  promptsDir: "agent",
  analysisDir: "analysis",
  engine: "mcp",
  mcpServerPath: "",
  mcpMode: "local",
  dockerImage: "tidyproteomics-mcp:latest",
  rscriptPath: "",
  pythonPath: "",
  searchProvider: "auto",
  searchApiKey: process.env.TAVILY_API_KEY || process.env.BRAVE_API_KEY || "",
  searxngUrl: process.env.SEARXNG_URL || "",
  workspaceRoot: process.env.TIDY_WORKSPACE || process.env.WORKSPACE_ROOT || process.env.WORKSPACE || "",
  recentWorkspaces: [],
  multiModelEnabled: true,
  tierUtility: { model: "claude-3-5-haiku-20241022" },
  tierToolRunner: { model: "claude-3-5-sonnet-20241022" },
  tierReasoner: { model: "claude-3-7-sonnet-20250219" },
  phaseModels: {},
};

export class ConfigStore {
  private static instance: ConfigStore;
  private configPath: string;
  private data: AppConfig;
  private listeners: Array<(cfg: AppConfig) => void> = [];

  private constructor() {
    const defaultDir =
      fs.existsSync(path.join(os.homedir(), ".tidyproteomics-agent"))
        ? path.join(os.homedir(), ".tidyproteomics-agent")
        : fs.existsSync(path.join(os.homedir(), ".tidyproteomics-ai"))
        ? path.join(os.homedir(), ".tidyproteomics-ai")
        : path.join(os.homedir(), ".tidyproteomics-agent");
    const configDir =
      process.env.TIDYPROTEOMICS_CONFIG_DIR || defaultDir;
    if (!fs.existsSync(configDir)) {
      try {
        fs.mkdirSync(configDir, { recursive: true });
      } catch (_) {}
    }
    this.configPath = path.join(configDir, "config.json");
    this.data = this.load();
  }

  public static getInstance(): ConfigStore {
    if (!ConfigStore.instance) {
      ConfigStore.instance = new ConfigStore();
    }
    return ConfigStore.instance;
  }

  private load(): AppConfig {
    let loaded: Partial<AppConfig> = {};

    // 1. Try reading our standalone config.json
    if (fs.existsSync(this.configPath)) {
      try {
        loaded = JSON.parse(fs.readFileSync(this.configPath, "utf-8"));
      } catch (e) {
        console.warn("[ConfigStore] Failed to parse config.json:", e);
      }
    } else {
      // 2. First-run convenience: import non-secret defaults from VSCode user settings if available
      try {
        const vscodeSettingsCandidates = [
          path.join(os.homedir(), "Library/Application Support/Code/User/settings.json"),
          path.join(os.homedir(), ".config/Code/User/settings.json"),
        ];
        for (const candidate of vscodeSettingsCandidates) {
          if (fs.existsSync(candidate)) {
            const raw = fs.readFileSync(candidate, "utf-8");
            const parsed = JSON.parse(raw);
            if (parsed["tidyproteomicsagent.provider"]) loaded.provider = parsed["tidyproteomicsagent.provider"];
            if (parsed["tidyproteomicsagent.model"]) loaded.model = parsed["tidyproteomicsagent.model"];
            if (parsed["tidyproteomicsagent.baseUrl"]) loaded.baseUrl = parsed["tidyproteomicsagent.baseUrl"];
            if (parsed["tidyproteomicsagent.apiKey"]) loaded.apiKey = parsed["tidyproteomicsagent.apiKey"];
            if (parsed["tidyproteomicsagent.maxTokens"]) loaded.maxTokens = parsed["tidyproteomicsagent.maxTokens"];
            if (parsed["tidyproteomicsagent.timeoutSeconds"]) loaded.timeoutSeconds = parsed["tidyproteomicsagent.timeoutSeconds"];
            if (parsed["tidyproteomicsagent.maxTurns"]) loaded.maxTurns = parsed["tidyproteomicsagent.maxTurns"];
            if (parsed["tidyproteomicsagent.mcpMode"]) loaded.mcpMode = parsed["tidyproteomicsagent.mcpMode"];
            if (parsed["tidyproteomicsagent.mcpServerPath"]) loaded.mcpServerPath = parsed["tidyproteomicsagent.mcpServerPath"];
            break;
          }
        }
      } catch (_) {}
    }

    // 3. Auto-detect a sensible default workspaceRoot if none is set
    const envWorkspace =
      process.env.TIDY_WORKSPACE || process.env.WORKSPACE_ROOT || process.env.WORKSPACE || "";
    if (envWorkspace) {
      try {
        if (!fs.existsSync(envWorkspace)) {
          fs.mkdirSync(envWorkspace, { recursive: true });
        }
      } catch (_) {}
    }

    let defaultWs = loaded.workspaceRoot || DEFAULT_CONFIG.workspaceRoot;
    // If a container previously defaulted to /app (the application bundle root) and TIDY_WORKSPACE is configured, switch to TIDY_WORKSPACE
    if (defaultWs === "/app" && envWorkspace) {
      defaultWs = envWorkspace;
    }

    if (!defaultWs || !fs.existsSync(defaultWs)) {
      const candidates = [
        envWorkspace,
        "/tidyproteomics_agent/project_01",
        "/tidyproteomics_agent",
        path.resolve(__dirname, "../../../TidyProteomicsAgent/testrun"),
        path.resolve(__dirname, "../../TidyProteomicsAgent/testrun"),
        path.join(os.homedir(), "Local/projects/LLM_TidyAgent/x_tpa_055"),
        path.join(os.homedir(), "Local/projects/LLM_TidyAgent"),
        process.cwd(),
      ].filter(Boolean) as string[];
      for (const c of candidates) {
        try {
          if (c.startsWith("/tidyproteomics_agent") && !fs.existsSync(c)) {
            fs.mkdirSync(c, { recursive: true });
          }
          if (fs.existsSync(c) && fs.statSync(c).isDirectory()) {
            defaultWs = fs.realpathSync(c);
            break;
          }
        } catch (_) {}
      }
    }

    const merged: AppConfig = {
      ...DEFAULT_CONFIG,
      ...loaded,
      workspaceRoot: defaultWs || "",
      recentWorkspaces: Array.isArray(loaded.recentWorkspaces) ? loaded.recentWorkspaces : [],
    };

    if (merged.workspaceRoot && !merged.recentWorkspaces.includes(merged.workspaceRoot)) {
      merged.recentWorkspaces.unshift(merged.workspaceRoot);
    }

    // Auto-fix mismatched tier providers:
    // If the primary provider is OpenRouter or the key is an OpenRouter key (sk-or-v1-*),
    // any tier without its own dedicated API key should use openrouter, NOT a stale "anthropic" or "openai" value.
    if (merged.provider === "openrouter" || (merged.apiKey && merged.apiKey.startsWith("sk-or-v1"))) {
      if (merged.tierUtility && (!merged.tierUtility.apiKey || merged.tierUtility.apiKey.startsWith("sk-or-v1"))) {
        merged.tierUtility.provider = "openrouter";
      }
      if (merged.tierToolRunner && (!merged.tierToolRunner.apiKey || merged.tierToolRunner.apiKey.startsWith("sk-or-v1"))) {
        merged.tierToolRunner.provider = "openrouter";
      }
      if (merged.tierReasoner && (!merged.tierReasoner.apiKey || merged.tierReasoner.apiKey.startsWith("sk-or-v1"))) {
        merged.tierReasoner.provider = "openrouter";
      }
    }

    this.saveToDisk(merged);
    return merged;
  }

  private saveToDisk(cfg: AppConfig) {
    try {
      fs.writeFileSync(this.configPath, JSON.stringify(cfg, null, 2), "utf-8");
    } catch (e) {
      console.warn("[ConfigStore] Could not write config.json:", e);
    }
  }

  public getAll(): AppConfig {
    return { ...this.data };
  }

  public get<K extends keyof AppConfig>(key: K): AppConfig[K] {
    return this.data[key];
  }

  public update(patch: Partial<AppConfig>): AppConfig {
    if (patch.workspaceRoot && fs.existsSync(patch.workspaceRoot)) {
      const real = fs.realpathSync(patch.workspaceRoot);
      patch.workspaceRoot = real;
      const recents = [real, ...(this.data.recentWorkspaces || []).filter((w) => w !== real)].slice(0, 12);
      patch.recentWorkspaces = recents;
    }

    const effectiveProvider = patch.provider || this.data.provider;
    const effectiveApiKey = patch.apiKey !== undefined ? patch.apiKey : this.data.apiKey;

    if (effectiveProvider === "openrouter" || (effectiveApiKey && effectiveApiKey.startsWith("sk-or-v1"))) {
      if (patch.tierUtility && (!patch.tierUtility.apiKey || patch.tierUtility.apiKey.startsWith("sk-or-v1"))) {
        patch.tierUtility.provider = "openrouter";
      }
      if (patch.tierToolRunner && (!patch.tierToolRunner.apiKey || patch.tierToolRunner.apiKey.startsWith("sk-or-v1"))) {
        patch.tierToolRunner.provider = "openrouter";
      }
      if (patch.tierReasoner && (!patch.tierReasoner.apiKey || patch.tierReasoner.apiKey.startsWith("sk-or-v1"))) {
        patch.tierReasoner.provider = "openrouter";
      }
    }

    this.data = {
      ...this.data,
      ...patch,
    };
    this.saveToDisk(this.data);
    for (const l of this.listeners) {
      try {
        l(this.getAll());
      } catch (_) {}
    }
    return this.getAll();
  }

  public onChange(listener: (cfg: AppConfig) => void): () => void {
    this.listeners.push(listener);
    return () => {
      this.listeners = this.listeners.filter((l) => l !== listener);
    };
  }
}

export const configStore = ConfigStore.getInstance();

