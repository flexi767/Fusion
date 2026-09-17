import { describe, expect, it } from "vitest";
import { externalCollectorConnection, externalSessionDigest, externalSessionId, parseExternalSessionDelivery,
  parseExternalSessionObservation } from "../external-sessions/contract.js";

const observation = { provider: "codex", nativeSessionId: "native/one", revision: 0,
  observedAt: "2026-09-17T00:00:00.000Z", activity: "working", title: "Inspect repository",
  projectPath: null, capabilities: [] };
const delivery = { version: 1, eventId: "event-1", streamId: "stream-1", sequence: 1,
  collectorVersion: "1.0", kind: "observation", observation };

describe("external session contract", () => {
  it.each(["codex", "claude", "future-provider"])("supports %s without enrolling observations as tasks", provider => {
    expect(parseExternalSessionDelivery({ ...delivery, observation: { ...observation, provider } }))
      .toEqual({ ...delivery, observation: { ...observation, provider } });
  });

  it.each([
    { version: 2 }, { hostId: "forged" }, { taskId: "FN-1" }, { sequence: 0 },
    { sequence: Number.MAX_SAFE_INTEGER + 1 }, { eventId: "../file" }, { streamId: "" },
    { kind: "heartbeat", observation }, { kind: "command" }, { observation: undefined },
  ])("refuses invalid or privilege-bearing envelopes %j", change => {
    expect(() => parseExternalSessionDelivery({ ...delivery, ...change })).toThrow();
  });

  it.each([
    { revision: -1 }, { revision: 0.5 }, { observedAt: "2026-02-30T00:00:00.000Z" },
    { observedAt: "2026-09-17T00:00:00Z" }, { activity: "disconnected" }, { title: "secret\u0000" },
    { projectPath: "x".repeat(4097) }, { capabilities: ["full-control"] },
    { capabilities: ["stop", "stop"] }, { origin: "managed" }, { nativeSessionId: "" },
  ])("refuses invalid observation %j", change => {
    expect(() => parseExternalSessionObservation({ ...observation, ...change })).toThrow();
  });

  it("canonicalizes key and capability order for exact replay", () => {
    const first = parseExternalSessionDelivery({ ...delivery, observation: { ...observation, capabilities: ["resume", "stop"] } });
    const second = parseExternalSessionDelivery({ kind: "observation", collectorVersion: "1.0", sequence: 1,
      streamId: "stream-1", eventId: "event-1", version: 1,
      observation: { ...observation, capabilities: ["stop", "resume"] } });
    expect(externalSessionDigest(first)).toBe(externalSessionDigest(second));
  });

  it("isolates identical native ids by host and provider", () => {
    expect(new Set([externalSessionId("m3", "codex", "same"), externalSessionId("m5", "codex", "same"),
      externalSessionId("J", "codex", "same"), externalSessionId("m3", "claude", "same")]).size).toBe(4);
  });

  it("separates missing/expired heartbeat from observed activity", () => {
    const now = Date.parse(observation.observedAt);
    expect(externalCollectorConnection(null, now)).toBe("disconnected");
    expect(externalCollectorConnection(observation.observedAt, now + 90_000)).toBe("connected");
    expect(externalCollectorConnection(observation.observedAt, now + 90_001)).toBe("disconnected");
    expect(externalCollectorConnection(observation.observedAt, now - 1)).toBe("disconnected");
    expect(observation.activity).toBe("working");
  });
});
