// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter } from "react-router";
import { ToastProvider } from "@admitto/ui";
import { UsersPage } from "../../src/pages/UsersPage.js";
import { mockMatchMedia } from "../test-utils.js";

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
    fetchRoleAssignments: vi.fn(),
    fetchSessions: vi.fn(),
    fetchAdminEvents: vi.fn(),
  };
});

import { fetchAdminEvents, fetchAdminUsers, fetchRoleAssignments, fetchSessions } from "../../src/api/client.js";

beforeEach(() => {
  vi.mocked(fetchAdminUsers).mockResolvedValue({ users: [], total: 0 });
  vi.mocked(fetchRoleAssignments).mockResolvedValue({ assignments: [], total: 0, page: 1, pageSize: 25 });
  vi.mocked(fetchSessions).mockResolvedValue({ sessions: [] });
  vi.mocked(fetchAdminEvents).mockResolvedValue([]);
  // ScrollFadeTabs scrolls the active tab into view on mount/change - jsdom has no real impl.
  Element.prototype.scrollIntoView = vi.fn();
  // ActiveSessionsTab is always mounted (hidden, not unmounted) regardless of which tab is
  // active, so its own useIsDesktop() call always runs - jsdom has no real matchMedia.
  mockMatchMedia(true);
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  // clearAllMocks wipes call history but not a persistent mockReturnValue - reassert the
  // superadmin default so a non-superadmin override set by one test can't leak into the next.
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

describe("UsersPage tab routing — usersTabFromSearch", () => {
  it.each([
    ["/admin/users?tab=sessions", true, "Active sessions"],
    ["/admin/users?tab=sessions", false, "Role assignments"],
    ["/admin/users?tab=staff", true, "Staff users"],
    ["/admin/users?tab=staff", false, "Role assignments"],
    ["/admin/users?tab=roles", true, "Role assignments"],
    ["/admin/users?tab=roles", false, "Role assignments"],
    ["/admin/users", true, "Staff users"],
    ["/admin/users", false, "Role assignments"],
  ])("path %s with superadmin=%s lands on %s", async (path, superadmin, expectedActiveTab) => {
    useAuthMock.mockReturnValue({
      assignments: superadmin ? SUPERADMIN_ASSIGNMENTS : [],
    });

    renderAt(path);

    const activeTab = await screen.findByRole("tab", { selected: true });
    expect(activeTab.textContent).toContain(expectedActiveTab);
  });

  it("clicking a different tab switches the active tab and updates the URL", async () => {
    renderAt("/admin/users");

    await screen.findByRole("tab", { selected: true, name: /Staff users/ });

    fireEvent.click(screen.getByRole("tab", { name: /Role assignments/ }));

    const activeTab = await screen.findByRole("tab", { selected: true });
    expect(activeTab.textContent).toContain("Role assignments");
    expect(screen.queryByRole("tab", { selected: true, name: /Staff users/ })).toBeNull();
  });
});
