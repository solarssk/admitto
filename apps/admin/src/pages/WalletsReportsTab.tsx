import { memo } from "react";
import type { MouseEvent as ReactMouseEvent } from "react";
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Pie,
  PieChart,
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

/** Recharts gives every chart's root <svg> tabindex="0" and role="application" by default (its
 * own built-in keyboard-accessibility layer), which a plain mouse click also focuses. A
 * `.recharts-surface:focus { outline: none }` rule (reports-page.css) suppresses the resulting
 * outline in most browsers, but :focus-visible's mouse-vs-keyboard heuristic isn't guaranteed
 * consistent for a non-standard interactive element like this across every browser - confirmed
 * still showing a raw focus ring on click in one real-world test despite that CSS rule matching
 * correctly in automated testing. Preventing the mousedown's default action stops the browser
 * from moving focus there at all on a click, at the event level rather than relying on any CSS
 * pseudo-class - a real Tab keypress still focuses and shows the CSS rule's ring normally, since
 * keyboard navigation doesn't fire mousedown. */
function preventFocusRing(event: ReactMouseEvent) {
  event.preventDefault();
}

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
}: Readonly<{ issuedPct: number; installedPct: number; installedCount: number }>) {
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
    <div // NOSONAR — mousedown-only, see preventFocusRing above; not an interactive element itself
      className="wallets-gauge-overlay"
      role="presentation"
      onMouseDown={preventFocusRing}
    >
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
 * one thing this donut exists to show (PO review). Samsung has no PassCreator signal yet - its
 * slice's count is always 0, reserving the legend entry without a fake percentage, once its own
 * toggle offers it at all. Ordered single-platform-first (Apple,
 * Google, Samsung), then the "doesn't map to one platform" bucket (multiple) - not alphabetical,
 * not by expected size, but grouping like with like reads clearest in a legend a viewer scans top
 * to bottom (PO review). */
interface PlatformSlice {
  label: string;
  color: string;
  count: number;
}

/** Single source of truth for the donut's slices and the breakdown list's rows - both need the
 * exact same set, in the exact same order, and two independent hand-written copies could silently
 * drift apart later (e.g. if real Samsung data is wired in and only one copy gets updated).
 * Every platform's slice - Apple, Google, and Samsung alike - and "more than one wallet", which
 * only means something once two platforms are both offered, drop out entirely (not just to a 0%
 * slice) when the event's own Wallet settings don't offer that platform, matching the same
 * enabledPlatforms gating the Wallets tab itself, the PDF export, and the CSV export all now
 * share. Samsung's own toggle exists ahead of any real PassCreator support (see its schema
 * comment) purely so this gating is already in place; its count stays 0 either way. "More than one
 * wallet" only ever reflects Apple+Google (the only combination `platform.both` can actually
 * represent) - it stays gated on those two specifically, not on "2+ platforms enabled" in general,
 * since enabling Samsung alongside just one of them proves nothing about any pass having both. */
function platformSlices(
  platform: EventWalletReportsResponse["platform"],
  enabledPlatforms: EnabledWalletPlatforms,
): PlatformSlice[] {
  return [
    enabledPlatforms.apple && { label: "Apple Wallet", color: APPLE_ORANGE, count: platform.apple_only },
    enabledPlatforms.google && { label: "Google Wallet", color: GOOGLE_BLUE, count: platform.google_only },
    // Named the same way as a real wallet app, not a bare provider name - "Samsung" alone reads
    // like an unfinished sentence next to "Apple Wallet"/"Google Wallet".
    enabledPlatforms.samsung && { label: "Samsung Wallet", color: SAMSUNG_TEAL, count: 0 },
    enabledPlatforms.apple &&
      enabledPlatforms.google && { label: "More than one wallet", color: MULTI_PURPLE, count: platform.both },
  ].filter((slice): slice is PlatformSlice => slice !== false);
}

/** Own legend replaced by the same fixed-circle-plus-BreakdownRows shape as AdoptionGauge, not
 * the chart library's built-in one - a donut's built-in legend claims its own slice of the
 * chart's width, so at the same container width this circle rendered visibly smaller than
 * AdoptionGauge's ring beside it (a different chart type with a different internal layout wasn't
 * a coincidence, it was the actual cause). Both cards now build the same "fixed circle | flexible
 * list" row, so the two circles size and center identically at every breakpoint instead of two
 * unrelated layouts happening to look similar at one specific width. */
function PlatformDonut({
  platform,
  installed,
  enabledPlatforms,
}: Readonly<{
  platform: EventWalletReportsResponse["platform"];
  installed: number;
  enabledPlatforms: EnabledWalletPlatforms;
}>) {
  const slices = platformSlices(platform, enabledPlatforms);
  return (
    <div // NOSONAR — mousedown-only, see preventFocusRing above; not an interactive element itself
      className="wallets-gauge-overlay"
      role="presentation"
      onMouseDown={preventFocusRing}
    >
      <ResponsiveContainer width="100%" height="100%">
        <PieChart style={{ fontFamily: FONT_FAMILY }}>
          <Pie
            data={slices}
            dataKey="count"
            nameKey="label"
            // Same 90% outer radius as AdoptionGauge's own ring above, both within the same 256px
            // canvas - both charts are the same library now, so matching their own radius
            // percentages directly keeps the two circles the same outer diameter, without the
            // cross-chart-type "customScale" fudge factor the old ApexCharts version needed (a
            // donut and a radialBar filled their own canvases by very different amounts there).
            innerRadius="58%"
            outerRadius="90%"
            stroke="#ffffff"
            strokeWidth={2}
            // Both native label paths off - see AdoptionGauge above for why the HTML overlay
            // exists at all: its center text is a standardized fs-h1/fs-xs pair shared by both
            // gauge cards, not each chart's own native label at its own ad hoc size. The
            // per-slice percentage is redundant with the breakdown list's own "<count> · <pct>%"
            // column anyway.
            label={false}
            labelLine={false}
            isAnimationActive={false}
          >
            {slices.map((slice) => (
              <Cell key={slice.label} fill={slice.color} />
            ))}
          </Pie>
          {/* Recharts' default tooltip position for a Pie tracks the cursor, which for a donut
             this size lands inside the empty center hole - directly on top of the HTML center
             label overlay above. Pinned to just below the 256px chart instead (x still follows
             the hovered slice) so it never competes with that overlay. */}
          <Tooltip formatter={(value) => `${value} pass${value === 1 ? "" : "es"}`} position={{ y: 256 }} />
        </PieChart>
      </ResponsiveContainer>
      <div className="wallets-gauge-overlay__center">
        <span className="wallets-gauge-overlay__value">{installed}</span>
        <span className="wallets-gauge-overlay__label">installed</span>
      </div>
    </div>
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

/** Rounds a normalized step (roughStep / magnitude, so always in [1, 10)) up to the nearest of the
 * classic "nice number" progression 1-2-5-10. */
function niceStepMultiplier(normalized: number): number {
  if (normalized <= 1) return 1;
  if (normalized <= 2) return 2;
  if (normalized <= 5) return 5;
  return 10;
}

/** Picks a "nice" whole-number step/max for a count axis (classic d3-style nice-number scaling) -
 * a charting library's own default tick generation typically divides min..max into a fixed number
 * of equal ticks regardless of the data's actual units, which for a small pass count (e.g. max 1)
 * can produce fractional labels (0, 0.2, 0.4, 0.6, 0.8, 1) that can never really occur since
 * passes only come in whole units. `max <= 1` gets one tick of headroom above the actual max (2,
 * not 1) rather than matching it exactly - the general step/rounding logic below sometimes ends up
 * with headroom too as a side effect of rounding to a "nice" step (round(45)->50), sometimes not
 * (round(8)->8), but max<=1 always lands exactly on 1 with none, which reads as the line pinned to
 * the axis's own ceiling with nowhere left to grow (PO review) - this one small-count case is
 * common enough (a new/small event) to fix explicitly rather than leaving to chance. */
function niceCountAxis(max: number): { axisMax: number; tickAmount: number } {
  if (max <= 1) return { axisMax: 2, tickAmount: 2 };
  const roughStep = max / 5;
  const magnitude = 10 ** Math.floor(Math.log10(roughStep));
  const normalized = roughStep / magnitude;
  // Counts are always whole numbers - clamp to at least 1 so a small max (e.g. 2 or 3) can't pick
  // a fractional step like 0.5 the way the raw "nice number" progression otherwise would.
  const step = Math.max(1, niceStepMultiplier(normalized) * magnitude);
  const tickAmount = Math.ceil(max / step);
  return { axisMax: tickAmount * step, tickAmount };
}

/** Area chart via Recharts, not hand-drawn SVG - an earlier hand-rolled version had two real bugs
 * (a CSS specificity conflict on the last axis label, and axis text distorted by the non-uniform
 * viewBox scaling a hand-built responsive chart needs). A real charting library's datetime axis
 * avoids both classes of bug entirely. */
function CumulativeChart({ data }: Readonly<{ data: EventWalletReportsResponse["issued_by_day"] }>) {
  if (data.length === 0) {
    return <p className="wallets-description">No passes issued yet.</p>;
  }

  // Noon UTC, not midnight - a date-only value pinned to midnight can render as the previous
  // calendar day once the chart formats it in the viewer's own local timezone.
  const points = data.map((d) => ({ date: Date.parse(`${d.date}T12:00:00Z`), value: d.cumulative }));
  // The first real day's cumulative is never 0 (it's already counting that day's own passes), so
  // without this the line starts flat at that count instead of visibly rising from 0.
  points.unshift({ date: points[0]!.date - 24 * 60 * 60 * 1000, value: 0 });
  // "Nice" whole-number axis, not Recharts' own default tick generation - a small pass count
  // (e.g. max 1) can otherwise produce fractional labels (0, 0.2, 0.4, 0.6, 0.8, 1) that can never
  // really occur since passes only come in whole units.
  const { axisMax, tickAmount } = niceCountAxis(data.at(-1)!.cumulative);
  const yTicks = Array.from({ length: tickAmount + 1 }, (_, i) => (i * axisMax) / tickAmount);
  const dayFormatter = (ts: number) => new Intl.DateTimeFormat("en-GB", { day: "2-digit", month: "short" }).format(ts);
  return (
    <div // NOSONAR — mousedown-only, see preventFocusRing above; not an interactive element itself
      role="presentation"
      className="wallets-chart-card__chart"
      onMouseDown={preventFocusRing}
    >
      <ResponsiveContainer width="100%" height="100%" minHeight={230}>
        <AreaChart data={points} style={{ fontFamily: FONT_FAMILY }}>
        <defs>
          <linearGradient id="wallets-cumulative-fill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={PRIMARY} stopOpacity={0.3} />
            <stop offset="100%" stopColor={PRIMARY} stopOpacity={0} />
          </linearGradient>
        </defs>
        <CartesianGrid stroke={BORDER} strokeDasharray="3 3" />
        <XAxis
          dataKey="date"
          type="number"
          domain={["dataMin", "dataMax"]}
          // Explicit day-only format - the data is per calendar day, so a default auto-format
          // (which shows a time-of-day component on a short date range) would add a meaningless
          // "12:00".
          tickFormatter={dayFormatter}
          tick={{ fontSize: 11, fill: TEXT_MUTED }}
          axisLine={{ stroke: BORDER }}
          tickLine={{ stroke: BORDER }}
        />
        <YAxis
          domain={[0, axisMax]}
          ticks={yTicks}
          tickFormatter={(v) => Math.round(Number(v)).toString()}
          tick={{ fontSize: 11, fill: TEXT_MUTED }}
        />
        <Tooltip
          labelFormatter={(label) =>
            new Intl.DateTimeFormat("en-GB", { day: "2-digit", month: "short", year: "numeric" }).format(
              Number(label),
            )
          }
        />
        <Area
          type="monotone"
          dataKey="value"
          name="Passes issued"
          stroke={PRIMARY}
          strokeWidth={2.5}
          fill="url(#wallets-cumulative-fill)"
          dot={false}
          // Animations off - the entrance animation redraws the line growing left-to-right for no
          // benefit: the axis ticks here are already fixed by niceCountAxis and the explicit day
          // format above rather than recomputed as the animation settles, so nothing about this
          // chart needs the motion.
          isAnimationActive={false}
        />
      </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}

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

/** Bar chart, not a breakdown list - four short rows of text left this card noticeably shorter
 * than "Admission rate by wallet status" beside it (both stretch to match the taller one), and a
 * distribution across "how many days" reads more naturally as bar heights to compare at a glance
 * than as percentage text anyway. Each bar gets its own bucket color (same mapping the list used)
 * via a <Cell> per bar, not a single series color. */
function TimeToTapChart({ buckets }: Readonly<{ buckets: EventWalletReportsResponse["time_to_wallet_tap"]["buckets"] }>) {
  const rows = buckets.map((b) => ({
    key: b.key,
    label: BUCKET_LABELS[b.key],
    pct: b.pct,
    count: b.count,
    fill: BUCKET_COLORS[b.key],
  }));

  return (
    <div // NOSONAR — mousedown-only, see preventFocusRing above; not an interactive element itself
      role="presentation"
      className="wallets-chart-card__chart"
      onMouseDown={preventFocusRing}
    >
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
    </div>
  );
}

/** Same bar-per-bucket shape as TimeToTapChart above (reuses its BarShape), for the same reason:
 * a distribution across a small ordinal count reads more naturally as bar heights than as list
 * text. `count` here is attendees, not registrations - one attendee's single pass can be
 * registered on more than one device/wallet account (an iPhone and an Apple Watch, say), and this
 * groups attendees by how many of those they currently have, not the raw registration total. */
function RegistrationsPerAttendeeChart({
  buckets,
}: Readonly<{ buckets: EventWalletReportsResponse["registrations_per_attendee"]["buckets"] }>) {
  const rows = buckets.map((b) => ({
    key: b.key,
    label: REGISTRATION_COUNT_LABELS[b.key],
    pct: b.pct,
    count: b.count,
    fill: REGISTRATION_COUNT_COLORS[b.key],
  }));

  return (
    <div // NOSONAR — mousedown-only, see preventFocusRing above; not an interactive element itself
      role="presentation"
      className="wallets-chart-card__chart"
      onMouseDown={preventFocusRing}
    >
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
    </div>
  );
}

/** Two independent radialBar gauges, not a stacked/concentric pair - "has a wallet" and "no
 * wallet" are separate groups with their own separate rates, not two shares of one whole (unlike
 * the donut above), so each gets its own fully-independent 0-100% ring. Same gauge style Tabler
 * itself uses for a single rate (its "Active users" card). Always rendered at a fixed 180x180
 * canvas - .wallets-compare-ring (reports-page.css) is the box that actually varies with the
 * container's width, via CSS clamp()/container-query units, and scales this fixed render down to
 * match with transform:scale. Re-rendering the chart itself at a different pixel size on every
 * resize would need a ResizeObserver driving React state for no visual benefit: the chart is SVG,
 * so scaling it in CSS is already lossless. */
function AdmissionGauge({ pct, color }: Readonly<{ pct: number; color: string }>) {
  return (
    <div className="wallets-compare-ring">
      <div // NOSONAR — mousedown-only, see preventFocusRing above; not an interactive element itself
        className="wallets-admission-gauge"
        role="presentation"
        onMouseDown={preventFocusRing}
      >
        <ResponsiveContainer width="100%" height="100%">
          <RadialBarChart
            data={[{ name: "pct", value: pct, fill: color }]}
            innerRadius="55%"
            outerRadius="90%"
            startAngle={90}
            endAngle={-270}
            style={{ fontFamily: FONT_FAMILY }}
          >
            <PolarAngleAxis type="number" domain={[0, 100]} angleAxisId={0} tick={false} />
            <RadialBar dataKey="value" background={{ fill: GRAY_100 }} cornerRadius="50%" isAnimationActive={false} />
          </RadialBarChart>
        </ResponsiveContainer>
        {/* Same reasoning as AdoptionGauge's own overlay above: Recharts has no native centered
           value label for a RadialBarChart, so an HTML overlay draws it instead. It lives inside
           the same transform:scale()'d wrapper as the ring itself (.wallets-compare-ring > div in
           reports-page.css), so it shrinks in step with the ring rather than needing its own
           separate scale calculation. */}
        <div className="wallets-admission-gauge__value">{pct}%</div>
      </div>
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
// unrelated re-renders reconstructed fresh chart data/config objects here and made every chart
// replay its entrance animation for no reason (a periodic "jump" with no data actually
// changing). eventId is stable for the component's whole mounted lifetime; walletPlatforms must
// stay reference-stable across those same unrelated re-renders too (ReportsPage.tsx memoizes it),
// or every SSE-driven re-render would defeat this memo() exactly the way an unmemoized eventId
// would.
export const WalletsReportsTab = memo(function WalletsReportsTab({
  eventId,
  walletPlatforms,
}: Readonly<{ eventId: string; walletPlatforms: EnabledWalletPlatforms }>) {
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
          platform mix, devices per attendee, adoption by ticket type, and time-to-wallet-tap
          below are based on a partial sample rather than every pass. Cumulative passes issued
          and admission rate by wallet status are unaffected - both come from a full count, not a
          sample.
        </Notice>
      )}
      <div className="wallets-panels">
        <Card title={<HintLabel hint={syncedHint(data.synced_at)}>Wallet adoption</HintLabel>}>
          <p className="wallets-description">
            One pass per attendee: issued when the attendee first taps Add to Wallet, installed once it&rsquo;s confirmed on their wallet app.
          </p>
          <div className="wallets-adoption">
            <AdoptionGauge
              issuedPct={data.adoption.got_pass_pct}
              installedPct={installedPctOfAttendees}
              installedCount={data.adoption.confirmed}
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
            Attendees with their ticket installed, split by which wallet app they used
            {walletPlatforms.apple && walletPlatforms.google
              ? " - one pass can register on more than one at once."
              : "."}
          </p>
          <div className="wallets-adoption">
            <PlatformDonut platform={data.platform} installed={data.adoption.confirmed} enabledPlatforms={walletPlatforms} />
            <div className="wallets-adoption__breakdown">
              <BreakdownRows rows={platformBreakdownRows(data.platform, data.adoption.confirmed, walletPlatforms)} />
            </div>
          </div>
        </Card>
      </div>

      <div className="wallets-panels">
        <Card title="Devices per attendee" className="wallets-chart-card">
          <p className="wallets-description">
            Some attendees add their ticket to more than one device, like a phone and a smartwatch. This shows how many devices attendees are actually using, not just how many people have their ticket installed.
          </p>
          <RegistrationsPerAttendeeChart buckets={data.registrations_per_attendee.buckets} />
        </Card>
        <Card title="Adoption by ticket type" className="wallets-list-card">
          <p className="wallets-description">Percentage of each ticket type&rsquo;s own attendees who installed a wallet pass.</p>
          <BreakdownRows rows={ticketTypeAdoptionRows(data.by_ticket_type)} />
        </Card>
      </div>

      <div className="wallets-panels">
        <Card title="Cumulative passes issued" className="wallets-chart-card">
          <p className="wallets-description">The running total of tickets added to attendees&rsquo; wallets over time.</p>
          <CumulativeChart data={data.issued_by_day} />
        </Card>
        <Card title="Time to wallet install" className="wallets-chart-card">
          <p className="wallets-description">
            How many days pass between the ticket email landing in an attendee&rsquo;s inbox and their pass being confirmed installed on their wallet app.
          </p>
          <TimeToTapChart buckets={data.time_to_wallet_tap.buckets} />
        </Card>
      </div>

      <div className="wallets-panels">
        <Card title="Admission rate by wallet status" className="wallets-card--centered">
          <AdmissionCompare data={data.admission_by_wallet} />
        </Card>
      </div>
    </>
  );
});
