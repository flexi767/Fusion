import { sql } from "drizzle-orm";
import type { AsyncDataLayer } from "../postgres/data-layer.js";
import type { ModelPricingOverrides } from "../ai/model-pricing.js";
import { priceSessionUsage } from "./cost.js";
import type { SessionModelUsage } from "./turn.js";

export interface ExternalSessionAnalyticsQuery { from?: string; to?: string; host?: string; model?: string; sessionId?: string }
export interface ExternalSessionUsageSummary {
  id: string; host: string; provider: string; title: string; turns: number; unreportedTurns: number;
  usd: number | null; unpricedRows: number; requests: number | null; inputTokens: number | null; outputTokens: number | null;
  usage: ReturnType<typeof priceSessionUsage>[];
}
function sumKnown(values: (number | null)[]) {
  if (!values.length || values.some(value => value === null)) return null;
  const sum = values.reduce<number>((total, value) => total + value!, 0);
  return Number.isSafeInteger(sum) ? sum : null;
}
/** Aggregate usage in PostgreSQL without loading prompts, responses or patches. */
export async function externalSessionAnalytics(layer: AsyncDataLayer, query: ExternalSessionAnalyticsQuery = {}, overrides?: ModelPricingOverrides) {
  for (const value of [query.from, query.to]) if (value !== undefined && (!Number.isFinite(Date.parse(value)) || value.length > 40)) throw new Error("Invalid analytics date");
  for (const value of [query.host, query.model, query.sessionId]) if (value !== undefined && value.length > 256) throw new Error("Invalid analytics filter");
  if (query.from && query.to && Date.parse(query.from) > Date.parse(query.to)) throw new Error("Invalid analytics range");
  const from = query.from ? new Date(query.from).toISOString() : null;
  const to = query.to ? new Date(query.to).toISOString() : null;
  const rows = await layer.db.execute(sql`
    WITH selected AS (
      SELECT s.id, s.host_id, s.provider, s.observation->>'title' AS title, t.id AS turn_id, t.result->'usage' AS usage
      FROM central.external_sessions s JOIN central.external_session_turns t ON t.session_id=s.id
      WHERE true ${from ? sql`AND t.started_at >= ${from}` : sql``} ${to ? sql`AND t.started_at <= ${to}` : sql``}
        ${query.host ? sql`AND s.host_id = ${query.host}` : sql``}
        ${query.sessionId ? sql`AND s.id = ${query.sessionId}` : sql``}
        ${query.model ? sql`AND EXISTS(SELECT 1 FROM jsonb_array_elements(t.result->'usage') u WHERE u->>'model'=${query.model})` : sql``}
    ), totals AS (
      SELECT id, host_id, provider, title, count(*)::int turns,
        count(*) FILTER(WHERE jsonb_array_length(usage)=0)::int unreported
      FROM selected GROUP BY id, host_id, provider, title
    ), grouped AS (
      SELECT id, u->>'model' AS model, (u->>'fast')::boolean AS fast, (u->>'longContext')::boolean AS long_context,
        CASE WHEN count(*)=count(u->>'inputTokens') THEN sum((u->>'inputTokens')::numeric) END AS input,
        CASE WHEN count(*)=count(u->>'cachedInputTokens') THEN sum((u->>'cachedInputTokens')::numeric) END AS cache_read,
        CASE WHEN count(*)=count(u->>'cacheWriteTokens') THEN sum((u->>'cacheWriteTokens')::numeric) END AS cache_write,
        CASE WHEN count(*)=count(u->>'cacheWriteHourTokens') THEN sum((u->>'cacheWriteHourTokens')::numeric) END AS cache_hour,
        CASE WHEN count(*)=count(u->>'outputTokens') THEN sum((u->>'outputTokens')::numeric) END AS output,
        CASE WHEN count(*)=count(u->>'requests') THEN sum((u->>'requests')::numeric) END AS requests
      FROM selected CROSS JOIN LATERAL jsonb_array_elements(usage) u
      WHERE true ${query.model ? sql`AND u->>'model'=${query.model}` : sql``}
      GROUP BY id, u->>'model', u->>'fast', u->>'longContext',
        (u->>'inputTokens' IS NOT NULL AND u->>'cachedInputTokens' IS NOT NULL AND u->>'cacheWriteTokens' IS NOT NULL AND u->>'outputTokens' IS NOT NULL),
        (u->>'cacheWriteHourTokens' IS NOT NULL), ((u->>'cacheWriteHourTokens')::numeric > 0),
        ((u->>'inputTokens')::numeric >= (u->>'cachedInputTokens')::numeric + (u->>'cacheWriteTokens')::numeric)
    )
    SELECT totals.*, (SELECT count(*) FROM grouped) AS group_count,
      CASE WHEN (SELECT count(*) FROM grouped)>5000 OR (SELECT count(*) FROM totals)>2000 THEN '[]'::jsonb
      ELSE COALESCE((SELECT jsonb_agg(to_jsonb(g)) FROM grouped g WHERE g.id=totals.id),'[]'::jsonb) END AS rows
    FROM totals ORDER BY id LIMIT 2001
  `);
  // Refuse a misleading partial ranking; callers can narrow the range/host/model.
  if (rows.length > 2000 || Number(rows[0]?.group_count ?? 0) > 5000) return { from, to, truncated: true, sessions: [] as ExternalSessionUsageSummary[] };
  const sessions = rows.map(row => {
    const values = row.rows as Record<string, unknown>[];
    const normalized = values.map(value => {
      const number = (key: string) => value[key] == null || !Number.isSafeInteger(Number(value[key])) ? null : Number(value[key]);
      return { model: String(value.model), inputTokens: number("input"), cachedInputTokens: number("cache_read"), cacheWriteTokens: number("cache_write"),
        cacheWriteHourTokens: number("cache_hour"), outputTokens: number("output"), requests: number("requests"), fast: value.fast === true, longContext: value.long_context === true,
        reasoningTokens: null, contextTokens: null } satisfies SessionModelUsage;
    });
    const usage = normalized.map(value => priceSessionUsage(String(row.provider), value, overrides));
    const priced = usage.filter(value => value.usd !== null);
    return { id: String(row.id), host: String(row.host_id), provider: String(row.provider), title: String(row.title), turns: Number(row.turns), unreportedTurns: Number(row.unreported),
      usd: priced.length ? priced.reduce((sum, value) => sum + value.usd!, 0) : null, unpricedRows: usage.length - priced.length,
      requests: sumKnown(normalized.map(value => value.requests)), inputTokens: sumKnown(normalized.map(value => value.inputTokens)), outputTokens: sumKnown(normalized.map(value => value.outputTokens)), usage };
  }).sort((a, b) => (b.usd ?? -1) - (a.usd ?? -1) || a.id.localeCompare(b.id));
  return { from, to, truncated: false, sessions };
}
