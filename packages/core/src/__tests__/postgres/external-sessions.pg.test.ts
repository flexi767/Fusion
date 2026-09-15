import { afterAll, afterEach, beforeAll, beforeEach, expect, it } from "vitest";
import { createSharedPgTaskStoreTestHarness, pgDescribe } from "../../__test-utils__/pg-test-harness.js";
import { ExternalSessionStore } from "../../external-sessions/store.js";
import { externalSessionAnalytics } from "../../external-sessions/analytics.js";
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
    await expect(store.ingest("m3", "test", { ...observation, revision: 11 }, [{ ...turn, files: [{ ...turn.files[0], path: "\ninvalid" }] }])).rejects.toThrow("Invalid turn file path");
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
    await store.ingest("m3", "test", { ...observation, revision: 11 }, [{ ...turn, id: "archived", response: "Partial native backfill", updatedAt: "2026-09-15T11:59:00Z" }]);
    expect((await store.turns(id)).turns.find(row => row.id === "archived")?.response).toBe("Newer live result");
    await store.ingest("m3", "test", { ...observation, revision: 12 }, [{ ...turn, id: "archived", response: "Later native result", updatedAt: "2026-09-15T12:01:00Z" }]);
    expect((await store.turns(id)).turns.find(row => row.id === "archived")?.response).toBe("Later native result");
  });

  it("searches historical output across pages without duplicate cards and keeps host filters", async () => {
    const store = new ExternalSessionStore(h.layer());
    const turn = { id: "one", startedAt: observation.observedAt, updatedAt: observation.observedAt, prompts: ["Investigate"], response: "Zebra deployment failed", files: [], usage: [] };
    const first = await store.ingest("m3", "test", observation, [turn, { ...turn, id: "two" }]);
    await store.ingest("j", "test", observation, [turn]);
    await store.ingest("m3", "test", { ...observation, nativeSessionId: "unrelated" }, [{ ...turn, response: "All done" }]);
    const matches = await store.list({ q: "zebra", limit: 1 });
    const older = await store.list({ q: "zebra", limit: 1, before: matches.nextCursor! });
    expect(new Set([...matches.sessions, ...older.sessions].map(row => row.id)).size).toBe(2);
    expect(older.nextCursor).toBeNull();
    expect((await store.list({ q: "zebra", hostId: "m3", activity: "working" })).sessions.map(row => row.id)).toEqual([first.id]);
    expect((await store.list({ q: "zebra", activity: "completed" })).sessions).toHaveLength(0);
  });

  it("totals every collected turn without replay inflation and separates missing prices", async () => {
    const store = new ExternalSessionStore(h.layer());
    const usage = { model: "fixture", inputTokens: 100, cachedInputTokens: 20, cacheWriteTokens: 0, cacheWriteHourTokens: 0, outputTokens: 10, requests: 1 };
    const turn = { id: "one", startedAt: observation.observedAt, updatedAt: observation.observedAt, prompts: [], response: "", files: [], usage: [usage] };
    const { id } = await store.ingest("m3", "test", observation, [turn, { ...turn, id: "two" }, { ...turn, id: "unknown", usage: [{ ...usage, inputTokens: null }] }, { ...turn, id: "missing", usage: [] }]);
    await store.ingest("m3", "test", observation, [turn]);
    await store.ingest("j", "test", observation, [turn]);
    const prices = { "openai:fixture": { inputPer1M: 2, cacheReadPer1M: 1, cacheWritePer1M: 3, outputPer1M: 4, source: "fixture" } };
    const result = await externalSessionAnalytics(h.layer(), { host: "m3" }, prices);
    expect((await externalSessionAnalytics(h.layer(), { sessionIds: [id] }, prices)).sessions.map(row => row.id)).toEqual([id]);
    expect((await externalSessionAnalytics(h.layer(), { sessionIds: [] }, prices)).sessions).toHaveLength(0);
    const ranked = await externalSessionAnalytics(h.layer(), { sessionId: id, groupBy: "turn" }, prices);
    expect(ranked.sessions).toHaveLength(4);
    expect(ranked.sessions.find(row => row.turnId === "one")?.usd).toBeCloseTo(0.00022, 12);
    expect(new Set(ranked.sessions.map(row => row.turnId)).size).toBe(4);
    expect(await store.turn(id, "one")).toMatchObject({ id: "one" });
    expect(await store.turn("another-session", "one")).toBeNull();
    const smallPage = await store.turns(id, undefined, 20, 1);
    expect(smallPage.turns).toHaveLength(1);
    const nextPage = await store.turns(id, smallPage.nextCursor!, 20, 1);
    expect(nextPage.turns).toHaveLength(1);
    expect(nextPage.turns[0].id).not.toBe(smallPage.turns[0].id);
    expect(result.truncated).toBe(false);
    expect(result.sessions).toHaveLength(1);
    expect(result.sessions[0]).toMatchObject({ id, turns: 4, unreportedTurns: 1, unpricedRows: 1, requests: 3, inputTokens: null, outputTokens: 30 });
    expect(result.sessions[0].usd).toBeCloseTo(0.00044, 12);
    expect((await externalSessionAnalytics(h.layer(), { from: "2026-09-16T00:00:00Z" }, prices)).sessions).toHaveLength(0);
    expect((await externalSessionAnalytics(h.layer(), { sessionId: id, model: "fixture" }, prices)).sessions[0].turns).toBe(3);
  });

  it("historical imports neither invent nor refresh live collector connectivity", async () => {
    const store = new ExternalSessionStore(h.layer());
    await store.ingest("archive-only", "import", observation, [], true);
    expect((await store.collectors()).find(row => row.hostId === "archive-only")?.lastHeartbeatAt).toBeNull();
    await store.ingest("m3", "native", observation);
    const heartbeat = (await store.collectors()).find(row => row.hostId === "m3")?.lastHeartbeatAt;
    await store.ingest("m3", "import", { ...observation, nativeSessionId: "historical" }, [], true);
    expect((await store.collectors()).find(row => row.hostId === "m3")?.lastHeartbeatAt).toBe(heartbeat);
  });

  it("keeps the newest turn across native/import arrival order for both providers", async () => {
    const store = new ExternalSessionStore(h.layer());
    const partial = { id: "partial", startedAt: observation.observedAt, updatedAt: observation.observedAt, prompts: ["Repair"], response: "", files: [], usage: [] };
    const complete = { ...partial, updatedAt: "2026-09-15T12:01:00.000Z", completedAt: "2026-09-15T12:01:00.000Z", response: "Repair failed", files: [{ path: "../shared.ts", diff: "+repair", added: 1, removed: 0 }] };
    for (const provider of ["codex", "claude"]) for (const importFirst of [false, true]) {
      const row = { ...observation, provider, nativeSessionId: `${provider}-${importFirst}` };
      let id: string;
      if (importFirst) {
        ({ id } = await store.ingest("m3", "import", row, [complete], true));
        await store.ingest("m3", "native", row, [partial]);
      } else {
        ({ id } = await store.ingest("m3", "native", row, [partial]));
        await store.ingest("m3", "import", row, [complete], true);
      }
      await store.ingest("m3", "native", { ...row, revision: 11 }, [partial]);
      expect((await store.turns(id)).turns).toHaveLength(1);
      expect((await store.turns(id)).turns[0]).toMatchObject({ response: "Repair failed", completedAt: complete.completedAt, files: [{ path: "../shared.ts", added: 1 }] });
      expect((await store.get(id))?.observation.activity).toBe("working");
    }
  });

  it("preserves archived snapshot metadata and never overwrites operator labels on replay", async () => {
    const store = new ExternalSessionStore(h.layer());
    const imported = { snapshot: "a".repeat(64), sourceSessionId: "old", archived: true, pinned: false, model: "fixture", usage: [] };
    const { id } = await store.ingest("j", "import", observation, [], true, undefined, imported);
    expect((await store.list({ saved: "archived" })).sessions.map(row => row.id)).toEqual([id]);
    await store.preferences(id, false, true, 0);
    await store.ingest("j", "import", observation, [], true, undefined, imported);
    expect((await store.list({ saved: "archived" })).sessions).toHaveLength(0);
    expect((await store.list({ saved: "pinned" })).sessions.map(row => row.id)).toEqual([id]);
    await expect(store.preferences(id, true, false, 0)).rejects.toThrow("revision conflict");
    expect((await store.get(id))?.observation.activity).toBe("working");
  });

  it("records server-owned rates atomically and preserves them across updates and process recreation", async () => {
    const store = new ExternalSessionStore(h.layer());
    const usage = { model: "fixture", inputTokens: 100, cachedInputTokens: 20, cacheWriteTokens: 0, cacheWriteHourTokens: 0, outputTokens: 10, requests: 1 };
    const turn = { id: "priced", startedAt: observation.observedAt, updatedAt: observation.observedAt, prompts: [], response: "", files: [], usage: [usage], recordedPricing: [{ version: "spoofed" }] };
    const prices = { "openai:fixture": { inputPer1M: 2, cacheReadPer1M: 1, cacheWritePer1M: 3, outputPer1M: 4, source: "fixture" } };
    const { id } = await store.ingest("m3", "native", observation, [turn], false, undefined, undefined, prices);
    const first = (await store.turn(id, "priced"))!.recordedPricing![0];
    expect(first.version).toMatch(/^[a-f0-9]{64}$/);
    const changedPrices = { "openai:fixture": { ...prices["openai:fixture"], inputPer1M: 20 } };
    await new ExternalSessionStore(h.layer()).ingest("m3", "native", { ...observation, revision: 11 }, [{ ...turn, updatedAt: "2026-09-15T12:01:00Z" }], false, undefined, undefined, changedPrices);
    expect((await store.turn(id, "priced"))!.recordedPricing![0]).toEqual(first);
    const recorded = await externalSessionAnalytics(h.layer(), { sessionId: id, basis: "recorded" }, changedPrices);
    const current = await externalSessionAnalytics(h.layer(), { sessionId: id }, changedPrices);
    expect(recorded.sessions[0].usd).toBeCloseTo(0.00022, 12);
    expect(current.sessions[0].usd).toBeCloseTo(0.00166, 12);
    expect(recorded.sessions[0].usage[0].rateVersion).toBe(first.version);
  });

  it("groups recorded rates across capture times without pricing turns outside their effective period", async () => {
    const store = new ExternalSessionStore(h.layer());
    const usage = { model: "fixture", inputTokens: 100, cachedInputTokens: 20, cacheWriteTokens: 0, cacheWriteHourTokens: 0, outputTokens: 10, requests: 1 };
    const prices = { "openai:fixture": { inputPer1M: 2, cacheReadPer1M: 1, cacheWritePer1M: 3, outputPer1M: 4, source: "fixture", effectiveFrom: "2026-09-15T00:00:00Z", effectiveUntil: "2026-09-16T00:00:00Z" } };
    let sessionId = "";
    for (const [index, startedAt] of ["2026-09-14T12:00:00Z", "2026-09-15T12:00:00Z", "2026-09-15T13:00:00Z", "2026-09-16T00:00:00Z"].entries()) {
      const turn = { id: String(index), startedAt, updatedAt: startedAt, prompts: [], response: "", files: [], usage: [usage] };
      ({ id: sessionId } = await store.ingest("m3", "native", { ...observation, revision: 10 + index }, [turn], false, undefined, undefined, prices));
    }
    const ranked = await externalSessionAnalytics(h.layer(), { sessionId, basis: "recorded" });
    expect(ranked.sessions[0].turns).toBe(4);
    expect(ranked.sessions[0].usage).toHaveLength(2);
    expect(ranked.sessions[0].unpricedRows).toBe(1);
    expect(ranked.sessions[0].usd).toBeCloseTo(0.00044, 12);
    expect(ranked.sessions[0].requests).toBe(4);
    const turns = await externalSessionAnalytics(h.layer(), { sessionId, basis: "recorded", groupBy: "turn" });
    expect(turns.sessions.filter(row => row.usd === null).map(row => row.turnId).sort()).toEqual(["0", "3"]);
  });

});
