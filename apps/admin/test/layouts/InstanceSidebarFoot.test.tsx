// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { RoleAssignment } from "../../src/api/types.js";
import { InstanceSidebarFoot } from "../../src/layouts/InstanceSidebarFoot.js";

let mockAssignments: RoleAssignment[] = [];

vi.mock("../../src/auth/AuthProvider.js", () => ({
  useAuth: () => ({ assignments: mockAssignments }),
}));

afterEach(() => {
  cleanup();
  mockAssignments = [];
});

describe("InstanceSidebarFoot", () => {
  it("shows All events, administration links, account, and docs for superadmin", () => {
    mockAssignments = [{ role: "superadmin", scope_type: "instance", scope_id: null }];
    render(
      <MemoryRouter>
        <InstanceSidebarFoot />
      </MemoryRouter>,
    );
    expect(screen.getByRole("link", { name: "All events" }).getAttribute("href")).toBe("/admin");
    expect(screen.getByRole("link", { name: "Users & roles" })).toBeTruthy();
    expect(screen.getByRole("link", { name: "Settings" })).toBeTruthy();
    expect(screen.getByRole("link", { name: "My account" }).getAttribute("href")).toBe("/account");
    expect(screen.getByRole("link", { name: "Documentation" }).getAttribute("href")).toBe(
      "https://github.com/solarssk/admitto/wiki",
    );
    expect(screen.getByText(/^v\d/)).toBeTruthy();
  });

  it("shows Check-in instead of All events for check-in-only operators", () => {
    mockAssignments = [{ role: "operator", scope_type: "event", scope_id: "evt-1" }];
    render(
      <MemoryRouter>
        <InstanceSidebarFoot />
      </MemoryRouter>,
    );
    expect(screen.getByRole("link", { name: "Check-in" }).getAttribute("href")).toBe("/operator");
    expect(screen.queryByRole("link", { name: "All events" })).toBeNull();
    expect(screen.queryByRole("link", { name: "Users & roles" })).toBeNull();
    expect(screen.getByRole("link", { name: "My account" })).toBeTruthy();
  });

  it("hides Settings for org admin without superadmin", () => {
    mockAssignments = [{ role: "admin", scope_type: "organization", scope_id: "org-1" }];
    render(
      <MemoryRouter>
        <InstanceSidebarFoot />
      </MemoryRouter>,
    );
    expect(screen.getByRole("link", { name: "All events" })).toBeTruthy();
    expect(screen.getByRole("link", { name: "Users & roles" })).toBeTruthy();
    expect(screen.queryByRole("link", { name: "Settings" })).toBeNull();
  });

  it("hides primary nav when omitPrimary is set for operator-only account views", () => {
    mockAssignments = [{ role: "operator", scope_type: "event", scope_id: "evt-1" }];
    render(
      <MemoryRouter>
        <InstanceSidebarFoot omitPrimary />
      </MemoryRouter>,
    );
    expect(screen.queryByRole("link", { name: "Check-in" })).toBeNull();
    expect(screen.queryByRole("link", { name: "All events" })).toBeNull();
    expect(screen.getByRole("link", { name: "My account" })).toBeTruthy();
  });
});
