# Checked remote-agent integration handoff

<!-- FNXC:RemoteAgents 2026-09-18-22:25: Prepare the exact accepted source and remaining native/server execution steps without changing protected source refs, deployment or native trust. -->

The three requested standalone features are implemented. This document prepares the outstanding source integration, supervised deployment and live acceptance. It does not certify those steps as completed.

## Exact accepted source

- Canonical upstream: `8a83f875bae673e3692bab0da36cc93851801f24`, tree `f8e91fb7ea50e6605c8c77eb867328f9704e05c6`.
- Owned source: `846be21f7f85905db788dd48928a2732bf35bde6`; 58 paths, including the latest managed-view request pause, native installer deduplication and authentic legacy fixture correction.
- Package SHA-256: `06144a25b22440aa95b36518f4e3d6064e282898561938ec5378167dd27e341c`.
- Validation SHA: `924229521171f0b75d2710c610bca3090f779658`; [full current-main CI passed](https://github.com/flexi767/Fusion/actions/runs/35395556505).
- Expected complete staged candidate tree: `240c9edfa08cec743e0a371994ae0b4aec2dcc12`, with 9,106 tracked paths. This is calculated from exact canonical entries and accepted resolved files, not an observed J tree or landed commit.

Local self-contained directory:

`/Users/v/Documents/Codex/2026-09-16/fusion-external-pr1-retry/outputs/fusion-remote-agent-integration/accepted-current-main-handoff`

It contains the original CI-tested helper, exact manifest/gzip package, source-tree record, complete job log, acceptance evidence and a wrapper that additionally requires the complete expected staged tree. All 561 original canonical directory trees were independently reconstructed and matched before adding the owned package. Both Mailbox paths and every other unowned canonical path are retained. This preparation does not require fetching missing blob bodies or changing repository refs.

## Integration in a permitted execution context

1. Refresh canonical main, peer worktrees/status/intents and upstream checks. If main moved, reconcile only owned paths and validate the resulting source; this exact-base wrapper deliberately refuses a different commit. Preserve the old unresolved J integration worktree/index and frozen runtime dependencies.
2. Prepare a new isolated review worktree at the exact accepted upstream commit using normal permitted Git operations. Declare intent there. Copy this handoff directory into a private owned preparation directory accessible from that context; do not copy native tokens or account credentials into it.
3. Verify the preparation without reading or changing a checkout:

   ```sh
   python3 /absolute/path/to/accepted-current-main-handoff/apply_checked_package.py --verify-package
   ```

4. From the clean new review worktree, invoke the same wrapper without the flag:

   ```sh
   python3 /absolute/path/to/accepted-current-main-handoff/apply_checked_package.py
   ```

   This requires the exact canonical commit and tree, a clean worktree/index, unchanged prepared assets, all exact base-file identities, allowed owned paths and the full expected resulting tree. It stages only the accepted 58 paths. It does not commit, push, create a PR, land or deploy. A failed guard is a stop condition; inspect its result in this disposable review worktree, preserving other work.
5. Review the full owned diff and synchronize latest owned plan/state documentation separately. The expected candidate tree above includes the frozen package's documentation; newer documentation changes the tree and must be reviewed/checkpointed explicitly. Preserve published migration 0082/0083 and remote observation/feedback 0084/0085. Check whitespace and commit by explicit owned pathspec. Fork-only workflows, package/helper preparation assets and unrelated inherited changes must remain outside the upstream feature PR.
6. Push the new owned review branch and open its checked PR through permitted tools. Satisfy required upstream checks and ownership review before landing. Existing fork success is evidence for the exact source, not a substitute for protected landing.

## Supervised deployment

Production currently runs `47e4ff866b7b21e88a98a557921f02de079e7e4f`, not the validation SHA or expected candidate tree. Target J through established SSH alias `wj`, the existing user service `fusion-daemon.service` and loopback 4040. Keep the direct `http://wj:4040` route, restricted relay, public `https://fusion.topkoli.com` proxy/authentication, provider settings, projects/tasks and unrelated services intact.

Before switching, verify the exact landed source, installed artifact/symlink/dependency ownership, fresh service/peer evidence and current database/configuration. Produce a fresh consistent PostgreSQL/configuration backup and preserve the currently installed 47e artifact/dependencies as the immediate rollback target. The original 06:28 cutover snapshot is historical; restoring it would discard subsequent work. Retain it privately, but do not treat it as a fresh backup for this later update.

Follow the existing supervised isolated-clone build/migration/health/cutover process. Record new source/artifact identity, task/project integrity, backup catalog, private configuration backup and usable rollback instructions before cutover. Preserve the normal service command/environment and native trust. Do not publish npm, tag a release, force main, retire AgentPulse or change unrelated units/routing. The legacy 0071 artifact requires its matching consistent database restoration; never start it against an incompatible upgraded database.

## Remaining live acceptance

- m3/J visibility: verify real Codex/Claude session rows, host connectivity separately from agent activity, project isolation, recent activity and honest unavailable telemetry. m5 remains offline with no heartbeat until genuinely reachable and installed; do not infer installation from history.
- Native feedback: J disposable Claude already passed against production. m3 Codex still requires a context able to write its normal native state and perform native hook review; m3 Claude needs usable existing CLI authentication and normal settings reload. Launch only controlled disposable sessions, confirm exact project/host/provider/native identity and runtime generation, send only their intended test marker, advance a native event if idle, and verify both receipt and actual agent response. Do not message the operator's active agents or forge trust/authentication. Context emitted is delivery evidence, not proof of execution.
- Costs: independently compare authoritative native request receipts with Fusion counts/rates/estimates for reachable supported runtimes. Existing J Claude and m3 Codex samples are recorded in state. Unknown telemetry, model, tier or tariff remains unknown; do not report partial sums as an invoice or host total.
- Outage/restart: preserve durable spool/ack state and verify response-loss/reconnect/restart replay without duplicated usage or ambiguous feedback reinjection. Existing exact-package real HTTP CI covers server replay; record post-cutover live evidence proportionately.
- Public access: use the operator-supplied existing public credentials privately through a permitted authentication client. Unauthenticated 401 and client/DNS failures do not constitute authenticated acceptance or invalid credentials. Direct WireGuard remains the operator route.

Operator test: Fusion Canonical Source → Agents → Remote agents → host/provider → session. Inspect activity, token categories, unit rates and estimate coverage. Feedback is available only for an exact currently hook-connected native generation; use an intended or disposable session and verify its actual response.

Record deployed SHA/artifact, coverage, feedback/accounting/replay/public evidence and testing steps in delivery state. Pause the narrow 20-minute heartbeat only after full live acceptance; preserve the paused general loop.
