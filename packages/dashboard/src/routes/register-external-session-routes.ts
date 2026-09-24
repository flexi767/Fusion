import { ExternalSessionStore, ExternalSessionReader, ExternalSessionConflict, externalSessionIngestionSchema,
  externalSessionHeartbeatSchema, externalSessionListQuerySchema, externalSessionReadId,
  externalSessionCursorAfter, ExternalSessionFeedback, ExternalFeedbackConflict, feedbackClaimSchema, feedbackAckSchema,
  ExternalSessionTurnStore, ExternalSessionTurnReader, ExternalSessionTurnConflict, externalSessionTurnIngestionSchema } from "@fusion/core";
import { ApiError } from "../api-error.js";
import { sessionCostBadge, summarizeTurnCost } from "../remote-agents/session-cost.js";
import { recordedRatesFor } from "../remote-agents/record-rates.js";
import { ExternalSessionTurnSearch } from "@fusion/core";
import type { ApiRouteRegistrar } from "./types.js";
import { authenticateExternalSessionCollector, parseExternalSessionCollectorCredentials } from "./external-session-collector-auth.js";
import { registerRemoteAgentActions } from "./register-remote-agent-actions.js";

/**
 * FNXC:ExternalSessions 2026-09-17-04:00:
 * Off by default. Collector access is limited to two ingestion endpoints, even with --no-auth.
 * Host identity comes exclusively from the credential; the explicit query project must match it.
 * Strict bounded bodies cannot submit runtime handles, capabilities, task links, or control requests.
 */
export const registerExternalSessionRoutes: ApiRouteRegistrar = ctx => {
  registerRemoteAgentActions(ctx);
  // FNXC:RemoteAgents 2026-09-17-23:19: Dashboard authentication owns list/detail access; the two collector POST exemptions grant no read access.
  ctx.router.get("/external-sessions", async (req, res) => {
    const limit = typeof req.query.limit === "string" && /^\d+$/.test(req.query.limit) ? Number(req.query.limit) : req.query.limit;
    const query = externalSessionListQuerySchema.safeParse({
      ...(req.query.hostId !== undefined ? { hostId: req.query.hostId } : {}),
      ...(req.query.provider !== undefined ? { provider: req.query.provider } : {}),
      ...(req.query.cursor !== undefined ? { cursor: req.query.cursor } : {}),
      ...(limit !== undefined ? { limit } : {}),
    });
    if (!query.success) throw new ApiError(400, "Invalid external session list query");
    const { store, projectId } = await ctx.getProjectContext(req);
    if (!projectId) throw new ApiError(503, "External session project storage unavailable");
    try { externalSessionCursorAfter(projectId, query.data); }
    catch { throw new ApiError(400, "Invalid external session cursor"); }
    const layer = store.getAsyncLayer();
    if (!layer || layer.projectId !== projectId) throw new ApiError(503, "External session project storage unavailable");
    /*
    FNXC:RemoteAgents 2026-09-23-21:32: Cost used to be reachable only by opening one session at a time, so
    "which session is expensive?" required N clicks. Each card now carries its own total, priced server-side
    from the same summary the detail pane uses, so the list and the detail can never disagree.
    */
    const page = await new ExternalSessionReader(layer, projectId).list(query.data);
    const settings = await store.getGlobalSettingsStore().getSettings();
    res.json({ ...page, sessions: page.sessions.map(session => ({ ...session, cost: sessionCostBadge(session, settings) })) });
  });
  /*
  FNXC:ExternalSessionSearch 2026-09-23-23:05: Registered BEFORE "/external-sessions/:id" on purpose; Express
  matches in order, so the parameter route would otherwise capture "search" as a session id and 400.
  */
  ctx.router.get("/external-sessions/search", async (req, res) => {
    const limit = typeof req.query.limit === "string" && /^\d+$/.test(req.query.limit) ? Number(req.query.limit) : undefined;
    if (typeof req.query.q !== "string") throw new ApiError(400, "Search requires a query");
    for (const key of ["hostId", "sessionId"] as const) {
      if (req.query[key] !== undefined && typeof req.query[key] !== "string") throw new ApiError(400, "Invalid external session search filter");
    }
    const { store, projectId } = await ctx.getProjectContext(req); const layer = store.getAsyncLayer();
    if (!projectId || !layer || layer.projectId !== projectId) throw new ApiError(503, "External session project storage unavailable");
    try {
      res.json(await new ExternalSessionTurnSearch(layer, projectId).search({ q: req.query.q,
        ...(limit === undefined ? {} : { limit }),
        ...(req.query.hostId === undefined ? {} : { hostId: String(req.query.hostId) }),
        ...(req.query.sessionId === undefined ? {} : { sessionId: String(req.query.sessionId) }) }));
    } catch (error) {
      if (error instanceof Error && error.name === "ZodError") throw new ApiError(400, "Invalid external session search query");
      throw error;
    }
  });
  ctx.router.get("/external-sessions/:id", async (req, res) => {
    const id = externalSessionReadId.safeParse(req.params.id);
    if (!id.success) throw new ApiError(400, "Invalid external session id");
    const { store, projectId } = await ctx.getProjectContext(req);
    const layer = store.getAsyncLayer();
    if (!projectId || !layer || layer.projectId !== projectId) throw new ApiError(503, "External session project storage unavailable");
    const session = await new ExternalSessionReader(layer, projectId).get(id.data);
    if (!session) throw new ApiError(404, "External session not found");
    res.json({ schemaVersion: 1, session });
  });
  ctx.router.get("/external-sessions/:id/turns", async (req, res) => {
    const id = externalSessionReadId.safeParse(req.params.id);
    const limit = typeof req.query.limit === "string" && /^\d+$/.test(req.query.limit) ? Number(req.query.limit) : req.query.limit;
    if (!id.success || (limit !== undefined && (!Number.isInteger(limit) || Number(limit) < 1 || Number(limit) > 100))
      || (req.query.cursor !== undefined && typeof req.query.cursor !== "string")) throw new ApiError(400, "Invalid external turn query");
    const { store, projectId } = await ctx.getProjectContext(req); const layer = store.getAsyncLayer();
    if (!projectId || !layer || layer.projectId !== projectId) throw new ApiError(503, "External session project storage unavailable");
    const priceTurns = async (page: { turns: Array<Record<string, unknown>> }) => {
      /* FNXC:ExternalSessionUsage 2026-09-23-23:24: Pricing is additive to turn history, so a failure to resolve
         the session or the rate table leaves turns UNPRICED rather than making the history itself unavailable. */
      let session: { provider: string } | null = null;
      let settings: Parameters<typeof summarizeTurnCost>[2];
      try {
        session = await new ExternalSessionReader(layer, projectId).get(id.data as string);
        settings = await store.getGlobalSettingsStore().getSettings();
      } catch { session = null; }
      /* FNXC:ExternalSessionUsage 2026-09-23-23:24: Priced here rather than in core so turns reuse the dashboard's
         single pricing seam; a session that vanished mid-read leaves turns unpriced instead of guessing a provider. */
      return { ...page, turns: page.turns.map(turn => ({ ...turn,
        cost: session ? summarizeTurnCost(turn, session.provider, settings, (turn.endedAt ?? turn.startedAt) as string | null) : null })) };
    };
    try { res.json(await priceTurns(await new ExternalSessionTurnReader(layer, projectId).list(id.data,
      { ...(limit === undefined ? {} : { limit: Number(limit) }), ...(req.query.cursor === undefined ? {} : { cursor: req.query.cursor }) }) as never)); }
    catch (error) {
      if (error instanceof SyntaxError || (error instanceof Error && (error.name === "ZodError" || error.message.includes("cursor scope")))) {
        throw new ApiError(400, "Invalid external turn cursor");
      }
      throw error;
    }
  });
  const configured = ctx.options?.externalSessionCollectors ?? process.env.FUSION_EXTERNAL_SESSION_COLLECTORS;
  let value: unknown = configured;
  if (typeof configured === "string") {
    try { value = configured.length <= 131_072 ? JSON.parse(configured) : null; } catch { value = null; }
  }
  const credentials = configured === undefined ? undefined : parseExternalSessionCollectorCredentials(value);
  for (const operation of ["ingest", "turn-ingest", "heartbeat", "feedback-claim", "feedback-ack"] as const) {
    ctx.router.post(`/external-sessions/${operation}`, async (req, res) => {
      if (credentials === undefined) throw new ApiError(404, "External session ingestion is disabled");
      if (credentials === null) throw new ApiError(503, "Invalid external session collector configuration");
      if (req.headers.origin || req.headers["sec-fetch-site"]) throw new ApiError(403, "Collector requests must not originate in a browser");
      const principal = authenticateExternalSessionCollector(req.headers.authorization, credentials);
      if (!principal) throw new ApiError(401, "Valid collector bearer token required");
      if (req.query.projectId !== principal.projectId) throw new ApiError(403, "Collector project scope mismatch");
      const parsed = (operation === "ingest" ? externalSessionIngestionSchema : operation === "turn-ingest" ? externalSessionTurnIngestionSchema : operation === "heartbeat" ? externalSessionHeartbeatSchema : operation === "feedback-claim" ? feedbackClaimSchema : feedbackAckSchema).safeParse(req.body);
      if (!parsed.success) throw new ApiError(400, "Invalid external session envelope");
      const { store, projectId } = await ctx.getProjectContext(req);
      const layer = store.getAsyncLayer();
      if (!layer || projectId !== principal.projectId || layer.projectId !== principal.projectId) {
        throw new ApiError(503, "External session project storage unavailable");
      }
      const sessions = new ExternalSessionStore(layer, principal);
      try {
        if (operation === "heartbeat") {
          await sessions.heartbeat(parsed.data);
          res.json({ schemaVersion: 1, hostId: principal.hostId });
        } else if (operation === "ingest") {
          res.json(await sessions.ingest(parsed.data));
        } else if (operation === "turn-ingest") {
          /*
          FNXC:ExternalSessionRates 2026-09-24-00:04: Stamp the applicable rates as the turn arrives; this is the
          last moment the true rate is knowable. The stamp is always recomputed here and overwrites anything the
          collector sent, so a host cannot choose the rates its own work is priced at.
          */
          const body = parsed.data as { sessionId: string; turn: Record<string, unknown> };
          let pricing: ReturnType<typeof recordedRatesFor>;
          try {
            const session = await new ExternalSessionReader(layer, principal.projectId).get(body.sessionId);
            if (session) pricing = recordedRatesFor(body.turn.usage as never, session.provider, await store.getGlobalSettingsStore().getSettings());
          } catch { pricing = undefined; }
          // An unavailable rate table must not refuse the turn: unstamped stays honestly unstamped.
          const turn = { ...body.turn, ...(pricing ? { pricing } : {}) };
          if (!pricing) delete (turn as { pricing?: unknown }).pricing;
          res.json(await new ExternalSessionTurnStore(layer, principal).ingest({ ...body, turn }));
        } else {
          const feedback = new ExternalSessionFeedback(layer, principal.projectId);
          res.json(operation === "feedback-claim" ? await feedback.claim(principal.hostId, parsed.data) : await feedback.acknowledge(principal.hostId, parsed.data));
        }
      } catch (error) {
        if (error instanceof ExternalFeedbackConflict) throw new ApiError(409, error.message);
        if (error instanceof ExternalSessionTurnConflict) throw new ApiError(error.code === "session-not-found" ? 404 : 409, error.code);
        if (error instanceof ExternalSessionConflict) {
          res.status(409).json({ error: error.code, ...(error.acknowledgedSequence !== undefined ? { acknowledgedSequence: error.acknowledgedSequence } : {}) });
          return;
        }
        throw error;
      }
    });
  }
};
