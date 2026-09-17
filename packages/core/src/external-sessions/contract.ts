import { createHash } from "node:crypto";

/**
 * FNXC:ExternalSessions 2026-09-17-04:01:
 * External observations remain outside task lifecycle and runtime ownership.
 * Provider identities are open identifiers; credentials supply host identity.
 * Delivery sequences belong to a durable spool stream, while session revisions
 * survive stream rotation. Reported capabilities confer no execution authority.
 */
export class ExternalSessionValidationError extends Error {}
export class ExternalSessionConflictError extends Error {}
export class ExternalSessionCapacityError extends Error {}
export const EXTERNAL_SESSION_DELIVERY_LIMIT = 1_000_000;
export const EXTERNAL_SESSION_COUNT_LIMIT = 10_000;
export const EXTERNAL_SESSION_STREAM_LIMIT = 100;

export interface ExternalSessionObservation {
  provider: string;
  nativeSessionId: string;
  revision: number;
  observedAt: string;
  activity: "working" | "waiting" | "completed" | "error";
  title: string;
  projectPath: string | null;
  capabilities: Array<"send-feedback" | "stop" | "resume">;
}

export interface ExternalSessionDelivery {
  version: 1;
  eventId: string;
  streamId: string;
  sequence: number;
  collectorVersion: string;
  kind: "heartbeat" | "observation";
  observation?: ExternalSessionObservation;
}

export interface ExternalSessionAcknowledgement {
  hostId: string;
  eventId: string;
  streamId: string;
  sequence: number;
  acknowledged: true;
  sessionId: string | null;
  outcome: "applied" | "stale" | "unchanged" | "heartbeat";
}

function invalid(field: string): never {
  throw new ExternalSessionValidationError(`Invalid ${field}`);
}

function record(value: unknown, allowed: string[], field: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) invalid(field);
  const row = value as Record<string, unknown>;
  if (Object.keys(row).some(key => !allowed.includes(key))) invalid(field);
  return row;
}

export function externalSessionIdentifier(value: unknown, field: string): string {
  if (typeof value !== "string" || !/^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,127}$/.test(value)) invalid(field);
  return value;
}

function text(value: unknown, field: string, max: number): string {
  if (typeof value !== "string" || !value.trim() || value.length > max
    || [...value].some(character => character.charCodeAt(0) < 32)) invalid(field);
  return value;
}

function counter(value: unknown, field: string, minimum: number): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < minimum) invalid(field);
  return value;
}

export function parseExternalSessionObservation(value: unknown): ExternalSessionObservation {
  const row = record(value, ["provider", "nativeSessionId", "revision", "observedAt", "activity", "title", "projectPath", "capabilities"], "observation");
  const observedAt = text(row.observedAt, "observedAt", 24);
  if (!Number.isFinite(Date.parse(observedAt)) || new Date(observedAt).toISOString() !== observedAt) invalid("observedAt");
  if (!["working", "waiting", "completed", "error"].includes(String(row.activity))) invalid("activity");
  if (!Array.isArray(row.capabilities) || row.capabilities.length > 3
    || row.capabilities.some(value => !["send-feedback", "stop", "resume"].includes(value))
    || new Set(row.capabilities).size !== row.capabilities.length) invalid("capabilities");
  return {
    provider: externalSessionIdentifier(row.provider, "provider"),
    nativeSessionId: text(row.nativeSessionId, "nativeSessionId", 256),
    revision: counter(row.revision, "revision", 0),
    observedAt,
    activity: row.activity as ExternalSessionObservation["activity"],
    title: text(row.title, "title", 512),
    projectPath: row.projectPath === null ? null : text(row.projectPath, "projectPath", 4096),
    capabilities: [...row.capabilities].sort() as ExternalSessionObservation["capabilities"],
  };
}

export function parseExternalSessionDelivery(value: unknown): ExternalSessionDelivery {
  const row = record(value, ["version", "eventId", "streamId", "sequence", "collectorVersion", "kind", "observation"], "delivery");
  if (row.version !== 1) invalid("delivery version");
  if (row.kind !== "heartbeat" && row.kind !== "observation") invalid("delivery kind");
  if (row.kind === "heartbeat" && row.observation !== undefined) invalid("heartbeat observation");
  return {
    version: 1,
    eventId: externalSessionIdentifier(row.eventId, "eventId"),
    streamId: externalSessionIdentifier(row.streamId, "streamId"),
    sequence: counter(row.sequence, "sequence", 1),
    collectorVersion: externalSessionIdentifier(row.collectorVersion, "collectorVersion"),
    kind: row.kind,
    ...(row.kind === "observation" ? { observation: parseExternalSessionObservation(row.observation) } : {}),
  };
}

export function externalSessionDigest(value: ExternalSessionDelivery | ExternalSessionObservation): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

export function externalSessionId(hostId: string, provider: string, nativeSessionId: string): string {
  return createHash("sha256").update(JSON.stringify([externalSessionIdentifier(hostId, "hostId"), provider, nativeSessionId])).digest("hex");
}

export function externalCollectorConnection(lastHeartbeatAt: string | null, nowMs: number): "connected" | "disconnected" {
  const last = lastHeartbeatAt === null ? NaN : Date.parse(lastHeartbeatAt);
  return Number.isFinite(last) && last <= nowMs && nowMs - last <= 90_000 ? "connected" : "disconnected";
}
