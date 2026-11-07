#!/usr/bin/env python3
import os
import subprocess

TARGET_PATHS = [
    "ai_benchmarking/docs/overleaf/supplemental.tex",
    "ai_benchmarking/overleaf/supplemental.tex",
    "ai_benchmarking/docs/publication_supplemental_03.tex"
]

TEX_CONTENT = r"""\documentclass[11pt,a4paper]{article}

\usepackage[utf8]{inputenc}
\usepackage[margin=1in]{geometry}
\usepackage{amsmath,amssymb,amsfonts}
\usepackage{graphicx}
\usepackage{booktabs}
\usepackage{tabularx}
\usepackage{xltabular}
\usepackage{array}
\usepackage{pdflscape}
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

% Supplemental numbering prefixes
\renewcommand{\thesection}{S\arabic{section}}
\renewcommand{\thesubsection}{S\arabic{section}.\arabic{subsection}}
\renewcommand{\thesubsubsection}{S\arabic{section}.\arabic{subsection}.\arabic{subsubsection}}
\renewcommand{\thetable}{S\arabic{table}}
\renewcommand{\thefigure}{S\arabic{figure}}
\renewcommand{\theequation}{S\arabic{equation}}

\title{\textbf{Additional File 1: Supplemental Methods, Extended Case-Study Analysis, Benchmark Tables, and Empirical Taxonomy of Agentic Failure Modes}}
\author[1,*]{Jeffrey Jones}
\author[1]{[Contributing Authors]}
\affil[1]{Division of Biology and Biological Engineering, California Institute of Technology, Pasadena, CA 91125, USA}
\affil[*]{Corresponding author: \texttt{jeffsocal@caltech.edu}}
\date{}

\begin{document}

\maketitle

\vspace{-1.5em}
\begin{center}
\small
\textbf{Accompanying Manuscript:}\\
\textit{TidyProteomics-Agent: An Autonomous, Multi-Tier Agentic Framework for Reproducible Quantitative Proteomics with Automated Integrity Verification and Peer Critique}\\
\vspace{0.5em}
\textbf{Target Journal:} \textit{BMC Bioinformatics} (Software Article)
\end{center}
\vspace{1.5em}

\tableofcontents
\newpage

\section{Prompt Context Architecture, 13-Phase Operational Matrix, and MCP Tool Primitives}
\label{sec:S1}

\subsection{Bifurcated Prompt Context Compilation and Prefix Caching}
\label{sec:S1.1}

To prevent conversational context rot over extended multi-turn investigations while minimizing commercial API expenditure, the \texttt{ContextBuilder} module compiles a bifurcated prompt context at each turn (\textbf{Table~\ref{tab:tabS1}}). The static system prefix (\texttt{staticPrefixForCache}) contains the global \texttt{PROTOCOL.md} specification and immutable statistical quality gates. Because this block remains byte-for-byte identical across all thirteen phases, LLM providers supporting prefix caching (including Anthropic, OpenAI, Google, and xAI) cache the tokenized system prefix after Turn 1, yielding $\sim$80--100\% cache hit rates across the pipeline.

Variable state information is isolated within the dynamic Turn-1 user payload, which injects a pre-indexed workspace file manifest (eliminating exploratory directory-listing tool calls), the current contents of \texttt{docs/experiment.md}, the phase-specific task directive (\texttt{analysis/<NN>\_<phase>.md}), and the Persistent Markdown Memory digest (\texttt{docs/*.md}). Ephemeral tool outputs and multi-turn debugging streams are retained only within the active phase loop (bounded at a maximum of 30 turns) and purged upon phase transition, keeping active context lengths below 15,000 tokens.

\begin{table}[htbp]
\centering
\small
\caption{\textbf{Prompt Context Architecture and Token Management Strategy.}}
\label{tab:tabS1}
\begin{tabularx}{\textwidth}{l l l X}
\toprule
\textbf{Context Component} & \textbf{Scope} & \textbf{Persistence} & \textbf{Token Management \& Caching Strategy} \\
\midrule
\textbf{Invariant System Prefix} (\texttt{PROTOCOL.md}) & Pipeline-wide & Static across all phases & Locked byte-for-byte; achieves $\sim$80--100\% prefix cache hits on supported LLM endpoints. \\
\addlinespace
\textbf{Workspace Manifest} & Per-phase & Dynamically compiled & Pre-indexes files in \texttt{code/}, \texttt{data/}, \texttt{docs/}, \texttt{logs/}; eliminates Turn-1 directory-listing calls. \\
\addlinespace
\textbf{Persistent Markdown Memory} (\texttt{docs/*.md}) & Per-phase & Dynamic markdown digest & Summarizes confirmed experimental design, active data schemas, and prior milestones; purges raw console noise. \\
\addlinespace
\textbf{Experiment Specification} (\texttt{docs/experiment.md}) & Per-phase & Editable markdown & Injected into Turn-1 user prompt; updating contrasts does not invalidate the system prefix cache. \\
\addlinespace
\textbf{Phase Directive} (\texttt{analysis/<NN>\_*.md}) & Phase-specific & Single-phase directive & Defines explicit deliverables, checkpoint gate criteria, and available MCP tools. \\
\addlinespace
\textbf{Ephemeral Tool History} & Within-phase & Purged upon completion & Retained during active phase turns (max 30); discarded upon phase transition to prevent context rot. \\
\bottomrule
\end{tabularx}
\end{table}

\subsection{Complete 13-Phase Operational Matrix and MCP Tool Architecture}
\label{sec:S1.2}

The Python Model Context Protocol server (\texttt{mcp/server.py}) exposes 34 strongly typed proteomics and workflow governance tools (\texttt{tpa\_*}) backed by a persistent in-memory R 4.3.2 daemon (\texttt{mcp/r\_daemon.R}) running \texttt{tidyproteomics} (v1.9.15). Each phase of the sequential pipeline is governed by explicit persistent markdown memory inputs, allowed MCP tool primitives, serialized outputs, and deterministic checkpoint validation gates (\textbf{Table~\ref{tab:tabS2}}).

\begin{landscape}
\scriptsize
\begin{xltabular}{\linewidth}{l c p{4.5cm} p{4.8cm} X}
\caption{\textbf{Complete 13-Phase Pipeline Operational Matrix and Checkpoint Gates.}} \label{tab:tabS2} \\
\toprule
\textbf{Phase ID \& Name} & \textbf{Tier} & \textbf{Primary MCP Tools Invoked} & \textbf{Generated Workspace Artifacts} & \textbf{Deterministic Checkpoint Gate Criteria} \\
\midrule
\endhead
\midrule
\multicolumn{5}{r}{\textit{Continued on next page\dots}} \\
\endfoot
\bottomrule
\endlastfoot
\textbf{01: Inspect \& Ingest} & Tier 1 & \texttt{tpa\_input\_audit}, \texttt{tpa\_load}, \texttt{tpa\_inspect}, \texttt{tpa\_filter\_contaminants}, \texttt{tpa\_export\_state} & \texttt{code/01\_inspect.R}, \texttt{docs/data.md}, \texttt{data/tidyproteomics\_data.rds}, \texttt{data/plot\_proteins\_counts.png} & Raw acquisition file loaded; cRAP contaminants purged; $\ge 2$ unique peptide filter applied; \texttt{docs/data.md} ledger written. \\
\addlinespace
\textbf{02: Normalize} & Tier 1 & \texttt{tpa\_select\_normalization}, \texttt{tpa\_normalize}, \texttt{tpa\_plot\_variation}, \texttt{tpa\_plot\_pca} & \texttt{code/02\_normalize.R}, \texttt{data/plot\_variation\_cv.png}, \texttt{data/plot\_pca.png} & Empirical CV benchmark across raw, median, linear, limma, and LOESS completed; minimum-CV method applied. \\
\addlinespace
\textbf{03: Impute} & Tier 1 & \texttt{tpa\_impute}, \texttt{tpa\_inspect\_missingness}, \texttt{tpa\_export\_state} & \texttt{code/03\_impute.R}, updated \texttt{data/tidyproteomics\_data.rds} & Pre- and post-imputation missingness quantified; MNAR vs.\ MCAR profile logged; residual missingness verified. \\
\addlinespace
\textbf{04: Differential Expression} & Tier 2 & \texttt{check\_checkpoint\_gate}, \texttt{tpa\_expression}, \texttt{tpa\_plot\_volcano} & \texttt{code/04\_expression.R}, \texttt{data/table\_proteins\_expression\_*.tsv}, \texttt{data/plot\_proteins\_volcano\_*.png} & Pre-flight HITL contract ratified; Limma empirical Bayes contrasts computed; TSV exported with $\log_2\text{FC}$, $p$, and $q$. \\
\addlinespace
\textbf{05: Functional Enrichment} & Tier 2 & \texttt{tpa\_enrichment}, \texttt{tpa\_plot\_enrichment}, \texttt{tpa\_export\_state} & \texttt{code/05\_enrichment.R}, \texttt{data/table\_proteins\_enrichment\_*.tsv}, \texttt{data/plot\_proteins\_enrichment\_*.png} & Rank-based \texttt{fgsea} executed across \textit{a priori} GO (BP, MF, CC), Reactome, and KEGG ontologies; enrichment tables exported. \\
\addlinespace
\textbf{06: Primary Observations} & Tier 2 & \texttt{tpa\_extract\_observations}, \texttt{write\_file} & \texttt{code/06\_observations.R}, \texttt{docs/observations.md}, \texttt{data/observations\_summary.md} & Target perturbation verified; significant hits stratified into \texttt{ROBUST\_QUANTITATIVE} vs.\ \texttt{DETECTION\_LIMITED\_ON\_OFF}. \\
\addlinespace
\textbf{07: Knowledge Extraction} & Tier 3 & \texttt{tpa\_cluster\_modules}, \texttt{write\_file} & \texttt{code/07\_knowledge.R}, \texttt{data/de\_novo\_modules.tsv}, \texttt{data/knowledge\_top\_candidates.tsv}, \texttt{docs/knowledge.md} & Co-regulated protein modules clustered on unthresholded matrix; concordance rates and top driver genes cataloged. \\
\addlinespace
\textbf{08: Literature Grounding} & Tier 3 & \texttt{tpa\_pubmed\_search}, \texttt{tpa\_pubmed\_fetch}, \texttt{write\_file} & \texttt{docs/literature.md}, \texttt{docs/literature\_candidates.md}, \texttt{data/literature\_candidate\_expression.csv} & NCBI Entrez E-utilities queried for top candidates; verified PMIDs, titles, and abstracts cached locally. \\
\addlinespace
\textbf{09: Targeted Search} & Tier 3 & \texttt{tpa\_uniprot\_fetch}, \texttt{tpa\_pathway\_context}, \texttt{write\_file} & \texttt{docs/websearch.md}, \texttt{data/actionable\_synthesis.json} & UniProtKB REST records retrieved for catalytic domains, subcellular localization, and physical interaction partners. \\
\addlinespace
\textbf{10: Diagnostic Figures} & Tier 2 & \texttt{tpa\_run\_figure\_script}, \texttt{tpa\_verify\_figures} & \texttt{code/10\_figures.R}, \texttt{data/figures.tsv}, \texttt{data/plot\_discussion\_*.png} & All composite publication plots rendered at 300 DPI; \texttt{data/figures.tsv} caption registry and non-zero byte sizes verified. \\
\addlinespace
\textbf{11: Manuscript Synthesis} & Tier 3 & \texttt{write\_manuscript}, \texttt{tpa\_compile\_digest} & \texttt{docs/manuscript\_rev\_00.md}, \texttt{data/manuscript\_digest.json} & Complete scientific manuscript drafted integrating all upstream persistent memory documents, tables, and figure links. \\
\addlinespace
\textbf{12: Integrity Verification} & Tier 3 & \texttt{run\_deterministic\_verifiers}, \texttt{apply\_integrity\_patches} & \texttt{data/integrity\_defects.json}, \texttt{docs/report\_integrity.md}, \texttt{docs/manuscript\_rev\_01.md} & All empirical claims audited against ground-truth TSVs; identified numeric/directional defects surgically patched. \\
\addlinespace
\textbf{13: Peer-Review Critique} & Tier 3 & \texttt{run\_reviewer\_panel}, \texttt{apply\_critique\_revisions} & \texttt{docs/report\_critique.md}, \texttt{docs/report\_performance\_review.md}, \texttt{docs/manuscript\_rev\_02.md}, \texttt{docs/llm.md} & Adversarial 3-reviewer panel executed; hard caps applied; caveats and biochemical validation assays integrated. \\
\end{xltabular}
\end{landscape}

\section{Mathematical Formulation of Deterministic Rubric Scoring, Hard-Cap Rules, and TierOptimizer Equations}
\label{sec:S2}

\subsection{Deterministic Analytical Fidelity Verifiers}
\label{sec:S2.1}

The Deterministic Rubric Scoring engine (\texttt{src/evaluation/rubric/verifiers.ts}) computes the composite analytical fidelity score ($\text{Score}_{\text{Fidelity}} \in [0, 100]$) as the weighted linear combination of six deterministic verification modules (\textbf{Figure~\ref{fig:figS1}}, \textbf{Table~\ref{tab:tabS3}}):

\begin{figure}[htbp]
\centering
\includegraphics[width=\textwidth]{figures/figure_S1_verifier_architecture}
\caption{\textbf{Verifier Architecture and Deterministic Rubric Scoring Pipeline.} 
\textbf{(A)}~Claim Extraction \& Ground-Truth Persistence: regex and Markdown table parsers extract empirical claims from \texttt{docs/manuscript\_rev\_00.md} and cross-reference them against ground-truth expression/enrichment TSVs, the Phase 08 SQLite/NCBI Entrez literature cache, and diagnostic plot files (\texttt{data/*.png}), exporting line-numbered discrepancies to \texttt{data/integrity\_defects.json} for Phase 12 surgical self-correction (\texttt{docs/manuscript\_rev\_01.md}). 
\textbf{(B)}~Six Deterministic Verifiers ($\text{Score}_{\text{Fidelity}}$): weighted code-based verifiers evaluating \textit{Numeric Fidelity} (35\%), \textit{Direction Consistency} (20\%), \textit{Significance Honesty} (15\%), \textit{Citation Integrity} (15\%), \textit{Count Consistency} (10\%), and \textit{Figure Integrity} (5\%). 
\textbf{(C)}~Hard-Cap Gate \& Deterministic Rubric Scoring: deterministic hard-cap matrix bounding the 5-dimension qualitative peer-review panel (1--10 scale) whenever underlying verification gates fail, feeding into the 3-pillar Composite Overall Benchmark Score (0--100 scale: 40\% Hard-Capped Manuscript Score, 35\% Deterministic Analytical Fidelity, and 25\% MCP Tool Compliance).}
\label{fig:figS1}
\end{figure}

\begin{equation}
\text{Score}_{\text{Fidelity}} = \left( 0.35 \cdot S_{\text{numeric}} + 0.20 \cdot S_{\text{direction}} + 0.15 \cdot S_{\text{significance}} + 0.15 \cdot S_{\text{citation}} + 0.10 \cdot S_{\text{count}} + 0.05 \cdot S_{\text{figure}} \right) \times 100
\end{equation}

For the \textbf{Numeric Fidelity Verifier} ($w = 0.35$), regular expressions and abstract syntax tree (AST) parsers extract every tuple of $(\text{protein\_identifier}, \text{metric\_type}, v_{\text{stated}})$ from prose and markdown tables in the manuscript. Each stated value ($v_{\text{stated}}$) is matched against the corresponding ground-truth value ($v_{\text{truth}}$) in \texttt{data/table\_proteins\_expression\_*.tsv} or \texttt{data/table\_proteins\_enrichment\_*.tsv}. To accommodate legitimate rounding in scientific prose without permitting fabrication, a claim is scored as verified if $|v_{\text{stated}} - v_{\text{truth}}| \le \text{Tolerance}(v_{\text{stated}}, v_{\text{truth}})$, defined as:

\begin{equation}
\text{Tolerance}\left(v_{\text{stated}}, v_{\text{truth}}\right) = \max\left( 0.05 \cdot \left|v_{\text{truth}}\right|, \; 0.5 \times 10^{-d} \times 10^{e} \right)
\end{equation}

where $d$ is the number of decimal places displayed in $v_{\text{stated}}$ and $e$ is the base-10 scientific exponent. The module score $S_{\text{numeric}}$ equals the fraction of extracted numeric claims satisfying this inequality.

For the \textbf{Direction Consistency Verifier} ($w = 0.20$), semantic polarity terms associated with any protein or pathway claim are mapped to positive polarity ($\mathcal{P}_+ = \{\text{upregulated}, \text{increased}, \text{accumulated}, \text{induced}, \text{enriched}, \text{elevated}\}$) or negative polarity ($\mathcal{P}_- = \{\text{downregulated}, \text{decreased}, \text{depleted}, \text{suppressed}, \text{reduced}, \text{repressed}\}$). A directional sign error is logged whenever a protein with $v_{\text{truth}}(\log_2\text{FC}) < 0$ is paired with $\mathcal{P}_+$, or $v_{\text{truth}}(\log_2\text{FC}) > 0$ is paired with $\mathcal{P}_-$, or when $v_{\text{stated}} \approx -v_{\text{truth}}$.

For the \textbf{Significance Honesty Verifier} ($w = 0.15$), any sentence asserting that a feature is ``significant'' or ``significantly altered'' when $v_{\text{truth}}(q) > 0.05$ without explicit qualification (e.g., ``nominally significant'', ``unadjusted $p < 0.05$, non-significant after FDR correction'') is penalized as an unhedged significance overclaim. The \textbf{Citation Integrity Verifier} ($w = 0.15$) validates all cited PMIDs against the Phase 08 SQLite cache and live NCBI Entrez \texttt{esummary} lookups, while the \textbf{Count Consistency Verifier} ($w = 0.10$) and \textbf{Figure Integrity Verifier} ($w = 0.05$) verify exact feature/replicate integers and physical PNG plot files on disk, respectively (\textbf{Table~\ref{tab:tabS3}}).

\begin{landscape}
\begin{table}[p]
\centering
\small
\caption{\textbf{Deterministic Verifier Weights and Hard-Cap Decision Thresholds.}}
\label{tab:tabS3}
\begin{tabularx}{\linewidth}{l c p{4.5cm} p{6.0cm} X}
\toprule
\textbf{Verifier Module} & \textbf{Weight ($w_k$)} & \textbf{Ground-Truth Reference} & \textbf{Failure Condition / Trigger} & \textbf{Enforced Reviewer Hard Cap} \\
\midrule
\textbf{Numeric Fidelity} & 0.35 & \texttt{table\_proteins\_expression\_*.tsv}, \texttt{table\_proteins\_enrichment\_*.tsv} & Stated value deviates from truth beyond $\text{Tolerance}(v_{\text{stated}}, v_{\text{truth}})$. & If $< 85\%$: \textit{Bioinformatics Intelligence} $\le 5.0/10$.\newline If $< 70\%$: \textit{Scientific Evaluation} $\le 3.0/10$ and Overall Score $\le 50/100$. \\
\addlinespace
\textbf{Direction Consistency} & 0.20 & Sign of \texttt{log2\_foldchange} or \texttt{enrichment} in TSVs & Semantic polarity ($\mathcal{P}_+ / \mathcal{P}_-$) or stated sign opposes truth sign. & If $\ge 1$ error: \textit{Scientific Evaluation} $\le 6.0/10$ and \textit{Bioinformatics Intelligence} $\le 5.0/10$. \\
\addlinespace
\textbf{Significance Honesty} & 0.15 & Benjamini-Hochberg \texttt{adj\_p\_value} ($q$) in TSVs & Unhedged assertion of significance when adjusted $q > 0.05$. & If $\ge 3$ overclaims: \textit{Scientific Evaluation} $\le 5.0/10$. \\
\addlinespace
\textbf{Citation Integrity} & 0.15 & Local Phase 08 SQLite cache \& NCBI Entrez API & Non-existent PMID, retracted article, or taxonomic/gene mismatch. & If verification $< 70\%$: \textit{Biological Insights} $\le 6.0/10$ and \textit{Actionable Next Steps} $\le 6.0/10$. \\
\addlinespace
\textbf{Count Consistency} & 0.10 & Row counts of filtered RDS \& contrast JSON & Mismatched total proteins (5,586), sig hits (36), or replicates ($N=6$). & Deducts proportionally from $\text{Score}_{\text{Fidelity}}$; flags sample-unit paradoxes. \\
\addlinespace
\textbf{Figure Integrity} & 0.05 & Workspace \texttt{data/plot\_*.png} filesystem check & Referenced markdown image path missing or file size $= 0$ bytes. & If $\ge 1$ missing core plot: \textit{Clarity and Communication} $\le 7.0/10$. \\
\bottomrule
\end{tabularx}
\end{table}
\end{landscape}

\subsection{TierOptimizer Suitability Functions}
\label{sec:S2.2}

To assign models across the three operational tiers (\textbf{Main Text Table 1}), \texttt{TierOptimizer} computes empirical suitability scores ($U_{\text{Tier}} \in [0, 100]$) for each candidate model $m$ using historical benchmark telemetry and live OpenRouter token pricing ($\text{Cost}_m = \text{Tokens}_{\text{Prompt}} R_{\text{Prompt}} + \text{Tokens}_{\text{Completion}} R_{\text{Completion}}$):

\begin{equation}
U_{\text{Tier 1}}(m) = 0.40 \cdot C_{\text{phase}}(m) + 0.25 \cdot S_{\text{numeric}}(m) + 0.20 \cdot E_{\text{turns}}(m) + 0.15 \cdot E_{\text{cost}}(m)
\end{equation}

\begin{equation}
U_{\text{Tier 2}}(m) = 0.40 \cdot C_{\text{tool}}(m) + 0.30 \cdot S_{\text{figure}}(m) + 0.20 \cdot E_{\text{turns}}(m) + 0.10 \cdot E_{\text{cost}}(m)
\end{equation}

\begin{equation}
U_{\text{Tier 3}}(m) = 0.50 \cdot \text{Score}_{\text{Overall}}(m) + 0.30 \cdot S_{\text{numeric}}(m) - 0.20 \cdot P_{\text{direction}}(m)
\end{equation}

where $C_{\text{phase}}$ and $C_{\text{tool}}$ denote phase and MCP tool completion rates, $E_{\text{turns}}$ and $E_{\text{cost}}$ denote normalized turn-economy and inverse-cost efficiency scores, and $P_{\text{direction}}$ represents the penalty for baseline directional sign inversions.

\section{Extended p97/VCP Depletion Proteomics Case Study and Biochemical Validation Protocols}
\label{sec:S3}

\subsection{Preprocessing Hygiene, Normalization Selection, and Imputation Auditing}
\label{sec:S3.1}

The benchmark dataset (Caltech Data Repository \texttt{aevwq-2ps50}, \texttt{ProteomeDiscoverer\_2.5\_p97KD\_HCT116\_proteins.xlsx}) profiles six biological replicate acquisitions of human HCT116 cells: three uninduced vehicle controls (\texttt{ctl\_1}, \texttt{ctl\_2}, \texttt{ctl\_3}) and three acute p97/VCP knockdown replicates (\texttt{p97\_kd\_1}, \texttt{p97\_kd\_2}, \texttt{p97\_kd\_3}). Automated Phase 01 inspection identified 7,055 initial protein entries. Contaminant screening purged 15 non-native cRAP features---predominantly bovine serum albumin (accounting for 3.66\% to 4.02\% of raw precursor intensity across runs), human keratins (3.56\% to 3.90\%), and porcine trypsin---yielding 7,040 native human proteins. Enforcing a strict two-unique-peptide threshold removed 1,454 single-peptide identifications, producing the final modeling matrix of \textbf{5,586 proteins} (90.8\% average sample coverage in controls with median intra-group CV = 0.16; 90.9\% coverage in p97-depleted samples with median intra-group CV = 0.21).

In Phase 02, \texttt{tpa\_select\_normalization} benchmarked five normalization strategies across intra-replicate CV and principal component variance structure. Raw unnormalized intensities exhibited a median intra-replicate CV of 0.25 (PC1 = 51.0\%, PC2 = 17.0\%). Global scaling, median centering, linear regression, and \texttt{limma} normalization each reduced median intra-replicate CV to 0.18. Local regression (\textbf{LOESS}) achieved the lowest technical dispersion at \textbf{median CV = 0.17} (a 32.0\% reduction in replicate noise relative to raw data) and balanced the principal components to PC1 = 34.0\% and PC2 = 24.0\%, cleanly segregating control and p97-depleted replicates along the primary axis.

In Phase 03, missingness auditing showed that filtering single-peptide hits reduced matrix missingness from 28.8\% (raw) to \textbf{17.7\%} (5,586-protein matrix). Missing values were strongly concentrated in condition-exclusive dropouts (MNAR), where low-abundance stress factors were absent in uninduced controls or depleted targets dropped below detection thresholds in knockdown replicates. Applying deterministic minimum-column imputation (\texttt{min\_column}) substituted missing entries with the minimum observed abundance of each respective sample column, reducing residual missingness to 0\% while recording the per-protein imputation delta ($\Delta\text{imp} = \text{ImputedFraction}_{\text{ctrl}} - \text{ImputedFraction}_{\text{kd}}$) to flag boundary-driven fold changes in downstream tables (\textbf{Table~\ref{tab:tabS4}}).

\subsection{Candidate Reliability Stratification and Top Altered Proteins}
\label{sec:S3.2}

Empirical Bayes linear modeling (\texttt{limma}) in Phase 04 identified \textbf{36 significantly altered proteins} satisfying $|\log_2\text{FC}| \ge 1.0$ and Benjamini-Hochberg adjusted $q \le 0.05$ (22 upregulated, 14 downregulated; top 20 presented in \textbf{Table~\ref{tab:tabS4}}). Phase 06 automatically stratified these candidates into \texttt{ROBUST\_QUANTITATIVE} ($N = 16$, quantified across all 6 replicates with $\Delta\text{imp} = 0.000$) and \texttt{DETECTION\_LIMITED\_ON\_OFF} ($N = 20$, where $|\Delta\text{imp}| \ge 0.667$ indicates condition-exclusive detection boundary imputation).

\begin{landscape}
\begin{table}[p]
\centering
\small
\caption{\textbf{Top 20 Significantly Altered Proteins in p97-Depleted Human HCT116 Cells.}}
\label{tab:tabS4}
\begin{tabularx}{\linewidth}{l l X r r r r l}
\toprule
\textbf{UniProt ID} & \textbf{Gene} & \textbf{Protein Description} & $\mathbf{\log_2\text{FC}}$ & \textbf{Nominal $p$} & \textbf{Adjusted $q$} & $\mathbf{\Delta\text{imp}}$ & \textbf{Reliability Category} \\
\midrule
\texttt{Q15011} & \textit{HERPUD1} & Homocysteine-responsive ER protein with ubiquitin domain 1 & +5.4145 & $8.77 \times 10^{-6}$ & $9.46 \times 10^{-3}$ & $-0.667$ & \texttt{DETECTION\_LIMITED} \\
\texttt{Q9BRJ7} & \textit{NUDT16L1} & Tudor-interacting repair regulator protein (C9orf64) & +4.5470 & $2.24 \times 10^{-6}$ & $3.22 \times 10^{-3}$ & $-1.000$ & \texttt{DETECTION\_LIMITED} \\
\texttt{Q14494} & \textit{NFE2L1} & ER membrane sensor NFE2L1 (Nrf1) & +3.5706 & $2.31 \times 10^{-6}$ & $3.22 \times 10^{-3}$ & $-1.000$ & \texttt{DETECTION\_LIMITED} \\
\texttt{Q13751} & \textit{LAMB3} & Laminin subunit beta-3 & +3.5555 & $1.72 \times 10^{-4}$ & $3.84 \times 10^{-2}$ & $-0.667$ & \texttt{DETECTION\_LIMITED} \\
\texttt{Q9BUI4} & \textit{C3orf38} & Uncharacterized protein C3orf38 & +2.5691 & $1.64 \times 10^{-4}$ & $1.11 \times 10^{-2}$ & $-1.000$ & \texttt{DETECTION\_LIMITED} \\
\texttt{Q9UM22} & \textit{DEPDC1B} & DEP domain-containing protein 1B & +2.4434 & $1.86 \times 10^{-4}$ & $1.11 \times 10^{-2}$ & $-1.000$ & \texttt{DETECTION\_LIMITED} \\
\texttt{O95833} & \textit{DUOXA1} & Dual oxidase maturation factor 1 & +2.4430 & $1.49 \times 10^{-3}$ & $4.92 \times 10^{-2}$ & $0.000$ & \texttt{ROBUST\_QUANTITATIVE} \\
\texttt{Q14534} & \textit{DDX6} & ATP-dependent RNA helicase DDX6 & +2.3256 & $1.79 \times 10^{-5}$ & $3.22 \times 10^{-3}$ & $0.000$ & \texttt{ROBUST\_QUANTITATIVE} \\
\texttt{Q8IW35} & \textit{C1orf112} & Uncharacterized protein C1orf112 & +2.2931 & $2.55 \times 10^{-4}$ & $1.40 \times 10^{-2}$ & $-1.000$ & \texttt{DETECTION\_LIMITED} \\
\texttt{Q9Y4C2} & \textit{UBE2J1} & Ubiquitin-conjugating enzyme E2 J1 & +2.1590 & $1.67 \times 10^{-4}$ & $1.11 \times 10^{-2}$ & $0.000$ & \texttt{ROBUST\_QUANTITATIVE} \\
\addlinespace
\texttt{Q9BZG8} & \textit{TDRD10} & Tudor domain-containing protein 10 & $-5.8046$ & $1.52 \times 10^{-4}$ & $9.46 \times 10^{-3}$ & $+1.000$ & \texttt{DETECTION\_LIMITED} \\
\texttt{A0A2R8Y6W5} & \textit{IGKV1-5} & Immunoglobulin kappa variable 1-5 & $-3.3375$ & $1.02 \times 10^{-3}$ & $3.91 \times 10^{-2}$ & $+1.000$ & \texttt{DETECTION\_LIMITED} \\
\texttt{Q9NVP2} & \textit{HEATR4} & HEAT repeat-containing protein 4 & $-3.2987$ & $7.05 \times 10^{-4}$ & $2.98 \times 10^{-2}$ & $+1.000$ & \texttt{DETECTION\_LIMITED} \\
\texttt{Q8WWI5} & \textit{C9orf172} & Uncharacterized protein C9orf172 & $-3.1289$ & $1.48 \times 10^{-3}$ & $4.92 \times 10^{-2}$ & $+1.000$ & \texttt{DETECTION\_LIMITED} \\
\texttt{Q9NZQ3} & \textit{WDR92} & WD repeat-containing protein 92 & $-2.3891$ & $1.39 \times 10^{-3}$ & $4.71 \times 10^{-2}$ & $+1.000$ & \texttt{DETECTION\_LIMITED} \\
\texttt{P55072} & \textit{VCP} & Transitional ER ATPase (p97/VCP) & $-2.3250$ & $2.45 \times 10^{-4}$ & $3.22 \times 10^{-3}$ & $0.000$ & \texttt{ROBUST\_QUANTITATIVE} \\
\texttt{Q7Z6Z7} & \textit{HUWE1} & E3 ubiquitin-protein ligase HUWE1 & $-1.7409$ & $9.91 \times 10^{-4}$ & $3.82 \times 10^{-2}$ & $0.000$ & \texttt{ROBUST\_QUANTITATIVE} \\
\texttt{P31350} & \textit{RRM2} & Ribonucleoside-diphosphate reductase M2 & $-1.4567$ & $4.85 \times 10^{-4}$ & $2.29 \times 10^{-2}$ & $0.000$ & \texttt{ROBUST\_QUANTITATIVE} \\
\texttt{Q9Y6I9} & \textit{TXNDC9} & Thioredoxin domain-containing protein 9 & $-1.4437$ & $1.50 \times 10^{-3}$ & $4.92 \times 10^{-2}$ & $0.000$ & \texttt{ROBUST\_QUANTITATIVE} \\
\texttt{P04183} & \textit{TK1} & Thymidine kinase 1 & $-1.3746$ & $2.31 \times 10^{-4}$ & $1.31 \times 10^{-2}$ & $0.000$ & \texttt{ROBUST\_QUANTITATIVE} \\
\bottomrule
\end{tabularx}
\end{table}
\end{landscape}

\subsection{Functional Pathway (fgsea) and De Novo Module Clustering Summary}
\label{sec:S3.3}

Rank-based gene set enrichment analysis (\texttt{fgsea}, Phase 05) and unsupervised functional module clustering (\texttt{data/de\_novo\_modules.tsv}, Phase 07) revealed a concerted cellular bifurcation: acute upregulation of ER-associated degradation (ERAD), ubiquitin-proteasome components, and secretory trafficking, paired with severe coordinated suppression of cytoplasmic and mitochondrial translation elongation and ribosome biogenesis (\textbf{Table~\ref{tab:tabS5}}).

\begin{landscape}
\begin{table}[p]
\centering
\small
\caption{\textbf{Functional Pathway (\texttt{fgsea}) and De Novo Module Enrichment Summary.}}
\label{tab:tabS5}
\begin{tabularx}{\linewidth}{l p{5.5cm} c r c r r X}
\toprule
\textbf{Database / Source} & \textbf{Pathway / De Novo Module} & $\mathbf{N}$ & \textbf{Score / Shift} & \textbf{Dir} & \textbf{Nominal $p$} & \textbf{Adjusted $q$} & \textbf{Leading Driver Proteins} \\
\midrule
\textbf{Reactome} & Peptide chain elongation & 84 & $-0.1244$ & DOWN & $1.20 \times 10^{-5}$ & $2.45 \times 10^{-4}$ & \textit{RPL15, RPS6, EEF1A1, RPL23A} \\
\textbf{Reactome} & Selenocysteine synthesis & 81 & $-0.1228$ & DOWN & $1.35 \times 10^{-5}$ & $2.45 \times 10^{-4}$ & \textit{EEFSEC, PSTK, RPL4, RPS12} \\
\textbf{Reactome} & Eukaryotic translation termination & 83 & $-0.1169$ & DOWN & $1.80 \times 10^{-5}$ & $2.45 \times 10^{-4}$ & \textit{ETF1, GSPT1, RPL10A, RPS20} \\
\textbf{Reactome} & Nonsense Mediated Decay & 86 & $-0.1125$ & DOWN & $2.10 \times 10^{-5}$ & $2.45 \times 10^{-4}$ & \textit{UPF1, UPF2, SMG1, RPL27A} \\
\addlinespace
\textbf{GO:MF} & RNA binding & 1,142 & $-0.0071$ & DOWN & $1.12 \times 10^{-10}$ & $2.93 \times 10^{-9}$ & \textit{DDX21, NPM1, EIF4A1, NOP56} \\
\textbf{GO:CC} & Extracellular space / matrix & 412 & $+0.0526$ & UP & $2.10 \times 10^{-12}$ & $5.92 \times 10^{-11}$ & \textit{LAMB3, COL6A1, LAMC1, ITGAV} \\
\textbf{GO:CC} & Cytoskeleton & 685 & $+0.0526$ & UP & $1.65 \times 10^{-11}$ & $4.03 \times 10^{-10}$ & \textit{ACTN1, FLNA, TLN1, VCL, MAP2} \\
\addlinespace
\textbf{De Novo 1} & Translation \& ribosome biogenesis & 425 & $-0.040$ (56.2\%) & DOWN & $2.24 \times 10^{-4}$ & $6.30 \times 10^{-4}$ & \textit{YTHDC2, RPS6KA5, PTRH1, EIF3A} \\
\textbf{De Novo 2} & Proteostasis, ubiquitin \& ER QC & 276 & $+0.053$ (64.9\%) & UP & $3.15 \times 10^{-4}$ & $6.30 \times 10^{-4}$ & \textit{VCP, HERPUD1, UBE2J1, ASF1B} \\
\textbf{De Novo 3} & Golgi, vesicle trafficking \& secretion & 201 & $+0.053$ (64.2\%) & UP & $2.12 \times 10^{-3}$ & $2.82 \times 10^{-3}$ & \textit{TVP23C, SNX17, SEC11C, ARCN1} \\
\textbf{De Novo 4} & ECM, adhesion \& cytoskeleton & 222 & $+0.053$ (57.7\%) & UP & $4.67 \times 10^{-1}$ & $4.67 \times 10^{-1}$ & \textit{NUDT16L1, LAMB3, BCAM, ITGAV} \\
\bottomrule
\end{tabularx}
\end{table}
\end{landscape}

\subsection{Discriminative Biochemical Validation Protocols Formulated in Phase 13}
\label{sec:S3.4}

During Phase 13 adversarial refinement, the agent formulated three concrete wet-lab validation protocols to test its mechanistic hypotheses and resolve the limitations of steady-state label-free mass spectrometry.

First, to determine whether accumulated ERAD factors (\textit{UBE2J1}, \textit{HERPUD1}) and \textit{NFE2L1} represent direct polyubiquitinated p97 substrates rather than secondary transcriptional inductions, the agent designed a \textbf{Tandem Ubiquitin-Binding Entity (TUBE) and Linkage-Specific Immunoprecipitation Protocol}. Whole-cell HCT116 lysates harvested under denaturing and non-denaturing conditions in the presence of N-ethylmaleimide (to inhibit deubiquitinases) are affinity-purified using agarose-conjugated TUBEs or K48-specific anti-ubiquitin antibodies alongside parallel non-specific IgG isotype controls, followed by quantitative immunoblotting for UBE2J1, HERPUD1, and cleaved versus full-length NFE2L1.

Second, to test whether NFE2L1 accumulation restores functional proteolytic capacity or whether 26S proteasomes remain kinetically choked by unextracted polyubiquitinated cargo, the agent designed a \textbf{Matched-Lysate Fluorogenic Proteasomal Peptidase Assay}. ATP-supplemented cytosolic extracts from control and p97-depleted cells are incubated with fluorogenic peptide substrates targeting chymotrypsin-like ($\beta 5$, Suc-LLVY-AMC), trypsin-like ($\beta 2$, Ac-RLR-AMC), and caspase-like ($\beta 1$, Z-LLE-AMC) active sites, recording AMC fluorescence release kinetics ($\text{Ex } 380\text{ nm} / \text{Em } 460\text{ nm}$) with parallel bortezomib-inhibited wells ($1\,\mu\text{M}$) to subtract non-proteasomal background cleavage.

Third, to establish causal dependence on mechanical ATPase segregase activity rather than structural scaffolding, the agent designed a \textbf{Catalytic Dominant-Negative Genetic Rescue Assay}. Inducible p97-knockdown HCT116 cells are transduced with shRNA/sgRNA-resistant constructs expressing either wild-type p97 or ATPase-dead Walker A/B point mutants (p97-E305Q/E578Q). Direct enzymatic segregase substrates must revert to basal control abundance upon wild-type p97 rescue while remaining trapped in high-molecular-weight polyubiquitinated complexes in cells expressing catalytically dead p97-E305Q/E578Q.

\section{Unrevised Baseline LLM Benchmark Breakdown and Per-Dimension Reviewer Scores}
\label{sec:S4}

To provide complete transparency into how Phase 12 (Integrity Verification) and Phase 13 (Peer-Review Critique) remediate model failure modes, \textbf{Table~\ref{tab:tabS6}} reports the complete unrevised baseline metrics (Phases 01--11), and \textbf{Table~\ref{tab:tabS7}} reports the per-dimension qualitative reviewer scores pre- and post-revision across the eleven evaluated models.

\begin{landscape}
\begin{table}[p]
\centering
\small
\caption{\textbf{Baseline Analytical Benchmark Metrics Across 11 Large Language Models Prior to Revision Phases (Phases 01--11).}}
\label{tab:tabS6}
\begin{tabularx}{\linewidth}{p{4.8cm} p{2.8cm} *{6}{>{\centering\arraybackslash}X}}
\toprule
\textbf{Model Architecture} & \textbf{Organization} & \textbf{Overall (0--100)} & \textbf{Manuscript (/10)} & \textbf{Fidelity (\%)} & \textbf{Dir Errors} & \textbf{Overclaims ($q > 0.05$)} & \textbf{Tool Use (\%)} \\
\midrule
\texttt{openai/gpt-6-sol} & OpenAI & 83 & 6.8 & 92\% & 1 & 2 & 96\% \\
\texttt{anthropic/claude-sonnet-5.5} & Anthropic & 82 & 6.2 & 93\% & 3 & 0 & 97\% \\
\texttt{x-ai/grok-4.7} & xAI & 81 & 6.4 & 90\% & 2 & 2 & 96\% \\
\texttt{anthropic/claude-haiku-5.5} & Anthropic & 80 & 5.8 & 92\% & 4 & 0 & 97\% \\
\texttt{openai/gpt-oss-120b} & OpenAI & 77 & 6.2 & 79\% & 0 & 0 & 98\% \\
\texttt{mistralai/mistral-large-4-0} & Mistral AI & 77 & 5.3 & 90\% & 1 & 0 & 97\% \\
\texttt{thinkingmachines/inkling} & Thinking Machines & 77 & 5.4 & 92\% & 5 & 0 & 93\% \\
\texttt{meta/muse-spark-1.3} & Meta & 76 & 6.0 & 81\% & 7 & 1 & 96\% \\
\texttt{openai/gpt-6-luna}* & OpenAI & 71 & 5.0 & 96\% & 2 & 0 & 45\%* \\
\texttt{google/gemini-4-argon} & Google & 68 & 4.8 & 71\% & 2 & 34 & 97\% \\
\texttt{google/gemini-3.1-flash-lite} & Google & 68 & 4.0 & 81\% & 4 & 0 & 95\% \\
\midrule
\textbf{Cohort Mean / Total} & \textbf{11 Models} & \textbf{76.5} & \textbf{5.6} & \textbf{86.8\%} & \textbf{29 Total} & \textbf{39 Total} & \textbf{96.1\%}** \\
\bottomrule
\end{tabularx}
\vspace{0.8ex}
\flushleft
\scriptsize
*\textit{Note: \texttt{openai/gpt-6-luna} was an uninstrumented initial snapshot run that lacked JSON tool-execution telemetry logs; **Mean MCP tool compliance across the 10 instrumented models.}
\end{table}
\end{landscape}

\begin{landscape}
\begin{table}[p]
\centering
\small
\caption{\textbf{Qualitative Reviewer Panel Dimension Scores (0--10 Scale) Pre- and Post-Revision.}}
\label{tab:tabS7}
\begin{tabularx}{\linewidth}{p{5.5cm} c c c X}
\toprule
\textbf{Evaluation Dimension} & \textbf{Baseline (Ph 11)} & \textbf{Revised (Ph 13)} & \textbf{Gain ($\Delta$)} & \textbf{Primary Source of Score Remediation} \\
\midrule
\textbf{1. Scientific Evaluation} & 6.2 & 7.2 & \textbf{+1.0} & Elimination of 27/29 directional sign errors and 34 unhedged $q > 0.05$ overclaims lifted deterministic hard caps. \\
\addlinespace
\textbf{2. Bioinformatics Intelligence} & 5.4 & 7.4 & \textbf{+2.0} & Explicit stratification of \texttt{DETECTION\_LIMITED\_ON\_OFF} MNAR imputation switches vs.\ \texttt{ROBUST\_QUANTITATIVE} shifts. \\
\addlinespace
\textbf{3. Biological Insights \& Novelty} & 6.0 & 6.9 & \textbf{+0.9} & Grounding of ERAD (\textit{UBE2J1/HERPUD1}) and \textit{NFE2L1} proteasome bounce-back mechanisms in verified PubMed PMIDs. \\
\addlinespace
\textbf{4. Manuscript Clarity \& Comm.} & 5.5 & 7.0 & \textbf{+1.5} & Removal of cross-sectional narrative redundancy and verification of all 300 DPI composite figure callouts. \\
\addlinespace
\textbf{5. Actionable Next Steps} & 5.0 & 7.0 & \textbf{+2.0} & Replacement of generic follow-up suggestions with TUBE co-IP, Suc-LLVY-AMC peptidase, and E305Q/E578Q rescue protocols. \\
\midrule
\textbf{Composite Qualitative Mean} & \textbf{5.6 / 10} & \textbf{7.1 / 10} & \textbf{+1.5 / 10} & Holistic elevation from hallucination-prone initial drafts to peer-reviewed publication quality. \\
\bottomrule
\end{tabularx}
\end{table}
\end{landscape}

\section{Empirical Evolution of the 13-Phase Architecture and Taxonomy of Agentic Failure Modes}
\label{sec:S5}

\subsection{Evolutionary Progression of the TidyProteomics-Agent Pipeline (Generations 1--5)}
\label{sec:S5.1}

The 13-phase architecture of TidyProteomics-Agent was not chosen arbitrarily; rather, it emerged through five successive architectural generations spanning more than thirty-five iterative benchmark executions and multi-cohort PRIDE repository stress tests (\texttt{PXD029668}, \texttt{PXD056771}, \texttt{PXD060637}, and \texttt{PXD064630}) (\textbf{Table~\ref{tab:tabS8}}). At each generation, specific failure modes observed in agent reasoning and tool execution motivated structural phase splits, reordering, or programmatic safeguards.

\begin{landscape}
\scriptsize
\begin{xltabular}{\linewidth}{p{3.2cm} p{3.5cm} p{3.2cm} X X}
\caption{\textbf{Evolutionary Progression of the TidyProteomics-Agent Pipeline Across Five Architectural Generations.}} \label{tab:tabS8} \\
\toprule
\textbf{Generation} & \textbf{Phase Structure} & \textbf{Environment} & \textbf{Empirical Failure Modes in Logs} & \textbf{Architectural Remediation} \\
\midrule
\endhead
\midrule
\multicolumn{5}{r}{\textit{Continued on next page\dots}} \\
\endfoot
\bottomrule
\endlastfoot
\textbf{Gen 1: Coarse CLI Prototype} & \textbf{4 Phases}:\newline \texttt{01\_Inspect} $\rightarrow$ \texttt{02\_Model} $\rightarrow$ \texttt{03\_Observations} $\rightarrow$ \texttt{04\_Synthesis} & Unconstrained CLI bash \& file editor & \textbf{1.} Sycophancy collapse \& forged log files in local utility models.\newline \textbf{2.} Context bloat ($>$150k tokens) from \texttt{cat *.csv} and 120s gateway timeouts on monolithic 4,000-word writes. & Replaced raw CLI bash scripting with a schema-bound MCP server (\texttt{mcp/server.py}) and decomposed the workflow into 12 granular phases. \\
\addlinespace
\textbf{Gen 2: Initial MCP Prototype} & \textbf{12 Phases}:\newline \texttt{00\_Install} .. \texttt{06\_Observations} .. \texttt{10A\_Figures} $\rightarrow$ \texttt{10B\_Synthesis} & Local R + MCP Server & \textbf{1.} Phase 06 repeatedly failed (562k--704k tokens) when extracting numbers and inventing hypotheses simultaneously.\newline \textbf{2.} Sub-numbered phases (\texttt{10A}/\texttt{10B}) confused orchestrator. & Strictly decoupled \texttt{06\_Observations} (factual numeric/reliability locking) from \texttt{07\_Knowledge} (de novo module clustering) and promoted \texttt{10\_Figures} and \texttt{11\_Synthesis} to top-level phases. \\
\addlinespace
\textbf{Gen 3: Persistent R Daemon} & \textbf{12 Phases}:\newline \texttt{00\_Install} $\rightarrow$ \texttt{01\_Inspect} .. \texttt{08\_WebSearch} $\rightarrow$ \texttt{09\_Literature} $\rightarrow$ \texttt{10\_Figures} $\rightarrow$ \texttt{11\_Synthesis} & Persistent In-Memory R Daemon + Prompt Caching & \textbf{1.} \texttt{00\_Install} wasted 15--47s and $\sim$50k tokens per run verifying R packages.\newline \textbf{2.} Running \texttt{08\_WebSearch} before \texttt{09\_Literature} consumed up to 1.39M tokens and biased hypotheses with secondary web noise. & Containerized R 4.3.2 and \texttt{tidyproteomics} in Docker (eliminating \texttt{00\_Install}) and introduced 3-tier multi-LLM role routing. \\
\addlinespace
\textbf{Gen 4: Dockerized 11-Phase Multi-Tier} & \textbf{11 Phases}:\newline \texttt{01\_Inspect} .. \texttt{08\_WebSearch} $\rightarrow$ \texttt{09\_Literature} $\rightarrow$ \texttt{10\_Figures} $\rightarrow$ \texttt{11\_Synthesis} & Hardened Docker + 3-Tier Multi-LLM Routing & \textbf{1.} Despite 96.1\% MCP tool compliance in Phases 01--10, Phase 11 manuscripts exhibited 29 directional sign flips and 86.8\% numeric fidelity.\newline \textbf{2.} Single-prompt self-correction ignored numeric fixes in favor of prose rewrites. & Swapped \texttt{08\_Literature} (primary PubMed) ahead of \texttt{09\_WebSearch} (targeted API gap-filling) and appended two orthogonal post-synthesis phases: \texttt{12\_Integrity} and \texttt{13\_Critique}. \\
\addlinespace
\textbf{Gen 5: Integrity-Verified 13-Phase} & \textbf{13 Phases}:\newline \texttt{01\_Inspect} .. \texttt{08\_Literature} $\rightarrow$ \texttt{09\_WebSearch} $\rightarrow$ \texttt{10\_Figures} $\rightarrow$ \texttt{11\_Synthesis} $\rightarrow$ \texttt{12\_Integrity} $\rightarrow$ \texttt{13\_Critique} & Docker + Deterministic Verifiers + \texttt{TierOptimizer} & Multi-cohort PRIDE stress tests exposed Turn-1 panic aborts, HITL self-confirmation, annotation ghosting, and stale-file rubber-stamping. & Added Turn-1 \texttt{fail\_phase} blocks, immutable \texttt{docs/data.md} accounting ledgers, \texttt{.status.json} provenance latches, and \texttt{mtime} file-modification verification. \\
\end{xltabular}
\end{landscape}

\subsection{Empirical Case Study of Unconstrained Agentic Execution}
\label{sec:S5.2}

Before enforcing MCP tool mediation and 13-phase encapsulation, we evaluated how three representative model classes behaved when tasked with executing the p97/VCP proteomics workflow inside an unconstrained 4-phase CLI workspace (\texttt{Generation 1}): a local 20B open-weights model (\texttt{gpt-oss-20B}), a free-tier 550B frontier model (\texttt{nemotron-3-ultra-550b}), and a commercial paid frontier reasoner (\texttt{grok-4.7}) (\textbf{Table~\ref{tab:tabS9}}).

\begin{table}[htbp]
\centering
\scriptsize
\caption{\textbf{Empirical Comparison of Unconstrained CLI Agent Execution Strategies (Generation 1 Prototype).}}
\label{tab:tabS9}
\begin{tabularx}{\textwidth}{p{3.2cm} X X X}
\toprule
\textbf{Evaluation Metric} & \textbf{Local 20B Model (\texttt{gpt-oss-20B})} & \textbf{Free-Tier 550B (\texttt{nemotron-3-ultra})} & \textbf{Frontier Reasoner (\texttt{grok-4.7})} \\
\midrule
\textbf{Pipeline Outcome} & \textbf{FAKED} (Forged checkpoint files) & \textbf{STALLED} (Phase 4 HTTP gateway timeout) & \textbf{PASSED} (Full publication manuscript) \\
\addlinespace
\textbf{Differential Expression} & \textbf{Not Calculated} (\texttt{log2FC: not available}) & \textbf{Calculated} ($N=5,586$, 36 hits, VCP $-80.0\%$) & \textbf{Calculated} ($N=5,586$, 36 hits, VCP $-80.1\%$) \\
\addlinespace
\textbf{Pathway Enrichment} & \textbf{Skipped} (placeholder for future analysis) & \textbf{Calculated} (Wilcoxon/GSEA across 5 ontologies) & \textbf{Calculated} (Full GSEA across GO \& Reactome) \\
\addlinespace
\textbf{Generated Tables \& Plots} & \textbf{0 tables, 0 plots} (none produced in this run) & \textbf{2 CSV tables} (3.65 MB), \textbf{7 PNG plots} & \textbf{All tables \& plots} (29/29 artifact links verified) \\
\addlinespace
\textbf{Phase 3 Extraction Behavior} & \textbf{Forged}: Wrote \texttt{logs/03\_observations.log} with \texttt{PASS} text & \textbf{Authentic}: Executed \texttt{code/03\_observations.R} and parsed output & \textbf{Authentic}: Executed R scripts and targeted Python summary queries \\
\addlinespace
\textbf{Phase 3 \& 4 Duration} & \textbf{2 seconds each} (No R code executed) & $\sim$4 minutes in Phase 3; \textbf{timed out ($>$120s)} in Ph 4 & $\sim$3.5 minutes (Chunked into 5 sequential section edits) \\
\addlinespace
\textbf{Peak Active Prompt Context} & \textbf{65,500 tokens} (No table inspection) & \textbf{$>$150,000--200,000 tokens} (Dumped 1,144 CSV lines via \texttt{cat}) & \textbf{$<$45,000 tokens} (Targeted 2-line Python \texttt{Counter} summaries) \\
\addlinespace
\textbf{Literature \& Provenance} & Emitted \texttt{PMID: XXXX}, \texttt{DOI: YYYY}, claimed authorship by \texttt{ChatGPT-4} & Relied on offline pre-training memory & Queried Crossref/PubMed APIs (\texttt{DOI: 10.1016/j.chembiol.2021.11.005}) \\
\bottomrule
\end{tabularx}
\end{table}

This three-way experiment revealed two fundamental laws of bioinformatic agent design. First, \textbf{file-existence checkpoints are vulnerable to sycophancy collapse}: when confronted with a complex instruction set and raw file-editing tools, \texttt{gpt-oss-20B} recognized the filenames required by the checkpoint (\texttt{logs/03\_observations.log}, \texttt{docs/observations.md}, \texttt{docs/scientific\_report.md}), manually typed \texttt{Analysis Checkpoint Verification: PASS} into the log file without invoking R, filled data tables with \texttt{?} and \texttt{N/A}, and exited in 2 seconds. Second, \textbf{unmediated shell access causes fatal context bloat}: \texttt{nemotron-3-ultra-550b} performed genuine R statistics but inspected \texttt{data/table\_proteins\_enrichment\_p97\_kd-ctl.csv} via an unpaged \texttt{cat} command---flooding its prompt context with $>$1,100 raw CSV lines---and then attempted to generate a 4,000-word manuscript in a single turn, exceeding the 60--120s Cloudflare/OpenRouter prefill idle timeout. By contrast, \texttt{grok-4.7} succeeded because it wrote 6-line Python scripts to summarize CSV category counts in 2 lines of stdout and proactively chunked its manuscript writing across five incremental file edits. TidyProteomics-Agent institutionalizes \texttt{grok-4.7}'s discipline at the platform level: the MCP server (\texttt{mcp/server.py}) replaces raw CSV shell dumps with compact JSON digests (\texttt{tpa\_compile\_summary}, \texttt{tpa\_query\_expression}), keeping every model's active context under 15,000 tokens.

\subsection{Taxonomy of Cross-Phase Provenance Traps and Orchestrator Safeguards}
\label{sec:S5.3}

Stress-testing the 13-phase pipeline across eleven LLMs on the p97/VCP benchmark and across external multi-cohort PRIDE datasets---including \texttt{PXD029668} (\textit{Bacillus subtilis} surfactin response), \texttt{PXD056771} (mouse hippocampal synaptosomes with coded cohorts \texttt{s1/s2/s3}), and \texttt{PXD064630} (wild-type vs.\ \textit{Elp3}-null macrophages across LPS timepoints)---exposed seven recurring domain-specific failure archetypes. Each failure mode was systematically eliminated by engineering deterministic guardrails into \texttt{mcp/r\_daemon.R}, \texttt{src/agent/AgentLoop.ts}, \texttt{src/orchestrator/PipelineOrchestrator.ts}, and \texttt{templates/shared/agent/PROTOCOL.md} (\textbf{Table~\ref{tab:tabS10}}).

\begin{landscape}
\scriptsize
\begin{xltabular}{\linewidth}{p{3.5cm} p{5.0cm} p{4.5cm} X}
\caption{\textbf{Taxonomy of Domain-Specific Agentic Failure Archetypes and Deterministic Programmatic Safeguards.}} \label{tab:tabS10} \\
\toprule
\textbf{Failure Archetype} & \textbf{Empirical Manifestation in Agent Logs} & \textbf{Root Cognitive / Technical Cause} & \textbf{Deterministic Programmatic Safeguard} \\
\midrule
\endhead
\midrule
\multicolumn{4}{r}{\textit{Continued on next page\dots}} \\
\endfoot
\bottomrule
\endlastfoot
\textbf{1. Sycophancy Collapse \& Stale-File Rubber-Stamping} & In early CLI runs, utility models forged \texttt{PASS} logs in 2s; in PRIDE reanalyses, agents called \texttt{read\_file} for 16s (881 tokens) without editing and called \texttt{complete\_phase}. & Models optimize for task-completion tokens; naive file-existence latches pass if stale files exist from earlier phases. & \texttt{AgentLoop.verifyPhaseGateDeliverables} verifies non-zero byte thresholds ($>$500 chars), mandatory artifacts (\texttt{docs/data.md}, \texttt{data/figures.tsv}), and strict file modification timestamps (\texttt{stat.mtimeMs >= phaseStartTimeMs}) for Phases 12 and 13. \\
\addlinespace
\textbf{2. Premature ``Panic'' Aborts (\texttt{fail\_phase} Misuse)} & In multi-model trials and PRIDE tests, models called \texttt{fail\_phase} on Turn 1 (in 5--8s) when LOESS reduced median CV modestly ($0.20 \rightarrow 0.18$), when CVs returned \texttt{NaN} on pre-logged inputs, or when \texttt{tpa\_input\_audit} saw an \texttt{.xlsx} binary header. & Models conflate negative or modest empirical data properties and advisory format warnings with fatal software exceptions. & \texttt{AgentLoop.ts} blocks Turn-1 \texttt{fail\_phase} invocations unless a prior tool returned \texttt{[FAILED]} or an explicit HITL gate is triggered. \texttt{r\_daemon.R} auto-detects \texttt{.xlsx} workbooks and computes \texttt{NaN}-safe CVs ($2^x$ back-transformation). \\
\addlinespace
\textbf{3. Unilateral HITL Mutation \& Self-Confirmation} & Agents misread post-filter summaries as 0\% missing and unilaterally changed confirmed \texttt{min\_column} strategies in \texttt{docs/experiment.md} to \texttt{none}, or continued execution despite Phase 1 halting on unmapped sample codes (\texttt{s1/s2/s3}). & Agents attempt to ``helpfully'' resolve unconfirmed flags (\texttt{Confirm ...: FALSE}) or adjust study contracts to match transient tool outputs. & \texttt{PROTOCOL.md} prohibits agents from modifying Sections 1--2 or flipping \texttt{Confirm ...: FALSE} to \texttt{TRUE}. \texttt{PipelineOrchestrator.ts} enforces a hard pre-flight lock blocking Phase 02+ whenever Phase 01 is \texttt{BLOCKED} or \texttt{FAILED}. \\
\addlinespace
\textbf{4. Layer-Transition Feature Accounting Drift} & Total protein counts drifted between imported (7,055), contaminant/peptide-filtered (5,586), and per-contrast modeled rows (where all-NA condition-exclusive rows drop under grouped imputation), or $(U \text{ up} + D \text{ down}) \neq T$. & Different phases queried different assay layers (\texttt{raw} vs.\ \texttt{normalized} vs.\ \texttt{imputed}), and prose synthesis cited numbers from memory rather than locked ledgers. & \texttt{r\_daemon.R} auto-generates an immutable \texttt{docs/data.md} accounting ledger tracking exact row transitions (\textit{Imported $\rightarrow$ Purged $\rightarrow$ Quantifiable $\rightarrow$ Zero-Quant Background $\rightarrow$ Per-Contrast Modeled}), verified by the \texttt{Count Consistency Verifier}. \\
\addlinespace
\textbf{5. Imputation Amnesia \& Sample-Unit Paradox} & Phase 03 applied \texttt{min\_column} imputation (0\% missing), but Phase 11 prose claimed the contrast was unimputed (17.7\% missing) and described 6 replicate files (\texttt{ctl\_1--3}, \texttt{p97\_kd\_1--3}) as a ``two-sample comparison.'' & Long-horizon context transitions between Tier 1/2 tool runners and Tier 3 prose reasoners lose implicit experimental design state. & \texttt{tpa\_compile\_summary} injects an explicit statistical provenance header into \texttt{docs/observations.md} locking active imputation method, pre/post missingness, $\Delta\text{imp}$, and biological replicate count ($N=6$, $df$) vs.\ condition count ($K=2$). \\
\addlinespace
\textbf{6. Annotation Ghosting \& Hallucinated Provenance} & When UniProt REST queries failed in Phase 05 (\texttt{data/annotations\_uniprot.tsv} not written), Phase 07 recovered symbols from FASTA headers/memory and claimed symbols were \textit{''resolved from \texttt{data/annotations\_uniprot.tsv}''}. & Models hallucinate standard pipeline file provenance to satisfy expected narrative templates even when fallback paths were used. & \texttt{r\_daemon.R} writes a machine-readable \texttt{data/annotations\_uniprot.tsv.status.json} (\texttt{written: true/false}). \texttt{AgentLoop.ts} rejects Phase 06/07 completion if prose claims TSV resolution when \texttt{written === false}. \\
\addlinespace
\textbf{7. Prose Sign Flips, FDR Overclaims \& Malformed Tool Calls} & Across 11 LLMs, Phase 11 drafts had 29 directional sign flips and 39 FDR overclaims ($q > 0.05$); models invoked contrast string \texttt{s3/s1} as an MCP tool name or ran \texttt{npm} commands in an R workspace. & Autoregressive models invert numerator/denominator polarity during prose generation and occasionally mis-parse tool argument schemas. & \texttt{AgentLoop.ts} rejects unregistered tool names (\texttt{!this.tools.hasTool(tc.name)}). Decoupled Phase 12 (\texttt{12\_Integrity} $\rightarrow$ \texttt{manuscript\_rev\_01.md}) and Phase 13 (\texttt{13\_Critique} $\rightarrow$ \texttt{manuscript\_rev\_02.md}) with deterministic hard caps eliminate 93.1\% of sign errors. \\
\end{xltabular}
\end{landscape}

\end{document}
"""

for p in TARGET_PATHS:
    os.makedirs(os.path.dirname(p), exist_ok=True)
    with open(p, "w", encoding="utf-8") as f:
        f.write(TEX_CONTENT.strip() + "\n")
    print(f"Updated: {p}")
