import type { ReactNode } from "react";
import { LocalTimeLine, TimeStack, TimeText, TimeWithZone } from "../components/TimeStack.js";
import { formatUtcDateTime, formatZonedClockTime } from "../utils/event-dates.js";

/**
 * A time of a request in a sentence or a list of facts ("The link works until ...", "Sent ..."): the same text for every viewer, in UTC (a request has
 * no zone of its own), in the look of every time (time-stack.css: digits that align, the zone quiet). `<time>` keeps its machine-readable form.
 */
export function RequestInlineTime({ iso }: Readonly<{ iso: string }>): ReactNode {
  return (
    <time dateTime={iso}>
      <TimeText>{formatUtcDateTime(iso)}</TimeText>
    </time>
  );
}

/**
 * The time a guest sent a request, as a row or a card of the list shows it: UTC, and under it the guest's own clock when the event kept the zone of their
 * browser (`timeZone`, null when it did not). A `LocalTimeLine` says whose time it is; the viewer's own zone is never put in its place, since the line is
 * about the guest.
 */
export function RequestSentTime({ iso, timeZone }: Readonly<{ iso: string; timeZone: string | null | undefined }>): ReactNode {
  return (
    <TimeStack
      primary={
        <time dateTime={iso}>
          <TimeWithZone text={formatUtcDateTime(iso)} />
        </time>
      }
    >
      {timeZone ? <LocalTimeLine title="Guest's local time">{formatZonedClockTime(iso, timeZone)}</LocalTimeLine> : null}
    </TimeStack>
  );
}
