import { memo, useCallback, useEffect, useRef, useState } from "react";
import type { ApexOptions } from "apexcharts";
import Chart from "react-apexcharts";
import { Button, Card, EmptyState, HintLabel, Notice, ticketTypeChartColor } from "@admitto/ui";
import type { EnabledWalletPlatforms } from "@admitto/shared";
import { ApiError, fetchEventWalletReports } from "../api/client.js";
import { hasApiErrorCode, operatorApiErrorMessage } from "../api/operator-api-error.js";
import type { EventWalletReportsResponse } from "../api/types.js";
import { useConnectionState } from "../connection/ConnectionStateProvider.js";
import { useDelayedLoading } from "../hooks/useDelayedLoading.js";
import { viewerLocalTime } from "../utils/event-dates.js";
import { BreakdownRows, pctOf, type BreakdownRow } from "./ReportsPage.js";
// This component's own .wallets-* rules live in reports-page.css alongside ReportsPage's own
// styles (one card-grid family, not a separate stylesheet) - importing it here too, not just
// relying on ReportsPage.tsx already having it loaded, matches this app's own convention that
// every consumer of a shared CSS file imports it directly (AGENTS.md's lazy-chunk gotcha).
import "./reports-page.css";

// Literal hex, not var(--token): ApexCharts does color math (hover shades, gradients) on these
// strings in JS, which a CSS custom-property reference can't feed - kept in sync with
// packages/ui/src/styles/tokens/colors.css by name in each comment below.
const PRIMARY = "#066fd1"; // --primary / --at-blue
const STATUS_OK = "#2fb344"; // --status-ok / --at-green
const STATUS_ERROR = "#d63939"; // --status-error / --at-red
const GRAY_400 = "#94a3b8"; // --at-gray-400
const GRAY_100 = "#f1f5f9"; // --at-gray-100, radial/donut track background
const TEXT_PRIMARY = "#1d273b"; // --text-primary / --at-ink
const TEXT_MUTED = "#64748b"; // --text-muted / --at-gray-500
const BORDER = "#e6e7e9"; // --border
const FONT_FAMILY = "Inter, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif"; // --font-sans

// Vivid, not literal brand marks - two rounds of trying to stay close to each brand's actual mark
// (Apple's jet-black #1d1d1f, then a desaturated gray #6e6e73, then a darker slate #37474f) all
// still read as dark/lifeless once a slice fills a meaningful share of the donut (PO review, three
// times over). Apple and Samsung don't have one universal "brand color" the way Google does
// anyway (Apple's own mark is black/white; Samsung's is a blue that would clash with Google's
// below) - so instead of forcing a near-black/gray onto Apple, this borrows a genuinely vivid
// accent iOS itself uses throughout its own UI (systemOrange), and gives Samsung a distinct vivid
// teal rather than a second blue.
const APPLE_ORANGE = "#ff9500"; // iOS's own "systemOrange" - vivid, not a literal Apple mark, but on-brand via iOS's design language
const GOOGLE_BLUE = "#4285f4"; // Google's four-color logo blue
const SAMSUNG_TEAL = "#00bcd4"; // vivid teal/cyan - Samsung's own brand blue would read as a second, indistinguishable Google
const MULTI_PURPLE = "#8a31a0"; // --status-vip-fg / --at-purple - an internal token, reused for "more than one wallet app" since that's not any single brand's color

const BUCKET_LABELS: Record<EventWalletReportsResponse["time_to_wallet_tap"]["buckets"][number]["key"], string> = {
  same_day: "Same day",
  "1_3": "1-3 days",
  "4_7": "4-7 days",
  "8_plus": "8+ days",
};
const BUCKET_COLORS: Record<EventWalletReportsResponse["time_to_wallet_tap"]["buckets"][number]["key"], string> = {
  same_day: STATUS_OK,
  "1_3": PRIMARY,
  "4_7": "#f59f00", // --at-yellow
  "8_plus": GRAY_400,
};

/** HintLabel next to the card title, not a bare icon in the header's actions slot - the app's
 * own established convention for a card-title info icon (ReportsPage.tsx's "Attendance
 * confirmation" card, EventSettingsPage.tsx, AccountPage.tsx, ...) puts it inline with the title
 * text itself, not off to the side where actions live. The sync time only matters to someone
 * wondering why a number looks stale, so it still lives behind a hover rather than competing for
 * attention with the title on every view. */
function syncedHint(syncedAt: string | null): string {
  const label = syncedAt ? `Synced at ${viewerLocalTime(syncedAt)}` : "Not synced yet";
  return `${label}. Reflects Apple/Google's last registration check for this event - refreshes each time the wallet-sync job runs, not on every page load.`;
}

/** Three-stage funnel as one radialBar with three series, outer to inner: share of attendees the
 * pass was issued to, share of those installed on a phone, share of those later voided (a ticket
 * revoke). Installed and Voided share the same base (issued passes, not total attendees) - they're
 * two different outcomes for an issued pass, not nested within each other, but concentric rings
 * are still the clearest way to show all three alongside the breakdown rows without a second
 * chart engine. "Voided" matches the same term WalletPassStatus and the rest of the admin SPA
 * (walletStatusBadge.tsx) already use - never "revoked", which is reserved for the ticket/attendee
 * action that causes it. */
function AdoptionGauge({
  issuedPct,
  installedPct,
  voidedPct,
  installedCount,
}: Readonly<{ issuedPct: number; installedPct: number; voidedPct: number; installedCount: number }>) {
  // ApexCharts' own plotOptions.radialBar.dataLabels.total center label silently doesn't render
  // for a multi-series radialBar (confirmed empirically - the single-series gauges below render
  // their dataLabels fine, only this multi-series "total" path came back with zero <text> nodes in
  // the rendered SVG). An absolutely-positioned HTML overlay draws the center text instead, so it
  // doesn't depend on that library quirk.
  const options: ApexOptions = {
    // sparkline is safe here specifically (unlike AdmissionGauge below) because this chart has no
    // ApexCharts-native label to lose - name/value are already hidden and the HTML overlay draws
    // the center text instead. Without it, ApexCharts reserves a fixed margin around the rings
    // (room for a title it never gets) that made them visibly float inside their own box instead
    // of filling it - sparkline strips that reserved space so the rings actually use the size the
    // container was widened to.
    chart: { type: "radialBar", toolbar: { show: false }, fontFamily: FONT_FAMILY, sparkline: { enabled: true } },
    labels: ["Issued", "Installed", "Voided"],
    colors: [PRIMARY, STATUS_OK, STATUS_ERROR],
    stroke: { lineCap: "round" },
    plotOptions: {
      radialBar: {
        hollow: { size: "32%" },
        track: { background: GRAY_100 },
        dataLabels: { name: { show: false }, value: { show: false } },
      },
    },
  };
  return (
    <div className="wallets-gauge-overlay">
      <Chart type="radialBar" series={[issuedPct, installedPct, voidedPct]} options={options} height={256} />
      <div className="wallets-gauge-overlay__center">
        <span className="wallets-gauge-overlay__value">{installedCount}</span>
        <span className="wallets-gauge-overlay__label">installed</span>
      </div>
    </div>
  );
}

/** Donut, not one ring per platform - a pass can be actively registered on more than one
 * platform at once (the same attendee opening the ticket link on an iPhone and an Android
 * device, say), so the five slices here are mutually exclusive (apple-only / google-only /
 * samsung / multiple / not installed) and always sum to the issued total, instead of two
 * independent "% with Apple" and "% with Google" numbers that could each look high while
 * double-counting the same passes. Samsung has no PassCreator signal yet - its slice is always
 * 0, reserving the legend entry without a fake percentage. Ordered single-platform-first (Apple,
 * Google, Samsung), then the two "doesn't map to one platform" buckets (multiple, none) - not
 * alphabetical, not by expected size, but grouping like with like reads clearest in a legend a
 * viewer scans top to bottom (PO review). */
interface PlatformSlice {
  label: string;
  color: string;
  count: number;
}

/** Single source of truth for the donut's slices and the breakdown list's rows - both need the
 * exact same set, in the exact same order, and two independent hand-written copies could silently
 * drift apart later (e.g. if real Samsung data is wired in and only one copy gets updated).
 * Apple/Google slices - and "more than one wallet", which only means something once two platforms
 * are both offered - drop out entirely (not just to a 0% slice) when the event's own Wallet
 * settings don't offer that platform, matching the same enabledPlatforms gating the Wallets tab
 * itself, the PDF export, and the CSV export all now share. Samsung has no enable/disable toggle
 * of its own (no PassCreator signal yet either) - its reserved, always-0 legend entry is
 * unaffected by which of Apple/Google are on. */
function platformSlices(
  platform: EventWalletReportsResponse["platform"],
  enabledPlatforms: EnabledWalletPlatforms,
): PlatformSlice[] {
  return [
    enabledPlatforms.apple && { label: "Apple Wallet", color: APPLE_ORANGE, count: platform.apple_only },
    enabledPlatforms.google && { label: "Google Wallet", color: GOOGLE_BLUE, count: platform.google_only },
    // Named the same way as a real wallet app, not a bare provider name - "Samsung" alone reads
    // like an unfinished sentence next to "Apple Wallet"/"Google Wallet".
    { label: "Samsung Wallet", color: SAMSUNG_TEAL, count: 0 },
    enabledPlatforms.apple &&
      enabledPlatforms.google && { label: "More than one wallet", color: MULTI_PURPLE, count: platform.both },
    { label: "No wallet installed", color: GRAY_400, count: platform.not_installed },
  ].filter((slice): slice is PlatformSlice => slice !== false);
}

/** Own legend replaced by the same fixed-circle-plus-BreakdownRows shape as AdoptionGauge, not
 * ApexCharts' built-in one - a donut's built-in legend claims its own slice of the chart's width,
 * so at the same container width this circle rendered visibly smaller than AdoptionGauge's ring
 * beside it (a different chart type with a different internal layout wasn't a coincidence, it was
 * the actual cause). Both cards now build the same "fixed circle | flexible list" row, so the two
 * circles size and center identically at every breakpoint instead of two unrelated layouts
 * happening to look similar at one specific width. */
function PlatformDonut({
  platform,
  issued,
  enabledPlatforms,
}: Readonly<{
  platform: EventWalletReportsResponse["platform"];
  issued: number;
  enabledPlatforms: EnabledWalletPlatforms;
}>) {
  const slices = platformSlices(platform, enabledPlatforms);
  const series = slices.map((s) => s.count);
  const options: ApexOptions = {
    chart: { type: "donut", fontFamily: FONT_FAMILY },
    labels: slices.map((s) => s.label),
    colors: slices.map((s) => s.color),
    stroke: { width: 2, colors: ["#ffffff"] },
    // Both native ApexCharts label paths off - see AdoptionGauge above for why this same HTML
    // overlay exists at all: its center text is a standardized fs-h1/fs-xs pair shared by both
    // gauge cards, not each chart's own native labels at their own ad hoc sizes. Here that
    // mattered doubly - donut.labels' center text and the per-slice dataLabels were BOTH also
    // getting shrunk again by customScale below (already reducing the whole chart to 80% of its
    // canvas to match AdoptionGauge's ring size), compounding into the "Issued"/"1"/"100.0%"
    // text reading as too small to use. The per-slice percentage is redundant with the
    // breakdown list's own "<count> · <pct>%" column anyway.
    dataLabels: { enabled: false },
    legend: { show: false },
    plotOptions: {
      pie: {
        // A donut fills its own canvas far more fully than a radialBar does by default (measured
        // via a horizontal scan of which element renders at each pixel, not any single element's
        // bounding box - those were misleading here, e.g. the pie's own hole circle looks like an
        // "outer edge" measurement until you check what shrinks when you change donut.size - at
        // ~93% vs. AdoptionGauge's ~74% of the same 256px canvas). customScale shrinks the whole
        // donut uniformly from its own center, tuned against that ratio so both circles land on
        // the same outer diameter.
        customScale: 0.8,
        donut: {
          size: "58%",
          labels: { show: false },
        },
      },
    },
    tooltip: { y: { formatter: (val: number) => `${val} pass${val === 1 ? "" : "es"}` } },
  };
  return (
    <div className="wallets-gauge-overlay">
      <Chart type="donut" series={series} options={options} height={256} />
      <div className="wallets-gauge-overlay__center">
        <span className="wallets-gauge-overlay__value">{issued}</span>
        <span className="wallets-gauge-overlay__label">issued</span>
      </div>
    </div>
  );
}

function platformBreakdownRows(
  platform: EventWalletReportsResponse["platform"],
  issued: number,
  enabledPlatforms: EnabledWalletPlatforms,
): BreakdownRow[] {
  return platformSlices(platform, enabledPlatforms).map((slice) => ({
    id: slice.label,
    label: slice.label,
    meta: `${slice.count} · ${pctOf(slice.count, issued)}%`,
    pct: pctOf(slice.count, issued),
    color: slice.color,
  }));
}

/** Rounds a normalized step (roughStep / magnitude, so always in [1, 10)) up to the nearest of the
 * classic "nice number" progression 1-2-5-10. */
function niceStepMultiplier(normalized: number): number {
  if (normalized <= 1) return 1;
  if (normalized <= 2) return 2;
  if (normalized <= 5) return 5;
  return 10;
}

/** Picks a "nice" whole-number step/max for a count axis (classic d3-style nice-number scaling) -
 * ApexCharts' own default divides min..max into a fixed number of equal ticks regardless of the
 * data's actual units, which for a small pass count (e.g. max 1) produced fractional labels
 * (0, 0.2, 0.4, 0.6, 0.8, 1) that can never really occur since passes only come in whole units. */
function niceCountAxis(max: number): { axisMax: number; tickAmount: number } {
  if (max <= 1) return { axisMax: 1, tickAmount: 1 };
  const roughStep = max / 5;
  const magnitude = 10 ** Math.floor(Math.log10(roughStep));
  const normalized = roughStep / magnitude;
  // Counts are always whole numbers - clamp to at least 1 so a small max (e.g. 2 or 3) can't pick
  // a fractional step like 0.5 the way the raw "nice number" progression otherwise would.
  const step = Math.max(1, niceStepMultiplier(normalized) * magnitude);
  const tickAmount = Math.ceil(max / step);
  return { axisMax: tickAmount * step, tickAmount };
}

/** Area chart via ApexCharts, not hand-drawn SVG - the previous version had two real bugs from
 * rolling this by hand (a CSS specificity conflict on the last axis label, and axis text
 * distorted by the non-uniform viewBox scaling a hand-built responsive chart needs). A real
 * charting library's datetime axis avoids both classes of bug entirely. */
function CumulativeChart({ data }: Readonly<{ data: EventWalletReportsResponse["issued_by_day"] }>) {
  if (data.length === 0) {
    return <p className="wallets-description">No passes issued yet.</p>;
  }

  // Noon UTC, not midnight - a date-only value pinned to midnight can render as the previous
  // calendar day once ApexCharts formats it in the viewer's own local timezone.
  const points: [number, number][] = data.map((d) => [Date.parse(`${d.date}T12:00:00Z`), d.cumulative]);
  // The first real day's cumulative is never 0 (it's already counting that day's own passes), so
  // without this the line starts flat at that count instead of visibly rising from 0.
  points.unshift([points[0]![0] - 24 * 60 * 60 * 1000, 0]);
  const series = [{ name: "Passes issued", data: points }];
  const { axisMax, tickAmount } = niceCountAxis(data.at(-1)!.cumulative);
  const options: ApexOptions = {
    // Animations off - the entrance animation redraws the line growing left-to-right, and until
    // it settles the x-axis ticks it lands on can visibly shift, reading as the dates "jumping"
    // on every load. Nothing about this chart benefits from animating in.
    chart: { type: "area", toolbar: { show: false }, zoom: { enabled: false }, animations: { enabled: false }, fontFamily: FONT_FAMILY },
    dataLabels: { enabled: false },
    stroke: { curve: "smooth", width: 2.5 },
    colors: [PRIMARY],
    fill: { type: "gradient", gradient: { shadeIntensity: 1, opacityFrom: 0.3, opacityTo: 0, stops: [0, 90, 100] } },
    xaxis: {
      type: "datetime",
      // Explicit day-only format - data is per calendar day, so ApexCharts' own auto-format
      // (which shows a time-of-day component on a short date range) added a meaningless "12:00".
      labels: { style: { fontSize: "11px", colors: TEXT_MUTED }, format: "dd MMM" },
      axisBorder: { color: BORDER },
      axisTicks: { color: BORDER },
    },
    yaxis: {
      min: 0,
      max: axisMax,
      tickAmount,
      labels: { style: { fontSize: "11px", colors: TEXT_MUTED }, formatter: (v: number) => Math.round(v).toString() },
    },
    grid: { borderColor: BORDER, strokeDashArray: 3 },
    tooltip: { x: { format: "dd MMM yyyy" } },
    markers: { size: 0 },
  };
  return <Chart type="area" series={series} options={options} height={220} />;
}

function ticketTypeAdoptionRows(rows: EventWalletReportsResponse["by_ticket_type"]): BreakdownRow[] {
  return [...rows]
    .sort((a, b) => b.pct - a.pct)
    .map((row) => ({
      id: row.key ?? "__none__",
      label: row.key === null ? "No ticket type" : row.type,
      meta: `${row.got_pass} of ${row.total} · ${row.pct}%`,
      pct: row.pct,
      // "gray" is an assignable ticket-type color (an admin can pick it for a real type, as this
      // event's own "Standard" type does), so reusing ticketTypeChartColor's gray for "no ticket
      // type" too can make the two rows collide - a step lighter keeps this row visibly distinct
      // no matter what color real types happen to use.
      color: row.key === null ? "var(--at-gray-400)" : ticketTypeChartColor(row.color),
    }));
}

/** Bar chart, not a breakdown list - four short rows of text left this card noticeably shorter
 * than "Admission rate by wallet status" beside it (both stretch to match the taller one), and a
 * distribution across "how many days" reads more naturally as bar heights to compare at a glance
 * than as percentage text anyway. Each bar distributed to its own bucket color (same mapping the
 * list used) via plotOptions.bar.distributed, not a single series color. */
function TimeToTapChart({ buckets }: Readonly<{ buckets: EventWalletReportsResponse["time_to_wallet_tap"]["buckets"] }>) {
  const options: ApexOptions = {
    chart: { type: "bar", toolbar: { show: false }, fontFamily: FONT_FAMILY },
    plotOptions: { bar: { distributed: true, borderRadius: 4, columnWidth: "50%" } },
    colors: buckets.map((b) => BUCKET_COLORS[b.key]),
    legend: { show: false },
    dataLabels: {
      enabled: true,
      offsetY: -20,
      // A tall bar's own count label lands inside its colored fill, not above it (there's no
      // "outside the bar" position left once a bar is anywhere near 100% of the 0-100 axis) -
      // dark navy text there read as nearly illegible against the bar's own color. White reads
      // fine on every bucket's color; only a near-empty bar would put it on the white card
      // background instead, where white would vanish, hence the threshold.
      style: { fontSize: "12px", fontWeight: 700, colors: buckets.map((b) => (b.pct >= 15 ? "#ffffff" : TEXT_PRIMARY)) },
      formatter: (_val: number, opts) => String(buckets[opts?.dataPointIndex ?? 0]!.count),
    },
    xaxis: {
      categories: buckets.map((b) => BUCKET_LABELS[b.key]),
      labels: { style: { fontSize: "11px", colors: TEXT_MUTED } },
      axisBorder: { color: BORDER },
      axisTicks: { color: BORDER },
    },
    yaxis: { max: 100, labels: { formatter: (v: number) => `${Math.round(v)}%`, style: { fontSize: "11px", colors: TEXT_MUTED } } },
    grid: { borderColor: BORDER, strokeDashArray: 3 },
    tooltip: {
      y: {
        formatter: (val: number, opts) => {
          const count = buckets[opts?.dataPointIndex ?? 0]!.count;
          return `${count} attendee${count === 1 ? "" : "s"} (${val}%)`;
        },
      },
    },
  };
  return <Chart type="bar" series={[{ name: "Attendees", data: buckets.map((b) => b.pct) }]} options={options} height={230} />;
}

/** Two independent radialBar gauges, not a stacked/concentric pair - "has a wallet" and "no
 * wallet" are separate groups with their own separate rates, not two shares of one whole (unlike
 * the donut above), so each gets its own fully-independent 0-100% ring. Same gauge style Tabler
 * itself uses for a single rate (its "Active users" card). Always rendered at a fixed 180x180
 * canvas - .wallets-compare-ring (reports-page.css) is the box that actually varies with the
 * container's width, via CSS clamp()/container-query units, and scales this fixed render down to
 * match with transform:scale. Re-rendering ApexCharts itself at a different pixel size on every
 * resize would need a ResizeObserver driving React state for no visual benefit: the chart is SVG,
 * so scaling it in CSS is already lossless. */
function AdmissionGauge({ pct, color }: Readonly<{ pct: number; color: string }>) {
  const options: ApexOptions = {
    // sparkline mode would strip the center dataLabels entirely (it's designed for tiny
    // decoration-free inline charts) - toolbar/animations disabled explicitly instead, so the
    // "Installed"/"admitted" center label this gauge exists for still renders.
    chart: { type: "radialBar", toolbar: { show: false }, fontFamily: FONT_FAMILY },
    colors: [color],
    stroke: { lineCap: "round" },
    plotOptions: {
      radialBar: {
        hollow: { size: "55%" },
        track: { background: GRAY_100 },
        dataLabels: {
          name: { show: false },
          // ApexCharts' own vertical centering for a single large value label sits a consistent
          // ~8px below the ring's true center (confirmed by measuring both bounding boxes) -
          // offsetY compensates for it.
          value: { fontSize: "24px", fontWeight: 700, color: TEXT_PRIMARY, offsetY: 9, formatter: (v) => `${v}%` },
        },
      },
    },
  };
  return (
    <div className="wallets-compare-ring">
      <Chart type="radialBar" series={[pct]} options={options} width={180} height={180} />
    </div>
  );
}

/** The delta pill sits between the two rings, not below them - that's the whole point of showing
 * it here at all: it's the difference BETWEEN the two rates on either side of it, not a caption
 * for the pair as a group. Fitting a pill between two rings needs more width than just the two
 * rings alone, so the rings shrink further/sooner (see .wallets-compare-ring's container query in
 * reports-page.css) than they would if the pill sat on its own row - a real tradeoff, made in the
 * pill's favor since "between" is the point. */
function AdmissionCompare({ data }: Readonly<{ data: EventWalletReportsResponse["admission_by_wallet"] }>) {
  const deltaPts = Math.round((data.with_wallet.pct - data.without_wallet.pct) * 10) / 10;
  const deltaLabel = deltaPts >= 0 ? `▲ +${deltaPts} pts` : `▼ ${Math.abs(deltaPts)} pts`;

  return (
    <>
      <p className="wallets-description">
        Check-in rate compared between attendees who installed a wallet pass and those who didn&rsquo;t.
      </p>
      <div className="wallets-compare">
        <div className="wallets-compare-group">
          <AdmissionGauge pct={data.with_wallet.pct} color={STATUS_OK} />
          <span className="wallets-compare-group__label">Has a wallet pass</span>
          <span className="wallets-compare-group__sub">{data.with_wallet.admitted} of {data.with_wallet.total} attendees</span>
        </div>
        <div className="wallets-compare-delta">
          <span className="wallets-compare-delta__pill">{deltaLabel}</span>
          <span className="wallets-compare-arrow">→</span>
        </div>
        <div className="wallets-compare-group">
          <AdmissionGauge pct={data.without_wallet.pct} color={GRAY_400} />
          <span className="wallets-compare-group__label">No wallet pass</span>
          <span className="wallets-compare-group__sub">{data.without_wallet.admitted} of {data.without_wallet.total} attendees</span>
        </div>
      </div>
    </>
  );
}

// Memoized: ReportsPage re-renders on every live check-in (Event Day's SSE feed), and this tab
// stays mounted underneath even while Event Day is the visible one - without memo, each of those
// unrelated re-renders reconstructed fresh ApexCharts options/series objects here and made every
// chart replay its entrance animation for no reason (a periodic "jump" with no data actually
// changing). eventId is stable for the component's whole mounted lifetime; walletPlatforms must
// stay reference-stable across those same unrelated re-renders too (ReportsPage.tsx memoizes it),
// or every SSE-driven re-render would defeat this memo() exactly the way an unmemoized eventId
// would.
export const WalletsReportsTab = memo(function WalletsReportsTab({
  eventId,
  walletPlatforms,
}: Readonly<{ eventId: string; walletPlatforms: EnabledWalletPlatforms }>) {
  const { reportApiError } = useConnectionState();
  const abortRef = useRef<AbortController | null>(null);
  const [data, setData] = useState<EventWalletReportsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const loadData = useCallback(async () => {
    abortRef.current?.abort();
    const ac = new AbortController();
    abortRef.current = ac;
    setLoading(true);
    setError(null);
    try {
      const report = await fetchEventWalletReports(eventId, ac.signal);
      if (ac.signal.aborted) return;
      setData(report);
    } catch (err) {
      if (err instanceof DOMException && err.name === "AbortError") return;
      setData(null);
      if (err instanceof ApiError) {
        reportApiError(err.status);
        setError(
          hasApiErrorCode(err, "forbidden")
            ? "You do not have access to this event."
            : operatorApiErrorMessage(err, "Request failed."),
        );
      } else {
        setError("Could not load wallet report.");
      }
    } finally {
      if (!ac.signal.aborted) setLoading(false);
    }
  }, [eventId, reportApiError]);

  useEffect(() => {
    void loadData();
    return () => abortRef.current?.abort();
  }, [loadData]);

  const showLoadingSkeleton = useDelayedLoading(loading);

  if (loading && showLoadingSkeleton) {
    return <p className="wallets-description">Loading wallet report…</p>;
  }

  if (!loading && error) {
    return (
      <EmptyState
        icon={<i className="ti ti-alert-triangle" aria-hidden="true" />}
        title="Could not load wallet report"
        description={error}
        action={
          <Button variant="secondary" onClick={() => void loadData()}>
            Retry
          </Button>
        }
      />
    );
  }

  if (!data) return null;

  if (data.adoption.got_pass === 0) {
    return (
      <EmptyState
        icon={<i className="ti ti-wallet-off" aria-hidden="true" />}
        title="No wallet passes yet"
        description="This card fills in once attendees start adding their ticket to Apple or Google Wallet."
      />
    );
  }

  const voidedPct = pctOf(data.adoption.cancelled, data.adoption.got_pass);

  return (
    <>
      {data.passes_truncated && (
        <Notice variant="warning" className="wallets-truncated-notice">
          This event has more issued wallet passes than a single report can process at once, so
          platform mix, adoption by ticket type, and time-to-wallet-tap below are based on a
          partial sample rather than every pass. Cumulative passes issued and admission rate by
          wallet status are unaffected - both come from a full count, not a sample.
        </Notice>
      )}
      <div className="wallets-panels">
        <Card title={<HintLabel hint={syncedHint(data.synced_at)}>Wallet adoption</HintLabel>}>
          <p className="wallets-description">
            One pass per attendee: issued when the ticket email goes out, installed once it&rsquo;s confirmed on their wallet app, voided if the ticket is later revoked.
          </p>
          <div className="wallets-adoption">
            <AdoptionGauge
              issuedPct={data.adoption.got_pass_pct}
              installedPct={data.adoption.confirmed_pct}
              voidedPct={voidedPct}
              installedCount={data.adoption.confirmed}
            />
            <div className="wallets-adoption__breakdown">
              <BreakdownRows
                rows={[
                  { id: "issued", label: "Issued", meta: `${data.adoption.got_pass} · ${data.adoption.got_pass_pct}%`, pct: data.adoption.got_pass_pct, color: "var(--primary)" },
                  { id: "installed", label: "Installed", meta: `${data.adoption.confirmed} · ${data.adoption.confirmed_pct}% of issued`, pct: data.adoption.confirmed_pct, color: "var(--status-ok)" },
                  { id: "voided", label: "Voided", meta: `${data.adoption.cancelled} · ticket revoked`, pct: voidedPct, color: "var(--status-error)" },
                ]}
              />
            </div>
          </div>
        </Card>
        <Card title={<HintLabel hint={syncedHint(data.synced_at)}>Wallet platform</HintLabel>}>
          <p className="wallets-description">
            Attendees who already have a pass issued, split by which wallet app picked it up
            {walletPlatforms.apple && walletPlatforms.google
              ? " - one pass can register on more than one at once."
              : "."}
          </p>
          <div className="wallets-adoption">
            <PlatformDonut platform={data.platform} issued={data.adoption.got_pass} enabledPlatforms={walletPlatforms} />
            <div className="wallets-adoption__breakdown">
              <BreakdownRows rows={platformBreakdownRows(data.platform, data.adoption.got_pass, walletPlatforms)} />
            </div>
          </div>
        </Card>
      </div>

      <div className="wallets-panels">
        <Card title="Adoption by ticket type" className="wallets-ticket-breakdown">
          <p className="wallets-description">Percentage of each ticket type&rsquo;s own attendees who installed a wallet pass.</p>
          <BreakdownRows rows={ticketTypeAdoptionRows(data.by_ticket_type)} />
        </Card>
        <Card title="Cumulative passes issued">
          <CumulativeChart data={data.issued_by_day} />
        </Card>
      </div>

      <div className="wallets-panels">
        <Card title="Time to wallet tap">
          <p className="wallets-description">
            How many days pass between the ticket email landing in an attendee&rsquo;s inbox and them tapping &ldquo;Add to Wallet&rdquo;.
          </p>
          {data.time_to_wallet_tap.average_days === null ? (
            <p className="wallets-description">Not enough data yet.</p>
          ) : (
            <TimeToTapChart buckets={data.time_to_wallet_tap.buckets} />
          )}
        </Card>

        <Card title="Admission rate by wallet status" className="wallets-card--centered">
          <AdmissionCompare data={data.admission_by_wallet} />
        </Card>
      </div>
    </>
  );
});
