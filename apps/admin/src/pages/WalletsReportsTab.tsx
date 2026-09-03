import { memo } from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  PolarAngleAxis,
  RadialBar,
  RadialBarChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { Button, Card, EmptyState, HintLabel, Notice, ticketTypeChartColor } from "@admitto/ui";
import type { EnabledWalletPlatforms } from "@admitto/shared";
import { fetchEventWalletReports } from "../api/client.js";
import type { EventWalletReportsResponse } from "../api/types.js";
import { useReportFetch } from "../hooks/useReportFetch.js";
import { viewerLocalTime } from "../utils/event-dates.js";
import { BreakdownRows, pctOf, type BreakdownRow } from "./ReportsPage.js";
import {
  preventFocusRing,
  ReportsAdmissionCompare,
  ReportsCumulativeAreaChart,
  ReportsDonutChart,
  type ReportsDonutSlice,
} from "./reports-charts.js";
// This component's own .wallets-* rules live in reports-page.css alongside ReportsPage's own
// styles (one card-grid family, not a separate stylesheet) - importing it here too, not just
// relying on ReportsPage.tsx already having it loaded, matches this app's own convention that
// every consumer of a shared CSS file imports it directly (AGENTS.md's lazy-chunk gotcha).
import "./reports-page.css";

// Literal hex, not var(--token): these strings are passed straight through as SVG fill/stroke
// values (Recharts renders as plain SVG), and a CSS custom property referenced from an SVG
// presentation attribute (as opposed to a `style` prop) doesn't resolve consistently across
// browsers - kept in sync with packages/ui/src/styles/tokens/colors.css by name in each comment
// below. The plain HTML overlay labels further down (not SVG) use var(--token) instead, same as
// the rest of this app.
const PRIMARY = "#066fd1"; // --primary / --at-blue
const STATUS_OK = "#2fb344"; // --status-ok / --at-green
const DANGER_RED = "#d63939"; // --at-red / --status-error - the "Removed" slice of Wallet lifecycle, the one outcome of the three worth calling out as a concern
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

const REGISTRATION_COUNT_LABELS: Record<EventWalletReportsResponse["registrations_per_attendee"]["buckets"][number]["key"], string> = {
  "1": "1 device",
  "2": "2 devices",
  "3": "3 devices",
  "4_plus": "4+ devices",
};
// Same four-color "few to more" scale as BUCKET_COLORS above, reused for the same reason (few/
// simple reads as the reassuring green, a rare high count as the muted gray) - these two charts
// are the only ones in this file classifying a count into an ordinal "how many" bucket.
const REGISTRATION_COUNT_COLORS: Record<EventWalletReportsResponse["registrations_per_attendee"]["buckets"][number]["key"], string> = {
  "1": STATUS_OK,
  "2": PRIMARY,
  "3": "#f59f00", // --at-yellow
  "4_plus": GRAY_400,
};

type WalletLifecycleKey = keyof EventWalletReportsResponse["wallet_lifecycle"];
const LIFECYCLE_LABELS: Record<WalletLifecycleKey, string> = {
  active: "Active",
  removed: "Removed",
  never_installed: "Never installed",
};
// Same green/gray-for-neutral convention as every other chart in this file - the one departure is
// DANGER_RED for "removed", the sole outcome of these three actually worth calling out (this
// card's whole reason for existing, per its own doc comment on EventWalletReportsResponse).
const LIFECYCLE_COLORS: Record<WalletLifecycleKey, string> = {
  active: STATUS_OK,
  removed: DANGER_RED,
  never_installed: GRAY_400,
};

/** HintLabel next to the card title, not a bare icon in the header's actions slot - the app's
 * own established convention for a card-title info icon (ReportsPage.tsx's "Attendance
 * confirmation" card, EventSettingsPage.tsx, AccountPage.tsx, ...) puts it inline with the title
 * text itself, not off to the side where actions live. The sync time only matters to someone
 * wondering why a number looks stale, so it still lives behind a hover rather than competing for
 * attention with the title on every view. */
function syncedHint(syncedAt: string | null): string {
  const label = syncedAt ? `Synced at ${viewerLocalTime(syncedAt)}` : "Not synced yet";
  // Generic "each enabled wallet platform", not "Apple/Google" - registration_checked_at is one
  // shared timestamp covering whichever platforms the event actually offers, Samsung included now
  // that this tab reads its real registration data too (CodeRabbit review).
  return `${label}. Reflects each enabled wallet platform's last registration check for this event - refreshes each time the wallet-sync job runs, not on every page load.`;
}

/** Two-stage funnel as one radialBar with two series, outer to inner: share of attendees the pass
 * was issued to, then share of attendees who actually installed it on a phone. Both `issuedPct`
 * and `installedPct` are shares of the same base - total attendees - so the inner ring reads as
 * literally nested "progress within" the outer one; the breakdown rows beside this gauge still
 * describe Installed as "% of issued" in their own text, a different (and separately useful)
 * number, but the ring itself needs the shared base or a high issued-to-installed conversion on a
 * low issued count renders as a full inner ring inside a mostly-empty outer one (bot review).
 * Unlike a since-removed third "Voided" ring this card used to carry (PO review: a voided pass
 * gets pulled from the device the same moment it's revoked, so it's not a wallet-adoption outcome
 * worth a stat here - the attendee/ticket status elsewhere already tracks the revoke itself). */
function AdoptionGauge({
  issuedPct,
  installedPct,
  installedCount,
  isActive,
}: Readonly<{ issuedPct: number; installedPct: number; installedCount: number; isActive: boolean }>) {
  // Recharts has no built-in "total" center label for a multi-ring RadialBarChart (its label
  // support is per-ring, not an aggregate across rings) - an absolutely-positioned HTML overlay
  // draws the center text instead, same as PlatformDonut and AdmissionGauge below for the same
  // reason.
  //
  // isAnimationActive={false} on every ring/slice/bar in this file (not just this one): traced a
  // "chart renders correctly once, then goes blank/frozen" report to Recharts' entrance animation
  // getting stuck at its zero-size starting frame indefinitely - see TimeToTapChart's BarShape
  // comment below for how this was diagnosed. None of these five charts benefit from animating in
  // on every load anyway (same reasoning CumulativeChart's Area already had this for).
  // Recharts' RadialBarChart maps a data array's first entry to the band nearest innerRadius and
  // the last entry nearest outerRadius - listed Installed-then-Issued (not doc-comment reading
  // order) so Issued actually renders as the outer ring, matching "outer to inner: issued, then
  // installed" above.
  const rings = [
    { name: "Installed", value: installedPct, fill: STATUS_OK },
    { name: "Issued", value: issuedPct, fill: PRIMARY },
  ];
  return (
    <div // NOSONAR: mousedown-only, see preventFocusRing above; not an interactive element itself
      className="wallets-gauge-overlay"
      role="presentation"
      onMouseDown={preventFocusRing}
    >
      {/* isActive-gated mount (this tab stays mounted with display:none on every other Reports
          tab, ReportsPage.tsx's sticky-mount) - a ResponsiveContainer left mounted there keeps
          its ResizeObserver watching a box that just collapsed to 0x0, which is exactly when
          Recharts logs its own "width(0) and height(0)" console warning on every subsequent tab
          switch. Same fix CustomFieldsReportsTab.tsx's CategoryDonut/FillRateGauge already use. */}
      {isActive && (
        <ResponsiveContainer width="100%" height="100%">
          <RadialBarChart
            data={rings}
            innerRadius="32%"
            outerRadius="90%"
            startAngle={90}
            endAngle={-270}
            style={{ fontFamily: FONT_FAMILY }}
          >
            {/* Hidden numeric angle axis - each ring's own value is already a 0-100 percentage, so
               the axis domain must be fixed at [0, 100] rather than the implicit per-render scale
               (largest value among the three rings) RadialBarChart falls back to without one. */}
            <PolarAngleAxis type="number" domain={[0, 100]} angleAxisId={0} tick={false} />
            <RadialBar dataKey="value" background={{ fill: GRAY_100 }} cornerRadius="50%" isAnimationActive={false} />
          </RadialBarChart>
        </ResponsiveContainer>
      )}
      <div className="wallets-gauge-overlay__center">
        <span className="wallets-gauge-overlay__value">{installedCount}</span>
        <span className="wallets-gauge-overlay__label">installed</span>
      </div>
    </div>
  );
}

/** Donut, not one ring per platform - a pass can be actively registered on more than one
 * platform at once (the same attendee opening the ticket link on an iPhone and an Android
 * device, say), so the four slices here are mutually exclusive (apple-only / google-only /
 * samsung / multiple) and always sum to the installed total, instead of two independent
 * "% with Apple" and "% with Google" numbers that could each look high while double-counting the
 * same passes. There's deliberately no "not installed" slice here - this card is a platform split
 * among installed passes specifically (the Wallet adoption card next to it already covers
 * installed-vs-not), so mixing that back in here would both duplicate that number and dilute the
 * one thing this donut exists to show (PO review). Samsung's slice reads the same real
 * `platform.samsung_only` count Apple/Google's slices read - it's 0 today only because
 * PassCreator hasn't finished activating Samsung Wallet, not because this chart fakes it. Ordered
 * single-platform-first (Apple, Google, Samsung), then the "doesn't map to one platform" bucket
 * (multiple) - not alphabetical,
 * not by expected size, but grouping like with like reads clearest in a legend a viewer scans top
 * to bottom (PO review). */
/** Single source of truth for the donut's slices and the breakdown list's rows - both need the
 * exact same set, in the exact same order, and two independent hand-written copies could silently
 * drift apart later. Every platform's slice - Apple, Google, and Samsung alike - and "more than
 * one wallet", which only means something once two platforms are both offered, drop out entirely
 * (not just to a 0% slice) when the event's own Wallet settings don't offer that platform,
 * matching the same enabledPlatforms gating the Wallets tab itself, the PDF export, and the CSV
 * export all now share. Samsung's count reads real data (`platform.samsung_only`) the same way
 * Apple/Google's do - it stays 0 today only because PassCreator hasn't finished activating Samsung
 * Wallet, not because this chart hardcodes it. "More than one wallet" only ever reflects
 * Apple+Google (the only combination `platform.both` can actually represent, see
 * classifyPassPlatform's own doc comment in reports-routes.ts) - it stays gated on those two
 * specifically, not on "2+ platforms enabled" in general, since enabling Samsung alongside just
 * one of them proves nothing about any pass having both. */
function platformSlices(
  platform: EventWalletReportsResponse["platform"],
  enabledPlatforms: EnabledWalletPlatforms,
): ReportsDonutSlice[] {
  return [
    enabledPlatforms.apple && { label: "Apple Wallet", color: APPLE_ORANGE, count: platform.apple_only },
    enabledPlatforms.google && { label: "Google Wallet", color: GOOGLE_BLUE, count: platform.google_only },
    // Named the same way as a real wallet app, not a bare provider name - "Samsung" alone reads
    // like an unfinished sentence next to "Apple Wallet"/"Google Wallet".
    enabledPlatforms.samsung && { label: "Samsung Wallet", color: SAMSUNG_TEAL, count: platform.samsung_only },
    enabledPlatforms.apple &&
      enabledPlatforms.google && { label: "More than one wallet", color: MULTI_PURPLE, count: platform.both },
  ].filter((slice): slice is ReportsDonutSlice => slice !== false);
}

function PlatformDonut({
  platform,
  installed,
  enabledPlatforms,
  isActive,
}: Readonly<{
  platform: EventWalletReportsResponse["platform"];
  installed: number;
  enabledPlatforms: EnabledWalletPlatforms;
  isActive: boolean;
}>) {
  return (
    <ReportsDonutChart
      slices={platformSlices(platform, enabledPlatforms)}
      centerValue={installed}
      centerLabel="installed"
      unit="pass"
      isActive={isActive}
    />
  );
}

function platformBreakdownRows(
  platform: EventWalletReportsResponse["platform"],
  installed: number,
  enabledPlatforms: EnabledWalletPlatforms,
): BreakdownRow[] {
  return platformSlices(platform, enabledPlatforms).map((slice) => ({
    id: slice.label,
    label: slice.label,
    meta: `${slice.count} · ${pctOf(slice.count, installed)}%`,
    pct: pctOf(slice.count, installed),
    color: slice.color,
  }));
}

/** Same donut-plus-breakdown shape as PlatformDonut above, for wallet_lifecycle's own three
 * mutually-exclusive outcomes (always summing to `adoption.got_pass`, unlike platform's slices
 * which sum to `wallet_lifecycle.active` - platform stays a live-right-now count, unlike
 * `adoption.confirmed` itself, see EventWalletReportsResponse's own doc comment) - one visual
 * language for "here's how a whole equals the sum
 * of its parts" across this tab, rather than a second one-off chart shape for a card that's
 * conceptually the same kind of breakdown. Centers on the same total the ring's slices sum to
 * (`adoption.got_pass`, passed in as `gotPass` rather than re-summed from the three slices here),
 * matching PlatformDonut/AdoptionGauge centering on their own ring's whole - not on `removed`
 * (PO review, 2026-09-03): the ring already has a red "Removed" slice and legend row for that
 * number, so the center is free to answer "how many total" instead of repeating one slice's value
 * there too. */
function walletLifecycleSlices(lifecycle: EventWalletReportsResponse["wallet_lifecycle"]): ReportsDonutSlice[] {
  return (Object.keys(LIFECYCLE_LABELS) as WalletLifecycleKey[]).map((key) => ({
    label: LIFECYCLE_LABELS[key],
    color: LIFECYCLE_COLORS[key],
    count: lifecycle[key],
  }));
}

function WalletLifecycleDonut({
  lifecycle,
  gotPass,
  isActive,
}: Readonly<{
  lifecycle: EventWalletReportsResponse["wallet_lifecycle"];
  gotPass: number;
  isActive: boolean;
}>) {
  return (
    <ReportsDonutChart
      slices={walletLifecycleSlices(lifecycle)}
      centerValue={gotPass}
      centerLabel="issued"
      unit="pass"
      isActive={isActive}
    />
  );
}

function walletLifecycleBreakdownRows(
  lifecycle: EventWalletReportsResponse["wallet_lifecycle"],
  gotPass: number,
): BreakdownRow[] {
  return walletLifecycleSlices(lifecycle).map((slice) => ({
    id: slice.label,
    label: slice.label,
    meta: `${slice.count} · ${pctOf(slice.count, gotPass)}%`,
    pct: pctOf(slice.count, gotPass),
    color: slice.color,
  }));
}

// Percentage axes (Time to wallet install, Devices per attendee) share a fixed [0, 100] domain, so
// unlike reports-charts.tsx's own yAxisWidthForCount their longest possible label is always the
// same one value - "100%", measured the same way (Canvas measureText, 11px): ~29px + the same
// +16 buffer.
const PERCENT_Y_AXIS_WIDTH = 46;

function ticketTypeAdoptionRows(rows: EventWalletReportsResponse["by_ticket_type"]): BreakdownRow[] {
  return [...rows]
    .sort((a, b) => b.confirmed_pct - a.confirmed_pct)
    .map((row) => ({
      id: row.key ?? "__none__",
      label: row.key === null ? "No ticket type" : row.type,
      // Installed count, not got_pass (issued) - this card's own copy already says "who
      // installed a wallet pass"; got_pass/pct stay on the DTO for the CSV/PDF export's "Got
      // pass" column, which intentionally reports issued rather than installed.
      meta: `${row.confirmed} of ${row.total} · ${row.confirmed_pct}%`,
      pct: row.confirmed_pct,
      // "gray" is an assignable ticket-type color (an admin can pick it for a real type, as this
      // event's own "Standard" type does), so reusing ticketTypeChartColor's gray for "no ticket
      // type" too can make the two rows collide - a step lighter keeps this row visibly distinct
      // no matter what color real types happen to use.
      color: row.key === null ? "var(--at-gray-400)" : ticketTypeChartColor(row.color),
    }));
}

// Diagnosed by logging the raw geometry Recharts computed per bar: with the default Cell-per-bar
// rendering TimeToTapChart never painted anything - `isAnimating: true`, `animationElapsedTime: 0`
// forever, every bar frozen at its zero-size entrance-animation starting frame (Recharts' default
// Rectangle skips rendering entirely at 0x0, so this showed as nothing at all, not a
// visible-but-tiny bar). `isAnimationActive={false}` on the <Bar> below fixes the height/y side of
// that. Separately, and regardless of animation, the computed `width` for every bar was *also* 0
// (so was Recharts' own `background` reference rect) - the chart's category-bandwidth calculation
// itself doesn't produce a usable width here, so `barSize={40}` sets it explicitly instead of
// trusting that computation. This `shape` render prop (drawing the rect + label directly) replaces
// Cell-based per-bar coloring so the chart always renders regardless of whichever of those two
// Recharts computations is fed into it.
//
// A tall bar's own count label lands inside its colored fill, not above it (there's no "outside
// the bar" room left once a bar is anywhere near 100% of the 0-100 axis) - dark navy text there
// read as nearly illegible against the bar's own color. White reads fine on every bucket's color;
// only a near-empty bar would put it on the white card background instead, where white would
// vanish, hence the threshold.
//
// Module scope, not defined inside TimeToTapChart (Sonar S6478 - a component defined inside
// another component's render body gets a new identity every render): reads the row straight off
// Recharts' own `payload` (the exact data item for that bar, always populated - see Bar.js's
// computeBarRectangles) instead of an index into a rows array TimeToTapChart would otherwise have
// to close over. Recharts' own BarRectangleItem type (Bar.d.ts) redeclares x/y/width/height as
// plain required `number`s, narrowing Rectangle's own optional `number | undefined` props -
// there's no real "missing geometry" case to fall back for here, only `payload` stays optional
// (Recharts' ActiveShape type leaves it `any`-typed upstream, covering every chart type's own
// shape props) - the ! below reflects that computeBarRectangles always spreads the real data item
// onto every shape invocation, never omits it, same as the other !-after-invariant sites in this
// codebase (e.g. event-dates.ts's previousIsoDate).
function BarShape({
  x,
  y,
  width,
  height,
  payload,
}: Readonly<{
  x: number;
  y: number;
  width: number;
  height: number;
  payload?: { pct: number; count: number; fill: string };
}>) {
  const row = payload!;
  const insideBar = row.pct >= 15;
  return (
    <g>
      <rect x={x} y={y} width={width} height={height} rx={4} ry={4} fill={row.fill} />
      <text
        x={x + width / 2}
        y={insideBar ? y + 16 : y - 8}
        textAnchor="middle"
        fontSize={12}
        fontWeight={700}
        fill={insideBar ? "#ffffff" : TEXT_PRIMARY}
      >
        {row.count}
      </text>
    </g>
  );
}

interface BucketChartRow {
  key: string;
  label: string;
  pct: number;
  count: number;
  fill: string;
}

/** Shared bar-chart body for TimeToTapChart and RegistrationsPerAttendeeChart below - both chart a
 * small ordinal bucket distribution the same way (bar heights read more naturally than percentage
 * text for a distribution like this), with only the row labels/colors differing between the two.
 * Extracted to keep that shared JSX in one place rather than two near-identical copies (SonarCloud
 * new-code duplication, PR review). */
function BucketBarChart({ rows, isActive }: Readonly<{ rows: BucketChartRow[]; isActive: boolean }>) {
  return (
    <div // NOSONAR: mousedown-only, see preventFocusRing above; not an interactive element itself
      role="presentation"
      className="wallets-chart-card__chart"
      onMouseDown={preventFocusRing}
    >
      {/* isActive-gated mount - see AdoptionGauge's own comment above for why. */}
      {isActive && (
        <ResponsiveContainer width="100%" height="100%" minHeight={230}>
          <BarChart data={rows} barCategoryGap="50%" style={{ fontFamily: FONT_FAMILY }}>
          <CartesianGrid stroke={BORDER} strokeDasharray="3 3" />
          <XAxis
            dataKey="label"
            tick={{ fontSize: 11, fill: TEXT_MUTED }}
            axisLine={{ stroke: BORDER }}
            tickLine={{ stroke: BORDER }}
          />
          <YAxis
            domain={[0, 100]}
            tickFormatter={(v) => `${Math.round(Number(v))}%`}
            tick={{ fontSize: 11, fill: TEXT_MUTED }}
            width={PERCENT_Y_AXIS_WIDTH}
          />
          <Tooltip
            formatter={(value, _name, props) => {
              const count = (props.payload as (typeof rows)[number]).count;
              return [`${count} attendee${count === 1 ? "" : "s"} (${value}%)`, undefined];
            }}
          />
          <Bar dataKey="pct" shape={BarShape} isAnimationActive={false} barSize={40} />
        </BarChart>
        </ResponsiveContainer>
      )}
    </div>
  );
}

/** Bar chart, not a breakdown list - four short rows of text left this card noticeably shorter
 * than "Admission rate by wallet status" beside it (both stretch to match the taller one), and a
 * distribution across "how many days" reads more naturally as bar heights to compare at a glance
 * than as percentage text anyway. Each bar gets its own bucket color (same mapping the list used)
 * via a <Cell> per bar, not a single series color. */
function TimeToTapChart({
  buckets,
  isActive,
}: Readonly<{ buckets: EventWalletReportsResponse["time_to_wallet_tap"]["buckets"]; isActive: boolean }>) {
  const rows = buckets.map((b) => ({
    key: b.key,
    label: BUCKET_LABELS[b.key],
    pct: b.pct,
    count: b.count,
    fill: BUCKET_COLORS[b.key],
  }));
  return <BucketBarChart rows={rows} isActive={isActive} />;
}

/** Same bar-per-bucket shape as TimeToTapChart above, for the same reason: a distribution across a
 * small ordinal count reads more naturally as bar heights than as list text. `count` here is
 * attendees, not registrations - one attendee's single pass can be registered on more than one
 * device/wallet account (an iPhone and an Apple Watch, say), and this groups attendees by how many
 * of those they currently have, not the raw registration total. */
function RegistrationsPerAttendeeChart({
  buckets,
  isActive,
}: Readonly<{
  buckets: EventWalletReportsResponse["registrations_per_attendee"]["buckets"];
  isActive: boolean;
}>) {
  const rows = buckets.map((b) => ({
    key: b.key,
    label: REGISTRATION_COUNT_LABELS[b.key],
    pct: b.pct,
    count: b.count,
    fill: REGISTRATION_COUNT_COLORS[b.key],
  }));
  return <BucketBarChart rows={rows} isActive={isActive} />;
}

// Memoized: ReportsPage re-renders on every live check-in (Event Day's SSE feed), and this tab
// stays mounted underneath even while Event Day is the visible one - without memo, each of those
// unrelated re-renders reconstructed fresh chart data/config objects here and made every chart
// replay its entrance animation for no reason (a periodic "jump" with no data actually
// changing). eventId is stable for the component's whole mounted lifetime; walletPlatforms must
// stay reference-stable across those same unrelated re-renders too (ReportsPage.tsx memoizes it),
// or every SSE-driven re-render would defeat this memo() exactly the way an unmemoized eventId
// would.
export const WalletsReportsTab = memo(function WalletsReportsTab({
  eventId,
  walletPlatforms,
  isActive,
}: Readonly<{ eventId: string; walletPlatforms: EnabledWalletPlatforms; isActive: boolean }>) {
  const { data, loading, error, showLoadingSkeleton, retry } = useReportFetch(
    fetchEventWalletReports,
    eventId,
    "Could not load wallet report.",
  );

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
          <Button variant="secondary" onClick={retry}>
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

  // adoption.confirmed_pct is a share of issued passes (see its own DTO doc comment), not of
  // total attendees like adoption.got_pass_pct - fine for the breakdown row's own "% of issued"
  // text, but AdoptionGauge's two rings need the same base or a high issued-to-installed
  // conversion on a low issued count renders as a full inner ring inside a mostly-empty outer one
  // (bot review on #1202).
  const installedPctOfAttendees = pctOf(data.adoption.confirmed, data.total_attendees);

  return (
    <>
      {data.passes_truncated && (
        <Notice variant="warning" className="wallets-truncated-notice">
          This event has more issued wallet passes than a single report can process at once, so
          platform mix, devices per attendee, adoption by ticket type, wallet lifecycle, time to
          wallet install, and time to install after reminder below are based on a partial sample
          rather than every pass. Cumulative passes issued and admission rate by wallet status are
          unaffected - both come from a full count, not a sample.
        </Notice>
      )}
      <div className="wallets-panels">
        <Card title={<HintLabel hint={syncedHint(data.synced_at)}>Wallet adoption</HintLabel>}>
          <p className="wallets-description">
            One pass per attendee: issued when the attendee first taps Add to Wallet, installed once it&rsquo;s confirmed on their wallet app. Counted here even if later removed from the device - see Wallet lifecycle below for who still has it installed right now.
          </p>
          <div className="wallets-adoption">
            <AdoptionGauge
              issuedPct={data.adoption.got_pass_pct}
              installedPct={installedPctOfAttendees}
              installedCount={data.adoption.confirmed}
              isActive={isActive}
            />
            <div className="wallets-adoption__breakdown">
              <BreakdownRows
                rows={[
                  // Literal hex constants, not var(--primary)/var(--status-ok): this row's
                  // dot/bar color must always match AdoptionGauge's own ring for the same series,
                  // and --primary is the tenant's branding color (Organisation settings), not a
                  // fixed design token - a non-default brand color made this row drift from the
                  // ring, which stays correct because it already uses the literal PRIMARY hex
                  // (see the comment on that constant above).
                  { id: "issued", label: "Issued", meta: `${data.adoption.got_pass} · ${data.adoption.got_pass_pct}% of attendees`, pct: data.adoption.got_pass_pct, color: PRIMARY },
                  // meta text keeps "% of issued" (confirmed_pct, a different and separately
                  // useful base) - the row's own pct bar uses installedPctOfAttendees instead, so
                  // it stays visually nested under Issued's bar rather than reading "more
                  // installed than issued" whenever conversion is high but issued count is low
                  // (bot review, same root cause as AdoptionGauge's own ring above).
                  { id: "installed", label: "Installed", meta: `${data.adoption.confirmed} · ${data.adoption.confirmed_pct}% of issued`, pct: installedPctOfAttendees, color: STATUS_OK },
                ]}
              />
            </div>
          </div>
        </Card>
        <Card title={<HintLabel hint={syncedHint(data.synced_at)}>Wallet platform</HintLabel>}>
          <p className="wallets-description">
            Attendees with their ticket currently installed, split by which wallet app they used
            {walletPlatforms.apple && walletPlatforms.google
              ? " - one pass can register on more than one at once."
              : "."}
          </p>
          <div className="wallets-adoption">
            <PlatformDonut
              platform={data.platform}
              installed={data.wallet_lifecycle.active}
              enabledPlatforms={walletPlatforms}
              isActive={isActive}
            />
            <div className="wallets-adoption__breakdown">
              <BreakdownRows rows={platformBreakdownRows(data.platform, data.wallet_lifecycle.active, walletPlatforms)} />
            </div>
          </div>
        </Card>
      </div>

      <div className="wallets-panels">
        <Card title="Devices per attendee" className="wallets-chart-card">
          <p className="wallets-description">
            Some attendees add their ticket to more than one device, like a phone and a smartwatch. This shows how many devices attendees are actually using, not just how many people have their ticket installed.
          </p>
          <RegistrationsPerAttendeeChart buckets={data.registrations_per_attendee.buckets} isActive={isActive} />
        </Card>
        <Card title="Adoption by ticket type" className="wallets-list-card">
          <p className="wallets-description">Percentage of each ticket type&rsquo;s own attendees who installed a wallet pass.</p>
          <BreakdownRows rows={ticketTypeAdoptionRows(data.by_ticket_type)} />
        </Card>
      </div>

      <div className="wallets-panels">
        <Card title="Time to wallet install" className="wallets-chart-card">
          <p className="wallets-description">
            How many days pass between the ticket email landing in an attendee&rsquo;s inbox and their pass being confirmed installed on their wallet app.
          </p>
          <TimeToTapChart buckets={data.time_to_wallet_tap.buckets} isActive={isActive} />
        </Card>
        <Card title="Time to install after reminder" className="wallets-chart-card">
          <p className="wallets-description">
            How many days pass between the most recent wallet-button email - a reminder, or other campaign - and their pass being confirmed installed.
          </p>
          <TimeToTapChart buckets={data.time_to_install_after_reminder.buckets} isActive={isActive} />
        </Card>
      </div>

      <div className="wallets-panels">
        <Card title="Wallet lifecycle">
          <p className="wallets-description">
            Every issued pass, grouped by whether it&rsquo;s still installed, was removed from every device, or was never installed at all.
          </p>
          <div className="wallets-adoption">
            <WalletLifecycleDonut lifecycle={data.wallet_lifecycle} gotPass={data.adoption.got_pass} isActive={isActive} />
            <div className="wallets-adoption__breakdown">
              <BreakdownRows rows={walletLifecycleBreakdownRows(data.wallet_lifecycle, data.adoption.got_pass)} />
            </div>
          </div>
        </Card>
        <Card title="Cumulative passes issued" className="wallets-chart-card">
          <p className="wallets-description">The running total of tickets added to attendees&rsquo; wallets over time.</p>
          {data.issued_by_day.length === 0 ? (
            <p className="wallets-description">No passes issued yet.</p>
          ) : (
            <ReportsCumulativeAreaChart
              data={data.issued_by_day}
              gradientId="wallets-cumulative-fill"
              seriesName="Passes issued"
              isActive={isActive}
            />
          )}
        </Card>
      </div>

      <div className="wallets-panels">
        <Card title="Admission rate by wallet status" className="wallets-card--centered">
          <ReportsAdmissionCompare
            description="Check-in rate compared between attendees who installed a wallet pass and those who didn’t."
            withLabel="Has a wallet pass"
            withGroup={data.admission_by_wallet.with_wallet}
            withoutLabel="No wallet pass"
            withoutGroup={data.admission_by_wallet.without_wallet}
            isActive={isActive}
          />
        </Card>
      </div>
    </>
  );
});
