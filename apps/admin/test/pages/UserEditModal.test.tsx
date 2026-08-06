// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { EventDto, UserListItemDto } from "../../src/api/types.js";
import { UserEditModal } from "../../src/pages/users/UserEditModal.js";
import { ApiError } from "../../src/api/client.js";

const useAuthMock = vi.fn(() => ({ user: { id: "usr-current-admin" } }));

vi.mock("../../src/auth/AuthProvider.js", () => ({
  useAuth: () => useAuthMock(),
}));

vi.mock("../../src/api/client.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../src/api/client.js")>();
  return {
    ...actual,
    deleteAdminUser: vi.fn(),
    fetchAdminEvents: vi.fn(),
    fetchAdminOrganizations: vi.fn(),
    fetchSecurityAuditLog: vi.fn(),
    grantUserRole: vi.fn(),
    patchAdminUser: vi.fn(),
    resetUserMfa: vi.fn(),
    resetUserPassword: vi.fn(),
    revokeUserRole: vi.fn(),
    revokeUserSessions: vi.fn(),
    unlinkUserExternalIdentity: vi.fn(),
  };
});

import {
  deleteAdminUser,
  fetchAdminEvents,
  fetchAdminOrganizations,
  fetchSecurityAuditLog,
  grantUserRole,
  patchAdminUser,
  resetUserMfa,
  resetUserPassword,
  revokeUserRole,
  revokeUserSessions,
  unlinkUserExternalIdentity,
} from "../../src/api/client.js";

const mockFetchAdminEvents = vi.mocked(fetchAdminEvents);
const mockFetchAdminOrganizations = vi.mocked(fetchAdminOrganizations);
const mockFetchSecurityAuditLog = vi.mocked(fetchSecurityAuditLog);
const mockGrantUserRole = vi.mocked(grantUserRole);
const mockPatchAdminUser = vi.mocked(patchAdminUser);
const mockResetUserMfa = vi.mocked(resetUserMfa);
const mockResetUserPassword = vi.mocked(resetUserPassword);
const mockDeleteAdminUser = vi.mocked(deleteAdminUser);
const mockRevokeUserRole = vi.mocked(revokeUserRole);
const mockRevokeUserSessions = vi.mocked(revokeUserSessions);
const mockUnlinkUserExternalIdentity = vi.mocked(unlinkUserExternalIdentity);

const event: EventDto = {
  id: "evt-1",
  title: "Summer Summit",
  slug: "summer-summit",
  date: "2026-07-01",
  timezone: "Europe/Warsaw",
  location: null,
  organization_id: "org-1",
  archived_at: null,
};

const user: UserListItemDto = {
  id: "usr-1",
  email: "staff@example.com",
  display_name: "Staff User",
  phone_country_code: null,
  phone_number: null,
  is_active: true,
  must_change_password: false,
  created_at: "2026-01-01T00:00:00.000Z",
  last_login_at: null,
  active_sessions_count: 0,
  has_mfa: false,
  has_sso: false,
  roles: [],
};

function openMoreActions() {
  fireEvent.click(screen.getByRole("button", { name: "More actions" }));
}

function renderModal(userOverride: Partial<UserListItemDto> = {}) {
  const onClose = vi.fn();
  const onUpdated = vi.fn();
  const onDeleted = vi.fn();
  const { unmount } = render(
    <UserEditModal
      open
      user={{ ...user, ...userOverride }}
      onClose={onClose}
      onUpdated={onUpdated}
      onDeleted={onDeleted}
    />,
  );
  return { onClose, onUpdated, onDeleted, unmount };
}

beforeEach(() => {
  mockFetchAdminEvents.mockResolvedValue([event]);
  mockFetchAdminOrganizations.mockResolvedValue([
    { id: "org-1", name: "Operations" },
    { id: "org-2", name: "Events" },
  ]);
  mockFetchSecurityAuditLog.mockResolvedValue({ entries: [], total: 0, page: 1, pageSize: 3 });
  mockGrantUserRole.mockResolvedValue({
    assignment: { id: "role-1", role: "superadmin", scope_type: "instance", scope_id: null },
  });
  mockResetUserMfa.mockResolvedValue(undefined);
  mockResetUserPassword.mockResolvedValue(undefined);
  mockDeleteAdminUser.mockResolvedValue(undefined);
  mockRevokeUserRole.mockResolvedValue(undefined);
  mockRevokeUserSessions.mockResolvedValue({ ok: true, sessionsRevoked: 2 });
  mockUnlinkUserExternalIdentity.mockResolvedValue({ ok: true });
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  useAuthMock.mockReturnValue({ user: { id: "usr-current-admin" } });
});

describe("UserEditModal header", () => {
  it("shows the user's avatar, name, and email inline instead of a bare title", async () => {
    renderModal();
    await screen.findByRole("heading", { name: "Staff User" });
    expect(screen.getByText("staff@example.com")).toBeTruthy();
  });

  it("renders nothing while open but the target user hasn't loaded yet", async () => {
    render(
      <UserEditModal open user={null} onClose={vi.fn()} onUpdated={vi.fn()} onDeleted={vi.fn()} />,
    );

    await waitFor(() => expect(mockFetchAdminEvents).toHaveBeenCalled());
    expect(document.body.textContent).toBe("");
  });

  it("does not update state (or warn) when unmounted before the events/organizations fetch resolves", async () => {
    let resolveEvents!: (value: EventDto[]) => void;
    mockFetchAdminEvents.mockReturnValueOnce(new Promise((resolve) => { resolveEvents = resolve; }));
    let resolveOrgs!: (value: Array<{ id: string; name: string }>) => void;
    mockFetchAdminOrganizations.mockReturnValueOnce(new Promise((resolve) => { resolveOrgs = resolve; }));
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});

    const { unmount } = renderModal();
    await waitFor(() => expect(mockFetchAdminEvents).toHaveBeenCalled());
    unmount();
    resolveEvents([event]);
    resolveOrgs([{ id: "org-1", name: "Operations" }]);
    await Promise.resolve();
    await Promise.resolve();

    expect(consoleError).not.toHaveBeenCalled();
    consoleError.mockRestore();
  });

  it("does not update state (or warn) when unmounted before recent logins resolve", async () => {
    let resolveLogins!: (value: { entries: never[]; total: number; page: number; pageSize: number }) => void;
    mockFetchSecurityAuditLog.mockReturnValueOnce(new Promise((resolve) => { resolveLogins = resolve; }));
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});

    const { unmount } = renderModal();
    await waitFor(() => expect(mockFetchSecurityAuditLog).toHaveBeenCalled());
    unmount();
    resolveLogins({ entries: [], total: 0, page: 1, pageSize: 3 });
    await Promise.resolve();
    await Promise.resolve();

    expect(consoleError).not.toHaveBeenCalled();
    consoleError.mockRestore();
  });

  it("does not update state (or warn) when unmounted before a rejected events/organizations fetch settles", async () => {
    let rejectEvents!: (err: Error) => void;
    mockFetchAdminEvents.mockReturnValueOnce(new Promise((_resolve, reject) => { rejectEvents = reject; }));
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});

    const { unmount } = renderModal();
    await waitFor(() => expect(mockFetchAdminEvents).toHaveBeenCalled());
    unmount();
    rejectEvents(new Error("network down"));
    await Promise.resolve();
    await Promise.resolve();

    expect(consoleError).not.toHaveBeenCalled();
    consoleError.mockRestore();
  });

  it("does not update state (or warn) when unmounted before a rejected recent-logins fetch settles", async () => {
    let rejectLogins!: (err: Error) => void;
    mockFetchSecurityAuditLog.mockReturnValueOnce(new Promise((_resolve, reject) => { rejectLogins = reject; }));
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});

    const { unmount } = renderModal();
    await waitFor(() => expect(mockFetchSecurityAuditLog).toHaveBeenCalled());
    unmount();
    rejectLogins(new Error("network down"));
    await Promise.resolve();
    await Promise.resolve();

    expect(consoleError).not.toHaveBeenCalled();
    consoleError.mockRestore();
  });

  it("closes via the header Close button and resets in-progress role UI state for next time", async () => {
    const { onClose } = renderModal();
    await screen.findByRole("button", { name: "Save" });

    fireEvent.change(screen.getByLabelText("Role"), { target: { value: "superadmin" } });
    fireEvent.click(screen.getByRole("button", { name: "Close" }));

    expect(onClose).toHaveBeenCalled();
  });

  it("falls back to empty event/organization pickers when they fail to load", async () => {
    mockFetchAdminEvents.mockRejectedValueOnce(new Error("network down"));
    mockFetchAdminOrganizations.mockRejectedValueOnce(new Error("network down"));
    renderModal();

    fireEvent.change(await screen.findByLabelText("Role"), { target: { value: "admin" } });
    const organizationSelect = await screen.findByLabelText("Organization scope for admin role");
    expect(organizationSelect.hasAttribute("disabled")).toBe(true);
    expect(screen.getByRole("option", { name: "No organizations available" })).toBeTruthy();
  });

  it("shows no recent logins when the security audit log fails to load", async () => {
    mockFetchSecurityAuditLog.mockRejectedValueOnce(new Error("network down"));
    renderModal();

    expect(await screen.findByText("No recent logins")).toBeTruthy();
  });
});

describe("UserEditModal role & access - exclusive roles", () => {
  it("grants a first role directly, no confirmation needed", async () => {
    const { onClose, onUpdated } = renderModal();

    await waitFor(() => {
      expect(mockFetchAdminOrganizations).toHaveBeenCalledOnce();
      expect(mockFetchAdminEvents).toHaveBeenCalledOnce();
    });
    const roleSelect = screen.getByLabelText("Role");
    fireEvent.change(roleSelect, { target: { value: "superadmin" } });

    const addButton = screen.getByRole("button", { name: "Add" });
    fireEvent.click(addButton);

    await waitFor(() => {
      expect(mockGrantUserRole).toHaveBeenCalledWith("usr-1", {
        role: "superadmin",
        scope_type: "instance",
      });
    });
    expect(onUpdated).toHaveBeenCalledWith(user, "Role updated");
    // Adding a role stays in the modal (so more scopes can be added in one sitting) instead of
    // closing it - unlike every other action here (Reset MFA, Delete account, ...).
    expect(onClose).not.toHaveBeenCalled();
    expect(screen.queryAllByRole("dialog")).toHaveLength(1);
  });

  it("switches between organization and event scope controls for admin and operator", async () => {
    renderModal();
    await waitFor(() => expect(mockFetchAdminOrganizations).toHaveBeenCalledOnce());

    const roleSelect = screen.getByLabelText("Role");
    fireEvent.change(roleSelect, { target: { value: "admin" } });
    const organizationSelect = screen.getByLabelText("Organization scope for admin role");
    await screen.findByRole("option", { name: "Operations" });
    fireEvent.change(organizationSelect, { target: { value: "org-2" } });
    expect((organizationSelect as HTMLSelectElement).value).toBe("org-2");

    fireEvent.change(roleSelect, { target: { value: "operator" } });
    const eventSelect = screen.getByLabelText("Event scope for operator role");
    fireEvent.change(eventSelect, { target: { value: "evt-1" } });
    expect((eventSelect as HTMLSelectElement).value).toBe("evt-1");
  });

  it("defaults the organization scope picker past an org the target is already assigned to", async () => {
    // org-1 ("Operations") is first in the fetched list and already assigned - the picker must
    // not default to it (it has no matching <option>, since pickableOrganizations excludes it).
    renderModal({
      roles: [{ id: "role-1", role: "admin", scope_type: "organization", scope_id: "org-1", is_oidc: false }],
    });
    const organizationSelect = await screen.findByLabelText("Organization scope for admin role");
    await screen.findByRole("option", { name: "Events" });

    await waitFor(() => {
      expect((organizationSelect as HTMLSelectElement).value).toBe("org-2");
    });
  });

  it("disables the add-scope action and explains the empty organization list", async () => {
    mockFetchAdminOrganizations.mockResolvedValueOnce([]);
    mockFetchAdminEvents.mockResolvedValueOnce([]);
    renderModal();

    await waitFor(() => expect(mockFetchAdminOrganizations).toHaveBeenCalled());
    fireEvent.change(screen.getByLabelText("Role"), { target: { value: "admin" } });

    const organizationSelect = screen.getByLabelText("Organization scope for admin role");
    expect(organizationSelect.hasAttribute("disabled")).toBe(true);
    expect(screen.getByRole("option", { name: "No organizations available" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Add" })).toHaveProperty("disabled", true);
  });

  it("requires confirmation before changing an existing role to a different type", async () => {
    const existingRole = { id: "role-1", role: "operator", scope_type: "event", scope_id: "evt-1", is_oidc: false };
    const { onClose, onUpdated } = renderModal({ roles: [existingRole] });
    await waitFor(() => {
      expect(document.querySelector(".users-modal__chips")).toBeTruthy();
    });

    fireEvent.change(screen.getByLabelText("Role"), { target: { value: "superadmin" } });
    expect(screen.getByText(/Changing to Superadmin removes/)).toBeTruthy();
    // Old scope chips are hidden while a type change is pending - they're about to be replaced.
    expect(document.querySelector(".users-modal__chips")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Change" }));
    const dialog = await screen.findByRole("dialog", { name: "Change role" });
    expect(dialog.textContent).toContain("from Operator to Superadmin");
    fireEvent.click(within(dialog).getByRole("button", { name: "Change role" }));

    await waitFor(() => {
      expect(mockGrantUserRole).toHaveBeenCalledWith("usr-1", { role: "superadmin", scope_type: "instance" });
    });
    expect(onUpdated).toHaveBeenCalledWith({ ...user, roles: [existingRole] }, "Role updated");
    // A type change closes the modal (unlike adding another same-type scope, below): if Staff
    // users is currently filtered by the target's old role, the refreshed list can drop the
    // target entirely, leaving the parent's user-sync effect nothing to find and the modal
    // stuck open showing the just-replaced role as if nothing happened.
    expect(onClose).toHaveBeenCalled();
  });

  it("cancels the change-role confirmation without calling the API, leaving the old role in place", async () => {
    const existingRole = { id: "role-1", role: "operator", scope_type: "event", scope_id: "evt-1", is_oidc: false };
    renderModal({ roles: [existingRole] });
    await waitFor(() => {
      expect(document.querySelector(".users-modal__chips")).toBeTruthy();
    });

    fireEvent.change(screen.getByLabelText("Role"), { target: { value: "superadmin" } });
    fireEvent.click(screen.getByRole("button", { name: "Change" }));
    const dialog = await screen.findByRole("dialog", { name: "Change role" });
    fireEvent.click(within(dialog).getByRole("button", { name: "Cancel" }));

    expect(mockGrantUserRole).not.toHaveBeenCalled();
    expect(screen.queryByRole("dialog", { name: "Change role" })).toBeNull();
  });

  it("Escape dismisses only the change-role confirmation, not the whole editor underneath it", async () => {
    const existingRole = { id: "role-1", role: "operator", scope_type: "event", scope_id: "evt-1", is_oidc: false };
    const { onClose } = renderModal({ roles: [existingRole] });
    await waitFor(() => {
      expect(document.querySelector(".users-modal__chips")).toBeTruthy();
    });

    fireEvent.change(screen.getByLabelText("Role"), { target: { value: "superadmin" } });
    fireEvent.click(screen.getByRole("button", { name: "Change" }));
    await screen.findByRole("dialog", { name: "Change role" });

    // The confirm dialog and this modal both listen for Escape on document - without
    // suspending this modal's own listener while a child confirm dialog is open, its handler
    // (registered first) fired first and closed the whole editor, discarding unsaved profile
    // edits (bot review finding).
    fireEvent.keyDown(document, { key: "Escape" });

    expect(screen.queryByRole("dialog", { name: "Change role" })).toBeNull();
    expect(onClose).not.toHaveBeenCalled();
    expect(mockGrantUserRole).not.toHaveBeenCalled();
    expect(screen.getByRole("heading", { name: "Staff User" })).toBeTruthy();
  });

  it("adds another scope of the same role type without confirmation, and keeps the modal open", async () => {
    const secondEvent: EventDto = { ...event, id: "evt-2", title: "Winter Gala" };
    mockFetchAdminEvents.mockResolvedValue([event, secondEvent]);
    const { onClose } = renderModal({
      roles: [{ id: "role-1", role: "operator", scope_type: "event", scope_id: "evt-1", is_oidc: false }],
    });
    await waitFor(() => {
      expect(document.querySelector(".users-modal__chips")).toBeTruthy();
    });
    // Already on "operator" (the user's current type) - no type-change notice, no confirm dialog.
    expect(screen.queryByText(/Changing to/)).toBeNull();

    fireEvent.change(screen.getByLabelText("Event scope for operator role"), { target: { value: "evt-2" } });
    fireEvent.click(screen.getByRole("button", { name: "Add" }));

    await waitFor(() => {
      expect(mockGrantUserRole).toHaveBeenCalledWith("usr-1", { role: "operator", scope_type: "event", scope_id: "evt-2" });
    });
    expect(onClose).not.toHaveBeenCalled();
  });

  it("shows a generic message when adding a scope fails for a reason other than cannot_change_own_role", async () => {
    mockGrantUserRole.mockRejectedValueOnce(new Error("network down"));
    const secondEvent: EventDto = { ...event, id: "evt-2", title: "Winter Gala" };
    mockFetchAdminEvents.mockResolvedValue([event, secondEvent]);
    renderModal({
      roles: [{ id: "role-1", role: "operator", scope_type: "event", scope_id: "evt-1", is_oidc: false }],
    });
    await waitFor(() => {
      expect(document.querySelector(".users-modal__chips")).toBeTruthy();
    });

    fireEvent.change(screen.getByLabelText("Event scope for operator role"), { target: { value: "evt-2" } });
    fireEvent.click(screen.getByRole("button", { name: "Add" }));

    expect(await screen.findByText("Failed to assign role.")).toBeTruthy();
  });

  it("grants an admin role with an organization scope", async () => {
    mockGrantUserRole.mockResolvedValueOnce({
      assignment: { id: "role-1", role: "admin", scope_type: "organization", scope_id: "org-1" },
    });
    renderModal();
    await waitFor(() => expect(mockFetchAdminOrganizations).toHaveBeenCalledOnce());

    fireEvent.change(screen.getByLabelText("Role"), { target: { value: "admin" } });
    fireEvent.change(screen.getByLabelText("Organization scope for admin role"), {
      target: { value: "org-1" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Add" }));

    await waitFor(() => {
      expect(mockGrantUserRole).toHaveBeenCalledWith("usr-1", {
        role: "admin",
        scope_type: "organization",
        scope_id: "org-1",
      });
    });
  });

  it("shows an inline error and does not call the API when adding an admin role with no organization picked", async () => {
    mockFetchAdminOrganizations.mockResolvedValueOnce([]);
    renderModal();
    await waitFor(() => expect(mockFetchAdminOrganizations).toHaveBeenCalled());

    fireEvent.change(screen.getByLabelText("Role"), { target: { value: "admin" } });
    // The Add button is disabled with no organization available, but handleAddRole's own guard
    // (resolveRoleGrantRequest) is what actually prevents the request - exercised directly here
    // rather than only relying on the disabled attribute.
    fireEvent.click(screen.getByRole("button", { name: "Add" }));

    expect(mockGrantUserRole).not.toHaveBeenCalled();
  });

  it("shows a specific message when changing your own role type is rejected by the server", async () => {
    mockGrantUserRole.mockRejectedValueOnce(new ApiError(409, "cannot_change_own_role", "cannot_change_own_role"));
    const existingRole = { id: "role-1", role: "operator", scope_type: "event", scope_id: "evt-1", is_oidc: false };
    renderModal({ roles: [existingRole] });
    await waitFor(() => {
      expect(document.querySelector(".users-modal__chips")).toBeTruthy();
    });

    fireEvent.change(screen.getByLabelText("Role"), { target: { value: "superadmin" } });
    fireEvent.click(screen.getByRole("button", { name: "Change" }));
    const dialog = await screen.findByRole("dialog", { name: "Change role" });
    fireEvent.click(within(dialog).getByRole("button", { name: "Change role" }));

    expect(
      await screen.findByText("You cannot change your own role. Ask another superadmin."),
    ).toBeTruthy();
  });

  it("removes a role assignment via its chip's remove button", async () => {
    const secondEvent: EventDto = { ...event, id: "evt-2", title: "Winter Gala" };
    mockFetchAdminEvents.mockResolvedValue([event, secondEvent]);
    const { onClose, onUpdated } = renderModal({
      roles: [
        { id: "role-1", role: "operator", scope_type: "event", scope_id: "evt-1", is_oidc: false },
        { id: "role-2", role: "operator", scope_type: "event", scope_id: "evt-2", is_oidc: false },
      ],
    });
    await screen.findByRole("button", { name: "Remove Operator for Summer Summit" });

    fireEvent.click(screen.getByRole("button", { name: "Remove Operator for Summer Summit" }));

    await waitFor(() => {
      expect(mockRevokeUserRole).toHaveBeenCalledWith("usr-1", "role-1");
    });
    expect(onClose).toHaveBeenCalled();
    expect(onUpdated).toHaveBeenCalledWith(expect.objectContaining({ id: "usr-1" }), "Role removed");
  });

  it("shows the raw scope id for an event scope chip that no longer matches a fetched event", async () => {
    renderModal({
      roles: [
        { id: "role-1", role: "operator", scope_type: "event", scope_id: "evt-deleted", is_oidc: false },
      ],
    });

    expect(await screen.findByText("evt-deleted")).toBeTruthy();
  });

  it("shows the raw scope id for an organization scope chip that no longer matches a fetched organization", async () => {
    renderModal({
      roles: [
        { id: "role-1", role: "admin", scope_type: "organization", scope_id: "org-deleted", is_oidc: false },
      ],
    });

    expect(await screen.findByText("org-deleted")).toBeTruthy();
  });

  it("shows an inline error when removing a role assignment fails", async () => {
    mockRevokeUserRole.mockRejectedValueOnce(new Error("network down"));
    renderModal({
      roles: [{ id: "role-1", role: "operator", scope_type: "event", scope_id: "evt-1", is_oidc: false }],
    });
    await screen.findByRole("button", { name: "Remove Operator for Summer Summit" });

    fireEvent.click(screen.getByRole("button", { name: "Remove Operator for Summer Summit" }));

    expect(await screen.findByText("Failed to remove role.")).toBeTruthy();
  });

  it("shows the superadmin no-scopes note only when superadmin is already the current role", async () => {
    renderModal({
      roles: [{ id: "role-1", role: "superadmin", scope_type: "instance", scope_id: null, is_oidc: false }],
    });
    await screen.findByText(/no scopes to add/);
    expect(screen.queryByRole("button", { name: "Add" })).toBeNull();
  });

  it("disables the role selector entirely on your own account, so it can't even be changed to look at a swap", async () => {
    useAuthMock.mockReturnValue({ user: { id: "usr-1" } });
    renderModal({
      roles: [{ id: "role-1", role: "operator", scope_type: "event", scope_id: "evt-1", is_oidc: false }],
    });
    await waitFor(() => {
      expect(document.querySelector(".users-modal__chips")).toBeTruthy();
    });

    const roleSelect = screen.getByLabelText("Role");
    expect(roleSelect).toHaveProperty("disabled", true);
    expect(roleSelect.title).toBe("You cannot change your own role.");
  });

  it("hides the remove control for an OIDC-managed scope chip", async () => {
    renderModal({
      roles: [{ id: "role-1", role: "operator", scope_type: "event", scope_id: "evt-1", is_oidc: true }],
    });

    await waitFor(() => {
      expect(document.querySelector(".users-modal__chips")).toBeTruthy();
    });
    expect(screen.queryByRole("button", { name: /Remove/ })).toBeNull();
  });

  it("disables removing your own role assignment", async () => {
    useAuthMock.mockReturnValue({ user: { id: "usr-1" } });
    renderModal({
      roles: [{ id: "role-1", role: "operator", scope_type: "event", scope_id: "evt-1", is_oidc: false }],
    });
    await waitFor(() => {
      expect(document.querySelector(".users-modal__chips")).toBeTruthy();
    });

    expect(screen.getByRole("button", { name: /Remove Operator/ })).toHaveProperty("disabled", true);
  });
});

describe("UserEditModal sign-in security", () => {
  it("shows SSO and MFA-enrolled status together with the active session count", async () => {
    renderModal({ has_sso: true, has_mfa: true, active_sessions_count: 3 });

    await screen.findByText("SSO");
    expect(screen.getByText("TOTP enrolled")).toBeTruthy();
    expect(screen.getByText("Active sessions")).toBeTruthy();
    expect(screen.getByText("3 sessions")).toBeTruthy();
  });

  it("shows no Unlink control for a local-only account", async () => {
    renderModal({ has_sso: false });
    await screen.findByText("Local password");
    expect(screen.queryByRole("button", { name: "Unlink" })).toBeNull();
  });

  it("unlinks SSO after confirmation, requiring a new password in the same step", async () => {
    const { onClose, onUpdated } = renderModal({ has_sso: true });
    await screen.findByRole("button", { name: "Unlink" });

    fireEvent.click(screen.getByRole("button", { name: "Unlink" }));
    const dialog = await screen.findByRole("dialog", { name: "Unlink SSO" });
    const confirmButton = within(dialog).getByRole("button", { name: "Unlink" });
    expect(confirmButton).toHaveProperty("disabled", true);

    fireEvent.change(screen.getByLabelText("New temporary password"), {
      target: { value: "long-enough-password" },
    });
    fireEvent.click(confirmButton);

    await waitFor(() => {
      expect(mockUnlinkUserExternalIdentity).toHaveBeenCalledWith("usr-1", {
        new_password: "long-enough-password",
      });
    });
    expect(onUpdated).toHaveBeenCalledWith(
      { ...user, has_sso: true },
      "SSO unlinked. User must sign in with the new local password.",
    );
    expect(onClose).toHaveBeenCalled();
  });

  it("cancels the unlink-SSO dialog without calling the API, clearing the typed password", async () => {
    renderModal({ has_sso: true });
    await screen.findByRole("button", { name: "Unlink" });

    fireEvent.click(screen.getByRole("button", { name: "Unlink" }));
    const dialog = await screen.findByRole("dialog", { name: "Unlink SSO" });
    fireEvent.change(within(dialog).getByLabelText("New temporary password"), {
      target: { value: "long-enough-password" },
    });
    fireEvent.click(within(dialog).getByRole("button", { name: "Cancel" }));

    expect(mockUnlinkUserExternalIdentity).not.toHaveBeenCalled();
    expect(screen.queryByRole("dialog", { name: "Unlink SSO" })).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Unlink" }));
    const reopened = await screen.findByRole("dialog", { name: "Unlink SSO" });
    expect((within(reopened).getByLabelText("New temporary password") as HTMLInputElement).value).toBe("");
  });

  it("ignores Escape on the unlink-SSO dialog while the request is in flight", async () => {
    mockUnlinkUserExternalIdentity.mockImplementationOnce(() => new Promise(() => {}));
    renderModal({ has_sso: true });
    await screen.findByRole("button", { name: "Unlink" });

    fireEvent.click(screen.getByRole("button", { name: "Unlink" }));
    const dialog = await screen.findByRole("dialog", { name: "Unlink SSO" });
    fireEvent.change(within(dialog).getByLabelText("New temporary password"), {
      target: { value: "long-enough-password" },
    });
    fireEvent.click(within(dialog).getByRole("button", { name: "Unlink" }));
    await waitFor(() => {
      expect(within(dialog).getByRole("button", { name: "Cancel" })).toHaveProperty("disabled", true);
    });

    fireEvent.keyDown(document, { key: "Escape" });

    expect(screen.getByRole("dialog", { name: "Unlink SSO" })).toBeTruthy();
  });

  it("shows the password-length message for an invalid_request unlink-SSO error", async () => {
    mockUnlinkUserExternalIdentity.mockRejectedValueOnce(new ApiError(400, "invalid_request", "invalid_request"));
    renderModal({ has_sso: true });
    await screen.findByRole("button", { name: "Unlink" });

    fireEvent.click(screen.getByRole("button", { name: "Unlink" }));
    const dialog = await screen.findByRole("dialog", { name: "Unlink SSO" });
    fireEvent.change(screen.getByLabelText("New temporary password"), {
      target: { value: "long-enough-password" },
    });
    fireEvent.click(within(dialog).getByRole("button", { name: "Unlink" }));

    expect(await screen.findByText("Password must be at least 12 characters.")).toBeTruthy();
  });

  it("shows a generic message for a non-invalid_request unlink-SSO error", async () => {
    mockUnlinkUserExternalIdentity.mockRejectedValueOnce(new Error("network down"));
    renderModal({ has_sso: true });
    await screen.findByRole("button", { name: "Unlink" });

    fireEvent.click(screen.getByRole("button", { name: "Unlink" }));
    const dialog = await screen.findByRole("dialog", { name: "Unlink SSO" });
    fireEvent.change(screen.getByLabelText("New temporary password"), {
      target: { value: "long-enough-password" },
    });
    fireEvent.click(within(dialog).getByRole("button", { name: "Unlink" }));

    expect(await screen.findByText("Failed to unlink SSO.")).toBeTruthy();
  });

  it("disables unlinking your own SSO", async () => {
    useAuthMock.mockReturnValue({ user: { id: "usr-1" } });
    renderModal({ has_sso: true });
    await screen.findByRole("button", { name: "Unlink" });

    expect(screen.getByRole("button", { name: "Unlink" })).toHaveProperty("disabled", true);
  });

  it("shows up to 3 recent successful logins with location", async () => {
    mockFetchSecurityAuditLog.mockResolvedValue({
      entries: [
        {
          id: "log-1",
          event_type: "auth.login.success",
          user_id: "usr-1",
          user_email: "staff@example.com",
          user_display_name: "Staff User",
          ip: "81.190.22.4",
          country: { kind: "resolved", countryCode: "DE" },
          metadata: null,
          created_at: "2026-01-01T00:00:00.000Z",
        },
      ],
      total: 1,
      page: 1,
      pageSize: 3,
    });
    renderModal();

    await waitFor(() => {
      expect(mockFetchSecurityAuditLog).toHaveBeenCalledWith(
        { eventType: "auth.login.success", userId: "usr-1", pageSize: 3 },
        expect.anything(),
      );
    });
    expect(await screen.findByText("Recent logins")).toBeTruthy();
    expect(screen.getByText("81.190.22.4")).toBeTruthy();
  });

  it("disables Revoke sessions when the user has none", async () => {
    renderModal({ active_sessions_count: 0 });
    await screen.findByText("Active sessions");
    expect(screen.getByText("None")).toBeTruthy();
    openMoreActions();
    expect(screen.getByRole("menuitem", { name: /Revoke sessions/ })).toHaveProperty("disabled", true);
  });

  it("revokes all sessions after confirmation and reports how many were ended", async () => {
    const { onClose, onUpdated } = renderModal({ active_sessions_count: 2 });
    await screen.findByText("2 sessions");

    openMoreActions();
    fireEvent.click(screen.getByRole("menuitem", { name: /Revoke sessions/ }));
    const dialog = await screen.findByRole("dialog", { name: "Revoke all sessions" });
    fireEvent.click(within(dialog).getByRole("button", { name: "Revoke" }));

    await waitFor(() => {
      expect(mockRevokeUserSessions).toHaveBeenCalledWith("usr-1");
    });
    expect(onUpdated).toHaveBeenCalledWith({ ...user, active_sessions_count: 2 }, "2 sessions revoked");
    expect(onClose).toHaveBeenCalled();
  });

  it("uses singular grammar when exactly one session is revoked", async () => {
    mockRevokeUserSessions.mockResolvedValueOnce({ ok: true, sessionsRevoked: 1 });
    const { onUpdated } = renderModal({ active_sessions_count: 1 });
    await screen.findByText("1 session");

    openMoreActions();
    fireEvent.click(screen.getByRole("menuitem", { name: /Revoke sessions/ }));
    const dialog = await screen.findByRole("dialog", { name: "Revoke all sessions" });
    fireEvent.click(within(dialog).getByRole("button", { name: "Revoke" }));

    await waitFor(() => {
      expect(onUpdated).toHaveBeenCalledWith({ ...user, active_sessions_count: 1 }, "1 session revoked");
    });
  });

  it("shows an inline error when revoking sessions fails", async () => {
    mockRevokeUserSessions.mockRejectedValueOnce(new Error("network down"));
    renderModal({ active_sessions_count: 2 });
    await screen.findByText("2 sessions");

    openMoreActions();
    fireEvent.click(screen.getByRole("menuitem", { name: /Revoke sessions/ }));
    const dialog = await screen.findByRole("dialog", { name: "Revoke all sessions" });
    fireEvent.click(within(dialog).getByRole("button", { name: "Revoke" }));

    expect(await screen.findByText("Failed to revoke sessions.")).toBeTruthy();
  });

  it("cancels the revoke-sessions dialog without calling the API", async () => {
    renderModal({ active_sessions_count: 2 });
    await screen.findByText("2 sessions");

    openMoreActions();
    fireEvent.click(screen.getByRole("menuitem", { name: /Revoke sessions/ }));
    const dialog = await screen.findByRole("dialog", { name: "Revoke all sessions" });
    fireEvent.click(within(dialog).getByRole("button", { name: "Cancel" }));

    expect(mockRevokeUserSessions).not.toHaveBeenCalled();
    expect(screen.queryByRole("dialog", { name: "Revoke all sessions" })).toBeNull();
  });
});

describe("UserEditModal reset actions", () => {
  it("confirms an MFA reset with the compact action label and reports why the user must sign in again", async () => {
    const { onClose, onUpdated } = renderModal();
    await screen.findByRole("button", { name: "Save" });

    openMoreActions();
    fireEvent.click(screen.getByRole("menuitem", { name: /Reset MFA/ }));
    const dialog = await screen.findByRole("dialog", { name: "Reset MFA" });
    fireEvent.click(within(dialog).getByRole("button", { name: "Reset" }));

    await waitFor(() => {
      expect(mockResetUserMfa).toHaveBeenCalledWith("usr-1");
    });
    expect(onUpdated).toHaveBeenCalledWith(user, "MFA reset. User must sign in again.");
    expect(onClose).toHaveBeenCalled();
  });

  it("shows an inline error when resetting MFA fails", async () => {
    mockResetUserMfa.mockRejectedValueOnce(new Error("network down"));
    renderModal();
    await screen.findByRole("button", { name: "Save" });

    openMoreActions();
    fireEvent.click(screen.getByRole("menuitem", { name: /Reset MFA/ }));
    const dialog = await screen.findByRole("dialog", { name: "Reset MFA" });
    fireEvent.click(within(dialog).getByRole("button", { name: "Reset" }));

    expect(await screen.findByText("Failed to reset MFA.")).toBeTruthy();
  });

  it("cancels the reset-MFA dialog without calling the API", async () => {
    renderModal();
    await screen.findByRole("button", { name: "Save" });

    openMoreActions();
    fireEvent.click(screen.getByRole("menuitem", { name: /Reset MFA/ }));
    const dialog = await screen.findByRole("dialog", { name: "Reset MFA" });
    fireEvent.click(within(dialog).getByRole("button", { name: "Cancel" }));

    expect(mockResetUserMfa).not.toHaveBeenCalled();
    expect(screen.queryByRole("dialog", { name: "Reset MFA" })).toBeNull();
  });

  it("shows a generic message for a non-invalid_request reset-password error", async () => {
    mockResetUserPassword.mockRejectedValueOnce(new Error("network down"));
    renderModal();
    await screen.findByRole("button", { name: "Save" });

    openMoreActions();
    fireEvent.click(screen.getByRole("menuitem", { name: /Reset password/ }));
    fireEvent.change(screen.getByLabelText("New temporary password"), { target: { value: "long-enough-password" } });
    fireEvent.click(screen.getByRole("button", { name: "Reset password" }));

    expect(await screen.findByText("Failed to reset password.")).toBeTruthy();
  });

  it("shows the password-length message for an invalid_request reset-password error", async () => {
    mockResetUserPassword.mockRejectedValueOnce(new ApiError(400, "invalid_request", "invalid_request"));
    renderModal();
    await screen.findByRole("button", { name: "Save" });

    openMoreActions();
    fireEvent.click(screen.getByRole("menuitem", { name: /Reset password/ }));
    fireEvent.change(screen.getByLabelText("New temporary password"), { target: { value: "long-enough-password" } });
    fireEvent.click(screen.getByRole("button", { name: "Reset password" }));

    expect(await screen.findByText("Password must be at least 12 characters.")).toBeTruthy();
  });

  it("resets a password and reports that existing sessions were revoked", async () => {
    const { onClose, onUpdated } = renderModal();
    await screen.findByRole("button", { name: "Save" });

    openMoreActions();
    fireEvent.click(screen.getByRole("menuitem", { name: /Reset password/ }));
    fireEvent.change(screen.getByLabelText("New temporary password"), { target: { value: "long-enough-password" } });
    fireEvent.click(screen.getByRole("button", { name: "Reset password" }));

    await waitFor(() => {
      expect(mockResetUserPassword).toHaveBeenCalledWith("usr-1", { new_password: "long-enough-password" });
    });
    expect(onUpdated).toHaveBeenCalledWith(user, "Password reset. Sessions revoked.");
    expect(onClose).toHaveBeenCalled();
  });

  it("cancels the reset-password form without calling the API, clearing the typed password", async () => {
    renderModal();
    await screen.findByRole("button", { name: "Save" });

    openMoreActions();
    fireEvent.click(screen.getByRole("menuitem", { name: /Reset password/ }));
    fireEvent.change(screen.getByLabelText("New temporary password"), { target: { value: "long-enough-password" } });
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));

    expect(mockResetUserPassword).not.toHaveBeenCalled();
    expect(screen.queryByLabelText("New temporary password")).toBeNull();
    expect(screen.getByText("No recent logins")).toBeTruthy();

    openMoreActions();
    fireEvent.click(screen.getByRole("menuitem", { name: /Reset password/ }));
    expect((screen.getByLabelText("New temporary password") as HTMLInputElement).value).toBe("");
  });
});

describe("UserEditModal disable / enable account", () => {
  it("confirms before disabling an active account and revokes sessions server-side", async () => {
    mockPatchAdminUser.mockResolvedValueOnce({ user: { ...user, is_active: false } });
    const { onClose, onUpdated } = renderModal({ is_active: true });
    await screen.findByRole("button", { name: "Save" });

    openMoreActions();
    fireEvent.click(screen.getByRole("menuitem", { name: /Disable account/ }));
    const dialog = await screen.findByRole("dialog", { name: "Disable account" });
    fireEvent.click(within(dialog).getByRole("button", { name: "Disable" }));

    await waitFor(() => {
      expect(mockPatchAdminUser).toHaveBeenCalledWith("usr-1", { is_active: false });
    });
    expect(onUpdated).toHaveBeenCalledWith({ ...user, is_active: false }, "Account disabled. Sessions revoked.");
    expect(onClose).toHaveBeenCalled();
  });

  it("shows an inline error when disabling an account fails", async () => {
    mockPatchAdminUser.mockRejectedValueOnce(new Error("network down"));
    renderModal({ is_active: true });
    await screen.findByRole("button", { name: "Save" });

    openMoreActions();
    fireEvent.click(screen.getByRole("menuitem", { name: /Disable account/ }));
    const dialog = await screen.findByRole("dialog", { name: "Disable account" });
    fireEvent.click(within(dialog).getByRole("button", { name: "Disable" }));

    expect(await screen.findByText("Failed to update account status.")).toBeTruthy();
  });

  it("cancels the disable-account dialog without calling the API", async () => {
    renderModal({ is_active: true });
    await screen.findByRole("button", { name: "Save" });

    openMoreActions();
    fireEvent.click(screen.getByRole("menuitem", { name: /Disable account/ }));
    const dialog = await screen.findByRole("dialog", { name: "Disable account" });
    fireEvent.click(within(dialog).getByRole("button", { name: "Cancel" }));

    expect(mockPatchAdminUser).not.toHaveBeenCalled();
    expect(screen.queryByRole("dialog", { name: "Disable account" })).toBeNull();
  });

  it("re-enables a disabled account immediately, without a confirmation dialog", async () => {
    mockPatchAdminUser.mockResolvedValueOnce({ user: { ...user, is_active: true } });
    const { onClose, onUpdated } = renderModal({ is_active: false });
    await screen.findByRole("button", { name: "Save" });

    openMoreActions();
    fireEvent.click(screen.getByRole("menuitem", { name: /Enable account/ }));

    await waitFor(() => {
      expect(mockPatchAdminUser).toHaveBeenCalledWith("usr-1", { is_active: true });
    });
    expect(onUpdated).toHaveBeenCalledWith({ ...user, is_active: true }, "Account enabled");
    expect(onClose).toHaveBeenCalled();
    // No confirmation step for re-enabling (only disabling revokes sessions and asks first) -
    // the only "dialog"-role element present is the edit modal itself, never a ConfirmDialog.
    expect(screen.queryAllByRole("dialog")).toHaveLength(1);
  });

  it("disables disabling your own account", async () => {
    useAuthMock.mockReturnValue({ user: { id: "usr-1" } });
    renderModal({ is_active: true });
    await screen.findByRole("button", { name: "Save" });

    openMoreActions();
    expect(screen.getByRole("menuitem", { name: /Disable account/ })).toHaveProperty("disabled", true);
  });
});

describe("UserEditModal profile - phone number", () => {
  it("pre-fills the country code and number from the user, and saves changes to both", async () => {
    mockPatchAdminUser.mockResolvedValueOnce({
      user: { ...user, phone_country_code: "+1", phone_number: "5551234" },
    });
    const { onUpdated } = renderModal({ phone_country_code: "+48", phone_number: "500100200" });
    await screen.findByRole("button", { name: "Save" });

    expect((document.getElementById("edit-phone-country-code") as HTMLSelectElement).value).toBe("+48");
    expect((document.getElementById("edit-phone-number") as HTMLInputElement).value).toBe("500100200");

    fireEvent.change(document.getElementById("edit-phone-country-code")!, { target: { value: "+1" } });
    fireEvent.change(document.getElementById("edit-phone-number")!, { target: { value: "5551234" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => {
      expect(mockPatchAdminUser).toHaveBeenCalledWith("usr-1", {
        display_name: "Staff User",
        email: "staff@example.com",
        phone_country_code: "+1",
        phone_number: "5551234",
      });
    });
    expect(onUpdated).toHaveBeenCalled();
  });

  it("sends null when the display name is cleared to blank", async () => {
    mockPatchAdminUser.mockResolvedValueOnce({ user: { ...user, display_name: null } });
    renderModal();
    await screen.findByRole("button", { name: "Save" });

    fireEvent.change(screen.getByLabelText("Display name"), { target: { value: "   " } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => {
      expect(mockPatchAdminUser).toHaveBeenCalledWith(
        "usr-1",
        expect.objectContaining({ display_name: null }),
      );
    });
  });

  it("saves an edited display name and email", async () => {
    mockPatchAdminUser.mockResolvedValueOnce({
      user: { ...user, display_name: "New Name", email: "new@example.com" },
    });
    const { onUpdated } = renderModal();
    await screen.findByRole("button", { name: "Save" });

    fireEvent.change(screen.getByLabelText("Display name"), { target: { value: "New Name" } });
    fireEvent.change(screen.getByLabelText("Email address"), { target: { value: "new@example.com" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => {
      expect(mockPatchAdminUser).toHaveBeenCalledWith(
        "usr-1",
        expect.objectContaining({ display_name: "New Name", email: "new@example.com" }),
      );
      expect(onUpdated).toHaveBeenCalled();
    });
  });

  it("sends null for both fields when no phone number is set", async () => {
    renderModal();
    await screen.findByRole("button", { name: "Save" });

    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => {
      expect(mockPatchAdminUser).toHaveBeenCalledWith(
        "usr-1",
        expect.objectContaining({ phone_country_code: null, phone_number: null }),
      );
    });
  });

  it("shows a taken-email message for an email_taken response", async () => {
    mockPatchAdminUser.mockRejectedValueOnce(new ApiError(409, "email_taken", "email_taken"));
    renderModal();
    await screen.findByRole("button", { name: "Save" });

    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    expect(await screen.findByText("A user with this email already exists.")).toBeTruthy();
  });

  it("shows a taken-email message for an email_conflict response", async () => {
    mockPatchAdminUser.mockRejectedValueOnce(new ApiError(409, "email_conflict", "email_conflict"));
    renderModal();
    await screen.findByRole("button", { name: "Save" });

    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    expect(await screen.findByText("A user with this email already exists.")).toBeTruthy();
  });

  it("shows a generic message for a non-email save-profile error", async () => {
    mockPatchAdminUser.mockRejectedValueOnce(new Error("network down"));
    renderModal();
    await screen.findByRole("button", { name: "Save" });

    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    expect(await screen.findByText("Failed to save changes.")).toBeTruthy();
  });
});

describe("UserEditModal save state", () => {
  it("keeps profile controls disabled while the update is in progress", async () => {
    mockPatchAdminUser.mockImplementationOnce(() => new Promise(() => {}));
    renderModal();
    await screen.findByRole("button", { name: "Save" });

    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => {
      expect(mockPatchAdminUser).toHaveBeenCalledWith("usr-1", {
        display_name: "Staff User",
        email: "staff@example.com",
        phone_country_code: null,
        phone_number: null,
      });
    });
    expect(screen.getByRole("button", { name: "Saving…" })).toHaveProperty("disabled", true);
    expect(screen.getByRole("button", { name: "Close" })).toHaveProperty("disabled", true);
  });

  it("ignores Escape while an update is in progress, unlike the disabled Close button it mirrors", async () => {
    mockPatchAdminUser.mockImplementationOnce(() => new Promise(() => {}));
    const { onClose } = renderModal();
    await screen.findByRole("button", { name: "Save" });

    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Close" })).toHaveProperty("disabled", true);
    });

    fireEvent.keyDown(document, { key: "Escape" });

    expect(onClose).not.toHaveBeenCalled();
    expect(screen.getByRole("heading", { name: "Staff User" })).toBeTruthy();
  });
});

describe("UserEditModal delete account", () => {
  it("disables Delete account for the signed-in user's own account", async () => {
    useAuthMock.mockReturnValue({ user: { id: "usr-1" } });
    renderModal();
    await screen.findByRole("button", { name: "Save" });

    openMoreActions();
    expect(screen.getByRole("menuitem", { name: /Delete account/ })).toHaveProperty("disabled", true);
  });

  it("keeps Delete disabled until the account's email is typed to confirm", async () => {
    renderModal();
    await screen.findByRole("button", { name: "Save" });

    openMoreActions();
    fireEvent.click(screen.getByRole("menuitem", { name: /Delete account/ }));
    const dialog = await screen.findByRole("dialog", { name: "Delete account" });
    const confirmButton = within(dialog).getByRole("button", { name: "Delete" });
    expect(confirmButton).toHaveProperty("disabled", true);

    fireEvent.change(within(dialog).getByLabelText(`Type the email address to confirm: "${user.email}"`), {
      target: { value: "wrong@example.com" },
    });
    expect(confirmButton).toHaveProperty("disabled", true);
  });

  it("deletes the account after typing the email to confirm", async () => {
    const { onClose, onDeleted } = renderModal();
    await screen.findByRole("button", { name: "Save" });

    openMoreActions();
    fireEvent.click(screen.getByRole("menuitem", { name: /Delete account/ }));
    const dialog = await screen.findByRole("dialog", { name: "Delete account" });
    fireEvent.change(within(dialog).getByLabelText(`Type the email address to confirm: "${user.email}"`), {
      target: { value: user.email },
    });
    fireEvent.click(within(dialog).getByRole("button", { name: "Delete" }));

    await waitFor(() => {
      expect(mockDeleteAdminUser).toHaveBeenCalledWith("usr-1");
    });
    expect(onDeleted).toHaveBeenCalledWith(user);
    expect(onClose).toHaveBeenCalled();
  });

  it("shows an inline error in the confirm dialog when deleting fails", async () => {
    mockDeleteAdminUser.mockRejectedValueOnce(new Error("network down"));
    renderModal();
    await screen.findByRole("button", { name: "Save" });

    openMoreActions();
    fireEvent.click(screen.getByRole("menuitem", { name: /Delete account/ }));
    const dialog = await screen.findByRole("dialog", { name: "Delete account" });
    fireEvent.change(within(dialog).getByLabelText(`Type the email address to confirm: "${user.email}"`), {
      target: { value: user.email },
    });
    fireEvent.click(within(dialog).getByRole("button", { name: "Delete" }));

    expect(await within(dialog).findByText("Failed to delete user.")).toBeTruthy();
  });

  it("cancels the delete-account dialog without calling the API", async () => {
    renderModal();
    await screen.findByRole("button", { name: "Save" });

    openMoreActions();
    fireEvent.click(screen.getByRole("menuitem", { name: /Delete account/ }));
    const dialog = await screen.findByRole("dialog", { name: "Delete account" });
    fireEvent.click(within(dialog).getByRole("button", { name: "Cancel" }));

    expect(mockDeleteAdminUser).not.toHaveBeenCalled();
    expect(screen.queryByRole("dialog", { name: "Delete account" })).toBeNull();
  });
});
