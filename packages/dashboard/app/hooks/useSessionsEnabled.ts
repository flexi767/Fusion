import { useEffect, useState } from "react";
import { api } from "../api/client/client.js";
let pending: Promise<{ enabled: boolean }> | undefined;
export function useSessionsEnabled(): boolean {
  const [enabled, setEnabled] = useState(false);
  useEffect(() => {
    let mounted = true;
    pending ??= api<{ enabled: boolean }>("/external-sessions?capabilities=1").finally(() => { pending = undefined; });
    void pending.then(result => { if (mounted) setEnabled(result.enabled); }).catch(() => {});
    return () => { mounted = false; };
  }, []);
  return enabled;
}
