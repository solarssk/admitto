// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter } from "react-router";
import { ToastProvider } from "@admitto/ui";
import { UsersPage } from "../../src/pages/UsersPage.js";
import { advanceTimers, deferred, makeStaffUser, makeSuperadminAssignment, mockMatchMedia } from "../test-utils.js";
import type { UserListItemDto } from "../../src/api/types.js";
import { LOAD_TIMEOUT_MESSAGE, SLOW_NOTICE_TEXT } from "../../src/utils/loading-timing.js";

const SUPERADMIN_ASSIGNMENTS = [makeSuperadminAssignment()];
vi.mock("../../src/auth/AuthProvider.js", () => ({
  useAuth: () => ({ assignments: SUPERADMIN_ASSIGNMENTS, user: { id: "current-admin" } }),
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
    deleteAdminUser: vi.fn(),
    createAdminUser: vi.fn(),
    patchAdminUser: vi.fn(),
    revokeUserRole: vi.fn(),
  };
});

import {
  createAdminUser,
  deleteAdminUser,
  fetchAdminEvents,
  fetchAdminOrganizations,
  fetchAdminUsers,
  fetchRoleAssignments,
  fetchSecurityAuditLog,
  fetchSessions,
  fetchUserStats,
  patchAdminUser,
  revokeUserRole,
} from "../../src/api/client.js";

const STATS = { total: 3, active: 3, mfa: 0, sso: 0, active_sessions: 0, active_sessions_users: 0, password_users: 3 };

const answer = (users: UserListItemDto[], total = users.length) => ({ users, total, page: 1, pageSize: 25 });

type UsersAnswer = ReturnType<typeof answer>;

beforeEach(() => {
  vi.mocked(fetchRoleAssignments).mockResolvedValue({ assignments: [], total: 0, page: 1, pageSize: 25 });
  vi.mocked(fetchSessions).mockResolvedValue({ sessions: [] });
  vi.mocked(fetchAdminEvents).mockResolvedValue([]);
  vi.mocked(fetchAdminOrganizations).mockResolvedValue([]);
  vi.mocked(fetchSecurityAuditLog).mockResolvedValue({ entries: [], total: 0, page: 1, pageSize: 25 });
  vi.mocked(fetchUserStats).mockResolvedValue(STATS);
  Element.prototype.scrollIntoView = vi.fn();
  mockMatchMedia(true);
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.resetAllMocks();
});

function renderUsers() {
  return render(
    <MemoryRouter initialEntries={["/admin/users"]}>
      <ToastProvider>
        <UsersPage />
      </ToastProvider>
    </MemoryRouter>,
  );
}

const HOLD = "at-loading-hold";
const placeholder = () => screen.queryByLabelText("Loading users");
const search = (value: string) => fireEvent.change(screen.getByLabelText("Search users by name or email"), { target: { value } });

describe("UsersPage first load", () => {
  it("holds the placeholder's room from the first frame, draws it after 200ms, keeps it for 400ms, and says so after 8 seconds", async () => {
    const first = deferred<UsersAnswer>();
    vi.mocked(fetchAdminUsers).mockReturnValue(first.promise);
    vi.useFakeTimers();
    renderUsers();
    await advanceTimers(0);

    expect(placeholder()?.className).toContain(HOLD);
    await advanceTimers(199);
    expect(placeholder()?.className).toContain(HOLD);
    await advanceTimers(1);
    expect(placeholder()?.className).not.toContain(HOLD);
    expect(screen.queryByText(SLOW_NOTICE_TEXT)).toBeNull();

    // Answered 50ms after the placeholder was drawn: it stays until it has been there for 400ms.
    await advanceTimers(50);
    await act(async () => first.resolve(answer([makeStaffUser("user-1", "Jane Doe")])));
    await advanceTimers(0);
    expect(placeholder()).not.toBeNull();
    await advanceTimers(349);
    expect(placeholder()).not.toBeNull();
    await advanceTimers(1);
    expect(placeholder()).toBeNull();
    expect(screen.getAllByText("user-1@example.com").length).toBeGreaterThan(0);
  });

  it("says it is taking longer than usual after 8 seconds", async () => {
    vi.mocked(fetchAdminUsers).mockReturnValue(new Promise(() => {}));
    vi.useFakeTimers();
    renderUsers();
    await advanceTimers(7999);
    expect(screen.queryByText(SLOW_NOTICE_TEXT)).toBeNull();
    await advanceTimers(1);
    expect(placeholder()?.textContent).toContain(SLOW_NOTICE_TEXT);
  });

  it("gives up after 30 seconds with an error and Retry, and a Retry is a first load again with its own 30 seconds", async () => {
    const signals: AbortSignal[] = [];
    vi.mocked(fetchAdminUsers).mockImplementation(
      (_params, signal) =>
        new Promise((_resolve, reject) => {
          if (signal) signals.push(signal);
          signal?.addEventListener("abort", () => reject(new DOMException("The operation was aborted.", "AbortError")));
        }),
    );
    vi.useFakeTimers();
    renderUsers();
    await advanceTimers(29_999);
    expect(screen.queryByText(LOAD_TIMEOUT_MESSAGE)).toBeNull();
    await advanceTimers(1);
    await advanceTimers(0);
    expect(screen.getByText(LOAD_TIMEOUT_MESSAGE)).toBeTruthy();
    expect(signals[0]?.aborted).toBe(true);

    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    await advanceTimers(0);
    // Nothing is on screen, so the placeholder takes the list's place again.
    expect(placeholder()).not.toBeNull();
    expect(screen.queryByText(LOAD_TIMEOUT_MESSAGE)).toBeNull();
    expect(signals).toHaveLength(2);
    await advanceTimers(29_999);
    expect(signals[1]?.aborted).toBe(false);
  });

  it("draws the KPI tiles' placeholders at their place, and shows no false 0 on the tab until the answer is in", async () => {
    const first = deferred<UsersAnswer>();
    vi.mocked(fetchAdminUsers).mockReturnValue(first.promise);
    vi.useFakeTimers();
    renderUsers();
    await advanceTimers(0);

    const tiles = document.querySelector(".users-page__stats");
    expect(tiles?.querySelectorAll(".users-page__stat-card")).toHaveLength(4);
    expect(tiles?.className).toContain(HOLD);
    expect(screen.queryByText("Via identity provider")).toBeNull();
    expect(screen.getByRole("tab", { name: /^Staff users/ }).textContent).toBe("Staff users");

    await advanceTimers(200);
    expect(tiles?.className).not.toContain(HOLD);
    await act(async () => first.resolve(answer([makeStaffUser("user-1", "Jane Doe")], 3)));
    await advanceTimers(1000);
    expect(screen.getByText("Via identity provider")).toBeTruthy();
    expect(document.querySelector(".users-page__stats")?.getAttribute("aria-hidden")).toBeNull();
    expect(screen.getByRole("tab", { name: /^Staff users/ }).textContent).toContain("3");
  });
});

describe("UsersPage refetch", () => {
  it("keeps the rows while a search is on its way: they cannot be used, are dimmed with a bar once it is noticeable, and are replaced by the answer", async () => {
    const second = deferred<UsersAnswer>();
    vi.mocked(fetchAdminUsers)
      .mockResolvedValueOnce(answer([makeStaffUser("user-1", "Jane Doe")]))
      .mockReturnValueOnce(second.promise);
    renderUsers();
    await screen.findAllByText("user-1@example.com");

    search("jane");
    await waitFor(() => expect(fetchAdminUsers).toHaveBeenCalledTimes(2));
    // The rows are still there, blocked at once...
    expect(screen.getAllByText("user-1@example.com").length).toBeGreaterThan(0);
    await waitFor(() => expect(document.querySelectorAll(".refetch-card--busy")).toHaveLength(1));
    fireEvent.click(screen.getAllByRole("button", { name: "Edit profile for Jane Doe" })[0]!);
    expect(screen.queryByRole("dialog")).toBeNull();
    // ...and dimmed, with the bar, once the wait is noticeable.
    await waitFor(() => expect(document.querySelector(".refetch-card--dim")).not.toBeNull());
    expect(await screen.findByLabelText("Refreshing users")).toBeTruthy();

    await act(async () => second.resolve(answer([makeStaffUser("user-2", "Jane Roe")])));
    await waitFor(() => expect(screen.getAllByText("user-2@example.com").length).toBeGreaterThan(0));
    expect(screen.queryByText("user-1@example.com")).toBeNull();
    await waitFor(() => expect(document.querySelectorAll(".refetch-card")).toHaveLength(0));
  });

  it("never lets an older answer replace a newer one when two searches overlap", async () => {
    const older = deferred<UsersAnswer>();
    const newer = deferred<UsersAnswer>();
    vi.mocked(fetchAdminUsers)
      .mockResolvedValueOnce(answer([makeStaffUser("user-1", "Jane Doe")]))
      .mockReturnValueOnce(older.promise)
      .mockReturnValueOnce(newer.promise);
    renderUsers();
    await screen.findAllByText("user-1@example.com");

    search("jan");
    await waitFor(() => expect(fetchAdminUsers).toHaveBeenCalledTimes(2));
    search("jane");
    await waitFor(() => expect(fetchAdminUsers).toHaveBeenCalledTimes(3));

    await act(async () => newer.resolve(answer([makeStaffUser("user-3", "Jane Newest")])));
    await act(async () => older.resolve(answer([makeStaffUser("user-2", "Jan Older")])));
    expect(screen.getAllByText("user-3@example.com").length).toBeGreaterThan(0);
    expect(screen.queryByText("user-2@example.com")).toBeNull();
  });

  it("replaces the list with an error and Retry when a changed search fails, because the rows no longer answer it", async () => {
    vi.mocked(fetchAdminUsers)
      .mockResolvedValueOnce(answer([makeStaffUser("user-1", "Jane Doe")]))
      .mockRejectedValueOnce(new Error("network down"));
    renderUsers();
    await screen.findAllByText("user-1@example.com");

    search("jane");
    expect(await screen.findByRole("button", { name: "Retry" })).toBeTruthy();
    expect(screen.queryByText("user-1@example.com")).toBeNull();
  });

  it("shows the delete when the refresh fails: the person is gone, the rest of the list stays, and a warning with a Retry that works says it may be older", async () => {
    const refresh = deferred<UsersAnswer>();
    vi.mocked(fetchAdminUsers)
      .mockResolvedValueOnce(answer([{ ...makeStaffUser("user-1", "Jane Doe"), display_name: null }, makeStaffUser("user-2", "Joe Roe")], 2))
      .mockReturnValueOnce(refresh.promise)
      .mockResolvedValueOnce(answer([makeStaffUser("user-2", "Joe Roe")], 1));
    vi.mocked(deleteAdminUser).mockResolvedValue(undefined);
    renderUsers();
    await screen.findAllByText("user-1@example.com");

    fireEvent.click(screen.getAllByRole("button", { name: "Edit profile for user-1@example.com" })[0]!);
    fireEvent.click(await screen.findByRole("button", { name: "More actions" }));
    fireEvent.click(screen.getByRole("menuitem", { name: /Delete account/ }));
    const dialog = await screen.findByRole("dialog", { name: "Delete account" });
    fireEvent.change(within(dialog).getByLabelText('Type the email address to confirm: "user-1@example.com"'), {
      target: { value: "user-1@example.com" },
    });
    fireEvent.click(within(dialog).getByRole("button", { name: "Delete" }));
    await waitFor(() => expect(fetchAdminUsers).toHaveBeenCalledTimes(2));

    // The refresh is on its way: the deleted person is already gone, the rest stays, and no placeholder took its place.
    expect(screen.queryByText("user-1@example.com")).toBeNull();
    expect(screen.getAllByText("user-2@example.com").length).toBeGreaterThan(0);
    expect(placeholder()).toBeNull();

    await act(async () => refresh.reject(new Error("network down")));
    expect(await screen.findByText(/Could not refresh this list, so it may show older details/)).toBeTruthy();
    expect(screen.queryByText("user-1@example.com")).toBeNull();
    expect(screen.getAllByText("user-2@example.com").length).toBeGreaterThan(0);
    expect(screen.queryByText(/Could not load users/)).toBeNull();
    expect(screen.getByText(/Check your connection and try again/)).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    await waitFor(() => expect(screen.queryByText(/Could not refresh this list/)).toBeNull());
  });

  it("says nothing false when the delete takes the only person of the last page, before any answer has come in", async () => {
    const page1 = Array.from({ length: 25 }, (_, i) => makeStaffUser(`user-${i + 1}`, `User ${i + 1}`));
    const reloadOfPageTwo = deferred<UsersAnswer>();
    vi.mocked(fetchAdminUsers).mockImplementation(async (params: { page?: number }) => {
      if (params.page === 1) return answer(page1, 26);
      return vi.mocked(fetchAdminUsers).mock.calls.length > 2 ? reloadOfPageTwo.promise : answer([makeStaffUser("user-26", "User 26")], 26);
    });
    vi.mocked(deleteAdminUser).mockResolvedValue(undefined);
    renderUsers();
    await screen.findAllByText("user-1@example.com");
    fireEvent.click(screen.getAllByRole("button", { name: "Next" })[0]!);
    await screen.findAllByText("user-26@example.com");

    fireEvent.click(screen.getAllByRole("button", { name: "Edit profile for User 26" })[0]!);
    fireEvent.click(await screen.findByRole("button", { name: "More actions" }));
    fireEvent.click(screen.getByRole("menuitem", { name: /Delete account/ }));
    const dialog = await screen.findByRole("dialog", { name: "Delete account" });
    fireEvent.change(within(dialog).getByLabelText('Type the email address to confirm: "user-26@example.com"'), {
      target: { value: "user-26@example.com" },
    });
    fireEvent.click(within(dialog).getByRole("button", { name: "Delete" }));

    // Page 2 has lost its only row, and the answer to the refresh is not in: no false "No users match".
    await waitFor(() => expect(placeholder()).not.toBeNull());
    expect(screen.queryByText("No users match your filters")).toBeNull();
    expect(screen.queryByText("No users yet")).toBeNull();
    await act(async () => reloadOfPageTwo.resolve({ users: [], total: 25, page: 2, pageSize: 25 }));
    expect(screen.queryByText("No users match your filters")).toBeNull();
  });

  it("shows a saved change when the refresh after it fails: the row has the new name, and the open modal follows it", async () => {
    vi.mocked(fetchAdminUsers)
      .mockResolvedValueOnce(answer([makeStaffUser("user-1", "Jane Doe")]))
      .mockRejectedValueOnce(new Error("network down"));
    vi.mocked(patchAdminUser).mockResolvedValue({ user: makeStaffUser("user-1", "Jane Renamed") });
    renderUsers();
    await screen.findAllByText("user-1@example.com");

    fireEvent.click(screen.getAllByRole("button", { name: "Edit profile for Jane Doe" })[0]!);
    const dialog = await screen.findByRole("dialog");
    fireEvent.change(within(dialog).getByLabelText(/^Display name/), { target: { value: "Jane Renamed" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Save changes" }));

    expect(await screen.findByText(/Could not refresh this list, so it may show older details/)).toBeTruthy();
    expect(screen.getAllByText("Jane Renamed").length).toBeGreaterThan(0);
    expect(screen.queryByText("Jane Doe")).toBeNull();
  });

  it("takes a revoked role off the person's row too, when the revoke was made on the Role assignments tab and the refresh fails", async () => {
    const withRole = { ...makeStaffUser("user-1", "Jane Doe"), roles: [{ id: "role-9", role: "operator", scope_type: "event", scope_id: "evt-1", is_oidc: false }] };
    vi.mocked(fetchAdminUsers)
      .mockResolvedValueOnce(answer([withRole]))
      .mockRejectedValueOnce(new Error("network down"));
    vi.mocked(fetchRoleAssignments)
      .mockResolvedValueOnce({
        assignments: [
          {
            id: "role-9",
            user_id: "user-1",
            user_email: "user-1@example.com",
            user_display_name: "Jane Doe",
            role: "operator",
            scope_type: "event",
            scope_id: "evt-1",
            is_oidc: false,
            granted_at: "2026-01-01T00:00:00.000Z",
            event: { id: "evt-1", title: "Summer Summit", slug: "summer", organization_id: "org-1" },
            organization: null,
          },
        ],
        total: 1,
        page: 1,
        pageSize: 25,
      })
      .mockResolvedValue({ assignments: [], total: 0, page: 1, pageSize: 25 });
    vi.mocked(revokeUserRole).mockResolvedValue(undefined);
    renderUsers();
    await screen.findAllByText("user-1@example.com");
    expect(screen.getAllByText(/Operator/).length).toBeGreaterThan(0);

    fireEvent.click(screen.getByRole("tab", { name: /Role assignments/ }));
    fireEvent.click((await screen.findAllByRole("button", { name: "Revoke Operator for Jane Doe" }))[0]!);
    fireEvent.click(within(await screen.findByRole("dialog")).getByRole("button", { name: "Revoke" }));
    await waitFor(() => expect(revokeUserRole).toHaveBeenCalledWith("user-1", "role-9"));

    fireEvent.click(screen.getByRole("tab", { name: /Staff users/ }));
    await waitFor(() => expect(screen.getByText(/Could not refresh this list/)).toBeTruthy());
    expect(within(screen.getAllByRole("table")[0]!).queryByText("Operator")).toBeNull();
  });

  it("shows the person that was just invited by refreshing the list, which keeps its rows meanwhile", async () => {
    const refresh = deferred<UsersAnswer>();
    vi.mocked(fetchAdminUsers).mockResolvedValueOnce(answer([])).mockReturnValueOnce(refresh.promise);
    vi.mocked(createAdminUser).mockResolvedValue({ user: makeStaffUser("new-user", "New User") } as Awaited<ReturnType<typeof createAdminUser>>);
    renderUsers();
    fireEvent.click(await screen.findByRole("button", { name: "Invite user" }));

    const dialog = await screen.findByRole("dialog");
    fireEvent.change(within(dialog).getByLabelText("Email address *"), { target: { value: "new-user@example.com" } });
    fireEvent.change(within(dialog).getByLabelText("Temporary password *"), { target: { value: "long-enough-password" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Send" }));

    await waitFor(() => expect(fetchAdminUsers).toHaveBeenCalledTimes(2));
    expect(await screen.findByText("new-user@example.com invited successfully")).toBeTruthy();
    await act(async () => refresh.resolve(answer([makeStaffUser("new-user", "New User")])));
    expect((await screen.findAllByText("new-user@example.com")).length).toBeGreaterThan(0);
  });

  it("steps back to the last page that exists when the one it was on is gone, and says nothing false meanwhile", async () => {
    const page1 = Array.from({ length: 25 }, (_, i) => makeStaffUser(`user-${i + 1}`, `User ${i + 1}`));
    const stepBack = deferred<UsersAnswer>();
    vi.mocked(fetchAdminUsers)
      .mockResolvedValueOnce(answer(page1, 26))
      .mockResolvedValueOnce({ users: [], total: 25, page: 2, pageSize: 25 })
      .mockReturnValueOnce(stepBack.promise);
    renderUsers();
    await screen.findAllByText("user-1@example.com");

    fireEvent.click(screen.getAllByRole("button", { name: "Next" })[0]!);
    await waitFor(() => expect(fetchAdminUsers).toHaveBeenCalledTimes(3));
    expect(vi.mocked(fetchAdminUsers).mock.calls.map((call) => call[0].page)).toEqual([1, 2, 1]);
    // The answer for page 2 has no rows although there are 25 users: that is neither "No users yet" nor "No users
    // match", so the placeholder keeps the room until the page that exists has answered.
    expect(screen.queryByText("No users match your filters")).toBeNull();
    expect(screen.queryByText("No users yet")).toBeNull();
    expect(placeholder()).not.toBeNull();

    await act(async () => stepBack.resolve(answer(page1, 25)));
    expect((await screen.findAllByText("user-1@example.com")).length).toBeGreaterThan(0);
    expect(screen.queryByText("No users match your filters")).toBeNull();
    await waitFor(() => expect(placeholder()).toBeNull());
  });

  it("says so, with a Retry, when the step back to the page that exists fails, instead of waiting for it forever", async () => {
    const page1 = Array.from({ length: 25 }, (_, i) => makeStaffUser(`user-${i + 1}`, `User ${i + 1}`));
    vi.mocked(fetchAdminUsers)
      .mockResolvedValueOnce(answer(page1, 26))
      .mockResolvedValueOnce({ users: [], total: 25, page: 2, pageSize: 25 })
      .mockRejectedValueOnce(new Error("network down"));
    renderUsers();
    await screen.findAllByText("user-1@example.com");

    fireEvent.click(screen.getAllByRole("button", { name: "Next" })[0]!);
    expect(await screen.findByRole("button", { name: "Retry" })).toBeTruthy();
    expect(screen.queryByText("No users match your filters")).toBeNull();
  });
});

describe("UsersPage empty states", () => {
  it("describe the answer on screen, not the search that is still on its way", async () => {
    const second = deferred<UsersAnswer>();
    vi.mocked(fetchAdminUsers).mockResolvedValueOnce(answer([])).mockReturnValueOnce(second.promise);
    renderUsers();
    await screen.findByText("No users yet");

    search("jane");
    await waitFor(() => expect(fetchAdminUsers).toHaveBeenCalledTimes(2));
    // Still the answer to "no filters": an empty organisation, not "no match".
    expect(screen.getByText("No users yet")).toBeTruthy();
    expect(screen.queryByText("No users match your filters")).toBeNull();

    await act(async () => second.resolve(answer([])));
    expect(await screen.findByText("No users match your filters")).toBeTruthy();
  });

  it("offers Invite user from the empty organisation, and Clear filters from a search that found nobody", async () => {
    vi.mocked(fetchAdminUsers).mockResolvedValue(answer([]));
    renderUsers();
    await screen.findByText("No users yet");
    fireEvent.click(screen.getAllByRole("button", { name: "Invite user" })[1]!);
    expect(await screen.findByRole("dialog")).toBeTruthy();
    fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Cancel" }));

    search("nobody");
    fireEvent.click(await screen.findByRole("button", { name: "Clear filters" }));
    expect((screen.getByLabelText("Search users by name or email") as HTMLInputElement).value).toBe("");
    await waitFor(() => expect(vi.mocked(fetchAdminUsers).mock.calls.at(-1)?.[0]).toMatchObject({ q: undefined, role: "all", status: "all" }));
  });

  it("blocks, dims and marks as refreshing the empty state too while a search started from it is on its way", async () => {
    const second = deferred<UsersAnswer>();
    vi.mocked(fetchAdminUsers).mockResolvedValueOnce(answer([])).mockReturnValueOnce(second.promise);
    renderUsers();
    await screen.findByText("No users yet");
    // The page header has an Invite user button too; the empty state's is the second one.
    const inviteInEmptyState = screen.getAllByRole("button", { name: "Invite user" })[1]!;

    search("jane");
    await waitFor(() => expect(document.querySelectorAll(".refetch-card--busy")).toHaveLength(1));
    fireEvent.click(inviteInEmptyState);
    expect(screen.queryByRole("dialog")).toBeNull();
    await waitFor(() => expect(document.querySelector(".refetch-card--dim")).not.toBeNull());
    expect(await screen.findByLabelText("Refreshing users")).toBeTruthy();

    await act(async () => second.resolve(answer([makeStaffUser("user-2", "Jane Roe")])));
    expect((await screen.findAllByText("user-2@example.com")).length).toBeGreaterThan(0);
    await waitFor(() => expect(document.querySelectorAll(".refetch-card")).toHaveLength(0));
  });
});
