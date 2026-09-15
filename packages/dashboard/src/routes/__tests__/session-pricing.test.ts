import { afterEach, expect, it, vi } from "vitest";
import { readSessionPricing } from "../session-pricing.js";
afterEach(() => vi.useRealTimers());
it("retains pricing when available and does not block ingestion on throwing, rejected or hanging settings", async () => {
  expect(await readSessionPricing(async () => ({}))).toEqual({});
  expect(await readSessionPricing(() => { throw Error("offline"); })).toBeNull();
  expect(await readSessionPricing(async () => { throw Error("offline"); })).toBeNull();
  vi.useFakeTimers(); const pending = readSessionPricing(() => new Promise(() => {}));
  await vi.advanceTimersByTimeAsync(500); expect(await pending).toBeNull();
});
