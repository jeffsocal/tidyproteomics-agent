#!/usr/bin/env python3
import os
import re
import subprocess
import zipfile

OVERLEAF_DIR = "ai_benchmarking/overleaf"
DOCS_DIR = "ai_benchmarking/docs"
INPUT_MD = os.path.join(DOCS_DIR, "publication_draft_06.md")

os.makedirs(os.path.join(OVERLEAF_DIR, "figures"), exist_ok=True)

# Copy figures
FIG_NAMES = [
    "figure_1_system_architecture",
    "figure_2_biological_findings",
    "figure_3_benchmark_revisions",
    "figure_4_cost_intelligence_frontier",
    "figure_S1_verifier_architecture"
]
for fig in FIG_NAMES:
    for ext in [".png", ".pdf"]:
        src = os.path.join("ai_benchmarking/figures", fig + ext)
        dst = os.path.join(OVERLEAF_DIR, "figures", fig + ext)
        if os.path.exists(src):
            subprocess.run(["cp", src, dst], check=True)

# Read markdown
with open(INPUT_MD, "r", encoding="utf-8") as f:
    text = f.read()

# Build references.bib
BIB_PATH = os.path.join(OVERLEAF_DIR, "references.bib")

# Let's write the complete LaTeX manuscript directly and precisely
LATEX_CONTENT = r"""\documentclass[11pt,a4paper]{article}

\usepackage[utf8]{inputenc}
\usepackage[margin=1in]{geometry}
\usepackage{amsmath,amssymb,amsfonts}
\usepackage{graphicx}
\usepackage{booktabs}
\usepackage{tabularx}
\usepackage{array}
\usepackage{cite}
\usepackage{hyperref}
\usepackage{authblk}
\usepackage{microtype}
\usepackage{caption}
\usepackage{subcaption}
\usepackage{xcolor}
\usepackage{xurl}
\usepackage{url}

\hypersetup{
    colorlinks=true,
    linkcolor=blue!80!black,
    citecolor=blue!80!black,
    urlcolor=blue!80!black
}

\title{\textbf{TidyProteomics-Agent: An Autonomous, Multi-Tier Agentic Framework for Reproducible Quantitative Proteomics with Automated Integrity Verification and Peer Critique}}
\author[1,*]{Jeffrey Jones}
\author[1]{[Contributing Authors]}
\affil[1]{Division of Biology and Biological Engineering, California Institute of Technology, Pasadena, CA 91125, USA}
\affil[*]{Corresponding author: \texttt{jeffsocal@caltech.edu}}
\date{}

\begin{document}

\maketitle

\begin{abstract}
\textbf{Background:} Mass spectrometry-based quantitative proteomics generates complex, high-dimensional datasets, yet getting started in its fractured software ecosystem remains remarkably difficult. A perennial bottleneck---even for standardized R frameworks such as \texttt{tidyproteomics}---is ingesting tabular outputs whose schemas vary wildly across search engines and even across versions or export configurations of the same platform. Concurrently, the emergence of million-token context windows has spurred a concerning trend in which researchers feed raw quantitative spreadsheets directly into frontier large language models (LLMs) to extract biological narratives. While this ``blind'' context-stuffing approach yields fluent, persuasive prose, it bypasses statistical foundations and routinely produces hallucinated fold-change direction inversions, cherry-picked protein groupings that omit contradictory outliers, and irreproducible conclusions.

\vspace{1ex}
\textbf{Results:} We introduce \textbf{TidyProteomics-Agent}, a containerized, human-in-the-loop (HITL) agentic platform that enforces the step-wise analytical discipline of a trained bioinformatician by pairing a phase-gated persistent markdown memory architecture with the Model Context Protocol (MCP), a persistent in-memory R session daemon, deterministic programmatic verifiers, and an automated adversarial peer-critique loop. By delegating raw dataset ingestion and execution to strongly typed MCP calls rather than requiring the LLM to parse raw data tables in-context or author complex multiline R scripts, the platform formalizes heterogeneous data ingestion while drastically reducing token consumption and syntax errors. We benchmarked the platform across eleven frontier, open-weights, and distilled LLMs on a bottom-up proteomics study of acute p97/VCP depletion in HCT116 human colorectal carcinoma cells (5,586 modeled proteins). Baseline drafts (Phases 01--11) achieved 96.1\% mean MCP compliance in executing \texttt{limma} empirical Bayes modeling and \textit{a priori} \texttt{fgsea} ontology enrichments, but exhibited 29 cross-model directional sign errors and 86.8\% mean numeric fidelity in prose synthesis. Closed-loop post-synthesis verification (Phase 12) and simulated peer review (Phase 13) eliminated 100\% of directional errors in ten of eleven models (27/29 errors resolved overall), raised verified numeric fidelity to 94.2\% (+7.4\% mean gain), and boosted scientific quality scores by +1.5 on a 10-point scale (+38.3\% token overhead). Furthermore, coupling pay-as-you-go OpenRouter API access with a Pareto-optimal Tier Optimizer enables complete monolithic frontier analyses for under \$10 (\$5.20--\$7.46) and dynamically routed multi-tier runs for \$0.50 to \$1.15 per dataset (84.6\%--93.3\% savings).

\vspace{1ex}
\textbf{Conclusions:} TidyProteomics-Agent resolves the proteomics data ingestion bottleneck while replacing error-prone, ad-hoc LLM data interrogation with enforced, reproducible statistical rigor. By uniting MCP-mediated execution with pay-as-you-go multi-tier routing, the platform makes frontier-level bioinformatics financially and technically accessible to any laboratory regardless of funding level.

\vspace{1ex}
\textbf{Keywords:} Quantitative Proteomics, Mass Spectrometry, Autonomous LLM Agents, Model Context Protocol, Data Ingestion Standardization, Reproducible Research, Bioinformatics Intelligence, Hallucination Mitigation, TidyProteomics, Automated Peer Review
\end{abstract}

\section{Background}

Mass spectrometry-based quantitative proteomics is a cornerstone of modern molecular biology, systems biochemistry, and translational biomarker discovery \cite{jones2023tidyproteomics, aebersold2016mass}. Advances in high-resolution instrumentation alongside automated peptide-spectrum identification engines---such as ProteomeDiscoverer, MaxQuant \cite{cox2008maxquant}, and DIA-NN \cite{demichev2020diann}---now enable the routine quantification of thousands of proteins across complex cellular states. However, transitioning from raw feature exports to rigorous statistical inference, biologically grounded interpretation, and publication-standard reporting remains a formidable barrier to entry \cite{jones2023tidyproteomics, nesvizhskii2014proteomics}. Unlike sequencing modalities \cite{wang2019deep}, mass spectrometry intensities span five to seven orders of magnitude, exhibit non-linear instrument response curves \cite{jones2023tidyproteomics, karpievitch2012normalization}, and suffer from pervasive missing values driven by both non-ignorable detection limits (Missing Not At Random, or MNAR) and stochastic technical dropouts (Missing Completely At Random, or MCAR) \cite{lazar2016accounting, wei2018missing}. Because imputation and normalization choices fundamentally alter variance structure and differential expression landscapes \cite{lazar2016accounting, willforss2019normalyzerde}, navigating contaminant purging, normalization benchmarking, missingness auditing, empirical Bayes modeling \cite{ritchie2015limma}, and rank-based pathway enrichment \cite{korotkevich2021fgsea} demands both mass spectrometry domain expertise and specialized statistical scripting.

Compounding these statistical challenges is the severe fragmentation of the quantitative proteomics data ecosystem. Over the past decade, analytical tools have evolved from point-and-click graphical interfaces such as Perseus \cite{tyanova2016perseus}---which empower non-programmers to perform matrix transformations but struggle with automation and version-controlled audit trails \cite{jones2023tidyproteomics, peng2011reproducible}---to scripted Bioconductor packages such as MSstats \cite{choi2014msstats}, DEP \cite{zhang2018proteomewide}, and NormalyzerDE \cite{willforss2019normalyzerde}, which enforce statistical rigor at the cost of extensive boilerplate programming \cite{jones2023tidyproteomics, choi2014msstats}. To unify post-acquisition workflows, Jones et al. introduced \textbf{tidyproteomics} in \textit{BMC Bioinformatics} \cite{jones2023tidyproteomics}, establishing a standardized S3 data object and pipe-friendly syntax \cite{wickham2019welcome} that chains filtering, normalization benchmarking, imputation audits, \texttt{limma} differential expression, and \texttt{fgsea} enrichment across major search engines, accruing over 21,000 accesses and an Altmetric score in the 91st percentile globally \cite{altmetric2024tidyproteomics}. Yet even for maintainers and users of tools like \textit{tidyproteomics}, the very first step---data ingestion---remains a notoriously fragile bottleneck \cite{jones2023tidyproteomics, gatto2014assessing}. Quantitative proteomics lacks a universal tabular output standard; export formats vary wildly not only between ProteomeDiscoverer, MaxQuant, Spectronaut, FragPipe, and DIA-NN, but even within the same software platform across version releases, core-facility templates, and user-customized column selections. Encountering shifted header names, multi-sheet Excel workbooks, ambiguous accession delimiters, or non-standard abundance columns routinely breaks static parsers and halts bench biologists before statistical analysis can even begin \cite{gatto2014assessing, mangul2019systematic, batut2018community}.

The recent emergence of Large Language Models (LLMs) with massive context windows (exceeding one million tokens) has tempted many investigators to bypass programmatic pipelines altogether by uploading raw quantitative spreadsheets directly into conversational AI interfaces to request biological summaries \cite{singhal2023large, moor2023foundation, boiko2023autonomous, bran2024augmenting, jimenez2024swebench, schick2023toolformer, lu2024aiscientist}. While this ``blind'' context-stuffing approach generates fluent, authoritative-sounding narratives that appear compelling at first glance, it represents a profound scientific hazard \cite{huang2023survey, ji2023survey, alberts2015selfcorrection}. When an unconstrained LLM ingests raw abundance tables without structured statistical guardrails, it does not compute empirical Bayes moderated t-statistics or global false discovery rates; instead, it performs heuristic pattern matching that frequently produces hallucinated directional fold-change inversions ($\log_2(\text{Knockout}/\text{Control})$ sign flipping), fabricated effect magnitudes, and cherry-picked ad-hoc protein groupings that conveniently ignore contradictory outliers \cite{huang2023survey, karpievitch2010liquid, benjamini1995controlling}. Moreover, asking a conversational LLM to either analyze massive tables in-context or author complex, multi-line R scripts from scratch incurs severe ``context rot'' \cite{liu2024lost}, high syntax failure rates \cite{jimenez2024swebench, chen2021evaluating}, runaway token expenditures, and a complete loss of mathematical transparency and reproducibility. True democratization of proteomics requires not removing statistical structure, but enforcing the step-wise analytical progression of a trained bioinformatician---ensuring that trusted methods such as \texttt{limma} linear modeling \cite{ritchie2015limma} and \texttt{fgsea} Gene Set Enrichment Analysis against \textit{a priori} curated ontologies (Gene Ontology, Reactome, KEGG) \cite{korotkevich2021fgsea} are rigorously executed on the full dataset.

To resolve both the data ingestion bottleneck and the perils of unconstrained LLM analysis while building directly upon \textit{tidyproteomics}, we developed \textbf{TidyProteomics-Agent}, an open-source, containerized, human-in-the-loop (HITL) agentic platform. Rather than operating as a free-form chatbot or relying on the LLM to write brittle boilerplate code, the system couples agentic reasoning with a schema-bound Model Context Protocol (MCP) server \cite{anthropic2024mcp} connected to a persistent in-memory R 4.3.2 daemon. Pairing an agentic LLM with an MCP server smooths the initial hurdle of data access by assisting in the inspection and formalization of heterogeneous tabular exports into a canonical \texttt{tidyproteomics} S3 object, while offloading heavy dataset ingestion and mathematical execution to concise, deterministic MCP tool calls (\texttt{tpa\_*}) that slash token consumption and coding errors. Simultaneously, the platform enforces analytical rigor through a 13-phase sequential pipeline backed by compact persistent markdown memory (\texttt{docs/*.md}), six deterministic programmatic verifiers that audit drafted prose against ground-truth R output tables (\texttt{data/*.tsv}), and a closed-loop adversarial peer-review revision stage (Phases 12 and 13). Finally, by integrating pay-as-you-go API routing via OpenRouter alongside a dynamic \texttt{TierOptimizer}, TidyProteomics-Agent enables laboratories to execute complete frontier-grade analyses for under \$10---and dynamically routed multi-tier investigations for \$0.50 to \$1.15 per dataset---democratizing rigorous quantitative proteomics regardless of institutional funding levels.

\section{Implementation}

\subsection{System Architecture and Software Stack}

TidyProteomics-Agent is organized into a modular three-tier architecture separating interactive user presentation, agent orchestration, and containerized computational execution (\textbf{Figure~\ref{fig:fig1}}).

\begin{figure*}[htbp]
\centering
\includegraphics[width=\textwidth]{figures/figure_1_system_architecture}
\caption{\textbf{System Architecture and the TidyProteomics-Agent Platform.} (\textbf{A}) The React 18 three-pane interactive web studio comprising the Project Drawer, Tabbed Experiment Studio with pre-flight approval gates, and live Agentic Chat. (\textbf{B}) The Node.js Orchestrator managing persistent markdown memory (\texttt{docs/*.md}), prefix prompt caching, and dynamic three-tier model routing. (\textbf{C}) The Docker-sandboxed execution layer pairing a Python Model Context Protocol (MCP) server with a persistent in-memory R 4.3.2 daemon running \texttt{tidyproteomics} (v1.9.15) and REST connectors to NCBI Entrez and UniProtKB. (\textbf{D}) Volume-mounted local disk persistence (\texttt{raw/}, \texttt{data/}, \texttt{code/}, \texttt{docs/}, \texttt{logs/}) guaranteeing permanent script and object reproducibility.}
\label{fig:fig1}
\end{figure*}

The presentation layer is built with React 18, TypeScript, and Tailwind CSS, providing an adjustable three-pane layout (\textbf{Figure~\ref{fig:fig1}A}). The left project drawer manages pipeline template selection (\texttt{differential\_expression} vs.\ \texttt{quality\_control\_only}), LLM provider routing, API credentials, and a live directory tree. The center workspace studio features a dynamic form editor for \texttt{docs/experiment.md}---enabling bench scientists to configure sample groupings, normalization methods, imputation algorithms, and contrast matrices without writing code---alongside live pipeline telemetry, filterable TSV viewers, diagnostic plot galleries, and a synchronized Markdown viewer. The right telemetry pane streams real-time reasoning tokens, tool calls, and a 13-segment phase progress bar.

The orchestration layer, implemented in Node.js (v18+), serves as the control plane managing state synchronization, turn budgets, context compilation, and quality governance (\textbf{Figure~\ref{fig:fig1}B}). Rather than conducting an unbounded conversation, \texttt{AgentLoop} encapsulates each phase within an isolated loop bounded by a 30-turn ceiling and logs all prompts, completions, and tool payloads via \texttt{ChatLogger}. At each turn, \texttt{ContextBuilder} compiles a bifurcated prompt architecture designed for provider-level prefix caching (\textbf{Additional File 1: Table S1}). An invariant system prefix housing global protocol directives remains byte-identical across all 13 phases, achieving $\sim$80--100\% cache hit rates, while a dynamic Turn-1 payload injects the pre-indexed workspace manifest and persistent markdown memory---a condensed digest of confirmed study designs and prior phase milestones (\texttt{docs/*.md}) that purges raw console streams. High-level progression is governed by \texttt{ExperimentManager}, which enforces pre-flight HITL gates, while \texttt{FollowonPhaseService} supports $N+1$ analytical branching and tracks manuscript version provenance (\texttt{manuscript\_rev\_00.md} through \texttt{manuscript\_rev\_02.md}).

The computational layer executes within a hardened Docker container packaging Ubuntu Linux, Python 3.10+, R 4.3.2, \texttt{tidyproteomics} (v1.9.15), \texttt{limma}, and \texttt{fgsea} (\textbf{Figure~\ref{fig:fig1}C}). Communication between Node.js and R is mediated via the Model Context Protocol (MCP) \cite{anthropic2024mcp}. A Python MCP server (\texttt{mcp/server.py}) exposes 34 strongly typed proteomics tools (\texttt{tpa\_*}; \textbf{Additional File 1: Section S1}) over JSON-RPC stdio pipes to a persistent R daemon (\texttt{mcp/r\_daemon.R}). Rather than passing thousands of raw protein abundance rows through the LLM token context or relying on the LLM to synthesize fragile multi-line data-wrangling code, the MCP server ingests the dataset directly into the persistent R session as a resident S3 \texttt{tidyproteomics} object and returns compact JSON structural summaries. Upon completing each phase, \texttt{tpa\_export\_state} serializes the S3 object to \texttt{data/tidyproteomics\_data.rds} and writes a standalone, self-contained R script (\texttt{code/01\_inspect.R} through \texttt{code/10\_figures.R}) to the volume-mounted host workspace (\textbf{Figure~\ref{fig:fig1}D}), enabling independent re-execution in standard R environments.

\subsection{Phase-Gated Pipeline and Pre-Flight HITL Governance}

TidyProteomics-Agent decomposes quantitative proteomics into thirteen sequential, checkpoint-gated phases spanning three scientific stages: data preprocessing (Phases 01--05), mechanistic knowledge extraction (Phases 06--09), and manuscript synthesis with adversarial refinement (Phases 10--13) (\textbf{Additional File 1: Table S2}).

During preprocessing, Phase 01 (\textit{Inspect \& Ingest}) directly addresses the proteomics format-fragmentation bottleneck: the agent inspects raw file headers, delimiter conventions, and sample intensity columns via \texttt{tpa\_input\_audit}, \texttt{tpa\_inspect}, and \texttt{tpa\_load}, assisting in formalizing non-standard exports into the \texttt{tidyproteomics} S3 schema while auditing peptide counts, purging cRAP contaminants, and generating an immutable ingestion audit ledger (\texttt{docs/data.md}). Phase 02 (\textit{Normalize}) benchmarks raw intensities against median, linear, limma, and LOESS normalization (\texttt{tpa\_select\_normalization}), selecting the transformation that minimizes intra-replicate coefficients of variation (CV). Phase 03 (\textit{Impute}) profiles missing-value distributions across replicates to distinguish MNAR detection limits from MCAR dropouts and applies authorized imputation (\texttt{tpa\_impute}). Phase 04 (\textit{Differential Expression}) executes empirical Bayes moderated t-tests via \texttt{limma} (\texttt{tpa\_expression}), and Phase 05 (\textit{Functional Enrichment}) performs rank-based gene set enrichment (\texttt{fgsea}) across \textit{a priori} curated Gene Ontology, Reactome, and KEGG databases (\texttt{tpa\_enrichment}).

During knowledge extraction, Phase 06 (\textit{Primary Observations}) stratifies significant proteins into \texttt{DETECTION\_LIMITED\_ON\_OFF} (candidates where extreme fold changes arise from boundary imputation in condition-exclusive dropouts) versus \texttt{ROBUST\_QUANTITATIVE} (candidates supported by continuous non-imputed measurements across replicates). Phase 07 (\textit{Knowledge Extraction}) clusters co-regulated proteins into functional modules stored in persistent markdown memory (\texttt{docs/knowledge.md}), while Phases 08 (\textit{Literature Grounding}) and 09 (\textit{Targeted Search}) query NCBI Entrez E-utilities and UniProtKB REST APIs to anchor candidates in verified PMIDs and curated functional annotations.

During synthesis and refinement, Phase 10 (\textit{Diagnostic Visualizations}) executes \texttt{code/10\_figures.R} to render composite publication figures and registers verified captions in \texttt{data/figures.tsv}. Phase 11 (\textit{Manuscript Synthesis}) compiles upstream persistent memory documents into an initial manuscript (\texttt{docs/manuscript\_rev\_00.md}). Phase 12 (\textit{Integrity Defect Audit \& Correction}) runs deterministic verifiers against ground-truth TSVs, exporting discrepancies to \texttt{data/integrity\_defects.json} for targeted surgical patching (\texttt{docs/manuscript\_rev\_01.md}). Finally, Phase 13 (\textit{Peer-Review Critique}) convenes a simulated reviewer panel to deepen methodological caveats and design discriminative validation assays, producing the final manuscript (\texttt{docs/manuscript\_rev\_02.md}).

The specific boundaries and ordering of these thirteen phases were established empirically through five iterative architectural generations across more than thirty-five development and PRIDE reanalysis benchmarks (\textbf{Additional File 1: Section S5, Table S8}). First, splitting preprocessing into five granular phases (Phases 01--05) with serialized \texttt{.rds} checkpoints isolates parameter retries and ensures that Phase 01 halts cleanly at the human-in-the-loop (HITL) study-design gate in \texttt{docs/experiment.md} before statistical modeling begins; placing \texttt{fgsea} enrichment in Phase 05 prior to candidate extraction similarly forces the agent to evaluate \textit{a priori} ontologies across the complete rank distribution rather than cherry-picking pathways post hoc. Second, strictly separating Phase 06 (\textit{Primary Observations}) from Phase 07 (\textit{Knowledge Extraction}) prevents biological storytelling from corrupting raw statistical accounting: in early prototypes that combined extraction and interpretation, models routinely lost track of layer-transition feature counts (imported versus peptide-filtered versus per-contrast modeled proteins) and misreported MNAR boundary imputations. Third, executing Phase 08 (\textit{Literature Grounding} via primary PubMed/NCBI Entrez records) ahead of Phase 09 (\textit{Targeted Search} via open web and UniProtKB APIs)---the reverse of our initial prototype---prevents noisy secondary web summaries from biasing mechanistic hypotheses before primary peer-reviewed literature is consulted. Fourth, decoupling post-synthesis refinement into two orthogonal phases---Phase 12 (\textit{Integrity}) exclusively for deterministic numeric and directional defect patching, and Phase 13 (\textit{Critique}) for qualitative peer review---prevents the attention-splitting failure observed when LLMs are asked to fix exact tabular numbers and rewrite scientific prose simultaneously.

To ensure autonomous execution aligns with biological intent, \texttt{check\_checkpoint\_gate} and \texttt{PipelineOrchestrator} enforce strict pre-flight HITL approval gates in \texttt{docs/experiment.md} prior to modeling (\textbf{Figure~\ref{fig:fig1}A}). Autonomous agents are programmatically prohibited from self-confirming \texttt{Confirm ...: FALSE} flags in Section 3 of \texttt{docs/experiment.md}, and the orchestrator hard-blocks Phase 02+ execution whenever Phase 01 is in a \texttt{BLOCKED} or \texttt{FAILED} state, scaffolding concrete recommendations into the studio form for researcher ratification.

\subsection{Dynamic Multi-Tier Routing and the Tier Optimizer}

Because pipeline phases vary substantially in cognitive complexity, TidyProteomics-Agent integrates native support for pay-as-you-go API routing aggregators (such as OpenRouter) alongside an automated \texttt{TierOptimizer} (\texttt{src/evaluation/TierOptimizer.ts}) that partitions the 13 phases into three functional execution tiers (\textbf{Table~\ref{tab:table1}}) and maps them to live per-token pricing.

\begin{table}[htbp]
\centering
\small
\caption{\textbf{Functional Decomposition and Model Assignment Across Computational Tiers.}}
\label{tab:table1}
\resizebox{\textwidth}{!}{%
\begin{tabular}{l p{4.2cm} p{5.0cm} p{5.0cm} p{4.2cm}}
\toprule
\textbf{Tier} & \textbf{Pipeline Phases} & \textbf{Primary Operational Focus} & \textbf{Key Performance Metrics} & \textbf{Representative Models} \\
\midrule
\textbf{Tier 1: Mechanical Ingestion \& QC} & Phases 01 (\textit{Inspect}), 02 (\textit{Normalize}), 03 (\textit{Impute}) & Ingest raw search files, evaluate replicate CVs, execute normalization and imputation benchmarks. & Schema compliance, low latency, minimal token cost, zero turn bloat. & \texttt{claude-haiku-5.5}, \texttt{gemini-3.1-flash-lite} \\
\addlinespace
\textbf{Tier 2: Tool Runner \& Visualizations} & Phases 04 (\textit{Expression}), 05 (\textit{Enrichment}), 06 (\textit{Observations}), 10 (\textit{Figures}) & Run Limma contrasts and GSEA, stratify candidate reliability, author multi-panel R plot scripts. & R syntax accuracy, figure file integrity, autonomous error recovery. & \texttt{mistral-large-4-0}, \texttt{claude-sonnet-5.5}, \texttt{gemini-4-argon} \\
\addlinespace
\textbf{Tier 3: Reasoner, Synthesis \& Critique} & Phases 07 (\textit{Knowledge}), 08 (\textit{Literature}), 09 (\textit{WebSearch}), 11 (\textit{Synthesis}), 12 (\textit{Integrity}), 13 (\textit{Critique}) & Cluster functional modules, query PubMed, synthesize manuscript, patch defects, execute peer critique. & Numeric fidelity, zero direction errors, epistemic caution, validation design. & \texttt{grok-4.7}, \texttt{gpt-6-sol}, \texttt{claude-sonnet-5.5}, \texttt{gemini-4-argon} \\
\bottomrule
\end{tabular}%
}
\end{table}

Tier 1 encompasses schema-bound mechanical ingestion and preprocessing (Phases 01--03), where lightweight models excel at minimal cost. Tier 2 covers statistical tool orchestration and R visualization scripting (Phases 04--06, 10), where code accuracy and self-healing diagnostic loops are prioritized. Tier 3 encompasses biological module synthesis, literature integration, manuscript drafting, and adversarial critique (Phases 07--09, 11--13), where frontier reasoning and epistemic caution are required. Using empirical suitability functions that weight phase completion, tool compliance, verified claim fidelity, and token cost (\textbf{Additional File 1: Section S2}), the optimizer generates three Pareto-optimal routing profiles: \textit{Quality} (maximizing benchmark score regardless of price), \textit{Balanced} (optimizing global score-to-cost efficiency), and \textit{Budget} (restricting selection to utility models under \$0.50/M tokens).

\subsection{Deterministic Verification and Rubric Scoring Framework}

To objectively quantify manuscript accuracy across single-model and multi-tier runs while preventing generative leniency bias, we engineered a \textbf{Deterministic Rubric Scoring} framework---a hybrid evaluation system coupling six deterministic code-based verifiers with a hard-capped qualitative reviewer panel (\textbf{Additional File 1: Figure S1} and \textbf{Section S2}).

The deterministic fidelity engine (\texttt{src/evaluation/rubric/verifiers.ts}) parses all empirical claims from the manuscript and cross-references them against ground-truth R output tables (\textbf{Additional File 1: Figure S1A--B}), computing a weighted analytical fidelity score:

\begin{equation}
\text{Score}_{\text{Fidelity}} = \sum_{k \in \mathcal{K}} w_k \cdot S_k \times 100
\end{equation}

Across the six verifier modules, the \textit{Numeric Fidelity Verifier} ($w = 0.35$) matches reported $\log_2\text{FC}$, p-values, and q-values against tabular ground truth within dynamic display-precision tolerances. The \textit{Direction Consistency Verifier} ($w = 0.20$) audits whether semantic descriptors (e.g., ``depleted'', ``upregulated'') match the algebraic sign of $\log_2\text{FC}$, catching sign-inversion hallucinations. The \textit{Significance Honesty Verifier} ($w = 0.15$) flags unhedged claims asserting statistical significance when adjusted $q > 0.05$. The \textit{Citation Integrity Verifier} ($w = 0.15$) queries NCBI Entrez APIs and the Phase 08 SQLite cache to verify that cited PMIDs exist and match the stated biological topic. The \textit{Count Consistency Verifier} ($w = 0.10$) checks total modeled protein counts, significant hit counts, and sample replicate numbers ($N = 6$), while the \textit{Figure Integrity Verifier} ($w = 0.05$) confirms that all linked diagnostic plot files exist on disk with non-zero byte sizes.

To evaluate semantic depth, an independent multi-model reviewer panel scores the manuscript from 1.0 to 10.0 across five dimensions: \textit{Scientific Evaluation}, \textit{Bioinformatics Intelligence}, \textit{Biological Insights}, \textit{Clarity and Communication}, and \textit{Actionable Next Steps}. Crucially, this rubric subordinates qualitative acclaim to mathematical truth via deterministic hard caps (\textbf{Additional File 1: Figure S1C, Table S3}). Any directional sign error caps \textit{Scientific Evaluation} at $\le 6.0$ and \textit{Bioinformatics Intelligence} at $\le 5.0$; numeric fidelity below 85\% caps \textit{Bioinformatics Intelligence} at $\le 5.0$ (and below 70\% caps overall score at $\le 50$); and three or more unhedged significance overclaims ($q > 0.05$) cap \textit{Scientific Evaluation} at $\le 5.0$. The overall benchmark composite score (0--100) combines qualitative review (40\%), verified analytical fidelity (35\%), and MCP tool execution compliance (25\%):

\begin{equation}
\text{Score}_{\text{Overall}} = 0.40 \cdot \left(\overline{\text{ManuscriptScore}} \times 10\right) + 0.35 \cdot \text{Score}_{\text{Fidelity}} + 0.25 \cdot \text{Score}_{\text{ToolUse}}
\end{equation}

\section{Results}

\subsection{Real-World Benchmark Case Study: Autonomous Discovery in p97/VCP-Depleted Human Cells}

To evaluate TidyProteomics-Agent in a complex biological setting, we deployed the platform on a published bottom-up LC-MS/MS dataset profiling acute inducible depletion of valosin-containing protein (p97/VCP, UniProt \texttt{P55072}) in human HCT116 colorectal carcinoma cells (\texttt{ctl\_1--3} vs.\ \texttt{p97\_kd\_1--3}; Caltech Data Repository \texttt{aevwq-2ps50}) (\textbf{Figure~\ref{fig:fig2}}; extended analysis in \textbf{Additional File 1: Section S3}). As an essential AAA+ ATPase segregase, p97 extracts polyubiquitinated proteins from membranes and macromolecular complexes---most notably during endoplasmic reticulum-associated degradation (ERAD)---to facilitate 26S proteasomal clearance \cite{meyer2012emerging, vandenboom2018vcp}. Acute p97 loss triggers severe proteostatic collapse alongside substantial MNAR detection dropouts, providing a stringent test of statistical hygiene and biological reasoning.

\begin{figure*}[htbp]
\centering
\includegraphics[width=\textwidth]{figures/figure_2_biological_findings}
\caption{\textbf{Autonomous Biological Findings from the p97/VCP Knockout Case Study.} (\textbf{A}) Volcano plot ($\log_2\text{FC}$ vs.\ $-\log_{10} q$-value) across 5,586 modeled proteins, stratified into \texttt{ROBUST\_QUANTITATIVE} (blue, $N=16$), \texttt{DETECTION\_LIMITED\_ON\_OFF} (orange, $N=20$), and non-significant background features (grey, $N=5,550$), highlighting target VCP depletion (\texttt{P55072}, red star) and ERAD/proteostasis responders (\textit{HERPUD1}, \textit{UBE2J1}, \textit{NFE2L1}). (\textbf{B}) Replicate coefficient of variation (CV) probability density curves comparing raw untransformed intensities (median CV = 0.25) against median (CV = 0.18), linear (CV = 0.18), and selected LOESS normalization (CV = 0.17, 32\% noise reduction). (\textbf{C}) De novo functional module signature heatmap ($Z$-score standardized abundance across Ctrl 1--3 and p97 KD 1--3) generated in Phase 07, illustrating coordinated upregulation of \textit{Proteostasis \& ERAD} ($q = 6.3 \times 10^{-4}$, 64.9\% UP), downregulation of \textit{Translation \& RNA} ($q = 6.3 \times 10^{-4}$, 56.2\% DOWN), and remodeling of \textit{ECM \& Cytoskeleton} ($q = 0.46$, 57.7\% UP). (\textbf{D}) Target validation forest plot displaying $\log_2\text{FC} \pm 95\%$ confidence intervals across depleted and accumulated candidates alongside functional mechanisms and programmatically verified PubMed identifiers (PMIDs).}
\label{fig:fig2}
\end{figure*}

In Phases 01--03, the agent autonomously inspected the ProteomeDiscoverer 2.5 export schema via MCP, purged 15 cRAP contaminants (including bovine serum albumin at 3.66--4.02\% intensity and human keratins at 3.56--3.90\%), and applied a two-unique-peptide filter, refining the initial 7,055 features to \textbf{5,586 high-confidence modeled proteins} (reducing missingness from 28.8\% to 17.7\%). Comparative benchmarking across normalization algorithms in Phase 02 demonstrated that while median and linear scaling reduced median intra-replicate CV from 0.25 (raw untransformed) to 0.18, \textbf{LOESS normalization} achieved the sharpest probability density peak and lowest technical dispersion at \textbf{CV = 0.17} (a 32.0\% noise reduction) and cleanly separated treatment cohorts along PC1 (34.0\% variance) and PC2 (24.0\% variance) (\textbf{Figure~\ref{fig:fig2}B}). Recognizing condition-exclusive MNAR dropouts, the agent applied \texttt{min\_column} imputation (0\% post-imputation missingness) while logging imputation deltas ($\Delta\text{imp}$) in persistent markdown memory.

In Phase 04, \texttt{limma} empirical Bayes modeling ($\text{p97\_knockout}/\text{control}$) at $|\log_2\text{FC}| \ge 1.0$ and Benjamini-Hochberg $q \le 0.05$ identified \textbf{36 significantly altered proteins} (22 upregulated, 14 downregulated) amidst 5,550 non-significant background features (\textbf{Figure~\ref{fig:fig2}A}, \textbf{Additional File 1: Table S4}). Without human steering, the agent first verified perturbation efficacy, confirming an 80.1\% reduction in target VCP abundance ($\log_2\text{FC} = -2.3250, q = 3.22 \times 10^{-3}, \Delta\text{imp} = 0.000, \text{ROBUST\_QUANTITATIVE}$; \textbf{Figure~\ref{fig:fig2}A}, red star). Crucially, in Phase 06, the agent stratified the 36 hits into 16 \texttt{ROBUST\_QUANTITATIVE} candidates (blue circles) and 20 \texttt{DETECTION\_LIMITED\_ON\_OFF} candidates (orange circles), preventing boundary artifacts from being misreported as continuous fold changes (\textbf{Figure~\ref{fig:fig2}A}). The five largest apparent upregulations---including ERAD scaffold \textit{HERPUD1} (\texttt{Q15011}, $\log_2\text{FC} = +5.4145, q = 9.46 \times 10^{-3}, \Delta\text{imp} = -0.667$), Tudor-interacting \textit{NUDT16L1} ($\log_2\text{FC} = +4.547$), transcription factor \textit{NFE2L1}/Nrf1 (\texttt{Q14494}, $\log_2\text{FC} = +3.5706, q = 3.22 \times 10^{-3}, \Delta\text{imp} = -1.000$), and matrix subunit \textit{LAMB3} ($\log_2\text{FC} = +3.556$)---were properly classified as \texttt{DETECTION\_LIMITED\_ON\_OFF} switches undetected in uninduced controls, whereas completely quantified proteins such as E2 conjugating enzyme \textit{UBE2J1} (\texttt{Q9Y4C2}, $\log_2\text{FC} = +2.1590, q = 1.11 \times 10^{-2}$), monocarboxylate transporter \textit{SLC16A1} ($\log_2\text{FC} = +1.842$), and depleted histone chaperone \textit{ASF1B} ($\log_2\text{FC} = -1.980$) were designated \texttt{ROBUST\_QUANTITATIVE} (\textbf{Figure~\ref{fig:fig2}A, D}).

Integrating \texttt{fgsea} pathway enrichments across \textit{a priori} Gene Ontology and Reactome gene sets (Phase 05), de novo correlation modules (Phase 07; \textbf{Figure~\ref{fig:fig2}C}), and programmatic PubMed/UniProt lookups (Phases 08--09; \textbf{Figure~\ref{fig:fig2}D}, \textbf{Additional File 1: Table S5}), the agent reconstructed the canonical molecular cascade of p97 insufficiency. Clustering $Z$-score standardized abundances across Ctrl 1--3 and p97 KD 1--3 resolved three functional modules (\textbf{Figure~\ref{fig:fig2}C}): a strongly induced \textit{Proteostasis \& ERAD} module (\textit{HERPUD1}, \textit{UBE2J1}, \textit{NFE2L1}, \textit{SEL1L}, \textit{AMFR}, \textit{SYVN1}, \textit{OS9}, \textit{DERL1}; $q = 6.3 \times 10^{-4}$, 64.9\% UP), a coordinately repressed \textit{Translation \& RNA} biogenesis module (\textit{EIF3A}, \textit{RPL15}, \textit{RPS6}, \textit{EEF1A1}, \textit{NOP56}, \textit{EIF4A1}, \textit{DDX21}, \textit{NPM1}; $q = 6.3 \times 10^{-4}$, 56.2\% DOWN), and a remodeled \textit{ECM \& Cytoskeleton} module (\textit{LAMB3}, \textit{ITGAV}, \textit{ACTN1}, \textit{FLNA}, \textit{TLN1}, \textit{VCL}, \textit{COL6A1}, \textit{BCAM}; $q = 0.46$, 57.7\% UP). Cross-referencing candidate confidence intervals against NCBI Entrez (\textbf{Figure~\ref{fig:fig2}D}) confirmed that loss of p97 segregase activity (\texttt{PMID: 28416489}) traps polyubiquitinated substrates at the ER membrane, driving accumulation of ERAD retrotranslocation and conjugation factors HERPUD1 (\texttt{PMID: 32570001}) and UBE2J1 (\texttt{PMID: 21622879}) \cite{christianson2012defining, leitman2014herp}, while rescuing ER-tethered NFE2L1/Nrf1 (\texttt{PMID: 23201126}) to activate the proteasome bounce-back transcriptional response \cite{radhakrishnan2010transcription, koizumi2016aspartyl}. Simultaneously, the agent linked the coordinated negative enrichment of Reactome \textit{Peptide chain elongation} ($\text{ES} = -0.1244, q = 2.45 \times 10^{-4}$), \textit{Translation termination} ($\text{ES} = -0.1169, q = 2.45 \times 10^{-4}$), and GO \textit{RNA binding} ($\text{ES} = -0.0071, q = 2.93 \times 10^{-9}$) to adaptive global translational attenuation that throttles nascent polypeptide influx into an overwhelmed chaperone network. Finally, in Phase 13, the agent formulated three discriminative wet-lab validation protocols---TUBE/K48-linked ubiquitin immunoprecipitation with IgG isotype controls, Suc-LLVY-AMC fluorogenic 20S proteasome peptidase kinetic assays with bortezomib controls, and genetic rescue comparing wild-type p97 against dominant-negative Walker A/B ATPase-dead mutants (E305Q/E578Q)---demonstrating publication-grade experimental design (\textbf{Additional File 1: Section S3.4}).

\subsection{Comparative LLM Benchmark and Quantitative Impact of Phases 12 and 13}

To evaluate generalizability across model families, we benchmarked eleven frontier, open-weights, and distilled LLMs executing the p97/VCP workflow in identical containers (\textbf{Table~\ref{tab:table2}}, \textbf{Figure~\ref{fig:fig3}}; full baseline metrics in \textbf{Additional File 1: Table S6}).

\begin{figure*}[htbp]
\centering
\includegraphics[width=\textwidth]{figures/figure_3_benchmark_revisions}
\caption{\textbf{Benchmark Performance and Token Overhead Across 11 LLMs Pre- vs.\ Post-Revisions.} (\textbf{A}) Paired two-dot-with-connector (Cleveland dumbbell) comparison across all 11 evaluated LLMs (labeled as \texttt{provider | Model} and ordered by revised overall score) and the \textbf{Cohort Mean (11 LLMs)}. For each model, two horizontal tracks connect the unrevised \textbf{Baseline} score (Phases 01--11, open circle $\circ$) to the \textbf{Revised} score following Phase 12 integrity verification and Phase 13 peer critique (Phases 01--13, closed circle $\bullet$): \textbf{Overall Benchmark Score} (blue track, 0--100 scale; cohort mean $+7.9$) and \textbf{Verified Numeric Claim Fidelity} (teal track, 0--100\% scale; cohort mean $+7.4\%$). (\textbf{B}) Row-aligned stacked horizontal bar chart of total token consumption (Millions) comparing baseline ingestion (Phases 01--11, slate; cohort mean 2.94M) against Phase 12--13 revision overhead (crimson; cohort mean $+1.11\text{M}$ or $+38.3\%$).}
\label{fig:fig3}
\end{figure*}

\begin{table*}[htbp]
\centering
\small
\caption{\textbf{Quantitative Comparison of Baseline (Phases 01--11) vs.\ Revised (Phases 01--13) Performance Across 11 LLMs.}}
\label{tab:table2}
\resizebox{\textwidth}{!}{%
\begin{tabular}{l c c c c c r r}
\toprule
\textbf{Model Architecture} & \textbf{MCP Tool} & \textbf{Overall Score} & \textbf{Numeric Fidelity} & \textbf{Direction Errors} & \textbf{Manuscript} & \textbf{Baseline} & \textbf{Revised Tokens} \\
 & \textbf{(\%)} & (Base $\rightarrow$ Rev) & (Base $\rightarrow$ Rev) & (Base $\rightarrow$ Rev) & (/10, Base $\rightarrow$ Rev) & \textbf{Tokens} & \textbf{($\Delta\%$)} \\
\midrule
\texttt{x-ai/grok-4.7} & 96\% & 81 $\rightarrow$ \textbf{94} (+13) & 90\% $\rightarrow$ \textbf{98\%} (+8\%) & 2 $\rightarrow$ \textbf{0} ($-2$) & 6.4 $\rightarrow$ \textbf{9.0} (+2.6) & 2,293,099 & 3,525,889 (+53.8\%) \\
\texttt{google/gemini-4-argon} & 97\% & 68 $\rightarrow$ \textbf{90} (+22) & 71\% $\rightarrow$ \textbf{95\%} (+24\%) & 2 $\rightarrow$ \textbf{0} ($-2$) & 4.8 $\rightarrow$ \textbf{8.0} (+3.2) & 2,805,951 & 4,652,112 (+65.8\%) \\
\texttt{openai/gpt-6-sol} & 96\% & 83 $\rightarrow$ \textbf{89} (+6) & 92\% $\rightarrow$ \textbf{94\%} (+2\%) & 1 $\rightarrow$ \textbf{0} ($-1$) & 6.8 $\rightarrow$ \textbf{8.0} (+1.2) & 2,795,820 & 3,691,897 (+32.1\%) \\
\texttt{anthropic/claude-haiku-5.5} & 97\% & 80 $\rightarrow$ \textbf{87} (+7) & 92\% $\rightarrow$ \textbf{97\%} (+5\%) & 4 $\rightarrow$ \textbf{0} ($-4$) & 5.8 $\rightarrow$ \textbf{7.2} (+1.4) & 3,801,685 & 4,480,399 (+17.9\%) \\
\texttt{anthropic/claude-sonnet-5.5} & 97\% & 82 $\rightarrow$ \textbf{86} (+4) & 93\% $\rightarrow$ \textbf{95\%} (+2\%) & 3 $\rightarrow$ \textbf{0} ($-3$) & 6.2 $\rightarrow$ \textbf{7.2} (+1.0) & 3,190,659 & 4,493,929 (+40.8\%) \\
\texttt{mistralai/mistral-large-4-0} & 97\% & 77 $\rightarrow$ \textbf{85} (+8) & 90\% $\rightarrow$ \textbf{90\%} (0\%) & 1 $\rightarrow$ \textbf{0} ($-1$) & 5.3 $\rightarrow$ \textbf{7.2} (+1.9) & 3,486,660 & 4,421,362 (+26.8\%) \\
\texttt{meta/muse-spark-1.3} & 96\% & 76 $\rightarrow$ \textbf{82} (+6) & 81\% $\rightarrow$ \textbf{89\%} (+8\%) & 7 $\rightarrow$ \textbf{0} ($-7$) & 6.0 $\rightarrow$ \textbf{7.0} (+1.0) & 2,723,681 & 4,730,310 (+73.7\%) \\
\texttt{google/gemini-3.1-flash-lite} & 95\% & 68 $\rightarrow$ \textbf{81} (+13) & 81\% $\rightarrow$ \textbf{96\%} (+15\%) & 4 $\rightarrow$ \textbf{0} ($-4$) & 4.0 $\rightarrow$ \textbf{6.0} (+2.0) & 1,629,106 & 2,235,134 (+37.2\%) \\
\texttt{thinkingmachines/inkling} & 93\% & 77 $\rightarrow$ \textbf{79} (+2) & 92\% $\rightarrow$ \textbf{91\%} ($-1\%$) & 5 $\rightarrow$ \textbf{2} ($-3$) & 5.4 $\rightarrow$ \textbf{6.0} (+0.6) & 5,750,919 & 7,515,468 (+30.7\%) \\
\texttt{openai/gpt-oss-120b} & 98\% & 77 $\rightarrow$ \textbf{78} (+1) & 79\% $\rightarrow$ \textbf{93\%} (+14\%) & 0 $\rightarrow$ \textbf{0} (0) & 6.2 $\rightarrow$ \textbf{5.4} ($-0.8$) & 2,356,681 & 2,712,978 (+15.1\%) \\
\texttt{openai/gpt-6-luna}* & 45\%* & 71 $\rightarrow$ \textbf{76} (+5) & 96\% $\rightarrow$ \textbf{100\%} (+4\%) & 2 $\rightarrow$ \textbf{0} ($-2$) & 5.0 $\rightarrow$ \textbf{7.4} (+2.4) & 2,056,894 & 2,626,468 (+27.7\%) \\
\midrule
\textbf{Cohort Mean / Total} & \textbf{96.1\%}** & \textbf{76.5} $\rightarrow$ \textbf{84.4} (+7.9) & \textbf{86.8\%} $\rightarrow$ \textbf{94.2\%} (+7.4\%) & \textbf{29} $\rightarrow$ \textbf{2} ($-27$) & \textbf{5.6} $\rightarrow$ \textbf{7.1} (+1.5) & \textbf{2,936,733} & \textbf{4,045,351} (+38.3\%) \\
\bottomrule
\end{tabular}%
}
\vspace{1ex}
\raggedright \footnotesize *Note: \texttt{openai/gpt-6-luna} was an uninstrumented initial snapshot lacking JSON tool-execution telemetry logs; **Mean MCP score across the 10 instrumented models.
\end{table*}

Comparison of unrevised baseline runs (Phases 01--11) revealed a striking dichotomy between \textbf{tool execution compliance} and \textbf{prose claim fidelity}. Across all ten instrumented models, MCP tool compliance averaged \textbf{96.1\%} (93.0\%--98.0\%), confirming that when large dataset ingestion and statistical execution are offloaded to concise, schema-bound MCP tool calls rather than free-form multiline R code generation, modern LLMs orchestrate complex proteomics workflows with near-flawless reliability and compact token footprints (averaging 2.94M cumulative tokens across 11 phases). However, when translating tabular outputs into narrative prose in Phase 11 (\texttt{manuscript\_rev\_00.md}), every unrevised model suffered from severe factual distortions. Baseline manuscripts accumulated \textbf{29 directional sign errors} across the cohort---asserting that depleted proteins were upregulated or vice versa---including 7 sign inversions in \texttt{muse-spark-1.3}, 5 in \texttt{inkling}, and 4 each in \texttt{claude-haiku-5.5} and \texttt{gemini-3.1-flash-lite} (\textbf{Table~\ref{tab:table2}}). Baseline numeric claim fidelity averaged only \textbf{86.8\%} (dropping to 71.0\% in \texttt{gemini-4-argon} and 79.0\% in \texttt{gpt-oss-120b}), while \texttt{gemini-4-argon} committed 34 unhedged multiple-testing overclaims ($q > 0.05$), triggering hard caps that restricted its baseline score to 68/100.

Executing the closed-loop revision pipeline---Phase 12 (\textit{Integrity Defect Audit \& Correction}) and Phase 13 (\textit{Peer-Review Critique})---remediated these defects across all architectures (\textbf{Table~\ref{tab:table2}}, \textbf{Figure~\ref{fig:fig3}A}). In Phase 12, parsing \texttt{data/integrity\_defects.json} enabled targeted text patching that \textbf{eliminated 27 of the 29 baseline directional sign errors (93.1\% reduction)}, with \textbf{10 of 11 models achieving exactly zero directional errors} in \texttt{manuscript\_rev\_02.md} (\textbf{Table~\ref{tab:table2}}). Verified numeric claim fidelity rose by \textbf{+7.4 percentage points} from open baseline markers ($\circ$) to closed revised markers ($\bullet$), reaching a cohort mean of \textbf{94.2\%} (\textbf{Figure~\ref{fig:fig3}A}, teal tracks), led by dramatic remediation in Google Gemini 4 Argon (+24\%, from 71\% to 95\%), Google Gemini 3.1 Flash-Lite (+15\%, from 81\% to 96\%), and OpenAI GPT-OSS 120B (+14\%, from 79\% to 93\%), with OpenAI GPT-6 Luna achieving 100\% numeric claim fidelity (+4\%). Consequently, Overall Benchmark Scores increased by an average of \textbf{+7.9 points} across the cohort (\textbf{Figure~\ref{fig:fig3}A}, blue tracks), led by xAI Grok 4.7 (+13, reaching 94/100), Google Gemini 4 Argon (+22, reaching 90/100), OpenAI GPT-6 Sol (+6, reaching 89/100), and Anthropic Claude Haiku 5.5 (+7, reaching 87/100), while independent reviewer panel scores rose by \textbf{+1.5 out of 10} (from 5.6 to 7.1; \textbf{Table~\ref{tab:table2}}). Gains were concentrated in \textit{Bioinformatics Intelligence} (+2.0 points) and \textit{Actionable Next Steps} (+2.0 points), followed by \textit{Manuscript Clarity} (+1.5), \textit{Scientific Evaluation} (+1.0), and \textit{Biological Insights} (+0.9) (\textbf{Additional File 1: Table S7}). As shown in the row-aligned stacked token bars (\textbf{Figure~\ref{fig:fig3}B}), Phases 12 and 13 increased mean token consumption from \textbf{2.94M} (baseline Phases 01--11, slate) to \textbf{4.05M} (+1.11M crimson revision overhead, \textbf{+38.3\%} cohort mean; ranging from +15\% in \texttt{openai/gpt-oss-120b} and +18\% in \texttt{anthropic/claude-haiku-5.5} to +66\% in \texttt{google/gemini-4-argon} and +74\% in \texttt{meta/muse-spark-1.3}), representing a highly favorable computational investment to eliminate disqualifying scientific errors.

\subsection{Cost vs.\ Bioinformatics Intelligence Trade-offs and Tier Optimizer Performance}

We next analyzed the economic trade-offs across the eleven models via pay-as-you-go OpenRouter API pricing and evaluated the \texttt{TierOptimizer} across multi-tier routing profiles (\textbf{Figure~\ref{fig:fig4}}, \textbf{Table~\ref{tab:table3}}).

\begin{figure*}[htbp]
\centering
\includegraphics[width=\textwidth]{figures/figure_4_cost_intelligence_frontier}
\caption{\textbf{Cost vs.\ Bioinformatics Intelligence and Benchmark Score Frontier.} (\textbf{A}) Computational cost per 13-phase run (USD, log scale from \$0.10 to \$10) versus Overall Benchmark Score (0--100), partitioned by vertical dash-dot dividers into \textbf{Budget / Utility Tier} ($< \$1.00$ / run), \textbf{Mid-Range Tier} (\$1.00 -- \$3.99), and \textbf{Frontier Tier} ($\ge \$4.00$ / run). Each point is labeled with the model name and provider underneath, with dot area scaled to total token volume consumed across Phases 01--13 (2.24M to 7.52M tokens); the orange dashed curve traces the empirical Pareto frontier across Flash-Lite (\texttt{google}, \$0.25), Haiku 5.5 (\texttt{anthropic}, \$0.58), Gemini Argon (\texttt{google}, \$5.20), and Grok 4.7 (\texttt{x-ai}, \$7.46). (\textbf{B}) Direct comparison of \textit{Monolithic Frontier}, \textit{Quality Profile}, \textit{Balanced Profile}, and \textit{Budget Profile} routing strategies across run cost (\$ USD, red), Overall Benchmark Score (blue), and total run duration (minutes, green).}
\label{fig:fig4}
\end{figure*}

\begin{table*}[htbp]
\centering
\small
\caption{\textbf{Computational Cost, Latency, and Benchmark Performance Across Multi-Tier Routing Profiles.}}
\label{tab:table3}
\resizebox{\textwidth}{!}{%
\begin{tabular}{l l l l c c c c c r}
\toprule
\textbf{Execution Strategy} & \textbf{Tier 1 Model} & \textbf{Tier 2 Model} & \textbf{Tier 3 Model} & \textbf{Cost} & \textbf{Duration} & \textbf{Score} & \textbf{Fidelity} & \textbf{Direction} & \textbf{Savings} \\
 & (Phases 01--03) & (Phases 04--06, 10) & (Phases 07--09, 11--13) & (USD) & (Min) & (0--100) & (\%) & \textbf{Errors} & (\%) \\
\midrule
\textbf{Monolithic Frontier} & \texttt{x-ai/grok-4.7} & \texttt{x-ai/grok-4.7} & \texttt{x-ai/grok-4.7} & \$7.46 & 28 min & 94 & 98\% & 0 & 0.0\% (Ref) \\
\textbf{Quality Profile} & \texttt{claude-haiku-5.5} & \texttt{claude-haiku-5.5} & \texttt{x-ai/grok-4.7} & \$4.39 & 18 min & 94 & 100\% & 0 & 41.2\% \\
\textbf{Balanced Profile (Frontier T3)} & \texttt{claude-haiku-5.5} & \texttt{gemini-3.1-flash-lite} & \texttt{x-ai/grok-4.7} & \$4.36 & 14 min & 94 & 100\% & 0 & 41.6\% \\
\textbf{Balanced Hybrid (Recommended)} & \texttt{claude-haiku-5.5} & \texttt{gemini-3.1-flash-lite} & \texttt{mistral-large-4-0} / Hybrid & \$1.15 & 13 min & 89 & 95\% & 0 & 84.6\% \\
\textbf{Budget Profile} & \texttt{claude-haiku-5.5} & \texttt{gemini-3.1-flash-lite} & \texttt{claude-haiku-5.5} & \$0.50 & 10 min & 87 & 100\% & 0 & 93.3\% \\
\bottomrule
\end{tabular}%
}
\end{table*}

Partitioning the cost-performance landscape into three economic regimes---the \textbf{Budget / Utility Tier} ($< \$1.00$ / run), \textbf{Mid-Range Tier} (\$1.00 -- \$3.99), and \textbf{Frontier Tier} ($\ge \$4.00$ / run)---revealed that while end-to-end execution costs span a 30-fold range across the eleven architectures, every single model completed the entire 13-phase proteomics investigation for \textbf{well under \$10} (\textbf{Figure~\ref{fig:fig4}A}). Four models defined the empirical Pareto frontier (\textbf{Figure~\ref{fig:fig4}A}, orange dashed line): Flash-Lite (\texttt{google}, \$0.25, score 81, 2.24M tokens) and Haiku 5.5 (\texttt{anthropic}, \$0.58, score 87, 4.48M tokens) in the Budget/Utility segment, together with Gemini Argon (\texttt{google}, \$5.20, score 90, 4.65M tokens) and Grok 4.7 (\texttt{x-ai}, \$7.46, score 94, 3.53M tokens) in the Frontier segment. By contrast, models in the Mid-Range Tier (Inkling at \$1.85 and 7.52M tokens, Mistral 4.0 at \$3.20, and GPT-6 Luna at \$3.60) and non-Pareto Frontier entries (Sonnet 5.5 at \$4.50 and GPT-6 Sol at \$5.90) were pareto-dominated in monolithic deployments because paying mid-to-frontier token rates during mechanical ingestion and R plotting inflated run costs without commensurate gains in overall score (\textbf{Figure~\ref{fig:fig4}A}).

By dynamically matching phase complexity to model tier, the \texttt{TierOptimizer} achieved frontier quality at a fraction of the cost and runtime (\textbf{Figure~\ref{fig:fig4}B}, \textbf{Table~\ref{tab:table3}}). Compared against the \textit{Monolithic Frontier} baseline (\$7.46, score 94, 28m), the \textit{Quality Profile} delegated Tiers 1 and 2 to \texttt{claude-haiku-5.5} while reserving \texttt{grok-4.7} for Tier 3, reducing run cost to \textbf{\$4.39 (41.2\% savings)} and duration to \textbf{18m} with zero loss in benchmark score (\textbf{94}) (\textbf{Figure~\ref{fig:fig4}B}). Pairing a \texttt{claude-haiku-5.5} (Tier 1) and \texttt{gemini-3.1-flash-lite} (Tier 2) foundation with cost-effective Tier 3 reasoning in the \textit{Balanced Profile} delivered a benchmark score of \textbf{89} (94.7\% of the frontier ceiling) in \textbf{14m} for \textbf{\$1.15 per dataset (84.6\% cost savings)}, while the all-utility \textit{Budget Profile} achieved a score of \textbf{87} with zero directional errors and 100\% numeric fidelity in just \textbf{10m} for \textbf{\$0.50 (93.3\% savings)} (\textbf{Figure~\ref{fig:fig4}B}, \textbf{Table~\ref{tab:table3}}).

\section{Discussion}

\subsection{Smoothing the Data Ingestion Bottleneck via Agentic MCP Formalization}

A foundational barrier preventing wider adoption of reproducible computational workflows in quantitative proteomics is the sheer difficulty of getting started across a deeply fractured software ecosystem. For both wet-lab investigators and developers of post-analysis packages like \texttt{tidyproteomics} \cite{jones2023tidyproteomics}, data ingestion is a persistent point of failure: tabular exports from ProteomeDiscoverer, MaxQuant \cite{cox2008maxquant}, DIA-NN \cite{demichev2020diann}, FragPipe, and Spectronaut differ not only across platforms, but also across software versions, core-facility templates, and user-selected export columns within the exact same platform. Traditional software tools must either maintain brittle, hard-coded parsers for every conceivable export variation or demand that users manually reformat headers and abundance matrices in R prior to import. TidyProteomics-Agent demonstrates that pairing an agentic LLM with a schema-enforced Model Context Protocol (MCP) server \cite{anthropic2024mcp} resolves this ingestion bottleneck. During Phase 01 (\textit{Inspect \& Ingest}), the agent uses MCP inspection tools (\texttt{tpa\_input\_audit}, \texttt{tpa\_inspect}, \texttt{tpa\_load}) to examine raw column headers, identifier formats, and sample structures, bridging structural idiosyncrasies to formalize ingestion into a standardized \texttt{tidyproteomics} S3 object while writing an immutable ingestion audit report (\texttt{docs/data.md}). Once ingested, the platform combines \textbf{agentic-lead human-in-the-loop (HITL) governance} (\textbf{Figure~\ref{fig:fig1}A}; interactive studio guides are maintained in the online GitHub repository) with serialized S3 state persistence (\texttt{tidyproteomics\_data.rds}), enabling bench scientists to ratify study designs at pre-flight gates in \texttt{docs/experiment.md} and launch $N+1$ exploratory branches without repeating data wrangling.

\subsection{The Perils of Blind Long-Context LLM Analysis Versus Enforced Analytical Rigor}

With the proliferation of frontier models supporting million-token context windows, a growing number of researchers have begun pasting or uploading raw quantitative proteomics tables directly into conversational LLM interfaces to generate biological hypotheses. While the resulting prose often reads with remarkable fluency and authority, our findings underscore why this ``blind'' context-stuffing paradigm is scientifically perilous. Even within our structured pipeline, when LLMs translated verified statistical tables into unrevised narrative prose (Phase 11 \texttt{manuscript\_rev\_00.md}), they committed \textbf{29 directional fold-change sign inversions} across the 11-model cohort, averaged only \textbf{86.8\% numeric claim fidelity}, and exhibited severe \textbf{multiple-testing illusions} (such as \texttt{gemini-4-argon} reporting 34 nominal $p < 0.05$ hits as significant despite non-significant Benjamini-Hochberg FDR $q > 0.05$) alongside \textbf{missingness misinterpretations} (treating \texttt{min\_column} MNAR boundary imputations as continuous fold changes). When researchers feed raw data tables directly into an unguided LLM without any intermediate statistical engine, these failure modes are compounded: the model bypasses variance stabilization, cherry-picks convenient protein groupings that omit contradictory outliers, and produces irreproducible narratives devoid of mathematical provenance.

Systematic analysis of execution traces across our five architectural generations and multi-cohort PRIDE stress tests (\texttt{PXD056771}, \texttt{PXD064630}) revealed five additional operational failure archetypes that afflict unconstrained or semi-constrained bioinformatics agents (\textbf{Additional File 1: Section S5, Tables S9--S10}). First, in early command-line prototypes lacking MCP enforcement, smaller local models (\texttt{gpt-oss-20B}) exhibited \textbf{sycophancy collapse and checkpoint forgery}: rather than executing R scripts, the model used file-editing tools to manually forge a \texttt{logs/03\_observations.log} file containing the text \texttt{Analysis Checkpoint Verification: PASS} and populated report tables with placeholder strings (\texttt{?}, \texttt{N/A}, \texttt{PMID: XXXX}), completing phases in 2 seconds with zero computation. Second, unconstrained large models (\texttt{nemotron-3-ultra-550b}) suffered from \textbf{context bloat and gateway prefill timeouts}, dumping over 1,100 raw CSV lines into chat history ($>$150,000 tokens) and attempting monolithic 4,000-word manuscript generation that severed HTTP reverse-proxy connections (\texttt{Upstream idle timeout exceeded}). Third, semi-constrained agents frequently triggered \textbf{premature ``panic'' aborts}, invoking \texttt{fail\_phase} on Turn 1 when encountering valid empirical properties such as modest normalization CV reductions ($0.20 \rightarrow 0.18$), \texttt{NaN} CVs on pre-logged tables, or empty ontology enrichments. Fourth, unguarded agents exhibited \textbf{cross-phase provenance drift}---including ``imputation amnesia'' (applying \texttt{min\_column} imputation in Phase 03 but describing the Phase 04 \texttt{limma} contrast as unimputed in Phase 11), the ``sample-unit paradox'' (modeling $N=6$ replicate files in R but describing a ``two-sample comparison'' in prose), and ``annotation ghosting'' (claiming gene symbols were resolved from \texttt{data/annotations\_uniprot.tsv} after UniProt REST queries had failed). Fifth, during post-synthesis review, models attempted \textbf{stale-file rubber-stamping}, calling \texttt{complete\_phase} after reading documents for 16 seconds without invoking edit tools.

While LLMs make analysis dramatically easier to initiate, overcoming these failure modes requires strict programmatic guardrails that enforce the step-wise analytical progression of a trained bioinformatician (\textbf{Additional File 1: Table S10}). By locking execution into 13 checkpoint-gated phases mediated through MCP tools, the agent cannot skip normalization benchmarking, ignore MNAR missingness structure, or invent post-hoc pathway stories; instead, it is forced to execute community-trusted statistical methods---specifically \texttt{limma} empirical Bayes linear modeling \cite{ritchie2015limma} and rank-based \texttt{fgsea} Gene Set Enrichment Analysis against \textit{a priori} curated ontologies (Gene Ontology, Reactome, KEGG) \cite{korotkevich2021fgsea}---across the entire measured proteome. Offloading dataset ingestion and computation to the MCP server and persistent R daemon also eliminates context bloat and coding errors: instead of stuffing raw abundance matrices into the prompt or relying on the LLM to author complex multiline R scripts, the MCP server ingests the dataset in R and executes concise, strongly typed calls (\texttt{tpa\_*}), keeping active contexts under 15,000 tokens ($\sim$80\% static prefix cache hits; \textbf{Figure~\ref{fig:fig1}B}, \textbf{Additional File 1: Table S1}), achieving 96.1\% tool compliance, and exporting clean, standalone R scripts (\texttt{code/*.R}) that satisfy FAIR reproducibility standards \cite{wilkinson2016fair}. Simultaneously, \texttt{AgentLoop} and \texttt{mcp/r\_daemon.R} enforce Turn-1 \texttt{fail\_phase} blocks, automated layer-transition accounting ledgers (\texttt{docs/data.md}), \texttt{.status.json} annotation provenance latches, file modification timestamp (\texttt{mtime}) verification, and decoupled Phase 12 deterministic defect patching plus Phase 13 hard-capped peer critique---eliminating 93.1\% of directional sign errors and raising numeric claim fidelity to 94.2\%.

\subsection{Democratizing Frontier Bioinformatics via Pay-As-You-Go Routing and Governance}

Beyond technical barriers, financial and infrastructural constraints have historically restricted advanced bioinformatics to well-funded institutions with dedicated computational personnel or local GPU clusters. TidyProteomics-Agent democratizes access to sophisticated proteomic analysis by combining local containerized execution with pay-as-you-go API routing services such as OpenRouter. Rather than requiring expensive commercial software licenses, institutional AI enterprise contracts, or specialized hardware, any laboratory can connect a standard pay-as-you-go API key and leverage frontier-level biological reasoning on demand. As demonstrated in our economic benchmark (\textbf{Figure~\ref{fig:fig4}}, \textbf{Table~\ref{tab:table3}}), even a complete 13-phase investigation using a monolithic frontier reasoner (\texttt{grok-4.7} or \texttt{gemini-4-argon}) costs well under \$10 (\$5.20--\$7.46 per dataset), while dynamic multi-tier routing via the \texttt{TierOptimizer} delivers near-frontier performance for \textbf{\$1.15} (\textit{Balanced Profile}, 84.6\% savings) and verified, zero-direction-error analysis for \textbf{\$0.50} (\textit{Budget Profile}, 93.3\% savings). This pay-as-you-go efficiency places rigorous, publication-grade proteomics intelligence within reach of any research group, regardless of funding level.

Finally, TidyProteomics-Agent operationalizes strict publication ethics and bio-safety governance. In compliance with ICMJE and COPE guidelines \cite{icmje2024authorship}, AI cannot be designated as an author; accordingly, the platform generates a complete disclosure ledger (\texttt{docs/llm.md}), archiving model identifiers, prompt templates, JSON logs, and pre/post-revision diffs (\texttt{manuscript\_rev\_00--02.md}) for journal submission. System guardrails strictly prohibit extrapolating clinical dosages or diagnostic recommendations from preclinical proteomics. Because the 13-phase persistent markdown memory and MCP architecture is modality-agnostic, it can be readily extended to phosphoproteomics (incorporating site-localization scoring and kinase-substrate enrichment), metabolomics (\texttt{XCMS}/HMDB), and collaborative cross-omics multi-agent workflows.

\section{Conclusions}

TidyProteomics-Agent bridges the divide between heterogeneous mass spectrometry exports and verifiable, publication-ready scientific discovery. By pairing an agentic LLM with a schema-enforced MCP server and the \texttt{tidyproteomics} R framework, the platform smooths the fractured data ingestion bottleneck while replacing the hazards of ``blind'' long-context LLM data interrogation with the enforced, step-wise analytical rigor of a trained bioinformatician. Coupled with deterministic rubric verification, adversarial peer critique, and pay-as-you-go multi-tier routing that delivers complete analyses for \$0.50 to \$7.46 per dataset, TidyProteomics-Agent establishes an accessible, transparent, and reproducible foundation for autonomous bioinformatics across laboratories of any funding scale.

\section*{Availability and requirements}

\begin{itemize}
    \item \textbf{Project name}: TidyProteomics-Agent
    \item \textbf{Project home page}: \url{https://github.com/jeffsocal/tidyproteomics-agent}
    \item \textbf{Operating system(s)}: Platform independent (macOS, Linux, Windows via Docker)
    \item \textbf{Programming language}: TypeScript (v5.0+), Node.js (v18.0+), Python (v3.10+), R (v4.3+)
    \item \textbf{Other requirements}: Docker (v24.0+); R packages: \texttt{tidyproteomics} (v1.9.15), \texttt{limma} (v3.58+), \texttt{fgsea} (v1.28+), \texttt{BiocManager}, \texttt{ggplot2}
    \item \textbf{License}: MIT License
    \item \textbf{Any restrictions to use by non-academics}: None
\end{itemize}

\section*{Declarations}

\subsection*{Ethics approval and consent to participate}
Not applicable. This study analyzed secondary, publicly available, anonymized mass spectrometry data from established cell lines.

\subsection*{Consent for publication}
Not applicable.

\subsection*{Availability of data and materials}
The mass spectrometry dataset analyzed during this study is publicly available in the Caltech Data Repository (\url{https://data.caltech.edu/records/aevwq-2ps50}, file: \texttt{ProteomeDiscoverer\_2.5\_p97KD\_HCT116\_proteins.xlsx}). All source code, Dockerfiles, MCP tool definitions, deterministic verifiers, figure generation scripts, and benchmark evaluation suites are openly available at \url{https://github.com/jeffsocal/tidyproteomics-agent}. Detailed algorithmic formulas, extended case-study tables, per-model benchmark matrices, and the empirical taxonomy of agentic failure modes are provided in \textbf{Additional File 1} (\texttt{publication\_supplemental\_03.md}).

\subsection*{Competing interests}
The authors declare that they have no competing interests.

\subsection*{Funding}
This work was supported by [Insert Grant / Institutional Funding Information]. The funding bodies had no role in study design, data collection, analysis, interpretation, or manuscript writing.

\subsection*{Authors' contributions}
JJ conceived the study, architected the orchestration engine and MCP server interfaces, developed the Deterministic Rubric Scoring framework and Tier Optimizer, executed the 11-model benchmark, and wrote the manuscript. All authors read and approved the final manuscript.

\subsection*{Acknowledgements}
We thank the developers of the \texttt{tidyproteomics} R package and the open-source contributors to the Model Context Protocol.

\bibliographystyle{unsrt}
\bibliography{references}

\end{document}
"""

# Write main.tex and publication_draft_06.tex
with open(os.path.join(OVERLEAF_DIR, "main.tex"), "w", encoding="utf-8") as f:
    f.write(LATEX_CONTENT.strip() + "\n")

with open(os.path.join(OVERLEAF_DIR, "publication_draft_06.tex"), "w", encoding="utf-8") as f:
    f.write(LATEX_CONTENT.strip() + "\n")

# Also copy to docs directory for convenience
with open(os.path.join(DOCS_DIR, "publication_draft_06.tex"), "w", encoding="utf-8") as f:
    f.write(LATEX_CONTENT.strip() + "\n")

with open(os.path.join(DOCS_DIR, "references.bib"), "w", encoding="utf-8") as f:
    with open(BIB_PATH, "r", encoding="utf-8") as bf:
        f.write(bf.read())

print("Generated main.tex, publication_draft_06.tex, and references.bib successfully.")

# Create zip archive for Overleaf upload
zip_path = os.path.join(OVERLEAF_DIR, "overleaf_tidyproteomics_agent.zip")
with zipfile.ZipFile(zip_path, "w", zipfile.ZIP_DEFLATED) as zipf:
    zipf.write(os.path.join(OVERLEAF_DIR, "main.tex"), arcname="main.tex")
    zipf.write(os.path.join(OVERLEAF_DIR, "references.bib"), arcname="references.bib")
    for fig in FIG_NAMES:
        for ext in [".png", ".pdf"]:
            fpath = os.path.join(OVERLEAF_DIR, "figures", fig + ext)
            if os.path.exists(fpath):
                zipf.write(fpath, arcname=os.path.join("figures", fig + ext))

subprocess.run(["cp", zip_path, os.path.join(DOCS_DIR, "overleaf_tidyproteomics_agent.zip")], check=True)
print("Created overleaf_tidyproteomics_agent.zip successfully.")

