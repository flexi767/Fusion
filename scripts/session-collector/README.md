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
importer handles session records, notes and collected turn-result events. Usage-only metadata and other AgentPulse event types still require the parity import extension.

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

History state is capped at 8 MiB per transcript. Each delivery is capped at 1.5 MB;
the durable queue is capped at 128 MiB with a 2 MiB live-update reserve and 5,000
records. Byte accounting is maintained transactionally, including live coalescing
and exact acknowledgements. A limit rolls back that file's checkpoint and reports
`resourcePaused`; it never discards an unacknowledged record. A malformed complete
line also preserves its cursor for repair. History rotates independently of the
recent live scan, including when a large file is paused. Old transcripts stay the
source of truth; state spilling/retention for unusually large histories remains
a follow-up rather than silent eviction.

Reported model/context metadata is separate from lifetime usage. Model changes
clear prior context; compacted context may shrink. Capacity stays unreported when
the native format does not provide it. Unsupported reported service tiers remain
unpriced. Exact native event identities deduplicate retries while preserving
repeated user steering with distinct event ids.
