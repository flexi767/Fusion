---
"@runfusion/fusion": patch
---

summary: Slim board lists no longer read every task's full log history.
category: performance
dev: readLiveTaskRows takes a logSince window, and slim listTasks uses it to select only the log entries its derived signals read (timing entries, the stall windows, the last and newest entries).
