# Standalone Fusion remote agents

These Python 3 standard-library collectors read native Codex and Claude JSONL files. They talk directly to Fusion. AgentPulse, its API, database, relay, supervisor and hooks are not dependencies.

Fusion requires PostgreSQL and one independently generated collector token per host/project. Add only SHA-256 token digests to the private dashboard environment:

```json
FUSION_EXTERNAL_SESSION_COLLECTORS=[{"projectId":"PROJECT_ID","hostId":"j","tokenSha256":"TOKEN_SHA256"}]
```

Save the matching raw token in a mode `0600` file on the corresponding host. Never commit tokens or state. Use HTTPS or a private loopback tunnel. Existing dashboard authentication remains required for viewing and composing feedback; collector tokens authorize only the four exact POST ingestion, heartbeat, feedback-claim and feedback-ack endpoints. They cannot read other hosts or projects.

```sh
python3 collector.py --url https://fusion.example.com --project PROJECT_ID --host j \
  --token-file /private/path/token --state /private/path/spool.sqlite
```

Keep this process running under the host's normal service manager. The collector checks native files modified in the last seven days, bounded to 2,000 files per scan. `--home` selects the native CLI user's home. It reads complete lines incrementally, keeps a private durable spool, resumes after outages and never resets an ambiguous replaced/truncated file automatically. Its own SQLite ledger is local transport state; canonical session and feedback storage is Fusion's PostgreSQL database.

Install feedback hooks independently of any other hook integrations:

```sh
python3 install_hooks.py --url https://fusion.example.com --project PROJECT_ID --host j \
  --token-file /private/path/token --state /private/path/spool.sqlite
# Review the target paths, then repeat with --apply.
```

The installer backs up and appends to existing settings. It does not overwrite other hooks or modify native trust decisions. Codex requires its hooks feature and native review/trust of the new command definitions. Restart/resume Claude sessions to load changed settings. Until a native hook actually registers a live runtime, Fusion displays feedback as unsupported.

Feedback is queued for five minutes and delivered as additional context at the next supported native hook. Resuming a session rotates its generation; old-generation feedback cannot enter the resumed runtime. Delivery acknowledges emitted native context, not proof that the agent acted on it. Ambiguous delivery is shown as uncertain and is never automatically replayed.

Open Fusion's **Agents → Remote agents**, select the configured project and a session. Collector connectivity and activity age are shown separately. Cost uses Fusion's recorded model/category pricing and shows its provenance. Claude's one-hour writes use its documented 2x input tariff, separately from five-minute writes. Unknown usage, models and unsupported fast/long-context pricing remain unavailable rather than becoming zero. Reported reasoning tokens are included in output tokens and are not charged twice. Partial known cost is labeled separately.

Agent launching/stopping/resuming, templates, notes/pins, transcript search, patches, AI summaries/watchers, rankings, notifications and historical AgentPulse migration are outside this implementation.

Run the native protocol tests with `python3 -m unittest discover -s scripts/remote-agents -p 'test_*.py'`. `pnpm smoke:external-sessions` exercises the real isolated Fusion HTTP ingest/read/pricing/feedback/restart flow without AgentPulse.
