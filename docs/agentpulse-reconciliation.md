# AgentPulse comparison reconciliation

Updated 2026-09-16 (Berlin). Comparison only; parity and cutover remain open.

## Cohort and normalization

The recovery snapshot is the consistent 157,188,096-byte J backup at source commit `04f0dcf42d700f60ea3848326ba6d43da80c7a40`, SHA-256 `04f7c3ebbf89eba90bf3fffdc782c01076301fb9a46f089f67d978f2a3d48f44`. It contains 95 session identities and 5,958 turn events. Native files verify 70 identities (65 m3, five J). Explicit source host metadata plus matching native SessionStart IDs establish 13 additional historical-only identities (12 m5, one m3); their evidence records `nativeTranscriptVerified: false`. Together these 83 identities cover all 5,958 stored turns. Four verified managed-session aliases additionally map to those same native identities: 87 source records map to 83 canonical sessions. Eight hostless metadata-only identities remain unresolved; all six archived source labels are accounted for. m5 has no live heartbeat and remains unreachable; neither offline nor unknown records are silently assigned to another host.

Comparison uses validated canonical turns, project-relative patch paths when supported by the recorded working directory, absent/null service-tier normalization and deterministic usage-band order. Server pricing snapshots, provenance and native parser-generation metadata are excluded from content hashes. Prompts, results, native times, tools, patches and usage remain compared. An equal timestamp is never treated as proof that different content is correct.

## Latest mapped comparison

| Host | Source turns | Normalized exact | Later native timestamp | Equal-time differences | Missing |
| --- | ---: | ---: | ---: | ---: | ---: |
| m3 | 4,982 | 4,480 | 30 | 472 | 0 |
| J | 392 | 354 | 10 | 28 | 0 |
| m5 (historical only) | 584 | 584 | 0 | 0 | 0 |

Latest captured comparison at approximately 21:31 UTC: 5,418 normalized exact turns, 40 later-native turns, 500 equal-time differences, zero missing and zero unexplained timestamp/provenance mismatches. J's 28 equal-time differences add reported service tier. m3's 472 comprise 21 current-context values, 441 service-tier values, one combination, eight earlier-prompt attribution corrections and one combined-turn correction. Active sessions continue changing; these counts describe the captured export.

The [accounting comparison](agentpulse-accounting-comparison.md) now verifies identical-rate arithmetic for all 5,746 source-priced model groups across the entire stored-turn snapshot, with zero discrepancies. It does not authorize replacing differently dated provider baselines.

Native corroboration covers all 49 substantive rows in this export: 35 m3 Claude, ten J Claude and four m3 Codex. Across the 45 Claude rows, 671 distinct native requests match retained request counters and every exported usage group. Actual prompts/responses match after executing Fusion's existing secret-redaction function; completion markers and unique tool counts match. Twenty extra-source prompt comparisons resolve to earlier native IDs and the same earlier PostgreSQL owning turns. The changed Claude patch matches its native successful edit result (+52/−32). The four Codex rows independently match 1,163 native requests, all input/cache/output/reasoning totals, tool counts, 65 collected file patches and completion state. Prefix byte lengths and SHA-256 hashes are retained in private evidence.

At 21:22 UTC, all 65 native-file-verified m3 transcripts had reached complete-line EOF, apart from the current active session's 2,157-byte trailing partial line. The 21:31 post-catch-up reconciliation above is complete; the earlier 21:06 export remains preserved privately as audit evidence.

## Native ownership corrections

The resumed Claude transcript `c4b18b9b-0e23-494f-8cd8-154b05528c05` repeats native event IDs. The fixed verification prefix is 66,833,948 bytes, SHA-256 `18f7c19ebe79e23ca63826bf5d2b9d9d4c1a9546926ef093592cc85554932a50`.

- Source turn `719350d3-3fe7-47b0-8554-e76002302fbc` combined five prompts and 39 tools. Its actual native interval contains one prompt, three requests and two tools. All four other prompts are retained in their owning turns. Native generation 5 and the corrected result are persisted in J PostgreSQL.
- Turn `b64070e5-76d8-4ff0-b130-5af9dde9732e` now completes at `2026-09-11T13:31:32.843Z`, with 19 tools and 20 requests. Earlier replay could attribute an old completion or unrelated later records to it. The fixed native replay confirms the response and counters; the generation upgrade repairs PostgreSQL despite the earlier parser's misleading later timestamp.

Seven additional equal-time differences each remove one earlier prompt from a later source turn. All seven exact prompt strings were found in the following native records, and each is retained in the matching earlier PostgreSQL turn. No prompt was dropped simply to match a count.

| Later source turn | Verified owning native turn | Native time |
| --- | --- | --- |
| `cc25fb4e-cc96-4225-ade6-1390531cf6e8` | `c1ab67bf-3dc8-47f8-9d86-b783798b9a1a` | 2026-09-13T05:07:03.504Z |
| `fafe3af8-8013-4bda-bd13-7cc7640188ac` | `94df9dc3-7cd8-41de-bcde-e57147242ae9` | 2026-09-11T09:11:27.455Z |
| `99694b58-51b6-4ffd-a3b6-626db509e8e4` | `e030e016-165e-4363-bc7b-ad80a4fe0c6a` | 2026-09-11T09:10:49.115Z |
| `93c1a7e8-f167-4591-8d81-8181517f0ddb` | `084201d8-1f3b-4750-9142-3875a1bcbf93` | 2026-09-11T09:11:19.655Z |
| `803d61b4-6bd6-441d-b766-bbb8fafc04c2` | `9db40383-8aa8-4f60-a4fc-fbae910f85b5` | 2026-09-13T05:05:56.953Z |
| `60102460-841b-4fff-bbb3-231ba7de281c` | `afcb1d4d-257b-490c-8018-f709c556abb8` | 2026-09-11T09:11:35.363Z |
| `09e2b93f-1a56-4dfb-b700-a500b31035d4` | `6bece214-761f-4cf4-a584-dfd5724797f9` | 2026-09-11T09:11:43.439Z |

The private native evidence records content hashes and bounded bytes read, without copying prompts into this report. Collector ownership and request deduplication survive SQLite restart and apply across native history, appended replay and partial request snapshots.

## Remaining acceptance evidence

- Resolve live m5 connectivity and the eight hostless metadata-only identities. Format-5 archive replay is complete, with zero source-to-PostgreSQL metadata mismatches.
- Continue dual-run observation for new regressions. The 21:31 export completed the catch-up comparison; all 40 later-native rows and nine substantive equal-time corrections are corroborated.
- Verify native hooks and supported real controls on every host and remaining Fusion runtime backends without enrolling observed sessions as tasks.
- Extend the completed m3 five-minute network outage and preview rollback rehearsal to all-host acceptance, and finish at least 24 hours of dual observation. The provisional window began 2026-09-15 18:28 UTC. The outage queued 57 deliveries and drained without rejects; AgentPulse remained available during rollback.
- Keep AgentPulse and the recovery snapshot. Content retention has not been applied to the real comparison cohort. No production switch, service retirement, main merge or release is authorized by this report.


## Private evidence locations

Under `/Users/v/.fusion/session-integration-test/`: `native-corroboration-m3.json`, `native-corroboration-j.json`, `native-corroboration-codex.json`, and `native-corroboration-claude-patch.json`. Inputs, exports and detailed prompt investigations are private mode-600 files. The corroboration scripts stream only audited native paths with bounded line/file sizes; no working-tree files are used to reconstruct historical patches.


## Post-catch-up export (21:31 UTC)

The fresh export has **5,418 normalized exact turns, 40 later-native turns and 500 equal-time differences**, still zero missing turns or unexplained timestamp/provenance mismatches. m3 is 4,480 / 30 / 472; J remains 354 / 10 / 28; m5 remains 584 exact. All previously corroborated Claude rows are byte-equivalent after canonical normalization. Four Codex later-native rows now match 1,163 raw native requests, all token categories, unique tool counts, patches and completion markers. This adds one corroborated historical completion and advances the current growing session's captured prefix. All 49 substantive rows in this export are accounted for. Earlier exports are preserved privately under `reconciliation-2106/`; they were not overwritten to conceal differences.

The independent managed-session/supervisor/native-thread relations additionally resolve four source aliases to already-mapped native identities. Audit maps now cover 87 source records → 83 unique native sessions; eight metadata-only identities remain unassigned. Format-5 alias-label and conversation replay completed at 22:09 UTC on server `023d257e7`. All three historical spools are drained with zero rejected deliveries. Exact metadata comparison verifies 83 canonical records, four preserved aliases, all six original archive labels and five explicit references to the one two-message Ask thread. A fresh m5 replay comparison remains 584/584 exact turns. The eight truly unassigned source records remain in the recovery snapshot; host-specific unresolved counts additionally include aliases mapped on other hosts.
