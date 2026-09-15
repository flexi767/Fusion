import { useCallback, useEffect, useRef, useState } from "react";
import { fetchSessionLaunches, type SessionLaunchPage } from "../api/external-sessions";
import { useVisibilityAwarePoll } from "./visibilitySuspension";

export function useSessionLaunches() {
  const [data, setData] = useState<SessionLaunchPage>(); const [error, setError] = useState(false);
  const active = useRef(false); const busy = useRef(false);
  const refresh = useCallback(async () => {
    if (busy.current) return; busy.current = true;
    try { const next = await fetchSessionLaunches(); if (active.current) { setData(next); setError(false); } }
    catch { if (active.current) setError(true); }
    finally { busy.current = false; }
  }, []);
  useEffect(() => { active.current = true; void refresh(); return () => { active.current = false; }; }, [refresh]);
  useVisibilityAwarePoll(() => void refresh(), 10000);
  return { data, error, refresh };
}
