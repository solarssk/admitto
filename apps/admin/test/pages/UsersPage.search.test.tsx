// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter } from "react-router";
import { ToastProvider } from "@admitto/ui";
import { UsersPage } from "../../src/pages/UsersPage.js";
import { mockMatchMedia } from "../test-utils.js";
import type { UserListItemDto } from "../../src/api/types.js";

const SUPERADMIN_ASSIGNMENTS = [{ role: "superadmin", scope_type: "instance", scope_id: null }];
const useAuthMock = vi.fn(() => ({ assignments: SUPERADMIN_ASSIGNMENTS as Array<{ role: string; scope_type: string; scope_id: string | null }> }));

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
  };
});

import {
  fetchAdminEvents,
  fetchAdminUsers,
  fetchUserStats,
  fetchRoleAssignments,
  fetchSessions,
} from "../../src/api/client.js";

function makeUser(id: string, displayName: string): UserListItemDto {
  return {
    id,
    email: `${id}@example.com`,
    display_name: displayName,
    is_active: true,
    must_change_password: false,
    created_at: "2026-01-01T00:00:00.000Z",
    last_login_at: null,
    active_sessions_count: 0,
    has_mfa: false,
    roles: [],
  };
}

beforeEach(() => {
  vi.mocked(fetchRoleAssignments).mockResolvedValue({ assignments: [], total: 0, page: 1, pageSize: 25 });
  vi.mocked(fetchSessions).mockResolvedValue({ sessions: [] });
  vi.mocked(fetchAdminEvents).mockResolvedValue([]);
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
  useAuthMock.mockReturnValue({ assignments: SUPERADMIN_ASSIGNMENTS });
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
  });
});
