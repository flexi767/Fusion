---
"@runfusion/fusion": patch
---

summary: Meta (Muse) shows its own icon instead of the generic unknown-provider chip.
category: fix
dev: FN-9340 added `meta` to both static auth catalogs without a ProviderIcon entry, so it fell through to the Lucide Cpu fallback. Adds MetaIcon, the `--provider-meta` token, and the registry entry.
