import { useState } from "react";
import { fetchExternalSessionUsage } from "../api/external-sessions";
import { formatCost } from "../utils/taskTokenCost";
import { SessionCostDetails } from "./SessionHistory";

export function SessionUsageOverview() {
  const [from, setFrom] = useState(() => new Date(Date.now() - 30 * 86400_000).toISOString().slice(0, 10));
  const [to, setTo] = useState(() => new Date().toISOString().slice(0, 10));
  const [host, setHost] = useState("");
  const [basis, setBasis] = useState<"current" | "recorded">("current");
  const [groupBy, setGroupBy] = useState<"session" | "turn">("session");
  const [model, setModel] = useState("");
  const [data, setData] = useState<Awaited<ReturnType<typeof fetchExternalSessionUsage>>>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const load = async () => {
    setBusy(true); setError("");
    try { setData(await fetchExternalSessionUsage({ from: `${from}T00:00:00.000Z`, to: `${to}T23:59:59.999Z`, host, model, groupBy, basis })); }
    catch { setError("Usage could not be loaded. Check the date range and try again."); }
    finally { setBusy(false); }
  };
  return <details className="session-card"><summary>Session usage and cost rankings</summary>
    <form className="sessions-filters" onSubmit={event => { event.preventDefault(); void load(); }}>
      <label>Cost basis<select value={basis} onChange={event => setBasis(event.target.value as "current" | "recorded")}><option value="current">Recalculate at current rates</option><option value="recorded">Recorded rate snapshots</option></select></label>
      <label>Rank by<select value={groupBy} onChange={event => setGroupBy(event.target.value as "session" | "turn")}><option value="session">Session</option><option value="turn">Individual turn</option></select></label>
      <label>From (UTC)<input type="date" required value={from} onChange={e => setFrom(e.target.value)} /></label>
      <label>To (UTC)<input type="date" required value={to} onChange={e => setTo(e.target.value)} /></label>
      <label>Host id<input value={host} maxLength={256} onChange={e => setHost(e.target.value)} placeholder="All hosts" /></label>
      <label>Exact model<input value={model} maxLength={256} onChange={e => setModel(e.target.value)} placeholder="All models" /></label>
      <button className="btn btn-secondary" type="submit" disabled={busy}>{busy ? "Calculating…" : "Calculate usage"}</button>
    </form>
    {error && <p role="alert">{error}</p>}
    {data?.truncated && <p>Too many sessions or model groups for a complete ranking. Narrow the date range, host or model.</p>}
    {data && !data.truncated && <>
      <p>{data.from} → {data.to} · {data.sessions.length} ranked results with collected turns. Estimates use {data.basis === "recorded" ? "recorded rate snapshots" : "current configured rates"} and exclude unpriced groups. External observations are counted separately from Fusion task usage.</p>
      <p>{data.sessions.reduce((sum, row) => sum + row.turns, 0)} collected turns · {data.sessions.reduce((sum, row) => sum + row.unreportedTurns, 0)} turns without usage · {data.sessions.reduce((sum, row) => sum + row.unpricedRows, 0)} unpriced model groups</p>
      {data.sessions.length === 0 && <p>No collected turns match this range.</p>}
      {data.sessions.slice(0, 50).map((row, index) => <section className="session-card" key={`${row.id}:${row.turnId ?? ""}`}>
        <h3>{index + 1}. <a href={`?view=sessions&session=${encodeURIComponent(row.id)}${row.turnId ? `&turn=${encodeURIComponent(row.turnId)}#session-turn-${encodeURIComponent(row.turnId)}` : ""}`}>{row.title}{row.turnId ? ` · Turn ${row.turnId}` : ""}</a> · {formatCost(row.usd, row.usd === null)}</h3>
        {row.startedAt && <p>Turn started {new Date(row.startedAt).toLocaleString()}</p>}
        <p>{row.host} · {row.provider} · {row.turns} turns · {row.requests ?? "Unreported"} requests · {row.inputTokens?.toLocaleString() ?? "Unreported"} inclusive input tokens · {row.outputTokens?.toLocaleString() ?? "Unreported"} output tokens</p>
        <SessionCostDetails cost={{ basis: row.basis, usd: row.usd, usage: row.usage, coveredTurns: row.turns, unreportedTurns: row.unreportedTurns, unpricedRows: row.unpricedRows }} label="Cost breakdown for selected turns" />
      </section>)}
      {data.sessions.length > 50 && <p>Showing the 50 most expensive results of {data.sessions.length} matched results.</p>}
    </>}
  </details>;
}
