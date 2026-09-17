import express from "express";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createAuthMiddleware } from "../../auth-middleware.js";
import { ApiError } from "../../api-error.js";
import { request } from "../../test-request.js";
import type { ApiRoutesContext } from "../types.js";
import { authenticateExternalSessionCollector } from "../external-session-collector-auth.js";
import { ExternalSessionValidationError, ExternalSessionConflictError, ExternalSessionCapacityError, parseExternalSessionDelivery } from "../../../../core/src/external-sessions/contract.js";
import { registerExternalSessionRoutes } from "../register-external-session-routes.js";

const mocks = vi.hoisted(() => ({ ingest: vi.fn(), list: vi.fn(), collectors: vi.fn() }));
vi.mock("@fusion/core", async () => {
  const contract = await import("../../../../core/src/external-sessions/contract.js");
  return { ...contract, ExternalSessionStore: class { ingest = mocks.ingest; list = mocks.list; collectors = mocks.collectors; } };
});

const token = "m3-collector-token-01234567890123456789";
const otherToken = "J-collector-token-01234567890123456789";
const credentials = JSON.stringify({ m3: token, J: otherToken });
const body = { version: 1, eventId: "event-1", streamId: "stream-1", sequence: 1, collectorVersion: "1.0", kind: "heartbeat" };
const collectorHeaders = { Authorization: `Bearer ${token}`, "Content-Type": "application/json" };
const dashboardHeaders = { Authorization: "Bearer dashboard-token" };

function app(auth = true, layer: object | null = {}) {
  const server = express();
  server.use(express.json());
  if (auth) server.use(createAuthMiddleware("dashboard-token"));
  const router = express.Router();
  registerExternalSessionRoutes({ router, store: { getAsyncLayer: () => layer } } as unknown as ApiRoutesContext);
  server.use("/api", router);
  server.use((_req, res) => res.status(404).json({ error: "Not found" }));
  server.use((error: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    const status = error instanceof ApiError ? error.statusCode
      : (error as { type?: string }).type === "entity.too.large" ? 413 : 500;
    res.status(status).json({ error: "Unavailable" });
  });
  return server;
}

beforeEach(() => {
  vi.stubEnv("FUSION_EXTERNAL_SESSION_INGESTION", "1");
  vi.stubEnv("FUSION_EXTERNAL_SESSION_COLLECTORS", credentials);
  mocks.ingest.mockResolvedValue({ acknowledged: true, hostId: "m3", eventId: body.eventId, sequence: 1 });
  mocks.list.mockResolvedValue({ sessions: [], nextCursor: null });
  mocks.collectors.mockResolvedValue([]);
});
afterEach(() => { vi.unstubAllEnvs(); vi.resetAllMocks(); });

describe("external collector credentials", () => {
  it("binds a credential to exactly one host", () => {
    expect(authenticateExternalSessionCollector(`Bearer ${token}`, credentials)).toBe("m3");
    expect(authenticateExternalSessionCollector(`Bearer ${otherToken}`, credentials)).toBe("J");
    expect(authenticateExternalSessionCollector("Bearer dashboard-token", credentials)).toBeNull();
  });
  it.each([undefined, "broken", "[]", "null", JSON.stringify({ m3: "short" }),
    JSON.stringify({ m3: token, J: token }), JSON.stringify({ "bad/host": token }), JSON.stringify({ m3: 1 })])("fails closed for invalid config %s", config => {
      expect(authenticateExternalSessionCollector(`Bearer ${token}`, config)).toBeNull();
    });
});

describe("external session routes", () => {
  it("allows host ingestion through daemon auth and acknowledges after persistence", async () => {
    let resolvePersistence!: (value: unknown) => void;
    let signalStarted!: () => void;
    const started = new Promise<void>(resolve => { signalStarted = resolve; });
    mocks.ingest.mockImplementation(() => {
      signalStarted();
      return new Promise(resolve => { resolvePersistence = resolve; });
    });
    const pending = request(app(), "POST", "/api/external-sessions/ingest", JSON.stringify(body), collectorHeaders);
    await started;
    expect(mocks.ingest).toHaveBeenCalledWith("m3", body);
    resolvePersistence({ acknowledged: true, sequence: 1 });
    expect(await pending).toMatchObject({ status: 200, body: { acknowledged: true, sequence: 1 } });
  });
  it.each([true, false])("requires collector auth with dashboard auth=%s", async auth => {
    expect(await request(app(auth), "POST", "/api/external-sessions/ingest", JSON.stringify(body),
      { ...collectorHeaders, Authorization: "Bearer dashboard-token" })).toMatchObject({ status: 401 });
    expect(await request(app(auth), "POST", "/api/external-sessions/ingest?fn_token=" + token,
      JSON.stringify(body), { "Content-Type": "application/json" })).toMatchObject({ status: 401 });
    expect(mocks.ingest).not.toHaveBeenCalled();
  });
  it.each([{ Origin: "https://browser.test" }, { "Sec-Fetch-Site": "same-origin" }, { Cookie: "session=browser" }])("rejects browser request %j", async headers => {
      expect(await request(app(), "POST", "/api/external-sessions/ingest", JSON.stringify(body),
        { ...collectorHeaders, ...headers })).toMatchObject({ status: 403 });
      expect(mocks.ingest).not.toHaveBeenCalled();
    });
  it("stays disabled by default", async () => {
    vi.stubEnv("FUSION_EXTERNAL_SESSION_INGESTION", "");
    expect(await request(app(), "POST", "/api/external-sessions/ingest", JSON.stringify(body), collectorHeaders)).toMatchObject({ status: 404 });
    expect(await request(app(), "GET", "/api/external-sessions", undefined, dashboardHeaders)).toMatchObject({ status: 404 });
    expect(mocks.ingest).not.toHaveBeenCalled();
  });
  it.each(["/api/external-sessions", "/api/external-sessions/collectors", "/api/external-sessions/ingest", "/api/external-sessions/ingest/extra"])("does not exempt GET %s or grant read access to a collector", async path => {
      expect(await request(app(), "GET", path, undefined, collectorHeaders)).toMatchObject({ status: 401 });
    });
  it("does not exempt neighboring POST paths", async () => {
    expect(await request(app(), "POST", "/api/external-sessions/ingest/extra", JSON.stringify(body), collectorHeaders)).toMatchObject({ status: 401 });
  });
  it("requires verified dashboard auth even in no-auth mode", async () => {
    expect(await request(app(false), "GET", "/api/external-sessions", undefined, dashboardHeaders)).toMatchObject({ status: 401 });
    expect(await request(app(false), "GET", "/api/external-sessions/collectors", undefined, dashboardHeaders)).toMatchObject({ status: 401 });
    expect(mocks.list).not.toHaveBeenCalled();
  });
  it("serves authenticated bounded session and collector reads", async () => {
    expect(await request(app(), "GET", "/api/external-sessions?hostId=J&provider=claude&limit=10", undefined, dashboardHeaders)).toMatchObject({ status: 200 });
    expect(mocks.list).toHaveBeenCalledWith({ hostId: "J", provider: "claude", limit: 10, after: undefined });
    expect(await request(app(), "GET", "/api/external-sessions/collectors", undefined, dashboardHeaders)).toMatchObject({ status: 200, body: { collectors: [] } });
  });
  it.each(["limit=-1", "limit=word", "hostId=J&hostId=m3"])("rejects malformed read query %s", async query => {
    expect(await request(app(), "GET", `/api/external-sessions?${query}`, undefined, dashboardHeaders)).toMatchObject({ status: 400 });
    expect(mocks.list).not.toHaveBeenCalled();
  });
  it.each([[new ExternalSessionValidationError("Invalid delivery"), 400],
    [new ExternalSessionConflictError("Event identity conflict"), 409],
    [new ExternalSessionCapacityError("Collector capacity reached"), 503], [new Error("database secret"), 503]] as const)("never acknowledges a persistence failure %s", async (error, status) => {
      mocks.ingest.mockRejectedValue(error);
      const result = await request(app(), "POST", "/api/external-sessions/ingest", JSON.stringify(body), collectorHeaders);
      expect(result.status).toBe(status);
      expect(result.body).not.toHaveProperty("acknowledged");
      expect(JSON.stringify(result.body)).not.toContain("database secret");
    });
  it("rejects a forged host through the actual domain parser", async () => {
    mocks.ingest.mockImplementation((_host, value) => parseExternalSessionDelivery(value));
    expect(await request(app(), "POST", "/api/external-sessions/ingest", JSON.stringify({ ...body, hostId: "J" }), collectorHeaders)).toMatchObject({ status: 400 });
  });
  it("returns unavailable rather than an acknowledgement without PostgreSQL", async () => {
    expect(await request(app(true, null), "POST", "/api/external-sessions/ingest", JSON.stringify(body), collectorHeaders)).toMatchObject({ status: 503 });
    expect(mocks.ingest).not.toHaveBeenCalled();
  });
  it("enforces Fusion's default 100 KiB JSON limit", async () => {
    expect(await request(app(), "POST", "/api/external-sessions/ingest", JSON.stringify({ ...body, extra: "x".repeat(103_000) }), collectorHeaders)).toMatchObject({ status: 413 });
    expect(mocks.ingest).not.toHaveBeenCalled();
  });
});
