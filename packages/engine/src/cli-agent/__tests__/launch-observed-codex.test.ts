import { mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import type { SessionLaunchRequest, CliSession } from "@fusion/core";
import type { TelemetryHub } from "../telemetry-hub.js";
import { launchObservedCodex } from "../launch-observed-codex.js";
import { codexAdapter } from "../adapters/codex.js";
const dirs: string[] = [];
afterEach(async () => { for (const dir of dirs.splice(0)) await rm(dir, { recursive: true, force: true }); });
async function fixture() {
  const hookRoot = await mkdtemp(join(tmpdir(), "fusion-managed-launch-test-")); dirs.push(hookRoot);
  let state = "starting";
  const machine = { getState: () => state, markReady: () => { state = "ready"; }, injectPrompt: () => { state = "busy"; }, signalBusy: () => { state = "busy"; } };
  const hub = { issueToken: vi.fn(() => "test-token"), invalidate: vi.fn(), getStateMachine: () => machine } as unknown as TelemetryHub;
  const manager = { spawn: vi.fn(async (_options: unknown) => ({ id: "cli-owned" } as CliSession)), getRuntimeGeneration: () => "runtime-generation",
    inject: vi.fn(async (_id: string, _text: string, _options: unknown) => {}), killOwned: vi.fn(() => true), waitForExit: vi.fn(() => new Promise<{ exitCode: number; signal: number | undefined }>(() => {})) };
  const request = { id: "launch-request", prompt: "Inspect the code", model: "test-model", expiresAt: new Date(Date.now() + 300000).toISOString() } as SessionLaunchRequest;
  return { options: { manager, hub, hookRoot, hookEndpointUrl: "http://127.0.0.1:12345/api/cli-agent/hooks", projectId: "project", projectPath: "/repo" }, request, manager, hub, machine };
}
it("launches the existing adapter with read-only policy, scoped notify, and no task enrollment", async () => {
  const f = await fixture(); const signal = new AbortController().signal;
  expect(await launchObservedCodex(f.options, f.request, signal)).toBe("cli-owned");
  const args = f.manager.spawn.mock.calls[0][0] as { settings: Record<string, unknown>; posture: null };
  expect(args).toMatchObject({ adapterId: "codex", purpose: "chat", taskId: null, projectId: "project", worktreePath: "/repo", posture: { autoApprove: false } });
  const launch = codexAdapter.buildLaunch({ settings: args.settings, posture: args.posture });
  expect(launch.command).toBe("codex"); expect(launch.args).toEqual(expect.arrayContaining(["--sandbox", "read-only", "--ask-for-approval", "never", 'model="test-model"']));
  expect(launch.args).not.toContain("--dangerously-bypass-approvals-and-sandbox");
  expect(await readFile(String(args.settings.notifyProgram), "utf8")).toContain("X-Fusion-Cli-Session-Id: $SESSION_ID");
  expect(f.manager.inject).toHaveBeenCalledWith("cli-owned", f.request.prompt, expect.objectContaining({ generation: "runtime-generation", signal, deadlineMs: expect.any(Number) }));
  expect(f.machine.getState()).toBe("busy"); expect(f.manager.killOwned).not.toHaveBeenCalled();
});
it("kills only its owned generation and cleans private hook files when the initial prompt fails", async () => {
  const f = await fixture(); f.manager.inject.mockRejectedValue(new Error("deadline"));
  await expect(launchObservedCodex(f.options, f.request, new AbortController().signal)).rejects.toThrow("deadline");
  expect(f.manager.killOwned).toHaveBeenCalledWith("cli-owned", "runtime-generation");
  expect(f.hub.invalidate).toHaveBeenCalledWith("cli-owned"); expect(await readdir(f.options.hookRoot)).toEqual([]);
});
it("cancellation before or during spawn cannot deliver an initial prompt", async () => {
  for (const before of [true, false]) {
    const f = await fixture(); const abort = new AbortController();
    if (before) abort.abort(); else f.manager.spawn.mockImplementation(async () => { abort.abort(); return { id: "cli-owned" } as CliSession; });
    await expect(launchObservedCodex(f.options, f.request, abort.signal)).rejects.toThrow("cancelled");
    expect(f.manager.inject).not.toHaveBeenCalled(); expect(await readdir(f.options.hookRoot)).toEqual([]);
    expect(f.manager.killOwned).toHaveBeenCalledTimes(before ? 0 : 1);
  }
});
it("does not turn a delivered initial prompt into a failed launch when the process exits before cleanup subscribes", async () => {
  const f = await fixture(); f.manager.waitForExit.mockImplementation(() => { throw new Error("Session already reaped"); });
  expect(await launchObservedCodex(f.options, f.request, new AbortController().signal)).toBe("cli-owned");
  expect(f.manager.killOwned).not.toHaveBeenCalled();
});
