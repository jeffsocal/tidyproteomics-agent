---
tools: []
---

### Phase 11: Publication-Grade Scientific Manuscript Synthesis

In this phase, you (the LLM) will author a comprehensive, publication-grade scientific manuscript (`docs/manuscript.md`).

Target execution budget: **Strictly 5 turns max**.

---

#### Consolidated 5-Turn Execution Architecture

To achieve publication-grade scientific depth without exploding turn and token counts:
- **No Pre-Flight Reading Turns**: All empirical statistics, sample counts, candidate records, pathway enrichments, and figure paths have already been pre-compiled into `data/manuscript_digest.json`. Ingest `data/manuscript_digest.json` in Turn 1 and proceed directly to writing.
- **Single-Turn Block Authoring Rule**: Each turn authors an entire major section in a single consolidated operation. Do NOT fragment writing into micro-turns (e.g. do not take separate turns for 2.1, 2.2, 2.3).
- **Target Section Depths**: To ensure a publication-grade manuscript that naturally clears the >30 KB quality gate on Turn 4 without iterative padding:
  - Section 2 (Materials & Methods): ~800–1,000 words
  - Section 3 (Results): ~1,500–2,000 words (including formatted markdown tables)
  - Section 4 & 5 (Discussion & Conclusions): ~1,500–2,000 words (evaluating all 4 discussion figures, top candidates, literature concordance, and study limitations)
  - Section 1, Abstract & Front Matter: ~800–1,000 words (structured abstract ~250–350 words, 5–8 keywords, biological background)
  - Total manuscript: ~4,500–6,000 words (>30 KB).

| Turn | Focus | Section Title | Target Placement in Manuscript | Input Source Context |
| :---: | :--- | :--- | :---: | :--- |
| **Turn 1** | Methods | Materials and Methods: Experimental Design, Search & Stats | Section 2 (2.1, 2.2, 2.3) | `data/manuscript_digest.json`, `docs/experiment.md` |
| **Turn 2** | Results | Results: Overview & QC, DE Analysis, Pathways, Target Validation | Section 3 (3.1, 3.2, 3.3, 3.4) | `data/manuscript_digest.json`, `docs/observations.md`, QC & DE plots |
| **Turn 3** | Discussion | Discussion & Conclusions | Section 4 & Section 5 | `data/manuscript_digest.json`, `docs/literature.md`, 4 discussion figures |
| **Turn 4** | Framing | Title, Header, Abstract, Keywords, Introduction, References & Data Availability | Sections 1, 6, 7 & Front Matter | `data/manuscript_digest.json`, `docs/llm.md`, study citations |
| **Turn 5** | Verification | Checkpoint Gate & Phase Completion | Gate Verification | File existence, size (>30KB), zero placeholders |

> ⚠️ **Strict Formatting & Autonomous Chaining Rules**:
> 1. **Continuous Autonomous Execution (Zero Conversational Intermission)**:
>    Do NOT emit conversational commentary or status announcements between sections (e.g. NEVER output *"Turn 1 complete. Ready for Turn 2."* or pause for acknowledgment). Any turn that outputs plain conversational text without calling a tool violates the pipeline protocol. Always invoke the next section's tool call (`replace_file_content`) immediately.
> 2. Do NOT include internal numeric step labels or alpha codes in the final manuscript text.

---

#### Zero-Exploration Direct Authoring Policy

- **Do NOT execute exploratory shell commands, R scripts, or directory listings**.
- All empirical data, quantitative statistics, top candidate metrics, and figure paths have already been compiled in:
  - `data/manuscript_digest.json` (compiled statistical digest and discussion figure paths)
  - `docs/observations.md` (primary data-derived observations & biomarker tables)
  - `docs/knowledge.md` (internal knowledge contextualization)
  - `docs/websearch.md` (second-layer web search findings)
  - `docs/literature.md` (third-layer DuckDB literature assertions & citations)
  - `docs/experiment.md` (study design, hypothesis, and sample groups)
- **Author `docs/manuscript.md` directly** using `write_file` (Turn 1 scaffold with Methods) and `replace_file_content` (Turns 2–4).

---

#### Master Template Scaffold (`docs/manuscript.md`)

In **Turn 1**, initialize `docs/manuscript.md` with the master scaffold containing designated insertion anchors, with Section 2 (Materials and Methods) already fully authored:

```markdown
<!-- SECTION: TITLE_AND_FRONT_MATTER -->

## 1. Introduction
<!-- SECTION: INTRODUCTION -->

## 2. Materials and Methods
### 2.1 Experimental Design
[Full text of 2.1 Experimental Design authored in Turn 1...]

### 2.2 Database Searching & Protein Quantification
[Full text of 2.2 Database Searching authored in Turn 1...]

### 2.3 Bioinformatics & Statistical Analysis
[Full text of 2.3 Bioinformatics & Statistical Analysis authored in Turn 1...]

## 3. Results
<!-- SECTION: RESULTS -->

## 4. Discussion
<!-- SECTION: DISCUSSION -->

## 5. Conclusions
<!-- SECTION: CONCLUSION -->

## 6. Documented References
<!-- SECTION: REFERENCES -->

## 7. Data & Artifact Availability
<!-- SECTION: DATA_AVAILABILITY -->
```

---

#### Turn-by-Turn Execution Schedule

Execute the synthesis strictly across the following 5 turns:

#### **Turn 1: Master Initialization & Complete Materials and Methods**
1. Read `data/manuscript_digest.json` and `data/figures.tsv` to ingest study metadata, contrast, and sample counts.
2. In the same turn, write `docs/manuscript.md` via `write_file` containing the master scaffold and the **complete, fully authored Materials and Methods section** (~800–1,000 words total across 2.1, 2.2, and 2.3):
   - **2.1 Experimental Design**: Cohort structure, sample groups, biological model, and replication scheme ($n=3$) from `docs/experiment.md`.
   - **2.2 Database Searching & Protein Quantification**: Platform (`ProteomeDiscoverer`, `MaxQuant`, etc.), analyte (`proteins`), filtering (explicitly stating initial identified entities, contaminant/decoy removal, and the $\ge 2$ unique peptides cutoff that cut the dataset from initial rows to retained proteins), and quantitation origin.
     - **Protocol Fidelity & Deviation Rule**: If source repository metadata contains implausible or nonstandard settings (e.g. '1 mL' injection volume, fixed cysteine acetylation), you MUST NOT silently rewrite or normalize them away. Quote the deposited parameter verbatim, state the correction in an explicit deviation sentence (e.g. *'Deposited protocol states 1 mL injection volume, flagged as SOURCE_PROTOCOL_ANOMALY (likely typographical error for 1 µL)'*), and do not report isoform suffixes (`-1`, `-2`) if the search was conducted without isoforms.
   - **2.3 Bioinformatics & Statistical Analysis**: Normalization benchmarking (selected normalization method and CV minimization), missing value imputation (reporting `imputation_method` from `data/manuscript_digest.json`—e.g., Random Forest `impute.randomforest` with `method = "matrix", group_by_sample = TRUE` for MAR missingness per Karpievitch et al., *BMC Bioinformatics* 2012, or column-wise minimum LOD `base::min, method = "column"` for MNAR/knockout designs, or complete-case bypass), empirical Bayes moderated $t$-test (`limma`, $|\log_2\text{FC}| \ge 1.0, q \le 0.05$), and Wilcoxon rank-sum pathway enrichment. Document true matrix missingness percentage ($N_{\text{imputed}} / (N_{\text{proteins}} \times N_{\text{replicates}}) \times 100\%$) and feature retention metrics from `data/manuscript_digest.json` (`feature_retention`), formally defining the criteria under which features drop from linear modeling (e.g. search engine identification hits lacking quantitation across replicates vs all-or-nothing condition-exclusive dropouts).
   - *Guardrail*: Do NOT fragment into multiple turns for 2.1/2.2/2.3. Write all of Section 2 in `write_file`, and **MUST include all 7 trailing and header section anchors** (`<!-- SECTION: TITLE_AND_FRONT_MATTER -->`, `<!-- SECTION: INTRODUCTION -->`, `<!-- SECTION: RESULTS -->`, `<!-- SECTION: DISCUSSION -->`, `<!-- SECTION: CONCLUSION -->`, `<!-- SECTION: REFERENCES -->`, and `<!-- SECTION: DATA_AVAILABILITY -->`) in the Turn 1 `write_file` call so Turns 2–4 can replace each anchor in a single call. In Turns 2–4, when replacing an anchor with `replace_file_content`, do NOT re-append `<!-- SECTION: ... -->` at the end of your replacement block. Do NOT write Results, Discussion, or Abstract in Turn 1.

#### **Turn 2: Complete Results & Empirical Validation**
Populate the complete Section 3 Results via `replace_file_content` targeting `<!-- SECTION: RESULTS -->` (~1,500–2,000 words). When embedding figures, always use the exact filenames recorded in `figures` in `data/manuscript_digest.json` prefixed with `../` (e.g. if `figures$pca` is `"data/plot_proteins_loess_pca_PC1PC2.png"`, embed `![Multivariate Clustering PCA](../data/plot_proteins_loess_pca_PC1PC2.png)`; omit any optional figure whose path in `figures` is `null`):
1. **3.1 Overview & Quality Control**:
   - **Single-Truth Feature Accounting**: The total quantified protein count reported across the Abstract, Results, and Tables must strictly match `data/manuscript_digest.json:total_quantified` / `feature_retention$total_quantified` (e.g. 1,941 post-filter proteins). Explicitly distinguish the modeled features (e.g. 1,640) from unmodeled features (e.g. 301, broken down into zero-intensity background vs condition-exclusive dropouts). Raw ingest rows (e.g. 2,209) must only be mentioned in Methods when explaining contaminant filtering; never quote raw counts as the quantified dataset size in Results or Abstract.
   - Dynamic range, missingness percentage, and feature retention breakdown, and embed available QC figures from `figures` in `data/manuscript_digest.json`:
   - `![Identification Counts](../<figures$counts>)`
   - `![Feature Overlap](../<figures$venn>)` (if present in `figures$venn`)
   - `![Coefficient of Variation](../<figures$variation_cv>)` (if present in `figures$variation_cv`)
   - `![Multivariate Clustering PCA](../<figures$pca>)`
   - `![Abundance Correlation Heatmap](../<figures$heatmap>)` (if present in `figures$heatmap`)
2. **3.2 Differential Expression Analysis**: Total significant counts ($|\log_2\text{FC}| \ge 1.0, q \le 0.05$, broken into upregulated and downregulated). Embed `![Volcano Plot](../<figures$volcano>)` strictly matching the primary study contrast recorded in `figures$volcano` of `data/manuscript_digest.json` (e.g. `plot_proteins_volcano_surfactin-control.png`). Secondary or exploratory comparisons (e.g. `m-control`) must never be substituted into the primary volcano slot. Formatted markdown tables for Top 10 Upregulated and Top 10 Downregulated candidates (Rank, Identifier, Description, $\log_2\text{FC}$, nominal $p$-value, adjusted $q$-value in scientific notation, `imputation_bias`, `candidate_reliability`, Function).
3. **3.3 Pathway, Functional Module & Network Analysis**: Multi-ontology enrichment summary (GO BP/CC/MF, Reactome, WikiPathways) AND/OR Phase 7 *de novo* functional modules (`domain == "de_novo_module"` in `top_pathways` / `data/de_novo_modules.tsv` when formal ontology annotations were absent or supplemented). Note: keyword-defined modules test coordinate co-movement of existing annotations; label them as investigator-defined modules. Embed pathway plots if present in `figures$enrichment` (e.g. `![Pathway Enrichment](../<figures$enrichment>)`). Explicitly state leading driver genes (`driver_proteins` / `member_genes`, e.g. `VCP, OS9, SEL1L`), Wilcoxon rank-shift $p$/$q$-values, and note that positive (+) score = induced in treatment; negative (−) score = repressed.
4. **3.4 Functional & Biological Validation**: Quantitative breakdown of target perturbation / biomarker efficacy (Target Gene Symbol, UniProt, $\log_2\text{FC}$, fold change, $p$-value, $q$-value, imputation risk, % change) comparing directly with experimental expectations from `docs/experiment.md`.
- *Guardrail*: Replace `<!-- SECTION: RESULTS -->` in a single operation. Do NOT write Discussion or Abstract in Turn 2.

#### **Turn 3: Complete Discussion & Conclusions**
Populate Section 4 Discussion and Section 5 Conclusions via `replace_file_content` targeting `<!-- SECTION: DISCUSSION -->` and `<!-- SECTION: CONCLUSION -->` (~1,500–2,000 words):
1. **4. Discussion**:
   - **The 70/30 Evidentiary Rule**: At least 70% empirical data interpretation; at most 30% external literature contextualization.
   - **Mandatory Top-Candidate Accounting**: Address and mechanistically evaluate every candidate in the Top 5 Upregulated and Top 5 Downregulated tables.
   - **Actionable Synthesis: Biological Signatures, Role-Classified Targets & Translational Archetype (`actionable_synthesis` in `manuscript_digest.json`)**:
     - Explicitly frame the dataset's **Primary Actionable Archetype** (`primary_archetype` & `archetype_rationale`: e.g., whether the findings define a *Predictive Biomarker Panel*, a *Druggable Target / Synthetic Vulnerability*, a *Mechanistic Dependency*, or a *Model of Cellular Response & Adaptive Remodeling*).
     - Justify the biological programs displayed in `plot_discussion_dichotomy.png` using `signature_rationale` and the statistical rank-shift metrics from Phase 5 pathways or Phase 7 *de novo* functional modules (`data/de_novo_modules.tsv`), demonstrating why these genes form a coherent functional signature rather than an arbitrary fold-change slice.
     - Evaluate every prioritized candidate in `plot_discussion_candidates.png` (or `plot_discussion_literature_forest.png`) by its assigned **Actionable Role** (`Predictive Biomarker`, `Druggable Target`, `Mechanistic Dependency`, `Compensatory Buffer`), integrating its statistical reliability (`ROBUST_QUANTITATIVE` vs. `DETECTION_LIMITED_ON_OFF`) and mechanistic rationale.
   - **Mandatory Discussion Figure Embedding**: Embed and evaluate all discussion figures from `discussion_figures` in `data/manuscript_digest.json` using the authoritative captions and types defined in `data/figures.tsv`:
     - `![Focused Biological Module](../data/plot_discussion_module.png)` (⚠️ **Caption Contract**: this represents a functional module heatmap; NEVER label or title it as an 'abundance correlation heatmap')
     - `![Opposing Biological Programs](../data/plot_discussion_dichotomy.png)`
     - `![Candidate Targets Forest Plot](../data/plot_discussion_candidates.png)` (or `![Literature Validation Forest Plot](../data/plot_discussion_literature_forest.png)` if `literature_status` was `"ACTIVE"`)
     - `![Imputation Diagnostic Strip Plot](../data/plot_discussion_imputation_diagnostic.png)`
   - **Candidate Reliability Tag & Count Arithmetic Discipline**:
     - Candidate reliability tags and imputation deltas in narrative and tables must match `docs/observations.md` exactly. If a candidate (e.g. `Cox6c`) is marked `HIGH_UNCERTAINTY` or `imputation_bias: MODERATE/HIGH`, you MUST NOT describe it as 'robust quantitative' or 'robustly quantified'.
     - Count arithmetic must be strictly consistent: any stated $(U \text{ up} + D \text{ down})$ must sum exactly to stated total $T$ (e.g. $217 + 148 = 365$, not $366$).
   - **Literature Integration & Sub-Threshold Dynamics**:
     - If `literature_status == "ACTIVE"`, integrate study IDs, DOIs, and grounded citations from `docs/literature.md` and `docs/websearch.md`.
     - If `literature_status == "SKIPPED"`, explicitly note that a local literature graph database was not configured for this organism/study; calibrate biological interpretation using web search findings and empirical data without fabricating literature concordance claims.
   - **Reconciliation with Experimental Hypothesis**: Point-by-point evaluation against `docs/experiment.md`.
   - **Limitations & Actionable "What To Do Next" Experimental Roadmap**:
     - Address sample size ($n=3$), residual missingness, LOD on/off candidate bias, and feature retention accounting (reconciling modeled vs unmodeled rows via `feature_retention` in `manuscript_digest.json`: noting search engine identification-only hits lacking quantitation and condition-exclusive dropouts).
     - Present the structured **3-Pillar "What To Do Next" Roadmap** from `actionable_synthesis$next_steps`:
       1. *Orthogonal Validation* (targeted PRM/SRM or immunoblot confirmation of `ROBUST_QUANTITATIVE` vs `DETECTION_LIMITED_ON_OFF` markers).
       2. *Mechanistic / Functional Perturbation* (genetic knockdown/overexpression, pharmacological inhibition, or metabolic rescue testing the lead `Druggable Target` or `Mechanistic Dependency`).
       3. *Translational / Model Expansion* (time-course kinetics, dose-response, or cohort stratification).
2. **5. Conclusions**: Concise summary of the primary proteomic hallmark, the overarching actionable model (`primary_archetype`), and the prioritized next experimental direction.
- *Guardrail*: Author both sections in full depth. Do NOT call `complete_phase` yet.

#### **Turn 4: Framing, Abstract, Title, Introduction & References**
Populate the framing and reference sections via `replace_file_content` (~800–1,000 words):
1. Replace `<!-- SECTION: TITLE_AND_FRONT_MATTER -->` with:
   - Descriptive publication title highlighting the perturbation, model, and primary discoveries.
   - Standard Document Header referencing `docs/llm.md`:
     ```markdown
     # Title

     Created: YYYY-MM-DD HH:MM  
     Author: PROVIDER | LLM-MODEL  
     Agent: TidyProteomicsAgent vX.X.X  
     R Package: tidyproteomics vX.X.X  
     ```
   - **Abstract**: Comprehensive structured abstract (~250–350 words: Background, Objective, Methods, Results, Conclusions) reflecting finalized empirical numbers.
   - **Keywords**: 5–8 MeSH and proteomics indexing keywords.
2. Replace `<!-- SECTION: INTRODUCTION -->` with:
   - **1. Introduction**: Biological context of the system/model, known physiological roles, and study rationale leading directly to the working hypothesis.
3. Replace `<!-- SECTION: REFERENCES -->` and `<!-- SECTION: DATA_AVAILABILITY -->` with:
   - **6. Documented References**: Complete bibliography compiling literature citations and study IDs across `docs/*`. All external citations MUST be grounded in tool-returned records with valid PMIDs or DOIs from Phase 8/9; unverified memory citations lacking identifiers must not be included.
   - **7. Data & Artifact Availability**: Explicit relative markdown links to scripts in `code/`, logs in `logs/`, tables in `data/`, and generated figures (`../data/*.png`, `../data/plot_discussion_*.png`).

#### **Turn 5: Checkpoint Verification & Completion**
- [ ] Verify that `docs/manuscript.md` exists with non-zero size (>30KB).
- [ ] Verify that all `<!-- SECTION: ... -->` placeholder comments have been replaced with full narrative text (e.g. `! grep -q "SECTION:" docs/manuscript.md` or `grep -c "SECTION:" docs/manuscript.md || true` to avoid exit code 1 when 0 matches remain).
- [ ] Invoke `complete_phase(phaseName = "11_SYNTHESIS", summary = "Authored publication-grade manuscript in docs/manuscript.md following staged chronological execution (Methods -> Results -> Discussion -> Introduction -> Abstract) into canonical publication structure.")`.
