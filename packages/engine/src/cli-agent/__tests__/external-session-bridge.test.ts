import { expect, it, vi } from "vitest";
import type { CliSession } from "@fusion/core";
import { ExternalSessionRuntimeBridge, type ExternalSessionBridgeOptions } from "../external-session-bridge.js";
const now = new Date().toISOString();
const row = (patch: Partial<CliSession> = {}): CliSession => ({ id: "cli-owned", projectId: "project", taskId: null, chatSessionId: null, purpose: "chat", adapterId: "codex", agentState: "ready", terminationReason: null, nativeSessionId: "native", resumeAttempts: 0, autonomyPosture: null, worktreePath: "/repo", createdAt: now, updatedAt: now, ...patch });
function fixture(rows = [row()]) {
  const generations = new Map(rows.map(row => [row.id, "generation-owned-123"]));
  const observations = { get: vi.fn(async () => null), ingest: vi.fn(async () => ({ id: "observed", revision: 0, applied: true })), associateNativeRuntime: vi.fn(async () => {}) };
  const manager = { getRuntimeGeneration: (id: string) => generations.get(id), inject: vi.fn(async () => {}), killOwned: vi.fn(() => true) };
  const controls = { register: vi.fn(async () => true), claim: vi.fn(async () => [] as Array<Record<string, unknown>>), beginExecution: vi.fn(async () => null as Record<string, unknown> | null), acknowledge: vi.fn(async () => true) };
  const onError = vi.fn();
  const options = { hostId: "m3", projectId: "project", projectPath: "/repo", controlsEnabled: true, store: { listSessions: () => rows }, observations, manager, controls, onError } as unknown as ExternalSessionBridgeOptions;
  return { bridge: new ExternalSessionRuntimeBridge(options), observations, manager, controls, generations, onError };
}
const command = (patch: Record<string, unknown> = {}) => ({ id: "command-123456789", operation: "feedback", text: "Check the failing test", expiresAt: new Date(Date.now() + 300000).toISOString(), ...patch });
it("reconciles only verified owned Codex and Claude native identities and leaves task controls with the task", async () => {
  const f = fixture([row({ taskId: "FN-1" }), row({ id: "claude", adapterId: "claude-code", nativeSessionId: "native-claude" }), row({ id: "unsupported", adapterId: "grok" }), row({ id: "unidentified", nativeSessionId: null }), row({ id: "historical" })]);
  f.generations.delete("historical"); await f.bridge.tick();
  expect(f.observations.ingest).toHaveBeenCalledTimes(2);
  expect(f.observations.ingest.mock.calls.map(call => (call as unknown as [string, string, { provider: string }])[2].provider)).toEqual(["codex", "claude"]);
  expect(f.observations.associateNativeRuntime).toHaveBeenCalledWith(expect.any(String), { cliSessionId: "cli-owned", projectId: "project", taskId: "FN-1" });
  expect(f.controls.register).toHaveBeenCalledWith("m3", expect.any(String), "generation-owned-123", ["feedback"], expect.any(Number), "fusion-runtime");
  expect(f.controls.register).toHaveBeenCalledWith("m3", expect.any(String), "generation-owned-123", ["feedback", "stop"], expect.any(Number), "fusion-runtime");
});
it("does not replace collected observations or grant controls to ambiguous native owners", async () => {
  const f = fixture([row(), row({ id: "second-owner" })]);
  f.observations.get.mockResolvedValue({ id: "existing" } as never);
  await f.bridge.tick(); expect(f.observations.ingest).not.toHaveBeenCalled(); expect(f.observations.associateNativeRuntime).not.toHaveBeenCalled();
  expect(f.controls.register.mock.calls.every(call => (call as unknown as unknown[][])[3].length === 0)).toBe(true);
  expect(f.controls.claim).not.toHaveBeenCalled();
});
it("never executes again when acknowledgement fails after native injection", async () => {
  const f = fixture(); const queued = command(); f.controls.claim.mockResolvedValue([queued]);
  f.controls.beginExecution.mockResolvedValueOnce(queued).mockResolvedValue(null); f.controls.acknowledge.mockRejectedValue(new Error("database offline"));
  await f.bridge.tick(); await f.bridge.tick();
  expect(f.manager.inject).toHaveBeenCalledTimes(1);
  expect(f.manager.inject).toHaveBeenCalledWith("cli-owned", queued.text, expect.objectContaining({ generation: "generation-owned-123", signal: expect.any(AbortSignal), deadlineMs: expect.any(Number) }));
  expect(f.onError).toHaveBeenCalledOnce();
});
it("checks generation and expiry again after durable execution begins", async () => {
  for (const changed of [true, false]) {
    const f = fixture(); const queued = command({ operation: "stop", expiresAt: new Date(Date.now() - 1).toISOString() });
    f.controls.claim.mockResolvedValue([queued]); f.controls.beginExecution.mockImplementation(async () => { if (changed) f.generations.set("cli-owned", "replacement"); return queued; });
    await f.bridge.tick(); expect(f.manager.killOwned).not.toHaveBeenCalled(); expect(f.manager.inject).not.toHaveBeenCalled();
    expect(f.controls.acknowledge).toHaveBeenCalledWith("m3", queued.id, "generation-owned-123", "failed");
  }
});
it("waits to inject busy sessions, prioritizes standalone stop, and never directly stops a task-owned session", async () => {
  const f = fixture([row({ agentState: "busy" })]); const stop = command({ id: "stop-123456789", operation: "stop" });
  f.controls.claim.mockResolvedValue([command(), stop]); f.controls.beginExecution.mockResolvedValue(stop);
  await f.bridge.tick(); expect(f.manager.inject).not.toHaveBeenCalled(); expect(f.manager.killOwned).toHaveBeenCalledWith("cli-owned", "generation-owned-123");
  const task = fixture([row({ taskId: "FN-1", agentState: "busy" })]); task.controls.claim.mockResolvedValue([command(), stop]);
  await task.bridge.tick(); expect(task.controls.beginExecution).not.toHaveBeenCalled();
});
it("shutdown prevents native side effects after a delayed database response", async () => {
  const f = fixture(); let finish!: (value: null) => void;
  f.observations.get.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
  const pending = f.bridge.tick(); f.bridge.stop(); finish(null); await pending;
  expect(f.observations.ingest).not.toHaveBeenCalled(); expect(f.manager.inject).not.toHaveBeenCalled(); expect(f.controls.register).not.toHaveBeenCalled();
});
it("rotates bounded work and detects duplicate owners beyond the current page", async () => {
  const rows = Array.from({ length: 34 }, (_, i) => row({ id: `cli-${i}`, nativeSessionId: `native-${i}` }));
  rows[33].nativeSessionId = rows[0].nativeSessionId;
  const f = fixture(rows); await f.bridge.tick();
  expect(f.observations.ingest).toHaveBeenCalledTimes(32);
  expect(f.observations.associateNativeRuntime).not.toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ cliSessionId: "cli-0" }));
  await f.bridge.tick();
  expect(f.observations.associateNativeRuntime).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ cliSessionId: "cli-32" }));
  expect(f.observations.associateNativeRuntime).not.toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ cliSessionId: "cli-33" }));
});
it("allows independent follow-ups after completion but leaves completed task work under task controls", async () => {
  const f = fixture([row({ agentState: "done" })]); const queued = command();
  f.controls.claim.mockResolvedValue([queued]); f.controls.beginExecution.mockResolvedValue(queued);
  await f.bridge.tick(); expect(f.manager.inject).toHaveBeenCalledOnce();
  const task = fixture([row({ taskId: "FN-1", agentState: "done" })]); task.controls.claim.mockResolvedValue([queued]);
  await task.bridge.tick(); expect(task.manager.inject).not.toHaveBeenCalled();
  expect(task.controls.register).toHaveBeenCalledWith("m3", expect.any(String), expect.any(String), [], expect.any(Number), "fusion-runtime");
});
