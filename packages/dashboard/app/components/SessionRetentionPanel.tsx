import { useState } from "react";
import { applySessionRetention, previewSessionRetention, type SessionRetentionPreview } from "../api/external-sessions";

export function SessionRetentionPanel() {
  const [days, setDays] = useState("30");
  const [preview, setPreview] = useState<SessionRetentionPreview>();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const run = async (apply: boolean) => {
    if (busy || (apply && !preview)) return;
    setBusy(true); setMessage("");
    try {
      const result = apply ? await applySessionRetention(preview!.cutoff) : await previewSessionRetention(Number(days));
      setPreview(result);
      if (apply) setMessage(`Removed collected text from ${result.removedContentTurns ?? 0} turns. Usage, file counts and notes are retained.`);
    } catch { setPreview(undefined); setMessage("Retention could not be completed. Review eligibility again before retrying."); }
    finally { setBusy(false); }
  };
  return <details className="session-card"><summary>Collected content retention</summary>
    <p>Nothing is removed automatically. Review old inactive sessions across all hosts, then remove collected prompt, response and patch text in small batches. Summaries containing that text are cleared.</p>
    <p>Pinned and task-linked sessions are protected. Identities, usage, recorded prices, file counts, operator notes, imported conversations and native transcript files are retained. Old replay cannot restore removed text; new activity in a turn can supply fresh content.</p>
    <form className="sessions-filters" onSubmit={event => { event.preventDefault(); void run(false); }}>
      <label>Keep recent content (days)<input type="number" min={1} max={3650} step={1} required value={days} disabled={busy} onChange={event => { setDays(event.target.value); setPreview(undefined); setMessage(""); }} /></label>
      <button className="btn btn-secondary" disabled={busy} type="submit">Review eligible content</button>
    </form>
    {preview && <>
      <p>Next batch: {preview.eligibleTurns} eligible turns inactive since {new Date(preview.cutoff).toLocaleString()}.{preview.moreAvailable ? " More eligible content remains after this batch." : ""}</p>
      {preview.eligibleTurns > 0 && <button className="btn btn-secondary" type="button" disabled={busy} onClick={() => void run(true)}>Remove text from up to {preview.eligibleTurns} eligible turns</button>}
    </>}
    {message && <p role="status">{message}</p>}
  </details>;
}
