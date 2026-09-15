import { parseSessionTurn, type SessionModelUsage } from "./turn.js";
import { redactSecrets } from "../secrets/redact-secrets.js";
export interface ImportedSessionMetadata {
  formatVersion?: number;
  snapshot: string; sourceSessionId: string; archived: boolean; pinned: boolean;
  model: string | null; startedAt: string | null; endedAt: string | null; branch: string | null;
  usage: SessionModelUsage[];
  conversations?: ImportedSessionConversation[];
  conversationsTruncated?: boolean;
  sourceAliases?: { sourceSessionId: string; title: string; archived: boolean; pinned: boolean; status: string; notes: string; truncated: boolean }[];
}
export interface ImportedSessionConversation {
  id: string; title: string; createdAt: string; archivedAt: string | null; totalMessages: number;
  messages: { id: string; role: string; content: string; at: string; truncated: boolean; contextSessionIds: string[]; error: string | null; inputTokens: number | null; outputTokens: number | null }[];
}
/** Preserve supported snapshot metadata without importing runtime handles or control privileges. */
export function parseImportedSessionMetadata(value: unknown): ImportedSessionMetadata {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Invalid imported metadata");
  const row = value as Record<string, unknown>;
  const formatVersion = row.formatVersion ?? 1;
  if (!Number.isSafeInteger(formatVersion) || Number(formatVersion) < 1 || Number(formatVersion) > 5) throw new Error("Invalid imported metadata format");
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
  const requiredText = (value: unknown, limit: number) => { const result = text(value, limit); if (!result) throw new Error("Invalid imported conversation text"); return result; };
  const counter = (value: unknown) => { if (value == null) return null; if (!Number.isSafeInteger(value) || Number(value) < 0) throw new Error("Invalid imported conversation counter"); return Number(value); };
  if (row.conversations !== undefined && (!Array.isArray(row.conversations) || row.conversations.length > 3)) throw new Error("Invalid imported conversations");
  const conversations = ((row.conversations ?? []) as unknown[]).map(value => {
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Invalid imported conversation");
    const thread = value as Record<string, unknown>;
    if (!Array.isArray(thread.messages) || thread.messages.length > 10) throw new Error("Invalid imported conversation messages");
    const messages = thread.messages.map(value => {
      if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Invalid imported conversation message");
      const message = value as Record<string, unknown>;
      if (!["user", "assistant", "system", "tool"].includes(String(message.role)) || typeof message.content !== "string"
        || !Array.isArray(message.contextSessionIds) || message.contextSessionIds.length > 64) throw new Error("Invalid imported conversation message");
      const at = date(message.at); if (!at) throw new Error("Invalid imported conversation timestamp");
      return { id: requiredText(message.id, 256), role: String(message.role), content: text(message.content, 4000)!, at,
        truncated: message.truncated === true, contextSessionIds: message.contextSessionIds.map(id => requiredText(id, 256)),
        error: text(message.error, 1000), inputTokens: counter(message.inputTokens), outputTokens: counter(message.outputTokens) };
    });
    const createdAt = date(thread.createdAt), totalMessages = counter(thread.totalMessages);
    if (!createdAt || totalMessages === null || totalMessages < messages.length) throw new Error("Invalid imported conversation coverage");
    return { id: requiredText(thread.id, 256), title: requiredText(thread.title, 512), createdAt, archivedAt: date(thread.archivedAt), totalMessages, messages };
  });
  if (row.sourceAliases !== undefined && (!Array.isArray(row.sourceAliases) || row.sourceAliases.length > 7)) throw new Error("Invalid imported source aliases");
  const sourceAliases = ((row.sourceAliases ?? []) as unknown[]).map(value => {
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Invalid imported source alias");
    const alias = value as Record<string, unknown>;
    if (typeof alias.archived !== "boolean" || typeof alias.pinned !== "boolean") throw new Error("Invalid imported source alias labels");
    return { sourceSessionId: requiredText(alias.sourceSessionId, 256), title: requiredText(alias.title, 512), archived: alias.archived, pinned: alias.pinned,
      status: requiredText(alias.status, 64), notes: text(alias.notes, 32000) ?? "", truncated: alias.truncated === true };
  });
  return { formatVersion: Number(formatVersion), snapshot: row.snapshot, sourceSessionId, archived: row.archived, pinned: row.pinned, model: text(row.model, 256),
    startedAt: date(row.startedAt), endedAt: date(row.endedAt), branch: text(row.branch, 4096), usage, conversations, conversationsTruncated: row.conversationsTruncated === true, sourceAliases };
}
