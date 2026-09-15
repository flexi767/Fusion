import { ExternalSessionStore, priceSessionTurns, ExternalSessionControls, ExternalSessionSummaries } from "@fusion/core";
import { ApiError } from "../api-error.js";
import type { ApiRouteRegistrar } from "./types.js";
import { authenticateSessionCollector } from "./session-collector-auth.js";

export const registerExternalSessionRoutes: ApiRouteRegistrar = ({ router, store, options }) => {
  const layer = () => {
    const layer = options?.centralCore?.asyncLayer ?? store.getAsyncLayer();
    if (!layer) throw new ApiError(503, "Sessions require PostgreSQL");
    return layer;
  };
  const sessions = () => new ExternalSessionStore(layer());
  const controls = () => new ExternalSessionControls(layer());
  const summaries = () => new ExternalSessionSummaries(layer());
  // This exact POST is independently authenticated, including when dashboard auth is disabled.
  router.post("/session-collector", async (req, res) => {
    if (process.env.FUSION_SESSION_INGESTION !== "1") return res.status(404).json({ error: "Session ingestion disabled" });
    if (req.headers.origin || req.headers["sec-fetch-site"]) return res.status(403).json({ error: "Collector requests only" });
    const hostId = authenticateSessionCollector(req.headers.authorization, process.env.FUSION_SESSION_COLLECTORS);
    if (!hostId) return res.status(401).json({ error: "Invalid collector credential" });
    const { version, eventId, collectorVersion, observation, turns, runtime, commandClaim, commandAck, historical } = req.body ?? {};
    if (version !== 1 || typeof eventId !== "string" || !/^[a-zA-Z0-9:_-]{1,128}$/.test(eventId)
      || typeof collectorVersion !== "string" || !/^[a-zA-Z0-9._-]{1,64}$/.test(collectorVersion)) {
      return res.status(400).json({ error: "Invalid delivery envelope" });
    }
    const operations = [observation, runtime, commandClaim, commandAck].filter(value => value !== undefined).length;
    if (operations > 1 || (turns !== undefined && observation === undefined) || (historical === true && observation === undefined)) return res.status(400).json({ error: "Ambiguous delivery envelope" });
    try {
      if (runtime || commandClaim || commandAck) {
        if (process.env.FUSION_SESSION_CONTROLS !== "1" || !(process.env.FUSION_SESSION_CONTROL_HOSTS ?? "").split(",").includes(hostId)) return res.status(403).json({ error: "Host controls disabled" });
        if (runtime) { await controls().register(hostId, runtime.sessionId, runtime.generation, runtime.capabilities); return res.json({ eventId, acknowledged: true }); }
        if (commandClaim) return res.json({ eventId, commands: await controls().claim(hostId, commandClaim.sessionId, commandClaim.generation) });
        return res.json({ eventId, acknowledged: await controls().acknowledge(hostId, commandAck.id, commandAck.generation, commandAck.status) });
      }
      if (observation === undefined) {
        await sessions().heartbeat(hostId, collectorVersion);
        return res.json({ eventId, hostId, acknowledged: true });
      }
      const result = await sessions().ingest(hostId, collectorVersion, observation, turns, historical === true);
      return res.json({ eventId, hostId, acknowledged: true, ...result });
    } catch (error) {
      const message = error instanceof Error ? error.message : "";
      if (message === "Observation revision conflict") return res.status(409).json({ error: message });
      if (/^(Invalid |Unsupported observation)/.test(message)) return res.status(400).json({ error: message });
      return res.status(503).json({ error: "Observation was not acknowledged; retry delivery" });
    }
  });
  router.get("/external-sessions", async (req, res) => {
    if (process.env.FUSION_SESSIONS !== "1") return res.json({ enabled: false, sessions: [], collectors: [], nextCursor: null });
    if (req.query.capabilities === "1") return res.json({ enabled: true });
    const query = req.query;
    if ([query.host, query.provider, query.before].some((v) => v !== undefined && typeof v !== "string")) throw new ApiError(400, "Invalid session filter");
    const result = await sessions().list({ hostId: query.host as string | undefined, provider: query.provider as string | undefined, before: query.before as string | undefined });
    res.json({ enabled: true, ...result, collectors: await sessions().collectors() });
  });
  router.get("/external-sessions/:id", async (req, res) => {
    if (process.env.FUSION_SESSIONS !== "1") throw new ApiError(404, "Sessions disabled");
    const session = await sessions().get(String(req.params.id));
    if (!session) throw new ApiError(404, "Session not found");
    const history = await sessions().turns(session.id, typeof req.query.before === "string" ? req.query.before : undefined);
    const settings = await store.getGlobalSettingsStore().getSettings();
    res.json({ session, ...history, summariesEnabled: process.env.FUSION_SESSION_SUMMARIES === "1" && Boolean(process.env.FUSION_SESSION_SUMMARY_URL), details: await summaries().get(session.id), runtime: process.env.FUSION_SESSION_CONTROLS === "1" ? await controls().capability(session.id) : null, commands: await controls().list(session.id), cost: priceSessionTurns(session.provider, history.turns, settings.modelPricingOverrides) });
  });
  router.post("/external-sessions/:id/commands", async (req, res) => {
    if (process.env.FUSION_SESSION_CONTROLS !== "1") return res.status(404).json({ error: "Session controls disabled" });
    try { return res.json(await controls().queue(String(req.params.id), req.body?.id, req.body?.operation, req.body?.text)); }
    catch (error) { return res.status(409).json({ error: error instanceof Error ? error.message : "Command rejected" }); }
  });
  router.put("/external-sessions/:id/notes", async (req, res) => {
    if (process.env.FUSION_SESSIONS !== "1") return res.status(404).json({ error: "Sessions disabled" });
    try { return res.json(await summaries().notes(String(req.params.id), req.body?.notes, req.body?.expectedRevision)); }
    catch { return res.status(409).json({ error: "Notes could not be saved; reload the current revision" }); }
  });
  router.post("/external-sessions/:id/summary", async (req, res) => {
    const endpoint = process.env.FUSION_SESSION_SUMMARY_URL;
    if (process.env.FUSION_SESSION_SUMMARIES !== "1" || !endpoint) return res.status(404).json({ error: "Session summaries disabled" });
    return res.json(await summaries().summarize(String(req.params.id), endpoint));
  });

};
