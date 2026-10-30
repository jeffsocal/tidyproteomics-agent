import * as path from "path";
import * as fs from "fs";
import { execFile } from "child_process";
import { ProviderClient } from "../llm/ProviderClient";
import { IngestQueueItem, IngestStage } from "../types";
import { LiteratureService, getLiteratureDir } from "./LiteratureService";

export interface IngestProgressEvent {
  item: IngestQueueItem;
  stage: IngestStage;
  message?: string;
  processedCount: number;
  totalCount: number;
}

export class IngestionRunner {
  private isRunning = false;
  private shouldAbort = false;

  constructor(
    private readonly literatureService: LiteratureService,
    private readonly client: ProviderClient,
    private readonly extensionPath: string,
    private readonly onProgress: (event: IngestProgressEvent) => void,
    private readonly onLog: (text: string, updateLast?: boolean) => void
  ) {}

  public getIsRunning(): boolean {
    return this.isRunning;
  }

  public abort() {
    this.shouldAbort = true;
  }

  private ts(): string {
    return new Date().toTimeString().split(" ")[0];
  }

  public async runIngestion(dbFileName: string): Promise<{ success: boolean; processed: number; errors: number }> {
    if (this.isRunning) {
      throw new Error("An ingestion process is already running.");
    }
    const viewState = this.literatureService.getViewState();
    const queue = viewState.queue;
    if (queue.length === 0) {
      throw new Error("No files in the ingestion queue. Select a literature folder first.");
    }

    const wsRoot = this.literatureService.getWorkspaceRoot();
    if (!wsRoot) {
      throw new Error("No active workspace directory set.");
    }

    const targetDir = viewState.literatureDir || viewState.corporaDir || getLiteratureDir(wsRoot);
    const dbPath = path.join(targetDir, path.basename(dbFileName));
    if (!fs.existsSync(dbPath)) {
      throw new Error(`Literature database does not exist: ${dbFileName}`);
    }

    this.isRunning = true;
    this.shouldAbort = false;
    let processed = 0;
    let errors = 0;

    this.onLog(`[${this.ts()}] Literature: Starting batch ingestion of ${queue.length} files into ${path.basename(dbFileName)}`);

    try {
      for (let i = 0; i < queue.length; i++) {
        if (this.shouldAbort) {
          this.onLog(`[${this.ts()}] Literature: Ingestion aborted by user.`);
          break;
        }

        const item = queue[i];
        if (item.stage === "indexed") {
          continue; // Already processed
        }

        try {
          await this.processItem(item, dbPath, i + 1, queue.length);
          processed++;
        } catch (err: any) {
          errors++;
          item.stage = "failed";
          item.message = err.message || String(err);
          this.literatureService.updateQueueItem(item.id, { stage: "failed", message: item.message });
          this.onProgress({
            item,
            stage: "failed",
            message: item.message,
            processedCount: i + 1,
            totalCount: queue.length,
          });
          this.onLog(`[${this.ts()}] Literature: ❌ Failed to ingest ${item.fileName}: ${item.message}`);
        }
      }
    } finally {
      this.isRunning = false;
      this.shouldAbort = false;
      this.literatureService.syncWorkspaceScripts();
    }

    this.onLog(`[${this.ts()}] Literature: Ingestion batch complete: ${processed} indexed, ${errors} failed.`);
    if (processed > 0) {
      try {
        this.onLog(`[${this.ts()}] Literature: Updating database accounting report (docs/literature_database.md)...`);
        await this.literatureService.generateReport(path.basename(dbFileName));
        this.onLog(`[${this.ts()}] Literature: ✓ Updated docs/literature_database.md`);
      } catch (repErr: any) {
        this.onLog(`[${this.ts()}] Literature: Notice: could not auto-update report: ${repErr.message}`);
      }
    }
    return { success: errors === 0, processed, errors };
  }

  private async processItem(
    item: IngestQueueItem,
    dbPath: string,
    currentIndex: number,
    totalCount: number
  ): Promise<void> {
    const notify = (stage: IngestStage, message?: string) => {
      item.stage = stage;
      item.message = message;
      this.literatureService.updateQueueItem(item.id, { stage, message });
      this.onProgress({
        item,
        stage,
        message,
        processedCount: currentIndex,
        totalCount,
      });
    };

    // Stage 1: Parsing PDF or Table
    notify("parsing_pdf", "Extracting text and tables...");
    this.onLog(`[${this.ts()}] Literature: [${currentIndex}/${totalCount}] Parsing ${item.fileName}...`);
    const extractScript = this.findScript("extract_text_or_table.R");
    const rscript = this.literatureService.resolveRscript();

    const extractPayload = await this.execRJson(rscript, extractScript, [item.absPath, "25"]);
    if (!extractPayload.ok) {
      throw new Error(extractPayload.error || "Failed to extract text from file.");
    }

    // Stage 2: LLM Structured Extraction
    notify("llm_extraction", "LLM structured extraction...");
    this.onLog(`[${this.ts()}] Literature: [${currentIndex}/${totalCount}] Extracting assertions from ${item.fileName}...`);

    let studyId = `doi_${path.basename(item.fileName, path.extname(item.fileName))}`;
    let extractedPayload: any = null;

    if (extractPayload.kind === "pdf") {
      extractedPayload = await this.llmExtractFromPdfText(item.fileName, extractPayload.text);
    } else {
      extractedPayload = await this.llmExtractFromTable(item.fileName, extractPayload.columns, extractPayload.rows);
    }

    if (!extractedPayload || !extractedPayload.study) {
      throw new Error("LLM failed to return structured extraction payload.");
    }

    extractedPayload.db_path = dbPath;
    if (extractedPayload.study && extractedPayload.study.study_id) {
      studyId = extractedPayload.study.study_id;
    } else {
      extractedPayload.study.study_id = studyId;
    }
    extractedPayload.study.filename = item.fileName;

    // Stage 3: R Symbol & Ortholog Normalization
    notify("normalization", "Normalizing symbols and orthologs...");
    this.onLog(`[${this.ts()}] Literature: [${currentIndex}/${totalCount}] Normalizing symbols via R (limma/babelgene)...`);

    let normScript: string;
    try {
      normScript = this.findScript("normalize_and_insert_literature.R");
    } catch {
      normScript = this.findScript("normalize_and_insert_corpus.R");
    }

    const wsRoot = this.literatureService.getWorkspaceRoot();
    const litDir = getLiteratureDir(wsRoot);
    fs.mkdirSync(litDir, { recursive: true });
    const tmpJson = path.join(litDir, `_tmp_ingest_${Date.now()}.json`);

    try {
      fs.writeFileSync(tmpJson, JSON.stringify(extractedPayload, null, 2), "utf-8");
      const normRes = await this.execRJson(rscript, normScript, [tmpJson, dbPath]);
      if (!normRes.ok) {
        throw new Error(normRes.error || "Normalization and insertion failed in R.");
      }

      // Stage 4: Indexed in DuckDB
      if ((normRes.assertions_inserted || 0) === 0) {
        notify("indexed", "Indexed 0 assertions (no explicit protein relationships found)");
        this.onLog(
          `[${this.ts()}] Literature: Warning: 0 assertions extracted from ${item.fileName}. Check if document contains explicit protein interactions or is a conceptual overview.`
        );
      } else {
        notify(
          "indexed",
          `Indexed ${normRes.assertions_inserted} assertions (${normRes.symbols_normalized || 0} normalized)`
        );
        this.onLog(
          `[${this.ts()}] Literature: ✓ [${currentIndex}/${totalCount}] Indexed ${item.fileName}: ${normRes.assertions_inserted} assertions into DuckDB.`
        );
      }
    } finally {
      try {
        if (fs.existsSync(tmpJson)) fs.unlinkSync(tmpJson);
      } catch {}
    }
  }

  private async llmExtractFromPdfText(fileName: string, rawText: string): Promise<any> {
    const systemPrompt = `You are an expert molecular biologist, biochemist, and biocuration specialist.
Your task is to extract structured scientific facts from literature text for ingestion into a Perturbation-Centric Knowledge Graph.

CRITICAL INSTRUCTIONS:
1. Extract ALL specific proteins, co-factors, adapters, substrates, binding partners, and pathway members mentioned across the text (Abstract, Introduction, Results, Figures, Discussion, or Review sections).
2. For experimental perturbation papers (KO, KD, chemical inhibition): extract altered targets, secondary hits, downstream destabilized targets, and co-regulated modules.
3. For structural, biochemical, or review papers: extract the primary target, its known physical interactors (e.g. adapters, co-chaperones, E3 ligases), direct substrates, and functional pathways (e.g. ERAD, autophagy, proteasome, ribosome quality control).
4. Do NOT return an empty list if any proteins, complexes, or molecular interactions are discussed in the paper. Always extract the relevant molecular entities with their biological relationship type.

OUTPUT SCHEMA (Must be raw valid JSON matching this exact structure):
{
  "study": {
    "study_id": "DOI or paper title slug (e.g. 10.1038/s41589-021-00800-0)",
    "title": "Full title of paper",
    "year": 2021,
    "core_thesis": "2-3 sentence summary of the primary biological conclusions"
  },
  "experimental_contexts": [
    {
      "context_id": "c1",
      "system_category": "cell_line | primary_cells | in_vivo_animal | human_clinical",
      "organism": "Homo sapiens | Mus musculus | Saccharomyces cerevisiae",
      "model_name": "HeLa | U2OS | HEK293T | C57BL/6",
      "perturbation_type": "CRISPR_KO | siRNA_KD | chemical_inhibitor | infection",
      "perturbation_target": "Exact perturbation target (e.g. VCP / p97, CB-5083)",
      "assay_modality": "whole_cell_proteomics | AP-MS | diGly_ubiquitinomics | RNA_seq | western_blot",
      "context_metadata": "Dose, timepoint, or condition details"
    }
  ],
  "molecular_assertions": [
    {
      "context_id": "c1",
      "raw_entity_name": "Exact protein/gene name used in paper (e.g. p97, p47, UBXD8, Cdc48)",
      "relationship_type": "ACCUMULATES_UP | DEPLETED_DOWN | PHYSICAL_INTERACTOR | DIRECT_SUBSTRATE | COMPENSATORY_PATHWAY | NO_CHANGE",
      "functional_module": "e.g. ERAD, RQC, Mitophagy, Proteasome, Golgi reassembly",
      "quantitative_note": "Fold change or statistical metric if stated",
      "evidence_quote": "Verbatim short sentence or table reference from the text"
    }
  ]
}

Return ONLY the raw JSON object. Do not include markdown code fences or conversational text.`;

    const userMessage = `Paper Filename: ${fileName}

Text Content:
${rawText.slice(0, 50000)}

Extract all studies, contexts, and molecular assertions.`;

    const utilityClient = this.client.forRole("utility");
    const response = await utilityClient.chat({
      system: systemPrompt,
      messages: [{ role: "user", content: userMessage }],
      tools: [],
    });

    return this.cleanAndParseJson(response.content);
  }

  private async llmExtractFromTable(fileName: string, columns: string[], rows: any[]): Promise<any> {
    const systemPrompt = `You are a biocuration specialist. Convert a supplementary proteomics/genomics table into structured assertions.
Return ONLY valid JSON with { "study": {...}, "experimental_contexts": [...], "molecular_assertions": [...] }.`;

    const userMessage = `Table Filename: ${fileName}
Columns: ${columns.join(", ")}
Top Data Rows (JSON):
${JSON.stringify(rows.slice(0, 40), null, 2)}

Extract the study, context, and all molecular assertions with raw_entity_name and relationship_type.`;

    const utilityClient = this.client.forRole("utility");
    const response = await utilityClient.chat({
      system: systemPrompt,
      messages: [{ role: "user", content: userMessage }],
      tools: [],
    });

    return this.cleanAndParseJson(response.content);
  }

  private cleanAndParseJson(content: string): any {
    let clean = (content || "").trim();
    if (clean.startsWith("```json")) clean = clean.slice(7);
    else if (clean.startsWith("```")) clean = clean.slice(3);
    if (clean.endsWith("```")) clean = clean.slice(0, -3);
    clean = clean.trim();
    const firstBrace = clean.indexOf("{");
    const lastBrace = clean.lastIndexOf("}");
    if (firstBrace !== -1 && lastBrace !== -1) {
      clean = clean.substring(firstBrace, lastBrace + 1);
    }
    return JSON.parse(clean);
  }

  private findScript(scriptName: string): string {
    const candidates = [
      path.join(this.extensionPath, "templates", "shared", "tools", "literature", scriptName),
      path.join(this.extensionPath, "extension", "templates", "shared", "tools", "literature", scriptName),
      path.join(__dirname, "..", "templates", "shared", "tools", "literature", scriptName),
      path.join(__dirname, "..", "..", "templates", "shared", "tools", "literature", scriptName),
      // Legacy fallbacks
      path.join(this.extensionPath, "templates", "shared", "tools", "corpus", scriptName),
      path.join(this.extensionPath, "extension", "templates", "shared", "tools", "corpus", scriptName),
      path.join(__dirname, "..", "templates", "shared", "tools", "corpus", scriptName),
      path.join(__dirname, "..", "..", "templates", "shared", "tools", "corpus", scriptName),
    ];
    const hit = candidates.find((c) => fs.existsSync(c));
    if (hit) return hit;
    throw new Error(`Literature script '${scriptName}' not found in extension templates.`);
  }

  private execRJson(rscript: string, scriptPath: string, args: string[]): Promise<any> {
    return new Promise((resolve) => {
      execFile(
        rscript,
        [scriptPath, ...args],
        { timeout: 90000, maxBuffer: 15 * 1024 * 1024 },
        (error, stdout, stderr) => {
          const lines = String(stdout || "").split(/\r?\n/);
          const line = lines.find((l) => l.startsWith("@@LITERATURE_JSON@@") || l.startsWith("@@CORPUS_JSON@@"));
          if (line) {
            try {
              const marker = line.startsWith("@@LITERATURE_JSON@@") ? "@@LITERATURE_JSON@@" : "@@CORPUS_JSON@@";
              resolve(JSON.parse(line.slice(marker.length)));
              return;
            } catch (err: any) {
              resolve({ ok: false, error: `JSON parse error: ${err.message}`, stderr });
              return;
            }
          }
          const msg = String(stderr || error?.message || "").trim();
          resolve({ ok: false, error: msg || "R process finished without output.", stderr });
        }
      );
    });
  }
}
