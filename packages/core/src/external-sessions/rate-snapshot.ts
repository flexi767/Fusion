import { redactSecrets } from "../secrets/redact-secrets.js";
import { createHash } from "node:crypto";
import { lookupPricing, pricingAsOf, validModelPricing, type ModelPricing, type ModelPricingOverrides } from "../ai/model-pricing.js";
import type { SessionModelUsage } from "./turn.js";
export interface RecordedSessionPrice {
  version: string; usageKey: string; capturedAt: string; turnStartedAt: string;
  referenceDate: string; rates: ModelPricing | null;
  contextBand?: "standard" | "long";
}
export function usagePriceKey(usage: SessionModelUsage) {
  return JSON.stringify([usage.model, usage.serviceTier ?? null, usage.fast, usage.longContext]);
}
/** Store immutable rates, not computed costs. Missing effective dates never become historical evidence. */
export function captureSessionPrice(provider: string, usage: SessionModelUsage, turnStartedAt: string, capturedAt: string,
  overrides?: ModelPricingOverrides | null, previous?: RecordedSessionPrice): RecordedSessionPrice {
  const usageKey = usagePriceKey(usage);
  if (previous?.usageKey === usageKey) return previous.turnStartedAt === turnStartedAt ? previous : { ...previous, turnStartedAt };
  const configured = overrides === null ? undefined : lookupPricing({ provider: provider === "claude" ? "anthropic" : "openai-codex", model: usage.model }, overrides);
  const selected = usage.longContext ? configured?.longContext : configured;
  const rates: ModelPricing | null = validModelPricing(selected) ? { inputPer1M: selected.inputPer1M, outputPer1M: selected.outputPer1M,
    cacheReadPer1M: selected.cacheReadPer1M, cacheWritePer1M: selected.cacheWritePer1M, source: redactSecrets(selected.source),
    ...(selected.cacheWriteHourPer1M !== undefined ? { cacheWriteHourPer1M: selected.cacheWriteHourPer1M } : {}),
    ...(selected.effectiveFrom ? { effectiveFrom: new Date(selected.effectiveFrom).toISOString() } : {}),
    ...(selected.effectiveUntil ? { effectiveUntil: new Date(selected.effectiveUntil).toISOString() } : {}) } : null;
  const referenceDate = overrides && configured && Object.values(overrides).includes(configured) ? "Operator override; verification date unavailable" : pricingAsOf;
  const contextBand = usage.longContext ? "long" : "standard";
  const version = createHash("sha256").update(JSON.stringify([provider, usage.model, contextBand, rates, referenceDate])).digest("hex");
  return { version, usageKey, capturedAt, turnStartedAt, referenceDate, rates, contextBand };
}
