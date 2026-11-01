import * as fsSync from "fs";
import * as path from "path";
import { loadRunTables } from "../rubric/tables";
import {
  extractClaims,
  verifyNumericFidelity,
  verifyDirectionConsistency,
  verifySignificanceHonesty,
  verifyFigureIntegrity,
  verifyCitationIntegrity,
  verifySectionStructure,
  verifyMethodsReproducibility,
  measureRepetition,
} from "../rubric/verifiers";
import { applyVerifierCaps, computeAnalyticalFidelityScore } from "../rubric/scorer";
import type { ManuscriptDimension, VerifierReport } from "../../types/evaluation";

/**
 * Adversarial and unit tests for the TidyProteomics Rubric v2.0.
 * Run with: npx tsx src/evaluation/__tests__/rubric.test.ts
 */

let failures = 0;
let passes = 0;

function assert(condition: boolean, msg: string) {
  if (!condition) {
    console.error(`  FAIL: ${msg}`);
    failures++;
  } else {
    console.log(`  PASS: ${msg}`);
    passes++;
  }
}

async function runTests() {
  console.log("\n============================================================");
  console.log("  Testing TidyProteomics Benchmark Rubric v2.0");
  console.log("============================================================\n");

  const runRoot = path.resolve("testrun/evaluations/06_anthropic_claude-sonnet-5_5_iter1");
  if (!fsSync.existsSync(runRoot)) {
    console.warn(`Testrun fixture directory not found at ${runRoot}; skipping fixture tests.`);
    return;
  }

  const tables = loadRunTables(runRoot);
  const origManuscript = fsSync.readFileSync(path.join(runRoot, "docs", "manuscript.md"), "utf-8");

  // Test 1: Ground truth table loading
  console.log("[Test 1: Table Loading]");
  assert(tables.expression.length > 1000, `Loaded ${tables.expression.length} expression rows`);
  assert(tables.enrichment.length > 50, `Loaded ${tables.enrichment.length} enrichment rows`);
  assert(tables.bySymbol.has("VCP"), "bySymbol index contains VCP");
  assert(tables.bySymbol.has("HERPUD1"), "bySymbol index contains HERPUD1");

  // Test 2: Extraction and baseline fidelity
  console.log("\n[Test 2: Claim Extraction and Baseline Fidelity]");
  const baseClaims = extractClaims(origManuscript, tables);
  assert(baseClaims.length >= 20, `Extracted ${baseClaims.length} quantitative claims from manuscript`);
  const baseFidelity = verifyNumericFidelity(baseClaims, tables);
  assert((baseFidelity.result.score ?? 0) >= 0.9, `Baseline numeric fidelity is high (${baseFidelity.result.score})`);

  // Test 3: Adversarial test - Corrupted fold-changes
  console.log("\n[Test 3: Adversarial - Corrupted Numbers]");
  const corruptedManuscript = origManuscript
    .replace("5.4145", "9.9999")
    .replace("4.5470", "1.1111")
    .replace("-2.3250", "-8.8888")
    .replace("3.5706", "0.0123");
  const corruptedClaims = extractClaims(corruptedManuscript, tables);
  const corruptedFidelity = verifyNumericFidelity(corruptedClaims, tables);
  assert(
    corruptedFidelity.stats.mismatched >= 4,
    `Corrupted numbers were correctly caught as mismatches (${corruptedFidelity.stats.mismatched} mismatches)`
  );

  // Test 4: Adversarial test - Sign flip (direction error)
  console.log("\n[Test 4: Adversarial - Direction Sign Flip]");
  const flippedManuscript = origManuscript.replace(
    /VCP fell about five-fold \(log2FC -2\.3250/g,
    "VCP increased dramatically (log2FC +2.3250"
  );
  const flippedClaims = extractClaims(flippedManuscript, tables);
  const flippedFid = verifyNumericFidelity(flippedClaims, tables);
  const dirReport = verifyDirectionConsistency(flippedManuscript, tables, flippedFid.stats.flipped);
  assert(flippedFid.stats.flipped >= 1, `Sign-flipped log2FC detected as flipped (${flippedFid.stats.flipped})`);
  assert(dirReport.details.length >= 1, "Direction report flags the sign discrepancy in details");

  // Test 5: Adversarial test - Unhedged significance overclaim
  console.log("\n[Test 5: Adversarial - Unhedged Significance Overclaim]");
  // Pick an insignificant protein from tables
  const nonSigRow = tables.expression.find((r) => r.q !== null && r.q > 0.4 && r.gene && r.gene.length > 2);
  if (nonSigRow) {
    const overclaimMs = origManuscript + `\n\nImportantly, ${nonSigRow.gene} was significantly altered in response to knockout.\n`;
    const sigCheck = verifySignificanceHonesty(overclaimMs, tables);
    assert(sigCheck.overclaims >= 1, `Caught overclaim for insignificant gene ${nonSigRow.gene} (q = ${nonSigRow.q})`);
  }

  // Test 6: Adversarial test - Invented fake PMIDs
  console.log("\n[Test 6: Adversarial - Fake PMID Injection]");
  const fakePmidMs = origManuscript + "\n\nAs previously shown (PMID 999999999 and PMID 888888888).\n";
  const citeCheck = verifyCitationIntegrity(fakePmidMs, runRoot);
  assert(
    (citeCheck.score ?? 1) < 1,
    `Fake PMIDs caused citation score to decrease (${citeCheck.score})`
  );
  assert(
    citeCheck.details.some((d) => d.includes("999999999")),
    "Detail specifies ungrounded PMID 999999999"
  );

  // Test 7: Adversarial test - Missing figure reference
  console.log("\n[Test 7: Adversarial - Non-existent Figure Reference]");
  const fakeFigMs = origManuscript + "\n\n![Fake Plot](../data/non_existent_plot_xyz.png)\n";
  const figCheck = verifyFigureIntegrity(fakeFigMs, runRoot);
  assert(figCheck.missing >= 1, `Non-existent figure detected (${figCheck.missing} missing)`);

  // Test 8: Verifier Caps Enforced
  console.log("\n[Test 8: Verifier Caps]");
  const mockReport: VerifierReport = {
    numericFidelity: { score: 0.65, passed: false, summary: "Low fidelity", details: [] },
    directionConsistency: { score: 0.5, passed: false, summary: "Direction error", details: [] },
    significanceHonesty: { score: 0.4, passed: false, summary: "Overclaims", details: [] },
    countConsistency: { score: 0.8, passed: true, summary: "Counts ok", details: [] },
    figureIntegrity: { score: 0.9, passed: true, summary: "Figures ok", details: [] },
    citationIntegrity: { score: 0.8, passed: true, summary: "Cites ok", details: [] },
    sectionStructure: { score: 1.0, passed: true, summary: "Structure ok", details: [] },
    methodsReproducibility: { score: 0.9, passed: true, summary: "Methods ok", details: [] },
    repetition: { score: 0.9, passed: true, summary: "Repetition ok", details: [] },
    stats: {
      claimsExtracted: 20,
      claimsMatched: 13,
      claimsMismatched: 7,
      claimsNotFound: 0,
      directionErrors: 2,
      overclaims: 4,
      missingFigures: 0,
      repetitionRatio: 0.1,
      abstractWords: 200,
      expressionRows: 5000,
      enrichmentRows: 100,
      wordCount: 3000,
    },
  };
  const rawScores: Record<ManuscriptDimension, number> = {
    scientificEvaluation: 9.5,
    bioinformaticsIntelligence: 9.0,
    insights: 8.5,
    clarity: 8.0,
    actionableInsights: 8.5,
  };
  const { scores: capped, caps } = applyVerifierCaps(rawScores, mockReport);
  assert(capped.scientificEvaluation <= 3.0, `Scientific evaluation capped to <= 3.0 (got ${capped.scientificEvaluation})`);
  assert(capped.bioinformaticsIntelligence <= 5.0, `Bioinformatics capped to <= 5.0 due to direction error (got ${capped.bioinformaticsIntelligence})`);
  assert(caps.length >= 2, `Applied ${caps.length} caps`);

  // Test 9: Analytical Fidelity Score calculation
  console.log("\n[Test 9: Analytical Fidelity Composite]");
  const fidelityScore = computeAnalyticalFidelityScore(mockReport);
  assert(fidelityScore < 70, `Analytical fidelity score correctly reflects defects (${fidelityScore}/100)`);

  console.log("\n============================================================");
  console.log(`Results: ${passes} passed, ${failures} failed.`);
  console.log("============================================================\n");

  if (failures > 0) process.exit(1);
}

runTests().catch((e) => {
  console.error("Test runner error:", e);
  process.exit(1);
});

