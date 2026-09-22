import { and, asc, eq, gt, or } from "drizzle-orm";
import { z } from "zod";
import type { AsyncDataLayer } from "../postgres/data-layer.js";
import { externalSessions, externalSessionTurns } from "../postgres/schema/project.js";
import { redactSecrets } from "../secrets/redact-secrets.js";
import { externalSessionDigest, type ExternalSessionPrincipal } from "./contract.js";
import { externalSessionReadId } from "./read-contract.js";
import { externalSessionTurnIngestionSchema, type ExternalSessionTurn } from "./turn-contract.js";

const listQuerySchema = z.object({
  limit: z.number().int().min(1).max(100).default(50),
  cursor: z.string().min(1).max(2048).regex(/^[A-Za-z0-9_-]+$/).optional(),
}).strict();
export type ExternalSessionTurnListQuery = z.input<typeof listQuerySchema>;

const cursorSchema = z.object({
  schemaVersion: z.literal(1), projectId: z.string().min(1).max(256), sessionId: externalSessionReadId,
  ordinal: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER), nativeTurnId: z.string().min(1).max(256),
}).strict();

function pageCursor(projectId: string, sessionId: string, turn: Pick<ExternalSessionTurn, "ordinal" | "nativeTurnId">) {
  return Buffer.from(JSON.stringify(cursorSchema.parse({ schemaVersion: 1, projectId, sessionId,
    ordinal: turn.ordinal, nativeTurnId: turn.nativeTurnId }))).toString("base64url");
}

function parseCursor(projectId: string, sessionId: string, cursor?: string) {
  if (cursor === undefined) return undefined;
  const value = cursorSchema.parse(JSON.parse(Buffer.from(cursor, "base64url").toString("utf8")));
  if (value.projectId !== projectId || value.sessionId !== sessionId) throw new Error("External turn cursor scope mismatch");
  return value;
}

function boundedRedaction(value: string, max: number) { return redactSecrets(value).slice(0, max); }
function redactTurn(turn: ExternalSessionTurn): ExternalSessionTurn {
  return { ...turn,
    prompts: turn.prompts.map(prompt => ({ ...prompt, text: boundedRedaction(prompt.text, 262_144) })),
    response: turn.response === null ? null : boundedRedaction(turn.response, 1_048_576),
    fileChanges: turn.fileChanges.map(change => ({ ...change,
      path: boundedRedaction(change.path, 4096),
      ...(change.previousPath === undefined ? {} : { previousPath: boundedRedaction(change.previousPath, 4096) }),
      ...(change.patch === undefined ? {} : { patch: boundedRedaction(change.patch, 262_144) }),
    })),
  };
}

export class ExternalSessionTurnConflict extends Error {
  constructor(readonly code: "session-not-found" | "session-scope" | "revision-conflict") { super(code); }
}

/** Native revisions make replay and out-of-order delivery idempotent without treating turns as task runs. */
export class ExternalSessionTurnStore {
  constructor(private readonly layer: AsyncDataLayer, private readonly principal: ExternalSessionPrincipal) {
    if (layer.projectId !== principal.projectId) throw new Error("External turn ingestion requires matching project storage");
  }

  async ingest(value: unknown, receivedAt = new Date().toISOString()) {
    const input = externalSessionTurnIngestionSchema.parse(value);
    const turn = redactTurn(input.turn);
    const digest = externalSessionDigest(turn);
    return this.layer.transactionImmediate(async tx => {
      const [session] = await tx.select({ id: externalSessions.id, hostId: externalSessions.hostId }).from(externalSessions)
        .where(and(eq(externalSessions.projectId, this.principal.projectId), eq(externalSessions.id, input.sessionId))).limit(1).for("update");
      if (!session) throw new ExternalSessionTurnConflict("session-not-found");
      if (session.hostId !== this.principal.hostId) throw new ExternalSessionTurnConflict("session-scope");
      const scope = and(eq(externalSessionTurns.projectId, this.principal.projectId),
        eq(externalSessionTurns.sessionId, input.sessionId), eq(externalSessionTurns.nativeTurnId, turn.nativeTurnId));
      const [previous] = await tx.select().from(externalSessionTurns).where(scope).limit(1);
      if (previous?.revision === turn.revision) {
        if (previous.turnDigest !== digest) throw new ExternalSessionTurnConflict("revision-conflict");
        return { schemaVersion: 1 as const, eventId: input.eventId, sessionId: input.sessionId,
          nativeTurnId: turn.nativeTurnId, revision: previous.revision, applied: false };
      }
      if (previous && previous.revision > turn.revision) return { schemaVersion: 1 as const, eventId: input.eventId,
        sessionId: input.sessionId, nativeTurnId: turn.nativeTurnId, revision: previous.revision, applied: false };
      if (previous) await tx.update(externalSessionTurns).set({ revision: turn.revision, ordinal: turn.ordinal,
        turn, turnDigest: digest, receivedAt }).where(scope);
      else await tx.insert(externalSessionTurns).values({ projectId: this.principal.projectId, sessionId: input.sessionId,
        nativeTurnId: turn.nativeTurnId, revision: turn.revision, ordinal: turn.ordinal, turn, turnDigest: digest, receivedAt });
      return { schemaVersion: 1 as const, eventId: input.eventId, sessionId: input.sessionId,
        nativeTurnId: turn.nativeTurnId, revision: turn.revision, applied: true };
    });
  }
}

export class ExternalSessionTurnReader {
  constructor(private readonly layer: AsyncDataLayer, private readonly projectId: string) {
    if (layer.projectId !== projectId) throw new Error("External turn reads require matching project storage");
  }

  async list(sessionId: string, value: ExternalSessionTurnListQuery = {}) {
    externalSessionReadId.parse(sessionId);
    const query = listQuerySchema.parse(value);
    const after = parseCursor(this.projectId, sessionId, query.cursor);
    const rows = await this.layer.db.select().from(externalSessionTurns).where(and(
      eq(externalSessionTurns.projectId, this.projectId), eq(externalSessionTurns.sessionId, sessionId),
      after === undefined ? undefined : or(gt(externalSessionTurns.ordinal, after.ordinal),
        and(eq(externalSessionTurns.ordinal, after.ordinal), gt(externalSessionTurns.nativeTurnId, after.nativeTurnId))),
    )).orderBy(asc(externalSessionTurns.ordinal), asc(externalSessionTurns.nativeTurnId)).limit(query.limit + 1);
    const page = rows.slice(0, query.limit);
    return { schemaVersion: 1 as const, turns: page.map(row => row.turn),
      nextCursor: rows.length > query.limit ? pageCursor(this.projectId, sessionId, page[page.length - 1].turn) : null };
  }
}
