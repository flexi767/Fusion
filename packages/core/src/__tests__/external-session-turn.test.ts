import { expect, it } from "vitest";
import { parseSessionTurn } from "../external-sessions/turn.js";
const turn = { id: "t", startedAt: "2026-09-15T12:00:00Z", updatedAt: "2026-09-15T12:00:00Z", prompts: [], response: "", usage: [], files: [] };
it("preserves historical patches inside and outside the project as display data", () => {
  const paths = ["src/a.ts", "a.ts", "/outside/b", "../c", "C:\\project\\d", "..\\e", "\\\\host\\share\\f"];
  const parsed = parseSessionTurn({ ...turn, files: paths.map(path => ({ path, diff: "+historical", added: 1, removed: 2 })) });
  expect(parsed.files.map(file => file.path)).toEqual(paths);
  expect(parsed.files.map(file => file.scope)).toEqual(["project", "project", ...Array(5).fill("external")]);
  expect(parsed.files.every(file => file.diff === "+historical" && file.added === 1 && file.removed === 2)).toBe(true);
  for (const path of ["", "bad\npath", "bad\0path", "x".repeat(4097)]) {
    expect(() => parseSessionTurn({ ...turn, files: [{ path, diff: "" }] })).toThrow();
  }
});
