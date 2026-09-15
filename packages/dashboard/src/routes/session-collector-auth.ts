import { createHash, timingSafeEqual } from "node:crypto";

/** Environment holds hashes, never collector bearer tokens. Invalid configuration fails closed. */
export function authenticateSessionCollector(authorization: string | undefined, configured: string | undefined): string | null {
  if (!authorization?.startsWith("Bearer ") || authorization.length > 512 || !configured) return null;
  let entries: unknown;
  try { entries = JSON.parse(configured); } catch { return null; }
  if (!entries || typeof entries !== "object" || Array.isArray(entries)) return null;
  const digest = createHash("sha256").update(authorization.slice(7)).digest();
  let host: string | null = null;
  for (const [id, hash] of Object.entries(entries)) {
    if (!id.trim() || id.length > 256 || /[\u0000-\u001f]/u.test(id) || typeof hash !== "string" || !/^[a-f0-9]{64}$/.test(hash)) return null;
    if (timingSafeEqual(digest, Buffer.from(hash, "hex"))) {
      if (host !== null) return null; // A credential may identify exactly one host.
      host = id;
    }
  }
  return host;
}
