import { parseSessionTurn, type SessionModelUsage } from "./turn.js";
import { redactSecrets } from "../secrets/redact-secrets.js";
export interface ImportedSessionMetadata {
  snapshot: string; sourceSessionId: string; archived: boolean; pinned: boolean;
  model: string | null; startedAt: string | null; endedAt: string | null; branch: string | null;
  usage: SessionModelUsage[];
}
/** Preserve supported snapshot metadata without importing runtime handles or control privileges. */
export function parseImportedSessionMetadata(value: unknown): ImportedSessionMetadata {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Invalid imported metadata");
  const row = value as Record<string, unknown>;
  const text = (value: unknown, limit: number): string | null => {
    if (value == null) return null;
    if (typeof value !== "string" || value.length > limit || value.includes("\0")) throw new Error("Invalid imported metadata text");
    return redactSecrets(value);
  };
  const date = (value: unknown) => {
    const raw = text(value, 40);
    if (raw === null) return null;
    if (!Number.isFinite(Date.parse(raw))) throw new Error("Invalid imported metadata timestamp");
    return new Date(raw).toISOString();
  };
  if (typeof row.snapshot !== "string" || !/^[a-f0-9]{64}$/.test(row.snapshot) || typeof row.archived !== "boolean" || typeof row.pinned !== "boolean") throw new Error("Invalid imported metadata provenance");
  const sourceSessionId = text(row.sourceSessionId, 256);
  if (!sourceSessionId) throw new Error("Invalid imported metadata identity");
  const at = "2000-01-01T00:00:00.000Z"; // Validation shell only; never persisted as a session timestamp.
  const usage = parseSessionTurn({ id: "metadata", startedAt: at, updatedAt: at, prompts: [], response: "", files: [], usage: row.usage ?? [] }).usage;
  return { snapshot: row.snapshot, sourceSessionId, archived: row.archived, pinned: row.pinned, model: text(row.model, 256),
    startedAt: date(row.startedAt), endedAt: date(row.endedAt), branch: text(row.branch, 4096), usage };
}
