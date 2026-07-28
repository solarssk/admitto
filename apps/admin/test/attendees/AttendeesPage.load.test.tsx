// @vitest-environment jsdom
import { cleanup, fireEvent, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter, Route, Routes } from "react-router";
import { AttendeesPage } from "../../src/pages/AttendeesPage.js";
import { mockMatchMedia, renderWithToast } from "../test-utils.js";

const fetchEventAttendees = vi.fn();
const exportAttendees = vi.fn();
const reportApiError = vi.fn();

vi.mock("../../src/connection/ConnectionStateProvider.js", () => ({
  useConnectionState: () => ({ reportApiError }),
}));

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
  bulkResendTickets: vi.fn(),
  sendEventBulk: vi.fn(),
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
        attendee_count: 0,
        archived_at: null,
      },
    }),
  };
});

function renderPage() {
  return renderWithToast(
    <MemoryRouter initialEntries={["/admin/events/evt-1/attendees"]}>
      <Routes>
        <Route path="/admin/events/:eventId/attendees" element={<AttendeesPage />} />
        <Route path="/admin/events/:eventId/attendees/import" element={<div>import page</div>} />
      </Routes>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  mockMatchMedia(true);
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  vi.unstubAllGlobals();
});

describe("AttendeesPage load errors", () => {
  it("shows persistent empty state instead of an empty roster on load failure", async () => {
    const { ApiError } = await import("../../src/api/client.js");
    fetchEventAttendees.mockRejectedValueOnce(new ApiError(403, "Forbidden"));

    renderPage();

    await waitFor(() => {
      expect(screen.getByText("Could not load attendees")).toBeTruthy();
    });
    expect(screen.getByText("You do not have access to this event.")).toBeTruthy();
    expect(screen.queryByText(/No attendees yet/i)).toBeNull();
    expect(screen.getByRole("button", { name: "Retry" })).toBeTruthy();
  });

  it("shows a safe generic error when the attendee request is not an API response", async () => {
    fetchEventAttendees.mockRejectedValueOnce(new TypeError("network unavailable"));

    renderPage();

    await waitFor(() => {
      expect(screen.getByText("Could not load attendees")).toBeTruthy();
      expect(screen.getByText("Failed to load attendees.")).toBeTruthy();
    });
    expect(reportApiError).not.toHaveBeenCalled();
  });

  it("redirects to login instead of displaying an inline error after a 401 list response", async () => {
    const { ApiError } = await import("../../src/api/client.js");
    const assignSpy = vi.fn();
    const locationDescriptor = Object.getOwnPropertyDescriptor(window, "location");
    Object.defineProperty(window, "location", {
      configurable: true,
      value: { pathname: "/admin/events/evt-1/attendees", assign: assignSpy },
    });
    try {
      fetchEventAttendees.mockRejectedValueOnce(new ApiError(401, "unauthorized"));

      renderPage();

      await waitFor(() => {
        expect(assignSpy).toHaveBeenCalledWith("/login?next=%2Fadmin%2Fevents%2Fevt-1%2Fattendees");
        expect(reportApiError).toHaveBeenCalledWith(401);
      });
      expect(screen.queryByText("Could not load attendees")).toBeNull();
    } finally {
      if (locationDescriptor) Object.defineProperty(window, "location", locationDescriptor);
    }
  });

  it("shows a small inline retryable error next to the Type filter when only the ticket-type catalog fails, without blocking the attendee list (CodeRabbit review)", async () => {
    const { fetchTicketTypes } = await import("../../src/api/client.js");
    fetchEventAttendees.mockResolvedValue({
      items: [],
      total: 0,
      page: 1,
      pageSize: 25,
    });
    vi.mocked(fetchTicketTypes).mockRejectedValueOnce(new Error("network down"));

    renderPage();

    // The error sits inside the Filters dropdown panel now (PO review) - open it to see it.
    fireEvent.click(await screen.findByRole("button", { name: "Filters" }));
    await screen.findByText("Couldn't load types.");
    // The list itself isn't replaced by an error - only the Type filter is affected.
    expect(screen.queryByText("Could not load attendees")).toBeNull();

    vi.mocked(fetchTicketTypes).mockResolvedValueOnce([
      { id: "tt-1", key: "vip", label: "VIP", color: "purple", sort_order: 0, attendee_count: 0, created_at: "2026-01-01T00:00:00.000Z" },
    ]);
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));

    await waitFor(() => expect(screen.queryByText("Couldn't load types.")).toBeNull());
  });
});

describe("AttendeesPage header actions on mobile (PO review — header must never change height)", () => {
  it("shortens '+ Add attendee' to '+ Add' below 768px, so all header buttons fit one line", async () => {
    mockMatchMedia(false);
    fetchEventAttendees.mockResolvedValue({ items: [], total: 0, page: 1, pageSize: 25 });

    renderPage();
    await screen.findByText(/No attendees yet/i);

    expect(screen.queryByRole("button", { name: "+ Add attendee" })).toBeNull();
    expect(screen.getByRole("button", { name: "+ Add" })).toBeTruthy();
    // Import, Send tickets, and Export all moved into the "More" menu (#615) — only "+ Add"
    // and "More" remain as standalone buttons, few enough to sit beside the "Attendees" title
    // instead of wrapping onto their own row underneath it. Menu items always show their full
    // label, since a menu item isn't width-constrained the way a header button is.
    expect(screen.getByRole("button", { name: "More" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Export" })).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "More" }));
    expect(screen.getByRole("menuitem", { name: /^Import/ })).toBeTruthy();
    expect(screen.getByRole("menuitem", { name: /^Send tickets/ })).toBeTruthy();
    expect(screen.getByRole("menuitem", { name: /^Export XLSX/ })).toBeTruthy();
    expect(screen.getByRole("menuitem", { name: /^Export CSV/ })).toBeTruthy();
    expect(screen.getByRole("menuitem", { name: /^Export PDF/ })).toBeTruthy();

    fireEvent.click(screen.getByRole("menuitem", { name: /^Import/ }));
    expect(screen.getByText("import page")).toBeTruthy();
  });

  it("exports from the mobile More menu and closes it before starting the download", async () => {
    mockMatchMedia(false);
    fetchEventAttendees.mockResolvedValue({ items: [], total: 0, page: 1, pageSize: 25 });
    exportAttendees.mockResolvedValue(undefined);

    renderPage();
    await screen.findByText(/No attendees yet/i);

    fireEvent.click(screen.getByRole("button", { name: "More" }));
    fireEvent.click(screen.getByRole("menuitem", { name: /^Export CSV/ }));

    await waitFor(() => expect(exportAttendees).toHaveBeenCalledTimes(1));
    expect(exportAttendees.mock.calls[0]![2]).toBe("csv");
    expect(screen.queryByRole("menu")).toBeNull();
  });

  it("keeps the full header button labels at desktop widths, with Export as its own standalone button", async () => {
    fetchEventAttendees.mockResolvedValue({ items: [], total: 0, page: 1, pageSize: 25 });

    renderPage();
    await screen.findByText(/No attendees yet/i);

    expect(screen.getByRole("button", { name: "+ Add attendee" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Export" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "More" }));
    expect(screen.getByRole("menuitem", { name: /^Send tickets/ })).toBeTruthy();
    expect(screen.queryByRole("menuitem", { name: /^Export/ })).toBeNull();
  });
});
