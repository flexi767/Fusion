import { and, eq, gt, inArray, lt, sql } from "drizzle-orm";
import type { AsyncDataLayer } from "../postgres/data-layer.js";
import { externalSessionCommands as commands, externalSessionRuntimes as runtimes, externalSessions as sessions } from "../postgres/schema/central.js";
export type SessionOperation = "feedback" | "stop" | "resume";
export class ExternalSessionControls {
  constructor(private readonly layer: AsyncDataLayer) {}
  /** Only a separately enabled, authenticated owning host adapter calls this; discovery never does. */
  async register(hostId: string, sessionId: string, generation: string, capabilities: SessionOperation[], now = Date.now()) {
    if (!/^[a-zA-Z0-9-]{16,128}$/.test(generation) || !Array.isArray(capabilities) || !capabilities.every(c => ["feedback", "stop", "resume"].includes(c))) throw new Error("Invalid runtime registration");
    const [session] = await this.layer.db.select().from(sessions).where(and(eq(sessions.id, sessionId), eq(sessions.hostId, hostId)));
    if (!session) throw new Error("Session does not belong to this host");
    await this.layer.db.insert(runtimes).values({ sessionId, generation, capabilities: [...new Set(capabilities)], expiresAt: new Date(now + 90_000).toISOString() })
      .onConflictDoUpdate({ target: runtimes.sessionId, set: { generation, capabilities: [...new Set(capabilities)], expiresAt: new Date(now + 90_000).toISOString() } });
  }
  async capability(sessionId: string, now = Date.now()) {
    const [runtime] = await this.layer.db.select().from(runtimes).where(eq(runtimes.sessionId, sessionId));
    if (!runtime) return null;
    const connected = Date.parse(runtime.expiresAt) > now;
    return { ...runtime, connected, capabilities: connected ? runtime.capabilities : runtime.capabilities.filter(operation => operation === "feedback") };
  }
  async queue(sessionId: string, id: string, operation: SessionOperation, text?: string, now = Date.now()) {
    if (!/^[a-zA-Z0-9-]{16,128}$/.test(id) || !["feedback", "stop", "resume"].includes(operation)) throw new Error("Invalid command");
    if (operation === "feedback" && (typeof text !== "string" || !text.trim() || text.length > 16000)) throw new Error("Feedback must contain 1–16000 characters");
    return this.layer.db.transaction(async tx => {
      await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(${"external-command:" + sessionId}, 0))`);
      const [previous] = await tx.select().from(commands).where(eq(commands.id, id));
      if (previous) {
        if (previous.sessionId !== sessionId || previous.operation !== operation || previous.text !== (text ?? null)) throw new Error("Command identity conflict");
        return previous;
      }
      const [runtime] = await tx.select().from(runtimes).where(and(eq(runtimes.sessionId, sessionId), operation === "feedback" ? undefined : gt(runtimes.expiresAt, new Date(now).toISOString())));
      if (!runtime?.capabilities.includes(operation)) throw new Error("Session does not support this operation");
      const [session] = await tx.select().from(sessions).where(eq(sessions.id, sessionId));
      if (!session) throw new Error("Session not found");
      const queued = await tx.select({ id: commands.id }).from(commands).where(and(eq(commands.sessionId, sessionId), inArray(commands.status, ["queued", "delivered"]), gt(commands.expiresAt, new Date(now).toISOString()))).limit(20);
      if (queued.length >= 20) throw new Error("Session command queue is full");
      const [command] = await tx.insert(commands).values({ id, sessionId, hostId: session.hostId, nativeSessionId: session.nativeSessionId, generation: runtime.generation,
        operation, text: text ?? null, status: "queued", createdAt: new Date(now).toISOString(), updatedAt: new Date(now).toISOString(), expiresAt: new Date(now + 300_000).toISOString() }).returning();
      return command;
    });
  }
  async claim(hostId: string, sessionId: string, generation: string, now = Date.now()) {
    return this.layer.db.transaction(async tx => {
      await tx.update(commands).set({ status: "expired", updatedAt: new Date(now).toISOString() }).where(and(eq(commands.hostId, hostId), inArray(commands.status, ["queued", "delivered"]), lt(commands.expiresAt, new Date(now).toISOString())));
      const [runtime] = await tx.select().from(runtimes).where(eq(runtimes.sessionId, sessionId));
      if (runtime?.generation !== generation) return [];
      // Delivered commands are replayed with the same id. The adapter's durable ledger fences application.
      const rows = await tx.select().from(commands).where(and(eq(commands.hostId, hostId), eq(commands.sessionId, sessionId), eq(commands.generation, generation), inArray(commands.status, ["queued", "delivered"]), gt(commands.expiresAt, new Date(now).toISOString()))).orderBy(commands.createdAt).limit(20);
      if (rows.length) await tx.update(commands).set({ status: "delivered", updatedAt: new Date(now).toISOString() }).where(inArray(commands.id, rows.map(row => row.id)));
      return rows.map(row => ({ ...row, status: "delivered" }));
    });
  }
  async acknowledge(hostId: string, id: string, generation: string, status: "applied" | "failed", now = Date.now()) {
    if (status !== "applied" && status !== "failed") throw new Error("Invalid command outcome");
    const rows = await this.layer.db.update(commands).set({ status, updatedAt: new Date(now).toISOString() }).where(and(eq(commands.id, id), eq(commands.hostId, hostId), eq(commands.generation, generation), eq(commands.status, "delivered"), gt(commands.expiresAt, new Date(now).toISOString()))).returning();
    if (rows.length) return true;
    const [previous] = await this.layer.db.select().from(commands).where(and(eq(commands.id, id), eq(commands.hostId, hostId), eq(commands.generation, generation), eq(commands.status, status)));
    return Boolean(previous);
  }
  async list(sessionId: string) { return this.layer.db.select().from(commands).where(eq(commands.sessionId, sessionId)).orderBy(commands.createdAt).limit(100); }
}
