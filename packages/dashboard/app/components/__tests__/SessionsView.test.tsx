import { render, screen, fireEvent } from "@testing-library/react";
import { expect, it } from "vitest";
import { SessionCard } from "../SessionsView";
import { SessionCostDetails, SessionTurnResult } from "../SessionHistory";
import type { SessionTurn } from "@fusion/core";
const session = { id: "s", hostId: "m3", provider: "codex", nativeSessionId: "n", revision: 1, receivedAt: "2026-09-15T12:00:00Z", observation: { version: 1 as const, provider: "codex" as const, nativeSessionId: "n", revision: 1, observedAt: "2026-09-15T12:00:00Z", activity: "working" as const, title: "Fix", projectPath: "/repo" } };
it("keeps expanded details and activity stable when collector connectivity changes", () => {
  const { rerender } = render(<SessionCard session={session} connected />);
  const details = screen.getByText("Session identity").closest("details")!;
  fireEvent.click(screen.getByText("Session identity"));
  expect(details.open).toBe(true);
  rerender(<SessionCard session={{ ...session, revision: 2 }} connected={false} />);
  expect(screen.getByText("Session identity").closest("details")).toBe(details);
  expect(details.open).toBe(true); expect(screen.getByText("working")).toBeTruthy();
  expect(screen.queryByRole("button", { name: /stop|resume/i })).toBeNull();
});
it("shows prompts before responses and never invents missing historical patches or duration", () => {
  const turn: SessionTurn = { id: "t", startedAt: "2026-09-15T12:00:00Z", updatedAt: "2026-09-15T12:00:00Z", completedAt: null, durationMs: null, durationSource: "timestamps", prompts: ["First", "Steering"], response: "Result", usage: [], files: [{ path: "a.ts", diff: "+new", added: 1, removed: 0, truncated: true, available: true }], toolCalls: 1, provenance: "native-transcript" };
  render(<SessionTurnResult turn={turn} />);
  expect(screen.getByText("First").compareDocumentPosition(screen.getByText("Result")) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  expect(screen.getByText(/Duration unavailable/)).toBeTruthy();
  expect(screen.getByText(/a.ts.*truncated/)).toBeTruthy();
});
it("uses keyboard-operable native cost disclosure and exposes missing price coverage", () => {
  render(<SessionCostDetails cost={{ usd: null, usage: [], unpricedRows: 2, unreportedTurns: 1, coveredTurns: 3 }} />);
  expect(screen.getByText(/2 unpriced model rows; 1 turns without usage/)).toBeTruthy();
  expect(screen.getByText(/Estimated cost for 3 displayed turns/).tagName).toBe("SUMMARY");
});
