// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { MemoryRouter, Route, Routes } from "react-router";
import { UserMenu } from "../../src/components/UserMenu.js";
import type { AuthUser, RoleAssignment } from "../../src/api/types.js";

const USER: AuthUser = {
  id: "u1",
  email: "ola@example.com",
  display_name: "Ola Operator",
  is_active: true,
  created_at: "2026-01-01T00:00:00.000Z",
};

function renderMenu(assignments: RoleAssignment[]) {
  return render(
    <MemoryRouter>
      <Routes>
        <Route path="/" element={<UserMenu user={USER} assignments={assignments} />} />
        <Route path="/account" element={<div>account-page</div>} />
      </Routes>
    </MemoryRouter>,
  );
}

afterEach(cleanup);

describe("UserMenu", () => {
  it("shows the display name on the trigger and opens the panel on click", () => {
    renderMenu([{ role: "operator", scope_type: "event", scope_id: "evt-1" }]);
    expect(screen.getByText("Ola Operator")).toBeTruthy();
    expect(screen.queryByRole("menuitem", { name: /My account/ })).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: /Ola Operator/ }));
    expect(screen.getByRole("menuitem", { name: /My account/ })).toBeTruthy();
  });

  it("shows the Superadmin role badge for a superadmin", () => {
    renderMenu([{ role: "superadmin", scope_type: "instance", scope_id: null }]);
    fireEvent.click(screen.getByRole("button", { name: /Ola Operator/ }));
    expect(screen.getByText("Superadmin")).toBeTruthy();
  });

  it("shows the Admin role badge for an org admin", () => {
    renderMenu([{ role: "admin", scope_type: "organization", scope_id: "org-1" }]);
    fireEvent.click(screen.getByRole("button", { name: /Ola Operator/ }));
    expect(screen.getByText("Admin")).toBeTruthy();
  });

  it("shows the Operator role badge for an operator", () => {
    renderMenu([{ role: "operator", scope_type: "event", scope_id: "evt-1" }]);
    fireEvent.click(screen.getByRole("button", { name: /Ola Operator/ }));
    expect(screen.getByText("Operator")).toBeTruthy();
  });

  it("navigates to /account when 'My account' is clicked", () => {
    renderMenu([{ role: "operator", scope_type: "event", scope_id: "evt-1" }]);
    fireEvent.click(screen.getByRole("button", { name: /Ola Operator/ }));
    fireEvent.click(screen.getByRole("menuitem", { name: /My account/ }));
    expect(screen.getByText("account-page")).toBeTruthy();
  });

  it("renders a sign-out form posting to /logout", () => {
    renderMenu([{ role: "operator", scope_type: "event", scope_id: "evt-1" }]);
    fireEvent.click(screen.getByRole("button", { name: /Ola Operator/ }));
    const signOut = screen.getByRole("menuitem", { name: /Sign out/ }) as HTMLButtonElement;
    expect(signOut.type).toBe("submit");
    const form = signOut.closest("form");
    expect(form?.getAttribute("action")).toBe("/logout");
    expect(form?.getAttribute("method")).toBe("post");
  });
});
