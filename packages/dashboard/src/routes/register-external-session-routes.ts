import { readSessionPricing } from "./session-pricing.js";
import { createSessionSummaryWorker } from "./session-summary-worker.js";
import { ExternalSessionStore, ExternalSessionRetention, externalSessionAnalytics, priceSessionTurns, ExternalSessionControls, ExternalSessionSummaries, ExternalSessionLaunches } from "@fusion/core";
import { ApiError } from "../api-error.js";
import type { ApiRouteRegistrar } from "./types.js";
import { authenticateSessionCollector } from "./session-collector-auth.js";

export const registerExternalSessionRoutes: ApiRouteRegistrar = ({ router, store, options, registerDispose, getScopedStore }) => {
  const layer = () => {
    const layer = options?.centralCore?.asyncLayer ?? store.getAsyncLayer();
    if (!layer) throw new ApiError(503, "Sessions require PostgreSQL");
    return layer;
  };
  const sessions = () => new ExternalSessionStore(layer());
  const hostControlsEnabled = (host: string) => process.env.FUSION_SESSION_CONTROLS === "1" && (process.env.FUSION_SESSION_CONTROL_HOSTS ?? "").split(",").includes(host);
  const controls = () => new ExternalSessionControls(layer());
  const summaries = () => new ExternalSessionSummaries(layer());
  const launches = () => new ExternalSessionLaunches(layer());
  const launchesEnabled = () => process.env.FUSION_SESSIONS === "1" && process.env.FUSION_SESSION_LAUNCHES === "1" && process.env.FUSION_SESSION_CONTROLS === "1";
  const summaryWorker = process.env.FUSION_SESSION_SUMMARIES === "1" && process.env.FUSION_SESSION_SUMMARY_URL
    ? createSessionSummaryWorker(layer, process.env.FUSION_SESSION_SUMMARY_URL) : undefined;
  if (summaryWorker) registerDispose(() => summaryWorker.stop());
  // This exact POST is independently authenticated, including when dashboard auth is disabled.
  router.post("/session-collector", async (req, res) => {
    if (process.env.FUSION_SESSION_INGESTION !== "1") return res.status(404).json({ error: "Session ingestion disabled" });
    if (req.headers.origin || req.headers["sec-fetch-site"]) return res.status(403).json({ error: "Collector requests only" });
    const hostId = authenticateSessionCollector(req.headers.authorization, process.env.FUSION_SESSION_COLLECTORS);
    if (!hostId) return res.status(401).json({ error: "Invalid collector credential" });
    const { version, eventId, collectorVersion, observation, turns, runtime, commandClaim, commandAck, historical, importedNotes, importedMetadata, diagnostics, probe } = req.body ?? {};
    if (version !== 1 || typeof eventId !== "string" || !/^[a-zA-Z0-9:_-]{1,128}$/.test(eventId)
      || typeof collectorVersion !== "string" || !/^[a-zA-Z0-9._-]{1,64}$/.test(collectorVersion)) {
      return res.status(400).json({ error: "Invalid delivery envelope" });
    }
    const operations = [observation, runtime, commandClaim, commandAck, probe === true ? true : undefined].filter(value => value !== undefined).length;
    if (operations > 1 || (turns !== undefined && observation === undefined) || (historical === true && observation === undefined)) return res.status(400).json({ error: "Ambiguous delivery envelope" });
    try {
      if (probe === true) return res.json({ eventId, hostId, acknowledged: true });
      if (runtime || commandClaim || commandAck) {
        if (!hostControlsEnabled(hostId)) return res.status(403).json({ error: "Host controls disabled" });
        if (runtime) { await controls().register(hostId, runtime.sessionId, runtime.generation, runtime.capabilities); return res.json({ eventId, acknowledged: true }); }
        if (commandClaim) return res.json({ eventId, commands: await controls().claim(hostId, commandClaim.sessionId, commandClaim.generation) });
        return res.json({ eventId, acknowledged: await controls().acknowledge(hostId, commandAck.id, commandAck.generation, commandAck.status) });
      }
      if (observation === undefined) {
        const health: Record<string, number | boolean> = {};
        if (diagnostics !== undefined) {
          if (!diagnostics || typeof diagnostics !== "object" || Array.isArray(diagnostics)) return res.status(400).json({ error: "Invalid collector diagnostics" });
          for (const field of ["spoolDepth", "rejectedDeliveries", "discoveredFiles", "parserStateBytes", "spoolBytes", "liveLagSamples", "liveLagClockSkewSamples", "liveLagP95Ms", "liveLagMaxMs", "liveQueueP95Ms", "oldestLivePendingMs"]) {
            const value = diagnostics[field];
            if (value !== undefined) {
              if (!Number.isSafeInteger(value) || value < 0) return res.status(400).json({ error: "Invalid collector diagnostics" });
              health[field] = value;
            }
          }
          for (const field of ["parseError", "deliveryError", "resourcePaused"]) if (typeof diagnostics[field] === "boolean") health[field] = diagnostics[field];
        }
        await sessions().heartbeat(hostId, collectorVersion, undefined, health);
        return res.json({ eventId, hostId, acknowledged: true });
      }
      const pricing = Array.isArray(turns) && turns.length ? await readSessionPricing(() => store.getGlobalSettingsStore().getSettings()) : undefined;
      const result = await sessions().ingest(hostId, collectorVersion, observation, turns, historical === true, importedNotes, importedMetadata, pricing);
      if (result.applied) summaryWorker?.enqueue(result.id);
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
    if ([query.host, query.projectPath, query.provider, query.activity, query.q, query.saved, query.before].some((v) => v !== undefined && typeof v !== "string")) throw new ApiError(400, "Invalid session filter");
    if (typeof query.q === "string" && query.q.length > 256) throw new ApiError(400, "Invalid session search");
    if (typeof query.projectPath === "string" && (query.projectPath.length > 4096 || /[\u0000-\u001f]/u.test(query.projectPath))) throw new ApiError(400, "Invalid project path filter");
    const result = await sessions().list({ projectPath: query.projectPath as string | undefined, saved: query.saved as string | undefined, activity: query.activity as string | undefined, q: query.q as string | undefined, hostId: query.host as string | undefined, provider: query.provider as string | undefined, before: query.before as string | undefined });
    const settings = await store.getGlobalSettingsStore().getSettings();
    const totals = await externalSessionAnalytics(layer(), { sessionIds: result.sessions.map(row => row.id) }, settings.modelPricingOverrides);
    const costs = new Map(totals.sessions.map(row => [row.id, row]));
    res.json({ enabled: true, ...result, sessions: result.sessions.map(row => ({ ...row, usageSummary: costs.get(row.id) ?? null })), collectors: await sessions().collectors() });
  });
  router.post("/external-session-retention/:operation", async (req, res) => {
    if (process.env.FUSION_SESSIONS !== "1") throw new ApiError(404, "Sessions disabled");
    const operation = req.params.operation;
    if (!["preview", "apply"].includes(operation)) throw new ApiError(404, "Unknown retention operation");
    const now = Date.now();
    const days = req.body?.retentionDays;
    if (operation === "preview" && (!Number.isSafeInteger(days) || days < 1 || days > 3650)) throw new ApiError(400, "Retention days must be between 1 and 3650");
    const cutoff = operation === "preview" ? new Date(now - days * 86_400_000).toISOString() : req.body?.cutoff;
    if (typeof cutoff !== "string") throw new ApiError(400, "A reviewed retention cutoff is required");
    const retention = new ExternalSessionRetention(layer());
    try { return res.json(operation === "preview" ? await retention.preview(cutoff, now) : await retention.apply(cutoff, now)); }
    catch (error) {
      if (error instanceof Error && error.message.startsWith("Retention cutoff")) throw new ApiError(400, error.message);
      throw error;
    }
  });
  router.get("/external-session-launches", async (_req, res) => {
    if (!launchesEnabled()) return res.json({ enabled: false, runtimes: [], requests: [] });
    return res.json({ enabled: true, runtimes: (await launches().available()).filter(row => hostControlsEnabled(row.hostId)), requests: (await launches().list()).filter(row => hostControlsEnabled(row.hostId)) });
  });
  router.post("/external-session-launches", async (req, res) => {
    if (!launchesEnabled()) throw new ApiError(404, "Session launches disabled");
    const body = req.body;
    if (!body || typeof body !== "object" || Array.isArray(body) || Object.keys(body).some(key => !["id", "hostId", "projectId", "generation", "prompt", "model"].includes(key))) throw new ApiError(400, "Invalid launch fields");
    if (!hostControlsEnabled(body.hostId)) throw new ApiError(403, "Host launches disabled");
    try { return res.json(await launches().queue(body)); }
    catch (error) { throw new ApiError(409, error instanceof Error ? error.message : "Launch rejected"); }
  });
  router.post("/external-session-launches/:id/cancel", async (req, res) => {
    if (!launchesEnabled()) throw new ApiError(404, "Session launches disabled");
    if (!hostControlsEnabled(req.body?.hostId)) throw new ApiError(403, "Host launches disabled");
    if (!await launches().cancel(String(req.params.id), req.body.hostId)) throw new ApiError(409, "Launch already claimed or changed; inspect its current state");
    return res.json({ cancelled: true });
  });
  router.get("/external-session-usage", async (req, res) => {
    if (process.env.FUSION_SESSIONS !== "1") throw new ApiError(404, "Sessions disabled");
    const { from, to, host, model, groupBy, basis } = req.query;
    if ([from, to, host, model, groupBy, basis].some(value => value !== undefined && typeof value !== "string")) throw new ApiError(400, "Invalid usage filter");
    const settings = await store.getGlobalSettingsStore().getSettings();
    try { return res.json(await externalSessionAnalytics(layer(), { from: from as string | undefined, to: to as string | undefined, host: host as string | undefined, model: model as string | undefined, groupBy: groupBy as "session" | "turn" | undefined, basis: basis as "current" | "recorded" | undefined }, settings.modelPricingOverrides)); }
    catch (error) { if (error instanceof Error && error.message.startsWith("Invalid analytics")) throw new ApiError(400, error.message); throw error; }
  });
  const linkedTask = async (req: import("express").Request) => {
    const scoped = await getScopedStore(req);
    const projectId = scoped.getProjectId();
    if (!projectId) throw new ApiError(409, "Task links require a registered project");
    const taskId = String(req.params.taskId);
    const task = await scoped.getTask(taskId).catch(() => null);
    if (!task) throw new ApiError(404, "Task not found in this project");
    return { projectId, taskId };
  };
  router.get("/tasks/:taskId/external-sessions", async (req, res) => {
    if (process.env.FUSION_SESSIONS !== "1") return res.json({ enabled: false, sessions: [], nextCursor: null });
    const task = await linkedTask(req);
    const result = await sessions().list({ taskProjectId: task.projectId, taskId: task.taskId, before: typeof req.query.before === "string" ? req.query.before : undefined });
    return res.json({ enabled: true, ...result });
  });
  router.put("/tasks/:taskId/external-sessions/:sessionId", async (req, res) => {
    if (process.env.FUSION_SESSIONS !== "1") throw new ApiError(404, "Sessions disabled");
    const task = await linkedTask(req);
    if (!await sessions().get(String(req.params.sessionId))) throw new ApiError(404, "Session not found");
    try { return res.json(await sessions().linkTask(String(req.params.sessionId), task.projectId, task.taskId, req.body?.linked, req.body?.expectedRevision)); }
    catch { throw new ApiError(409, "Session link changed elsewhere or belongs to another task"); }
  });
  router.get("/external-sessions/:id", async (req, res) => {
    if (process.env.FUSION_SESSIONS !== "1") throw new ApiError(404, "Sessions disabled");
    const session = await sessions().get(String(req.params.id));
    if (!session) throw new ApiError(404, "Session not found");
    const basis = req.query.basis === "recorded" ? "recorded" : "current";
    const history = await sessions().turns(session.id, typeof req.query.before === "string" ? req.query.before : undefined);
    const settings = await store.getGlobalSettingsStore().getSettings();
    const wholeSessionUsage = await externalSessionAnalytics(layer(), { sessionId: session.id, basis }, settings.modelPricingOverrides);
    res.json({ session, ...history, turnCosts: Object.fromEntries(history.turns.map(turn => [turn.id, priceSessionTurns(session.provider, [turn], settings.modelPricingOverrides, basis)])), wholeSessionUsage: wholeSessionUsage.sessions[0] ?? null, summariesEnabled: process.env.FUSION_SESSION_SUMMARIES === "1" && Boolean(process.env.FUSION_SESSION_SUMMARY_URL), details: await summaries().get(session.id), runtime: hostControlsEnabled(session.hostId) ? await controls().capability(session.id) : null, commands: await controls().list(session.id), cost: priceSessionTurns(session.provider, history.turns, settings.modelPricingOverrides, basis) });
  });
  router.get("/external-sessions/:id/turns/:turnId", async (req, res) => {
    if (process.env.FUSION_SESSIONS !== "1") throw new ApiError(404, "Sessions disabled");
    const session = await sessions().get(String(req.params.id));
    if (!session) throw new ApiError(404, "Session not found");
    const turn = await sessions().turn(session.id, String(req.params.turnId));
    if (!turn) throw new ApiError(404, "Turn not found");
    const settings = await store.getGlobalSettingsStore().getSettings();
    res.json({ turn, cost: priceSessionTurns(session.provider, [turn], settings.modelPricingOverrides, req.query.basis === "recorded" ? "recorded" : "current") });
  });
  router.post("/external-sessions/:id/commands", async (req, res) => {
    if (process.env.FUSION_SESSION_CONTROLS !== "1") return res.status(404).json({ error: "Session controls disabled" });
    const session = await sessions().get(String(req.params.id));
    if (!session || !hostControlsEnabled(session.hostId)) return res.status(403).json({ error: "Host controls disabled" });
    try { return res.json(await controls().queue(String(req.params.id), req.body?.id, req.body?.operation, req.body?.text)); }
    catch (error) { return res.status(409).json({ error: error instanceof Error ? error.message : "Command rejected" }); }
  });
  router.put("/external-sessions/:id/preferences", async (req, res) => {
    if (process.env.FUSION_SESSIONS !== "1") throw new ApiError(404, "Sessions disabled");
    try { res.json(await sessions().preferences(String(req.params.id), req.body?.archived, req.body?.pinned, req.body?.expectedRevision)); }
    catch { throw new ApiError(409, "Preferences changed elsewhere or could not be saved"); }
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
