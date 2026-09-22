import { z } from "zod";
import { externalSessionIdentifier } from "./contract.js";

const safeCounter = z.number().int().min(0).max(Number.MAX_SAFE_INTEGER);
const timestamp = z.string().datetime({ offset: true }).transform(value => new Date(value).toISOString());
const transcriptText = (max: number) => z.string().max(max).refine(value => !value.includes("\u0000"), "Transcript text cannot contain NUL bytes");

export const externalSessionFileChangeSchema = z.object({
  path: z.string().min(1).max(4096).refine(value => !value.includes("\u0000")),
  operation: z.enum(["add", "delete", "modify", "rename"]),
  previousPath: z.string().min(1).max(4096).refine(value => !value.includes("\u0000")).optional(),
  addedLines: safeCounter.nullable(),
  removedLines: safeCounter.nullable(),
  patchAvailable: z.boolean(),
  patch: transcriptText(262_144).optional(),
  truncated: z.boolean(),
}).strict().superRefine((value, ctx) => {
  if (value.operation === "rename" && value.previousPath === undefined) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["previousPath"], message: "Renames require the previous path" });
  }
  if (!value.patchAvailable && value.patch !== undefined) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["patch"], message: "Unavailable patches cannot include patch text" });
  }
  if (value.patchAvailable && value.patch === undefined) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["patch"], message: "Available patches require patch text" });
  }
});

const promptSchema = z.object({
  at: timestamp.nullable(),
  text: transcriptText(262_144),
}).strict();

/**
 * Durable provider-neutral turn payload. Missing native telemetry stays null/absent rather
 * than being converted to zero. Historical patches belong to their turn and are bounded;
 * callers must never replace them with a live working-tree diff.
 */
export const externalSessionTurnSchema = z.object({
  nativeTurnId: externalSessionIdentifier,
  revision: z.number().int().min(1).max(Number.MAX_SAFE_INTEGER),
  ordinal: safeCounter,
  state: z.enum(["ongoing", "completed", "failed", "interrupted", "unknown"]),
  prompts: z.array(promptSchema).min(1).max(32),
  response: transcriptText(1_048_576).nullable(),
  startedAt: timestamp.nullable(),
  endedAt: timestamp.nullable(),
  durationMs: safeCounter.nullable(),
  durationSource: z.enum(["native", "derived"]).nullable(),
  toolCallCount: safeCounter.nullable(),
  fileChanges: z.array(externalSessionFileChangeSchema).max(128),
}).strict().superRefine((value, ctx) => {
  if ((value.durationMs === null) !== (value.durationSource === null)) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["durationSource"], message: "Duration value and source must be reported together" });
  }
  if (value.startedAt !== null && value.endedAt !== null && Date.parse(value.endedAt) < Date.parse(value.startedAt)) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["endedAt"], message: "Turn cannot end before it starts" });
  }
  if (value.state === "ongoing" && value.endedAt !== null) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["endedAt"], message: "Ongoing turns cannot have an end timestamp" });
  }
});

export type ExternalSessionFileChange = z.infer<typeof externalSessionFileChangeSchema>;
export type ExternalSessionTurn = z.infer<typeof externalSessionTurnSchema>;
