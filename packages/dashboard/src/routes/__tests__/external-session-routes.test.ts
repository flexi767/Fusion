// @vitest-environment node
import express from "express";
import { createHash } from "node:crypto";
import { afterEach, expect, it, vi } from "vitest";
import { createAuthMiddleware } from "../../auth-middleware.js";
import { registerExternalSessionRoutes } from "../register-external-session-routes.js";
import type { ApiRoutesContext } from "../types.js";
import { request as rawRequest } from "../../test-request.js";
function request(app: express.Express, method: string, path: string, options: { body?: unknown; headers?: Record<string, string> } = {}) {
  return rawRequest(app, method, path, options.body ? JSON.stringify(options.body) : undefined, { "Content-Type": "application/json", ...options.headers });
}
const ingest = vi.fn();
const heartbeat = vi.fn();
vi.mock("@fusion/core", () => ({ ExternalSessionStore: class { ingest = ingest; heartbeat = heartbeat; } }));
afterEach(() => { vi.unstubAllEnvs(); vi.clearAllMocks(); });
function app() {
  vi.stubEnv("FUSION_SESSION_INGESTION", "1");
  vi.stubEnv("FUSION_SESSION_COLLECTORS", JSON.stringify({ m3: createHash("sha256").update("collector-token").digest("hex") }));
  const app = express(); app.use(express.json()); app.use(createAuthMiddleware("dashboard-token"));
  const router = express.Router();
  registerExternalSessionRoutes({ router, store: { getAsyncLayer: () => ({}) } } as unknown as ApiRoutesContext);
  app.use("/api", router); return app;
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
