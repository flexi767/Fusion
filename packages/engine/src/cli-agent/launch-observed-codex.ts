import { mkdir, mkdtemp } from "node:fs/promises";
import { join } from "node:path";
import type { SessionLaunchRequest } from "@fusion/core";
import type { CliSessionManager } from "./session-manager.js";
import type { TelemetryHub } from "./telemetry-hub.js";
import { cleanupSessionHookDir, HOOK_SCRIPT_NAMES, writeSessionHookScripts } from "./hook-scripts.js";

export function markObservedPromptInjected(hub: TelemetryHub, sessionId: string) {
  const machine = hub.getStateMachine(sessionId);
  if (!machine) return;
  try {
    if (machine.getState() === "starting") machine.markReady();
    if (["ready", "done"].includes(machine.getState())) machine.injectPrompt();
    else if (machine.getState() === "waitingOnInput") machine.signalBusy();
  } catch { /* A native event may already have advanced the state. */ }
}

/** Reuses Fusion's PTY manager and session-scoped notify shim. Never enrolls a task. */
export async function launchObservedCodex(options: {
  manager: Pick<CliSessionManager, "spawn" | "getRuntimeGeneration" | "inject" | "killOwned" | "waitForExit">;
  hub: TelemetryHub; hookRoot: string; hookEndpointUrl: string; projectId: string; projectPath: string;
}, request: SessionLaunchRequest, signal: AbortSignal): Promise<string> {
  const deadlineMs = Math.min(Date.parse(request.expiresAt), Date.now() + 30000);
  const check = () => { if (signal.aborted || !Number.isFinite(deadlineMs) || deadlineMs <= Date.now()) throw new Error("Launch cancelled or expired"); };
  check();
  await mkdir(options.hookRoot, { recursive: true, mode: 0o700 });
  const hookDir = await mkdtemp(join(options.hookRoot, "launch-"));
  let sessionId: string | undefined; let generation: string | undefined;
  const clean = async () => { if (sessionId) options.hub.invalidate(sessionId); await cleanupSessionHookDir(hookDir); };
  try {
    check();
    const record = await options.manager.spawn({ adapterId: "codex", projectId: options.projectId, purpose: "chat", taskId: null, signal, deadlineMs,
      worktreePath: options.projectPath, posture: { autoApprove: false },
      settings: { model: request.model ?? undefined, notifyProgram: join(hookDir, HOOK_SCRIPT_NAMES.notify), extraArgs: ["--sandbox", "read-only", "--ask-for-approval", "never"] } });
    sessionId = record.id; generation = options.manager.getRuntimeGeneration(record.id);
    check(); if (!generation) throw new Error("Launched session exited");
    const token = options.hub.issueToken(record.id);
    await writeSessionHookScripts({ sessionId: record.id, token, endpointUrl: options.hookEndpointUrl, dir: hookDir });
    check();
    await options.manager.inject(record.id, request.prompt, { generation, signal, deadlineMs });
    markObservedPromptInjected(options.hub, record.id);
    // The manager owns the process. Cleanup is scoped to this launch's token
    // and private hook directory, including normal exit and engine shutdown.
    void Promise.resolve().then(() => options.manager.waitForExit(record.id)).then(clean, clean).catch(() => {});
    return record.id;
  } catch (error) {
    if (sessionId && generation) options.manager.killOwned(sessionId, generation);
    await clean().catch(() => {});
    throw error;
  }
}
