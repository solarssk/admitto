import type { MouseEvent as ReactMouseEvent } from "react";
import {
  Area,
  AreaChart,
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
// Shared with reports-page.css - both WalletsReportsTab.tsx and MailReportsTab.tsx already import
// it directly (every consumer of a shared CSS file does, per AGENTS.md's lazy-chunk gotcha), so
// this module (imported by both) doesn't need to import it a third time.

// Literal hex, not var(--token): both charts below render as plain SVG (Recharts), and a CSS
// custom property referenced from an SVG presentation attribute doesn't resolve consistently
// across browsers - same constraint as every other Reports tab file's own PRIMARY/BORDER/etc.
const PRIMARY = "#066fd1"; // --primary / --at-blue
const STATUS_OK = "#2fb344"; // --status-ok / --at-green
const GRAY_400 = "#94a3b8"; // --at-gray-400
const GRAY_100 = "#f1f5f9"; // --at-gray-100, radial track background
const TEXT_MUTED = "#64748b"; // --text-muted / --at-gray-500
const BORDER = "#e6e7e9"; // --border
const FONT_FAMILY = "Inter, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif"; // --font-sans

/** Recharts gives every chart's root <svg> tabindex="0" and role="application" by default (its
 * own built-in keyboard-accessibility layer), which a plain mouse click also focuses. Preventing
 * the mousedown's default action stops the browser from moving focus there at all on a click, at
 * the event level rather than relying on a CSS :focus-visible heuristic that isn't guaranteed
 * consistent across browsers for a non-standard interactive element like this - a real Tab
 * keypress still focuses and shows the app's own `.recharts-surface:focus` ring normally, since
 * keyboard navigation doesn't fire mousedown. Shared by every donut/gauge/area chart across the
 * Reports feature (Wallets, Custom fields, Mail). */
export function preventFocusRing(event: ReactMouseEvent) {
  event.preventDefault();
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
 * of equal ticks regardless of the data's actual units, which for a small count (e.g. max 1) can
 * produce fractional labels (0, 0.2, 0.4, ...) that can never really occur since these charts only
 * count whole units (passes, emails). `max <= 1` gets one tick of headroom above the actual max
 * (2, not 1) rather than matching it exactly - a small/new event is common enough to fix
 * explicitly rather than leaving to chance. */
export function niceCountAxis(max: number): { axisMax: number; tickAmount: number } {
  if (max <= 1) return { axisMax: 2, tickAmount: 2 };
  const roughStep = max / 5;
  const magnitude = 10 ** Math.floor(Math.log10(roughStep));
  const normalized = roughStep / magnitude;
  const step = Math.max(1, niceStepMultiplier(normalized) * magnitude);
  const tickAmount = Math.ceil(max / step);
  return { axisMax: tickAmount * step, tickAmount };
}

/** Recharts' own YAxis default width (60px) reserves a fixed gutter for tick labels regardless of
 * how narrow they actually are, leaving a visibly empty band to the axis's own left - measured
 * directly (Canvas measureText at 11px, the same size these ticks render at, not assumed): a
 * single digit is ~7px wide, three digits ~19px, four ~26px. +16 covers the tick mark plus
 * Recharts' own internal label padding on top of the measured text width itself. */
export function yAxisWidthForCount(axisMax: number): number {
  return Math.ceil(String(Math.round(axisMax)).length * 6.5) + 16;
}

/** English plural of a tooltip unit word ("pass" -> "passes", "attendee" -> "attendees", "attempt"
 * -> "attempts") - a bare `+"s"` breaks on a word already ending in s (e.g. "pass" -> "passs"
 * instead of "passes"), so a word ending in s/sh/ch/x gets the "-es" plural instead. Every unit
 * this component is actually called with today falls into one of these two regular patterns; a
 * genuinely irregular plural (e.g. "person" -> "people") would need a real exceptions table, not
 * needed yet. */
function pluralizeUnit(unit: string, count: number): string {
  if (count === 1) return unit;
  return /[sxz]$|[cs]h$/.test(unit) ? `${unit}es` : `${unit}s`;
}

export interface ReportsDonutSlice {
  label: string;
  color: string;
  count: number;
}

/** Donut for a mutually-exclusive breakdown, with an HTML overlay center value/label (Recharts has
 * no native centered label for a Pie chart). `unit` pluralizes the hover tooltip ("1 pass" / "3
 * passes", "1 attendee" / "2 attendees") - the only thing that varies between callers besides the
 * slices/center text themselves. `isActive` gates whether ResponsiveContainer (and the
 * ResizeObserver it installs) actually mounts - every Reports tab stays mounted with display:none
 * on every other tab (ReportsPage.tsx's sticky-mount), and an observer left watching a box that
 * just collapsed to 0x0 is what triggers Recharts' own "width(0) and height(0)" console warning. */
export function ReportsDonutChart({
  slices,
  centerValue,
  centerLabel,
  unit,
  isActive,
}: Readonly<{
  slices: ReportsDonutSlice[];
  centerValue: number;
  centerLabel: string;
  unit: string;
  isActive: boolean;
}>) {
  return (
    <div // NOSONAR: mousedown-only, see preventFocusRing above; not an interactive element itself
      className="wallets-gauge-overlay"
      role="presentation"
      onMouseDown={preventFocusRing}
    >
      {isActive && (
        <ResponsiveContainer width="100%" height="100%">
          <PieChart style={{ fontFamily: FONT_FAMILY }}>
            <Pie
              data={slices}
              dataKey="count"
              nameKey="label"
              innerRadius="58%"
              outerRadius="90%"
              stroke="#ffffff"
              strokeWidth={2}
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
            <Tooltip formatter={(value) => `${value} ${pluralizeUnit(unit, Number(value))}`} position={{ y: 256 }} />
          </PieChart>
        </ResponsiveContainer>
      )}
      <div className="wallets-gauge-overlay__center">
        <span className="wallets-gauge-overlay__value">{centerValue}</span>
        <span className="wallets-gauge-overlay__label">{centerLabel}</span>
      </div>
    </div>
  );
}

export interface ReportsCumulativePoint {
  date: string;
  count: number;
  cumulative: number;
}

/** Area chart of a running total over time, via Recharts (not hand-drawn SVG - an earlier
 * hand-rolled version had two real bugs: a CSS specificity conflict on the last axis label, and
 * axis text distorted by the non-uniform viewBox scaling a hand-built responsive chart needs). A
 * real charting library's datetime axis avoids both classes of bug entirely. Assumes `data` is
 * non-empty - a caller renders its own empty state first (Wallets' and Mail's empty-state copy and
 * icon genuinely differ, so that branch stays with each caller rather than being parameterized
 * here). `gradientId` must be unique per chart on the page (Recharts renders the `<linearGradient>`
 * into the live DOM, so two charts sharing an id would fight over the same `<defs>` entry).
 * `isActive` gates the ResponsiveContainer mount - see ReportsDonutChart's own comment for why. */
export function ReportsCumulativeAreaChart({
  data,
  gradientId,
  seriesName,
  isActive,
}: Readonly<{
  data: ReadonlyArray<ReportsCumulativePoint>;
  gradientId: string;
  seriesName: string;
  isActive: boolean;
}>) {
  // Noon UTC, not midnight - a date-only value pinned to midnight can render as the previous
  // calendar day once the chart formats it in the viewer's own local timezone.
  const points = data.map((d) => ({ date: Date.parse(`${d.date}T12:00:00Z`), value: d.cumulative }));
  // The first real day's cumulative is never 0 (it's already counting that day's own count), so
  // without this the line starts flat at that count instead of visibly rising from 0.
  points.unshift({ date: points[0]!.date - 24 * 60 * 60 * 1000, value: 0 });
  // "Nice" whole-number axis, not Recharts' own default tick generation - see niceCountAxis's own
  // comment for why a small count needs this.
  const { axisMax, tickAmount } = niceCountAxis(data.at(-1)!.cumulative);
  const yTicks = Array.from({ length: tickAmount + 1 }, (_, i) => (i * axisMax) / tickAmount);
  const dayFormatter = (ts: number) => new Intl.DateTimeFormat("en-GB", { day: "2-digit", month: "short" }).format(ts);
  return (
    <div // NOSONAR: mousedown-only, see preventFocusRing above; not an interactive element itself
      role="presentation"
      className="wallets-chart-card__chart"
      onMouseDown={preventFocusRing}
    >
      {isActive && (
        <ResponsiveContainer width="100%" height="100%" minHeight={230}>
          <AreaChart data={points} style={{ fontFamily: FONT_FAMILY }}>
            <defs>
              <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
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
              // (which shows a time-of-day component on a short date range) would add a
              // meaningless "12:00".
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
              width={yAxisWidthForCount(axisMax)}
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
              name={seriesName}
              stroke={PRIMARY}
              strokeWidth={2.5}
              fill={`url(#${gradientId})`}
              dot={false}
              // Animations off - the entrance animation redraws the line growing left-to-right for
              // no benefit: the axis ticks here are already fixed by niceCountAxis and the
              // explicit day format above rather than recomputed as the animation settles.
              isAnimationActive={false}
            />
          </AreaChart>
        </ResponsiveContainer>
      )}
    </div>
  );
}

export interface ReportsAdmissionGroup {
  total: number;
  admitted: number;
  pct: number;
}

/** Single independent radialBar gauge - "with X" and "without X" are two separate groups with
 * their own separate rates, not two shares of one whole (unlike ReportsDonutChart above), so each
 * gets its own fully-independent 0-100% ring. Same gauge style Tabler itself uses for a single
 * rate (its "Active users" card). Always rendered at a fixed 180x180 canvas - .wallets-compare-ring
 * (reports-page.css) is the box that actually varies with the container's width, via CSS
 * clamp()/container-query units, and scales this fixed render down to match with transform:scale.
 * Re-rendering the chart itself at a different pixel size on every resize would need a
 * ResizeObserver driving React state for no visual benefit: the chart is SVG, so scaling it in CSS
 * is already lossless. */
function AdmissionGauge({
  pct,
  color,
  isActive,
}: Readonly<{ pct: number; color: string; isActive: boolean }>) {
  return (
    <div className="wallets-compare-ring">
      <div // NOSONAR: mousedown-only, see preventFocusRing above; not an interactive element itself
        className="wallets-admission-gauge"
        role="presentation"
        onMouseDown={preventFocusRing}
      >
        {isActive && (
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
        )}
        {/* Recharts has no native centered value label for a RadialBarChart, so an HTML overlay
           draws it instead. It lives inside the same transform:scale()'d wrapper as the ring
           itself (.wallets-compare-ring > div in reports-page.css), so it shrinks in step with
           the ring rather than needing its own separate scale calculation. */}
        <div className="wallets-admission-gauge__value">{pct}%</div>
      </div>
    </div>
  );
}

/** Two independent rate gauges compared side by side, with a delta pill between them - "check-in
 * rate for attendees with some trait vs. without it" (a wallet pass, a successful email delivery,
 * ...). The delta pill sits between the two rings, not below them - that's the whole point of
 * showing it at all: it's the difference BETWEEN the two rates on either side of it, not a caption
 * for the pair as a group. Fitting a pill between two rings needs more width than just the two
 * rings alone, so the rings shrink further/sooner (see .wallets-compare-ring's container query in
 * reports-page.css) than they would if the pill sat on its own row - a real tradeoff, made in the
 * pill's favor since "between" is the point. */
export function ReportsAdmissionCompare({
  description,
  withLabel,
  withGroup,
  withoutLabel,
  withoutGroup,
  isActive,
}: Readonly<{
  description: string;
  withLabel: string;
  withGroup: ReportsAdmissionGroup;
  withoutLabel: string;
  withoutGroup: ReportsAdmissionGroup;
  isActive: boolean;
}>) {
  const deltaPts = Math.round((withGroup.pct - withoutGroup.pct) * 10) / 10;
  const deltaLabel = deltaPts >= 0 ? `▲ +${deltaPts} pts` : `▼ ${Math.abs(deltaPts)} pts`;

  return (
    <>
      <p className="wallets-description">{description}</p>
      <div className="wallets-compare">
        <div className="wallets-compare-group">
          <AdmissionGauge pct={withGroup.pct} color={STATUS_OK} isActive={isActive} />
          <span className="wallets-compare-group__label">{withLabel}</span>
          <span className="wallets-compare-group__sub">{withGroup.admitted} of {withGroup.total} attendees</span>
        </div>
        <div className="wallets-compare-delta">
          <span className="wallets-compare-delta__pill">{deltaLabel}</span>
          <span className="wallets-compare-arrow">→</span>
        </div>
        <div className="wallets-compare-group">
          <AdmissionGauge pct={withoutGroup.pct} color={GRAY_400} isActive={isActive} />
          <span className="wallets-compare-group__label">{withoutLabel}</span>
          <span className="wallets-compare-group__sub">{withoutGroup.admitted} of {withoutGroup.total} attendees</span>
        </div>
      </div>
    </>
  );
}
