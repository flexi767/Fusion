import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, it, vi } from "vitest";
import { SessionLaunchPanel } from "../SessionLaunchPanel";
import { ApiRequestError } from "../../api/client/client";
const mock = vi.hoisted(() => ({ data: undefined as unknown, queue: vi.fn(), cancel: vi.fn(), mutate: vi.fn() }));
vi.mock("../../hooks/useSessionLaunches", () => ({ useSessionLaunches: () => ({ data: mock.data, refresh: mock.mutate }) }));
vi.mock("../../api/external-sessions", () => ({ fetchSessionLaunches: vi.fn(), queueSessionLaunch: mock.queue, cancelSessionLaunch: mock.cancel }));
afterEach(() => { cleanup(); vi.clearAllMocks(); mock.data = undefined; });
const runtime = { hostId: "m3", projectId: "project", generation: "generation-12345", projectPath: "/repo" };
function fixture(requests: object[] = []) { mock.mutate.mockResolvedValue(undefined); mock.data = { enabled: true, runtimes: [runtime], requests }; return render(<SessionLaunchPanel />); }
async function fill() {
  const user = userEvent.setup(); await user.click(screen.getByText("Launch a managed Codex session"));
  await user.selectOptions(screen.getByLabelText("Host and project"), "m3:project:generation-12345");
  await user.type(screen.getByLabelText("Initial prompt"), "Inspect the code"); return user;
}
it("retains mounted form fields and the same immutable request when acceptance is uncertain", async () => {
  fixture(); const user = await fill(); const prompt = screen.getByLabelText("Initial prompt");
  mock.queue.mockRejectedValueOnce(new Error("offline")).mockResolvedValueOnce({ status: "queued" });
  await user.click(screen.getByRole("button", { name: "Launch read-only Codex" }));
  expect(await screen.findByRole("alert")).toHaveTextContent("unconfirmed");
  expect(screen.getByLabelText("Initial prompt")).toBe(prompt); expect(prompt).toBeDisabled();
  await user.click(screen.getByRole("button", { name: "Retry same launch" }));
  await waitFor(() => expect(mock.queue).toHaveBeenCalledTimes(2));
  expect(mock.queue.mock.calls[0][0]).toEqual(mock.queue.mock.calls[1][0]);
  expect(mock.queue.mock.calls[0][0]).toMatchObject({ hostId: "m3", projectId: "project", generation: "generation-12345", prompt: "Inspect the code" });
  expect(await screen.findByRole("status")).toHaveTextContent("Launch queued");
});
it("keeps a successful acknowledgement when status refresh fails and permits editing after definitive rejection", async () => {
  fixture(); const user = await fill(); mock.queue.mockRejectedValueOnce(new ApiRequestError("Runtime changed", 409)).mockResolvedValueOnce({ status: "queued" });
  await user.click(screen.getByRole("button", { name: "Launch read-only Codex" }));
  expect(await screen.findByRole("alert")).toHaveTextContent("Runtime changed"); expect(screen.getByLabelText("Initial prompt")).toBeEnabled();
  mock.mutate.mockRejectedValue(new Error("refresh unavailable"));
  await user.click(screen.getByRole("button", { name: "Launch read-only Codex" }));
  expect(await screen.findByRole("status")).toHaveTextContent("Launch queued");
  expect(screen.queryByRole("button", { name: "Retry same launch" })).not.toBeInTheDocument();
});
it("shows cancellation only while queued, and preserves interrupted launch uncertainty", async () => {
  fixture([{ id: "queued", hostId: "m3", status: "queued", createdAt: "2026-09-15T10:00:00Z", prompt: "Inspect" }, { id: "ambiguous", hostId: "m3", status: "unconfirmed after interruption", createdAt: "2026-09-15T09:00:00Z", prompt: "Earlier" }]);
  fireEvent.click(screen.getByText("Launch a managed Codex session")); mock.cancel.mockResolvedValue({ cancelled: true });
  expect(screen.getAllByRole("button", { name: "Cancel queued launch" })).toHaveLength(1);
  expect(screen.getByText(/This request will not be replayed/)).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Cancel queued launch" })); await waitFor(() => expect(mock.cancel).toHaveBeenCalledWith("queued", "m3"));
});
it("leaves no launch button when the feature or all runtimes are unavailable", () => {
  mock.data = { enabled: false, runtimes: [], requests: [] }; const view = render(<SessionLaunchPanel />); expect(screen.queryByRole("button")).not.toBeInTheDocument();
  mock.data = { enabled: true, runtimes: [], requests: [] }; view.rerender(<SessionLaunchPanel />); fireEvent.click(screen.getByText("Launch a managed Codex session"));
  expect(screen.getByText("No connected Fusion runtime is accepting launches.")).toBeInTheDocument(); expect(screen.queryByRole("button")).not.toBeInTheDocument();
});
