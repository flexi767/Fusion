// @vitest-environment node
import express from "express";
import { expect, it, vi } from "vitest";
import { createCliAgentHooksRouterForTest } from "../cli-agent-hooks.js";
import { request } from "../../test-request.js";

it("authenticates and routes native Codex completion IDs separately from Claude waiting notifications", async () => {
  const ingest = vi.fn(); const hub = { validateToken: (id: string, token: string | null | undefined) => id === "owned" && token === "session-token", ingest };
  const resolver = vi.fn((projectId: string | undefined) => projectId === "other-project" ? hub : undefined);
  const app = express(); app.use("/api", createCliAgentHooksRouterForTest(resolver));
  const headers = { "Content-Type": "application/json", Host: "127.0.0.1:12345", "X-Fusion-Cli-Session-Id": "owned", "X-Fusion-Cli-Session-Token": "session-token" };
  const path = "/api/cli-agent/hooks?projectId=other-project&event=notify";
  for (const key of ["thread-id", "thread_id", "threadId"]) {
    expect((await request(app, "POST", path, JSON.stringify({ type: "agent-turn-complete", [key]: "native-codex" }), headers)).status).toBe(200);
    expect(ingest).toHaveBeenLastCalledWith("owned", expect.objectContaining({ kind: "done", payload: expect.objectContaining({ nativeSessionId: "native-codex" }) }));
  }
  expect(resolver).toHaveBeenCalledWith("other-project", "owned");
  await request(app, "POST", path, JSON.stringify({ type: "agent-turn-complete" }), headers);
  expect(ingest).toHaveBeenLastCalledWith("owned", { kind: "outputProgress", payload: {} });
  await request(app, "POST", path, JSON.stringify({ session_id: "claude-native", message: "Permission" }), headers);
  expect(ingest).toHaveBeenLastCalledWith("owned", expect.objectContaining({ kind: "waitingOnInput", payload: expect.objectContaining({ nativeSessionId: "claude-native" }) }));
  const calls = ingest.mock.calls.length;
  expect((await request(app, "POST", path, "{}", { ...headers, "X-Fusion-Cli-Session-Token": "wrong" })).status).toBe(401);
  expect((await request(app, "POST", path, "{}", { ...headers, Origin: "http://127.0.0.1" })).status).toBe(403);
  expect(ingest).toHaveBeenCalledTimes(calls);
});
