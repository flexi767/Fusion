import { externalSessionTurnPricingSchema, lookupPricing } from "@fusion/core";
import { describe, expect, it } from "vitest";
import { recordedRatesFor } from "./record-rates.js";

describe("recorded turn rates", () => {
  it("stamps only the base-rate fields for a model the catalog prices in volume tiers", () => {
    const catalog = lookupPricing({ provider: "openai-codex", model: "gpt-5.6-luna" });
    expect(catalog?.tiers?.length).toBeGreaterThan(0);

    const pricing = recordedRatesFor([{ model: "gpt-5.6-luna" }], "codex_cli");

    expect(pricing?.rates["codex_cli:gpt-5.6-luna"]).toEqual({
      inputPer1M: catalog?.inputPer1M,
      outputPer1M: catalog?.outputPer1M,
      cacheReadPer1M: catalog?.cacheReadPer1M,
      cacheWritePer1M: catalog?.cacheWritePer1M,
      source: catalog?.source,
    });
    expect(externalSessionTurnPricingSchema.safeParse(pricing).success).toBe(true);
  });
});
