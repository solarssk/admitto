// @vitest-environment jsdom
import { cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { RoleAssignmentsTab } from "../../../src/pages/users/RoleAssignmentsTab.js";
import { renderWithToast } from "../../test-utils.js";

const fetchRoleAssignments = vi.fn();
const revokeUserRole = vi.fn();
const useAuthMock = vi.fn(() => ({
  assignments: [] as Array<{ role: string; scope_type: string; scope_id?: string | null }>,
  user: { id: "current-admin" },
}));

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
  useAuthMock.mockReturnValue({ assignments: [], user: { id: "current-admin" } });
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

  it("debounces the search box before refetching with the trimmed term", async () => {
    fetchRoleAssignments.mockResolvedValue({ assignments: [], total: 0, page: 1, pageSize: 25 });
    renderWithToast(<RoleAssignmentsTab />);
    await waitFor(() => expect(fetchRoleAssignments).toHaveBeenCalledOnce());

    fireEvent.change(screen.getByLabelText("Search role assignments by user name or email"), {
      target: { value: "jane" },
    });
    await new Promise((r) => setTimeout(r, 400));

    await waitFor(() => {
      expect(fetchRoleAssignments).toHaveBeenLastCalledWith(
        expect.objectContaining({ q: "jane", page: 1 }),
        expect.anything(),
      );
    });
  });

  it("shows a search-specific empty state with a button that clears the search", async () => {
    fetchRoleAssignments.mockResolvedValue({ assignments: [], total: 0, page: 1, pageSize: 25 });
    renderWithToast(<RoleAssignmentsTab />);
    await waitFor(() => expect(fetchRoleAssignments).toHaveBeenCalledOnce());

    fireEvent.change(screen.getByLabelText("Search role assignments by user name or email"), {
      target: { value: "nomatch" },
    });
    await new Promise((r) => setTimeout(r, 400));
    await waitFor(() => {
      expect(fetchRoleAssignments).toHaveBeenLastCalledWith(
        expect.objectContaining({ q: "nomatch", page: 1 }),
        expect.anything(),
      );
    });
    expect(await screen.findByText("No role assignments match your search")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Clear search" }));

    expect(
      (screen.getByLabelText("Search role assignments by user name or email") as HTMLInputElement).value,
    ).toBe("");
  });

  it("shows the capitalized role label, not the raw wire value, in the revoke confirmation", async () => {
    useAuthMock.mockReturnValue({
      assignments: [{ role: "superadmin", scope_type: "instance" }],
      user: { id: "current-admin" },
    });
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

  it("never offers to revoke the signed-in superadmin's own assignment, even though they can manage everyone else's", async () => {
    useAuthMock.mockReturnValue({
      assignments: [{ role: "superadmin", scope_type: "instance" }],
      user: { id: "current-admin" },
    });
    fetchRoleAssignments.mockResolvedValue({
      assignments: [{
        id: "role-1",
        user_id: "current-admin",
        user_email: "me@example.com",
        user_display_name: null,
        role: "superadmin",
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

    await screen.findAllByText("me@example.com");
    expect(screen.queryByRole("button", { name: /Revoke/ })).toBeNull();
  });

  it("notifies the parent to refresh other tabs after a successful revoke", async () => {
    useAuthMock.mockReturnValue({
      assignments: [{ role: "superadmin", scope_type: "instance" }],
      user: { id: "current-admin" },
    });
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
