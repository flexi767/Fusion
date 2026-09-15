import { captureSessionPrice, usagePriceKey } from "./rate-snapshot.js";
import type { ModelPricingOverrides } from "../ai/model-pricing.js";
import { createHash } from "node:crypto";
import { and, getTableColumns, desc, eq, lt, or, sql } from "drizzle-orm";
import type { AsyncDataLayer } from "../postgres/data-layer.js";
import { externalSessions, externalSessionTurns, externalSessionDetails, sessionCollectors } from "../postgres/schema/central.js";
import { parseImportedSessionMetadata } from "./imported-metadata.js";
import { parseSessionTurn } from "./turn.js";
import { redactSecrets } from "../secrets/redact-secrets.js";
import { externalSessionKey, parseSessionObservation, type SessionObservation } from "./observation.js";

export function sessionId(hostId: string, row: Pick<SessionObservation, "provider" | "nativeSessionId">): string {
  return createHash("sha256").update(externalSessionKey(hostId, row.provider, row.nativeSessionId)).digest("hex");
}

function cursor(value: string | undefined): { at: string; id: string } | undefined {
  if (!value) return undefined;
  try {
    const parsed = JSON.parse(Buffer.from(value, "base64url").toString());
    if (typeof parsed.at !== "string" || !Number.isFinite(Date.parse(parsed.at)) || typeof parsed.id !== "string" || parsed.id.length > 256) throw new Error();
    return parsed;
  } catch { throw new Error("Invalid history cursor"); }
}
function nextCursor(at: string, id: string) { return Buffer.from(JSON.stringify({ at, id })).toString("base64url"); }

/** Acknowledgements are returned only after the transaction commits. */
export class ExternalSessionStore {
  constructor(private readonly layer: AsyncDataLayer) {}

  async heartbeat(hostId: string, collectorVersion: string, now = new Date().toISOString(), diagnostics: Record<string, number | boolean> = {}) {
    await this.layer.db.insert(sessionCollectors).values({ hostId, collectorVersion, lastHeartbeatAt: now, diagnostics })
      .onConflictDoUpdate({ target: sessionCollectors.hostId, set: { collectorVersion, lastHeartbeatAt: now, diagnostics } });
  }

  async ingest(hostId: string, collectorVersion: string, value: unknown, turnValues: unknown[] = [], historical = false, importedNotes?: string, importedValue?: unknown, pricingOverrides?: ModelPricingOverrides | null) {
    if (!Array.isArray(turnValues) || turnValues.length > 25) throw new Error("Invalid turn batch");
    if (importedNotes !== undefined && (typeof importedNotes !== "string" || importedNotes.length > 32000)) throw new Error("Invalid imported notes");
    const importedMetadata = historical && importedValue !== undefined ? parseImportedSessionMetadata(importedValue) : undefined;
    const turns = turnValues.map(parseSessionTurn);
    if (historical) for (const turn of turns) turn.provenance = "agentpulse-import";
    const observation = parseSessionObservation(value);
    observation.title = redactSecrets(observation.title);
    if (historical) observation.revision = 0;
    const id = sessionId(hostId, observation);
    const receivedAt = new Date().toISOString();
    return this.layer.db.transaction(async (tx) => {
      if (historical) {
        await tx.insert(sessionCollectors).values({ hostId, collectorVersion, lastHeartbeatAt: null }).onConflictDoNothing();
      } else {
        await tx.insert(sessionCollectors).values({ hostId, collectorVersion, lastHeartbeatAt: receivedAt, lastAcknowledgementAt: receivedAt })
          .onConflictDoUpdate({ target: sessionCollectors.hostId, set: { collectorVersion, lastHeartbeatAt: receivedAt, lastAcknowledgementAt: receivedAt } });
      }
      const applied = await tx.insert(externalSessions).values({ id, hostId, provider: observation.provider,
        nativeSessionId: observation.nativeSessionId, revision: observation.revision, observation, receivedAt })
        .onConflictDoUpdate({ target: externalSessions.id, set: { revision: observation.revision, observation, receivedAt },
          setWhere: historical ? sql`false` : lt(externalSessions.revision, observation.revision) }).returning({ id: externalSessions.id });
      const [current] = await tx.select().from(externalSessions).where(eq(externalSessions.id, id));
      if (!historical && current.revision === observation.revision && JSON.stringify(current.observation) !== JSON.stringify(observation)) {
        // jsonb reorders keys; compare the validated canonical representation.
        if (JSON.stringify(parseSessionObservation(current.observation)) !== JSON.stringify(observation)) throw new Error("Observation revision conflict");
      }
      for (const result of turns) {
        const [previous] = await tx.select({ result: externalSessionTurns.result }).from(externalSessionTurns)
          .where(and(eq(externalSessionTurns.sessionId, id), eq(externalSessionTurns.id, result.id)));
        result.recordedPricing = result.usage.map(usage => captureSessionPrice(observation.provider, usage, result.startedAt, receivedAt, pricingOverrides,
          previous?.result.recordedPricing?.find(price => price.usageKey === usagePriceKey(usage))));
        await tx.insert(externalSessionTurns).values({ sessionId: id, id: result.id, revision: observation.revision, startedAt: result.startedAt, result })
          .onConflictDoUpdate({ target: [externalSessionTurns.sessionId, externalSessionTurns.id],
            set: { revision: observation.revision, startedAt: result.startedAt, result },
            setWhere: historical
              ? sql`${externalSessionTurns.result}->>'updatedAt' < ${result.updatedAt}`
              : and(lt(externalSessionTurns.revision, observation.revision), sql`(
                  ${externalSessionTurns.result}->>'updatedAt' < ${result.updatedAt}
                  OR (${externalSessionTurns.result}->>'provenance' = 'native-transcript' AND ${externalSessionTurns.result}->>'updatedAt' = ${result.updatedAt})
                )`) });
      }
      if (historical && importedNotes) {
        await tx.insert(externalSessionDetails).values({ sessionId: id, notes: redactSecrets(importedNotes), notesRevision: 1 })
          .onConflictDoUpdate({ target: externalSessionDetails.sessionId, set: { notes: redactSecrets(importedNotes), notesRevision: 1 }, setWhere: eq(externalSessionDetails.notesRevision, 0) });
      }
      if (importedMetadata) {
        await tx.insert(externalSessionDetails).values({ sessionId: id, importedMetadata, archived: importedMetadata.archived, pinned: importedMetadata.pinned })
          .onConflictDoUpdate({ target: externalSessionDetails.sessionId, set: { importedMetadata,
            archived: sql`CASE WHEN ${externalSessionDetails.preferencesRevision}=0 THEN ${importedMetadata.archived} ELSE ${externalSessionDetails.archived} END`,
            pinned: sql`CASE WHEN ${externalSessionDetails.preferencesRevision}=0 THEN ${importedMetadata.pinned} ELSE ${externalSessionDetails.pinned} END` } });
      }
      return { id, revision: current.revision, applied: applied.length > 0 };
    });
  }

  async list(query: { hostId?: string; provider?: string; activity?: string; q?: string; saved?: string; before?: string; limit?: number } = {}) {
    if (query.q && query.q.length > 256) throw new Error("Invalid session search");
    const search = query.q?.trim();
    const limit = Math.max(1, Math.min(100, query.limit ?? 50));
    const before = cursor(query.before);
    const rows = await this.layer.db.select({ ...getTableColumns(externalSessions), archived: externalSessionDetails.archived, pinned: externalSessionDetails.pinned }).from(externalSessions).leftJoin(externalSessionDetails, eq(externalSessionDetails.sessionId, externalSessions.id)).where(and(
      query.saved === "archived" ? eq(externalSessionDetails.archived, true) : query.saved === "pinned" ? eq(externalSessionDetails.pinned, true) : undefined,
      query.hostId ? eq(externalSessions.hostId, query.hostId) : undefined,
      query.provider ? eq(externalSessions.provider, query.provider) : undefined,
      query.activity ? sql`${externalSessions.observation}->>'activity' = ${query.activity}` : undefined,
      search ? sql`(jsonb_to_tsvector('simple', ${externalSessions.observation}, '["string"]'::jsonb) @@ plainto_tsquery('simple', ${search}) OR EXISTS (
        SELECT 1 FROM central.external_session_turns AS searched_turn
        WHERE searched_turn.session_id = ${externalSessions.id}
        AND jsonb_to_tsvector('simple', searched_turn.result, '["string"]'::jsonb) @@ plainto_tsquery('simple', ${search})
      ))` : undefined,
      before ? or(lt(externalSessions.receivedAt, before.at), and(eq(externalSessions.receivedAt, before.at), lt(externalSessions.id, before.id))) : undefined,
    )).orderBy(desc(externalSessions.receivedAt), desc(externalSessions.id)).limit(limit + 1);
    return { sessions: rows.slice(0, limit), nextCursor: rows.length > limit ? nextCursor(rows[limit - 1].receivedAt, rows[limit - 1].id) : null };
  }

  async preferences(id: string, archived: boolean, pinned: boolean, expectedRevision: number) {
    if (typeof archived !== "boolean" || typeof pinned !== "boolean" || !Number.isSafeInteger(expectedRevision) || expectedRevision < 0) throw new Error("Invalid session preferences");
    return this.layer.db.transaction(async tx => {
      await tx.insert(externalSessionDetails).values({ sessionId: id }).onConflictDoNothing();
      const [row] = await tx.update(externalSessionDetails).set({ archived, pinned, preferencesRevision: expectedRevision + 1 })
        .where(and(eq(externalSessionDetails.sessionId, id), eq(externalSessionDetails.preferencesRevision, expectedRevision))).returning();
      if (!row) throw new Error("Session preferences revision conflict");
      return row;
    });
  }

  async get(id: string) {
    const [row] = await this.layer.db.select().from(externalSessions).where(eq(externalSessions.id, id));
    return row ?? null;
  }

  async turn(sessionId: string, turnId: string) {
    const [row] = await this.layer.db.select().from(externalSessionTurns).where(and(eq(externalSessionTurns.sessionId, sessionId), eq(externalSessionTurns.id, turnId)));
    return row?.result ?? null;
  }

  async turns(id: string, beforeValue?: string, requestedLimit = 20, requestedBytes = 8 * 1024 * 1024) {
    const limit = Math.min(50, Math.max(1, requestedLimit));
    const before = cursor(beforeValue);
    const rows = await this.layer.db.select().from(externalSessionTurns).where(and(eq(externalSessionTurns.sessionId, id),
      before ? or(lt(externalSessionTurns.startedAt, before.at), and(eq(externalSessionTurns.startedAt, before.at), lt(externalSessionTurns.id, before.id))) : undefined))
      .orderBy(desc(externalSessionTurns.startedAt), desc(externalSessionTurns.id)).limit(limit + 1);
    const selected = []; let bytes = 0;
    const budget = Math.max(1, Math.min(8 * 1024 * 1024, requestedBytes));
    for (const row of rows.slice(0, limit)) {
      const size = Buffer.byteLength(JSON.stringify(row.result));
      if (selected.length && bytes + size > budget) break;
      selected.push(row); bytes += size;
    }
    const last = selected.at(-1);
    return { turns: selected.map(row => row.result), nextCursor: last && rows.length > selected.length ? nextCursor(last.startedAt, last.id) : null };
  }

  async collectors() {
    return this.layer.db.select().from(sessionCollectors).orderBy(sessionCollectors.hostId);
  }
}
