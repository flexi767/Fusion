import type { ObservedSession } from "../api/external-sessions";

/** Shared by the global list, session history and task-linked history. */
export function SessionActivityStatus({ session, connected }: { session: Pick<ObservedSession, "observation" | "activityStale">; connected?: boolean }) {
  return <>
    <p>Last reported activity: <strong>{session.observation.activity}</strong>{connected === undefined ? "" : ` · Collector ${connected ? "connected" : "disconnected"}`}</p>
    {session.activityStale && <p>Stale working report: no native activity has been reported for over five minutes. The session’s current activity is unknown.</p>}
  </>;
}
