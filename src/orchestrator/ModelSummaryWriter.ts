import * as fs from "fs/promises";
import * as path from "path";
import { LLMConfig } from "../types";

export function formatDateTime(d = new Date()): string {
  const pad = (n: number) => n.toString().padStart(2, "0");
  const year = d.getFullYear();
  const month = pad(d.getMonth() + 1);
  const day = pad(d.getDate());
  const hours = pad(d.getHours());
  const minutes = pad(d.getMinutes());
  return `${year}-${month}-${day} ${hours}:${minutes}`;
}

export function generateActiveModelSummaryMarkdown(
  config: LLMConfig,
  extensionVersion = "0.1.0",
  date = new Date(),
  engine = "mcp"
): string {
  const timestampStr = formatDateTime(date);
  const providerStr = (config.provider || "anthropic").toUpperCase();
  const modelStr = config.model || "claude-3-7-sonnet-20250219";
  const cachingStr =
    config.provider === "anthropic" || config.provider === "openrouter"
      ? "Active ⚡"
      : "Standard";
  const maxTokensStr = (config.maxTokens || 32768).toLocaleString();
  const timeoutStr = `${config.timeoutSeconds || 600}s`;
  const keyStatusStr = config.apiKey
    ? "Configured"
    : config.provider === "ollama"
    ? "Not Required (Local)"
    : "Missing";
  const baseUrlStr =
    config.baseUrl && config.baseUrl.trim() ? config.baseUrl.trim() : "Default";
  const agentStr = `TidyProteomicsAgent v${extensionVersion || "0.1.0"}`;
  const authorStr = `${providerStr} | ${modelStr}`;

  return `# Active Model Summary

Created: ${timestampStr}
Author: ${authorStr}
Agent: ${agentStr}

## Active Configuration

| Configuration Property | Value |
| :--- | :--- |
| **Provider** | ${providerStr} |
| **Model** | ${modelStr} |
| **Execution Engine** | ${engine === "mcp" ? "MCP Server (Live In-Memory)" : "Markdown Skills (Script Generation)"} |
| **Author** | ${authorStr} |
| **Agent** | ${agentStr} |
| **Prompt Caching** | ${cachingStr} |
| **Max Output Tokens** | ${maxTokensStr} |
| **Request Timeout** | ${timeoutStr} |
| **Key Status** | ${keyStatusStr} |
| **Base URL** | ${baseUrlStr} |
| **Multi-Model Routing** | ${config.multiModelEnabled ? "Active (3-Tier Multi-LLM)" : "Disabled (Single Model)"} |

${
  config.multiModelEnabled
    ? `### 3-Tier Multi-LLM Role Allocations

| Role | Operational Scope | Assigned Model | Provider |
| :--- | :--- | :--- | :--- |
| **Tier 1: Fast Utility & Extractor** | PDF Ingestion, Tables, Search Summaries | \`${config.tierUtility?.model || config.model}\` | ${(config.tierUtility?.provider || config.provider).toUpperCase()} |
| **Tier 2: Tool Runner & Code Orchestrator** | Phases 00–08 (QC, Norm, Impute, DE), MCP R Execution | \`${config.tierToolRunner?.model || config.model}\` | ${(config.tierToolRunner?.provider || config.provider).toUpperCase()} |
| **Tier 3: Frontier Scientific Reasoner** | Phases 09–11 (Corroboration, Synthesis, Manuscript) | \`${config.tierReasoner?.model || config.model}\` | ${(config.tierReasoner?.provider || config.provider).toUpperCase()} |
`
    : ""
}
---

## Agent Document Header Standard
All agent-authored documents and reports (including \`docs/observations.md\`, \`docs/knowledge.md\`, \`docs/websearch.md\`, \`docs/literature.md\`, \`docs/manuscript.md\`, and any other generated markdown reports) must reference this specification and place the following metadata block immediately below the title:

\`\`\`markdown
Title

Created: YYYY-MM-DD HH:MM
Author: ${authorStr}
Agent: ${agentStr}
\`\`\`
`;
}

export async function writeActiveModelSummaryFile(
  workspaceRoot: string,
  config: LLMConfig,
  extensionVersion = "0.1.0",
  engine = "mcp"
): Promise<string> {
  if (!workspaceRoot) return "";
  const docsDir = path.join(workspaceRoot, "docs");
  await fs.mkdir(docsDir, { recursive: true });
  const llmPath = path.join(docsDir, "llm.md");
  const markdown = generateActiveModelSummaryMarkdown(config, extensionVersion, new Date(), engine);

  try {
    const existing = await fs.readFile(llmPath, "utf-8");
    const stripCreated = (s: string) =>
      s.replace(/Created:\s*\d{4}-\d{2}-\d{2}\s+\d{2}:\d{2}/g, "");
    if (stripCreated(existing) === stripCreated(markdown)) {
      return llmPath;
    }
  } catch {
    // file does not exist yet
  }

  await fs.writeFile(llmPath, markdown, "utf-8");
  return llmPath;
}
