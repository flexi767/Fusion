import { and, desc, eq, gt, inArray, sql } from "drizzle-orm";
import type { AsyncDataLayer } from "../postgres/data-layer.js";
import { externalSessionLaunches as requests, externalSessionLaunchRuntimes as runtimes } from "../postgres/schema/central.js";

export type SessionLaunchRequest = typeof requests.$inferSelect;
export type SessionLaunchRuntime = typeof runtimes.$inferSelect;
const validId = (value: unknown): value is string => typeof value === "string" && /^[a-zA-Z0-9._-]{1,128}$/.test(value);
/** Independent read-only Codex launches. No task creation or arbitrary executable/cwd input. */
export class ExternalSessionLaunches {
  constructor(private readonly layer: AsyncDataLayer) {}
  async register(hostId: string, projectId: string, generation: string, projectPath: string, now = Date.now()) {
    if (![hostId, projectId, generation].every(validId) || generation.length < 16 || !projectPath.startsWith("/") || projectPath.length > 4096) throw new Error("Invalid launch runtime");
    const rows = await this.layer.db.insert(runtimes).values({ hostId, projectId, generation, projectPath, expiresAt: new Date(now + 90000).toISOString() })
      .onConflictDoUpdate({ target: [runtimes.hostId, runtimes.projectId], set: { generation, projectPath, expiresAt: new Date(now + 90000).toISOString() },
        setWhere: sql`${runtimes.generation}=${generation} OR ${runtimes.expiresAt}<=${new Date(now).toISOString()}` }).returning();
    return rows.length > 0;
  }
  async available(now = Date.now()) {
    return this.layer.db.select().from(runtimes).where(gt(runtimes.expiresAt, new Date(now).toISOString())).orderBy(runtimes.hostId, runtimes.projectId).limit(100);
  }
  async owns(hostId: string, projectId: string, generation: string, now = Date.now()) {
    const [row] = await this.layer.db.select().from(runtimes).where(and(eq(runtimes.hostId, hostId), eq(runtimes.projectId, projectId), eq(runtimes.generation, generation), gt(runtimes.expiresAt, new Date(now).toISOString())));
    return Boolean(row);
  }
  async queue(input: { id: string; hostId: string; projectId: string; generation: string; prompt: string; model?: string | null }, now = Date.now()) {
    if (![input.id, input.hostId, input.projectId, input.generation].every(validId) || input.id.length < 16 || typeof input.prompt !== "string" || !input.prompt.trim() || input.prompt.length > 16000
      || (input.model != null && (typeof input.model !== "string" || !/^[a-zA-Z0-9._:/-]{1,128}$/.test(input.model)))) throw new Error("Invalid launch request");
    const model = input.model ?? null;
    return this.layer.db.transaction(async tx => {
      await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(${"external-launch:" + input.hostId},0))`);
      const [previous] = await tx.select().from(requests).where(eq(requests.id, input.id));
      if (previous) {
        if (previous.hostId !== input.hostId || previous.projectId !== input.projectId || previous.generation !== input.generation || previous.prompt !== input.prompt || previous.model !== model) throw new Error("Launch identity conflict");
        return previous;
      }
      const [runtime] = await tx.select().from(runtimes).where(and(eq(runtimes.hostId, input.hostId), eq(runtimes.projectId, input.projectId), eq(runtimes.generation, input.generation), gt(runtimes.expiresAt, new Date(now).toISOString())));
      if (!runtime) throw new Error("Launch runtime is disconnected or changed");
      const pending = await tx.select({ id: requests.id }).from(requests).where(and(eq(requests.hostId, input.hostId), inArray(requests.status, ["queued", "starting"]), gt(requests.expiresAt, new Date(now).toISOString()))).limit(5);
      if (pending.length >= 5) throw new Error("Host launch queue is full");
      const [row] = await tx.insert(requests).values({ ...input, model, status: "queued", createdAt: new Date(now).toISOString(), updatedAt: new Date(now).toISOString(), expiresAt: new Date(now + 300000).toISOString() }).returning();
      return row;
    });
  }
  /** Durable one-shot claim. Starting requests are never automatically replayed. */
  async begin(hostId: string, projectId: string, generation: string, now = Date.now()) {
    return this.layer.db.transaction(async tx => {
      const [row] = await tx.select().from(requests).where(and(eq(requests.hostId, hostId), eq(requests.projectId, projectId), eq(requests.generation, generation), eq(requests.status, "queued"), gt(requests.expiresAt, new Date(now).toISOString()),
        sql`EXISTS (SELECT 1 FROM central.external_session_launch_runtimes r WHERE r.host_id=${hostId} AND r.project_id=${projectId} AND r.generation=${generation} AND r.expires_at>${new Date(now).toISOString()})`)).orderBy(requests.createdAt, requests.id).limit(1).for("update", { skipLocked: true });
      if (!row) return null;
      const [claimed] = await tx.update(requests).set({ status: "starting", updatedAt: new Date(now).toISOString() }).where(eq(requests.id, row.id)).returning();
      return claimed;
    });
  }
  async finish(hostId: string, projectId: string, generation: string, id: string, outcome: { status: "started" | "failed"; cliSessionId?: string }, now = Date.now()) {
    if (!["started", "failed"].includes(outcome.status) || (outcome.status === "started" && !validId(outcome.cliSessionId))) throw new Error("Invalid launch outcome");
    const rows = await this.layer.db.update(requests).set({ status: outcome.status, cliSessionId: outcome.cliSessionId ?? null, failure: outcome.status === "failed" ? "Launch or initial prompt failed; inspect the owning runtime" : null, updatedAt: new Date(now).toISOString() })
      .where(and(eq(requests.id, id), eq(requests.hostId, hostId), eq(requests.projectId, projectId), eq(requests.generation, generation), eq(requests.status, "starting"))).returning();
    if (rows.length) return true;
    const [previous] = await this.layer.db.select().from(requests).where(and(eq(requests.id, id), eq(requests.hostId, hostId), eq(requests.projectId, projectId), eq(requests.generation, generation), eq(requests.status, outcome.status)));
    return Boolean(previous && previous.cliSessionId === (outcome.cliSessionId ?? null));
  }
  async cancel(id: string, hostId: string, now = Date.now()) {
    const rows = await this.layer.db.update(requests).set({ status: "cancelled", updatedAt: new Date(now).toISOString() }).where(and(eq(requests.id, id), eq(requests.hostId, hostId), eq(requests.status, "queued"))).returning();
    return rows.length > 0;
  }
  async list(now = Date.now()) {
    const rows = await this.layer.db.select().from(requests).orderBy(desc(requests.createdAt), desc(requests.id)).limit(100);
    return rows.map(row => ({ ...row, status: Date.parse(row.expiresAt) <= now ? row.status === "queued" ? "expired" : row.status === "starting" ? "unconfirmed after interruption" : row.status : row.status }));
  }
}
