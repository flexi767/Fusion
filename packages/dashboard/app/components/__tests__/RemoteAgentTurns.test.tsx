import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { RemoteAgentTurns } from "../RemoteAgentTurns";
import { api } from "../../api/client/client";

vi.mock("../../api/client/client", () => ({ api: vi.fn() }));
const sessionId = "a".repeat(64);
const turn = (over: Record<string, unknown> = {}) => ({
  nativeTurnId: "turn-1", revision: 1, ordinal: 0, state: "completed",
  prompts: [{ at: "2026-09-23T10:00:00.000Z", text: "Do the thing" }],
  response: "Did the thing", startedAt: "2026-09-23T10:00:00.000Z", endedAt: "2026-09-23T10:00:05.000Z",
  durationMs: 5000, durationSource: "native", toolCallCount: 3, fileChanges: [], ...over,
});
afterEach(() => { cleanup(); vi.resetAllMocks(); });

describe("remote agent turn history", () => {
  it("renders each prompt above its response with measured work time", async () => {
    vi.mocked(api).mockResolvedValue({ schemaVersion: 1, turns: [turn()], nextCursor: null } as never);
    render(<RemoteAgentTurns sessionId={sessionId} projectId="project-a" />);
    const item = (await screen.findByRole("list", { name: "Collected turns" })).querySelector("li")!;
    expect(item).toHaveTextContent("5.0 s");
    expect(item).toHaveTextContent("3 tool calls");
    const text = item.textContent!;
    expect(text.indexOf("Do the thing")).toBeLessThan(text.indexOf("Did the thing"));
  });

  it("reports unreported telemetry as unavailable rather than zero", async () => {
    vi.mocked(api).mockResolvedValue({ schemaVersion: 1, turns: [turn({ durationMs: null, durationSource: null, toolCallCount: null })], nextCursor: null } as never);
    render(<RemoteAgentTurns sessionId={sessionId} projectId="project-a" />);
    const item = (await screen.findByRole("list", { name: "Collected turns" })).querySelector("li")!;
    expect(item).toHaveTextContent("Duration not reported");
    expect(item).toHaveTextContent("Tool calls not reported");
    // The bug this guards: null telemetry rendering as a confident "0".
    expect(item).not.toHaveTextContent("0 ms");
    expect(item).not.toHaveTextContent("0 tool calls");
  });

  it("marks a derived duration so it is not mistaken for provider-reported timing", async () => {
    vi.mocked(api).mockResolvedValue({ schemaVersion: 1, turns: [turn({ durationSource: "derived" })], nextCursor: null } as never);
    render(<RemoteAgentTurns sessionId={sessionId} projectId="project-a" />);
    expect(await screen.findByText(/derived/)).toBeInTheDocument();
  });

  it("says a turn is still running instead of claiming no response", async () => {
    vi.mocked(api).mockResolvedValue({ schemaVersion: 1, turns: [turn({ state: "ongoing", response: null, endedAt: null })], nextCursor: null } as never);
    render(<RemoteAgentTurns sessionId={sessionId} projectId="project-a" />);
    expect(await screen.findByText("This turn is still running.")).toBeInTheDocument();
  });

  it("shows a stored patch and flags truncation, and never claims a patch it does not have", async () => {
    const fileChanges = [
      { path: "src/a.ts", operation: "modify", addedLines: 3, removedLines: 1, patchAvailable: true, patch: "@@ -1 +1 @@", truncated: true },
      { path: "src/b.ts", operation: "add", addedLines: null, removedLines: null, patchAvailable: false, truncated: false },
    ];
    vi.mocked(api).mockResolvedValue({ schemaVersion: 1, turns: [turn({ fileChanges })], nextCursor: null } as never);
    render(<RemoteAgentTurns sessionId={sessionId} projectId="project-a" />);
    expect(await screen.findByText("2 files changed")).toBeInTheDocument();
    expect(screen.getByText("@@ -1 +1 @@")).toBeInTheDocument();
    expect(screen.getByText("This patch was truncated when it was collected.")).toBeInTheDocument();
    expect(screen.getByText("Patch unavailable for this change.")).toBeInTheDocument();
    expect(screen.getByText("Line counts not reported")).toBeInTheDocument();
  });

  it("appends older turns instead of replacing the page already shown", async () => {
    vi.mocked(api)
      .mockResolvedValueOnce({ schemaVersion: 1, turns: [turn()], nextCursor: "next" } as never)
      .mockResolvedValueOnce({ schemaVersion: 1, turns: [turn({ nativeTurnId: "turn-0", ordinal: 1, prompts: [{ at: null, text: "Earlier prompt" }] })], nextCursor: null } as never);
    render(<RemoteAgentTurns sessionId={sessionId} projectId="project-a" />);
    fireEvent.click(await screen.findByRole("button", { name: "Load older turns" }));
    await waitFor(() => expect(screen.getByText("Earlier prompt")).toBeInTheDocument());
    expect(screen.getByText("Do the thing")).toBeInTheDocument();
    expect(within(screen.getByRole("list", { name: "Collected turns" })).getAllByRole("listitem")).toHaveLength(2);
  });

  it("surfaces a read failure instead of implying the session has no turns", async () => {
    vi.mocked(api).mockRejectedValue(new Error("Turn storage unavailable"));
    render(<RemoteAgentTurns sessionId={sessionId} projectId="project-a" />);
    expect(await screen.findByRole("alert")).toHaveTextContent("Turn storage unavailable");
    expect(screen.queryByText("No turns have been collected for this session.")).toBeNull();
  });
});
