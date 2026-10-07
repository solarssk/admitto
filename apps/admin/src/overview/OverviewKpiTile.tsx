import type { ReactNode } from "react";
import { Card } from "@admitto/ui";

export type KpiTone = "primary" | "info" | "ok" | "error";

/** Overview's own icon-square-left KPI tile (mockup-aligned): a bigger colored icon square beside
 * a stacked value/label block. ReportsPage has its own separate bespoke KPI tile (ReportStat)
 * with a different layout, not shared with this one — both pages migrated off @admitto/ui's
 * generic Stat component independently, which has since been removed entirely, having ended up
 * with zero remaining consumers (see #590). */
export function OverviewKpiTile({
  icon,
  tone,
  label,
  value,
}: Readonly<{
  icon: ReactNode;
  tone: KpiTone;
  label: string;
  value: ReactNode;
}>) {
  return (
    <Card className="overview-kpi-card">
      <div className="overview-kpi">
        <span className={`overview-kpi__icon overview-kpi__icon--${tone}`} aria-hidden="true">
          {icon}
        </span>
        <div className="overview-kpi__body">
          <span className="overview-kpi__value">{value}</span>
          <span className="overview-kpi__label">{label}</span>
        </div>
      </div>
    </Card>
  );
}
