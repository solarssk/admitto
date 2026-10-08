import { Card, Skeleton } from "@admitto/ui";
import { SettingsSkeletonRegion } from "../settings/SettingsPanelSkeleton.js";
import { assertPresent } from "../utils/assert-present.js";

/** The four KPI tiles of Event day, by their real names and icons: only their values are what the read says. */
const STAT_TILES = [
  { variant: "neutral", icon: "users", label: "Total attendees" },
  { variant: "ok", icon: "circle-check", label: "Admitted" },
  { variant: "warn", icon: "circle-x", label: "No-shows" },
  { variant: "info", icon: "clock", label: "Peak hour" },
] as const;

/** The hours the chart shows at the least (the real chart pads sparse data out to as many columns), as bars of varying height. */
const CHART_BARS = [
  { hour: 9, height: 28 },
  { hour: 10, height: 52 },
  { hour: 11, height: 84 },
  { hour: 12, height: 112 },
  { hour: 13, height: 96 },
  { hour: 14, height: 64 },
  { hour: 15, height: 40 },
  { hour: 16, height: 24 },
  { hour: 17, height: 12 },
] as const;

/** The widths of the names in a breakdown, one after the other (a placeholder has no data to take them from). */
const NAME_WIDTHS = [120, 96, 140, 104, 88, 112] as const;

/** One row of a breakdown card: a dot, a name and its figures over the track of a bar. */
function BreakdownRowSkeleton({ nameWidth }: Readonly<{ nameWidth: number }>) {
  return (
    <div className="reports-breakdown-row">
      <div className="reports-breakdown-row__head">
        <Skeleton variant="circle" width={9} height={9} />
        <span className="reports-breakdown-row__name">
          <Skeleton variant="rect" width={nameWidth} height={14} />
        </span>
        <Skeleton variant="rect" width={48} height={12} />
      </div>
      <Skeleton variant="rect" height={7} />
    </div>
  );
}

/** A breakdown card's list: `rows` rows, with names of varying width. */
function BreakdownSkeleton({ rows }: Readonly<{ rows: number }>) {
  return (
    <div className="reports-breakdown-list">
      {Array.from({ length: rows }, (_, row) => {
        const nameWidth = NAME_WIDTHS[row % NAME_WIDTHS.length];
        assertPresent(nameWidth);
        return <BreakdownRowSkeleton key={row} nameWidth={nameWidth} />;
      })}
    </div>
  );
}

function ChartSkeleton() {
  return (
    <div className="reports-chart">
      {CHART_BARS.map((bar) => (
        <div key={bar.hour} className="reports-chart__bar-wrap">
          <div className="reports-chart__count" />
          <div className="reports-chart__track">
            <Skeleton variant="rect" height={bar.height} />
          </div>
          <div className="reports-chart__label">
            <Skeleton variant="rect" width={14} height={10} />
          </div>
        </div>
      ))}
    </div>
  );
}

const LOG_COLUMNS = ["Attendee", "Ticket type", "Admitted at", "Checked in by", "Items"] as const;
const LOG_ROWS = 5;

/** The admission log: its real column headings over a few rows of bars (the log has up to a page of rows), and the line of
 * paging controls under them. */
function AdmissionLogSkeleton() {
  return (
    <Card title="Admission log" padded={false} actions={<Skeleton variant="rect" width={88} height={32} />}>
      <div className="reports-log-table-wrap">
        <table className="table">
          <thead>
            <tr>
              {LOG_COLUMNS.map((column) => (
                <th key={column}>{column}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {Array.from({ length: LOG_ROWS }, (_, row) => (
              <tr key={row}>
                <td>
                  <div className="reports-log-user">
                    <Skeleton variant="rect" width={120} height={14} />
                    <Skeleton variant="rect" width={170} height={12} />
                  </div>
                </td>
                <td>
                  <Skeleton variant="rect" width={72} height={22} />
                </td>
                <td>
                  <Skeleton variant="rect" width={64} height={14} />
                </td>
                <td>
                  <Skeleton variant="rect" width={96} height={14} />
                </td>
                <td>
                  <Skeleton variant="rect" width={24} height={14} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="reports-log-footer">
        <div className="reports-skeleton__footer">
          <Skeleton variant="rect" width={96} height={14} />
          <Skeleton variant="rect" width={72} height={32} />
        </div>
      </div>
    </Card>
  );
}

/**
 * The Event day report below its tabs while its first read is on its way: the four tiles, the hourly chart and the
 * breakdowns with their real titles, and the admission log with its real column headings, in a status region named after
 * what is loading (invisible for the first 200ms, with the 8 second note). Decoration, so hidden from assistive tech.
 */
export function ReportsEventDaySkeleton({ held, slow }: Readonly<{ held: boolean; slow: boolean }>) {
  return (
    <SettingsSkeletonRegion label="Loading the report" held={held} slow={slow}>
      <div className="reports-eventday reports-skeleton" aria-hidden="true">
        <div className="reports-stats-grid">
          {STAT_TILES.map((tile) => (
            <Card key={tile.label}>
              <div className="reports-stat">
                <div className={`reports-stat__icon reports-stat__icon--${tile.variant}`} aria-hidden="true">
                  <i className={`ti ti-${tile.icon}`} />
                </div>
                <div className="reports-stat__body">
                  <span className="reports-stat__value">
                    <Skeleton variant="rect" width={56} height={22} />
                  </span>
                  <span className="reports-stat__label">{tile.label}</span>
                  <span className="reports-stat__sub">
                    <Skeleton variant="rect" width={96} height={12} />
                  </span>
                </div>
              </div>
            </Card>
          ))}
        </div>

        <div className="reports-panels">
          <Card title="Hourly admissions">
            <ChartSkeleton />
          </Card>
          <Card title="By ticket type">
            <BreakdownSkeleton rows={3} />
          </Card>
        </div>

        <h2 className="reports-section-title">Check-in details</h2>
        <div className="reports-grid-3">
          <Card title="Attendance confirmation">
            <BreakdownSkeleton rows={6} />
          </Card>
          <Card title="Check-in method">
            <BreakdownSkeleton rows={2} />
          </Card>
          <Card title="By operator">
            <BreakdownSkeleton rows={2} />
          </Card>
        </div>

        <AdmissionLogSkeleton />
      </div>
    </SettingsSkeletonRegion>
  );
}
