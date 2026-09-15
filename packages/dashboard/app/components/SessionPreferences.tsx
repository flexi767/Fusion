import { useEffect, useState } from "react";
import { saveSessionPreferences, type SessionDetail } from "../api/external-sessions";

export function SessionPreferences({ id, details, refresh }: { id: string; details: SessionDetail["details"]; refresh: () => Promise<void> }) {
  const [archived, setArchived] = useState(details?.archived ?? false);
  const [pinned, setPinned] = useState(details?.pinned ?? false);
  const [revision, setRevision] = useState(details?.preferencesRevision ?? 0);
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  useEffect(() => {
    if (!dirty && (details?.preferencesRevision ?? 0) >= revision) {
      setArchived(details?.archived ?? false); setPinned(details?.pinned ?? false); setRevision(details?.preferencesRevision ?? 0);
    }
  }, [details?.archived, details?.pinned, details?.preferencesRevision, dirty, revision]);
  const save = async () => {
    setBusy(true);
    try { await saveSessionPreferences(id, archived, pinned, revision); setRevision(revision + 1); setDirty(false); setMessage("Session preferences saved"); await refresh(); }
    catch { setMessage("Preferences changed elsewhere or could not be saved. Your choices are preserved."); }
    finally { setBusy(false); }
  };
  const imported = details?.importedMetadata;
  return <details className="session-card"><summary>Saved session and imported metadata</summary>
    <label><input type="checkbox" checked={archived} onChange={e => { setArchived(e.target.checked); setDirty(true); }} />Archived</label>
    <label><input type="checkbox" checked={pinned} onChange={e => { setPinned(e.target.checked); setDirty(true); }} />Pinned</label>
    <p>These labels preserve the session and its history.</p>
    <button className="btn btn-secondary" disabled={!dirty || busy} onClick={() => void save()}>Save preferences</button>
    {message && <p role="status">{message}</p>}
    {imported && <section><h3>AgentPulse snapshot</h3>
      <p>Model: {imported.model ?? "Unreported"} · Branch: {imported.branch ?? "Unreported"}</p>
      <p>Started: {imported.startedAt ? new Date(imported.startedAt).toLocaleString() : "Unreported"} · Ended: {imported.endedAt ? new Date(imported.endedAt).toLocaleString() : "Unreported"}</p>
      <p>Snapshot totals are preserved as reported. Rankings use collected turns; these totals are not added again.</p>
      {(imported.sourceAliases?.length ?? 0) > 0 && <details><summary>Source aliases for this native session</summary>
        <p>Verified source records share this native identity. Original labels are preserved below. Import archives the combined card only when every source record was archived, and preserves any source pin; your saved preferences take precedence.</p>
        {imported.sourceAliases?.map(alias => <section key={alias.sourceSessionId}><h4>{alias.title}</h4><p>Source ID: {alias.sourceSessionId}</p>
          <p>Original status: {alias.status} · {alias.archived ? "Archived" : "Not archived"} · {alias.pinned ? "Pinned" : "Not pinned"}</p>
          {alias.notes && <pre className="session-output">{alias.notes}</pre>}
          {alias.truncated && <p>Alias notes are truncated; the recovery snapshot retains the original.</p>}
        </section>)}
      </details>}
      {imported.usage.map((row, index) => <p key={index}>{row.model} · {row.requests ?? "Unreported"} requests · {row.inputTokens?.toLocaleString() ?? "Unreported"} input · {row.outputTokens?.toLocaleString() ?? "Unreported"} output · {row.cachedInputTokens?.toLocaleString() ?? "Unreported"} cache read · {row.cacheWriteTokens?.toLocaleString() ?? "Unreported"} cache write</p>)}
      {(imported.conversations?.length ?? 0) > 0 && <section><h4>Imported AgentPulse conversations</h4>
        <p>Read-only history mentioning this session. Conversation IDs identify the same source thread when it mentions several sessions. Conversation token counts are archive metadata, excluded from session rankings.</p>
        {imported.conversations?.map(thread => <details key={thread.id}><summary>{thread.title}{thread.archivedAt ? " · Archived" : ""}</summary>
          <p>Source conversation: {thread.id} · {thread.messages.length} of {thread.totalMessages} messages</p>
          {thread.messages.map(message => <article key={message.id}>
            <p>{message.role} · <time dateTime={message.at}>{new Date(message.at).toLocaleString()}</time>{message.truncated ? " · Truncated" : ""}</p>
            <pre className="session-output">{message.content}</pre>
            {message.error && <p>Recorded error: {message.error}</p>}
            <p>{message.inputTokens ?? "Unreported"} input tokens · {message.outputTokens ?? "Unreported"} output tokens</p>
            {message.contextSessionIds.length > 0 && <details><summary>Source context session IDs</summary>{message.contextSessionIds.map((context, index) => <p key={`${context}:${index}`}><code>{context}</code></p>)}</details>}
          </article>)}
        </details>)}
        {imported.conversationsTruncated && <p>This bounded archive omits some older or oversized content. The original recovery snapshot retains it.</p>}
      </section>}
      <details><summary>Snapshot provenance</summary><p>Source session: {imported.sourceSessionId}</p><code>{imported.snapshot}</code></details>
    </section>}
  </details>;
}
