import { afterEach, expect, it, vi } from "vitest";
import { createSessionSummaryWorker } from "../session-summary-worker.js";
import type { AsyncDataLayer } from "@fusion/core";
const { summarize, list } = vi.hoisted(() => ({ summarize: vi.fn(), list: vi.fn() }));
vi.mock("@fusion/core", () => ({ ExternalSessionStore: class { list = list; }, ExternalSessionSummaries: class { summarize = summarize; } }));
afterEach(() => { vi.useRealTimers(); vi.clearAllMocks(); });
it("coalesces bursts, serializes summaries, recovers durable records and stops cleanly", async () => {
  vi.useFakeTimers(); list.mockResolvedValue({ sessions: [{ id: "recover" }], nextCursor: null });
  let release!: () => void; summarize.mockImplementationOnce(() => new Promise<void>(resolve => { release = resolve; })).mockResolvedValue({ changed: true });
  const worker = createSessionSummaryWorker(() => ({}) as AsyncDataLayer, "http://localhost/v1");
  worker.enqueue("same"); worker.enqueue("same");
  await vi.advanceTimersByTimeAsync(2000); expect(summarize).toHaveBeenCalledTimes(1);
  await vi.advanceTimersByTimeAsync(10000); expect(summarize).toHaveBeenCalledTimes(1);
  release(); await vi.advanceTimersByTimeAsync(2000); expect(summarize).toHaveBeenCalledTimes(2);
  expect(summarize.mock.calls[1][0]).toBe("recover");
  worker.stop(); await vi.advanceTimersByTimeAsync(10000); expect(summarize).toHaveBeenCalledTimes(2);
});
