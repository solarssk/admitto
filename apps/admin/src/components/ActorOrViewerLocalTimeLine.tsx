import type { ReactNode } from "react";
import { formatZonedClockTime, viewerLocalTime } from "../utils/event-dates.js";

/**
 * Secondary time line under a UTC primary timestamp: actor/signer zone when known, otherwise
 * the current viewer's browser zone as a stand-in. Shared by Sessions, Account sessions, and
 * Security logs. One icon regardless of which zone backs it - both read as "roughly when this
 * happened, in a locally-relevant time," and a second icon just for the fallback case made the
 * reader work out a distinction that doesn't change what they'd do with the row (PO report).
 */
export function ActorOrViewerLocalTimeLine({
  iso,
  actorTimezone,
  actorTitle = "User's local time",
}: Readonly<{
  iso: string;
  actorTimezone: string | null | undefined;
  actorTitle?: string;
}>): ReactNode {
  if (actorTimezone) {
    return (
      <div className="sessions-subdued audit-log-time__local">
        <i className="ti ti-user" aria-hidden="true" title={actorTitle} />
        <span className="sr-only">{actorTitle}: </span>
        {formatZonedClockTime(iso, actorTimezone)}
      </div>
    );
  }
  return (
    <div className="sessions-subdued audit-log-time__local">
      <i className="ti ti-user" aria-hidden="true" title="Your local time" />
      <span className="sr-only">Your local time: </span>
      {viewerLocalTime(iso)}
    </div>
  );
}
