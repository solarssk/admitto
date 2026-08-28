// @vitest-environment jsdom
import { act, cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { WalletsReportsTab } from "../../src/pages/WalletsReportsTab.js";
import { ApiError } from "../../src/api/client.js";
import type { EventWalletReportsResponse } from "../../src/api/types.js";
import { mockMatchMedia, renderWithToast } from "../test-utils.js";

const fetchEventWalletReports = vi.fn();
const reportApiError = vi.fn();

vi.mock("../../src/connection/ConnectionStateProvider.js", () => ({
  useConnectionState: () => ({ state: "connected", reportApiError }),
}));

vi.mock("../../src/api/client.js", () => ({
  ApiError: class ApiError extends Error {
    status: number;
    constructor(status: number, message: string) {
      super(message);
      this.status = status;
    }
  },
  fetchEventWalletReports: (...args: unknown[]) => fetchEventWalletReports(...args),
}));

// react-apexcharts has no jsdom-verified rendering path here (no ResizeObserver polyfill in
// apps/admin/vitest.config.ts) - stubbing it out lets these tests assert on the *data this
// component computes and passes into each chart* (the actual logic worth covering) instead of
// depending on a third-party SVG chart library rendering correctly under jsdom. `options` isn't
// JSON-serializable (it carries formatter functions) - capturing the raw objects in render order
// lets a test invoke a specific chart's own tooltip/label formatters directly, the only way to
// exercise that logic without a real ApexCharts instance calling them itself.
const capturedOptions: unknown[] = [];
vi.mock("react-apexcharts", () => ({
  default: (props: { series: unknown; type: string; options: unknown }) => {
    capturedOptions.push(props.options);
    return <div data-testid="apex-chart" data-series={JSON.stringify(props.series)} data-type={props.type} />;
  },
}));

function fixture(overrides: Partial<EventWalletReportsResponse> = {}): EventWalletReportsResponse {
  return {
    total_attendees: 20,
    synced_at: "2026-08-01T10:00:00.000Z",
    passes_truncated: false,
    adoption: { got_pass: 15, got_pass_pct: 75, confirmed: 10, confirmed_pct: 66.7, cancelled: 3 },
    platform: { apple_only: 6, google_only: 3, both: 1, not_installed: 5 },
    by_ticket_type: [
      { key: "vip", type: "VIP", color: "purple", total: 5, got_pass: 4, pct: 80 },
      { key: "standard", type: "Standard", color: "gray", total: 10, got_pass: 6, pct: 60 },
      { key: null, type: "Unknown", color: "gray", total: 2, got_pass: 0, pct: 0 },
    ],
    issued_by_day: [
      { date: "2026-06-01", count: 2, cumulative: 2 },
      { date: "2026-06-02", count: 3, cumulative: 5 },
    ],
    time_to_wallet_tap: {
      average_days: 4.2,
      buckets: [
        { key: "same_day", count: 5, pct: 50 },
        { key: "1_3", count: 3, pct: 30 },
        { key: "4_7", count: 1, pct: 10 },
        { key: "8_plus", count: 1, pct: 10 },
      ],
    },
    admission_by_wallet: {
      with_wallet: { total: 12, admitted: 9, pct: 75 },
      without_wallet: { total: 8, admitted: 2, pct: 25 },
    },
    ...overrides,
  };
}

/** Cards title their header with `<HintLabel>` for two of these cards ("Wallet adoption",
 * "Wallet platform"), which renders the title text alongside a trailing icon inside the same
 * tooltip-trigger wrapper as `.at-card__title` itself - both nodes end up with identical
 * `textContent`, so a plain `screen.getByText(title)` throws "multiple elements found" for those
 * two cards. Locating the `.at-card` by its title text via `closest` sidesteps that ambiguity
 * for every card uniformly. */
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

function chartSeries(el: HTMLElement): unknown {
  return JSON.parse(el.getAttribute("data-series") ?? "null");
}

/** Every captured chart `options` object (see the react-apexcharts mock above) whose own
 * `chart.type` matches - each chart component sets this itself, redundantly with the `type` prop,
 * so it doubles as a stable way to pick out one chart's options among everything captured this
 * render. `options` isn't JSON-serializable (it carries formatter functions), so this is the only
 * way to reach them - chartSeries above only covers the `data-series` attribute. */
function optionsByType(type: string): Record<string, any>[] {
  return capturedOptions.filter((o) => (o as { chart?: { type?: string } }).chart?.type === type) as Record<
    string,
    any
  >[];
}

beforeEach(() => {
  mockMatchMedia(true);
  capturedOptions.length = 0;
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  vi.unstubAllGlobals();
});

describe("WalletsReportsTab", () => {
  it("shows the loading state once the delayed-loading threshold elapses", async () => {
    vi.useFakeTimers();
    let resolveFetch: (value: EventWalletReportsResponse) => void = () => {};
    fetchEventWalletReports.mockReturnValue(
      new Promise<EventWalletReportsResponse>((resolve) => {
        resolveFetch = resolve;
      }),
    );
    try {
      renderWithToast(<WalletsReportsTab eventId="evt-1" />);

      // useDelayedLoading only flips on after 200ms of continuous loading - before that the
      // component renders nothing (data is still null), so this also proves the delay is real
      // rather than the text simply being present from the first render.
      expect(screen.queryByText("Loading wallet report…")).toBeNull();

      await act(async () => {
        await vi.advanceTimersByTimeAsync(200);
      });
      expect(screen.getByText("Loading wallet report…")).toBeTruthy();

      await act(async () => {
        resolveFetch(fixture());
      });
    } finally {
      vi.useRealTimers();
    }
  });

  it("shows an EmptyState with a Retry action on a generic fetch error, and re-fetches on click", async () => {
    fetchEventWalletReports.mockRejectedValueOnce(new ApiError(500, "Internal server problem"));
    fetchEventWalletReports.mockResolvedValueOnce(fixture());

    renderWithToast(<WalletsReportsTab eventId="evt-1" />);

    await screen.findByText("Failed to load wallet report");
    expect(screen.getByText("Internal server problem")).toBeTruthy();
    expect(reportApiError).toHaveBeenCalledWith(500);

    fireEvent.click(screen.getByRole("button", { name: "Retry" }));

    await waitFor(() => {
      expect(fetchEventWalletReports).toHaveBeenCalledTimes(2);
    });
    expect(await screen.findByText("Wallet adoption")).toBeTruthy();
    expect(screen.queryByText("Failed to load wallet report")).toBeNull();
  });

  it("shows a generic message for a non-ApiError failure (e.g. a network error)", async () => {
    fetchEventWalletReports.mockRejectedValueOnce(new TypeError("Failed to fetch"));

    renderWithToast(<WalletsReportsTab eventId="evt-1" />);

    await screen.findByText("Failed to load wallet report");
    expect(screen.getByText("Failed to load wallet report.")).toBeTruthy();
    expect(reportApiError).not.toHaveBeenCalled();
  });

  it("shows the 403-specific access message instead of the server's own error text", async () => {
    // Real 403 body is { error: "forbidden" }, which client.ts's parseJson maps to both message
    // and code (see apiErrorCodeFromBody's fallback to body.error) - passed explicitly here since
    // the source now branches on the normalized code, not the raw status.
    fetchEventWalletReports.mockRejectedValueOnce(new ApiError(403, "forbidden", "forbidden"));

    renderWithToast(<WalletsReportsTab eventId="evt-1" />);

    await screen.findByText("Failed to load wallet report");
    expect(screen.getByText("You do not have access to this event.")).toBeTruthy();
    expect(reportApiError).toHaveBeenCalledWith(403);
  });

  it("renders populated adoption, platform, ticket-type, and time-to-tap data with correctly computed percentages", async () => {
    const data = fixture();
    fetchEventWalletReports.mockResolvedValue(data);

    renderWithToast(<WalletsReportsTab eventId="evt-1" />);
    await screen.findByText("Wallet adoption");

    // Adoption gauge: [issuedPct, installedPct, voidedPct] - voidedPct (20) is computed by the
    // component itself via pctOf(cancelled=3, got_pass=15), not read straight off the fixture.
    const adoptionCard = cardByTitle("Wallet adoption");
    expect(chartSeries(within(adoptionCard).getByTestId("apex-chart"))).toEqual([75, 66.7, 20]);
    expect(breakdownRows(adoptionCard)).toEqual([
      { name: "Issued", meta: "15 · 75%" },
      { name: "Installed", meta: "10 · 66.7% of issued" },
      { name: "Voided", meta: "3 · ticket revoked" },
    ]);

    // Platform donut: apple_only, google_only, samsung placeholder (always 0), both, not_installed
    // - and the breakdown list's own per-platform percentages, each independently computed by
    // pctOf(count, issued=15).
    const platformCard = cardByTitle("Wallet platform");
    expect(chartSeries(within(platformCard).getByTestId("apex-chart"))).toEqual([6, 3, 0, 1, 5]);
    expect(breakdownRows(platformCard)).toEqual([
      { name: "Apple Wallet", meta: "6 · 40%" },
      { name: "Google Wallet", meta: "3 · 20%" },
      { name: "Samsung Wallet", meta: "0 · 0%" },
      { name: "More than one wallet", meta: "1 · 6.7%" },
      { name: "No wallet installed", meta: "5 · 33.3%" },
    ]);

    // Ticket-type breakdown: sorted descending by pct, and the null-key row relabeled "No ticket
    // type" instead of showing its raw `type` string.
    const ticketCard = cardByTitle("Adoption by ticket type");
    expect(breakdownRows(ticketCard)).toEqual([
      { name: "VIP", meta: "4 of 5 · 80%" },
      { name: "Standard", meta: "6 of 10 · 60%" },
      { name: "No ticket type", meta: "0 of 2 · 0%" },
    ]);

    // Cumulative chart: a leading zero point one day before the first real day is unshifted onto
    // the series, so a 2-row fixture produces 3 plotted points ending at the real final cumulative.
    const cumulativeCard = cardByTitle("Cumulative passes issued");
    const cumulativeSeries = chartSeries(within(cumulativeCard).getByTestId("apex-chart")) as Array<{
      data: [number, number][];
    }>;
    expect(cumulativeSeries[0]!.data).toHaveLength(3);
    expect(cumulativeSeries[0]!.data[0]![1]).toBe(0);
    expect(cumulativeSeries[0]!.data.at(-1)).toEqual([Date.parse("2026-06-02T12:00:00Z"), 5]);

    // Time-to-tap bar chart: one bar per bucket, series value is each bucket's own pct.
    const tapCard = cardByTitle("Time to wallet tap");
    const tapSeries = chartSeries(within(tapCard).getByTestId("apex-chart")) as Array<{ data: number[] }>;
    expect(tapSeries[0]!.data).toEqual([50, 30, 10, 10]);

    // Admission-by-wallet compare: two independent gauges plus the delta pill between them.
    const compareCard = cardByTitle("Admission rate by wallet status");
    const compareCharts = within(compareCard).getAllByTestId("apex-chart");
    expect(compareCharts.map((el) => chartSeries(el))).toEqual([[75], [25]]);
    const subs = compareCard.querySelectorAll(".wallets-compare-group__sub");
    expect(subs[0]?.textContent).toBe("9 of 12 attendees");
    expect(subs[1]?.textContent).toBe("2 of 8 attendees");
    expect(compareCard.querySelector(".wallets-compare-delta__pill")?.textContent).toBe("▲ +50 pts");

    // No truncation notice for this (default) fixture.
    expect(document.querySelector(".wallets-truncated-notice")).toBeNull();
  });

  it("shows the down-arrow delta when the wallet group's admission rate trails the no-wallet group's", async () => {
    fetchEventWalletReports.mockResolvedValue(
      fixture({
        admission_by_wallet: {
          with_wallet: { total: 10, admitted: 3, pct: 30 },
          without_wallet: { total: 10, admitted: 5, pct: 50 },
        },
      }),
    );

    renderWithToast(<WalletsReportsTab eventId="evt-1" />);
    await screen.findByText("Wallet adoption");

    const compareCard = cardByTitle("Admission rate by wallet status");
    expect(compareCard.querySelector(".wallets-compare-delta__pill")?.textContent).toBe("▼ 20 pts");
  });

  it("renders the truncation notice when passes_truncated is true, and omits it otherwise", async () => {
    fetchEventWalletReports.mockResolvedValue(fixture({ passes_truncated: true }));

    renderWithToast(<WalletsReportsTab eventId="evt-1" />);
    await screen.findByText("Wallet adoption");

    const notice = document.querySelector(".wallets-truncated-notice");
    expect(notice).toBeTruthy();
    expect(notice?.textContent).toContain(
      "This event has more issued wallet passes than a single report can process at once",
    );
  });

  it("shows the CumulativeChart's own empty copy when no passes have been issued yet", async () => {
    fetchEventWalletReports.mockResolvedValue(fixture({ issued_by_day: [] }));

    renderWithToast(<WalletsReportsTab eventId="evt-1" />);
    await screen.findByText("Wallet adoption");

    const cumulativeCard = cardByTitle("Cumulative passes issued");
    expect(within(cumulativeCard).getByText("No passes issued yet.")).toBeTruthy();
    expect(within(cumulativeCard).queryByTestId("apex-chart")).toBeNull();
  });

  it("shows 'Not enough data yet' instead of the time-to-tap chart when there's no average yet", async () => {
    fetchEventWalletReports.mockResolvedValue(
      fixture({ time_to_wallet_tap: { average_days: null, buckets: [] } }),
    );

    renderWithToast(<WalletsReportsTab eventId="evt-1" />);
    await screen.findByText("Wallet adoption");

    const tapCard = cardByTitle("Time to wallet tap");
    expect(within(tapCard).getByText("Not enough data yet.")).toBeTruthy();
    expect(within(tapCard).queryByTestId("apex-chart")).toBeNull();
  });

  it("formats chart tooltip/label text with correct singular/plural and rounding", async () => {
    fetchEventWalletReports.mockResolvedValue(fixture());
    renderWithToast(<WalletsReportsTab eventId="evt-1" />);
    await screen.findByText("Wallet adoption");

    const [donutOptions] = optionsByType("donut");
    expect(donutOptions!.tooltip.y.formatter(1)).toBe("1 pass");
    expect(donutOptions!.tooltip.y.formatter(2)).toBe("2 passes");
    expect(donutOptions!.tooltip.y.formatter(0)).toBe("0 passes");

    const [barOptions] = optionsByType("bar");
    // buckets fixture: [{count:5},{count:3},{count:1},{count:1}] - dataPointIndex 2 and 3 are the
    // fixture's two count===1 buckets, exercising the tooltip's own singular/plural branch.
    expect(barOptions!.dataLabels.formatter(undefined, { dataPointIndex: 0 })).toBe("5");
    expect(barOptions!.tooltip.y.formatter(50, { dataPointIndex: 0 })).toBe("5 attendees (50%)");
    expect(barOptions!.tooltip.y.formatter(10, { dataPointIndex: 2 })).toBe("1 attendee (10%)");
    // opts?.dataPointIndex ?? 0 - undefined opts falls back to bucket 0, not a crash.
    expect(barOptions!.dataLabels.formatter(undefined, undefined)).toBe("5");

    const [areaOptions] = optionsByType("area");
    expect(areaOptions!.yaxis.labels.formatter(2.6)).toBe("3");
    expect(barOptions!.yaxis.labels.formatter(49.6)).toBe("50%");

    // AdmissionGauge's own radialBar value label (AdoptionGauge, the other radialBar chart on
    // this tab, hides its value label entirely and has no formatter to exercise).
    const admissionGaugeOptions = optionsByType("radialBar").find(
      (o) => typeof o.plotOptions?.radialBar?.dataLabels?.value?.formatter === "function",
    );
    expect(admissionGaugeOptions!.plotOptions.radialBar.dataLabels.value.formatter(75)).toBe("75%");
  });

  it("shows the 'No wallet passes yet' EmptyState when nothing has been issued at all", async () => {
    fetchEventWalletReports.mockResolvedValue(
      fixture({
        adoption: { got_pass: 0, got_pass_pct: 0, confirmed: 0, confirmed_pct: 0, cancelled: 0 },
      }),
    );

    renderWithToast(<WalletsReportsTab eventId="evt-1" />);

    expect(await screen.findByText("No wallet passes yet")).toBeTruthy();
    expect(
      screen.getByText(
        "This card fills in once attendees start adding their ticket to Apple or Google Wallet.",
      ),
    ).toBeTruthy();
    expect(screen.queryByText("Wallet adoption")).toBeNull();
  });
});
