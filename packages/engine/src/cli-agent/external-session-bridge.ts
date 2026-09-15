import { sessionId as observedSessionId, type CliSession, type CliSessionStore, type ExternalSessionControls, type ExternalSessionStore } from "@fusion/core";
import type { CliSessionManager } from "./session-manager.js";

export interface ExternalSessionBridgeOptions {
  hostId: string; projectId: string; projectPath: string; controlsEnabled: boolean;
  store: Pick<CliSessionStore, "listSessions">;
  manager: Pick<CliSessionManager, "getRuntimeGeneration" | "inject" | "killOwned">;
  observations: Pick<ExternalSessionStore, "get" | "ingest" | "associateNativeRuntime">;
  controls: Pick<ExternalSessionControls, "register" | "claim" | "beginExecution" | "acknowledge">;
  onError?: (error: unknown) => void;
}

/** Reads only this manager's owned handles. Transcript discovery never enters this bridge. */
export class ExternalSessionRuntimeBridge {
  private timer?: ReturnType<typeof setTimeout>;
  private running = false;
  private started = false;
  private stopped = false;
  private cursor = 0;
  private readonly shutdown = new AbortController();
  constructor(private readonly options: ExternalSessionBridgeOptions) {
    if (!/^[a-zA-Z0-9._-]{1,128}$/.test(options.hostId)) throw new Error("Invalid session observation host id");
  }
  start() {
    if (this.started || this.stopped) return;
    this.started = true;
    const run = async () => { await this.tick(); if (!this.stopped) { this.timer = setTimeout(() => void run(), 5000); this.timer.unref(); } };
    void run();
  }
  stop() { this.stopped = true; this.shutdown.abort(); if (this.timer) clearTimeout(this.timer); }
  async tick() {
    if (this.running || this.stopped) return;
    this.running = true;
    try {
      const candidates = this.options.store.listSessions({ projectId: this.options.projectId })
        .filter(row => row.nativeSessionId && ["codex", "claude-code"].includes(row.adapterId) && this.options.manager.getRuntimeGeneration(row.id));
      const identities = new Map<string, number>();
      for (const row of candidates) { const key = `${row.adapterId}:${row.nativeSessionId}`; identities.set(key, (identities.get(key) ?? 0) + 1); }
      // Count every owner before bounding database work, and rotate so larger
      // fleets cannot starve the sessions beyond the first page.
      const start = candidates.length ? this.cursor % candidates.length : 0;
      const page = [...candidates.slice(start), ...candidates.slice(0, start)].slice(0, 32);
      this.cursor = candidates.length ? (start + page.length) % candidates.length : 0;
      for (const row of page) {
        if (this.stopped) break;
        try { await this.sync(row, identities.get(`${row.adapterId}:${row.nativeSessionId}`) === 1); }
        catch (error) { try { this.options.onError?.(error); } catch { /* Visibility cannot disable the runtime. */ } }
      }
    } catch (error) { try { this.options.onError?.(error); } catch { /* Best effort. */ } }
    finally { this.running = false; }
  }
  private async sync(row: CliSession, unambiguous: boolean) {
    const { manager, observations, controls, hostId } = this.options;
    const generation = manager.getRuntimeGeneration(row.id);
    if (!generation || !row.nativeSessionId || row.projectId !== this.options.projectId) return;
    const provider = row.adapterId === "codex" ? "codex" : "claude";
    const identity = observedSessionId(hostId, { provider, nativeSessionId: row.nativeSessionId });
    const stillOwned = () => !this.stopped && manager.getRuntimeGeneration(row.id) === generation;
    if (!await observations.get(identity)) {
      if (!stillOwned()) return;
      await observations.ingest(hostId, "fusion-runtime-1", { version: 1, provider, nativeSessionId: row.nativeSessionId, revision: 0,
        observedAt: row.updatedAt, activity: row.agentState === "busy" || row.agentState === "starting" ? "working" : "waiting",
        title: row.taskId ? `Fusion ${row.taskId}` : "Fusion managed session", projectPath: row.worktreePath ?? this.options.projectPath });
    }
    if (!stillOwned()) return;
    if (unambiguous) await observations.associateNativeRuntime(identity, { cliSessionId: row.id, projectId: row.projectId, taskId: row.taskId });
    if (!stillOwned() || !this.options.controlsEnabled) return;
    // Task-owned sessions retain Fusion's task Pause/Resume controls. Direct
    // process stop is exposed only for independent managed/chat sessions.
    const capabilities = unambiguous ? row.taskId ? ["feedback"] as const : ["feedback", "stop"] as const : [];
    if (!await controls.register(hostId, identity, generation, [...capabilities], Date.now(), "fusion-runtime") || !unambiguous || !stillOwned()) return;
    const commands = await controls.claim(hostId, identity, generation);
    commands.sort((a, b) => Number(b.operation === "stop") - Number(a.operation === "stop"));
    for (const queued of commands) {
      if (!stillOwned()) break;
      if (queued.operation === "feedback" && !["ready", "waitingOnInput"].includes(row.agentState)) continue;
      if (queued.operation !== "feedback" && (queued.operation !== "stop" || row.taskId)) continue;
      const command = await controls.beginExecution(hostId, queued.id, generation);
      if (!command) continue;
      let applied = false;
      try {
        if (!stillOwned() || Date.parse(command.expiresAt) <= Date.now()) throw new Error("Command expired or runtime changed");
        if (command.operation === "stop") applied = manager.killOwned(row.id, generation);
        else {
          await manager.inject(row.id, command.text!, { generation, signal: this.shutdown.signal, deadlineMs: Math.min(Date.parse(command.expiresAt), Date.now() + 2000) });
          applied = true;
        }
      } catch { applied = false; }
      // A failed acknowledgement leaves the execution fence in place. Never
      // inject/stop again to make acknowledgement retry appear successful.
      await controls.acknowledge(hostId, command.id, generation, applied ? "applied" : "failed");
      break; // At most one native action per session/tick; bounded host work.
    }
  }
}
