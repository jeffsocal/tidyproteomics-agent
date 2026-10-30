---
tools: [web_search, pubmed_search, uniprot_search]
---

### Phase 8: Web Search Corroboration, Second-Layer Conclusions & Actionable Synthesis

In this phase, you (the LLM) will use the keyphrases curated in `07_KNOWLEDGE` (`docs/knowledge.md`) to conduct targeted web searches and external literature exploration. You will then synthesize:
- `07_KNOWLEDGE` (`docs/knowledge.md` and `data/de_novo_modules.tsv` if generated, which already summarize the primary observations from `docs/observations.md`)
- The findings from the current web search

to further contextualize the observations, develop the **second layer of conclusions**, and emit a structured **Actionable Synthesis Contract (`data/actionable_synthesis.json`)** that translates the empirical findings and study context (`docs/experiment.md`) into:
1. **Validated Biological Signatures** (opposing induced vs. repressed functional programs grounded in formal pathways or Phase 7 *de novo* modules).
2. **Role-Classified Candidate Targets** (`Predictive Biomarker`, `Druggable Target`, `Mechanistic Dependency`, `Compensatory Buffer`).
3. **An Actionable Translational Archetype & "What To Do Next" Experimental Roadmap**.

If web search findings reveal new candidate interactors, orthologs, operon partners, pathway regulators, or disease biomarkers that suggest follow-up questions:
- Write and execute `code/08_websearch.R` via `execute_command("Rscript code/08_websearch.R")` to query the saved dataset (`data/table_*_expression_*.tsv` / `data/tidyproteomics_data.rds`) directly (logged to `logs/08_websearch/console.log`).
- Document any **new** data-derived observations in `docs/websearch.md`.

You will also develop a targeted **Literature Search Strategy** (defining candidate seed gene symbols, functional modules, and context filters) to prepare for the DuckDB Literature Knowledge Database interrogation in Phase 09.

Finally, you will construct `docs/websearch.md` and write `data/actionable_synthesis.json` documenting the corroborated biological signatures, role-tagged candidates, and concrete next experimental steps.

---

#### 1. Pre-Flight Verification & Inputs Ingestion
Before proceeding:
1. Read `docs/knowledge.md` in Turn 1 (which contains the Phase 6 primary observations synthesis, Phase 7 de novo module statistics, actionable candidate roles, and curated web-search keyphrases). Only read `docs/observations.md` if you need to look up a specific metric not already summarized in `docs/knowledge.md`.
2. Rely on the `[WORKSPACE MANIFEST]` and `docs/experiment.md` already injected in your prompt above.

---

#### 2. Executing Web Searches
Extract the prioritized keyphrases from `docs/knowledge.md` and execute targeted web inquiries:
- Prefer using the built-in search tools (`pubmed_search`, `uniprot_search`, and `web_search`) directly for fast, rate-limited queries across Europe PMC / PubMed, UniProtKB, and the web.
- If web search is performed via command-line utilities (e.g. `curl` queries to PubMed/UniProt APIs or inline scripting), execute commands via `execute_command` and capture relevant text summaries. If executing Python snippets, explicitly invoke `python3` (as `/usr/bin/python` is unavailable on macOS and modern systems). **Rate Limit / API Discipline**: When invoking NCBI E-utilities (esearch/esummary), unauthenticated API calls are strictly capped at 3 requests per second. Always insert `time.sleep(0.4)` between HTTP requests in scripts to prevent HTTP 429 (Too Many Requests) errors.
- In offline or sandboxed environments without direct internet access, synthesize published literature and database knowledge corresponding to the curated keyphrases, ensuring strict attribution without hallucination.
- Search priorities:
  1. Primary perturbation target in the specific cell line / organism: reported proteomic alterations, direct interactors, and downstream markers.
  2. Functional validation, druggability, and biomarker utility of top upregulated and downregulated proteins in relation to the phenotype.
  3. Mechanistic cross-talk among top enriched pathways or Phase 7 *de novo* functional modules.

---

#### 3. Interactive Data Queries via `tidyproteomics query tools (tpa_extract, tpa_run_code, or Rscript)` (Testing New Web-Derived Hypotheses)
If external web findings suggest candidate interactors, co-complex members, or downstream pathway markers that were not initially examined in Phase 6 or Phase 7:
- Write and execute `code/08_websearch.R` (output is automatically captured to `logs/08_websearch/console.log`):
  ```bash
  if [ -f tools/lint_tidyproteomics.R ]; then Rscript tools/lint_tidyproteomics.R code/08_websearch.R && Rscript code/08_websearch.R; else Rscript code/08_websearch.R; fi
  ```
- Use canonical `tidyproteomics` functions per `tidyproteomics query tools (tpa_extract, tpa_run_code, or Rscript)`:
  ```r
  library(tidyproteomics)
  library(dplyr)

  tp_data <- readRDS("data/tidyproteomics_data.rds")
  analyses <- get_analyses(tp_data)
  contrast_str <- if (nrow(analyses) > 0) analyses$comparison[1] else "<treatment>/<control>"
  c_clean <- gsub("[^A-Za-z0-9]", ".*", contrast_str)
  # Prefer loading the curated Phase 6 expression table matched to contrast_str (with FASTA regex-mapped gene symbols):
  exp_files <- list.files("data", pattern = "^table_.*_expression_.*[.](tsv|csv)$", full.names = TRUE)
  exp_files <- exp_files[!grepl("_extract", exp_files)]
  matched_files <- exp_files[grepl(c_clean, basename(exp_files), ignore.case = TRUE)]
  cand_files <- c(matched_files, setdiff(exp_files, matched_files))
  exp_tbl <- if (length(cand_files) > 0) {
    if (grepl("[.]tsv$", cand_files[1])) readr::read_tsv(cand_files[1], show_col_types = FALSE) else readr::read_csv(cand_files[1], show_col_types = FALSE)
  } else {
    rlang::inject(export_analysis(tp_data, !!rlang::parse_expr(contrast_str), .analysis = "expression"))
  }

  # Query newly identified candidates from web search (checking symbol, accession/peptide, and description for unmapped isoforms like CIP2A):
  web_candidates <- c("CAND_A", "CAND_B", "CAND_C")
  matches <- exp_tbl %>% filter(if_any(any_of(c("gene_name", "gene_symbol", "symbol", "protein", "peptide")), ~ .x %in% web_candidates) |
                                grepl(paste(web_candidates, collapse = "|"), description, ignore.case = TRUE))
  print(matches %>% select(any_of(c("gene_name", "protein", "peptide", "log2_foldchange", "p_value", "adj_p_value", "description"))))
  ```
- Inspect output via CLI (`head -n 30 logs/08_websearch/console.log`).
- Any newly tested targets and their quantitative metrics must be documented as **new observations** in `docs/websearch.md`.

---

#### 4. Developing Second-Layer Biological Conclusions (Evidentiary Tiering)
Synthesize findings across the primary data (`docs/observations.md`), internal domain knowledge (`docs/knowledge.md`), and web search evidence:

1. **Strict Evidentiary Distance Tiering**:
   When evaluating external studies and literature findings, explicitly classify each reference by its biological and assay proximity to the current experiment:
   - **Tier 1 (Direct Match):** Same species, same tissue/cell type, same condition (e.g., human lung granuloma tissue proteomics or spatial transcriptomics). Represents direct molecular validation.
   - **Tier 2 (Surrogate Matrix / Proximal Model):** Human peripheral biofluids (plasma, serum) or in vitro human primary cell models. Must be explicitly labeled as **surrogate context**, not tissue validation.
   - **Tier 3 (Distal Context):** Animal models (e.g., mouse, rabbit) or transformed cell line screens.
2. **Handling Non-Replicated Literature Candidates**:
   - Candidates nominated by external literature or surrogate panels that show no statistically significant change in the empirical dataset ($p > 0.05$ or $|\log_2\text{FC}| < 0.5$) must be classified as **"Non-Replicated / Concordance: NONE"**.
   - **Prohibition on Speculative Hijacking**: Do NOT construct extensive narrative hypotheses or speculation around non-replicated external genes. State the lack of replication concisely (1–2 sentences) as empirical divergence between the primary tissue pathology and surrogate matrices (e.g., tissue lesions vs. circulating plasma).
3. **Corroboration of Primary Remodeling**:
   - Do external studies support the directionality and magnitude of the primary empirical changes?
   - Focus corroboration on the dataset's actual drivers (Top Upregulated, Top Downregulated, enriched pathways, and Phase 7 *de novo* functional modules).
4. **Identification of Novel vs. Canonical Responses**:
   - Differentiate canonical markers (commonly observed across similar perturbation studies) from potential study-specific or novel tissue discoveries.
5. **Cross-Study & Model Comparison**:
   - How do the findings compare with published datasets across Tier 1, 2, and 3 contexts?

---

#### 5. Emitting the Actionable Synthesis Contract (`data/actionable_synthesis.json`)
To ensure downstream figures (`10_FIGURES.md`) and manuscript synthesis (`11_SYNTHESIS.md`) are driven by biologically coherent programs and well-supported candidate roles (rather than arbitrary top-fold-change slicing), write `data/actionable_synthesis.json` via `write_file`:

```json
{
  "primary_archetype": "Mechanistic Model of Cellular Response & Adaptive Remodeling",
  "archetype_rationale": "Concise 1-2 sentence synthesis connecting the study context in docs/experiment.md with the primary proteomic remodeling.",
  "signatures": {
    "Induced: <Specific Functional Program Name>": ["GENE1", "GENE2", "GENE3", "GENE4", "GENE5"],
    "Repressed: <Specific Functional Program Name>": ["GENE6", "GENE7", "GENE8", "GENE9", "GENE10"]
  },
  "signature_rationale": "Explicit statistical and biological justification for pairing these two functional programs (citing Phase 5 enrichment q-values or Phase 7 de novo module Wilcoxon p-values and median log2FC shifts).",
  "candidates": [
    {
      "gene": "GENE1",
      "role": "Predictive Biomarker",
      "rationale": "Specific quantitative and biological reason for inclusion (e.g. ROBUST_QUANTITATIVE shift, extracellular/diagnostic accessibility, or canonical pathway readout)."
    },
    {
      "gene": "GENE2",
      "role": "Druggable Target",
      "rationale": "Specific enzymatic, transporter, or survival bottleneck whose inhibition or modulation tests the phenotype."
    },
    {
      "gene": "GENE3",
      "role": "Mechanistic Dependency",
      "rationale": "Direct complex subunit, operon partner, or physical interactor of the primary perturbation."
    },
    {
      "gene": "GENE4",
      "role": "Compensatory Buffer",
      "rationale": "Adaptive stress-response factor or metabolic bypass induced to buffer perturbation stress."
    }
  ],
  "next_steps": [
    {
      "category": "Orthogonal Validation",
      "action": "Specific targeted assay (e.g. PRM/SRM peptide panel or immunoblot) on top ROBUST_QUANTITATIVE biomarkers and verification of DETECTION_LIMITED_ON_OFF candidates.",
      "hypothesis_tested": "Confirms quantitative effect sizes independent of discovery-mode normalization and LOD imputation."
    },
    {
      "category": "Mechanistic / Functional Perturbation",
      "action": "Specific genetic (CRISPRi/KO/overexpression), chemical (small-molecule inhibitor/agonist), or metabolic supplementation experiment targeting the lead Druggable Target or Mechanistic Dependency.",
      "hypothesis_tested": "Distinguishes causal phenotypic drivers and synthetic vulnerabilities from passive downstream bystanders."
    },
    {
      "category": "Translational / Model Expansion",
      "action": "Specific time-course, dose-response, or independent cohort stratification study.",
      "hypothesis_tested": "Establishes kinetic ordering of primary vs. compensatory remodeling and validates predictive biomarker generalizability."
    }
  ]
}
```
> ⚠️ **Rules for `data/actionable_synthesis.json`**:
> - Every gene symbol in `signatures` and `candidates` **must** match an actual `gene_name` (or `protein` accession) present in the Phase 6 expression table (`data/table_*_expression_*.tsv`).
> - Include 4–8 genes per signature in `signatures` and 6–8 total prioritized candidates in `candidates`.
> - Never use generic placeholder labels like `"Top Upregulated Candidates"` or `"Upregulated Program"`—always name the specific biological process, complex, or operon (e.g., `"Induced: Surfactin Synthetase & Quorum Sensing"`, `"Repressed: Ribosomal Biogenesis"`).

---

#### 6. Developing a Literature Search Strategy for Phase 09
Formulate a concrete search strategy to interrogate the DuckDB Literature Knowledge Database in Phase 09:
- **Seed Gene Symbols** (`seed_symbols`): Comma-separated list of 3–8 primary altered genes and verified candidate interactors (e.g. `"VCP,FAF2,DERL1,UFD1"`), anchored in top empirical hits.
- **Pathway Terms** (`pathway_terms`): Comma-separated functional terms and molecular complexes (e.g. `"ERAD,proteasome,unfolded protein response"`).
- **Interrogation Targets**: Specific candidate complexes or functional modules hypothesized to show sub-threshold coordinated regulation.

---

#### 7. Direct Construction of `docs/websearch.md`
Write `docs/websearch.md` directly, referencing `docs/llm.md` for active model details. Ensure it begins with the standard document header immediately below the title:

```markdown
# Web Search Corroboration & Second-Layer Conclusions

Created: YYYY-MM-DD HH:MM  
Author: PROVIDER | LLM-MODEL  
Agent: TidyProteomicsAgent vX.X.X  
R Package: tidyproteomics vX.X.X  
```

Organize the document strictly into the following structured sections:

1. **Executed Search Strategy & Queries**:
   - Summary of keyphrases searched, information sources consulted, and search objectives.
2. **Follow-Up Data Inquiries & New Observations**:
   - If follow-up data queries were executed via `code/08_websearch.R`, document hypotheses tested, candidate proteins queried, and **new data-derived observations** (with exact $\log_2\text{FC}$ and $p$-values). If no additional queries were required, state that the current dataset was verified.
3. **Second-Layer Biological Conclusions (with Evidentiary Tiering)**:
   - Synthesized biological interpretation combining primary observations, internal knowledge, and external web findings.
   - Explicit classification of cited studies into **Tier 1 (Direct Match)**, **Tier 2 (Surrogate Context)**, or **Tier 3 (Distal Context)**.
   - **Accounting for Non-Replicated Literature Candidates**: Summary table or concise audit documenting external candidates that failed to replicate ($p > 0.05$ or $|\log_2\text{FC}| < 0.5$) labeled as **"Non-Replicated / Concordance: NONE"**, without speculative narrative expansion.
4. **Actionable Direction: Validated Signatures, Target Roles & Next Experimental Steps**:
   - Explicit justification of the **Primary Actionable Archetype**, the paired **Biological Signatures**, and the **Role-Classified Candidates** (`Predictive Biomarker`, `Druggable Target`, `Mechanistic Dependency`, `Compensatory Buffer`) persisted to `data/actionable_synthesis.json`.
   - Concrete 3-pillar **"What To Do Next" Experimental Roadmap** (Orthogonal Validation, Functional Perturbation, and Model/Translational Expansion).
5. **Literature Search Strategy for Phase 09**:
   - Defined seed symbols (`seed_symbols`), pathway terms (`pathway_terms`), and prioritized candidate complexes for querying the DuckDB Literature Knowledge Database.
6. **Documented References**:
   - Complete bibliography of all external sources referenced: Title, Authors/Venue, Year, Evidentiary Tier (Tier 1/2/3), and valid URL or DOI/PMID. Never fabricate identifiers.

---

#### 8. Phase Completion Gate
- [ ] **Checkpoint Gate**:
  1. `docs/knowledge.md` and `docs/observations.md` successfully ingested.
  2. If follow-up data queries were executed, `code/08_websearch.R` exited with code 0 and output was logged to `logs/08_websearch/console.log` (or `logs/08_websearch.log`).
  3. `data/actionable_synthesis.json` exists on disk with non-zero size and valid JSON structure containing `primary_archetype`, `signatures`, `candidates`, and `next_steps`.
  4. `docs/websearch.md` exists on disk with non-zero size, containing second-layer conclusions, actionable synthesis & next steps, a literature search strategy for Phase 09, and documented references.
- [ ] **Complete Phase**:
  - Invoke `complete_phase(phaseName = "08_WEBSEARCH", summary = "Web search corroboration complete in docs/websearch.md and actionable synthesis persisted to data/actionable_synthesis.json with validated signatures, role-tagged candidates, and next experimental steps.")`
