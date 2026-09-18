export interface RemoteUsage {
  model: string; input: number; cached: number; cacheWrite: number; cacheWriteHour: number;
  output: number; reasoning: number | null; usd: number | null;
  rates: { inputPer1M: number; outputPer1M: number; cacheReadPer1M: number; cacheWritePer1M: number; source: string } | null;
  reason: string | null;
}
