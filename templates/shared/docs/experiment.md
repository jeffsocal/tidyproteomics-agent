# Experiment & Dataset Specification

## 1. Input Dataset Parameters
- **PATH_TO_DATA_FILE**: [REQUIRED: Enter URL or relative path to data file]
- **PLATFORM**: [REQUIRED: Enter search platform]
- **ANALYTE**: [REQUIRED: proteins or peptides]

## 2. Experimental Hypothesis & Study Design
[REQUIRED: Describe the experimental hypothesis, biological system, treatment conditions, control groups, and key biological questions to investigate.]

## 3. Bioinformatics Design

### A. Discovered Sample Groups in Dataset
- *(Pending Phase 1 data ingestion)*
- **Confirm Discovered Sample Groups**: FALSE

### B. Quantitative Normalization Strategy
- **Normalization Methods**: default
- **Normalization Subset Filter**: NONE
- **Confirm Normalization Strategy**: FALSE

### C. Missing Value Imputation Strategy
- **Imputation Method**: randomforest_grouped
- **Confirm Imputation Strategy**: FALSE

### D. Sample Group Renaming & Pooling Map
| Raw Sample Group | Cleaned Group Name |
| :--- | :--- |

- **Reassign Sample Names According to Pooling Map**: TRUE
- **Confirm Sample Pooling Map**: FALSE

### E. Target Contrasts
- **Contrast**: *(Pending Phase 1 data ingestion)*
- **Confirm Target Contrasts**: FALSE

### F. Confounded Batch & Exploratory Comparison Gate
<!-- Exposed only if LLM determines batch confounding to be an issue in the study design -->
- **Batch Confounding Detected**: FALSE
- **Proceed With Potential Batch Confounding**: FALSE
- **Confirm Batch Confounding Authorization**: FALSE
