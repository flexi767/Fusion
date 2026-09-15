import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, expect, it, vi } from "vitest";
import { SessionHistory } from "../SessionHistory";
const { fetchSession, fetchTurn, savePreferences } = vi.hoisted(() => ({ fetchSession: vi.fn(), fetchTurn: vi.fn(), savePreferences: vi.fn() }));
vi.mock("../../api/external-sessions", () => ({ fetchExternalSession: fetchSession, fetchExternalSessionTurn: fetchTurn, saveSessionPreferences: savePreferences }));
const turn = { id: "old/turn", startedAt: "2026-09-01T12:00:00Z", updatedAt: "2026-09-01T12:00:00Z", completedAt: null, durationMs: null, durationSource: "timestamps", prompts: ["Earlier request"], response: "Earlier failure", toolCalls: 0, usage: [], files: [], provenance: "native-transcript" };
const data = { session: { id: "session", hostId: "m3", provider: "codex", observation: { title: "History", activity: "waiting" } }, turns: [], nextCursor: "older-page", summariesEnabled: false, details: null, runtime: null, commands: [], cost: { usd: null, usage: [], unpricedRows: 0, unreportedTurns: 0, coveredTurns: 0 } };
beforeEach(() => {
  window.history.replaceState({}, "", "/?view=sessions&session=session&turn=old%2Fturn");
  fetchSession.mockReset().mockResolvedValue(data); fetchTurn.mockReset().mockResolvedValue({ turn }); savePreferences.mockReset().mockResolvedValue({});
});
it("loads a linked older turn directly and preserves its native identity in the link", async () => {
  render(<SessionHistory id="session" />);
  await screen.findByText("Earlier failure");
  expect(fetchTurn).toHaveBeenCalledWith("session", "old/turn", "current");
  expect(fetchSession).toHaveBeenCalledTimes(1);
  expect(screen.getByRole("link", { name: "Link to this turn" }).getAttribute("href")).toBe("?view=sessions&session=session&turn=old%2Fturn#session-turn-old%2Fturn");
  expect(screen.getByText("Earlier failure").closest("article")?.id).toBe("session-turn-old%2Fturn");
});
it("retains current history if a linked turn is unavailable", async () => {
  fetchTurn.mockRejectedValue(new Error("missing"));
  fetchSession.mockResolvedValue({ ...data, turns: [{ ...turn, id: "current", response: "Current output" }] });
  render(<SessionHistory id="session" />);
  await screen.findByText("Linked turn is unavailable. Collected history remains below.");
  expect(screen.getByText("Current output")).toBeTruthy();
});
it("saves archive and pin labels without scheduling or deleting the session", async () => {
  const user = userEvent.setup(); render(<SessionHistory id="session" />);
  await user.click(await screen.findByText("Saved session and imported metadata"));
  const checkbox = screen.getByRole("checkbox", { name: "Archived" });
  await user.click(checkbox); await user.click(screen.getByRole("checkbox", { name: "Pinned" }));
  await user.click(screen.getByRole("button", { name: "Save preferences" }));
  await waitFor(() => expect(savePreferences).toHaveBeenCalledWith("session", true, true, 0));
  expect(screen.getByRole("checkbox", { name: "Archived" })).toBe(checkbox);
});

it("ignores an older cost-basis response after switching to recorded rates", async () => {
  window.history.replaceState({}, "", "/?view=sessions&session=session");
  let finish!: (value: typeof data) => void;
  fetchSession.mockReset().mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }))
    .mockResolvedValue({ ...data, turns: [{ ...turn, response: "Recorded output" }], cost: { ...data.cost, basis: "recorded" } });
  const user = userEvent.setup(); render(<SessionHistory id="session" />);
  await user.selectOptions(screen.getByLabelText("Cost basis"), "recorded");
  await screen.findByText("Recorded output");
  await act(async () => { finish({ ...data, turns: [{ ...turn, response: "Stale current output" }] } as typeof data); });
  expect(screen.queryByText("Stale current output")).toBeNull();
  expect(screen.getByText("Recorded output")).toBeTruthy();
});
