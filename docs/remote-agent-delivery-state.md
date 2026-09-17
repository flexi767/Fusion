# Remote-agent delivery state

Updated 2026-09-17 23:24 UTC.

Owned worktree: `/Users/v/Documents/Codex/2026-09-16/fusion-external-pr1-retry/work/fusion-remote-agents`, branch `codex/remote-agent-feedback-costs`. Narrow scope and queue in `remote-agent-delivery-plan.md`.

Completed first read API increment: authenticated project-bound bounded cursor list/detail, exact host/provider filters, immutable identity ordering, separate host/activity freshness and presentation DTOs without stored fingerprints. No schema changes in this increment. Focused local contract tests: 12 passed; route/auth tests: 14 passed. Core and dashboard source typechecks passed; scoped eslint has no errors (two tests ignored by the repository's existing lint configuration); changesets, UTC FNXC dates, route modularity and whitespace checks passed. Two PostgreSQL read regressions are added, but not yet run in the restricted local sandbox; outside-sandbox acceptance is the next validation step. The HTTP smoke now checks real list/detail/filter responses and persisted read state after restart.

Deployment inventory: SSH alias `j` reaches the existing user-systemd `fusion-daemon.service`. Loopback health is healthy, version `0.78.0-beta.4`. It runs installed global CLI from `/home/ubuntu/.npm-global/lib/node_modules/@runfusion/fusion` in `/srv/scrapeui-dev`; production source `/home/ubuntu/fusion-src` was clean at `38455359f`. The actual nginx server name is `fusion.topkoli.com`, forwarding to loopback 4040 behind existing Basic Auth. External URL returns expected HTTP 401. The user-typed `fusion.topcollie.com` does not resolve; no DNS or proxy settings changed. `/api/system` is absent on the currently installed version; don't assume the newer source-rebuild API exists.

Earlier prototype evidence suggests Codex/Claude on m3/m5/J, with m5 historically offline. The optional host/runtime question is unanswered; proceed with the earlier Codex/Claude m3/m5/J scope. A fresh m5 SSH probe still failed with `No route to host`. Show it offline; do not invent visibility or feedback delivery. Prototype remains read-only. Production config/service/database/provider hooks and AgentPulse are unchanged.

Scheduler blocker: attempted creation of the requested 20-minute thread heartbeat was rejected because the tool requires approval and this session's policy is `never`. NO automation was created. Continue useful local work; scheduler activation still requires an execution context that permits this tool. Do not claim scheduled continuations will run.

Next: run focused PostgreSQL plus HTTP read/restart acceptance and required checks; safely checkpoint/push owned increment; then bounded recent activity/usage contract, native collectors, honest pricing, feedback transport and shared responsive view. Refresh upstream before assigning any new migration identity. Finished-feature deployment is explicitly authorized, but not performed yet.

## Native feedback investigation

Current local host is m3: Codex CLI `0.141.0`, Claude Code `2.1.263`. J: Codex CLI `0.154.0`, Claude Code `2.1.275`. Both hosts expose those executables. No agents were launched.

Official [Codex hooks](https://developers.openai.com/codex/hooks) and [Claude hooks](https://code.claude.com/docs/en/hooks) document `hookSpecificOutput.additionalContext` on relevant native events. This is a candidate transport; current installed versions and actual loaded hook configuration still need disposable verification. Hook output is context delivery, not proof that an agent acted on feedback, and idle sessions may need another native event.

The prototype hook hashes `[host, provider, native id]`; the new foundation hashes `[project, host, provider, native id]`. Do not port the prototype identity or envelope verbatim. Its adapter has an independent prepared/emitted/failed SQLite fence and a two-second hook budget, useful as design evidence. Adapt only feedback; preserve all existing provider hooks. Raw AgentPulse feedback is stored in session metadata with a lease and retries, which is weaker than generation-fenced delivery and must not be advertised as exactly-once execution.

Outside-sandbox acceptance running: https://github.com/flexi767/Fusion/actions/runs/35286799773, fork-only validation branch `codex/remote-agent-read-validation`, head `2c610146f`; it differs from application head `eeea9399a` only by the temporary workflow. Includes 47 focused cases, full real HTTP read/ingest/restart smoke, workspace lint/typecheck/build and curated Gate.

## Read increment accepted

Updated 2026-09-17 23:40 UTC.

Fork validation run `35286799773` completed SUCCESS. Application code head `eeea9399ab8810f34fe6832cdda5185e50629c00`, validation head `2c610146f` (only added a fork-only workflow). Logs confirm 33 core contract/PostgreSQL cases plus 14 route/auth cases: 47 passed, none skipped. Real CLI HTTP smoke passed project-scoped list/detail, exact host filters, ingest/replay/conflict/auth checks, durable acknowledgement and completed-session reads after restart, clean shutdown and disposable-state removal. Build, full lint, workspace typecheck and all 755 curated Gate tests passed. The subsequent checkpoint commit changes only this state document.

The read API increment is complete and pushed. The feature is NOT finished: recent activity/usage collection, costs, feedback transport and UI remain queued. NO production deployment or service change occurred, and NO recurring automation is active. Automation creation remains blocked by this session's approval policy. Prepared continuation prompt is at `/Users/v/Documents/Codex/2026-09-16/fusion-external-pr1-retry/outputs/fusion-remote-agent-loop-prompt.md`; activate it only through confirmed scheduler creation in an execution context that permits the tool. Do not rely on uncreated future runs.
