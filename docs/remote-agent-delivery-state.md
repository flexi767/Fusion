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

## Standalone implementation checkpoint

Updated 2026-09-18 05:49 UTC. The operator explicitly requires AgentPulse independence. New source uses Fusion-native PostgreSQL observations/feedback, standalone stdlib Python JSONL collectors and native context hooks, existing Fusion pricing, and Agents → Remote agents. No AgentPulse API/database/relay/supervisor/hook dependency remains. Existing unrelated AgentPulse services are preserved.

Migration identities were checked against current upstream: its 0082/0083 are already assigned. Own unreleased ingestion migration is now 0084; feedback is 0085. Production is still the old installed package with migration ceiling 0071. Its actual database is system PostgreSQL on loopback 5432/database fusion (about 1.4 GB), not the inactive embedded cluster. Deployment must back up that database and validate all intervening migrations on a disposable clone first.

Local full build, lint, workspace typecheck and curated Gate passed (9 PG Gate cases skipped due restricted sandbox); focused cases passed 12 core + 17 routes/pricing, with 23 PG cases awaiting real PostgreSQL. RemoteAgentsPanel/AgentsView passed 143 cases; standalone Python parser/spool/hooks tests passed six cases. Full desktop packaging hit a sandbox-denied tsx Unix pipe; the server artifact can be built outside this sandbox. No deployment, hook installation, production feedback, or recurring automation has occurred. Native Codex hooks require native review/trust; installer explicitly preserves that requirement and other existing hooks. M5 remains an offline/unverified host.

Next: run current standalone branch in fork-only full PostgreSQL/HTTP acceptance, prepare full server artifact and rollback backups, stage against an isolated production database clone, then cut over the existing service and verify collectors/native feedback/UI. Do not treat prior read-only CI as acceptance of this new implementation.

## Standalone server acceptance

Updated 2026-09-18 06:09 UTC. Complete server packaging succeeded on J for application head `00f736543`. Owned staged dashboard is healthy on loopback 4085, isolated database `fusion_remote_agents_stage_20260918`, separate HOME/TMPDIR and cloned project paths/node mappings. The database reached 0085 and retained 1,407 tasks. Cloned durable agents and automations are disabled; production is untouched.

A disposable native Claude Haiku session, with Fusion-only hooks and no AgentPulse configuration, appeared through the standalone collector, accepted queued feedback, consumed additional context and returned its unique test marker. Fusion recorded delivered. Copied native authentication files were removed afterward. Existing real agents received no unsolicited feedback. Codex native trust remains a required operator step, never forged by installation.

Browser acceptance found two gaps before rollout: inherited local-agent controls/duplicate Refresh in the remote view, and actual Claude one-hour cache writes made totals unavailable. Current source hides those local controls in remote mode and prices one-hour writes with Anthropic's officially documented 2x base-input tariff; caches/reasoning remain disjoint. OpenAI's official GPT-6 Astra model page provides standard rates (input 10, cached 1, writes 12.5, output 50 USD/million), now added to Fusion's single catalog with per-entry verified provenance. Existing baseline prices are unchanged. Model pricing has 32 passing cases, remote UI/pricing has 148 passing cases, native scripts have seven passing cases. Final checks and updated artifact are pending; production is NOT deployed yet.
