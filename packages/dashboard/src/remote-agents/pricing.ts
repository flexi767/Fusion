import { costFor, lookupPricing, type ModelPricingOverrides } from "@fusion/core";
import type { RemoteUsage } from "./types.js";

function count(value: unknown): number | null {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? value : null;
}

// FNXC:RemoteAgents 2026-09-18-05:22: Collector input includes caches, and output includes reasoning. Price disjoint categories once using Fusion's rates; unsupported tiers stay unknown.
export function priceUsage(value: unknown, provider: string, overrides?: ModelPricingOverrides): RemoteUsage | null {
  if (!value || typeof value !== "object") return null;
  const v = value as Record<string, unknown>;
  const input = count(v.inputTokens), cached = count(v.cachedInputTokens), write = count(v.cacheWriteTokens);
  const hour = count(v.cacheWriteHourTokens), output = count(v.outputTokens), reasoning = count(v.reasoningTokens);
  if (input === null || cached === null || write === null || hour === null || output === null || (reasoning === null && v.reasoningTokens !== null) || cached + write > input || hour > write || (reasoning !== null && reasoning > output) || typeof v.model !== "string" || v.model.length > 256) return null;
  const ref = { provider: provider === "claude_code" ? "anthropic" : "openai-codex", model: v.model };
  const rates = lookupPricing(ref, overrides) ?? null;
  const reason = v.fast === true || v.longContext === true ? "Tier rate unavailable" : hour > 0 ? "One-hour cache rate unavailable" : !rates ? "Model rate unavailable" : null;
  const usd = reason ? null : costFor({ inputTokens: input - cached - write, cachedTokens: cached, cacheWriteTokens: write, outputTokens: output }, ref, undefined, overrides).usd;
  return { model: v.model, input: input - cached - write, cached, cacheWrite: write - hour, cacheWriteHour: hour, output, reasoning, rates, usd, reason };
}
