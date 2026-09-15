import { afterAll, afterEach, beforeAll, beforeEach, expect, it } from "vitest";
import { createSharedPgTaskStoreTestHarness, pgDescribe } from "../../__test-utils__/pg-test-harness.js";
import { ExternalSessionStore } from "../../external-sessions/store.js";
import { ExternalSessionSummaries } from "../../external-sessions/summaries.js";
import { externalSessionAnalytics } from "../../external-sessions/analytics.js";
const at = "2026-09-15T12:00:00Z";
const metadata = { formatVersion: 5, snapshot: "a".repeat(64), sourceSessionId: "source", archived: true, pinned: false, sourceAliases: [{ sourceSessionId: "managed-alias", title: "Source alias", archived: true, pinned: false, status: "stopped", notes: "" }], conversations: [{ id: "thread", title: "Read-only summary", createdAt: at, totalMessages: 1, messages: [{ id: "message", role: "assistant", content: "Work remains unfinished.", at, contextSessionIds: ["source"], inputTokens: 100, outputTokens: 10 }] }] };
pgDescribe("Imported conversation history", () => {
  const h = createSharedPgTaskStoreTestHarness({ prefix: "fusion_session_conversations", projectId: "session-conversations-test" });
  beforeAll(h.beforeAll); beforeEach(h.beforeEach); afterEach(h.afterEach); afterAll(h.afterAll);
  it("preserves newer archive formats across delayed old metadata and never creates turns, task ownership or live heartbeats", async () => {
    const store = new ExternalSessionStore(h.layer()), summaries = new ExternalSessionSummaries(h.layer());
    for (const host of ["m3", "m5", "j"]) for (const provider of ["codex", "claude"]) {
      const observation = { version: 1, provider, nativeSessionId: "native", revision: 1, observedAt: at, activity: "waiting", title: "Imported", projectPath: "/repo" };
      const { id } = await store.ingest(host, "import", observation, [], true, undefined, metadata);
      await store.preferences(id, false, true, 0);
      await store.ingest(host, "old-import", observation, [], true, undefined, { ...metadata, formatVersion: undefined, conversations: undefined });
      const details = await summaries.get(id);
      expect(details).toMatchObject({ archived: false, pinned: true, taskId: null, nativeRuntime: null, importedMetadata: { formatVersion: 5, sourceAliases: [{ sourceSessionId: "managed-alias", archived: true }], conversations: [{ id: "thread" }] } });
      expect((await store.turns(id)).turns).toEqual([]);
      const analytics = await externalSessionAnalytics(h.layer(), { sessionId: id });
      expect(analytics.sessions).toEqual([]);
    }
    expect((await store.collectors()).every(row => row.lastHeartbeatAt === null)).toBe(true);
    expect((await store.list()).sessions).toHaveLength(6);
    expect(await h.store().listTasks()).toHaveLength(0);
  });
});
