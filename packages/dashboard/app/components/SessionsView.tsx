import { SessionHistory } from "./SessionHistory";
import { useMemo, useState } from "react";
import { useExternalSessions } from "../hooks/useExternalSessions";
import { Activity } from "lucide-react";
import { fetchExternalSessions, type ObservedSession } from "../api/external-sessions";
import { ViewHeader } from "./ViewHeader";
import { ViewLayout } from "./ViewLayout";
import "./SessionsView.css";

export function SessionCard({ session, connected }: { session: ObservedSession; connected: boolean }) {
  const row = session.observation;
  return <article className="session-card" aria-label={`${session.hostId}: ${row.title}`}>
    <h3><a href={`?view=sessions&session=${encodeURIComponent(session.id)}`}>{row.title}</a></h3>
    <p>{session.hostId} · {row.provider} · <strong>{row.activity}</strong> · {connected ? "Collector connected" : "Collector disconnected"}</p>
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
  const { data, error, isLoading } = useExternalSessions();
  const [older, setOlder] = useState<ObservedSession[]>([]);
  const [cursor, setCursor] = useState<string | null | undefined>();
  const [loadingMore, setLoadingMore] = useState(false);
  const [pageError, setPageError] = useState("");
  const [host, setHost] = useState("");
  const [provider, setProvider] = useState("");
  const [activity, setActivity] = useState("");
  const [search, setSearch] = useState("");
  const sessions = useMemo(() => {
    const rows = new Map(older.map(row => [row.id, row]));
    for (const row of data?.sessions ?? []) if (!rows.has(row.id) || rows.get(row.id)!.revision <= row.revision) rows.set(row.id, row);
    return [...rows.values()].sort((a, b) => b.observation.observedAt.localeCompare(a.observation.observedAt) || a.id.localeCompare(b.id));
  }, [data, older]);
  const visible = sessions.filter(row => (!host || row.hostId === host) && (!provider || row.provider === provider)
    && (!activity || row.observation.activity === activity) && `${row.observation.title} ${row.observation.projectPath}`.toLowerCase().includes(search.toLowerCase()));
  const next = cursor === undefined ? data?.nextCursor : cursor;
  const loadMore = async () => {
    if (!next || loadingMore) return;
    setLoadingMore(true); setPageError("");
    try { const page = await fetchExternalSessions(next); setOlder(rows => [...rows, ...page.sessions]); setCursor(page.nextCursor); }
    catch { setPageError("Could not load more sessions. Please retry."); }
    finally { setLoadingMore(false); }
  };
  return <ViewLayout header={<ViewHeader icon={Activity} title="Sessions" />}>
    <div className="sessions-view">
      <p>Codex and Claude sessions across your hosts. Observing a session does not schedule a Fusion task.</p>
      <div className="sessions-filters">
        <label>Host<select value={host} onChange={e => setHost(e.target.value)}><option value="">All hosts</option>{(data?.collectors ?? []).map(c => <option key={c.hostId}>{c.hostId}</option>)}</select></label>
        <label>Provider<select value={provider} onChange={e => setProvider(e.target.value)}><option value="">All providers</option><option value="codex">Codex</option><option value="claude">Claude</option></select></label>
        <label>Activity<select value={activity} onChange={e => setActivity(e.target.value)}><option value="">All activity</option>{["working", "waiting", "completed", "error"].map(x => <option key={x}>{x}</option>)}</select></label>
        <label>Project or title<input type="search" value={search} onChange={e => setSearch(e.target.value)} /></label>
      </div>
      {isLoading && <p role="status">Loading sessions…</p>}
      {data?.enabled === false && <p>Sessions are not enabled on this server.</p>}
      {error && <p role="alert">Session updates are unavailable. Previously loaded sessions remain visible.</p>}
      {!isLoading && data?.enabled && visible.length === 0 && <p>No sessions match these filters.</p>}
      <div className="sessions-grid">{visible.map(session => {
        const heartbeat = data?.collectors.find(c => c.hostId === session.hostId)?.lastHeartbeatAt;
        const age = heartbeat ? Date.now() - Date.parse(heartbeat) : Infinity;
        return <SessionCard key={session.id} session={session} connected={age >= 0 && age <= 90_000} />;
      })}</div>
      {pageError && <p role="alert">{pageError}</p>}
      {next && <button className="btn btn-secondary" onClick={() => void loadMore()} disabled={loadingMore}>{loadingMore ? "Loading…" : "Load more sessions"}</button>}
      {next && <p>Filters apply to loaded sessions; load more to include older records.</p>}
    </div>
  </ViewLayout>;
}
