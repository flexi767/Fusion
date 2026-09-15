import { expect, it } from "vitest";
import { mergePricingRefresh } from "../pricing-refresh.js";
const base = { inputPer1M: 2, outputPer1M: 4, cacheReadPer1M: 1, cacheWritePer1M: 3, source: "original" };
const fetched = { ...base, inputPer1M: 20, source: "fresh" };
it("refreshes standard rates while preserving complete explicit bands, dates and their original provenance", () => {
  const protectedRows = {
    hour: { ...base, cacheWriteHourPer1M: 0 },
    long: { ...base, longContext: { ...base, source: "long source" } },
    from: { ...base, effectiveFrom: "2026-09-01T00:00:00Z" },
    until: { ...base, effectiveUntil: "2026-10-01T00:00:00Z" },
  };
  const existing = { ...protectedRows, ordinary: base, absentFromFetch: base };
  const updates = Object.fromEntries([...Object.keys(protectedRows), "ordinary", "new"].map(key => [key, fetched]));
  const result = mergePricingRefresh(existing, updates);
  expect(result).toMatchObject({ updatedCount: 2, preservedCount: 4 });
  expect(result.overrides).toEqual({ ...existing, ordinary: fetched, new: fetched });
  for (const key of Object.keys(protectedRows)) expect(result.overrides[key]).toBe(existing[key as keyof typeof existing]);
  expect(existing.ordinary).toBe(base);
  expect(mergePricingRefresh(result.overrides, updates)).toEqual(result);
});
it("handles empty configurations and empty fetches without dropping configured rates", () => {
  expect(mergePricingRefresh({}, { model: fetched })).toEqual({ overrides: { model: fetched }, updatedCount: 1, preservedCount: 0 });
  expect(mergePricingRefresh({ model: base }, {})).toEqual({ overrides: { model: base }, updatedCount: 0, preservedCount: 0 });
});

it("persists the protected merge through the refresh route and reports updated and preserved counts", async () => {
  const { vi } = await import("vitest");
  const { registerCommandCenterRoutes } = await import("../register-command-center-routes.js");
  const rows = { "anthropic:fixture": { ...base, cacheWriteHourPer1M: 5 } };
  const updateGlobalSettings = vi.fn();
  const handlers = new Map<string, (...args: unknown[]) => Promise<void>>();
  const router = { get: vi.fn(), post: (path: string, handler: (...args: unknown[]) => Promise<void>) => handlers.set(path, handler) };
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: async () => ({
    fixture: { mode: "chat", litellm_provider: "anthropic", input_cost_per_token: 0.000020, output_cost_per_token: 0.000040 },
    new: { mode: "chat", litellm_provider: "openai", input_cost_per_token: 0.000020, output_cost_per_token: 0.000040 },
  }) }));
  try {
    registerCommandCenterRoutes({ router, getScopedStore: async () => ({ getGlobalSettingsStore: () => ({ getSettings: async () => ({ modelPricingOverrides: rows }) }), updateGlobalSettings }), rethrowAsApiError: (error: unknown) => { throw error; } } as unknown as Parameters<typeof registerCommandCenterRoutes>[0]);
    const json = vi.fn();
    await handlers.get("/command-center/pricing/fetch")!({}, { json });
    expect(updateGlobalSettings.mock.calls[0][0].modelPricingOverrides["anthropic:fixture"]).toEqual(rows["anthropic:fixture"]);
    expect(updateGlobalSettings.mock.calls[0][0].modelPricingOverrides["openai:new"].inputPer1M).toBe(20);
    expect(json).toHaveBeenCalledWith(expect.objectContaining({ count: 1, preservedCount: 1 }));
  } finally { vi.unstubAllGlobals(); }
});
