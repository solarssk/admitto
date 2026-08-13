// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { RouterProvider } from "react-router/dom";
import { createMemoryRouter, MemoryRouter, Route, Routes } from "react-router";
import { AttendeesPage } from "../../src/pages/AttendeesPage.js";
import { getTooltipText, mockMatchMedia } from "../test-utils.js";
import type { AttendeeRowDto } from "../../src/api/types.js";

const fetchEventAttendees = vi.fn();
const fetchEventMailSettings = vi.fn();
const sendEventBulk = vi.fn();
const fetchBulkSendStatus = vi.fn();
const bulkDeleteAttendees = vi.fn();
const bulkCheckInAttendees = vi.fn();
const bulkRevokeCheckIn = vi.fn();
const bulkRevokePass = vi.fn();
const bulkChangeTicketType = vi.fn();
const bulkChangeRsvpStatus = vi.fn();
const exportSelectedAttendees = vi.fn();
const fetchTicketTypes = vi.fn();
const fetchEventItems = vi.fn();
const bulkRevokeItems = vi.fn();
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
    has_issued_items: true,
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

const { pollBulkSendCompletion, setPollBulkSendCompletionActual, getPollBulkSendCompletionActual } =
  vi.hoisted(() => {
    let actual: typeof import("../../src/attendees/pollBulkSendCompletion.js").pollBulkSendCompletion;
    const pollBulkSendCompletion = vi.fn();
    return {
      pollBulkSendCompletion,
      setPollBulkSendCompletionActual: (
        fn: typeof import("../../src/attendees/pollBulkSendCompletion.js").pollBulkSendCompletion,
      ) => {
        actual = fn;
      },
      getPollBulkSendCompletionActual: () => actual,
    };
  });

vi.mock("../../src/attendees/pollBulkSendCompletion.js", async (importOriginal) => {
  const mod = await importOriginal<typeof import("../../src/attendees/pollBulkSendCompletion.js")>();
  setPollBulkSendCompletionActual(mod.pollBulkSendCompletion);
  return {
    pollBulkSendCompletion: (...args: unknown[]) => pollBulkSendCompletion(...args),
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
  bulkChangeRsvpStatus: (...args: unknown[]) => bulkChangeRsvpStatus(...args),
  fetchEventMailSettings: (...args: unknown[]) => fetchEventMailSettings(...args),
  fetchEventItems: (...args: unknown[]) => fetchEventItems(...args),
  bulkRevokeItems: (...args: unknown[]) => bulkRevokeItems(...args),
  exportAttendees: vi.fn(),
  exportSelectedAttendees: (...args: unknown[]) => exportSelectedAttendees(...args),
  bulkResendTickets: vi.fn(),
  sendEventBulk: (...args: unknown[]) => sendEventBulk(...args),
  fetchBulkSendStatus: (...args: unknown[]) => fetchBulkSendStatus(...args),
  bulkDeleteAttendees: (...args: unknown[]) => bulkDeleteAttendees(...args),
  bulkCheckInAttendees: (...args: unknown[]) => bulkCheckInAttendees(...args),
  bulkRevokeCheckIn: (...args: unknown[]) => bulkRevokeCheckIn(...args),
  bulkRevokePass: (...args: unknown[]) => bulkRevokePass(...args),
  updateAttendee: vi.fn(),
}));

vi.mock("react-router", async (importOriginal) => {
  const actual = await importOriginal<typeof import("react-router")>();
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
 * The accessible name concatenates the label and hint text, so a plain prefix match on "Delete"
 * also catches "Delete wallet pass" - excluded via the lookahead. */
function openAndArmDeleteDialog() {
  return openMenuItemAndArmDialog(/^Delete(?! wallet)/);
}

/** Opens the "More actions" menu, then clicks the given menu item and returns the confirm dialog. */
function openMenuItemAndArmDialog(menuItemName: RegExp, dialogName?: string) {
  fireEvent.click(bulkBar().getByRole("button", { name: "More actions" }));
  return clickMenuItemAndArmDialog(menuItemName, dialogName);
}

/** Opens a bulk confirm / card-picker dialog (no arming delay). */
function clickMenuItemAndArmDialog(menuItemName: RegExp, dialogName?: string) {
  fireEvent.click(bulkBar().getByRole("menuitem", { name: menuItemName }));
  return dialogName ? screen.getByRole("dialog", { name: dialogName }) : screen.getByRole("dialog");
}

beforeEach(() => {
  mockMatchMedia(true);
  fetchEventMailSettings.mockResolvedValue(mailSettings("smtp"));
  fetchTicketTypes.mockResolvedValue([]);
  fetchEventItems.mockResolvedValue([]);
  fetchBulkSendStatus.mockResolvedValue({
    batchId: "batch-1",
    total: 1,
    queued: 0,
    sent: 1,
    failed: 0,
  });
  pollBulkSendCompletion.mockImplementation((...args: Parameters<ReturnType<typeof getPollBulkSendCompletionActual>>) =>
    getPollBulkSendCompletionActual()(...args),
  );
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
    fireEvent.click(within(confirmDialog).getByRole("button", { name: "Send" }));

    await waitFor(() => {
      // No templateId — the server falls back to the built-in default ("ticket")
      // template when it's omitted, so this works even with no persisted template row.
      expect(sendEventBulk).toHaveBeenCalledWith("evt-1", {
        filter: { type: "attendee_ids", ids: ["att-1", "att-2"] },
      });
    });
    await waitFor(() => {
      expect(addToast).toHaveBeenCalledWith("Queued tickets for 2 attendees.", "success");
    });
    await waitFor(() => expect(document.querySelector(".attendees-bulkbar")).toBeNull());
    await waitFor(() => {
      expect(fetchBulkSendStatus).toHaveBeenCalledWith("evt-1", "batch-1", expect.any(AbortSignal));
      expect(addToast).toHaveBeenCalledWith("Send complete: 1 ticket sent.", "success");
    });
  });

  it("toasts info when bulk-send status polling throws", async () => {
    fetchEventAttendees.mockResolvedValue({ items: [rowA], total: 1, page: 1, pageSize: 25 });
    sendEventBulk.mockResolvedValue({ batchId: "batch-err", queued: 1, skipped: 0, failed: 0 });
    fetchBulkSendStatus.mockRejectedValue(new Error("network down"));

    renderPage();
    await screen.findByText("Jane Doe");
    fireEvent.click(screen.getByRole("checkbox", { name: "Select Jane Doe" }));
    fireEvent.click(bulkBar().getByRole("button", { name: "Send tickets" }));
    fireEvent.click(within(screen.getByRole("dialog", { name: "Send tickets?" })).getByRole("button", { name: "Send" }));

    await waitFor(() => {
      expect(addToast).toHaveBeenCalledWith(
        "Could not refresh send status. Check Communication.",
        "info",
      );
    });
  });

  it("does not toast poll errors after selected-send polling was aborted on unmount", async () => {
    fetchEventAttendees.mockResolvedValue({ items: [rowA], total: 1, page: 1, pageSize: 25 });
    sendEventBulk.mockResolvedValue({ batchId: "batch-abort", queued: 1, skipped: 0, failed: 0 });
    pollBulkSendCompletion.mockImplementationOnce(async (_eventId, _batchId, _addToast, options) => {
      const signal = options?.signal;
      await new Promise<void>((_resolve, reject) => {
        const fail = () => reject(new Error("stale poll"));
        if (signal?.aborted) {
          fail();
          return;
        }
        signal?.addEventListener("abort", fail, { once: true });
      });
    });

    const { unmount } = renderPage();
    await screen.findByText("Jane Doe");
    fireEvent.click(screen.getByRole("checkbox", { name: "Select Jane Doe" }));
    fireEvent.click(bulkBar().getByRole("button", { name: "Send tickets" }));
    fireEvent.click(within(screen.getByRole("dialog", { name: "Send tickets?" })).getByRole("button", { name: "Send" }));

    await waitFor(() => {
      expect(pollBulkSendCompletion).toHaveBeenCalled();
    });
    unmount();

    await waitFor(() => {
      expect(addToast).not.toHaveBeenCalledWith(
        "Could not refresh send status. Check Communication.",
        "info",
      );
    });
  });

  it("aborts an in-flight selected-send poll when another selected send starts", async () => {
    fetchEventAttendees.mockResolvedValue({ items: [rowA, rowB], total: 2, page: 1, pageSize: 25 });
    sendEventBulk
      .mockResolvedValueOnce({ batchId: "batch-a", queued: 1, skipped: 0, failed: 0 })
      .mockResolvedValueOnce({ batchId: "batch-b", queued: 1, skipped: 0, failed: 0 });

    const firstSignalRef: { current?: AbortSignal } = {};
    pollBulkSendCompletion.mockImplementation(async (_eventId, batchId, _addToast, options) => {
      if (batchId === "batch-a") {
        firstSignalRef.current = options?.signal;
        await new Promise<void>((_resolve, reject) => {
          options?.signal?.addEventListener(
            "abort",
            () => reject(new DOMException("Aborted", "AbortError")),
            { once: true },
          );
        });
        return;
      }
      return getPollBulkSendCompletionActual()(
        _eventId,
        batchId,
        _addToast,
        options,
      );
    });

    renderPage();
    await screen.findByText("Jane Doe");
    fireEvent.click(screen.getByRole("checkbox", { name: "Select Jane Doe" }));
    fireEvent.click(bulkBar().getByRole("button", { name: "Send tickets" }));
    fireEvent.click(within(screen.getByRole("dialog", { name: "Send tickets?" })).getByRole("button", { name: "Send" }));

    await waitFor(() => expect(firstSignalRef.current).toBeTruthy());

    fireEvent.click(screen.getByRole("checkbox", { name: "Select John Smith" }));
    await waitFor(() => expect(document.querySelector(".attendees-bulkbar")).toBeTruthy());
    fireEvent.click(bulkBar().getByRole("button", { name: "Send tickets" }));
    fireEvent.click(within(screen.getByRole("dialog", { name: "Send tickets?" })).getByRole("button", { name: "Send" }));

    await waitFor(() => {
      expect(firstSignalRef.current?.aborted).toBe(true);
      expect(pollBulkSendCompletion).toHaveBeenCalledWith(
        "evt-1",
        "batch-b",
        addToast,
        expect.objectContaining({ signal: expect.any(AbortSignal) }),
      );
    });
  });

  it("does not poll bulk-send status when enqueue queues nothing", async () => {
    fetchEventAttendees.mockResolvedValue({ items: [rowA], total: 1, page: 1, pageSize: 25 });
    sendEventBulk.mockResolvedValue({ batchId: null, queued: 0, skipped: 1, failed: 0 });

    renderPage();
    await screen.findByText("Jane Doe");
    fireEvent.click(screen.getByRole("checkbox", { name: "Select Jane Doe" }));
    fireEvent.click(bulkBar().getByRole("button", { name: "Send tickets" }));
    fireEvent.click(within(screen.getByRole("dialog", { name: "Send tickets?" })).getByRole("button", { name: "Send" }));

    await waitFor(() => {
      expect(addToast).toHaveBeenCalledWith("No tickets were queued (1 skipped).", "info");
    });
    expect(fetchBulkSendStatus).not.toHaveBeenCalled();
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
    fireEvent.click(within(confirmDialog).getByRole("button", { name: "Send" }));

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
    fireEvent.click(within(dialog).getByRole("button", { name: "Delete" }));

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
    fireEvent.click(within(dialog).getByRole("button", { name: "Delete" }));

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
      fireEvent.click(within(dialog).getByRole("button", { name: "Delete" }));

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
    fireEvent.click(within(dialog).getByRole("button", { name: "Delete" }));

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
    fireEvent.click(within(dialog).getByRole("button", { name: "Delete" }));

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
    fireEvent.click(within(dialog).getByRole("button", { name: "Delete" }));

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
    fireEvent.click(within(dialog).getByRole("button", { name: "Delete" }));

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

  it("still clears the busy/spinner state after navigating away mid-request, even though the toast and dialog-close side effects are skipped (CodeRabbit review)", async () => {
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
    fireEvent.click(within(dialog).getByRole("button", { name: "Delete" }));
    await waitFor(() => expect(within(dialog).getByRole("button", { name: "Working…" })).toBeTruthy());

    await act(async () => router.navigate("/admin/events/evt-2/attendees"));
    await waitFor(() => {
      expect(fetchEventAttendees).toHaveBeenCalledWith("evt-2", expect.anything(), expect.anything());
    });

    await act(async () => {
      resolveDelete({ deletedCount: 1 });
      await Promise.resolve();
    });

    // The dialog itself stays open (closing it is a skipped success side effect, same as the
    // toast covered above) but its busy state is this component's own local state, not tied to
    // which event initiated the request — it must still clear, or the confirm button is stuck
    // reading "Working…" forever once the operator has navigated away.
    await waitFor(() => {
      expect(within(dialog).getByRole("button", { name: "Delete" })).toBeTruthy();
    });
  });
});

describe("AttendeesPage bulk revoke pass (#549)", () => {
  it("revokes the pass for the selected attendees via the More actions menu, toasts, and clears the selection", async () => {
    fetchEventAttendees.mockResolvedValue({ items: [rowA, rowB, rowC], total: 3, page: 1, pageSize: 25 });
    bulkRevokePass.mockResolvedValue({ revoked: 2, skipped: 0, errored: 0 });

    renderPage();

    await screen.findByText("Jane Doe");
    fireEvent.click(screen.getByRole("checkbox", { name: "Select Jane Doe" }));
    fireEvent.click(screen.getByRole("checkbox", { name: "Select John Smith" }));
    await waitFor(() => expect(bulkBar().getByText("2")).toBeTruthy());

    const dialog = openMenuItemAndArmDialog(/Revoke pass/);
    fireEvent.click(within(dialog).getByRole("button", { name: "Revoke" }));

    await waitFor(() => {
      expect(bulkRevokePass).toHaveBeenCalledWith("evt-1", ["att-1", "att-2"]);
    });
    await waitFor(() => {
      expect(addToast).toHaveBeenCalledWith("2 passes revoked.", "success");
    });
    await waitFor(() => expect(document.querySelector(".attendees-bulkbar")).toBeNull());
  });

  it("toasts that everyone was already revoked or cancelled when nobody new was revoked", async () => {
    fetchEventAttendees.mockResolvedValue({ items: [rowA, rowB, rowC], total: 3, page: 1, pageSize: 25 });
    bulkRevokePass.mockResolvedValue({ revoked: 0, skipped: 1, errored: 0 });

    renderPage();

    await screen.findByText("Jane Doe");
    fireEvent.click(screen.getByRole("checkbox", { name: "Select Jane Doe" }));
    await waitFor(() => expect(document.querySelector(".attendees-bulkbar")).toBeTruthy());

    const dialog = openMenuItemAndArmDialog(/Revoke pass/);
    fireEvent.click(within(dialog).getByRole("button", { name: "Revoke" }));

    await waitFor(() => {
      expect(addToast).toHaveBeenCalledWith("All selected attendees were already revoked or cancelled.", "info");
    });
  });

  it("doesn't claim everyone was already revoked when a mixed batch also had unexpected failures (code review)", async () => {
    fetchEventAttendees.mockResolvedValue({ items: [rowA, rowB, rowC], total: 3, page: 1, pageSize: 25 });
    bulkRevokePass.mockResolvedValue({ revoked: 0, skipped: 1, errored: 1 });

    renderPage();

    await screen.findByText("Jane Doe");
    fireEvent.click(screen.getByRole("checkbox", { name: "Select Jane Doe" }));
    await waitFor(() => expect(document.querySelector(".attendees-bulkbar")).toBeTruthy());

    const dialog = openMenuItemAndArmDialog(/Revoke pass/);
    fireEvent.click(within(dialog).getByRole("button", { name: "Revoke" }));

    await waitFor(() => {
      expect(addToast).toHaveBeenCalledWith(
        "No passes revoked (1 already revoked or cancelled, 1 failed unexpectedly).",
        "error",
      );
    });
    expect(addToast).not.toHaveBeenCalledWith(
      "All selected attendees were already revoked or cancelled.",
      "info",
    );
  });

  it("shows an operator-safe error inside the dialog and keeps the selection when bulkRevokePass fails", async () => {
    const { ApiError } = await import("../../src/api/client.js");
    fetchEventAttendees.mockResolvedValue({ items: [rowA, rowB, rowC], total: 3, page: 1, pageSize: 25 });
    bulkRevokePass.mockRejectedValueOnce(new ApiError(500, "secret_internal"));

    renderPage();

    await screen.findByText("Jane Doe");
    fireEvent.click(screen.getByRole("checkbox", { name: "Select Jane Doe" }));
    await waitFor(() => expect(document.querySelector(".attendees-bulkbar")).toBeTruthy());

    const dialog = openMenuItemAndArmDialog(/Revoke pass/);
    fireEvent.click(within(dialog).getByRole("button", { name: "Revoke" }));

    // Inline in the dialog, not a toast - matches bulk delete's own convention.
    await screen.findByText("Revoke pass failed.");
    expect(addToast).not.toHaveBeenCalled();
    expect(document.querySelector(".attendees-bulkbar")).toBeTruthy();
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
      bulkRevokePass.mockRejectedValueOnce(new ApiError(401, "unauthorized"));

      renderPage();

      await screen.findByText("Jane Doe");
      fireEvent.click(screen.getByRole("checkbox", { name: "Select Jane Doe" }));
      await waitFor(() => expect(document.querySelector(".attendees-bulkbar")).toBeTruthy());

      const dialog = openMenuItemAndArmDialog(/Revoke pass/);
      fireEvent.click(within(dialog).getByRole("button", { name: "Revoke" }));

      await waitFor(() => {
        expect(assignSpy).toHaveBeenCalledWith(expect.stringContaining("/login?next="));
      });
      expect(reportApiError).toHaveBeenCalledWith(401);
    } finally {
      if (locationDescriptor) Object.defineProperty(window, "location", locationDescriptor);
    }
  });

  it("shows a generic inline error when bulkRevokePass rejects with something other than ApiError", async () => {
    fetchEventAttendees.mockResolvedValue({ items: [rowA, rowB, rowC], total: 3, page: 1, pageSize: 25 });
    bulkRevokePass.mockRejectedValueOnce(new Error("network down"));

    renderPage();

    await screen.findByText("Jane Doe");
    fireEvent.click(screen.getByRole("checkbox", { name: "Select Jane Doe" }));
    await waitFor(() => expect(document.querySelector(".attendees-bulkbar")).toBeTruthy());

    const dialog = openMenuItemAndArmDialog(/Revoke pass/);
    fireEvent.click(within(dialog).getByRole("button", { name: "Revoke" }));

    await screen.findByText("Failed to revoke pass.");
    expect(addToast).not.toHaveBeenCalled();
  });

  it("ignores a stale bulk-revoke-pass error after navigating to a different event mid-request", async () => {
    let rejectRevoke!: (err: unknown) => void;
    fetchEventAttendees.mockResolvedValue({ items: [rowA, rowB, rowC], total: 3, page: 1, pageSize: 25 });
    bulkRevokePass.mockReturnValueOnce(
      new Promise((_resolve, reject) => {
        rejectRevoke = reject;
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

    const dialog = openMenuItemAndArmDialog(/Revoke pass/);
    fireEvent.click(within(dialog).getByRole("button", { name: "Revoke" }));

    await act(async () => router.navigate("/admin/events/evt-2/attendees"));
    await waitFor(() => {
      expect(fetchEventAttendees).toHaveBeenCalledWith("evt-2", expect.anything(), expect.anything());
    });

    await act(async () => {
      rejectRevoke(new Error("network down"));
      await Promise.resolve();
    });

    expect(addToast).not.toHaveBeenCalled();
    expect(screen.queryByText("Failed to revoke pass.")).toBeNull();
  });

  it("ignores a stale bulk-revoke-pass completion after navigating to a different event mid-request", async () => {
    let resolveRevoke!: (value: { revoked: number; skipped: number; errored: number }) => void;
    fetchEventAttendees.mockResolvedValue({ items: [rowA, rowB, rowC], total: 3, page: 1, pageSize: 25 });
    bulkRevokePass.mockReturnValueOnce(
      new Promise((resolve) => {
        resolveRevoke = resolve;
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

    const dialog = openMenuItemAndArmDialog(/Revoke pass/);
    fireEvent.click(within(dialog).getByRole("button", { name: "Revoke" }));

    await act(async () => router.navigate("/admin/events/evt-2/attendees"));
    await waitFor(() => {
      expect(fetchEventAttendees).toHaveBeenCalledWith("evt-2", expect.anything(), expect.anything());
    });

    await act(async () => {
      resolveRevoke({ revoked: 1, skipped: 0, errored: 0 });
      await Promise.resolve();
    });

    expect(addToast).not.toHaveBeenCalledWith(expect.stringContaining("revoked"), "success");
  });

  it("Cancel closes the bulk-revoke-pass dialog without calling bulkRevokePass", async () => {
    fetchEventAttendees.mockResolvedValue({ items: [rowA, rowB, rowC], total: 3, page: 1, pageSize: 25 });

    renderPage();

    await screen.findByText("Jane Doe");
    fireEvent.click(screen.getByRole("checkbox", { name: "Select Jane Doe" }));
    await waitFor(() => expect(document.querySelector(".attendees-bulkbar")).toBeTruthy());

    const dialog = openMenuItemAndArmDialog(/Revoke pass/);
    fireEvent.click(within(dialog).getByRole("button", { name: "Cancel" }));

    expect(screen.queryByRole("dialog")).toBeNull();
    expect(bulkRevokePass).not.toHaveBeenCalled();
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

describe("AttendeesPage bulk revoke check-in (#522 follow-up)", () => {
  const rowAdmitted = { ...rowA, check_in_status: "admitted" as const };

  it("revokes check-in for the selected attendees via the More actions menu, toasts, and clears the selection", async () => {
    fetchEventAttendees.mockResolvedValue({ items: [rowAdmitted, rowB, rowC], total: 3, page: 1, pageSize: 25 });
    bulkRevokeCheckIn.mockResolvedValue({ revoked: 1, notAdmitted: 0, blocked: 0, errored: 0 });

    renderPage();

    await screen.findByText("Jane Doe");
    fireEvent.click(screen.getByRole("checkbox", { name: "Select Jane Doe" }));
    await waitFor(() => expect(document.querySelector(".attendees-bulkbar")).toBeTruthy());

    const dialog = openMenuItemAndArmDialog(/Revoke check-in/);
    fireEvent.click(within(dialog).getByRole("button", { name: "Revoke" }));

    await waitFor(() => {
      expect(bulkRevokeCheckIn).toHaveBeenCalledWith("evt-1", ["att-1"]);
    });
    await waitFor(() => {
      expect(addToast).toHaveBeenCalledWith("1 check-in revoked.", "success");
    });
    await waitFor(() => expect(document.querySelector(".attendees-bulkbar")).toBeNull());
  });

  it("toasts that nobody was checked in when the whole selection had nothing to revoke", async () => {
    fetchEventAttendees.mockResolvedValue({ items: [rowAdmitted, rowB, rowC], total: 3, page: 1, pageSize: 25 });
    bulkRevokeCheckIn.mockResolvedValue({ revoked: 0, notAdmitted: 1, blocked: 0, errored: 0 });

    renderPage();

    await screen.findByText("Jane Doe");
    fireEvent.click(screen.getByRole("checkbox", { name: "Select Jane Doe" }));
    await waitFor(() => expect(document.querySelector(".attendees-bulkbar")).toBeTruthy());

    const dialog = openMenuItemAndArmDialog(/Revoke check-in/);
    fireEvent.click(within(dialog).getByRole("button", { name: "Revoke" }));

    await waitFor(() => {
      expect(addToast).toHaveBeenCalledWith("None of the selected attendees were checked in.", "info");
    });
  });

  it("doesn't claim nobody was checked in when a blocked-pass attendee was actually checked in (code review)", async () => {
    fetchEventAttendees.mockResolvedValue({ items: [rowAdmitted, rowB, rowC], total: 3, page: 1, pageSize: 25 });
    bulkRevokeCheckIn.mockResolvedValue({ revoked: 0, notAdmitted: 1, blocked: 1, errored: 0 });

    renderPage();

    await screen.findByText("Jane Doe");
    fireEvent.click(screen.getByRole("checkbox", { name: "Select Jane Doe" }));
    await waitFor(() => expect(document.querySelector(".attendees-bulkbar")).toBeTruthy());

    const dialog = openMenuItemAndArmDialog(/Revoke check-in/);
    fireEvent.click(within(dialog).getByRole("button", { name: "Revoke" }));

    await waitFor(() => {
      expect(addToast).toHaveBeenCalledWith(
        "No check-ins revoked (1 weren't checked in, 1 pass no longer active).",
        "error",
      );
    });
    expect(addToast).not.toHaveBeenCalledWith("None of the selected attendees were checked in.", "info");
  });

  it("shows an operator-safe error inside the dialog and keeps the selection when bulkRevokeCheckIn fails", async () => {
    const { ApiError } = await import("../../src/api/client.js");
    fetchEventAttendees.mockResolvedValue({ items: [rowAdmitted, rowB, rowC], total: 3, page: 1, pageSize: 25 });
    bulkRevokeCheckIn.mockRejectedValueOnce(new ApiError(500, "secret_internal"));

    renderPage();

    await screen.findByText("Jane Doe");
    fireEvent.click(screen.getByRole("checkbox", { name: "Select Jane Doe" }));
    await waitFor(() => expect(document.querySelector(".attendees-bulkbar")).toBeTruthy());

    const dialog = openMenuItemAndArmDialog(/Revoke check-in/);
    fireEvent.click(within(dialog).getByRole("button", { name: "Revoke" }));

    // Inline in the dialog, not a toast - matches bulk revoke pass/items' own convention.
    await screen.findByText("Revoke check-in failed.");
    expect(addToast).not.toHaveBeenCalled();
    expect(document.querySelector(".attendees-bulkbar")).toBeTruthy();
  });

  it("toasts a warning with the failure count when some check-ins errored unexpectedly", async () => {
    fetchEventAttendees.mockResolvedValue({ items: [rowAdmitted, rowB, rowC], total: 3, page: 1, pageSize: 25 });
    bulkRevokeCheckIn.mockResolvedValue({ revoked: 1, notAdmitted: 0, blocked: 0, errored: 2 });

    renderPage();

    await screen.findByText("Jane Doe");
    fireEvent.click(screen.getByRole("checkbox", { name: "Select Jane Doe" }));
    await waitFor(() => expect(document.querySelector(".attendees-bulkbar")).toBeTruthy());

    const dialog = openMenuItemAndArmDialog(/Revoke check-in/);
    fireEvent.click(within(dialog).getByRole("button", { name: "Revoke" }));

    await waitFor(() => {
      expect(addToast).toHaveBeenCalledWith("1 check-in revoked (2 failed unexpectedly).", "warning");
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
      fetchEventAttendees.mockResolvedValue({ items: [rowAdmitted, rowB, rowC], total: 3, page: 1, pageSize: 25 });
      bulkRevokeCheckIn.mockRejectedValueOnce(new ApiError(401, "unauthorized"));

      renderPage();

      await screen.findByText("Jane Doe");
      fireEvent.click(screen.getByRole("checkbox", { name: "Select Jane Doe" }));
      await waitFor(() => expect(document.querySelector(".attendees-bulkbar")).toBeTruthy());

      const dialog = openMenuItemAndArmDialog(/Revoke check-in/);
      fireEvent.click(within(dialog).getByRole("button", { name: "Revoke" }));

      await waitFor(() => {
        expect(assignSpy).toHaveBeenCalledWith(expect.stringContaining("/login?next="));
      });
      expect(reportApiError).toHaveBeenCalledWith(401);
    } finally {
      if (locationDescriptor) Object.defineProperty(window, "location", locationDescriptor);
    }
  });

  it("shows a generic inline error when bulkRevokeCheckIn rejects with something other than ApiError", async () => {
    fetchEventAttendees.mockResolvedValue({ items: [rowAdmitted, rowB, rowC], total: 3, page: 1, pageSize: 25 });
    bulkRevokeCheckIn.mockRejectedValueOnce(new Error("network down"));

    renderPage();

    await screen.findByText("Jane Doe");
    fireEvent.click(screen.getByRole("checkbox", { name: "Select Jane Doe" }));
    await waitFor(() => expect(document.querySelector(".attendees-bulkbar")).toBeTruthy());

    const dialog = openMenuItemAndArmDialog(/Revoke check-in/);
    fireEvent.click(within(dialog).getByRole("button", { name: "Revoke" }));

    await screen.findByText("Failed to revoke check-in.");
    expect(addToast).not.toHaveBeenCalled();
  });

  it("ignores a stale bulk-revoke-check-in error after navigating to a different event mid-request", async () => {
    let rejectRevoke!: (err: unknown) => void;
    fetchEventAttendees.mockResolvedValue({ items: [rowAdmitted, rowB, rowC], total: 3, page: 1, pageSize: 25 });
    bulkRevokeCheckIn.mockReturnValueOnce(
      new Promise((_resolve, reject) => {
        rejectRevoke = reject;
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

    const dialog = openMenuItemAndArmDialog(/Revoke check-in/);
    fireEvent.click(within(dialog).getByRole("button", { name: "Revoke" }));

    await act(async () => router.navigate("/admin/events/evt-2/attendees"));
    await waitFor(() => {
      expect(fetchEventAttendees).toHaveBeenCalledWith("evt-2", expect.anything(), expect.anything());
    });

    await act(async () => {
      rejectRevoke(new Error("network down"));
      await Promise.resolve();
    });

    expect(addToast).not.toHaveBeenCalledWith(expect.stringContaining("Revoke"), "error");
    expect(addToast).not.toHaveBeenCalledWith("Failed to revoke check-in.", "error");
  });

  it("ignores a stale bulk-revoke-check-in completion after navigating to a different event mid-request", async () => {
    let resolveRevoke!: (value: {
      revoked: number;
      notAdmitted: number;
      blocked: number;
      errored: number;
    }) => void;
    fetchEventAttendees.mockResolvedValue({ items: [rowAdmitted, rowB, rowC], total: 3, page: 1, pageSize: 25 });
    bulkRevokeCheckIn.mockReturnValueOnce(
      new Promise((resolve) => {
        resolveRevoke = resolve;
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

    const dialog = openMenuItemAndArmDialog(/Revoke check-in/);
    fireEvent.click(within(dialog).getByRole("button", { name: "Revoke" }));

    await act(async () => router.navigate("/admin/events/evt-2/attendees"));
    await waitFor(() => {
      expect(fetchEventAttendees).toHaveBeenCalledWith("evt-2", expect.anything(), expect.anything());
    });

    await act(async () => {
      resolveRevoke({ revoked: 1, notAdmitted: 0, blocked: 0, errored: 0 });
      await Promise.resolve();
    });

    expect(addToast).not.toHaveBeenCalledWith(expect.stringContaining("revoked"), "success");
  });

  it("Cancel closes the bulk-revoke-check-in dialog without calling bulkRevokeCheckIn", async () => {
    fetchEventAttendees.mockResolvedValue({ items: [rowAdmitted, rowB, rowC], total: 3, page: 1, pageSize: 25 });

    renderPage();

    await screen.findByText("Jane Doe");
    fireEvent.click(screen.getByRole("checkbox", { name: "Select Jane Doe" }));
    await waitFor(() => expect(document.querySelector(".attendees-bulkbar")).toBeTruthy());

    fireEvent.click(bulkBar().getByRole("button", { name: "More actions" }));
    fireEvent.click(bulkBar().getByRole("menuitem", { name: /Revoke check-in/ }));
    const dialog = screen.getByRole("dialog");
    fireEvent.click(within(dialog).getByRole("button", { name: "Cancel" }));

    expect(screen.queryByRole("dialog")).toBeNull();
    expect(bulkRevokeCheckIn).not.toHaveBeenCalled();
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
    const dialog = clickMenuItemAndArmDialog(/Change ticket type/, "Change ticket type");
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

  it("closes the picker on Cancel without applying anything, and keeps the selection", async () => {
    fetchEventAttendees.mockResolvedValue({ items: [rowA, rowB, rowC], total: 3, page: 1, pageSize: 25 });
    fetchTicketTypes.mockResolvedValue(catalog);

    await selectTwoRowsAndOpenMenu();
    fireEvent.click(bulkBar().getByRole("menuitem", { name: /Change ticket type/ }));
    const dialog = screen.getByRole("dialog", { name: "Change ticket type" });
    fireEvent.click(within(dialog).getByRole("button", { name: "Cancel" }));

    expect(screen.queryByRole("dialog", { name: "Change ticket type" })).toBeNull();
    expect(bulkChangeTicketType).not.toHaveBeenCalled();
    expect(document.querySelector(".attendees-bulkbar")).toBeTruthy();
  });

  it("notes attendees that already had the type in the success toast", async () => {
    fetchEventAttendees.mockResolvedValue({ items: [rowA, rowB, rowC], total: 3, page: 1, pageSize: 25 });
    fetchTicketTypes.mockResolvedValue(catalog);
    bulkChangeTicketType.mockResolvedValue({ updatedCount: 1, alreadySetCount: 1 });

    await selectTwoRowsAndOpenMenu();
    const dialog = clickMenuItemAndArmDialog(/Change ticket type/, "Change ticket type");
    fireEvent.click(within(dialog).getByRole("button", { name: "Apply" }));

    await waitFor(() => {
      expect(addToast).toHaveBeenCalledWith("1 attendee set to VIP (1 already had it)", "success");
    });
  });

  it("notes attendees skipped by a concurrent edit alongside the success toast (bot review: CAS race fix)", async () => {
    fetchEventAttendees.mockResolvedValue({ items: [rowA, rowB, rowC], total: 3, page: 1, pageSize: 25 });
    fetchTicketTypes.mockResolvedValue(catalog);
    bulkChangeTicketType.mockResolvedValue({ updatedCount: 1, alreadySetCount: 0, conflictCount: 1 });

    await selectTwoRowsAndOpenMenu();
    const dialog = clickMenuItemAndArmDialog(/Change ticket type/, "Change ticket type");
    fireEvent.click(within(dialog).getByRole("button", { name: "Apply" }));

    await waitFor(() => {
      expect(addToast).toHaveBeenCalledWith(
        "1 attendee set to VIP (1 skipped, changed by someone else just now)",
        "success",
      );
    });
  });

  it("toasts info when every selected attendee already has the type", async () => {
    fetchEventAttendees.mockResolvedValue({ items: [rowA, rowB, rowC], total: 3, page: 1, pageSize: 25 });
    fetchTicketTypes.mockResolvedValue(catalog);
    bulkChangeTicketType.mockResolvedValue({ updatedCount: 0, alreadySetCount: 2 });

    await selectTwoRowsAndOpenMenu();
    const dialog = clickMenuItemAndArmDialog(/Change ticket type/, "Change ticket type");
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
    const dialog = clickMenuItemAndArmDialog(/Change ticket type/, "Change ticket type");
    fireEvent.click(within(dialog).getByRole("button", { name: "Apply" }));

    await waitFor(() => {
      expect(addToast).toHaveBeenCalledWith(
        "None of the selected attendees could be found. They may have been removed.",
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
    const dialog = clickMenuItemAndArmDialog(/Change ticket type/, "Change ticket type");
    fireEvent.click(within(dialog).getByRole("button", { name: "Apply" }));

    await waitFor(() => {
      expect(within(dialog).getByRole("alert").textContent).toContain("no longer exists");
    });
    // Dialog stays open, selection survives, no toast for a dialog-scoped error.
    expect(screen.getByRole("dialog", { name: "Change ticket type" })).toBeTruthy();
    expect(document.querySelector(".attendees-bulkbar")).toBeTruthy();
    expect(addToast).not.toHaveBeenCalled();
  });

  it("redirects to /login on a 401", async () => {
    const { ApiError } = await import("../../src/api/client.js");
    fetchTicketTypes.mockResolvedValue(catalog);
    bulkChangeTicketType.mockRejectedValueOnce(new ApiError(401, "unauthorized"));
    const assign = vi.fn();
    vi.stubGlobal("location", { ...window.location, assign, pathname: "/admin/events/evt-1/attendees" });

    await selectTwoRowsAndOpenMenu();
    const dialog = clickMenuItemAndArmDialog(/Change ticket type/, "Change ticket type");
    fireEvent.click(within(dialog).getByRole("button", { name: "Apply" }));

    await waitFor(() => {
      expect(assign).toHaveBeenCalledWith(
        `/login?next=${encodeURIComponent("/admin/events/evt-1/attendees")}`,
      );
    });
  });

  it("shows a generic inline error in the dialog when the failure isn't an ApiError", async () => {
    fetchTicketTypes.mockResolvedValue(catalog);
    bulkChangeTicketType.mockRejectedValueOnce(new TypeError("Failed to fetch"));

    await selectTwoRowsAndOpenMenu();
    const dialog = clickMenuItemAndArmDialog(/Change ticket type/, "Change ticket type");
    fireEvent.click(within(dialog).getByRole("button", { name: "Apply" }));

    await waitFor(() => {
      expect(within(dialog).getByRole("alert").textContent).toBe("Failed to change ticket type.");
    });
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
    expect(getTooltipText(item)).toContain("No ticket types configured");
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
    expect(getTooltipText(item)).not.toContain("No ticket types configured");
    expect(getTooltipText(item)).toContain("Couldn't load ticket types");
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

describe("AttendeesPage bulk change attendance status", () => {
  async function selectTwoRowsAndOpenMenu() {
    renderPage();
    await screen.findByText("Jane Doe");
    fireEvent.click(screen.getByRole("checkbox", { name: "Select Jane Doe" }));
    fireEvent.click(screen.getByRole("checkbox", { name: "Select John Smith" }));
    await waitFor(() => expect(bulkBar().getByText("2")).toBeTruthy());
    fireEvent.click(bulkBar().getByRole("button", { name: "More actions" }));
  }

  it("opens the picker with the fixed 5 statuses, applies, toasts, and clears the selection", async () => {
    fetchEventAttendees.mockResolvedValue({ items: [rowA, rowB, rowC], total: 3, page: 1, pageSize: 25 });
    bulkChangeRsvpStatus.mockResolvedValue({ updatedCount: 2, alreadySetCount: 0 });

    await selectTwoRowsAndOpenMenu();
    const item = bulkBar().getByRole("menuitem", { name: /Change attendance status/ });
    expect(item.textContent).toContain("Set for 2 attendees");
    const dialog = clickMenuItemAndArmDialog(/Change attendance status/, "Change attendance status");
    expect(within(dialog).getByRole("radio", { name: "Confirmed" })).toBeTruthy();
    fireEvent.click(within(dialog).getByRole("radio", { name: "Declined" }));
    fireEvent.click(within(dialog).getByRole("button", { name: "Apply" }));

    await waitFor(() => {
      expect(bulkChangeRsvpStatus).toHaveBeenCalledWith("evt-1", ["att-1", "att-2"], "declined");
    });
    await waitFor(() => {
      expect(addToast).toHaveBeenCalledWith('2 attendees set to "Declined"', "success");
    });
    await waitFor(() => expect(document.querySelector(".attendees-bulkbar")).toBeNull());
  });

  it("closes the picker on Cancel without applying anything, and keeps the selection", async () => {
    fetchEventAttendees.mockResolvedValue({ items: [rowA, rowB, rowC], total: 3, page: 1, pageSize: 25 });

    await selectTwoRowsAndOpenMenu();
    fireEvent.click(bulkBar().getByRole("menuitem", { name: /Change attendance status/ }));
    const dialog = screen.getByRole("dialog", { name: "Change attendance status" });
    fireEvent.click(within(dialog).getByRole("button", { name: "Cancel" }));

    expect(screen.queryByRole("dialog", { name: "Change attendance status" })).toBeNull();
    expect(bulkChangeRsvpStatus).not.toHaveBeenCalled();
    expect(document.querySelector(".attendees-bulkbar")).toBeTruthy();
  });

  it("notes attendees that already had the status in the success toast", async () => {
    fetchEventAttendees.mockResolvedValue({ items: [rowA, rowB, rowC], total: 3, page: 1, pageSize: 25 });
    bulkChangeRsvpStatus.mockResolvedValue({ updatedCount: 1, alreadySetCount: 1 });

    await selectTwoRowsAndOpenMenu();
    const dialog = clickMenuItemAndArmDialog(/Change attendance status/, "Change attendance status");
    fireEvent.click(within(dialog).getByRole("button", { name: "Apply" }));

    await waitFor(() => {
      expect(addToast).toHaveBeenCalledWith('1 attendee set to "Confirmed" (1 already had it)', "success");
    });
  });

  it("toasts info when every selected attendee already has the status", async () => {
    fetchEventAttendees.mockResolvedValue({ items: [rowA, rowB, rowC], total: 3, page: 1, pageSize: 25 });
    bulkChangeRsvpStatus.mockResolvedValue({ updatedCount: 0, alreadySetCount: 2 });

    await selectTwoRowsAndOpenMenu();
    const dialog = clickMenuItemAndArmDialog(/Change attendance status/, "Change attendance status");
    fireEvent.click(within(dialog).getByRole("button", { name: "Apply" }));

    await waitFor(() => {
      expect(addToast).toHaveBeenCalledWith(
        'All selected attendees already have attendance status "Confirmed".',
        "info",
      );
    });
  });

  it("toasts an error (not the 'already had it' message) when none of the selected attendees could be found", async () => {
    fetchEventAttendees.mockResolvedValue({ items: [rowA, rowB, rowC], total: 3, page: 1, pageSize: 25 });
    bulkChangeRsvpStatus.mockResolvedValue({ updatedCount: 0, alreadySetCount: 0 });

    await selectTwoRowsAndOpenMenu();
    const dialog = clickMenuItemAndArmDialog(/Change attendance status/, "Change attendance status");
    fireEvent.click(within(dialog).getByRole("button", { name: "Apply" }));

    await waitFor(() => {
      expect(addToast).toHaveBeenCalledWith(
        "None of the selected attendees could be found. They may have been removed.",
        "error",
      );
    });
    expect(addToast).not.toHaveBeenCalledWith(expect.stringContaining("already have"), expect.anything());
  });

  it("notes attendees skipped by a concurrent edit alongside the success toast (bot review: CAS race fix)", async () => {
    fetchEventAttendees.mockResolvedValue({ items: [rowA, rowB, rowC], total: 3, page: 1, pageSize: 25 });
    bulkChangeRsvpStatus.mockResolvedValue({ updatedCount: 1, alreadySetCount: 0, conflictCount: 1 });

    await selectTwoRowsAndOpenMenu();
    const dialog = clickMenuItemAndArmDialog(/Change attendance status/, "Change attendance status");
    fireEvent.click(within(dialog).getByRole("button", { name: "Apply" }));

    await waitFor(() => {
      expect(addToast).toHaveBeenCalledWith(
        '1 attendee set to "Confirmed" (1 skipped, changed by someone else just now)',
        "success",
      );
    });
  });

  it("includes the conflict note alongside the already-set info toast", async () => {
    fetchEventAttendees.mockResolvedValue({ items: [rowA, rowB, rowC], total: 3, page: 1, pageSize: 25 });
    bulkChangeRsvpStatus.mockResolvedValue({ updatedCount: 0, alreadySetCount: 1, conflictCount: 1 });

    await selectTwoRowsAndOpenMenu();
    const dialog = clickMenuItemAndArmDialog(/Change attendance status/, "Change attendance status");
    fireEvent.click(within(dialog).getByRole("button", { name: "Apply" }));

    await waitFor(() => {
      expect(addToast).toHaveBeenCalledWith(
        'All selected attendees already have attendance status "Confirmed" (1 skipped, changed by someone else just now).',
        "info",
      );
    });
  });

  it("toasts a warning (not the 'none found' error) when every selected attendee lost the race to a concurrent edit", async () => {
    fetchEventAttendees.mockResolvedValue({ items: [rowA, rowB, rowC], total: 3, page: 1, pageSize: 25 });
    bulkChangeRsvpStatus.mockResolvedValue({ updatedCount: 0, alreadySetCount: 0, conflictCount: 2 });

    await selectTwoRowsAndOpenMenu();
    const dialog = clickMenuItemAndArmDialog(/Change attendance status/, "Change attendance status");
    fireEvent.click(within(dialog).getByRole("button", { name: "Apply" }));

    await waitFor(() => {
      expect(addToast).toHaveBeenCalledWith(
        "No attendees were updated (2 skipped, changed by someone else just now).",
        "warning",
      );
    });
    expect(addToast).not.toHaveBeenCalledWith(expect.stringContaining("may have been removed"), expect.anything());
  });

  it("redirects to /login on a 401", async () => {
    const { ApiError } = await import("../../src/api/client.js");
    bulkChangeRsvpStatus.mockRejectedValueOnce(new ApiError(401, "unauthorized"));
    const assign = vi.fn();
    vi.stubGlobal("location", { ...window.location, assign, pathname: "/admin/events/evt-1/attendees" });

    await selectTwoRowsAndOpenMenu();
    const dialog = clickMenuItemAndArmDialog(/Change attendance status/, "Change attendance status");
    fireEvent.click(within(dialog).getByRole("button", { name: "Apply" }));

    await waitFor(() => {
      expect(assign).toHaveBeenCalledWith(
        `/login?next=${encodeURIComponent("/admin/events/evt-1/attendees")}`,
      );
    });
  });

  it("shows a generic inline error in the dialog when the failure isn't an ApiError", async () => {
    bulkChangeRsvpStatus.mockRejectedValueOnce(new TypeError("Failed to fetch"));

    await selectTwoRowsAndOpenMenu();
    const dialog = clickMenuItemAndArmDialog(/Change attendance status/, "Change attendance status");
    fireEvent.click(within(dialog).getByRole("button", { name: "Apply" }));

    await waitFor(() => {
      expect(within(dialog).getByRole("alert").textContent).toBe("Failed to change attendance status.");
    });
  });
});

describe("AttendeesPage bulk revoke items (#551)", () => {
  const items = [
    {
      id: "item-1",
      key: "badge",
      label: "Badge",
      description: null,
      type: "custom",
      enabled: true,
      icon: null,
      config: null,
    },
  ];

  async function selectTwoRowsAndOpenMenu() {
    renderPage();
    await screen.findByText("Jane Doe");
    fireEvent.click(screen.getByRole("checkbox", { name: "Select Jane Doe" }));
    fireEvent.click(screen.getByRole("checkbox", { name: "Select John Smith" }));
    await waitFor(() => expect(bulkBar().getByText("2")).toBeTruthy());
    fireEvent.click(bulkBar().getByRole("button", { name: "More actions" }));
  }

  it("revokes items for the selected attendees via the More actions menu, toasts, and clears the selection", async () => {
    fetchEventAttendees.mockResolvedValue({ items: [rowA, rowB, rowC], total: 3, page: 1, pageSize: 25 });
    fetchEventItems.mockResolvedValue(items);
    bulkRevokeItems.mockResolvedValue({ revokedCount: 3 });

    await selectTwoRowsAndOpenMenu();
    const item = bulkBar().getByRole("menuitem", { name: /Revoke items/ });
    expect(item.textContent).toContain("Reset all issued items for 2 attendees");
    const dialog = clickMenuItemAndArmDialog(/Revoke items/, "Revoke items for 2 attendees?");
    fireEvent.click(within(dialog).getByRole("button", { name: "Revoke" }));

    await waitFor(() => {
      expect(bulkRevokeItems).toHaveBeenCalledWith("evt-1", ["att-1", "att-2"]);
    });
    await waitFor(() => {
      expect(addToast).toHaveBeenCalledWith("3 items revoked.", "success");
    });
    await waitFor(() => expect(document.querySelector(".attendees-bulkbar")).toBeNull());
  });

  it("toasts an info message (not an error) when nothing was issued for the selection", async () => {
    fetchEventAttendees.mockResolvedValue({ items: [rowA, rowB, rowC], total: 3, page: 1, pageSize: 25 });
    fetchEventItems.mockResolvedValue(items);
    bulkRevokeItems.mockResolvedValue({ revokedCount: 0 });

    await selectTwoRowsAndOpenMenu();
    const dialog = clickMenuItemAndArmDialog(/Revoke items/, "Revoke items for 2 attendees?");
    fireEvent.click(within(dialog).getByRole("button", { name: "Revoke" }));

    await waitFor(() => {
      expect(addToast).toHaveBeenCalledWith("No issued items to revoke for the selected attendees.", "info");
    });
  });

  it("Cancel closes the dialog without calling bulkRevokeItems, and keeps the selection", async () => {
    fetchEventAttendees.mockResolvedValue({ items: [rowA, rowB, rowC], total: 3, page: 1, pageSize: 25 });
    fetchEventItems.mockResolvedValue(items);

    await selectTwoRowsAndOpenMenu();
    const dialog = clickMenuItemAndArmDialog(/Revoke items/, "Revoke items for 2 attendees?");
    fireEvent.click(within(dialog).getByRole("button", { name: "Cancel" }));

    expect(screen.queryByRole("dialog", { name: "Revoke items for 2 attendees?" })).toBeNull();
    expect(bulkRevokeItems).not.toHaveBeenCalled();
    expect(document.querySelector(".attendees-bulkbar")).toBeTruthy();
  });

  it("shows an operator-safe error inside the dialog and keeps the selection when bulkRevokeItems fails", async () => {
    const { ApiError } = await import("../../src/api/client.js");
    fetchEventAttendees.mockResolvedValue({ items: [rowA, rowB, rowC], total: 3, page: 1, pageSize: 25 });
    fetchEventItems.mockResolvedValue(items);
    bulkRevokeItems.mockRejectedValueOnce(new ApiError(500, "secret_internal"));

    await selectTwoRowsAndOpenMenu();
    const dialog = clickMenuItemAndArmDialog(/Revoke items/, "Revoke items for 2 attendees?");
    fireEvent.click(within(dialog).getByRole("button", { name: "Revoke" }));

    await screen.findByText("Revoke items failed.");
    expect(addToast).not.toHaveBeenCalled();
    expect(screen.getByRole("dialog", { name: "Revoke items for 2 attendees?" })).toBeTruthy();
    expect(document.querySelector(".attendees-bulkbar")).toBeTruthy();
  });

  it("redirects to /login on a 401 instead of showing an inline error", async () => {
    const { ApiError } = await import("../../src/api/client.js");
    fetchEventAttendees.mockResolvedValue({ items: [rowA, rowB, rowC], total: 3, page: 1, pageSize: 25 });
    fetchEventItems.mockResolvedValue(items);
    bulkRevokeItems.mockRejectedValueOnce(new ApiError(401, "unauthorized"));
    const assign = vi.fn();
    vi.stubGlobal("location", { ...window.location, assign, pathname: "/admin/events/evt-1/attendees" });

    await selectTwoRowsAndOpenMenu();
    const dialog = clickMenuItemAndArmDialog(/Revoke items/, "Revoke items for 2 attendees?");
    fireEvent.click(within(dialog).getByRole("button", { name: "Revoke" }));

    await waitFor(() => {
      expect(assign).toHaveBeenCalledWith(
        `/login?next=${encodeURIComponent("/admin/events/evt-1/attendees")}`,
      );
    });
  });

  it("shows a generic inline error when bulkRevokeItems rejects with something other than ApiError", async () => {
    fetchEventAttendees.mockResolvedValue({ items: [rowA, rowB, rowC], total: 3, page: 1, pageSize: 25 });
    fetchEventItems.mockResolvedValue(items);
    bulkRevokeItems.mockRejectedValueOnce(new Error("network down"));

    await selectTwoRowsAndOpenMenu();
    const dialog = clickMenuItemAndArmDialog(/Revoke items/, "Revoke items for 2 attendees?");
    fireEvent.click(within(dialog).getByRole("button", { name: "Revoke" }));

    await screen.findByText("Failed to revoke items.");
    expect(addToast).not.toHaveBeenCalled();
  });

  it("ignores a stale bulk-revoke-items error after navigating to a different event mid-request", async () => {
    let rejectRevoke!: (err: unknown) => void;
    fetchEventAttendees.mockResolvedValue({ items: [rowA, rowB, rowC], total: 3, page: 1, pageSize: 25 });
    fetchEventItems.mockResolvedValue(items);
    bulkRevokeItems.mockReturnValueOnce(
      new Promise((_resolve, reject) => {
        rejectRevoke = reject;
      }),
    );

    const router = createMemoryRouter(
      [{ path: "/admin/events/:eventId/attendees", element: <AttendeesPage /> }],
      { initialEntries: ["/admin/events/evt-1/attendees"] },
    );
    render(<RouterProvider router={router} />);

    await screen.findByText("Jane Doe");
    fireEvent.click(screen.getByRole("checkbox", { name: "Select Jane Doe" }));
    fireEvent.click(screen.getByRole("checkbox", { name: "Select John Smith" }));
    await waitFor(() => expect(bulkBar().getByText("2")).toBeTruthy());
    fireEvent.click(bulkBar().getByRole("button", { name: "More actions" }));
    const dialog = clickMenuItemAndArmDialog(/Revoke items/, "Revoke items for 2 attendees?");
    fireEvent.click(within(dialog).getByRole("button", { name: "Revoke" }));

    await act(async () => router.navigate("/admin/events/evt-2/attendees"));
    await waitFor(() => {
      expect(fetchEventAttendees).toHaveBeenCalledWith("evt-2", expect.anything(), expect.anything());
    });

    await act(async () => {
      rejectRevoke(new Error("network down"));
      await Promise.resolve();
    });

    expect(addToast).not.toHaveBeenCalled();
    expect(screen.queryByText("Failed to revoke items.")).toBeNull();
  });

  it("ignores a stale bulk-revoke-items completion after navigating to a different event mid-request", async () => {
    let resolveRevoke!: (value: { revokedCount: number }) => void;
    fetchEventAttendees.mockResolvedValue({ items: [rowA, rowB, rowC], total: 3, page: 1, pageSize: 25 });
    fetchEventItems.mockResolvedValue(items);
    bulkRevokeItems.mockReturnValueOnce(
      new Promise((resolve) => {
        resolveRevoke = resolve;
      }),
    );

    const router = createMemoryRouter(
      [{ path: "/admin/events/:eventId/attendees", element: <AttendeesPage /> }],
      { initialEntries: ["/admin/events/evt-1/attendees"] },
    );
    render(<RouterProvider router={router} />);

    await screen.findByText("Jane Doe");
    fireEvent.click(screen.getByRole("checkbox", { name: "Select Jane Doe" }));
    fireEvent.click(screen.getByRole("checkbox", { name: "Select John Smith" }));
    await waitFor(() => expect(bulkBar().getByText("2")).toBeTruthy());
    fireEvent.click(bulkBar().getByRole("button", { name: "More actions" }));
    const dialog = clickMenuItemAndArmDialog(/Revoke items/, "Revoke items for 2 attendees?");
    fireEvent.click(within(dialog).getByRole("button", { name: "Revoke" }));

    await act(async () => router.navigate("/admin/events/evt-2/attendees"));
    await waitFor(() => {
      expect(fetchEventAttendees).toHaveBeenCalledWith("evt-2", expect.anything(), expect.anything());
    });

    await act(async () => {
      resolveRevoke({ revokedCount: 2 });
      await Promise.resolve();
    });

    expect(addToast).not.toHaveBeenCalledWith(expect.stringContaining("revoked"), "success");
  });

  it("disables the menu item when the event has no configured items", async () => {
    fetchEventAttendees.mockResolvedValue({ items: [rowA, rowB, rowC], total: 3, page: 1, pageSize: 25 });
    fetchEventItems.mockResolvedValue([]);

    renderPage();
    await screen.findByText("Jane Doe");
    fireEvent.click(screen.getByRole("checkbox", { name: "Select Jane Doe" }));
    await waitFor(() => expect(document.querySelector(".attendees-bulkbar")).toBeTruthy());
    fireEvent.click(bulkBar().getByRole("button", { name: "More actions" }));

    const item = bulkBar().getByRole("menuitem", { name: /Revoke items/ }) as HTMLButtonElement;
    expect(item.disabled).toBe(true);
    expect(getTooltipText(item)).toContain("No items configured");
  });

  it("disables the menu item when nothing in the selection has anything issued, even though the event has configured items (CodeRabbit review)", async () => {
    const nothingIssuedRow = { ...rowA, has_issued_items: false };
    fetchEventAttendees.mockResolvedValue({ items: [nothingIssuedRow, rowB, rowC], total: 3, page: 1, pageSize: 25 });
    fetchEventItems.mockResolvedValue(items);

    renderPage();
    await screen.findByText("Jane Doe");
    fireEvent.click(screen.getByRole("checkbox", { name: "Select Jane Doe" }));
    await waitFor(() => expect(document.querySelector(".attendees-bulkbar")).toBeTruthy());
    fireEvent.click(bulkBar().getByRole("button", { name: "More actions" }));

    const item = bulkBar().getByRole("menuitem", { name: /Revoke items/ }) as HTMLButtonElement;
    expect(item.disabled).toBe(true);
    expect(getTooltipText(item)).toBe("None of the selected attendees have anything issued.");
  });

  it("lets the operator retry the items load from the bulk bar's More actions menu, without losing the selection", async () => {
    fetchEventAttendees.mockResolvedValue({ items: [rowA, rowB, rowC], total: 3, page: 1, pageSize: 25 });
    fetchEventItems.mockRejectedValueOnce(new Error("network down"));

    renderPage();
    await screen.findByText("Jane Doe");
    fireEvent.click(screen.getByRole("checkbox", { name: "Select Jane Doe" }));
    await waitFor(() => expect(document.querySelector(".attendees-bulkbar")).toBeTruthy());
    fireEvent.click(bulkBar().getByRole("button", { name: "More actions" }));

    await waitFor(() => expect(bulkBar().getByText("Retry loading items")).toBeTruthy());

    fetchEventItems.mockResolvedValueOnce(items);
    fireEvent.click(bulkBar().getByText("Retry loading items"));

    await waitFor(() => {
      const item = bulkBar().getByRole("menuitem", { name: /Revoke items/ }) as HTMLButtonElement;
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
    fireEvent.click(within(confirmDialog).getByRole("button", { name: "Send" }));

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
