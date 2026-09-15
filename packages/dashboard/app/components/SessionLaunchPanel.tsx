import { useState } from "react";
import { useSessionLaunches } from "../hooks/useSessionLaunches";
import { ApiRequestError } from "../api/client/client";
import { cancelSessionLaunch, queueSessionLaunch, type SessionLaunchInput } from "../api/external-sessions";
import "./SessionLaunchPanel.css";

export function SessionLaunchPanel() {
  const { data, error: loadError, refresh: mutate } = useSessionLaunches();
  const [target, setTarget] = useState(""); const [prompt, setPrompt] = useState(""); const [model, setModel] = useState("");
  const [pending, setPending] = useState<SessionLaunchInput | null>(null);
  const [busy, setBusy] = useState(false); const [error, setError] = useState(""); const [notice, setNotice] = useState("");
  if (!data?.enabled) return loadError ? <p role="status">Launch availability could not be checked.</p> : null;
  const runtime = data.runtimes.find(row => `${row.hostId}:${row.projectId}:${row.generation}` === target);
  const submit = async () => {
    if (busy || (!pending && (!runtime || !prompt.trim()))) return;
    const input = pending ?? { id: crypto.randomUUID(), hostId: runtime!.hostId, projectId: runtime!.projectId, generation: runtime!.generation, prompt, model: model || null };
    setPending(input); setBusy(true); setError(""); setNotice("");
    try {
      await queueSessionLaunch(input); setPending(null); setPrompt(""); setNotice("Launch queued. Its state below confirms whether it started."); void mutate().catch(() => {});
    } catch (failure) {
      if (failure instanceof ApiRequestError && [400, 401, 403, 404, 409].includes(failure.status)) { setPending(null); setError(failure.message); void mutate(); }
      else setError("Launch acceptance is unconfirmed. Retry uses the same request and cannot start a duplicate.");
    }
    finally { setBusy(false); }
  };
  const cancel = async (id: string, hostId: string) => {
    if (busy) return; setBusy(true); setError("");
    try { await cancelSessionLaunch(id, hostId); await mutate(); }
    catch { setError("Launch could not be cancelled. It may already have started; refresh its state."); }
    finally { setBusy(false); }
  };
  return <details className="session-card session-launch-panel"><summary>Launch a managed Codex session</summary>
    <p>Runs in the selected project with a read-only sandbox and no approval prompts. The session stays independent of Fusion tasks.</p>
    {data.runtimes.length === 0 && !pending ? <p>No connected Fusion runtime is accepting launches.</p> : <form onSubmit={event => { event.preventDefault(); void submit(); }}>
      <label>Host and project<select value={target} disabled={busy || Boolean(pending)} onChange={event => setTarget(event.target.value)} required>
        <option value="">Choose a runtime</option>{data.runtimes.map(row => <option key={`${row.hostId}:${row.projectId}`} value={`${row.hostId}:${row.projectId}:${row.generation}`}>{row.hostId} · {row.projectPath}</option>)}
      </select></label>
      <label>Model (optional)<input value={model} disabled={busy || Boolean(pending)} maxLength={128} onChange={event => setModel(event.target.value)} placeholder="Provider default" /></label>
      <label>Initial prompt<textarea value={prompt} disabled={busy || Boolean(pending)} maxLength={16000} onChange={event => setPrompt(event.target.value)} required /></label>
      <button className="btn btn-primary" disabled={busy || (!pending && (!runtime || !prompt.trim()))} type="submit">{busy ? "Queuing…" : pending ? "Retry same launch" : "Launch read-only Codex"}</button>
    </form>}
    {notice && <p role="status">{notice}</p>}{error && <p role="alert">{error}</p>}
    {loadError && <p role="status">Launch status updates are unavailable. Previous states remain visible.</p>}
    {data.requests.length > 0 && <section aria-label="Recent launch requests"><h3>Recent launches</h3>{data.requests.map(row => <article key={row.id}>
      <p><strong>{row.hostId}</strong> · {row.status} · {new Date(row.createdAt).toLocaleString()}</p>
      <p>{row.prompt}</p>{row.cliSessionId && <p>Owned CLI session: {row.cliSessionId}</p>}{row.failure && <p>{row.failure}</p>}
      {row.status === "unconfirmed after interruption" && <p>Inspect the owning host before requesting another launch. This request will not be replayed.</p>}
      {row.status === "queued" && <button className="btn btn-secondary" disabled={busy} onClick={() => void cancel(row.id, row.hostId)}>Cancel queued launch</button>}
    </article>)}</section>}
  </details>;
}
