# Fusion AgentPulse integration progress

Session: **Fusion AgentPulse integration**. Updated 2026-09-15.
Worktree: `/Users/v/dev/fusion-worktrees/agentpulse-sessions`.
Branch: `codex/agentpulse-sessions`; plan baseline `801d03c84`; foundation `f435871bf`.

## Current checkpoint

- J authenticated comparison preview and independent m3/J collectors are running; provisional observation window began **2026-09-15 18:28 UTC**. Initial catch-up is incomplete and m5 is unreachable. The earlier m3 test preview retained 302 m3/293 J sessions at its last counted checkpoint.
- Historical audit: **70 of 95 source identities verified** (65 m3, 5 J). All **5,374 mapped source turns** delivered and reconciled: 5,319 exact normalized matches, 55 equal-or-newer native results, no missing/unexplained turns. Thirteen identities remain unresolved; twelve more source sessions are on m5.
- Implemented: PostgreSQL ingestion/history, host authentication, durable disk-backed collectors, Sessions UI/shared linked-task history, search, patches, model/context/cost cards, recorded/effective-dated and current-rate rankings, notes/archive metadata, durable commands, opt-in external feedback and verified Fusion CLI runtime control bridge, bounded Qwen summaries.
- Pending: real all-host managed launch/control verification and other native runtime backends; operator-selected retention; native-hook latency and real per-host control verification; remaining identities/m5; price-date comparison; production rollout, 24-hour dual run and rollback rehearsal.
- Branch only; latest implementation commit is `62deba2ca`. Push is blocked by unavailable GitHub credentials. AgentPulse services remain running; no main merge, release, model installation or new inference service.

## Verified deployment and source

- J: live source `/home/ubuntu/agent-panels/agentpulse`, clean at full commit `04f0dcf42d700f60ea3848326ba6d43da80c7a40`, origin https://github.com/flexi767/agentpulse.git. MIT, copyright 2026 Jay Stuart. Read actual shared telemetry/results contracts, observer, and Python turn parser before adapting.
- J: user services `agentpulse`, `agentpulse-supervisor`, `agentpulse-private-relay`, and `fusion-daemon` active. AgentPulse binds loopback 43120; private relay 43121. Fusion works from `/srv/scrapeui-dev`, PostgreSQL database `fusion`, port 4040 (reserved; untouched).
- m3: `~/.agentpulse/supervisor.js` and `relay.ts` running; independent durable AgentPulse queue forwards to J. Existing native sources include Codex desktop rollouts and Claude project JSONL. Credentials remain private.
- m5 remains unreachable. Snapshot recovery, source counts, the m3 summary endpoint and the real 20-file reference have since been verified; see the dated evidence below.
- Source inspection identifies search, channels/notifications, launch templates, workspace actions, feedback and AI inbox/gates beyond the initial session list. These need usage inventory and explicit replacement mapping before parity.

## Contract and ownership

Native Fusion feature: core owns PostgreSQL observations and normalized history; dashboard owns authenticated ingestion and presentation; isolated host collector reads native transcripts. No new live database. Observed identity is `(authenticated host, provider, native session id)`. No task enrollment, title/path matching, or inferred control privileges. Additive migration; feature gates keep production ingestion opt-in.

## Completed

- Foundation validator, host/provider identity, monotonic observation reconciliation, separate collector connectivity; five node tests in the first commit.
- Source/deployment verification above; no AgentPulse service or configuration changed.

## Plan workstreams

Dated checkpoints below record progress within these workstreams; the latest checkpoint supersedes earlier intermediate limitations.

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

## Search and usage slice (in progress)

The prior reliability slice is committed as `1cf594c2a`; push still fails for missing HTTPS credentials. New work adds an indexed PostgreSQL search over session metadata and collected history, with server-side host/provider/activity filtering and duplicate-free paginated matches. Six PostgreSQL tests now pass, including the new search and whole-session accounting cases. The accounting query reads usage only, separates unsupported/incomplete model groups, uses existing Fusion pricing/overrides, and refuses oversized partial rankings. The new UI adds date/host/model rankings and whole-session cost coverage alongside paginated history. Migration 0082 owns the search indexes. Latest typecheck/build/UI validation for this slice is pending.

## Gate and feedback checkpoint (2026-09-15, 17:14 local)

- All merge-gate lanes were run serially: engine 470 tests, PostgreSQL gate 9, core unit gate 203, CLI CI-shape 72; all passed. Static validators passed earlier. Latest search/control edits still require final lint/typecheck/build/boot verification.
- Added an opt-in Codex/Claude `additionalContext` feedback adapter with an independent, host-bound durable ledger and two-second network budget. Eighteen Python tests pass, covering retry, expiry, ambiguous crashes and both hook formats. It advertises feedback only. No provider settings were changed and no native feedback parity is claimed.
- Hardened command replay acknowledgements, generation checks, offline feedback capability display and host control allowlist checks. Two targeted PostgreSQL control/summary tests pass. Used stop/launch behavior still needs a verified replacement using Fusion-owned runtimes.
- Snapshot copied privately to m3 and its SHA-256 independently verified. Used-source inventory is now concrete: 4 launch requests; 4 managed sessions (3 stopped, 1 failed); 7 controls (3 successful prompt actions, 3 successful stop actions, 1 failed stop). Notifications/channels, alert rules/fires and inbox snoozes each have zero records. Six archived sessions still require preservation. This is evidence of stored use, not a claim that every possible feature was unused.
- Next: final browser/verification pass for search/usage, native identity audit and resumable real import, then remaining pricing history, retention/parser bounds, managed-session linking/controls and native-hook/24-hour parity verification.

## Real import findings (2026-09-15, 17:26 local)

- Verified 62 m3 native identities from actual provider files (51 Codex, 11 Claude), covering 4,776 source turn results. No host conflict was found. The source has another 17 sessions explicitly on J/m5 and 16 unresolved identities for this host-scoped audit (12 hostless, 4 m3 records without native evidence).
- Import bookkeeping now durably tracks unresolved identities while verified records advance; a changed audited map safely restarts an idempotent scan. Unresolved identities prevent a complete result. The first 62 session records and 573 historical turns reached the preview with no rejected deliveries.
- Sustained real backfill exposed the shared 600/minute mutation-IP limiter. The remaining spool survived the 429. Added authenticated per-host live/history limits using Fusion's existing limiter, separate from ordinary mutations. Collector `Retry-After` delays history while allowing new live updates. Nineteen limiter/API tests and twenty Python tests pass. Latest rebuild and replay are pending.
- Full serial `verify:fast` passed all 23 steps in 100.9 seconds before the limiter fix, including CLI build and real boot/health/shutdown. No production service, provider settings, release or default-branch merge was changed.


### Import liveness and rate isolation

Real backfill exposed two operator-visible invariants: bulk history must not consume dashboard/live-update rate budgets, and importing history must not make an offline collector appear connected. Both are now fixed. Migration 0083 permits an unknown live heartbeat for historical-only hosts. Credential probes authenticate without changing liveness. Seven PostgreSQL persistence/search/accounting/liveness tests and four ingestion/probe API tests pass; limiter tests passed at the prior checkpoint. Final lint has zero errors and four existing control-regex warnings. The latest serial build/boot verification is finishing.

Symptom verification surfaces: live and historical ingestion, credential probes, same-host and cross-host rate buckets, dashboard mutations, native-hook requests, durable retries, desktop/mobile connectivity labels, and historical-only hosts. Historical and live state remain separate, including null/empty/unreported states. No source path or process identity is used to infer control privileges.

## Reconciled history and search checkpoint (2026-09-15, 17:55 local)

- All 4,776 turn results belonging to the 62 verified m3 source identities are present. Hash comparison uses the same redaction/validation and project-relative normalization as ingestion: 4,754 exact matches, 22 equal-or-newer native results, zero missing and zero unexplained differences. Native replacements remain separately classified; this is not same-date price parity. The private reconciliation report is `.agent-intent/reconciliation-m3.json`.
- Real reconciliation found five older partial native results that wrongly blocked a newer complete imported result. Ingestion now chooses the newer turn timestamp across origins while keeping live observation state independent. Eight PostgreSQL tests pass, including both providers and both arrival orders; the five exact repairs were replayed through authenticated ingestion and acknowledged.
- The verified import spool is empty, with zero rejected deliveries. Sixteen unresolved identities remain durable (12 hostless, 4 m3 without native evidence); the overall migration is explicitly incomplete. The other 17 source sessions belong to J/m5 and were excluded from this host-scoped import.
- Native preview counts are now m3 200 (189 Codex, 11 Claude) and J 193 (130 Codex, 63 Claude). These are bounded discovery passes, not exhaustive-host parity. Both native queues drained without rejected records. AgentPulse continues unchanged on all hosts.
- Search and cost rankings verified in the actual browser at desktop and 390×844 mobile. The selected 30-day range displayed 4,820 collected turns across 70 sessions, with missing usage/unpriced coverage shown. Desktop page width remained 1,440 at a 1,440 viewport. Screenshots are private artifacts under `output/playwright/usage-{desktop,mobile}.png`.
- Final lint passed with zero errors/four control-regex warnings; serial `verify:fast` passed all 23 steps in 111.3 seconds after the rate/liveness fixes. The subsequent five-record reconciliation fix passed the eight-test PostgreSQL file and core build. All four merge-gate lanes (754 tests total) passed earlier; no flakes were observed or appeased.
- Remaining work: parser state/queue byte bounds and duplicate-event invariants; card model/context/cost; recorded/effective-dated rates and turn rankings; Fusion-native reconciliation/task-detail reuse; used managed launch/stop/prompt replacements; archived metadata and retention; remaining host identity/import audit; native hook validation and measured latency; m5 connectivity; 24-hour dual run and rollback rehearsal. No production cutover or retirement is authorized by this checkpoint.

## Card telemetry and collection bounds (2026-09-15, 18:08 local)

- Added server-batched whole-session cost/coverage on cards, plus provider-reported model, current context, capacity where reported, service tier and telemetry timestamp. Real Codex `token_count.info.model_context_window` was verified in native m3 data; Claude capacity remains unknown. Compaction may reduce current context, and a reported model change clears old context. Unknown/unsupported reported tiers stay unpriced.
- Collector v2 bounds each history state to 8 MiB, deliveries to 1.5 MB, and the durable queue to 128 MiB plus a 2 MiB live reserve/5,000 records. SQLite triggers maintain byte counts transactionally through inserts, coalescing and exact ACK deletes. Capacity failures roll back revisions/cursors; malformed complete records now pause instead of being silently skipped. Resource pauses are visible in collector health.
- History rotates independently from live discovery and charges failed/paused reads against its per-pass budget. Parser v1 state is safely re-read from native source on upgrade; server timestamp/revision fences prevent partial replay from replacing newer complete results. Large histories that exceed the per-file state limit still require state spilling; this remains a named limit, not claimed parity.
- Native ids deduplicate repeated prompts/tool completions/patches across both providers; identical steering with distinct native ids is preserved. File-change deduplication is turn-scoped. Regression surfaces include restarts, coalescing, partial/malformed records, byte limits, same/different turn ids, model changes, compacted context and unknown capacities.
- Verification: 25 Python tests, 6 observation tests, 8 PostgreSQL tests, 6 UI tests, 4 ingestion API tests and 3 pricing tests passed. Root lint has zero errors/four warnings. Serial `verify:fast` passed all 23 steps in 126.8 seconds. Real m3/J v2 passes and subsequent drains both report zero pending/rejected bytes, no parse errors and no resource pauses (300/299 discovered transcript files respectively). Desktop/mobile card output inspected in the browser.
- Branch checkpoint `6a71fdf8a` could not push: GitHub HTTPS credentials remain unavailable. m5 still returns `No route to host`. Existing AgentPulse services are active and untouched. No hook, inference service, production configuration, release or main merge was performed.

## Older-turn links, rankings and preserved archives (2026-09-15, 18:31 local)

- Added direct lookup and shareable links to older turns, including the real 20-file reference. Browser verification at 390 pixels found the linked turn in view with all 20 files and no horizontal overflow. The shared renderer includes per-turn cost disclosure. History response pages have an 8 MiB budget and keep a valid continuation cursor.
- Added individual-turn rankings using the same PostgreSQL usage aggregation, date/host/model filters and unknown-price rules as whole-session rankings. Large result sets refuse partial rankings instead of misrepresenting coverage.
- Migration 0084 preserves imported model, branch, timestamps, archived/pinned labels and reported session usage. Labels have a separate optimistic revision; import replay cannot overwrite operator edits. Reported snapshot totals remain separate from turn analytics. Archive/pin filters and an editable detail panel use existing UI primitives.
- Native directory audit found 78 Codex archived transcript files on m3 and verified three previously unresolved source identities there. Collector discovery now includes this actual native directory. Audited identities: m3 65/66 explicitly tagged source sessions; J all 5 tagged sessions. Missing evidence remains explicit.
- Replayed importer v4 metadata and the expanded map through authenticated ingestion. m3: 4,982 source turns, 4,959 exact matches, 23 equal-or-newer native results; J: 392 source turns, 360 exact matches, 32 equal-or-newer native results. Both spools are empty with zero rejections, missing turns or unexplained mismatches. J's one archived source session is visible in Fusion; five other source archives remain on m5/unresolved identities.
- Validation: 11 PostgreSQL tests, 9 UI tests and 25 Python tests pass. Root lint has zero errors/four control-regex warnings. Serial `verify:fast` passed all 23 steps in 209.1 seconds under peer memory load. Import bookkeeping now clears resolved identities across checkpoint-version upgrades; focused Python verification passed after that repair.
- Surface enumeration: both provider/native directory layouts, equal/replayed/out-of-order history, bounded pages and direct lookup, session/turn rankings, zero/missing/unknown usage, archive/pin concurrent edits and reimport, desktop/mobile shared cards/detail, and unchanged independent activity/connectivity/task lifecycle.

## Recorded rates checkpoint (2026-09-15, 18:57 local)

- Fusion now captures immutable, versioned rates at turn ingestion, separately from computed costs. Collector-supplied rate snapshots are ignored. Existing snapshots survive updated turn output and process recreation; corrected turn timestamps recheck applicability without rewriting the captured rate. A bounded settings read prevents a stalled pricing store from blocking acknowledgements indefinitely.
- Current-rate recalculation and recorded-rate estimates are separate choices in history and session/turn rankings. Effective UTC periods can be supplied through the existing pricing editor. Missing snapshots, unsupported tiers and out-of-period rates remain unpriced; undated captured rates explicitly disclose unknown historical applicability. Old imported history is not assigned fabricated historical rates.
- PostgreSQL aggregation groups rates across capture times and separates applicability, preserving bounded rankings. Eleven focused PostgreSQL tests pass, including mixed dates and immutable rate replay. Pricing unit tests (37), dashboard UI tests (18), pricing/ingestion route tests (5) passed; the four snapshot/cost unit tests passed again after the final timestamp/redaction edits.
- Root lint passed with zero errors/four existing control-regex warnings. Serial `verify:fast` passed all 23 steps in 177.7 seconds. Browser checks on the isolated preview show old history unpriced in recorded mode and a newly ingested synthetic turn with its rate version, capture date and category arithmetic. No production deployment or parity claim is implied.
- Surface enumeration: both provider pricing semantics, missing/invalid/source-unavailable prices, inclusive cache arithmetic, explicit periods, replay and corrected dates, SQL session/turn grouping, direct/older/current history pages, stale request responses, mobile/desktop shared renderer, and pricing settings accessibility. Existing task cost calculations retain their undated-rate behavior.

## Collector activity correction (2026-09-15)

Original symptom: late records for an older turn could switch parser attribution backward; Claude text/thinking records with `stop_reason: tool_use` could prematurely finish a turn, split steering prompts and display waiting while work continued.

Exact reproduction: behavioral native-shaped fixtures replay older Codex usage, file changes, completions and starts after a newer turn, and older Claude tool results after new user input. Claude fixtures cover text, thinking and tool blocks with missing, tool-use and terminal stop reasons. A read-only local native inventory found 3,416 text-only and 8,399 thinking-only assistant records with `tool_use`, confirming this is an actual transcript shape.

Assertion it is gone: explicit older-turn updates retain their history without changing the active turn; following unscoped output belongs to the current turn. Live Codex state ignores another turn's completion. Claude only finishes on an explicit terminal stop reason or its duration event. All 29 collector/import/feedback tests pass. Collector/parser v3 rereads native sources using independent durable revisions and existing server replay fences.

Surface enumeration: both providers; live and historical parsers; late usage, patches, completion and start events; Claude partial output, tool execution, steering, successful edits and terminal reasons. No provider hooks, services or external sessions were changed. Parser storage spilling/retention and full all-host parity remain pending.

## Parser storage and real replay checkpoint (2026-09-15, 19:07 local)

- Parser v4 now uses lazy SQLite maps for historical turns, requests, tool calls and deduplication records in the existing collector spool. It reads only touched records, uses an indexed per-turn request lookup, and drains changed-turn backlogs before reading more history. Cursor, revision, parser records and delivery commit atomically. Working state/single-turn requests remain capped at 8 MiB; retained parser payloads at 1 GiB/two million records. Limits pause without evicting unacknowledged data. Operator-selected historical retention remains unfinished.
- Thirty-four Python tests pass. New behavioral coverage processes both providers beyond a reduced memory budget, restarts mid-history, applies late updates to disk-backed turns, verifies cursor/backlog ordering and rolls back every durable surface when disk capacity is exhausted. Syntax compilation and diff checks passed. This Python-only slice does not require another dashboard rebuild; the preceding 23-step verification remains green.
- Real m3/J bounded passes upgraded their independent preview spools. Latest diagnostics: m3 392 discovered files, 2,248,507 bytes of parser state; J 344 files, 773,436 bytes. Both drained to zero pending/rejected deliveries and report no parse, delivery or capacity errors. These are discovery/pass diagnostics, not proof of full history coverage.
- J's expanded archived discovery exposed 15 actual HTTP 400 title rejections: 512 Python characters occupied 513 UTF-16 units. The shared enqueue boundary now normalizes title limits for live/history/import delivery; provider prompt/result/patch clipping also follows the server's UTF-16 bounds and preserves patch truncation indicators. Tests cover both providers and imported/live envelopes with astral characters.
- All 15 retained J deliveries were repaired and acknowledged. Original rejected bodies are preserved in a mode-600 J recovery artifact, and no unrelated queue rows were removed. AgentPulse and its supervisor remain active. m5 still reports `No route to host`; its current address was requested asynchronously.
- Remaining work includes task/native-session reconciliation and shared task-detail presentation, managed launch/stop/prompt bridges, native feedback/hook verification, explicit retention, remaining m5/unresolved imports, production deployment and the full 24-hour dual-run/rollback gates. No services were retired and no releases or main merges were performed.
- Local commits `27bab93bd` (recorded pricing) and `987e928d5` (activity attribution) are retained. Another push failed because HTTPS credentials are unavailable.

## Explicit task links and shared detail (2026-09-15, 19:27 local)

- Added project-scoped explicit session links with compare-and-swap revisions. A session cannot be moved to another task by stale writes; unlinking preserves its independent history. Collector/import input cannot create or replace links. Migration 0085 is additive.
- Task detail → Summary can search observed sessions, link/unlink a selected identity and display the same paginated prompt/result/patch/cost/notes renderer as Sessions. Only the opened history is fetched. Existing links are shown in session history; usage remains separate from task totals to avoid adding the same telemetry twice.
- Validation: 12 PostgreSQL persistence tests, 6 authenticated route tests and 8 history/link UI tests pass. Root lint passed with zero errors/four existing warnings. Serial `verify:fast` passed all 23 steps in 114.0 seconds. The subsequently changed project resolver passed 12 focused tests and a server TypeScript build; scoped lint was also run.
- Browser verification used one explicitly created synthetic preview task and the synthetic pricing session, with no engine or agent execution. Mobile 390px and desktop 1440px checks show linked shared history. UI unlink was followed by API verification: zero linked sessions, the independent session and its turn preserved, runtime capabilities still absent. Private screenshots remain under `output/playwright`.
- Original symptom found during this check: engine-free project requests opened a second default backend instead of the injected project-bound store. The shared resolver now reuses an exact matching PostgreSQL project scope when no manager owns its lifecycle. Reproduction/assertion tests cover HTTP, project context and realtime resolution, different project IDs and manager-owned recovery. Preview fixture setup was corrected to use a reserved test identity and the existing isolated database; failed empty bootstrap artifacts were moved under the private test directory. No additional database server remains running.
- Surface enumeration: global Sessions and embedded task detail; desktop/mobile; empty/search/multiple/linked/unlinked/conflicting identities; authenticated browser vs host-token requests; separate projects with equal task IDs; pagination and lazy history fetch; unlink/replay/restart persistence; no task lifecycle or runtime capability changes. Verified-native automatic reconciliation and managed controls remain next.


## Verified native runtime bridge (2026-09-15, 19:52 local)

- Fusion CLI Agent Executor runtimes now reconcile only live handles they own, using the authenticated host/provider/native identifier. The bridge records native runtime provenance and links a verified owning task; an explicit unlink survives later reconciliation. Existing collected activity/history stays authoritative. Duplicate native owners receive no controls, including duplicates beyond the bounded rotating work page.
- Independent owned sessions advertise feedback and stop. Task-owned sessions advertise feedback and link to the existing task controls. Expired Fusion runtimes expose no controls. External transcript discovery and imported runtime-looking metadata never grant ownership.
- Migration 0086 adds controller provenance and a durable execution fence. Commands commit `executing` before native side effects, check host/generation/expiry again, and cannot execute twice after an acknowledgement failure or ambiguous crash. An interrupted command is visibly unconfirmed. Reusing a CLI session record produces a fresh runtime generation.
- Native terminal injection now cancels before readiness or while waiting for quiet output, expires without a later write, and rejects if its process exits before delivery. Shutdown aborts pending injections. Applied feedback explicitly means bytes reached the owned terminal, separately from provider-hook context acknowledgement.
- Verification: 12 engine tests across three files (the final ten bridge/injection tests passed after bounded rotation); four PostgreSQL control/summary tests; ten linked-history/UI tests. Root lint: zero errors/four existing control-regex warnings. Serial `verify:fast`: all 23 steps passed in 126.9 seconds, including real boot smoke. The final small deadline/rotation changes passed their targeted tests; no real agent was launched.
- Surface enumeration: Codex/Claude owned and observed identities, duplicate/missing/native IDs, task-linked and independent sessions, explicit unlink, connected/disconnected runtime, current/reused generation, busy/ready/exited PTYs, cancellation/expiry/shutdown, acknowledgement failure, and global/embedded desktop/mobile control presentation.
- The source launch inventory is verified: all four used launch requests were managed Codex with `read-only` sandbox and approval policy `never`. Launch replacement is next; source resume/fork remains unimplemented upstream. This bridge currently covers Fusion's CLI Agent Executor, not every native backend. AgentPulse stays running, no production cutover or 24-hour parity claim.

## Managed launch slice (in progress, 2026-09-15, 20:12 local)

Native bridge committed as `c55c1969e`; push again failed because GitHub HTTPS credentials are unavailable. New managed-launch work remains uncommitted pending final verification.

- Migration 0087 and a host/project/runtime generation registry support durable, independent Codex launch requests. All four used AgentPulse requests selected read-only sandboxing and approval policy `never`; the adapter preserves those choices through Fusion's existing PTY manager. Installed m3 `codex-cli 0.141.0` help confirms both flags. No agent has been launched for validation.
- The authenticated Sessions panel selects an explicitly registered connected runtime, accepts a prompt and optional model, and shows queued/started/failed/cancelled/expired or interrupted-unconfirmed states. It retains the same request ID after uncertain network acceptance. Only queued work can be cancelled. Browser input cannot supply an executable, arguments, environment, arbitrary working directory, elevated posture or task enrollment.
- Execution commits its claim before spawn and never replays an ambiguous start. Queues are bounded per host; one worker runs one launch at a time. An overall 30-second deadline is checked after database/PTY preparation and before native spawn, and pending initial input cancels on shutdown. A failed acknowledgement cannot terminate or duplicate a successfully launched session.
- Source inspection found an existing native hook gap: Codex turn-complete notify was normalized as waiting and dropped its thread ID; hook URLs also appended a second question mark, losing project routing. The existing Codex mapper is now reused after session-token authentication, and generated hook URLs preserve the project query. Tests exercise both native script forms with a fake local curl (no networking), native ID spellings, unknown completion payloads, Claude notifications, wrong tokens and browser origins.
- Completed tests so far: four PostgreSQL launch tests, 31 engine tests and twelve dashboard UI/API tests. Core and engine builds passed. Root lint and full serial build/boot verification are running. m5 still returns `No route to host`; J's AgentPulse and supervisor services remain active.
- Limitations: this launch adapter covers explicitly configured Fusion CLI runtimes sharing the dashboard's PostgreSQL data layer. It is not a deployed remote collector execution path. Live per-host controls, other native backends, retention policy, unresolved/m5 migration, price-date comparison, production rollout and the 24-hour dual-run/rollback gate remain open. AgentPulse is unchanged.


### Managed launch verification complete (branch checkpoint)

- Root lint passed with zero errors/four existing control-regex warnings. Serial `verify:fast` passed all 25 steps in 116.4 seconds. The complete merge gate ran serially: engine 470 tests, PostgreSQL nine, core 203, CLI 72; all 754 passed, as did static validators.
- Desktop and 390×844 mobile browser checks verified the actual launch form, queue acknowledgement and cancellation. The synthetic request `1b353bb5-ec14-400b-a485-09492f834b39` is persisted as cancelled with no CLI session ID; the preview has no agent executor. Mobile document width was exactly 390 pixels. Screenshots: `output/playwright/launch-desktop.png` and `launch-mobile-open.png`. Existing engine-free preview banners/console errors remain unrelated; a clean console is not claimed.
- Native cleanup now preserves successful initial delivery if the process exits before its cleanup subscription. The focused four-test launch file passes after this final adjustment. The synthetic runtime heartbeat was removed and launch/control flags disabled in the private preview; no production runtime or provider hook settings changed.
- Surface enumeration: feature-disabled/no-runtime/disconnected states; explicit host/project/model selection; empty/populated/oversized input; unknown input privilege fields; duplicate, rejected and uncertain acceptance; queued-only cancellation; generation replacement, expiry, shutdown and lost acknowledgements; task-independent launch; both native hook forms/project routing; all Codex native ID spellings and Claude notifications; desktop/mobile forms and recent-state presentation.

Final launch cleanup verification: engine rebuild and scoped lint passed; the CLI bundle was rebuilt successfully for the exact final source. The preview retained the cancelled request as audit evidence.


## J comparison deployment and observation window (2026-09-15, 20:28 local)

- The verified branch implementation is committed as `62deba2ca`. Push failed again for unavailable GitHub HTTPS credentials; all commits remain local. No merge or release occurred.
- An isolated authenticated comparison server now runs on J from the exact branch source, bundled into `/home/ubuntu/.fusion/session-integration-preview/server-62deba2ca/dist/server.mjs`. It uses a separate preview-only PostgreSQL database/role `fusion_ap_preview_20260915` in J's existing PostgreSQL 18 cluster, and explicit private project/global directories. Production Fusion and AgentPulse databases/configuration are unchanged. This is temporary comparison infrastructure, not a second production datastore.
- J service: `fusion-agentpulse-preview.service`, bound only to `127.0.0.1:60834`, memory capped at 1536 MiB and CPU at one core. Engine, launches, controls and summaries are disabled. Sessions authentication was verified: dashboard token returns 200; unauthenticated requests return 401; the host-scoped credential probe returns the correct host. Private credentials are mode 600 and are not recorded here.
- Frozen independent collectors use `comparison-collector-62deba2ca`, with new `comparison-spool.sqlite` files separate from AgentPulse and the earlier m3 preview spools. J runs `fusion-session-collector-preview.service` (512 MiB/50% CPU cap). m3 uses launchd jobs `com.runfusion.agentpulse-comparison-collector` and `com.runfusion.agentpulse-comparison-tunnel`; the latter forwards m3 loopback 60835 to J loopback 60834 through a dedicated non-multiplexed SSH connection. No provider settings or agent processes were changed.
- Initial deployment mistakenly supplied the collector route rather than its server-base URL; both collectors retained their queues through HTTP retries. The private unit/job URLs were corrected and only those new collectors restarted. At **2026-09-15 18:28:10 UTC**, both had current successful acknowledgements, zero rejected deliveries, no parse/delivery errors and no capacity pauses. The provisional observation window starts here; its 24-hour duration is not yet satisfied.
- Initial ongoing catch-up: J discovered 1,299 native transcript files, m3 763. Database counts at that checkpoint were J 250 sessions (187 Codex/63 Claude), m3 150 (139 Codex/11 Claude), with historical turns still queued behind initial live discovery. Spools contained J 1,265 pending/2,537,195 bytes and m3 1,154 pending/19,578,327 bytes. These are initial rotating-pass counts, not exhaustive history or parity. Earlier 5,374-turn source reconciliation remains in the separate m3 test preview and must be replayed/reconciled against this J preview.
- AgentPulse and its supervisor remain active on J. m5 remains unreachable. Remaining gates include all-host/native-hook/control verification, history catch-up and replay, retention controls, same-date price comparison, measured latency, restart/outage/rollback rehearsal and at least 24 hours of observation. This checkpoint is not cutover or retirement approval.
- Rollback of this preview is bounded to its own service names: stop/disable `fusion-session-collector-preview` and `fusion-agentpulse-preview` on J, and boot out the two named m3 launchd jobs. Keep their spools/configuration for investigation. Do not replay accepted controls (controls are disabled), delete the AgentPulse snapshot, or stop the existing AgentPulse services.

The J preview archive SHA-256 matches on m3 and J: `5ae63536f09f793460c21aab41be245c2a415931b8d67944b2b23c9ce98b54ea`. At the deployment check, server RSS accounting was approximately 303 MB and the J collector 212 MB, within their unit limits.


## Same-rate accounting audit and provider selection (2026-09-15)

The [accounting comparison](agentpulse-accounting-comparison.md) now records all 5,374 mapped source turns. Of 5,351 model groups, 3,595 reconcile exactly under identical supplied rates, with zero arithmetic discrepancies. Baseline differences are documented separately. The audit identifies a used-feature gap: 1,560 Claude groups report one-hour cache writes; 951 also report long context. Explicit configured rates for those surfaces are the next pricing work, rather than guessed multipliers.

Original symptom: an exact OpenAI override could win over a different exact Codex override for observed Codex sessions. Reproduction supplies conflicting OpenAI/Codex rates in both insertion orders; the assertion checks current costs and newly captured immutable rates. Both provider branches pass, old captured snapshots stay unchanged, and unknown/unreported cases remain covered. The focused five-test cost suite and core build pass. Current/history/card/ranking calculations all use the shared pricing function; ingestion capture uses the corrected provider selection as well.

## Initial-discovery pressure repair (collector v5)

J's wider native scan reached 6,002 transcript files and 3,450 stored sessions while its durable queue approached 5,000 records. At that point J had zero rejected deliveries or parse errors, but correctly reported a capacity pause. The m3 collector had 760 sessions and continued advancing. These remain rotating discovery counts, not exhaustive coverage.

Original symptoms: unchanged transcripts lacking telemetry were re-enqueued because the live skip guard required telemetry to exist; all old discovery snapshots also shared live priority and could occupy the entire record budget. Exact reproduction uses both provider shapes without usage, repeated unchanged/partial-line scans, and a filled background queue followed by fresh native events. Assertions prove stable live revision/cursor on unchanged input, independent fresh-event reserve, newest fresh event delivered first, atomic cold-to-live coalescing, restart preservation and non-destructive priority ageing. All 36 Python tests pass.

Collector v5 adds a live-parser version checkpoint, distinct from the unchanged v4 historical ledger, and reserves 500 queue records plus 2 MiB for fresh native updates. Older discovery/backfill pauses before consuming that reserve. No pending row, parser history or AgentPulse cursor is evicted. The comparison collectors will be upgraded with their existing spools; the J server remains the isolated build described above.


### Collector v5 deployed (2026-09-15 18:42 UTC)

Both comparison collectors now report `fusion-native-5` and successful acknowledgements after restarting with their original spools. Frozen code lives in `comparison-collector-v5-885de68fc` on each host. J held 6,600 sessions (6,537 Codex/63 Claude), m3 760 (744 Codex/16 Claude), and the J preview held 2,557 historical turns at this checkpoint. Discovery/backfill continues.

Both background queues correctly pause around the 4,500-record budget with zero rejected deliveries or parsing/delivery errors. The m3 queue simultaneously retained three fresh-priority updates in the reserved capacity. This is an expected backfill capacity signal, not a completed catch-up claim. AgentPulse, its supervisor, the preview server and J comparison collector were all active. The preview server still runs the frozen `62deba2ca` bundle; later source changes will be deployed deliberately.


## Explicit cache lifetime and context pricing (2026-09-15)

- Both native providers now price one-hour cache writes separately from five-minute writes, and long-context usage only from an explicitly configured band. Unknown service tiers, missing lifetimes/rates and inconsistent counters remain unpriced. No provider price or multiplier was invented or copied into the production baseline.
- New immutable rate snapshots identify their selected context band and capture only that band's rates, provenance and applicability interval. Existing snapshots are unchanged; old long-context snapshots without an explicit band stay unpriced. Current repricing remains separate from recorded estimates.
- All **5,155 source-priced groups** in the 5,374-turn audited cohort now reconcile under identical supplied AgentPulse rates with **zero arithmetic differences**. The [accounting report](agentpulse-accounting-comparison.md) distinguishes arithmetic coverage from missing or differently dated baseline rates.
- The existing advanced Model Pricing editor supports optional one-hour rates and explicit editable long-context bands. Browser inspection exposed a cramped Source-column layout; expanded fields now span the row below standard prices, with a wider desktop dialog and a single-column mobile layout. The shared history renderer identifies long-context charges and both cache categories.
- Surface enumeration: Codex/Claude, standard/long bands, known/unknown/invalid cache counters, current/recorded/legacy snapshots, explicit date periods, immutable replay, session/turn SQL aggregation, cards and shared global/task history, new/existing/deleted pricing rows, desktop/mobile, keyboard typing and DOM identity. SQL grouping prevents a valid row from masking an inconsistent one-hour counter in another row.
- Verification: 39 core unit tests, 13 PostgreSQL ingestion/analytics tests, 14 dashboard UI tests; root lint zero errors/four existing warnings. Serial `verify:fast` passed all 25 steps in 220.7 seconds; all 754 merge-gate tests and static validators passed. The final layout adjustment passed the 14 UI tests, scoped lint and client build again. Desktop and 390×844 mobile forms were visually checked; mobile content width equals its 390-pixel viewport. The shared header description wraps, fields retain keyboard focus, and no synthetic price was saved.
- Operational checkpoint: all 392 mapped J source turns replayed into the isolated J comparison database: 360 exact matches, 32 newer native results, zero missing or unexplained differences; five J metadata records imported and its queue drained without rejects. m3 replay remains in progress in a separate new spool. Twelve hostless identities remain unresolved for J; this is not full source parity.
- Preliminary latest-snapshot latency sample after 18:28 UTC: m3 24 samples, p95 16.40s; J four samples, p95 5.88s. These are latest revisions rather than every delivery, exclude older catch-up records and are insufficient to close the latency/24-hour gates. No hook latency or cutover claim.
- Next work includes protecting explicit pricing bands during refresh, history retention controls, completed m3/J comparison reconciliation, measured collector delivery lag, outage/restart/rollback rehearsal, native-hook and other-runtime controls, m5 access and the remaining unresolved identities. AgentPulse remains active; nothing has been released or merged into main.


## Pricing refresh protection and stricter reconciliation (2026-09-15 19:18 UTC)

Pricing bands committed as `472c6c232`; push failed again (`could not read Username for https://github.com`, terminal prompts disabled). The local branch and commits are retained.

- Standard pricing refresh now preserves a complete existing row when it has an explicit one-hour rate, long-context band or effective period, including its original provenance. Ordinary rows still refresh and new models are added. The result reports updated and preserved counts separately. Three narrow refresh/route tests, ten pricing UI tests, scoped lint, dashboard app typecheck, server TypeScript build and client build pass.
- Both fresh comparison import spools have drained: 4,982 m3 source turns and 392 J source turns, plus all 70 mapped metadata records. Neither queue contains rejected records. m5 and 13 unresolved source identities remain outside the mapped cohort.
- A stricter content comparison separates provenance, absent/null service-tier representation, equal timestamps and genuinely newer timestamps. J has 361 normalized exact matches, three later native turns and 28 equal-timestamp turns with the native reported service tier added. m3 has 4,497 normalized exact matches, 22 later native turns and 463 equal-timestamp differences. Of those, 460 concern current context and/or reported service tier; three require further investigation. One of the three is a usage-band ordering difference; two show substantive attribution differences in a resumed Claude transcript.
- **Parity is not closed.** The earlier coarse “newer native” classifier included equal timestamps and was insufficient evidence of content parity. Investigation now targets repeated Claude history after resume: an old completion was attributed to a later turn, and some prompt/tool/usage records may be assigned to the wrong turn. Native transcript evidence and bounded regression fixtures are the next work. No discrepancy is silently accepted or repaired by inventing timestamps.
- At 19:14 UTC, J's native queue was 1,871 records (~10 MB), m3's 1,305 (~8.9 MB), both version 5 with current heartbeats and zero parse/delivery/rejection errors. J no longer reported capacity pressure; m3 retained a per-file capacity flag. The frozen J server remains `62deba2ca`; later pricing/refresh source has not yet been deployed there. AgentPulse remains active.


## Resumed Claude replay correction (collector v6, implementation verified)

- Actual evidence: the 54,462,838-byte resumed Claude transcript contained 6,103 duplicated native event IDs, some appearing four times. Replayed assistant records were assigned to the current turn, which could inflate its usage and set a completion before its prompt. The ported upstream parser also lacked native event ownership; the replacement is verified against actual transcript records rather than assumed source behavior.
- Collector v6 persists Claude event/request ownership, uses native parent links for delayed completions/tool results, and keeps changed request snapshots on their original turn. Exact replay does not rewind the active turn. Output/completion updates respect native time; partial usage snapshots preserve known counters, context band and provider metadata. Current context is ordered by request timestamps and may still shrink between requests.
- Surface enumeration: both provider suites; Claude fresh/resumed/duplicated/changed native IDs, delayed parents, partial usage, tool results, steering and explicit completions; SQLite restart/checkpoint persistence; bounded ledger generations; active/new/old turn isolation; per-request pricing bands and current context. Codex remains on parser v4; only Claude upgrades to parser v5, preserving live cursors and delivery revisions.
- Forty Python regressions pass (0.385s). The actual resumed file replayed through the durable bounded collector in 68 passes: 128 turns, zero completion-before-prompt cases, zero parse/rejection/capacity errors, ~4.1 MB parser state and an empty verification spool. Final normalized responses for the two substantive comparison turns match the snapshot. Native replay corrects the later turn's completion and usage attribution.
- The earlier snapshot turn `719350d3-3fe7-47b0-8554-e76002302fbc` had already combined unrelated work upstream. Its native time interval contains 17 repeated message records but only six unique native events: one prompt, three requests and two tools. The snapshot stored five prompts and 39 tools. All four extra prompts were located in their own corrected turns; they are retained, not discarded to force matching totals. The separate usage-band ordering difference is presentation order, not arithmetic.
- v6 is not yet deployed at this checkpoint. Next: freeze and install it into the two existing comparison collectors with spools intact, verify corrected PostgreSQL results and update the reconciliation report. Remaining retention, full delivery-lag instrumentation, outage/restart/rollback and all-host/24-hour gates remain open. AgentPulse stays active; no releases, main merge or retirement.


## v6 rollout and opaque-record recovery (2026-09-15)

- Both existing comparison collectors now run frozen `cb6fb7ae0` (v6) with original spools. Their `collector.py` SHA-256 matches: `fae2018679b99cfca8fd3e69c54ca5f59b90a95f3b7c7028e4f027f7dcd03d86`. J's preview server, AgentPulse and its supervisor remained active throughout. GitHub push still fails because HTTPS credentials are unavailable.
- The resumed Claude file continued growing during inspection. A fixed, complete-line prefix was preserved at 19:28:21 UTC: **66,833,948 bytes**, SHA-256 **`18f7c19ebe79e23ca63826bf5d2b9d9d4c1a9546926ef093592cc85554932a50`**. Replaying that fixed snapshot confirms 128 turns and zero completion-before-prompt cases. The earlier 54 MB figure described its initial size, not the final frozen verification input.
- Wider catch-up exposed four safely paused Codex records: three ~4.5 MB compaction snapshots and one ~7.8 MB raw tool-output record containing images. These record types have no turn-parser effect at ordinary sizes. Collector v7 recognizes their actual canonical header, including `ordinal`, and persists bounded framing progress through oversized bodies. Unknown/actionable oversized records remain paused, and no main cursor crosses an incomplete record.
- Verification against a consistent copy of the real m3 spool advanced all four paused offsets, including `20,067,730 → 27,910,443` for the image-bearing tool output. The copied checkpoint then had zero parse/rejection/capacity errors. No production/native source record was edited or discarded.
- One J delivery was retained as HTTP 400 because a patch contained an embedded NUL. v7 represents NUL visibly as `␀`, preserves patch counts and event identity, and retries only the changed display-normalization rejection. Other rejected records remain parked. Forty-five Python tests cover both providers, canonical/unknown oversized types, following prompts, partial lines, restart and exact acknowledgement/repair identity.
- v7 is verified in source and the copied checkpoint; deployment and PostgreSQL reconciliation are next. The J server is still the frozen `62deba2ca` build. All-host, retention, full latency, outage/rollback and 24-hour gates remain open; AgentPulse is not retired.


## v7 deployed; native parser upgrade contract in verification

- Frozen `46ccd4b5c` (collector v7) is now running in both existing comparison jobs. J's original rejected NUL-bearing envelope was saved privately before restart; its repaired delivery retained the event ID and was acknowledged. At **19:45 UTC**, both hosts reported zero queued/rejected records, parse errors, delivery errors and capacity pauses. J discovered 8,132 transcripts and m3 766. Empty spools do not mean every historical byte has been parsed; bounded history cursors continue advancing.
- Database verification found a second-order repair issue: incorrect earlier parser output could itself have a later `updatedAt`, so timestamp ordering blocked a corrected earlier result. The next server version records an explicit native parser generation. A higher generation with a higher durable observation revision may correct earlier native output; same-generation older timestamps, lower revisions and parser downgrades remain refused. Historical imports cannot claim this generation or be replaced merely by a native upgrade.
- Collector v8 will republish existing Claude turns in batches of 25, with a durable keyset cursor, before continuing file reads. It preserves native file offsets and does not reparse all Codex history. Deploy the updated server **before** v8 so these generation markers are recorded. No server/collector change has yet been made for this contract.
- Focused verification so far: 15 PostgreSQL ingestion/analytics tests and 46 Python collector tests pass, including bounded republish across SQLite restart. Build/gate verification is next. The isolated J server still runs `62deba2ca`; AgentPulse remains active and no cutover is claimed.


### Native correction generation verification complete

The v8 contract passed 15 PostgreSQL integration tests, eight turn/pricing unit tests, 46 Python collector tests and scoped lint. Serial `verify:fast` passed all 25 steps in 210.0 seconds; the serial merge gate passed all 754 tests and static validators. The deployment order remains server first, then collectors with their original spools.


## Native correction rollout and durable delivery lag

- Isolated J server and both comparison collectors now run frozen `4858a8213` (collector v8). The archive hash matches `9d31909afa56970730fe34464779d61f82ffcd07b33b5e4819498ce27741af9b`. Only the preview server executable path changed; its original configuration, preview database and both collector spools remain in place. Unauthenticated/authenticated checks returned 401/200. AgentPulse and its supervisor remain active. GitHub push still fails for unavailable HTTPS credentials.
- The next collector version retains up to 10,000 content-free live acknowledgement samples, bounded to a rolling 24-hour diagnostics window. Original live eligibility survives ageing, outages and restart. Exact-ACK deletion and sampling commit together; superseded snapshots, cold discovery and history are excluded. Negative clock skew is visible and omitted from latency percentiles.
- Symptom verification: a fresh update queued through a simulated outage and SQLite restart records the entire 601-second native-event-to-ACK delay; mismatched ACKs and a replaced in-flight snapshot do not create samples. Surface enumeration covers both shared provider delivery paths, cold/live/history, fresh/aged/rejected/empty queues, coalescing, retries, rollback clocks, restart, sample-cap/age pruning, route validation and the shared desktop/mobile health display. Fifty Python tests, seven route tests and eight UI tests pass; build/lint and deployed measurements remain next.


### Delivery lag verification complete

Scoped lint, all 25 serial verification steps (77.7 seconds), all 754 serial gate tests and static checks pass. Desktop (1440px) and mobile (390px) health displays were visually inspected with explicitly synthetic metrics in the separate m3 test preview; mobile content width remained 390px. Existing engine/provider/allocator fixture banners remain unrelated preview limitations. Screenshots are local ignored artifacts under `output/playwright/delivery-lag-*.png`. The real J comparison database received no synthetic latency values.

Fresh v8 mapped reconciliation: J 358 normalized exact, six later native and 28 equal-time service-tier additions; m3 4,483 exact, 30 later native and 469 equal-time differences. No mapped turns are missing. Eight equal-time differences need attribution explanation: the previously verified combined Claude turn plus seven earlier prompts wrongly included in later snapshot turns. All seven prompts exist in earlier stored turns; two native files were directly checked, and remaining native checks are pending. Generation 5 corrected both known substantive turns in PostgreSQL, including `b64070e5-76d8-4ff0-b130-5af9dde9732e` at `2026-09-11T13:31:32.843Z` with 19 tools. This is not full parity: later-native comparisons, all-host access, retention, measured outage/rollback and 24-hour observation remain open.
