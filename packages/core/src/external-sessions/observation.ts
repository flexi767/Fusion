/**
 * FNXC:ExternalSessions 2026-09-15-15:00:
 * Independently launched agents are observations, not scheduled Fusion tasks.
 * Host-scoped identities and monotonic revisions make relay retries safe.
 * The host id must come from authenticated collector credentials at ingestion.
 */
export type ExternalSessionProvider = "codex" | "claude";
export type ExternalSessionActivity = "working" | "waiting" | "completed" | "error";

export interface SessionObservation {
  version: 1;
  provider: ExternalSessionProvider;
  nativeSessionId: string;
  revision: number;
  observedAt: string;
  activity: ExternalSessionActivity;
  title: string;
  projectPath: string;
  telemetry?: { model: string | null; contextTokens: number | null; contextCapacity: number | null; serviceTier: string | null; observedAt: string };
}

export interface ExternalSessionSnapshot extends SessionObservation {
  hostId: string;
  key: string;
  receivedAt: string;
}

function boundedString(value: unknown, name: string, max: number): string {
  if (typeof value !== "string" || !value.trim() || value.length > max || /[\u0000-\u001f]/u.test(value)) {
    throw new Error(`Invalid ${name}`);
  }
  return value;
}

export function parseSessionObservation(value: unknown): SessionObservation {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Invalid observation");
  const row = value as Record<string, unknown>;
  if (row.version !== 1) throw new Error("Unsupported observation version");
  if (row.provider !== "codex" && row.provider !== "claude") throw new Error("Invalid provider");
  if (!Number.isSafeInteger(row.revision) || (row.revision as number) < 0) throw new Error("Invalid revision");
  if (!["working", "waiting", "completed", "error"].includes(String(row.activity))) throw new Error("Invalid activity");
  const observedAt = boundedString(row.observedAt, "observedAt", 40);
  if (!/^\d{4}-\d{2}-\d{2}T.*Z$/.test(observedAt) || !Number.isFinite(Date.parse(observedAt))) throw new Error("Invalid observedAt");
  let telemetry: SessionObservation["telemetry"];
  if (row.telemetry !== undefined) {
    if (!row.telemetry || typeof row.telemetry !== "object" || Array.isArray(row.telemetry)) throw new Error("Invalid telemetry");
    const t = row.telemetry as Record<string, unknown>;
    const counter = (value: unknown) => {
      if (value == null) return null;
      if (!Number.isSafeInteger(value) || Number(value) < 0) throw new Error("Invalid telemetry counter");
      return Number(value);
    };
    const at = boundedString(t.observedAt, "telemetry timestamp", 40);
    if (!Number.isFinite(Date.parse(at)) || Date.parse(at) > Date.parse(observedAt)) throw new Error("Invalid telemetry timestamp");
    telemetry = { model: t.model == null ? null : boundedString(t.model, "model", 256), contextTokens: counter(t.contextTokens),
      contextCapacity: counter(t.contextCapacity), serviceTier: t.serviceTier == null ? null : boundedString(t.serviceTier, "service tier", 64), observedAt: new Date(at).toISOString() };
  }
  return {
    ...(telemetry ? { telemetry } : {}),
    version: 1,
    provider: row.provider,
    nativeSessionId: boundedString(row.nativeSessionId, "nativeSessionId", 256),
    revision: row.revision as number,
    observedAt,
    activity: row.activity as ExternalSessionActivity,
    title: boundedString(row.title, "title", 512),
    projectPath: boundedString(row.projectPath, "projectPath", 4096),
  };
}

export function externalSessionKey(hostId: string, provider: ExternalSessionProvider, nativeSessionId: string): string {
  return JSON.stringify([boundedString(hostId, "hostId", 256), provider, boundedString(nativeSessionId, "nativeSessionId", 256)]);
}

/**
 * FNXC:ExternalSessions 2026-09-15-15:00:
 * Revision belongs to the native session and must survive collector restarts.
 * A replay is acknowledged without changing the snapshot or its receipt time.
 * Database integration must enforce this same comparison atomically.
 */
export function reconcileSessionObservation(
  previous: ExternalSessionSnapshot | null,
  hostId: string,
  observation: SessionObservation,
  receivedAt: string,
): { applied: boolean; snapshot: ExternalSessionSnapshot } {
  const row = parseSessionObservation(observation);
  if (!Number.isFinite(Date.parse(receivedAt))) throw new Error("Invalid receivedAt");
  const key = externalSessionKey(hostId, row.provider, row.nativeSessionId);
  if (previous && previous.key !== key) throw new Error("Session identity mismatch");
  if (previous && previous.revision >= row.revision) return { applied: false, snapshot: previous };
  return { applied: true, snapshot: { ...row, hostId, key, receivedAt } };
}

/** Activity is never inferred from a missed heartbeat. */
export function collectorConnection(lastHeartbeatAt: string | null, nowMs: number, staleAfterMs = 90_000): "connected" | "disconnected" {
  const last = lastHeartbeatAt === null ? NaN : Date.parse(lastHeartbeatAt);
  return Number.isFinite(last) && last <= nowMs && nowMs - last <= staleAfterMs ? "connected" : "disconnected";
}


/** Quiet working reports are uncertain, never an inferred completion or cancellation. */
export function sessionActivityStale(observation: Pick<SessionObservation, "activity" | "observedAt">, nowMs: number): boolean {
  return observation.activity === "working" && nowMs - Date.parse(observation.observedAt) > 5 * 60_000;
}
