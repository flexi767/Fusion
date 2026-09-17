import { createHash, timingSafeEqual } from "node:crypto";

export function authenticateExternalSessionCollector(authorization: string | undefined, configuration: string | undefined): string | null {
  if (!authorization?.startsWith("Bearer ") || !configuration || configuration.length > 65_536) return null;
  try {
    const credentials: unknown = JSON.parse(configuration);
    if (!credentials || typeof credentials !== "object" || Array.isArray(credentials)) return null;
    const entries = Object.entries(credentials);
    if (entries.length === 0 || entries.length > 100 || entries.some(([host, token]) =>
      !/^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,127}$/.test(host)
      || typeof token !== "string" || !/^[a-zA-Z0-9._~-]{32,512}$/.test(token))
      || new Set(entries.map(([, token]) => token)).size !== entries.length) return null;
    const provided = authorization.slice(7);
    if (provided.length > 512) return null;
    const digest = (value: string) => createHash("sha256").update(value).digest();
    const providedDigest = digest(provided);
    let matched: string | null = null;
    for (const [host, token] of entries) {
      if (timingSafeEqual(providedDigest, digest(token as string))) matched = host;
    }
    return matched;
  } catch {
    return null;
  }
}
