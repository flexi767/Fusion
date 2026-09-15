import { lazy } from "react";
import { render, screen } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import type { MainContentProps } from "../types";
vi.mock("../../../api", async (importOriginal) => { const { createDashboardApiMock } = await import("../../../test/mockApi"); return createDashboardApiMock(() => importOriginal<typeof import("../../../api")>()); });
import { MainContent } from "../MainContent";
const SessionsProbe = lazy(async () => ({ default: () => <div>Global session history</div> }));
it.each([false, true])("opens external history with no registered project (mobile=%s)", async isMobile => {
  const props = { isMobile, viewMode: "overview", currentProject: null, projects: [], taskView: "sessions", pluginDashboardViews: [], modalManager: {}, SessionsView: SessionsProbe } as unknown as MainContentProps;
  render(<MainContent {...props} />);
  expect(await screen.findByText("Global session history")).toBeTruthy();
});
