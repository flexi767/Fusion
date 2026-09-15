import { ExternalSessionStore, ExternalSessionSummaries, type AsyncDataLayer } from "@fusion/core";
/** One inference at a time per server. Database leases coordinate other server instances. */
export function createSessionSummaryWorker(layer: () => AsyncDataLayer, endpoint: string) {
  const pending = new Set<string>();
  let stopped = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let cursor: string | undefined;
  let recovery: string[] = [];
  let busy = false;
  const tick = async () => {
    if (stopped || busy) return;
    busy = true;
    try {
      if (pending.size === 0 && recovery.length === 0) {
        const page = await new ExternalSessionStore(layer()).list({ before: cursor, limit: 25 });
        recovery = page.sessions.map(session => session.id);
        cursor = page.nextCursor ?? undefined;
      }
      const id = pending.values().next().value as string | undefined ?? recovery.shift();
      if (id) {
        pending.delete(id);
        await new ExternalSessionSummaries(layer()).summarize(id, endpoint);
      }
    } catch {
      // Collection and display stay independent of summary/database availability.
      // The next recovery sweep revisits the durable observations.
    } finally {
      busy = false;
      if (!stopped) timer = setTimeout(() => void tick(), 2000);
    }
  };
  timer = setTimeout(() => void tick(), 2000);
  return {
    enqueue(id: string) { if (pending.size < 500) pending.add(id); },
    stop() { stopped = true; if (timer) clearTimeout(timer); pending.clear(); },
  };
}
