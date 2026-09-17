import { beforeAll, beforeEach, afterEach, afterAll, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import { createSharedPgTaskStoreTestHarness, pgDescribe } from "../../__test-utils__/pg-test-harness.js";
import { ExternalSessionStore } from "../../external-sessions/store.js";
import { applySchemaBaseline } from "../../postgres/schema-applier.js";

const at = "2026-09-17T00:00:00.000Z";
const later = "2026-09-17T01:00:00.000Z";
const observation = { provider: "codex", nativeSessionId: "native", revision: 2, observedAt: at,
  activity: "working", title: "Inspect repository", projectPath: "/repo", capabilities: [] };
const delivery = (sequence = 1, changes = {}) => ({ version: 1, eventId: `event-${sequence}`, streamId: "stream-1",
  sequence, collectorVersion: "1.0", kind: "observation", observation, ...changes });

pgDescribe("external session ingestion durability", () => {
  const harness = createSharedPgTaskStoreTestHarness({ prefix: "fusion_external_ingest_pr1" });
  beforeAll(harness.beforeAll);
  beforeEach(harness.beforeEach);
  afterEach(harness.afterEach);
  afterAll(harness.afterAll);
  const store = () => new ExternalSessionStore(harness.layer());

  it("commits once across concurrent replay and a new store instance", async () => {
    const results = await Promise.all([store().ingest("m3", delivery(), at), store().ingest("m3", delivery(), at)]);
    expect(results[0]).toEqual(results[1]);
    expect(await store().ingest("m3", delivery(), later)).toEqual(results[0]);
    expect((await store().list()).sessions).toHaveLength(1);
    expect((await store().list()).sessions[0].receivedAt).toBe(at);
    const receipts = await harness.layer().db.execute(sql`SELECT count(*)::int AS count FROM central.external_session_receipts`);
    expect(receipts[0].count).toBe(1);
    expect((await store().collectors())[0].lastAcknowledgementAt).toBe(at);
  });

  it("acknowledges stale state while retaining newer snapshots and receipt time", async () => {
    await store().ingest("m3", delivery(), at);
    expect(await store().ingest("m3", delivery(2, { observation: { ...observation, revision: 1, activity: "completed" } }), later))
      .toMatchObject({ acknowledged: true, sequence: 2, outcome: "stale" });
    expect((await store().list()).sessions[0]).toMatchObject({ receivedAt: at, observation: { revision: 2, activity: "working" } });
    expect(await store().ingest("m3", delivery(3), later)).toMatchObject({ outcome: "unchanged" });
  });

  it("rejects event reuse, sequence reuse, gaps and equal-revision changes without advancing the cursor", async () => {
    await store().ingest("m3", delivery(), at);
    await expect(store().ingest("m3", delivery(2, { eventId: "event-1" }))).rejects.toThrow("Event identity conflict");
    await expect(store().ingest("m3", delivery(1, { eventId: "other" }))).rejects.toThrow("Delivery sequence");
    await expect(store().ingest("m3", delivery(3))).rejects.toThrow("Delivery sequence");
    await expect(store().ingest("m3", delivery(2, { observation: { ...observation, title: "different" } }))).rejects.toThrow("Observation revision conflict");
    expect(await store().ingest("m3", delivery(2))).toMatchObject({ sequence: 2, outcome: "unchanged" });
  });

  it("isolates native identity across three hosts and providers", async () => {
    for (const host of ["m3", "m5", "J"]) {
      for (const provider of ["codex", "claude"]) {
        await store().ingest(host, delivery(provider === "codex" ? 1 : 2, { observation: { ...observation, provider } }));
      }
    }
    expect((await store().list()).sessions).toHaveLength(6);
    expect((await store().list({ hostId: "J", provider: "claude" })).sessions).toHaveLength(1);
    expect(await harness.layer().db.execute(sql`SELECT count(*)::int AS count FROM project.tasks`)).toMatchObject([{ count: 0 }]);
  });

  it("supports a new spool stream without resetting session revision", async () => {
    await store().ingest("m3", delivery());
    expect(await store().ingest("m3", delivery(1, { streamId: "stream-2", eventId: "new-spool",
      observation: { ...observation, revision: 0 } }))).toMatchObject({ sequence: 1, outcome: "stale" });
    expect((await store().list()).sessions[0].observation.revision).toBe(2);
  });

  it("only fresh explicit heartbeats refresh connectivity", async () => {
    await store().ingest("m3", delivery(), at);
    expect((await store().collectors(Date.parse(at)))[0]).toMatchObject({ connection: "disconnected", lastHeartbeatAt: null });
    const heartbeat = delivery(2, { kind: "heartbeat", observation: undefined });
    await store().ingest("m3", heartbeat, at);
    expect((await store().collectors(Date.parse(at)))[0].connection).toBe("connected");
    await store().ingest("m3", heartbeat, later);
    expect((await store().collectors(Date.parse(later)))[0].connection).toBe("disconnected");
    expect((await store().list()).sessions[0].observation.activity).toBe("working");
  });

  it("rolls back snapshot, collector and stream if the durable receipt cannot be written", async () => {
    await harness.layer().db.execute(sql`ALTER TABLE central.external_session_receipts ADD CONSTRAINT reject_test_receipt CHECK (event_id <> 'event-1')`);
    try {
      await expect(store().ingest("m3", delivery())).rejects.toThrow();
      expect((await store().list()).sessions).toEqual([]);
      expect(await store().collectors()).toEqual([]);
      expect(await harness.layer().db.execute(sql`SELECT * FROM central.external_session_streams`)).toHaveLength(0);
    } finally {
      await harness.layer().db.execute(sql`ALTER TABLE central.external_session_receipts DROP CONSTRAINT reject_test_receipt`);
    }
    expect(await store().ingest("m3", delivery())).toMatchObject({ outcome: "applied", sequence: 1 });
  });

  it("redacts display metadata and paginates without duplicate identities", async () => {
    await store().ingest("m3", delivery(1, { observation: { ...observation, title: "token=very-secret", projectPath: "/repo?password=very-secret" } }));
    await store().ingest("m3", delivery(2, { observation: { ...observation, nativeSessionId: "second" } }));
    const first = await store().list({ limit: 1 });
    const second = await store().list({ limit: 1, after: first.nextCursor! });
    expect(first.sessions[0].id).not.toBe(second.sessions[0].id);
    expect(second.nextCursor).toBeNull();
    expect(JSON.stringify((await store().list()).sessions)).not.toContain("very-secret");
    await expect(store().list({ limit: 101 })).rejects.toThrow("Invalid limit");
  });

  it("upgrades a 0078 schema and preserves records on repeated migration", async () => {
    await harness.layer().db.execute(sql`DROP TABLE central.external_session_receipts, central.external_session_streams, central.external_session_collectors, central.external_sessions`);
    await harness.layer().db.execute(sql`DELETE FROM public.fusion_schema_migrations WHERE version = '0079'`);
    expect(await applySchemaBaseline(harness.layer().db)).toMatchObject({ applied: true });
    await store().ingest("m3", delivery());
    await applySchemaBaseline(harness.layer().db);
    expect((await store().list()).sessions).toHaveLength(1);
  });

  it.each([
    ["accepted_deliveries", 1_000_000, delivery(2), "delivery"],
    ["session_count", 10_000, delivery(2, { observation: { ...observation, nativeSessionId: "new" } }), "session"],
    ["stream_count", 100, delivery(1, { streamId: "new-stream", eventId: "new-event" }), "stream"],
  ] as const)("bounds durable %s while preserving accepted replay", async (column, value, pending, category) => {
    const accepted = await store().ingest("m3", delivery(), at);
    await harness.layer().db.execute(sql`UPDATE central.external_session_collectors SET ${sql.identifier(column)} = ${value} WHERE host_id = 'm3'`);
    await expect(store().ingest("m3", pending)).rejects.toThrow(`Collector ${category} capacity reached`);
    expect(await store().ingest("m3", delivery(), later)).toEqual(accepted);
    expect((await store().list()).sessions).toHaveLength(1);
  });
});
