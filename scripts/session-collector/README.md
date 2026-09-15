# Fusion native session collector

This collector is independent of AgentPulse. Keep both running during comparison.
Python 3 reads local Codex rollout and Claude project JSONL files. It does not
launch agents, create tasks, inspect working-tree diffs or offer process controls.
`turn_parser.py` adapts the verified AgentPulse source; see `AGENTPULSE-LICENSE`.

On the Fusion server enable `FUSION_SESSIONS=1`, `FUSION_SESSION_INGESTION=1`,
and set `FUSION_SESSION_COLLECTORS` to a JSON mapping of stable host ids to
SHA-256 hashes of randomly generated tokens (minimum 32 random bytes).
Keep each token in a mode-600 file on its owning host. Do not put raw tokens
in shell arguments, URLs or source control. Use HTTPS or the existing private
WireGuard transport. One token may identify exactly one host.

```sh
python3 scripts/session-collector/collector.py \
  --host m3 --url http://wj:4040 --token-file ~/.fusion/session-collector/token
```

Default spool: `~/.fusion/session-collector/spool.sqlite`. This is only a local
write-ahead delivery queue. It never shares AgentPulse state. Use `--once` for a
bounded pass and `--home`/`--state` for disposable verification fixtures.
The spool is bound to `--host`, and a credential preflight checks the server host binding before sending session data. HTTP redirects are rejected.
A service manager should restart the collector; do not wrap it in detached
shell launch patterns. The single-instance file lock prevents concurrent writers.
Keep the spool on persistent local storage. Never delete it to repair delivery.

## Diagnostics and limitations

SQLite `health` records last acknowledgement and parse/delivery errors; `pending`
contains retryable deliveries. The cursor and delivery are committed together.
Partial final lines remain unconsumed. A delivery is removed only after its exact
event id is acknowledged. Collection pauses when the queue reaches its cap.
The initial history catch-up can take several passes. Discovery reads only the
known provider directory depths. A future provider directory format needs an
explicit adapter update. Long native records and unsupported files remain visible
in diagnostics rather than being used to claim complete coverage.

Controls are separately gated by `FUSION_SESSION_CONTROLS=1` and an explicit
`FUSION_SESSION_CONTROL_HOSTS` comma-separated allowlist. Transcript discovery
never registers capabilities. Runtime adapters must retain their generation and
a durable command execution ledger; delivered does not mean applied. Do not enable
an operation until its native adapter has been verified with disposable sessions.

Summaries use `FUSION_SESSION_SUMMARIES=1` and a trusted
`FUSION_SESSION_SUMMARY_URL` ending in `/v1`; on m3 the verified endpoint is
`http://127.0.0.1:8080/v1`, model `qwen3.5-2b`. Thinking is disabled. No models or
servers are installed by this collector.

## Historical import

First take a consistent AgentPulse snapshot with SQLite's supported backup API;
do not copy a live WAL database file. Preserve its configuration independently.
Use an audited JSON map keyed by AgentPulse `session_id`, with `hostId`, `provider`
(`codex` or `claude`) and `nativeSessionId` proven from the native transcript.
Unknown identities remain in a durable unresolved list and prevent a complete import result. Verified records can advance. Updating the audited identity map restarts a safe idempotent scan so previously unresolved records can be recovered.

```sh
python3 scripts/session-collector/import_agentpulse.py \
  --snapshot /secure/agentpulse-snapshot.db --identity-map /secure/identities.json \
  --host m3 --state ~/.fusion/session-collector/spool.sqlite --limit 100
```

Run once per host credential/spool. Import resumes by snapshot SHA-256, identity-map digest and phase/event cursor. It enqueues bounded deliveries; normal collector draining acknowledges
them. Historical data never overwrites a live activity snapshot. Turn results use the newest native timestamp across live and imported data; an older partial backfill cannot replace a newer complete result. This
importer handles session records, notes, archived/pinned labels, model/branch/timestamps, reported session usage and collected turn-result events. Reported session totals are retained separately from turn-based accounting to avoid double counting. Other AgentPulse event types still require their mapped replacements.

## Optional feedback hook adapter

`feedback_hook.py` implements the verified AgentPulse `additionalContext` hook
contract for Codex and Claude. It is opt-in and does not edit provider settings.
Configure it only after disposable native-hook verification; retain every existing
AgentPulse hook throughout comparison. Example command for an installed provider
hook (supply the actual absolute checkout/install path):

```sh
python3 /absolute/path/scripts/session-collector/feedback_hook.py \
  --provider claude --host m3 --url http://wj:4040 \
  --token-file ~/.fusion/session-collector/token
```

Supported events: `PreToolUse`, `PostToolUse`, `UserPromptSubmit`, `SessionStart`.
The native session must already have been observed by Fusion. Server controls and
the host allowlist must both be enabled. This hook advertises **feedback only**;
it does not claim stop/resume access. Inactive adapters can receive queued feedback,
which expires after five minutes and requires another supported native hook event.

The separate mode-600 `feedback.sqlite` ledger binds commands to host, provider,
native identity and runtime generation. It records intent before emitting output.
Retries after emission only acknowledge; an ambiguous crash is marked failed and
never automatically re-emits. This favors avoiding duplicate instructions over
retrying a possibly delivered message. "Emitted as provider hook context" reports
adapter output, not proof that the model followed the feedback. Hooks have a
bounded two-second network budget and fail open when Fusion is unavailable.

Rejected transcript deliveries remain in `pending` with a `rejection` HTTP status.
Fix the rejected payload/parser before re-enabling a specific delivery; do not
clear the whole spool. Permanent errors do not prevent other sessions draining.

## Resource bounds and replay

Parser v4 keeps historical turn, request and deduplication records in the same
local SQLite spool, loading only the records touched by a bounded input chunk.
The working state and single-turn request set are capped at 8 MiB; retained parser
records are capped at 1 GiB / two million records. Install `parser_ledger.py`
alongside `collector.py` and `turn_parser.py`. Existing parser checkpoints are
rebuilt from native sources on upgrade, without clearing pending deliveries.
Each delivery is capped at 1.5 MB;
the durable queue is capped at 128 MiB with a 2 MiB live-update reserve and 5,000
records. Byte accounting is maintained transactionally, including live coalescing
and exact acknowledgements. A limit rolls back that file's checkpoint and reports
`resourcePaused`; it never discards an unacknowledged record. A malformed complete
line also preserves its cursor for repair. History rotates independently of the
recent live scan, including when a large file is paused. Changed-turn backlogs
drain before more history is parsed. Disk-state writes, cursor, revision and queued
delivery commit together; replacement checkpoints remove obsolete parser records
only in that transaction. Old transcripts remain the source of truth. An
operator-selected history retention policy remains pending; hitting the disk cap
pauses collection rather than silently evicting history or deduplication evidence.

Reported model/context metadata is separate from lifetime usage. Model changes
clear prior context; compacted context may shrink. Capacity stays unreported when
the native format does not provide it. Unsupported reported service tiers remain
unpriced. Exact native event identities deduplicate retries while preserving
repeated user steering with distinct event ids.

Codex archived transcripts are discovered in the verified native
`~/.codex/archived_sessions/*.jsonl` directory as well as live rollouts. Moving a
transcript into that directory preserves its host/provider/native identity.
AgentPulse archived/pinned labels remain independent of collector connectivity
and agent activity, and importing a snapshot never overwrites operator-edited
labels. Import v4 replays earlier checkpoints to add this preserved metadata.

## Fusion-owned runtime reconciliation

When the existing experimental CLI Agent Executor is enabled, its owning Fusion
process can also set `FUSION_SESSIONS=1` and `FUSION_SESSION_HOST_ID=m3` (or the
actual stable collector host id). This enables an independent, bounded observer
of that manager's live Codex/Claude handles. It matches exact native ids, records
verified runtime provenance and links the owning task without creating tasks.
Explicit link/unlink decisions remain authoritative. Historical records and
transcript files alone never grant control ownership.

With `FUSION_SESSION_CONTROLS=1` and that host in `FUSION_SESSION_CONTROL_HOSTS`,
ready owned terminals support feedback; busy terminals retain queued feedback.
Independent managed/chat sessions also support stop. Task-owned sessions expose
a link to Fusion's existing task Pause/Resume controls. This bridge does not start
agents or inference services and does not advertise unsupported resume actions.

Each owned PTY has a fresh generation, including when its durable session id is
reused on resume. PostgreSQL commits an execution fence before native side
effects. A crash after that fence never causes automatic command re-execution;
an unconfirmed result remains explicit. Injection is cancellable and checks its
deadline again before writing; acknowledgement means bytes were written to the
owned terminal, not that the model obeyed them. A connected Fusion owner takes
precedence over the optional external feedback hook adapter.

### Managed Codex launches

With the CLI Agent Executor enabled, a Fusion runtime can opt in to independent
managed launches using `FUSION_SESSION_LAUNCHES=1`, alongside the Sessions,
controls, host ID and control-host allowlist flags above. Enable the launch flag
on the dashboard as well. The Sessions launch panel lists only registered,
connected host/project runtimes. The selected project supplies the working
directory; browser requests cannot supply a command, argument vector, arbitrary
working directory, environment, task ID or elevated posture.

This first managed launch adapter preserves the policies recorded on all four
used AgentPulse launch requests: Codex, `--sandbox read-only`,
`--ask-for-approval never`. These flags were verified against the installed m3
`codex-cli 0.141.0` help. It reuses Fusion's existing PTY manager, native adapter,
per-session hook token and notify shim. It starts no task and no additional
inference server. Claude launch, provider resume/fork, and arbitrary remote
supervisor launch modes are not advertised by this adapter.

Launches have immutable request IDs, a five-minute queue expiry, exact
host/project/runtime generation binding, and a one-shot durable claim before
spawn. At most five requests may be pending per host. A worker handles one launch
at a time, with a 30-second spawn/initial-prompt deadline. Only queued requests can
be cancelled. A failed acknowledgement after launch leaves an interrupted,
unconfirmed request; it never automatically launches again. Inspect the owning
runtime before manually creating another request. Acknowledged `started` means
the initial prompt reached the owned terminal, not that its work completed.

Runtime registration and launch execution currently require the runtime to use
the same central PostgreSQL data layer as the dashboard. The read-only Python
collector cannot register a launch runtime or execute launch requests. Deployment
and real per-host launch/control verification remain part of the parity gate.

### Live updates during initial discovery

Collector v5 keeps the historical parser ledger at v4. It adds a separate live
parser checkpoint so unchanged transcripts without token telemetry are read once,
not re-enqueued every scan. Partial records do not generate a new live revision.

Fresh native events (within 90 seconds, allowing 30 seconds of forward clock skew)
use the highest delivery priority, ordered by event time. Older discovery snapshots
come next, then turn backfill. Discovery/history may occupy at most 4,500 of the
5,000 durable queue records; the remaining records and the 2 MiB byte reserve are
for fresh live events. Coalescing updates priority atomically with the exact body.
Old fresh-priority rows age back into discovery priority without deleting data.
Capacity pressure preserves every unacknowledged row and checkpoint.


## Resumed Claude history (collector v6)

Claude transcripts can append earlier native records again. Collector v6 persists
native event/request ownership in the SQLite parser ledger, routes delayed events
through their native parent, and ignores exact replay without moving the active
turn. Changed snapshots of the same request update its original turn. Older
assistant output cannot rewind a newer response or completion. Partial usage
snapshots retain the request's known counters, context band and metadata.

Only Claude history advances to parser version 5 and reparses from its native
file; Codex history remains at parser version 4. Live cursors, monotonically
increasing delivery revisions and pending acknowledgements are preserved. The
new ownership namespace is subject to the existing parser byte/record bounds.
Keep AgentPulse and its independent recovery snapshot throughout comparison.


## Opaque records and binary display text (collector v7)

Canonical Codex `compacted` records and `response_item` records with
`custom_tool_call_output`/`function_call_output` payloads do not contribute turn
history. Their oversized opaque bodies can now be framed without loading them
into JSON memory. The reader recognizes the canonical header, including optional
`ordinal`, persists bounded scan progress and advances the main cursor only after
the terminating newline arrives. It reads at most 1 MiB per continuation, after
the existing bounded initial prefix. User/assistant messages and unknown record
shapes still pause at the configured limit; no actionable record is skipped.

NUL in display prompts, responses or patch text is shown as `␀`. A bounded repair
pass can retry previously rejected 400 deliveries when this normalization changes
the display text, retaining the exact event ID and observation revision. Other
rejections remain parked. Patch counts stay intact and sanitized patch display is
marked bounded. Native transcript files and AgentPulse recovery data are unchanged.


## Native correction generations (collector v8)

Native turns now carry their provider parser generation. The server accepts an
earlier corrected timestamp only when both the parser generation and durable
observation revision increase over the stored native turn. Same-generation stale
snapshots and parser downgrades remain refused. Imported snapshots cannot claim
this authority. Display or collector releases do not themselves advance a parser
generation.

Deploy the updated server before collector v8. Existing Claude turns are
republished in durable keyset batches of 25 without rewinding file offsets.
Codex history is not republished wholesale. Keep the existing spool when updating
a collector; resetting it would discard the revision and acknowledgement chain.
