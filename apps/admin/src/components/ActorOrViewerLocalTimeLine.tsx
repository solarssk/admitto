import type { ReactNode } from "react";
import { formatZonedClockTime, viewerLocalTime } from "../utils/event-dates.js";

/**
 * Secondary time line under a UTC primary timestamp: actor/signer zone when known (user icon),
 * otherwise the current viewer's browser zone (desktop icon). Shared by Sessions, Account
 * sessions, and Security logs.
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
      <i className="ti ti-device-desktop" aria-hidden="true" title="Your local time" />
      <span className="sr-only">Your local time: </span>
      {viewerLocalTime(iso)}
    </div>
  );
}
