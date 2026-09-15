// @vitest-environment node
import express from "express";
import { createHash } from "node:crypto";
import { afterEach, expect, it, vi } from "vitest";
import { createSessionCollectorRateLimit } from "../session-collector-rate-limit.js";
import { rateLimit } from "../../rate-limit.js";
import { request } from "../../test-request.js";
afterEach(() => vi.unstubAllEnvs());
it("isolates authenticated live/history/host budgets from ordinary API mutations", async () => {
  vi.stubEnv("FUSION_SESSION_INGESTION", "1");
  vi.stubEnv("FUSION_SESSION_COLLECTORS", JSON.stringify(Object.fromEntries(["m3", "j"].map(host => [host, createHash("sha256").update(host + "-token").digest("hex")]))));
  const app = express(); app.use(express.json());
  const collector = createSessionCollectorRateLimit({ max: 2 }); const ordinary = rateLimit({ max: 2 });
  app.use("/api", (req, res, next) => { if (!collector(req, res, next)) ordinary(req, res, next); });
  app.use((_req, res) => res.json({ accepted: true }));
  const send = (host: string, historical = false, path = "/api/session-collector") => request(app, "POST", path, JSON.stringify({ historical }), { "Content-Type": "application/json", Authorization: `Bearer ${host}-token` });
  expect((await send("m3", true)).status).toBe(200); expect((await send("m3", true)).status).toBe(200);
  expect((await send("m3", true)).status).toBe(429);
  expect((await send("m3")).status).toBe(200); expect((await send("j", true)).status).toBe(200);
  expect((await send("m3", false, "/api/tasks")).status).toBe(200);
  expect((await send("unknown")).status).toBe(200);
  expect((await send("unknown")).status).toBe(429);
});
