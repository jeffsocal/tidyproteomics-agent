import * as fsSync from "fs";
import * as path from "path";
import { loadRunTables } from "./rubric/tables";
import { runAllVerifiers } from "./rubric/verifiers";
import type { VerifierReport } from "../types/evaluation";

/**
 * Standalone CLI utility for Phase 12 (Integrity) and developers to run
 * data-grounded deterministic verification against docs/manuscript.md and data/*.tsv.
 *
 * Usage:
 *   npx tsx src/evaluation/check_integrity.ts [workspace_root] [--manuscript docs/manuscript.md]
 */

export interface IntegrityCheckOutput {
  timestamp: string;
  manuscriptFile: string;
  hasDefects: boolean;
  totalDefectCount: number;
  matrixStatus: "MATRIX_MATCHES_SPEC" | "REQUIRES_RERUN";
  stats: VerifierReport["stats"];
  defects: {
    methodMismatches: string[];
    directionErrors: string[];
    numericMismatches: string[];
    significanceOverclaims: string[];
    missingFigures: string[];
    ungroundedCitations: string[];
    candidateReliabilityMismatches: string[];
    repetitionWarning: string | null;
  };
  verifierScores: {
    numericFidelity: number | null;
    directionConsistency: number | null;
    significanceHonesty: number | null;
    countConsistency: number | null;
    figureIntegrity: number | null;
    citationIntegrity: number | null;
    candidateReliabilityConsistency?: number | null;
  };
}

export function canonicalizeImputationMethod(raw: string | undefined | null): string {
  if (!raw) return "unknown";
  const s = String(raw)
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/^[`'\"]+|[`'\"]+$/g, "")
    .trim()
    .toLowerCase();
  if (!s) return "unknown";
  if (["none", "bypass", "unimputed", "none (unimputed)", "false"].includes(s)) return "none";
  if (
    ["min_column", "column_min", "lod_column"].includes(s) ||
    ((s.includes("base::min") || /\bmin\b/.test(s)) && s.includes("column"))
  ) {
    return "min_column";
  }
  if (
    ["min_row_grouped", "row_min_grouped"].includes(s) ||
    ((s.includes("base::min") || /\bmin\b/.test(s)) && s.includes("row"))
  ) {
    return "min_row_grouped";
  }
  if (["randomforest", "randomforest_grouped", "rf"].includes(s) || s.includes("randomforest")) {
    return "randomforest_grouped";
  }
  return s;
}

export function verifyWorkspaceMethodIdentity(absRoot: string): {
  methodMismatches: string[];
  specImputeRaw: string;
  specImputeCanon: string;
  executedImputeRaw: string;
  executedImputeCanon: string;
} {
  const methodMismatches: string[] = [];
  let specImputeRaw = "";
  let specImputeCanon = "unknown";
  let specConfirmed = false;
  let specNormRaw = "";

  const expPath = path.join(absRoot, "docs", "experiment.md");
  if (fsSync.existsSync(expPath)) {
    try {
      const expTxt = fsSync.readFileSync(expPath, "utf-8");
      const impMatch = expTxt.match(/-\s*\*\*Imputation Method\*\*:\s*([^\n\r]+)/i);
      if (impMatch) {
        specImputeRaw = impMatch[1].replace(/<!--[\s\S]*?-->/g, "").trim();
        specImputeCanon = canonicalizeImputationMethod(specImputeRaw);
      }
      const confMatch = expTxt.match(/-\s*\*\*Confirm Imputation Strategy\*\*:\s*([^\n\r]+)/i);
      if (confMatch) {
        specConfirmed = /^true$/i.test(confMatch[1].replace(/<!--[\s\S]*?-->/g, "").trim());
      }
      const normMatch = expTxt.match(/-\s*\*\*Normalization Methods\*\*:\s*([^\n\r]+)/i);
      if (normMatch) {
        specNormRaw = normMatch[1].replace(/<!--[\s\S]*?-->/g, "").trim().toLowerCase();
      }
    } catch {
      // ignore
    }
  }

  let executedImputeRaw = "";
  let executedImputeCanon = "unknown";

  // 1. Check code/03_impute.R for last impute(...) call
  const code03Path = path.join(absRoot, "code", "03_impute.R");
  if (fsSync.existsSync(code03Path)) {
    try {
      const codeTxt = fsSync.readFileSync(code03Path, "utf-8");
      const matches = [...codeTxt.matchAll(/\bimpute\(([^)]+)\)/gi)];
      if (matches.length > 0) {
        executedImputeRaw = matches[matches.length - 1][1].trim();
        executedImputeCanon = canonicalizeImputationMethod(executedImputeRaw);
      }
    } catch {
      // ignore
    }
  }

  // 2. Check docs/data.md operations history
  const dataDocPath = path.join(absRoot, "docs", "data.md");
  if (fsSync.existsSync(dataDocPath)) {
    try {
      const dataDocTxt = fsSync.readFileSync(dataDocPath, "utf-8");
      const impOps = [...dataDocTxt.matchAll(/-\s*Missing values imputed[^\n\r]*/gi)];
      if (impOps.length > 0) {
        const lastOp = impOps[impOps.length - 1][0].trim();
        const opCanon = canonicalizeImputationMethod(lastOp);
        if (opCanon !== "unknown") {
          executedImputeRaw = lastOp;
          executedImputeCanon = opCanon;
        }
      }
      if (specNormRaw && !["default", "all"].includes(specNormRaw)) {
        const activeAssayMatch = dataDocTxt.match(/-\s*\*\*Active Quantitative Assay\*\*:\s*`?([a-z0-9_]+)`?/i);
        if (activeAssayMatch) {
          const activeAssay = activeAssayMatch[1].toLowerCase();
          const allowedNorms = specNormRaw.split(/[,;\s]+/).map((s) => s.trim()).filter(Boolean);
          if (activeAssay !== "raw" && allowedNorms.length > 0 && !allowedNorms.includes(activeAssay)) {
            methodMismatches.push(
              `NORMALIZATION_MISMATCH [REQUIRES_RERUN]: docs/experiment.md Section 3.B specifies Normalization Methods '${specNormRaw}', but Active Quantitative Assay in docs/data.md is '${activeAssay}'.`
            );
          }
        }
      }
    } catch {
      // ignore
    }
  }

  // 3. Check data/manuscript_digest.json if still unknown
  if (executedImputeCanon === "unknown") {
    const digestPath = path.join(absRoot, "data", "manuscript_digest.json");
    if (fsSync.existsSync(digestPath)) {
      try {
        const digest = JSON.parse(fsSync.readFileSync(digestPath, "utf-8"));
        if (digest?.imputation_method) {
          executedImputeRaw = String(digest.imputation_method);
          executedImputeCanon = canonicalizeImputationMethod(executedImputeRaw);
        }
      } catch {
        // ignore
      }
    }
  }

  if (
    (specConfirmed || specImputeCanon !== "unknown") &&
    specImputeCanon !== "unknown" &&
    executedImputeCanon !== "unknown" &&
    specImputeCanon !== executedImputeCanon
  ) {
    methodMismatches.push(
      `IMPUTATION_METHOD_MISMATCH [REQUIRES_RERUN]: docs/experiment.md Section 3.C specifies Imputation Method '${specImputeRaw}' (canonical: '${specImputeCanon}'), but operations history / code/03_impute.R executed '${executedImputeRaw}' (canonical: '${executedImputeCanon}'). You MUST re-run tpa_impute(method = '${specImputeRaw}'), tpa_expression(), tpa_batch_analysis(type = 'expressions'), and tpa_export_state() to repair the quantitative matrix before completing Phase 12; a prose disclosure in Methods does NOT satisfy this gate.`
    );
  }

  return {
    methodMismatches,
    specImputeRaw,
    specImputeCanon,
    executedImputeRaw,
    executedImputeCanon,
  };
}

export function runIntegrityCheck(
  workspaceRoot: string = process.cwd(),
  manuscriptRelPath: string = "docs/manuscript.md"
): IntegrityCheckOutput {
  const absRoot = path.resolve(workspaceRoot);
  const manuscriptPath = path.isAbsolute(manuscriptRelPath)
    ? manuscriptRelPath
    : path.join(absRoot, manuscriptRelPath);

  if (!fsSync.existsSync(manuscriptPath)) {
    throw new Error(`Manuscript file not found at: ${manuscriptPath}`);
  }

  const manuscript = fsSync.readFileSync(manuscriptPath, "utf-8");
  const tables = loadRunTables(absRoot);
  const report = runAllVerifiers(manuscript, absRoot, tables);

  const directionErrors = report.directionConsistency.details || [];
  const numericMismatches = report.numericFidelity.details || [];
  const significanceOverclaims = report.significanceHonesty.details || [];
  const missingFigures = report.figureIntegrity.details || [];
  const ungroundedCitations = report.citationIntegrity.details || [];
  const candidateReliabilityMismatches = report.candidateReliabilityConsistency?.details || [];
  const { methodMismatches } = verifyWorkspaceMethodIdentity(absRoot);
  const matrixStatus: "MATRIX_MATCHES_SPEC" | "REQUIRES_RERUN" =
    methodMismatches.length > 0 ? "REQUIRES_RERUN" : "MATRIX_MATCHES_SPEC";

  const repRatio = report.stats.repetitionRatio ?? 0;
  const repetitionWarning =
    repRatio > 0.2
      ? `High repetition: ${(repRatio * 100).toFixed(1)}% of 8-word shingles are repeated.`
      : null;

  const totalDefectCount =
    methodMismatches.length +
    directionErrors.length +
    numericMismatches.length +
    significanceOverclaims.length +
    missingFigures.length +
    ungroundedCitations.length +
    candidateReliabilityMismatches.length +
    (repetitionWarning ? 1 : 0);

  const hasDefects = totalDefectCount > 0;

  const output: IntegrityCheckOutput = {
    timestamp: new Date().toISOString(),
    manuscriptFile: path.relative(absRoot, manuscriptPath).replace(/\\/g, "/"),
    hasDefects,
    totalDefectCount,
    matrixStatus,
    stats: report.stats,
    defects: {
      methodMismatches,
      directionErrors,
      numericMismatches,
      significanceOverclaims,
      missingFigures,
      ungroundedCitations,
      candidateReliabilityMismatches,
      repetitionWarning,
    },
    verifierScores: {
      numericFidelity: report.numericFidelity.score,
      directionConsistency: report.directionConsistency.score,
      significanceHonesty: report.significanceHonesty.score,
      countConsistency: report.countConsistency.score,
      figureIntegrity: report.figureIntegrity.score,
      citationIntegrity: report.citationIntegrity.score,
      candidateReliabilityConsistency: report.candidateReliabilityConsistency?.score ?? null,
    },
  };

  // Persist to data/integrity_defects.json if data/ exists
  const dataDir = path.join(absRoot, "data");
  if (fsSync.existsSync(dataDir)) {
    fsSync.writeFileSync(
      path.join(dataDir, "integrity_defects.json"),
      JSON.stringify(output, null, 2),
      "utf-8"
    );
  }

  return output;
}

// CLI Execution entrypoint
if (require.main === module || process.argv[1]?.endsWith("check_integrity.ts")) {
  const args = process.argv.slice(2);
  let workspaceRoot = process.cwd();
  let manuscriptRelPath = "docs/manuscript.md";

  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === "--manuscript" && args[i + 1]) {
      manuscriptRelPath = args[++i];
    } else if (!a.startsWith("-")) {
      workspaceRoot = a;
    }
  }

  try {
    const res = runIntegrityCheck(workspaceRoot, manuscriptRelPath);
    console.log(`\n============================================================`);
    console.log(`  TidyProteomics Deterministic Integrity Verifier`);
    console.log(`============================================================`);
    console.log(`Target Manuscript: ${res.manuscriptFile}`);
    console.log(
      `Claims Verified: ${res.stats.claimsMatched}/${res.stats.claimsExtracted} matched (${
        res.verifierScores.numericFidelity !== null
          ? (res.verifierScores.numericFidelity * 100).toFixed(0) + "%"
          : "N/A"
      })`
    );
    console.log(`Matrix Identity Status: ${res.matrixStatus}`);
    console.log(`Total Defects Found: ${res.totalDefectCount}`);

    if (res.defects.methodMismatches.length > 0) {
      console.log(`\n🚨 METHOD MISMATCHES / MATRIX INTEGRITY (${res.defects.methodMismatches.length}):`);
      res.defects.methodMismatches.forEach((d) => console.log(`   • ${d}`));
    }

    if (res.defects.directionErrors.length > 0) {
      console.log(`\n❌ DIRECTION ERRORS (${res.defects.directionErrors.length}):`);
      res.defects.directionErrors.forEach((d) => console.log(`   • ${d}`));
    }

    if (res.defects.numericMismatches.length > 0) {
      console.log(`\n❌ NUMERIC MISMATCHES (${res.defects.numericMismatches.length}):`);
      res.defects.numericMismatches.forEach((d) => console.log(`   • ${d}`));
    }

    if (res.defects.significanceOverclaims.length > 0) {
      console.log(`\n⚠️ SIGNIFICANCE OVERCLAIMS (${res.defects.significanceOverclaims.length}):`);
      res.defects.significanceOverclaims.forEach((d) => console.log(`   • ${d}`));
    }

    if (res.defects.missingFigures.length > 0) {
      console.log(`\n⚠️ MISSING FIGURES (${res.defects.missingFigures.length}):`);
      res.defects.missingFigures.forEach((d) => console.log(`   • ${d}`));
    }

    if (res.defects.ungroundedCitations.length > 0) {
      console.log(`\n⚠️ UNGROUNDED CITATIONS (${res.defects.ungroundedCitations.length}):`);
      res.defects.ungroundedCitations.forEach((d) => console.log(`   • ${d}`));
    }

    if (res.defects.candidateReliabilityMismatches.length > 0) {
      console.log(`\n❌ CANDIDATE RELIABILITY CONFLICTS (${res.defects.candidateReliabilityMismatches.length}):`);
      res.defects.candidateReliabilityMismatches.forEach((d) => console.log(`   • ${d}`));
    }

    if (res.defects.repetitionWarning) {
      console.log(`\n⚠️ REPETITION: ${res.defects.repetitionWarning}`);
    }

    if (!res.hasDefects) {
      console.log(`\n✓ ZERO DEFECTS DETECTED. Manuscript is empirically consistent.`);
    }

    console.log(`\nDefect report saved to data/integrity_defects.json\n`);
  } catch (err: any) {
    console.error("Integrity check error:", err.message);
    process.exit(1);
  }
}

