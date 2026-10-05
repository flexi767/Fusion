---
"@runfusion/fusion": patch
---

summary: Re-reading a rewritten agent transcript now corrects turns already sent instead of keeping stale copies.
category: fix
dev: The collector spool kept a turn only when its parser revision rose, but parser revisions restart at 1 on a rescan, so a turn that a rescan split or shrank stayed stale (usage counted twice, mixed ordinals). Each pass now compares a turn's final state with the stored one, skips identical bodies and gives changed ones a revision above the stored one.
