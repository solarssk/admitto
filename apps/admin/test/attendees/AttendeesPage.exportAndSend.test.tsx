// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter, Route, Routes } from "react-router";
import { AttendeesPage } from "../../src/pages/AttendeesPage.js";
import { mockMatchMedia } from "../test-utils.js";
import type { AttendeeRowDto } from "../../src/api/types.js";

const fetchEventAttendees = vi.fn();
const exportAttendees = vi.fn();
const bulkResendTickets = vi.fn();
const fetchBulkSendStatus = vi.fn();
const addToast = vi.fn();
const reportApiError = vi.fn();

const sampleRow: AttendeeRowDto = {
  id: "att-1",
  name: "Jane Doe",
  email: "jane@example.com",
  company: "Acme",
  department: null,
  ticket_type: "VIP",
  status: "registered",
  check_in_status: "not_admitted",
  admitted_at: null,
  updated_at: "2026-06-01T10:00:00.000Z",
  last_mail_status: "sent",
  rsvp_status: "confirmed",
  has_issued_items: false,
  wallet_status: null,
};

let listResponse = {
  items: [sampleRow] as AttendeeRowDto[],
  total: 1,
  page: 1,
  pageSize: 25,
};

function setListItems(items: AttendeeRowDto[]) {
  listResponse = {
    items,
    total: items.length,
    page: 1,
    pageSize: 25,
  };
}

function mockFetchEventAttendees() {
  fetchEventAttendees.mockImplementation((_eventId, _params, signal?: AbortSignal) => {
    return new Promise((resolve, reject) => {
      if (signal?.aborted) {
        reject(new DOMException("The operation was aborted.", "AbortError"));
        return;
      }
      const timer = window.setTimeout(() => {
        if (signal?.aborted) {
          reject(new DOMException("The operation was aborted.", "AbortError"));
          return;
        }
        resolve({
          ...listResponse,
          items: listResponse.items.map((item) => ({ ...item })),
        });
      }, 0);
      signal?.addEventListener(
        "abort",
        () => {
          window.clearTimeout(timer);
          reject(new DOMException("The operation was aborted.", "AbortError"));
        },
        { once: true },
      );
    });
  });
}

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
  fetchTicketTypes: vi.fn().mockResolvedValue([]),
  fetchEventItems: vi.fn().mockResolvedValue([]),
  fetchEventTemplates: vi.fn().mockResolvedValue([
    {
      id: "tpl-ticket",
      name: "ticket",
      label: "Ticket",
      template_format: "html",
      subject_template: "",
      updated_at: "2026-01-01T00:00:00.000Z",
    },
  ]),
  fetchEventMailSettings: vi.fn().mockResolvedValue({
    eventId: "evt-1",
    organizationId: "org-1",
    isProduction: false,
    hasEventOverride: false,
    fields: { provider: { value: "smtp", source: "organization", locked: false } },
  }),
  exportAttendees: (...args: unknown[]) => exportAttendees(...args),
  bulkResendTickets: (...args: unknown[]) => bulkResendTickets(...args),
  fetchBulkSendStatus: (...args: unknown[]) => fetchBulkSendStatus(...args),
  sendEventBulk: vi.fn(),
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
        attendee_count: 1,
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

beforeEach(() => {
  addToast.mockClear();
  reportApiError.mockClear();
  fetchEventAttendees.mockReset();
  bulkResendTickets.mockReset();
  fetchBulkSendStatus.mockReset();
  fetchBulkSendStatus.mockResolvedValue({
    batchId: "batch-1",
    total: 1,
    queued: 0,
    sent: 1,
    failed: 0,
  });
  pollBulkSendCompletion.mockReset();
  pollBulkSendCompletion.mockImplementation((...args: Parameters<ReturnType<typeof getPollBulkSendCompletionActual>>) =>
    getPollBulkSendCompletionActual()(...args),
  );
  setListItems([sampleRow]);
  mockFetchEventAttendees();
  mockMatchMedia(true);
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("AttendeesPage export and header Send tickets", () => {
  it("toasts operator-safe export failure", async () => {
    const { ApiError } = await import("../../src/api/client.js");
    exportAttendees.mockRejectedValueOnce(new ApiError(500, "secret_internal"));
    renderPage();
    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Export" })).toBeTruthy();
    });
    // Export formats live behind a single "Export" menu button (#354).
    fireEvent.click(screen.getByRole("button", { name: "Export" }));
    fireEvent.click(screen.getByRole("menuitem", { name: /^XLSX/ }));
    await waitFor(() => {
      expect(addToast).toHaveBeenCalledWith("Request failed.", "error");
    });
  });

  it("polls bulk-send status after header Send tickets queues work", async () => {
    bulkResendTickets.mockResolvedValueOnce({ batchId: "batch-hdr", queued: 2, skipped: 0, failed: 0 });
    fetchBulkSendStatus.mockResolvedValue({
      batchId: "batch-hdr",
      total: 2,
      queued: 0,
      sent: 2,
      failed: 0,
    });
    renderPage();
    await waitFor(() => {
      expect(screen.getByRole("button", { name: "More" })).toBeTruthy();
    });
    fireEvent.click(screen.getByRole("button", { name: "More" }));
    fireEvent.click(screen.getByRole("menuitem", { name: /^Send tickets/ }));
    const dialog = screen.getByRole("dialog", { name: "Send tickets" });
    fireEvent.click(within(dialog).getByRole("button", { name: "Send tickets" }));
    await waitFor(() => {
      expect(fetchBulkSendStatus).toHaveBeenCalledWith("evt-1", "batch-hdr", expect.any(AbortSignal));
      expect(addToast).toHaveBeenCalledWith("Send complete: 2 tickets sent.", "success");
    });
  });

  it("toasts info when header Send tickets status polling throws", async () => {
    bulkResendTickets.mockResolvedValueOnce({ batchId: "batch-hdr-err", queued: 1, skipped: 0, failed: 0 });
    fetchBulkSendStatus.mockRejectedValue(new Error("network down"));
    renderPage();
    await waitFor(() => {
      expect(screen.getByRole("button", { name: "More" })).toBeTruthy();
    });
    fireEvent.click(screen.getByRole("button", { name: "More" }));
    fireEvent.click(screen.getByRole("menuitem", { name: /^Send tickets/ }));
    const dialog = screen.getByRole("dialog", { name: "Send tickets" });
    fireEvent.click(within(dialog).getByRole("button", { name: "Send tickets" }));
    await waitFor(() => {
      expect(addToast).toHaveBeenCalledWith(
        "Could not refresh send status. Check Communication.",
        "info",
      );
    });
  });

  it("does not start header-send status polling when enqueue queues nothing", async () => {
    bulkResendTickets.mockResolvedValueOnce({ batchId: "batch-hdr-empty", queued: 0, skipped: 2, failed: 0 });
    renderPage();
    await waitFor(() => {
      expect(screen.getByRole("button", { name: "More" })).toBeTruthy();
    });
    fireEvent.click(screen.getByRole("button", { name: "More" }));
    fireEvent.click(screen.getByRole("menuitem", { name: /^Send tickets/ }));
    fireEvent.click(
      within(screen.getByRole("dialog", { name: "Send tickets" })).getByRole("button", {
        name: "Send tickets",
      }),
    );
    await waitFor(() => {
      expect(addToast).toHaveBeenCalledWith("No tickets were queued (2 skipped).", "info");
    });
    expect(pollBulkSendCompletion).not.toHaveBeenCalled();
  });

  it("does not toast poll errors after header-send polling was aborted on unmount", async () => {
    bulkResendTickets.mockResolvedValueOnce({ batchId: "batch-hdr-abort", queued: 1, skipped: 0, failed: 0 });
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
    await waitFor(() => {
      expect(screen.getByRole("button", { name: "More" })).toBeTruthy();
    });
    fireEvent.click(screen.getByRole("button", { name: "More" }));
    fireEvent.click(screen.getByRole("menuitem", { name: /^Send tickets/ }));
    fireEvent.click(
      within(screen.getByRole("dialog", { name: "Send tickets" })).getByRole("button", {
        name: "Send tickets",
      }),
    );
    await waitFor(() => expect(pollBulkSendCompletion).toHaveBeenCalled());
    unmount();
    await waitFor(() => {
      expect(addToast).not.toHaveBeenCalledWith(
        "Could not refresh send status. Check Communication.",
        "info",
      );
    });
  });

  it("aborts an in-flight header-send poll when another header send starts", async () => {
    bulkResendTickets
      .mockResolvedValueOnce({ batchId: "batch-hdr-a", queued: 1, skipped: 0, failed: 0 })
      .mockResolvedValueOnce({ batchId: "batch-hdr-b", queued: 1, skipped: 0, failed: 0 });
    const firstSignalRef: { current?: AbortSignal } = {};
    pollBulkSendCompletion.mockImplementation(async (_eventId, batchId, addToastArg, options) => {
      if (batchId === "batch-hdr-a") {
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
      return getPollBulkSendCompletionActual()(_eventId, batchId, addToastArg, options);
    });

    renderPage();
    expect(await screen.findByRole("button", { name: "More" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "More" }));
    fireEvent.click(screen.getByRole("menuitem", { name: /^Send tickets/ }));
    fireEvent.click(
      within(screen.getByRole("dialog", { name: "Send tickets" })).getByRole("button", {
        name: "Send tickets",
      }),
    );
    await waitFor(() => expect(firstSignalRef.current).toBeTruthy());

    fireEvent.click(screen.getByRole("button", { name: "More" }));
    fireEvent.click(screen.getByRole("menuitem", { name: /^Send tickets/ }));
    fireEvent.click(
      within(screen.getByRole("dialog", { name: "Send tickets" })).getByRole("button", {
        name: "Send tickets",
      }),
    );

    await waitFor(() => {
      expect(firstSignalRef.current?.aborted).toBe(true);
      expect(pollBulkSendCompletion).toHaveBeenCalledWith(
        "evt-1",
        "batch-hdr-b",
        addToast,
        expect.objectContaining({ signal: expect.any(AbortSignal) }),
      );
    });
  });

  it("shows operator-safe bulk send failure", async () => {
    const { ApiError } = await import("../../src/api/client.js");
    bulkResendTickets.mockRejectedValueOnce(new ApiError(500, "secret_internal"));
    renderPage();
    await waitFor(() => {
      expect(screen.getByRole("button", { name: "More" })).toBeTruthy();
    });
    fireEvent.click(screen.getByRole("button", { name: "More" }));
    fireEvent.click(screen.getByRole("menuitem", { name: /^Send tickets/ }));
    const dialog = screen.getByRole("dialog", { name: "Send tickets" });
    fireEvent.click(within(dialog).getByRole("button", { name: "Send tickets" }));
    await waitFor(() => {
      expect(within(dialog).getByText(/Send failed/)).toBeTruthy();
    });
  });
});
