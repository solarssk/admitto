// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter, Route, Routes } from "react-router";
import type { RoleAssignment } from "../../src/api/types.js";
import { AdminGuard, OperatorGuard, SuperadminGuard } from "../../src/auth/RoleRouter.js";

let assignments: RoleAssignment[] = [];

vi.mock("../../src/auth/AuthProvider.js", () => ({
  useAuth: () => ({ assignments }),
}));

afterEach(() => {
  cleanup();
  assignments = [];
});

const superadminAssignment: RoleAssignment = { role: "superadmin", scope_type: "instance", scope_id: null };
const orgAdminAssignment: RoleAssignment = { role: "admin", scope_type: "organization", scope_id: "org-1" };
const operatorAssignment: RoleAssignment = { role: "operator", scope_type: "event", scope_id: "evt-1" };

describe("OperatorGuard", () => {
  function renderAtOperator(path = "/operator") {
    render(
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          <Route path="/operator" element={<OperatorGuard />}>
            <Route index element={<p>Operator content</p>} />
            <Route path="events/:eventId/checkin" element={<p>Check-in content</p>} />
          </Route>
          <Route path="/admin" element={<p>Admin home</p>} />
        </Routes>
      </MemoryRouter>,
    );
  }

  it("renders the operator outlet for an operator-only assignment", () => {
    assignments = [operatorAssignment];
    renderAtOperator();
    expect(screen.getByText("Operator content")).toBeTruthy();
  });

  // Regression: canAccessCheckInPanel() also returns true for superadmins/org admins (they can
  // drive check-in from the admin panel's own Check-in tab), so a naive "can check in?" check
  // alone would let them stay on /operator instead of being sent back to /admin.
  it("redirects a superadmin away from /operator to /admin", () => {
    assignments = [superadminAssignment];
    renderAtOperator();
    expect(screen.getByText("Admin home")).toBeTruthy();
    expect(screen.queryByText("Operator content")).toBeNull();
  });

  it("redirects an org admin away from /operator to /admin", () => {
    assignments = [orgAdminAssignment];
    renderAtOperator();
    expect(screen.getByText("Admin home")).toBeTruthy();
    expect(screen.queryByText("Operator content")).toBeNull();
  });

  it("preserves the operator picker and event route for mixed-scope staff", () => {
    assignments = [orgAdminAssignment, operatorAssignment];
    renderAtOperator();
    expect(screen.getByText("Operator content")).toBeTruthy();

    cleanup();
    renderAtOperator("/operator/events/evt-1/checkin");
    expect(screen.getByText("Check-in content")).toBeTruthy();
    expect(screen.queryByText("Admin home")).toBeNull();
  });

  it("redirects to login when the assignment has neither admin nor check-in access", () => {
    assignments = [];
    vi.stubGlobal("location", { ...window.location, assign: vi.fn(), pathname: "/operator", search: "" });
    renderAtOperator();
    expect(screen.getByText("Redirecting to sign in…")).toBeTruthy();
    expect(window.location.assign).toHaveBeenCalledWith("/login?next=%2Foperator");
    vi.unstubAllGlobals();
  });
});

describe("AdminGuard", () => {
  it("renders the admin outlet for a superadmin", () => {
    assignments = [superadminAssignment];
    render(
      <MemoryRouter initialEntries={["/admin"]}>
        <Routes>
          <Route path="/admin" element={<AdminGuard />}>
            <Route index element={<p>Admin content</p>} />
          </Route>
        </Routes>
      </MemoryRouter>,
    );
    expect(screen.getByText("Admin content")).toBeTruthy();
  });

  it("redirects an operator-only assignment from /admin to /operator", () => {
    assignments = [operatorAssignment];
    render(
      <MemoryRouter initialEntries={["/admin"]}>
        <Routes>
          <Route path="/admin" element={<AdminGuard />}>
            <Route index element={<p>Admin content</p>} />
          </Route>
          <Route path="/operator" element={<p>Operator home</p>} />
        </Routes>
      </MemoryRouter>,
    );
    expect(screen.getByText("Operator home")).toBeTruthy();
  });
});

describe("SuperadminGuard", () => {
  function renderAtSettings() {
    render(
      <MemoryRouter initialEntries={["/admin/settings"]}>
        <Routes>
          <Route path="/admin/settings" element={<SuperadminGuard />}>
            <Route index element={<p>Settings content</p>} />
          </Route>
          <Route path="/admin" element={<p>Admin home</p>} />
        </Routes>
      </MemoryRouter>,
    );
  }

  it("renders the outlet for a superadmin", () => {
    assignments = [superadminAssignment];
    renderAtSettings();
    expect(screen.getByText("Settings content")).toBeTruthy();
  });

  it("redirects a non-superadmin org admin back to /admin", () => {
    assignments = [orgAdminAssignment];
    renderAtSettings();
    expect(screen.getByText("Admin home")).toBeTruthy();
    expect(screen.queryByText("Settings content")).toBeNull();
  });
});
