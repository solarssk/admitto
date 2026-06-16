import type { HTMLAttributes, ReactNode } from "react";

export interface StatTrend {
  dir: "up" | "down";
  value: string;
}

export interface StatProps extends HTMLAttributes<HTMLDivElement> {
  label: string;
  value: ReactNode;
  sub?: ReactNode;
  icon?: ReactNode;
  trend?: StatTrend | null;
}

export function Stat({ label, value, sub, icon = null, trend = null, className, ...rest }: StatProps) {
  return (
    <div className={["at-stat", className].filter(Boolean).join(" ")} {...rest}>
      <div className="at-stat__top">
        <span className="at-stat__label overline">{label}</span>
        {icon && <span className="at-stat__icon">{icon}</span>}
      </div>
      <div className="at-stat__value">{value}</div>
      {(sub || trend) && (
        <div className="at-stat__sub">
          {sub}
          {trend && (
            <span className={`at-stat__trend at-stat__trend--${trend.dir}`}>{trend.value}</span>
          )}
        </div>
      )}
    </div>
  );
}
