// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter } from "react-router";
import { ToastProvider } from "@admitto/ui";
import { UsersPage } from "../../src/pages/UsersPage.js";
import { mockMatchMedia } from "../test-utils.js";
import type { UserListItemDto } from "../../src/api/types.js";

const SUPERADMIN_ASSIGNMENTS = [{ role: "superadmin", scope_type: "instance", scope_id: null }];
const useAuthMock = vi.fn(() => ({
  assignments: SUPERADMIN_ASSIGNMENTS as Array<{ role: string; scope_type: string; scope_id: string | null }>,
  user: { id: "current-admin" },
}));

vi.mock("../../src/auth/AuthProvider.js", () => ({
  useAuth: () => useAuthMock(),
}));

vi.mock("../../src/api/client.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../src/api/client.js")>();
  return {
    ...actual,
    fetchAdminUsers: vi.fn(),
    fetchUserStats: vi.fn(),
    fetchRoleAssignments: vi.fn(),
    fetchSessions: vi.fn(),
    fetchAdminEvents: vi.fn(),
    fetchAdminOrganizations: vi.fn(),
    fetchSecurityAuditLog: vi.fn(),
    revokeUserRole: vi.fn(),
    deleteAdminUser: vi.fn(),
    grantUserRole: vi.fn(),
    patchAdminUser: vi.fn(),
  };
});

import {
  deleteAdminUser,
  fetchAdminEvents,
  fetchAdminOrganizations,
  fetchAdminUsers,
  fetchSecurityAuditLog,
  fetchUserStats,
  fetchRoleAssignments,
  fetchSessions,
  grantUserRole,
  patchAdminUser,
  revokeUserRole,
} from "../../src/api/client.js";

function makeUser(id: string, displayName: string): UserListItemDto {
  return {
    id,
    email: `${id}@example.com`,
    display_name: displayName,
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
}

beforeEach(() => {
  vi.mocked(fetchRoleAssignments).mockResolvedValue({ assignments: [], total: 0, page: 1, pageSize: 25 });
  vi.mocked(fetchSessions).mockResolvedValue({ sessions: [] });
  vi.mocked(fetchAdminEvents).mockResolvedValue([]);
  vi.mocked(fetchAdminOrganizations).mockResolvedValue([]);
  vi.mocked(fetchSecurityAuditLog).mockResolvedValue({ entries: [], total: 0, page: 1, pageSize: 25 });
  vi.mocked(fetchUserStats).mockResolvedValue({
    total: 0,
    active: 0,
    mfa: 0,
    sso: 0,
    active_sessions: 0,
    active_sessions_users: 0,
  });
  // ScrollFadeTabs scrolls the active tab into view on mount/change - jsdom has no real impl.
  Element.prototype.scrollIntoView = vi.fn();
  // ActiveSessionsTab is always mounted (hidden, not unmounted) regardless of which tab is
  // active, so its own useIsDesktop() call always runs - jsdom has no real matchMedia.
  mockMatchMedia(true);
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  useAuthMock.mockReturnValue({ assignments: SUPERADMIN_ASSIGNMENTS, user: { id: "current-admin" } });
});

function renderAt(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <ToastProvider>
        <UsersPage />
      </ToastProvider>
    </MemoryRouter>,
  );
}

describe("UsersPage header", () => {
  it("opens the Invite user modal from the header button", async () => {
    vi.mocked(fetchAdminUsers).mockResolvedValue({ users: [], total: 0, page: 1, pageSize: 25 });

    renderAt("/admin/users");
    await screen.findByText("No users yet");

    // "Invite user" also appears as the empty state's own call-to-action button - both wire to
    // the same setInviteOpen(true), this exercises the page header's own copy specifically.
    fireEvent.click(screen.getAllByRole("button", { name: "Invite user" })[0]!);

    expect(await screen.findByRole("heading", { name: /Invite a new team member/ })).toBeTruthy();
  });

  it("shows the Two-factor coverage tile in its ok (green) state at full coverage", async () => {
    vi.mocked(fetchAdminUsers).mockResolvedValue({ users: [], total: 0, page: 1, pageSize: 25 });
    vi.mocked(fetchUserStats).mockResolvedValue({
      total: 4,
      active: 4,
      mfa: 4,
      password_users: 4,
      sso: 0,
      active_sessions: 0,
      active_sessions_users: 0,
    });

    renderAt("/admin/users");

    expect(await screen.findByText("100%")).toBeTruthy();
    const icon = document.querySelector(".users-page__stat-icon--ok .ti-shield-check");
    expect(icon).toBeTruthy();
  });

  it("counts a hybrid password+SSO account's local password toward two-factor coverage (codex review)", async () => {
    vi.mocked(fetchAdminUsers).mockResolvedValue({ users: [], total: 0, page: 1, pageSize: 25 });
    vi.mocked(fetchUserStats).mockResolvedValue({
      total: 4,
      active: 4,
      // 3 users have a local password (including one hybrid SSO+password account); only 2 of
      // those have MFA confirmed - the hybrid account's own password path is left unprotected,
      // so this must read 67%, not 100% (which excluding every SSO-linked user would produce).
      mfa: 2,
      password_users: 3,
      sso: 2,
      active_sessions: 0,
      active_sessions_users: 0,
    });

    renderAt("/admin/users");

    expect(await screen.findByText("67%")).toBeTruthy();
    const icon = document.querySelector(".users-page__stat-icon--warn .ti-shield-check");
    expect(icon).toBeTruthy();
  });

  it("shows vacuous 100% coverage, not 0%, when no user has a local password", async () => {
    vi.mocked(fetchAdminUsers).mockResolvedValue({ users: [], total: 0, page: 1, pageSize: 25 });
    vi.mocked(fetchUserStats).mockResolvedValue({
      total: 3,
      active: 3,
      mfa: 0,
      password_users: 0,
      sso: 3,
      active_sessions: 0,
      active_sessions_users: 0,
    });

    renderAt("/admin/users");

    expect(await screen.findByText("100%")).toBeTruthy();
    expect(screen.getByText("No local password accounts")).toBeTruthy();
    const icon = document.querySelector(".users-page__stat-icon--ok .ti-shield-check");
    expect(icon).toBeTruthy();
  });

  it("shows a toast (falling back to the email when there's no display name) and refreshes the list after deleting a user from the Edit modal", async () => {
    vi.mocked(fetchAdminUsers).mockResolvedValue({
      users: [{ ...makeUser("user-1", "Jane Doe"), display_name: null }],
      total: 1,
      page: 1,
      pageSize: 25,
    });
    vi.mocked(deleteAdminUser).mockResolvedValue(undefined);

    renderAt("/admin/users");
    await screen.findAllByText("user-1@example.com");
    expect(fetchAdminUsers).toHaveBeenCalledOnce();

    fireEvent.click(screen.getAllByRole("button", { name: "Edit profile for user-1@example.com" })[0]!);
    fireEvent.click(await screen.findByRole("button", { name: "More actions" }));
    fireEvent.click(screen.getByRole("menuitem", { name: /Delete account/ }));
    const dialog = await screen.findByRole("dialog", { name: "Delete account" });
    fireEvent.change(within(dialog).getByLabelText('Type the email address to confirm: "user-1@example.com"'), {
      target: { value: "user-1@example.com" },
    });
    fireEvent.click(within(dialog).getByRole("button", { name: "Delete" }));

    await waitFor(() => {
      expect(deleteAdminUser).toHaveBeenCalledWith("user-1");
    });
    expect(await screen.findByText("user-1@example.com deleted")).toBeTruthy();
    await waitFor(() => {
      expect(fetchAdminUsers).toHaveBeenCalledTimes(2);
    });
  });
});

describe("UsersPage Edit modal sync", () => {
  it("commits a staged role grant on Save changes and refreshes the Staff users list", async () => {
    vi.mocked(fetchAdminUsers)
      .mockResolvedValueOnce({
        users: [makeUser("user-1", "Jane Doe")],
        total: 1,
        page: 1,
        pageSize: 25,
      })
      .mockResolvedValueOnce({
        users: [
          {
            ...makeUser("user-1", "Jane Doe"),
            roles: [
              { id: "role-1", role: "operator", scope_type: "event", scope_id: "evt-1", is_oidc: false },
            ],
          },
        ],
        total: 1,
        page: 1,
        pageSize: 25,
      });
    vi.mocked(fetchAdminEvents).mockResolvedValue([
      {
        id: "evt-1",
        title: "Summer Summit",
        slug: "summer-summit",
        date: "2026-07-01",
        timezone: "Europe/Warsaw",
        location: null,
        organization_id: "org-1",
        archived_at: null,
      },
    ]);
    vi.mocked(grantUserRole).mockResolvedValueOnce({
      assignment: { id: "role-1", role: "operator", scope_type: "event", scope_id: "evt-1" },
    });
    vi.mocked(patchAdminUser).mockResolvedValueOnce({ user: makeUser("user-1", "Jane Doe") });

    renderAt("/admin/users");
    await screen.findAllByText("user-1@example.com");

    fireEvent.click(screen.getAllByRole("button", { name: "Edit profile for Jane Doe" })[0]!);
    await screen.findByRole("heading", { name: "Jane Doe" });

    fireEvent.click(await screen.findByRole("button", { name: /^Role,/ }));
    fireEvent.click(screen.getByRole("button", { name: "Operator" }));
    fireEvent.click(screen.getByRole("button", { name: "Event scope for operator role, none selected" }));
    fireEvent.click(await screen.findByRole("button", { name: "Summer Summit" }));
    fireEvent.click(screen.getByRole("button", { name: "Add" }));

    // Add only stages the grant locally - it shows up as a pending chip, not yet sent to the
    // server, until "Save changes" actually commits it (and, per every other immediate-commit
    // action in this modal, closes it on success).
    expect(document.querySelector(".users-modal__chip--pending")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));

    await waitFor(() => {
      expect(grantUserRole).toHaveBeenCalledWith("user-1", {
        role: "operator",
        scope_type: "event",
        scope_id: "evt-1",
      });
    });
    await waitFor(() => {
      expect(fetchAdminUsers).toHaveBeenCalledTimes(2);
    });
    expect(screen.queryByRole("heading", { name: "Jane Doe" })).toBeNull();
  });
});

describe("UsersPage Role assignments tab", () => {
  it("refreshes the Staff users list after a role is revoked from the Role assignments tab", async () => {
    useAuthMock.mockReturnValue({ assignments: SUPERADMIN_ASSIGNMENTS, user: { id: "current-admin" } });
    vi.mocked(fetchAdminUsers).mockResolvedValue({ users: [], total: 0, page: 1, pageSize: 25 });
    vi.mocked(fetchRoleAssignments).mockResolvedValue({
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
    vi.mocked(revokeUserRole).mockResolvedValue(undefined);

    renderAt("/admin/users?tab=roles");

    await screen.findAllByText("staff@example.com");
    expect(fetchAdminUsers).toHaveBeenCalledOnce();

    fireEvent.click(screen.getAllByRole("button", { name: "Revoke Operator for staff@example.com" })[0]!);
    const dialog = await screen.findByRole("dialog");
    fireEvent.click(within(dialog).getByRole("button", { name: "Revoke" }));

    await waitFor(() => {
      expect(fetchAdminUsers).toHaveBeenCalledTimes(2);
    });
  });
});

describe("UsersPage search debounce", () => {
  it("debounces the search box before refetching with the trimmed term", async () => {
    vi.mocked(fetchAdminUsers).mockResolvedValue({ users: [], total: 0, page: 1, pageSize: 25 });

    renderAt("/admin/users");
    await screen.findByText("No users yet");

    fireEvent.change(screen.getByLabelText("Search users by name or email"), { target: { value: "jane" } });

    // Past SEARCH_DEBOUNCE_MS (300ms).
    await new Promise((r) => setTimeout(r, 400));

    await waitFor(() => {
      expect(fetchAdminUsers).toHaveBeenLastCalledWith(
        expect.objectContaining({ q: "jane" }),
        expect.anything(),
      );
    });
  });

  it("clears the search box via its own inline clear button and refocuses it", async () => {
    vi.mocked(fetchAdminUsers).mockResolvedValue({ users: [], total: 0, page: 1, pageSize: 25 });

    renderAt("/admin/users");
    await screen.findByText("No users yet");

    const searchInput = screen.getByLabelText("Search users by name or email") as HTMLInputElement;
    fireEvent.change(searchInput, { target: { value: "jane" } });
    expect(searchInput.value).toBe("jane");

    fireEvent.click(screen.getByRole("button", { name: "Clear search" }));

    expect(searchInput.value).toBe("");
    expect(document.activeElement).toBe(searchInput);
  });

  it("does not reset to page 1 when the debounce timer fires with an unchanged search value while paginated", async () => {
    vi.mocked(fetchAdminUsers).mockResolvedValue({
      users: [makeUser("user-1", "Jane Doe")],
      // > PAGE_SIZE (25) so a second page exists to navigate to.
      total: 30,
      page: 1,
      pageSize: 25,
    });

    // Fake timers under full manual control (no shouldAdvanceTime) so the mount-scheduled
    // debounce timer cannot fire until explicitly advanced below. With a real (or
    // auto-advancing) clock, a slow/contended test worker could let this test's own initial
    // `waitFor`/`findByText` eat past SEARCH_DEBOUNCE_MS, so the timer fires while page is
    // still 1 (harmless) and *before* the Next click below - the pre-fix code would then pass
    // this test too, a false negative (bot review finding on #675).
    vi.useFakeTimers();
    try {
      renderAt("/admin/users");
      await act(async () => {
        await vi.advanceTimersByTimeAsync(0);
      });
      // Rendered once for the desktop table row and once for the mobile card (CSS-only switch).
      expect(screen.getAllByText("Jane Doe").length).toBeGreaterThan(0);
      expect(fetchAdminUsers).toHaveBeenCalledTimes(1);

      // Paginate away from page 1 - still before the mount-scheduled debounce timer has been
      // allowed to fire, since the search box was never touched (starts and stays empty).
      fireEvent.click(screen.getByRole("button", { name: "Next" }));
      await act(async () => {
        await vi.advanceTimersByTimeAsync(0);
      });
      expect(fetchAdminUsers).toHaveBeenCalledTimes(2);
      expect(fetchAdminUsers).toHaveBeenLastCalledWith(
        expect.objectContaining({ page: 2 }),
        expect.anything(),
      );
      expect(screen.getByText("Page 2 of 2")).toBeTruthy();

      // Only now let the mount-scheduled timer (SEARCH_DEBOUNCE_MS = 300) actually fire,
      // deterministically after pagination - this is what exercises the regression. The
      // buggy version calls setPage(1) unconditionally here (the debounced value never
      // actually changed), triggering an unplanned 3rd fetch for page 1 and silently
      // snapping the operator back to it.
      await act(async () => {
        await vi.advanceTimersByTimeAsync(400);
      });

      expect(fetchAdminUsers).toHaveBeenCalledTimes(2);
      expect(screen.getByText("Page 2 of 2")).toBeTruthy();
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("UsersPage Filters panel", () => {
  it("filters by role from the Filters panel, with Role and Status stacked in the same panel", async () => {
    vi.mocked(fetchAdminUsers).mockResolvedValue({ users: [], total: 0, page: 1, pageSize: 25 });

    renderAt("/admin/users");
    await screen.findByText("No users yet");

    fireEvent.click(screen.getByRole("button", { name: /Filters/ }));
    const roleTrigger = screen.getByRole("button", { name: /^Role,/ });
    const statusTrigger = screen.getByRole("button", { name: /^Status,/ });
    const panel = roleTrigger.closest(".users-page-filters-menu__panel");
    expect(panel).toBeTruthy();
    expect(panel).toBe(statusTrigger.closest(".users-page-filters-menu__panel"));
    // Stacked, not side by side - no shared row wrapper grouping the two fields.
    expect(roleTrigger.closest(".users-page-filters-menu__row")).toBeNull();

    fireEvent.click(roleTrigger);
    fireEvent.click(screen.getByRole("button", { name: "Operator" }));

    await waitFor(() => {
      expect(fetchAdminUsers).toHaveBeenLastCalledWith(
        expect.objectContaining({ role: "operator", page: 1 }),
        expect.anything(),
      );
    });

    fireEvent.click(statusTrigger);
    fireEvent.click(screen.getByRole("button", { name: "Disabled" }));

    await waitFor(() => {
      expect(fetchAdminUsers).toHaveBeenLastCalledWith(
        expect.objectContaining({ role: "operator", status: "disabled", page: 1 }),
        expect.anything(),
      );
    });
    // Both filters active at once - the trigger button badge reflects the combined count.
    expect(screen.getByRole("button", { name: /Filters/ }).textContent).toContain("2");
  });
});

describe("UsersPage cross-tab sync", () => {
  it("refreshes the open Edit user modal after a revoke on the Role assignments tab", async () => {
    // Revoking on the Role assignments tab wires onAssignmentsChanged to re-run load() (#440);
    // the open Edit user modal then has to pick up the freshly-fetched `users` array itself -
    // both halves of this only fire when the fetched user object is a genuinely new reference
    // with different roles, not just a rerender.
    const original = makeUser("user-1", "Jane Doe");
    const updated = { ...original, roles: [] };
    vi.mocked(fetchAdminUsers)
      .mockResolvedValueOnce({ users: [original], total: 1, page: 1, pageSize: 25 })
      .mockResolvedValue({ users: [updated], total: 1, page: 1, pageSize: 25 });
    vi.mocked(fetchRoleAssignments).mockResolvedValue({
      assignments: [{
        id: "role-1",
        user_id: "user-1",
        user_email: "user-1@example.com",
        user_display_name: "Jane Doe",
        role: "operator",
        scope_type: "event",
        scope_id: "evt-1",
        is_oidc: false,
        granted_at: "2026-01-01T00:00:00.000Z",
        event: { id: "evt-1", title: "Summer Summit", slug: "summer-summit", organization_id: "org-1" },
        organization: null,
      }],
      total: 1,
      page: 1,
      pageSize: 25,
    });
    vi.mocked(revokeUserRole).mockResolvedValue();
    useAuthMock.mockReturnValue({ assignments: SUPERADMIN_ASSIGNMENTS, user: { id: "current-admin" } });

    renderAt("/admin/users");
    await screen.findAllByText("Jane Doe");

    // Desktop table row and mobile card both render (CSS-only hidden, not conditionally
    // mounted), so this accessible name matches twice - either fires the same setEditUser.
    fireEvent.click(screen.getAllByRole("button", { name: "Edit profile for Jane Doe" })[0]!);
    expect(await screen.findByRole("heading", { name: "Jane Doe" })).toBeTruthy();

    fireEvent.click(screen.getByRole("tab", { name: /Role assignments/ }));
    fireEvent.click((await screen.findAllByRole("button", { name: /Revoke Operator for/ }))[0]!);
    // Both the Edit user modal and the revoke confirmation are open at once here - scope to the
    // confirmation specifically by its own title.
    const dialog = await screen.findByRole("dialog", { name: "Revoke role assignment" });
    fireEvent.click(within(dialog).getByRole("button", { name: "Revoke" }));

    await waitFor(() => {
      expect(fetchAdminUsers).toHaveBeenCalledTimes(2);
    });
    // The still-open Edit modal now reflects the revoke - the Role picker resets to "No role
    // assigned" (it was seeded from the just-revoked Operator role) without the operator having
    // to close and reopen the modal for it to notice.
    await waitFor(() => {
      expect(screen.getByRole("heading", { name: "Jane Doe" })).toBeTruthy();
      expect(screen.getByRole("button", { name: "Role, none selected" })).toBeTruthy();
    });
  });
});
