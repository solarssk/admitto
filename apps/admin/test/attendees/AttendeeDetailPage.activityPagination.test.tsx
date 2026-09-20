// @vitest-environment jsdom
import { act, cleanup, fireEvent, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter, Route, Routes, useNavigate } from "react-router";
import type { RoleAssignment } from "../../src/api/types.js";
import { AttendeeDetailPage } from "../../src/pages/AttendeeDetailPage.js";
import { makeOrgAdminAssignment, mockMatchMedia, renderWithToast } from "../test-utils.js";

const loadAttendeeDetailData = vi.fn();
const fetchAttendeeDetail = vi.fn();

const ADMIN_ONE: RoleAssignment = makeOrgAdminAssignment();
const outletEvent = {
  id: "evt-1",
  title: "Demo",
  slug: "demo",
  date: "2026-06-01",
  timezone: "Europe/Warsaw",
  location: null,
  attendee_count: 1,
  wallet_enabled: true,
  wallet_apple_enabled: true,
  wallet_google_enabled: true,
  wallet_samsung_enabled: true,
  archived_at: null as string | null,
  organization_id: "org-1",
};

vi.mock("../../src/attendees/attendeeDetailForm.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../src/attendees/attendeeDetailForm.js")>();
  return {
    ...actual,
    loadAttendeeDetailData: (...args: unknown[]) => loadAttendeeDetailData(...args),
  };
});

vi.mock("../../src/auth/AuthProvider.js", () => ({
  useAuth: () => ({ assignments: [ADMIN_ONE], user: { id: "user-admin-1" } }),
}));

vi.mock("react-router", async (importOriginal) => {
  const actual = await importOriginal<typeof import("react-router")>();
  return { ...actual, useOutletContext: () => ({ event: outletEvent }) };
});

vi.mock("../../src/api/client.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../src/api/client.js")>();
  return {
    ...actual,
    fetchAttendeeDetail: (...args: unknown[]) => fetchAttendeeDetail(...args),
  };
});

function logEntry(n: number) {
  return {
    id: `log-${n}`,
    action_type: "ticket_link_retrieved",
    actor_display: "Ola Nowak",
    metadata: null,
    created_at: "2026-06-01T09:00:00.000Z",
    client_timezone: null,
  };
}

function detailWithLog(page: number, entries: number[], total = 30) {
  return {
    id: "att-1",
    name: "Anna",
    email: "anna@example.com",
    company: null,
    department: null,
    ticket_type: "vip",
    custom_data: {},
    status: "registered" as const,
    admitted_at: null,
    updated_at: "2026-01-01T00:00:00.000Z",
    check_in_status: "not_admitted" as const,
    last_mail_status: null,
    rsvp_status: "confirmed" as const,
    rsvp_updated_at: null,
    rsvp_source: null,
    deliveries: [],
    action_log: entries.map(logEntry),
    action_log_total: total,
    action_log_page: page,
    action_log_page_size: 25,
    action_log_first_action_type: "attendees_imported",
    action_log_snapshot: "2026-06-01T09:00:00.000Z|log-3",
    event_items: [],
    notes: [],
    notes_total: 0,
    notes_page: 1,
    notes_page_size: 50,
  };
}

function SwitchAttendee() {
  const navigate = useNavigate();
  return (
    <>
      <button type="button" onClick={() => navigate("/admin/events/evt-2/attendees/att-2")}>
        Switch attendee
      </button>
      <button type="button" onClick={() => navigate("/admin/events/evt-3/attendees/att-3")}>
        Switch again
      </button>
    </>
  );
}

function renderPage() {
  renderWithToast(
    <MemoryRouter initialEntries={["/admin/events/evt-1/attendees/att-1"]}>
      <Routes>
        <Route
          path="/admin/events/:eventId/attendees/:attendeeId"
          element={
            <>
              <SwitchAttendee />
              <AttendeeDetailPage />
            </>
          }
        />
      </Routes>
    </MemoryRouter>,
  );
}

function makeNote(body: string) {
  return {
    id: `note-${body}`,
    body,
    author_display: "Ola Nowak",
    author_user_id: "user-admin-1",
    author_role: "admin",
    created_at: "2026-06-01T09:00:00.000Z",
  };
}

/** A detail with 51 notes (so the Notes tab paginates too) and the given activity page. */
function detailWithNotes(noteBody: string, notesPage: number, entries: number[]) {
  return {
    ...detailWithLog(1, entries),
    notes: [makeNote(noteBody)],
    notes_total: 51,
    notes_page: notesPage,
  };
}

async function chooseRowsPerPage(size: string) {
  fireEvent.click(screen.getByRole("button", { name: /^Rows per page,/ }));
  fireEvent.click(screen.getByRole("button", { name: size }));
}

async function openActivityTab() {
  fireEvent.click(await screen.findByRole("tab", { name: /Activity log/ }));
}

beforeEach(() => {
  mockMatchMedia(true);
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  // clearAllMocks keeps queued mockResolvedValueOnce values, which would leak into the next test.
  loadAttendeeDetailData.mockReset();
  fetchAttendeeDetail.mockReset();
});

describe("AttendeeDetailPage - Activity log pagination", () => {
  it("shows the row summary but keeps Previous and Next disabled when everything fits on one page", async () => {
    loadAttendeeDetailData.mockResolvedValueOnce({
      detail: detailWithLog(1, [1, 2, 3], 3),
      attributeFields: [],
      itemsWarning: null,
    });
    renderPage();
    await screen.findByRole("heading", { name: "Anna" });
    await openActivityTab();

    expect(screen.getByText("Showing 1–3 of 3")).toBeTruthy();
    expect((screen.getByRole("button", { name: "Previous" }) as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByRole("button", { name: "Next" }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("pages through the log, requesting only the activity page from the server", async () => {
    loadAttendeeDetailData.mockResolvedValueOnce({
      detail: detailWithLog(1, [1, 2, 3]),
      attributeFields: [],
      itemsWarning: null,
    });
    fetchAttendeeDetail.mockResolvedValueOnce(detailWithLog(2, [26, 27]));
    renderPage();
    await screen.findByRole("heading", { name: "Anna" });
    await openActivityTab();

    expect(screen.getByText("Page 1 of 2")).toBeTruthy();
    expect((screen.getByRole("button", { name: "Previous" }) as HTMLButtonElement).disabled).toBe(true);

    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    await waitFor(() => expect(screen.getByText("Page 2 of 2")).toBeTruthy());
    expect(fetchAttendeeDetail).toHaveBeenCalledWith(
      "evt-1",
      "att-1",
      undefined,
      1,
      2,
      25,
      "2026-06-01T09:00:00.000Z|log-3",
    );
    expect(screen.getAllByText("Ticket link copied")).toHaveLength(2);
    expect((screen.getByRole("button", { name: "Next" }) as HTMLButtonElement).disabled).toBe(true);
    // Flipping a page never reloads the whole detail (that would reset the profile form).
    expect(loadAttendeeDetailData).toHaveBeenCalledTimes(1);

    fetchAttendeeDetail.mockResolvedValueOnce(detailWithLog(1, [1, 2, 3]));
    fireEvent.click(screen.getByRole("button", { name: "Previous" }));
    await waitFor(() => expect(screen.getByText("Page 1 of 2")).toBeTruthy());
    expect(fetchAttendeeDetail).toHaveBeenLastCalledWith("evt-1", "att-1", undefined, 1, 1, 25, undefined);
  });

  it("refetches from page 1 with the chosen rows per page", async () => {
    loadAttendeeDetailData.mockResolvedValueOnce({
      detail: detailWithLog(1, [1, 2, 3]),
      attributeFields: [],
      itemsWarning: null,
    });
    fetchAttendeeDetail.mockResolvedValueOnce({
      ...detailWithLog(1, [1, 2, 3, 4], 30),
      action_log_page_size: 50,
    });
    renderPage();
    await screen.findByRole("heading", { name: "Anna" });
    await openActivityTab();

    fireEvent.click(screen.getByRole("button", { name: /^Rows per page,/ }));
    fireEvent.click(screen.getByRole("button", { name: "50" }));

    await waitFor(() =>
      expect(fetchAttendeeDetail).toHaveBeenCalledWith("evt-1", "att-1", undefined, 1, 1, 50, undefined),
    );
    await waitFor(() => expect(screen.getByText("Showing 1–30 of 30")).toBeTruthy());
    expect(screen.getByText("Page 1 of 1")).toBeTruthy();
    expect(loadAttendeeDetailData).toHaveBeenCalledTimes(1);
  });

  it("keeps the current page and tells the operator when a page fails to load", async () => {
    loadAttendeeDetailData.mockResolvedValueOnce({
      detail: detailWithLog(1, [1, 2, 3]),
      attributeFields: [],
      itemsWarning: null,
    });
    fetchAttendeeDetail.mockRejectedValueOnce(new Error("boom"));
    renderPage();
    await screen.findByRole("heading", { name: "Anna" });
    await openActivityTab();

    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    expect(await screen.findByText("Could not load activity.")).toBeTruthy();
    expect(screen.getByText("Page 1 of 2")).toBeTruthy();
    expect((screen.getByRole("button", { name: "Next" }) as HTMLButtonElement).disabled).toBe(false);
  });

  it("still derives the source from the oldest entry even when it is not on this page", async () => {
    loadAttendeeDetailData.mockResolvedValueOnce({
      detail: detailWithLog(1, [1, 2, 3]),
      attributeFields: [],
      itemsWarning: null,
    });
    renderPage();
    await screen.findByRole("heading", { name: "Anna" });

    expect(screen.getByText("CSV/XLSX import")).toBeTruthy();
  });

  it("ignores a page that finishes loading after switching to another attendee", async () => {
    loadAttendeeDetailData.mockResolvedValueOnce({
      detail: detailWithLog(1, [1, 2, 3]),
      attributeFields: [],
      itemsWarning: null,
    });
    let resolvePage!: (value: ReturnType<typeof detailWithLog>) => void;
    fetchAttendeeDetail.mockReturnValueOnce(new Promise((resolve) => { resolvePage = resolve; }));
    loadAttendeeDetailData.mockResolvedValueOnce({
      detail: { ...detailWithLog(1, [9], 1), id: "att-2", name: "Bea" },
      attributeFields: [],
      itemsWarning: null,
    });
    renderPage();
    await screen.findByRole("heading", { name: "Anna" });
    await openActivityTab();

    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    fireEvent.click(screen.getByRole("button", { name: "Switch attendee" }));
    await screen.findByRole("heading", { name: "Bea" });
    resolvePage(detailWithLog(2, [26, 27]));
    await Promise.resolve();

    expect(screen.queryByText("Page 2 of 2")).toBeNull();
    expect(screen.getByRole("heading", { name: "Bea" })).toBeTruthy();
  });

  it("stays silent when a page fails after switching to another attendee", async () => {
    loadAttendeeDetailData.mockResolvedValueOnce({
      detail: detailWithLog(1, [1, 2, 3]),
      attributeFields: [],
      itemsWarning: null,
    });
    let rejectPage!: (reason: Error) => void;
    fetchAttendeeDetail.mockReturnValueOnce(new Promise((_, reject) => { rejectPage = reject; }));
    loadAttendeeDetailData.mockResolvedValueOnce({
      detail: { ...detailWithLog(1, [9], 1), id: "att-2", name: "Bea" },
      attributeFields: [],
      itemsWarning: null,
    });
    renderPage();
    await screen.findByRole("heading", { name: "Anna" });
    await openActivityTab();

    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    fireEvent.click(screen.getByRole("button", { name: "Switch attendee" }));
    await screen.findByRole("heading", { name: "Bea" });
    rejectPage(new Error("boom"));
    await Promise.resolve();

    expect(screen.queryByText("Could not load activity.")).toBeNull();
  });

  it("keeps the chosen rows per page when another flow replaces the whole detail", async () => {
    loadAttendeeDetailData.mockResolvedValueOnce({
      detail: detailWithNotes("First page note", 1, [1, 2, 3]),
      attributeFields: [],
      itemsWarning: null,
    });
    fetchAttendeeDetail.mockResolvedValueOnce({ ...detailWithLog(1, [1, 2, 3, 4], 30), action_log_page_size: 50 });
    // Notes pagination reloads the whole detail, which comes back at the server's default size.
    loadAttendeeDetailData.mockResolvedValueOnce({
      detail: detailWithNotes("Second page note", 2, [1, 2, 3]),
      attributeFields: [],
      itemsWarning: null,
    });
    fetchAttendeeDetail.mockResolvedValueOnce({ ...detailWithLog(1, [1, 2, 3, 4], 30), action_log_page_size: 50 });
    renderPage();
    await screen.findByRole("heading", { name: "Anna" });
    await openActivityTab();
    await chooseRowsPerPage("50");
    await waitFor(() => expect(fetchAttendeeDetail).toHaveBeenCalledTimes(1));

    fireEvent.click(screen.getByRole("tab", { name: /Notes/ }));
    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    await screen.findByText("Second page note");
    await waitFor(() => expect(fetchAttendeeDetail).toHaveBeenCalledTimes(2));
    expect(fetchAttendeeDetail).toHaveBeenLastCalledWith("evt-1", "att-1", undefined, 1, 1, 50, undefined);

    await openActivityTab();
    expect(await screen.findByRole("button", { name: "Rows per page, 50" })).toBeTruthy();
  });

  it("applies only the newest activity request when an older one resolves later", async () => {
    loadAttendeeDetailData.mockResolvedValueOnce({
      detail: detailWithLog(1, [1, 2, 3]),
      attributeFields: [],
      itemsWarning: null,
    });
    let resolveOlder!: (value: ReturnType<typeof detailWithLog>) => void;
    fetchAttendeeDetail.mockReturnValueOnce(new Promise((resolve) => { resolveOlder = resolve; }));
    fetchAttendeeDetail.mockResolvedValueOnce({ ...detailWithLog(1, [1, 2, 3, 4], 30), action_log_page_size: 50 });
    renderPage();
    await screen.findByRole("heading", { name: "Anna" });
    await openActivityTab();

    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    await chooseRowsPerPage("50");
    await waitFor(() => expect(screen.getByText("Showing 1–30 of 30")).toBeTruthy());

    await act(async () => {
      resolveOlder(detailWithLog(2, [26, 27]));
    });

    expect(screen.getByText("Showing 1–30 of 30")).toBeTruthy();
    expect(screen.getByText("Page 1 of 1")).toBeTruthy();
  });

  it("drops a pending activity page when another flow replaces the detail first", async () => {
    loadAttendeeDetailData.mockResolvedValueOnce({
      detail: detailWithNotes("First page note", 1, [1, 2, 3]),
      attributeFields: [],
      itemsWarning: null,
    });
    let resolvePending!: (value: ReturnType<typeof detailWithLog>) => void;
    fetchAttendeeDetail.mockReturnValueOnce(new Promise((resolve) => { resolvePending = resolve; }));
    loadAttendeeDetailData.mockResolvedValueOnce({
      detail: detailWithNotes("Second page note", 2, [1, 2, 3]),
      attributeFields: [],
      itemsWarning: null,
    });
    renderPage();
    await screen.findByRole("heading", { name: "Anna" });
    await openActivityTab();

    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    fireEvent.click(screen.getByRole("tab", { name: /Notes/ }));
    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    await screen.findByText("Second page note");

    await act(async () => {
      resolvePending(detailWithLog(2, [26, 27]));
    });

    await openActivityTab();
    expect(await screen.findByText("Page 1 of 2")).toBeTruthy();
  });

  it("falls back to the shown page size when a new one fails to load, so choosing it again retries", async () => {
    loadAttendeeDetailData.mockResolvedValueOnce({
      detail: detailWithLog(1, [1, 2, 3]),
      attributeFields: [],
      itemsWarning: null,
    });
    fetchAttendeeDetail.mockRejectedValueOnce(new Error("boom"));
    fetchAttendeeDetail.mockResolvedValueOnce({ ...detailWithLog(1, [1, 2, 3, 4], 30), action_log_page_size: 50 });
    renderPage();
    await screen.findByRole("heading", { name: "Anna" });
    await openActivityTab();

    await chooseRowsPerPage("50");
    expect(await screen.findByText("Could not load activity.")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Rows per page, 25" })).toBeTruthy();

    await chooseRowsPerPage("50");
    await waitFor(() => expect(screen.getByText("Showing 1–30 of 30")).toBeTruthy());
    expect(fetchAttendeeDetail).toHaveBeenCalledTimes(2);
  });

  it("drops a pending page even when the replacing detail lands in the same React batch", async () => {
    loadAttendeeDetailData.mockResolvedValueOnce({
      detail: detailWithNotes("First page note", 1, [1, 2, 3]),
      attributeFields: [],
      itemsWarning: null,
    });
    let resolvePending!: (value: ReturnType<typeof detailWithLog>) => void;
    fetchAttendeeDetail.mockReturnValueOnce(new Promise((resolve) => { resolvePending = resolve; }));
    let resolveReload!: (value: unknown) => void;
    loadAttendeeDetailData.mockReturnValueOnce(new Promise((resolve) => { resolveReload = resolve; }));
    renderPage();
    await screen.findByRole("heading", { name: "Anna" });
    await openActivityTab();

    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    fireEvent.click(screen.getByRole("tab", { name: /Notes/ }));
    fireEvent.click(screen.getByRole("button", { name: "Next" }));

    // Both settle in one act(), so no passive effect can run between them.
    await act(async () => {
      resolveReload({
        detail: detailWithNotes("Second page note", 2, [7, 8, 9]),
        attributeFields: [],
        itemsWarning: null,
      });
      resolvePending(detailWithLog(2, [26, 27]));
    });

    await openActivityTab();
    expect(await screen.findByText("Page 1 of 2")).toBeTruthy();
  });

  it("re-applies the chosen page size after every attendee, even when a correction was dropped", async () => {
    loadAttendeeDetailData.mockResolvedValueOnce({
      detail: detailWithLog(1, [1, 2, 3]),
      attributeFields: [],
      itemsWarning: null,
    });
    fetchAttendeeDetail.mockResolvedValueOnce({ ...detailWithLog(1, [1, 2, 3, 4], 30), action_log_page_size: 50 });
    // The second attendee's correction never settles before the operator moves on to a third.
    fetchAttendeeDetail.mockReturnValueOnce(new Promise(() => {}));
    fetchAttendeeDetail.mockResolvedValueOnce({ ...detailWithLog(1, [1, 2, 3, 4], 30), action_log_page_size: 50 });
    loadAttendeeDetailData.mockResolvedValueOnce({
      detail: { ...detailWithLog(1, [5, 6], 30), id: "att-2", name: "Bea" },
      attributeFields: [],
      itemsWarning: null,
    });
    loadAttendeeDetailData.mockResolvedValueOnce({
      detail: { ...detailWithLog(1, [7, 8], 30), id: "att-3", name: "Cy" },
      attributeFields: [],
      itemsWarning: null,
    });
    renderPage();
    await screen.findByRole("heading", { name: "Anna" });
    await openActivityTab();
    await chooseRowsPerPage("50");
    await waitFor(() => expect(fetchAttendeeDetail).toHaveBeenCalledTimes(1));

    fireEvent.click(screen.getByRole("button", { name: "Switch attendee" }));
    await screen.findByRole("heading", { name: "Bea" });
    await waitFor(() => expect(fetchAttendeeDetail).toHaveBeenCalledTimes(2));

    fireEvent.click(screen.getByRole("button", { name: "Switch again" }));
    await screen.findByRole("heading", { name: "Cy" });
    await waitFor(() => expect(fetchAttendeeDetail).toHaveBeenCalledTimes(3));
    expect(fetchAttendeeDetail).toHaveBeenLastCalledWith("evt-3", "att-3", undefined, 1, 1, 50, undefined);
  });

  it("follows the size the server actually returns instead of refetching in a loop", async () => {
    loadAttendeeDetailData.mockResolvedValueOnce({
      detail: detailWithLog(1, [1, 2, 3]),
      attributeFields: [],
      itemsWarning: null,
    });
    // An older backend ignores activity_page_size and keeps answering with 25.
    fetchAttendeeDetail.mockResolvedValue(detailWithLog(1, [1, 2, 3]));
    renderPage();
    await screen.findByRole("heading", { name: "Anna" });
    await openActivityTab();

    await chooseRowsPerPage("50");
    expect(await screen.findByRole("button", { name: "Rows per page, 25" })).toBeTruthy();
    await act(async () => {});
    expect(fetchAttendeeDetail).toHaveBeenCalledTimes(1);
  });

  it("pages against the snapshot from page 1, and goes live again on returning to page 1", async () => {
    loadAttendeeDetailData.mockResolvedValueOnce({
      detail: { ...detailWithLog(1, [1, 2, 3], 60), action_log_snapshot: "snap-first" },
      attributeFields: [],
      itemsWarning: null,
    });
    fetchAttendeeDetail.mockResolvedValueOnce({ ...detailWithLog(2, [26], 60), action_log_snapshot: "snap-first" });
    fetchAttendeeDetail.mockResolvedValueOnce({ ...detailWithLog(3, [51], 60), action_log_snapshot: "snap-first" });
    fetchAttendeeDetail.mockResolvedValueOnce({ ...detailWithLog(2, [26], 60), action_log_snapshot: "snap-first" });
    fetchAttendeeDetail.mockResolvedValueOnce({ ...detailWithLog(1, [1, 2], 61), action_log_snapshot: "snap-fresh" });
    renderPage();
    await screen.findByRole("heading", { name: "Anna" });
    await openActivityTab();

    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    await waitFor(() => expect(screen.getByText("Page 2 of 3")).toBeTruthy());
    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    await waitFor(() => expect(screen.getByText("Page 3 of 3")).toBeTruthy());
    fireEvent.click(screen.getByRole("button", { name: "Previous" }));
    await waitFor(() => expect(screen.getByText("Page 2 of 3")).toBeTruthy());
    expect(fetchAttendeeDetail).toHaveBeenNthCalledWith(1, "evt-1", "att-1", undefined, 1, 2, 25, "snap-first");
    expect(fetchAttendeeDetail).toHaveBeenNthCalledWith(2, "evt-1", "att-1", undefined, 1, 3, 25, "snap-first");
    expect(fetchAttendeeDetail).toHaveBeenNthCalledWith(3, "evt-1", "att-1", undefined, 1, 2, 25, "snap-first");

    // Page 1 is always the live log: no snapshot is sent, and the fresh one replaces the old.
    fireEvent.click(screen.getByRole("button", { name: "Previous" }));
    await waitFor(() => expect(screen.getByText("Page 1 of 3")).toBeTruthy());
    expect(fetchAttendeeDetail).toHaveBeenNthCalledWith(4, "evt-1", "att-1", undefined, 1, 1, 25, undefined);
    expect(screen.getByText("Showing 1–25 of 61")).toBeTruthy();
  });

  it("ignores a failure from a page request that another flow already superseded", async () => {
    loadAttendeeDetailData.mockResolvedValueOnce({
      detail: detailWithNotes("First page note", 1, [1, 2, 3]),
      attributeFields: [],
      itemsWarning: null,
    });
    let rejectPending!: (reason: Error) => void;
    fetchAttendeeDetail.mockReturnValueOnce(new Promise((_, reject) => { rejectPending = reject; }));
    loadAttendeeDetailData.mockResolvedValueOnce({
      detail: detailWithNotes("Second page note", 2, [1, 2, 3]),
      attributeFields: [],
      itemsWarning: null,
    });
    renderPage();
    await screen.findByRole("heading", { name: "Anna" });
    await openActivityTab();
    fireEvent.click(screen.getByRole("button", { name: "Next" }));

    fireEvent.click(screen.getByRole("tab", { name: /Notes/ }));
    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    await screen.findByText("Second page note");

    await act(async () => {
      rejectPending(new Error("boom"));
    });

    expect(screen.queryByText("Could not load activity.")).toBeNull();
  });
});
