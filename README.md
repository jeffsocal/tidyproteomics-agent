# tidyproteomics-agent

A standalone modern web application for autonomous quantitative proteomics workflows, combining the **TidyProteomics Agent Orchestrator**, **Interactive Experiment Studio**, **Pipeline Progress Telemetry**, **Web & Scientific Literature Search**, and **TidyProteomics MCP + R Daemon** in a single self-contained platform.

---

## Key Features

### 1. Adjustable `20% / 60% / 20%` Three-Pane Studio Layout
- **Left Pane (`20%`, adjustable) — Project Main**:
  - **Top Settings Drawer**: Initialize a workspace with a pipeline template (`differential_expression` or `quality_control_only`), browse/switch local project directories, configure LLM Provider (`Anthropic`, `OpenAI`, `Gemini`, `Local/Ollama`), Model, API Keys, MCP execution engine (`local` `server.py` or `docker`), and Web Search provider.
  - **Bottom Navigable Workspace Tree**: Live hierarchical browser for `docs/`, `analysis/`, `data/`, `code/`, `logs/`, `agent/`, `tools/`, and `literature/` writing directly to your local disk.
- **Center Pane (`60%`, adjustable) — Tabbed Main Viewer**:
  - **Interactive `experiment.md` Form Tab**: Edit `docs/experiment.md` via dynamic inputs, toggles, dropdowns, sample renaming/pooling table, statistical contrast builder, imputation selector, normalization multi-select, and biological context editor (with **Interactive Form**, **Split Form + Markdown**, and **Raw Markdown** modes).
  - **Pipeline Progress Table Tab**: Row-based phase telemetry table using identical status colors (`#52525b` pending, `#10b981` completed, animated `#2563eb`–`#60a5fa` running, `#ef4444` failed, `#f59e0b` warning/HITL attention) showing **Time**, **Turns**, **Input Tokens**, **Cached Tokens**, **Output Tokens**, and an expandable drawer with the **Phase Summary** and **clickable Associated Files** (`analysis/`, `code/`, `logs/`, `data/`, `docs/`).
  - **Rich File Viewer Tabs**: GitHub-Flavored Markdown viewer (resolving relative workspace plots like `../data/plot_*.png`), filterable TSV/CSV table preview, plot image viewer, and R script/log editor.
- **Right Pane (`20%`, adjustable) — Agentic Chat & Live Progress**:
  - **Top Agentic Return**: Real-time reasoning and turn progress (`Turn X/Y`), scientific observation cards, milestone cards, and collapsible live R/pipeline console stream.
  - **Bottom Chat Input**: Prompt textarea with quick-action chips (`Explain Findings`, `Review QC`, `Suggest Contrasts`).
  - **Below Chat Input — Segmented Progress Bar**: Compact 12-phase segmented progress bar with identical colors and shimmer animation. Clicking any segment jumps to the **Pipeline Progress** tab and expands that phase.

### 2. Built-In Web & Literature Search Tools
- `web_search`: General web search (`DuckDuckGo` / `Tavily` / `Brave`) for biological pathways, reagents, and proteomics methods.
- `pubmed_search`: Direct NCBI Entrez E-utilities PubMed search returning PMIDs, titles, journals, DOIs, and abstracts.
- `uniprot_search`: Direct UniProtKB REST API search returning accessions, gene symbols, organisms, and curated functional annotations.

---

## Quick Start (Local Development / Host Runtime)

```bash
cd tidyproteomics-agent
npm install
npm run build
npm start
```

Then open **http://localhost:3000** in your browser.

For hot-reload frontend + backend development:
```bash
npm run dev
```

---

## Self-Contained All-in-One Docker Image

Build and launch the complete stack (Web App + Node.js Orchestrator + Python `tidyproteomics-mcp` + R 4.3.2 & `tidyproteomics`) in one container while writing all prompts, code, plots, and logs to `./workspaces` on your host:

```bash
docker compose up --build
```

Then open **http://localhost:3000**. All files generated inside `/workspaces/<your_project>` are persisted directly in `./workspaces/<your_project>` on your host machine.

