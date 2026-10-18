/**
 * FNXC:SlimLogWindow 2026-10-18-14:30:
 * Slim board lists read a trimmed task log. The trim must keep every entry a slim-path signal can
 * read (timing entries, the stall windows, the last and newest entries, unparseable timestamps) so
 * timedExecutionMs, stalledReview and inReviewStalled match a full-log read exactly.
 */
import { afterAll, afterEach, beforeAll, beforeEach, expect, it } from "vitest";
import {
  pgDescribe,
  createSharedPgTaskStoreTestHarness,
  type SharedPgTaskStoreHarness,
} from "../../__test-utils__/pg-test-harness.js";
import { readLiveTaskRows } from "../../task-store/async/async-persistence.js";
import { STALLED_REVIEW_REENQUEUE_PATTERN } from "../../tasks/stalled-review-detector.js";

const HOUR = 60 * 60 * 1000;
const iso = (msAgo: number) => new Date(Date.now() - msAgo).toISOString();

pgDescribe("slim list log window (PostgreSQL)", () => {
  const h: SharedPgTaskStoreHarness = createSharedPgTaskStoreTestHarness({ prefix: "fusion_slim_log" });

  beforeAll(h.beforeAll);
  afterAll(h.afterAll);
  beforeEach(async () => { await h.beforeEach(); });
  afterEach(async () => { await h.afterEach(); });

  async function setLog(id: string, log: unknown[]): Promise<void> {
    const sql = h.adminSql();
    await sql`update project.tasks set log = ${JSON.stringify(log)}::jsonb where id = ${id}`;
  }

  async function readLog(id: string, since: string): Promise<Array<{ action: string }>> {
    const rows = await readLiveTaskRows(h.layer(), { logSince: since });
    const row = rows.find((r) => r.id === id)!;
    const log = typeof row.log === "string" ? JSON.parse(row.log) : row.log;
    return log as Array<{ action: string }>;
  }

  it("keeps exactly the entries slim-path signals can read", async () => {
    const task = await h.store().createTask({ description: "trim me", column: "in-review" });
    await setLog(task.id, [
      { timestamp: iso(240 * HOUR), action: "old ordinary" },
      { timestamp: iso(239 * HOUR), action: "[timing] step took 1200ms" },
      { timestamp: iso(238 * HOUR), action: "old outcome", outcome: "[timing] 300ms" },
      { timestamp: "2026-01-01 10:00:00+02", action: "odd timestamp" },
      { action: "no timestamp" },
      { timestamp: iso(2 * HOUR), action: "recent" },
      { timestamp: iso(100 * HOUR), action: "last but old" },
    ]);

    const kept = await readLog(task.id, iso(24 * HOUR));

    expect(kept.map((e) => e.action)).toEqual([
      "[timing] step took 1200ms",
      "old outcome",
      "odd timestamp",
      "no timestamp",
      "recent",
      "last but old",
    ]);
  });

  it("keeps the newest-timestamp entry even when it is not last", async () => {
    const task = await h.store().createTask({ description: "out of order", column: "todo" });
    await setLog(task.id, [
      { timestamp: iso(300 * HOUR), action: "oldest" },
      { timestamp: iso(50 * HOUR), action: "newest" },
      { timestamp: iso(200 * HOUR), action: "last" },
    ]);

    expect((await readLog(task.id, iso(24 * HOUR))).map((e) => e.action)).toEqual(["newest", "last"]);
  });

  it("derives the same timing and stall signals as a full-log read", async () => {
    const store = h.store();
    const review = await store.createTask({ description: "churning review", column: "in-review" });
    const idle = await store.createTask({ description: "idle review", column: "in-review" });
    const done = await store.createTask({ description: "timed work", column: "todo" });
    await setLog(review.id, [
      { timestamp: iso(500 * HOUR), action: "ancient" },
      ...[50, 40, 30, 20].map((m) => ({ timestamp: iso(m * 60_000), action: `${STALLED_REVIEW_REENQUEUE_PATTERN} attempt` })),
    ]);
    await setLog(idle.id, [
      { timestamp: iso(400 * HOUR), action: "long ago" },
      { timestamp: iso(30 * HOUR), action: "last activity" },
    ]);
    await setLog(done.id, [
      { timestamp: iso(900 * HOUR), action: "[timing] build 700ms" },
      { timestamp: iso(800 * HOUR), action: "noise" },
      { timestamp: iso(1 * HOUR), action: "x", outcome: "[timing] test 50ms" },
    ]);

    const slim = await store.listTasks({ slim: true, includeArchived: false });
    const full = await store.listTasks({ slim: false, includeArchived: false });
    for (const task of full) {
      const s = slim.find((t) => t.id === task.id)!;
      expect(s.log).toEqual([]);
      expect(s.timedExecutionMs).toBe(store.computeTimedExecutionMs(task.log));
      expect(s.stalledReview).toEqual(task.stalledReview);
      expect(s.inReviewStalled).toEqual(task.inReviewStalled);
      expect(s.ageStaleness).toEqual(task.ageStaleness);
    }
    expect(slim.find((t) => t.id === done.id)?.timedExecutionMs).toBe(750);
    expect(slim.find((t) => t.id === review.id)?.stalledReview).toBeDefined();
  });
});
