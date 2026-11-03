# TidyProteomics Agent: Scientific Guide to Quantitative Analysis & Methodology

An in-depth scientific reference explaining the biological, physical, and statistical rationale behind quantitative normalization, missing value imputation, differential expression, and functional enrichment in mass spectrometry proteomics, supported by peer-reviewed literature citations and persistent web links.

---

## Table of Contents
1. [Physical & Technical Foundations of Quantitative Proteomics](#1-physical--technical-foundations-of-quantitative-proteomics)
   - [Sources of Systematic Bias in LC-MS/MS](#sources-of-systematic-bias-in-lc-msms)
   - [The Distinction Between Technical Noise and Biological Signal](#the-distinction-between-technical-noise-and-biological-signal)
2. [Quantitative Normalization Strategies](#2-quantitative-normalization-strategies)
   - [Why Normalization is Essential](#why-normalization-is-essential)
   - [Linear Normalization Models](#linear-normalization-models)
     - [`scaled` (Total / Mean / Median Intensity Scaling)](#scaled-total--mean--median-intensity-scaling)
     - [`median` (Median Centering)](#median-median-centering)
     - [`linear` (Linear Regression Scaling)](#linear-linear-regression-scaling)
     - [`limma` (Cyclic Loess / Linear Empirical Bayes Normalization)](#limma-cyclic-loess--linear-empirical-bayes-normalization)
   - [Non-Linear Normalization Models](#non-linear-normalization-models)
     - [`loess` (Locally Estimated Scatterplot Smoothing)](#loess-locally-estimated-scatterplot-smoothing)
     - [`svm` (Support Vector Regression Normalization)](#svm-support-vector-regression-normalization)
     - [`randomforest` (Random Forest Ensemble Normalization)](#randomforest-random-forest-ensemble-normalization)
   - [Sub-Population Normalization (`subset_filter`)](#sub-population-normalization-subset_filter)
     - [Biological Rationale (Asymmetric Perturbations)](#biological-rationale-asymmetric-perturbations)
     - [Mathematical Constraint: Out-of-Sample Extrapolation](#mathematical-constraint-out-of-sample-extrapolation)
   - [Benchmarking Metrics & Decision Framework](#benchmarking-metrics--decision-framework)
     - [Replicate Coefficient of Variation (CV) Reduction](#replicate-coefficient-of-variation-cv-reduction)
     - [Unsupervised Clustering & PCA Separation](#unsupervised-clustering--pca-separation)
     - [Normalization Sensitivity Analysis](#normalization-sensitivity-analysis)
   - [Comparative Decision Matrix for Normalization](#comparative-decision-matrix-for-normalization)
   - [Supporting Scientific Publications for Normalization](#supporting-scientific-publications-for-normalization)
3. [Missing Value Imputation Strategies](#3-missing-value-imputation-strategies)
   - [The Taxonomy of Missing Data in Mass Spectrometry](#the-taxonomy-of-missing-data-in-mass-spectrometry)
     - [MCAR: Missing Completely At Random](#mcar-missing-completely-at-random)
     - [MAR: Missing At Random](#mar-missing-at-random)
     - [MNAR: Missing Not At Random](#mnar-missing-not-at-random)
   - [Supported Imputation Algorithms](#supported-imputation-algorithms)
     - [`randomforest_grouped` (MissForest within Biological Conditions / MAR)](#randomforest_grouped-missforest-within-biological-conditions--mar)
     - [`min_column` (Replicate Limit of Detection / MNAR Knockout Override)](#min_column-replicate-limit-of-detection--mnar-knockout-override)
     - [`min_row_grouped` (Grouped Minimum Abundance)](#min_row_grouped-grouped-minimum-abundance)
     - [`none` (Complete-Case Bypass / Pre-Imputed Pass-Through)](#none-complete-case-bypass--pre-imputed-pass-through)
   - [Statistical & Downstream Modeling Trade-Offs](#statistical--downstream-modeling-trade-offs)
     - [The Risk of Imputing MNAR with MAR Algorithms](#the-risk-of-imputing-mnar-with-mar-algorithms)
     - [The Risk of Imputing MAR with Fixed Noise Floors](#the-risk-of-imputing-mar-with-fixed-noise-floors)
     - [Condition-Exclusive Dropouts in Linear Models (`limma`)](#condition-exclusive-dropouts-in-linear-models-limma)
   - [Comparative Decision Flowchart for Imputation](#comparative-decision-flowchart-for-imputation)
   - [Supporting Scientific Publications for Imputation](#supporting-scientific-publications-for-imputation)
4. [Quantitative Differential Expression Analysis & Statistical Methods](#4-quantitative-differential-expression-analysis--statistical-methods)
   - [Foundations of Differential Expression in Proteomics](#foundations-of-differential-expression-in-proteomics)
   - [Supported Differential Expression Methods in `tidyproteomics`](#supported-differential-expression-methods-in-tidyproteomics)
     - [`limma` (Empirical Bayes Moderated $t$-Test — Default & Recommended)](#limma-empirical-bayes-moderated-t-test--default--recommended)
     - [`t.test` (Standard Two-Sample Student's & Welch's $t$-Test)](#ttest-standard-two-sample-students--welchs-t-test)
     - [`wilcoxon` (Mann-Whitney $U$ / Non-Parametric Rank-Sum Test)](#wilcoxon-mann-whitney-u--non-parametric-rank-sum-test)
     - [`mixed-effects` (Linear Mixed-Effects Models)](#mixed-effects-linear-mixed-effects-models)
   - [Multiple Hypothesis Testing Correction & FDR Control](#multiple-hypothesis-testing-correction--fdr-control)
   - [Pairwise Contrast Formulation, Covariates & Sample Pooling](#pairwise-contrast-formulation-covariates--sample-pooling)
     - [Contrast Formulation and Log2 Fold-Change Orientation](#contrast-formulation-and-log2-fold-change-orientation)
     - [Confounded Batch Effects and Variance Partitioning](#confounded-batch-effects-and-variance-partitioning)
   - [Volcano Plot Visual Diagnostics & Candidate Prioritization](#volcano-plot-visual-diagnostics--candidate-prioritization)
     - [Dual-Cutoff Candidate Prioritization](#dual-cutoff-candidate-prioritization)
   - [Comparative Decision Matrix for Differential Expression](#comparative-decision-matrix-for-differential-expression)
   - [Supporting Scientific Publications for Differential Expression](#supporting-scientific-publications-for-differential-expression)
5. [Functional Enrichment Analysis & Biological Pathway Methods](#5-functional-enrichment-analysis--biological-pathway-methods)
   - [Foundations of Functional Enrichment in Proteomics](#foundations-of-functional-enrichment-in-proteomics)
   - [Over-Representation Analysis (ORA) vs Functional Class Scoring (GSEA)](#over-representation-analysis-ora-vs-functional-class-scoring-gsea)
   - [Supported Functional Enrichment Methods in `tidyproteomics`](#supported-functional-enrichment-methods-in-tidyproteomics)
     - [`gsea` (Gene Set Enrichment Analysis — Subramanian et al., 2005)](#gsea-gene-set-enrichment-analysis--subramanian-et-al-2005)
     - [`wilcoxon` (Wilcoxon Rank-Sum Shift Test — Native TidyProteomics Engine)](#wilcoxon-wilcoxon-rank-sum-shift-test--native-tidyproteomics-engine)
     - [`fisher` (Fisher's Exact Test / Hypergeometric Over-Representation)](#fisher-fishers-exact-test--hypergeometric-over-representation)
   - [Biological Ontologies & Knowledgebase Integration](#biological-ontologies--knowledgebase-integration)
   - [The Critical Proteomics Background Space](#the-critical-proteomics-background-space)
   - [Directional Sign Convention for Enrichment Scores](#directional-sign-convention-for-enrichment-scores)
   - [Handling Unannotated Proteomes & Graceful Autonomous Continuation](#handling-unannotated-proteomes--graceful-autonomous-continuation)
   - [Comparative Decision Matrix for Functional Enrichment](#comparative-decision-matrix-for-functional-enrichment)
   - [Supporting Scientific Publications for Functional Enrichment](#supporting-scientific-publications-for-functional-enrichment)

---

## 1. Physical & Technical Foundations of Quantitative Proteomics

### Sources of Systematic Bias in LC-MS/MS
In bottom-up quantitative liquid chromatography-tandem mass spectrometry (LC-MS/MS)—whether data-dependent acquisition (DDA), data-independent acquisition (DIA), or multiplexed isobaric labeling (TMT/iTRAQ)—signal intensities are influenced by a cascade of pre-analytical and analytical variables:
1. **Sample Preparation & Digestion**: Pipetting inaccuracies, protein extraction efficiencies, enzymatic cleavage kinetics, and peptide desalting losses on solid-phase extraction (SPE) cartridges.
2. **Chromatographic Instability**: Gradual retention-time drift, column aging, stationary phase fouling, and solvent gradient inconsistencies.
3. **Electrospray Ionization (ESI) Variability**: Changes in emitter tip geometry, ambient temperature, humidity, spray voltage, and compound-dependent matrix suppression effects.
4. **Mass Analyzer & Detector Dynamics**: Quadrupole transmission fluctuations, ion-trap filling limits (automatic gain control / AGC targets), space-charge distortions, and detector degradation over long multi-day acquisition sequences.

### The Distinction Between Technical Noise and Biological Signal
These technical factors introduce **systematic, non-biological variation** across runs. Without rigorous computational correction, technical shifts obscure true biological differential expression, elevate false positive rates (FPR), and inflate replicate variance.

The goal of data preprocessing in TidyProteomics is to isolate and remove systematic technical distortions while preserving genuine biological variance across experimental conditions.

---

## 2. Quantitative Normalization Strategies

### Why Normalization is Essential
Normalization adjusts quantitative abundances across liquid chromatography runs so that quantitative comparisons reflect biological changes rather than differences in sample loading or instrument sensitivity.

In TidyProteomics, normalization is benchmarked across candidate algorithms in Phase 2 (`02_NORMALIZE`). The optimal algorithm is selected based on minimizing median replicate Coefficient of Variation (CV) and optimizing Principal Component Analysis (PCA) cohort clustering.

---

### Linear Normalization Models

Linear normalization methods assume that technical bias can be modeled as a scalar multiplication factor or additive offset in $\log_2$ space across the entire dynamic range.

#### `scaled` (Total / Mean / Median Intensity Scaling)
- **Mathematical Principle**: Computes the sum, mean, or median of all quantified peptide or protein intensities within each sample, calculates a global scaling factor relative to the average or median sample total, and multiplies all abundances by this factor:
  $$\hat{y}_{ij} = y_{ij} \times \frac{\tilde{Y}_{\text{ref}}}{\sum_{k} y_{kj}}$$
- **Key Assumptions**: Total protein biomass is approximately equal across all samples; the majority of proteins do not change across conditions; technical bias is proportional and constant across the entire intensity spectrum.
- **When to Use**: High-load DDA or DIA studies with well-balanced protein concentrations, or as a fast baseline normalization.
- **Limitations**: Highly sensitive to extreme outliers or hyper-abundant serum/plasma proteins (e.g. Albumin) that dominate total ion current (TIC).

#### `median` (Median Centering)
- **Mathematical Principle**: Calculates the median $\log_2$ intensity for each sample and shifts all values so that all samples share an identical median:
  $$\hat{y}_{ij} = y_{ij} - \text{median}_i(y_{ij}) + \text{median}_{\text{all}}$$
- **Key Assumptions**: The median protein abundance is invariant across biological conditions. More robust against hyper-abundant outliers than total intensity scaling.
- **When to Use**: General label-free quantification (LFQ) and isobaric labeling (TMT) when dynamic range is broad and extreme outliers may be present.
- **Limitations**: Assumes symmetric perturbation around the median; cannot correct intensity-dependent curvature.

#### `linear` (Linear Regression Scaling)
- **Mathematical Principle**: Selects a representative reference sample (or pseudo-reference built from the median across runs) and fits a simple linear regression $y_{ij} = \alpha_j + \beta_j y_{i,\text{ref}} + \epsilon_{ij}$. Abundances are then adjusted by the estimated slope $\hat{\beta}_j$ and intercept $\hat{\alpha}_j$.
- **When to Use**: When run-to-run variation exhibits proportional scaling drift with an intercept shift.
- **Limitations**: Enforces a rigid straight-line relationship across the entire intensity scale.

#### `limma` (Cyclic Loess / Linear Empirical Bayes Normalization)
- **Mathematical Principle**: Adapts the linear and empirical Bayes normalization routines from the gold-standard `limma` Bioconductor package (Ritchie et al., 2015). Pairwise linear fits or cyclic loess iterations are performed across sample pairs until convergence.
- **When to Use**: Complex multi-replicate experimental designs with moderate inter-batch variance where downstream differential expression will be evaluated using linear models and empirical Bayes moderation.
- **Limitations**: Computationally heavier than median centering; cannot be extrapolated to unobserved sub-populations.

---

### Non-Linear Normalization Models

In many LC-MS instruments, detector response is non-linear: low-abundance ions experience ion suppression or detector thresholding, while high-abundance ions suffer from detector saturation or space-charge effects. Non-linear models correct this intensity-dependent curvature.

#### `loess` (Locally Estimated Scatterplot Smoothing)
- **Mathematical Principle**: Fits localized low-degree polynomials across sliding intensity windows along the MA plot ($M = \log_2(y_1/y_2)$ vs. $A = \frac{1}{2}\log_2(y_1 y_2)$). The fitted curve $\hat{M}(A)$ represents intensity-dependent technical bias and is subtracted from the observed log ratios.
- **When to Use**: Large-scale label-free proteomics with wide dynamic range ($>4$ orders of magnitude), where low-abundance and high-abundance proteins exhibit divergent run-to-run drift.
- **Limitations**: Assumes that at any given intensity level, roughly equal numbers of proteins are up-regulated and down-regulated (symmetric regulation assumption).

#### `svm` (Support Vector Regression Normalization)
- **Mathematical Principle**: Utilizes Support Vector Regression (SVR) with an $\epsilon$-insensitive loss function and radial basis function (RBF) kernel to learn non-linear mapping functions between runs.
- **When to Use**: Studies where non-linear drift is punctuated by extreme leverage points or asymmetric outliers that would otherwise distort polynomial smoothing.
- **Unique Advantage**: Because SVR learns a continuous kernel decision function over the feature space, **`svm` can extrapolate normalization adjustments beyond a training sub-population** (unlike Loess or Random Forest).

#### `randomforest` (Random Forest Ensemble Normalization)
- **Mathematical Principle**: Trains an ensemble of regression decision trees to model complex, multi-dimensional non-linear relationships across samples without making parametric assumptions.
- **When to Use**: Datasets with complex multi-factorial batch effects and severe non-linear distortions.
- **Limitations**: High computational overhead ($O(N_{\text{trees}} \times M \log M)$); cannot extrapolate outside the training feature range.

---

### Sub-Population Normalization (`subset_filter`)

#### Biological Rationale (Asymmetric Perturbations)
Standard global normalization methods assume that **the total proteome remains constant** and that **differential expression is symmetric** (equal numbers of proteins go up and down). This assumption completely breaks down in several critical biological scenarios:
1. **Global Transcriptional / Translational Shutdown**: Viral infection (e.g. SARS-CoV-2, Poliovirus shutoff of host translation), heat shock, or high-dose cycloheximide treatment.
2. **Global Hyper-Transcription**: Oncogene amplification (e.g. c-Myc overexpression driving massive global biomass expansion).
3. **Sub-Cellular Fractionation / Organelle Enrichments**: Mitochondrial, nuclear, or membrane-bound fractions where global yields differ fundamentally by preparation.
4. **Tissue Secretomes & Biofluids**: Condition-specific protein shedding or leakage.

In these cases, normalizing to the global median causes true biological changes to be normalized away, creating widespread false down-regulation of invariant proteins!

**Solution**: Train normalization parameters exclusively on a validated **invariant sub-population** (e.g., core ribosomal structural proteins, stable mitochondrial complexes, or spiked-in standards) using the `subset_filter` parameter in `docs/experiment.md`:
```markdown
- **Normalization Subset Filter**: description %like% "Ribosome"
```

#### Mathematical Constraint: Out-of-Sample Extrapolation
When normalization factors are calculated on a subset of proteins (e.g. 80 ribosomal proteins) and then applied to all 6,000 quantifiable proteins in the proteome, the underlying mathematical algorithm must possess **out-of-sample extrapolation capability**:

| Method | Mathematical Extrapolation Support | Supported with `subset_filter`? | Explanation |
|:---|:---:|:---:|:---|
| `scaled` | **YES** | **YES** | Derives a single scalar multiplier from the subset and multiplies all proteome features. |
| `median` | **YES** | **YES** | Computes subset median offset and shifts the entire proteome coordinate space. |
| `linear` | **YES** | **YES** | Slope and intercept estimated on subset are evaluated across all protein intensities. |
| `svm` | **YES** | **YES** | Support vectors form a continuous global functional mapping across feature space. |
| `limma` | **NO** | **NO** | Cyclic loess interpolates strictly across rank-ordered sample points; cannot extrapolate. |
| `loess` | **NO** | **NO** | Local polynomials are undefined outside the intensity domain of the training subset. |
| `randomforest` | **NO** | **NO** | Decision trees predict piecewise constant values and cannot extrapolate beyond subset min/max. |

> **Rule of Thumb**: When applying `subset_filter`, always configure `Normalization Methods` to linear models and SVM:
> `- **Normalization Methods**: scaled, median, linear, svm`

---

### Benchmarking Metrics & Decision Framework

In TidyProteomics, normalization is an empirical science. Rather than guessing which method is superior, Phase 2 tests candidate algorithms simultaneously and ranks them using objective metrics:

#### Replicate Coefficient of Variation (CV) Reduction
The primary objective of normalization across technical and biological replicates is to reduce intra-group variance while preserving inter-group biological variance:
$$\text{CV} = \frac{\sigma_{\text{replicates}}}{\mu_{\text{replicates}}} \times 100\%$$
- The algorithm that produces the **lowest median replicate CV** across quantifiable proteins is ranked as the primary candidate.
- TidyProteomics generates `data/plot_*_normalizated_variation.png` showing CV distribution density curves across all candidates.

#### Unsupervised Clustering & PCA Separation
In the Principal Component Analysis (PCA) score plot (`data/plot_*_pca_PC1PC2.png`):
- Biological replicates within the same experimental condition should cluster tightly together.
- Distinct biological conditions (e.g. `Treated` vs `Control`) should separate cleanly along Principal Component 1 (PC1) and Principal Component 2 (PC2).
- If unnormalized data clusters by acquisition date or processing batch, successful normalization should collapse the batch effect and restore biological clustering.

#### Normalization Sensitivity Analysis
When the top two normalization candidates produce nearly identical median CVs (e.g. Loess at 12.1% CV vs Median Centering at 12.4% CV), the agent invokes `tpa_normalization_sensitivity`:
- Evaluates whether the set of statistically significant differentially expressed proteins ($p < 0.05, |\log_2\text{FC}| \ge 1.0$) changes substantially between the two methods.
- Candidates that are invariant to the choice of normalization algorithm are flagged as high-confidence biological hits.

---

### Comparative Decision Matrix for Normalization

| Experimental Context | Recommended Methods | Rationale | Literature Reference |
|:---|:---|:---|:---|
| **Standard Label-Free DIA / DDA** (balanced design, equal loading) | `loess`, `median`, `limma` | Corrects intensity-dependent curvature and median run drift. | Välikangas et al., *Brief Bioinform* (2018) |
| **Multiplexed Isobaric (TMT / iTRAQ)** (single plex) | `median`, `scaled` | TMT channels exhibit linear ratio compression; median centering corrects channel loading. | Callister et al., *J Proteome Res* (2006) |
| **Wide Dynamic Range LFQ** ($>4$ orders of magnitude, Orbitrap/timsTOF) | `loess`, `svm` | Accommodates non-linear detector response at upper and lower boundaries. | Bolstad et al., *Bioinformatics* (2003) |
| **Asymmetric Biology / Translation Shutdown / Spike-In** | `median` (with `subset_filter`), `linear`, `svm` | Global assumptions fail; must train on invariant sub-population with extrapolation support. | Chawade et al., *J Proteome Res* (2014) |
| **High Missingness ($>30\%$) / Sparse LFQ** | `median`, `scaled` | Local non-linear smoothers overfit when matrix sparsity is elevated. | Välikangas et al., *Brief Bioinform* (2018) |

---

### Supporting Scientific Publications for Normalization

1. **Välikangas, T., Suomi, T., & Elo, L. L. (2018)**. *A systematic evaluation of normalization methods in quantitative label-free proteomics*. **Briefings in Bioinformatics**, 19(1), 1–11.
   - **Key Finding**: Benchmarked 11 normalization algorithms across spike-in and biological LFQ datasets. Demonstrated that variance-stabilizing and local regression methods (`loess`, `linear`) consistently outperformed basic total intensity scaling in controlling false discoveries.
   - **PubMed ID**: [27694351](https://pubmed.ncbi.nlm.nih.gov/27694351/) | **DOI**: [10.1093/bib/bbw095](https://doi.org/10.1093/bib/bbw095)

2. **Callister, S. J., et al. (2006)**. *Normalization approaches for removing systematic biases associated with mass spectrometry and label-free proteomics*. **Journal of Proteome Research**, 5(2), 277–286.
   - **Key Finding**: Seminal paper establishing linear and non-linear regression normalization for LC-MS peptide abundance, establishing replicate CV reduction as an objective evaluation criterion.
   - **PubMed ID**: [16457593](https://pubmed.ncbi.nlm.nih.gov/16457593/) | **DOI**: [10.1021/pr050300l](https://doi.org/10.1021/pr050300l)

3. **Bolstad, B. M., et al. (2003)**. *A comparison of normalization methods for high density oligonucleotide array data based on variance and bias*. **Bioinformatics**, 19(2), 185–193.
   - **Key Finding**: Mathematical derivation of Cyclic Loess and quantile normalization, proving that intensity-dependent non-linear bias requires localized smoothing functions.
   - **PubMed ID**: [12538238](https://pubmed.ncbi.nlm.nih.gov/12538238/) | **DOI**: [10.1093/bioinformatics/19.2.185](https://doi.org/10.1093/bioinformatics/19.2.185)

4. **Ritchie, M. E., et al. (2015)**. *limma powers differential expression analyses for RNA-sequencing and microarray studies*. **Nucleic Acids Research**, 43(7), e47.
   - **Key Finding**: Demonstrates linear modeling and empirical Bayes variance shrinkage, foundation for `tpa_normalize(methods = "limma")` and downstream Phase 4 differential expression.
   - **PubMed ID**: [25605792](https://pubmed.ncbi.nlm.nih.gov/25605792/) | **DOI**: [10.1093/nar/gkv007](https://doi.org/10.1093/nar/gkv007)

5. **Chawade, A., et al. (2014)**. *Normalyzer: a tool for rapid evaluation of normalization methods on mass spectrometry based proteomics data*. **Journal of Proteome Research**, 13(6), 3114–3120.
   - **Key Finding**: Established comparative evaluation metrics including replicate CV, pooled variance plots, and MA distribution symmetry.
   - **PubMed ID**: [24779435](https://pubmed.ncbi.nlm.nih.gov/24779435/) | **DOI**: [10.1021/pr401264n](https://doi.org/10.1021/pr401264n)

---

## 3. Missing Value Imputation Strategies

### The Taxonomy of Missing Data in Mass Spectrometry
Missing quantitative values are ubiquitous in LC-MS proteomics, typically affecting 10% to 45% of quantified proteins in label-free experiments. Crucially, missing values arise through **two fundamentally distinct mechanisms** (Karpievitch et al., 2012; Lazar et al., 2016):

```
                        ┌────────────────────────────────────────────────────────┐
                        │              MISSING VALUES IN LC-MS                   │
                        └──────────────────────────┬─────────────────────────────┘
                                                   │
                 ┌─────────────────────────────────┴─────────────────────────────────┐
                 ▼                                                                   ▼
   ┌───────────────────────────┐                                       ┌───────────────────────────┐
   │ MISSING AT RANDOM (MAR)   │                                       │MISSING NOT AT RANDOM(MNAR)│
   └─────────────┬─────────────┘                                       └─────────────┬─────────────┘
                 │                                                                   │
   • Sporadic ionization loss                                          • Abundance below MS Limit  │
   • Precursor co-isolation failure                                      of Detection (LOD)        │
   • Match-Between-Runs (MBR) drop                                     • Genetic Knockout (CRISPR) │
   • Retention time boundary slice                                     • siRNA/shRNA silencing     │
                 │                                                     • PROTAC/degrader ablation  │
                 ▼                                                     • Condition-exclusive pull  │
   ┌───────────────────────────┐                                                     │
   │  Recommended Method:      │                                                     ▼
   │  randomforest_grouped     │                                       ┌───────────────────────────┐
   │  (MissForest within       │                                       │  Recommended Method:      │
   │   biological conditions)  │                                       │  min_column               │
   └───────────────────────────┘                                       │  (MS replicate LOD)       │
                                                                       └───────────────────────────┘
```

#### MCAR: Missing Completely At Random
- Occurs completely independent of protein identity or abundance.
- Examples: Instrument autosampler failure, dropped spray droplets, bubble transit in capillary. Rare in high-quality LC-MS runs.

#### MAR: Missing At Random
- Stochastic dropouts where missingness depends on observable technical variables (e.g. low peptide abundance near the limit of detection, chromatographic retention alignment failure across runs), but where **the protein is physically present in the sample**.
- Critical Characteristic: If Replicate A has an abundance of 100,000 and Replicate B has 95,000, but Replicate C is `NA`, Replicate C is a sporadic MAR dropout. Its true abundance is approximately ~97,000.

#### MNAR: Missing Not At Random
- Systematic, left-censored absence where missingness is directly caused by the **true biological abundance being zero or below the instrument's Limit of Detection (LOD)**.
- Examples:
  - **CRISPR-Cas9 Genetic Knockouts (KO)**: The target gene has been deleted; protein concentration is 0.
  - **Targeted Protein Degraders (PROTACs, Molecular Glues)**: The protein has been degraded to completion in treated cells.
  - **Affinity Purification / Immunoprecipitation (IP-MS)**: Non-interacting proteins are completely absent in the mock/beads-only negative control.
  - **Condition-Exclusive Biomarkers**: Proteins expressed exclusively in diseased tissue and 100% absent in healthy controls.

---

### Supported Imputation Algorithms

#### `randomforest_grouped` (MissForest within Biological Conditions / MAR)
- **Tool Directive**: `tpa_impute(method = "impute.randomforest, method = 'matrix', group_by_sample = TRUE")`
- **Statistical Principle**: Employs an iterative non-parametric random forest algorithm (Stekhoven & Bühlmann, 2012). For each protein with missing values, the algorithm treats observed values as a training set and predicts missing values from the multi-protein covariance structure of all other proteins within the same biological condition.
- **Why `group_by_sample = TRUE` is Vital**: It restricts the predictor trees strictly to replicates belonging to the same biological condition group (e.g. only within `WildType` or only within `Treated`). This guarantees that treatment-specific covariance structures do not contaminate control profiles.
- **Behavior on 100% Condition-Exclusive Dropouts**:
  - If a protein is observed in 3/3 replicates of `Control` but is **0/3 (100% absent) across all replicates of `Knockout`**, `randomforest_grouped` cannot and **does not invent synthetic values** in `Knockout`.
  - The protein remains `NA` in `Knockout`.
  - In downstream Phase 4 and Phase 6, this protein is recognized as a qualitative biological presence/absence switch (`unmodeled_condition_exclusive`).

#### `min_column` (Replicate Limit of Detection / MNAR Knockout Override)
- **Tool Directive**: `tpa_impute(method = "base::min, method = 'column'")`
- **Statistical Principle**: Calculates the minimum quantified abundance independently within each MS run (column), representing that individual replicate's empirical Limit of Detection (LOD). All missing values across the entire dataset—including 100% condition-exclusive dropouts—are filled with that replicate's baseline noise floor.
- **Why `min_column` is Essential for Knockouts**:
  - In a genetic knockout or degrader study, the target protein has zero abundance in treated cells.
  - Standard linear modeling tools (`limma`, Student's t-test) require numerical values in both groups to compute log fold-changes, standard errors, and p-values.
  - Filling missing knockout replicates with the column LOD assigns the knockout group an empirical floor value, allowing `limma` in Phase 4 to model the comparison continuously.
  - In Phase 6, the agent tags these candidates as `DETECTION_LIMITED_ON_OFF` with massive fold changes (e.g. $\log_2\text{FC} < -6.0$).

#### `min_row_grouped` (Grouped Minimum Abundance)
- **Tool Directive**: `tpa_impute(method = "base::min, method = 'row', group_by_sample = TRUE")`
- **Statistical Principle**: Replaces missing values with the minimum observed abundance for that specific protein within its biological condition group.
- **When to Use**: High-confidence condition-specific baseline modeling where proteins exhibit condition-dependent noise floors.

#### `none` (Complete-Case Bypass / Pre-Imputed Pass-Through)
- **Tool Directive**: Bypass `tpa_impute`
- **Statistical Principle**: Preserves observed values without synthetic numerical injection.
- **When to Use**:
  - Datasets with **0% missing values** (e.g. complete single-plex TMT studies).
  - Datasets where upstream search engines (e.g. MaxQuant with Match-Between-Runs enabled or FragPipe) already applied validated imputation.
  - Complete-case analyses where only proteins quantified across 100% of samples are analyzed.

---

### Statistical & Downstream Modeling Trade-Offs

#### The Risk of Imputing MNAR with MAR Algorithms
Applying a MAR algorithm (such as global k-Nearest Neighbors / k-NN or un-grouped Random Forest) to true MNAR data (such as a CRISPR knockout) is scientifically disastrous:
- The algorithm searches for "similar" proteins and borrows synthetic positive values from other proteins.
- It injects artificial intermediate abundance into the knockout group.
- The true $\log_2\text{FC}$ of $-\infty$ is shrunk to a modest $-1.2$, causing the primary knockout phenotype to lose statistical significance!

#### The Risk of Imputing MAR with Fixed Noise Floors
Conversely, applying constant minimum or left-censored Gaussian shift (e.g. Perseus width 0.3, downshift 1.8) to true MAR dropouts introduces severe bias:
- A protein that is abundant (e.g. top 20th percentile) but suffered a single sporadic chromatographic dropout is dragged down to the instrument noise floor.
- The replicate variance explodes, and the protein is falsely flagged as down-regulated.
- Imputing thousands of MAR values with a single fixed constant produces an artificial bimodal spike at the lower boundary of the dynamic range.

#### Condition-Exclusive Dropouts in Linear Models (`limma`)
The choice between `randomforest_grouped` and `min_column` in Section 3.C of `docs/experiment.md` dictates how condition-exclusive proteins are handled downstream:

| Metric / Behavior | `randomforest_grouped` (MAR Default) | `min_column` (MNAR / Knockout Override) |
|:---|:---|:---|
| **Intra-Condition Replicate Correlation** | Modeled accurately; preserves natural variance. | Collapsed at noise floor; variance becomes 0. |
| **Sporadic (1/3 or 2/3) Missingness** | Imputed with expected value from replicate correlation. | Imputed at LOD noise floor (artificially deflates mean). |
| **Condition-Exclusive (0/3 vs 3/3) Dropouts** | Retained as `NA`; bypassed in continuous linear model. | Imputed at column LOD; modeled continuously in `limma`. |
| **Downstream Phase 6 Representation** | Tagged as qualitative switch (`unmodeled_condition_exclusive`). | Modeled in volcano plot with large $|\log_2\text{FC}|$; tagged `DETECTION_LIMITED_ON_OFF`. |
| **Primary Biological Use Case** | Complex multi-factorial studies, disease vs control, drug screens. | CRISPR knockouts, siRNA knockdowns, PROTAC degraders, IP-MS. |

---

### Comparative Decision Flowchart for Imputation

```
[Inspect Missing Value Percentage & Operations History]
                     │
     ┌───────────────┴───────────────┐
     ▼                               ▼
[Missingness = 0% OR]          [Missingness > 0%]
[Pre-Imputed in Upstream Data]       │
     │                               │
     ▼                               ▼
Select: 'none'                 [Does the experiment involve an intentional genetic KO,]
(Complete-case bypass)         [targeted degrader (PROTAC), or binary on/off switch?]
                                     │
                     ┌───────────────┴───────────────┐
                     ▼                               ▼
                   [YES]                            [NO]
                     │                               │
                     ▼                               ▼
           Select: 'min_column'            Select: 'randomforest_grouped'
           (Empirical MS replicate LOD;    (Iterative MissForest within condition
            retains condition-exclusive     groups; preserves correlation structure
            hits in continuous limma DE)    without artificial variance collapse)
```

---

### Supporting Scientific Publications for Imputation

1. **Karpievitch, Y. V., et al. (2012)**. *Statistical framework for protein quantization in bottom-up MS-based proteomics*. **BMC Bioinformatics**, 13(Suppl 16), S5.
   - **Key Finding**: Seminal paper defining the distinction between MAR and MNAR mechanisms in mass spectrometry, proving that combining linear models (`limma`) with inappropriate imputation creates massive bias.
   - **PubMed ID**: [23176165](https://pubmed.ncbi.nlm.nih.gov/23176165/) | **DOI**: [10.1186/1471-2105-13-S16-S5](https://doi.org/10.1186/1471-2105-13-S16-S5)

2. **Lazar, C., et al. (2016)**. *Accounting for the Multiple Natures of Missing Values in Label-Free Quantitative Proteomics: Challenges and Solutions*. **Journal of Proteome Research**, 15(4), 1116–1125.
   - **Key Finding**: Evaluated 8 imputation methods across 4 benchmark datasets. Concluded that MissForest and group-aware MAR methods provide the highest imputation accuracy for MAR values, while left-censored methods must be reserved strictly for MNAR biology.
   - **PubMed ID**: [26906401](https://pubmed.ncbi.nlm.nih.gov/26906401/) | **DOI**: [10.1021/acs.jproteome.5b01109](https://doi.org/10.1021/acs.jproteome.5b01109)

3. **Stekhoven, D. J., & Bühlmann, P. (2012)**. *MissForest—non-parametric missing value imputation for mixed-type data*. **Bioinformatics**, 28(1), 112–118.
   - **Key Finding**: Mathematical specification of the MissForest algorithm. Demonstrated superior imputation precision and error reduction over k-NN and SVDimpute across complex biological matrices.
   - **PubMed ID**: [22039212](https://pubmed.ncbi.nlm.nih.gov/22039212/) | **DOI**: [10.1093/bioinformatics/btr597](https://doi.org/10.1093/bioinformatics/btr597)

4. **Webb-Robertson, B. J. M., et al. (2015)**. *Review, evaluation, and discussion of the challenges of missing value imputation for mass spectrometry-based label-free global proteomics*. **Journal of Proteome Research**, 14(5), 1993–2001.
   - **Key Finding**: Comprehensive survey establishing that no single imputation algorithm fits all mass spectrometry datasets; emphasizes the necessity of matching algorithm assumptions to study design.
   - **PubMed ID**: [25855118](https://pubmed.ncbi.nlm.nih.gov/25855118/) | **DOI**: [10.1021/pr501138h](https://doi.org/10.1021/pr501138h)

5. **Wei, R., et al. (2018)**. *Missing Value Imputation Approach for Mass Spectrometry-based Metabolomics and Proteomics Data*. **Scientific Reports**, 8, 663.
   - **Key Finding**: Benchmarked imputation strategies across high-resolution MS platforms, demonstrating that random forest ensemble methods minimize normalized root mean squared error (NRMSE) while preserving true biological distribution skewness.
   - **PubMed ID**: [29330448](https://pubmed.ncbi.nlm.nih.gov/29330448/) | **DOI**: [10.1038/s41598-017-19120-0](https://doi.org/10.1038/s41598-017-19120-0)

---

## 4. Quantitative Differential Expression Analysis & Statistical Methods

Differential expression analysis in bottom-up quantitative mass spectrometry identifies proteins exhibiting statistically significant abundance shifts between experimental conditions, distinguishing true biological perturbations from analytical and technical variance.

### Foundations of Differential Expression in Proteomics

In contrast to RNA-seq count data (which follow negative binomial distributions), normalized MS1 peak intensities and spectral abundance metrics in label-free and isobaric proteomics are continuous and typically log-normally distributed. Following $\log_2$-transformation, protein abundance distributions approximate normality, making them amenable to linear modeling.

However, quantitative proteomics poses unique statistical challenges:
1. **High Dimensionality with Small Sample Sizes ($p \gg n$)**: Typically 3,000–10,000 proteins are quantified across only 3–6 biological replicates per condition. Standard sample variance estimators $s^2_i$ have low degrees of freedom ($df \approx 2-4$), causing high vulnerability to false positives (artificially tiny sample variances leading to massive test statistics) and false negatives (artificially inflated sample variances).
2. **Heteroscedasticity**: Low-abundance proteins frequently exhibit higher relative measurement error than abundant housekeeping proteins.
3. **Multiple Hypothesis Testing**: Performing thousands of simultaneous statistical tests necessitates rigorous False Discovery Rate (FDR) control to avoid widespread type I errors.

---

### Supported Differential Expression Methods in `tidyproteomics`

`tidyproteomics` provides four distinct statistical testing engines via the `expression()` verb:

#### `limma` (Empirical Bayes Moderated $t$-Test — Default & Recommended)
- **Mathematical Formulation**: Developed by Gordon Smyth (2004), `limma` employs an empirical Bayes hierarchical model that borrows information across all quantified proteins to shrink individual protein sample variances $s^2_g$ toward a global pooled prior variance $s^2_0$:
  $$\tilde{s}_g^2 = \frac{d_0 s_0^2 + d_g s_g^2}{d_0 + d_g}$$
  where $d_g$ is the original degrees of freedom ($n - p$), $s_0^2$ is the prior variance, and $d_0$ represents the prior degrees of freedom estimated across the entire proteome dataset.
- **Moderated $t$-Statistic**:
  $$\tilde{t}_{gj} = \frac{\hat{\beta}_{gj}}{\tilde{s}_g \sqrt{v_{gj}}}$$
  The resulting test statistic follows a Student's $t$-distribution with augmented degrees of freedom $d_g + d_0$.
- **Proteomics Rationale**: In low-replicate proteomics ($n=3-5$), individual variance estimates are notoriously unstable. By shrinking outlier variances toward a common trend, `limma` prevents proteins with spuriously low variance from dominating top candidate lists, dramatically boosting statistical power while strictly controlling the false positive rate.
- **Reference**: Smyth, G. K. (2004). *Linear models and empirical bayes methods for assessing differential expression in microarray experiments*. Statistical Applications in Genetics and Molecular Biology, 3(1), Article 3.

#### `t.test` (Standard Two-Sample Student's & Welch's $t$-Test)
- **Formulation**: Computes independent sample variance estimates per protein:
  $$t = \frac{\bar{x}_1 - \bar{x}_2}{\sqrt{\frac{s_1^2}{n_1} + \frac{s_2^2}{n_2}}}$$
- **Proteomics Rationale**: Provides an unmoderated, classic parametric baseline. Appropriate when replicate counts are large ($n \ge 15-20$ per group, e.g., large clinical cohort studies) where sample variances are reliably estimated without empirical Bayes shrinkage.
- **Limitation**: Highly prone to both false positives and false negatives in standard exploratory proteomics studies ($n=3-5$).

#### `wilcoxon` (Mann-Whitney $U$ / Non-Parametric Rank-Sum Test)
- **Formulation**: Ranks all pooled abundance measurements across conditions and evaluates the sum of ranks for condition 1:
  $$U = n_1 n_2 + \frac{n_1(n_1 + 1)}{2} - R_1$$
- **Proteomics Rationale**: Distribution-free; makes no parametric assumption of normality or homoscedasticity. Robust against extreme technical outliers, non-Gaussian noise, and skewed distributions.
- **Limitation**: Requires sufficient sample size for non-parametric power ($n \ge 5-6$ per group minimum; with $n=3$ per group, the minimum possible two-sided $p$-value is $1/\binom{6}{3} = 0.05$, precluding significance under multiple testing correction).

#### `mixed-effects` (Linear Mixed-Effects Models)
- **Formulation**: Models quantitative abundance using fixed effects (biological conditions, treatment, dose) and random effects (subject ID, instrument batch, collection center) via `lme4`:
  $$y = X\beta + Zb + \epsilon, \quad b \sim \mathcal{N}(0, \Psi), \quad \epsilon \sim \mathcal{N}(0, \sigma^2 I)$$
- **Proteomics Rationale**: Essential for complex longitudinal studies, patient-matched pre/post-treatment designs, crossover trials, or experiments where technical variance components must be partitioned from biological variance without losing statistical degrees of freedom.

---

### Multiple Hypothesis Testing Correction & FDR Control

Testing thousands of proteins simultaneously guarantees that even with $\alpha = 0.05$, hundreds of inactive proteins would appear significant by random chance alone. `tidyproteomics` supports standard multiple testing adjustments:

1. **Benjamini-Hochberg (BH / FDR — Default)**:
   - Ranks raw $p$-values: $p_{(1)} \le p_{(2)} \le \dots \le p_{(m)}$.
   - Controls the False Discovery Rate (expected proportion of false discoveries among rejected null hypotheses):
     $$q_{(i)} = \min_{k \ge i} \left( \frac{m \cdot p_{(k)}}{k} \right)$$
   - Standard significance threshold in proteomics: $q \le 0.05$ (5% false discovery rate).
2. **Bonferroni (Family-Wise Error Rate — FWER)**:
   - $p_{\text{adj}} = \min(1, m \cdot p)$.
   - Controls the probability of making even one type I error across all tests. Highly conservative; causes severe loss of sensitivity in large-scale proteomics.
3. **Holm-Bonferroni (Holm Step-Down)**:
   - Moderately less conservative than Bonferroni while preserving strong control of FWER: $p_{(i)} \cdot (m - i + 1)$.
4. **Benjamini-Yekutieli (BY)**:
   - Controls FDR under arbitrary or negative dependency structures between proteins (e.g. tightly co-regulated multi-protein complexes).

---

### Pairwise Contrast Formulation, Covariates & Sample Pooling

#### Contrast Formulation and Log2 Fold-Change Orientation
In `tidyproteomics`, contrast specifications are formatted as `<treatment>/<control>`:
- The numerator represents the perturbed condition (e.g. `Knockdown`, `Drug_Treated`, `Disease`).
- The denominator represents the reference baseline (e.g. `Control`, `Vehicle`, `Healthy`).
- **Effect Size Sign Convention**:
  $$\log_2\text{FC} = \log_2(\text{Treatment}) - \log_2(\text{Control})$$
  - **$\log_2\text{FC} > 0$**: Upregulated / accumulated in Treatment.
  - **$\log_2\text{FC} < 0$**: Downregulated / depleted in Treatment.

#### Confounded Batch Effects and Variance Partitioning
When biological conditions coincide with analytical batches (e.g. all replicates of Condition A run on Week 1 and Condition B on Week 2), linear models cannot statistically separate biological signal from instrument drift. In such cases:
- Linear model coefficients absorb technical bias.
- The pipeline HITL Gate (Section 3.F) enforces explicit researcher authorization before unadjusted modeling proceeds.

---

### Volcano Plot Visual Diagnostics & Candidate Prioritization

The volcano plot visualizes effect size ($\log_2\text{FC}$ on the $x$-axis) versus statistical significance ($-\log_{10}(q\text{-value})$ on the $y$-axis).

```
                      -log10(q)
                          ▲
                          │      ★ Highly Significant Candidates
                          │     /  (|log2FC| >= 1.0, q <= 0.05)
                     4.0 ─┼───★───────★
                          │
                     2.0 ─┼───★───────★
              q = 0.05 ───┼─────────────────────  Statistical Threshold
                          │   · · ·   · · ·
                          │  · · · · · · · ·      Insignificant Proteins
                     0.0 ─┴───────────┼───────────► log2FC
                                    0.0
                          ◄── Depleted   Accumulated ──►
```

#### Dual-Cutoff Candidate Prioritization
High-confidence biological regulators require satisfying both criteria:
1. **Statistical Significance**: $q \le 0.05$ (or $-\log_{10}(q) \ge 1.301$).
2. **Biological Magnitude**: $|\log_2\text{FC}| \ge 1.0$ (representing at least a 2-fold change in protein abundance).

---

### Comparative Decision Matrix for Differential Expression

| Method | Best For | Sample Size ($n$) | Outlier Sensitivity | Assumptions | Proteomics Standard |
|:---|:---|:---|:---|:---|:---|
| **`limma`** | Global LFQ/TMT discovery proteomics | $n \ge 3$ per group | Low (moderated shrinkage) | Log-normal abundance; common prior variance | **Gold Standard (Recommended)** |
| **`t.test`** | Large clinical cohorts | $n \ge 15$ per group | High | Log-normal abundance; independent variance | Baseline comparison |
| **`wilcoxon`** | Extreme non-normal skewness or heavy outliers | $n \ge 6$ per group | Zero (rank-based) | Continuous distribution, independent observations | Non-parametric fallback |
| **`mixed-effects`** | Longitudinal, repeated-measures, paired subjects | $n \ge 4$ subjects | Moderate | Linear mixed model normality for random effects | Complex multifactorial designs |

---

### Supporting Scientific Publications for Differential Expression

1. **Smyth, G. K. (2004)**. *Linear models and empirical bayes methods for assessing differential expression in microarray experiments*. **Statistical Applications in Genetics and Molecular Biology**, 3(1), Article 3.
   - **Key Finding**: Foundation of the empirical Bayes variance moderation framework implemented in `limma`, proving dramatic reduction in false discovery rates for small-sample high-throughput experiments.
   - **PubMed ID**: [16646809](https://pubmed.ncbi.nlm.nih.gov/16646809/) | **DOI**: [10.2202/1544-6115.1027](https://doi.org/10.2202/1544-6115.1027)

2. **Ritchie, M. E., et al. (2015)**. *limma powers differential expression analyses for RNA-sequencing and microarray studies*. **Nucleic Acids Research**, 43(7), e47.
   - **Key Finding**: Demonstrates the versatility, statistical robustness, and empirical Bayes shrinkage properties of `limma` across diverse omics platforms including mass spectrometry proteomics.
   - **PubMed ID**: [25605792](https://pubmed.ncbi.nlm.nih.gov/25605792/) | **DOI**: [10.1093/nar/gkv007](https://doi.org/10.1093/nar/gkv007)

3. **Benjamini, Y., & Hochberg, Y. (1995)**. *Controlling the false discovery rate: a practical and powerful approach to multiple testing*. **Journal of the Royal Statistical Society: Series B (Methodological)**, 57(1), 289–300.
   - **Key Finding**: Introduced the False Discovery Rate (FDR) controlling procedure that has become the ubiquitous standard for large-scale proteomics and genomics.
   - **JSTOR**: [2346101](https://www.jstor.org/stable/2346101) | **DOI**: [10.1111/j.2517-6161.1995.tb02031.x](https://doi.org/10.1111/j.2517-6161.1995.tb02031.x)

4. **Cox, J., & Mann, M. (2008)**. *MaxQuant enables high peptide identification rates, individualized p.p.b.-range mass accuracies and proteome-wide protein quantification*. **Nature Biotechnology**, 26(12), 1367–1372.
   - **Key Finding**: Foundational framework for high-resolution quantitative proteomics, establishing log-transformed intensity scaling and significance metrics in bottom-up proteomics.
   - **PubMed ID**: [19029910](https://pubmed.ncbi.nlm.nih.gov/19029910/) | **DOI**: [10.1038/nbt.1511](https://doi.org/10.1038/nbt.1511)

---

## 5. Functional Enrichment Analysis & Biological Pathway Methods

Functional enrichment analysis translates long lists of differentially expressed proteins into cohesive biological systems, pathways, and cellular modules. Rather than evaluating individual proteins in isolation, enrichment testing identifies biological processes that are collectively coordinated.

### Foundations of Functional Enrichment in Proteomics

Proteins function within highly organized complexes, metabolic cascades, and signaling networks. A modest 1.3-fold change across ten proteins in the same metabolic pathway often exerts greater physiological impact than a 5-fold change in a single isolated enzyme.

Enrichment methodologies evaluate whether proteins annotated with a specific biological term (e.g. *Oxidative phosphorylation*, *Cell cycle*, *Mitochondrial ribosome*) show non-random coordination relative to the rest of the measured proteome.

---

### Over-Representation Analysis (ORA) vs Functional Class Scoring (GSEA)

| Feature | Over-Representation Analysis (ORA / Fisher) | Functional Class Scoring (GSEA / Wilcoxon) |
|:---|:---|:---|
| **Input Data** | Discrete subset of significant proteins (e.g. $q \le 0.05, |\log_2\text{FC}| \ge 1.0$) | Full continuum of quantified proteins ranked by fold-change or test statistic |
| **Statistical Model** | Hypergeometric distribution / Fisher's exact test ($2 \times 2$ contingency table) | Kolmogorov-Smirnov running sum test or Wilcoxon rank-sum shift |
| **Threshold Dependence** | Highly sensitive to arbitrary significance cutoffs | Cutoff-free; evaluates entire distribution |
| **Small-Effect Sensitivity**| Misses coordinated pathways with modest but consistent fold changes | Detects subtle, coordinated multi-protein shifts |
| **Proteomics Suitability** | Excellent for focused regulatory modules and curated candidate sets | Superior for global pathway discovery and system-level dynamics |

---

### Supported Functional Enrichment Methods in `tidyproteomics`

`tidyproteomics` provides three statistical testing algorithms for functional enrichment via the `enrichment()` verb:

#### `gsea` (Gene Set Enrichment Analysis — Subramanian et al., 2005)
- **Mathematical Formulation**: All proteins in the active dataset are ordered into a ranked list $L = \{p_1, p_2, \dots, p_N\}$ based on differential abundance statistics (typically $\log_2\text{FC}$ or signed $-\log_{10} p$).
- **Running Sum Test Statistic**: An Enrichment Score ($ES$) is calculated by traversing down the ranked list $L$, increasing a running sum when a protein belongs to pathway $S$ and decreasing it when it does not:
  $$P_{\text{hit}}(S, i) = \sum_{p_j \in S, j \le i} \frac{|r_j|^p}{N_R}, \quad P_{\text{miss}}(S, i) = \sum_{p_j \notin S, j \le i} \frac{1}{N - N_H}$$
  $$ES(S) = \max_{1 \le i \le N} (P_{\text{hit}}(S, i) - P_{\text{miss}}(S, i))$$
- **Proteomics Rationale**: Eliminates arbitrary threshold cutoffs. Accurately detects subtle, coordinated shifts in multi-subunit protein complexes (such as ribosomes or oxidative phosphorylation complexes) where individual protein fold changes may fall just below $|\log_2\text{FC}| \ge 1.0$.

#### `wilcoxon` (Wilcoxon Rank-Sum Shift Test — Native TidyProteomics Engine)
- **Formulation**: Compares the distribution of log2 fold-changes or ranks of proteins belonging to pathway $S$ against all quantified background proteins not in $S$ using a two-sample Mann-Whitney $U$ test.
- **Enrichment Score Metric**: In `tidyproteomics`, the Wilcoxon enrichment score represents the signed median rank shift of pathway members relative to background:
  - **Positive (`+`) Score**: Pathway member proteins are systematically shifted toward higher $\log_2\text{FC}$ values (induced/upregulated in Treatment).
  - **Negative (`-`) Score**: Pathway member proteins are systematically shifted toward lower $\log_2\text{FC}$ values (repressed/downregulated in Treatment).
- **Proteomics Rationale**: Highly robust, non-parametric, computationally fast, and free of distributional assumptions.

#### `fisher` (Fisher's Exact Test / Hypergeometric Over-Representation)
- **Formulation**: Constructs a $2 \times 2$ contingency table partitioning quantified proteins:
  - Member of Pathway vs Not Member
  - Significantly Differentially Expressed ($q \le 0.05, |\log_2\text{FC}| \ge 1.0$) vs Not Significant
  $$p = \frac{\binom{K}{k}\binom{N - K}{n - k}}{\binom{N}{n}}$$
  where $N$ is total measured background proteins, $K$ is total pathway members in measured proteome, $n$ is total significant DE proteins, and $k$ is significant proteins in the pathway.
- **Proteomics Rationale**: Ideal when researchers want to evaluate over-representation specifically among high-stringency candidate proteins.

---

### Biological Ontologies & Knowledgebase Integration

`tidyproteomics` supports multi-category enrichment across canonical biomedical ontologies:

1. **Gene Ontology (GO)**:
   - `biological_process`: Coordinated biological objectives (e.g. *DNA replication*, *Glycolysis*, *Autophagy*).
   - `cellular_component`: Subcellular compartments and macromolecular complexes (e.g. *Mitochondrial inner membrane*, *Proteasome core complex*, *Nucleolus*).
   - `molecular_function`: Biochemical activities at the molecular level (e.g. *ATP binding*, *Protein kinase activity*, *Ubiquitin ligase*).
2. **Curated Molecular Pathways**:
   - `reactome_pathway`: Manually curated, peer-reviewed human biochemical reactions and signaling networks (Reactome Knowledgebase).
   - `wiki_pathway`: Community-curated biological pathway diagrams (WikiPathways).
   - `kegg`: Kyoto Encyclopedia of Genes and Genomes metabolic and disease pathways.

---

### The Critical Proteomics Background Space

> [!IMPORTANT]
> **Mass Spectrometry Detection Bias Mandates a Measured-Proteome Background**
> In genomics/transcriptomics, the whole genome (20,000+ protein-coding genes) is often mistakenly used as an enrichment background. **In mass spectrometry proteomics, using the whole genome as background causes massive false-positive inflation.**

- **Why Whole-Genome Backgrounds Fail in Proteomics**: Liquid chromatography-tandem mass spectrometry (LC-MS/MS) has an inherent analytical detection bias toward abundant, soluble, and easily ionizable proteins (ribosomal, cytoskeletal, metabolic, and chaperone proteins). In contrast, low-abundance transcription factors, olfactory receptors, and transmembrane channel proteins are under-detected.
- **The Solution**: In `tidyproteomics`, the background population $N$ is defined **strictly as the set of proteins empirically detected and quantified in the current experiment**. This ensures that enrichment tests reflect true experimental perturbation rather than instrument detectability bias.

---

### Directional Sign Convention for Enrichment Scores

In `tidyproteomics`, enrichment outputs carry explicit biological directionality derived from contrast orientation:
- **Positive (`+`) Enrichment Score**: Gene ontology or pathway terms enriched among accumulated proteins in the treatment cohort.
- **Negative (`-`) Enrichment Score**: Gene ontology or pathway terms enriched among depleted proteins in the treatment cohort.

---

### Handling Unannotated Proteomes & Graceful Autonomous Continuation

Non-model organism proteomes or custom FASTA databases may lack structured Gene Ontology or Reactome term tables:
1. When `tpa_inspect(what = "annotation_terms")` reveals no canonical ontology categories, the agent audits FASTA headers for `GN=` symbols and descriptions.
2. If external ontologies cannot be resolved, the pipeline records `ANNOTATION_UNAVAILABLE` as a valid empirical finding.
3. The pipeline **does not fail or halt**: it preserves dataset continuity and advances directly to Phase 6 observations and Phase 7 *de novo* module identification.

---

### Comparative Decision Matrix for Functional Enrichment

| Method | Approach | Input Requirement | Cutoff Sensitive? | Best Use Case | Proteomics Suitability |
|:---|:---|:---|:---|:---|:---|
| **`gsea`** | Functional Class Scoring | Continuous ranked list ($\log_2\text{FC}$) | No | Global pathway modulation, subtle multi-protein complexes | **Gold Standard for Global Signaling** |
| **`wilcoxon`** | Non-parametric rank shift | Continuous ranked list ($\log_2\text{FC}$) | No | Fast, robust rank-shift evaluation with directional signed scores | **TidyProteomics Standard** |
| **`fisher`** | Over-Representation (ORA) | Categorical candidate list ($q \le 0.05$) | Yes | Discrete high-confidence candidate list over-representation | Excellent for focused target sets |

---

### Supporting Scientific Publications for Functional Enrichment

1. **Subramanian, A., et al. (2005)**. *Gene set enrichment analysis: a knowledge-based approach for interpreting genome-wide expression profiles*. **Proceedings of the National Academy of Sciences (PNAS)**, 102(43), 15545–15550.
   - **Key Finding**: Seminal paper introducing Gene Set Enrichment Analysis (GSEA), proving that evaluating continuous rank shifts across entire molecular distributions overcomes the limitations of arbitrary significance cutoffs.
   - **PubMed ID**: [16199517](https://pubmed.ncbi.nlm.nih.gov/16199517/) | **DOI**: [10.1073/pnas.0506580102](https://doi.org/10.1073/pnas.0506580102)

2. **Ashburner, M., et al. (2000)**. *Gene Ontology: tool for the unification of biology*. **Nature Genetics**, 25(1), 25–29.
   - **Key Finding**: Foundational architecture of the Gene Ontology (GO) structured vocabulary spanning Biological Process, Cellular Component, and Molecular Function.
   - **PubMed ID**: [10802651](https://pubmed.ncbi.nlm.nih.gov/10802651/) | **DOI**: [10.1038/75556](https://doi.org/10.1038/75556)

3. **Fabregat, A., et al. (2018)**. *The Reactome Pathway Knowledgebase*. **Nucleic Acids Research**, 46(D1), D649–D655.
   - **Key Finding**: Comprehensive reference for the Reactome open-source curated pathway database of human biological pathways and biochemical reaction cascades.
   - **PubMed ID**: [29145629](https://pubmed.ncbi.nlm.nih.gov/29145629/) | **DOI**: [10.1093/nar/gkx1132](https://doi.org/10.1093/nar/gkx1132)

4. **Slenter, D. N., et al. (2018)**. *WikiPathways: a multifaceted pathway database bridging metabolomics to other omics research disciplines*. **Nucleic Acids Research**, 46(D1), D661–D667.
   - **Key Finding**: Specification of WikiPathways for multi-omics integration across proteomic and transcriptomic data.
   - **PubMed ID**: [29136241](https://pubmed.ncbi.nlm.nih.gov/29136241/) | **DOI**: [10.1093/nar/gkx1064](https://doi.org/10.1093/nar/gkx1064)

5. **Timmons, J. A., et al. (2015)**. *Multiple sources of bias confound functional enrichment analysis of global -omics data*. **Genome Biology**, 16, 186.
   - **Key Finding**: Highlights widespread false discovery inflation when using inappropriate background sets or failing to account for detection bias in high-throughput omics.
   - **PubMed ID**: [26365314](https://pubmed.ncbi.nlm.nih.gov/26365314/) | **DOI**: [10.1186/s13059-015-0761-7](https://doi.org/10.1186/s13059-015-0761-7)

