import { expect, it } from "vitest";
import { parseImportedSessionMetadata } from "../external-sessions/imported-metadata.js";
const at = "2026-09-15T12:00:00Z";
const message = { id: "message", role: "assistant", content: "Recorded answer; token=private-value", at, contextSessionIds: ["source-session"], inputTokens: 20, outputTokens: 5 };
const thread = { id: "thread", title: "Recent activity", createdAt: at, totalMessages: 1, messages: [message] };
const alias = { sourceSessionId: "managed-alias", title: "Original card", archived: true, pinned: false, status: "stopped", notes: "token=private-value", capabilities: ["stop"] };
const metadata = { formatVersion: 5, snapshot: "a".repeat(64), sourceSessionId: "source-session", archived: false, pinned: false, conversations: [thread], sourceAliases: [alias], capabilities: ["stop"] };
it("preserves inert conversation provenance and counts while redacting text and dropping authority fields", () => {
  const parsed = parseImportedSessionMetadata(metadata);
  expect(parsed.conversations?.[0]).toMatchObject({ id: "thread", totalMessages: 1, messages: [{ content: "Recorded answer; token=[REDACTED]", contextSessionIds: ["source-session"], inputTokens: 20, outputTokens: 5 }] });
  expect(parsed).not.toHaveProperty("capabilities");
  expect(parsed.sourceAliases?.[0]).toMatchObject({ archived: true, notes: "token=[REDACTED]" });
  expect(parsed.sourceAliases?.[0]).not.toHaveProperty("capabilities");
  expect(parseImportedSessionMetadata({ ...metadata, formatVersion: undefined, conversations: undefined })).toMatchObject({ formatVersion: 1, conversations: [] });
});
it("bounds threads/messages/content/references and refuses invalid dates, roles and counters", () => {
  for (const value of [
    { ...metadata, formatVersion: 6 }, { ...metadata, conversations: Array(4).fill(thread) }, { ...metadata, sourceAliases: Array(8).fill(alias) }, { ...metadata, sourceAliases: [{ ...alias, pinned: "true" }] },
    ...[{ messages: Array(11).fill(message) }, { totalMessages: 0 }, { createdAt: "bad" }].map(patch => ({ ...metadata, conversations: [{ ...thread, ...patch }] })),
    ...[{ content: "x".repeat(4001) }, { role: "execute" }, { contextSessionIds: Array(65).fill("id") }, { contextSessionIds: [null] }, { inputTokens: -1 }, { at: "bad" }].map(patch => ({ ...metadata, conversations: [{ ...thread, messages: [{ ...message, ...patch }] }] })),
  ]) expect(() => parseImportedSessionMetadata(value)).toThrow("Invalid imported");
});
