// @vitest-environment jsdom
import { Children, isValidElement, type ReactElement, type ReactNode } from "react";
import { act, cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { WalletsReportsTab } from "../../src/pages/WalletsReportsTab.js";
import { ApiError } from "../../src/api/client.js";
import type { EventWalletReportsResponse } from "../../src/api/types.js";
import { connectionStateValue, mockMatchMedia, renderWithToast } from "../test-utils.js";

const fetchEventWalletReports = vi.fn();
const reportApiError = vi.fn();

vi.mock("../../src/connection/ConnectionStateProvider.js", () => ({
  useConnectionState: () => connectionStateValue("connected", reportApiError),
}));

vi.mock("../../src/api/client.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../src/api/client.js")>()),
  fetchEventWalletReports: (...args: unknown[]) => fetchEventWalletReports(...args),
}));

// Donut/cumulative/bar Tooltip and axis formatters (see below).
let capturedDonut: { values: number[]; tooltipFormatter?: (value: number) => string } | undefined;
let capturedCumulative:
  | {
      points: Array<{ date: number; value: number }>;
      yTickFormatter?: (v: number) => string;
      yTicks?: number[];
      yWidth?: number;
      labelFormatter?: (label: number) => string;
    }
  | undefined;
let capturedTap:
  | {
      rows: Array<{ label: string; pct: number; count: number }>;
      yTickFormatter?: (v: number) => string;
      yWidth?: number;
      tooltipFormatter?: (
        value: number,
        name: string,
        props: { payload: { count: number } },
      ) => [string, undefined];
      barShape?: (props: {
        x: number;
        y: number;
        width: number;
        height: number;
        payload: { pct: number; count: number; fill: string };
      }) => ReactElement;
    }
  | undefined;

// Recharts has no jsdom-verified rendering path here (no ResizeObserver polyfill in
// apps/admin/vitest.config.ts, and jsdom doesn't do real layout anyway, so ResponsiveContainer
// would always measure a 0x0 box) - stubbing it out lets these tests assert on the *data this
// component computes and passes into each chart* (the actual logic worth covering) instead of
// depending on a third-party SVG chart library rendering correctly under jsdom. Each mocked
// chart-root component (RadialBarChart/PieChart/AreaChart/BarChart) renders a marker div carrying
// its own `data` as a `data-*` JSON attribute (the direct equivalent of ApexCharts' own `series`),
// and separately captures its Tooltip/axis-formatter and Bar `label` render-prop functions (not
// JSON-serializable) so a test can invoke them directly - the only way to exercise that logic
// without a real Recharts instance calling them itself.
vi.mock("recharts", () => {
  function childProps(children: ReactNode, type: unknown): any {
    let found: any;
    Children.forEach(children, (child) => {
      if (isValidElement(child) && child.type === type) found = child.props;
    });
    return found;
  }

  const RadialBar = () => null;
  const PolarAngleAxis = () => null;
  const Cell = () => null;
  const Area = () => null;
  const Bar = () => null;
  const XAxis = () => null;
  const YAxis = () => null;
  const CartesianGrid = () => null;
  const Tooltip = () => null;
  const Pie = () => null;

  const ResponsiveContainer = ({ children }: { children: ReactNode }) => <>{children}</>;

  const RadialBarChart = ({ data }: { data: Array<{ value: number }> }) => (
    <div data-testid="rc-radialbar" data-values={JSON.stringify(data.map((d) => d.value))} />
  );

  const PieChart = ({ children }: { children: ReactNode }) => {
    const pie = childProps(children, Pie);
    const tooltip = childProps(children, Tooltip);
    const values = ((pie?.data ?? []) as Array<{ count: number }>).map((d) => d.count);
    capturedDonut = { values, tooltipFormatter: tooltip?.formatter };
    return <div data-testid="rc-pie" data-values={JSON.stringify(values)} />;
  };

  const AreaChart = ({
    data,
    children,
  }: {
    data: Array<{ date: number; value: number }>;
    children: ReactNode;
  }) => {
    const yAxis = childProps(children, YAxis);
    const tooltip = childProps(children, Tooltip);
    capturedCumulative = {
      points: data,
      yTickFormatter: yAxis?.tickFormatter,
      yTicks: yAxis?.ticks,
      yWidth: yAxis?.width,
      labelFormatter: tooltip?.labelFormatter,
    };
    return <div data-testid="rc-area" data-points={JSON.stringify(data)} />;
  };

  const BarChart = ({
    data,
    children,
  }: {
    data: Array<{ label: string; pct: number; count: number }>;
    children: ReactNode;
  }) => {
    const yAxis = childProps(children, YAxis);
    const tooltip = childProps(children, Tooltip);
    const bar = childProps(children, Bar);
    capturedTap = {
      rows: data,
      yTickFormatter: yAxis?.tickFormatter,
      yWidth: yAxis?.width,
      tooltipFormatter: tooltip?.formatter,
      barShape: bar?.shape,
    };
    return <div data-testid="rc-bar" data-rows={JSON.stringify(data)} />;
  };

  return {
    ResponsiveContainer,
    RadialBarChart,
    RadialBar,
    PolarAngleAxis,
    PieChart,
    Pie,
    Cell,
    AreaChart,
    Area,
    BarChart,
    Bar,
    XAxis,
    YAxis,
    CartesianGrid,
    Tooltip,
  };
});

function fixture(overrides: Partial<EventWalletReportsResponse> = {}): EventWalletReportsResponse {
  return {
    total_attendees: 20,
    synced_at: "2026-08-01T10:00:00.000Z",
    passes_truncated: false,
    adoption: { got_pass: 15, got_pass_pct: 75, confirmed: 10, confirmed_pct: 66.7 },
    platform: { apple_only: 6, google_only: 3, samsung_only: 0, both: 1 },
    // Sums to confirmed=10 above (6+3+0+1).
    registrations_per_attendee: {
      buckets: [
        { key: "1", count: 6, pct: 60 },
        { key: "2", count: 3, pct: 30 },
        { key: "3", count: 1, pct: 10 },
        { key: "4_plus", count: 0, pct: 0 },
      ],
    },
    // got_pass/pct (issued) deliberately differ from confirmed/confirmed_pct (installed) below -
    // the "Adoption by ticket type" card must read the confirmed numbers, not got_pass, since a
    // ticket type can have issued-but-not-installed passes (e.g. VIP: 5 issued, only 4 installed).
    by_ticket_type: [
      { key: "vip", type: "VIP", color: "purple", total: 5, got_pass: 5, pct: 100, confirmed: 4, confirmed_pct: 80 },
      { key: "standard", type: "Standard", color: "gray", total: 10, got_pass: 8, pct: 80, confirmed: 6, confirmed_pct: 60 },
      { key: null, type: "Unknown", color: "gray", total: 2, got_pass: 1, pct: 50, confirmed: 0, confirmed_pct: 0 },
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
    time_to_install_after_reminder: {
      eligible_count: 0,
      average_days: null,
      buckets: [
        { key: "same_day", count: 0, pct: 0 },
        { key: "1_3", count: 0, pct: 0 },
        { key: "4_7", count: 0, pct: 0 },
        { key: "8_plus", count: 0, pct: 0 },
      ],
    },
    admission_by_wallet: {
      with_wallet: { total: 12, admitted: 9, pct: 75 },
      without_wallet: { total: 8, admitted: 2, pct: 25 },
    },
    // Sums to adoption.got_pass=15 above, not adoption.confirmed=10 (unlike `platform` and
    // `registrations_per_attendee` above) - never_installed passes were issued but never
    // confirmed installed at all, so they're outside `confirmed` while still counting here.
    wallet_lifecycle: { active: 6, removed: 3, never_installed: 6 },
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

/** Reads the `data-values` JSON attribute the mocked `RadialBarChart`/`PieChart` (see the
 * "recharts" mock above) captures from each ring's/slice's own `value`/`count` field - the
 * Recharts equivalent of the old `data-series` attribute. */
function dataValues(el: HTMLElement): number[] {
  return JSON.parse(el.getAttribute("data-values") ?? "null");
}

function dataPoints(el: HTMLElement): Array<{ date: number; value: number }> {
  return JSON.parse(el.getAttribute("data-points") ?? "null");
}

function dataRows(el: HTMLElement): Array<{ label: string; pct: number; count: number }> {
  return JSON.parse(el.getAttribute("data-rows") ?? "null");
}

beforeEach(() => {
  mockMatchMedia(true);
  capturedDonut = undefined;
  capturedCumulative = undefined;
  capturedTap = undefined;
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
      renderWithToast(
      <WalletsReportsTab isActive eventId="evt-1" walletPlatforms={{ apple: true, google: true, samsung: true, any: true }} />,
    );

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

    renderWithToast(
      <WalletsReportsTab isActive eventId="evt-1" walletPlatforms={{ apple: true, google: true, samsung: true, any: true }} />,
    );

    await screen.findByText("Could not load wallet report");
    expect(screen.getByText("Internal server problem")).toBeTruthy();
    expect(reportApiError).toHaveBeenCalledWith(500);

    fireEvent.click(screen.getByRole("button", { name: "Retry" }));

    await waitFor(() => {
      expect(fetchEventWalletReports).toHaveBeenCalledTimes(2);
    });
    expect(await screen.findByText("Wallet adoption")).toBeTruthy();
    expect(screen.queryByText("Could not load wallet report")).toBeNull();
  });

  it("shows a generic message for a non-ApiError failure (e.g. a network error)", async () => {
    fetchEventWalletReports.mockRejectedValueOnce(new TypeError("Failed to fetch"));

    renderWithToast(
      <WalletsReportsTab isActive eventId="evt-1" walletPlatforms={{ apple: true, google: true, samsung: true, any: true }} />,
    );

    await screen.findByText("Could not load wallet report");
    expect(screen.getByText("Could not load wallet report.")).toBeTruthy();
    expect(reportApiError).not.toHaveBeenCalled();
  });

  it("shows the 403-specific access message instead of the server's own error text", async () => {
    // Real 403 body is { error: "forbidden" }, which client.ts's parseJson maps to both message
    // and code (see apiErrorCodeFromBody's fallback to body.error) - passed explicitly here since
    // the source now branches on the normalized code, not the raw status.
    fetchEventWalletReports.mockRejectedValueOnce(new ApiError(403, "forbidden", "forbidden"));

    renderWithToast(
      <WalletsReportsTab isActive eventId="evt-1" walletPlatforms={{ apple: true, google: true, samsung: true, any: true }} />,
    );

    await screen.findByText("Could not load wallet report");
    expect(screen.getByText("You do not have access to this event.")).toBeTruthy();
    expect(reportApiError).toHaveBeenCalledWith(403);
  });

  it("renders populated adoption, platform, ticket-type, and time-to-tap data with correctly computed percentages", async () => {
    const data = fixture();
    fetchEventWalletReports.mockResolvedValue(data);

    renderWithToast(
      <WalletsReportsTab isActive eventId="evt-1" walletPlatforms={{ apple: true, google: true, samsung: true, any: true }} />,
    );
    await screen.findByText("Wallet adoption");

    // Adoption gauge: rings are listed [installedPct, issuedPct] (innermost to outermost) so
    // Issued actually renders as the outer ring - see the AdoptionGauge doc comment. Both rings
    // share the same base (total_attendees=20): installed is 10/20=50%, not confirmed_pct's own
    // 66.7% (which is a share of issued=15, kept in the breakdown row's text only - bot review).
    const adoptionCard = cardByTitle("Wallet adoption");
    expect(dataValues(within(adoptionCard).getByTestId("rc-radialbar"))).toEqual([50, 75]);
    expect(breakdownRows(adoptionCard)).toEqual([
      { name: "Issued", meta: "15 · 75% of attendees" },
      { name: "Installed", meta: "10 · 66.7% of issued" },
    ]);

    // Platform donut: apple_only, google_only, samsung_only (real data, 0 in this fixture), both -
    // no "not installed" slice (that's the Wallet adoption card's job) - and the breakdown list's
    // own per-platform percentages, each independently computed by pctOf(count,
    // installed=wallet_lifecycle.active=6). This card reads wallet_lifecycle.active, not
    // adoption.confirmed=10 - platform stays a live-right-now count, unlike adoption.confirmed
    // itself (see EventWalletReportsResponse's own doc comment) - so this fixture's own
    // platform slices (6+3+0+1=10) don't actually sum to the donut's center value (6); a real
    // server response keeps the two in sync (platform sums to wallet_lifecycle.active by
    // construction), this hand-written fixture just doesn't bother modeling that.
    const platformCard = cardByTitle("Wallet platform");
    expect(dataValues(within(platformCard).getByTestId("rc-pie"))).toEqual([6, 3, 0, 1]);
    expect(breakdownRows(platformCard)).toEqual([
      { name: "Apple Wallet", meta: "6 · 100%" },
      { name: "Google Wallet", meta: "3 · 50%" },
      { name: "Samsung Wallet", meta: "0 · 0%" },
      { name: "More than one wallet", meta: "1 · 16.7%" },
    ]);

    // Devices per attendee bar chart: one bar per bucket, matching fixture()'s buckets
    // (6/3/1/0, summing to confirmed=10 above).
    const devicesCard = cardByTitle("Devices per attendee");
    const deviceRows = dataRows(within(devicesCard).getByTestId("rc-bar"));
    expect(deviceRows.map((r) => r.pct)).toEqual([60, 30, 10, 0]);

    // Ticket-type breakdown: sorted descending by confirmed_pct (installed, not got_pass/pct
    // which are issued), and the null-key row relabeled "No ticket type" instead of showing its
    // raw `type` string.
    const ticketCard = cardByTitle("Adoption by ticket type");
    expect(breakdownRows(ticketCard)).toEqual([
      { name: "VIP", meta: "4 of 5 · 80%" },
      { name: "Standard", meta: "6 of 10 · 60%" },
      { name: "No ticket type", meta: "0 of 2 · 0%" },
    ]);

    // Cumulative chart: a leading zero point one day before the first real day is unshifted onto
    // the series, so a 2-row fixture produces 3 plotted points ending at the real final cumulative.
    const cumulativeCard = cardByTitle("Cumulative passes issued");
    const cumulativePoints = dataPoints(within(cumulativeCard).getByTestId("rc-area"));
    expect(cumulativePoints).toHaveLength(3);
    expect(cumulativePoints[0]!.value).toBe(0);
    expect(cumulativePoints.at(-1)).toEqual({ date: Date.parse("2026-06-02T12:00:00Z"), value: 5 });
    // axisMax=5 (1 digit) here - see the dedicated Y-axis-width tests below for how this scales
    // with the actual digit count instead of Recharts' own flat 60px default gutter.
    expect(capturedCumulative?.yWidth).toBe(23);

    // Time-to-tap bar chart: one bar per bucket, each row carrying its own bucket's own pct.
    const tapCard = cardByTitle("Time to wallet install");
    const tapRows = dataRows(within(tapCard).getByTestId("rc-bar"));
    expect(tapRows.map((r) => r.pct)).toEqual([50, 30, 10, 10]);
    // Percentage axes share one fixed width (PERCENT_Y_AXIS_WIDTH) regardless of the actual
    // values, since their domain is always [0, 100] - "100%" is always the longest possible label.
    expect(capturedTap?.yWidth).toBe(46);

    // Admission-by-wallet compare: two independent gauges (their own percentage rendered as
    // plain text now, not a chart-native label) plus the delta pill between them.
    const compareCard = cardByTitle("Admission rate by wallet status");
    const compareGauges = within(compareCard).getAllByTestId("rc-radialbar");
    expect(compareGauges.map((el) => dataValues(el))).toEqual([[75], [25]]);
    expect(within(compareCard).getByText("75%")).toBeTruthy();
    expect(within(compareCard).getByText("25%")).toBeTruthy();
    const subs = compareCard.querySelectorAll(".wallets-compare-group__sub");
    expect(subs[0]?.textContent).toBe("9 of 12 attendees");
    expect(subs[1]?.textContent).toBe("2 of 8 attendees");
    expect(compareCard.querySelector(".wallets-compare-delta__pill")?.textContent).toBe("▲ +50 pts");

    // Wallet lifecycle donut: active, removed, never_installed (fixture's 6/3/6, summing to
    // adoption.got_pass=15, not adoption.confirmed=10) - and the breakdown list's own percentages,
    // each independently computed against got_pass (not confirmed, unlike the platform card).
    const lifecycleCard = cardByTitle("Wallet lifecycle");
    expect(dataValues(within(lifecycleCard).getByTestId("rc-pie"))).toEqual([6, 3, 6]);
    expect(breakdownRows(lifecycleCard)).toEqual([
      { name: "Active", meta: "6 · 40%" },
      { name: "Removed", meta: "3 · 20%" },
      { name: "Never installed", meta: "6 · 40%" },
    ]);
    // Centers on the ring's whole (got_pass=15), not the "Removed" slice's own value - that value
    // is already shown in the "Removed" legend row above.
    expect(lifecycleCard.querySelector(".wallets-gauge-overlay__value")?.textContent).toBe("15");
    expect(lifecycleCard.querySelector(".wallets-gauge-overlay__label")?.textContent).toBe("issued");

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

    renderWithToast(
      <WalletsReportsTab isActive eventId="evt-1" walletPlatforms={{ apple: true, google: true, samsung: true, any: true }} />,
    );
    await screen.findByText("Wallet adoption");

    const compareCard = cardByTitle("Admission rate by wallet status");
    expect(compareCard.querySelector(".wallets-compare-delta__pill")?.textContent).toBe("▼ 20 pts");
  });

  it("renders the truncation notice when passes_truncated is true, and omits it otherwise", async () => {
    fetchEventWalletReports.mockResolvedValue(fixture({ passes_truncated: true }));

    renderWithToast(
      <WalletsReportsTab isActive eventId="evt-1" walletPlatforms={{ apple: true, google: true, samsung: true, any: true }} />,
    );
    await screen.findByText("Wallet adoption");

    const notice = document.querySelector(".wallets-truncated-notice");
    expect(notice).toBeTruthy();
    expect(notice?.textContent).toContain(
      "This event has more issued wallet passes than a single report can process at once",
    );
  });

  it("shows the CumulativeChart's own empty copy when no passes have been issued yet", async () => {
    fetchEventWalletReports.mockResolvedValue(fixture({ issued_by_day: [] }));

    renderWithToast(
      <WalletsReportsTab isActive eventId="evt-1" walletPlatforms={{ apple: true, google: true, samsung: true, any: true }} />,
    );
    await screen.findByText("Wallet adoption");

    const cumulativeCard = cardByTitle("Cumulative passes issued");
    expect(within(cumulativeCard).getByText("No passes issued yet.")).toBeTruthy();
    expect(within(cumulativeCard).queryByTestId("rc-area")).toBeNull();
  });

  it("still renders the time-to-tap chart, all-zero, when there's no average yet - buckets are always 4 zero-filled entries from the backend, never truly absent", async () => {
    fetchEventWalletReports.mockResolvedValue(
      fixture({
        time_to_wallet_tap: {
          average_days: null,
          buckets: [
            { key: "same_day", count: 0, pct: 0 },
            { key: "1_3", count: 0, pct: 0 },
            { key: "4_7", count: 0, pct: 0 },
            { key: "8_plus", count: 0, pct: 0 },
          ],
        },
      }),
    );

    renderWithToast(
      <WalletsReportsTab isActive eventId="evt-1" walletPlatforms={{ apple: true, google: true, samsung: true, any: true }} />,
    );
    await screen.findByText("Wallet adoption");

    const tapCard = cardByTitle("Time to wallet install");
    const tapRows = dataRows(within(tapCard).getByTestId("rc-bar"));
    expect(tapRows.map((r) => r.pct)).toEqual([0, 0, 0, 0]);
  });

  it("still renders the Time to install after reminder chart, all-zero, when eligible_count is 0 - same as Time to wallet install, never a text-only fallback", async () => {
    fetchEventWalletReports.mockResolvedValue(fixture());

    renderWithToast(
      <WalletsReportsTab isActive eventId="evt-1" walletPlatforms={{ apple: true, google: true, samsung: true, any: true }} />,
    );
    await screen.findByText("Wallet adoption");

    const reminderCard = cardByTitle("Time to install after reminder");
    const reminderRows = dataRows(within(reminderCard).getByTestId("rc-bar"));
    expect(reminderRows.map((r) => r.pct)).toEqual([0, 0, 0, 0]);
  });

  it("renders real, non-zero bars for Time to install after reminder once eligible_count is non-zero", async () => {
    fetchEventWalletReports.mockResolvedValue(
      fixture({
        time_to_install_after_reminder: {
          eligible_count: 4,
          average_days: 0.5,
          buckets: [
            { key: "same_day", count: 3, pct: 75 },
            { key: "1_3", count: 1, pct: 25 },
            { key: "4_7", count: 0, pct: 0 },
            { key: "8_plus", count: 0, pct: 0 },
          ],
        },
      }),
    );

    renderWithToast(
      <WalletsReportsTab isActive eventId="evt-1" walletPlatforms={{ apple: true, google: true, samsung: true, any: true }} />,
    );
    await screen.findByText("Wallet adoption");

    const reminderCard = cardByTitle("Time to install after reminder");
    const reminderRows = dataRows(within(reminderCard).getByTestId("rc-bar"));
    expect(reminderRows.map((r) => r.pct)).toEqual([75, 25, 0, 0]);
  });

  it("still renders the devices-per-attendee chart, all-zero, when nothing is confirmed - buckets are always 4 zero-filled entries from the backend, never truly absent", async () => {
    fetchEventWalletReports.mockResolvedValue(
      fixture({
        adoption: { got_pass: 15, got_pass_pct: 75, confirmed: 0, confirmed_pct: 0 },
        registrations_per_attendee: {
          buckets: [
            { key: "1", count: 0, pct: 0 },
            { key: "2", count: 0, pct: 0 },
            { key: "3", count: 0, pct: 0 },
            { key: "4_plus", count: 0, pct: 0 },
          ],
        },
      }),
    );

    renderWithToast(
      <WalletsReportsTab isActive eventId="evt-1" walletPlatforms={{ apple: true, google: true, samsung: true, any: true }} />,
    );
    await screen.findByText("Wallet adoption");

    const devicesCard = cardByTitle("Devices per attendee");
    const deviceRows = dataRows(within(devicesCard).getByTestId("rc-bar"));
    expect(deviceRows.map((r) => r.pct)).toEqual([0, 0, 0, 0]);
  });

  it("formats chart tooltip/label text with correct singular/plural and rounding", async () => {
    fetchEventWalletReports.mockResolvedValue(fixture());
    renderWithToast(
      <WalletsReportsTab isActive eventId="evt-1" walletPlatforms={{ apple: true, google: true, samsung: true, any: true }} />,
    );
    await screen.findByText("Wallet adoption");

    expect(capturedDonut?.tooltipFormatter?.(1)).toBe("1 pass");
    expect(capturedDonut?.tooltipFormatter?.(2)).toBe("2 passes");
    expect(capturedDonut?.tooltipFormatter?.(0)).toBe("0 passes");

    // buckets fixture: [{count:5},{count:3},{count:1},{count:1}] - index 2 is one of the
    // fixture's two count===1 buckets (pct 10, below the 15% "label fits inside the bar"
    // threshold), exercising the same singular/plural and color-threshold logic the old
    // ApexCharts dataLabels formatter/color array covered. The bar and its count label are both
    // drawn by the <Bar shape> render prop now (not Recharts' own default rectangle + a separate
    // label prop - see WalletsReportsTab.tsx's BarShape comment for why) - calling it directly
    // with synthetic geometry, then reaching into its <text> child, is the only way to exercise
    // this without a real Recharts render.
    const tallBarShape = capturedTap?.barShape?.({
      x: 0,
      y: 100,
      width: 40,
      height: 130,
      payload: { pct: 50, count: 5, fill: "#000000" },
    });
    const tallBarText = (tallBarShape?.props.children as ReactElement[])[1] as ReactElement<{ children: number; fill: string }>;
    expect(tallBarText.props.children).toBe(5);
    expect(tallBarText.props.fill).toBe("#ffffff");
    const shortBarShape = capturedTap?.barShape?.({
      x: 0,
      y: 220,
      width: 40,
      height: 10,
      payload: { pct: 10, count: 1, fill: "#000000" },
    });
    const shortBarText = (shortBarShape?.props.children as ReactElement[])[1] as ReactElement<{ children: number; fill: string }>;
    expect(shortBarText.props.children).toBe(1);
    expect(shortBarText.props.fill).not.toBe("#ffffff");

    expect(capturedTap?.tooltipFormatter?.(50, "pct", { payload: { count: 5 } })).toEqual([
      "5 attendees (50%)",
      undefined,
    ]);
    expect(capturedTap?.tooltipFormatter?.(10, "pct", { payload: { count: 1 } })).toEqual([
      "1 attendee (10%)",
      undefined,
    ]);

    expect(capturedCumulative?.yTickFormatter?.(2.6)).toBe("3");
    expect(capturedTap?.yTickFormatter?.(49.6)).toBe("50%");
  });

  it("computes a 'nice' whole-number Y-axis step for the cumulative chart, not a fractional default", async () => {
    // niceStepMultiplier's three non-trivial bands (normalized <= 2, <= 5, and the > 5 fallback
    // to 10) - the <= 1 band is already exercised by the main fixture test above (final
    // cumulative 5 normalizes to exactly 1).
    const cases: Array<{ finalCumulative: number; ticks: number[] }> = [
      { finalCumulative: 8, ticks: [0, 2, 4, 6, 8] },
      { finalCumulative: 20, ticks: [0, 5, 10, 15, 20] },
      { finalCumulative: 45, ticks: [0, 10, 20, 30, 40, 50] },
    ];

    for (const { finalCumulative, ticks } of cases) {
      fetchEventWalletReports.mockResolvedValue(
        fixture({ issued_by_day: [{ date: "2026-06-01", count: finalCumulative, cumulative: finalCumulative }] }),
      );

      renderWithToast(
        <WalletsReportsTab isActive eventId="evt-1" walletPlatforms={{ apple: true, google: true, samsung: true, any: true }} />,
      );
      await screen.findByText("Wallet adoption");

      expect(capturedCumulative?.yTicks).toEqual(ticks);
      cleanup();
    }
  });

  it("gives the cumulative chart's Y-axis one tick of headroom above the max when it's 1, instead of pinning the line to the axis's own ceiling", async () => {
    fetchEventWalletReports.mockResolvedValue(
      fixture({ issued_by_day: [{ date: "2026-06-01", count: 1, cumulative: 1 }] }),
    );

    renderWithToast(
      <WalletsReportsTab isActive eventId="evt-1" walletPlatforms={{ apple: true, google: true, samsung: true, any: true }} />,
    );
    await screen.findByText("Wallet adoption");

    expect(capturedCumulative?.yTicks).toEqual([0, 1, 2]);
  });

  it("widens the cumulative chart's Y-axis gutter for a wider axis max, instead of Recharts' own flat default", async () => {
    // axisMax=2 (1 digit, from the headroom test above) vs axisMax=1000 (4 digits) - real digit
    // counts an event's actual pass total can produce, not two arbitrary numbers.
    const cases: Array<{ finalCumulative: number; width: number }> = [
      { finalCumulative: 1, width: 23 },
      { finalCumulative: 999, width: 42 },
    ];

    for (const { finalCumulative, width } of cases) {
      fetchEventWalletReports.mockResolvedValue(
        fixture({ issued_by_day: [{ date: "2026-06-01", count: finalCumulative, cumulative: finalCumulative }] }),
      );

      renderWithToast(
        <WalletsReportsTab isActive eventId="evt-1" walletPlatforms={{ apple: true, google: true, samsung: true, any: true }} />,
      );
      await screen.findByText("Wallet adoption");

      expect(capturedCumulative?.yWidth).toBe(width);
      cleanup();
    }
  });

  it("formats the cumulative chart's tooltip label as a full date", async () => {
    fetchEventWalletReports.mockResolvedValue(fixture());
    renderWithToast(
      <WalletsReportsTab isActive eventId="evt-1" walletPlatforms={{ apple: true, google: true, samsung: true, any: true }} />,
    );
    await screen.findByText("Wallet adoption");

    expect(capturedCumulative?.labelFormatter?.(Date.parse("2026-06-02T12:00:00Z"))).toBe("02 Jun 2026");
  });

  it("prevents the browser's default focus-ring outline on a chart click, at the mousedown event level", async () => {
    fetchEventWalletReports.mockResolvedValue(fixture());
    renderWithToast(
      <WalletsReportsTab isActive eventId="evt-1" walletPlatforms={{ apple: true, google: true, samsung: true, any: true }} />,
    );
    await screen.findByText("Wallet adoption");

    // fireEvent's return value mirrors native dispatchEvent: false once a handler in the
    // (bubbling) chain has called preventDefault() - see preventFocusRing's own comment in
    // WalletsReportsTab.tsx for why this runs at the event level instead of relying on CSS.
    const cumulativeCard = cardByTitle("Cumulative passes issued");
    const notPrevented = fireEvent.mouseDown(within(cumulativeCard).getByTestId("rc-area"));
    expect(notPrevented).toBe(false);
  });

  it("excludes the Google slice and 'More than one wallet' from the donut and breakdown when Google Wallet is disabled for the event", async () => {
    fetchEventWalletReports.mockResolvedValue(fixture());

    renderWithToast(
      <WalletsReportsTab isActive eventId="evt-1" walletPlatforms={{ apple: true, google: false, samsung: true, any: true }} />,
    );
    await screen.findByText("Wallet adoption");

    const platformCard = cardByTitle("Wallet platform");
    expect(dataValues(within(platformCard).getByTestId("rc-pie"))).toEqual([6, 0]);
    expect(breakdownRows(platformCard)).toEqual([
      { name: "Apple Wallet", meta: "6 · 100%" },
      { name: "Samsung Wallet", meta: "0 · 0%" },
    ]);
    expect(within(platformCard).getByText(/they used\.$/)).toBeTruthy();
    expect(within(platformCard).queryByText(/more than one at once/)).toBeNull();
  });

  it("excludes the Apple slice from the donut and breakdown when Apple Wallet is disabled for the event", async () => {
    fetchEventWalletReports.mockResolvedValue(fixture());

    renderWithToast(
      <WalletsReportsTab isActive eventId="evt-1" walletPlatforms={{ apple: false, google: true, samsung: true, any: true }} />,
    );
    await screen.findByText("Wallet adoption");

    const platformCard = cardByTitle("Wallet platform");
    expect(dataValues(within(platformCard).getByTestId("rc-pie"))).toEqual([3, 0]);
    expect(breakdownRows(platformCard)).toEqual([
      { name: "Google Wallet", meta: "3 · 50%" },
      { name: "Samsung Wallet", meta: "0 · 0%" },
    ]);
  });

  it("keeps the 'More than one wallet' slice and the 'more than one at once' description only when both platforms are enabled", async () => {
    fetchEventWalletReports.mockResolvedValue(fixture());

    renderWithToast(
      <WalletsReportsTab isActive eventId="evt-1" walletPlatforms={{ apple: true, google: true, samsung: true, any: true }} />,
    );
    await screen.findByText("Wallet adoption");

    const platformCard = cardByTitle("Wallet platform");
    expect(within(platformCard).getByText(/more than one at once\.$/)).toBeTruthy();
    expect(breakdownRows(platformCard).map((r) => r.name)).toContain("More than one wallet");
  });

  it("excludes the Samsung Wallet slice from the donut and breakdown when Samsung Wallet is disabled for the event", async () => {
    fetchEventWalletReports.mockResolvedValue(fixture());

    renderWithToast(
      <WalletsReportsTab
        isActive
        eventId="evt-1"
        walletPlatforms={{ apple: true, google: true, samsung: false, any: true }}
      />,
    );
    await screen.findByText("Wallet adoption");

    const platformCard = cardByTitle("Wallet platform");
    // Apple, Google, More than one wallet - no Samsung slice.
    expect(dataValues(within(platformCard).getByTestId("rc-pie"))).toEqual([6, 3, 1]);
    expect(breakdownRows(platformCard).map((r) => r.name)).toEqual([
      "Apple Wallet",
      "Google Wallet",
      "More than one wallet",
    ]);
  });

  it("does not count Samsung toward 'More than one wallet', which stays Apple+Google only", async () => {
    fetchEventWalletReports.mockResolvedValue(fixture());

    renderWithToast(
      <WalletsReportsTab
        isActive
        eventId="evt-1"
        walletPlatforms={{ apple: true, google: false, samsung: true, any: true }}
      />,
    );
    await screen.findByText("Wallet adoption");

    const platformCard = cardByTitle("Wallet platform");
    expect(breakdownRows(platformCard).map((r) => r.name)).toEqual(["Apple Wallet", "Samsung Wallet"]);
  });

  // Regression: platformSlices() used to hardcode the Samsung slice's count to 0 - proves it now
  // reads platform.samsung_only from the DTO the same way the Apple/Google slices read their own
  // counts, not just that it happens to render 0 when the fixture's value is 0.
  it("renders a real, non-zero Samsung slice from platform.samsung_only", async () => {
    fetchEventWalletReports.mockResolvedValue(
      fixture({
        adoption: { got_pass: 15, got_pass_pct: 75, confirmed: 12, confirmed_pct: 80 },
        platform: { apple_only: 6, google_only: 3, samsung_only: 2, both: 1 },
      }),
    );

    renderWithToast(
      <WalletsReportsTab isActive eventId="evt-1" walletPlatforms={{ apple: true, google: true, samsung: true, any: true }} />,
    );
    await screen.findByText("Wallet adoption");

    const platformCard = cardByTitle("Wallet platform");
    expect(dataValues(within(platformCard).getByTestId("rc-pie"))).toEqual([6, 3, 2, 1]);
    // Denominator is wallet_lifecycle.active=6 (unchanged by this override, base fixture()'s own
    // value - it isn't overridden here), not adoption.confirmed=12 as overridden above.
    expect(breakdownRows(platformCard)).toContainEqual({ name: "Samsung Wallet", meta: "2 · 33.3%" });
  });

  it("shows the 'No wallet passes yet' EmptyState when nothing has been issued at all", async () => {
    fetchEventWalletReports.mockResolvedValue(
      fixture({
        adoption: { got_pass: 0, got_pass_pct: 0, confirmed: 0, confirmed_pct: 0 },
      }),
    );

    renderWithToast(
      <WalletsReportsTab isActive eventId="evt-1" walletPlatforms={{ apple: true, google: true, samsung: true, any: true }} />,
    );

    expect(await screen.findByText("No wallet passes yet")).toBeTruthy();
    expect(
      screen.getByText(
        "This card fills in once attendees start adding their ticket to Apple or Google Wallet.",
      ),
    ).toBeTruthy();
    expect(screen.queryByText("Wallet adoption")).toBeNull();
  });
});
