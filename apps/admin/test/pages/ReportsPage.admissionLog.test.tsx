// @vitest-environment jsdom
import { cleanup, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter, Route, Routes } from "react-router";
import { ReportsPage } from "../../src/pages/ReportsPage.js";
import type { EventReportsResponse } from "../../src/api/types.js";
import { connectionStateValue, mockMatchMedia, renderWithToast } from "../test-utils.js";

const fetchEventReports = vi.fn();
const fetchTicketTypes = vi.fn();

// vi.mock factories are hoisted above this file's own bindings: the class goes through vi.hoisted(), as in ReportsPage.live.test.tsx.
const { MockApiError } = vi.hoisted(() => {
  class MockApiError extends Error {
    status: number;
    constructor(status: number, message: string) {
      super(message);
      this.status = status;
    }
  }
  return { MockApiError };
});

vi.mock("react-router", async (importOriginal) => {
  const actual = await importOriginal<typeof import("react-router")>();
  return {
    ...actual,
    useOutletContext: () => ({
      event: { archived_at: null, wallet_enabled: true, wallet_apple_enabled: true, wallet_google_enabled: true, wallet_samsung_enabled: true },
    }),
  };
});

vi.mock("../../src/hooks/useEventStream.js", () => ({ useEventStream: () => ({ connected: true, status: "connected" }) }));
vi.mock("../../src/connection/ConnectionStateProvider.js", () => ({ useConnectionState: () => connectionStateValue("connected", vi.fn()) }));
// react-apexcharts has no jsdom setup in this project: the chart of the Wallets tab is not what these tests look at.
vi.mock("react-apexcharts", () => ({ default: () => null }));
vi.mock("../../src/api/client.js", () => ({
  ApiError: MockApiError,
  fetchEventReports: (...args: unknown[]) => fetchEventReports(...args),
  fetchTicketTypes: (...args: unknown[]) => fetchTicketTypes(...args),
  exportEventReportsCsv: vi.fn(),
  eventReportsPrintUrl: (eventId: string) => `/api/admin/events/${eventId}/reports/export?format=pdf`,
  fetchEventWalletReports: vi.fn(),
  fetchEventMailReports: vi.fn(),
  fetchEventCustomFieldReports: vi.fn(),
  exportEventWalletReportsCsv: vi.fn(),
  eventWalletReportsPrintUrl: () => "",
  exportEventMailReportsCsv: vi.fn(),
  eventMailReportsPrintUrl: () => "",
  exportEventCustomFieldReportsCsv: vi.fn(),
  eventCustomFieldReportsPrintUrl: () => "",
}));

type LogRow = EventReportsResponse["admission_log"][number];

const admission = (n: number, over: Partial<LogRow> = {}): LogRow => ({
  attendee_id: `att-${n}`,
  name: `Guest ${n}`,
  email: `guest${n}@example.com`,
  ticket_type: null,
  admitted_at: "2026-06-01T10:00:00.000Z",
  operator_user_id: null,
  operator_display_name: null,
  operator_email: null,
  device_id: null,
  items: [],
  ...over,
});

function report(log: LogRow[], truncated = false): EventReportsResponse {
  return {
    timezone: "UTC",
    event: { id: "evt-1", title: "Demo Event", date: "2026-06-01T08:00:00.000Z", capacity: 100 },
    summary: { total_attendees: 10, admitted: log.length, no_shows: 10 - log.length, admission_rate_pct: 20, peak_hour: "10:00", peak_hour_count: log.length, companions_admitted: 0 },
    by_hour: [],
    by_ticket_type: [],
    admission_log: log,
    admission_log_truncated: truncated,
    admission_log_total: truncated ? 120 : log.length,
    by_rsvp_status: [],
    by_checkin_method: [],
    by_operator: [],
  };
}

function renderPage() {
  return renderWithToast(
    <MemoryRouter initialEntries={["/admin/events/evt-1/reports"]}>
      <Routes>
        <Route path="/admin/events/:eventId/reports" element={<ReportsPage />} />
      </Routes>
    </MemoryRouter>,
  );
}

const TWO_ADMISSIONS = [admission(1, { items: ["Badge", "Gift bag"] }), admission(2)];

beforeEach(() => {
  fetchTicketTypes.mockResolvedValue([]);
  fetchEventReports.mockResolvedValue(report(TWO_ADMISSIONS));
  mockMatchMedia(true);
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  vi.unstubAllGlobals();
});

describe("the Admission log of the Reports page", () => {
  it("draws the log in the shared box of a padded card, with its pager inside the card, and asks for 1024px for the table", async () => {
    const queries: string[] = [];
    vi.stubGlobal("matchMedia", (query: string) => {
      queries.push(query);
      return { matches: true, media: query, addEventListener: () => undefined, removeEventListener: () => undefined };
    });
    const { container } = renderPage();

    await waitFor(() => expect(container.querySelectorAll(".reports-log-box tbody tr")).toHaveLength(2));
    const table = container.querySelector(".item-table.reports-log-box > .attendees-table-wrap > table.table");
    expect(table).toBeTruthy();
    // A box inside the padded body of the card, with the pager under it in the same body, not a table bled to the edges of the card.
    const body = table!.closest(".at-card")?.querySelector(".at-card__body");
    expect(body?.contains(table)).toBe(true);
    expect(body?.querySelector(".audit-log-footer")).toBeTruthy();
    expect(container.querySelector(".reports-log-table-wrap")).toBeNull();
    expect(container.querySelector(".reports-log-footer")).toBeNull();
    expect(queries).toContain("(min-width: 1024px)");
  });

  it("draws cards, not a table, below 1024px", async () => {
    vi.stubGlobal("matchMedia", (query: string) => ({
      matches: query === "(min-width: 768px)",
      media: query,
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
    }));
    const { container } = renderPage();

    await waitFor(() => expect(container.querySelectorAll(".reports-log-card")).toHaveLength(2));
    expect(container.querySelector(".reports-log-box")).toBeNull();
  });

  it("keeps the columns in the order their widths are written for, with Items the one that a narrower screen folds", async () => {
    const { container } = renderPage();
    await waitFor(() => expect(container.querySelectorAll(".reports-log-box tbody tr")).toHaveLength(2));

    // reports-log-table.css writes the widths by position, so a column moved here would take another column's width.
    const head = [...container.querySelectorAll(".reports-log-box thead th")];
    expect(head.map((th) => th.textContent?.trim())).toEqual(["Attendee", "Ticket type", "Admitted at", "Checked in by", "Items"]);
    expect(head.filter((th) => th.classList.contains("reports-log-table__from-1180")).map((th) => th.textContent?.trim())).toEqual(["Items"]);

    const row = container.querySelector(".reports-log-box tbody tr")!;
    expect(row.children).toHaveLength(5);
    expect([...row.children].map((cell) => cell.classList.contains("reports-log-table__from-1180"))).toEqual([false, false, false, false, true]);
  });

  it("folds Items into a line under the guest only for an admission that issued something, and puts no text in the page twice", async () => {
    const { container } = renderPage();
    await waitFor(() => expect(container.querySelectorAll(".reports-log-box tbody tr")).toHaveLength(2));

    const lines = [...container.querySelectorAll(".reports-log-box .reports-log-table__below-1180")];
    expect(lines.map((line) => line.textContent)).toEqual(["Items: Badge, Gift bag"]);
    expect(lines[0]!.parentElement).toBe(lines[0]!.closest("tr")!.children[0]);
    // The items of the row are found once, in their column: the folded line is a text of its own. The row with none keeps its dash.
    expect(screen.getAllByText("Badge, Gift bag")).toHaveLength(1);
    expect(screen.getAllByText("-")).toHaveLength(1);
  });

  it("puts the note of a log cut to its latest rows above the box, inside the card", async () => {
    fetchEventReports.mockResolvedValue(report(TWO_ADMISSIONS, true));
    const { container } = renderPage();

    await waitFor(() => expect(container.querySelectorAll(".reports-log-box tbody tr")).toHaveLength(2));
    const note = container.querySelector(".reports-log-truncated")!;
    expect(note.textContent).toContain("Showing the latest 2 of 120 admissions");
    expect(note.nextElementSibling).toBe(container.querySelector(".reports-log-box"));
  });

  it("has a placeholder with the same box and the same Items heading folded, and one with cards below 1024px", async () => {
    fetchEventReports.mockReturnValue(new Promise(() => undefined));
    const first = renderPage();

    const placeholder = await screen.findByRole("status", { name: "Loading the report" });
    const folded = [...placeholder.querySelectorAll(".item-table.reports-log-box > .attendees-table-wrap th.reports-log-table__from-1180")];
    expect(folded.map((th) => th.textContent)).toEqual(["Items"]);
    expect(placeholder.querySelector(".reports-skeleton__footer")).toBeTruthy();
    expect(placeholder.querySelector(".reports-log-table-wrap")).toBeNull();
    first.unmount();

    vi.stubGlobal("matchMedia", (query: string) => ({
      matches: query === "(min-width: 768px)",
      media: query,
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
    }));
    renderPage();
    const narrow = await screen.findByRole("status", { name: "Loading the report" });
    expect(narrow.querySelectorAll(".reports-log-cards .reports-log-card")).toHaveLength(3);
    expect(narrow.querySelector(".reports-log-box")).toBeNull();
  });
});
