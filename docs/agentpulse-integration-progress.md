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

### Commit and push status

Checkpoint saved locally as `b81ca5adc`. HTTPS push failed with `could not read Username`; `gh auth status` reports the existing token invalid, and GitHub SSH rejects the available key (`Permission denied (publickey)`). No local commit was discarded. Normal branch push remains blocked on valid GitHub credentials.

Subsequent work adds session-only/notes historical import, explicit collector-method auth fencing, and automatic bounded summary scheduling with restart recovery and burst coalescing. These changes are pending their focused verification and next commit.

## Verified recovery and reliability checkpoint (2026-09-15, 16:38 local)

- J access recovered through its existing `j` SSH alias. Supported SQLite backup secured at `/home/ubuntu/.agentpulse/backups/fusion-integration-20260915.db` (157,188,096 bytes, mode 600), SHA-256 `04f7c3ebbf89eba90bf3fffdc782c01076301fb9a46f089f67d978f2a3d48f44`. Nine collector/provider configuration files preserved under `/home/ubuntu/.agentpulse/backups/fusion-config-20260915` (directory 700, files 600). AgentPulse remains active.
- Snapshot inventory: 95 sessions, 5,958 stored turns, usage coverage 71/95; host/provider counts: m3 Claude 12/Codex 54, m5 7/5, J 4/1, hostless 7/5. Hostless identities require native evidence. Notes 0, pinned 0, archived 6, managed sessions 4, control actions 7, projects 0. Source resume/fork endpoints return 501; do not claim those as working capabilities.
- Serial `pnpm verify:fast` passed all 23 steps, including scoped typechecks/builds, CLI build and real boot/health/shutdown smoke. Root lint passed with zero errors and four warnings. One initial bootstrap run was stopped because pnpm recursively parallelized despite the fast verifier's serial flag; the successful run also set `npm_config_workspace_concurrency=1`.
- Six PostgreSQL observation/history/control tests, three turn/pricing tests, and ten Python collector/parser/import tests pass. Automatic summary scheduling route/worker tests passed earlier; latest UI/gate verification remains pending.
- Collector now separates live-tail and history cursors, prioritizes/coalesces live observations during backlog, retains exact-ack fencing, rotates older discovery and caps history read budget per pass. Tests exercise offline coalescing, in-flight replacement, partial final lines, host binding and redirect refusal. Full parser state/resource bounds still need work.

### Symptom verification: external historical patch paths

Original symptom: the real AgentPulse 20-file, +663/−42 reference was rejected because some recorded edits were outside its working directory; live/import adapters also silently dropped such patches.

Exact reproduction: reference session `01a09920-9cc7-7c81-9270-aaa7e520477a`, turn `01a0a4ab-d055-7d00-86ea-391901b12b12`, obtained from the supported J snapshot. The private fixture is retained locally outside tracked source.

Assertion it is gone: parser tests preserve all relative, absolute, parent-relative, Windows and UNC paths and patch counts as display data. Import tests preserve outside-project files. The real fixture roundtrip and browser comparison are next; no arbitrary filesystem-read endpoint exists.

Surface enumeration: native collector, historical importer, core validation and shared desktop/mobile history renderer. Paths are labeled project/external, never opened on a host. Empty, control-character and oversized paths still reject atomically. Missing/truncated patches retain explicit presentation.

## Live preview verification (2026-09-15, 16:49 local)

- The real reference roundtrip now passes: PostgreSQL and the browser preserve all 20 files and +663/−42. Desktop and 390×844 mobile screenshots are private local artifacts under `output/playwright`. Cost disclosure responds to keyboard Enter; cost and patch expansions survive polling; no horizontal page overflow in the checked desktop state.
- A bounded real m3 collector pass populated the preview with both native Codex and Claude sessions (first page 39 Codex / 11 Claude), independently of AgentPulse. More discoveries/history remain queued; this is not an all-host parity count. Preview uses the isolated database on 55439 and loopback HTTP 60832. Port 4040 is untouched.
- Fixed Sessions routing when no Fusion project exists, with mobile/desktop behavioral tests and a global header entry. Fixed invalid spacing aliases found through actual visual inspection by using canonical theme tokens.
- Added missing-counter propagation and per-turn canonical/cumulative usage reconciliation. Context reflects the latest reported request rather than lifetime maximum. Claude cache writes without lifetime evidence remain unpriced. Thirteen Python tests now pass.
- Rejected 400/409/413 deliveries remain durable for repair and no longer block unrelated sessions; transient failures retain normal retry behavior. Added host diagnostics for pending/rejected delivery counts, discovery and parser state size, with ingestion validation and operator display. Latest health/UI/build checks are pending.
- A real request to the existing Qwen endpoint succeeded with thinking disabled. The synthetic failure fixture summary preserved the database error, unfinished repair and absence of deployment. No model or inference server was installed.
- J remains reachable and AgentPulse services active. m5 still fails with `No route to host`. J preview ingestion is next.

Remaining gaps still include all-host deployment and latency measurement, full parser-state bounds, native Fusion session reconciliation/task-detail reuse, recorded rate history and complete analytics/rankings, native feedback/control execution adapters, full historical import/reconciliation and the 24-hour dual-run/rollback gates. None of those gates is claimed complete.

J's bounded preview pass succeeded (43 Codex / 7 Claude on its first page, 199 discovered transcripts, 184 queued deliveries, zero reported parse/rejection errors). Its isolated spool is `~/.fusion/session-integration-preview/spool.sqlite`; the temporary loopback SSH tunnel closed after the pass. Updated m3 collection also persists discovery while offline, verified by a focused regression. Latest counts: 14 Python tests, 4 API/worker tests and 4 turn/cost tests pass; root lint and every static gate check pass. Core and dashboard builds pass. The remaining merge-gate lanes are still pending, so this checkpoint is not ready to merge.
