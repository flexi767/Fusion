# Remote-agent delivery state

Updated 2026-09-17 23:24 UTC.

Owned worktree: `/Users/v/Documents/Codex/2026-09-16/fusion-external-pr1-retry/work/fusion-remote-agents`, branch `codex/remote-agent-feedback-costs`. Narrow scope and queue in `remote-agent-delivery-plan.md`.

Completed first read API increment: authenticated project-bound bounded cursor list/detail, exact host/provider filters, immutable identity ordering, separate host/activity freshness and presentation DTOs without stored fingerprints. No schema changes in this increment. Focused local contract tests: 12 passed; route/auth tests: 14 passed. Core and dashboard source typechecks passed; scoped eslint has no errors (two tests ignored by the repository's existing lint configuration); changesets, UTC FNXC dates, route modularity and whitespace checks passed. Two PostgreSQL read regressions are added, but not yet run in the restricted local sandbox; outside-sandbox acceptance is the next validation step. The HTTP smoke now checks real list/detail/filter responses and persisted read state after restart.

Deployment inventory: SSH alias `j` reaches the existing user-systemd `fusion-daemon.service`. Loopback health is healthy, version `0.78.0-beta.4`. It runs installed global CLI from `/home/ubuntu/.npm-global/lib/node_modules/@runfusion/fusion` in `/srv/scrapeui-dev`; production source `/home/ubuntu/fusion-src` was clean at `38455359f`. The actual nginx server name is `fusion.topkoli.com`, forwarding to loopback 4040 behind existing Basic Auth. External URL returns expected HTTP 401. The user-typed `fusion.topcollie.com` does not resolve; no DNS or proxy settings changed. `/api/system` is absent on the currently installed version; don't assume the newer source-rebuild API exists.

Earlier prototype evidence suggests Codex/Claude on m3/m5/J, with m5 historically offline. Pending optional host/runtime question is unanswered. Prototype remains read-only. Production config/service/database/provider hooks and AgentPulse are unchanged.

Scheduler blocker: attempted creation of the requested 20-minute thread heartbeat was rejected because the tool requires approval and this session's policy is `never`. NO automation was created. Continue useful local work; scheduler activation still requires an execution context that permits this tool. Do not claim scheduled continuations will run.

Next: run focused PostgreSQL plus HTTP read/restart acceptance and required checks; safely checkpoint/push owned increment; then bounded recent activity/usage contract, native collectors, honest pricing, feedback transport and shared responsive view. Refresh upstream before assigning any new migration identity. Finished-feature deployment is explicitly authorized, but not performed yet.
