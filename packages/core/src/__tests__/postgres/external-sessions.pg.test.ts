import { afterAll, afterEach, beforeAll, beforeEach, expect, it } from "vitest";
import { createSharedPgTaskStoreTestHarness, pgDescribe } from "../../__test-utils__/pg-test-harness.js";
import { ExternalSessionStore } from "../../external-sessions/store.js";
const observation = { version: 1, provider: "codex", nativeSessionId: "native-1", revision: 10, observedAt: "2026-09-15T12:00:00.000Z", activity: "working", title: "Review", projectPath: "/workspace/project" };
pgDescribe("External session durable ingestion", () => {
  const h = createSharedPgTaskStoreTestHarness({ prefix: "fusion_external_sessions", projectId: "external-session-test" });
  beforeAll(h.beforeAll); beforeEach(h.beforeEach); afterEach(h.afterEach); afterAll(h.afterAll);
  it("keeps the newest revision under concurrent replay and does not create tasks", async () => {
    const store = new ExternalSessionStore(h.layer());
    const results = await Promise.all([12, 9, 11, 10].map(revision => store.ingest("m3", "test", { ...observation, revision })));
    const row = await new ExternalSessionStore(h.layer()).get(results[0].id);
    expect(row?.revision).toBe(12);
    const retry = await store.ingest("m3", "test", { ...observation, revision: 12 });
    expect(retry.applied).toBe(false);
    expect((await store.get(retry.id))?.receivedAt).toBe(row?.receivedAt);
    await expect(store.ingest("m3", "test", { ...observation, revision: 12, title: "conflict" })).rejects.toThrow("revision conflict");
    expect(await h.store().listTasks()).toHaveLength(0);
  });
  it("isolates hosts/providers, persists heartbeat separately, and paginates without duplicates", async () => {
    const store = new ExternalSessionStore(h.layer());
    for (const host of ["m3", "m5", "J"]) for (const provider of ["codex", "claude"]) await store.ingest(host, "test", { ...observation, provider });
    const a = await store.list({ limit: 3 });
    const b = await store.list({ limit: 3, before: a.nextCursor! });
    expect(new Set([...a.sessions, ...b.sessions].map(row => row.id)).size).toBe(6);
    expect(b.nextCursor).toBeNull();
    expect((await store.list({ hostId: "m5", provider: "claude" })).sessions).toHaveLength(1);
    await store.heartbeat("m3", "test-2");
    expect((await store.collectors()).find(row => row.hostId === "m3")?.collectorVersion).toBe("test-2");
    expect((await store.list({ hostId: "m3" })).sessions.every(row => row.observation.activity === "working")).toBe(true);
  });
  it("commits history with its acknowledgement and rejects stale patches on replay", async () => {
    const store = new ExternalSessionStore(h.layer());
    const turn = { id: "t", startedAt: observation.observedAt, updatedAt: observation.observedAt, completedAt: null,
      durationMs: null, durationSource: "timestamps", prompts: ["Prompt"], response: "New result", toolCalls: 1,
      usage: [], files: [{ path: "a.ts", diff: "+new", added: 1, removed: 0, truncated: false }] };
    const ack = await store.ingest("m3", "test", observation, [turn]);
    await store.ingest("m3", "test", { ...observation, revision: 9 }, [{ ...turn, response: "Old result" }]);
    expect((await store.turns(ack.id)).turns[0].response).toBe("New result");
    await expect(store.ingest("m3", "test", { ...observation, revision: 11 }, [{ ...turn, files: [{ ...turn.files[0], path: "../private" }] }])).rejects.toThrow("Invalid turn file path");
    expect((await store.get(ack.id))?.revision).toBe(10);
    expect((await store.turns(ack.id)).turns).toHaveLength(1);
  });

  it("historical imports fill missing turns without overwriting live activity or results", async () => {
    const store = new ExternalSessionStore(h.layer());
    const turn = { id: "live", startedAt: observation.observedAt, updatedAt: observation.observedAt, completedAt: null, durationMs: null, prompts: ["Live"], response: "Newer live result", files: [], usage: [], toolCalls: 0 };
    const { id } = await store.ingest("m3", "test", observation, [turn]);
    await store.ingest("m3", "import", { ...observation, revision: 1000, title: "Old archive", activity: "completed" }, [{ ...turn, response: "Old archive result" }, { ...turn, id: "archived" }], true);
    expect((await store.get(id))?.observation.title).toBe("Review");
    expect((await store.turns(id)).turns.find(row => row.id === "live")?.response).toBe("Newer live result");
    expect((await store.turns(id)).turns.find(row => row.id === "archived")?.provenance).toBe("agentpulse-import");
  });

});
