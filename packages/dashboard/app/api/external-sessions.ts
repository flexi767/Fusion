import type { SessionObservation } from "@fusion/core";
import { api } from "./client/client.js";
export interface ObservedSession {
  id: string; hostId: string; provider: string; nativeSessionId: string;
  revision: number; observation: SessionObservation; receivedAt: string;
}
export interface CollectorHealth { hostId: string; lastHeartbeatAt: string; lastAcknowledgementAt: string | null; collectorVersion: string; diagnostics?: { spoolDepth?: number; rejectedDeliveries?: number; discoveredFiles?: number; parserStateBytes?: number; parseError?: boolean; deliveryError?: boolean } }
export interface SessionPage { enabled: boolean; sessions: ObservedSession[]; collectors: CollectorHealth[]; nextCursor: string | null }
export const fetchExternalSessions = (before?: string) => api<SessionPage>(`/external-sessions${before ? `?before=${encodeURIComponent(before)}` : ""}`);
export interface SessionDetail {
  session: ObservedSession;
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
