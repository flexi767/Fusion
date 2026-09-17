import { ExternalSessionStore, ExternalSessionConflictError, ExternalSessionValidationError, ExternalSessionCapacityError } from "@fusion/core";
import { ApiError } from "../api-error.js";
import { hasVerifiedDaemonRequest } from "../auth-middleware.js";
import type { ApiRouteRegistrar } from "./types.js";
import { authenticateExternalSessionCollector } from "./external-session-collector-auth.js";

export const registerExternalSessionRoutes: ApiRouteRegistrar = ({ router, store, options }) => {
  const sessions = () => {
    const layer = options?.centralCore?.asyncLayer ?? store.getAsyncLayer();
    if (!layer) throw new ApiError(503, "External sessions require PostgreSQL");
    return new ExternalSessionStore(layer);
  };
  const enabled = () => process.env.FUSION_EXTERNAL_SESSION_INGESTION === "1";

  router.post("/external-sessions/ingest", async (req, res) => {
    if (!enabled()) return res.status(404).json({ error: "External session ingestion disabled" });
    if (req.headers.origin !== undefined || req.headers["sec-fetch-site"] !== undefined || req.headers.cookie !== undefined) {
      return res.status(403).json({ error: "Collector requests only" });
    }
    const hostId = authenticateExternalSessionCollector(req.headers.authorization, process.env.FUSION_EXTERNAL_SESSION_COLLECTORS);
    if (!hostId) return res.status(401).json({ error: "Invalid collector credential" });
    try {
      return res.json(await sessions().ingest(hostId, req.body));
    } catch (error) {
      if (error instanceof ExternalSessionValidationError) return res.status(400).json({ error: error.message });
      if (error instanceof ExternalSessionConflictError) return res.status(409).json({ error: error.message });
      if (error instanceof ExternalSessionCapacityError) return res.status(503).json({ error: error.message });
      throw new ApiError(503, "External session persistence unavailable");
    }
  });

  router.get("/external-sessions", async (req, res) => {
    if (!enabled()) return res.status(404).json({ error: "External sessions disabled" });
    if (!hasVerifiedDaemonRequest(req)) return res.status(401).json({ error: "Dashboard authentication required" });
    const field = (name: string): string | undefined => {
      const value = req.query[name];
      if (value !== undefined && typeof value !== "string") throw new ApiError(400, `Invalid ${name}`);
      return value as string | undefined;
    };
    try {
      const rawLimit = field("limit");
      if (rawLimit !== undefined && !/^\d{1,3}$/.test(rawLimit)) throw new ApiError(400, "Invalid limit");
      return res.json(await sessions().list({ hostId: field("hostId"), provider: field("provider"),
        after: field("after"), limit: rawLimit === undefined ? undefined : Number(rawLimit) }));
    } catch (error) {
      if (error instanceof ExternalSessionValidationError) return res.status(400).json({ error: error.message });
      throw error;
    }
  });

  router.get("/external-sessions/collectors", async (req, res) => {
    if (!enabled()) return res.status(404).json({ error: "External sessions disabled" });
    if (!hasVerifiedDaemonRequest(req)) return res.status(401).json({ error: "Dashboard authentication required" });
    return res.json({ collectors: await sessions().collectors() });
  });
};
