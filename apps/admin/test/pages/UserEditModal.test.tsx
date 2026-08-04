// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { EventDto, UserListItemDto } from "../../src/api/types.js";
import { UserEditModal } from "../../src/pages/users/UserEditModal.js";

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
    grantUserRole: vi.fn(),
    patchAdminUser: vi.fn(),
    resetUserMfa: vi.fn(),
    resetUserPassword: vi.fn(),
    revokeUserRole: vi.fn(),
  };
});

import {
  deleteAdminUser,
  fetchAdminEvents,
  fetchAdminOrganizations,
  grantUserRole,
  patchAdminUser,
  resetUserMfa,
  resetUserPassword,
} from "../../src/api/client.js";

const mockFetchAdminEvents = vi.mocked(fetchAdminEvents);
const mockFetchAdminOrganizations = vi.mocked(fetchAdminOrganizations);
const mockGrantUserRole = vi.mocked(grantUserRole);
const mockPatchAdminUser = vi.mocked(patchAdminUser);
const mockResetUserMfa = vi.mocked(resetUserMfa);
const mockResetUserPassword = vi.mocked(resetUserPassword);
const mockDeleteAdminUser = vi.mocked(deleteAdminUser);

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
  is_active: true,
  must_change_password: false,
  created_at: "2026-01-01T00:00:00.000Z",
  last_login_at: null,
  active_sessions_count: 0,
  has_mfa: false,
  roles: [],
};

function renderModal(userOverride: Partial<UserListItemDto> = {}) {
  const onClose = vi.fn();
  const onUpdated = vi.fn();
  const onDeleted = vi.fn();
  render(
    <UserEditModal
      open
      user={{ ...user, ...userOverride }}
      onClose={onClose}
      onUpdated={onUpdated}
      onDeleted={onDeleted}
    />,
  );
  return { onClose, onUpdated, onDeleted };
}

beforeEach(() => {
  mockFetchAdminEvents.mockResolvedValue([event]);
  mockFetchAdminOrganizations.mockResolvedValue([
    { id: "org-1", name: "Operations" },
    { id: "org-2", name: "Events" },
  ]);
  mockGrantUserRole.mockResolvedValue({
    assignment: { id: "role-1", role: "superadmin", scope_type: "instance", scope_id: null },
  });
  mockResetUserMfa.mockResolvedValue(undefined);
  mockResetUserPassword.mockResolvedValue(undefined);
  mockDeleteAdminUser.mockResolvedValue(undefined);
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  useAuthMock.mockReturnValue({ user: { id: "usr-current-admin" } });
});

describe("UserEditModal role scope controls", () => {
  it("switches between organization, event, and unscoped role controls", async () => {
    const { onClose, onUpdated } = renderModal();

    await waitFor(() => {
      expect(mockFetchAdminOrganizations).toHaveBeenCalledOnce();
      expect(mockFetchAdminEvents).toHaveBeenCalledOnce();
    });
    const roleSelect = screen.getByLabelText("Role to assign");
    expect(screen.getByRole("button", { name: "Add" }).hasAttribute("disabled")).toBe(true);

    fireEvent.change(roleSelect, { target: { value: "admin" } });
    const organizationSelect = screen.getByLabelText("Organization scope for admin role");
    await screen.findByRole("option", { name: "Operations" });
    await waitFor(() => {
      expect((organizationSelect as HTMLSelectElement).value).toBe("org-1");
    });
    expect(organizationSelect.hasAttribute("disabled")).toBe(false);
    fireEvent.change(organizationSelect, { target: { value: "org-2" } });
    expect((organizationSelect as HTMLSelectElement).value).toBe("org-2");

    fireEvent.change(roleSelect, { target: { value: "operator" } });
    const eventSelect = screen.getByLabelText("Event scope for operator role");
    expect(screen.getByRole("option", { name: "Summer Summit" })).toBeTruthy();
    fireEvent.change(eventSelect, { target: { value: "evt-1" } });
    expect((eventSelect as HTMLSelectElement).value).toBe("evt-1");

    fireEvent.change(roleSelect, { target: { value: "superadmin" } });
    const addButton = screen.getByRole("button", { name: "Add" });
    expect(addButton.hasAttribute("disabled")).toBe(false);
    fireEvent.click(addButton);

    await waitFor(() => {
      expect(mockGrantUserRole).toHaveBeenCalledWith("usr-1", {
        role: "superadmin",
        scope_type: "instance",
      });
    });
    expect(onUpdated).toHaveBeenCalledWith(user, "Role assigned");
    expect(onClose).toHaveBeenCalled();
  });

  it("disables the admin scope control and explains the empty organization list", async () => {
    mockFetchAdminOrganizations.mockResolvedValueOnce([]);
    mockFetchAdminEvents.mockResolvedValueOnce([]);
    renderModal();

    await waitFor(() => {
      expect(mockFetchAdminOrganizations).toHaveBeenCalled();
    });
    fireEvent.change(screen.getByLabelText("Role to assign"), { target: { value: "admin" } });

    const organizationSelect = screen.getByLabelText("Organization scope for admin role");
    expect(organizationSelect.hasAttribute("disabled")).toBe(true);
    expect(screen.getByRole("option", { name: "No organizations available" })).toBeTruthy();
  });
});

describe("UserEditModal assigned roles list", () => {
  it("shows each assigned role's badge with the shared label and color, not a flat neutral badge", async () => {
    renderModal({
      roles: [
        { id: "role-1", role: "admin", scope_type: "organization", scope_id: "org-1", is_oidc: false },
      ],
    });

    // Scoped to the assigned-roles list, not the page overall - "Administrator" also appears as
    // an <option> in the separate "Role to assign" select further down the same modal.
    const rolesList = document.querySelector(".users-modal__roles") as HTMLElement;
    await waitFor(() => {
      expect(within(rolesList).getByText("Administrator")).toBeTruthy();
    });
    expect(within(rolesList).getByText("Administrator").className).toMatch(/at-badge--warn/);
  });
});

describe("UserEditModal reset actions", () => {
  it("confirms a 2FA reset with the compact action label and reports why the user must sign in again", async () => {
    const { onClose, onUpdated } = renderModal();
    await screen.findByRole("button", { name: "Reset 2FA" });

    fireEvent.click(screen.getByRole("button", { name: "Reset 2FA" }));
    const dialog = await screen.findByRole("dialog", { name: "Reset 2FA" });
    fireEvent.click(within(dialog).getByRole("button", { name: "Reset" }));

    await waitFor(() => {
      expect(mockResetUserMfa).toHaveBeenCalledWith("usr-1");
    });
    expect(onUpdated).toHaveBeenCalledWith(user, "2FA reset. User must sign in again.");
    expect(onClose).toHaveBeenCalled();
  });

  it("resets a password and reports that existing sessions were revoked", async () => {
    const { onClose, onUpdated } = renderModal();
    await screen.findByRole("button", { name: "Reset password" });

    fireEvent.click(screen.getByRole("button", { name: "Reset password" }));
    fireEvent.change(screen.getByLabelText("New temporary password"), { target: { value: "long-enough-password" } });
    fireEvent.click(screen.getAllByRole("button", { name: "Reset password" }).at(-1)!);

    await waitFor(() => {
      expect(mockResetUserPassword).toHaveBeenCalledWith("usr-1", { new_password: "long-enough-password" });
    });
    expect(onUpdated).toHaveBeenCalledWith(user, "Password reset. Sessions revoked.");
    expect(onClose).toHaveBeenCalled();
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
        is_active: true,
      });
    });
    expect(screen.getByRole("button", { name: "Saving…" })).toHaveProperty("disabled", true);
    expect(screen.getByRole("button", { name: "Cancel" })).toHaveProperty("disabled", true);
  });
});

describe("UserEditModal delete account", () => {
  it("disables Delete account for the signed-in user's own account", async () => {
    useAuthMock.mockReturnValue({ user: { id: "usr-1" } });
    renderModal();
    await screen.findByRole("button", { name: "Save" });

    expect(screen.getByRole("button", { name: "Delete account" })).toHaveProperty("disabled", true);
  });

  it("deletes the account after confirmation", async () => {
    const { onClose, onDeleted } = renderModal();
    await screen.findByRole("button", { name: "Delete account" });

    fireEvent.click(screen.getByRole("button", { name: "Delete account" }));
    const dialog = await screen.findByRole("dialog", { name: "Delete account" });
    fireEvent.click(within(dialog).getByRole("button", { name: "Delete" }));

    await waitFor(() => {
      expect(mockDeleteAdminUser).toHaveBeenCalledWith("usr-1");
    });
    expect(onDeleted).toHaveBeenCalledWith(user);
    expect(onClose).toHaveBeenCalled();
  });
});
