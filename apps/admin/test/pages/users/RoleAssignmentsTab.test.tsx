// @vitest-environment jsdom
import { act, cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { RoleAssignmentsTab } from "../../../src/pages/users/RoleAssignmentsTab.js";
import { formatUtcDateTime } from "../../../src/utils/event-dates.js";
import { advanceTimers, deferred, renderWithToast } from "../../test-utils.js";

const fetchRoleAssignments = vi.fn();
const fetchAdminEvents = vi.fn();
const revokeUserRole = vi.fn();
const useAuthMock = vi.fn(() => ({
  assignments: [] as Array<{ role: string; scope_type: string; scope_id?: string | null }>,
  user: { id: "current-admin" },
}));

vi.mock("../../../src/api/client.js", () => ({
  // operatorApiErrorMessage tells an ApiError from any other failure.
  ApiError: class ApiError extends Error {
    constructor(
      readonly status: number,
      message: string,
    ) {
      super(message);
    }
  },
  fetchRoleAssignments: (...args: unknown[]) => fetchRoleAssignments(...args),
  fetchAdminEvents: (...args: unknown[]) => fetchAdminEvents(...args),
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
  fetchAdminEvents.mockResolvedValue([]);
});
fetchAdminEvents.mockResolvedValue([]);

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
    vi.useFakeTimers();
    try {
      renderWithToast(<RoleAssignmentsTab />);
      await act(async () => {
        await vi.advanceTimersByTimeAsync(0);
      });
      expect(fetchRoleAssignments).toHaveBeenCalledOnce();

      fireEvent.change(screen.getByLabelText("Search role assignments by user name or email"), {
        target: { value: "jane" },
      });
      await act(async () => {
        await vi.advanceTimersByTimeAsync(400);
      });

      expect(fetchRoleAssignments).toHaveBeenLastCalledWith(
        expect.objectContaining({ q: "jane", page: 1 }),
        expect.anything(),
      );
    } finally {
      vi.useRealTimers();
    }
  });

  it("clears the search box via its own inline clear button and refocuses it", async () => {
    fetchRoleAssignments.mockResolvedValue({ assignments: [], total: 0, page: 1, pageSize: 25 });
    renderWithToast(<RoleAssignmentsTab />);
    await waitFor(() => expect(fetchRoleAssignments).toHaveBeenCalledOnce());

    const searchInput = screen.getByLabelText("Search role assignments by user name or email") as HTMLInputElement;
    fireEvent.change(searchInput, { target: { value: "jane" } });
    expect(searchInput.value).toBe("jane");

    fireEvent.click(screen.getByRole("button", { name: "Clear search" }));

    expect(searchInput.value).toBe("");
    expect(document.activeElement).toBe(searchInput);
  });

  it("shows a search-specific empty state with a button that clears the search", async () => {
    fetchRoleAssignments.mockResolvedValue({ assignments: [], total: 0, page: 1, pageSize: 25 });
    vi.useFakeTimers();
    try {
      renderWithToast(<RoleAssignmentsTab />);
      await act(async () => {
        await vi.advanceTimersByTimeAsync(0);
      });
      expect(fetchRoleAssignments).toHaveBeenCalledOnce();

      fireEvent.change(screen.getByLabelText("Search role assignments by user name or email"), {
        target: { value: "nomatch" },
      });
      await act(async () => {
        await vi.advanceTimersByTimeAsync(400);
      });
      expect(fetchRoleAssignments).toHaveBeenLastCalledWith(
        expect.objectContaining({ q: "nomatch", page: 1 }),
        expect.anything(),
      );
      expect(screen.getByText("No role assignments match your filters")).toBeTruthy();

      fireEvent.click(screen.getByRole("button", { name: "Clear filters" }));

      expect(
        (screen.getByLabelText("Search role assignments by user name or email") as HTMLInputElement).value,
      ).toBe("");
    } finally {
      vi.useRealTimers();
    }
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
    // Desktop table row and mobile card both render (CSS-only hidden, not conditionally
    // mounted), so this accessible name now matches twice - either fires the same onRevoke.
    fireEvent.click(screen.getAllByRole("button", { name: "Revoke Administrator for staff@example.com" })[0]!);

    const dialog = await screen.findByRole("dialog");
    expect(dialog.textContent).toContain("Remove Administrator access for staff@example.com");
    expect(dialog.textContent).not.toContain("Remove admin access");
  });

  it("opens the revoke confirmation from the mobile card's own button, for an organization-scoped assignment", async () => {
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
        scope_type: "organization",
        scope_id: "org-1",
        is_oidc: false,
        granted_at: "2026-01-01T00:00:00.000Z",
        event: null,
        organization: { id: "org-1", name: "Acme Events" },
      }],
      total: 1,
      page: 1,
      pageSize: 25,
    });

    renderWithToast(<RoleAssignmentsTab />);

    await screen.findAllByText("staff@example.com");
    expect(screen.getAllByText("Acme Events").length).toBeGreaterThan(0);
    // Desktop table row and mobile card both render (CSS-only hidden, not conditionally
    // mounted) - [0] is exercised by the test above, so this one fires the card's own onClick.
    fireEvent.click(screen.getAllByRole("button", { name: "Revoke Administrator for staff@example.com" })[1]!);

    expect(await screen.findByRole("dialog")).toBeTruthy();
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

  it("populates the event filter and refetches with the selected eventId", async () => {
    fetchAdminEvents.mockResolvedValue([
      { id: "evt-1", title: "Kickoff" },
      { id: "evt-2", title: "Retro", archived_at: "2026-01-01T00:00:00.000Z" },
    ]);
    fetchRoleAssignments.mockResolvedValue({ assignments: [], total: 0, page: 1, pageSize: 25 });
    renderWithToast(<RoleAssignmentsTab />);
    await waitFor(() => expect(fetchRoleAssignments).toHaveBeenCalledOnce());

    fireEvent.click(screen.getByRole("button", { name: /Filters/ }));
    fireEvent.click(await screen.findByRole("button", { name: /^Event,/ }));
    await screen.findByRole("button", { name: "Retro (archived)" });
    fireEvent.click(screen.getByRole("button", { name: "Kickoff" }));

    await waitFor(() => {
      expect(fetchRoleAssignments).toHaveBeenLastCalledWith(
        expect.objectContaining({ eventId: "evt-1", page: 1 }),
        expect.anything(),
      );
    });
  });

  it("shows the grant time in UTC with an explanatory tooltip on the column header", async () => {
    const grantedAt = "2026-01-01T12:00:00.000Z";
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
        granted_at: grantedAt,
        event: { id: "evt-1", title: "Kickoff", slug: "kickoff", organization_id: "org-1" },
        organization: null,
      }],
      total: 1,
      page: 1,
      pageSize: 25,
    });

    renderWithToast(<RoleAssignmentsTab />);

    const table = await screen.findByRole("table");
    expect(within(table).getByText(formatUtcDateTime(grantedAt))).toBeTruthy();

    const headerTrigger = within(table).getByText("Granted").closest(".at-tooltip-trigger");
    expect(headerTrigger).toBeTruthy();
    fireEvent.mouseEnter(headerTrigger!);
    expect(await screen.findByRole("tooltip")).toHaveProperty(
      "textContent",
      "Top: when this role was granted, in UTC. Below: the same moment in your own local time.",
    );
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
    // Desktop table row and mobile card both render (CSS-only hidden, not conditionally
    // mounted), so this accessible name now matches twice - either fires the same onRevoke.
    fireEvent.click(screen.getAllByRole("button", { name: "Revoke Operator for staff@example.com" })[0]!);
    const dialog = await screen.findByRole("dialog");
    fireEvent.click(within(dialog).getByRole("button", { name: "Revoke" }));

    await vi.waitFor(() => {
      expect(onAssignmentsChanged).toHaveBeenCalledOnce();
    });
    expect(revokeUserRole).toHaveBeenCalledWith("user-1", "role-1");
  });
});

describe("RoleAssignmentsTab on the loading standard", () => {
  const assignment = (id: string, email: string) => ({
    id,
    user_id: `user-${id}`,
    user_email: email,
    user_display_name: null,
    role: "operator",
    scope_type: "event",
    scope_id: "evt-1",
    is_oidc: false,
    granted_at: "2026-01-01T00:00:00.000Z",
    event: { id: "evt-1", title: "Summer Summit" },
    organization: null,
  });
  const answer = (rows: ReturnType<typeof assignment>[], total = rows.length) => ({ assignments: rows, total, page: 1, pageSize: 25 });
  const asSuperadmin = () => useAuthMock.mockReturnValue({ assignments: [{ role: "superadmin", scope_type: "instance" }], user: { id: "current-admin" } });

  it("holds the placeholder's room from the first frame, draws it after 200ms, keeps it for 400ms, and says so after 8 seconds", async () => {
    const first = deferred<ReturnType<typeof answer>>();
    fetchRoleAssignments.mockReturnValue(first.promise);
    vi.useFakeTimers();
    try {
      renderWithToast(<RoleAssignmentsTab />);
      await advanceTimers(0);
      const region = () => screen.queryByLabelText("Loading role assignments");
      expect(region()?.className).toContain("at-loading-hold");
      await advanceTimers(200);
      expect(region()?.className).not.toContain("at-loading-hold");

      await advanceTimers(7800);
      expect(region()?.textContent).toContain("Taking longer than usual");
      await act(async () => first.resolve(answer([assignment("1", "staff@example.com")])));
      await advanceTimers(400);
      expect(region()).toBeNull();
      expect(screen.getAllByText("staff@example.com").length).toBeGreaterThan(0);
    } finally {
      vi.useRealTimers();
    }
  });

  it("gives up after 30 seconds with an error and Retry", async () => {
    fetchRoleAssignments.mockImplementation(
      (_params: unknown, signal?: AbortSignal) =>
        new Promise((_resolve, reject) => {
          signal?.addEventListener("abort", () => reject(new DOMException("The operation was aborted.", "AbortError")));
        }),
    );
    vi.useFakeTimers();
    try {
      renderWithToast(<RoleAssignmentsTab />);
      await advanceTimers(30_000);
      await advanceTimers(0);
      expect(screen.getByText("The server did not answer in time. Check your connection and try again.")).toBeTruthy();
      expect(screen.getByRole("button", { name: "Retry" })).toBeTruthy();
    } finally {
      vi.useRealTimers();
    }
  });

  it("keeps the rows while the refresh after a revoke is on its way, and ends the dialog's busy state with the revoke, not with the refresh", async () => {
    asSuperadmin();
    const refresh = deferred<ReturnType<typeof answer>>();
    fetchRoleAssignments
      .mockResolvedValueOnce(answer([assignment("1", "one@example.com"), assignment("2", "two@example.com")]))
      .mockReturnValueOnce(refresh.promise);
    revokeUserRole.mockResolvedValue(undefined);
    const onAssignmentsChanged = vi.fn();
    renderWithToast(<RoleAssignmentsTab onAssignmentsChanged={onAssignmentsChanged} />);
    await screen.findAllByText("one@example.com");

    fireEvent.click(screen.getAllByRole("button", { name: "Revoke Operator for one@example.com" })[0]!);
    fireEvent.click(within(await screen.findByRole("dialog")).getByRole("button", { name: "Revoke" }));
    await waitFor(() => expect(onAssignmentsChanged).toHaveBeenCalledOnce());

    // The refresh has not answered: the rows are still there, blocked, and no placeholder took their place.
    expect(screen.getAllByText("two@example.com").length).toBeGreaterThan(0);
    expect(screen.queryByLabelText("Loading role assignments")).toBeNull();
    await waitFor(() => expect(document.querySelectorAll(".refetch-card--busy")).toHaveLength(1));
    // A click on a row is swallowed while it refreshes.
    fireEvent.click(screen.getAllByRole("button", { name: "Revoke Operator for two@example.com" })[0]!);
    expect(screen.queryByRole("dialog")).toBeNull();

    await act(async () => refresh.resolve(answer([assignment("2", "two@example.com")])));
    await waitFor(() => expect(screen.queryByText("one@example.com")).toBeNull());
    await waitFor(() => expect(document.querySelectorAll(".refetch-card")).toHaveLength(0));
    // The next revoke starts with a button that is not busy: the flag ended with the first revoke.
    fireEvent.click(screen.getAllByRole("button", { name: "Revoke Operator for two@example.com" })[0]!);
    const confirm = within(await screen.findByRole("dialog")).getByRole("button", { name: "Revoke" });
    expect(confirm.getAttribute("aria-busy")).toBeNull();
  });

  it("keeps the rows and says so when the refresh after a revoke fails", async () => {
    asSuperadmin();
    fetchRoleAssignments
      .mockResolvedValueOnce(answer([assignment("1", "one@example.com")]))
      .mockRejectedValueOnce(new Error("network down"));
    revokeUserRole.mockResolvedValue(undefined);
    renderWithToast(<RoleAssignmentsTab />);
    await screen.findAllByText("one@example.com");

    fireEvent.click(screen.getAllByRole("button", { name: "Revoke Operator for one@example.com" })[0]!);
    fireEvent.click(within(await screen.findByRole("dialog")).getByRole("button", { name: "Revoke" }));

    expect(await screen.findByText(/Could not refresh this list, so it may show older details/)).toBeTruthy();
    expect(screen.getAllByText("one@example.com").length).toBeGreaterThan(0);
  });

  it("keeps the dialog open, with the reason and a usable button, when the revoke itself fails, and does not refresh a list that did not change", async () => {
    asSuperadmin();
    fetchRoleAssignments.mockResolvedValue(answer([assignment("1", "one@example.com")]));
    revokeUserRole.mockRejectedValueOnce(new Error("boom"));
    const onAssignmentsChanged = vi.fn();
    renderWithToast(<RoleAssignmentsTab onAssignmentsChanged={onAssignmentsChanged} />);
    await screen.findAllByText("one@example.com");

    fireEvent.click(screen.getAllByRole("button", { name: "Revoke Operator for one@example.com" })[0]!);
    const dialog = await screen.findByRole("dialog");
    fireEvent.click(within(dialog).getByRole("button", { name: "Revoke" }));

    expect((await within(dialog).findAllByText("Failed to revoke role.")).length).toBeGreaterThan(0);
    expect(within(dialog).getByRole("button", { name: "Revoke" }).getAttribute("aria-busy")).toBeNull();
    expect(onAssignmentsChanged).not.toHaveBeenCalled();
    expect(fetchRoleAssignments).toHaveBeenCalledOnce();
  });

  it("retries a failed first load from the error, and shows the rows when it works", async () => {
    fetchRoleAssignments.mockRejectedValueOnce(new Error("network down")).mockResolvedValueOnce(answer([assignment("1", "one@example.com")]));
    renderWithToast(<RoleAssignmentsTab />);

    expect(await screen.findByRole("alert")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    expect((await screen.findAllByText("one@example.com")).length).toBeGreaterThan(0);
    expect(screen.queryByRole("button", { name: "Retry" })).toBeNull();
  });

  it("steps back to the last page that exists when a revoke takes the only row of the last page, and says nothing false meanwhile", async () => {
    asSuperadmin();
    fetchRoleAssignments.mockImplementation(async (params: { page: number }) =>
      params.page === 1 ? answer([assignment("1", "first-page@example.com")], 26) : answer([assignment("26", "last-page@example.com")], 26),
    );
    revokeUserRole.mockResolvedValue(undefined);
    renderWithToast(<RoleAssignmentsTab />);
    await screen.findAllByText("first-page@example.com");

    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    await screen.findAllByText("last-page@example.com");
    // The revoke leaves 25 rows: page 2 no longer exists, and asking for it returns nothing. Page 1 is slow.
    const stepBack = deferred<ReturnType<typeof answer>>();
    fetchRoleAssignments.mockImplementation((params: { page: number }) =>
      params.page === 1 ? stepBack.promise : Promise.resolve({ assignments: [], total: 25, page: params.page, pageSize: 25 }),
    );
    fireEvent.click(screen.getAllByRole("button", { name: "Revoke Operator for last-page@example.com" })[0]!);
    fireEvent.click(within(await screen.findByRole("dialog")).getByRole("button", { name: "Revoke" }));

    // No rows, but 25 assignments: neither "No role assignments yet" nor "match your filters", the room is kept.
    await waitFor(() => expect(screen.queryByLabelText("Loading role assignments")).not.toBeNull());
    expect(screen.queryByText("No role assignments yet")).toBeNull();
    expect(screen.queryByText("No role assignments match your filters")).toBeNull();

    await act(async () => stepBack.resolve(answer([assignment("1", "first-page@example.com")], 25)));
    expect((await screen.findAllByText("first-page@example.com")).length).toBeGreaterThan(0);
    expect(screen.getByText(/Page 1 of 1/)).toBeTruthy();
  });

  it("says so, with a Retry, when the step back to the page that exists fails, instead of waiting for it forever", async () => {
    asSuperadmin();
    fetchRoleAssignments.mockImplementation(async (params: { page: number }) =>
      params.page === 1 ? answer([assignment("1", "first-page@example.com")], 26) : answer([assignment("26", "last-page@example.com")], 26),
    );
    revokeUserRole.mockResolvedValue(undefined);
    renderWithToast(<RoleAssignmentsTab />);
    await screen.findAllByText("first-page@example.com");
    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    await screen.findAllByText("last-page@example.com");

    fetchRoleAssignments.mockImplementation(async (params: { page: number }) => {
      if (params.page === 1) throw new Error("network down");
      return { assignments: [], total: 25, page: params.page, pageSize: 25 };
    });
    fireEvent.click(screen.getAllByRole("button", { name: "Revoke Operator for last-page@example.com" })[0]!);
    fireEvent.click(within(await screen.findByRole("dialog")).getByRole("button", { name: "Revoke" }));

    expect(await screen.findByRole("button", { name: "Retry" })).toBeTruthy();
    expect(screen.queryByText("No role assignments yet")).toBeNull();
  });

  it("blocks, dims and marks as refreshing the empty state too while a search started from it is on its way", async () => {
    const second = deferred<ReturnType<typeof answer>>();
    fetchRoleAssignments.mockResolvedValueOnce(answer([])).mockReturnValueOnce(second.promise);
    renderWithToast(<RoleAssignmentsTab />);
    await screen.findByText("No role assignments yet");

    fireEvent.change(screen.getByLabelText("Search role assignments by user name or email"), { target: { value: "jane" } });
    await waitFor(() => expect(document.querySelectorAll(".refetch-card--busy")).toHaveLength(1));
    await waitFor(() => expect(document.querySelector(".refetch-card--dim")).not.toBeNull());
    expect(await screen.findByLabelText("Refreshing role assignments")).toBeTruthy();

    await act(async () => second.resolve(answer([assignment("1", "jane@example.com")])));
    expect((await screen.findAllByText("jane@example.com")).length).toBeGreaterThan(0);
    await waitFor(() => expect(document.querySelectorAll(".refetch-card")).toHaveLength(0));
  });

  it("describes the answer on screen in its empty state, not the search that is still on its way", async () => {
    const second = deferred<ReturnType<typeof answer>>();
    fetchRoleAssignments.mockResolvedValueOnce(answer([])).mockReturnValueOnce(second.promise);
    renderWithToast(<RoleAssignmentsTab />);
    await screen.findByText("No role assignments yet");

    fireEvent.change(screen.getByLabelText("Search role assignments by user name or email"), { target: { value: "jane" } });
    await waitFor(() => expect(fetchRoleAssignments).toHaveBeenCalledTimes(2));
    expect(screen.getByText("No role assignments yet")).toBeTruthy();
    expect(screen.queryByText("No role assignments match your filters")).toBeNull();

    await act(async () => second.resolve(answer([])));
    expect(await screen.findByText("No role assignments match your filters")).toBeTruthy();
  });

  it("gives up on the events for the filter after 30 seconds, in the time limit's own words", async () => {
    fetchRoleAssignments.mockResolvedValue(answer([]));
    fetchAdminEvents.mockImplementation(
      (options?: { signal?: AbortSignal }) =>
        new Promise((_resolve, reject) => {
          options?.signal?.addEventListener("abort", () => reject(new DOMException("The operation was aborted.", "AbortError")));
        }),
    );
    vi.useFakeTimers();
    try {
      renderWithToast(<RoleAssignmentsTab />);
      await advanceTimers(30_000);
      await advanceTimers(0);
      expect(document.querySelector('.sr-only[role="alert"]')?.textContent).toBe(
        "Could not load events. The server did not answer in time. Check your connection and try again.",
      );
    } finally {
      vi.useRealTimers();
    }
  });

  it("says when the events for the filter could not load, with a Retry that reruns only that request", async () => {
    fetchRoleAssignments.mockResolvedValue(answer([]));
    fetchAdminEvents.mockRejectedValueOnce(new Error("network down")).mockResolvedValueOnce([{ id: "evt-1", title: "Kickoff" }]);
    renderWithToast(<RoleAssignmentsTab />);
    await waitFor(() => expect(fetchRoleAssignments).toHaveBeenCalledOnce());

    // Said out loud when it happens, though the hint itself is in the Filters panel that is still closed.
    await waitFor(() => expect(document.querySelector('.sr-only[role="alert"]')?.textContent).toBe("Could not load events."));
    fireEvent.click(screen.getByRole("button", { name: /Filters/ }));
    expect((await screen.findAllByText("Could not load events.")).length).toBeGreaterThan(0);

    const calls = fetchRoleAssignments.mock.calls.length;
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    fireEvent.click(await screen.findByRole("button", { name: /^Event,/ }));
    expect(await screen.findByRole("button", { name: "Kickoff" })).toBeTruthy();
    expect(fetchRoleAssignments.mock.calls).toHaveLength(calls);
    expect(fetchAdminEvents).toHaveBeenCalledTimes(2);
  });
});
