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
const ingest = vi.fn();
const heartbeat = vi.fn();
const linkTask = vi.fn(); const get = vi.fn(); const list = vi.fn(); const getTask = vi.fn();
vi.mock("@fusion/core", () => ({ ExternalSessionStore: class { ingest = ingest; heartbeat = heartbeat; linkTask = linkTask; get = get; list = list; } }));
afterEach(() => { vi.unstubAllEnvs(); vi.clearAllMocks(); });
function app() {
  vi.stubEnv("FUSION_SESSION_INGESTION", "1");
  vi.stubEnv("FUSION_SESSION_COLLECTORS", JSON.stringify({ m3: createHash("sha256").update("collector-token").digest("hex") }));
  const app = express(); app.use(express.json()); app.use(createAuthMiddleware("dashboard-token"));
  const router = express.Router();
  registerExternalSessionRoutes({ router, store: { getAsyncLayer: () => ({}) }, getScopedStore: async () => ({ getProjectId: () => "canonical-project", getTask }) } as unknown as ApiRoutesContext);
  app.use("/api", router);
  app.use((error: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => res.status(error instanceof ApiError ? error.statusCode : 500).json({ error: error instanceof Error ? error.message : "Failed" }));
  return app;
}
const body = { version: 1, eventId: "event-1", collectorVersion: "test", observation: { hostId: "spoofed" } };
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
  const envelope = { version: 1, eventId: "health", collectorVersion: "test", diagnostics: { spoolDepth: 12, rejectedDeliveries: 1, parseError: true, secret: "never retained" } };
  expect((await request(server, "POST", "/api/session-collector", { body: envelope, headers })).status).toBe(200);
  expect(heartbeat).toHaveBeenCalledWith("m3", "test", undefined, { spoolDepth: 12, rejectedDeliveries: 1, parseError: true });
  expect((await request(server, "POST", "/api/session-collector", { body: { ...envelope, diagnostics: { spoolDepth: -1 } }, headers })).status).toBe(400);
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
