import { and, asc, eq, inArray, sql } from "drizzle-orm";
import type { AsyncDataLayer } from "../postgres/data-layer.js";
import { externalSessions as sessions, externalSessionTurns as turns, externalSessionDetails as details } from "../postgres/schema/central.js";
import type { SessionTurn } from "./turn.js";

const BATCH = 25;
export function pruneSessionContent(turn: SessionTurn, marker: { at: string; through: string }): SessionTurn {
  return { ...turn, contentPruned: marker, prompts: [], response: "",
    files: turn.files.map(file => ({ ...file, diff: "", available: false, truncated: true })) };
}

/** Operator-triggered only. Accounting, identities, native files and notes are retained. */
export class ExternalSessionRetention {
  constructor(private readonly layer: AsyncDataLayer) {}
  private cutoff(value: string, now: number) {
    const parsed = Date.parse(value);
    if (typeof value !== "string" || !Number.isFinite(parsed) || parsed > now - 86_400_000 || parsed < now - 3660 * 86_400_000) throw new Error("Retention cutoff must be between one day and ten years ago");
    return new Date(parsed).toISOString();
  }
  private eligible(cutoff: string) {
    return and(sql`${turns.result}->>'updatedAt' < ${cutoff}`, sql`${turns.result}->'contentPruned' IS NULL`,
      sql`${sessions.observation}->>'observedAt' < ${cutoff}`, sql`coalesce(${details.pinned}, false) = false`, sql`${details.taskId} IS NULL`, sql`${details.taskProjectId} IS NULL`);
  }
  async preview(value: string, now = Date.now()) {
    const cutoff = this.cutoff(value, now);
    const rows = await this.layer.db.select({ sessionId: turns.sessionId, id: turns.id }).from(turns)
      .innerJoin(sessions, eq(sessions.id, turns.sessionId)).leftJoin(details, eq(details.sessionId, turns.sessionId))
      .where(this.eligible(cutoff)).orderBy(asc(turns.sessionId), asc(turns.id)).limit(BATCH + 1);
    return { cutoff, eligibleTurns: Math.min(BATCH, rows.length), moreAvailable: rows.length > BATCH, batchLimit: BATCH };
  }
  async apply(value: string, now = Date.now()) {
    const cutoff = this.cutoff(value, now);
    const removed = await this.layer.db.transaction(async tx => {
      const candidates = await tx.select({ sessionId: turns.sessionId, id: turns.id }).from(turns)
        .innerJoin(sessions, eq(sessions.id, turns.sessionId)).leftJoin(details, eq(details.sessionId, turns.sessionId))
        .where(this.eligible(cutoff)).orderBy(asc(turns.sessionId), asc(turns.id)).limit(BATCH);
      let count = 0;
      for (const id of [...new Set(candidates.map(row => row.sessionId))].sort()) {
        // Same lock order as ingestion. Preferences/links are rechecked under their row lock.
        const [session] = await tx.select().from(sessions).where(eq(sessions.id, id)).for("update");
        if (!session || session.observation.observedAt >= cutoff) continue;
        await tx.insert(details).values({ sessionId: id }).onConflictDoNothing();
        const [detail] = await tx.select().from(details).where(eq(details.sessionId, id)).for("update");
        if (detail.pinned || detail.taskId || detail.taskProjectId) continue;
        const rows = await tx.select().from(turns).where(and(eq(turns.sessionId, id), inArray(turns.id, candidates.filter(row => row.sessionId === id).map(row => row.id)))).for("update");
        let changed = false;
        for (const row of rows) {
          if (row.result.updatedAt >= cutoff || row.result.contentPruned) continue;
          await tx.update(turns).set({ result: pruneSessionContent(row.result, { at: new Date(now).toISOString(), through: row.result.updatedAt }) })
            .where(and(eq(turns.sessionId, id), eq(turns.id, row.id)));
          count++; changed = true;
        }
        if (changed) await tx.update(details).set({ summary: null, summaryHash: null, summaryLeaseUntil: null, summaryRetryAt: null, summaryFailures: 0, lastSummaryError: null }).where(eq(details.sessionId, id));
      }
      return count;
    });
    return { removedContentTurns: removed, ...await this.preview(cutoff, now) };
  }
}
