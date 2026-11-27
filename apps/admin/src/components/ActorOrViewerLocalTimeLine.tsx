import type { ReactNode } from "react";
import { formatZonedClockTime, viewerLocalTime } from "../utils/event-dates.js";
import { LocalTimeLine } from "./TimeStack.js";

/**
 * Secondary time line under a UTC primary timestamp: actor/signer zone when known, otherwise
 * the current viewer's browser zone as a stand-in. Shared by Sessions, Account sessions, and
 * Security logs. One icon regardless of which zone backs it - both read as "roughly when this
 * happened, in a locally-relevant time," and a second icon just for the fallback case made the
 * reader work out a distinction that doesn't change what they'd do with the row (PO report).
 * Drawn by `LocalTimeLine`, so it looks the same as every other time line (time-stack.css).
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
    return <LocalTimeLine title={actorTitle}>{formatZonedClockTime(iso, actorTimezone)}</LocalTimeLine>;
  }
  return <LocalTimeLine title="Your local time">{viewerLocalTime(iso)}</LocalTimeLine>;
}
