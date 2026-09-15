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
  for (const patch of [{ fast: true }, { longContext: true }, { cacheWriteHourTokens: 1 }, { inputTokens: null }, { inputTokens: 1 }]) {
    expect(priceSessionUsage("codex", { ...usage, ...patch }, { "openai:fixture": rates }).usd).toBeNull();
  }
});
