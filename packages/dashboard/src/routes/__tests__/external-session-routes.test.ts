// @vitest-environment node
import express from "express";
import { createHash } from "node:crypto";
import { afterEach, expect, it, vi } from "vitest";
import { createAuthMiddleware } from "../../auth-middleware.js";
import { ApiError } from "../../api-error.js";
import { registerExternalSessionRoutes } from "../register-external-session-routes.js";
import type { ApiRoutesContext } from "../types.js";
import { request as rawRequest } from "../../test-request.js";
function request(app: express.Express, method: string, path: string, options: { body?: unknown; headers?: Record<string, string> } = {}) {
  return rawRequest(app, method, path, options.body ? JSON.stringify(options.body) : undefined, { "Content-Type": "application/json", ...options.headers });
}
const retentionPreview = vi.fn(); const retentionApply = vi.fn();
const overview = vi.fn();
const ingest = vi.fn();
const heartbeat = vi.fn();
const collectors = vi.fn(); const analytics = vi.fn();
const linkTask = vi.fn(); const get = vi.fn(); const list = vi.fn(); const getTask = vi.fn();
const launchQueue = vi.fn(); const launchList = vi.fn(); const launchAvailable = vi.fn(); const launchCancel = vi.fn();
vi.mock("@fusion/core", () => ({ externalSessionAnalytics: (...args: unknown[]) => analytics(...args), ExternalSessionRetention: class { preview = retentionPreview; apply = retentionApply; }, ExternalSessionStore: class { ingest = ingest; heartbeat = heartbeat; linkTask = linkTask; get = get; list = list; collectors = collectors; },
  ExternalSessionSummaries: class { overview = overview; }, ExternalSessionLaunches: class { queue = launchQueue; list = launchList; available = launchAvailable; cancel = launchCancel; } }));
afterEach(() => { vi.unstubAllEnvs(); vi.clearAllMocks(); });
function app() {
  vi.stubEnv("FUSION_SESSION_INGESTION", "1");
  vi.stubEnv("FUSION_SESSION_COLLECTORS", JSON.stringify({ m3: createHash("sha256").update("collector-token").digest("hex") }));
  const app = express(); app.use(express.json()); app.use(createAuthMiddleware("dashboard-token"));
  const router = express.Router();
  registerExternalSessionRoutes({ router, store: { getAsyncLayer: () => ({}), getGlobalSettingsStore: () => ({ getSettings: async () => ({}) }) }, getScopedStore: async () => ({ getProjectId: () => "canonical-project", getTask }) } as unknown as ApiRoutesContext);
  app.use("/api", router);
  app.use((error: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => res.status(error instanceof ApiError ? error.statusCode : 500).json({ error: error instanceof Error ? error.message : "Failed" }));
  return app;
}
const body = { version: 1, eventId: "event-1", collectorVersion: "test", observation: { hostId: "spoofed" } };
it("serves the read-only overview only through dashboard authentication and the Sessions flag", async () => {
  const server = app(); const headers = { Authorization: "Bearer dashboard-token" };
  vi.stubEnv("FUSION_SESSIONS", "0");
  expect((await request(server, "GET", "/api/external-session-overview", { headers })).body).toEqual({ enabled: false, sessions: [] });
  expect(overview).not.toHaveBeenCalled();
  vi.stubEnv("FUSION_SESSIONS", "1"); overview.mockResolvedValue([{ id: "recent" }]);
  expect((await request(server, "GET", "/api/external-session-overview", { headers: { Authorization: "Bearer collector-token" } })).status).toBe(401);
  expect((await request(server, "GET", "/api/external-session-overview", { headers })).body).toEqual({ enabled: true, sessions: [{ id: "recent" }] });
  expect(overview).toHaveBeenCalledTimes(1); expect(ingest).not.toHaveBeenCalled(); expect(launchQueue).not.toHaveBeenCalled();
});
it("restricts managed launch to enabled browser-authenticated hosts and refuses arbitrary executable/cwd fields", async () => {
  const server = app(); const headers = { Authorization: "Bearer dashboard-token" };
  vi.stubEnv("FUSION_SESSIONS", "1"); vi.stubEnv("FUSION_SESSION_LAUNCHES", "1"); vi.stubEnv("FUSION_SESSION_CONTROLS", "1"); vi.stubEnv("FUSION_SESSION_CONTROL_HOSTS", "m3");
  const input = { id: "launch-request-12345", hostId: "m3", projectId: "project", generation: "generation-123456", prompt: "Inspect", model: null };
  launchQueue.mockResolvedValue({ ...input, status: "queued" });
  expect((await request(server, "POST", "/api/external-session-launches", { body: input, headers: { Authorization: "Bearer collector-token" } })).status).toBe(401);
  expect((await request(server, "POST", "/api/external-session-launches", { body: { ...input, hostId: "m5" }, headers })).status).toBe(403);
  for (const field of ["cwd", "command", "extraArgs", "autoApprove", "taskId", "sandbox"]) {
    expect((await request(server, "POST", "/api/external-session-launches", { body: { ...input, [field]: "injected" }, headers })).status).toBe(400);
  }
  expect(launchQueue).not.toHaveBeenCalled();
  expect((await request(server, "POST", "/api/external-session-launches", { body: input, headers })).status).toBe(200);
  expect(launchQueue).toHaveBeenCalledWith(input);
  launchAvailable.mockResolvedValue([{ hostId: "m3" }, { hostId: "m5" }]); launchList.mockResolvedValue([{ hostId: "m3", status: "starting" }, { hostId: "m5" }]);
  const listed = await request(server, "GET", "/api/external-session-launches", { headers });
  expect(listed.body).toMatchObject({ runtimes: [{ hostId: "m3" }], requests: [{ hostId: "m3", status: "starting" }] });
  launchCancel.mockResolvedValue(false);
  expect((await request(server, "POST", `/api/external-session-launches/${input.id}/cancel`, { headers, body: { hostId: "m3" } })).status).toBe(409);
  expect(launchCancel).toHaveBeenCalledWith(input.id, "m3");
  vi.stubEnv("FUSION_SESSION_LAUNCHES", "0");
  expect((await request(server, "POST", "/api/external-session-launches", { body: input, headers })).status).toBe(404);
});
it("host token reaches only its independently authenticated ingestion route", async () => {
  const server = app(); ingest.mockResolvedValue({ id: "session", revision: 1 });
  const response = await request(server, "POST", "/api/session-collector", { body, headers: { Authorization: "Bearer collector-token" } });
  expect(response.status).toBe(200); expect(ingest.mock.calls[0][0]).toBe("m3");
  expect((await request(server, "GET", "/api/external-sessions", { headers: { Authorization: "Bearer collector-token" } })).status).toBe(401);
  expect((await request(server, "POST", "/api/session-collector", { body, headers: { Authorization: "Bearer dashboard-token" } })).status).toBe(401);
});
it("never acknowledges a failed commit, browser request, invalid envelope or disabled collector", async () => {
  const server = app(); const headers = { Authorization: "Bearer collector-token" }; ingest.mockRejectedValue(new Error("database unavailable"));
  const failed = await request(server, "POST", "/api/session-collector", { body, headers });
  expect(failed.status).toBe(503); expect(failed.body).not.toHaveProperty("acknowledged");
  expect((await request(server, "POST", "/api/session-collector", { body, headers: { ...headers, Origin: "https://browser.test" } })).status).toBe(403);
  expect((await request(server, "POST", "/api/session-collector", { body: { ...body, version: 2 }, headers })).status).toBe(400);
  vi.stubEnv("FUSION_SESSION_INGESTION", "0");
  expect((await request(server, "POST", "/api/session-collector", { body, headers })).status).toBe(404);
});

it("accepts bounded host diagnostics and discards unrecognized fields", async () => {
  const server = app(); const headers = { Authorization: "Bearer collector-token" };
  const envelope = { version: 1, eventId: "health", collectorVersion: "test", diagnostics: { spoolDepth: 12, rejectedDeliveries: 1, parseError: true, liveLagSamples: 25, liveLagP95Ms: 13000, liveLagMaxMs: 600000, liveQueueP95Ms: 12000, oldestLivePendingMs: 900000, liveLagClockSkewSamples: 2, secret: "never retained" } };
  expect((await request(server, "POST", "/api/session-collector", { body: envelope, headers })).status).toBe(200);
  expect(heartbeat).toHaveBeenCalledWith("m3", "test", undefined, { spoolDepth: 12, rejectedDeliveries: 1, parseError: true, liveLagSamples: 25, liveLagP95Ms: 13000, liveLagMaxMs: 600000, liveQueueP95Ms: 12000, oldestLivePendingMs: 900000, liveLagClockSkewSamples: 2 });
  expect((await request(server, "POST", "/api/session-collector", { body: { ...envelope, diagnostics: { spoolDepth: -1 } }, headers })).status).toBe(400);
  for (const field of ["liveLagSamples", "liveLagClockSkewSamples", "liveLagP95Ms", "liveLagMaxMs", "liveQueueP95Ms", "oldestLivePendingMs"]) {
    for (const value of [-1, 1.5, "100", Number.MAX_SAFE_INTEGER + 1]) {
      expect((await request(server, "POST", "/api/session-collector", { body: { ...envelope, diagnostics: { [field]: value } }, headers })).status).toBe(400);
    }
  }
});

it("credential probes authenticate without refreshing collector liveness", async () => {
  const response = await request(app(), "POST", "/api/session-collector", { body: { version: 1, eventId: "probe", collectorVersion: "test", probe: true }, headers: { Authorization: "Bearer collector-token" } });
  expect(response.status).toBe(200); expect(response.body).toMatchObject({ hostId: "m3", acknowledged: true });
  expect(heartbeat).not.toHaveBeenCalled(); expect(ingest).not.toHaveBeenCalled();
});

it("allows dashboard-authenticated explicit links only after checking the scoped task", async () => {
  vi.stubEnv("FUSION_SESSIONS", "1"); const server = app();
  const path = "/api/tasks/FN-1/external-sessions/session";
  const body = { linked: true, expectedRevision: 0, projectId: "spoofed" };
  getTask.mockResolvedValue({ id: "FN-1" }); get.mockResolvedValue({ id: "session" }); linkTask.mockResolvedValue({ taskId: "FN-1" });
  expect((await request(server, "PUT", path, { body, headers: { Authorization: "Bearer collector-token" } })).status).toBe(401);
  expect(linkTask).not.toHaveBeenCalled();
  expect((await request(server, "PUT", path, { body, headers: { Authorization: "Bearer dashboard-token" } })).status).toBe(200);
  expect(getTask).toHaveBeenCalledWith("FN-1");
  expect(linkTask).toHaveBeenCalledWith("session", "canonical-project", "FN-1", true, 0);
  linkTask.mockClear(); getTask.mockRejectedValue(new Error("missing"));
  expect((await request(server, "PUT", path, { body, headers: { Authorization: "Bearer dashboard-token" } })).status).toBe(404);
  expect(linkTask).not.toHaveBeenCalled();
});

it("returns linked sessions only from the resolved task/project and respects the feature flag", async () => {
  const server = app(); const headers = { Authorization: "Bearer dashboard-token" };
  vi.stubEnv("FUSION_SESSIONS", "0");
  const disabled = await request(server, "GET", "/api/tasks/FN-1/external-sessions", { headers });
  expect(disabled.body).toMatchObject({ enabled: false, sessions: [] }); expect(list).not.toHaveBeenCalled();
  vi.stubEnv("FUSION_SESSIONS", "1"); getTask.mockResolvedValue({ id: "FN-1" }); list.mockResolvedValue({ sessions: [], nextCursor: null });
  expect((await request(server, "GET", "/api/tasks/FN-1/external-sessions", { headers })).status).toBe(200);
  expect(list).toHaveBeenCalledWith({ taskProjectId: "canonical-project", taskId: "FN-1", before: undefined });
});


it("requires dashboard authentication and explicit bounded retention intent", async () => {
  const server = app(); vi.stubEnv("FUSION_SESSIONS", "1");
  const headers = { Authorization: "Bearer dashboard-token" };
  expect((await request(server, "POST", "/api/external-session-retention/apply", { headers: { Authorization: "Bearer collector-token" }, body: { cutoff: "2026-07-01" } })).status).toBe(401);
  for (const retentionDays of [0, 3651, 1.5, "30"]) expect((await request(server, "POST", "/api/external-session-retention/preview", { headers, body: { retentionDays } })).status).toBe(400);
  retentionPreview.mockResolvedValue({ eligibleTurns: 25 });
  expect((await request(server, "POST", "/api/external-session-retention/preview", { headers, body: { retentionDays: 30 } })).status).toBe(200);
  expect(retentionPreview).toHaveBeenCalledOnce(); expect(retentionApply).not.toHaveBeenCalled();
  const cutoff = retentionPreview.mock.calls[0][0];
  retentionApply.mockResolvedValue({ removedContentTurns: 25 });
  expect((await request(server, "POST", "/api/external-session-retention/apply", { headers, body: { cutoff } })).status).toBe(200);
  expect(retentionApply).toHaveBeenCalledWith(cutoff, expect.any(Number));
  expect((await request(server, "POST", "/api/external-session-retention/apply", { headers, body: {} })).status).toBe(400);
  vi.stubEnv("FUSION_SESSIONS", "0");
  expect((await request(server, "POST", "/api/external-session-retention/preview", { headers, body: { retentionDays: 30 } })).status).toBe(404);
});


it("validates and forwards exact project filters through dashboard authentication", async () => {
  const server = app(); vi.stubEnv("FUSION_SESSIONS", "1"); const headers = { Authorization: "Bearer dashboard-token" };
  list.mockResolvedValue({ sessions: [], nextCursor: null }); collectors.mockResolvedValue([]); analytics.mockResolvedValue({ sessions: [] });
  expect((await request(server, "GET", "/api/external-sessions?projectPath=%2Frepo%20with%20spaces&host=m3", { headers })).status).toBe(200);
  expect(list).toHaveBeenCalledWith(expect.objectContaining({ projectPath: "/repo with spaces", hostId: "m3" }));
  for (const query of ["projectPath=a&projectPath=b", "projectPath=bad%0Apath", `projectPath=${"x".repeat(4097)}`]) {
    expect((await request(server, "GET", `/api/external-sessions?${query}`, { headers })).status).toBe(400);
  }
});
