# TidyProteomics Agent: Operations Guide & Application Manual

An in-depth, searchable operations manual explaining how to navigate the **TidyProteomics Agent Studio**, locate files across the project hierarchy, interpret pipeline telemetry and status indicators, resolve Human-in-the-Loop (HITL) checkpoints, and converse with the interactive agent.

---

## Table of Contents
1. [Architecture & Studio Layout](#1-architecture--studio-layout)
   - [Left Pane: Project Explorer & Settings](#left-pane-project-explorer--settings)
   - [Center Pane: Interactive Viewer & Workflows](#center-pane-interactive-viewer--workflows)
   - [Right Pane: Agent Chat & Telemetry](#right-pane-agent-chat--telemetry)
2. [Workspace Directory Structure & Where to Find Things](#2-workspace-directory-structure--where-to-find-things)
   - [Hierarchy Overview](#hierarchy-overview)
   - [Directory Breakdown](#directory-breakdown)
3. [Studio Tabs & What They Mean](#3-studio-tabs--what-they-mean)
   - [Experiment Setup Tab (`docs/experiment.md`)](#experiment-setup-tab-docsexperimentmd)
   - [Pipeline Progress Tab](#pipeline-progress-tab)
   - [AI Evaluation & Benchmarking Tab](#ai-evaluation--benchmarking-tab)
   - [Settings Tab](#settings-tab)
   - [Dynamic File Viewers](#dynamic-file-viewers)
4. [Visual Semantics, Status Colors & Telemetry](#4-visual-semantics-status-colors--telemetry)
   - [Status Color Coding](#status-color-coding)
   - [Telemetry Metrics Explained](#telemetry-metrics-explained)
   - [Orange Border Semantics (Action Required)](#orange-border-semantics-action-required)
5. [Human-in-the-Loop (HITL) Checkpoints & Gates](#5-human-in-the-loop-hitl-checkpoints--gates)
   - [Phase 2.1b Unified Study Design Gate](#phase-21b-unified-study-design-gate)
   - [Sample Group Renaming & Pooling Map (3.D)](#sample-group-renaming--pooling-map-3d)
   - [Target Contrasts Builder (3.E)](#target-contrasts-builder-3e)
   - [Confounded Batch Gate (3.F)](#confounded-batch-gate-3f)
   - [Autonomous Mode Bypass](#autonomous-mode-bypass)
6. [Differential Expression & Functional Enrichment Execution (Phases 4 & 5)](#6-differential-expression--functional-enrichment-execution-phases-4--5)
   - [Phase 4: Differential Expression Analysis & Candidate Profiling](#phase-4-differential-expression-analysis--candidate-profiling)
   - [Phase 5: Functional Annotation Assessment & Pathway Enrichment](#phase-5-functional-annotation-assessment--pathway-enrichment)
7. [Follow-On Iterative Refinement (Phases 12+)](#7-follow-on-iterative-refinement-phases-12)
8. [Interacting with the Right-Side Agent](#8-interacting-with-the-right-side-agent)
   - [Conversational Commands & Intent Shortcuts](#conversational-commands--intent-shortcuts)
   - [Role Directives (`@reasoner`, `@toolrunner`, `@utility`)](#role-directives-reasoner-toolrunner-utility)
   - [Quick Action Chips](#quick-action-chips)

---

## 1. Architecture & Studio Layout

The TidyProteomics Agent user interface is engineered as an adjustable **three-pane responsive workbench**:

```
+---------------------------------------------------------------------------------------------------------+
| [Top Global Bar: Project Workspace Picker | Pipeline Controls | Theme Toggle | MCP Connection Status]   |
+---------------------+---------------------------------------------------------+-------------------------+
| LEFT PANE (20%)     | CENTER PANE (60%)                                       | RIGHT PANE (20%)        |
|                     |                                                         |                         |
| • Settings Drawer   | Tab Bar: [Experiment Setup] [Pipeline Progress] [...]   | • Live Turn Telemetry   |
|   - Workspace Root  | +-----------------------------------------------------+ | • Milestone & Scientific|
|   - Template Select | |                                                     | |   Observation Stream  |
|   - LLM Tiers       | | Main Active Viewer:                                 | | • Collapsible R/MCP   |
|   - MCP Engine      | | - Interactive Form / Markdown Split View            | |   Console Log Stream  |
|                     | | - Telemetry Table & Checkpoint Drawer               | | • Interactive Chat    |
| • File Tree Browser | | - Markdown Document Viewer (Search, PDF Export)     | |   Input & Quick Chips |
|   - docs/           | | - TSV/CSV Tabular Data Preview with Live Filter     | | • 12-Phase Segmented  |
|   - data/           | | - High-Resolution Mass Spec Plot Viewer             | |   Progress Bar        |
|   - code/           | | - R Code & Script Inspection Editor                 | |                         |
|   - logs/           | +-----------------------------------------------------+ |                         |
+---------------------+---------------------------------------------------------+-------------------------+
```

### Left Pane: Project Explorer & Settings
- **Top Settings Drawer**:
  - **Workspace Directory**: Switch between active project folders or initialize new workspaces.
  - **Pipeline Template**: Choose between `differential_expression` (full 11-phase workflow) and `quality_control_only` (focused diagnostic ingestion).
  - **LLM Multi-Model Tiering**: Configure separate models and API keys for **Tier 1 (Utility)**, **Tier 2 (Tool Runner)**, and **Tier 3 (Deep Scientific Reasoner)** across Anthropic Claude, OpenAI GPT, Google Gemini, or Local Ollama.
  - **MCP Execution Engine**: Toggle between local Python/R daemon (`server.py`) and isolated Docker container.
- **Bottom File Tree Browser**:
  - Live, real-time filesystem tree of the project workspace.
  - Single-click to open any file in the Center Pane (Markdown, TSV, CSV, PNG, R script, log).

### Center Pane: Interactive Viewer & Workflows
- Houses the pinned core tabs (**Experiment Setup**, **Pipeline Progress**, **AI Evaluation**, **Settings**) and dynamic tabs for any workspace file opened from the tree or linked in reports.
- Includes a toolbar on every document tab with **Reload**, **Edit/Preview Toggle**, **Save**, **Download**, **PDF Publication Export**, and an **in-document text search bar**.

### Right Pane: Agent Chat & Telemetry
- **Agentic Chat Stream**: Conversational interface to interview the agent, review findings, modify study designs, and command pipeline execution.
- **Live Terminal & Progress Cards**: Real-time turn counter (`Turn X/Y`), collapsible R console stream, milestone cards, and scientific deduction cards.
- **12-Phase Segmented Progress Bar**: Visual roadmap of the autonomous pipeline. Clicking any segment immediately navigates the Center Pane to that phase in the **Pipeline Progress** tab.

---

## 2. Workspace Directory Structure & Where to Find Things

Every TidyProteomics workspace maintains a clean, self-documenting directory structure:

### Hierarchy Overview
```text
my_workspace/
├── docs/                     # Experimental design, synthesis manuscript & reports
│   ├── experiment.md         # Single source of truth for experimental parameters
│   ├── notes.md              # Shared blackboard runtime notes and milestones
│   ├── manuscript.md         # Complete scientific manuscript generated in Phase 11
│   ├── manuscript_rev_01.md  # Versioned follow-on manuscript revisions
│   ├── observations.md       # Phase 6 raw biological and statistical deductions
│   ├── knowledge.md          # Phase 7 functional module and pathway deductions
│   ├── README_OPERATIONS.md  # This operational guide
│   └── README_SCIENTIFIC.md  # Scientific rationale for normalization & imputation
├── data/                     # Output datasets, intermediate RDS objects & plots
│   ├── raw/                  # User input files (MaxQuant, DIA-NN, PD, FragPipe, Excel)
│   ├── tidyproteomics_data.rds # In-memory persistent serialized R data object
│   ├── plot_proteins_counts.png # Identification accounting plot across conditions
│   ├── plot_expression_volcano_*.png # High-res Volcano plots for target contrasts
│   ├── plot_enrichment_bubble_*.png  # Pathway enrichment bubble charts
│   └── *_table.tsv           # Filterable differential expression result tables
├── code/                     # Exported, standalone reproducible R scripts
│   ├── 01_inspect.R          # Self-contained R code for Phase 1
│   ├── 02_normalize.R        # Self-contained R code for Phase 2
│   ├── 03_impute.R           # Self-contained R code for Phase 3
│   └── ...                   # Re-runnable from any standard R/RStudio environment
├── logs/                     # Console logs and tool call histories per phase
│   ├── 01_inspect/console.log
│   ├── 02_normalize/console.log
│   └── ...
├── analysis/                 # Phase markdown directives and autonomous instructions
│   ├── 01_INSPECT.md
│   ├── 02_NORMALIZE.md
│   └── ...
├── literature/               # Local cache of retrieved PubMed abstracts & full-texts
│   ├── corpus/               # Downloaded PDFs and XML texts
│   └── literature_index.sqlite # SQLite semantic index for literature queries
└── tools/                    # Analysis helper utilities and reference tables
    ├── reactome_pathways.tsv # Local reference of curated Reactome pathways
    └── lint_tidyproteomics.R # Code linter for tidyproteomics syntax
```

### Directory Breakdown
| Directory | Purpose | Typical Files | How to Access in Studio |
|:---|:---|:---|:---|
| `docs/` | Experimental hypotheses, protocols, study designs, final manuscript, and follow-on reports. | `experiment.md`, `manuscript.md`, `notes.md`, `report_kinase.md` | Pinned in the **Experiment Setup** tab; or click files in the Left Project Explorer. |
| `data/` | Serialized MS data objects, result tables, and high-resolution plots. | `tidyproteomics_data.rds`, `plot_*_pca_*.png`, `plot_*_volcano_*.png` | Click any plot in the tree to view in high resolution; click TSV tables for instant filtering. |
| `data/raw/` | User raw search output files. Place your data here. | `proteinGroups.txt`, `report.tsv`, `export.xlsx` | Drag & drop or copy files here; select in Section 1 of `docs/experiment.md`. |
| `code/` | Auto-generated, 100% reproducible R scripts produced by `tpa_export_state`. | `01_inspect.R`, `02_normalize.R`, `04_expression.R` | Click to inspect or copy executable R code to reproduce results in RStudio. |
| `logs/` | Real-time console logs, execution errors, and tool trace logs per phase. | `logs/02_normalize/console.log` | Visible in the expandable drawer of the **Pipeline Progress** tab or via file tree. |
| `literature/`| Local scientific literature corpus, SQLite database, and synthesis summaries. | `literature_index.sqlite`, downloaded PMIDs | Configured via Settings -> Literature Database. |

---

## 3. Studio Tabs & What They Mean

### Experiment Setup Tab (`docs/experiment.md`)
The central control hub for your quantitative study. It provides three viewing modes:
1. **Interactive Form**: Clean web controls with dropdowns, toggles, sample renaming tables, contrast builders, and biological hypothesis inputs.
2. **Split Form + Markdown**: Side-by-side view with interactive controls on the left and live GitHub-Flavored Markdown preview on the right.
3. **Raw Markdown**: Full-featured code editor to edit `docs/experiment.md` directly.

Key Sections in `experiment.md`:
- **Section 1: Data Source & Platform**: Filepath, search engine (`DIA-NN`, `MaxQuant`, `ProteomeDiscoverer`, `Spectronaut`, `FragPipe`), and analyte (`proteins` or `peptides`).
- **Section 2: Biological Hypothesis**: Hypothesis, model organism, experimental perturbation, and scientific questions.
- **Section 3: Unified Study Design Gate**:
  - `3.A Discovered Groups`: Replicates identified in file headers.
  - `3.B Normalization`: Algorithm selection (`scaled`, `median`, `linear`, `limma`, `loess`, `svm`, `randomforest`) and sub-population subset filters.
  - `3.C Imputation`: Strategy (`randomforest_grouped` for MAR vs `min_column` for knockouts/MNAR vs `none`).
  - `3.D Sample Pooling`: Mapping raw replicate names to clean biological condition cohorts.
  - `3.E Target Contrasts`: Pairwise differential comparisons (e.g. `Treated vs Control`).
  - `3.F Confounded Batch Gate`: Detection and authorization of batch confounding.

### Pipeline Progress Tab
Row-based real-time telemetry for every phase in the workflow:
- **Phase Name & Directive**: e.g., `01_INSPECT`, `02_NORMALIZE`, `04_EXPRESSION`.
- **Status Indicator**: Animated pulse during execution, green checkmark on completion, red badge on failure, amber badge when awaiting HITL confirmation.
- **Duration**: Exact execution time in seconds.
- **Turns & Token Telemetry**: Input tokens, cached prompt tokens, and output tokens.
- **Expandable Phase Drawer**: Click any row to reveal:
  - Concise bulleted phase summary.
  - Clickable associated workspace files (`code/02_normalize.R`, `data/plot_proteins_pca_PC1PC2.png`, `logs/02_normalize/console.log`).
  - Raw console output toggle.

### AI Evaluation & Benchmarking Tab
A comprehensive quantitative rubric studio evaluating agent performance:
- Scores workflows across **6 dimensions**: Checkpoint Rigor, Data Integrity, Statistical Soundness, Biological Reasoning, Literature Depth, and Execution Efficiency.
- Offers **Multi-Model Comparisons** (e.g. comparing Claude 3.5 Sonnet vs GPT-4o vs Gemini 1.5 Pro).
- Features an automated **Tier Optimizer** recommending optimal model allocations to minimize token cost while maintaining >95% benchmark quality.

### Settings Tab
- **Model Provider & Credentials**: Secure API key entry and base URL configuration.
- **Multi-Model Tiering**: Assign separate models to Utility, Tool Runner, and Reasoner roles.
- **MCP Engine Management**: Check health of `tidyproteomics-mcp`, ping the R daemon, or trigger reconnection.
- **Literature Corpus**: Manage local SQLite search index and NCBI PubMed API keys.

### Dynamic File Viewers
Whenever you click a file in the workspace tree:
- **Markdown Files (`.md`)**: Rendered with GitHub-Flavored Markdown, clickable image figures, print-to-PDF export, and in-document search.
- **Tabular Files (`.tsv`, `.csv`)**: Fast interactive table with real-time text filter and row counters.
- **Plot Images (`.png`, `.svg`)**: High-resolution zoomable viewer for volcano plots, PCA score plots, and heatmaps.
- **R Scripts & Logs (`.R`, `.log`, `.txt`)**: Syntax-highlighted code viewer with reload and download buttons.

---

## 4. Visual Semantics, Status Colors & Telemetry

### Status Color Coding
The studio uses consistent, accessible color tokens across all tabs and progress bars:

| Color | Hex | Meaning | UI Context |
|:---|:---|:---|:---|
| **Pending / Inactive** | `#52525b` | Phase has not started yet. | Grey status badge, inactive progress bar segment. |
| **Running** | `#2563eb` -> `#60a5fa` | Phase is actively executing tool calls and reasoning turns. | Animated blue pulse, glowing progress segment. |
| **Completed** | `#10b981` | Phase completed all checkpoints successfully. | Solid green badge, green progress segment. |
| **Warning / HITL** | `#f59e0b` | Execution halted cleanly for required researcher review and confirmation. | Amber badge, orange outline around unconfirmed inputs in `experiment.md`. |
| **Failed / Error** | `#ef4444` | Checkpoint failed or unhandled tool error encountered. | Red badge, error banner with actionable insights. |

### Telemetry Metrics Explained
- **Time (s)**: Wall-clock runtime for the phase.
- **Turns**: Number of agent-tool roundtrips executed within the phase.
- **Input Tokens**: Prompt tokens transmitted to the LLM.
- **Cached Tokens**: Tokens read from persistent prompt cache (e.g. Anthropic Prompt Caching or OpenAI Cached Tokens). High cache hits (>80%) significantly reduce API costs and latency.
- **Output Tokens**: Response and tool-argument tokens generated by the LLM.

### Orange Border Semantics (Action Required)
When the pipeline halts at Phase 2.1b or Phase 3.1:
- Any unconfirmed setting in Section 3 of `docs/experiment.md` is rendered with a **vibrant orange outline** (`border: 2px solid #f59e0b`).
- This visually signals: *"The agent has discovered defaults, but requires your human confirmation before irreversible statistical modeling proceeds."*

---

## 5. Human-in-the-Loop (HITL) Checkpoints & Gates

Scientific integrity requires that automated agents never make silent, irreversible assumptions about study design. TidyProteomics Agent enforces strict **HITL Gates**:

```
[Raw Mass Spec Data]
        │
        ▼
[Phase 1: Ingestion & QC Header Audit]
        │
        ▼
[Phase 2.1: Contaminant & Confidence Filtering]
        │
        ▼
╔══════════════════════════════════════════════════════════════╗
║  STOP: Phase 2.1b Unified Study Design Gate                 ║
║  - 3.A Confirm Discovered Groups?                           ║
║  - 3.B Confirm Normalization Method & Filters?              ║
║  - 3.C Confirm Imputation Method (MAR vs MNAR)?             ║
║  - 3.D Confirm Sample Group Renaming & Pooling Map?         ║
║  - 3.E Confirm Target Contrasts (Treatment vs Control)?     ║
║  - 3.F Authorize Batch Confounding (if detected)?           ║
╚══════════════════════════════════════════════════════════════╝
        │
        ├─► [User clicks '🎯 Confirm All Study Design & Proceed']
        │   OR [User types 'confirm' in Agent Chat]
        ▼
[Phase 2.2 - Phase 11: Autonomous Execution Resumes Uninterrupted]
```

### Phase 2.1b Unified Study Design Gate
In Phase 2.1b, execution pauses cleanly so you can verify:
1. **Discovered Sample Groups (3.A)**: Replicates detected from raw filenames.
2. **Quantitative Normalization (3.B)**: Benchmarking candidates (`scaled`, `median`, `linear`, `limma`, `loess`).
3. **Missing Value Imputation (3.C)**: Strategy confirmed based on biological mechanism.
4. **Sample Pooling & Renaming (3.D)**: Grouping technical replicates into clean biological cohorts.
5. **Target Contrasts (3.E)**: Pairwise comparison formulas.
6. **Confounded Batch Gate (3.F)**: Authorized only if batch confounding is detected.

### Sample Group Renaming & Pooling Map (3.D)
Mass spectrometry filenames often carry instrument suffixes (e.g. `WT_rep1_run04`, `WT_rep2_run05`).
- The pooling map groups these into clean biological conditions: `WT_rep1_run04 -> WT`, `WT_rep2_run05 -> WT`.
- **Why this matters**: Normalization replicate CVs, PCA clustering, and missingness summaries are computed at the condition level ($n \ge 2$) rather than treating each run as an isolated $n=1$ singleton.

### Target Contrasts Builder (3.E)
Specifies which conditions to compare in differential expression:
- Format: `Treatment vs Control` or `Treatment / Control` (e.g. `Drug_10uM vs Vehicle`).
- Supports multiple contrasts simultaneously.

### Confounded Batch Gate (3.F)
If biological cohorts correlate 1:1 with processing dates or instrument batches (e.g. all Wild-Type samples run on Day 1, all Knockout samples run on Day 2):
- The agent flags batch confounding.
- Execution requires explicit authorization (`Proceed With Potential Batch Confounding: TRUE`) before unadjusted exploratory analysis is permitted.

### Autonomous Mode Bypass
For automated benchmarking, headless batch runs, or CI/CD testing:
- Set `- **Autonomous Mode**: TRUE` or `- **Auto-Confirm**: TRUE` in `docs/experiment.md`.
- The agent will automatically adopt standard analytical defaults, auto-confirm all Section 3 gates, and run Phases 01 through 11 without pausing.

---

---

## 6. Differential Expression & Functional Enrichment Execution (Phases 4 & 5)

Following quantitative normalization and missingness imputation, the pipeline transitions to statistical comparison and biological interpretation.

### Phase 4: Differential Expression Analysis & Candidate Profiling

In Phase 4, the agent calculates empirical Bayes linear models across all confirmed target contrasts:

1. **Target Contrast Validation**:
   - The agent reads contrast specifications defined in `docs/experiment.md` Section 3.E (`<treatment>/<control>`).
   - If contrasts are unconfirmed or if batch confounding is detected without authorization in Section 3.F, execution halts cleanly at the Pre-Flight Gate.
2. **Empirical Bayes Moderation (`tpa_expression`)**:
   - Differential expression is computed via `tpa_expression(comparison = "<treatment>/<control>", method = "limma")`.
   - Optional methods include `wilcoxon` (non-parametric rank-sum) and `mixed-effects` (linear mixed models for repeated or longitudinal designs).
3. **Automated Batch Processing (`analyze_expressions()`)**:
   - `tpa_batch_analysis(type = "expressions", labels_column = "gene_name")` processes all modeled contrasts simultaneously.
   - Generates publication-grade volcano plots with `ggrepel` gene symbol callouts (`data/plot_proteins_volcano_<contrast>.png`).
   - Exports complete quantitative expression tables (`data/table_proteins_expression_<contrast>.csv` and `.tsv`).
4. **Targeted Candidate Querying (`tpa_query_expression`)**:
   - Query significant proteins directly without loading massive tables into memory:
     `tpa_query_expression(log2fc_min = 1.0, significance_max = 0.05, top_n = 20)`.

### Phase 5: Functional Annotation Assessment & Pathway Enrichment

Phase 5 contextualizes differentially expressed proteins within biological pathways and gene ontology terms:

1. **Annotation Term Audit (`tpa_inspect(what = "annotation_terms")`)**:
   - Audits available functional categories: Gene Ontology (`biological_process`, `cellular_component`, `molecular_function`), `reactome_pathway`, and `wiki_pathway`.
2. **Multi-Category Pathway Enrichment (`tpa_enrichment`)**:
   - Tests enrichment across ontologies using rank-based Wilcoxon rank-sum testing:
     `tpa_enrichment(comparison = "<treatment>/<control>", terms = "biological_process,cellular_component,reactome_pathway", method = "wilcoxon")`.
   - Also supports Gene Set Enrichment Analysis (`method = "gsea"`) and Fisher's Exact Test (`method = "fisher"`).
3. **Automated Batch Processing (`analyze_enrichments()`)**:
   - `tpa_batch_analysis(type = "enrichments", top_n = 50)` creates the faceted multi-ontology enrichment summary plot (`data/plot_proteins_enrichment_<contrast>.png`) and exports `data/table_proteins_enrichment_<contrast>.tsv`.
4. **Directional Interpretation**:
   - **Positive (`+`) score**: Pathway is induced / accumulated in treatment relative to control.
   - **Negative (`-`) score**: Pathway is repressed / depleted in treatment relative to control.
5. **Handling Unannotated Datasets (Autonomous Continuity)**:
   - If formal ontologies are absent, the agent verifies `GN=` symbols from FASTA headers, records `ANNOTATION_UNAVAILABLE`, and advances cleanly to Phase 6 without halting or failing.

## 7. Follow-On Iterative Refinement (Phases 12+)

After Phase 11 completes the initial synthesis manuscript, research does not stop. You can launch **Follow-On Iterative Phases**:
1. Click **+ Add Follow-On Phase** in the Pipeline Progress tab.
2. Enter a scientific directive (e.g., *"Investigate kinase phosphorylation networks and corroborate with literature"*, *"Perform sub-cluster analysis on mitochondrial complexes"*).
3. Select manuscript revision mode:
   - **New Dedicated Report Only**: Creates `docs/report_<topic>.md` without altering the main manuscript.
   - **Append Section to Manuscript**: Creates a versioned manuscript (`docs/manuscript_rev_01.md`) with a dedicated follow-on results subsection.
   - **Holistic Rewrite**: Re-synthesizes the entire manuscript incorporating the new discoveries across Abstract, Results, and Discussion.

---

## 8. Interacting with the Right-Side Agent

The right-side agent is not just a chatbot—it is an active co-pilot that can read workspace files, execute tools, modify experiment parameters, and guide scientific choices.

### Conversational Commands & Intent Shortcuts
You can type natural instructions directly into the chat:

| User Message | Agent Action |
|:---|:---|
| `"Start pipeline"` / `"Run"` | Launches the autonomous pipeline from Phase 1 or current checkpoint. |
| `"Stop"` / `"Pause"` | Safely pauses pipeline execution at the end of the active tool turn. |
| `"Restart"` / `"Start over"` | Resets all phases and begins re-execution from Phase 1. |
| `"Status"` | Prints current phase, completion status, and token usage summary. |
| `"Confirm"` / `"Proceed"` | Confirms pending Section 3 study design gates and resumes the pipeline. |
| `"Use min_column for imputation"` | Updates Section 3.C to `min_column`, confirms the gate, and resumes. |
| `"Set contrast to KO vs WT"` | Sets target contrast in Section 3.E. |
| `"Data file is data/raw/exp.xlsx"` | Configures `PATH_TO_DATA_FILE` in Section 1. |
| `"Explain normalization"` | Explains linear and non-linear normalization choices with literature links. |
| `"Explain imputation"` | Explains MAR vs MNAR missingness and method selection with literature links. |

### Role Directives (`@reasoner`, `@toolrunner`, `@utility`)
You can explicitly direct queries to specific multi-model tiers:
- `@reasoner <question>`: Routes to Tier 3 (e.g. Claude 3.5 Sonnet / o1) for deep biological pathway deduction, statistical critique, or mechanistic hypotheses.
- `@toolrunner <command>`: Routes to Tier 2 for file operations, tool calls, or parameter updates.
- `@utility <question>`: Routes to Tier 1 for quick status checks or light formatting.

### Quick Action Chips
Clickable buttons appear below agent messages to accelerate frequent actions:
- `🎯 Confirm All Study Design & Proceed`: Resolves all pending Section 3 checks in one click.
- `Review docs/experiment.md ↗`: Jumps to the Experiment Setup tab.
- `Review docs/manuscript.md ↗`: Opens the final scientific manuscript in the Center Pane.
- `📖 Operations Guide ↗`: Opens this operations guide.
- `🔬 Scientific Guide ↗`: Opens the scientific guide on normalization and imputation.

