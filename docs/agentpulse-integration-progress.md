# Fusion AgentPulse integration progress

Session: **Fusion AgentPulse integration**. Updated 2026-09-15.
Worktree: `/Users/v/dev/fusion-worktrees/agentpulse-sessions`.
Branch: `codex/agentpulse-sessions`; plan baseline `801d03c84`; foundation `f435871bf`.

## Verified deployment and source

- J: live source `/home/ubuntu/agent-panels/agentpulse`, clean at full commit `04f0dcf42d700f60ea3848326ba6d43da80c7a40`, origin https://github.com/flexi767/agentpulse.git. MIT, copyright 2026 Jay Stuart. Read actual shared telemetry/results contracts, observer, and Python turn parser before adapting.
- J: user services `agentpulse`, `agentpulse-supervisor`, `agentpulse-private-relay`, and `fusion-daemon` active. AgentPulse binds loopback 43120; private relay 43121. Fusion works from `/srv/scrapeui-dev`, PostgreSQL database `fusion`, port 4040 (reserved; untouched).
- m3: `~/.agentpulse/supervisor.js` and `relay.ts` running; independent durable AgentPulse queue forwards to J. Existing native sources include Codex desktop rollouts and Claude project JSONL. Credentials remain private.
- m5 inventory, supported snapshot backup, counts/usage coverage, exact summary endpoint model, and representative native fixture capture remain to verify.
- Source inspection identifies search, channels/notifications, launch templates, workspace actions, feedback and AI inbox/gates beyond the initial session list. These need usage inventory and explicit replacement mapping before parity.

## Contract and ownership

Native Fusion feature: core owns PostgreSQL observations and normalized history; dashboard owns authenticated ingestion and presentation; isolated host collector reads native transcripts. No new live database. Observed identity is `(authenticated host, provider, native session id)`. No task enrollment, title/path matching, or inferred control privileges. Additive migration; feature gates keep production ingestion opt-in.

## Completed

- Foundation validator, host/provider identity, monotonic observation reconciliation, separate collector connectivity; five node tests in the first commit.
- Source/deployment verification above; no AgentPulse service or configuration changed.

## In progress / remaining

1. PostgreSQL persistence, host credential authentication, durable acknowledgements and heartbeat.
2. Independent durable collectors and Sessions navigation/list for m3/m5/J; live reconciliation with Fusion-owned sessions.
3. Paginated prompt/result history, duration/tool counts and historical patches.
4. Provider usage normalization, effective-dated Fusion pricing, accessible cost popup and rankings.
5. Host-routed feedback/control capability and idempotent delivery/expiry.
6. Bounded summaries through existing m3 Qwen3.5-2B endpoint; operational health/search/notes/notifications.
7. Resumable historical import, counts/text/diff/usage reconciliation, rollback rehearsal and 24-hour dual-run observation.

## Verification and rollout

Only one heavy command at a time, bounded workers. Existing unrelated Vitest jobs detected at start (one about 10 GiB RSS), so heavy checks deferred while inspecting and implementing. No releases, merges to main, model downloads, inference servers or service retirement. Parity is **not verified**. AgentPulse must remain running; retirement requires explicit approval after parity.

## Implementation checkpoint (2026-09-15, afternoon)

- Added migrations 0079/0080 for host heartbeats, observations and turns; registered with schema applier and central schema inventory.
- Added opt-in `/api/session-collector` authentication using per-host SHA-256 credential hashes. Commit-before-ack, monotonic revisions, browser rejection, bounded payloads; no task creation.
- Added independent Python collector and durable SQLite delivery spool (local queue only, not an application database), single-instance file lock, partial-line checkpointing, retry/backoff and old/resumed Codex discovery plus Claude transcript discovery.
- Adapted the verified upstream turn parser with its complete MIT license. Native prompts, final output, duration, tool results and patches feed PostgreSQL through the same acknowledgement transaction.
- Added opt-in Sessions navigation across standard/Alpha desktop and mobile, stable card identity, connection/activity separation, host/provider/activity/project filters, deep links and paginated history. Reuses ViewLayout/ViewHeader, visibility-aware polling and existing cost formatting.
- Added cost category calculations through Fusion's existing price lookup/overrides. Explicitly unpriced unknown models, unsupported tiers/context bands/cache lifetime, and missing categories. Current estimates and displayed-turn coverage are labeled; recorded historical prices and full rankings remain outstanding.
- Verified existing m3 MLX config and `/v1/models`: `http://127.0.0.1:8080/v1` advertises `qwen3.5-2b`; no new inference service or downloads.
- m5 SSH returned `No route to host`. J SSH alternates between success and banner timeout. AgentPulse backup command has not succeeded yet; do not treat a snapshot as secured.

### Checks so far

- Core, dashboard-server, and dashboard-app TypeScript checks passed at their respective checkpoints; rerun after later edits.
- 6 Node observation/auth tests passed.
- 5 Python collector/parser tests passed.
- 2 real PostgreSQL ingestion/replay tests passed against an isolated local server on 55439. Added history atomicity test pending rerun.
- 2 in-memory Express authentication/durability route tests passed.
- 4 core pricing/migration tests passed.
- 3 new UI behavioral tests passed. Existing lazy-view count assertion needed 22→23 alongside the inventory; rerun pending.
- The standard PG provisioner rejects macOS, and localhost:5432 requires credentials. Isolated test server uses the already-installed PostgreSQL native payload under `~/.fusion/session-integration-test`; it touches neither port 4040 nor the existing DB.

### Still not verified

Live m3/m5/J delivery into a serving Fusion build, native-session reconciliation, latency targets, full transcript/state bounds, source fixtures for compaction/model changes, cost history/rankings, durable commands/feedback, summaries, search/notes/notifications, historical import, snapshot/parity/rollback, and the 24-hour comparison window. Feature flags remain off by default. AgentPulse remains running.

## Extended checkpoint (2026-09-15, 16:15 local)

- Added migration 0081 and durable host/runtime-generation-scoped command queues, capability registration, expiry, outcome acknowledgements, notes CAS, and summary leases/backoff. Transcript discovery still cannot grant capabilities. Native control execution adapters remain to implement and verify; keep control feature flags off.
- Added bounded, thinking-disabled Qwen summary requests with a five-turn window, content hashing, database lease, retry delay, provenance and previous-summary preservation. Current UI supports explicit summary refresh; automatic changed-content scheduling remains outstanding.
- Added shared history/notes/control/summary presentation. Only registered capabilities expose action buttons. This does not establish that any real runtime supports controls yet.
- Added resumable SHA-256/cursor-based historical turn-result importer requiring an audited host/provider/native-id mapping. Missing mappings stop with a report. Historical writes fill missing turns and cannot overwrite live snapshots/results. Session-only records, imported notes/usage metadata, complete reconciliation reporting and native identity-map generation remain outstanding.
- Additional checks: three PostgreSQL observation/history tests passed; two PostgreSQL command/summary/notes tests passed; six Python collector/parser/import tests passed; route-modularity and changeset-format checks passed; targeted lint had zero errors and three control-regex warnings (including the original foundation validator).
- Latest core typecheck passed. New history-import PG test, latest UI/server typechecks and the adjusted lazy-inventory test still need rerun; full lint/build/serial gate and real browser verification remain required.
- Resource check detected a new unrelated Bun process around 10 GiB and low free memory. Further heavy checks are deferred until capacity recovers. No user/peer process was killed.

This is an implementation checkpoint, **not a parity or production-readiness claim**. Neither Fusion production ingestion nor existing AgentPulse hooks/services have been reconfigured. J connectivity is currently timing out; m5 remains unreachable. Keep all AgentPulse services running.
