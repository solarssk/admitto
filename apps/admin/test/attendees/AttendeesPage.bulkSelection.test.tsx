// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { AttendeesPage } from "../../src/pages/AttendeesPage.js";
import { mockMatchMedia } from "../test-utils.js";
import type { AttendeeRowDto } from "../../src/api/types.js";

const fetchEventAttendees = vi.fn();
const fetchEventMailSettings = vi.fn();
const sendEventBulk = vi.fn();
const bulkDeleteAttendees = vi.fn();
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
  fetchTicketTypes: vi.fn().mockResolvedValue([]),
  fetchEventMailSettings: (...args: unknown[]) => fetchEventMailSettings(...args),
  exportAttendees: vi.fn(),
  bulkResendTickets: vi.fn(),
  sendEventBulk: (...args: unknown[]) => sendEventBulk(...args),
  bulkDeleteAttendees: (...args: unknown[]) => bulkDeleteAttendees(...args),
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
  fireEvent.click(bulkBar().getByRole("menuitem", { name: "Delete" }));
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

    await waitFor(() => expect(screen.getByText("Jane Doe")).toBeTruthy());
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

    await waitFor(() => expect(screen.getByText("Jane Doe")).toBeTruthy());

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

    await waitFor(() => expect(screen.getByText("Jane Doe")).toBeTruthy());
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

    await waitFor(() => expect(screen.getByText("Jane Doe")).toBeTruthy());
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

    await waitFor(() => expect(screen.getByText("Jane Doe")).toBeTruthy());
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

    await waitFor(() => expect(screen.getByText("Jane Doe")).toBeTruthy());
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

    await waitFor(() => expect(screen.getByText("Jane Doe")).toBeTruthy());
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

  it("toasts an operator-safe error and keeps the selection when bulkDeleteAttendees fails", async () => {
    const { ApiError } = await import("../../src/api/client.js");
    fetchEventAttendees.mockResolvedValue({ items: [rowA, rowB, rowC], total: 3, page: 1, pageSize: 25 });
    bulkDeleteAttendees.mockRejectedValueOnce(new ApiError(500, "secret_internal"));

    renderPage();

    await screen.findByText("Jane Doe");
    fireEvent.click(screen.getByRole("checkbox", { name: "Select Jane Doe" }));
    await waitFor(() => expect(document.querySelector(".attendees-bulkbar")).toBeTruthy());

    const dialog = openAndArmDeleteDialog();
    fireEvent.click(within(dialog).getByRole("button", { name: "Delete attendees" }));

    await waitFor(() => {
      expect(addToast).toHaveBeenCalledWith("Delete failed.", "error");
    });
    expect(document.querySelector(".attendees-bulkbar")).toBeTruthy();
  });
});
