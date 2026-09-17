# External session ingestion — PR1

This increment provides a provider-neutral observation contract, additive central PostgreSQL storage, authenticated ingestion, durable replay acknowledgements, collector heartbeat reporting and paginated API reads. It does not complete phase 1 of [the integration plan](agentpulse-integration-plan.md): collectors, a Sessions view and verified native-session reconciliation still require subsequent PRs. Observations never create or schedule tasks, register runtime handles, or authorize controls.

Ownership follows Fusion's native core domain/storage and dashboard registrar architecture. No AgentPulse source or parser is copied. The separate `codex/agentpulse-sessions` worktree was read as implementation evidence only; its schema, spool and endpoints are not compatible with this contract.

## Configuration and access

Both ingestion and reads are off unless `FUSION_EXTERNAL_SESSION_INGESTION=1`. Configure `FUSION_EXTERNAL_SESSION_COLLECTORS` as a JSON object mapping stable host identifiers to unique random bearer credentials (32–512 URL-safe characters). Store it in the serving process's protected environment/secret configuration; never commit it or put credentials in query strings. Maximum: 100 hosts. Invalid configuration or duplicate credentials denies all collector access. Removing a host's credential revokes it immediately for subsequent requests.

Only exact `POST /api/external-sessions/ingest` bypasses daemon authentication; the registrar independently checks the host credential, even with `--no-auth`. Origin, Fetch Metadata and cookie-bearing collector requests are refused. A host credential cannot read session or collector data. Session reads require a request verified by Fusion's daemon/remote-session authentication; they also fail closed in no-auth mode. Existing authenticated dashboard users have global session metadata access, consistent with central registry administration. Per-project session access rules remain a prerequisite before granting narrower users access.

## Version 1 delivery

Send `Content-Type: application/json` and `Authorization: Bearer <host credential>`. Fusion's existing JSON parser bounds the body to 100 KiB. Unknown fields are rejected, including claimed host/task/run/runtime identifiers. One envelope contains one observation or heartbeat:

```json
{
  "version": 1,
  "eventId": "unique-event-1",
  "streamId": "durable-spool-1",
  "sequence": 1,
  "collectorVersion": "1.0.0",
  "kind": "observation",
  "observation": {
    "provider": "codex",
    "nativeSessionId": "native-session-id",
    "revision": 1,
    "observedAt": "2026-09-17T00:00:00.000Z",
    "activity": "working",
    "title": "Inspect repository",
    "projectPath": "/workspace/repository",
    "capabilities": []
  }
}
```

Providers are open, case-sensitive identifiers, allowing Codex, Claude and future adapters. Host identity comes only from authentication. A session identity is the SHA-256 of the JSON tuple `(host, provider, nativeSessionId)`. Project paths are metadata, never proof of task or project ownership, and are never used to read host files. Titles and paths use Fusion's existing secret redactor before persistence. Collectors must still sanitize metadata before sending it; redaction is best effort. Native IDs must be opaque identifiers, never credentials.

`projectPath` may be `null` to represent unknown. All other observation fields are required. Activity is `working`, `waiting`, `completed` or `error`. `observedAt` uses canonical UTC ISO timestamps with millisecond precision. Revisions and sequences are nonnegative/positive safe integers respectively. Capabilities may report `send-feedback`, `stop`, `resume`; they remain informational and grant no control authority. Transcript/turn/patch/usage payloads and task links are outside this contract.

For a heartbeat use `kind: "heartbeat"` and omit `observation`. Every unique heartbeat occupies a sequence/event position like an observation. Connectivity uses the server receipt time of a fresh explicit heartbeat (connected for 90 seconds), separately from the observation's activity. Replaying an old heartbeat never freshens connectivity. A newer revision is authoritative even if the collector's clock differs; synchronize host clocks before using observation timestamps for latency measurements.

## Acknowledgements and replay

Maintain a durable spool per authenticated host, with a persistent stream ID, event IDs and contiguous sequence starting at 1. Serialize delivery within that stream. The observation revision belongs to the native session and must persist across spool/collector restarts and stream rotation. A new spool starts a new stream; it must not reset session revisions. Canonical parsing makes JSON key/capability order irrelevant.

The server returns HTTP 200 only after the snapshot, receipt, stream cursor and collector metadata commit together. Example:

```json
{
  "hostId": "m3",
  "eventId": "unique-event-1",
  "streamId": "durable-spool-1",
  "sequence": 1,
  "acknowledged": true,
  "sessionId": "<64-character-session-id>",
  "outcome": "applied"
}
```

Validate host/event/stream/sequence against the queued envelope before advancing the local acknowledgement. A lost HTTP response is recovered by retrying the same event, returning its original durable acknowledgement without changing state or receipt time. The acknowledgement sequence is that event's position, not a claim about another pending event. Event IDs cannot be reused with different content or in another stream. Gaps, reused sequence positions and changed content at the same session revision return 409 and advance nothing. Repair the spool ordering; do not discard unacknowledged entries or silently mint replacement IDs for conflicts.

An older session revision is committed with outcome `stale`; an identical revision with outcome `unchanged`. Both are successful delivery acknowledgements and preserve the newer snapshot. Fresh heartbeats return `heartbeat` with `sessionId: null`. A host transaction advisory lock serializes observations across concurrent streams and retries, including multiple Fusion processes. Database failures/capacity limits return 503 without acknowledgement; retry with bounded backoff. Validation/auth/browser failures return 400/401/403, disabled ingestion returns 404, oversized JSON returns 413. Retain failed records for operator review.

Storage is bounded per host to 1,000,000 accepted envelopes, 10,000 distinct sessions and 100 spool streams. The 101st stream, 10,001st session or 1,000,001st delivery is refused without acknowledgement. Already accepted replay remains available at capacity. Auth configuration bounds the active host cohort, but rotating host identities must be operator-controlled. PR1 intentionally does not prune receipts: pruning without a coordinated collector replay floor would break idempotency. Monitor capacity and disk usage; sustained production ingestion requires the retention/checkpoint follow-up. Do not delete rows or reset counters to bypass limits.

## Read API

- `GET /api/external-sessions?hostId=m3&provider=codex&limit=50&after=<id>` returns `{ sessions, nextCursor }`. Limit 1–100; ascending immutable identity order. Pass `nextCursor` as `after` with the same filters. This is history pagination, not a live event cursor or a consistent snapshot of concurrent new sessions. Start a fresh listing to observe earlier-sorting new identities.
- `GET /api/external-sessions/collectors` returns up to 100 collectors with separate connectivity, last heartbeat, last acknowledgement and capacity counters. Revoked hosts retain history and may be disconnected. More than 100 historical hosts requires the collector pagination follow-up; do not treat this bounded list as a complete fleet inventory then.

## Server J deployment prerequisites

No J deployment, release, merge, service restart or SSH audit was performed for this PR. Prototype progress notes describe a separate comparison server/database with migrations 0079–0087; those notes are historical evidence, not verification of J's current state.

Before an operator deploys this increment:

1. Identify the exact serving Fusion instance on J: executable/artifact SHA, launcher/service, owner, port, environment source, central registry and database target. Distinguish the normal main-based instance from the AgentPulse comparison preview. Preserve all prototype configuration, DB and spools; never point this binary at that preview database.
2. Read `public.fusion_schema_migrations` in the intended target. This binary knows through **0079**; its additive **0079_external_session_ingestion.sql** follows main base **801d03c846889c86292a3d5482ab10994ca9edca** (0078 ceiling). A database containing a different migration recorded as 0079, or any version above 0079, is incompatible. Existing prototype migration 0079 is a different migration. Require a separately reviewed forward migration/data conversion and ceiling alignment before adopting prototype data. Never rewrite/delete its ledger to make this binary boot.
3. Take a supported, consistent backup of the target PostgreSQL database, its roles/permissions and Fusion configuration. Record backup identity, schema versions and restore procedure, and rehearse recovery against an isolated restore. Preserve AgentPulse's supported snapshot/configuration and independent spool acknowledgements. Do not use a live raw file copy of PostgreSQL as the backup.
4. Build the exact reviewed checkpoint with Fusion's pinned pnpm/Node conventions (Node >=22.5), including core/server and bundled CLI artifacts and migration SQL. Run required lint, typecheck, build, boot smoke and merge gate serially, plus the focused ingestion tests against real isolated PostgreSQL. A skipped PostgreSQL suite is not durability evidence. Deployment requires all these checks, not merely unit-test success.
5. Confirm the schema migration connection can apply DDL and acquire transaction advisory locks. Confirm runtime credentials have central table SELECT/INSERT/UPDATE access and receipt insertion access; existing default privileges depend on migration-role ownership. Verify multi-project topology routes central reads/writes to the same intended DB; PR1 uses `centralCore.asyncLayer`, falling back to the launch store layer for a single central-less instance. External per-project databases require centralCore wiring before enablement.
6. Prepare stable host IDs and unique collector credentials for m3, m5 and J. Confirm HTTPS/private transport, reverse-proxy body limits, daemon dashboard authentication and operator-only session metadata access. Leave the ingestion flag off for initial installation/migration and verify existing health/dashboard behavior. No collector or AgentPulse service change is part of PR1.
7. Enable only an explicitly approved bounded comparison after the collector follow-up implements this contract. Exercise fresh Codex/Claude observations per available host, lost-response replay, duplicate/gap/conflict rejection, offline/reconnect, server restart recovery, heartbeat expiry and capacity monitoring. Keep Fusion and AgentPulse spool acknowledgements independent. Measure the plan's latency targets; PR1 claims no all-host visibility, latency or parity gate.

Port 4040 remains reserved. A local boot test uses an ephemeral free port. Deployment/service commands depend on the verified launcher and are intentionally not guessed here.

## Focused validation

Run these serially in the isolated worktree with installed workspace dependencies:

```sh
pnpm --filter @fusion/core exec vitest run src/__tests__/external-session-contract.test.ts src/__tests__/migration-wiring-integrity.test.ts src/__tests__/postgres/schema-applier.test.ts --maxWorkers=1 --silent=passed-only --reporter=dot
pnpm --filter @fusion/core exec vitest run --config vitest.pg.config.ts src/__tests__/postgres/external-session-ingestion.pg.test.ts --maxWorkers=1 --silent=passed-only --reporter=dot
pnpm --filter @fusion/dashboard exec vitest run --project dashboard-api-quality --project dashboard-api-quality-backfill src/routes/__tests__/external-session-ingestion.test.ts src/routes/__tests__/create-api-routes-mount-order.test.ts src/__tests__/auth-middleware.test.ts --maxWorkers=1 --silent=passed-only --reporter=dot
```

The PostgreSQL command needs an accessible isolated test server and database-creation privileges through `FUSION_PG_TEST_URL_BASE`. It uses Fusion's shared harness, creates only harness-owned test databases and skips if the TCP reachability probe fails. Confirm all 12 ingestion tests actually execute. For serial artifact bootstrap set `npm_config_workspace_concurrency=1`; `FUSION_VERIFY_FAST_SERIAL=1` alone does not limit pnpm's nested workspace builds. `verify:fast` resolves committed diffs, so an uncommitted patch also needs explicit changed-package typechecks/builds.

## Rollback prerequisites

The operational rollback is to pause only Fusion-bound collectors, preserve every spool/acknowledgement, disable `FUSION_EXTERNAL_SESSION_INGESTION`, revoke collector credentials as needed and return the primary entry point to the prior dashboard. An operator applies process environment changes through the verified launcher; PR1 performs no restart. Leave the additive tables/data intact. There are no command queues in PR1 and no accepted controls to replay.

Disabling the flag does **not** downgrade the schema. A pre-0079 Fusion binary refuses a database already marked 0079 (`StaleBinarySchemaError`). Keep the schema-compatible PR1 binary with ingestion disabled, or use a separately reviewed schema-compatible rollback build. If an actual binary/schema downgrade is unavoidable, stop writers under an approved maintenance window and restore the complete pre-upgrade database/configuration from the rehearsed backup, acknowledging all post-backup data loss. A ledger deletion alone is not a rollback. Before any later re-enable, reconcile retained Fusion spool acknowledgements against the restored receipts; an acknowledged record missing after restore needs an explicit recovery/import process.

## Remaining bounded PRs

The prototype's `docs/agentpulse-feature-checklist.md` at checkpoint `9c7797a91` was inspected for phase 0 evidence. Its snapshot reports turns, cost metadata, archived sessions, managed launches, feedback/stop requests and a read-only Ask thread. It also records successful idle wakes consistent with an unconfigured no-op watcher. Those observations were not re-audited on J in PR1; zero stored records do not establish that a UI feature is unused. The follow-up assignments below preserve the inventory without claiming that prototype replacements exist on this branch:

| Inventoried surface | Fusion reuse / follow-up assignment |
| --- | --- |
| Cross-host session identity/activity | PR1 storage/auth plus collector and Sessions/reconciliation PRs 1–2 below |
| Prompt/result/tool/duration/patch history | PR3; reuse shared task/session presentation |
| Context, usage, prices and rankings | PR4; existing Fusion pricing and analytics |
| Feedback, stop, managed launch and resume/fork | PR5; native runtime adapters and verified capabilities. Prototype evidence reports upstream resume/fork unsupported; PR1 capability metadata does not claim provider support. |
| Summaries, read-only Ask/recent activity overview, search | PR6; existing AI configuration and bounded collected content; historical Ask import in PR7 |
| Archive, pins and notes | PR6 preference/notes contract and PR7 preservation of source metadata |
| Idle watcher and operational history | PR7 preservation; no autonomous continuation is enabled by ingestion |
| Launch templates, alerts/notifications, snoozes/HITL/action requests, workspace/project actions, Q&A/embeddings | Snapshot reports no stored use; PR1–phase 0 revalidation assigns any confirmed use to PR5–6. Reuse project registry/launch forms where applicable; no arbitrary host actions or approval automation through ingestion. |
| Retention and recovery | PR6 coordinated receipt retention and PR7 supported snapshot/reconciliation/rollback |

1. Collector adapters and durable independent spools for m3/m5/J; sanitized native fixtures, stable host mapping, health diagnostics, source evidence/licensing and complete used-feature inventory (phase 0 and remaining collection work).
2. Sessions navigation/list/live delivery, filters, activity staleness, host connectivity and verified native Fusion-session reconciliation. Explicit task/run linking and project access rules; no inference from path/title.
3. Durable turns/results/duration and historical file patches with bounded parsing/output and history pagination.
4. Provider-normalized request accounting, shared effective-dated pricing, coverage and rankings without native/import double counting.
5. Host/runtime-generation-scoped controls and feedback with durable application acknowledgements, expiry and capability verification.
6. Bounded summaries, search/notes/alerts/launch/workspace equivalents as established by the used-feature inventory, operational metrics, coordinated receipt/session retention and collector pagination.
7. Resumable historical import, schema/data conversion from any adopted prototype, reconciliation, all-host outage/restart/rollback rehearsal and at least 24-hour comparison before separately approved cutover/AgentPulse retirement.
