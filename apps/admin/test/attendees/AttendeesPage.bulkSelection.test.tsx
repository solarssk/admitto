// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createMemoryRouter, MemoryRouter, RouterProvider, Route, Routes } from "react-router-dom";
import { AttendeesPage } from "../../src/pages/AttendeesPage.js";
import { mockMatchMedia } from "../test-utils.js";
import type { AttendeeRowDto } from "../../src/api/types.js";

const fetchEventAttendees = vi.fn();
const fetchEventMailSettings = vi.fn();
const sendEventBulk = vi.fn();
const bulkDeleteAttendees = vi.fn();
const bulkCheckInAttendees = vi.fn();
const bulkChangeTicketType = vi.fn();
const exportSelectedAttendees = vi.fn();
const fetchTicketTypes = vi.fn();
const addToast = vi.fn();
const reportApiError = vi.fn();

function mailSettings(provider: string | null) {
  return {
    eventId: "evt-1",
    organizationId: "org-1",
    isProduction: false,
    hasEventOverride: false,
    fields: { provider: { value: provider, source: "organization", locked: false } },
  };
}

function makeRow(id: string, name: string): AttendeeRowDto {
  return {
    id,
    name,
    email: `${id}@example.com`,
    company: "Acme",
    department: null,
    ticket_type: "VIP",
    status: "registered",
    check_in_status: "not_admitted",
    admitted_at: null,
    updated_at: "2026-06-01T10:00:00.000Z",
    last_mail_status: "sent",
    rsvp_status: "confirmed",
  };
}

const rowA = makeRow("att-1", "Jane Doe");
const rowB = makeRow("att-2", "John Smith");
const rowC = makeRow("att-3", "Alex Kim");

vi.mock("../../src/connection/ConnectionStateProvider.js", () => ({
  useConnectionState: () => ({ reportApiError }),
}));

vi.mock("@admitto/ui", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@admitto/ui")>();
  return {
    ...actual,
    useToast: () => ({ addToast }),
  };
});

vi.mock("../../src/api/client.js", () => ({
  ApiError: class ApiError extends Error {
    status: number;
    code?: string;
    constructor(status: number, message: string, code?: string) {
      super(message);
      this.status = status;
      this.code = code;
    }
  },
  fetchEventAttendees: (...args: unknown[]) => fetchEventAttendees(...args),
  fetchTicketTypes: (...args: unknown[]) => fetchTicketTypes(...args),
  bulkChangeTicketType: (...args: unknown[]) => bulkChangeTicketType(...args),
  fetchEventMailSettings: (...args: unknown[]) => fetchEventMailSettings(...args),
  exportAttendees: vi.fn(),
  exportSelectedAttendees: (...args: unknown[]) => exportSelectedAttendees(...args),
  bulkResendTickets: vi.fn(),
  sendEventBulk: (...args: unknown[]) => sendEventBulk(...args),
  bulkDeleteAttendees: (...args: unknown[]) => bulkDeleteAttendees(...args),
  bulkCheckInAttendees: (...args: unknown[]) => bulkCheckInAttendees(...args),
  updateAttendee: vi.fn(),
}));

vi.mock("react-router-dom", async (importOriginal) => {
  const actual = await importOriginal<typeof import("react-router-dom")>();
  return {
    ...actual,
    useOutletContext: () => ({
      event: {
        id: "evt-1",
        title: "Demo",
        timezone: "UTC",
        date: "2026-07-01",
        location: null,
        attendee_count: 3,
        archived_at: null,
      },
    }),
  };
});

function renderPage() {
  return render(
    <MemoryRouter initialEntries={["/admin/events/evt-1/attendees"]}>
      <Routes>
        <Route path="/admin/events/:eventId/attendees" element={<AttendeesPage />} />
      </Routes>
    </MemoryRouter>,
  );
}

function bulkBar() {
  const bar = document.querySelector(".attendees-bulkbar");
  if (!bar) throw new Error("Bulk bar not found");
  return within(bar as HTMLElement);
}

/** Delete lives behind the bulk bar's "More actions" menu (not a bare button) - open it first.
 * The bulk-delete dialog's confirm button then stays disabled for 10s after opening
 * (ConfirmDialog's confirmDelaySeconds - an "arm before confirming" pause). Fake-timers just
 * the open+arm step, matching EventSettingsPage's own bulk-danger-action tests. */
function openAndArmDeleteDialog() {
  fireEvent.click(bulkBar().getByRole("button", { name: "More actions" }));
  vi.useFakeTimers();
  fireEvent.click(bulkBar().getByRole("menuitem", { name: /^Delete/ }));
  const dialog = screen.getByRole("dialog");
  act(() => {
    vi.advanceTimersByTime(10_000);
  });
  vi.useRealTimers();
  return dialog;
}

beforeEach(() => {
  mockMatchMedia(true);
  fetchEventMailSettings.mockResolvedValue(mailSettings("smtp"));
  fetchTicketTypes.mockResolvedValue([]);
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  vi.unstubAllGlobals();
});

describe("AttendeesPage row selection + bulk bar (#355)", () => {
  it("shows the bulk bar with '1 selected', then '2 selected' as rows are checked", async () => {
    fetchEventAttendees.mockResolvedValue({ items: [rowA, rowB, rowC], total: 3, page: 1, pageSize: 25 });

    renderPage();

    await screen.findByText("Jane Doe");
    expect(document.querySelector(".attendees-bulkbar")).toBeNull();

    fireEvent.click(screen.getByRole("checkbox", { name: "Select Jane Doe" }));
    await waitFor(() => expect(bulkBar().getByText("1")).toBeTruthy());
    expect(bulkBar().getByText("selected")).toBeTruthy();

    fireEvent.click(screen.getByRole("checkbox", { name: "Select John Smith" }));
    await waitFor(() => expect(bulkBar().getByText("2")).toBeTruthy());
  });

  it("selects/deselects all currently-loaded rows via the header checkbox", async () => {
    fetchEventAttendees.mockResolvedValue({ items: [rowA, rowB, rowC], total: 3, page: 1, pageSize: 25 });

    renderPage();

    await screen.findByText("Jane Doe");

    fireEvent.click(screen.getByRole("checkbox", { name: "Select all" }));
    await waitFor(() => expect(bulkBar().getByText("3")).toBeTruthy());
    expect((screen.getByRole("checkbox", { name: "Select Jane Doe" }) as HTMLInputElement).checked).toBe(true);
    expect((screen.getByRole("checkbox", { name: "Select John Smith" }) as HTMLInputElement).checked).toBe(true);
    expect((screen.getByRole("checkbox", { name: "Select Alex Kim" }) as HTMLInputElement).checked).toBe(true);

    fireEvent.click(screen.getByRole("checkbox", { name: "Select all" }));
    await waitFor(() => expect(document.querySelector(".attendees-bulkbar")).toBeNull());
  });

  it("clears the selection and hides the bar when the bulk bar's clear control is clicked", async () => {
    fetchEventAttendees.mockResolvedValue({ items: [rowA, rowB, rowC], total: 3, page: 1, pageSize: 25 });

    renderPage();

    await screen.findByText("Jane Doe");
    fireEvent.click(screen.getByRole("checkbox", { name: "Select Jane Doe" }));
    await waitFor(() => expect(document.querySelector(".attendees-bulkbar")).toBeTruthy());

    fireEvent.click(bulkBar().getByRole("button", { name: "Clear selection" }));

    await waitFor(() => expect(document.querySelector(".attendees-bulkbar")).toBeNull());
    expect((screen.getByRole("checkbox", { name: "Select Jane Doe" }) as HTMLInputElement).checked).toBe(false);
  });

  it("sends tickets to the selected attendees via sendEventBulk, toasts, and clears the selection", async () => {
    fetchEventAttendees.mockResolvedValue({ items: [rowA, rowB, rowC], total: 3, page: 1, pageSize: 25 });
    sendEventBulk.mockResolvedValue({ batchId: "batch-1", queued: 2, skipped: 0, failed: 0 });

    renderPage();

    await screen.findByText("Jane Doe");
    fireEvent.click(screen.getByRole("checkbox", { name: "Select Jane Doe" }));
    fireEvent.click(screen.getByRole("checkbox", { name: "Select John Smith" }));
    await waitFor(() => expect(bulkBar().getByText("2")).toBeTruthy());

    fireEvent.click(bulkBar().getByRole("button", { name: "Send tickets" }));
    const confirmDialog = screen.getByRole("dialog", { name: "Send tickets?" });
    fireEvent.click(within(confirmDialog).getByRole("button", { name: "Send tickets" }));

    await waitFor(() => {
      // No templateId — the server falls back to the built-in default ("ticket")
      // template when it's omitted, so this works even with no persisted template row.
      expect(sendEventBulk).toHaveBeenCalledWith("evt-1", {
        filter: { type: "attendee_ids", ids: ["att-1", "att-2"] },
      });
    });
    await waitFor(() => {
      expect(addToast).toHaveBeenCalledWith("Sending tickets to 2 attendees.", "success");
    });
    await waitFor(() => expect(document.querySelector(".attendees-bulkbar")).toBeNull());
  });

  it("toasts an operator-safe error when sendEventBulk fails", async () => {
    const { ApiError } = await import("../../src/api/client.js");
    fetchEventAttendees.mockResolvedValue({ items: [rowA, rowB, rowC], total: 3, page: 1, pageSize: 25 });
    sendEventBulk.mockRejectedValueOnce(new ApiError(500, "secret_internal"));

    renderPage();

    await screen.findByText("Jane Doe");
    fireEvent.click(screen.getByRole("checkbox", { name: "Select Jane Doe" }));
    await waitFor(() => expect(document.querySelector(".attendees-bulkbar")).toBeTruthy());

    fireEvent.click(bulkBar().getByRole("button", { name: "Send tickets" }));
    const confirmDialog = screen.getByRole("dialog", { name: "Send tickets?" });
    fireEvent.click(within(confirmDialog).getByRole("button", { name: "Send tickets" }));

    await waitFor(() => {
      expect(addToast).toHaveBeenCalledWith("Send failed.", "error");
    });
    // The selection survives a failed send — only a successful queue clears it.
    expect(document.querySelector(".attendees-bulkbar")).toBeTruthy();
  });

  it("disables 'Send tickets' in the bulk bar when the event has no effective mail transport", async () => {
    fetchEventAttendees.mockResolvedValue({ items: [rowA, rowB, rowC], total: 3, page: 1, pageSize: 25 });
    fetchEventMailSettings.mockResolvedValue(mailSettings(null));

    renderPage();

    await screen.findByText("Jane Doe");
    fireEvent.click(screen.getByRole("checkbox", { name: "Select Jane Doe" }));

    await waitFor(() => expect(document.querySelector(".attendees-bulkbar")).toBeTruthy());
    expect((bulkBar().getByRole("button", { name: "Send tickets" }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("clears the selection when the list reloads (e.g. page change)", async () => {
    // Selecting a row swaps the toolbar (search + filter selects) for the bulk bar (#355 mobile
    // rework), so the filter selects used to trigger this reload are no longer reachable while a
    // row is selected. Pagination controls stay in the footer regardless of selection state, so
    // they're used here to trigger the same "any list reload clears selectedIds" behavior.
    fetchEventAttendees.mockResolvedValue({ items: [rowA, rowB, rowC], total: 30, page: 1, pageSize: 25 });

    renderPage();

    await screen.findByText("Jane Doe");
    fireEvent.click(screen.getByRole("checkbox", { name: "Select Jane Doe" }));
    await waitFor(() => expect(document.querySelector(".attendees-bulkbar")).toBeTruthy());

    fireEvent.click(screen.getByRole("button", { name: "Next" }));

    await waitFor(() => {
      expect(fetchEventAttendees).toHaveBeenLastCalledWith(
        "evt-1",
        expect.objectContaining({ page: 2 }),
        expect.anything(),
      );
    });
    expect(document.querySelector(".attendees-bulkbar")).toBeNull();
  });
});

describe("AttendeesPage bulk delete (#356 follow-up)", () => {
  it("deletes the selected attendees via bulkDeleteAttendees, toasts, and clears the selection", async () => {
    fetchEventAttendees.mockResolvedValue({ items: [rowA, rowB, rowC], total: 3, page: 1, pageSize: 25 });
    bulkDeleteAttendees.mockResolvedValue({ deletedCount: 2 });

    renderPage();

    await screen.findByText("Jane Doe");
    fireEvent.click(screen.getByRole("checkbox", { name: "Select Jane Doe" }));
    fireEvent.click(screen.getByRole("checkbox", { name: "Select John Smith" }));
    await waitFor(() => expect(bulkBar().getByText("2")).toBeTruthy());

    const dialog = openAndArmDeleteDialog();
    fireEvent.click(within(dialog).getByRole("button", { name: "Delete attendees" }));

    await waitFor(() => {
      expect(bulkDeleteAttendees).toHaveBeenCalledWith("evt-1", ["att-1", "att-2"]);
    });
    await waitFor(() => {
      expect(addToast).toHaveBeenCalledWith("2 attendees permanently deleted", "success");
    });
    await waitFor(() => expect(document.querySelector(".attendees-bulkbar")).toBeNull());
  });

  it("shows an operator-safe error inside the dialog and keeps the selection when bulkDeleteAttendees fails", async () => {
    const { ApiError } = await import("../../src/api/client.js");
    fetchEventAttendees.mockResolvedValue({ items: [rowA, rowB, rowC], total: 3, page: 1, pageSize: 25 });
    bulkDeleteAttendees.mockRejectedValueOnce(new ApiError(500, "secret_internal"));

    renderPage();

    await screen.findByText("Jane Doe");
    fireEvent.click(screen.getByRole("checkbox", { name: "Select Jane Doe" }));
    await waitFor(() => expect(document.querySelector(".attendees-bulkbar")).toBeTruthy());

    const dialog = openAndArmDeleteDialog();
    fireEvent.click(within(dialog).getByRole("button", { name: "Delete attendees" }));

    // Inline in the dialog, not a toast - matches the attendee detail page's single-delete
    // flow and the project's own "destructive actions don't also toast" convention.
    await screen.findByText("Delete failed.");
    expect(addToast).not.toHaveBeenCalled();
    expect(screen.getByText("Permanently delete 1 attendee?")).toBeTruthy();
    expect(document.querySelector(".attendees-bulkbar")).toBeTruthy();
  });

  it("Cancel closes the bulk-delete dialog without calling bulkDeleteAttendees", async () => {
    fetchEventAttendees.mockResolvedValue({ items: [rowA, rowB, rowC], total: 3, page: 1, pageSize: 25 });

    renderPage();

    await screen.findByText("Jane Doe");
    fireEvent.click(screen.getByRole("checkbox", { name: "Select Jane Doe" }));
    await waitFor(() => expect(document.querySelector(".attendees-bulkbar")).toBeTruthy());

    const dialog = openAndArmDeleteDialog();
    fireEvent.click(within(dialog).getByRole("button", { name: "Cancel" }));

    expect(screen.queryByText("Permanently delete 1 attendee?")).toBeNull();
    expect(bulkDeleteAttendees).not.toHaveBeenCalled();
  });

  it("redirects to /login on a 401 instead of showing an inline error", async () => {
    const { ApiError } = await import("../../src/api/client.js");
    const assignSpy = vi.fn();
    const locationDescriptor = Object.getOwnPropertyDescriptor(window, "location");
    Object.defineProperty(window, "location", {
      configurable: true,
      value: { pathname: "/admin/events/evt-1/attendees", assign: assignSpy },
    });
    try {
      fetchEventAttendees.mockResolvedValue({ items: [rowA, rowB, rowC], total: 3, page: 1, pageSize: 25 });
      bulkDeleteAttendees.mockRejectedValueOnce(new ApiError(401, "unauthorized"));

      renderPage();

      await screen.findByText("Jane Doe");
      fireEvent.click(screen.getByRole("checkbox", { name: "Select Jane Doe" }));
      await waitFor(() => expect(document.querySelector(".attendees-bulkbar")).toBeTruthy());

      const dialog = openAndArmDeleteDialog();
      fireEvent.click(within(dialog).getByRole("button", { name: "Delete attendees" }));

      await waitFor(() => {
        expect(assignSpy).toHaveBeenCalledWith(expect.stringContaining("/login?next="));
      });
      expect(reportApiError).toHaveBeenCalledWith(401);
    } finally {
      if (locationDescriptor) Object.defineProperty(window, "location", locationDescriptor);
    }
  });

  it("shows a generic inline error when bulkDeleteAttendees rejects with something other than ApiError", async () => {
    fetchEventAttendees.mockResolvedValue({ items: [rowA, rowB, rowC], total: 3, page: 1, pageSize: 25 });
    bulkDeleteAttendees.mockRejectedValueOnce(new TypeError("Failed to fetch"));

    renderPage();

    await screen.findByText("Jane Doe");
    fireEvent.click(screen.getByRole("checkbox", { name: "Select Jane Doe" }));
    await waitFor(() => expect(document.querySelector(".attendees-bulkbar")).toBeTruthy());

    const dialog = openAndArmDeleteDialog();
    fireEvent.click(within(dialog).getByRole("button", { name: "Delete attendees" }));

    await screen.findByText("Failed to delete attendees.");
    expect(document.querySelector(".attendees-bulkbar")).toBeTruthy();
  });

  it("uses singular wording when exactly one attendee is deleted", async () => {
    fetchEventAttendees.mockResolvedValue({ items: [rowA, rowB, rowC], total: 3, page: 1, pageSize: 25 });
    bulkDeleteAttendees.mockResolvedValueOnce({ deletedCount: 1 });

    renderPage();

    await screen.findByText("Jane Doe");
    fireEvent.click(screen.getByRole("checkbox", { name: "Select Jane Doe" }));
    await waitFor(() => expect(document.querySelector(".attendees-bulkbar")).toBeTruthy());

    const dialog = openAndArmDeleteDialog();
    fireEvent.click(within(dialog).getByRole("button", { name: "Delete attendees" }));

    await waitFor(() => {
      expect(addToast).toHaveBeenCalledWith("1 attendee permanently deleted", "success");
    });
  });

  it("ignores a stale bulk-delete completion after navigating to a different event mid-request (CodeRabbit review)", async () => {
    let resolveDelete!: (value: { deletedCount: number }) => void;
    fetchEventAttendees.mockResolvedValue({ items: [rowA, rowB, rowC], total: 3, page: 1, pageSize: 25 });
    bulkDeleteAttendees.mockReturnValueOnce(
      new Promise((resolve) => {
        resolveDelete = resolve;
      }),
    );

    const router = createMemoryRouter(
      [{ path: "/admin/events/:eventId/attendees", element: <AttendeesPage /> }],
      { initialEntries: ["/admin/events/evt-1/attendees"] },
    );
    render(<RouterProvider router={router} />);

    await screen.findByText("Jane Doe");
    fireEvent.click(screen.getByRole("checkbox", { name: "Select Jane Doe" }));
    await waitFor(() => expect(document.querySelector(".attendees-bulkbar")).toBeTruthy());

    const dialog = openAndArmDeleteDialog();
    fireEvent.click(within(dialog).getByRole("button", { name: "Delete attendees" }));

    // Navigate to a different event while the bulk-delete request is still in flight — the
    // completion below must not toast, close the dialog, or clear the selection on behalf of
    // an event that's no longer the one being viewed.
    await act(async () => router.navigate("/admin/events/evt-2/attendees"));
    await waitFor(() => {
      expect(fetchEventAttendees).toHaveBeenCalledWith("evt-2", expect.anything(), expect.anything());
    });

    await act(async () => {
      resolveDelete({ deletedCount: 1 });
      await Promise.resolve();
    });

    expect(addToast).not.toHaveBeenCalledWith(expect.stringContaining("permanently deleted"), "success");
  });

  it("ignores a stale bulk-delete failure after navigating to a different event mid-request (CodeRabbit review)", async () => {
    const { ApiError } = await import("../../src/api/client.js");
    let rejectDelete!: (err: unknown) => void;
    fetchEventAttendees.mockResolvedValue({ items: [rowA, rowB, rowC], total: 3, page: 1, pageSize: 25 });
    bulkDeleteAttendees.mockReturnValueOnce(
      new Promise((_resolve, reject) => {
        rejectDelete = reject;
      }),
    );

    const router = createMemoryRouter(
      [{ path: "/admin/events/:eventId/attendees", element: <AttendeesPage /> }],
      { initialEntries: ["/admin/events/evt-1/attendees"] },
    );
    render(<RouterProvider router={router} />);

    await screen.findByText("Jane Doe");
    fireEvent.click(screen.getByRole("checkbox", { name: "Select Jane Doe" }));
    await waitFor(() => expect(document.querySelector(".attendees-bulkbar")).toBeTruthy());

    const dialog = openAndArmDeleteDialog();
    fireEvent.click(within(dialog).getByRole("button", { name: "Delete attendees" }));

    // Navigate away before the bulk-delete request rejects — the failure below must not set an
    // inline error on a dialog that belonged to an event the operator has since left.
    await act(async () => router.navigate("/admin/events/evt-2/attendees"));
    await waitFor(() => {
      expect(fetchEventAttendees).toHaveBeenCalledWith("evt-2", expect.anything(), expect.anything());
    });

    await act(async () => {
      rejectDelete(new ApiError(500, "secret_internal"));
      await Promise.resolve().catch(() => {});
    });

    expect(screen.queryByText("Delete failed.")).toBeNull();
  });
});

describe("AttendeesPage bulk check-in", () => {
  it("checks in the selected attendees via bulkCheckInAttendees, toasts, and clears the selection", async () => {
    fetchEventAttendees.mockResolvedValue({ items: [rowA, rowB, rowC], total: 3, page: 1, pageSize: 25 });
    bulkCheckInAttendees.mockResolvedValue({ checkedIn: 2, alreadyCheckedIn: 0, revoked: 0, invalid: 0, errored: 0 });

    renderPage();

    await screen.findByText("Jane Doe");
    fireEvent.click(screen.getByRole("checkbox", { name: "Select Jane Doe" }));
    fireEvent.click(screen.getByRole("checkbox", { name: "Select John Smith" }));
    await waitFor(() => expect(bulkBar().getByText("2")).toBeTruthy());

    fireEvent.click(bulkBar().getByRole("button", { name: "Check in" }));

    await waitFor(() => {
      expect(bulkCheckInAttendees).toHaveBeenCalledWith("evt-1", ["att-1", "att-2"]);
    });
    await waitFor(() => {
      expect(addToast).toHaveBeenCalledWith("2 attendees checked in.", "success");
    });
    await waitFor(() => expect(document.querySelector(".attendees-bulkbar")).toBeNull());
  });

  it("notes already-admitted attendees in the toast instead of erroring", async () => {
    fetchEventAttendees.mockResolvedValue({ items: [rowA, rowB, rowC], total: 3, page: 1, pageSize: 25 });
    bulkCheckInAttendees.mockResolvedValue({ checkedIn: 1, alreadyCheckedIn: 1, revoked: 0, invalid: 0, errored: 0 });

    renderPage();

    await screen.findByText("Jane Doe");
    fireEvent.click(screen.getByRole("checkbox", { name: "Select Jane Doe" }));
    await waitFor(() => expect(document.querySelector(".attendees-bulkbar")).toBeTruthy());

    fireEvent.click(bulkBar().getByRole("button", { name: "Check in" }));

    await waitFor(() => {
      expect(addToast).toHaveBeenCalledWith("1 attendee checked in (1 already admitted).", "success");
    });
  });

  it("toasts that everyone was already checked in when nobody new was admitted", async () => {
    fetchEventAttendees.mockResolvedValue({ items: [rowA, rowB, rowC], total: 3, page: 1, pageSize: 25 });
    bulkCheckInAttendees.mockResolvedValue({ checkedIn: 0, alreadyCheckedIn: 3, revoked: 0, invalid: 0, errored: 0 });

    renderPage();

    await screen.findByText("Jane Doe");
    fireEvent.click(screen.getByRole("checkbox", { name: "Select Jane Doe" }));
    await waitFor(() => expect(document.querySelector(".attendees-bulkbar")).toBeTruthy());

    fireEvent.click(bulkBar().getByRole("button", { name: "Check in" }));

    await waitFor(() => {
      expect(addToast).toHaveBeenCalledWith("All selected attendees were already checked in.", "info");
    });
  });

  it("toasts a revoked/invalid breakdown when nobody could be checked in", async () => {
    fetchEventAttendees.mockResolvedValue({ items: [rowA, rowB, rowC], total: 3, page: 1, pageSize: 25 });
    bulkCheckInAttendees.mockResolvedValue({ checkedIn: 0, alreadyCheckedIn: 0, revoked: 1, invalid: 1, errored: 0 });

    renderPage();

    await screen.findByText("Jane Doe");
    fireEvent.click(screen.getByRole("checkbox", { name: "Select Jane Doe" }));
    await waitFor(() => expect(document.querySelector(".attendees-bulkbar")).toBeTruthy());

    fireEvent.click(bulkBar().getByRole("button", { name: "Check in" }));

    await waitFor(() => {
      expect(addToast).toHaveBeenCalledWith("No attendees checked in (1 pass revoked, 1 not found).", "error");
    });
  });

  it("toasts a warning with the failure count when some check-ins errored unexpectedly", async () => {
    fetchEventAttendees.mockResolvedValue({ items: [rowA, rowB, rowC], total: 3, page: 1, pageSize: 25 });
    bulkCheckInAttendees.mockResolvedValue({ checkedIn: 1, alreadyCheckedIn: 0, revoked: 0, invalid: 0, errored: 2 });

    renderPage();

    await screen.findByText("Jane Doe");
    fireEvent.click(screen.getByRole("checkbox", { name: "Select Jane Doe" }));
    await waitFor(() => expect(document.querySelector(".attendees-bulkbar")).toBeTruthy());

    fireEvent.click(bulkBar().getByRole("button", { name: "Check in" }));

    await waitFor(() => {
      expect(addToast).toHaveBeenCalledWith("1 attendee checked in (2 failed unexpectedly).", "warning");
    });
  });

  it("redirects to /login on a 401", async () => {
    const { ApiError } = await import("../../src/api/client.js");
    const assignSpy = vi.fn();
    const locationDescriptor = Object.getOwnPropertyDescriptor(window, "location");
    Object.defineProperty(window, "location", {
      configurable: true,
      value: { pathname: "/admin/events/evt-1/attendees", assign: assignSpy },
    });
    try {
      fetchEventAttendees.mockResolvedValue({ items: [rowA, rowB, rowC], total: 3, page: 1, pageSize: 25 });
      bulkCheckInAttendees.mockRejectedValueOnce(new ApiError(401, "unauthorized"));

      renderPage();

      await screen.findByText("Jane Doe");
      fireEvent.click(screen.getByRole("checkbox", { name: "Select Jane Doe" }));
      await waitFor(() => expect(document.querySelector(".attendees-bulkbar")).toBeTruthy());

      fireEvent.click(bulkBar().getByRole("button", { name: "Check in" }));

      await waitFor(() => {
        expect(assignSpy).toHaveBeenCalledWith(expect.stringContaining("/login?next="));
      });
      expect(reportApiError).toHaveBeenCalledWith(401);
    } finally {
      if (locationDescriptor) Object.defineProperty(window, "location", locationDescriptor);
    }
  });

  it("toasts an operator-safe error and keeps the selection when bulkCheckInAttendees fails", async () => {
    const { ApiError } = await import("../../src/api/client.js");
    fetchEventAttendees.mockResolvedValue({ items: [rowA, rowB, rowC], total: 3, page: 1, pageSize: 25 });
    bulkCheckInAttendees.mockRejectedValueOnce(new ApiError(500, "secret_internal"));

    renderPage();

    await screen.findByText("Jane Doe");
    fireEvent.click(screen.getByRole("checkbox", { name: "Select Jane Doe" }));
    await waitFor(() => expect(document.querySelector(".attendees-bulkbar")).toBeTruthy());

    fireEvent.click(bulkBar().getByRole("button", { name: "Check in" }));

    await waitFor(() => {
      expect(addToast).toHaveBeenCalledWith("Check-in failed.", "error");
    });
    expect(document.querySelector(".attendees-bulkbar")).toBeTruthy();
  });

  it("shows a generic error toast when the request throws a non-API error", async () => {
    fetchEventAttendees.mockResolvedValue({ items: [rowA, rowB, rowC], total: 3, page: 1, pageSize: 25 });
    bulkCheckInAttendees.mockRejectedValueOnce(new Error("network down"));

    renderPage();

    await screen.findByText("Jane Doe");
    fireEvent.click(screen.getByRole("checkbox", { name: "Select Jane Doe" }));
    await waitFor(() => expect(document.querySelector(".attendees-bulkbar")).toBeTruthy());

    fireEvent.click(bulkBar().getByRole("button", { name: "Check in" }));

    await waitFor(() => {
      expect(addToast).toHaveBeenCalledWith("Failed to check in attendees.", "error");
    });
  });

  it("ignores a stale bulk-checkin error after navigating to a different event mid-request", async () => {
    let rejectCheckIn!: (err: unknown) => void;
    fetchEventAttendees.mockResolvedValue({ items: [rowA, rowB, rowC], total: 3, page: 1, pageSize: 25 });
    bulkCheckInAttendees.mockReturnValueOnce(
      new Promise((_resolve, reject) => {
        rejectCheckIn = reject;
      }),
    );

    const router = createMemoryRouter(
      [{ path: "/admin/events/:eventId/attendees", element: <AttendeesPage /> }],
      { initialEntries: ["/admin/events/evt-1/attendees"] },
    );
    render(<RouterProvider router={router} />);

    await screen.findByText("Jane Doe");
    fireEvent.click(screen.getByRole("checkbox", { name: "Select Jane Doe" }));
    await waitFor(() => expect(document.querySelector(".attendees-bulkbar")).toBeTruthy());

    fireEvent.click(bulkBar().getByRole("button", { name: "Check in" }));

    await act(async () => router.navigate("/admin/events/evt-2/attendees"));
    await waitFor(() => {
      expect(fetchEventAttendees).toHaveBeenCalledWith("evt-2", expect.anything(), expect.anything());
    });

    await act(async () => {
      rejectCheckIn(new Error("network down"));
      await Promise.resolve();
    });

    expect(addToast).not.toHaveBeenCalledWith(expect.stringContaining("Check-in"), "error");
    expect(addToast).not.toHaveBeenCalledWith("Failed to check in attendees.", "error");
  });

  it("ignores a stale bulk-checkin completion after navigating to a different event mid-request (CodeRabbit-style race guard)", async () => {
    let resolveCheckIn!: (value: {
      checkedIn: number;
      alreadyCheckedIn: number;
      revoked: number;
      invalid: number;
      errored: number;
    }) => void;
    fetchEventAttendees.mockResolvedValue({ items: [rowA, rowB, rowC], total: 3, page: 1, pageSize: 25 });
    bulkCheckInAttendees.mockReturnValueOnce(
      new Promise((resolve) => {
        resolveCheckIn = resolve;
      }),
    );

    const router = createMemoryRouter(
      [{ path: "/admin/events/:eventId/attendees", element: <AttendeesPage /> }],
      { initialEntries: ["/admin/events/evt-1/attendees"] },
    );
    render(<RouterProvider router={router} />);

    await screen.findByText("Jane Doe");
    fireEvent.click(screen.getByRole("checkbox", { name: "Select Jane Doe" }));
    await waitFor(() => expect(document.querySelector(".attendees-bulkbar")).toBeTruthy());

    fireEvent.click(bulkBar().getByRole("button", { name: "Check in" }));

    await act(async () => router.navigate("/admin/events/evt-2/attendees"));
    await waitFor(() => {
      expect(fetchEventAttendees).toHaveBeenCalledWith("evt-2", expect.anything(), expect.anything());
    });

    await act(async () => {
      resolveCheckIn({ checkedIn: 1, alreadyCheckedIn: 0, revoked: 0, invalid: 0, errored: 0 });
      await Promise.resolve();
    });

    expect(addToast).not.toHaveBeenCalledWith(expect.stringContaining("checked in"), "success");
  });
});

describe("AttendeesPage bulk export selected (#520)", () => {
  it("exports exactly the selected attendees as CSV and keeps the selection", async () => {
    fetchEventAttendees.mockResolvedValue({ items: [rowA, rowB, rowC], total: 3, page: 1, pageSize: 25 });
    exportSelectedAttendees.mockResolvedValue(undefined);

    renderPage();

    await screen.findByText("Jane Doe");
    fireEvent.click(screen.getByRole("checkbox", { name: "Select Jane Doe" }));
    fireEvent.click(screen.getByRole("checkbox", { name: "Select John Smith" }));
    await waitFor(() => expect(bulkBar().getByText("2")).toBeTruthy());

    fireEvent.click(bulkBar().getByRole("button", { name: "More actions" }));
    fireEvent.click(bulkBar().getByRole("menuitem", { name: /Export selected/ }));

    await waitFor(() => {
      expect(exportSelectedAttendees).toHaveBeenCalledWith(
        "evt-1",
        ["att-1", "att-2"],
        "csv",
        expect.anything(),
      );
    });
    // No success toast and the selection stays — the download starting is the feedback,
    // matching the header Export dropdown's behavior.
    expect(addToast).not.toHaveBeenCalled();
    expect(document.querySelector(".attendees-bulkbar")).toBeTruthy();
  });

  it("shows a dynamic 'CSV of N attendees' hint on the menu item", async () => {
    fetchEventAttendees.mockResolvedValue({ items: [rowA, rowB, rowC], total: 3, page: 1, pageSize: 25 });

    renderPage();

    await screen.findByText("Jane Doe");
    fireEvent.click(screen.getByRole("checkbox", { name: "Select Jane Doe" }));
    await waitFor(() => expect(document.querySelector(".attendees-bulkbar")).toBeTruthy());

    fireEvent.click(bulkBar().getByRole("button", { name: "More actions" }));
    expect(bulkBar().getByText("CSV of 1 attendee")).toBeTruthy();
    fireEvent.click(bulkBar().getByRole("button", { name: "More actions" }));

    fireEvent.click(screen.getByRole("checkbox", { name: "Select John Smith" }));
    await waitFor(() => expect(bulkBar().getByText("2")).toBeTruthy());
    fireEvent.click(bulkBar().getByRole("button", { name: "More actions" }));
    expect(bulkBar().getByText("CSV of 2 attendees")).toBeTruthy();
  });

  it("shows dynamic hints on 'Send tickets' and 'Delete' too, matching 'Export selected' (PO review — consistency)", async () => {
    // "Send tickets" only lives in this menu below 768px (its own button on desktop).
    mockMatchMedia(false);
    fetchEventAttendees.mockResolvedValue({ items: [rowA, rowB, rowC], total: 3, page: 1, pageSize: 25 });

    renderPage();

    await screen.findByText("Jane Doe");
    fireEvent.click(screen.getByRole("checkbox", { name: "Select Jane Doe" }));
    await waitFor(() => expect(document.querySelector(".attendees-bulkbar")).toBeTruthy());

    fireEvent.click(bulkBar().getByRole("button", { name: "More" }));
    expect(bulkBar().getByText("Email tickets to 1 attendee")).toBeTruthy();
    expect(bulkBar().getByText("Permanently remove 1 attendee")).toBeTruthy();
  });

  it("toasts an operator-safe error and keeps the selection when the export fails", async () => {
    const { ApiError } = await import("../../src/api/client.js");
    fetchEventAttendees.mockResolvedValue({ items: [rowA, rowB, rowC], total: 3, page: 1, pageSize: 25 });
    exportSelectedAttendees.mockRejectedValueOnce(new ApiError(500, "secret_internal"));

    renderPage();

    await screen.findByText("Jane Doe");
    fireEvent.click(screen.getByRole("checkbox", { name: "Select Jane Doe" }));
    await waitFor(() => expect(document.querySelector(".attendees-bulkbar")).toBeTruthy());

    fireEvent.click(bulkBar().getByRole("button", { name: "More actions" }));
    fireEvent.click(bulkBar().getByRole("menuitem", { name: /Export selected/ }));

    await waitFor(() => {
      expect(addToast).toHaveBeenCalledWith("Export failed.", "error");
    });
    expect(document.querySelector(".attendees-bulkbar")).toBeTruthy();
  });

  it("redirects to /login on a 401", async () => {
    const { ApiError } = await import("../../src/api/client.js");
    fetchEventAttendees.mockResolvedValue({ items: [rowA, rowB, rowC], total: 3, page: 1, pageSize: 25 });
    exportSelectedAttendees.mockRejectedValueOnce(new ApiError(401, "unauthorized"));
    const assign = vi.fn();
    vi.stubGlobal("location", { ...window.location, assign, pathname: "/admin/events/evt-1/attendees" });

    renderPage();

    await screen.findByText("Jane Doe");
    fireEvent.click(screen.getByRole("checkbox", { name: "Select Jane Doe" }));
    await waitFor(() => expect(document.querySelector(".attendees-bulkbar")).toBeTruthy());

    fireEvent.click(bulkBar().getByRole("button", { name: "More actions" }));
    fireEvent.click(bulkBar().getByRole("menuitem", { name: /Export selected/ }));

    await waitFor(() => {
      expect(assign).toHaveBeenCalledWith(
        `/login?next=${encodeURIComponent("/admin/events/evt-1/attendees")}`,
      );
    });
  });

  it("toasts a generic 'Export failed.' message when the failure isn't an ApiError", async () => {
    fetchEventAttendees.mockResolvedValue({ items: [rowA, rowB, rowC], total: 3, page: 1, pageSize: 25 });
    exportSelectedAttendees.mockRejectedValueOnce(new TypeError("Failed to fetch"));

    renderPage();

    await screen.findByText("Jane Doe");
    fireEvent.click(screen.getByRole("checkbox", { name: "Select Jane Doe" }));
    await waitFor(() => expect(document.querySelector(".attendees-bulkbar")).toBeTruthy());

    fireEvent.click(bulkBar().getByRole("button", { name: "More actions" }));
    fireEvent.click(bulkBar().getByRole("menuitem", { name: /Export selected/ }));

    await waitFor(() => {
      expect(addToast).toHaveBeenCalledWith("Export failed.", "error");
    });
  });

  it("ignores a stale bulk-export error after navigating to a different event mid-request", async () => {
    let rejectExport!: (err: unknown) => void;
    fetchEventAttendees.mockResolvedValue({ items: [rowA, rowB, rowC], total: 3, page: 1, pageSize: 25 });
    exportSelectedAttendees.mockReturnValueOnce(
      new Promise((_resolve, reject) => {
        rejectExport = reject;
      }),
    );

    const router = createMemoryRouter(
      [{ path: "/admin/events/:eventId/attendees", element: <AttendeesPage /> }],
      { initialEntries: ["/admin/events/evt-1/attendees"] },
    );
    render(<RouterProvider router={router} />);

    await screen.findByText("Jane Doe");
    fireEvent.click(screen.getByRole("checkbox", { name: "Select Jane Doe" }));
    await waitFor(() => expect(document.querySelector(".attendees-bulkbar")).toBeTruthy());

    fireEvent.click(bulkBar().getByRole("button", { name: "More actions" }));
    fireEvent.click(bulkBar().getByRole("menuitem", { name: /Export selected/ }));

    await act(async () => router.navigate("/admin/events/evt-2/attendees"));
    await waitFor(() => {
      expect(fetchEventAttendees).toHaveBeenCalledWith("evt-2", expect.anything(), expect.anything());
    });

    await act(async () => {
      rejectExport(new Error("network down"));
      await Promise.resolve();
    });

    expect(addToast).not.toHaveBeenCalledWith("Export failed.", "error");
  });
});

describe("AttendeesPage bulk change ticket type (#521)", () => {
  const catalog = [
    { id: "tt-1", key: "vip", label: "VIP", color: "purple", sort_order: 0, attendee_count: 1, created_at: "2026-06-01T00:00:00.000Z" },
    { id: "tt-2", key: "standard", label: "Standard", color: "gray", sort_order: 1, attendee_count: 2, created_at: "2026-06-01T00:00:00.000Z" },
  ];

  async function selectTwoRowsAndOpenMenu() {
    renderPage();
    await screen.findByText("Jane Doe");
    fireEvent.click(screen.getByRole("checkbox", { name: "Select Jane Doe" }));
    fireEvent.click(screen.getByRole("checkbox", { name: "Select John Smith" }));
    await waitFor(() => expect(bulkBar().getByText("2")).toBeTruthy());
    fireEvent.click(bulkBar().getByRole("button", { name: "More actions" }));
  }

  it("opens the picker with the event's configured types, applies, toasts, and clears the selection", async () => {
    fetchEventAttendees.mockResolvedValue({ items: [rowA, rowB, rowC], total: 3, page: 1, pageSize: 25 });
    fetchTicketTypes.mockResolvedValue(catalog);
    bulkChangeTicketType.mockResolvedValue({ updatedCount: 2, alreadySetCount: 0 });

    await selectTwoRowsAndOpenMenu();
    const item = bulkBar().getByRole("menuitem", { name: /Change ticket type/ });
    expect(item.textContent).toContain("Choose from 2 configured types");
    fireEvent.click(item);

    const dialog = screen.getByRole("dialog", { name: "Change ticket type" });
    expect(within(dialog).getByRole("radio", { name: "VIP" })).toBeTruthy();
    fireEvent.click(within(dialog).getByRole("radio", { name: "Standard" }));
    fireEvent.click(within(dialog).getByRole("button", { name: "Apply" }));

    await waitFor(() => {
      expect(bulkChangeTicketType).toHaveBeenCalledWith("evt-1", ["att-1", "att-2"], "standard");
    });
    await waitFor(() => {
      expect(addToast).toHaveBeenCalledWith("2 attendees set to Standard", "success");
    });
    await waitFor(() => expect(document.querySelector(".attendees-bulkbar")).toBeNull());
  });

  it("notes attendees that already had the type in the success toast", async () => {
    fetchEventAttendees.mockResolvedValue({ items: [rowA, rowB, rowC], total: 3, page: 1, pageSize: 25 });
    fetchTicketTypes.mockResolvedValue(catalog);
    bulkChangeTicketType.mockResolvedValue({ updatedCount: 1, alreadySetCount: 1 });

    await selectTwoRowsAndOpenMenu();
    fireEvent.click(bulkBar().getByRole("menuitem", { name: /Change ticket type/ }));
    const dialog = screen.getByRole("dialog", { name: "Change ticket type" });
    fireEvent.click(within(dialog).getByRole("button", { name: "Apply" }));

    await waitFor(() => {
      expect(addToast).toHaveBeenCalledWith("1 attendee set to VIP (1 already had it)", "success");
    });
  });

  it("toasts info when every selected attendee already has the type", async () => {
    fetchEventAttendees.mockResolvedValue({ items: [rowA, rowB, rowC], total: 3, page: 1, pageSize: 25 });
    fetchTicketTypes.mockResolvedValue(catalog);
    bulkChangeTicketType.mockResolvedValue({ updatedCount: 0, alreadySetCount: 2 });

    await selectTwoRowsAndOpenMenu();
    fireEvent.click(bulkBar().getByRole("menuitem", { name: /Change ticket type/ }));
    const dialog = screen.getByRole("dialog", { name: "Change ticket type" });
    fireEvent.click(within(dialog).getByRole("button", { name: "Apply" }));

    await waitFor(() => {
      expect(addToast).toHaveBeenCalledWith("All selected attendees already have VIP.", "info");
    });
  });

  it("toasts an error (not the 'already had it' message) when none of the selected attendees could be found (#521 code review)", async () => {
    fetchEventAttendees.mockResolvedValue({ items: [rowA, rowB, rowC], total: 3, page: 1, pageSize: 25 });
    fetchTicketTypes.mockResolvedValue(catalog);
    // Both zero — nothing was found at all, distinct from "found but already had it"
    // (updatedCount: 0, alreadySetCount > 0), which is a different, non-error toast below.
    bulkChangeTicketType.mockResolvedValue({ updatedCount: 0, alreadySetCount: 0 });

    await selectTwoRowsAndOpenMenu();
    fireEvent.click(bulkBar().getByRole("menuitem", { name: /Change ticket type/ }));
    const dialog = screen.getByRole("dialog", { name: "Change ticket type" });
    fireEvent.click(within(dialog).getByRole("button", { name: "Apply" }));

    await waitFor(() => {
      expect(addToast).toHaveBeenCalledWith(
        "None of the selected attendees could be found — they may have been removed.",
        "error",
      );
    });
    expect(addToast).not.toHaveBeenCalledWith(expect.stringContaining("already have"), expect.anything());
  });

  it("shows the deleted-type error inline in the dialog and keeps the selection", async () => {
    const { ApiError } = await import("../../src/api/client.js");
    fetchEventAttendees.mockResolvedValue({ items: [rowA, rowB, rowC], total: 3, page: 1, pageSize: 25 });
    fetchTicketTypes.mockResolvedValue(catalog);
    bulkChangeTicketType.mockRejectedValueOnce(new ApiError(400, "unknown_ticket_type"));

    await selectTwoRowsAndOpenMenu();
    fireEvent.click(bulkBar().getByRole("menuitem", { name: /Change ticket type/ }));
    const dialog = screen.getByRole("dialog", { name: "Change ticket type" });
    fireEvent.click(within(dialog).getByRole("button", { name: "Apply" }));

    await waitFor(() => {
      expect(within(dialog).getByRole("alert").textContent).toContain("no longer exists");
    });
    // Dialog stays open, selection survives, no toast for a dialog-scoped error.
    expect(screen.getByRole("dialog", { name: "Change ticket type" })).toBeTruthy();
    expect(document.querySelector(".attendees-bulkbar")).toBeTruthy();
    expect(addToast).not.toHaveBeenCalled();
  });

  it("disables the menu item when the event has no configured ticket types", async () => {
    fetchEventAttendees.mockResolvedValue({ items: [rowA, rowB, rowC], total: 3, page: 1, pageSize: 25 });
    fetchTicketTypes.mockResolvedValue([]);

    renderPage();
    await screen.findByText("Jane Doe");
    fireEvent.click(screen.getByRole("checkbox", { name: "Select Jane Doe" }));
    await waitFor(() => expect(document.querySelector(".attendees-bulkbar")).toBeTruthy());
    fireEvent.click(bulkBar().getByRole("button", { name: "More actions" }));

    const item = bulkBar().getByRole("menuitem", { name: /Change ticket type/ }) as HTMLButtonElement;
    expect(item.disabled).toBe(true);
    expect(item.title).toContain("No ticket types configured");
  });

  it("blames a failed catalog load, not 'no types configured', when the fetch itself failed (#521 code review)", async () => {
    fetchEventAttendees.mockResolvedValue({ items: [rowA, rowB, rowC], total: 3, page: 1, pageSize: 25 });
    fetchTicketTypes.mockRejectedValue(new Error("network down"));

    renderPage();
    await screen.findByText("Jane Doe");
    // The error sits inside the Filters dropdown panel now (PO review) — open it to confirm
    // the ticketTypesError state has actually settled before proceeding.
    fireEvent.click(screen.getByRole("button", { name: "Filters" }));
    await screen.findByText("Couldn't load types.");

    fireEvent.click(screen.getByRole("checkbox", { name: "Select Jane Doe" }));
    await waitFor(() => expect(document.querySelector(".attendees-bulkbar")).toBeTruthy());
    fireEvent.click(bulkBar().getByRole("button", { name: "More actions" }));

    const item = bulkBar().getByRole("menuitem", { name: /Change ticket type/ }) as HTMLButtonElement;
    expect(item.disabled).toBe(true);
    expect(item.title).not.toContain("No ticket types configured");
    expect(item.title).toContain("Couldn't load ticket types");
  });

  it("lets the operator retry the catalog load from the bulk bar's More actions menu, without losing the selection (Codex review)", async () => {
    fetchEventAttendees.mockResolvedValue({ items: [rowA, rowB, rowC], total: 3, page: 1, pageSize: 25 });
    fetchTicketTypes.mockRejectedValueOnce(new Error("network down"));

    renderPage();
    await screen.findByText("Jane Doe");
    fireEvent.click(screen.getByRole("checkbox", { name: "Select Jane Doe" }));
    await waitFor(() => expect(document.querySelector(".attendees-bulkbar")).toBeTruthy());
    fireEvent.click(bulkBar().getByRole("button", { name: "More actions" }));

    await waitFor(() => expect(bulkBar().getByText("Retry loading ticket types")).toBeTruthy());

    fetchTicketTypes.mockResolvedValueOnce([
      { id: "tt-1", key: "vip", label: "VIP", color: "purple", sort_order: 0, attendee_count: 1, created_at: "2026-06-01T00:00:00.000Z" },
    ]);
    fireEvent.click(bulkBar().getByText("Retry loading ticket types"));

    await waitFor(() => {
      const item = bulkBar().getByRole("menuitem", { name: /Change ticket type/ }) as HTMLButtonElement;
      expect(item.disabled).toBe(false);
    });
    // The selection survives the retry — the whole point was not losing it.
    expect(bulkBar().getByText("1")).toBeTruthy();
  });
});

describe("AttendeesPage bulk bar on mobile (PO review — bar must never change height)", () => {
  it("shortens 'More actions' to 'More' below 768px so it fits alongside the count, and the menu still works", async () => {
    mockMatchMedia(false);
    fetchEventAttendees.mockResolvedValue({ items: [rowA, rowB, rowC], total: 3, page: 1, pageSize: 25 });

    renderPage();
    await screen.findByText("Jane Doe");
    fireEvent.click(screen.getByRole("checkbox", { name: "Select Jane Doe" }));
    await waitFor(() => expect(document.querySelector(".attendees-bulkbar")).toBeTruthy());

    expect(bulkBar().queryByRole("button", { name: "More actions" })).toBeNull();
    fireEvent.click(bulkBar().getByRole("button", { name: "More" }));
    expect(bulkBar().getByRole("menuitem", { name: /Export selected/ })).toBeTruthy();
  });

  it("keeps the full 'More actions' label at desktop widths", async () => {
    fetchEventAttendees.mockResolvedValue({ items: [rowA, rowB, rowC], total: 3, page: 1, pageSize: 25 });

    renderPage();
    await screen.findByText("Jane Doe");
    fireEvent.click(screen.getByRole("checkbox", { name: "Select Jane Doe" }));
    await waitFor(() => expect(document.querySelector(".attendees-bulkbar")).toBeTruthy());

    expect(bulkBar().getByRole("button", { name: "More actions" })).toBeTruthy();
  });

  it("moves 'Send tickets' into the 'More' menu below 768px instead of its own button, so count + Check in + More fit one line", async () => {
    mockMatchMedia(false);
    fetchEventAttendees.mockResolvedValue({ items: [rowA, rowB, rowC], total: 3, page: 1, pageSize: 25 });
    sendEventBulk.mockResolvedValue({ batchId: "batch-1", queued: 1, skipped: 0, failed: 0 });

    renderPage();
    await screen.findByText("Jane Doe");
    fireEvent.click(screen.getByRole("checkbox", { name: "Select Jane Doe" }));
    await waitFor(() => expect(document.querySelector(".attendees-bulkbar")).toBeTruthy());

    expect(bulkBar().queryByRole("button", { name: "Send tickets" })).toBeNull();
    expect(bulkBar().getByRole("button", { name: "Check in" })).toBeTruthy();

    fireEvent.click(bulkBar().getByRole("button", { name: "More" }));
    fireEvent.click(bulkBar().getByRole("menuitem", { name: /^Send tickets/ }));
    const confirmDialog = screen.getByRole("dialog", { name: "Send tickets?" });
    fireEvent.click(within(confirmDialog).getByRole("button", { name: "Send tickets" }));

    await waitFor(() => {
      expect(sendEventBulk).toHaveBeenCalledWith("evt-1", {
        filter: { type: "attendee_ids", ids: ["att-1"] },
      });
    });
  });

  it("keeps 'Send tickets' as its own button at desktop widths", async () => {
    fetchEventAttendees.mockResolvedValue({ items: [rowA, rowB, rowC], total: 3, page: 1, pageSize: 25 });

    renderPage();
    await screen.findByText("Jane Doe");
    fireEvent.click(screen.getByRole("checkbox", { name: "Select Jane Doe" }));
    await waitFor(() => expect(document.querySelector(".attendees-bulkbar")).toBeTruthy());

    expect(bulkBar().getByRole("button", { name: "Send tickets" })).toBeTruthy();
  });
});
