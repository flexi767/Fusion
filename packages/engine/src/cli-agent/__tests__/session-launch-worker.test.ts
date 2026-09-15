import { expect, it, vi } from "vitest";
import type { SessionLaunchRequest } from "@fusion/core";
import { SessionLaunchWorker } from "../session-launch-worker.js";
function fixture() {
  const request = { id: "launch-request", expiresAt: new Date(Date.now() + 300000).toISOString() } as SessionLaunchRequest;
  const requests = { register: vi.fn(async () => true), begin: vi.fn(async () => null as SessionLaunchRequest | null), owns: vi.fn(async () => true), finish: vi.fn(async () => true) };
  const launch = vi.fn(async (_request: SessionLaunchRequest, _signal: AbortSignal) => "cli-owned"); const onError = vi.fn();
  const worker = new SessionLaunchWorker({ hostId: "m3", projectId: "project", projectPath: "/repo", requests, launch, onError });
  return { worker, request, requests, launch, onError };
}
it("executes only a durable claim and never repeats a launch after a lost acknowledgement", async () => {
  const f = fixture(); f.requests.begin.mockResolvedValueOnce(f.request); f.requests.finish.mockRejectedValue(new Error("lost ack"));
  await f.worker.tick(); await f.worker.tick(); expect(f.launch).toHaveBeenCalledOnce();
  expect(f.requests.finish).toHaveBeenCalledWith("m3", "project", expect.any(String), f.request.id, { status: "started", cliSessionId: "cli-owned" });
  expect(f.onError).toHaveBeenCalledOnce();
});
it("refuses expired, replaced and stopped owners after the database claim", async () => {
  for (const condition of ["expired", "replaced", "stopped"]) {
    const f = fixture();
    if (condition === "expired") f.request.expiresAt = new Date(Date.now() - 1).toISOString();
    if (condition === "replaced") f.requests.owns.mockResolvedValue(false);
    f.requests.begin.mockImplementationOnce(async () => { if (condition === "stopped") f.worker.stop(); return f.request; });
    await f.worker.tick(); expect(f.launch).not.toHaveBeenCalled();
    expect(f.requests.finish).toHaveBeenCalledWith("m3", "project", expect.any(String), f.request.id, { status: "failed", cliSessionId: undefined });
  }
});
it("serializes work and aborts an in-flight initial prompt during shutdown", async () => {
  const f = fixture(); f.requests.begin.mockResolvedValueOnce(f.request); let started!: () => void;
  const launched = new Promise<void>(resolve => { started = resolve; });
  f.launch.mockImplementation((_request, signal) => new Promise((_resolve, reject) => { signal.addEventListener("abort", () => reject(new Error("stopped"))); started(); }));
  const pending = f.worker.tick(); await launched;
  await f.worker.tick(); expect(f.requests.begin).toHaveBeenCalledOnce(); f.worker.stop(); await pending;
  expect(f.requests.finish).toHaveBeenCalledWith("m3", "project", expect.any(String), f.request.id, { status: "failed", cliSessionId: undefined });
});
