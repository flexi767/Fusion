import { redactSecrets } from "../secrets/redact-secrets.js";
import type { RecordedSessionPrice } from "./rate-snapshot.js";
import { lookupPricing, pricingAsOf, validModelPricing, pricingAppliesAt, type ModelPricingOverrides } from "../ai/model-pricing.js";
import type { SessionModelUsage, SessionTurn } from "./turn.js";
export interface SessionCostLine {
  category: string; tokens: number; ratePerMillion: number; usd: number;
}
export interface SessionUsageCost {
  model: string; usd: number | null; reason: string | null; lines: SessionCostLine[];
  source: string | null; effectiveDate: string; calculation: "current-rates-estimate" | "recorded-rates-estimate";
  effectiveUntil?: string; rateVersion?: string; capturedAt?: string; rateTiming?: "effective-period" | "capture-only";
}
/** Both adapters expose inclusive input; reasoning stays within output. Never infer tier/TTL prices. */
export function priceSessionUsage(provider: string, usage: SessionModelUsage, overrides?: ModelPricingOverrides, recorded?: RecordedSessionPrice | null): SessionUsageCost {
  const result: SessionUsageCost = { model: usage.model, usd: null, reason: null, lines: [], source: null, effectiveDate: pricingAsOf, calculation: recorded === undefined ? "current-rates-estimate" : "recorded-rates-estimate" };
  if (recorded === null) return { ...result, reason: "No recorded rate snapshot" };
  if (recorded) Object.assign(result, { rateVersion: recorded.version, capturedAt: recorded.capturedAt, effectiveDate: recorded.rates?.effectiveFrom ?? recorded.referenceDate,
    rateTiming: recorded.rates?.effectiveFrom ? "effective-period" : "capture-only" });
  if ((usage.serviceTier && !["standard", "default"].includes(usage.serviceTier)) || usage.fast || usage.longContext || (usage.cacheWriteHourTokens ?? 0) > 0) return { ...result, reason: "Unsupported tier, context band or cache lifetime" };
  const { inputTokens: input, cachedInputTokens: read, cacheWriteTokens: write, outputTokens: output } = usage;
  if (input === null || read === null || write === null || output === null) return { ...result, reason: "Missing token categories" };
  if (provider === "claude" && write > 0 && usage.cacheWriteHourTokens === null) return { ...result, reason: "Cache lifetime unreported" };
  if (read + write > input) return { ...result, reason: "Inconsistent input counters" };
  const rates = recorded ? recorded.rates : lookupPricing({ provider: provider === "claude" ? "anthropic" : "openai", model: usage.model }, overrides);
  if (!validModelPricing(rates)) return { ...result, reason: recorded ? "No valid price was recorded" : "Model has no valid configured price" };
  if (rates.effectiveUntil) result.effectiveUntil = rates.effectiveUntil;
  const at = recorded ? Date.parse(recorded.turnStartedAt) : Date.now();
  if (!pricingAppliesAt(rates, at)) {
    return { ...result, reason: "Rate does not cover this calculation date" };
  }
  const lines = [["Uncached input", input - read - write, rates.inputPer1M], ["Cache read", read, rates.cacheReadPer1M], ["Cache write", write, rates.cacheWritePer1M], ["Output (includes reasoning)", output, rates.outputPer1M]] as const;
  result.lines = lines.map(([category, tokens, ratePerMillion]) => ({ category, tokens, ratePerMillion, usd: tokens * ratePerMillion / 1_000_000 }));
  if (result.lines.some(line => !Number.isFinite(line.usd))) return { ...result, lines: [], reason: "Cost exceeds numeric range" };
  result.usd = result.lines.reduce((sum, line) => sum + line.usd, 0); result.source = redactSecrets(rates.source);
  if (!recorded && overrides && Object.values(overrides).includes(rates)) result.effectiveDate = rates.effectiveFrom ?? "Operator override; effective date unavailable";
  return result;
}
export interface SessionTurnCost {
  basis?: "current" | "recorded"; usd: number | null; usage: SessionUsageCost[];
  unpricedRows: number; unreportedTurns: number; coveredTurns: number;
}
export function priceSessionTurns(provider: string, turns: SessionTurn[], overrides?: ModelPricingOverrides, basis: "current" | "recorded" = "current"): SessionTurnCost {
  const usage = turns.flatMap(turn => turn.usage.map((row, index) => priceSessionUsage(provider, row, overrides, basis === "recorded" ? turn.recordedPricing?.[index] ?? null : undefined)));
  const priced = usage.filter(row => row.usd !== null);
  return { basis, usd: priced.length ? priced.reduce((sum, row) => sum + row.usd!, 0) : null, usage,
    unpricedRows: usage.length - priced.length, unreportedTurns: turns.filter(turn => !turn.usage.length).length, coveredTurns: turns.length };
}
