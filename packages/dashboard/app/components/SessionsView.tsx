import { SessionActivityStatus } from "./SessionActivityStatus";
import { SessionRetentionPanel } from "./SessionRetentionPanel";
import { SessionUsageOverview } from "./SessionUsageOverview";
import { SessionLaunchPanel } from "./SessionLaunchPanel";
import { SessionHistory, SessionCostDetails } from "./SessionHistory";
import { useEffect, useMemo, useState } from "react";
import { useExternalSessions } from "../hooks/useExternalSessions";
import { Activity } from "lucide-react";
import { fetchExternalSessions, type ObservedSession, type CollectorHealth, type SessionFilters } from "../api/external-sessions";
import { ViewHeader } from "./ViewHeader";
import { ViewLayout } from "./ViewLayout";
import "./SessionsView.css";

export function SessionCard({ session, connected }: { session: ObservedSession; connected: boolean }) {
  const row = session.observation;
  return <article className="session-card" aria-label={`${session.hostId}: ${row.title}`}>
    {(session.archived || session.pinned) && <p>{session.archived ? "Archived · " : ""}{session.pinned ? "Pinned" : ""}</p>}
    <h3><a href={`?view=sessions&session=${encodeURIComponent(session.id)}`}>{row.title}</a></h3>
    <p>{session.hostId} · {row.provider}</p>
    <SessionActivityStatus session={session} connected={connected} />
    <p>Last reported model: {row.telemetry?.model ?? "Unreported"} · Context: {row.telemetry?.contextTokens?.toLocaleString() ?? "Unreported"}{row.telemetry?.contextCapacity != null ? ` / ${row.telemetry.contextCapacity.toLocaleString()}` : " / capacity unreported"}</p>
    {row.telemetry && <p>Telemetry as of <time dateTime={row.telemetry.observedAt}>{new Date(row.telemetry.observedAt).toLocaleString()}</time>{row.telemetry.serviceTier ? ` · ${row.telemetry.serviceTier} service` : ""}</p>}
    {session.usageSummary ? <SessionCostDetails label="Session cost and coverage" cost={{ ...session.usageSummary, coveredTurns: session.usageSummary.turns }} /> : <p>Cost total unavailable</p>}
    <p className="session-project">{row.projectPath}</p>
    <p>Observed session · Last activity <time dateTime={row.observedAt}>{new Date(row.observedAt).toLocaleString()}</time></p>
    <details><summary>Session identity</summary><code>{row.nativeSessionId}</code></details>
  </article>;
}

export function SessionsView() {
  const id = new URLSearchParams(window.location.search).get("session");
  return id ? <SessionHistory key={id} id={id} /> : <SessionList />;
}

function SessionList() {
  const [collectors, setCollectors] = useState<CollectorHealth[]>([]);
  const [host, setHost] = useState("");
  const [provider, setProvider] = useState("");
  const [saved, setSaved] = useState("");
  const [activity, setActivity] = useState("");
  const [search, setSearch] = useState("");
  const [query, setQuery] = useState("");
  const [projectDraft, setProjectDraft] = useState("");
  const [projectPath, setProjectPath] = useState("");
  const filters = { host, provider, activity, q: query, saved, projectPath };
  return <ViewLayout header={<ViewHeader icon={Activity} title="Sessions" />}><div className="sessions-view">
    <p>Codex and Claude sessions across your hosts. Observing a session does not schedule a Fusion task.</p>
    <SessionLaunchPanel />
    <form className="sessions-filters" onSubmit={event => { event.preventDefault(); setQuery(search.trim()); setProjectPath(projectDraft); }}>
      <label>Saved sessions<select value={saved} onChange={event => setSaved(event.target.value)}><option value="">All sessions</option><option value="archived">Archived</option><option value="pinned">Pinned</option></select></label>
      <label>Host<select value={host} onChange={e => setHost(e.target.value)}><option value="">All hosts</option>{collectors.map(c => <option key={c.hostId}>{c.hostId}</option>)}</select></label>
      <label>Exact project path<input value={projectDraft} maxLength={4096} onChange={event => setProjectDraft(event.target.value)} placeholder="All projects" /></label>
      <label>Provider<select value={provider} onChange={e => setProvider(e.target.value)}><option value="">All providers</option><option value="codex">Codex</option><option value="claude">Claude</option></select></label>
      <label>Activity<select value={activity} onChange={e => setActivity(e.target.value)}><option value="">All activity</option>{["working", "waiting", "completed", "error"].map(x => <option key={x}>{x}</option>)}</select></label>
      <label>Search sessions and collected output<input type="search" maxLength={256} value={search} onChange={e => setSearch(e.target.value)} /></label>
      <button className="btn btn-secondary" type="submit">Search</button>
    </form>
    <SessionUsageOverview />
    <SessionRetentionPanel />
    <SessionResults key={JSON.stringify(filters)} filters={filters} onCollectors={setCollectors} />
  </div></ViewLayout>;
}

function SessionResults({ filters, onCollectors }: { filters: SessionFilters; onCollectors: (rows: CollectorHealth[]) => void }) {
  const { data, error, isLoading } = useExternalSessions(filters);
  const [older, setOlder] = useState<ObservedSession[]>([]);
  const [cursor, setCursor] = useState<string | null | undefined>();
  const [loadingMore, setLoadingMore] = useState(false);
  const [pageError, setPageError] = useState("");
  useEffect(() => { if (data) onCollectors(data.collectors); }, [data, onCollectors]);
  const sessions = useMemo(() => {
    const rows = new Map(older.map(row => [row.id, row]));
    for (const row of data?.sessions ?? []) if (!rows.has(row.id) || rows.get(row.id)!.revision <= row.revision) rows.set(row.id, row);
    return [...rows.values()].sort((a, b) => b.observation.observedAt.localeCompare(a.observation.observedAt) || a.id.localeCompare(b.id));
  }, [data, older]);
  const next = cursor === undefined ? data?.nextCursor : cursor;
  const loadMore = async () => {
    if (!next || loadingMore) return;
    setLoadingMore(true); setPageError("");
    try { const page = await fetchExternalSessions(next, filters); setOlder(rows => [...rows, ...page.sessions]); setCursor(page.nextCursor); }
    catch { setPageError("Could not load more sessions. Please retry."); }
    finally { setLoadingMore(false); }
  };
  return <>
    <details className="session-card"><summary>Collector health</summary>{data?.collectors.map(collector => <section key={collector.hostId}>
      <h3>{collector.hostId}</h3><p>Last heartbeat: {collector.lastHeartbeatAt ? new Date(collector.lastHeartbeatAt).toLocaleString() : "No live heartbeat"} · Last acknowledged delivery: {collector.lastAcknowledgementAt ? new Date(collector.lastAcknowledgementAt).toLocaleString() : "None"}</p>
      <p>{collector.diagnostics?.spoolDepth ?? "Unknown"} queued · {collector.diagnostics?.rejectedDeliveries ?? "Unknown"} rejected · {collector.diagnostics?.discoveredFiles ?? "Unknown"} discovered transcripts</p>
      <SessionDeliveryLag diagnostics={collector.diagnostics} />
      {collector.diagnostics?.resourcePaused && <p>Collection paused at a resource limit. Acknowledged data and pending checkpoints are preserved; inspect this host’s collector diagnostics.</p>}
      {collector.diagnostics?.parseError && <p>Transcript parsing needs attention. Inspect collector diagnostics on this host.</p>}
      {collector.diagnostics?.deliveryError && <p>Delivery is retrying after a failure.</p>}
    </section>)}</details>
    {isLoading && <p role="status">Loading sessions…</p>}
    {data?.enabled === false && <p>Sessions are not enabled on this server.</p>}
    {error && <p role="alert">Session updates are unavailable. Previously loaded sessions remain visible.</p>}
    {!isLoading && data?.enabled && sessions.length === 0 && <p>No sessions match these filters.</p>}
    {filters.q && <p>Matching collected words: {filters.q}. Search includes older history.</p>}
    <div className="sessions-grid">{sessions.map(session => {
      const heartbeat = data?.collectors.find(c => c.hostId === session.hostId)?.lastHeartbeatAt;
      const age = heartbeat ? Date.now() - Date.parse(heartbeat) : Infinity;
      return <SessionCard key={session.id} session={session} connected={age >= 0 && age <= 90_000} />;
    })}</div>
    {pageError && <p role="alert">{pageError}</p>}
    {next && <button className="btn btn-secondary" onClick={() => void loadMore()} disabled={loadingMore}>{loadingMore ? "Loading…" : "Load more sessions"}</button>}
  </>;
}

/** Shared across hosts and viewport sizes; unknown latency is never displayed as zero. */
export function SessionDeliveryLag({ diagnostics: health }: { diagnostics: CollectorHealth["diagnostics"] }) {
  const seconds = (value: number) => `${(value / 1000).toFixed(1)} s`;
  return <>
    {health?.liveLagSamples && health.liveLagP95Ms != null ? <p>Live delivery lag: p95 {seconds(health.liveLagP95Ms)} · maximum {health.liveLagMaxMs != null ? seconds(health.liveLagMaxMs) : "unknown"} · {health.liveLagSamples.toLocaleString()} acknowledged updates</p>
      : <p>Live delivery lag: no valid measurements yet.</p>}
    <p>Latest 10,000 acknowledged live updates within 24 hours. Measures native event to collector acknowledgement; superseded snapshots and old backfill are excluded.</p>
    {health?.liveQueueP95Ms != null && <p>Queue delay p95: {seconds(health.liveQueueP95Ms)}</p>}
    {health?.oldestLivePendingMs != null && <p>Oldest queued live update: {seconds(health.oldestLivePendingMs)}</p>}
    {Boolean(health?.liveLagClockSkewSamples) && <p>{health!.liveLagClockSkewSamples} samples excluded because host clocks moved backward or native timestamps were in the future.</p>}
  </>;
}
