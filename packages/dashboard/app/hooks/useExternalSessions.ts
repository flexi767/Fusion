import { useCallback, useEffect, useRef, useState } from "react";
import { fetchExternalSessions, type SessionPage, type SessionFilters } from "../api/external-sessions";
import { useVisibilityAwarePoll } from "./visibilitySuspension";
export function useExternalSessions(filters: SessionFilters = {}) {
  const filterKey = JSON.stringify(filters);
  const [data, setData] = useState<SessionPage>();
  const [error, setError] = useState(false);
  const [isLoading, setLoading] = useState(true);
  const active = useRef(true);
  const busy = useRef(false);
  const refresh = useCallback(async () => {
    if (busy.current) return;
    busy.current = true;
    try { const page = await fetchExternalSessions(undefined, JSON.parse(filterKey)); if (active.current) { setData(page); setError(false); } }
    catch { if (active.current) setError(true); }
    finally { busy.current = false; if (active.current) setLoading(false); }
  }, [filterKey]);
  useEffect(() => { active.current = true; void refresh(); return () => { active.current = false; }; }, [refresh]);
  useVisibilityAwarePoll(() => void refresh(), 5000);
  return { data, error, isLoading };
}
