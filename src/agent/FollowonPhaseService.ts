import * as fs from "fs/promises";
import * as fsSync from "fs";
import * as path from "path";
import { ProviderClient } from "../llm/ProviderClient";
import { TokenUsage, LLMRole } from "../types";

export type ManuscriptOption = "none" | "append" | "rewrite";

export interface ManuscriptRevisionInfo {
  hasBaseManuscript: boolean;
  existingRevs: number[];
  latestRev: number | null;
  nextRev: number;
  nextRevId: string;
  sourceFile: string;
  targetFile: string;
}

export interface FollowonDraftRequest {
  description: string;
  existingMarkdown?: string;
  feedback?: string;
  suggestedFileName?: string;
  manuscriptOption?: ManuscriptOption;
  workspaceRoot: string;
}

export interface FollowonDraftResult {
  fileName: string;
  title: string;
  content: string;
  nextIndex: number;
  manuscriptOption: ManuscriptOption;
  targetManuscriptRev?: string;
  tokenUsage?: TokenUsage;
  model?: string;
  role?: LLMRole;
}

export class FollowonPhaseService {
  constructor(private client: ProviderClient) {}

  /**
   * Scans analysis/ to discover existing phase numbers and determine N+1.
   */
  public async getNextPhaseInfo(workspaceRoot: string): Promise<{ nextIndex: number; nextId: string; existingPhases: string[] }> {
    const analysisDir = path.join(workspaceRoot, "analysis");
    let maxIdx = 0;
    const existingPhases: string[] = [];

    if (fsSync.existsSync(analysisDir)) {
      try {
        const files = await fs.readdir(analysisDir);
        for (const file of files) {
          if (!file.endsWith(".md")) continue;
          existingPhases.push(file);
          const match = file.match(/^(\d+)/);
          if (match) {
            const idx = parseInt(match[1], 10);
            if (idx > maxIdx) maxIdx = idx;
          }
        }
      } catch (err) {
        console.error("[FollowonPhaseService] Error reading analysis directory:", err);
      }
    }

    const nextIndex = maxIdx > 0 ? maxIdx + 1 : 14;
    const nextId = String(nextIndex).padStart(2, "0");
    return { nextIndex, nextId, existingPhases };
  }

  /**
   * Scans docs/ to determine existing manuscript revisions.
   * If manuscript.md exists and manuscript_rev_00.md does not, nextRev is 1 (with manuscript.md becoming rev_00).
   * If manuscript_rev_[N].md exists, nextRev is max(N) + 1.
   */
  public async getManuscriptRevisionInfo(workspaceRoot: string): Promise<ManuscriptRevisionInfo> {
    const docsDir = path.join(workspaceRoot, "docs");
    let hasBaseManuscript = false;
    const existingRevs: number[] = [];

    if (fsSync.existsSync(docsDir)) {
      try {
        const files = await fs.readdir(docsDir);
        for (const file of files) {
          if (file.toLowerCase() === "manuscript.md") {
            hasBaseManuscript = true;
          }
          const m = file.match(/^manuscript_rev_(\d+)\.md$/i);
          if (m) {
            existingRevs.push(parseInt(m[1], 10));
          }
        }
      } catch (err) {
        console.error("[FollowonPhaseService] Error scanning docs for manuscripts:", err);
      }
    }

    existingRevs.sort((a, b) => a - b);
    const latestRev = existingRevs.length > 0 ? existingRevs[existingRevs.length - 1] : null;

    let nextRev = 1;
    let sourceFile = "docs/manuscript.md";

    if (existingRevs.length === 0) {
      nextRev = 1;
      sourceFile = "docs/manuscript_rev_00.md";
    } else {
      nextRev = (latestRev ?? 0) + 1;
      sourceFile = `docs/manuscript_rev_${String(latestRev).padStart(2, "0")}.md`;
    }

    const nextRevId = String(nextRev).padStart(2, "0");
    const targetFile = `docs/manuscript_rev_${nextRevId}.md`;

    return {
      hasBaseManuscript,
      existingRevs,
      latestRev,
      nextRev,
      nextRevId,
      sourceFile,
      targetFile,
    };
  }

  /**
   * Prepares manuscript revision files on disk:
   * 1. If manuscript_rev_00.md does not exist, copies/moves docs/manuscript.md to docs/manuscript_rev_00.md.
   * 2. Copies the latest revision to docs/manuscript_rev_[N+1].md.
   */
  public async prepareManuscriptRevision(
    workspaceRoot: string,
    mode: ManuscriptOption = "none"
  ): Promise<{ nextRevId: string; sourceFile: string; targetFile: string } | null> {
    if (mode === "none") return null;

    const docsDir = path.join(workspaceRoot, "docs");
    if (!fsSync.existsSync(docsDir)) {
      await fs.mkdir(docsDir, { recursive: true });
    }

    const baseManuscriptPath = path.join(docsDir, "manuscript.md");
    const rev00Path = path.join(docsDir, "manuscript_rev_00.md");

    // If rev_00 does not exist, copy base manuscript.md to manuscript_rev_00.md
    if (!fsSync.existsSync(rev00Path) && fsSync.existsSync(baseManuscriptPath)) {
      await fs.copyFile(baseManuscriptPath, rev00Path);
    }

    const revInfo = await this.getManuscriptRevisionInfo(workspaceRoot);
    const targetPath = path.join(docsDir, `manuscript_rev_${revInfo.nextRevId}.md`);

    // Determine source path on disk
    let srcPath = path.join(workspaceRoot, revInfo.sourceFile);
    if (!fsSync.existsSync(srcPath)) {
      if (fsSync.existsSync(rev00Path)) {
        srcPath = rev00Path;
      } else if (fsSync.existsSync(baseManuscriptPath)) {
        srcPath = baseManuscriptPath;
      }
    }

    if (fsSync.existsSync(srcPath) && !fsSync.existsSync(targetPath)) {
      await fs.copyFile(srcPath, targetPath);
    }

    return {
      nextRevId: revInfo.nextRevId,
      sourceFile: path.relative(workspaceRoot, srcPath).replace(/\\/g, "/"),
      targetFile: `docs/manuscript_rev_${revInfo.nextRevId}.md`,
    };
  }

  /**
   * Generates or revises a follow-on phase markdown specification using Tier 3 (Reasoner).
   */
  public async generateDraft(req: FollowonDraftRequest): Promise<FollowonDraftResult> {
    const { nextIndex, nextId, existingPhases } = await this.getNextPhaseInfo(req.workspaceRoot);
    const manuscriptInfo = await this.getManuscriptRevisionInfo(req.workspaceRoot);
    const mode: ManuscriptOption = req.manuscriptOption || "append";

    // Read experiment context if available
    let experimentSummary = "";
    try {
      const expPath = path.join(req.workspaceRoot, "docs", "experiment.md");
      if (fsSync.existsSync(expPath)) {
        const raw = await fs.readFile(expPath, "utf-8");
        const lines = raw.split("\n").filter((l) => !l.startsWith("<!--") && !l.startsWith("👉"));
        experimentSummary = lines.slice(0, 40).join("\n").trim();
      }
    } catch {}

    const reasonerClient = this.client.forRole("reasoner");
    const isRevision = Boolean(req.existingMarkdown && req.feedback);

    const systemPrompt = `You are a Principal Computational Biologist and Bioinformatics Pipeline Architect specializing in quantitative proteomics and the R 'tidyproteomics' ecosystem.

Your task is to create or revise a new follow-on analysis phase specification for an autonomous analytical pipeline.
The file must be named strictly in the pattern: \`${nextId}_SINGLEWORD.md\` (e.g. \`${nextId}_KINASES.md\`, \`${nextId}_PATHWAYS.md\`, \`${nextId}_DEEPDIVE.md\`, \`${nextId}_HEATMAP.md\`).
The SINGLEWORD component must be exactly ONE uppercase word summarizing the biological or analytical focus.

Available MCP & File System Tools for this phase:
- tpa_health: Health check & active quantitative layer audit
- tpa_load(source = "data/tidyproteomics_data.rds"): Ingest in-memory data
- tpa_inspect(what = "overview" | "summary" | "samples" | "quants" | "analyses" | "operations"): Inspect dataset structure
- tpa_summary: Summary statistics of proteins/peptides
- tpa_reassign: Sample grouping, renaming, and pooling
- tpa_normalize: Normalization benchmarking
- tpa_impute: Missing value imputation
- tpa_expression: Empirical Bayes differential expression
- tpa_enrichment: Functional enrichment analysis (GO BP/MF/CC, Reactome, WikiPathways)
- tpa_enrichment: Run pathway/GO enrichment analysis
- tpa_batch_analysis(type = "expressions" | "enrichments"): Automated batch differential expression or multi-ontology enrichment analysis
- tpa_query_expression(comparison, min_log2fc, max_adjp, direction = "up"|"down"|"both", sort_by, limit, save_csv): Query and screen differential candidate proteins directly from empirical Bayes / limma results without row truncation or bash pipe clipping
- tpa_query_enrichment(comparison, terms, max_adjp, direction, sort_by, limit, resolve_reactome, save_csv): Query and screen enriched pathways across annotation categories with resolved Reactome names
- tpa_extract(values = "loess" | "raw", na_rm, save_csv): Extract sample-level quantitative abundance matrix (not statistical tests)
- tpa_plot: Generate volcano, PCA, heatmap, variation, counts, proteins_enrichment plots (Note: plot_heatmap renders across all samples/proteins and does not take comparison contrasts)
- tpa_export_table: Export analysis tables to TSV/CSV
- tpa_operations: Inspect operations history
- tpa_export_state: Persist dataset state to data/tidyproteomics_data.rds & reproducible R script
- read_file: Read workspace files or data tables
- write_file: Write or overwrite reports in docs/
- edit_file: Modify specific sections in existing markdown files
- execute_command: Run helper shell or R commands if necessary
- complete_phase: Finalize phase execution with summary and metrics
- fail_phase: Halt execution with actionable blocker reason

STANDARD PHASE STRUCTURE REQUIREMENT:
1. YAML frontmatter:
---
tools: [tpa_health, tpa_load, tpa_inspect, tpa_expression, tpa_enrichment, tpa_batch_analysis, tpa_query_expression, tpa_query_enrichment, tpa_plot, tpa_export_table, tpa_export_state, read_file, write_file, edit_file, execute_command, complete_phase, fail_phase]
---

2. Phase Header:
### Phase ${nextIndex}: <Clear Descriptive Title>

3. Mandatory Documentation & Synthesis Requirements:
- Dedicated Report Requirement: At a minimum, every follow-on phase MUST author a dedicated scientific markdown document in 'docs/' (named strictly 'docs/report_<singleword_lower>.md', e.g. 'docs/report_kinase.md') capturing candidate screening metrics, biological mechanisms, hypotheses, and figure/table citations.
${
  mode === "append"
    ? `- MANUSCRIPT INTEGRATION (APPEND):
  - Prior manuscript version has been archived/preserved in '${manuscriptInfo.sourceFile}'.
  - The agent MUST edit '${manuscriptInfo.targetFile}' by appending a dedicated follow-on subsection to Results & Discussion detailing these new discoveries and mechanistic conclusions.
  - The agent MUST also update/copy to 'docs/manuscript.md' with the revised manuscript so the main document viewer remains current.`
    : mode === "rewrite"
    ? `- MANUSCRIPT INTEGRATION (REWRITE):
  - Prior manuscript version has been archived/preserved in '${manuscriptInfo.sourceFile}'.
  - The agent MUST comprehensively rewrite and synthesize '${manuscriptInfo.targetFile}', incorporating these follow-on findings into the Abstract, Results, Discussion, and Conclusions.
  - The agent MUST also update/copy to 'docs/manuscript.md' with the revised manuscript so the main document viewer remains current.`
    : `- MANUSCRIPT INTEGRATION: Manuscript modification is not requested. Keep all discoveries documented in 'docs/report_<singleword_lower>.md' without editing manuscript files.`
}
- Pre-Flight Gate Requirement: Before invoking complete_phase, the agent MUST confirm that 'docs/report_<singleword_lower>.md' exists on disk with non-zero size${mode !== "none" ? ` and '${manuscriptInfo.targetFile}' has been written` : ""}.

4. Step-by-step numbered sub-checkpoints:
- Phase ${nextIndex}.1: Data verification & in-memory state continuity (loading 'data/tidyproteomics_data.rds' and tpa_inspect)
- Phase ${nextIndex}.2: Targeted analytical computation, candidate screening via tpa_query_expression, or specialized modeling
- Phase ${nextIndex}.3: Publication figure generation & tabular data export (saving to data/plot_*.png and data/table_*.tsv)
- Phase ${nextIndex}.4: Scientific documentation & manuscript revision:
  - Author dedicated report 'docs/report_<singleword_lower>.md' using write_file.
  ${mode === "append" ? `  - Edit '${manuscriptInfo.targetFile}' by appending a dedicated follow-on results and discussion section, and update 'docs/manuscript.md'` : mode === "rewrite" ? `  - Rewrite '${manuscriptInfo.targetFile}' with holistic integration across abstract, results, and discussion, and update 'docs/manuscript.md'` : "  - No manuscript edits requested"}
- Phase ${nextIndex}.5: State persistence and automated completion via complete_phase(phaseName = "${nextId}_SINGLEWORD", summary = "...")

OUTPUT FORMAT:
You must respond with valid JSON containing exactly three fields:
{
  "fileName": "${nextId}_SINGLEWORD.md",
  "title": "Phase ${nextIndex}: Full Title Here",
  "content": "--- ... (full markdown content of the phase) ..."
}
Do NOT include markdown backticks around the JSON. Return raw valid JSON only.`;

    let userPrompt = "";
    if (isRevision) {
      userPrompt = `REVISION REQUEST FOR EXISTING PHASE SPECIFICATION:

User Feedback / Required Edits:
${req.feedback}

Current Draft File: ${req.suggestedFileName || `${nextId}_FOLLOWON.md`}
Current Draft Markdown:
\`\`\`markdown
${req.existingMarkdown}
\`\`\`

Experiment Context:
${experimentSummary}

Please revise the phase markdown to incorporate all user feedback while maintaining the strict tool frontmatter, numbered checkpoints, and complete_phase signature.
Return the updated JSON.`;
    } else {
      userPrompt = `NEW FOLLOW-ON PHASE REQUEST:

Next Phase Number: ${nextIndex} (ID: "${nextId}")
Existing Phases in Pipeline: ${existingPhases.join(", ")}

Researcher's Objective & Description:
${req.description}

Experiment Context:
${experimentSummary}

Generate the complete, publication-grade Phase ${nextIndex} specification following the naming rule '${nextId}_SINGLEWORD.md' and the standardized structure. Return raw JSON.`;
    }

    const response = await reasonerClient.chat({
      system: systemPrompt,
      messages: [{ role: "user", content: userPrompt }],
      tools: [],
    });

    const rawText = (response.content || "").trim();
    let parsed: any = null;

    try {
      // Clean possible markdown code fence wrappers
      const cleanJson = rawText
        .replace(/^```json\s*/i, "")
        .replace(/^```\s*/i, "")
        .replace(/\s*```$/i, "")
        .trim();
      parsed = JSON.parse(cleanJson);
    } catch (err) {
      // Fallback extraction
      const fileMatch = rawText.match(/"fileName":\s*"([^"]+)"/i);
      const titleMatch = rawText.match(/"title":\s*"([^"]+)"/i);
      const contentMatch = rawText.match(/"content":\s*"([\s\S]*)"\s*\}/i);

      if (contentMatch) {
        parsed = {
          fileName: fileMatch ? fileMatch[1] : `${nextId}_FOLLOWON.md`,
          title: titleMatch ? titleMatch[1] : `Phase ${nextIndex}: Follow-on Analysis`,
          content: contentMatch[1].replace(/\\n/g, "\n").replace(/\\"/g, '"'),
        };
      } else {
        // Direct markdown fallback if model returned raw markdown instead of JSON
        parsed = {
          fileName: req.suggestedFileName || `${nextId}_FOLLOWON.md`,
          title: `Phase ${nextIndex}: Follow-on Analysis`,
          content: rawText,
        };
      }
    }

    let finalFileName = String(parsed.fileName || `${nextId}_FOLLOWON.md`).trim();
    if (!finalFileName.endsWith(".md")) finalFileName += ".md";
    // Ensure format starts with nextId
    if (!finalFileName.startsWith(`${nextId}_`)) {
      const slug = finalFileName.replace(/^[0-9]+_?/, "").replace(/\.md$/, "");
      finalFileName = `${nextId}_${slug.toUpperCase() || "ANALYSIS"}.md`;
    }

    let finalTitle = String(parsed.title || `Phase ${nextIndex}: Follow-on Analysis`).trim();
    let finalContent = String(parsed.content || "").trim();
    const reasonerCfg = reasonerClient.getConfig();

    return {
      fileName: finalFileName,
      title: finalTitle,
      content: finalContent,
      nextIndex,
      manuscriptOption: mode,
      targetManuscriptRev: mode !== "none" ? manuscriptInfo.targetFile : undefined,
      tokenUsage: response.usage,
      model: reasonerCfg.model,
      role: "reasoner",
    };
  }

  /**
   * Saves the follow-on phase markdown directly to analysis/<fileName>
   * and prepares manuscript revisions if requested.
   */
  public async savePhase(
    workspaceRoot: string,
    fileName: string,
    content: string,
    manuscriptOption: ManuscriptOption = "none"
  ): Promise<{ phasePath: string; manuscriptRevision?: { targetFile: string } | null }> {
    if (!workspaceRoot) throw new Error("Workspace root required");
    const safeName = path.basename(fileName);
    if (!safeName.endsWith(".md")) {
      throw new Error("Phase file must have a .md extension");
    }

    const analysisDir = path.join(workspaceRoot, "analysis");
    if (!fsSync.existsSync(analysisDir)) {
      await fs.mkdir(analysisDir, { recursive: true });
    }

    const targetPath = path.join(analysisDir, safeName);
    await fs.writeFile(targetPath, content, "utf-8");

    // Prepare manuscript revision on disk if requested
    let manuscriptRev = null;
    if (manuscriptOption !== "none") {
      manuscriptRev = await this.prepareManuscriptRevision(workspaceRoot, manuscriptOption);
    }

    return {
      phasePath: targetPath,
      manuscriptRevision: manuscriptRev,
    };
  }
}
