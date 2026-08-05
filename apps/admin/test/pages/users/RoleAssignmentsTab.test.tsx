// @vitest-environment jsdom
import { cleanup, fireEvent, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { RoleAssignmentsTab } from "../../../src/pages/users/RoleAssignmentsTab.js";
import { renderWithToast } from "../../test-utils.js";

const fetchRoleAssignments = vi.fn();
const revokeUserRole = vi.fn();
const useAuthMock = vi.fn(() => ({ assignments: [] as Array<{ role: string; scope_type: string; scope_id?: string | null }> }));

vi.mock("../../../src/api/client.js", () => ({
  fetchRoleAssignments: (...args: unknown[]) => fetchRoleAssignments(...args),
  revokeUserRole: (...args: unknown[]) => revokeUserRole(...args),
}));

vi.mock("../../../src/auth/AuthProvider.js", () => ({
  useAuth: () => useAuthMock(),
}));

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  // clearAllMocks wipes call history but not a persistent mockReturnValue - reassert the
  // no-permissions default so a superadmin override set by one test can't leak into the next.
  useAuthMock.mockReturnValue({ assignments: [] });
});

describe("RoleAssignmentsTab", () => {
  it("shows explicit empty placeholders for an unscoped, non-revocable assignment", async () => {
    fetchRoleAssignments.mockResolvedValue({
      assignments: [{
        id: "role-1",
        user_id: "user-1",
        user_email: "staff@example.com",
        user_display_name: null,
        role: "viewer",
        scope_type: "instance",
        scope_id: null,
        is_oidc: true,
        granted_at: "2026-01-01T00:00:00.000Z",
        event: null,
        organization: null,
      }],
      total: 1,
      page: 1,
      pageSize: 25,
    });

    renderWithToast(<RoleAssignmentsTab />);

    await screen.findAllByText("staff@example.com");
    expect(within(screen.getByRole("table")).getAllByText("-")).toHaveLength(2);
  });

  it("shows the capitalized role label, not the raw wire value, in the revoke confirmation", async () => {
    useAuthMock.mockReturnValue({ assignments: [{ role: "superadmin", scope_type: "instance" }] });
    fetchRoleAssignments.mockResolvedValue({
      assignments: [{
        id: "role-1",
        user_id: "user-1",
        user_email: "staff@example.com",
        user_display_name: null,
        role: "admin",
        scope_type: "instance",
        scope_id: null,
        is_oidc: false,
        granted_at: "2026-01-01T00:00:00.000Z",
        event: null,
        organization: null,
      }],
      total: 1,
      page: 1,
      pageSize: 25,
    });

    renderWithToast(<RoleAssignmentsTab />);

    await screen.findAllByText("staff@example.com");
    fireEvent.click(screen.getByRole("button", { name: "Revoke Administrator for staff@example.com" }));

    const dialog = await screen.findByRole("dialog");
    expect(dialog.textContent).toContain("Remove Administrator access for staff@example.com");
    expect(dialog.textContent).not.toContain("Remove admin access");
  });

  it("notifies the parent to refresh other tabs after a successful revoke", async () => {
    useAuthMock.mockReturnValue({ assignments: [{ role: "superadmin", scope_type: "instance" }] });
    fetchRoleAssignments.mockResolvedValue({
      assignments: [{
        id: "role-1",
        user_id: "user-1",
        user_email: "staff@example.com",
        user_display_name: null,
        role: "operator",
        scope_type: "event",
        scope_id: "evt-1",
        is_oidc: false,
        granted_at: "2026-01-01T00:00:00.000Z",
        event: { id: "evt-1", title: "Summer Summit" },
        organization: null,
      }],
      total: 1,
      page: 1,
      pageSize: 25,
    });
    revokeUserRole.mockResolvedValue(undefined);
    const onAssignmentsChanged = vi.fn();

    renderWithToast(<RoleAssignmentsTab onAssignmentsChanged={onAssignmentsChanged} />);

    await screen.findAllByText("staff@example.com");
    fireEvent.click(screen.getByRole("button", { name: "Revoke Operator for staff@example.com" }));
    const dialog = await screen.findByRole("dialog");
    fireEvent.click(within(dialog).getByRole("button", { name: "Revoke" }));

    await vi.waitFor(() => {
      expect(onAssignmentsChanged).toHaveBeenCalledOnce();
    });
    expect(revokeUserRole).toHaveBeenCalledWith("user-1", "role-1");
  });
});
