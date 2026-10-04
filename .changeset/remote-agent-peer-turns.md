---
"@runfusion/fusion": patch
---

summary: A Claude turn started by a message from another session now appears as its own remote-agent turn.
category: fix
dev: The collector's Claude parser skipped every `isMeta` user record, including messages from another session (`origin.kind: "peer"`), so that turn's tools and answer merged into the previous turn and kept its old end time.
