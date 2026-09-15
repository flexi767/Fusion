import { EventEmitter } from "node:events";
import { afterEach, expect, it, vi } from "vitest";
import type { CliSessionStore, CliSession } from "@fusion/core";
import type { IPty } from "node-pty";
import { CliSessionManager } from "../session-manager.js";
import { CliAdapterRegistry, type CliAgentAdapter } from "../adapter.js";

afterEach(() => vi.useRealTimers());
async function fixture(quiet = 0) {
  let record: CliSession;
  const store = Object.assign(new EventEmitter(), {
    flush: async () => {},
    createSession: (input: object) => (record = { id: "owned", agentState: "starting", ...input } as CliSession),
    updateSession: (_id: string, patch: object) => (record = { ...record, ...patch }),
    getSession: () => record,
  }) as unknown as CliSessionStore;
  let data: (value: string) => void = () => {};
  let exited: (value: { exitCode: number }) => void = () => {};
  const pty = { pid: 123, write: vi.fn(), kill: vi.fn(), resize: vi.fn(), onData: (callback: typeof data) => { data = callback; }, onExit: (callback: typeof exited) => { exited = callback; } };
  const registry = new CliAdapterRegistry();
  registry.register({ id: "fixture", name: "Fixture", capabilities: { nativeDone: false, nativeWaiting: false, transcriptSource: "none", supportsResume: true },
    buildLaunch: () => ({ command: "fixture", args: [] }), buildResume: () => ({ command: "fixture", args: [] }), buildEnvAllowlist: () => [],
    createReadinessDetector: () => ({ observe: () => true }), formatInjection: text => ({ payload: text }),
  } satisfies CliAgentAdapter);
  const manager = new CliSessionManager({ registry, store, injectionQuietWindowMs: quiet, loadPty: async () => ({ spawn: () => pty as unknown as IPty }) });
  await manager.spawn({ adapterId: "fixture", projectId: "project", purpose: "chat" });
  return { manager, pty, ready: () => data("ready"), exit: () => exited({ exitCode: 0 }) };
}
it("cancels before readiness and never writes the queued text on a later ready signal", async () => {
  const { manager, pty, ready } = await fixture();
  const abort = new AbortController();
  const pending = manager.inject("owned", "cancelled", { signal: abort.signal }).catch(error => error);
  abort.abort(); expect((await pending).message).toContain("cancelled"); ready();
  await manager.inject("owned", "current");
  expect(pty.write.mock.calls.flat().join("")).toContain("current");
  expect(pty.write.mock.calls.flat().join("")).not.toContain("cancelled"); manager.dispose();
});
it("expires during a quiet-window wait and never writes after the deadline", async () => {
  vi.useFakeTimers(); vi.setSystemTime(1000);
  const { manager, pty, ready } = await fixture(1000); ready();
  const pending = manager.inject("owned", "expired", { deadlineMs: 1500 }).catch(error => error);
  await vi.advanceTimersByTimeAsync(501); expect((await pending).message).toContain("expired");
  await vi.advanceTimersByTimeAsync(1000); expect(pty.write).not.toHaveBeenCalled(); manager.dispose();
});
it("rejects unwritten input on process exit and fences a reused session id with a fresh generation", async () => {
  const { manager, pty, exit, ready } = await fixture();
  const first = manager.getRuntimeGeneration("owned")!;
  const pending = manager.inject("owned", "before exit", { generation: first }).catch(error => error);
  exit(); expect((await pending).message).toContain("exited");
  await manager.spawn({ adapterId: "fixture", projectId: "project", purpose: "chat", resume: { sessionId: "owned", nativeSessionId: "native" } });
  expect(manager.getRuntimeGeneration("owned")).not.toBe(first);
  expect(manager.killOwned("owned", first)).toBe(false); expect(pty.kill).not.toHaveBeenCalled();
  await expect(manager.inject("owned", "wrong generation", { generation: first })).rejects.toThrow("generation");
  ready(); expect(pty.write).not.toHaveBeenCalled();
  expect(manager.killOwned("owned", manager.getRuntimeGeneration("owned")!)).toBe(true); expect(pty.kill).toHaveBeenCalledOnce();
});
