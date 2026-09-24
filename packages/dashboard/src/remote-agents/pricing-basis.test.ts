import { describe, expect, it } from "vitest";
import { pricingAsOf } from "@fusion/core";
import { pricingBasis, summarizeSessionCost, summarizeTurnCost } from "./session-cost.js";

const session = (observedAt: string) => ({
  id: "a".repeat(64), hostId: "j", provider: "claude", nativeSessionId: "n", revision: 1,
  observation: { provider: "claude", nativeSessionId: "n", revision: 1, activity: "working", observedAt, usageComplete: true, usage: [] },
  receivedAt: observedAt, lastHeartbeatAt: null, collectorConnected: true, activityStale: false,
}) as never;

describe("pricing basis and historical repricing", () => {
  it("flags work older than the rate basis as a recalculation", () => {
    // Fusion keeps no rate history, so an old session priced today is a recomputation, not its billed cost.
    expect(pricingBasis(undefined, "2026-01-01T00:00:00.000Z").recalculated).toBe(true);
    expect(pricingBasis(undefined, "2026-01-01T00:00:00.000Z").asOf).toBe(pricingAsOf);
  });

  it("does not flag work that happened after the rate basis", () => {
    expect(pricingBasis(undefined, "2099-01-01T00:00:00.000Z").recalculated).toBe(false);
  });

  it("never claims a recalculation it cannot prove", () => {
    for (const at of [undefined, null, "not-a-date"]) {
      expect(pricingBasis(undefined, at).recalculated).toBe(false);
    }
  });

  it("prefers an operator-refreshed basis and its source over the built-in baseline", () => {
    const basis = pricingBasis({ modelPricingFetchedAt: "2026-08-01", modelPricingSource: "Operator refresh" }, "2026-07-01T00:00:00.000Z");
    expect(basis).toMatchObject({ asOf: "2026-08-01", source: "Operator refresh", recalculated: true });
    // The same session is NOT a recalculation once the basis predates it.
    expect(pricingBasis({ modelPricingFetchedAt: "2026-06-01" }, "2026-07-01T00:00:00.000Z").recalculated).toBe(false);
  });

  it("carries the basis on session and turn costs so neither can be read as a billed amount", () => {
    expect(summarizeSessionCost(session("2026-01-01T00:00:00.000Z")).basis.recalculated).toBe(true);
    expect(summarizeSessionCost(session("2099-01-01T00:00:00.000Z")).basis.recalculated).toBe(false);
    expect(summarizeTurnCost({}, "claude", undefined, "2026-01-01T00:00:00.000Z").basis.recalculated).toBe(true);
    expect(summarizeTurnCost({}, "claude", undefined, null).basis.recalculated).toBe(false);
  });
});
