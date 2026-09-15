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
