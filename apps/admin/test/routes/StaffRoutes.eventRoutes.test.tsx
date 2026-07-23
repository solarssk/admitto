// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter } from "react-router-dom";
import { StaffRoutes } from "../../src/App.js";
import type { EventDto } from "../../src/api/types.js";

vi.mock("../../src/auth/AuthProvider.js", () => ({
  useAuth: () => ({ assignments: [], setupComplete: true, refresh: async () => {} }),
}));

vi.mock("../../src/auth/capabilities.js", () => ({
  isSuperadmin: () => false,
}));

vi.mock("../../src/auth/RoleRouter.js", async () => {
  const { Outlet } = await import("react-router-dom");
  return {
    AdminGuard: () => <Outlet />,
    AuthenticatedGuard: () => <Outlet />,
    OperatorGuard: () => <Outlet />,
    SuperadminGuard: () => <Outlet />,
  };
});

vi.mock("../../src/layouts/AdminShell.js", async () => {
  const { Outlet } = await import("react-router-dom");
  return {
    AdminShell: () => <Outlet />,
  };
});

vi.mock("../../src/pages/EventOverviewPage.js", () => ({
  EventOverviewPage: () => <div>mapped event overview</div>,
}));

vi.mock("../../src/pages/PlaceholderPage.js", () => ({
  PlaceholderPage: ({ title }: { title: string }) => <div>placeholder:{title}</div>,
}));

const event: EventDto = {
  id: "evt-1",
  title: "Spring Gala",
  slug: "spring-gala",
  date: "2026-09-01",
  timezone: "UTC",
  location: "Hall A",
  archived_at: null,
} as EventDto;

function renderAt(pathname: string) {
  return render(
    <MemoryRouter initialEntries={[{ pathname, state: { event } }]}>
      <StaffRoutes />
    </MemoryRouter>,
  );
}

afterEach(() => {
  cleanup();
});

describe("StaffRoutes event route selection", () => {
  it("uses the mapped implementation for an available event section", async () => {
    renderAt("/admin/events/evt-1/overview");

    expect(await screen.findByText("mapped event overview")).toBeTruthy();
    expect(screen.queryByText("placeholder:Overview")).toBeNull();
  });

  it("falls back to the placeholder for an event section without an implementation", async () => {
    renderAt("/admin/events/evt-1/approval");

    expect(await screen.findByText("placeholder:Approval & waitlist")).toBeTruthy();
  });
});
