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
  --url http://wj:4040 --token-file ~/.fusion/session-collector/token
```

Default spool: `~/.fusion/session-collector/spool.sqlite`. This is only a local
write-ahead delivery queue. It never shares AgentPulse state. Use `--once` for a
bounded pass and `--home`/`--state` for disposable verification fixtures.
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
Unknown identities stop the import and appear in its report.

```sh
python3 scripts/session-collector/import_agentpulse.py \
  --snapshot /secure/agentpulse-snapshot.db --identity-map /secure/identities.json \
  --host m3 --state ~/.fusion/session-collector/spool.sqlite --limit 100
```

Run once per host credential/spool. Import resumes by snapshot SHA-256 and event
cursor. It enqueues bounded deliveries; normal collector draining acknowledges
them. Historical data never overwrites a live snapshot or a live turn. This
initial importer handles collected turn-result events; session-only records,
notes, and other AgentPulse event types need the parity import extension.
