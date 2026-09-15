import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { ModelPricingSection } from "./ModelPricingSection";
import type { SettingsFormState } from "./context";

const { apiMock } = vi.hoisted(() => ({
  apiMock: vi.fn(),
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (_key: string, fallback: string, vars?: Record<string, unknown>) => {
    if (!vars) return fallback;
    return Object.entries(vars).reduce((text, [key, value]) => text.replace(`{{${key}}}`, String(value)), fallback);
  } }),
}));

// Mock the API helper so fetch actions stay deterministic and do not hit the dashboard server.
vi.mock("../../../api", () => ({
  api: apiMock,
}));

function Harness({ initial, addToast = vi.fn() }: { initial: SettingsFormState; addToast?: (message: string, type?: "success" | "error" | "info" | "warning") => void }) {
  const [form, setForm] = useState<SettingsFormState>(initial);
  return (
    <ModelPricingSection
      form={form}
      setForm={setForm}
      addToast={addToast}
      projectId="proj-a"
    />
  );
}

const initialForm = (): SettingsFormState => ({
  modelPricingOverrides: {
    "openai:gpt-4o": {
      inputPer1M: 2.5,
      outputPer1M: 10,
      cacheReadPer1M: 1.25,
      cacheWritePer1M: 2.5,
      source: "manual",
    },
  },
} as SettingsFormState);

function openPricingTable() {
  fireEvent.click(screen.getByRole("button", { name: "View pricing table" }));
  return screen.getByTestId("model-pricing-table-modal");
}

describe("ModelPricingSection", () => {
  beforeEach(() => {
    apiMock.mockReset();
  });

  it("renders collapsed override summary without mounting the table shell", () => {
    render(<Harness initial={initialForm()} />);

    expect(screen.getByText("1 pricing override")).toBeInTheDocument();
    expect(screen.queryByText("openai:gpt-4o")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("openai:gpt-4o input per 1M")).not.toBeInTheDocument();
    expect(screen.queryByRole("table", { name: "Model pricing overrides" })).not.toBeInTheDocument();
  });

  it("shows empty summary copy when no overrides exist", () => {
    render(<Harness initial={{} as SettingsFormState} />);

    expect(screen.getByText("0 pricing overrides")).toBeInTheDocument();
    expect(screen.getByText("No model pricing overrides yet. Add one manually or fetch the latest LiteLLM prices.")).toBeInTheDocument();
    expect(screen.queryByLabelText("New provider:model key")).not.toBeInTheDocument();
  });

  it("opens and closes the pricing table popup by close button, Escape, and overlay click", () => {
    render(<Harness initial={initialForm()} />);

    openPricingTable();
    expect(screen.getByRole("dialog", { name: "Model pricing table" })).toHaveAccessibleDescription("Manual edits are saved with the rest of Global settings.");
    fireEvent.click(screen.getByTestId("model-pricing-close"));
    expect(screen.queryByRole("dialog", { name: "Model pricing table" })).not.toBeInTheDocument();

    openPricingTable();
    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByRole("dialog", { name: "Model pricing table" })).not.toBeInTheDocument();

    const overlay = openPricingTable();
    fireEvent.click(overlay);
    expect(screen.queryByRole("dialog", { name: "Model pricing table" })).not.toBeInTheDocument();
  });

  it("renders existing overrides and edits a row inside the popup", () => {
    render(<Harness initial={initialForm()} />);

    openPricingTable();
    expect(screen.getByText("openai:gpt-4o")).toBeInTheDocument();
    const inputRate = screen.getByLabelText("openai:gpt-4o input per 1M");
    fireEvent.change(inputRate, { target: { value: "3.75" } });

    expect(screen.getByLabelText("openai:gpt-4o input per 1M")).toHaveValue(3.75);
  });

  it("adds and deletes pricing rows through form state inside the popup", () => {
    render(<Harness initial={{} as SettingsFormState} />);

    openPricingTable();
    fireEvent.change(screen.getByLabelText("New provider:model key"), { target: { value: "Anthropic:Claude-Test" } });
    fireEvent.change(screen.getByLabelText("New input rate"), { target: { value: "1" } });
    fireEvent.change(screen.getByLabelText("New output rate"), { target: { value: "5" } });
    fireEvent.change(screen.getByLabelText("New cache read rate"), { target: { value: "0.1" } });
    fireEvent.change(screen.getByLabelText("New cache write rate"), { target: { value: "1.25" } });
    fireEvent.change(screen.getByLabelText("New source"), { target: { value: "manual-test" } });
    fireEvent.click(screen.getByRole("button", { name: "Add row" }));

    expect(screen.getByText("anthropic:claude-test")).toBeInTheDocument();
    expect(screen.getByLabelText("anthropic:claude-test output per 1M")).toHaveValue(5);
    expect(screen.getByText("1 pricing override")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Delete" }));
    expect(screen.queryByText("anthropic:claude-test")).not.toBeInTheDocument();
    expect(screen.getByText("0 pricing overrides")).toBeInTheDocument();
    expect(within(screen.getByRole("dialog", { name: "Model pricing table" })).getByText("No model pricing overrides yet. Add one manually or fetch the latest LiteLLM prices.")).toBeInTheDocument();
  });

  it("shows an error toast and resets loading when pricing fetch fails from the collapsed view", async () => {
    const addToast = vi.fn();
    let rejectFetch: (error: Error) => void = () => undefined;
    apiMock.mockImplementationOnce(() => new Promise((_resolve, reject) => {
      rejectFetch = reject;
    }));

    render(<Harness initial={{} as SettingsFormState} addToast={addToast} />);
    fireEvent.click(screen.getByRole("button", { name: "Fetch latest prices" }));

    expect(await screen.findByRole("button", { name: "Fetching…" })).toBeDisabled();
    rejectFetch(new Error("pricing unavailable"));
    await waitFor(() => expect(addToast).toHaveBeenCalledWith("pricing unavailable", "error"));
    await waitFor(() => expect(screen.getByRole("button", { name: "Fetch latest prices" })).not.toBeDisabled());
    expect(screen.queryByLabelText("New provider:model key")).not.toBeInTheDocument();
  });

  it("fetch button calls the API and refreshes fetched pricing state while keeping the table collapsed", async () => {
    apiMock
      .mockResolvedValueOnce({ count: 1, fetchedAt: "2026-06-22T00:00:00.000Z", source: "litellm" })
      .mockResolvedValueOnce({
        modelPricingFetchedAt: "2026-06-22T00:00:00.000Z",
        modelPricingSource: "litellm",
        modelPricingOverrides: {
          "openai:gpt-test": {
            inputPer1M: 1,
            outputPer1M: 2,
            cacheReadPer1M: 1,
            cacheWritePer1M: 1,
            source: "litellm/model_prices_and_context_window.json",
          },
        },
      });

    render(<Harness initial={{} as SettingsFormState} />);
    fireEvent.click(screen.getByRole("button", { name: "Fetch latest prices" }));

    await waitFor(() => expect(apiMock).toHaveBeenCalledWith(
      "/command-center/pricing/fetch?projectId=proj-a",
      { method: "POST" },
    ));
    await waitFor(() => expect(screen.getByText("1 pricing override")).toBeInTheDocument());
    expect(screen.queryByText("openai:gpt-test")).not.toBeInTheDocument();
    expect(apiMock).toHaveBeenCalledTimes(2);
    expect(screen.getByText(/Prices as of/)).toBeInTheDocument();
    expect(screen.getByText(/litellm/)).toBeInTheDocument();

    openPricingTable();
    expect(screen.getByText("openai:gpt-test")).toBeInTheDocument();
  });
});

it("preserves explicit UTC effective dates while other pricing fields change", () => {
  render(<Harness initial={initialForm()} />); openPricingTable();
  const from = screen.getByLabelText("openai:gpt-4o effective from UTC");
  const until = screen.getByLabelText("openai:gpt-4o effective until UTC");
  fireEvent.change(from, { target: { value: "2026-09-01T12:00" } });
  fireEvent.change(until, { target: { value: "2026-10-01T12:00" } });
  fireEvent.change(screen.getByLabelText("openai:gpt-4o input per 1M"), { target: { value: "3" } });
  expect(screen.getByLabelText("openai:gpt-4o effective from UTC")).toBe(from);
  expect(from).toHaveValue("2026-09-01T12:00"); expect(until).toHaveValue("2026-10-01T12:00");
});


it("keeps optional cache and context rates through add, edits and explicit removal without remounting inputs", async () => {
  const user = userEvent.setup();
  render(<Harness initial={{} as SettingsFormState} />); openPricingTable();
  await user.type(screen.getByLabelText("New provider:model key"), "anthropic:fixture");
  fireEvent.click(screen.getByText("Cache lifetime and long context"));
  const hour = screen.getByLabelText("New one-hour cache write per 1M");
  expect(hour).toHaveValue(null);
  await user.type(hour, "12");
  expect(screen.getByLabelText("New one-hour cache write per 1M")).toBe(hour);
  fireEvent.click(screen.getByRole("button", { name: "Copy these rates for long context" }));
  expect(screen.getByLabelText("New long-context one-hour cache write per 1M")).toHaveValue(12);
  const source = screen.getByLabelText("New long-context source");
  await user.clear(source); await user.type(source, "verified fixture");
  expect(screen.getByLabelText("New long-context source")).toBe(source);
  fireEvent.change(screen.getByLabelText("New long-context input per 1M"), { target: { value: "20" } });
  fireEvent.change(screen.getByLabelText("New long-context effective from UTC"), { target: { value: "2026-09-01T00:00" } });
  fireEvent.click(screen.getByRole("button", { name: "Add row" }));
  const label = "anthropic:fixture";
  expect(screen.getByLabelText(`${label} one-hour cache write per 1M`)).toHaveValue(12);
  expect(screen.getByLabelText(`${label} long-context input per 1M`)).toHaveValue(20);
  expect(screen.getByLabelText(`${label} long-context source`)).toHaveValue("verified fixture");
  const existing = screen.getByLabelText(`${label} long-context effective from UTC`);
  fireEvent.change(screen.getByLabelText(`${label} input per 1M`), { target: { value: "3" } });
  expect(screen.getByLabelText(`${label} long-context effective from UTC`)).toBe(existing);
  expect(existing).toHaveValue("2026-09-01T00:00");
  fireEvent.change(screen.getByLabelText(`${label} one-hour cache write per 1M`), { target: { value: "" } });
  expect(screen.getByLabelText(`${label} one-hour cache write per 1M`)).toHaveValue(null);
  fireEvent.click(screen.getByRole("button", { name: "Remove long-context rates", hidden: true }));
  expect(screen.queryByLabelText(`${label} long-context source`)).not.toBeInTheDocument();
  expect(screen.getByLabelText(`${label} input per 1M`)).toHaveValue(3);
});
