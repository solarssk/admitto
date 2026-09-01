import { memo } from "react";
import type { MouseEvent as ReactMouseEvent } from "react";
import { Cell, Pie, PieChart, PolarAngleAxis, RadialBar, RadialBarChart, ResponsiveContainer, Tooltip } from "recharts";
import { Button, Card, EmptyState } from "@admitto/ui";
import { CUSTOM_FIELD_NOT_ANSWERED_KEY } from "@admitto/shared";
import { fetchEventCustomFieldReports } from "../api/client.js";
import type { EventCustomFieldReportsResponse } from "../api/types.js";
import { useReportFetch } from "../hooks/useReportFetch.js";
import { BreakdownRows, type BreakdownRow } from "./ReportsPage.js";
import "./reports-page.css";

type CustomFieldReport = EventCustomFieldReportsResponse["fields"][number];

// Literal hex, not var(--token) - Recharts renders as plain SVG, and a CSS custom property in an
// SVG presentation attribute (fill=) doesn't resolve consistently across browsers, same
// constraint as WalletsReportsTab.tsx's own PRIMARY/GRAY_400 constants.
const PRIMARY = "#066fd1"; // --primary / --at-blue
const GRAY_400 = "#94a3b8"; // --at-gray-400, "not answered" bucket
const GRAY_100 = "#f1f5f9"; // --at-gray-100, radial track background
const FONT_FAMILY = "Inter, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif"; // --font-sans

/** Cycled by index, not tied to any specific value - an admin-defined select/boolean field's
 * option set has no fixed brand or status meaning to color by, so the same rotation applies to
 * every field's distribution consistently. Mirrors @admitto/ui's TICKET_TYPE_COLORS
 * (TicketTypeBadge.tsx) minus its "gray" entry, which is reserved here for the "not answered"
 * bucket. Kept in sync by name with packages/ui/src/styles/tokens/colors.css. */
const CATEGORY_PALETTE = [
  "#04519c", // blue / --primary-active
  "#1f7a2e", // green / --status-ok-fg
  "#9a6400", // yellow / --status-warn-fg
  "#b32525", // red / --status-error-fg
  "#2b6cb0", // azure / --status-info-fg
  "#097a59", // teal / --status-confirmed-fg
  "#8a31a0", // purple / --status-vip-fg
];

function categoryColor(key: string, index: number): string {
  return key === CUSTOM_FIELD_NOT_ANSWERED_KEY ? GRAY_400 : CATEGORY_PALETTE[index % CATEGORY_PALETTE.length]!;
}

/** Same fix as WalletsReportsTab.tsx's own preventFocusRing: a plain mouse click on a Recharts
 * root <svg> focuses it (its own built-in keyboard-accessibility layer), showing a raw focus ring
 * the CSS `:focus` suppression doesn't reliably catch across every browser. Preventing the
 * mousedown's default action stops focus from moving there at all on a click; a real Tab keypress
 * still focuses and shows the ring normally. */
function preventFocusRing(event: ReactMouseEvent) {
  event.preventDefault();
}

function distributionRows(distribution: NonNullable<CustomFieldReport["distribution"]>): BreakdownRow[] {
  return distribution.map((row, index) => ({
    id: row.key,
    label: row.label,
    meta: `${row.count} · ${row.pct}%`,
    pct: row.pct,
    color: categoryColor(row.key, index),
  }));
}

/** Donut for a `select`/`boolean` field's category distribution - the same rendering for both,
 * since the only real difference between them is how many slices the distribution happens to
 * have. Mirrors WalletsReportsTab.tsx's PlatformDonut (isAnimationActive, literal hex, the HTML
 * center-label overlay in place of Recharts' own per-slice label - same reasons, see that file). */
function CategoryDonut({
  distribution,
  totalAttendees,
  isActive,
}: Readonly<{
  distribution: NonNullable<CustomFieldReport["distribution"]>;
  totalAttendees: number;
  isActive: boolean;
}>) {
  const slices = distribution.map((row, index) => ({ ...row, color: categoryColor(row.key, index) }));
  return (
    <div // NOSONAR - mousedown-only, see preventFocusRing above; not an interactive element itself
      className="wallets-gauge-overlay"
      role="presentation"
      onMouseDown={preventFocusRing}
    >
      {/* Only mount ResponsiveContainer (and the ResizeObserver it installs) while this tab is
          the visible one - ReportsPage keeps this whole tab mounted with display:none rather
          than unmounting it on tab switch (to avoid refetching), so leaving the chart mounted
          too left its observer watching a box that legitimately collapses to 0x0 the moment the
          wrapper flips to display:none, which is exactly when Recharts logs its own "width(0)
          and height(0)" console warning. */}
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
                <Cell key={slice.key} fill={slice.color} />
              ))}
            </Pie>
            <Tooltip
              formatter={(value) => `${value} attendee${value === 1 ? "" : "s"}`}
              position={{ y: 256 }}
            />
          </PieChart>
        </ResponsiveContainer>
      )}
      <div className="wallets-gauge-overlay__center">
        <span className="wallets-gauge-overlay__value">{totalAttendees}</span>
        <span className="wallets-gauge-overlay__label">attendees</span>
      </div>
    </div>
  );
}

/** Single ring for a `text` field's fill rate - mirrors WalletsReportsTab.tsx's AdmissionGauge.
 * Free-text answers don't bucket into categories the way select/boolean do, so "answered vs not"
 * is the only meaningful chart here. Same responsive box as CategoryDonut above
 * (.wallets-gauge-overlay - up to 256px, shrinking with its card on a narrower screen), so every
 * card in this tab's grid reads at a consistent chart size whenever there's room for one. */
function FillRateGauge({ pct, isActive }: Readonly<{ pct: number; isActive: boolean }>) {
  return (
    <div // NOSONAR - mousedown-only, see preventFocusRing above; not an interactive element itself
      className="wallets-gauge-overlay"
      role="presentation"
      onMouseDown={preventFocusRing}
    >
      {/* Same isActive gating as CategoryDonut above - see its comment for why. */}
      {isActive && (
        <ResponsiveContainer width="100%" height="100%">
          <RadialBarChart
            data={[{ name: "pct", value: pct, fill: PRIMARY }]}
            innerRadius="58%"
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
      <div className="wallets-gauge-overlay__center">
        <span className="wallets-gauge-overlay__value">{pct}%</span>
        <span className="wallets-gauge-overlay__label">filled in</span>
      </div>
    </div>
  );
}

/** Same placement as every WalletsReportsTab.tsx card - a plain description paragraph above the
 * chart. Unlike Wallets' own fixed captions, this one is admin-entered per field
 * (EventCustomField.description, same text as the Requirements page's field editor), so it falls
 * back to a literal "No description" rather than rendering nothing when the admin left it blank -
 * every card keeps the same shape instead of some having a caption and others not. */
function FieldDescription({ description }: Readonly<{ description: string | null }>) {
  return <p className="wallets-description">{description ?? "No description"}</p>;
}

function CustomFieldCard({
  field,
  totalAttendees,
  isActive,
}: Readonly<{ field: CustomFieldReport; totalAttendees: number; isActive: boolean }>) {
  if (field.type === "text") {
    const rate = field.response_rate!;
    return (
      <Card title={field.label}>
        <FieldDescription description={field.description} />
        <div className="wallets-adoption">
          <FillRateGauge pct={rate.pct} isActive={isActive} />
          <p className="wallets-description">
            {rate.answered} of {totalAttendees} attendees have filled this in.
          </p>
        </div>
      </Card>
    );
  }
  const distribution = field.distribution!;
  return (
    <Card title={field.label}>
      <FieldDescription description={field.description} />
      <div className="wallets-adoption">
        <CategoryDonut distribution={distribution} totalAttendees={totalAttendees} isActive={isActive} />
        <div className="wallets-adoption__breakdown">
          <BreakdownRows rows={distributionRows(distribution)} />
        </div>
      </div>
    </Card>
  );
}

// Memoized and kept mounted once visited, same reasoning as WalletsReportsTab.tsx: ReportsPage
// re-renders on every live check-in (Event Day's SSE feed), and this tab stays mounted
// underneath even while Event Day is the visible one. `isActive` (whether this is currently the
// visible tab) still changes though, and memo's shallow prop comparison re-renders on that -
// each chart below only mounts its ResponsiveContainer while isActive is true, so its
// ResizeObserver stops watching once the tab hides instead of observing a box that just
// collapsed to 0x0 under display:none (see CategoryDonut's own comment).
export const CustomFieldsReportsTab = memo(function CustomFieldsReportsTab({
  eventId,
  isActive,
}: Readonly<{ eventId: string; isActive: boolean }>) {
  const { data, loading, error, showLoadingSkeleton, retry } = useReportFetch(
    fetchEventCustomFieldReports,
    eventId,
    "Could not load custom field report.",
  );

  if (loading && showLoadingSkeleton) {
    return <p className="wallets-description">Loading custom field report…</p>;
  }

  if (!loading && error) {
    return (
      <EmptyState
        icon={<i className="ti ti-alert-triangle" aria-hidden="true" />}
        title="Could not load custom field report"
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

  if (data.fields.length === 0) {
    return (
      <EmptyState
        icon={<i className="ti ti-forms" aria-hidden="true" />}
        title="No custom fields yet"
        description="Add custom fields on the Requirements page to see a chart for each one here."
      />
    );
  }

  return (
    <div className="custom-fields-grid">
      {data.fields.map((field) => (
        <CustomFieldCard key={field.id} field={field} totalAttendees={data.total_attendees} isActive={isActive} />
      ))}
    </div>
  );
});
