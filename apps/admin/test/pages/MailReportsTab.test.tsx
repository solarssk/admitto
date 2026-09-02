// @vitest-environment jsdom
import { Children, isValidElement, type ReactNode } from "react";
import { act, cleanup, fireEvent, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MailReportsTab } from "../../src/pages/MailReportsTab.js";
import { ApiError } from "../../src/api/client.js";
import type { EventMailReportsResponse } from "../../src/api/types.js";
import { connectionStateValue, mockMatchMedia, renderWithToast } from "../test-utils.js";

const fetchEventMailReports = vi.fn();
const reportApiError = vi.fn();

vi.mock("../../src/connection/ConnectionStateProvider.js", () => ({
  useConnectionState: () => connectionStateValue("connected", reportApiError),
}));

vi.mock("../../src/api/client.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../src/api/client.js")>()),
  fetchEventMailReports: (...args: unknown[]) => fetchEventMailReports(...args),
}));

// Same reasoning as WalletsReportsTab.test.tsx/CustomFieldsReportsTab.test.tsx's own "recharts"
// mock: no ResizeObserver polyfill under jsdom, so ResponsiveContainer would always measure a 0x0
// box. Each mocked chart root renders a marker div carrying its own data as a JSON attribute, so a
// test can assert on the data this component computes and passes into the chart instead of a real
// SVG render.
vi.mock("recharts", () => {
  function childProps(children: ReactNode, type: unknown): any {
    let found: any;
    Children.forEach(children, (child) => {
      if (isValidElement(child) && child.type === type) found = child.props;
    });
    return found;
  }

  const Cell = () => null;
  const Area = () => null;
  const XAxis = () => null;
  const YAxis = () => null;
  const CartesianGrid = () => null;
  const Tooltip = () => null;
  const Pie = () => null;

  const ResponsiveContainer = ({ children }: { children: ReactNode }) => <>{children}</>;

  const PieChart = ({ children }: { children: ReactNode }) => {
    const pie = childProps(children, Pie);
    const tooltip = childProps(children, Tooltip);
    const values = ((pie?.data ?? []) as Array<{ count: number }>).map((d) => d.count);
    return (
      <div
        data-testid="rc-pie"
        data-values={JSON.stringify(values)}
        data-tooltip-one={tooltip?.formatter?.(1)}
        data-tooltip-many={tooltip?.formatter?.(3)}
      />
    );
  };

  const AreaChart = ({ data }: { data: Array<{ date: number; value: number }> }) => (
    <div data-testid="rc-area" data-points={JSON.stringify(data)} />
  );

  return { ResponsiveContainer, PieChart, Pie, Cell, AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip };
});

function fixture(overrides: Partial<EventMailReportsResponse> = {}): EventMailReportsResponse {
  return {
    total_attendees: 5,
    delivery: {
      total_attempts: 6,
      successful: 2,
      successful_pct: 33.3,
      by_status: [
        { status: "queued", count: 1 },
        { status: "accepted", count: 1 },
        { status: "sent", count: 1 },
        { status: "failed", count: 1 },
        { status: "bounced", count: 1 },
        { status: "cancelled", count: 1 },
      ],
    },
    attendee_reach: { reached: 2, not_reached: 3, reached_pct: 40 },
    by_purpose: { initial: 5, resend: 1 },
    by_template: [
      { template: null, total: 5, successful: 1, successful_pct: 20 },
      { template: "Reminder", total: 1, successful: 1, successful_pct: 100 },
    ],
    sent_by_day: [
      { date: "2027-09-01", count: 1, cumulative: 1 },
      { date: "2027-09-02", count: 1, cumulative: 2 },
    ],
    ticket_viewed: { reached: 2, viewed: 1, viewed_pct: 50 },
    ...overrides,
  };
}

function cardByTitle(title: string): HTMLElement {
  const titleEl = Array.from(document.querySelectorAll(".at-card__title")).find((el) =>
    el.textContent?.includes(title),
  );
  const card = titleEl?.closest(".at-card");
  if (!card) throw new Error(`Card titled "${title}" not found`);
  return card as HTMLElement;
}

function breakdownRows(container: HTMLElement): Array<{ name: string; meta: string }> {
  return Array.from(container.querySelectorAll(".reports-breakdown-row")).map((row) => ({
    name: row.querySelector(".reports-breakdown-row__name")?.textContent ?? "",
    meta: row.querySelector(".reports-breakdown-row__meta")?.textContent ?? "",
  }));
}

function pieValues(container: HTMLElement): number[] {
  const el = container.querySelector('[data-testid="rc-pie"]');
  return JSON.parse(el?.getAttribute("data-values") ?? "null");
}

beforeEach(() => {
  mockMatchMedia(true);
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  vi.unstubAllGlobals();
});

describe("MailReportsTab", () => {
  it("shows the loading state once the delayed-loading threshold elapses", async () => {
    vi.useFakeTimers();
    let resolveFetch: (value: EventMailReportsResponse) => void = () => {};
    fetchEventMailReports.mockReturnValue(
      new Promise<EventMailReportsResponse>((resolve) => {
        resolveFetch = resolve;
      }),
    );
    try {
      renderWithToast(<MailReportsTab eventId="evt-1" isActive />);

      expect(screen.queryByText("Loading mail report…")).toBeNull();

      await act(async () => {
        await vi.advanceTimersByTimeAsync(200);
      });
      expect(screen.getByText("Loading mail report…")).toBeTruthy();

      await act(async () => {
        resolveFetch(fixture());
      });
    } finally {
      vi.useRealTimers();
    }
  });

  it("shows an EmptyState with a Retry action on a generic fetch error, and re-fetches on click", async () => {
    fetchEventMailReports.mockRejectedValueOnce(new ApiError(500, "Internal server problem"));
    fetchEventMailReports.mockResolvedValueOnce(fixture());

    renderWithToast(<MailReportsTab eventId="evt-1" isActive />);

    await screen.findByText("Could not load mail report");
    expect(screen.getByText("Internal server problem")).toBeTruthy();
    expect(reportApiError).toHaveBeenCalledWith(500);

    fireEvent.click(screen.getByRole("button", { name: "Retry" }));

    await waitFor(() => {
      expect(fetchEventMailReports).toHaveBeenCalledTimes(2);
    });
    expect(await screen.findByText("Email delivery")).toBeTruthy();
    expect(screen.queryByText("Could not load mail report")).toBeNull();
  });

  it("shows a generic message for a non-ApiError failure (e.g. a network error)", async () => {
    fetchEventMailReports.mockRejectedValueOnce(new TypeError("Failed to fetch"));

    renderWithToast(<MailReportsTab eventId="evt-1" isActive />);

    await screen.findByText("Could not load mail report");
    expect(screen.getByText("Could not load mail report.")).toBeTruthy();
    expect(reportApiError).not.toHaveBeenCalled();
  });

  it("shows the 403-specific access message instead of the server's own error text", async () => {
    fetchEventMailReports.mockRejectedValueOnce(new ApiError(403, "forbidden", "forbidden"));

    renderWithToast(<MailReportsTab eventId="evt-1" isActive />);

    await screen.findByText("Could not load mail report");
    expect(screen.getByText("You do not have access to this event.")).toBeTruthy();
    expect(reportApiError).toHaveBeenCalledWith(403);
  });

  it("shows an EmptyState when no email has ever been sent for this event", async () => {
    fetchEventMailReports.mockResolvedValue(
      fixture({
        delivery: { total_attempts: 0, successful: 0, successful_pct: 0, by_status: [] },
      }),
    );

    renderWithToast(<MailReportsTab eventId="evt-1" isActive />);

    expect(await screen.findByText("No emails sent yet")).toBeTruthy();
  });

  it("falls back to the raw status string and a neutral color for a status this tab doesn't have a label for", async () => {
    // Defensive fallback, not a real status EMAIL_DELIVERY_STATUS actually produces today - covers
    // the frontend and backend status enums drifting apart rather than a real product scenario.
    fetchEventMailReports.mockResolvedValue(
      fixture({
        delivery: { total_attempts: 1, successful: 0, successful_pct: 0, by_status: [{ status: "unknown_status", count: 1 }] },
      }),
    );

    renderWithToast(<MailReportsTab eventId="evt-1" isActive />);
    await screen.findByText("Email delivery");

    const deliveryCard = cardByTitle("Email delivery");
    expect(breakdownRows(deliveryCard)).toEqual([{ name: "unknown_status", meta: "1 · 100%" }]);
  });

  it("shows a chart-specific EmptyState when there are delivery attempts but none has succeeded yet", async () => {
    fetchEventMailReports.mockResolvedValue(
      fixture({
        delivery: { total_attempts: 2, successful: 0, successful_pct: 0, by_status: [{ status: "queued", count: 2 }] },
        sent_by_day: [],
      }),
    );

    renderWithToast(<MailReportsTab eventId="evt-1" isActive />);

    // The tab-wide guard only fires on zero attempts (already covered above) - this event has
    // attempts, just none successful yet, so the rest of the tab still renders normally and only
    // the "Emails sent over time" card falls back to its own empty state.
    await screen.findByText("Email delivery");
    expect(screen.getByText("Nothing sent successfully yet")).toBeTruthy();
    const chartCard = cardByTitle("Emails sent over time");
    expect(chartCard.querySelector('[data-testid="rc-area"]')).toBeNull();
  });

  it("renders every card's donut/breakdown from the aggregate response", async () => {
    fetchEventMailReports.mockResolvedValue(fixture());

    renderWithToast(<MailReportsTab eventId="evt-1" isActive />);
    await screen.findByText("Email delivery");

    // Delivery status donut - one slice per status, in the server's own order, plus a matching
    // breakdown row per status with its share of every delivery attempt (not just successes).
    const deliveryCard = cardByTitle("Email delivery");
    expect(pieValues(deliveryCard)).toEqual([1, 1, 1, 1, 1, 1]);
    expect(breakdownRows(deliveryCard)).toEqual([
      { name: "Queued", meta: "1 · 16.7%" },
      { name: "Accepted", meta: "1 · 16.7%" },
      { name: "Sent", meta: "1 · 16.7%" },
      { name: "Failed", meta: "1 · 16.7%" },
      { name: "Bounced", meta: "1 · 16.7%" },
      { name: "Cancelled", meta: "1 · 16.7%" },
    ]);

    // Attendee reach donut - reached vs not-reached, as a share of every attendee (not of attempts).
    const reachCard = cardByTitle("Attendee reach");
    expect(pieValues(reachCard)).toEqual([2, 3]);
    expect(breakdownRows(reachCard)).toEqual([
      { name: "Reached", meta: "2 · 40%" },
      { name: "Not reached", meta: "3 · 60%" },
    ]);

    // Initial vs resend - list only, no donut, same total-attempts denominator as Email delivery.
    const purposeCard = cardByTitle("Initial vs resend");
    expect(breakdownRows(purposeCard)).toEqual([
      { name: "Initial", meta: "5 · 83.3%" },
      { name: "Resend", meta: "1 · 16.7%" },
    ]);

    // Delivery by template - a null template reads as "Default ticket email", not a blank row.
    const templateCard = cardByTitle("Delivery by template");
    expect(breakdownRows(templateCard)).toEqual([
      { name: "Default ticket email", meta: "1 of 5 · 20%" },
      { name: "Reminder", meta: "1 of 1 · 100%" },
    ]);

    // Emails sent over time - a leading zero point one day before the first real day, then the
    // two real days in order.
    const chartCard = cardByTitle("Emails sent over time");
    const points = JSON.parse(
      chartCard.querySelector('[data-testid="rc-area"]')!.getAttribute("data-points") ?? "null",
    ) as Array<{ value: number }>;
    expect(points.map((p) => p.value)).toEqual([0, 1, 2]);

    // Ticket page opened - viewed vs not-yet-opened, as a share of reached attendees only (2), not
    // of every attendee (5).
    const viewedCard = cardByTitle("Ticket page opened");
    expect(pieValues(viewedCard)).toEqual([1, 1]);
    expect(breakdownRows(viewedCard)).toEqual([
      { name: "Opened ticket page", meta: "1 · 50%" },
      { name: "Not opened yet", meta: "1 · 50%" },
    ]);
  });

  it("skips mounting every ResponsiveContainer chart while the tab is hidden (isActive=false), keeping titles and breakdown lists rendered", async () => {
    fetchEventMailReports.mockResolvedValue(fixture());

    renderWithToast(<MailReportsTab eventId="evt-1" isActive={false} />);
    await screen.findByText("Email delivery");

    // ReportsPage keeps this tab mounted with display:none instead of unmounting it on tab switch
    // (to avoid refetching) - isActive gates only the actual chart mount, since a
    // ResponsiveContainer left alive underneath a display:none ancestor is what produces
    // Recharts' own "width(0) and height(0)" console warning the moment the wrapper collapses.
    const deliveryCard = cardByTitle("Email delivery");
    expect(deliveryCard.querySelector('[data-testid="rc-pie"]')).toBeNull();
    expect(breakdownRows(deliveryCard)).toEqual([
      { name: "Queued", meta: "1 · 16.7%" },
      { name: "Accepted", meta: "1 · 16.7%" },
      { name: "Sent", meta: "1 · 16.7%" },
      { name: "Failed", meta: "1 · 16.7%" },
      { name: "Bounced", meta: "1 · 16.7%" },
      { name: "Cancelled", meta: "1 · 16.7%" },
    ]);

    const chartCard = cardByTitle("Emails sent over time");
    expect(chartCard.querySelector('[data-testid="rc-area"]')).toBeNull();
  });
});
