# AgentPulse used-feature inventory (Phase 0 gate)

Measured: 2026-09-24, against the live production AgentPulse on J
(`agentpulse.service`, `agentpulse-supervisor.service`, `agentpulse-private-relay.service`,
SQLite at `/home/ubuntu/.agentpulse/data/agentpulse.db`, 1,013,276,672 bytes).

The integration plan scopes parity to "the AgentPulse features **used in this deployment**".
This inventory answers that from data rather than from the source tree: a feature whose tables
hold zero rows after the deployment's whole lifetime is not in use here. Row counts are the
evidence; the code surface exists for all of them.

## Used — these need a Fusion equivalent

| AgentPulse capability | Evidence (rows) | Fusion status |
| --- | --- | --- |
| Session observation | `sessions` 556 | **Done.** Phase 1; `external_sessions`, Remote agents panel. |
| Session events | `events` 96,006 | **Done.** Observation ingestion with durable replay. |
| Turn history / results | covered by `events` | **API only.** Migration 0088 + `/external-sessions/:id/turns` are deployed and paginated; nothing renders them. Largest gap. |
| Full-text search over output | `search_events_fts` 67,148 docs; `search_sessions_fts` 556 | **Missing.** Phase 5. Genuinely used at scale. |
| AI watcher runs | `ai_watcher_runs` 817 | **Missing.** Phase 5 summaries. Heaviest AI usage in the deployment. |
| Session control actions | `control_actions` 7 | **Missing.** Phase 4 stop/resume, capability-gated. |
| Managed sessions | `managed_sessions` 4 | **Partial.** Fusion owns its own sessions; external managed-session control is Phase 4. |
| Launch requests | `launch_requests` 4 | **Missing.** Low usage; candidate for a named follow-up rather than parity. |
| Supervisors + credentials | `supervisors` 3, `supervisor_credentials` 3 | **Equivalent.** Fusion host-scoped collector credentials cover host identity/auth. |
| Ask threads | `ask_threads` 1, `ask_messages` 2 | **Near-unused.** Fusion Chat is the equivalent; propose follow-up, not parity. |
| Settings | `settings` 9 | **Equivalent.** Fusion global settings. |
| LLM providers | `llm_providers` 1 | **Equivalent.** Fusion provider/credential settings. |
| API keys | `api_keys` 1 | **Equivalent.** Collector credentials. |
| Cost overview / popover | `CostOverview.tsx`, `CostPopover.tsx` | **Partial.** Session + card totals done; turn costs, effective-dated rates and rankings open. |

## Not used in this deployment — zero rows, not parity requirements

`watcher_proposals`, `watcher_configs`, `users`, `supervisor_enrollment_tokens`,
`session_templates`, `projects`, `project_alert_rules`, `project_alert_rule_fires`,
`notification_channels` (Telegram), `event_embeddings` (vector search), `auth_sessions`,
`ai_qa_cache`, `ai_pending_project_drafts`, `ai_inbox_snoozes`.

This retires a large amount of assumed scope: Telegram channels, project alert rules, session
templates, vector/semantic search, the HITL inbox snooze flow and AgentPulse's own user/auth
model carry no data here. Each is recorded as a **named follow-up**, not a blocker, per the
Phase 0 gate wording ("no unassigned used capability"). If any is later switched on in
AgentPulse, it re-enters scope and this table must be re-measured.

## Consequences for ordering

1. Turn history rendering (Phase 2) — the API exists, the data exists, nothing shows it.
2. Search over collected output (Phase 5) — 67k indexed documents is real, demonstrated use.
3. AI summaries (Phase 5) — 817 watcher runs.
4. Controls (Phase 4) — 7 control actions; small but user-visible.
5. Launches / Ask — lowest measured use; follow-ups.

Historical import (Phase 6) must carry `sessions` 556 and `events` 96,006, and its
reconciliation report is what proves parity. Retiring AgentPulse still requires separate
explicit approval, and the recovery snapshot is retained regardless.
