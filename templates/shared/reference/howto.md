# Quick "How-To" Guide

Get started in four steps and navigate the main components of the **TidyProteomics Agent** studio.

---

## 1. Getting Started in 4 Steps

1. **Connect LLMs (`Settings` → `Model Provider`)**
   - Click **`[Settings]`** in the left panel (or the **`[LLM]`** pill in the top banner).
   - Select your provider (Anthropic, OpenAI, Google Gemini, OpenRouter, or local Ollama), enter your **API Key**, and click **`Test LLM Connection`** (or **`Test Key & Model`**) to verify and save.
   - *(Optional)* Assign **Tier 1 (Utility)**, **Tier 2 (Tool Runner)**, and **Tier 3 (Deep Reasoner)** models, and verify **`[MCP]`** is green.

2. **Select Workspace & Add Data (`Left Panel` → `data/`)**
   - Click **`[Change]`** in the left workspace header to select an existing project folder or initialize a new workspace template.
   - Place your quantitative proteomics table (MaxQuant `proteinGroups.txt`, DIA-NN `report.tsv`, Spectronaut, FragPipe, or CSV/TSV) into the **`data/`** directory.

3. **Populate or Bypass the Literature Library (`Library`)**
   - Click **`[Library]`** in the left panel (or **`[Literature]`** in the top banner) to ingest PDFs / PubMed PMIDs into the local DuckDB assertion graph.
   - **No literature needed?** Toggle **Bypass Literature** to **ON** (`🔵 Literature (Bypassed)`) so the pipeline runs without halting for literature queries.

4. **Edit `docs/experiment.md` & Start (`Experiment Setup` → `Start Pipeline`)**
   - Open the pinned **`Experiment Setup`** tab (or click **`[FORM]`** next to `docs/experiment.md` in the left file tree).
   - Fill in **Section 1** (data file path, platform, analyte, organism Taxon ID such as `9606`) and **Section 2** (hypothesis), then click **Save**.
   - Click **`Start Pipeline`** in the right chat bar to launch autonomous execution.

---

## 2. Main Studio Components

### `↑` Top Banner — Status Pills, 12-Phase Roadmap & Timer
- **5 Readiness Pills (`Workspace`, `Experiments`, `Literature`, `LLM`, `MCP`)**: Click any pill to jump directly to its configuration view.
  - 🟢 **Green**: Ready.
  - 🟠 **Orange**: Needs configuration or paused at a **Human-in-the-Loop (HITL)** study gate.
  - 🔵 **Blue**: Deliberately bypassed (e.g., Literature bypass enabled).
- **12-Phase Segmented Progress Bar**: Tracks pipeline progress from Ingestion (`P01`) to Publication Integrity (`P12`). Click any segment to inspect that phase.
- **Total Time**: Cumulative active runtime across phases (automatically pauses during HITL review).

### `←` Left Side Panel — Quick Drawers & Workspace File Tree
- **Top 2×2 Drawers**: Instant center-tab openers for **`[Settings]`** (LLM keys & MCP), **`[Library]`** (literature database), **`[Evaluation]`** (Rubric v2.0 benchmarks), and **`[Guides]`** (this guide, Operations Manual, and Scientific Guide).
- **Workspace & File Tree**: Switch workspaces (`[Change]`) and browse live host files in `docs/`, `data/`, `code/` (reproducible R scripts), `analysis/` (plots & DE tables), and `logs/`. Click the **`[FORM]`** badge on `docs/experiment.md` to jump straight to the visual form editor.

### `↖` The Two Permanent Tabs — Center Workbench
These two tabs are **permanently pinned** to the left of the center tab bar and cannot be closed (files opened from the tree appear as closable tabs to their right):
- **`Experiment Setup` (`docs/experiment.md`)**: Interactive form and Markdown editor for dataset metadata and **Section 3 HITL Study Design Gates** (`3.A` Sample Groups, `3.B` Normalization, `3.C` Imputation, `3.D` Pooling, `3.E` Contrasts, `3.F` Batch Confounding, `3.G` UniProt Annotation).
- **`Pipeline Progress`**: Real-time execution table showing per-phase status, runtime, agent turn usage, token counts, and expandable R execution logs.

### `→` Right Side Chat Bar — Live Agent & Controls
- **Session & Budget Header**: Switch or create chat sessions (`+ New`) and monitor live **Turn Counters** and **Token Usage**.
- **HITL Quick-Action Chips**: When the pipeline pauses at a study design checkpoint, click **`Confirm All & Proceed`** (or **`Fetch UniProt`**) to approve settings and resume in one click.
- **Prompt & Pipeline Controls**: Start/Stop the pipeline, expand R tool calls, or chat with the agent (supports `@reasoner`, `@toolrunner`, and `@utility` role directives).
