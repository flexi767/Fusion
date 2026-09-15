import { SessionPreferences } from "./SessionPreferences";
import { useCallback, useEffect, useRef, useState } from "react";
import type { SessionTurn } from "@fusion/core";
import { fetchExternalSession, fetchExternalSessionTurn, saveSessionNotes, summarizeSession, sendSessionCommand, type SessionDetail } from "../api/external-sessions";
import { useVisibilityAwarePoll } from "../hooks/visibilitySuspension";
import { formatCost } from "../utils/taskTokenCost";
import { ViewHeader } from "./ViewHeader";
import { ViewLayout } from "./ViewLayout";
import "./SessionsView.css";

/** Reusable history presentation: linked tasks can render the same durable turns. */
export function SessionTurnResult({ turn, sessionId, cost }: { turn: SessionTurn; sessionId?: string; cost?: SessionDetail["cost"] }) {
  return <article className="session-card" id={`session-turn-${encodeURIComponent(turn.id)}`}>
    <h3><time dateTime={turn.startedAt}>{new Date(turn.startedAt).toLocaleString()}</time></h3>
    {sessionId && <a href={`?view=sessions&session=${encodeURIComponent(sessionId)}&turn=${encodeURIComponent(turn.id)}#session-turn-${encodeURIComponent(turn.id)}`}>Link to this turn</a>}
    {turn.prompts.map((prompt, index) => <section key={index}><h4>Prompt {index + 1}</h4><pre className="session-output">{prompt}</pre></section>)}
    <section><h4>Response</h4><pre className="session-output">{turn.response || (turn.completedAt ? "Response unavailable" : "Response in progress")}</pre></section>
    <p>{turn.completedAt ? "Turn finished" : "Turn ongoing"} · {turn.durationMs === null ? "Duration unavailable" : `${(turn.durationMs / 1000).toFixed(1)} seconds (${turn.durationSource})`} · {turn.toolCalls} tool calls</p>
    {cost && <SessionCostDetails cost={cost} label="Turn cost" />}
    {turn.usage.map((usage, i) => <p key={i}>{usage.model} · Context {usage.contextTokens ?? "unreported"} tokens · Reasoning {usage.reasoningTokens ?? "unreported"} tokens (included in output)</p>)}
    {turn.files.length === 0 ? <p>No collected patches for this turn.</p> : <details><summary>{turn.files.length} file changes</summary>{turn.files.map(file => <details key={file.path}><summary>{file.path}{file.scope === "external" ? " · outside project" : ""} · +{file.added}/−{file.removed}{file.truncated ? " · truncated" : ""}</summary>
      {file.available ? <pre className="session-output">{file.diff || "Patch text unavailable"}</pre> : <p>Historical patch unavailable.</p>}</details>)}</details>}
  </article>;
}

export function SessionCostDetails({ cost, label }: { cost: SessionDetail["cost"]; label?: string }) {
  return <details className="session-card"><summary>{label ?? `Estimated cost for ${cost.coveredTurns} displayed turns`}: {formatCost(cost.usd, cost.usd === null)}</summary>
    <p>{cost.unpricedRows} unpriced model rows; {cost.unreportedTurns} turns without usage. Estimates use current configured rates.</p>
    {cost.usage.map((row, index) => <section key={index}><h4>{row.model}</h4>{row.reason ? <p>{row.reason}</p> : <>
      <div className="session-cost-table"><table><thead><tr><th>Category</th><th>Tokens</th><th>USD / million</th><th>Charge USD</th></tr></thead><tbody>{row.lines.map(line => <tr key={line.category}><td>{line.category}</td><td>{line.tokens.toLocaleString()}</td><td>{line.ratePerMillion}</td><td>{line.usd.toFixed(6)}</td></tr>)}</tbody></table></div>
      <p>Rate reference: {row.effectiveDate} · {row.source}</p></>}</section>)}
  </details>;
}
export function SessionNotes({ id, details }: { id: string; details: SessionDetail["details"] }) {
  const [notes, setNotes] = useState(details?.notes ?? "");
  const [revision, setRevision] = useState(details?.notesRevision ?? 0);
  const [dirty, setDirty] = useState(false);
  const [message, setMessage] = useState("");
  const [saving, setSaving] = useState(false);
  useEffect(() => { if (!dirty && (details?.notesRevision ?? 0) >= revision) { setNotes(details?.notes ?? ""); setRevision(details?.notesRevision ?? 0); } }, [details?.notes, details?.notesRevision, dirty, revision]);
  const save = async () => {
    setSaving(true);
    try { await saveSessionNotes(id, notes, revision); setRevision(revision + 1); setDirty(false); setMessage("Notes saved"); }
    catch { setMessage("Notes changed elsewhere or could not be saved. Your draft is preserved."); }
    finally { setSaving(false); }
  };
  return <details className="session-card"><summary>Session notes</summary><label>Notes<textarea value={notes} maxLength={32000} onChange={e => { setNotes(e.target.value); setDirty(true); }} /></label><button className="btn btn-secondary" disabled={saving || !dirty} onClick={() => void save()}>Save notes</button>{message && <p role="status">{message}</p>}</details>;
}
function SessionControls({ detail }: { detail: SessionDetail }) {
  const [text, setText] = useState(""); const [message, setMessage] = useState(""); const [busy, setBusy] = useState(false);
  const request = useRef<{ id: string; operation: string; text: string } | null>(null);
  const send = async (operation: string) => {
    setBusy(true);
    // Preserve the same request id after an ambiguous network failure.
    if (!request.current || request.current.operation !== operation || request.current.text !== text) request.current = { id: crypto.randomUUID(), operation, text };
    try { await sendSessionCommand(detail.session.id, request.current.id, operation, operation === "feedback" ? text : undefined); setMessage("Command queued. Delivery and application are reported below."); request.current = null; if (operation === "feedback") setText(""); }
    catch { setMessage("Command not confirmed. Retry to check the same request."); }
    finally { setBusy(false); }
  };
  return <section className="session-card"><h3>Session controls</h3>{!detail.runtime && <p>This observed session has no connected control adapter.</p>}
    {detail.runtime && !detail.runtime.connected && <p>Adapter offline. Feedback waits for a supported hook and expires after five minutes.</p>}
    {detail.runtime?.capabilities.includes("feedback") && <><label>Feedback<textarea value={text} maxLength={16000} onChange={e => setText(e.target.value)} /></label><button className="btn btn-secondary" disabled={busy || !text.trim()} onClick={() => void send("feedback")}>Send feedback</button></>}
    {["stop", "resume"].filter(operation => detail.runtime?.capabilities.includes(operation)).map(operation => <button key={operation} className="btn btn-secondary" disabled={busy} onClick={() => void send(operation)}>{operation === "stop" ? "Stop session" : "Resume session"}</button>)}
    {message && <p role="status">{message}</p>}
    {detail.commands?.map(command => <p key={command.id}>{command.operation} · {command.operation === "feedback" && command.status === "applied" ? "Emitted as provider hook context" : command.status} · Expires {new Date(command.expiresAt).toLocaleString()}</p>)}
  </section>;
}
function SessionSummary({ detail, refresh }: { detail: SessionDetail; refresh: () => Promise<void> }) {
  const [busy, setBusy] = useState(false); const [message, setMessage] = useState("");
  const summary = detail.details?.summary;
  const summarize = async () => {
    setBusy(true);
    try { const result = await summarizeSession(detail.session.id); setMessage(result.reason ?? "Summary updated"); await refresh(); }
    catch { setMessage("Summary unavailable; previous summary preserved."); }
    finally { setBusy(false); }
  };
  return <section className="session-card"><h3>Summary</h3>{summary ? <><p>{summary.text}</p><p>{summary.model} · {summary.coveredTurns} turns · {new Date(summary.at).toLocaleString()}</p><p>Covered turns: {summary.firstTurn} → {summary.lastTurn}</p></> : <p>No summary yet.</p>}
    {detail.details?.lastSummaryError && <p>Summary may be stale; the last inference attempt failed.</p>}
    {detail.summariesEnabled && <button className="btn btn-secondary" disabled={busy} onClick={() => void summarize()}>{busy ? "Summarizing…" : "Update summary"}</button>}
    {message && <p role="status">{message}</p>}
  </section>;
}

export function SessionHistory({ id }: { id: string }) {
  const targetId = new URLSearchParams(window.location.search).get("turn");
  const [target, setTarget] = useState<SessionTurn>();
  const [targetCost, setTargetCost] = useState<SessionDetail["cost"]>();
  const [targetError, setTargetError] = useState("");
  const [detail, setDetail] = useState<SessionDetail>();
  const [older, setOlder] = useState<SessionTurn[]>([]);
  const [cursor, setCursor] = useState<string | null | undefined>();
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const active = useRef(true);
  const refreshing = useRef(false);
  const refresh = useCallback(async () => {
    if (refreshing.current) return;
    refreshing.current = true;
    try {
      const data = await fetchExternalSession(id);
      if (active.current) { setDetail(data); setError(""); }
      if (targetId && !data.turns.some(turn => turn.id === targetId)) {
        try { const page = await fetchExternalSessionTurn(id, targetId); if (active.current) { setTarget(page.turn); setTargetCost(page.cost); setTargetError(""); } }
        catch { if (active.current) setTargetError("Linked turn is unavailable. Collected history remains below."); }
      }
    }
    catch { if (active.current) setError("History updates unavailable. Retry when the server reconnects."); }
    finally { refreshing.current = false; }
  }, [id, targetId]);
  useEffect(() => { active.current = true; void refresh(); return () => { active.current = false; }; }, [refresh]);
  useVisibilityAwarePoll(() => void refresh(), 5000);
  const rows = new Map(older.map(turn => [turn.id, turn]));
  if (target) rows.set(target.id, target);
  for (const turn of detail?.turns ?? []) rows.set(turn.id, turn);
  const turns = [...rows.values()].sort((a, b) => b.startedAt.localeCompare(a.startedAt));
  const jumped = useRef(false);
  const linkedTurnReady = Boolean(targetId && rows.has(targetId));
  useEffect(() => {
    if (!targetId || !linkedTurnReady || jumped.current) return;
    const frame = requestAnimationFrame(() => {
      document.getElementById(`session-turn-${encodeURIComponent(targetId)}`)?.scrollIntoView?.({ block: "start" });
      jumped.current = true;
    });
    return () => cancelAnimationFrame(frame);
  }, [targetId, linkedTurnReady]);
  const next = cursor === undefined ? detail?.nextCursor : cursor;
  const more = async () => {
    if (!next || busy) return;
    setBusy(true);
    try { const page = await fetchExternalSession(id, next); setOlder(old => [...old, ...page.turns]); setCursor(page.nextCursor); }
    catch { setError("Older history could not be loaded. Please retry."); }
    finally { setBusy(false); }
  };
  return <ViewLayout header={<ViewHeader title={detail?.session.observation.title ?? "Session history"} backAction={{ label: "Back to sessions", onClick: () => { window.location.search = "?view=sessions"; } }} />}>
    <div className="sessions-view">
      {targetError && <p role="alert">{targetError}</p>}
      {error && <p role="alert">{error}</p>}
      {!detail && !error && <p role="status">Loading history…</p>}
      {detail?.wholeSessionUsage && <section className="session-card"><h3>Whole session: {formatCost(detail.wholeSessionUsage.usd, detail.wholeSessionUsage.usd === null)}</h3><p>{detail.wholeSessionUsage.turns} collected turns · {detail.wholeSessionUsage.unreportedTurns} turns without usage · {detail.wholeSessionUsage.unpricedRows} unpriced model groups. Estimate at current rates.</p></section>}
      {detail && <><p>{detail.session.hostId} · {detail.session.provider} · {detail.session.observation.activity} · Observed session</p><SessionSummary detail={detail} refresh={refresh} /><SessionCostDetails cost={detail.cost} /><SessionControls detail={detail} /><SessionNotes id={id} details={detail.details} /><SessionPreferences id={id} details={detail.details} refresh={refresh} /></>}
      <div className="sessions-grid">{turns.map(turn => <SessionTurnResult key={turn.id} turn={turn} sessionId={id} cost={detail?.turnCosts?.[turn.id] ?? (turn.id === targetId ? targetCost : undefined)} />)}</div>
      {detail && turns.length === 0 && <p>No turn history has been collected yet.</p>}
      {next && <button className="btn btn-secondary" disabled={busy} onClick={() => void more()}>Load older turns</button>}
    </div>
  </ViewLayout>;
}
