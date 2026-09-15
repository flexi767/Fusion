import { expect, it } from "vitest";
import { priceSessionUsage } from "../external-sessions/cost.js";
import type { SessionModelUsage } from "../external-sessions/turn.js";
const usage: SessionModelUsage = { model: "fixture", inputTokens: 100, cachedInputTokens: 20, cacheWriteTokens: 30, cacheWriteHourTokens: 0, outputTokens: 40, reasoningTokens: 10, requests: 1, contextTokens: 100, fast: false, longContext: false };
const rates = { inputPer1M: 2, cacheReadPer1M: 1, cacheWritePer1M: 3, outputPer1M: 4, source: "fixture" };
it("prices inclusive inputs exactly once and never adds reasoning to output", () => {
  for (const provider of ["codex", "claude"]) {
    const price = priceSessionUsage(provider, usage, { [`${provider === "codex" ? "openai" : "anthropic"}:fixture`]: rates });
    expect(price.lines.map(row => row.tokens)).toEqual([50,20,30,40]);
    expect(price.usd).toBeCloseTo(0.00037, 12);
  }
});
it("unknown and unsupported rates or incomplete telemetry stay visibly unpriced", () => {
  expect(priceSessionUsage("codex", usage).usd).toBeNull();
  for (const patch of [{ serviceTier: "unrecognized" }, { fast: true }, { longContext: true }, { cacheWriteHourTokens: 1 }, { inputTokens: null }, { inputTokens: 1 }]) {
    expect(priceSessionUsage("codex", { ...usage, ...patch }, { "openai:fixture": rates }).usd).toBeNull();
  }
});

it("does not assume a five-minute cache write when Claude omits its lifetime", () => {
  expect(priceSessionUsage("claude", { ...usage, cacheWriteHourTokens: null }, { "anthropic:fixture": rates }).reason).toBe("Cache lifetime unreported");
});

it("keeps immutable recorded rates distinct from current repricing and unknown historical applicability", async () => {
  const { captureSessionPrice } = await import("../external-sessions/rate-snapshot.js");
  const at = "2026-09-15T12:00:00.000Z";
  const first = captureSessionPrice("codex", usage, at, at, { "openai:fixture": rates });
  const changed = { ...rates, inputPer1M: 20 };
  const replay = captureSessionPrice("codex", usage, at, "2026-09-16T12:00:00Z", { "openai:fixture": changed }, first);
  expect(replay).toBe(first);
  expect(captureSessionPrice("codex", usage, "2026-09-14T12:00:00Z", at, { "openai:fixture": changed }, first).version).toBe(first.version);
  expect(priceSessionUsage("codex", usage, { "openai:fixture": changed }, replay).usd).toBeCloseTo(0.00037, 12);
  expect(priceSessionUsage("codex", usage, { "openai:fixture": changed }).usd).toBeGreaterThan(0.00037);
  expect(priceSessionUsage("codex", usage, undefined, first).rateTiming).toBe("capture-only");
  expect(priceSessionUsage("codex", usage, undefined, null).reason).toBe("No recorded rate snapshot");
  const dated = { ...rates, effectiveFrom: "2026-09-15T00:00:00Z", effectiveUntil: "2026-09-16T00:00:00Z" };
  const applicable = captureSessionPrice("codex", usage, at, at, { "openai:fixture": dated });
  expect(applicable.version).not.toBe(first.version);
  expect(priceSessionUsage("codex", usage, undefined, applicable)).toMatchObject({ rateTiming: "effective-period", usd: 0.00037 });
  const before = captureSessionPrice("codex", usage, "2026-09-14T12:00:00Z", at, { "openai:fixture": dated });
  expect(priceSessionUsage("codex", usage, undefined, before).usd).toBeNull();
});
it("uses each native provider's exact pricing override for both current costs and newly recorded rates", async () => {
  const { captureSessionPrice } = await import("../external-sessions/rate-snapshot.js");
  const wrong = { ...rates, inputPer1M: 200, outputPer1M: 400, source: "another provider" };
  for (const provider of ["codex", "claude"]) {
    const exact = provider === "codex" ? "openai-codex" : "anthropic";
    for (const reverse of [false, true]) {
      const entries = [["openai:fixture", wrong], [`${exact}:fixture`, rates]] as const;
      const overrides = Object.fromEntries(reverse ? [...entries].reverse() : entries);
      expect(priceSessionUsage(provider, usage, overrides).usd).toBeCloseTo(0.00037, 12);
      const recorded = captureSessionPrice(provider, usage, "2026-09-15T12:00:00Z", "2026-09-15T12:00:01Z", overrides);
      expect(recorded.rates).toEqual(rates);
      expect(priceSessionUsage(provider, usage, undefined, recorded).usd).toBeCloseTo(0.00037, 12);
    }
  }
});


it("prices separate cache lifetimes and context bands without borrowing missing rates", async () => {
  const { captureSessionPrice } = await import("../external-sessions/rate-snapshot.js");
  const { validModelPricing } = await import("../ai/model-pricing.js");
  const standard = { ...rates, cacheWriteHourPer1M: 5 };
  const long = { inputPer1M: 20, cacheReadPer1M: 10, cacheWritePer1M: 30, cacheWriteHourPer1M: 50, outputPer1M: 40, source: "long fixture" };
  const combined = { ...standard, longContext: long };
  const at = "2026-09-15T12:00:00Z";
  for (const provider of ["codex", "claude"]) for (const longContext of [false, true]) {
    const row = { ...usage, cacheWriteHourTokens: 10, longContext };
    const key = `${provider === "codex" ? "openai-codex" : "anthropic"}:fixture`;
    const overrides = { [key]: combined };
    const price = priceSessionUsage(provider, row, overrides);
    expect(price.contextBand).toBe(longContext ? "long" : "standard");
    expect(price.lines.map(line => line.tokens)).toEqual([50, 20, 20, 10, 40]);
    expect(price.usd).toBeCloseTo(longContext ? 0.0039 : 0.00039, 12);
    const snapshot = captureSessionPrice(provider, row, at, at, overrides);
    expect(snapshot.rates).toEqual(longContext ? long : standard);
    expect(captureSessionPrice(provider, row, at, at, { [key]: rates }, snapshot)).toBe(snapshot);
    expect(priceSessionUsage(provider, row, undefined, snapshot).usd).toBe(price.usd);
    expect(priceSessionUsage(provider, { ...row, cacheWriteHourTokens: 31 }, overrides).reason).toBe("Inconsistent cache-write counters");
    expect(priceSessionUsage(provider, { ...row, fast: true }, overrides).usd).toBeNull();
    expect(priceSessionUsage(provider, { ...row, serviceTier: "unknown" }, overrides).usd).toBeNull();
    if (longContext) {
      expect(priceSessionUsage(provider, row, { [key]: standard }).reason).toBe("No long-context rate configured");
      expect(priceSessionUsage(provider, row, undefined, { ...snapshot, contextBand: undefined }).reason).toBe("No long-context rate was recorded");
      const dated = captureSessionPrice(provider, row, at, at, { [key]: { ...standard, longContext: { ...long, effectiveFrom: "2026-09-16T00:00:00Z" } } });
      expect(priceSessionUsage(provider, row, undefined, dated).reason).toBe("Rate does not cover this calculation date");
    } else {
      expect(priceSessionUsage(provider, row, { [key]: rates }).reason).toBe("No one-hour cache-write rate configured");
    }
  }
  expect(validModelPricing(combined)).toBe(true);
  for (const bad of [-1, NaN, Infinity]) {
    expect(validModelPricing({ ...standard, cacheWriteHourPer1M: bad })).toBe(false);
    expect(validModelPricing({ ...standard, longContext: { ...long, inputPer1M: bad } })).toBe(false);
  }
});
