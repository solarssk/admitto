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
  it("shows administration links for superadmin", () => {
    mockAssignments = [{ role: "superadmin", scope_type: "instance", scope_id: null }];
    render(
      <MemoryRouter>
        <InstanceSidebarFoot />
      </MemoryRouter>,
    );
    expect(screen.getByRole("link", { name: "Users & roles" }).getAttribute("href")).toBe(
      "/admin/users",
    );
    expect(screen.getByRole("link", { name: "Organisation settings" }).getAttribute("href")).toBe(
      "/admin/settings",
    );
    expect(screen.getByText(/^v\d/)).toBeTruthy();
    // Its own element (not just present in the version span's combined text) - the collapsed
    // sidebar rail hides it via `.shell:not(.shell--nav-open) .sidebar__build-commit`, which
    // only works if the commit SHA has a selectable node of its own, separate from the version.
    expect(document.querySelector(".sidebar__build-commit")).toBeTruthy();
  });

  it("renders no administration links for check-in-only operators", () => {
    mockAssignments = [{ role: "operator", scope_type: "event", scope_id: "evt-1" }];
    render(
      <MemoryRouter>
        <InstanceSidebarFoot />
      </MemoryRouter>,
    );
    expect(screen.queryByRole("link", { name: "Users & roles" })).toBeNull();
    expect(screen.queryByRole("link", { name: "Organisation settings" })).toBeNull();
    expect(screen.getByText(/^v\d/)).toBeTruthy();
  });

  it("hides Settings for org admin without superadmin", () => {
    mockAssignments = [{ role: "admin", scope_type: "organization", scope_id: "org-1" }];
    render(
      <MemoryRouter>
        <InstanceSidebarFoot />
      </MemoryRouter>,
    );
    expect(screen.getByRole("link", { name: "Users & roles" })).toBeTruthy();
    expect(screen.queryByRole("link", { name: "Organisation settings" })).toBeNull();
  });

  it("renders no administration links for a role with neither admin nor check-in access", () => {
    mockAssignments = [];
    render(
      <MemoryRouter>
        <InstanceSidebarFoot />
      </MemoryRouter>,
    );
    expect(screen.queryByRole("link", { name: "Users & roles" })).toBeNull();
    expect(screen.queryByRole("link", { name: "Organisation settings" })).toBeNull();
    expect(screen.getByText(/^v\d/)).toBeTruthy();
  });

  it("marks the current route's nav link as active", () => {
    mockAssignments = [{ role: "superadmin", scope_type: "instance", scope_id: null }];
    render(
      <MemoryRouter initialEntries={["/admin/users"]}>
        <InstanceSidebarFoot />
      </MemoryRouter>,
    );
    expect(screen.getByRole("link", { name: "Users & roles" }).className).toContain(
      "nav-item--active",
    );
    expect(screen.getByRole("link", { name: "Organisation settings" }).className).not.toContain(
      "nav-item--active",
    );
  });
});
