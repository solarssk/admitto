// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
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
  external_identities: [],
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

  it("closes via the Close button when nothing is busy", async () => {
    const { onClose } = renderModal();
    await screen.findByRole("button", { name: "Save changes" });

    fireEvent.click(screen.getByRole("button", { name: "Close" }));

    expect(onClose).toHaveBeenCalledOnce();
  });

  it("ignores Escape while a save is still in flight", async () => {
    mockPatchAdminUser.mockImplementationOnce(() => new Promise(() => {}));
    const { onClose } = renderModal();
    await screen.findByRole("button", { name: "Save changes" });

    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));
    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Close" })).toHaveProperty("disabled", true);
    });

    fireEvent.keyDown(document, { key: "Escape" });

    expect(onClose).not.toHaveBeenCalled();
  });
});

describe("UserEditModal profile - display name and email", () => {
  it("saves an edited display name and email address", async () => {
    renderModal();
    await screen.findByRole("button", { name: "Save changes" });

    fireEvent.change(screen.getByLabelText("Display name"), { target: { value: "New Name" } });
    fireEvent.change(screen.getByLabelText("Email address"), { target: { value: "new-email@example.com" } });
    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));

    await waitFor(() => {
      expect(mockPatchAdminUser).toHaveBeenCalledWith("usr-1", {
        display_name: "New Name",
        email: "new-email@example.com",
        phone_country_code: null,
        phone_number: null,
      });
    });
  });

  it("shows an empty display name field for a user who never set one", async () => {
    renderModal({ display_name: null });
    await screen.findByRole("button", { name: "Save changes" });

    expect((screen.getByLabelText("Display name") as HTMLInputElement).value).toBe("");
  });

  it("sends null, not an empty string, for a display name cleared before saving", async () => {
    renderModal();
    await screen.findByRole("button", { name: "Save changes" });

    fireEvent.change(screen.getByLabelText("Display name"), { target: { value: "" } });
    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));

    await waitFor(() => {
      expect(mockPatchAdminUser).toHaveBeenCalledWith(
        "usr-1",
        expect.objectContaining({ display_name: null }),
      );
    });
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
});

describe("UserEditModal role & access - exclusive roles", () => {
  it("stages a first role locally without calling the API, until Save", async () => {
    const { onClose, onUpdated } = renderModal();

    await waitFor(() => {
      expect(mockFetchAdminOrganizations).toHaveBeenCalledOnce();
      expect(mockFetchAdminEvents).toHaveBeenCalledOnce();
    });
    fireEvent.click(screen.getByRole("button", { name: /^Role,/ }));
    fireEvent.click(screen.getByRole("button", { name: "Superadmin" }));

    const addButton = screen.getByRole("button", { name: "Add" });
    fireEvent.click(addButton);

    // Add only stages the grant locally now - it shows up as a pending chip, but nothing is
    // sent to the server and nothing is reported to the parent list until Save changes.
    expect(await screen.findByText("Instance-wide")).toBeTruthy();
    expect(document.querySelector(".users-modal__chip--pending")).toBeTruthy();
    expect(mockGrantUserRole).not.toHaveBeenCalled();
    expect(onUpdated).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
    expect(screen.queryAllByRole("dialog")).toHaveLength(1);
  });

  it("locks the Role select once a scope grant is staged for a previously roleless user", async () => {
    renderModal();
    await waitFor(() => {
      expect(mockFetchAdminOrganizations).toHaveBeenCalledOnce();
      expect(mockFetchAdminEvents).toHaveBeenCalledOnce();
    });
    fireEvent.click(screen.getByRole("button", { name: /^Role,/ }));
    fireEvent.click(screen.getByRole("button", { name: "Superadmin" }));
    fireEvent.click(screen.getByRole("button", { name: "Add" }));
    await screen.findByText("Instance-wide");

    // Switching role type now, with a scope grant already staged, would leave that staged add
    // pointing at a type the picker no longer shows once Save changes submits it. isRoleTypeChange
    // only guards this for a user who already had an assigned role (it requires a non-empty
    // currentRoleType), so a previously roleless user could otherwise stage one type, restage the
    // picker to a different type, and stage a second, conflicting add underneath it (bot review
    // finding on #722) - the Role select itself is disabled instead once anything is pending.
    expect(screen.getByRole("button", { name: /^Role,/ })).toHaveProperty("disabled", true);
  });

  it("switches between organization and event scope controls for admin and operator", async () => {
    renderModal();
    await waitFor(() => expect(mockFetchAdminOrganizations).toHaveBeenCalledOnce());

    fireEvent.click(screen.getByRole("button", { name: /^Role,/ }));
    fireEvent.click(screen.getByRole("button", { name: "Administrator" }));
    // Organizations pre-fill to the first fetched org (see the load effect), so the trigger may
    // already read "...Operations" rather than "none selected" by the time this runs.
    fireEvent.click(await screen.findByRole("button", { name: /^Organization scope for admin role/ }));
    fireEvent.click(await screen.findByRole("button", { name: "Events" }));
    expect(
      screen.getByRole("button", { name: "Organization scope for admin role, Events" }),
    ).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: /^Role,/ }));
    fireEvent.click(screen.getByRole("button", { name: "Operator" }));
    fireEvent.click(screen.getByRole("button", { name: "Event scope for operator role, none selected" }));
    fireEvent.click(await screen.findByRole("button", { name: "Summer Summit" }));
    expect(
      screen.getByRole("button", { name: "Event scope for operator role, Summer Summit" }),
    ).toBeTruthy();
  });

  it("defaults the organization scope picker past an org the target is already assigned to", async () => {
    // org-1 ("Operations") is first in the fetched list and already assigned - the picker must
    // not default to it (pickableOrganizations excludes already-assigned orgs entirely).
    renderModal({
      roles: [{ id: "role-1", role: "admin", scope_type: "organization", scope_id: "org-1", is_oidc: false }],
    });

    expect(
      await screen.findByRole("button", { name: "Organization scope for admin role, Events" }),
    ).toBeTruthy();
  });

  it("disables the add-scope action and explains the empty organization list", async () => {
    mockFetchAdminOrganizations.mockResolvedValueOnce([]);
    mockFetchAdminEvents.mockResolvedValueOnce([]);
    renderModal();

    await waitFor(() => expect(mockFetchAdminOrganizations).toHaveBeenCalled());
    fireEvent.click(screen.getByRole("button", { name: /^Role,/ }));
    fireEvent.click(screen.getByRole("button", { name: "Administrator" }));

    const organizationTrigger = screen.getByRole("button", {
      name: "Organization scope for admin role, none selected",
    });
    expect(organizationTrigger).toHaveProperty("disabled", true);
    expect(screen.getByText("No organizations available")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Add" })).toHaveProperty("disabled", true);
  });

  it("falls back to empty organization and event lists when the initial fetch fails", async () => {
    mockFetchAdminOrganizations.mockRejectedValueOnce(new Error("network down"));
    mockFetchAdminEvents.mockRejectedValueOnce(new Error("network down"));
    renderModal();

    fireEvent.click(screen.getByRole("button", { name: /^Role,/ }));
    fireEvent.click(screen.getByRole("button", { name: "Administrator" }));

    await waitFor(() => {
      expect(screen.getByText("No organizations available")).toBeTruthy();
    });
    expect(screen.getByRole("button", { name: "Add" })).toHaveProperty("disabled", true);
  });

  it("ignores a stale organizations/events fetch that resolves after the modal has already closed", async () => {
    let resolveOrgs: (value: { id: string; name: string }[]) => void = () => {};
    mockFetchAdminOrganizations.mockReturnValueOnce(
      new Promise((resolve) => {
        resolveOrgs = resolve;
      }),
    );
    const onClose = vi.fn();
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    const { rerender } = render(
      <UserEditModal open user={user} onClose={onClose} onUpdated={vi.fn()} onDeleted={vi.fn()} />,
    );
    await screen.findByRole("button", { name: "Save changes" });

    // Closes before the in-flight fetch settles - the effect's cleanup aborts its controller.
    rerender(
      <UserEditModal open={false} user={user} onClose={onClose} onUpdated={vi.fn()} onDeleted={vi.fn()} />,
    );

    // Resolving now must not call setOrganizations/setEvents on the now-stale request - only
    // the `controller.signal.aborted` guard stands between this and a "state update on an
    // unmounted/closed component" warning.
    await act(async () => {
      resolveOrgs([]);
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(consoleError).not.toHaveBeenCalled();
    consoleError.mockRestore();
  });

  it("requires confirmation before changing an existing role to a different type", async () => {
    const existingRole = { id: "role-1", role: "operator", scope_type: "event", scope_id: "evt-1", is_oidc: false };
    const { onClose, onUpdated } = renderModal({ roles: [existingRole] });
    await waitFor(() => {
      expect(document.querySelector(".users-modal__chips")).toBeTruthy();
    });

    fireEvent.click(screen.getByRole("button", { name: /^Role,/ }));
    fireEvent.click(screen.getByRole("button", { name: "Superadmin" }));
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
    // A type change closes the modal (unlike adding another same-type scope, below): the modal's
    // own `user` prop is now stale, and if Staff users is currently filtered by the old role, the
    // parent's next refresh can drop the target entirely, leaving nothing for the modal to pick
    // fresh data up from.
    expect(onClose).toHaveBeenCalled();
  });

  it("cancels the change-role confirmation without calling the API, leaving the old role in place", async () => {
    const existingRole = { id: "role-1", role: "operator", scope_type: "event", scope_id: "evt-1", is_oidc: false };
    renderModal({ roles: [existingRole] });
    await waitFor(() => {
      expect(document.querySelector(".users-modal__chips")).toBeTruthy();
    });

    fireEvent.click(screen.getByRole("button", { name: /^Role,/ }));
    fireEvent.click(screen.getByRole("button", { name: "Superadmin" }));
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

    fireEvent.click(screen.getByRole("button", { name: /^Role,/ }));
    fireEvent.click(screen.getByRole("button", { name: "Superadmin" }));
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

  it("changes an existing role to Administrator with the picked organization scope", async () => {
    const existingRole = { id: "role-1", role: "operator", scope_type: "event", scope_id: "evt-1", is_oidc: false };
    const { onClose, onUpdated } = renderModal({ roles: [existingRole] });
    await waitFor(() => {
      expect(document.querySelector(".users-modal__chips")).toBeTruthy();
    });

    fireEvent.click(screen.getByRole("button", { name: /^Role,/ }));
    fireEvent.click(screen.getByRole("button", { name: "Administrator" }));
    fireEvent.click(await screen.findByRole("button", { name: /^Organization scope for admin role/ }));
    fireEvent.click(await screen.findByRole("button", { name: "Events" }));
    fireEvent.click(screen.getByRole("button", { name: "Change" }));
    const dialog = await screen.findByRole("dialog", { name: "Change role" });
    expect(dialog.textContent).toContain("from Operator to Administrator");
    fireEvent.click(within(dialog).getByRole("button", { name: "Change role" }));

    await waitFor(() => {
      expect(mockGrantUserRole).toHaveBeenCalledWith("usr-1", {
        role: "admin",
        scope_type: "organization",
        scope_id: "org-2",
      });
    });
    expect(onUpdated).toHaveBeenCalledWith({ ...user, roles: [existingRole] }, "Role updated");
    expect(onClose).toHaveBeenCalled();
  });

  it("changes an existing role to Operator with the picked event scope", async () => {
    const existingRole = { id: "role-1", role: "admin", scope_type: "organization", scope_id: "org-1", is_oidc: false };
    const { onClose, onUpdated } = renderModal({ roles: [existingRole] });
    await waitFor(() => {
      expect(document.querySelector(".users-modal__chips")).toBeTruthy();
    });

    fireEvent.click(screen.getByRole("button", { name: /^Role,/ }));
    fireEvent.click(screen.getByRole("button", { name: "Operator" }));
    fireEvent.click(screen.getByRole("button", { name: "Event scope for operator role, none selected" }));
    fireEvent.click(await screen.findByRole("button", { name: "Summer Summit" }));
    fireEvent.click(screen.getByRole("button", { name: "Change" }));
    const dialog = await screen.findByRole("dialog", { name: "Change role" });
    expect(dialog.textContent).toContain("from Administrator to Operator");
    fireEvent.click(within(dialog).getByRole("button", { name: "Change role" }));

    await waitFor(() => {
      expect(mockGrantUserRole).toHaveBeenCalledWith("usr-1", {
        role: "operator",
        scope_type: "event",
        scope_id: "evt-1",
      });
    });
    expect(onUpdated).toHaveBeenCalledWith({ ...user, roles: [existingRole] }, "Role updated");
    expect(onClose).toHaveBeenCalled();
  });

  it("stages another scope of the same role type without confirmation or an API call", async () => {
    const secondEvent: EventDto = { ...event, id: "evt-2", title: "Winter Gala" };
    mockFetchAdminEvents.mockResolvedValue([event, secondEvent]);
    renderModal({
      roles: [{ id: "role-1", role: "operator", scope_type: "event", scope_id: "evt-1", is_oidc: false }],
    });
    await waitFor(() => {
      expect(document.querySelector(".users-modal__chips")).toBeTruthy();
    });
    // Already on "operator" (the user's current type) - no type-change notice, no confirm dialog.
    expect(screen.queryByText(/Changing to/)).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Event scope for operator role, none selected" }));
    fireEvent.click(await screen.findByRole("button", { name: "Winter Gala" }));
    fireEvent.click(screen.getByRole("button", { name: "Add" }));

    expect(await screen.findByText("Winter Gala")).toBeTruthy();
    expect(mockGrantUserRole).not.toHaveBeenCalled();
    // The just-staged scope is no longer offered again in the picker.
    fireEvent.click(screen.getByRole("button", { name: "Event scope for operator role, none selected" }));
    expect(screen.queryByRole("button", { name: "Winter Gala" })).toBeNull();
  });

  it("cancels a not-yet-saved pending add locally, with no confirmation or request", async () => {
    renderModal();
    await waitFor(() => expect(mockFetchAdminOrganizations).toHaveBeenCalledOnce());

    fireEvent.click(screen.getByRole("button", { name: /^Role,/ }));
    fireEvent.click(screen.getByRole("button", { name: "Superadmin" }));
    fireEvent.click(screen.getByRole("button", { name: "Add" }));
    expect(await screen.findByText("Instance-wide")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: /Cancel adding Superadmin/ }));

    expect(screen.queryByText("Instance-wide")).toBeNull();
    expect(mockGrantUserRole).not.toHaveBeenCalled();
  });

  it("disables Change role type while a same-type scope change is still only staged", async () => {
    renderModal({
      roles: [{ id: "role-1", role: "operator", scope_type: "event", scope_id: "evt-1", is_oidc: false }],
    });
    await waitFor(() => {
      expect(document.querySelector(".users-modal__chips")).toBeTruthy();
    });

    fireEvent.click(screen.getByRole("button", { name: /Remove Operator/ }));
    expect(screen.queryByText("Summer Summit")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: /^Role,/ }));
    fireEvent.click(screen.getByRole("button", { name: "Superadmin" }));

    const changeButton = screen.getByRole("button", { name: "Change" });
    expect(changeButton).toHaveProperty("disabled", true);
    expect(changeButton.title).toBe("Save or discard your pending scope changes first.");
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

    const roleTrigger = screen.getByRole("button", { name: /^Role,/ });
    expect(roleTrigger).toHaveProperty("disabled", true);
    expect(roleTrigger.title).toBe("You cannot change your own role.");
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

  it("stages a scope removal locally, hiding the chip immediately without calling the API", async () => {
    const existingRole = { id: "role-1", role: "operator", scope_type: "event", scope_id: "evt-1", is_oidc: false };
    const { onClose, onUpdated } = renderModal({ roles: [existingRole] });
    await waitFor(() => {
      expect(document.querySelector(".users-modal__chips")).toBeTruthy();
    });
    expect(screen.getByText("Summer Summit")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: /Remove Operator/ }));

    expect(screen.queryByText("Summer Summit")).toBeNull();
    expect(mockRevokeUserRole).not.toHaveBeenCalled();
    expect(onUpdated).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
    expect(screen.queryAllByRole("dialog")).toHaveLength(1);
  });

  it("commits staged role adds and removes together with the profile fields, in one Save", async () => {
    const secondEvent: EventDto = { ...event, id: "evt-2", title: "Winter Gala" };
    mockFetchAdminEvents.mockResolvedValue([event, secondEvent]);
    const existingRole = { id: "role-1", role: "operator", scope_type: "event", scope_id: "evt-1", is_oidc: false };
    mockPatchAdminUser.mockResolvedValueOnce({ user: { ...user, roles: [existingRole] } });
    const { onClose, onUpdated } = renderModal({ roles: [existingRole] });
    await waitFor(() => {
      expect(document.querySelector(".users-modal__chips")).toBeTruthy();
    });

    // Stage a removal of the existing scope and an add of a different one, in one sitting.
    fireEvent.click(screen.getByRole("button", { name: /Remove Operator/ }));
    fireEvent.click(screen.getByRole("button", { name: "Event scope for operator role, none selected" }));
    fireEvent.click(await screen.findByRole("button", { name: "Winter Gala" }));
    fireEvent.click(screen.getByRole("button", { name: "Add" }));
    expect(mockGrantUserRole).not.toHaveBeenCalled();
    expect(mockRevokeUserRole).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));

    await waitFor(() => {
      expect(mockPatchAdminUser).toHaveBeenCalledWith("usr-1", {
        display_name: "Staff User",
        email: "staff@example.com",
        phone_country_code: null,
        phone_number: null,
      });
    });
    await waitFor(() => {
      expect(mockRevokeUserRole).toHaveBeenCalledWith("usr-1", "role-1");
    });
    await waitFor(() => {
      expect(mockGrantUserRole).toHaveBeenCalledWith("usr-1", {
        role: "operator",
        scope_type: "event",
        scope_id: "evt-2",
      });
    });
    // One combined notification and close, not one per action - the whole point of staging.
    expect(onUpdated).toHaveBeenCalledOnce();
    expect(onUpdated).toHaveBeenCalledWith({ ...user, roles: [existingRole] }, "Changes saved");
    expect(onClose).toHaveBeenCalledOnce();
  });

  it("stages an admin role add with the picked organization scope", async () => {
    renderModal();
    await waitFor(() => expect(mockFetchAdminOrganizations).toHaveBeenCalledOnce());

    fireEvent.click(screen.getByRole("button", { name: /^Role,/ }));
    fireEvent.click(screen.getByRole("button", { name: "Administrator" }));
    fireEvent.click(await screen.findByRole("button", { name: /^Organization scope for admin role/ }));
    fireEvent.click(await screen.findByRole("button", { name: "Events" }));
    fireEvent.click(screen.getByRole("button", { name: "Add" }));

    expect(await screen.findByText("Events")).toBeTruthy();
    expect(document.querySelector(".users-modal__chip--pending")).toBeTruthy();
    expect(mockGrantUserRole).not.toHaveBeenCalled();
  });

  it("stages an operator role add with the picked event scope", async () => {
    renderModal();
    await waitFor(() => expect(mockFetchAdminEvents).toHaveBeenCalledOnce());

    fireEvent.click(screen.getByRole("button", { name: /^Role,/ }));
    fireEvent.click(screen.getByRole("button", { name: "Operator" }));
    fireEvent.click(screen.getByRole("button", { name: "Event scope for operator role, none selected" }));
    fireEvent.click(await screen.findByRole("button", { name: "Summer Summit" }));
    fireEvent.click(screen.getByRole("button", { name: "Add" }));

    expect(await screen.findByText("Summer Summit")).toBeTruthy();
    expect(document.querySelector(".users-modal__chip--pending")).toBeTruthy();
    expect(mockGrantUserRole).not.toHaveBeenCalled();
  });

  it("shows the organization name (not the raw id) on an existing admin scope chip", async () => {
    const existingRole = { id: "role-1", role: "admin", scope_type: "organization", scope_id: "org-2", is_oidc: false };
    renderModal({ roles: [existingRole] });

    expect(await screen.findByText("Events")).toBeTruthy();
  });

  it("maps cannot_change_own_role to a specific message when saving profile fields", async () => {
    mockPatchAdminUser.mockRejectedValueOnce(new ApiError(400, "cannot_change_own_role", "cannot_change_own_role"));
    renderModal();
    await screen.findByRole("button", { name: "Save changes" });

    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));

    expect(await screen.findByText("You cannot change your own role. Ask another superadmin.")).toBeTruthy();
  });

  it("maps email_taken to a specific message when saving profile fields", async () => {
    mockPatchAdminUser.mockRejectedValueOnce(new ApiError(400, "email_taken", "email_taken"));
    renderModal();
    await screen.findByRole("button", { name: "Save changes" });

    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));

    expect(await screen.findByText("A user with this email already exists.")).toBeTruthy();
  });

  it("maps cannot_change_own_role to a specific message when confirming a role type change", async () => {
    const existingRole = { id: "role-1", role: "operator", scope_type: "event", scope_id: "evt-1", is_oidc: false };
    mockGrantUserRole.mockRejectedValueOnce(new ApiError(400, "cannot_change_own_role", "cannot_change_own_role"));
    renderModal({ roles: [existingRole] });
    await waitFor(() => {
      expect(document.querySelector(".users-modal__chips")).toBeTruthy();
    });

    fireEvent.click(screen.getByRole("button", { name: /^Role,/ }));
    fireEvent.click(screen.getByRole("button", { name: "Superadmin" }));
    fireEvent.click(screen.getByRole("button", { name: "Change" }));
    const dialog = await screen.findByRole("dialog", { name: "Change role" });
    fireEvent.click(within(dialog).getByRole("button", { name: "Change role" }));

    expect(await screen.findByText("You cannot change your own role. Ask another superadmin.")).toBeTruthy();
  });

  it("falls back to a generic message for a non-API error confirming a role type change", async () => {
    const existingRole = { id: "role-1", role: "operator", scope_type: "event", scope_id: "evt-1", is_oidc: false };
    mockGrantUserRole.mockRejectedValueOnce(new Error("network down"));
    renderModal({ roles: [existingRole] });
    await waitFor(() => {
      expect(document.querySelector(".users-modal__chips")).toBeTruthy();
    });

    fireEvent.click(screen.getByRole("button", { name: /^Role,/ }));
    fireEvent.click(screen.getByRole("button", { name: "Superadmin" }));
    fireEvent.click(screen.getByRole("button", { name: "Change" }));
    const dialog = await screen.findByRole("dialog", { name: "Change role" });
    fireEvent.click(within(dialog).getByRole("button", { name: "Change role" }));

    expect(await screen.findByText("Failed to assign role.")).toBeTruthy();
  });
});

describe("UserEditModal sign-in security", () => {
  it("shows SSO and MFA-enrolled status together with the active session count", async () => {
    renderModal({
      has_sso: true,
      has_mfa: true,
      active_sessions_count: 3,
      external_identities: [{ id: "ei-1", provider_display_name: "Authentik" }],
    });

    await screen.findByText("Authentik");
    expect(screen.getByText("Authenticator app enrolled")).toBeTruthy();
    expect(screen.getByText("Active sessions")).toBeTruthy();
    expect(screen.getByText("3 sessions")).toBeTruthy();
  });

  it("joins multiple linked identity providers in the Sign-in method tile (e.g. also Cloudflare Access)", async () => {
    renderModal({
      has_sso: true,
      external_identities: [
        { id: "ei-1", provider_display_name: "Authentik" },
        { id: "ei-2", provider_display_name: "Cloudflare Access" },
      ],
    });

    expect(await screen.findByText("Authentik + Cloudflare Access")).toBeTruthy();
  });

  it("disables Unlink SSO for a local-only account", async () => {
    renderModal({ has_sso: false });
    await screen.findByText("Local password");
    openMoreActions();
    expect(screen.getByRole("menuitem", { name: /Unlink identity provider/ })).toHaveProperty("disabled", true);
  });

  it("unlinks SSO after confirmation, requiring a new password in the same step", async () => {
    const { onClose, onUpdated } = renderModal({ has_sso: true });
    await screen.findByRole("button", { name: "Save changes" });

    openMoreActions();
    fireEvent.click(screen.getByRole("menuitem", { name: /Unlink identity provider/ }));
    const dialog = await screen.findByRole("dialog", { name: "Unlink identity provider" });
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
      "Identity provider unlinked. User must sign in with the new local password.",
    );
    expect(onClose).toHaveBeenCalled();
  });

  it("maps invalid_request to the password-length message when unlinking SSO", async () => {
    mockUnlinkUserExternalIdentity.mockRejectedValueOnce(new ApiError(400, "invalid_request", "invalid_request"));
    const { onClose } = renderModal({ has_sso: true });
    await screen.findByRole("button", { name: "Save changes" });

    openMoreActions();
    fireEvent.click(screen.getByRole("menuitem", { name: /Unlink identity provider/ }));
    const dialog = await screen.findByRole("dialog", { name: "Unlink identity provider" });
    fireEvent.change(screen.getByLabelText("New temporary password"), {
      target: { value: "long-enough-password" },
    });
    fireEvent.click(within(dialog).getByRole("button", { name: "Unlink" }));

    expect(await screen.findByText("Password must be at least 12 characters.")).toBeTruthy();
    expect(onClose).not.toHaveBeenCalled();
  });

  it("falls back to a generic message for a non-API error unlinking SSO", async () => {
    mockUnlinkUserExternalIdentity.mockRejectedValueOnce(new Error("network down"));
    renderModal({ has_sso: true });
    await screen.findByRole("button", { name: "Save changes" });

    openMoreActions();
    fireEvent.click(screen.getByRole("menuitem", { name: /Unlink identity provider/ }));
    const dialog = await screen.findByRole("dialog", { name: "Unlink identity provider" });
    fireEvent.change(screen.getByLabelText("New temporary password"), {
      target: { value: "long-enough-password" },
    });
    fireEvent.click(within(dialog).getByRole("button", { name: "Unlink" }));

    expect(await screen.findByText("Failed to unlink identity provider.")).toBeTruthy();
  });

  it("cancels the unlink-SSO confirmation, clearing the typed password", async () => {
    renderModal({ has_sso: true });
    await screen.findByRole("button", { name: "Save changes" });

    openMoreActions();
    fireEvent.click(screen.getByRole("menuitem", { name: /Unlink identity provider/ }));
    const dialog = await screen.findByRole("dialog", { name: "Unlink identity provider" });
    fireEvent.change(screen.getByLabelText("New temporary password"), {
      target: { value: "long-enough-password" },
    });
    fireEvent.click(within(dialog).getByRole("button", { name: "Cancel" }));

    expect(screen.queryByRole("dialog", { name: "Unlink identity provider" })).toBeNull();
    expect(mockUnlinkUserExternalIdentity).not.toHaveBeenCalled();
  });

  it("ignores Escape while the SSO unlink request is still in flight", async () => {
    mockUnlinkUserExternalIdentity.mockImplementationOnce(() => new Promise(() => {}));
    renderModal({ has_sso: true });
    await screen.findByRole("button", { name: "Save changes" });

    openMoreActions();
    fireEvent.click(screen.getByRole("menuitem", { name: /Unlink identity provider/ }));
    const dialog = await screen.findByRole("dialog", { name: "Unlink identity provider" });
    fireEvent.change(screen.getByLabelText("New temporary password"), {
      target: { value: "long-enough-password" },
    });
    fireEvent.click(within(dialog).getByRole("button", { name: "Unlink" }));

    await waitFor(() => {
      expect(within(dialog).getByRole("button", { name: "Cancel" })).toHaveProperty("disabled", true);
    });

    fireEvent.keyDown(document, { key: "Escape" });

    expect(screen.getByRole("dialog", { name: "Unlink identity provider" })).toBeTruthy();
    expect((screen.getByLabelText("New temporary password") as HTMLInputElement).value).toBe(
      "long-enough-password",
    );
  });

  it("disables unlinking your own SSO", async () => {
    useAuthMock.mockReturnValue({ user: { id: "usr-1" } });
    renderModal({ has_sso: true });
    await screen.findByRole("button", { name: "Save changes" });

    openMoreActions();
    expect(screen.getByRole("menuitem", { name: /Unlink identity provider/ })).toHaveProperty("disabled", true);
  });

  it("disables reset password and reset two-factor for SSO-managed accounts", async () => {
    renderModal({ has_sso: true });
    await screen.findByRole("button", { name: "Save changes" });

    openMoreActions();
    expect(screen.getByRole("menuitem", { name: /Reset password/ })).toHaveProperty("disabled", true);
    expect(screen.getByRole("menuitem", { name: /Reset two-factor/ })).toHaveProperty("disabled", true);
  });

  it("keeps reset password and reset two-factor enabled for local accounts", async () => {
    renderModal({ has_sso: false });
    await screen.findByRole("button", { name: "Save changes" });

    openMoreActions();
    expect(screen.getByRole("menuitem", { name: /Reset password/ })).toHaveProperty("disabled", false);
    expect(screen.getByRole("menuitem", { name: /Reset two-factor/ })).toHaveProperty("disabled", false);
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

  it("shows the empty recent-logins state when the fetch fails, instead of leaving the section stuck loading", async () => {
    mockFetchSecurityAuditLog.mockRejectedValueOnce(new Error("network down"));
    renderModal();

    expect(await screen.findByText("No recent logins")).toBeTruthy();
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

  it("uses the singular 'session' when exactly one was revoked", async () => {
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

  it("shows an error and stays open when revoking sessions fails", async () => {
    mockRevokeUserSessions.mockRejectedValueOnce(new Error("network down"));
    const { onClose } = renderModal({ active_sessions_count: 2 });
    await screen.findByText("2 sessions");

    openMoreActions();
    fireEvent.click(screen.getByRole("menuitem", { name: /Revoke sessions/ }));
    const dialog = await screen.findByRole("dialog", { name: "Revoke all sessions" });
    fireEvent.click(within(dialog).getByRole("button", { name: "Revoke" }));

    expect(await screen.findByText("Failed to revoke sessions.")).toBeTruthy();
    expect(onClose).not.toHaveBeenCalled();
  });

  it("cancels the revoke-sessions confirmation without calling the API", async () => {
    renderModal({ active_sessions_count: 2 });
    await screen.findByText("2 sessions");

    openMoreActions();
    fireEvent.click(screen.getByRole("menuitem", { name: /Revoke sessions/ }));
    const dialog = await screen.findByRole("dialog", { name: "Revoke all sessions" });
    fireEvent.click(within(dialog).getByRole("button", { name: "Cancel" }));

    expect(screen.queryByRole("dialog", { name: "Revoke all sessions" })).toBeNull();
    expect(mockRevokeUserSessions).not.toHaveBeenCalled();
  });
});

describe("UserEditModal reset actions", () => {
  it("confirms an MFA reset with the compact action label and reports why the user must sign in again", async () => {
    const { onClose, onUpdated } = renderModal();
    await screen.findByRole("button", { name: "Save changes" });

    openMoreActions();
    fireEvent.click(screen.getByRole("menuitem", { name: /Reset two-factor/ }));
    const dialog = await screen.findByRole("dialog", { name: "Reset two-factor" });
    fireEvent.click(within(dialog).getByRole("button", { name: "Reset" }));

    await waitFor(() => {
      expect(mockResetUserMfa).toHaveBeenCalledWith("usr-1", undefined);
    });
    expect(onUpdated).toHaveBeenCalledWith(user, "Two-factor reset. User must sign in again.");
    expect(onClose).toHaveBeenCalled();
  });

  it("shows an error and stays open when resetting MFA fails", async () => {
    mockResetUserMfa.mockRejectedValueOnce(new Error("network down"));
    const { onClose } = renderModal();
    await screen.findByRole("button", { name: "Save changes" });

    openMoreActions();
    fireEvent.click(screen.getByRole("menuitem", { name: /Reset two-factor/ }));
    const dialog = await screen.findByRole("dialog", { name: "Reset two-factor" });
    fireEvent.click(within(dialog).getByRole("button", { name: "Reset" }));

    expect(await screen.findByText("Failed to reset two-factor.")).toBeTruthy();
    expect(onClose).not.toHaveBeenCalled();
  });

  it("cancels the reset-MFA confirmation without calling the API", async () => {
    renderModal();
    await screen.findByRole("button", { name: "Save changes" });

    openMoreActions();
    fireEvent.click(screen.getByRole("menuitem", { name: /Reset two-factor/ }));
    const dialog = await screen.findByRole("dialog", { name: "Reset two-factor" });
    fireEvent.click(within(dialog).getByRole("button", { name: "Cancel" }));

    expect(screen.queryByRole("dialog", { name: "Reset two-factor" })).toBeNull();
    expect(mockResetUserMfa).not.toHaveBeenCalled();
  });

  it("ignores a backdrop click on the reset-MFA dialog while the request is in flight", async () => {
    let resolveReset!: () => void;
    mockResetUserMfa.mockReturnValueOnce(new Promise((resolve) => (resolveReset = () => resolve(undefined))));
    renderModal();
    await screen.findByRole("button", { name: "Save changes" });

    openMoreActions();
    fireEvent.click(screen.getByRole("menuitem", { name: /Reset two-factor/ }));
    const dialog = await screen.findByRole("dialog", { name: "Reset two-factor" });
    fireEvent.click(within(dialog).getByRole("button", { name: "Reset" }));

    // The Edit user modal has its own outer backdrop too - scope the query to this
    // ConfirmDialog's own <dialog> element so the click can't land on the wrong one.
    fireEvent.click(dialog.querySelector(".at-modal-backdrop")!);
    expect(screen.getByRole("dialog", { name: "Reset two-factor" })).toBeTruthy();

    resolveReset();
    await waitFor(() => {
      expect(screen.queryByRole("dialog", { name: "Reset two-factor" })).toBeNull();
    });
  });

  it("resets a password and reports that existing sessions were revoked", async () => {
    const { onClose, onUpdated } = renderModal();
    await screen.findByRole("button", { name: "Save changes" });

    openMoreActions();
    fireEvent.click(screen.getByRole("menuitem", { name: /Reset password/ }));
    fireEvent.change(screen.getByLabelText("New temporary password"), { target: { value: "long-enough-password" } });
    fireEvent.click(screen.getByRole("button", { name: "Reset password" }));

    await waitFor(() => {
      expect(mockResetUserPassword).toHaveBeenCalledWith("usr-1", {
        new_password: "long-enough-password",
        code: undefined,
      });
    });
    expect(onUpdated).toHaveBeenCalledWith(user, "Password reset. Sessions revoked.");
    expect(onClose).toHaveBeenCalled();
  });

  it("maps invalid_request to the password-length message when resetting a password", async () => {
    mockResetUserPassword.mockRejectedValueOnce(new ApiError(400, "invalid_request", "invalid_request"));
    const { onClose } = renderModal();
    await screen.findByRole("button", { name: "Save changes" });

    openMoreActions();
    fireEvent.click(screen.getByRole("menuitem", { name: /Reset password/ }));
    fireEvent.change(screen.getByLabelText("New temporary password"), { target: { value: "long-enough-password" } });
    fireEvent.click(screen.getByRole("button", { name: "Reset password" }));

    expect(await screen.findByText("Password must be at least 12 characters.")).toBeTruthy();
    expect(onClose).not.toHaveBeenCalled();
  });

  it("falls back to a generic message for a non-API error resetting a password", async () => {
    mockResetUserPassword.mockRejectedValueOnce(new Error("network down"));
    renderModal();
    await screen.findByRole("button", { name: "Save changes" });

    openMoreActions();
    fireEvent.click(screen.getByRole("menuitem", { name: /Reset password/ }));
    fireEvent.change(screen.getByLabelText("New temporary password"), { target: { value: "long-enough-password" } });
    fireEvent.click(screen.getByRole("button", { name: "Reset password" }));

    expect(await screen.findByText("Failed to reset password.")).toBeTruthy();
  });

  it("cancels the reset-password form, clearing the typed password", async () => {
    renderModal();
    await screen.findByRole("button", { name: "Save changes" });

    openMoreActions();
    fireEvent.click(screen.getByRole("menuitem", { name: /Reset password/ }));
    fireEvent.change(screen.getByLabelText("New temporary password"), { target: { value: "long-enough-password" } });
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));

    expect(screen.queryByLabelText("New temporary password")).toBeNull();
    expect(mockResetUserPassword).not.toHaveBeenCalled();
  });
});

describe("UserEditModal reset actions on another superadmin - actor step-up", () => {
  const superadminUser: Partial<UserListItemDto> = {
    roles: [{ id: "role-1", role: "superadmin", scope_type: "instance", scope_id: null, is_oidc: false }],
  };

  it("requires and sends the actor's own code when resetting another superadmin's MFA", async () => {
    renderModal(superadminUser);
    await screen.findByRole("button", { name: "Save changes" });

    openMoreActions();
    fireEvent.click(screen.getByRole("menuitem", { name: /Reset two-factor/ }));
    const dialog = await screen.findByRole("dialog", { name: "Reset two-factor" });
    const resetButton = within(dialog).getByRole("button", { name: "Reset" });
    expect(resetButton).toHaveProperty("disabled", true);

    fireEvent.change(within(dialog).getByLabelText("Your authenticator or backup code"), {
      target: { value: "123456" },
    });
    expect(resetButton).toHaveProperty("disabled", false);
    fireEvent.click(resetButton);

    await waitFor(() => {
      expect(mockResetUserMfa).toHaveBeenCalledWith("usr-1", "123456");
    });
  });

  it("does not show or require an actor code when resetting your own superadmin MFA", async () => {
    useAuthMock.mockReturnValue({ user: { id: "usr-1" } });
    renderModal(superadminUser);
    await screen.findByRole("button", { name: "Save changes" });

    openMoreActions();
    fireEvent.click(screen.getByRole("menuitem", { name: /Reset two-factor/ }));
    const dialog = await screen.findByRole("dialog", { name: "Reset two-factor" });
    expect(within(dialog).queryByLabelText("Your authenticator or backup code")).toBeNull();
    fireEvent.click(within(dialog).getByRole("button", { name: "Reset" }));

    await waitFor(() => {
      expect(mockResetUserMfa).toHaveBeenCalledWith("usr-1", undefined);
    });
  });

  it("requires and sends the actor's own code when resetting another superadmin's password", async () => {
    renderModal(superadminUser);
    await screen.findByRole("button", { name: "Save changes" });

    openMoreActions();
    fireEvent.click(screen.getByRole("menuitem", { name: /Reset password/ }));
    fireEvent.change(screen.getByLabelText("New temporary password"), { target: { value: "long-enough-password" } });
    const resetButton = screen.getByRole("button", { name: "Reset password" });
    expect(resetButton).toHaveProperty("disabled", true);

    fireEvent.change(screen.getByLabelText("Your authenticator or backup code"), { target: { value: "654321" } });
    expect(resetButton).toHaveProperty("disabled", false);
    fireEvent.click(resetButton);

    await waitFor(() => {
      expect(mockResetUserPassword).toHaveBeenCalledWith("usr-1", {
        new_password: "long-enough-password",
        code: "654321",
      });
    });
  });

  it("surfaces actor_mfa_required with a clear message instead of a generic failure", async () => {
    mockResetUserPassword.mockRejectedValueOnce(
      new ApiError(403, "actor_mfa_required", "actor_mfa_required"),
    );
    renderModal(superadminUser);
    await screen.findByRole("button", { name: "Save changes" });

    openMoreActions();
    fireEvent.click(screen.getByRole("menuitem", { name: /Reset password/ }));
    fireEvent.change(screen.getByLabelText("New temporary password"), { target: { value: "long-enough-password" } });
    fireEvent.change(screen.getByLabelText("Your authenticator or backup code"), { target: { value: "654321" } });
    fireEvent.click(screen.getByRole("button", { name: "Reset password" }));

    expect(
      await screen.findByText(
        "You need a confirmed authenticator app on your own account before you can reset another superadmin's two-factor or password. If you signed in through single sign-on and have no local password, you can't set one up yourself here - ask another superadmin who already has an authenticator app to do this instead.",
      ),
    ).toBeTruthy();
  });
});

describe("UserEditModal disable / enable account", () => {
  it("confirms before disabling an active account and revokes sessions server-side", async () => {
    mockPatchAdminUser.mockResolvedValueOnce({ user: { ...user, is_active: false } });
    const { onClose, onUpdated } = renderModal({ is_active: true });
    await screen.findByRole("button", { name: "Save changes" });

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

  it("re-enables a disabled account immediately, without a confirmation dialog", async () => {
    mockPatchAdminUser.mockResolvedValueOnce({ user: { ...user, is_active: true } });
    const { onClose, onUpdated } = renderModal({ is_active: false });
    await screen.findByRole("button", { name: "Save changes" });

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
    await screen.findByRole("button", { name: "Save changes" });

    openMoreActions();
    expect(screen.getByRole("menuitem", { name: /Disable account/ })).toHaveProperty("disabled", true);
  });

  it("shows an error and stays open when disabling the account fails", async () => {
    mockPatchAdminUser.mockRejectedValueOnce(new Error("network down"));
    const { onClose } = renderModal({ is_active: true });
    await screen.findByRole("button", { name: "Save changes" });

    openMoreActions();
    fireEvent.click(screen.getByRole("menuitem", { name: /Disable account/ }));
    const dialog = await screen.findByRole("dialog", { name: "Disable account" });
    fireEvent.click(within(dialog).getByRole("button", { name: "Disable" }));

    expect(await screen.findByText("Failed to update account status.")).toBeTruthy();
    expect(onClose).not.toHaveBeenCalled();
  });

  it("cancels the disable-account confirmation without calling the API", async () => {
    renderModal({ is_active: true });
    await screen.findByRole("button", { name: "Save changes" });

    openMoreActions();
    fireEvent.click(screen.getByRole("menuitem", { name: /Disable account/ }));
    const dialog = await screen.findByRole("dialog", { name: "Disable account" });
    fireEvent.click(within(dialog).getByRole("button", { name: "Cancel" }));

    expect(screen.queryByRole("dialog", { name: "Disable account" })).toBeNull();
    expect(mockPatchAdminUser).not.toHaveBeenCalled();
  });
});

describe("UserEditModal profile - phone number", () => {
  it("pre-fills the country code and number from the user, and saves changes to both", async () => {
    mockPatchAdminUser.mockResolvedValueOnce({
      user: { ...user, phone_country_code: "+1", phone_number: "5551234" },
    });
    const { onUpdated } = renderModal({ phone_country_code: "+48", phone_number: "500100200" });
    await screen.findByRole("button", { name: "Save changes" });

    expect(screen.getByRole("button", { name: /Phone country code, Poland \+48/ })).toBeTruthy();
    expect((document.getElementById("edit-phone-number") as HTMLInputElement).value).toBe("500100200");

    fireEvent.click(screen.getByRole("button", { name: /Phone country code/ }));
    fireEvent.change(screen.getByLabelText("Search country or dial code"), {
      target: { value: "United States" },
    });
    fireEvent.click(screen.getByRole("button", { name: /United States/ }));
    fireEvent.change(document.getElementById("edit-phone-number")!, { target: { value: "5551234" } });
    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));

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

  it("sends null for both fields when no phone number is set", async () => {
    renderModal();
    await screen.findByRole("button", { name: "Save changes" });

    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));

    await waitFor(() => {
      expect(mockPatchAdminUser).toHaveBeenCalledWith(
        "usr-1",
        expect.objectContaining({ phone_country_code: null, phone_number: null }),
      );
    });
  });
});

describe("UserEditModal save state", () => {
  it("keeps profile controls disabled while the update is in progress", async () => {
    mockPatchAdminUser.mockImplementationOnce(() => new Promise(() => {}));
    renderModal();
    await screen.findByRole("button", { name: "Save changes" });

    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));

    await waitFor(() => {
      expect(mockPatchAdminUser).toHaveBeenCalledWith("usr-1", {
        display_name: "Staff User",
        email: "staff@example.com",
        phone_country_code: null,
        phone_number: null,
      });
    });
    expect(screen.getByRole("button", { name: "Saving changes…" })).toHaveProperty("disabled", true);
    expect(screen.getByRole("button", { name: "Close" })).toHaveProperty("disabled", true);
  });
});

describe("UserEditModal delete account", () => {
  it("disables Delete account for the signed-in user's own account", async () => {
    useAuthMock.mockReturnValue({ user: { id: "usr-1" } });
    renderModal();
    await screen.findByRole("button", { name: "Save changes" });

    openMoreActions();
    expect(screen.getByRole("menuitem", { name: /Delete account/ })).toHaveProperty("disabled", true);
  });

  it("keeps Delete disabled until the account's email is typed to confirm", async () => {
    renderModal();
    await screen.findByRole("button", { name: "Save changes" });

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
    await screen.findByRole("button", { name: "Save changes" });

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

  it("shows an error and stays open when deleting the account fails", async () => {
    mockDeleteAdminUser.mockRejectedValueOnce(new Error("network down"));
    const { onClose, onDeleted } = renderModal();
    await screen.findByRole("button", { name: "Save changes" });

    openMoreActions();
    fireEvent.click(screen.getByRole("menuitem", { name: /Delete account/ }));
    const dialog = await screen.findByRole("dialog", { name: "Delete account" });
    fireEvent.change(within(dialog).getByLabelText(`Type the email address to confirm: "${user.email}"`), {
      target: { value: user.email },
    });
    fireEvent.click(within(dialog).getByRole("button", { name: "Delete" }));

    expect(await screen.findByText("Failed to delete user.")).toBeTruthy();
    expect(onDeleted).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
  });

  it("cancels the delete-account confirmation without calling the API", async () => {
    renderModal();
    await screen.findByRole("button", { name: "Save changes" });

    openMoreActions();
    fireEvent.click(screen.getByRole("menuitem", { name: /Delete account/ }));
    const dialog = await screen.findByRole("dialog", { name: "Delete account" });
    fireEvent.click(within(dialog).getByRole("button", { name: "Cancel" }));

    expect(screen.queryByRole("dialog", { name: "Delete account" })).toBeNull();
    expect(mockDeleteAdminUser).not.toHaveBeenCalled();
  });
});
