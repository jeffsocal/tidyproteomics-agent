import * as fs from "fs/promises";
import * as path from "path";
import { getActiveSynthesisLiterature, readLiteratureConfig } from "../literature/LiteratureService";

export interface ContextBundle {
  systemPrompt: string;
  phasePrompt: string;
  blackboardState: string;
  staticPrefixForCache: string;
  phaseContent?: string;
  loadedSkillFiles?: string[];
  phaseSkillFiles?: string[];
}

export class ContextBuilder {
  constructor(
    private workspaceRoot: string,
    private promptsDir = "agent",
    private analysisDir = "analysis"
  ) {}

  public setWorkspaceRoot(newRoot: string) {
    this.workspaceRoot = newRoot || "";
  }

  private async readFileSafe(relPath: string): Promise<string> {
    try {
      if (!this.workspaceRoot && !path.isAbsolute(relPath)) return "";
      const fullPath = path.isAbsolute(relPath) ? relPath : path.join(this.workspaceRoot, relPath);
      return await fs.readFile(fullPath, "utf-8");
    } catch {
      return "";
    }
  }

  /**
   * Resolves the list of skill names required for a phase.
   * Checks YAML frontmatter in the phase directive first, then applies intelligent phase defaults.
   */
  public getSkillsForPhase(_phaseFileName: string, _phaseContent: string): string[] {
    // Skills are superseded by dynamic MCP tool definitions
    return [];
  }

  /**
   * Builds the prompt context for a phase using persistent MCP in-memory tool calling.
   */
  public async buildPhaseContext(
    phaseFileName: string,
    _overrideMode?: string
  ): Promise<ContextBundle> {
    // 1. Persistent rules and instructions (load unified PROTOCOL.md with legacy fallback)
    let agentDir = this.promptsDir;
    let protocol = await this.readFileSafe(path.join(agentDir, "PROTOCOL.md"));
    if (!protocol && agentDir === "agent") {
      const fallback = await this.readFileSafe(path.join("prompts", "PROTOCOL.md"));
      if (fallback) {
        agentDir = "prompts";
        protocol = fallback;
      } else {
        const tplFallback = await this.readFileSafe(path.join("extension", "templates", "shared", "agent", "PROTOCOL.md"));
        if (tplFallback) {
          agentDir = path.join("extension", "templates", "shared", "agent");
          protocol = tplFallback;
        }
      }
    }

    if (!protocol) {
      const clinerules = await this.readFileSafe(".clinerules");
      const instruct = await this.readFileSafe(path.join(agentDir, "INSTRUCT.md"));
      protocol = `${clinerules}\n\n${instruct}`.trim();
    }

    // 2. Read phase directive
    let phasePath = phaseFileName;
    if (!phaseFileName.includes("/") && !phaseFileName.includes("\\")) {
      phasePath = path.join(this.analysisDir, phaseFileName);
      const contentCheck = await this.readFileSafe(phasePath);
      if (!contentCheck) {
        for (const pipelineFolder of [
          "differential_expression",
          "rapid_expression",
          "quality_control_only",
          "multi_cohort_merge",
          "biological_synthesis",
          "peptide_analysis",
        ]) {
          const tplPhase = path.join("extension", "templates", "pipelines", pipelineFolder, phaseFileName);
          const tplContent = await this.readFileSafe(tplPhase);
          if (tplContent) {
            phasePath = tplPhase;
            break;
          }
        }
      }
    }
    const phaseContent = await this.readFileSafe(phasePath);
    const experiment = await this.readFileSafe(path.join("docs", "experiment.md"));

    // 1. Invariant Persistent System Frame - strictly static across all phases 00 through 10
    // Locks PROTOCOL.md to guarantee 100% prefix prompt cache hits across the entire pipeline
    // (docs/experiment.md is decoupled into Turn 1 phasePrompt so metadata/contrast updates never bust prompt cache)
    const staticPrefixForCache = `
# AUTONOMOUS ANALYSIS PROTOCOL & QUALITY GATES
${protocol}
`.trim();

    const systemPrompt = staticPrefixForCache;

    // 2. Lean Executive Blackboard (Active Data State, Confirmed Study Design, Prior Phase Summary)
    const executiveBlackboard = await this.buildExecutiveBlackboard(phaseFileName, "mcp");
    const llm = await this.readFileSafe(path.join("docs", "llm.md"));

    const blackboardState = `
## CURRENT RUNTIME STATE (Shared Memory)
${executiveBlackboard}

### docs/llm.md (ACTIVE MODEL & AGENT SPECIFICATION - READ ONLY):
${llm || "No active model summary found."}
${this.buildLiteratureSection()}
`.trim();

    // 3. Workspace Directory Manifest (Pre-populate manifest to eliminate Turn 1 list_directory calls)
    const workspaceManifest = await this.buildWorkspaceManifest();

    const engineSection = `
### EXECUTION ENGINE: TIDYPROTEOMICS MCP (Live In-Memory Session)
- **Live Tool Calling Enabled**: The persistent tidyproteomics MCP server is CONNECTED and maintains the S3 dataset in memory. All analysis operations are executed via live \`tpa_*\` MCP tools.
- **Direct Tools Available**: You have direct access to live \`tpa_*\` MCP tools dynamically scoped for this phase.
- **Standard MCP-First Workflow**:
  1. **Phase 1 Ingestion**: Ingest the dataset directly via \`tpa_load(source = "<URL_OR_PATH>", platform = "<PLATFORM>", analyte = "proteins")\`. Remote HTTPS URLs are automatically downloaded to \`data/raw/\` and imported into memory. If custom regex or column mapping adjustments are needed (e.g. bare accession headers without pipes, or LFQ vs raw intensity), export the mapping template with \`tpa_export_config\`, modify the TSV, and pass \`config = "<platform>_<analyte>.tsv"\` to \`tpa_load\`.
  2. **Phase 2+ State Continuity**: In subsequent phases, the dataset is already held in memory from prior phases. If reloading is needed, call \`tpa_load(source = "data/tidyproteomics_data.rds")\`.
  3. **In-Memory Transformation**: Execute subsetting, normalization benchmarking, imputation, and contrast testing directly using the corresponding \`tpa_*\` MCP tools. All tool executions and outputs are automatically recorded to \`logs/<phase>/console.log\`.
  4. **Phase Checkpoint Gates & Artifact Generation**: When completing each phase, invoke \`tpa_export_state(rds_path = "data/tidyproteomics_data.rds", script_path = "code/<NN>_<phase>.R")\`. This automatically saves the data object to \`data/tidyproteomics_data.rds\` and writes the reproducible script to \`code/<NN>_<phase>.R\`, fully satisfying all checkpoint gates.
  5. **No Redundant Script Authoring**: Do NOT author manual R scripts from scratch or run redundant R scripts via 'execute_command' when live 'tpa_*' MCP tools perform the tasks in memory. 'tpa_export_state' produces the required reproducible script automatically.
  6. **Strict Tool Discipline (No Ad-Hoc Python or Shell Data Munging)**: Do NOT invoke Python, pandas, openpyxl, Rscript, or shell scripts via 'execute_command' to inspect, parse, or manipulate dataset files or raw tables. All study metadata, raw acquisition files, sample IDs, condition groups, and replicate layouts MUST be inspected through \`tpa_inspect(what = "experiments")\` and \`tpa_summary()\`.
`.trim();

    const normalizedPhaseName = path.basename(phaseFileName).replace(/\.md$/, "").toUpperCase();

    const phasePrompt = `
${workspaceManifest ? `${workspaceManifest}\n\n---\n\n` : ""}${blackboardState}

---

## EXPERIMENT SPECIFICATION & DATASET PARAMETERS (docs/experiment.md)
${experiment || "No dataset parameters provided. See docs/experiment.md."}

---

## ACTIVE PHASE DIRECTIVE (${phaseFileName})
${phaseContent}

${engineSection}

### Execution Instructions:
- Adhere strictly to the guidelines and gate checkpoints for this phase.
- Standard Workspace Manifest Pre-Indexed: Key workspace files across code/, data/, docs/, tools/, and logs/ are pre-indexed in [WORKSPACE MANIFEST] above. Do NOT waste Turn 1 calling 'list_directory' to inspect existing files; proceed immediately to phase execution tasks.
- Execute phase tasks directly using the available \`tpa_*\` MCP tools.
- MCP-First Workflow: Do NOT author manual R scripts from scratch or run redundant R scripts via 'execute_command' when live 'tpa_*' MCP tools can perform the transformations in memory. Use 'tpa_export_state' to export the persisted data object and reproducible script ('code/<phase>.R') automatically upon completing in-memory tasks.
- Strict Tool Discipline: Never run ad-hoc Python, pandas, or shell scripts via 'execute_command' to inspect data tables, read Excel sheets, or parse sample metadata. Rely strictly on \`tpa_inspect(what = "experiments")\` for sample, replicate, and file mappings, and \`tpa_summary()\` for quality distributions. 'execute_command' is strictly reserved for environment checks (Phase 0), AST linting ('tools/lint_tidyproteomics.R'), and literature CLI tools ('tools/literature/*').
- Document Editing Discipline: In docs/experiment.md, never overwrite or modify Sections 1 & 2 (user hypotheses and dataset parameters). Update Section 3 (Sample Grouping, Recoding & Contrast Designations) using 'replace_file_content' or 'write_file'. When modifying markdown documents with 'replace_file_content', ensure targetContent matches exact line numbering, bullet styles, and indentation; if making multiple non-contiguous edits to the same document, perform them sequentially across turns or use 'write_file'. Do NOT execute Python or shell scripts (e.g. pathlib, sed, awk) via 'execute_command' to modify documents.
- For scripts and documents under 150 lines, always write or overwrite the full file using 'write_file'.
- When authoring or updating any report or document (e.g. in docs/), reference 'docs/llm.md' and place the metadata header immediately beneath the title:
  Title

  Created: YYYY-MM-DD HH:MM
  Author: PROVIDER | LLM-MODEL
  Agent: TidyProteomicsAgent vX.X.X
- Standardized Note Ownership: Do not directly append phase completion headers or raw execution blocks to docs/notes.md from manual file commands. The orchestration framework automatically records a single, clean markdown summary upon complete_phase(phaseName = "${normalizedPhaseName}", summary = "...").
- Once all checkpoints for this phase are satisfied and verified, invoke complete_phase(phaseName = "${normalizedPhaseName}", summary = "...").
- Mandatory Pre-flight Human Gates: When Section 3 in docs/experiment.md contains unconfirmed gates ('Confirm ...: FALSE') for discovered sample groups, normalization, imputation, pooling, or target contrasts, scaffold concrete suggestions directly into Section 3 of docs/experiment.md with 'Confirm ...: FALSE', then immediately invoke fail_phase(phaseName = "${normalizedPhaseName}", reason = "...", actionableInsights = "...") to halt execution and request human researcher confirmation. Agents are strictly prohibited from self-confirming gates by changing 'Confirm ...: FALSE' to 'TRUE'. Note: 'Batch Confounding Detected: FALSE' is inactive and satisfied, and must not be treated as a blocker.
`.trim();

    return {
      systemPrompt,
      phasePrompt,
      blackboardState,
      staticPrefixForCache,
      phaseContent,
      loadedSkillFiles: [],
      phaseSkillFiles: [],
    };
  }

    public async buildWorkspaceManifest(): Promise<string> {
    if (!this.workspaceRoot) return "";

    const targetDirs = ["code", "data", "docs", "tools", "logs"];
    const lines: string[] = ["[WORKSPACE MANIFEST]"];

    for (const dirName of targetDirs) {
      const fullDir = path.join(this.workspaceRoot, dirName);
      try {
        const stat = await fs.stat(fullDir);
        if (stat.isDirectory()) {
          const entries = await fs.readdir(fullDir);
          const cleanFiles = entries
            .filter((f) => !f.startsWith(".") && f !== "node_modules")
            .sort();

          if (cleanFiles.length > 0) {
            let displayList: string;
            if (cleanFiles.length <= 15) {
              displayList = cleanFiles.join(", ");
            } else {
              const head = cleanFiles.slice(0, 12).join(", ");
              displayList = `${head}, ... (${cleanFiles.length} files total)`;
            }
            lines.push(`${dirName}/: ${displayList}`);
          } else {
            lines.push(`${dirName}/: (empty)`);
          }
        }
      } catch {
        // Directory doesn't exist yet
      }
    }

    if (lines.length === 1) return "";
    return lines.join("\n");
  }

  /**
   * Builds a lean, rolling Executive Blackboard for Turn 1 injection.
   * Replaces raw multi-KB docs/notes.md with a lightweight summary containing ONLY:
   * 1. Active Data State (number of proteins, active assay, imputation status)
   * 2. Confirmed Study Design (sample groups, contrast pair)
   * 3. Prior Phase Summary (ONLY the immediately preceding phase summary)
   */
  public async buildExecutiveBlackboard(currentPhaseFileName: string, activeMode: "mcp" | "markdown_skill" = "mcp"): Promise<string> {
    const notesContent = await this.readFileSafe(path.join("docs", "notes.md"));
    const experimentContent = await this.readFileSafe(path.join("docs", "experiment.md"));

    // --- 1. Active Data State ---
    let proteinCount = "Not yet loaded (pre-ingestion)";
    let activeAssay = "raw (unnormalized)";
    let imputationStatus = "Unimputed / pending Phase 3";

    if (notesContent) {
      // Find latest protein count mentioned across phase records
      const proteinMatches = [...notesContent.matchAll(/(\b\d[\d,]*)\s+(?:human\s+)?proteins\b/gi)];
      if (proteinMatches.length > 0) {
        proteinCount = proteinMatches[proteinMatches.length - 1][1] + " proteins";
      }

      // Check normalization/assay method (exclude imputation references such as impute.randomforest or randomforest_grouped)
      const notesWithoutImputeRf = notesContent
        .replace(/impute\.randomforest/gi, "")
        .replace(/randomforest_grouped/gi, "")
        .replace(/random\s*forest\s+imputation/gi, "")
        .replace(/imputation[^.\n]*random\s*forest/gi, "");

      const explicitNormMatch = notesWithoutImputeRf.match(
        /(?:select_normalization\(\s*["']?|selected\s+["'`]?|optimal\s+normalization[^.\n]*?\b|active\s+assay\s*:\s*["'`]?)(randomforest|svm|loess|limma|linear|median|scaled)\b/i
      );
      if (explicitNormMatch) {
        activeAssay = explicitNormMatch[1].toLowerCase();
      } else if (/\brandomforest\b/i.test(notesWithoutImputeRf)) {
        activeAssay = "randomforest";
      } else if (/\bsvm\b/i.test(notesWithoutImputeRf)) {
        activeAssay = "svm";
      } else if (/\bloess\b/i.test(notesWithoutImputeRf)) {
        activeAssay = "loess";
      } else if (/\blinear\b/i.test(notesWithoutImputeRf)) {
        activeAssay = "linear";
      } else if (/\bmedian\b/i.test(notesWithoutImputeRf)) {
        activeAssay = "median";
      } else if (/\blimma\b/i.test(notesWithoutImputeRf)) {
        activeAssay = "limma";
      } else if (/\bscaled\b/i.test(notesWithoutImputeRf)) {
        activeAssay = "scaled";
      }

      // Check imputation status using completed phase records so Phase 1/2 notes mentioning "un-imputed" or "23.0% missing" do not false-trigger
      const hasCompletedImputePhase = /###\s+[^\n]*03[_\s-]*IMPUTE[^\n]*-\s*COMPLETED/i.test(notesContent);
      const missingPctMatches = [...notesContent.matchAll(/(\d+(?:\.\d+)?)%\s*(?:pre-imputation\s+|post-filter\s+|overall\s+|raw\s+)?missing/gi)];
      const latestMissingPct = missingPctMatches.length > 0 ? missingPctMatches[missingPctMatches.length - 1][1] : null;
      const isZeroMissing = /(?:^|[^0-9.])0(?:\.0+)?%\s+missing|\bzero\s+missing\b/i.test(notesContent);

      if (hasCompletedImputePhase) {
        if (/randomforest|random\s*forest/i.test(notesContent)) {
          imputationStatus = "Imputed (impute.randomforest within-group matrix, post-Phase 3)";
        } else if (/column[\s/-]?min(?:imum)?|min_column/i.test(notesContent)) {
          imputationStatus = "Imputed (column-minimum LOD, 0% missing)";
        } else if (/row[\s/-]?min(?:imum)?|min_row/i.test(notesContent)) {
          imputationStatus = "Imputed (within-group row-minimum, post-Phase 3)";
        } else if (/complete[\s-]*case|bypass/i.test(notesContent) || isZeroMissing) {
          imputationStatus = "Complete cases / 0% missing (bypass)";
        } else {
          imputationStatus = "Imputed (post-Phase 3)";
        }
      } else if (/preserved\s+upstream\s+imput|pre-imputed\s+pass-through/i.test(notesContent)) {
        imputationStatus = "Preserved upstream imputation";
      } else if (isZeroMissing) {
        imputationStatus = "Complete cases / 0% missing";
      } else if (latestMissingPct !== null) {
        imputationStatus = `Unimputed (${latestMissingPct}% missing, pending Phase 3)`;
      }
    }

    // --- 2. Confirmed Study Design ---
    let contrastPair = "Pending Phase 1 confirmation";
    let sampleGroups: string[] = [];

    if (experimentContent) {
      // Contrast pair from Section 3.C
      const contrastMatch = experimentContent.match(/###\s*3\.C[^\n]*\n+([^\n\r#]+)/i);
      if (contrastMatch) {
        const raw = contrastMatch[1].replace(/[`*]/g, "").trim();
        if (raw && !raw.includes("[REQUIRED:")) {
          contrastPair = raw;
        }
      }

      // Sample groups from Section 3.B (clean pooling map) or 3.A (discovered sample groups)
      const discoveredGroups = new Set<string>();
      const match3B = experimentContent.match(/###\s*3\.B[^\n]*\n([\s\S]*?)(?=\n###|$)/i);
      if (match3B) {
        const lines3B = match3B[1].split("\n").filter((l) => l.trim().startsWith("|"));
        for (const line of lines3B) {
          const cols = line.split("|").map((c) => c.trim().replace(/[`*]/g, ""));
          if (cols.length >= 3) {
            const val = cols[2];
            if (val && !val.includes("---") && !/proposed|clean|label|current/i.test(val)) {
              discoveredGroups.add(val);
            }
          }
        }
      }

      if (discoveredGroups.size === 0) {
        const match3A = experimentContent.match(/###\s*3\.A[^\n]*\n([\s\S]*?)(?=\n###|$)/i);
        if (match3A) {
          const lines3A = match3A[1].split("\n").filter((l) => l.trim().startsWith("|"));
          for (const line of lines3A) {
            const cols = line.split("|").map((c) => c.trim().replace(/[`*]/g, ""));
            if (cols.length >= 2) {
              const val = cols[1];
              if (val && !val.includes("---") && !/discovered|sample|group/i.test(val)) {
                discoveredGroups.add(val);
              }
            }
          }
        }
      }

      if (discoveredGroups.size > 0) {
        sampleGroups = Array.from(discoveredGroups);
      }
    }
    if (sampleGroups.length === 0) {
      sampleGroups = ["Pending discovery in Phase 1"];
    }

    // --- 3. Prior Phase Summary (ONLY immediately preceding phase) ---
    let priorPhaseTitle = "Prior Phase";
    let priorPhaseStatus = "COMPLETED";
    let priorPhaseSummary = "No prior phase executed. Initializing pipeline.";

    if (notesContent) {
      const sections = notesContent.split(/\n(?=###\s+)/);
      const parsedRecords: { title: string; fileName: string; status: string; summary: string }[] = [];

      for (const sec of sections) {
        const fileMatch = sec.match(/- \*\*File\*\*:\s*`([^`]+)`/);
        if (!fileMatch) continue;
        const fileName = fileMatch[1].trim();

        const titleMatch = sec.match(/###\s+([^-\n\r]+?)\s*-\s*(COMPLETED|FAILED)/i);
        const title = titleMatch ? titleMatch[1].trim() : fileName;
        const status = titleMatch ? titleMatch[2].toUpperCase() : "COMPLETED";

        const summaryMatch = sec.match(/- \*\*Summary\*\*:\s*\n([\s\S]*?)(?:\n---|\n###|$)/);
        const summary = summaryMatch ? summaryMatch[1].trim() : "";

        if (summary) {
          parsedRecords.push({ title, fileName, status, summary });
        }
      }

      if (parsedRecords.length > 0) {
        // If current phase file is known, find the record right before it, otherwise take the last completed record
        const curBase = path.basename(currentPhaseFileName).toLowerCase();
        let targetIdx = parsedRecords.length - 1;

        for (let i = 0; i < parsedRecords.length; i++) {
          if (path.basename(parsedRecords[i].fileName).toLowerCase() === curBase) {
            targetIdx = i - 1;
            break;
          }
        }

        if (targetIdx >= 0 && targetIdx < parsedRecords.length) {
          const rec = parsedRecords[targetIdx];
          priorPhaseTitle = rec.title;
          priorPhaseStatus = rec.status;
          priorPhaseSummary = rec.summary;
        } else if (targetIdx === -1) {
          // Current phase is the very first recorded one
          priorPhaseTitle = "Prior Phase";
          priorPhaseStatus = "N/A";
          priorPhaseSummary = "No prior phase executed. Initializing pipeline.";
        } else {
          const rec = parsedRecords[parsedRecords.length - 1];
          priorPhaseTitle = rec.title;
          priorPhaseStatus = rec.status;
          priorPhaseSummary = rec.summary;
        }
      }
    }

    const engineLabel = "Live MCP Server (In-Memory Session)";

    // Extract confirmed/configured imputation method from docs/experiment.md Section 3.C
    let configuredImputationMethod = "randomforest_grouped (default)";
    let imputationConfirmedFlag = "FALSE";
    if (experimentContent) {
      const impMethodMatch = experimentContent.match(/-\s*\*\*Imputation Method\*\*:\s*([^\n\r]+)/i);
      if (impMethodMatch) {
        configuredImputationMethod = impMethodMatch[1].replace(/<!--[\s\S]*?-->/g, "").trim();
      }
      const impConfMatch = experimentContent.match(/-\s*\*\*Confirm Imputation Strategy\*\*:\s*([^\n\r]+)/i);
      if (impConfMatch) {
        imputationConfirmedFlag = impConfMatch[1].replace(/<!--[\s\S]*?-->/g, "").trim().toUpperCase();
      }
    }

    // Extract per-phase model provenance from docs/notes.md
    const phaseModelMap: string[] = [];
    if (notesContent) {
      const entryRegex = /###\s*\[[^\]]+\]\s*([0-9]{2}_[A-Za-z0-9_]+)\s*—[\s\S]*?(?=\n###\s*\[|$)/g;
      const latestMap = new Map<string, string>();
      let m: RegExpExecArray | null;
      while ((m = entryRegex.exec(notesContent)) !== null) {
        const pid = m[1].toUpperCase();
        const modMatch = m[0].match(/-\s*\*\*Model\*\*:\s*([^\n\r]+)/i);
        if (modMatch) {
          latestMap.set(pid, modMatch[1].trim().replace(/`/g, ""));
        }
      }
      for (const [pid, modStr] of latestMap.entries()) {
        phaseModelMap.push(`${pid}: ${modStr}`);
      }
    }

    // Check if data/tidyproteomics_data.rds already exists for Phase 1 fast-path resume
    let rdsResumeNotice = "";
    if (this.workspaceRoot && /01_inspect/i.test(currentPhaseFileName)) {
      const rdsFullPath = path.join(this.workspaceRoot, "data", "tidyproteomics_data.rds");
      try {
        const st = await fs.stat(rdsFullPath);
        if (st.size > 0) {
          rdsResumeNotice = `\n- **Phase 1 Resume State**: \`data/tidyproteomics_data.rds\` already exists on disk (${Math.round(st.size / 1024)} KB). Unless \`PATH_TO_DATA_FILE\` or \`PLATFORM\` changed in \`docs/experiment.md\`, resume directly via \`tpa_load(source = "data/tidyproteomics_data.rds")\` without repeating \`tpa_input_audit\` or raw file import.`;
        }
      } catch {
        // RDS does not exist yet
      }
    }

    return `
### EXECUTIVE BLACKBOARD (Active Memory):
- **Active Execution Engine**: ${engineLabel}
- **Active Data State**:
  - Quantified Proteins: ${proteinCount}
  - Active Assay / Normalization: ${activeAssay}
  - Imputation Status: ${imputationStatus}
  - Configured Section 3.C Imputation Method: \`${configuredImputationMethod}\` (Confirmed: \`${imputationConfirmedFlag}\`)${rdsResumeNotice}
- **Confirmed Study Design**:
  - Active Sample Groups: ${sampleGroups.join(", ")}
  - Confirmed Contrast Pair: ${contrastPair}${phaseModelMap.length > 0 ? `\n- **Executed Per-Phase Model Map (Provenance)**: ${phaseModelMap.join("; ")}` : ""}
- **Prior Phase Summary (${priorPhaseTitle} - ${priorPhaseStatus})**:
${priorPhaseSummary.split("\n").map(line => `  ${line}`).join("\n")}
`.trim();
  }

  /**
   * Describes the active DuckDB literature database (toggled from the Literature tab).
   * Placed in the dynamic blackboard (not the cached prefix) because it can change between phases.
   */
  private buildLiteratureSection(): string {
    if (!this.workspaceRoot) return "";
    const cfg = readLiteratureConfig(this.workspaceRoot);
    const activeName = cfg.activeLiterature || cfg.activeCorpus;
    if (!activeName && !cfg.useInSynthesis) return "";

    const active = getActiveSynthesisLiterature(this.workspaceRoot);
    if (!active) {
      return `
### ACTIVE LITERATURE DATABASE (DuckDB):
- Status: DISABLED for synthesis (toggle off or no database selected in the Literature tab).
- Use the standard literature corroboration strategy described in the phase directive.
`;
    }

    return `
### ACTIVE LITERATURE DATABASE (DuckDB - READ ONLY):
- Status: ENABLED for literature corroboration and synthesis.
- Database file: \`${active.relPath}\`
- Schema: studies(study_id, title, year, core_thesis) -> experimental_contexts(context_id, organism, model_name, perturbation_type, perturbation_target, assay_modality) -> molecular_assertions(raw_entity_name, canonical_human_symbol, relationship_type, functional_module, quantitative_note, evidence_quote). Denormalized view: v_assertions_full.
- Inspect: \`Rscript tools/literature/literature_cli.R stats ${active.relPath}\`
- Lookup: \`Rscript tools/literature/literature_cli.R search ${active.relPath} <SYMBOL_OR_MODULE> [limit]\`
- Query Skill: \`Rscript tools/literature/query_literature.R ${active.relPath} "<seed_symbols>" "<pathway_terms>"\`
- Policy: Prefer literature database evidence (cite study_id + verbatim evidence_quote) over generic web search. Open the database read-only; never modify it during analysis phases.
`;
  }
}
