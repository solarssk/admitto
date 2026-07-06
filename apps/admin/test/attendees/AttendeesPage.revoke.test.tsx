// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { AttendeesPage } from "../../src/pages/AttendeesPage.js";
import type { AttendeeDetailDto, AttendeeRowDto } from "../../src/api/types.js";

const updateAttendee = vi.fn();
const fetchEventAttendees = vi.fn();
const exportAttendees = vi.fn();
const bulkResendTickets = vi.fn();
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
};

const otherRow: AttendeeRowDto = {
  ...sampleRow,
  id: "att-2",
  name: "John Smith",
  email: "john@example.com",
  updated_at: "2026-06-01T10:00:00.000Z",
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

function asDetail(row: AttendeeRowDto, patch: Partial<AttendeeDetailDto> = {}): AttendeeDetailDto {
  return {
    id: row.id,
    name: row.name,
    email: row.email,
    company: row.company,
    department: row.department,
    ticket_type: row.ticket_type,
    status: row.status,
    check_in_status: row.check_in_status,
    admitted_at: row.admitted_at,
    updated_at: row.updated_at,
    rsvp_status: row.rsvp_status,
    rsvp_updated_at: null,
    rsvp_source: null,
    ticket_ref: null,
    custom_data: null,
    deliveries: [],
    action_log: [],
    ...patch,
  };
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
  exportAttendees: (...args: unknown[]) => exportAttendees(...args),
  bulkResendTickets: (...args: unknown[]) => bulkResendTickets(...args),
  updateAttendee: (...args: unknown[]) => updateAttendee(...args),
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

function findRowByName(name: string) {
  const row = screen.getAllByRole("row").find((candidate) => within(candidate).queryByText(name));
  if (!row) {
    throw new Error(`Row not found for ${name}`);
  }
  return within(row);
}

function tableActions() {
  return within(screen.getByRole("table"));
}

beforeEach(() => {
  addToast.mockClear();
  reportApiError.mockClear();
  updateAttendee.mockReset();
  fetchEventAttendees.mockReset();
  setListItems([sampleRow]);
  mockFetchEventAttendees();
});

afterEach(cleanup);

describe("AttendeesPage revoke/restore", () => {
  it("confirms revoke, merges PATCH response into the row, and shows restore action", async () => {
    updateAttendee.mockResolvedValue(
      asDetail(sampleRow, {
        status: "revoked",
        updated_at: "2026-06-01T10:01:00.000Z",
      }),
    );

    renderPage();

    await waitFor(() => {
      expect(tableActions().getByRole("button", { name: "Revoke pass" })).toBeTruthy();
    });

    fireEvent.click(tableActions().getByRole("button", { name: "Revoke pass" }));
    const dialog = screen.getByRole("dialog", { name: "Revoke pass?" });
    fireEvent.click(within(dialog).getByRole("button", { name: "Revoke pass" }));

    await waitFor(() => {
      expect(updateAttendee).toHaveBeenCalledWith("evt-1", "att-1", {
        status: "revoked",
        expected_updated_at: sampleRow.updated_at,
      });
      expect(addToast).toHaveBeenCalledWith("Pass revoked", "success");
      expect(screen.getByText("Revoked")).toBeTruthy();
      expect(tableActions().getByRole("button", { name: "Restore pass" })).toBeTruthy();
      expect(tableActions().queryByRole("button", { name: "Revoke pass" })).toBeNull();
    });
  });

  it("restores without confirm dialog, merges response, and uses refreshed updated_at next time", async () => {
    const revokedRow = { ...sampleRow, status: "revoked" as const };
    setListItems([revokedRow]);

    updateAttendee
      .mockResolvedValueOnce(
        asDetail(revokedRow, {
          status: "registered",
          updated_at: "2026-06-01T10:01:00.000Z",
        }),
      )
      .mockResolvedValueOnce(
        asDetail(sampleRow, {
          status: "revoked",
          updated_at: "2026-06-01T10:02:00.000Z",
        }),
      );

    renderPage();

    await waitFor(() => {
      expect(tableActions().getByRole("button", { name: "Restore pass" })).toBeTruthy();
    });

    fireEvent.click(tableActions().getByRole("button", { name: "Restore pass" }));

    await waitFor(() => {
      expect(updateAttendee).toHaveBeenNthCalledWith(1, "evt-1", "att-1", {
        status: "registered",
        expected_updated_at: revokedRow.updated_at,
      });
      expect(addToast).toHaveBeenCalledWith("Pass restored", "success");
      expect(screen.queryByText("Revoked")).toBeNull();
    });

    await waitFor(() => {
      expect(tableActions().getByRole("button", { name: "Revoke pass" })).toBeTruthy();
    });
    fireEvent.click(tableActions().getByRole("button", { name: "Revoke pass" }));
    const dialog = screen.getByRole("dialog", { name: "Revoke pass?" });
    fireEvent.click(within(dialog).getByRole("button", { name: "Revoke pass" }));

    await waitFor(() => {
      expect(updateAttendee).toHaveBeenNthCalledWith(2, "evt-1", "att-1", {
        status: "revoked",
        expected_updated_at: "2026-06-01T10:01:00.000Z",
      });
    });
  });

  it("updates only the targeted row when multiple attendees are listed", async () => {
    setListItems([sampleRow, otherRow]);
    updateAttendee.mockResolvedValue(
      asDetail(sampleRow, {
        status: "revoked",
        updated_at: "2026-06-01T10:01:00.000Z",
      }),
    );

    renderPage();

    await waitFor(() => {
      expect(screen.getAllByRole("button", { name: "Revoke pass" })).toHaveLength(2);
    });

    fireEvent.click(findRowByName("Jane Doe").getByRole("button", { name: "Revoke pass" }));
    const dialog = screen.getByRole("dialog", { name: "Revoke pass?" });
    fireEvent.click(within(dialog).getByRole("button", { name: "Revoke pass" }));

    await waitFor(() => {
      expect(findRowByName("Jane Doe").getByText("Revoked")).toBeTruthy();
      expect(findRowByName("Jane Doe").getByRole("button", { name: "Restore pass" })).toBeTruthy();
      expect(findRowByName("John Smith").getByRole("button", { name: "Revoke pass" })).toBeTruthy();
      expect(findRowByName("John Smith").queryByRole("button", { name: "Restore pass" })).toBeNull();
    });
  });

  it("reloads the list on stale_write conflict", async () => {
    const { ApiError } = await import("../../src/api/client.js");
    updateAttendee.mockRejectedValue(new ApiError(409, "stale_write", "stale_write"));

    renderPage();

    await waitFor(() => {
      expect(tableActions().getByRole("button", { name: "Revoke pass" })).toBeTruthy();
    });
    const callsBeforeConflict = fetchEventAttendees.mock.calls.length;

    fireEvent.click(tableActions().getByRole("button", { name: "Revoke pass" }));
    const dialog = screen.getByRole("dialog", { name: "Revoke pass?" });
    fireEvent.click(within(dialog).getByRole("button", { name: "Revoke pass" }));

    await waitFor(() => {
      expect(updateAttendee).toHaveBeenCalledWith("evt-1", "att-1", {
        status: "revoked",
        expected_updated_at: sampleRow.updated_at,
      });
      expect(addToast).toHaveBeenCalledWith(
        "Someone else updated this attendee — reloading list",
        "warning",
      );
      expect(fetchEventAttendees.mock.calls.length).toBeGreaterThan(callsBeforeConflict);
      expect(screen.queryByRole("dialog", { name: "Revoke pass?" })).toBeNull();
    });
  });

  it("restores without confirm dialog and toasts event_full on capacity error", async () => {
    const { ApiError } = await import("../../src/api/client.js");
    const revokedRow = { ...sampleRow, status: "revoked" as const };
    setListItems([revokedRow]);
    updateAttendee.mockRejectedValue(new ApiError(409, "event_full", "event_full"));

    renderPage();

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Restore pass" })).toBeTruthy();
    });

    fireEvent.click(screen.getByRole("button", { name: "Restore pass" }));

    await waitFor(() => {
      expect(updateAttendee).toHaveBeenCalledWith("evt-1", "att-1", {
        status: "registered",
        expected_updated_at: revokedRow.updated_at,
      });
      expect(addToast).toHaveBeenCalledWith(
        "Event is at capacity — pass cannot be restored.",
        "error",
      );
    });
  });

  it("disables the in-flight row action until the PATCH settles", async () => {
    const revokedRow = { ...sampleRow, status: "revoked" as const };
    setListItems([revokedRow]);

    let resolveUpdate: (value: AttendeeDetailDto) => void = () => undefined;
    updateAttendee.mockImplementation(
      () =>
        new Promise<AttendeeDetailDto>((resolve) => {
          resolveUpdate = resolve;
        }),
    );

    renderPage();

    await waitFor(() => {
      expect(tableActions().getByRole("button", { name: "Restore pass" })).toBeTruthy();
    });

    fireEvent.click(tableActions().getByRole("button", { name: "Restore pass" }));

    await waitFor(() => {
      expect((tableActions().getByRole("button", { name: "Restore pass" }) as HTMLButtonElement).disabled).toBe(true);
    });

    resolveUpdate(
      asDetail(revokedRow, {
        status: "registered",
        updated_at: "2026-06-01T10:01:00.000Z",
      }),
    );

    await waitFor(() => {
      expect(tableActions().getByRole("button", { name: "Revoke pass" })).toBeTruthy();
    });
  });

  it("closes revoke dialog on cancel without calling updateAttendee", async () => {
    renderPage();

    await waitFor(() => {
      expect(tableActions().getByRole("button", { name: "Revoke pass" })).toBeTruthy();
    });

    fireEvent.click(tableActions().getByRole("button", { name: "Revoke pass" }));
    const dialog = screen.getByRole("dialog", { name: "Revoke pass?" });
    fireEvent.click(within(dialog).getByRole("button", { name: "Cancel" }));

    await waitFor(() => {
      expect(screen.queryByRole("dialog", { name: "Revoke pass?" })).toBeNull();
    });
    expect(updateAttendee).not.toHaveBeenCalled();
  });

  it("toasts operator-safe export failure", async () => {
    const { ApiError } = await import("../../src/api/client.js");
    exportAttendees.mockRejectedValueOnce(new ApiError(500, "secret_internal"));
    renderPage();
    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Export XLSX" })).toBeTruthy();
    });
    fireEvent.click(screen.getByRole("button", { name: "Export XLSX" }));
    await waitFor(() => {
      expect(addToast).toHaveBeenCalledWith("Request failed.", "error");
    });
  });

  it("shows operator-safe revoke pass failure in dialog", async () => {
    const { ApiError } = await import("../../src/api/client.js");
    updateAttendee.mockRejectedValueOnce(new ApiError(500, "secret_internal"));
    renderPage();
    await waitFor(() => {
      expect(tableActions().getByRole("button", { name: "Revoke pass" })).toBeTruthy();
    });
    fireEvent.click(tableActions().getByRole("button", { name: "Revoke pass" }));
    const dialog = screen.getByRole("dialog", { name: "Revoke pass?" });
    fireEvent.click(within(dialog).getByRole("button", { name: "Revoke pass" }));
    await waitFor(() => {
      expect(within(dialog).getByText(/Could not update pass status/)).toBeTruthy();
    });
  });

  it("toasts operator-safe restore failure without dialog", async () => {
    const { ApiError } = await import("../../src/api/client.js");
    const revokedRow = { ...sampleRow, status: "revoked" as const };
    setListItems([revokedRow]);
    updateAttendee.mockRejectedValueOnce(new ApiError(500, "secret_internal"));
    renderPage();
    await waitFor(() => {
      expect(findRowByName("Jane Doe").getByRole("button", { name: "Restore pass" })).toBeTruthy();
    });
    fireEvent.click(findRowByName("Jane Doe").getByRole("button", { name: "Restore pass" }));
    await waitFor(() => {
      expect(addToast).toHaveBeenCalledWith("Could not update pass status.", "error");
    });
  });

  it("shows operator-safe bulk send failure", async () => {
    const { ApiError } = await import("../../src/api/client.js");
    bulkResendTickets.mockRejectedValueOnce(new ApiError(500, "secret_internal"));
    renderPage();
    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Send tickets" })).toBeTruthy();
    });
    fireEvent.click(screen.getAllByRole("button", { name: "Send tickets" })[0]!);
    const dialog = screen.getByRole("dialog", { name: "Send tickets" });
    fireEvent.click(within(dialog).getByRole("button", { name: "Send tickets" }));
    await waitFor(() => {
      expect(within(dialog).getByText(/Send failed/)).toBeTruthy();
    });
  });
});
