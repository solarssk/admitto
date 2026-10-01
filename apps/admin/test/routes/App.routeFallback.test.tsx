// @vitest-environment jsdom
import { act, cleanup, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { MemoryRouter } from "react-router";
import { afterEach, describe, expect, it, vi } from "vitest";
import App from "../../src/App.js";
import type { EventDto } from "../../src/api/types.js";
import { SLOW_NOTICE_TEXT } from "../../src/utils/loading-timing.js";

vi.mock("../../src/auth/AuthProvider.js", () => ({
  AuthProvider: ({ children }: { children: ReactNode }) => <>{children}</>,
  useAuth: () => ({ assignments: [], setupComplete: true, refresh: async () => {} }),
}));

vi.mock("../../src/connection/ConnectionStateProvider.js", () => ({
  ConnectionStateProvider: ({ children }: { children: ReactNode }) => <>{children}</>,
}));

vi.mock("../../src/auth/capabilities.js", () => ({
  isSuperadmin: () => false,
}));

vi.mock("../../src/auth/RoleRouter.js", async () => {
  const { Outlet } = await import("react-router");
  return {
    AdminGuard: () => <Outlet />,
    AuthenticatedGuard: () => <Outlet />,
    OperatorGuard: () => <Outlet />,
    SuperadminGuard: () => <Outlet />,
  };
});

vi.mock("../../src/layouts/AdminShell.js", async () => {
  const { Outlet } = await import("react-router");
  return { AdminShell: () => <Outlet /> };
});

// The first page's code never arrives: the route Suspense boundary stays on its fallback.
vi.mock("../../src/pages/EventOverviewPage.js", () => new Promise(() => {}));

const event = {
  id: "evt-1",
  title: "Spring Gala",
  slug: "spring-gala",
  date: "2026-09-01",
  timezone: "UTC",
  location: "Hall A",
  archived_at: null,
} as EventDto;

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe("App while the code of the first page is still downloading", () => {
  it("shows the full-screen loader, and says it is taking longer than usual after 8 seconds", async () => {
    vi.useFakeTimers();
    render(
      <MemoryRouter initialEntries={[{ pathname: "/admin/events/evt-1/overview", state: { event } }]}>
        <App />
      </MemoryRouter>,
    );
    expect(screen.getByRole("status", { name: "Loading page" })).toBeTruthy();
    // The line under the logo says what is loading, not just that something is.
    expect(screen.getByText("Loading page…")).toBeTruthy();
    // Structurally, too: the page-change bar has the same default name, so the name alone does not tell them apart.
    expect(document.querySelector(".shell-loading .at-loader--page")).not.toBeNull();
    expect(screen.queryByText(SLOW_NOTICE_TEXT)).toBeNull();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(8000);
    });
    expect(screen.getByText(SLOW_NOTICE_TEXT)).toBeTruthy();
  });
});
