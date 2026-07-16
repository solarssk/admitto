// @vitest-environment jsdom
import { cleanup, fireEvent, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { AttendeesPage } from "../../src/pages/AttendeesPage.js";
import { mockMatchMedia, renderWithToast } from "../test-utils.js";
import type { AttendeeRowDto } from "../../src/api/types.js";

const fetchEventAttendees = vi.fn();
const exportAttendees = vi.fn();
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
  fetchEventTemplates: vi.fn().mockResolvedValue([]),
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
  return renderWithToast(
    <MemoryRouter initialEntries={["/admin/events/evt-1/attendees"]}>
      <Routes>
        <Route path="/admin/events/:eventId/attendees" element={<AttendeesPage />} />
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

describe("AttendeesPage export menu (#354)", () => {
  it("opens the Export menu with 3 items; clicking one exports the matching format and closes the menu", async () => {
    fetchEventAttendees.mockResolvedValue({ items: [sampleRow], total: 1, page: 1, pageSize: 25 });
    exportAttendees.mockResolvedValue(undefined);

    renderPage();

    await waitFor(() => {
      expect(screen.getByText("Jane Doe")).toBeTruthy();
    });

    fireEvent.click(screen.getByRole("button", { name: "Export" }));
    expect(screen.getByRole("menu")).toBeTruthy();
    expect(screen.getByRole("menuitem", { name: /^XLSX/ })).toBeTruthy();
    expect(screen.getByRole("menuitem", { name: /^CSV/ })).toBeTruthy();
    expect(screen.getByRole("menuitem", { name: /^PDF/ })).toBeTruthy();

    fireEvent.click(screen.getByRole("menuitem", { name: /^CSV/ }));

    await waitFor(() => {
      expect(exportAttendees).toHaveBeenCalledTimes(1);
    });
    expect(exportAttendees.mock.calls[0]![2]).toBe("csv");
    expect(screen.queryByRole("menu")).toBeNull();
  });

  it("closes the menu on outside click and on Escape", async () => {
    fetchEventAttendees.mockResolvedValue({ items: [sampleRow], total: 1, page: 1, pageSize: 25 });

    renderPage();

    await waitFor(() => {
      expect(screen.getByText("Jane Doe")).toBeTruthy();
    });

    const trigger = screen.getByRole("button", { name: "Export" });

    fireEvent.click(trigger);
    expect(screen.getByRole("menu")).toBeTruthy();
    fireEvent.pointerDown(document.body);
    expect(screen.queryByRole("menu")).toBeNull();

    fireEvent.click(trigger);
    expect(screen.getByRole("menu")).toBeTruthy();
    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByRole("menu")).toBeNull();
  });

  it("moves focus between menu items with ArrowDown/ArrowUp/Home/End (WAI-ARIA menu pattern)", async () => {
    fetchEventAttendees.mockResolvedValue({ items: [sampleRow], total: 1, page: 1, pageSize: 25 });

    renderPage();

    await waitFor(() => {
      expect(screen.getByText("Jane Doe")).toBeTruthy();
    });

    fireEvent.click(screen.getByRole("button", { name: "Export" }));
    const items = screen.getAllByRole("menuitem");
    expect(items.map((i) => i.textContent)).toEqual([
      expect.stringContaining("XLSX"),
      expect.stringContaining("CSV"),
      expect.stringContaining("PDF"),
    ]);
    expect(document.activeElement).toBe(items[0]);

    fireEvent.keyDown(document, { key: "ArrowDown" });
    expect(document.activeElement).toBe(items[1]);

    fireEvent.keyDown(document, { key: "ArrowDown" });
    expect(document.activeElement).toBe(items[2]);

    // Wraps back to the first item past the last one.
    fireEvent.keyDown(document, { key: "ArrowDown" });
    expect(document.activeElement).toBe(items[0]);

    // Wraps to the last item going backward past the first one.
    fireEvent.keyDown(document, { key: "ArrowUp" });
    expect(document.activeElement).toBe(items[2]);

    fireEvent.keyDown(document, { key: "Home" });
    expect(document.activeElement).toBe(items[0]);

    fireEvent.keyDown(document, { key: "End" });
    expect(document.activeElement).toBe(items[2]);
  });
});
