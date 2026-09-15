import { useCallback, useEffect, useRef, useState } from "react";
import { fetchSessionOverview, type SessionOverviewPage } from "../api/external-sessions";
import { useVisibilityAwarePoll } from "../hooks/visibilitySuspension";
import { SessionActivityStatus } from "./SessionActivityStatus";

export function SessionRecentActivity() {
  const [open, setOpen] = useState(false);
  return <details className="session-card" onToggle={event => setOpen(event.currentTarget.open)}>
    <summary>Recent activity overview</summary>
    {open && <RecentActivityContent />}
  </details>;
}

function RecentActivityContent() {
  const [data, setData] = useState<SessionOverviewPage>();
  const [error, setError] = useState(false);
  const active = useRef(true), busy = useRef(false);
  const refresh = useCallback(async () => {
    if (busy.current) return;
    busy.current = true;
    try { const result = await fetchSessionOverview(); if (active.current) { setData(result); setError(false); } }
    catch { if (active.current) setError(true); }
    finally { busy.current = false; }
  }, []);
  useEffect(() => { active.current = true; void refresh(); return () => { active.current = false; }; }, [refresh]);
  useVisibilityAwarePoll(() => void refresh(), 10000);
  return <>
    <p>Latest reported activity and saved summaries for up to five sessions across all hosts and projects. Open a session for full history or to refresh its summary.</p>
    {error && <p role="alert">Recent activity updates are unavailable. Previously loaded summaries remain visible.</p>}
    {!data && !error && <p role="status">Loading recent activity…</p>}
    {data?.enabled === false && <p>Sessions are disabled.</p>}
    {data?.enabled && !data.sessions.length && <p>No observed sessions yet.</p>}
    {data?.sessions.map(session => <article className="session-card" key={session.id}>
      <h3><a href={`?view=sessions&session=${encodeURIComponent(session.id)}`}>{session.observation.title}</a></h3>
      <p>{session.hostId} · {session.provider} · {session.observation.projectPath}</p>
      <SessionActivityStatus session={session} />
      <p>Last native activity: <time dateTime={session.observation.observedAt}>{new Date(session.observation.observedAt).toLocaleString()}</time></p>
      {session.summary ? <>
        <p>{session.summary.text}</p>
        <p>{session.summary.model} · {session.summary.coveredTurns} turns · Summary at {new Date(session.summary.at).toLocaleString()}</p>
        <p>Covered turns: {session.summary.firstTurn} → {session.summary.lastTurn}</p>
      </> : <p>No stored summary yet. Open the session for its collected history.</p>}
      {session.summaryStale && <p>Collected content has changed since this summary.</p>}
      {session.lastSummaryError && <p>The last summary attempt failed; the previous summary is preserved.</p>}
    </article>)}
  </>;
}
