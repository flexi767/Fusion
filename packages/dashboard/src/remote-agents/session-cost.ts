import type { ExternalSessionView, ModelPricingOverrides } from "@fusion/core";
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
}

/** Collectors report a runtime name; Fusion's catalog is keyed by provider. Unmapped names stay unpriced. */
export function pricingProviderFor(provider: string): string {
  return provider === "claude" ? "claude_code" : provider === "codex" ? "codex_cli" : provider;
}

export function summarizeSessionCost(session: ExternalSessionView, overrides?: ModelPricingOverrides): SessionCostSummary {
  const raw = session.observation.usage ?? [];
  const usage = raw
    .map(entry => priceUsage(entry, pricingProviderFor(session.provider), overrides))
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
  };
}

/** The list card needs the totals, not the per-model breakdown; keep the list response small. */
export type SessionCostBadge = Omit<SessionCostSummary, "usage">;

export function sessionCostBadge(session: ExternalSessionView, overrides?: ModelPricingOverrides): SessionCostBadge {
  const { estimatedUsd, partialUsd, usageComplete, unpricedRecords } = summarizeSessionCost(session, overrides);
  return { estimatedUsd, partialUsd, usageComplete, unpricedRecords };
}
