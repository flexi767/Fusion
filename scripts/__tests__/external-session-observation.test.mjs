import test from "node:test";
import assert from "node:assert/strict";
import { parseSessionObservation, externalSessionKey, reconcileSessionObservation, collectorConnection } from "../../packages/core/src/external-sessions/observation.ts";

const row = { version: 1, provider: "codex", nativeSessionId: "native-1", revision: 10, observedAt: "2026-09-15T12:00:00.000Z", activity: "working", title: "Review", projectPath: "/workspace/project" };
test("identity includes host and provider even for the same native id", () => {
  assert.notEqual(externalSessionKey("a", "codex", "id"), externalSessionKey("b", "codex", "id"));
  assert.notEqual(externalSessionKey("a", "codex", "id"), externalSessionKey("a", "claude", "id"));
});
test("replayed and stale observations cannot replace newer activity", () => {
  const first = reconcileSessionObservation(null, "a", row, row.observedAt).snapshot;
  for (const revision of [9, 10]) {
    const result = reconcileSessionObservation(first, "a", { ...row, revision, activity: "completed" }, "2026-09-15T12:01:00Z");
    assert.equal(result.applied, false);
    assert.equal(result.snapshot, first);
  }
  assert.equal(reconcileSessionObservation(first, "a", { ...row, revision: 11, activity: "waiting" }, row.observedAt).snapshot.activity, "waiting");
  assert.throws(() => reconcileSessionObservation(first, "b", row, row.observedAt), /identity/);
});
test("payload cannot grant management or choose an authenticated host", () => {
  const parsed = parseSessionObservation({ ...row, hostId: "spoofed", taskId: "task", capabilities: ["stop"] });
  assert.equal("hostId" in parsed, false);
  assert.equal("taskId" in parsed, false);
  assert.equal("capabilities" in parsed, false);
});
test("rejects unsupported providers, versions, counters and malformed data", () => {
  for (const patch of [{ provider: "other" }, { version: 2 }, { revision: -1 }, { revision: 0.5 }, { revision: Number.MAX_SAFE_INTEGER + 1 }, { observedAt: "bad" }, { title: "x".repeat(513) }, { nativeSessionId: "" }, { activity: "running" }]) {
    assert.throws(() => parseSessionObservation({ ...row, ...patch }));
  }
});
test("disconnection does not invent a terminal activity", () => {
  assert.equal(collectorConnection(row.observedAt, Date.parse(row.observedAt) + 1000), "connected");
  assert.equal(collectorConnection(row.observedAt, Date.parse(row.observedAt) + 100000), "disconnected");
  assert.equal(collectorConnection(null, Date.now()), "disconnected");
  assert.equal(row.activity, "working");
});

test("reported telemetry preserves unknowns, validates counters and cannot grant capabilities", () => {
  const telemetry = { model: "fixture", contextTokens: 0, contextCapacity: null, serviceTier: "priority", observedAt: row.observedAt, capabilities: ["stop"] };
  const parsed = parseSessionObservation({ ...row, telemetry }).telemetry;
  assert.equal(parsed.contextTokens, 0); assert.equal(parsed.contextCapacity, null);
  assert.equal("capabilities" in parsed, false);
  for (const patch of [{ contextTokens: -1 }, { contextCapacity: 1.5 }, { observedAt: "2026-09-16T12:00:00Z" }]) {
    assert.throws(() => parseSessionObservation({ ...row, telemetry: { ...telemetry, ...patch } }));
  }
});
