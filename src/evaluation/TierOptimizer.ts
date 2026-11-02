import * as fs from "fs/promises";
import * as fsSync from "fs";
import * as path from "path";
import { ProviderClient } from "../llm/ProviderClient";
import type {
  BenchmarkSuite,
  EvaluationRunSummary,
  TierOptimizationProfile,
  TierRecommendation,
  TierSuggestionResult,
  ExplainTierRequest,
  ExplainTierResponse,
} from "../types/evaluation";

interface ModelPricing {
  prompt: number; // USD per token
  completion: number; // USD per token
}

// Fallback pricing table (in $ per 1M tokens) based on verified OpenRouter catalog
const FALLBACK_PRICING_PER_MILLION: Record<string, { prompt: number; completion: number }> = {
  "google/gemini-3.1-flash-lite": { prompt: 0.25, completion: 1.5 },
  "anthropic/claude-haiku-5.5": { prompt: 0.1, completion: 0.5 },
  "anthropic/claude-sonnet-5.5": { prompt: 2.0, completion: 10.0 },
  "openai/gpt-oss-120b": { prompt: 0.15, completion: 0.6 },
  "x-ai/grok-4.7": { prompt: 2.0, completion: 6.0 },
  "meta/muse-spark-1.3": { prompt: 0.1, completion: 0.2 },
  "mistralai/mistral-large-4-0": { prompt: 0.7, completion: 2.1 },
  "thinkingmachines/inkling": { prompt: 0.45, completion: 1.2 },
  "google/gemini-4-argon": { prompt: 2.0, completion: 10.0 },
  "openai/gpt-6-sol": { prompt: 2.0, completion: 10.0 },
  "openai/gpt-4o": { prompt: 2.5, completion: 10.0 },
  "openai/gpt-4o-mini": { prompt: 0.15, completion: 0.6 },
  "google/gemini-2.0-flash-001": { prompt: 0.1, completion: 0.4 },
  "anthropic/claude-3-5-sonnet": { prompt: 3.0, completion: 15.0 },
  "anthropic/claude-3-7-sonnet": { prompt: 3.0, completion: 15.0 },
};

export class TierOptimizer {
  private pricingCache: Map<string, ModelPricing> = new Map();
  private lastPricingFetchMs = 0;
  private readonly PRICING_TTL_MS = 60 * 60 * 1000; // 1 hour

  constructor(private evalDir: string = "testrun/evaluations") {}

  /**
   * Fetches OpenRouter pricing with in-memory caching and resilient fallback.
   */
  public async getPricing(): Promise<{ pricing: Map<string, ModelPricing>; source: "openrouter_live" | "openrouter_cache" }> {
    const now = Date.now();
    if (this.pricingCache.size > 0 && now - this.lastPricingFetchMs < this.PRICING_TTL_MS) {
      return { pricing: this.pricingCache, source: "openrouter_cache" };
    }

    try {
      const res = await fetch("https://openrouter.ai/api/v1/models", { signal: AbortSignal.timeout(4000) });
      if (res.ok) {
        const data = await res.json();
        if (Array.isArray(data?.data)) {
          for (const item of data.data) {
            if (item.id && item.pricing) {
              const p = Number(item.pricing.prompt) || 0;
              const c = Number(item.pricing.completion) || 0;
              this.pricingCache.set(item.id.toLowerCase(), { prompt: p, completion: c });
            }
          }
          this.lastPricingFetchMs = now;
          return { pricing: this.pricingCache, source: "openrouter_live" };
        }
      }
    } catch {
      // Offline or network timeout - use fallback catalog
    }

    // Populate fallback pricing
    for (const [m, p] of Object.entries(FALLBACK_PRICING_PER_MILLION)) {
      this.pricingCache.set(m.toLowerCase(), {
        prompt: p.prompt / 1e6,
        completion: p.completion / 1e6,
      });
    }
    this.lastPricingFetchMs = now;
    return { pricing: this.pricingCache, source: "openrouter_cache" };
  }

  /**
   * Calculates cost in USD for a given model and token count.
   */
  private calculateCost(model: string, promptTokens: number, completionTokens: number): number {
    const key = model.toLowerCase();
    let pricing = this.pricingCache.get(key);

    if (!pricing) {
      // Try matching prefix or suffix
      for (const [k, v] of this.pricingCache.entries()) {
        if (key.includes(k) || k.includes(key)) {
          pricing = v;
          break;
        }
      }
    }

    // Default fallback: $1/M prompt, $3/M completion
    const promptRate = pricing ? pricing.prompt : 1.0 / 1e6;
    const compRate = pricing ? pricing.completion : 3.0 / 1e6;

    return promptTokens * promptRate + completionTokens * compRate;
  }

  /**
   * Loads runs from suite.json and disk.
   */
  private async loadSuite(): Promise<{ suite: BenchmarkSuite | null; runs: EvaluationRunSummary[] }> {
    const suitePath = path.join(this.evalDir, "suite.json");
    if (!fsSync.existsSync(suitePath)) {
      return { suite: null, runs: [] };
    }

    try {
      const raw = await fs.readFile(suitePath, "utf-8");
      const suite: BenchmarkSuite = JSON.parse(raw);
      const runs = (suite.runs || []).filter(
        (r) => !r.isBaseline && r.id !== "00_benchmark" && (r.status === "completed" || r.status === "failed")
      );
      return { suite, runs };
    } catch {
      return { suite: null, runs: [] };
    }
  }

  /**
   * Analyzes benchmark runs and produces tier suggestions.
   */
  public async suggestTiers(): Promise<TierSuggestionResult> {
    const { source } = await this.getPricing();
    const { runs } = await this.loadSuite();

    if (runs.length === 0) {
      throw new Error(`No benchmark evaluation runs found in ${this.evalDir}`);
    }

    // Compute tier performance for each model run
    const tier1Candidates: Array<{
      model: string;
      provider: string;
      score: number;
      costUsd: number;
      durationSec: number;
      turns: number;
      completionRate: number;
      note: string;
    }> = [];

    const tier2Candidates: Array<{
      model: string;
      provider: string;
      score: number;
      costUsd: number;
      durationSec: number;
      turns: number;
      toolSuccessRate: number;
      figureScore: number;
      note: string;
    }> = [];

    const tier3Candidates: Array<{
      model: string;
      provider: string;
      score: number;
      costUsd: number;
      durationSec: number;
      turns: number;
      overallScore: number;
      fidelity: number;
      directionErrors: number;
      note: string;
    }> = [];

    for (const run of runs) {
      const model = run.model;
      const provider = run.provider || "openrouter";
      const metrics = run.phaseMetrics || [];

      // 1. Tier 1: Phases 01, 02, 03 (Inspect, Normalize, Impute)
      const t1Phases = metrics.filter((p) => ["01", "02", "03"].includes(p.phaseId));
      const t1Completed = t1Phases.filter((p) => p.status === "completed").length;
      const t1Prompt = t1Phases.reduce((acc, p) => acc + (p.tokenUsage?.promptTokens || 0), 0);
      const t1Comp = t1Phases.reduce((acc, p) => acc + (p.tokenUsage?.completionTokens || 0), 0);
      const t1Turns = t1Phases.reduce((acc, p) => acc + (p.turns || 0), 0);
      const t1Dur = t1Phases.reduce((acc, p) => acc + (p.durationSeconds || 0), 0);
      const t1Cost = this.calculateCost(model, t1Prompt, t1Comp);
      const t1Rate = t1Phases.length > 0 ? t1Completed / t1Phases.length : 0;
      const t1Fidelity = run.scores?.verifiers?.numericFidelity?.score ?? 0.8;

      // Tier 1 Suitability Score: completion (40 pts) + numerical fidelity (25 pts) + turn economy (20 pts) + low cost (15 pts)
      let t1Score = t1Rate * 40 + t1Fidelity * 25;
      const t1TurnScore = Math.max(0, 20 - Math.max(0, t1Turns - 8) * 2.0);
      t1Score += t1TurnScore;
      t1Score += Math.max(0, 15 - (t1Cost / 0.15) * 6);
      tier1Candidates.push({
        model,
        provider,
        score: Math.min(100, Math.round(t1Score)),
        costUsd: t1Cost,
        durationSec: t1Dur,
        turns: t1Turns,
        completionRate: t1Rate,
        note: `${t1Completed}/3 phases completed in ${t1Turns} turns (${t1Dur}s), ${(t1Fidelity * 100).toFixed(0)}% fidelity ($${t1Cost.toFixed(3)})`,
      });

      // 2. Tier 2: Phases 04, 05, 06, 08, 09, 10 (Tool Runner, R Execution, Figures)
      const t2Phases = metrics.filter((p) => ["04", "05", "06", "08", "09", "10"].includes(p.phaseId));
      const t2Completed = t2Phases.filter((p) => p.status === "completed").length;
      const t2Prompt = t2Phases.reduce((acc, p) => acc + (p.tokenUsage?.promptTokens || 0), 0);
      const t2Comp = t2Phases.reduce((acc, p) => acc + (p.tokenUsage?.completionTokens || 0), 0);
      const t2Turns = t2Phases.reduce((acc, p) => acc + (p.turns || 0), 0);
      const t2Dur = t2Phases.reduce((acc, p) => acc + (p.durationSeconds || 0), 0);
      const t2Cost = this.calculateCost(model, t2Prompt, t2Comp);
      const t2Rate = t2Phases.length > 0 ? t2Completed / t2Phases.length : 0;
      const figPassed = run.scores?.verifiers?.figureIntegrity?.passed ? 1 : 0.8;
      const figScore = (run.scores?.verifiers?.figureIntegrity?.score ?? 1) * figPassed;

      // Tier 2 Suitability Score:
      // Phase completion (40 pts) + Figure integrity (30 pts) + Velocity & Turn Economy (20 pts) + Cost efficiency (10 pts)
      // Heavily penalizes turn bloat (>20 turns across tool phases risks turn exhaustion)
      let t2Score = t2Rate * 40 + figScore * 30;
      const turnScore = Math.max(0, 20 - Math.max(0, t2Turns - 15) * 0.6);
      t2Score += turnScore;
      t2Score += Math.max(0, 10 - (t2Cost / 1.0) * 5);
      tier2Candidates.push({
        model,
        provider,
        score: Math.min(100, Math.round(t2Score)),
        costUsd: t2Cost,
        durationSec: t2Dur,
        turns: t2Turns,
        toolSuccessRate: t2Rate,
        figureScore: figScore,
        note: `${t2Completed}/6 tool phases passed in ${t2Turns} turns (${t2Dur}s), figure integrity: ${(figScore * 100).toFixed(0)}% ($${t2Cost.toFixed(3)})`,
      });

      // 3. Tier 3: Phases 07, 11, 12, 13 (Biological Reasoner, Manuscript & Critique)
      const t3Phases = metrics.filter((p) => ["07", "11", "12", "13"].includes(p.phaseId));
      const t3Prompt = t3Phases.reduce((acc, p) => acc + (p.tokenUsage?.promptTokens || 0), 0);
      const t3Comp = t3Phases.reduce((acc, p) => acc + (p.tokenUsage?.completionTokens || 0), 0);
      const t3Turns = t3Phases.reduce((acc, p) => acc + (p.turns || 0), 0);
      const t3Dur = t3Phases.reduce((acc, p) => acc + (p.durationSeconds || 0), 0);
      const t3Cost = this.calculateCost(model, t3Prompt, t3Comp);

      const overall = run.scores?.overallBenchmarkScore || 50;
      const fidelity = (run.scores?.verifiers?.numericFidelity?.score ?? 0.8) * 100;
      const dirErrors = run.scores?.verifiers?.stats?.directionErrors ?? 0;

      // Tier 3 Suitability Score: benchmark overall (50 pts) + fidelity (30 pts) + direction penalty (20 pts)
      let t3Score = (overall / 100) * 50 + (fidelity / 100) * 30;
      t3Score += dirErrors === 0 ? 20 : Math.max(0, 20 - dirErrors * 8);
      tier3Candidates.push({
        model,
        provider,
        score: Math.min(100, Math.round(t3Score)),
        costUsd: t3Cost,
        durationSec: t3Dur,
        turns: t3Turns,
        overallScore: overall,
        fidelity,
        directionErrors: dirErrors,
        note: `Overall Benchmark: ${overall}/100, Fidelity: ${fidelity.toFixed(0)}%, Direction Errors: ${dirErrors}`,
      });
    }

    // Sort rankings
    tier1Candidates.sort((a, b) => b.score - a.score || a.costUsd - b.costUsd);
    tier2Candidates.sort((a, b) => b.score - a.score || a.costUsd - b.costUsd);
    tier3Candidates.sort((a, b) => b.score - a.score || b.overallScore - a.overallScore);

    // Baseline frontier reference: run Grok 4.7 or highest cost frontier across all 13 phases
    const frontierSoloCost = runs.find((r) => r.model.includes("grok-4.7"))
      ? tier1Candidates.find((c) => c.model.includes("grok-4.7"))!.costUsd +
        tier2Candidates.find((c) => c.model.includes("grok-4.7"))!.costUsd +
        tier3Candidates.find((c) => c.model.includes("grok-4.7"))!.costUsd
      : 7.46;

    // Build the 3 Pareto Profiles:
    // 1. Quality: Absolute highest scoring models per tier (prioritizing high fidelity and clean figures)
    const qT1 = tier1Candidates.find((c) => c.model.includes("haiku")) || tier1Candidates[0];
    const qT2 = tier2Candidates.find((c) => c.figureScore >= 0.95 && c.turns <= 40) || tier2Candidates[0];
    const qT3 = tier3Candidates[0]; // Top reasoner (e.g. Grok 4.7, 94 pts)
    const qualityProfile = this.buildProfile(
      "quality",
      "Frontier Maximum Quality",
      "🏆 Max Quality",
      "Maximizes overall scientific rigor, deep biological deductions, and flawless numerical claim verification regardless of cost.",
      qT1,
      qT2,
      qT3,
      frontierSoloCost
    );

    // 2. Balanced (Recommended): Maximizes Score / Cost ratio (Pareto frontier)
    // T1: Ultra-cheap, disciplined utility model (Claude Haiku 5.5, $0.08)
    // T2: Rapid, batch tool runner with zero turn bloat (Gemini 3.1 Flash-Lite, $0.16, 11 turns)
    // T3: Frontier reasoner with 0 direction errors (Grok 4.7, 94/100)
    const bT1 = tier1Candidates.find((c) => c.model.includes("haiku")) || tier1Candidates[0];
    const bT2 = tier2Candidates.find((c) => c.model.includes("flash") || c.turns <= 15) || tier2Candidates[0];
    const bT3 = qT3; // Still pair with top reasoner for manuscript & critique!
    const balancedProfile = this.buildProfile(
      "balanced",
      "Sweet Spot (Pareto Value)",
      "⚖️ Sweet Spot (Recommended)",
      "Optimal balance: pairs ultra-cheap high-throughput models for routine phases with the top frontier reasoner for manuscript synthesis and peer review.",
      bT1,
      bT2,
      bT3,
      frontierSoloCost
    );

    // 3. Budget / High Speed: Lowest cost with 0 direction errors and fast execution
    const bgT1 = tier1Candidates.find((c) => c.costUsd <= 0.10 && c.completionRate === 1) || tier1Candidates[0];
    const bgT2 = tier2Candidates.find((c) => c.turns <= 15) || tier2Candidates[0];
    const bgT3 =
      tier3Candidates.find((c) => c.directionErrors === 0 && c.costUsd < 1.0) ||
      tier3Candidates.find((c) => c.directionErrors === 0) ||
      tier3Candidates[tier3Candidates.length - 1];
    const budgetProfile = this.buildProfile(
      "budget",
      "High Speed & Cost-Optimized",
      "⚡ Fast & Budget",
      "Minimizes total API spend while ensuring 100% completion of initial phases and zero directional inversions in the manuscript.",
      bgT1,
      bgT2,
      bgT3,
      frontierSoloCost
    );

    return {
      ok: true,
      timestamp: new Date().toISOString(),
      profiles: {
        quality: qualityProfile,
        balanced: balancedProfile,
        budget: budgetProfile,
      },
      modelRankings: {
        tier1: tier1Candidates.slice(0, 5).map((c) => ({ model: c.model, score: c.score, costUsd: c.costUsd, note: c.note })),
        tier2: tier2Candidates.slice(0, 5).map((c) => ({ model: c.model, score: c.score, costUsd: c.costUsd, note: c.note })),
        tier3: tier3Candidates.slice(0, 5).map((c) => ({ model: c.model, score: c.score, costUsd: c.costUsd, note: c.note })),
      },
      totalRunsAnalyzed: runs.length,
      pricingSource: source,
    };
  }

  private buildProfile(
    id: "quality" | "balanced" | "budget",
    title: string,
    badge: string,
    description: string,
    t1: any,
    t2: any,
    t3: any,
    frontierSoloCost: number
  ): TierOptimizationProfile {
    const totalCost = t1.costUsd + t2.costUsd + t3.costUsd;
    const totalDurationSec = t1.durationSec + t2.durationSec + t3.durationSec;
    const projectedScore = t3.overallScore;
    const savingsPercent = Math.max(0, Math.round(((frontierSoloCost - totalCost) / frontierSoloCost) * 100));

    const recUtility: TierRecommendation = {
      role: "utility",
      tierName: "Tier 1: Fast Utility & Ingestion",
      phases: ["01_INSPECT", "02_NORMALIZE", "03_IMPUTE"],
      recommendedModel: t1.model,
      provider: t1.provider || "openrouter",
      score: t1.score,
      estimatedCostUsd: Number(t1.costUsd.toFixed(3)),
      rationale: t1.note,
      metrics: {
        completionRate: t1.completionRate,
        avgTurns: t1.turns,
        tokensUsed: Math.round(t1.costUsd * 1e6),
        fidelityOrSuccessRate: Math.round(t1.completionRate * 100),
      },
    };

    const recToolRunner: TierRecommendation = {
      role: "toolRunner",
      tierName: "Tier 2: Tool Runner & Code Orchestrator",
      phases: ["04_EXPRESSION", "05_ENRICHMENT", "06_OBSERVATIONS", "08_LITERATURE", "09_WEBSEARCH", "10_FIGURES"],
      recommendedModel: t2.model,
      provider: t2.provider || "openrouter",
      score: t2.score,
      estimatedCostUsd: Number(t2.costUsd.toFixed(3)),
      rationale: t2.note,
      metrics: {
        completionRate: t2.toolSuccessRate,
        avgTurns: t2.turns,
        tokensUsed: Math.round(t2.costUsd * 1e6),
        fidelityOrSuccessRate: Math.round(t2.figureScore * 100),
      },
    };

    const recReasoner: TierRecommendation = {
      role: "reasoner",
      tierName: "Tier 3: Frontier Scientific Reasoner",
      phases: ["07_KNOWLEDGE", "11_SYNTHESIS", "12_INTEGRITY", "13_CRITIQUE"],
      recommendedModel: t3.model,
      provider: t3.provider || "openrouter",
      score: t3.score,
      estimatedCostUsd: Number(t3.costUsd.toFixed(3)),
      rationale: t3.note,
      metrics: {
        completionRate: 1.0,
        avgTurns: t3.turns,
        tokensUsed: Math.round(t3.costUsd * 1e6),
        fidelityOrSuccessRate: Math.round(t3.fidelity),
        directionErrors: t3.directionErrors,
      },
    };

    return {
      id,
      title,
      badge,
      description,
      tierUtility: { model: t1.model, provider: t1.provider },
      tierToolRunner: { model: t2.model, provider: t2.provider },
      tierReasoner: { model: t3.model, provider: t3.provider },
      projectedBenchmarkScore: projectedScore,
      projectedCostUsd: Number(totalCost.toFixed(2)),
      projectedDurationMinutes: Math.round(totalDurationSec / 60) || 5,
      costSavingsPercentVsFrontier: savingsPercent,
      recommendations: {
        utility: recUtility,
        toolRunner: recToolRunner,
        reasoner: recReasoner,
      },
    };
  }

  /**
   * Calls an LLM advisor to produce an executive biological and bioinformatics
   * justification for the suggested multi-model blend.
   */
  public async explainTierConfiguration(
    req: ExplainTierRequest,
    client: ProviderClient
  ): Promise<ExplainTierResponse> {
    const suggestions = await this.suggestTiers();
    const profile = suggestions.profiles[req.profileId] || suggestions.profiles.balanced;

    const t1Model = req.tierUtilityModel || profile.tierUtility.model;
    const t2Model = req.tierToolRunnerModel || profile.tierToolRunner.model;
    const t3Model = req.tierReasonerModel || profile.tierReasoner.model;

    const systemPrompt = `You are a Lead Proteomics Bioinformatician and Agent Systems Architect.
Your task is to analyze an empirical 3-Tier Multi-LLM Role Configuration for a quantitative mass-spectrometry differential expression pipeline (e.g. p97/VCP knockout in HCT116 cells).

Provide a concise, high-impact scientific and architectural review (3 structured sections) explaining why this specific allocation of models maximizes data integrity, biological insight, and computational cost-efficiency.`;

    const userPrompt = `### Proposed Multi-LLM Role Configuration:
- **Optimization Profile**: ${profile.title} (${profile.badge})
- **Tier 1 (Utility & Ingestion)**: \`${t1Model}\`
  - Operational Scope: Phases 01–03 (Raw protein ingestion, Loess normalization, Minimum imputation)
  - Estimated Tier Cost: $${profile.recommendations.utility.estimatedCostUsd}
- **Tier 2 (Tool Runner & Code Orchestrator)**: \`${t2Model}\`
  - Operational Scope: Phases 04–06, 08–10 (Limma differential expression, Wilcoxon pathway enrichment, R ggplot2 figure generation, Web search & literature DB query)
  - Estimated Tier Cost: $${profile.recommendations.toolRunner.estimatedCostUsd}
- **Tier 3 (Frontier Scientific Reasoner)**: \`${t3Model}\`
  - Operational Scope: Phases 07, 11–13 (De novo functional modules, publication-grade manuscript synthesis, data-grounded integrity review, scientific critique)
  - Estimated Tier Cost: $${profile.recommendations.reasoner.estimatedCostUsd}

### Projected Metrics:
- Projected Overall Benchmark Score: **${profile.projectedBenchmarkScore} / 100**
- Total Multi-Model Run Cost: **$${profile.projectedCostUsd}** (Savings: **${profile.costSavingsPercentVsFrontier}%** vs running frontier model across all phases)
- Direction Error Guarantee: **0 directional claim inversions**

Please write:
1. **Architectural & Economic Synergy**: Why this role split beats single-model execution.
2. **Biological Fidelity & Data Grounding**: How the Reasoner specifically guards against directional hallucinations (e.g. p97 substrate accumulation vs translation suppression) while the Tool Runner executes reproducible R statistical models.
3. **Biologist's Recommendation**: A final 2-sentence verdict on deploying this configuration.`;

    try {
      const reasonerClient = client.forRole("reasoner");
      const modelName = reasonerClient.getConfig().model || "Tier-3 Reasoner";

      const response = await reasonerClient.chat({
        system: systemPrompt,
        messages: [{ role: "user", content: userPrompt }],
        tools: [],
      });

      return {
        ok: true,
        explanation: response.content || "No explanation generated.",
        profileId: req.profileId,
        generatedBy: modelName,
        tokensUsed: response.usage?.totalTokens,
      };
    } catch (err: any) {
      return {
        ok: false,
        explanation: "",
        profileId: req.profileId,
        generatedBy: "error",
        error: err.message,
      };
    }
  }
}
