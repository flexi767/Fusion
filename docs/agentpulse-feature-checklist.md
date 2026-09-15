# AgentPulse feature and acceptance checklist

Source inspected on J at `04f0dcf42d700f60ea3848326ba6d43da80c7a40` in `/home/ubuntu/agent-panels/agentpulse`. Counts refer to the consistent snapshot with SHA-256 `04f7c3ebbf89eba90bf3fffdc782c01076301fb9a46f089f67d978f2a3d48f44`. Zero stored records are evidence about this snapshot, not proof that a UI was never opened.

## Used or required surfaces

| Surface | Observed use / requirement | Fusion replacement | Acceptance remaining |
| --- | --- | --- | --- |
| Cross-host sessions and native activity | 95 source identities; plan explicitly includes external desktop/Claude launches | Authenticated host-scoped observations, independent collectors, Sessions list, exact project/provider/host filters, stale activity and separate connectivity | Live m5; 12 hostless metadata-only records; every native runtime backend; 24-hour window |
| Prompts, results, duration, tools and patches | 5,958 stored turns | Bounded PostgreSQL turn history, direct links, shared task detail and historical patch renderer | Fresh post-catch-up reconciliation; captured substantive differences are corroborated |
| Context, usage, costs and rankings | 76 sessions have source cost-usage metadata | Provider normalization, per-category costs, recorded/current rates, context telemetry and rankings | Authoritative baseline rate updates; unsupported prices remain unknown |
| Search | Source FTS tables; explicitly required by plan | Search across collected titles and older turn output | Continued dual-run acceptance |
| Archive/pins/notes | Six archived; zero pinned; zero notes | Independent preferences and revision-fenced notes; importer preserves mapped records | Four archived records are hostless/unresolved and retained in the snapshot |
| Managed launch | Four requests and four managed Codex sessions, all read-only with approval `never` | Explicit managed Codex launch through a registered Fusion CLI runtime, durable claim and cancellation state | Real native launch acceptance per host; no disposable AI agents launched in this session |
| Feedback and stop | Seven source controls: three successful prompts, three successful stops, one failed stop | Durable host/generation-scoped commands, Fusion-owned CLI bridge and optional feedback-only native hook | Real native-hook/control checks on each host; other Fusion backend identities; comparison controls stay off |
| Per-session summaries | Required by plan; existing m3 Qwen endpoint verified | Bounded, thinking-disabled Qwen summaries, content hashing, leases, retry delay, coverage and preserved previous output | Sustained endpoint/host acceptance; no extra inference server installed |
| Read-only overview across recent sessions | One Ask thread and two messages: a one-sentence activity-summary request, no action requested | Recent activity overview reuses up to five existing session summaries with host, native activity time and coverage | Overview build/gate/desktop/mobile checks passed; original Ask thread remains in recovery snapshot and has no imported conversation view yet |
| Idle watcher | 65 successful idle runs, one attempt each; zero proposals/configuration rows | Source runner returns success without inference when configuration is absent/disabled; no proposals, associated AI events or spend exist in this snapshot | Evidence is consistent with no-op wakes, not 65 AI decisions. Preserve operational history; autonomous continuation is not enabled by the integration |
| Retention and recovery | Required by plan | Explicit bounded content/cache retention, immutable snapshot, independent spools, outage and rollback rehearsals | All-host restart/rollback and full observation window; no real retention applied |

## Additional source surfaces with no stored use

| Surface | Snapshot evidence | Mapping or named follow-up |
| --- | --- | --- |
| Launch templates | `session_templates`: 0 | Explicit Fusion launch form covers recorded launches. Template import/management is a named follow-up if actual use is established. |
| Notification channels and alert rules | Channels, rules and rule fires: 0 each | No channel configuration is silently copied or activated. Session notification mapping remains a named follow-up if required. |
| Inbox snoozes, HITL gates and action requests | Snoozes, HITL and action requests: 0 each | Fusion task controls remain separate. External-session AI approval workflows are not implicitly enabled. |
| Workspace/project actions | Projects and pending project drafts: 0 | Existing Fusion project registry supplies explicit launch destinations. Arbitrary workspace creation/clone actions are not accepted through the collector. |
| Session Q&A cache and embeddings | Cache and embeddings: 0 | Bounded collected-output search and stored summaries; free-form transcript Q&A is not claimed as ported. |
| Resume/fork | Verified upstream handlers return 501 | Not advertised as a supported capability. A runtime adapter must establish a working contract before exposing it. |

## Watcher evidence

The actual source `src/server/services/ai/runner.ts` was read on J. `evaluateInner` returns `{ kind: "ok" }` immediately for missing/disabled configuration, and `processRun` records that as succeeded. Inference creates a pending proposal first. The snapshot contains zero watcher configurations, proposals, proposal references, associated `AiProposalPending`/budget/provider error events and daily spend rows. The 65 successful idle wakes are therefore consistent with no-op evaluation; success alone is not evidence of AI inference or an autonomous continuation workload. Those original operational records remain in the recovery snapshot.

## Parity decision

**Open.** Implemented replacements do not substitute for missing native acceptance. AgentPulse remains running. The comparison preview has no execution engine and never enrolls observed sessions as tasks. No main merge, release, production entry-point switch or retirement follows from this checklist.

Detailed evidence: [progress](agentpulse-integration-progress.md), [reconciliation](agentpulse-reconciliation.md), [accounting](agentpulse-accounting-comparison.md).
