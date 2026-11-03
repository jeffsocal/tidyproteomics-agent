import * as fs from "fs/promises";
import * as fsSync from "fs";
import * as path from "path";

export interface ExperimentSpec {
  exists: boolean;
  pathToDataFile: string | null;
  platform: string | null;
  analyte: string | null;
  description: string | null;
  analysisMode: "hypothesis_test" | "cohort_coded_descriptive";
  subjectPairing: "paired" | "unpaired" | "unknown";
  batchEffect: "none" | "column" | "unknown";
  groupLabelsMapped: boolean;
  rawSampleGroups: string[];
  discoveredGroups: string[];
  discoveredGroupsConfirmed: boolean;
  normalizationMethods: string;
  normalizationSubsetFilter: string;
  normalizationConfirmed: boolean;
  imputationMethod: string;
  imputationConfirmed: boolean;
  sampleRenamingMap: Record<string, string>;
  reassignSampleNames: boolean;
  samplePoolingConfirmed: boolean;
  targetContrasts: string[];
  contrastConfirmed: boolean;
  batchConfoundingDetected: boolean;
  batchConfoundingAuthorized: boolean;
  batchConfoundingConfirmed: boolean;
  batchConfoundingRationale?: string;
  annotationSource: string;
  annotationFilePath: string;
  annotationTaxonId: string;
  annotationOntologies: string;
  annotationValidationStatus: string;
  annotationConfirmed: boolean;
  missingInitialFields: ("PATH_TO_DATA_FILE" | "PLATFORM" | "ANALYTE" | "DESCRIPTION")[];
}

export class ExperimentManager {
  constructor(
    private workspaceRoot: string,
    private extensionUriPath?: string
  ) {}

  public setWorkspaceRoot(newRoot: string) {
    this.workspaceRoot = newRoot || "";
  }

  public getExperimentPath(): string {
    return path.join(this.workspaceRoot, "docs", "experiment.md");
  }

  /**
   * Ensures docs/experiment.md exists by copying the template if needed.
   */
  public async ensureExperimentDoc(): Promise<string> {
    const expPath = this.getExperimentPath();
    if (fsSync.existsSync(expPath)) {
      return await fs.readFile(expPath, "utf-8");
    }

    const docsDir = path.dirname(expPath);
    if (!fsSync.existsSync(docsDir)) {
      await fs.mkdir(docsDir, { recursive: true });
    }

    let templateContent = "";
    if (this.extensionUriPath) {
      const templatePath = path.join(this.extensionUriPath, "templates", "shared", "docs", "experiment.md");
      if (fsSync.existsSync(templatePath)) {
        templateContent = await fs.readFile(templatePath, "utf-8");
      }
    }

    if (!templateContent) {
      templateContent = `# Experiment & Dataset Specification

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
- **Contrast**: <treatment> vs <control>
- **Confirm Target Contrasts**: FALSE

### F. Confounded Batch & Exploratory Comparison Gate
<!-- Exposed only if LLM determines batch confounding to be an issue in the study design -->
- **Batch Confounding Detected**: FALSE
- **Proceed With Potential Batch Confounding**: FALSE
- **Confirm Batch Confounding Authorization**: FALSE

### G. Functional Annotation Strategy
<!-- Configures functional ontology annotation (GO terms, KEGG, Reactome) for pathway enrichment -->
- **Annotation Source**: uniprot
- **Annotation File Path**: NONE
- **Taxon / Organism ID**: (Pending Phase 1 target organism identification)
- **Annotation Ontologies**: biological_process, cellular_component, molecular_function, reactome_pathway
- **Annotation Validation Status**: PENDING
- **Confirm Functional Annotation Strategy**: FALSE
`;
    }

    await fs.writeFile(expPath, templateContent, "utf-8");
    return templateContent;
  }

  /**
   * Reads and parses docs/experiment.md, determining which fields are unassigned.
   */
  public async readSpec(): Promise<ExperimentSpec> {
    const expPath = this.getExperimentPath();
    if (!fsSync.existsSync(expPath)) {
      return {
        exists: false,
        pathToDataFile: null,
        platform: null,
        analyte: null,
        description: null,
        analysisMode: "hypothesis_test",
        subjectPairing: "unpaired",
        batchEffect: "none",
        groupLabelsMapped: false,
        rawSampleGroups: [],
        discoveredGroups: [],
        discoveredGroupsConfirmed: false,
        normalizationMethods: "default",
        normalizationSubsetFilter: "NONE",
        normalizationConfirmed: false,
        imputationMethod: "randomforest_grouped",
        imputationConfirmed: false,
        sampleRenamingMap: {},
        reassignSampleNames: true,
        samplePoolingConfirmed: false,
        targetContrasts: [],
        contrastConfirmed: false,
        batchConfoundingDetected: false,
        batchConfoundingAuthorized: false,
        batchConfoundingConfirmed: false,
        annotationSource: "uniprot",
        annotationFilePath: "NONE",
        annotationTaxonId: "(Pending Phase 1 target organism identification)",
        annotationOntologies: "biological_process, cellular_component, molecular_function, reactome_pathway",
        annotationValidationStatus: "PENDING",
        annotationConfirmed: false,
        missingInitialFields: ["PATH_TO_DATA_FILE", "PLATFORM", "ANALYTE", "DESCRIPTION"],
      };
    }

    const content = await fs.readFile(expPath, "utf-8");
    const missing: ("PATH_TO_DATA_FILE" | "PLATFORM" | "ANALYTE" | "DESCRIPTION")[] = [];

    // 1. PATH_TO_DATA_FILE
    let pathToDataFile: string | null = null;
    const pathMatch = content.match(/-\s*\*\*PATH_TO_DATA_FILE\*\*:\s*(.*)/i);
    if (pathMatch) {
      const val = pathMatch[1].trim();
      if (val && !val.includes("[REQUIRED") && !val.startsWith("<") && !val.includes("Enter URL")) {
        pathToDataFile = val;
      }
    }
    if (!pathToDataFile) missing.push("PATH_TO_DATA_FILE");

    // 2. PLATFORM
    let platform: string | null = null;
    const platMatch = content.match(/-\s*\*\*PLATFORM\*\*:\s*(.*)/i);
    if (platMatch) {
      const val = platMatch[1].trim();
      if (val && !val.includes("[REQUIRED") && !val.startsWith("<") && !val.includes("Enter search platform")) {
        platform = val;
      }
    }
    if (!platform) missing.push("PLATFORM");

    // 3. ANALYTE
    let analyte: string | null = null;
    const analyteMatch = content.match(/-\s*\*\*ANALYTE\*\*:\s*(.*)/i);
    if (analyteMatch) {
      const val = analyteMatch[1].trim();
      if (val && !val.includes("[REQUIRED") && !val.startsWith("<") && !val.includes("proteins or peptides")) {
        analyte = val;
      }
    }
    if (!analyte) missing.push("ANALYTE");

    // 4. DESCRIPTION
    let description: string | null = null;
    const descSectionMatch = content.match(/## 2\. Experimental Hypothesis & Study Design[\s\S]*?(?=## 3\.|$)/i);
    if (descSectionMatch) {
      const secText = descSectionMatch[0];
      const cleaned = secText
        .replace(/## 2\. Experimental Hypothesis & Study Design/i, "")
        .replace(/👉\s*\[USER ACTION REQUIRED[^\]]*\]:/gi, "")
        .replace(/<!--[\s\S]*?-->/g, "")
        .trim();
      if (cleaned && !cleaned.includes("[REQUIRED") && cleaned.length >= 10) {
        description = cleaned;
      }
    }
    if (!description) missing.push("DESCRIPTION");

    // 5. Target Contrasts (Section 3.E or legacy 3.C)
    const targetContrasts: string[] = [];
    const contrastMatches = content.matchAll(/-\s*(?:Confirmed\s*)?Contrast:\s*(.*)/gi);
    for (const m of contrastMatches) {
      const c = m[1].trim();
      if (c && !c.includes("<treatment>") && !c.includes("<control>") && !c.includes("[REQUIRED") && !c.includes("Pending Phase 1")) {
        targetContrasts.push(c);
      }
    }
    // Also parse backticked or slash-separated contrasts in Section 3.E / 3.C
    const secCMatch = content.match(/###\s*(?:3\.E|E|3\.C|C)\.?\s*Target [Cc]ontrasts[\s\S]*?(?=###\s*(?:3\.[A-Z]|[A-Z])\.|$|##)/i);
    if (secCMatch) {
      const lines = secCMatch[0].split("\n");
      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith("#") || trimmed.startsWith("👉") || trimmed.startsWith("<!--") || trimmed.includes("[REQUIRED") || trimmed.includes("Pending Phase 1")) {
          continue;
        }
        const m = trimmed.match(/(?:-\s*(?:Confirmed\s*)?Contrast:\s*)?`?([a-zA-Z0-9_-]+)`?\s*(?:\/|vs\.?|versus)\s*`?([a-zA-Z0-9_-]+)`?/i);
        if (m) {
          const pair = `${m[1]} vs ${m[2]}`;
          if (!targetContrasts.includes(pair)) {
            targetContrasts.push(pair);
          }
        }
      }
    }

    // 6. Sample Renaming Map (Section 3.D or legacy 3.B)
    const sampleRenamingMap: Record<string, string> = {};
    const tableMatch =
      content.match(/^[ \t]*\|[ \t]*Raw Sample Group[ \t]*\|[ \t]*Cleaned Group Name[ \t]*\|[^\r\n]*\r?\n[ \t]*\|[ \t]*:?---+:?[ \t]*\|[ \t]*:?---+:?[ \t]*\|[^\r\n]*\r?\n([\s\S]*?)(?=\n\s*(?:[^|\s]|👉|###|##|$))/im) ||
      content.match(/\| Raw Sample Group \| Cleaned Group Name \|\s*\n\| :--- \| :--- \|\s*\n([\s\S]*?)(?=\n\s*(?:👉|###|##|$))/i);
    if (tableMatch) {
      const rows = tableMatch[1].split("\n").map((r) => r.trim()).filter((r) => r.startsWith("|"));
      for (const row of rows) {
        const parts = row.split("|").map((p) => p.trim()).filter(Boolean);
        if (parts.length >= 2 && parts[0] !== "Raw Sample Group" && !parts[0].includes("---")) {
          sampleRenamingMap[parts[0]] = parts[1];
        }
      }
    }

    // 7. Parse discovered sample groups from Section 3.A & cleaned groups from Section 3.D / 3.B
    const rawGroups: string[] = [];
    const secAMatch = content.match(/###\s*(?:3\.A|A)\.?\s*Discovered sample groups[\s\S]*?(?=###\s*(?:3\.[B-Z]|[B-Z])\.|$|##)/i);
    if (secAMatch) {
      const rows = secAMatch[0].split("\n");
      for (const row of rows) {
        const trimmed = row.trim();
        if (trimmed.startsWith("|") && !trimmed.includes("---") && !trimmed.includes("Discovered sample group") && !trimmed.includes("Raw Sample Group")) {
          const parts = trimmed.split("|").map((p) => p.trim()).filter(Boolean);
          if (parts.length >= 1) {
            const clean = parts[0].replace(/[`'"]/g, "").trim();
            if (clean && !rawGroups.includes(clean)) {
              rawGroups.push(clean);
            }
          }
        }
      }
    }

    const cleanBiologicalGroups: string[] = [];
    const secBMatch = content.match(/###\s*(?:3\.D|D|3\.B|B)\.?\s*Sample Group Renaming[\s\S]*?(?=###\s*(?:3\.[A-Z]|[A-Z])\.|$|##)/i);
    if (secBMatch) {
      const rows = secBMatch[0].split("\n");
      for (const row of rows) {
        const trimmed = row.trim();
        if (trimmed.startsWith("|") && !trimmed.includes("---") && !trimmed.includes("Proposed clean") && !trimmed.includes("Cleaned Group")) {
          const parts = trimmed.split("|").map((p) => p.trim()).filter(Boolean);
          if (parts.length >= 2) {
            const clean = parts[1].replace(/[`'"]/g, "").trim();
            if (clean && !cleanBiologicalGroups.includes(clean)) {
              cleanBiologicalGroups.push(clean);
            }
          }
        }
      }
    }

    const effectiveGroups = cleanBiologicalGroups.length >= 2 ? cleanBiologicalGroups : rawGroups;

    // 8. Typed Design Object Metadata
    const modeMatch = content.match(/-\s*\*\*Analysis Mode\*\*:\s*([^\n\r]+)/i);
    const analysisMode: "hypothesis_test" | "cohort_coded_descriptive" =
      modeMatch && /cohort_coded_descriptive/i.test(modeMatch[1]) ? "cohort_coded_descriptive" : "hypothesis_test";

    const pairingMatch = content.match(/-\s*\*\*Subject Pairing\*\*:\s*([^\n\r]+)/i);
    const subjectPairing: "paired" | "unpaired" | "unknown" =
      pairingMatch && /paired/i.test(pairingMatch[1])
        ? "paired"
        : pairingMatch && /unknown/i.test(pairingMatch[1])
        ? "unknown"
        : "unpaired";

    const batchMatch = content.match(/-\s*\*\*Batch Effect\*\*:\s*([^\n\r]+)/i);
    const batchEffect: "none" | "column" | "unknown" =
      batchMatch && /column/i.test(batchMatch[1])
        ? "column"
        : batchMatch && /unknown/i.test(batchMatch[1])
        ? "unknown"
        : "none";

    const hasUnmapped = rawGroups.length > 0 && rawGroups.some(g => {
      const lower = g.toLowerCase();
      const isCodedOnly = /^[sS]?\d+$/.test(lower) || /^(sample|group|cohort)[-_]?\d+$/i.test(lower);
      const mapped = sampleRenamingMap[g];
      return isCodedOnly && (!mapped || /^[sS]?\d+$/.test(mapped) || /^(sample|group|cohort)[-_]?\d+$/i.test(mapped));
    });
    const groupLabelsMappedMatch = content.match(/-\s*\*\*Group Labels Mapped\*\*:\s*([^\n\r]+)/i);
    const groupLabelsMapped = groupLabelsMappedMatch
      ? /TRUE/i.test(groupLabelsMappedMatch[1])
      : !hasUnmapped;

    // 3.A Discovered Groups Confirmation: illegal to set TRUE if cohorts are unmapped without explicit descriptive deviation
    let discoveredGroupsConfirmed = /-\s*\*\*Confirm Discovered Sample Groups\*\*:\s*TRUE/i.test(content);
    if (analysisMode !== "cohort_coded_descriptive" && hasUnmapped && !groupLabelsMapped) {
      discoveredGroupsConfirmed = false;
    }

    // 3.B Quantitative Normalization Strategy & Confirmation
    const normMethodsMatch = content.match(/-\s*\*\*Normalization Methods\*\*:\s*([^\n\r]+)/i);
    const normalizationMethods = normMethodsMatch ? normMethodsMatch[1].trim() : "default";
    const normSubsetMatch = content.match(/-\s*\*\*Normalization Subset Filter\*\*:\s*([^\n\r]+)/i);
    const normalizationSubsetFilter = normSubsetMatch ? normSubsetMatch[1].trim() : "NONE";
    const normalizationConfirmed = /-\s*\*\*Confirm Normalization Strategy\*\*:\s*TRUE/i.test(content);

    // 3.C Missing Value Imputation Strategy & Confirmation
    const impMethodMatch = content.match(/-\s*\*\*Imputation Method\*\*:\s*([a-zA-Z0-9_.:-]+)/i);
    const imputationMethod = impMethodMatch ? impMethodMatch[1].trim() : "randomforest_grouped";
    const imputationConfirmed = /-\s*\*\*Confirm Imputation Strategy\*\*:\s*TRUE/i.test(content);

    // 3.D Sample Group Renaming & Pooling Map Confirmation
    const reassignSampleNames = !/-\s*\*\*Reassign Sample Names According to (?:Sample Group Renaming & )?Pooling Map\*\*:\s*FALSE/i.test(content);
    const samplePoolingConfirmed = /-\s*\*\*Confirm Sample Pooling Map\*\*:\s*TRUE/i.test(content);

    // 3.E Target Contrasts Confirmation
    const secCText = secCMatch ? secCMatch[0] : "";
    const contrastConfirmed =
      /-\s*\*\*Confirm Target Contrasts\*\*:\s*TRUE/i.test(content) ||
      /Status:\s*CONFIRMED/i.test(secCText) ||
      /###\s*(?:3\.E|E|3\.C|C)\.?\s*Target [Cc]ontrasts[^\n]*CONFIRMED/i.test(content) ||
      (targetContrasts.length > 0 && !secCText.includes("👉 [USER ACTION REQUIRED") && !secCText.includes("<treatment>") && !/-\s*\*\*Confirm Target Contrasts\*\*:\s*FALSE/i.test(content));

    // 3.F Confounded Batch & Exploratory Comparison Gate (Only exposed if LLM determines issue)
    const batchConfoundingDetected =
      /-\s*\*\*Batch Confounding Detected\*\*:\s*TRUE/i.test(content) ||
      /<!--\s*(?:Agent Note:\s*)?Batch Confounding(?:\s*Issue)?\s*Detected/i.test(content) ||
      /⚠️\s*\[PRE-FLIGHT GATE DECISION\]:\s*Batch confounding detected/i.test(content) ||
      /batch confounding detected between treatment and control cohorts/i.test(content);

    const batchConfoundingAuthorized =
      /-\s*\*\*Proceed With Potential Batch Confounding\*\*:\s*TRUE/i.test(content) ||
      /-\s*\*\*Authorize Unadjusted Exploratory Comparison\*\*:\s*TRUE/i.test(content);

    const batchConfoundingConfirmed =
      /-\s*\*\*Confirm Batch Confounding Authorization\*\*:\s*TRUE/i.test(content) ||
      batchConfoundingAuthorized;

    let batchConfoundingRationale: string | undefined = undefined;
    const rationaleMatch = content.match(/<!--\s*Agent Batch Confounding Rationale:\s*([\s\S]*?)-->/i);
    if (rationaleMatch) {
      batchConfoundingRationale = rationaleMatch[1].trim();
    }

    // 3.G Functional Annotation Strategy & Confirmation
    const annotSourceMatch = content.match(/-\s*\*\*Annotation Source\*\*:\s*([^\n\r]+)/i);
    const annotationSource = annotSourceMatch ? annotSourceMatch[1].trim().toLowerCase() : "uniprot";

    const annotFileMatch = content.match(/-\s*\*\*Annotation File Path\*\*:\s*([^\n\r]+)/i);
    const annotationFilePath = annotFileMatch ? annotFileMatch[1].trim() : "NONE";

    const annotTaxonMatch = content.match(/-\s*\*\*Taxon \/ Organism ID\*\*:\s*([^\n\r]+)/i);
    const annotationTaxonId = annotTaxonMatch ? annotTaxonMatch[1].trim() : "(Pending Phase 1 target organism identification)";

    const annotOntMatch = content.match(/-\s*\*\*Annotation Ontologies\*\*:\s*([^\n\r]+)/i);
    const annotationOntologies = annotOntMatch ? annotOntMatch[1].trim() : "biological_process, cellular_component, molecular_function, reactome_pathway";

    const annotStatusMatch = content.match(/-\s*\*\*Annotation Validation Status\*\*:\s*([^\n\r]+)/i);
    const annotationValidationStatus = annotStatusMatch ? annotStatusMatch[1].trim() : "PENDING";

    const annotationConfirmed =
      /(?:-\s*|\*\s*)?\*{0,2}Confirm Functional Annotation Strategy\*{0,2}\s*:\s*(?:TRUE|YES|1|\[x\])/i.test(content);

    return {
      exists: true,
      pathToDataFile,
      platform,
      analyte,
      description,
      analysisMode,
      subjectPairing,
      batchEffect,
      groupLabelsMapped,
      rawSampleGroups: rawGroups,
      discoveredGroups: effectiveGroups,
      discoveredGroupsConfirmed,
      normalizationMethods,
      normalizationSubsetFilter,
      normalizationConfirmed,
      imputationMethod,
      imputationConfirmed,
      sampleRenamingMap,
      reassignSampleNames,
      samplePoolingConfirmed,
      targetContrasts,
      contrastConfirmed,
      batchConfoundingDetected,
      batchConfoundingAuthorized,
      batchConfoundingConfirmed,
      batchConfoundingRationale,
      annotationSource,
      annotationFilePath,
      annotationTaxonId,
      annotationOntologies,
      annotationValidationStatus,
      annotationConfirmed,
      missingInitialFields: missing,
    };
  }

  public getDiscoveredGroups(spec?: ExperimentSpec): string[] {
    if (spec && spec.discoveredGroups && spec.discoveredGroups.length > 0) {
      return spec.discoveredGroups;
    }
    return [];
  }

  /**
   * Updates Section 1 parameter (PATH_TO_DATA_FILE, PLATFORM, or ANALYTE).
   */
  public async setParameter(key: "PATH_TO_DATA_FILE" | "PLATFORM" | "ANALYTE", value: string): Promise<void> {
    await this.ensureExperimentDoc();
    const expPath = this.getExperimentPath();
    let content = await fs.readFile(expPath, "utf-8");

    const regex = new RegExp(`(-\\s*\\*\\*${key}\\*\\*:\\s*)(.*)`, "i");
    if (regex.test(content)) {
      content = content.replace(regex, `$1${value.trim()}`);
    } else {
      // If missing from Section 1, append it
      content = content.replace(
        /(## 1\. Input Dataset Parameters[\s\S]*?)(?=## 2\.|$)/i,
        `$1\n- **${key}**: ${value.trim()}\n`
      );
    }
    await fs.writeFile(expPath, content, "utf-8");
  }

  /**
   * Sets Section 2 experimental hypothesis & study design.
   */
  public async setDescription(description: string): Promise<void> {
    await this.ensureExperimentDoc();
    const expPath = this.getExperimentPath();
    let content = await fs.readFile(expPath, "utf-8");

    const sectionRegex = /(## 2\. Experimental Hypothesis & Study Design[\s\S]*?)(?=## 3\.|$)/i;
    const newSection = `## 2. Experimental Hypothesis & Study Design\n\n${description.trim()}\n\n`;

    if (sectionRegex.test(content)) {
      content = content.replace(sectionRegex, newSection);
    } else {
      content += `\n\n${newSection}`;
    }
    await fs.writeFile(expPath, content, "utf-8");
  }

  public async setAnalysisMode(mode: "hypothesis_test" | "cohort_coded_descriptive"): Promise<void> {
    await this.ensureExperimentDoc();
    const expPath = this.getExperimentPath();
    let content = await fs.readFile(expPath, "utf-8");
    if (/-\s*\*\*Analysis Mode\*\*:/i.test(content)) {
      content = content.replace(/(-\s*\*\*Analysis Mode\*\*:\s*)([^\n\r]+)/i, `$1${mode}`);
    } else {
      content = content.replace(/(## 3\. Bioinformatics Design\s*\n)/i, `$1\n- **Analysis Mode**: ${mode}\n`);
    }
    await fs.writeFile(expPath, content, "utf-8");
  }

  /**
   * Sets Section 3.A Discovered Sample Groups confirmation check.
   */
  public async setDiscoveredGroupsConfirmed(confirmed: boolean = true): Promise<void> {
    await this.ensureExperimentDoc();
    const expPath = this.getExperimentPath();
    const spec = await this.readSpec();
    let content = await fs.readFile(expPath, "utf-8");

    // Guard: Confirm flags may be set TRUE only after non-empty sample-key field,
    // or an explicit DEVIATION_ACCEPTED / cohort_coded_descriptive mode (Issue 2)
    if (confirmed && !spec.groupLabelsMapped && spec.analysisMode !== "cohort_coded_descriptive") {
      throw new Error(
        "Cannot set Confirm Discovered Sample Groups: TRUE while sample group biological identities are unmapped. " +
        "Map cohorts to biological condition labels in Section 3.D, or explicitly set Analysis Mode: cohort_coded_descriptive."
      );
    }

    const val = confirmed ? "TRUE" : "FALSE";
    if (/-\s*\*\*Confirm Discovered Sample Groups\*\*:/i.test(content)) {
      content = content.replace(/(-\s*\*\*Confirm Discovered Sample Groups\*\*:\s*)(TRUE|FALSE)/i, `$1${val}`);
    } else {
      content = content.replace(
        /(###\s*(?:3\.A|A)\.?\s*Discovered sample groups[\s\S]*?(?=###\s*(?:3\.[B-F]|[B-F])\.|$|##))/i,
        `$1\n- **Confirm Discovered Sample Groups**: ${val}\n`
      );
    }
    await fs.writeFile(expPath, content, "utf-8");
  }

  /**
   * Sets Section 3.D (or legacy 3.B) sample renaming and pooling map.
   */
  public async setSampleRenamingMap(mapping: Record<string, string>, confirmed?: boolean): Promise<void> {
    await this.ensureExperimentDoc();
    const expPath = this.getExperimentPath();
    let content = await fs.readFile(expPath, "utf-8");

    let table = "| Raw Sample Group | Cleaned Group Name |\n| :--- | :--- |\n";
    for (const [raw, clean] of Object.entries(mapping)) {
      table += `| ${raw} | ${clean} |\n`;
    }

    // Match an existing table under Section 3.D/3.B (only table rows starting with |)
    const existingTableRegex = /(^[ \t]*\|[ \t]*Raw Sample Group[ \t]*\|[ \t]*Cleaned Group Name[ \t]*\|[^\r\n]*(?:\r?\n[ \t]*\|[^\r\n]*)*)/im;

    if (existingTableRegex.test(content)) {
      content = content.replace(existingTableRegex, table.trimEnd());
    } else {
      const sectionHeaderRegex = /(###\s*(?:3\.D|D|3\.B|B)\.?\s*Sample Group Renaming[^\r\n]*\r?\n)/i;
      if (sectionHeaderRegex.test(content)) {
        content = content.replace(sectionHeaderRegex, `$1\n${table}\n`);
      } else {
        const secERegex = /(###\s*(?:3\.E|E|3\.C|C)\.?\s*Target [Cc]ontrasts)/i;
        const confirmStr = confirmed ? "TRUE" : "FALSE";
        const newSecD = `### D. Sample Group Renaming & Pooling Map:\n${table}\n- **Reassign Sample Names According to Pooling Map**: TRUE\n- **Confirm Sample Pooling Map**: ${confirmStr}\n\n`;
        if (secERegex.test(content)) {
          content = content.replace(secERegex, `${newSecD}$1`);
        } else {
          content += `\n\n${newSecD}`;
        }
      }
    }

    // Ensure Reassign toggle is present
    if (!/-\s*\*\*Reassign Sample Names According to (?:Sample Group Renaming & )?Pooling Map\*\*:/i.test(content)) {
      if (existingTableRegex.test(content)) {
        content = content.replace(existingTableRegex, `$1\n\n- **Reassign Sample Names According to Pooling Map**: TRUE`);
      } else {
        const sectionHeaderRegex = /(###\s*(?:3\.D|D|3\.B|B)\.?\s*Sample Group Renaming[^\r\n]*\r?\n)/i;
        if (sectionHeaderRegex.test(content)) {
          content = content.replace(sectionHeaderRegex, `$1\n- **Reassign Sample Names According to Pooling Map**: TRUE\n`);
        }
      }
    }

    // Ensure Confirm check is present and updated if confirmed specified
    const confirmVal = confirmed !== undefined ? (confirmed ? "TRUE" : "FALSE") : undefined;
    if (/-\s*\*\*Confirm Sample Pooling Map\*\*:/i.test(content)) {
      if (confirmVal !== undefined) {
        content = content.replace(/(-\s*\*\*Confirm Sample Pooling Map\*\*:\s*)(TRUE|FALSE)/i, `$1${confirmVal}`);
      }
    } else {
      const initialConfirm = confirmVal ?? "FALSE";
      if (/-\s*\*\*Reassign Sample Names According to (?:Sample Group Renaming & )?Pooling Map\*\*:\s*[^\r\n]*\r?\n/i.test(content)) {
        content = content.replace(
          /(-\s*\*\*Reassign Sample Names According to (?:Sample Group Renaming & )?Pooling Map\*\*:\s*[^\r\n]*\r?\n)/i,
          `$1- **Confirm Sample Pooling Map**: ${initialConfirm}\n`
        );
      } else {
        const secDRegex = /(###\s*(?:3\.D|D|3\.B|B)\.?\s*Sample Group Renaming[\s\S]*?)(?=###\s*(?:3\.[A-Z]|[A-Z])\.|$|##)/i;
        if (secDRegex.test(content)) {
          content = content.replace(secDRegex, (m) => `${m.trimEnd()}\n- **Confirm Sample Pooling Map**: ${initialConfirm}\n\n`);
        }
      }
    }

    await fs.writeFile(expPath, content, "utf-8");
  }

  /**
   * Sets Section 3.D Sample Pooling Map confirmation check.
   */
  public async setSamplePoolingConfirmed(confirmed: boolean = true): Promise<void> {
    await this.ensureExperimentDoc();
    const expPath = this.getExperimentPath();
    let content = await fs.readFile(expPath, "utf-8");
    const val = confirmed ? "TRUE" : "FALSE";
    if (/-\s*\*\*Confirm Sample Pooling Map\*\*:/i.test(content)) {
      content = content.replace(/(-\s*\*\*Confirm Sample Pooling Map\*\*:\s*)(TRUE|FALSE)/i, `$1${val}`);
    } else if (/-\s*\*\*Reassign Sample Names According to (?:Sample Group Renaming & )?Pooling Map\*\*:\s*[^\r\n]*\r?\n/i.test(content)) {
      content = content.replace(
        /(-\s*\*\*Reassign Sample Names According to (?:Sample Group Renaming & )?Pooling Map\*\*:\s*[^\r\n]*\r?\n)/i,
        `$1- **Confirm Sample Pooling Map**: ${val}\n`
      );
    } else {
      const secDRegex = /(###\s*(?:3\.D|D|3\.B|B)\.?\s*Sample Group Renaming[\s\S]*?)(?=###\s*(?:3\.[A-Z]|[A-Z])\.|$|##)/i;
      if (secDRegex.test(content)) {
        content = content.replace(secDRegex, (match) => {
          return `${match.trimEnd()}\n- **Confirm Sample Pooling Map**: ${val}\n\n`;
        });
      }
    }
    await fs.writeFile(expPath, content, "utf-8");
  }

  /**
   * Sets Section 3.E (or legacy 3.C) target contrasts and marks them confirmed.
   */
  public async setTargetContrasts(contrasts: string[], confirmed: boolean = true): Promise<void> {
    await this.ensureExperimentDoc();
    const expPath = this.getExperimentPath();
    let content = await fs.readFile(expPath, "utf-8");

    const formattedContrasts = contrasts.map((c) => {
      let clean = c.replace(/^[-\*]\s*(?:Confirmed\s*)?Contrast:\s*/i, "").trim();
      clean = clean.replace(/[`'"]/g, "").trim();
      const parts = clean.split(/\s*(?:\/|vs\.?|versus)\s*/i);
      if (parts.length === 2 && parts[0] && parts[1]) {
        return `\`${parts[0]}\` / \`${parts[1]}\``;
      }
      return clean;
    });

    const contrastList = formattedContrasts.map((c) => `- **Contrast**: ${c}`).join("\n");
    const statusText = confirmed ? "CONFIRMED" : "PENDING";
    const confirmVal = confirmed ? "TRUE" : "FALSE";
    const newSectionE = `### E. Target Contrasts\n${contrastList}\n- **Confirm Target Contrasts**: ${confirmVal}\n\nStatus: ${statusText}\n\n`;

    const sectionRegex = /(###\s*(?:3\.E|E|3\.C|C)\.?\s*Target [Cc]ontrasts[\s\S]*?)(?=###\s*(?:3\.[A-Z]|[A-Z])\.|$|##)/i;
    if (sectionRegex.test(content)) {
      content = content.replace(sectionRegex, newSectionE);
    } else {
      content += `\n\n${newSectionE}`;
    }

    await fs.writeFile(expPath, content, "utf-8");
  }

  /**
   * Confirms whatever contrasts are in Section 3.E / 3.C, removing pending confirmation tags.
   */
  public async confirmExistingContrasts(): Promise<void> {
    await this.ensureExperimentDoc();
    const expPath = this.getExperimentPath();
    let content = await fs.readFile(expPath, "utf-8");

    const spec = await this.readSpec();
    if (spec.targetContrasts.length > 0) {
      await this.setTargetContrasts(spec.targetContrasts, true);
      return;
    }

    // If no explicit target contrasts parsed, clean any pending text and add Status: CONFIRMED
    const sectionRegex = /(###\s*(?:3\.E|E|3\.C|C)\.?\s*Target [Cc]ontrasts[\s\S]*?)(?=###\s*(?:3\.[A-Z]|[A-Z])\.|$|##)/i;
    const match = content.match(sectionRegex);
    if (match) {
      let secText = match[1];
      secText = secText.replace(/👉\s*\[USER ACTION REQUIRED[^\]]*\]:?/gi, "");
      secText = secText.replace(/\(suggested contrast requiring confirmation\)/gi, "");
      secText = secText.replace(/Status:\s*PENDING[^\n]*/gi, "");
      secText = secText.replace(/-\s*\*\*Confirm Target Contrasts\*\*:\s*FALSE/i, "- **Confirm Target Contrasts**: TRUE");
      if (!/-\s*\*\*Confirm Target Contrasts\*\*:/i.test(secText)) {
        secText = secText.trim() + "\n- **Confirm Target Contrasts**: TRUE\n";
      }
      if (!/Status:\s*CONFIRMED/i.test(secText)) {
        secText = secText.trim() + "\n\nStatus: CONFIRMED\n\n";
      }
      content = content.replace(sectionRegex, secText);
      await fs.writeFile(expPath, content, "utf-8");
    }
  }

  /**
   * Sets Section 3.F (or legacy 3.D) Confounded Batch & Exploratory Comparison Gate.
   */
  public async setBatchConfounding(authorized: boolean, detected?: boolean, confirmed: boolean = true): Promise<void> {
    await this.ensureExperimentDoc();
    const expPath = this.getExperimentPath();
    let content = await fs.readFile(expPath, "utf-8");

    const authVal = authorized ? "TRUE" : "FALSE";
    const confVal = (confirmed && authorized) ? "TRUE" : "FALSE";
    let updated = false;

    if (content.includes("Proceed With Potential Batch Confounding")) {
      content = content.replace(
        /(-\s*\*\*Proceed With Potential Batch Confounding\*\*:\s*)(TRUE|FALSE)/i,
        `$1${authVal}`
      );
      updated = true;
    }
    if (content.includes("Authorize Unadjusted Exploratory Comparison")) {
      content = content.replace(
        /(-\s*\*\*Authorize Unadjusted Exploratory Comparison\*\*:\s*)(TRUE|FALSE)/i,
        `$1${authVal}`
      );
      updated = true;
    }

    if (/-\s*\*\*Confirm Batch Confounding Authorization\*\*:/i.test(content)) {
      content = content.replace(/(-\s*\*\*Confirm Batch Confounding Authorization\*\*:\s*)(TRUE|FALSE)/i, `$1${confVal}`);
    } else if (content.includes("Proceed With Potential Batch Confounding")) {
      content = content.replace(
        /(-\s*\*\*Proceed With Potential Batch Confounding\*\*:\s*[^\n]*\n)/i,
        `$1- **Confirm Batch Confounding Authorization**: ${confVal}\n`
      );
    }

    if (detected !== undefined) {
      const detVal = detected ? "TRUE" : "FALSE";
      if (/-\s*\*\*Batch Confounding Detected\*\*:/i.test(content)) {
        content = content.replace(/(-\s*\*\*Batch Confounding Detected\*\*:\s*)(TRUE|FALSE)/i, `$1${detVal}`);
      } else {
        content = content.replace(
          /(###\s*(?:3\.F|F|3\.D|D)\.?\s*Confounded Batch[^\n]*\n)/i,
          `$1- **Batch Confounding Detected**: ${detVal}\n`
        );
      }
    }

    if (!updated) {
      content += `\n\n### F. Confounded Batch & Exploratory Comparison Gate:\n- **Batch Confounding Detected**: ${detected ? "TRUE" : "FALSE"}\n- **Proceed With Potential Batch Confounding**: ${authVal}\n- **Confirm Batch Confounding Authorization**: ${confVal}\n`;
    }

    await fs.writeFile(expPath, content, "utf-8");
  }

  /**
   * Flags or clears batch confounding detection as determined by the LLM in Phase 1 / Phase 4.
   */
  public async setBatchConfoundingDetected(detected: boolean, rationale?: string): Promise<void> {
    await this.ensureExperimentDoc();
    const expPath = this.getExperimentPath();
    let content = await fs.readFile(expPath, "utf-8");

    const detVal = detected ? "TRUE" : "FALSE";
    const rationaleComment = rationale ? `\n<!-- Agent Batch Confounding Rationale: ${rationale} -->\n` : "";

    if (/-\s*\*\*Batch Confounding Detected\*\*:/i.test(content)) {
      content = content.replace(/(-\s*\*\*Batch Confounding Detected\*\*:\s*)(TRUE|FALSE)/i, `$1${detVal}`);
    } else if (/###\s*(?:3\.F|F|3\.D|D)\.?\s*Confounded Batch/i.test(content)) {
      content = content.replace(
        /(###\s*(?:3\.F|F|3\.D|D)\.?\s*Confounded Batch[^\n]*\n)/i,
        `$1- **Batch Confounding Detected**: ${detVal}\n`
      );
    } else {
      content += `\n\n### F. Confounded Batch & Exploratory Comparison Gate:\n${rationaleComment}- **Batch Confounding Detected**: ${detVal}\n- **Proceed With Potential Batch Confounding**: FALSE\n- **Confirm Batch Confounding Authorization**: FALSE\n`;
    }

    if (rationale && !content.includes(rationale)) {
      content = content.replace(/(###\s*(?:3\.F|F|3\.D|D)\.?\s*Confounded Batch[^\n]*\n)/i, `$1${rationaleComment}`);
    }

    await fs.writeFile(expPath, content, "utf-8");
  }

  /**
   * Sets Section 3.C (or legacy 3.E) Missing Value Imputation Strategy and confirmation status.
   */
  public async setImputationStrategy(method?: string, confirmed: boolean = true): Promise<string> {
    await this.ensureExperimentDoc();
    const expPath = this.getExperimentPath();
    let content = await fs.readFile(expPath, "utf-8");

    const spec = await this.readSpec();
    const finalMethod = method && method.trim() ? method.trim() : spec.imputationMethod || "randomforest_grouped";
    const confirmStr = confirmed ? "TRUE" : "FALSE";

    if (/-\s*\*\*Imputation Method\*\*:/i.test(content)) {
      content = content.replace(/(-\s*\*\*Imputation Method\*\*:\s*)([^\n]*)/i, `$1${finalMethod}`);
    } else if (/###\s*(?:3\.C|C|3\.E|E)\.?\s*Missing Value Imputation Strategy/i.test(content)) {
      content = content.replace(
        /(###\s*(?:3\.C|C|3\.E|E)\.?\s*Missing Value Imputation Strategy[^\n]*\n)/i,
        `$1- **Imputation Method**: ${finalMethod}\n`
      );
    } else {
      content += `\n\n### C. Missing Value Imputation Strategy:\n- **Imputation Method**: ${finalMethod}\n- **Confirm Imputation Strategy**: ${confirmStr}\n`;
    }

    if (/-\s*\*\*Confirm Imputation Strategy\*\*:/i.test(content)) {
      content = content.replace(/(-\s*\*\*Confirm Imputation Strategy\*\*:\s*)(TRUE|FALSE)/i, `$1${confirmStr}`);
    } else {
      content = content.replace(
        /(-\s*\*\*Imputation Method\*\*:\s*[^\n]*\n)/i,
        `$1- **Confirm Imputation Strategy**: ${confirmStr}\n`
      );
    }

    await fs.writeFile(expPath, content, "utf-8");
    return finalMethod;
  }

  /**
   * Sets Section 3.B (or legacy 3.F) Quantitative Normalization Strategy (methods, optional subset_filter, and confirmation).
   */
  public async setNormalizationStrategy(
    methods?: string,
    subsetFilter?: string,
    confirmed: boolean = true
  ): Promise<{ methods: string; subsetFilter: string }> {
    await this.ensureExperimentDoc();
    const expPath = this.getExperimentPath();
    let content = await fs.readFile(expPath, "utf-8");

    const spec = await this.readSpec();
    let finalSubset = subsetFilter !== undefined && subsetFilter.trim() ? subsetFilter.trim() : spec.normalizationSubsetFilter || "NONE";
    let finalMethods = methods && methods.trim() ? methods.trim() : spec.normalizationMethods || "default";
    const confirmStr = confirmed ? "TRUE" : "FALSE";

    // If a sub-population filter is specified and methods is default, automatically set to linear models + svm
    if (finalSubset.toUpperCase() !== "NONE" && finalMethods.toLowerCase() === "default") {
      finalMethods = "scaled, median, linear, svm";
    }

    if (/-\s*\*\*Normalization Methods\*\*:/i.test(content)) {
      content = content.replace(/(-\s*\*\*Normalization Methods\*\*:\s*)([^\n]*)/i, `$1${finalMethods}`);
    } else if (/###\s*(?:3\.B|B|3\.F|F)\.?\s*Quantitative Normalization Strategy/i.test(content)) {
      content = content.replace(
        /(###\s*(?:3\.B|B|3\.F|F)\.?\s*Quantitative Normalization Strategy[^\n]*\n)/i,
        `$1- **Normalization Methods**: ${finalMethods}\n`
      );
    } else {
      content += `\n\n### B. Quantitative Normalization Strategy:\n- **Normalization Methods**: ${finalMethods}\n- **Normalization Subset Filter**: ${finalSubset}\n- **Confirm Normalization Strategy**: ${confirmStr}\n`;
    }

    if (/-\s*\*\*Normalization Subset Filter\*\*:/i.test(content)) {
      content = content.replace(/(-\s*\*\*Normalization Subset Filter\*\*:\s*)([^\n]*)/i, `$1${finalSubset}`);
    } else {
      content = content.replace(
        /(-\s*\*\*Normalization Methods\*\*:\s*[^\n]*\n)/i,
        `$1- **Normalization Subset Filter**: ${finalSubset}\n`
      );
    }

    if (/-\s*\*\*Confirm Normalization Strategy\*\*:/i.test(content)) {
      content = content.replace(/(-\s*\*\*Confirm Normalization Strategy\*\*:\s*)(TRUE|FALSE)/i, `$1${confirmStr}`);
    } else {
      content = content.replace(
        /(-\s*\*\*Normalization Subset Filter\*\*:\s*[^\n]*\n)/i,
        `$1- **Confirm Normalization Strategy**: ${confirmStr}\n`
      );
    }

    await fs.writeFile(expPath, content, "utf-8");
    return { methods: finalMethods, subsetFilter: finalSubset };
  }

  /**
   * Enables sample name reassignment in Section 3.D/3.B if a pooling map exists.
   */
  public async enableSampleReassignment(): Promise<void> {
    await this.setReassignSampleNames(true);
  }

  /**
   * Sets the boolean toggle for Reassign Sample Names According to Pooling Map in Section 3.D/3.B.
   */
  public async setReassignSampleNames(enabled: boolean): Promise<void> {
    await this.ensureExperimentDoc();
    const expPath = this.getExperimentPath();
    let content = await fs.readFile(expPath, "utf-8");
    const val = enabled ? "TRUE" : "FALSE";
    if (/-\s*\*\*Reassign Sample Names According to (?:Sample Group Renaming & )?Pooling Map\*\*:/i.test(content)) {
      content = content.replace(
        /(-\s*\*\*Reassign Sample Names According to (?:Sample Group Renaming & )?Pooling Map\*\*:\s*)(?:TRUE|FALSE)/i,
        `$1${val}`
      );
    } else {
      const existingTableRegex = /(^[ \t]*\|[ \t]*Raw Sample Group[ \t]*\|[ \t]*Cleaned Group Name[ \t]*\|[^\r\n]*(?:\r?\n[ \t]*\|[^\r\n]*)*)/im;
      if (existingTableRegex.test(content)) {
        content = content.replace(existingTableRegex, `$1\n\n- **Reassign Sample Names According to Pooling Map**: ${val}`);
      } else {
        const secRegex = /(###\s*(?:3\.D|D|3\.B|B)\.?\s*Sample Group Renaming[^\r\n]*\r?\n)/i;
        if (secRegex.test(content)) {
          content = content.replace(secRegex, `$1\n- **Reassign Sample Names According to Pooling Map**: ${val}\n`);
        }
      }
    }
    await fs.writeFile(expPath, content, "utf-8");
  }

  /**
   * Updates docs/experiment.md from a structured form payload and returns the updated spec + raw markdown.
   */
  public async updateFromForm(patch: Partial<ExperimentSpec>): Promise<{ spec: ExperimentSpec; raw: string }> {
    await this.ensureExperimentDoc();
    if (patch.analysisMode !== undefined && patch.analysisMode !== null) {
      await this.setAnalysisMode(patch.analysisMode);
    }
    if (patch.pathToDataFile !== undefined && patch.pathToDataFile !== null) {
      await this.setParameter("PATH_TO_DATA_FILE", patch.pathToDataFile);
    }
    if (patch.platform !== undefined && patch.platform !== null) {
      await this.setParameter("PLATFORM", patch.platform);
    }
    if (patch.analyte !== undefined && patch.analyte !== null) {
      await this.setParameter("ANALYTE", patch.analyte);
    }
    if (patch.description !== undefined && patch.description !== null) {
      await this.setDescription(patch.description);
    }
    if (patch.discoveredGroupsConfirmed !== undefined) {
      await this.setDiscoveredGroupsConfirmed(patch.discoveredGroupsConfirmed);
    }
    if (patch.normalizationConfirmed !== undefined || patch.normalizationMethods !== undefined || patch.normalizationSubsetFilter !== undefined) {
      const current = await this.readSpec();
      await this.setNormalizationStrategy(
        patch.normalizationMethods ?? current.normalizationMethods,
        patch.normalizationSubsetFilter ?? current.normalizationSubsetFilter,
        patch.normalizationConfirmed ?? current.normalizationConfirmed
      );
    }
    if (patch.imputationMethod !== undefined || patch.imputationConfirmed !== undefined) {
      const current = await this.readSpec();
      await this.setImputationStrategy(
        patch.imputationMethod ?? current.imputationMethod,
        patch.imputationConfirmed ?? current.imputationConfirmed
      );
    }
    if (patch.sampleRenamingMap !== undefined) {
      await this.setSampleRenamingMap(patch.sampleRenamingMap, patch.samplePoolingConfirmed);
    }
    if (patch.reassignSampleNames !== undefined) {
      await this.setReassignSampleNames(patch.reassignSampleNames);
    }
    if (patch.samplePoolingConfirmed !== undefined) {
      await this.setSamplePoolingConfirmed(patch.samplePoolingConfirmed);
    }
    if (patch.targetContrasts !== undefined || patch.contrastConfirmed !== undefined) {
      const current = await this.readSpec();
      await this.setTargetContrasts(
        patch.targetContrasts ?? current.targetContrasts,
        patch.contrastConfirmed ?? (patch.targetContrasts ? true : current.contrastConfirmed)
      );
    }
    if (patch.batchConfoundingDetected !== undefined) {
      await this.setBatchConfoundingDetected(patch.batchConfoundingDetected);
    }
    if (patch.batchConfoundingAuthorized !== undefined || patch.batchConfoundingConfirmed !== undefined) {
      await this.setBatchConfounding(
        patch.batchConfoundingAuthorized ?? false,
        patch.batchConfoundingDetected,
        patch.batchConfoundingConfirmed ?? patch.batchConfoundingAuthorized ?? true
      );
    }
    if (
      patch.annotationSource !== undefined ||
      patch.annotationFilePath !== undefined ||
      patch.annotationTaxonId !== undefined ||
      patch.annotationOntologies !== undefined ||
      patch.annotationValidationStatus !== undefined ||
      patch.annotationConfirmed !== undefined
    ) {
      const current = await this.readSpec();
      await this.setAnnotationStrategy(
        patch.annotationSource ?? current.annotationSource,
        patch.annotationFilePath ?? current.annotationFilePath,
        patch.annotationTaxonId ?? current.annotationTaxonId,
        patch.annotationOntologies ?? current.annotationOntologies,
        patch.annotationValidationStatus ?? current.annotationValidationStatus,
        patch.annotationConfirmed ?? current.annotationConfirmed
      );
    }
    const spec = await this.readSpec();
    const raw = await fs.readFile(this.getExperimentPath(), "utf-8");
    return { spec, raw };
  }

  public async setAnnotationStrategy(
    source?: string,
    filePath?: string,
    taxonId?: string,
    ontologies?: string,
    validationStatus?: string,
    confirmed?: boolean
  ): Promise<void> {
    await this.ensureExperimentDoc();
    const expPath = this.getExperimentPath();
    let content = await fs.readFile(expPath, "utf-8");

    const spec = await this.readSpec();
    const finalSource = source ?? spec.annotationSource ?? "uniprot";
    const finalFile = filePath ?? spec.annotationFilePath ?? "NONE";
    const finalTaxon = taxonId ?? spec.annotationTaxonId ?? "(Pending Phase 1 target organism identification)";
    const finalOnt = ontologies ?? spec.annotationOntologies ?? "biological_process, cellular_component, molecular_function, reactome_pathway";
    const finalStatus = validationStatus ?? spec.annotationValidationStatus ?? "PENDING";
    const finalConfirmed = confirmed !== undefined ? confirmed : spec.annotationConfirmed;
    const confirmStr = finalConfirmed ? "TRUE" : "FALSE";

    const sectionRegex = /#{2,4}\s*(?:3\.G|G)[\.\:\-]?\s*Functional Annotation Strategy[\s\S]*?(?=\n#{2,4}\s|\n##|$)/i;
    const sectionBody = `### G. Functional Annotation Strategy
<!-- Configures functional ontology annotation (GO terms, KEGG, Reactome) for pathway enrichment -->
- **Annotation Source**: ${finalSource}
- **Annotation File Path**: ${finalFile}
- **Taxon / Organism ID**: ${finalTaxon}
- **Annotation Ontologies**: ${finalOnt}
- **Annotation Validation Status**: ${finalStatus}
- **Confirm Functional Annotation Strategy**: ${confirmStr}`;

    if (sectionRegex.test(content)) {
      content = content.replace(sectionRegex, sectionBody);
    } else {
      content = content.trimEnd() + "\n\n" + sectionBody + "\n";
    }

    await fs.writeFile(expPath, content, "utf-8");
  }

  public async setAnnotationConfirmed(confirmed: boolean): Promise<void> {
    await this.ensureExperimentDoc();
    const expPath = this.getExperimentPath();
    let content = await fs.readFile(expPath, "utf-8");
    const confirmStr = confirmed ? "TRUE" : "FALSE";

    const lineRegex = /((?:-\s*|\*\s*)?\*{0,2}Confirm Functional Annotation Strategy\*{0,2}\s*:\s*)(?:TRUE|FALSE)/i;
    if (lineRegex.test(content)) {
      content = content.replace(lineRegex, `$1${confirmStr}`);
      await fs.writeFile(expPath, content, "utf-8");
    } else {
      await this.setAnnotationStrategy(undefined, undefined, undefined, undefined, undefined, confirmed);
    }
  }

  /**
   * Unified confirmation: confirms ALL Section 3 sub-tasks:
   * - 3.A Discovered Sample Groups
   * - 3.B Quantitative Normalization Strategy
   * - 3.C Missing Value Imputation Strategy
   * - 3.D Sample Group Renaming & Pooling Map (if mapped, enables reassignment)
   * - 3.E Target Contrasts
   * - 3.F Confounded Batch & Exploratory Comparison Gate (if detected)
   * - 3.G Functional Annotation Strategy
   */
  public async confirmContrastAndAuthorizeConfounding(contrasts?: string[]): Promise<string[]> {
    await this.ensureExperimentDoc();
    const spec = await this.readSpec();

    // Confirm 3.A Discovered Groups
    if (!spec.groupLabelsMapped && spec.analysisMode !== "cohort_coded_descriptive") {
      // Unmapped cohort codes require explicit DEVIATION_ACCEPTED descriptive mode before confirming
      await this.setAnalysisMode("cohort_coded_descriptive");
    }
    await this.setDiscoveredGroupsConfirmed(true);

    // Confirm 3.B Normalization
    await this.setNormalizationStrategy(undefined, undefined, true);

    // Confirm 3.C Imputation
    await this.setImputationStrategy(undefined, true);

    // Confirm 3.D Sample Pooling
    if (Object.keys(spec.sampleRenamingMap).length > 0) {
      await this.enableSampleReassignment();
    }
    await this.setSamplePoolingConfirmed(true);

    // Confirm 3.E Target Contrasts
    let finalContrasts = contrasts && contrasts.length > 0 ? contrasts : [];
    if (finalContrasts.length === 0) {
      if (spec.targetContrasts.length > 0) {
        finalContrasts = spec.targetContrasts;
      } else {
        const groups = this.getDiscoveredGroups(spec);
        if (groups.length >= 2) {
          finalContrasts = [`${groups[0]} vs ${groups[1]}`];
        }
      }
    }

    if (finalContrasts.length > 0) {
      await this.setTargetContrasts(finalContrasts, true);
    } else {
      await this.confirmExistingContrasts();
    }

    // Confirm 3.F Batch Confounding (authorize if detected or previously flagged)
    if (spec.batchConfoundingDetected || spec.batchConfoundingAuthorized) {
      await this.setBatchConfounding(true, true, true);
    }

    // Confirm 3.G Functional Annotation Strategy
    await this.setAnnotationConfirmed(true);

    return finalContrasts;
  }
}
