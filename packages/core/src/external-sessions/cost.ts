import { lookupPricing, pricingAsOf, type ModelPricingOverrides } from "../ai/model-pricing.js";
import type { SessionModelUsage, SessionTurn } from "./turn.js";
export interface SessionCostLine {
  category: string; tokens: number; ratePerMillion: number; usd: number;
}
export interface SessionUsageCost {
  model: string; usd: number | null; reason: string | null; lines: SessionCostLine[];
  source: string | null; effectiveDate: string; calculation: "current-rates-estimate";
}
/** Both adapters expose inclusive input; reasoning stays within output. Never infer tier/TTL prices. */
export function priceSessionUsage(provider: string, usage: SessionModelUsage, overrides?: ModelPricingOverrides): SessionUsageCost {
  const result: SessionUsageCost = { model: usage.model, usd: null, reason: null, lines: [], source: null, effectiveDate: pricingAsOf, calculation: "current-rates-estimate" };
  if (usage.fast || usage.longContext || (usage.cacheWriteHourTokens ?? 0) > 0) return { ...result, reason: "Unsupported tier, context band or cache lifetime" };
  const { inputTokens: input, cachedInputTokens: read, cacheWriteTokens: write, outputTokens: output } = usage;
  if (input === null || read === null || write === null || output === null) return { ...result, reason: "Missing token categories" };
  if (read + write > input) return { ...result, reason: "Inconsistent input counters" };
  const rates = lookupPricing({ provider: provider === "claude" ? "anthropic" : "openai", model: usage.model }, overrides);
  if (!rates) return { ...result, reason: "Model has no configured price" };
  const lines = [["Uncached input", input - read - write, rates.inputPer1M], ["Cache read", read, rates.cacheReadPer1M], ["Cache write", write, rates.cacheWritePer1M], ["Output (includes reasoning)", output, rates.outputPer1M]] as const;
  result.lines = lines.map(([category, tokens, ratePerMillion]) => ({ category, tokens, ratePerMillion, usd: tokens * ratePerMillion / 1_000_000 }));
  result.usd = result.lines.reduce((sum, line) => sum + line.usd, 0); result.source = rates.source;
  if (overrides && Object.values(overrides).includes(rates)) result.effectiveDate = "Operator override; effective date unavailable";
  return result;
}
export function priceSessionTurns(provider: string, turns: SessionTurn[], overrides?: ModelPricingOverrides) {
  const usage = turns.flatMap(turn => turn.usage.map(row => priceSessionUsage(provider, row, overrides)));
  const priced = usage.filter(row => row.usd !== null);
  return { usd: priced.length ? priced.reduce((sum, row) => sum + row.usd!, 0) : null, usage,
    unpricedRows: usage.length - priced.length, unreportedTurns: turns.filter(turn => !turn.usage.length).length, coveredTurns: turns.length };
}
