import type { ModelPricingOverrides } from "@fusion/core";

/** A standard-rate refresh cannot replace independently specified bands or their provenance. */
export function mergePricingRefresh(existing: ModelPricingOverrides, fetched: ModelPricingOverrides) {
  const overrides = { ...existing };
  let updatedCount = 0;
  let preservedCount = 0;
  for (const [key, rates] of Object.entries(fetched)) {
    const current = existing[key];
    if (current && (current.cacheWriteHourPer1M !== undefined || current.longContext !== undefined || current.effectiveFrom || current.effectiveUntil)) {
      preservedCount++;
      continue;
    }
    overrides[key] = rates;
    updatedCount++;
  }
  return { overrides, updatedCount, preservedCount };
}
