import { pricingAsOf, type ExternalSessionView, type ModelPricingOverrides } from "@fusion/core";
import { priceUsage } from "./pricing.js";
import type { RemoteUsage } from "./types.js";

/*
FNXC:RemoteAgents 2026-09-23-21:32:
Session cost is shown in two places that must never disagree: a compact badge on every list card, and the
full breakdown in session detail. Both derive from this one summary so a provider mapping or a
complete/partial rule can only be changed in one place.

`estimatedUsd` is a whole-session total and is null unless EVERY reported usage record priced, because a
number that silently omits an unknown model reads as the session's real cost. `partialUsd` carries what did
price, so the operator sees "some of this is unknown" rather than either a wrong total or nothing at all.
*/
export interface SessionCostSummary {
  usage: RemoteUsage[];
  estimatedUsd: number | null;
  partialUsd: number | null;
  usageComplete: boolean;
  /** Reported usage records that carry no applicable rate. Non-zero means estimatedUsd is deliberately null. */
  unpricedRecords: number;
  /** What the figure was computed on, and whether the work predates those rates. */
  basis: PricingBasis;
}

/** Collectors report a runtime name; Fusion's catalog is keyed by provider. Unmapped names stay unpriced. */
export function pricingProviderFor(provider: string): string {
  return provider === "claude" ? "claude_code" : provider === "codex" ? "codex_cli" : provider;
}

export function summarizeSessionCost(session: ExternalSessionView, settings?: PricingSettings): SessionCostSummary {
  const raw = session.observation.usage ?? [];
  const usage = raw
    .map(entry => priceUsage(entry, pricingProviderFor(session.provider), settings?.modelPricingOverrides))
    .filter((entry): entry is RemoteUsage => entry !== null);
  const priced = usage.filter(entry => entry.usd !== null);
  const total = priced.reduce((sum, entry) => sum + entry.usd!, 0);
  // A dropped record (malformed counters) is as disqualifying as an unpriced one: usage.length must equal raw.length.
  const complete = session.observation.usageComplete === true && usage.length > 0 && usage.length === raw.length && priced.length === usage.length;
  return {
    usage,
    estimatedUsd: complete ? total : null,
    partialUsd: priced.length ? total : null,
    usageComplete: session.observation.usageComplete === true,
    unpricedRecords: raw.length - priced.length,
    basis: pricingBasis(settings, session.observation.observedAt),
  };
}


/*
FNXC:ExternalSessionRates 2026-09-24-00:04:
Fusion's catalog is a single current baseline with one `pricingAsOf` date; neither it nor the operator
overrides carry per-rate effective dates, so there is NO record of what a model cost in the past. A figure for
an old session is therefore a recalculation at today's rates, not what that work was billed.

Rather than invent a rate history, every cost states the basis it was computed on and whether the work
predates it. `recalculated` is true only when the activity is older than the basis date, which is exactly the
case where presenting the number as "the cost" would be false.
*/
export interface PricingBasis {
  asOf: string;
  source: string;
  recalculated: boolean;
}

export interface PricingSettings {
  modelPricingFetchedAt?: string | null;
  modelPricingSource?: string | null;
  modelPricingOverrides?: ModelPricingOverrides;
}

export function pricingBasis(settings: PricingSettings | undefined, activityAt?: string | null): PricingBasis {
  const asOf = settings?.modelPricingFetchedAt || pricingAsOf;
  const source = settings?.modelPricingSource || "Fusion model pricing";
  const activity = activityAt === undefined || activityAt === null ? NaN : Date.parse(activityAt);
  const basisAt = Date.parse(asOf);
  // Unknown activity time cannot be proven older, so it is not claimed to be a recalculation.
  const recalculated = Number.isFinite(activity) && Number.isFinite(basisAt) && activity < basisAt;
  return { asOf, source, recalculated };
}

/** The list card needs the totals, not the per-model breakdown; keep the list response small. */
export type SessionCostBadge = Omit<SessionCostSummary, "usage">;

export function sessionCostBadge(session: ExternalSessionView, settings?: PricingSettings): SessionCostBadge {
  const { estimatedUsd, partialUsd, usageComplete, unpricedRecords, basis } = summarizeSessionCost(session, settings);
  return { estimatedUsd, partialUsd, usageComplete, unpricedRecords, basis };
}

/*
FNXC:ExternalSessionUsage 2026-09-23-23:24: A turn is priced from its OWN measured requests, through the same
priceUsage the session total uses, so a turn and its session can never disagree about a rate. A turn with no
reported usage is unpriced, never apportioned a share of the session: an invented split reads as measurement.
*/
export interface TurnCostSummary {
  estimatedUsd: number | null;
  partialUsd: number | null;
  unpricedRecords: number;
  /** False when the collector could not read a usage record for this turn. */
  usageComplete: boolean;
  /** Null when the provider reported no context size for this turn. */
  contextTokens: number | null;
  contextCapacity: number | null;
  basis: PricingBasis;
}

interface TurnLike {
  usage?: Array<Record<string, unknown>>;
  usageComplete?: boolean;
  contextTokens?: number | null;
  contextCapacity?: number | null;
}

export function summarizeTurnCost(turn: TurnLike, provider: string, settings?: PricingSettings, activityAt?: string | null): TurnCostSummary {
  const raw = turn.usage ?? [];
  const priced = raw
    .map(entry => priceUsage(entry, pricingProviderFor(provider), settings?.modelPricingOverrides))
    .filter((entry): entry is RemoteUsage => entry !== null && entry.usd !== null);
  const total = priced.reduce((sum, entry) => sum + entry.usd!, 0);
  const complete = turn.usageComplete !== false && raw.length > 0 && priced.length === raw.length;
  return {
    estimatedUsd: complete ? total : null,
    partialUsd: priced.length ? total : null,
    unpricedRecords: raw.length - priced.length,
    usageComplete: turn.usageComplete !== false,
    contextTokens: turn.contextTokens ?? null,
    contextCapacity: turn.contextCapacity ?? null,
    basis: pricingBasis(settings, activityAt),
  };
}
