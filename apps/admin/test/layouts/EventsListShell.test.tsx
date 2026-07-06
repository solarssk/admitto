// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { MemoryRouter, Outlet, Route, Routes } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { RoleAssignment } from "../../src/api/types.js";
import { EventsListShell } from "../../src/layouts/EventsListShell.js";

let mockAssignments: RoleAssignment[] = [];

vi.mock("../../src/auth/AuthProvider.js", () => ({
  useAuth: () => ({ assignments: mockAssignments }),
}));

vi.mock("../../src/layouts/StaffShell.js", () => ({
  StaffShell: ({ sidebar, children }: { sidebar: React.ReactNode; children: React.ReactNode }) => (
    <div>
      <nav data-testid="sidebar">{sidebar}</nav>
      {children}
    </div>
  ),
}));

function renderShell(path = "/admin") {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route element={<EventsListShell />}>
          <Route path="/admin" element={<div>events</div>} />
          <Route path="/account" element={<div>account</div>} />
        </Route>
        <Route path="/operator" element={<div>operator</div>} />
      </Routes>
    </MemoryRouter>,
  );
}

afterEach(() => {
  cleanup();
  mockAssignments = [];
});

describe("EventsListShell", () => {
  it("links the brand to /admin for admin-panel users", () => {
    mockAssignments = [{ role: "superadmin", scope_type: "instance", scope_id: null }];
    renderShell("/admin");
    const brand = screen.getByRole("link", { name: "Admitto" });
    expect(brand.getAttribute("href")).toBe("/admin");
    expect(screen.getByRole("link", { name: "All events" })).toBeTruthy();
  });

  it("links the brand to /operator for check-in-only operators", () => {
    mockAssignments = [{ role: "operator", scope_type: "event", scope_id: "evt-1" }];
    renderShell("/account");
    const brand = screen.getByRole("link", { name: "Admitto" });
    expect(brand.getAttribute("href")).toBe("/operator");
    expect(screen.getByRole("link", { name: "Check-in" })).toBeTruthy();
  });

  it("links the brand to /account when user has no admin or check-in access", () => {
    mockAssignments = [];
    renderShell("/account");
    const brand = screen.getByRole("link", { name: "Admitto" });
    expect(brand.getAttribute("href")).toBe("/account");
    expect(screen.queryByRole("link", { name: "All events" })).toBeNull();
    expect(screen.queryByRole("link", { name: "Check-in" })).toBeNull();
  });
});
