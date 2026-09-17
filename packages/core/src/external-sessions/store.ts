import { and, asc, eq, gt, sql } from "drizzle-orm";
import type { AsyncDataLayer } from "../postgres/data-layer.js";
import { externalSessionCollectors, externalSessionStreams, externalSessionReceipts, externalSessions } from "../postgres/schema/central.js";
import { redactSecrets } from "../secrets/redact-secrets.js";
import {
  ExternalSessionConflictError, ExternalSessionValidationError, ExternalSessionCapacityError, externalCollectorConnection,
  EXTERNAL_SESSION_DELIVERY_LIMIT, EXTERNAL_SESSION_COUNT_LIMIT, EXTERNAL_SESSION_STREAM_LIMIT,
  externalSessionDigest, externalSessionId, externalSessionIdentifier, parseExternalSessionDelivery,
  type ExternalSessionAcknowledgement,
} from "./contract.js";

export class ExternalSessionStore {
  constructor(private readonly layer: AsyncDataLayer) {}

  /**
   * FNXC:ExternalSessions 2026-09-17-04:01:
   * Commit receipts, cursors and snapshots atomically before acknowledging.
   * Serialize each authenticated host across processes; accepted replay returns
   * its original receipt and never freshens heartbeat or overwrites newer state.
   * Capacity refusal preserves receipts until a coordinated retention protocol exists.
   */
  async ingest(hostId: string, value: unknown, receivedAt = new Date().toISOString()): Promise<ExternalSessionAcknowledgement> {
    externalSessionIdentifier(hostId, "hostId");
    const delivery = parseExternalSessionDelivery(value);
    const payloadHash = externalSessionDigest(delivery);
    if (!Number.isFinite(Date.parse(receivedAt)) || new Date(receivedAt).toISOString() !== receivedAt) {
      throw new ExternalSessionValidationError("Invalid receivedAt");
    }
    return this.layer.transaction(async tx => {
      await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(${`external-session:${hostId}`}, 0))`);
      const [receipt] = await tx.select().from(externalSessionReceipts).where(and(
        eq(externalSessionReceipts.hostId, hostId), eq(externalSessionReceipts.eventId, delivery.eventId),
      ));
      if (receipt) {
        if (receipt.payloadHash !== payloadHash) throw new ExternalSessionConflictError("Event identity conflict");
        return receipt.acknowledgement;
      }
      const [collector] = await tx.select().from(externalSessionCollectors).where(eq(externalSessionCollectors.hostId, hostId));
      if ((collector?.acceptedDeliveries ?? 0) >= EXTERNAL_SESSION_DELIVERY_LIMIT) {
        throw new ExternalSessionCapacityError("Collector delivery capacity reached");
      }
      const [stream] = await tx.select().from(externalSessionStreams).where(and(
        eq(externalSessionStreams.hostId, hostId), eq(externalSessionStreams.streamId, delivery.streamId),
      ));
      if (delivery.sequence !== (stream?.acknowledgedSequence ?? 0) + 1) {
        throw new ExternalSessionConflictError("Delivery sequence must follow the durable acknowledgement");
      }
      if (!stream && (collector?.streamCount ?? 0) >= EXTERNAL_SESSION_STREAM_LIMIT) {
        throw new ExternalSessionCapacityError("Collector stream capacity reached");
      }
      let sessionId: string | null = null;
      let createdSession = false;
      let outcome: ExternalSessionAcknowledgement["outcome"] = "heartbeat";
      if (delivery.observation) {
        const observation = delivery.observation;
        sessionId = externalSessionId(hostId, observation.provider, observation.nativeSessionId);
        const observationHash = externalSessionDigest(observation);
        const [current] = await tx.select().from(externalSessions).where(eq(externalSessions.id, sessionId));
        createdSession = !current;
        if (createdSession && (collector?.sessionCount ?? 0) >= EXTERNAL_SESSION_COUNT_LIMIT) {
          throw new ExternalSessionCapacityError("Collector session capacity reached");
        }
        if (current && current.revision === observation.revision && current.observationHash !== observationHash) {
          throw new ExternalSessionConflictError("Observation revision conflict");
        }
        outcome = current && current.revision > observation.revision ? "stale"
          : current?.revision === observation.revision ? "unchanged" : "applied";
        if (outcome === "applied") {
          const snapshot = { ...observation, title: redactSecrets(observation.title),
            projectPath: observation.projectPath === null ? null : redactSecrets(observation.projectPath) };
          await tx.insert(externalSessions).values({ id: sessionId, hostId, provider: observation.provider,
            nativeSessionId: observation.nativeSessionId, revision: observation.revision, observation: snapshot,
            observationHash, receivedAt }).onConflictDoUpdate({ target: externalSessions.id,
            set: { revision: observation.revision, observation: snapshot, observationHash, receivedAt } });
        }
      }
      const acknowledgement: ExternalSessionAcknowledgement = {
        hostId, eventId: delivery.eventId, streamId: delivery.streamId, sequence: delivery.sequence,
        acknowledged: true, sessionId, outcome,
      };
      await tx.insert(externalSessionCollectors).values({ hostId, collectorVersion: delivery.collectorVersion,
        lastAcknowledgementAt: receivedAt, lastHeartbeatAt: delivery.kind === "heartbeat" ? receivedAt : null,
        acceptedDeliveries: (collector?.acceptedDeliveries ?? 0) + 1,
        sessionCount: (collector?.sessionCount ?? 0) + Number(createdSession),
        streamCount: (collector?.streamCount ?? 0) + Number(!stream),
      }).onConflictDoUpdate({ target: externalSessionCollectors.hostId, set: {
        collectorVersion: delivery.collectorVersion, lastAcknowledgementAt: receivedAt,
        acceptedDeliveries: (collector?.acceptedDeliveries ?? 0) + 1,
        sessionCount: (collector?.sessionCount ?? 0) + Number(createdSession),
        streamCount: (collector?.streamCount ?? 0) + Number(!stream),
        ...(delivery.kind === "heartbeat" ? { lastHeartbeatAt: receivedAt } : {}),
      } });
      await tx.insert(externalSessionStreams).values({ hostId, streamId: delivery.streamId, acknowledgedSequence: delivery.sequence })
        .onConflictDoUpdate({ target: [externalSessionStreams.hostId, externalSessionStreams.streamId],
          set: { acknowledgedSequence: delivery.sequence } });
      await tx.insert(externalSessionReceipts).values({ hostId, eventId: delivery.eventId, streamId: delivery.streamId,
        sequence: delivery.sequence, payloadHash, acknowledgement, receivedAt });
      return acknowledgement;
    });
  }

  async list(query: { hostId?: string; provider?: string; after?: string; limit?: number } = {}) {
    if (query.hostId !== undefined) externalSessionIdentifier(query.hostId, "hostId");
    if (query.provider !== undefined) externalSessionIdentifier(query.provider, "provider");
    if (query.after !== undefined && !/^[a-f0-9]{64}$/.test(query.after)) throw new ExternalSessionValidationError("Invalid cursor");
    const limit = query.limit ?? 50;
    if (!Number.isInteger(limit) || limit < 1 || limit > 100) throw new ExternalSessionValidationError("Invalid limit");
    const rows = await this.layer.db.select({ id: externalSessions.id, hostId: externalSessions.hostId,
      observation: externalSessions.observation, receivedAt: externalSessions.receivedAt,
    }).from(externalSessions).where(and(
      query.hostId ? eq(externalSessions.hostId, query.hostId) : undefined,
      query.provider ? eq(externalSessions.provider, query.provider) : undefined,
      query.after ? gt(externalSessions.id, query.after) : undefined,
    )).orderBy(asc(externalSessions.id)).limit(limit + 1);
    return { sessions: rows.slice(0, limit), nextCursor: rows.length > limit ? rows[limit - 1].id : null };
  }

  async collectors(nowMs = Date.now()) {
    const rows = await this.layer.db.select().from(externalSessionCollectors).orderBy(asc(externalSessionCollectors.hostId)).limit(100);
    return rows.map(row => ({ ...row, connection: externalCollectorConnection(row.lastHeartbeatAt, nowMs) }));
  }
}
