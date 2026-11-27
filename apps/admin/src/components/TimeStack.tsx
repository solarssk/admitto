import type { ReactNode } from "react";
import "./time-stack.css";

/**
 * A time in a row or a card: the primary text (the UTC time, as a rule `formatUtcPrimaryTime`) and under it the lines that say when it was where it happened
 * (`ActorOrViewerLocalTimeLine`, or a `LocalTimeLine` of the caller's own). One look, one stylesheet (time-stack.css), for every place that shows a time this
 * way: standards/admin-spa/time-display.md. The text each place shows is its own; never a monospace font or a hand-made "subdued" line instead.
 */
export function TimeStack({ primary, children }: Readonly<{ primary: ReactNode; children?: ReactNode }>) {
  return (
    <div className="time-stack">
      <div className="time-stack__utc">{primary}</div>
      {children}
    </div>
  );
}

/**
 * The secondary line under a time: one icon, then the time in the zone where it happened or, when none is stored, the viewer's. The icon says "local" and
 * nothing else, so one icon serves every zone (PO report: a second icon for the fallback made the reader work out a distinction that changes nothing).
 * `title` names whose time it is, for the icon's tooltip and for a screen reader.
 */
export function LocalTimeLine({ title, children }: Readonly<{ title: string; children: ReactNode }>) {
  return (
    <div className="time-stack__local">
      <i className="ti ti-user" aria-hidden="true" title={title} />
      <span className="sr-only">{title}: </span>
      {children}
    </div>
  );
}
