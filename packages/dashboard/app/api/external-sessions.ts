import type { SessionObservation } from "@fusion/core";
import { api } from "./client/client.js";
export interface ObservedSession {
  id: string; hostId: string; provider: string; nativeSessionId: string;
  revision: number; observation: SessionObservation; receivedAt: string;
}
export interface CollectorHealth { hostId: string; lastHeartbeatAt: string | null; lastAcknowledgementAt: string | null; collectorVersion: string; diagnostics?: { spoolDepth?: number; rejectedDeliveries?: number; discoveredFiles?: number; parserStateBytes?: number; parseError?: boolean; deliveryError?: boolean } }
export interface SessionPage { enabled: boolean; sessions: ObservedSession[]; collectors: CollectorHealth[]; nextCursor: string | null }
export interface SessionFilters { host?: string; provider?: string; activity?: string; q?: string }
export const fetchExternalSessions = (before?: string, filters: SessionFilters = {}) => {
  const query = new URLSearchParams();
  if (before) query.set("before", before);
  for (const [key, value] of Object.entries(filters)) if (value) query.set(key, value);
  return api<SessionPage>(`/external-sessions?${query}`);
};
export interface SessionDetail {
  session: ObservedSession;
  wholeSessionUsage?: import("@fusion/core").ExternalSessionUsageSummary | null;
  turns: import("@fusion/core").SessionTurn[];
  nextCursor: string | null;
  details: Awaited<ReturnType<import("@fusion/core").ExternalSessionSummaries["get"]>>;
  runtime: Awaited<ReturnType<import("@fusion/core").ExternalSessionControls["capability"]>>;
  commands: Awaited<ReturnType<import("@fusion/core").ExternalSessionControls["list"]>>;
  summariesEnabled: boolean;
  cost: ReturnType<typeof import("@fusion/core").priceSessionTurns>;
}
export const fetchExternalSession = (id: string, before?: string) => api<SessionDetail>(`/external-sessions/${encodeURIComponent(id)}${before ? `?before=${encodeURIComponent(before)}` : ""}`);
export const saveSessionNotes = (id: string, notes: string, expectedRevision: number) => api(`/external-sessions/${encodeURIComponent(id)}/notes`, { method: "PUT", body: JSON.stringify({ notes, expectedRevision }) });
export const summarizeSession = (id: string) => api<{ changed: boolean; reason?: string }>(`/external-sessions/${encodeURIComponent(id)}/summary`, { method: "POST", body: "{}" });
export const sendSessionCommand = (sessionId: string, id: string, operation: string, text?: string) => api(`/external-sessions/${encodeURIComponent(sessionId)}/commands`, { method: "POST", body: JSON.stringify({ id, operation, text }) });

export const fetchExternalSessionUsage = (filters: { from?: string; to?: string; host?: string; model?: string }) => {
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(filters)) if (value) query.set(key, value);
  return api<Awaited<ReturnType<typeof import("@fusion/core").externalSessionAnalytics>>>(`/external-session-usage?${query}`);
};
