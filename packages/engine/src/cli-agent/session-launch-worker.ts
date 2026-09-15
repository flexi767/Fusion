import { randomUUID } from "node:crypto";
import type { ExternalSessionLaunches, SessionLaunchRequest } from "@fusion/core";

export interface SessionLaunchWorkerOptions {
  hostId: string; projectId: string; projectPath: string;
  requests: Pick<ExternalSessionLaunches, "register" | "begin" | "owns" | "finish">;
  launch: (request: SessionLaunchRequest, signal: AbortSignal) => Promise<string>;
  onError?: (error: unknown) => void;
}
/** One durable launch at a time; no restart or timeout can replay a claimed launch. */
export class SessionLaunchWorker {
  private readonly generation = randomUUID();
  private readonly shutdown = new AbortController();
  private timer?: ReturnType<typeof setTimeout>;
  private started = false;
  private running = false;
  constructor(private readonly options: SessionLaunchWorkerOptions) {}
  start() {
    if (this.started || this.shutdown.signal.aborted) return;
    this.started = true;
    const run = async () => { await this.tick(); if (!this.shutdown.signal.aborted) { this.timer = setTimeout(() => void run(), 5000); this.timer.unref(); } };
    void run();
  }
  stop() { this.shutdown.abort(); if (this.timer) clearTimeout(this.timer); }
  async tick() {
    if (this.running || this.shutdown.signal.aborted) return;
    this.running = true;
    const { hostId, projectId, projectPath, requests } = this.options;
    try {
      if (!await requests.register(hostId, projectId, this.generation, projectPath) || this.shutdown.signal.aborted) return;
      const request = await requests.begin(hostId, projectId, this.generation);
      if (!request) return;
      let cliSessionId: string | undefined;
      try {
        if (this.shutdown.signal.aborted || Date.parse(request.expiresAt) <= Date.now() || !await requests.owns(hostId, projectId, this.generation) || this.shutdown.signal.aborted) throw new Error("Launch expired or runtime stopped");
        cliSessionId = await this.options.launch(request, this.shutdown.signal);
      } catch (error) { this.report(error); }
      // This is outside the launch catch: an ACK failure must never stop a
      // successfully launched session or cause the launch to be retried.
      await requests.finish(hostId, projectId, this.generation, request.id, { status: cliSessionId ? "started" : "failed", cliSessionId });
    } catch (error) { this.report(error); }
    finally { this.running = false; }
  }
  private report(error: unknown) { try { this.options.onError?.(error); } catch { /* Best effort. */ } }
}
