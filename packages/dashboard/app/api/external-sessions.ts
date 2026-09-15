import type { SessionObservation } from "@fusion/core";
import { api } from "./client/client.js";
export interface SessionLaunchPage {
  enabled: boolean; runtimes: import("@fusion/core").SessionLaunchRuntime[];
  requests: import("@fusion/core").SessionLaunchRequest[];
}
export type SessionLaunchInput = Parameters<import("@fusion/core").ExternalSessionLaunches["queue"]>[0];
export const fetchSessionLaunches = () => api<SessionLaunchPage>("/external-session-launches");
export const queueSessionLaunch = (input: SessionLaunchInput) => api("/external-session-launches", { method: "POST", body: JSON.stringify(input) });
export const cancelSessionLaunch = (id: string, hostId: string) => api(`/external-session-launches/${encodeURIComponent(id)}/cancel`, { method: "POST", body: JSON.stringify({ hostId }) });
export interface ObservedSession {
  taskProjectId?: string | null; taskId?: string | null; taskLinkRevision?: number | null;
  archived?: boolean | null; pinned?: boolean | null;
  id: string; hostId: string; provider: string; nativeSessionId: string;
  usageSummary?: import("@fusion/core").ExternalSessionUsageSummary | null;
  revision: number; observation: SessionObservation; receivedAt: string;
}
export interface CollectorHealth { hostId: string; lastHeartbeatAt: string | null; lastAcknowledgementAt: string | null; collectorVersion: string; diagnostics?: { liveLagSamples?: number; liveLagClockSkewSamples?: number; liveLagP95Ms?: number; liveLagMaxMs?: number; liveQueueP95Ms?: number; oldestLivePendingMs?: number; spoolDepth?: number; rejectedDeliveries?: number; discoveredFiles?: number; parserStateBytes?: number; spoolBytes?: number; resourcePaused?: boolean; parseError?: boolean; deliveryError?: boolean } }
export interface SessionPage { enabled: boolean; sessions: ObservedSession[]; collectors: CollectorHealth[]; nextCursor: string | null }
export interface SessionFilters { projectPath?: string; host?: string; provider?: string; activity?: string; q?: string; saved?: string }
export const fetchExternalSessions = (before?: string, filters: SessionFilters = {}) => {
  const query = new URLSearchParams();
  if (before) query.set("before", before);
  for (const [key, value] of Object.entries(filters)) if (value) query.set(key, value);
  return api<SessionPage>(`/external-sessions?${query}`);
};
export interface SessionDetail {
  session: ObservedSession;
  turnCosts?: Record<string, SessionDetail["cost"]>;
  wholeSessionUsage?: import("@fusion/core").ExternalSessionUsageSummary | null;
  turns: import("@fusion/core").SessionTurn[];
  nextCursor: string | null;
  details: Awaited<ReturnType<import("@fusion/core").ExternalSessionSummaries["get"]>>;
  runtime: Awaited<ReturnType<import("@fusion/core").ExternalSessionControls["capability"]>>;
  commands: Awaited<ReturnType<import("@fusion/core").ExternalSessionControls["list"]>>;
  summariesEnabled: boolean;
  cost: ReturnType<typeof import("@fusion/core").priceSessionTurns>;
}
export const fetchExternalSession = (id: string, before?: string, basis: "current" | "recorded" = "current") => {
  const query = new URLSearchParams({ basis }); if (before) query.set("before", before);
  return api<SessionDetail>(`/external-sessions/${encodeURIComponent(id)}?${query}`);
};
export const saveSessionNotes = (id: string, notes: string, expectedRevision: number) => api(`/external-sessions/${encodeURIComponent(id)}/notes`, { method: "PUT", body: JSON.stringify({ notes, expectedRevision }) });
export const summarizeSession = (id: string) => api<{ changed: boolean; reason?: string }>(`/external-sessions/${encodeURIComponent(id)}/summary`, { method: "POST", body: "{}" });
export const sendSessionCommand = (sessionId: string, id: string, operation: string, text?: string) => api(`/external-sessions/${encodeURIComponent(sessionId)}/commands`, { method: "POST", body: JSON.stringify({ id, operation, text }) });

export const fetchExternalSessionUsage = (filters: { from?: string; to?: string; host?: string; model?: string; groupBy?: "session" | "turn"; basis?: "current" | "recorded" }) => {
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(filters)) if (value) query.set(key, value);
  return api<Awaited<ReturnType<typeof import("@fusion/core").externalSessionAnalytics>>>(`/external-session-usage?${query}`);
};

export const fetchExternalSessionTurn = (id: string, turnId: string, basis: "current" | "recorded" = "current") => api<{ turn: import("@fusion/core").SessionTurn; cost: SessionDetail["cost"] }>(`/external-sessions/${encodeURIComponent(id)}/turns/${encodeURIComponent(turnId)}?basis=${basis}`);

export const saveSessionPreferences = (id: string, archived: boolean, pinned: boolean, expectedRevision: number) => api(`/external-sessions/${encodeURIComponent(id)}/preferences`, { method: "PUT", body: JSON.stringify({ archived, pinned, expectedRevision }) });

export const fetchTaskSessions = (taskId: string, projectId?: string, before?: string) => {
  const query = new URLSearchParams(); if (projectId) query.set("projectId", projectId); if (before) query.set("before", before);
  return api<Pick<SessionPage, "enabled" | "sessions" | "nextCursor">>(`/tasks/${encodeURIComponent(taskId)}/external-sessions?${query}`);
};
export const linkTaskSession = (taskId: string, sessionId: string, linked: boolean, expectedRevision: number, projectId?: string) => api(`/tasks/${encodeURIComponent(taskId)}/external-sessions/${encodeURIComponent(sessionId)}${projectId ? `?projectId=${encodeURIComponent(projectId)}` : ""}`, { method: "PUT", body: JSON.stringify({ linked, expectedRevision }) });

export interface SessionRetentionPreview { cutoff: string; eligibleTurns: number; moreAvailable: boolean; batchLimit: number; removedContentTurns?: number }
export const previewSessionRetention = (retentionDays: number) => api<SessionRetentionPreview>("/external-session-retention/preview", { method: "POST", body: JSON.stringify({ retentionDays }) });
export const applySessionRetention = (cutoff: string) => api<SessionRetentionPreview>("/external-session-retention/apply", { method: "POST", body: JSON.stringify({ cutoff }) });
