import { useCallback, useEffect, useRef, useState } from "react";
import { fetchExternalSessions, type SessionPage } from "../api/external-sessions";
import { useVisibilityAwarePoll } from "./visibilitySuspension";
export function useExternalSessions() {
  const [data, setData] = useState<SessionPage>();
  const [error, setError] = useState(false);
  const [isLoading, setLoading] = useState(true);
  const active = useRef(true);
  const busy = useRef(false);
  const refresh = useCallback(async () => {
    if (busy.current) return;
    busy.current = true;
    try { const page = await fetchExternalSessions(); if (active.current) { setData(page); setError(false); } }
    catch { if (active.current) setError(true); }
    finally { busy.current = false; if (active.current) setLoading(false); }
  }, []);
  useEffect(() => { active.current = true; void refresh(); return () => { active.current = false; }; }, [refresh]);
  useVisibilityAwarePoll(() => void refresh(), 5000);
  return { data, error, isLoading };
}
