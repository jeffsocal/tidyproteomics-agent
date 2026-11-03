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
  stats: VerifierReport["stats"];
  defects: {
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

  const repRatio = report.stats.repetitionRatio ?? 0;
  const repetitionWarning =
    repRatio > 0.2
      ? `High repetition: ${(repRatio * 100).toFixed(1)}% of 8-word shingles are repeated.`
      : null;

  const totalDefectCount =
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
    stats: report.stats,
    defects: {
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
    console.log(`Total Defects Found: ${res.totalDefectCount}`);

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

