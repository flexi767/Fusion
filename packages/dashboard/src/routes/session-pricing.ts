import type { ModelPricingOverrides } from "@fusion/core";
/** Pricing availability cannot hold up acknowledgement of collected history. */
export async function readSessionPricing(read: () => Promise<{ modelPricingOverrides?: ModelPricingOverrides }>, timeoutMs = 500): Promise<ModelPricingOverrides | null> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      Promise.resolve().then(read).then(settings => settings.modelPricingOverrides ?? {}).catch(() => null),
      new Promise<null>(resolve => { timer = setTimeout(() => resolve(null), timeoutMs); }),
    ]);
  } finally { if (timer) clearTimeout(timer); }
}
