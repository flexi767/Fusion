import { redactSecrets } from "../secrets/redact-secrets.js";
import type { RecordedSessionPrice } from "./rate-snapshot.js";
import { lookupPricing, pricingAsOf, validModelPricing, pricingAppliesAt, type ModelPricingOverrides } from "../ai/model-pricing.js";
import type { SessionModelUsage, SessionTurn } from "./turn.js";
export interface SessionCostLine {
  category: string; tokens: number; ratePerMillion: number; usd: number;
}
export interface SessionUsageCost {
  contextBand?: "standard" | "long";
  model: string; usd: number | null; reason: string | null; lines: SessionCostLine[];
  source: string | null; effectiveDate: string; calculation: "current-rates-estimate" | "recorded-rates-estimate";
  effectiveUntil?: string; rateVersion?: string; capturedAt?: string; rateTiming?: "effective-period" | "capture-only";
}
/** Both adapters expose inclusive input; reasoning stays within output. Never infer tier/TTL prices. */
export function priceSessionUsage(provider: string, usage: SessionModelUsage, overrides?: ModelPricingOverrides, recorded?: RecordedSessionPrice | null): SessionUsageCost {
  const result: SessionUsageCost = { model: usage.model, contextBand: usage.longContext ? "long" : "standard", usd: null, reason: null, lines: [], source: null, effectiveDate: pricingAsOf, calculation: recorded === undefined ? "current-rates-estimate" : "recorded-rates-estimate" };
  if (recorded === null) return { ...result, reason: "No recorded rate snapshot" };
  if (recorded) Object.assign(result, { rateVersion: recorded.version, capturedAt: recorded.capturedAt, effectiveDate: recorded.rates?.effectiveFrom ?? recorded.referenceDate,
    rateTiming: recorded.rates?.effectiveFrom ? "effective-period" : "capture-only" });
  if ((usage.serviceTier && !["standard", "default"].includes(usage.serviceTier)) || usage.fast) return { ...result, reason: "Unsupported service tier" };
  const { inputTokens: input, cachedInputTokens: read, cacheWriteTokens: write, outputTokens: output } = usage;
  if (input === null || read === null || write === null || output === null) return { ...result, reason: "Missing token categories" };
  if (provider === "claude" && write > 0 && usage.cacheWriteHourTokens === null) return { ...result, reason: "Cache lifetime unreported" };
  if (read + write > input) return { ...result, reason: "Inconsistent input counters" };
  const hour = usage.cacheWriteHourTokens ?? 0;
  if (hour > write) return { ...result, reason: "Inconsistent cache-write counters" };
  const configured = recorded ? recorded.rates : lookupPricing({ provider: provider === "claude" ? "anthropic" : "openai-codex", model: usage.model }, overrides);
  if (recorded && usage.longContext && recorded.contextBand !== "long") return { ...result, reason: "No long-context rate was recorded" };
  const rates = recorded ? configured : usage.longContext ? configured?.longContext : configured;
  if (usage.longContext && !rates) return { ...result, reason: "No long-context rate configured" };
  if (!validModelPricing(rates)) return { ...result, reason: recorded ? "No valid price was recorded" : "Model has no valid configured price" };
  if (hour > 0 && rates.cacheWriteHourPer1M === undefined) return { ...result, reason: "No one-hour cache-write rate configured" };
  if (rates.effectiveUntil) result.effectiveUntil = rates.effectiveUntil;
  const at = recorded ? Date.parse(recorded.turnStartedAt) : Date.now();
  if (!pricingAppliesAt(rates, at)) {
    return { ...result, reason: "Rate does not cover this calculation date" };
  }
  const lines: Array<readonly [string, number, number]> = [["Uncached input", input - read - write, rates.inputPer1M], ["Cache read", read, rates.cacheReadPer1M], [hour > 0 ? "Cache write (5 minutes)" : "Cache write", write - hour, rates.cacheWritePer1M]];
  if (hour > 0) lines.push(["Cache write (1 hour)", hour, rates.cacheWriteHourPer1M!]);
  lines.push(["Output (includes reasoning)", output, rates.outputPer1M]);
  result.lines = lines.map(([category, tokens, ratePerMillion]) => ({ category, tokens, ratePerMillion, usd: tokens * ratePerMillion / 1_000_000 }));
  if (result.lines.some(line => !Number.isFinite(line.usd))) return { ...result, lines: [], reason: "Cost exceeds numeric range" };
  result.usd = result.lines.reduce((sum, line) => sum + line.usd, 0); result.source = redactSecrets(rates.source);
  if (!recorded && overrides && configured && Object.values(overrides).includes(configured)) result.effectiveDate = rates.effectiveFrom ?? "Operator override; effective date unavailable";
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
