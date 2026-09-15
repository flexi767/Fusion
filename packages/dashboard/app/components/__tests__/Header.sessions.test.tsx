import { fireEvent, render, screen } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import { Header } from "../Header";
vi.mock("../../api", () => ({ fetchScripts: async () => [] }));
vi.mock("../../hooks/useSessionsEnabled", () => ({ useSessionsEnabled: () => true }));
it.each(["mobile", "desktop"])("opens Sessions without a project on %s", tier => {
  vi.stubGlobal("matchMedia", vi.fn((query: string) => ({ matches: tier === "mobile" && query.includes("max-width: 768px"), media: query, addEventListener: vi.fn(), removeEventListener: vi.fn() })));
  const open = vi.fn();
  render(<Header onOpenSessions={open} />);
  fireEvent.click(screen.getByRole("button", { name: "Sessions" }));
  expect(open).toHaveBeenCalledOnce();
  vi.unstubAllGlobals();
});
