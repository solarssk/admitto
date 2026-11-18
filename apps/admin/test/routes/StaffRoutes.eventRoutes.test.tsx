// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter } from "react-router";
import { StaffRoutes } from "../../src/App.js";
import type { EventDto } from "../../src/api/types.js";

vi.mock("../../src/auth/AuthProvider.js", () => ({
  useAuth: () => ({ assignments: [], setupComplete: true, refresh: async () => {} }),
}));

// A direct visit carries no navigation state, so the layout reads the event from the API.
vi.mock("../../src/api/client.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../src/api/client.js")>()),
  fetchAdminEvent: async () => event,
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
  return {
    AdminShell: () => <Outlet />,
  };
});

vi.mock("../../src/pages/EventOverviewPage.js", () => ({
  EventOverviewPage: () => <div>mapped event overview</div>,
}));

vi.mock("../../src/pages/RegistrationPage.js", () => ({
  RegistrationPage: () => <div>mapped registration page</div>,
}));

vi.mock("../../src/pages/RequirementsPage.js", () => ({
  RequirementsPage: () => <div>mapped event items page</div>,
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

  it("opens the Registration page at its own address, not the placeholder", async () => {
    renderAt("/admin/events/evt-1/registration");

    expect(await screen.findByText("mapped registration page")).toBeTruthy();
    expect(screen.queryByText("placeholder:Registration")).toBeNull();
  });

  it("opens the Event items page at /event-items", async () => {
    renderAt("/admin/events/evt-1/event-items");

    expect(await screen.findByText("mapped event items page")).toBeTruthy();
  });

  it("sends the old /requirements address to /event-items, so old links and bookmarks still work", async () => {
    // Like a bookmark or an old link: a direct visit has no navigation state, so the layout reads the event itself.
    render(
      <MemoryRouter initialEntries={["/admin/events/evt-1/requirements"]}>
        <StaffRoutes />
      </MemoryRouter>,
    );

    expect(await screen.findByText("mapped event items page")).toBeTruthy();
  });

  it("falls back to the placeholder for an event section without an implementation", async () => {
    renderAt("/admin/events/evt-1/wallet");

    expect(await screen.findByText("placeholder:Wallet passes")).toBeTruthy();
  });
});
