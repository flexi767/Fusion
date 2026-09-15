import type { Request, Response, NextFunction } from "express";
import { rateLimit, type RateLimitOptions } from "../rate-limit.js";
import { authenticateSessionCollector } from "./session-collector-auth.js";

/** Authenticated history cannot consume another host's live or dashboard budget. */
export function createSessionCollectorRateLimit(options: Pick<RateLimitOptions, "windowMs" | "max"> = {}) {
  const limiter = rateLimit({ windowMs: 60_000, max: 1200, ...options, keyGenerator: req => {
    const host = authenticateSessionCollector(req.headers.authorization, process.env.FUSION_SESSION_COLLECTORS);
    const history = req.body?.historical === true || (Array.isArray(req.body?.turns) && req.body.turns.length > 0);
    return `${host}:${history ? "history" : "live"}`;
  } });
  return (req: Request, res: Response, next: NextFunction): boolean => {
    if (process.env.FUSION_SESSION_INGESTION !== "1" || req.method !== "POST" || !["/session-collector", "/session-collector/"].includes(req.path)
      || req.headers.origin || req.headers["sec-fetch-site"] || !authenticateSessionCollector(req.headers.authorization, process.env.FUSION_SESSION_COLLECTORS)) return false;
    limiter(req, res, next);
    return true;
  };
}
