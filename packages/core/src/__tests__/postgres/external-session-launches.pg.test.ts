import { afterAll, afterEach, beforeAll, beforeEach, expect, it } from "vitest";
import { createSharedPgTaskStoreTestHarness, pgDescribe } from "../../__test-utils__/pg-test-harness.js";
import { ExternalSessionLaunches } from "../../external-sessions/launches.js";
pgDescribe("Independent session launches", () => {
  const h = createSharedPgTaskStoreTestHarness({ prefix: "fusion_session_launches", projectId: "launch-test-project" });
  beforeAll(h.beforeAll); beforeEach(h.beforeEach); afterEach(h.afterEach); afterAll(h.afterAll);
  const generation = "generation-launch-1";
  const input = { id: "launch-request-12345", hostId: "m3", projectId: "project", generation, prompt: "Inspect the repository", model: null };
  it("requires an active exact host/project/runtime and commits one request across retries without enrolling tasks", async () => {
    const store = new ExternalSessionLaunches(h.layer()); const now = Date.now();
    await expect(store.queue(input, now)).rejects.toThrow("disconnected");
    expect(await store.register("m3", "project", generation, "/repo", now)).toBe(true);
    await expect(store.queue({ ...input, hostId: "m5" }, now)).rejects.toThrow("disconnected");
    await expect(store.queue({ ...input, projectId: "elsewhere" }, now)).rejects.toThrow("disconnected");
    const rows = await Promise.all([store, new ExternalSessionLaunches(h.layer())].map(s => s.queue(input, now)));
    expect(rows[0].id).toBe(rows[1].id); expect(await store.list(now)).toHaveLength(1);
    await expect(store.queue({ ...input, prompt: "Different" }, now)).rejects.toThrow("identity conflict");
    await expect(store.queue({ ...input, id: "another-launch-123", model: "bad\nmodel" }, now)).rejects.toThrow("Invalid");
    expect(await h.store().listTasks()).toHaveLength(0);
  });
  it("claims only once, fences takeover and preserves ambiguous starts without replay", async () => {
    const store = new ExternalSessionLaunches(h.layer()); const now = Date.now();
    await store.register("m3", "project", generation, "/repo", now); await store.queue(input, now);
    expect(await store.register("m3", "project", "replacement-runtime", "/repo", now)).toBe(false);
    expect(await store.begin("m5", "project", generation, now)).toBeNull();
    expect(await store.begin("m3", "project", "wrong-generation", now)).toBeNull();
    const claims = await Promise.all([store, new ExternalSessionLaunches(h.layer())].map(s => s.begin("m3", "project", generation, now)));
    expect(claims.filter(Boolean)).toHaveLength(1);
    expect(await store.cancel(input.id, "m3", now)).toBe(false);
    expect(await new ExternalSessionLaunches(h.layer()).begin("m3", "project", generation, now)).toBeNull();
    expect((await store.list(now + 300001))[0].status).toBe("unconfirmed after interruption");
    expect(await store.finish("m5", "project", generation, input.id, { status: "started", cliSessionId: "cli-owned" }, now)).toBe(false);
    expect(await store.finish("m3", "project", generation, input.id, { status: "started", cliSessionId: "cli-owned" }, now + 300001)).toBe(true);
    expect(await store.finish("m3", "project", generation, input.id, { status: "started", cliSessionId: "cli-owned" }, now + 300002)).toBe(true);
    expect(await store.finish("m3", "project", generation, input.id, { status: "failed" }, now)).toBe(false);
  });
  it("cancels queued launches and refuses expired or replaced runtime generations", async () => {
    const store = new ExternalSessionLaunches(h.layer()); const now = Date.now();
    await store.register("m3", "project", generation, "/repo", now); await store.queue(input, now);
    expect(await store.cancel(input.id, "m5", now)).toBe(false);
    expect(await store.cancel(input.id, "m3", now)).toBe(true);
    expect(await store.begin("m3", "project", generation, now)).toBeNull();
    await store.queue({ ...input, id: "another-request-12345" }, now);
    expect(await store.available(now + 90001)).toHaveLength(0);
    expect(await store.register("m3", "project", "replacement-runtime", "/repo", now + 90001)).toBe(true);
    expect(await store.owns("m3", "project", generation, now + 90001)).toBe(false);
    expect(await store.begin("m3", "project", generation, now + 90001)).toBeNull();
    expect(await store.begin("m3", "project", "replacement-runtime", now + 90001)).toBeNull();
    expect((await store.list(now + 300001)).find(row => row.id === "another-request-12345")?.status).toBe("expired");
  });
  it("bounds pending launches per host while allowing separate hosts", async () => {
    const store = new ExternalSessionLaunches(h.layer()); const now = Date.now();
    await store.register("m3", "project", generation, "/repo", now); await store.register("j", "project", generation, "/repo", now);
    for (let i = 0; i < 5; i++) await store.queue({ ...input, id: `bounded-request-${i}` }, now);
    await expect(store.queue(input, now)).rejects.toThrow("queue is full");
    expect((await store.queue({ ...input, hostId: "j" }, now)).hostId).toBe("j");
  });
});
