---
"@runfusion/fusion": patch
---

summary: Recreate managed remote-access tunnels automatically when their process exits while Fusion remains active.
category: fix
dev: Tunnel retries use bounded exponential backoff and are cancelled by an explicit stop or provider switch.
