import { redactSecrets } from "../secrets/redact-secrets.js";

export interface SessionModelUsage {
  serviceTier?: string | null;
  model: string; inputTokens: number | null; cachedInputTokens: number | null;
  cacheWriteTokens: number | null; cacheWriteHourTokens: number | null;
  outputTokens: number | null; reasoningTokens: number | null;
  requests: number | null; contextTokens: number | null; longContext: boolean; fast: boolean;
}
export interface SessionTurn {
  /** Server-owned snapshots; collector-supplied values are ignored by validation. */
  recordedPricing?: import("./rate-snapshot.js").RecordedSessionPrice[];
  id: string; startedAt: string; completedAt: string | null; updatedAt: string;
  durationMs: number | null; durationSource: "provider" | "timestamps";
  prompts: string[]; response: string; toolCalls: number; usage: SessionModelUsage[];
  files: { scope?: "project" | "external"; path: string; diff: string; added: number; removed: number; truncated: boolean; available: boolean }[];
  provenance: "native-transcript" | "agentpulse-import";
}
function text(value: unknown, max: number): string {
  if (typeof value !== "string" || value.length > max || value.includes("\0")) throw new Error("Invalid turn text");
  return value;
}
function count(value: unknown): number | null {
  if (value === undefined || value === null) return null;
  if (!Number.isSafeInteger(value) || Number(value) < 0) throw new Error("Invalid turn counter");
  return Number(value);
}
function timestamp(value: unknown): string {
  const raw = text(value, 40);
  if (!Number.isFinite(Date.parse(raw))) throw new Error("Invalid turn timestamp");
  return new Date(raw).toISOString();
}
function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Invalid turn object");
  return value as Record<string, unknown>;
}
export function parseSessionTurn(value: unknown): SessionTurn {
  const r = record(value);
  if (!Array.isArray(r.prompts) || r.prompts.length > 32 || !Array.isArray(r.files) || r.files.length > 256
    || !Array.isArray(r.usage) || r.usage.length > 64 || JSON.stringify(r).length > 1_500_000) throw new Error("Invalid turn size");
  const id = text(r.id, 256);
  if (!id || /[\u0000-\u001f]/u.test(id)) throw new Error("Invalid turn identity");
  return { id, startedAt: timestamp(r.startedAt), completedAt: r.completedAt == null ? null : timestamp(r.completedAt), updatedAt: timestamp(r.updatedAt),
    durationMs: count(r.durationMs), durationSource: r.durationSource === "provider" ? "provider" : "timestamps",
    prompts: r.prompts.map(p => redactSecrets(text(p, 65536))), response: redactSecrets(text(r.response, 131072)), toolCalls: count(r.toolCalls) ?? 0,
    provenance: r.provenance === "agentpulse-import" ? "agentpulse-import" : "native-transcript",
    files: r.files.map(value => {
      const f = record(value); const path = text(f.path, 4096);
      // Historical display only: no API ever opens this path on the server.
      if (!path || Array.from(path).some(char => char.charCodeAt(0) < 32)) throw new Error("Invalid turn file path");
      const external = /^(?:[\\/]|[A-Za-z]:)/u.test(path) || path.split(/[\\/]/u).includes("..");
      return { path, scope: external ? "external" as const : "project" as const, diff: redactSecrets(text(f.diff, 65536)), added: count(f.added) ?? 0, removed: count(f.removed) ?? 0, truncated: f.truncated === true, available: f.available !== false };
    }),
    usage: r.usage.map(value => {
      const u = record(value);
      return { ...(u.serviceTier === undefined ? {} : { serviceTier: u.serviceTier === null ? null : text(u.serviceTier, 64) }), model: text(u.model, 256), inputTokens: count(u.inputTokens), cachedInputTokens: count(u.cachedInputTokens), cacheWriteTokens: count(u.cacheWriteTokens),
        cacheWriteHourTokens: count(u.cacheWriteHourTokens), outputTokens: count(u.outputTokens), reasoningTokens: count(u.reasoningTokens), requests: count(u.requests),
        contextTokens: count(u.contextTokens), longContext: u.longContext === true, fast: u.fast === true };
    }),
  };
}
