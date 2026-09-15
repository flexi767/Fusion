import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, expect, it, vi } from "vitest";
import { SessionsView } from "../SessionsView";
const { fetchSessions, fetchUsage } = vi.hoisted(() => ({ fetchSessions: vi.fn(), fetchUsage: vi.fn() }));
vi.mock("../../api/external-sessions", () => ({ fetchExternalSessions: fetchSessions, fetchExternalSessionUsage: fetchUsage }));
beforeEach(() => {
  window.history.replaceState({}, "", "/?view=sessions");
  fetchSessions.mockReset().mockResolvedValue({ enabled: true, sessions: [], collectors: [], nextCursor: null });
  fetchUsage.mockReset().mockResolvedValue({ from: "2026-09-01T00:00:00.000Z", to: "2026-09-15T23:59:59.999Z", sessions: [], truncated: false });
});
it("keeps the search input mounted while typing and submits filters to all-history search", async () => {
  const user = userEvent.setup(); render(<SessionsView />);
  await screen.findByText("No sessions match these filters.");
  const input = screen.getByRole("searchbox", { name: "Search sessions and collected output" });
  await user.type(input, "needle");
  expect(screen.getByRole("searchbox")).toBe(input);
  expect(fetchSessions).toHaveBeenCalledTimes(1);
  await user.click(screen.getByRole("button", { name: "Search", exact: true }));
  await waitFor(() => expect(fetchSessions).toHaveBeenLastCalledWith(undefined, { host: "", provider: "", activity: "", q: "needle", saved: "" }));
  expect(screen.getByRole("searchbox")).toBe(input);
});
it("calculates a disclosed UTC range and reports an empty usage result", async () => {
  render(<SessionsView />);
  fireEvent.click(screen.getByText("Session usage and cost rankings"));
  fireEvent.change(screen.getByLabelText("From (UTC)"), { target: { value: "2026-09-01" } });
  fireEvent.change(screen.getByLabelText("To (UTC)"), { target: { value: "2026-09-15" } });
  fireEvent.click(screen.getByRole("button", { name: "Calculate usage" }));
  await screen.findByText("No collected turns match this range.");
  expect(fetchUsage).toHaveBeenCalledWith({ from: "2026-09-01T00:00:00.000Z", to: "2026-09-15T23:59:59.999Z", host: "", model: "", groupBy: "session" });
});
