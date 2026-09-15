# AgentPulse accounting comparison

Comparison made 2026-09-15 against source commit `04f0dcf42d700f60ea3848326ba6d43da80c7a40` and the preserved snapshot SHA-256 `04f7c3ebbf89eba90bf3fffdc782c01076301fb9a46f089f67d978f2a3d48f44`. This records source arithmetic and configured rate coverage, not verified current provider prices.

## Cohort and result

- 5,374 source turns across the 70 audited m3/J identities; 5,351 model usage groups. Eighty turns contain no reported usage. Unresolved/m5 identities are excluded explicitly.
- AgentPulse source rates are dated 2026-09-15; Fusion baseline rates are dated 2026-07-16. Their default totals therefore need not match.
- Recalculation using the same AgentPulse category rates and 2026-09-15 effective period produced **5,155 matching groups, zero arithmetic mismatches** (absolute tolerance $0.000000001). The override map was private comparison input and was not installed as a second production price table.
- Fusion currently prices 3,344 groups from its baseline; AgentPulse prices 5,155. With the unchanged baseline, Fusion leaves 951 groups without an explicit long-context band, 485 without an explicit one-hour cache-write rate and 571 without a configured model price. Unpriced does not mean zero cost.

## Coverage by model

| Model | Usage groups | AgentPulse priced | Fusion priced | Identical-rate comparisons |
| --- | ---: | ---: | ---: | ---: |
| `gpt-5.6-sol` | 1865 | 1865 | 1865 | 1865 |
| `claude-opus-5` | 525 | 525 | 0 | 525 |
| `claude-sonnet-5` | 1014 | 1014 | 0 | 1014 |
| `gpt-5.5` | 1030 | 1030 | 1030 | 1030 |
| `gpt-5.6-luna` | 449 | 449 | 449 | 449 |
| `gpt-6-astra` | 251 | 251 | 0 | 251 |
| `codex-auto-review` | 178 | 0 | 0 | 0 |
| `<synthetic>` | 18 | 0 | 0 | 0 |
| `claude-fable-5-1` | 21 | 21 | 0 | 21 |

## Explained differences and remaining work

- GPT-5.5 agrees under the existing rate sets. The GPT-5.6 Sol and Luna baselines differ between the two source trees; those differences are rate data, not token arithmetic. Rates were not copied into Fusion without an authoritative update.
- The 1,560 Claude groups with reported one-hour cache writes, including 951 long-context groups, now reconcile using explicit category rates and separately configured context bands. No multiplier or cache lifetime is inferred. Settings can edit both bands; absent fields remain unpriced.
- The 196 `codex-auto-review`/`<synthetic>` groups are unpriced in both trees. GPT-6 Astra lacks a Fusion baseline entry but its 251 groups reconcile under identical supplied rates.
- Native Codex pricing must prefer an exact `openai-codex:model` override. Both current calculations and new recorded snapshots now do so; earlier immutable snapshots remain unchanged. Claude keeps its exact `anthropic:model` preference.
- Remaining validation: verify authoritative baseline rates, reconcile the J comparison database after catch-up/import, and include the remaining source identities once verified.

## Evidence

- Actual upstream `src/shared/model-pricing.ts` was read from the verified source archive and executed unchanged for the comparison. Type-only imports were stripped by Node.
- Private usage-only input, executable comparison script and detailed result are under `/Users/v/.fusion/session-integration-test/`: `accounting-source-turns.json`, `scripts/compare-accounting.mjs`, `accounting-comparison.json`.
- Source turn content, prompts, credentials and local rate overrides are not reproduced in this document.

## Pricing-band verification

New recorded snapshots capture only the selected standard or long-context band, including its one-hour rate, source and effective period. Existing snapshots are immutable; an older long-context snapshot without an explicit band remains unpriced. Current repricing can use newly configured rates without rewriting history.

Unit and PostgreSQL regressions cover both providers, separate cache lifetimes, missing/invalid rates, unknown tiers, effective periods and immutable replay. Session and turn rankings keep inconsistent cache counters separate so valid rows cannot mask an invalid row during aggregation. UI coverage includes add/edit/remove, unknown fields, context labels and stable input identity during typing. The comparison uses the actual upstream selected rates, including its one-hour category, solely as private verification input.
