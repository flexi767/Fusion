import { render, screen, fireEvent } from "@testing-library/react";
import { expect, it } from "vitest";
import { SessionActivityStatus } from "../SessionActivityStatus";
import { SessionCard, SessionDeliveryLag } from "../SessionsView";
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

it("displays reported model/context and cost coverage without inventing capacity", () => {
  const row = { ...session, observation: { ...session.observation, telemetry: { model: "fixture", contextTokens: 123, contextCapacity: null, serviceTier: null, observedAt: session.receivedAt } },
    usageSummary: { id: "s", host: "m3", provider: "codex", title: "Fix", turns: 5, unreportedTurns: 2, usd: null, unpricedRows: 1, requests: null, inputTokens: null, outputTokens: null, usage: [] } };
  const { rerender } = render(<SessionCard session={row} connected />);
  expect(screen.getByText(/Last reported model: fixture.*123.*capacity unreported/)).toBeTruthy();
  const popup = screen.getByText(/Session cost and coverage/).closest("details")!;
  fireEvent.click(popup.querySelector("summary")!);
  rerender(<SessionCard session={{ ...row, revision: 2 }} connected={false} />);
  expect(screen.getByText(/Session cost and coverage/).closest("details")).toBe(popup);
  expect(popup.open).toBe(true);
  expect(screen.getByText(/1 unpriced model rows; 2 turns without usage/)).toBeTruthy();
});


it("discloses long-context and separate cache-lifetime charges while retaining unknown-rate explanations", () => {
  render(<SessionCostDetails cost={{ usd: 0.0039, unpricedRows: 1, unreportedTurns: 0, coveredTurns: 2, usage: [
    { model: "fixture", contextBand: "long", usd: 0.0039, reason: null, lines: [
      { category: "Cache write (5 minutes)", tokens: 20, ratePerMillion: 30, usd: 0.0006 },
      { category: "Cache write (1 hour)", tokens: 10, ratePerMillion: 50, usd: 0.0005 },
    ], source: "verified fixture", effectiveDate: "2026-09-15", calculation: "current-rates-estimate" },
    { model: "unknown", contextBand: "long", usd: null, reason: "No long-context rate was recorded", lines: [], source: null, effectiveDate: "unknown", calculation: "recorded-rates-estimate" },
  ] }} />);
  expect(screen.getByText("fixture · Long context")).toBeTruthy();
  expect(screen.getByText("Cache write (5 minutes)")).toBeTruthy();
  expect(screen.getByText("Cache write (1 hour)")).toBeTruthy();
  expect(screen.getByText("No long-context rate was recorded")).toBeTruthy();
});


it("discloses the live latency sample window, queue age and clock exclusions without inventing missing measurements", () => {
  const { rerender } = render(<SessionDeliveryLag diagnostics={undefined} />);
  expect(screen.getByText("Live delivery lag: no valid measurements yet.")).toBeTruthy();
  rerender(<SessionDeliveryLag diagnostics={{ liveLagSamples: 25, liveLagP95Ms: 12500, liveLagMaxMs: 600000, liveQueueP95Ms: 12000, oldestLivePendingMs: 900000, liveLagClockSkewSamples: 2 }} />);
  expect(screen.getByText(/p95 12.5 s.*maximum 600.0 s.*25 acknowledged updates/)).toBeTruthy();
  expect(screen.getByText(/Latest 10,000.*24 hours/)).toBeTruthy();
  expect(screen.getByText("Queue delay p95: 12.0 s")).toBeTruthy();
  expect(screen.getByText("Oldest queued live update: 900.0 s")).toBeTruthy();
  expect(screen.getByText(/2 samples excluded/)).toBeTruthy();
  rerender(<SessionDeliveryLag diagnostics={{ liveLagSamples: 0, liveLagClockSkewSamples: 1 }} />);
  expect(screen.getByText("Live delivery lag: no valid measurements yet.")).toBeTruthy();
  expect(screen.queryByText(/Queue delay p95/)).toBeNull();
});


it("labels retained turn metadata without showing removed text as an active response", () => {
  const turn: SessionTurn = { id: "retained", startedAt: session.receivedAt, updatedAt: session.receivedAt, completedAt: null, durationMs: null, durationSource: "timestamps", prompts: [], response: "", usage: [], toolCalls: 2, provenance: "native-transcript", contentPruned: { at: session.receivedAt, through: session.receivedAt }, files: [{ path: "a.ts", diff: "", added: 3, removed: 1, available: false, truncated: true }] };
  render(<SessionTurnResult turn={turn} />);
  expect(screen.getByText(/Collected prompt, response and patch text removed by retention/)).toBeTruthy();
  expect(screen.getByText("Response removed by retention")).toBeTruthy();
  expect(screen.getByText("Patch text removed by retention.")).toBeTruthy();
  expect(screen.getByText(/a.ts.*3.*1/)).toBeTruthy();
  expect(screen.queryByText("Response in progress")).toBeNull();
});


it("keeps reported activity distinct from stale observation and collector connectivity", () => {
  const { rerender } = render(<SessionActivityStatus session={{ ...session, activityStale: true }} connected />);
  expect(screen.getByText("working")).toBeTruthy(); expect(screen.getByText(/Collector connected/)).toBeTruthy();
  expect(screen.getByText(/Stale working report/)).toBeTruthy();
  rerender(<SessionActivityStatus session={{ ...session, activityStale: true }} connected={false} />);
  expect(screen.getByText("working")).toBeTruthy(); expect(screen.getByText(/Collector disconnected/)).toBeTruthy();
  expect(screen.getByText(/Stale working report/)).toBeTruthy();
  rerender(<SessionActivityStatus session={{ ...session, activityStale: false }} />);
  expect(screen.queryByText(/Stale working report/)).toBeNull(); expect(screen.queryByText(/Collector/)).toBeNull();
  expect(screen.getByText("working")).toBeTruthy();
});
