import { useCallback, useEffect, useRef, useState } from "react";
import { fetchExternalSessions, fetchTaskSessions, linkTaskSession, type ObservedSession } from "../api/external-sessions";
import { SessionHistory } from "./SessionHistory";
import "./TaskLinkedSessions.css";

/** One explicit association, shared history renderer, no task lifecycle mutations. */
export function TaskLinkedSessions({ taskId, projectId }: { taskId: string; projectId?: string }) {
  const [enabled, setEnabled] = useState(false);
  const [sessions, setSessions] = useState<ObservedSession[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [matches, setMatches] = useState<ObservedSession[]>([]);
  const [searched, setSearched] = useState(false);
  const [selected, setSelected] = useState<string>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const mounted = useRef(true);
  const load = useCallback(async (before?: string) => {
    const page = await fetchTaskSessions(taskId, projectId, before);
    if (!mounted.current) return;
    setEnabled(page.enabled); setCursor(page.nextCursor);
    setSessions(previous => [...new Map([...(before ? previous : []), ...page.sessions].map(row => [row.id, row])).values()]);
  }, [taskId, projectId]);
  useEffect(() => { mounted.current = true; void load().catch(() => { if (mounted.current) setError("Linked sessions are unavailable. Reload to retry."); }); return () => { mounted.current = false; }; }, [load]);
  const search = async () => {
    setBusy(true); setError("");
    try { const page = await fetchExternalSessions(undefined, { q: query }); if (mounted.current) { setMatches(page.sessions); setSearched(true); } }
    catch { if (mounted.current) setError("Session search failed. Please retry."); }
    finally { if (mounted.current) setBusy(false); }
  };
  const link = async (row: ObservedSession, linked: boolean) => {
    setBusy(true); setError("");
    try {
      await linkTaskSession(taskId, row.id, linked, row.taskLinkRevision ?? 0, projectId);
      await load(); if (mounted.current) { setMatches([]); setSearched(false); if (!linked && selected === row.id) setSelected(undefined); }
    } catch { if (mounted.current) setError("Link could not be saved. It may have changed elsewhere; search again to refresh."); }
    finally { if (mounted.current) setBusy(false); }
  };
  if (!enabled) return error ? <p role="status">{error}</p> : null;
  return <section className="task-linked-sessions">
    <h3>Linked sessions</h3>
    <p>Link an observed session to show its history here. Session usage stays separate from task totals.</p>
    {error && <p role="alert">{error}</p>}
    {sessions.map(row => <article className="session-card" key={row.id}>
      <h4>{row.observation.title}</h4><p>{row.hostId} · {row.provider} · {row.nativeSessionId}</p>
      <div className="task-linked-sessions-actions"><button className="btn btn-secondary" aria-expanded={selected === row.id} onClick={() => setSelected(selected === row.id ? undefined : row.id)}>{selected === row.id ? "Hide history" : "Show history"}</button>
        <button className="btn btn-secondary" disabled={busy} onClick={() => void link(row, false)}>Unlink session</button></div>
      {selected === row.id && <SessionHistory key={row.id} id={row.id} embedded />}
    </article>)}
    {cursor && <button className="btn btn-secondary" disabled={busy} onClick={() => { setBusy(true); void load(cursor).catch(() => setError("More linked sessions could not be loaded.")).finally(() => setBusy(false)); }}>More linked sessions</button>}
    <details><summary>Link a session</summary>
      <form className="task-linked-sessions-actions" onSubmit={event => { event.preventDefault(); void search(); }}>
        <label>Search observed sessions<input value={query} maxLength={256} onChange={event => setQuery(event.target.value)} /></label>
        <button className="btn btn-secondary" disabled={busy}>Search sessions</button>
      </form>
      {searched && matches.length === 0 && <p>No matching sessions.</p>}
      {matches.map(row => <article className="session-card" key={row.id}><h4>{row.observation.title}</h4><p>{row.hostId} · {row.provider} · {row.nativeSessionId}</p>
        {row.taskId ? <p>Linked to {row.taskId}; unlink it there before changing tasks.</p> : <button className="btn btn-secondary" disabled={busy} onClick={() => void link(row, true)}>Link to this task</button>}
      </article>)}
      {matches.length >= 50 && <p>Showing the first 50 matches. Narrow the search to find another session.</p>}
    </details>
  </section>;
}
