import { useCallback, useEffect, useRef, useState } from "react";
import type { ExternalSessionFileChange, ExternalSessionTurn } from "@fusion/core";
import { api } from "../api/client/client";
import { withProjectId } from "../api/client/health";

type TurnCost = { estimatedUsd: number | null; partialUsd: number | null; unpricedRecords: number; usageComplete: boolean; contextTokens: number | null; contextCapacity: number | null; basis?: { asOf: string; source: string; recalculated: boolean } };
type PricedTurn = ExternalSessionTurn & { cost?: TurnCost | null };
type TurnPage = { schemaVersion: 1; turns: PricedTurn[]; nextCursor: string | null };
const money = (n: number) => new Intl.NumberFormat(undefined, { style: "currency", currency: "USD", maximumFractionDigits: 6 }).format(n);

/*
FNXC:ExternalSessionUsage 2026-09-23-23:24: A turn shows only what was measured for it. With no reported usage
it reads "Cost not reported" rather than a share of the session total, because an apportioned number is
indistinguishable from a measured one once it is on screen.
*/
function turnCostLabel(cost?: TurnCost | null): string {
  if (!cost) return "Cost not reported";
  if (cost.estimatedUsd !== null) return cost.basis?.recalculated ? `${money(cost.estimatedUsd)} at today\u2019s rates` : `${money(cost.estimatedUsd)}`;
  if (cost.partialUsd !== null) return `${money(cost.partialUsd)} priced so far · ${cost.unpricedRecords} unpriced`;
  return cost.usageComplete ? "Cost not reported" : "Usage incomplete for this turn";
}

function contextLabel(cost?: TurnCost | null): string | null {
  if (!cost || cost.contextTokens === null) return null;
  const used = cost.contextTokens.toLocaleString();
  if (cost.contextCapacity === null) return `Context ${used} tokens`;
  return `Context ${used} / ${cost.contextCapacity.toLocaleString()} (${Math.round((cost.contextTokens / cost.contextCapacity) * 100)}%)`;
}

/*
FNXC:RemoteAgents 2026-09-23-22:07:
Turn history was ingested and served (migration 0088, GET /external-sessions/:id/turns) but nothing rendered
it, so the collected prompts, responses, durations and historical patches were invisible. This renders the
prompt above its response, as the plan requires.

Unavailable telemetry is shown as unavailable and never as zero: a null duration, tool count or line count
means the provider did not report it, which is a different fact from "no time passed" or "nothing changed".
A stored patch belongs to its turn; it is never replaced with a live working-tree diff.
*/
const TURN_PAGE = 25;

function durationLabel(turn: ExternalSessionTurn): string {
  if (turn.durationMs === null) return "Duration not reported";
  const seconds = turn.durationMs / 1000;
  const text = seconds < 1 ? `${turn.durationMs} ms` : seconds < 90 ? `${seconds.toFixed(1)} s` : `${Math.floor(seconds / 60)} min ${Math.round(seconds % 60)} s`;
  // "derived" means Fusion computed it from timestamps rather than the provider reporting it.
  return `${text}${turn.durationSource === "derived" ? " (derived)" : ""}`;
}

function lineLabel(change: ExternalSessionFileChange): string {
  const added = change.addedLines === null ? "?" : `+${change.addedLines}`;
  const removed = change.removedLines === null ? "?" : `-${change.removedLines}`;
  return change.addedLines === null && change.removedLines === null ? "Line counts not reported" : `${added} ${removed}`;
}

function FileChange({ change }: { change: ExternalSessionFileChange }) {
  const title = change.operation === "rename" && change.previousPath ? `${change.previousPath} → ${change.path}` : change.path;
  return <li className="remote-turn-file">
    <details>
      <summary>
        <span className="remote-turn-op">{change.operation}</span>
        <span className="remote-turn-path">{title}</span>
        <span>{lineLabel(change)}</span>
      </summary>
      {change.patchAvailable && change.patch !== undefined
        ? <><pre className="remote-turn-patch">{change.patch}</pre>{change.truncated && <p className="remote-agent-meta">This patch was truncated when it was collected.</p>}</>
        : <p className="remote-agent-meta">Patch unavailable for this change.</p>}
    </details>
  </li>;
}

function Turn({ turn }: { turn: PricedTurn }) {
  return <li className="remote-turn card">
    <p className="remote-agent-meta">
      <span>Turn {turn.ordinal + 1}</span> · <span>{turn.state}</span> · <span>{durationLabel(turn)}</span>
      {" · "}<span>{turn.toolCallCount === null ? "Tool calls not reported" : `${turn.toolCallCount} tool ${turn.toolCallCount === 1 ? "call" : "calls"}`}</span>
      {turn.startedAt && <> · <time dateTime={turn.startedAt}>{new Date(turn.startedAt).toLocaleString()}</time></>}
      {" · "}<span className="remote-turn-cost">{turnCostLabel(turn.cost)}</span>
      {contextLabel(turn.cost) && <> · <span>{contextLabel(turn.cost)}</span></>}
    </p>
    {turn.prompts.map((prompt, index) => <div key={`${turn.nativeTurnId}:prompt:${index}`} className="remote-turn-prompt">
      <h5>Prompt{turn.prompts.length > 1 ? ` ${index + 1}` : ""}</h5>
      <pre>{prompt.text}</pre>
    </div>)}
    <div className="remote-turn-response">
      <h5>Response</h5>
      {turn.response === null
        ? <p className="remote-agent-meta">{turn.state === "ongoing" ? "This turn is still running." : "No response was collected for this turn."}</p>
        : <pre>{turn.response}</pre>}
    </div>
    {turn.fileChanges.length > 0 && <div className="remote-turn-changes">
      <h5>{turn.fileChanges.length} {turn.fileChanges.length === 1 ? "file changed" : "files changed"}</h5>
      <ul className="remote-turn-files">{turn.fileChanges.map((change, index) => <FileChange key={`${change.path}:${index}`} change={change} />)}</ul>
    </div>}
  </li>;
}

export function RemoteAgentTurns({ sessionId, projectId }: { sessionId: string; projectId: string }) {
  const [turns, setTurns] = useState<PricedTurn[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);
  const scope = useRef(0);
  const load = useCallback(async (after?: string) => {
    const epoch = scope.current;
    setLoading(true);
    try {
      const query = new URLSearchParams({ limit: String(TURN_PAGE) });
      if (after) query.set("cursor", after);
      const page = await api<TurnPage>(withProjectId(`/external-sessions/${sessionId}/turns?${query}`, projectId));
      if (epoch !== scope.current) return;
      // A response is a trust boundary: a malformed page must surface as an error, not throw inside a state update.
      if (!Array.isArray(page?.turns)) throw new Error("Turn history response was malformed");
      // Pagination walks older history, so a page is appended rather than replacing what is shown.
      setTurns(current => after ? [...current, ...page.turns.filter(t => !current.some(c => c.nativeTurnId === t.nativeTurnId))] : page.turns);
      setCursor(page.nextCursor); setError(null); setLoaded(true);
    } catch (e) {
      if (epoch === scope.current) { setError(e instanceof Error ? e.message : "Turn history unavailable"); setLoaded(true); }
    } finally { if (epoch === scope.current) setLoading(false); }
  }, [projectId, sessionId]);
  useEffect(() => {
    scope.current += 1;
    setTurns([]); setCursor(null); setError(null); setLoaded(false);
    void load();
  }, [load]);
  return <section className="remote-agent-turns" aria-labelledby={`remote-turns-${sessionId}`}>
    <h4 id={`remote-turns-${sessionId}`}>Turn history</h4>
    {error && <p role="alert">{error}</p>}
    {!error && loaded && !turns.length && <p className="remote-agent-meta">No turns have been collected for this session.</p>}
    {!loaded && loading && <p className="remote-agent-meta">Loading turn history…</p>}
    {!!turns.length && <ul className="remote-turn-list" aria-label="Collected turns">{turns.map(turn => <Turn key={turn.nativeTurnId} turn={turn} />)}</ul>}
    {cursor && <button className="btn btn-sm" onClick={() => void load(cursor)} disabled={loading}>Load older turns</button>}
  </section>;
}
