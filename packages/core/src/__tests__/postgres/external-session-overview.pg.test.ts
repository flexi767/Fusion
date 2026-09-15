import { afterAll, afterEach, beforeAll, beforeEach, expect, it, vi } from "vitest";
import { createSharedPgTaskStoreTestHarness, pgDescribe } from "../../__test-utils__/pg-test-harness.js";
import { ExternalSessionStore } from "../../external-sessions/store.js";
import { ExternalSessionSummaries } from "../../external-sessions/summaries.js";
const at = "2026-09-15T12:00:00.000Z";
const observation = { version: 1, provider: "codex", nativeSessionId: "native", revision: 1, observedAt: at, activity: "waiting", title: "Recent work", projectPath: "/repo" };
const turn = { id: "turn", startedAt: at, updatedAt: at, completedAt: null, prompts: ["Check failures"], response: "Tests failed; remediation is unfinished.", toolCalls: 1, files: [], usage: [] };
pgDescribe("Recent session overview", () => {
  const h = createSharedPgTaskStoreTestHarness({ prefix: "fusion_session_overview", projectId: "session-overview-test" });
  beforeAll(h.beforeAll); beforeEach(h.beforeEach); afterEach(h.afterEach); afterAll(h.afterAll);
  it("bounds all-host results by native activity while late old imports cannot displace recent work", async () => {
    const store = new ExternalSessionStore(h.layer()), summaries = new ExternalSessionSummaries(h.layer());
    expect(await summaries.overview()).toEqual([]);
    const ids: string[] = [];
    for (const [i, host] of ["m3", "m5", "j", "m3", "m5", "j"].entries()) ids.push((await store.ingest(host, "test", { ...observation, nativeSessionId: `native-${i}`, provider: i % 2 ? "claude" : "codex", observedAt: `2026-09-15T12:00:0${i}Z` }, [])).id);
    await store.ingest("m5", "import", { ...observation, nativeSessionId: "old", observedAt: "2026-01-01T00:00:00Z" }, [], true);
    const rows = await summaries.overview();
    expect(rows.map(row => row.id)).toEqual(ids.slice(1).reverse());
    expect(new Set(rows.map(row => row.hostId))).toEqual(new Set(["m3", "m5", "j"]));
    expect(rows.every(row => row.summary === null && !row.summaryStale)).toBe(true);
    expect(await h.store().listTasks()).toHaveLength(0);
  });
  it("detects changed content within the same covered turn and preserves a previous summary during outages", async () => {
    const store = new ExternalSessionStore(h.layer()), summaries = new ExternalSessionSummaries(h.layer());
    const { id } = await store.ingest("m3", "test", observation, [turn]);
    const send = vi.fn(async () => new Response(JSON.stringify({ choices: [{ message: { content: "Tests failed; fixes remain unfinished." } }] })));
    expect(await summaries.summarize(id, "http://fixture/v1", send)).toEqual({ changed: true });
    expect(await summaries.state(id)).toMatchObject({ summaryStale: false, summary: { lastTurn: "turn", coveredTurns: 1 } });
    await store.ingest("m3", "test", { ...observation, revision: 2 }, [{ ...turn, updatedAt: "2026-09-15T12:01:00Z", response: "Another failed check; still unfinished." }]);
    expect((await summaries.overview())[0]).toMatchObject({ summaryStale: true, summary: { text: "Tests failed; fixes remain unfinished." } });
    await summaries.summarize(id, "http://fixture/v1", async () => { throw new Error("offline"); });
    expect((await summaries.overview())[0]).toMatchObject({ summaryStale: true, lastSummaryError: "summary-endpoint-unavailable", summary: { text: "Tests failed; fixes remain unfinished." } });
    expect(send).toHaveBeenCalledTimes(1);
  });
});
