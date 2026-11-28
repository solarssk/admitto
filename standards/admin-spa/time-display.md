# Time display in the admin SPA

Read before a screen shows a time: a timestamp, a "last updated", a "Today 14:05".

---

Staff read these screens together, on calls and in screenshots. A time has to be the same text for everyone who looks at it, wherever each of them sits. So the viewer's own time zone does not decide what a screen shows, except in the few places listed below.

## Which time to show

| The time is | Show | Use |
|---|---|---|
| An action whose zone Admitto stored (an Activity entry, a delivery or an import that an admin queued, who created or archived an event) | That zone, with its offset: "15:00 UTC+2" | `formatActorTime(iso, actorZone)` |
| Anything with no stored zone (a worker run, a provider's value, an attendee's action, a note) | UTC: "13:00 UTC" | `formatActorTime(iso, null)` or `formatUtcDateTime(iso)` |
| A fact about the event or its venue: the event's own date, a check-in (admission) time, a report that lists admissions or groups by day | The date as it was set, or the time in the event's zone with its offset | `formatEventCalendarDate(event.date)`, `formatEventDateTime(iso, event.timezone)`, `formatEventTime` |
| A table of logs, with a UTC time and a line under it | UTC on top. The line under it shows the actor's zone when stored. Where none is stored, a table shows the viewer's zone labelled "Your local time", or no line | `formatUtcPrimaryTime(iso)` and `ActorOrViewerLocalTimeLine` |

The helpers above add the offset or "UTC" to a time. A date alone has none.

The event's own date is a calendar day stored as noon UTC, so it goes through `formatEventCalendarDate`, never through a zone: in a zone far east of UTC a zone would show the next day.

An event can be far from the people who work on it, from its attendees and from the mail scanners that open their links. A time shown in the event's zone is a guess that looks like a fact, so the event's zone is not used to guess where an action happened. It is used for facts about the event and its venue: a check-in happens there. UTC claims nothing.

## How a time looks

One look for every time, from one stylesheet (`apps/admin/src/components/time-stack.css`). A time with a line under it is a `TimeStack`: the primary text, then `ActorOrViewerLocalTimeLine`, or a `LocalTimeLine` of your own when the text under it is not the actor's zone or the viewer's. A time that is only text wears the class `time-text`. Both are in the body font of the row with tabular digits, so a column of times lines up. The zone at the end of a time ("UTC", "UTC+2") is the quiet part: smaller and grey, in its own element (`TimeWithZone`, which `TimeStack` and `TimeText` use), so three capital letters do not catch the eye before the digits do; the text is the same string. In a test a time is found with the matcher `timeText` of `test/test-utils.tsx`, as its text is in two nodes.

A time is never monospace, and never a hand made "subdued" line: the logs, the timeline and Reports once showed a time in monospace while the sessions did not, and the same moment looked different from one screen to the next. `test/styles/time-look.test.ts` fails on a rule for a selector about a time, a date, a clock or a stamp that sets a monospace font.

## Where the viewer's own zone is still read

The scan in `time-zone-standard.test.ts` lists each such read it finds, with its reason. They are of four kinds:

- A screen read live by the person who just acted: a check-in screen read by the operator who is scanning, a test mail or a health check they have just run.
- The secondary "Your local time" line under a UTC time.
- A default or a unit, not a displayed time: the zone offered first for a new event, Fahrenheit or Celsius, a 12 or 24 hour clock.
- The Recent activity feed on the Overview. It groups its rows under "Today" and day headings in the reader's own zone, and a row that arrives live carries this browser's zone. Every other row follows the table above.

## What checks this

`apps/admin/test/locale/time-zone-standard.test.ts` is a ratchet with four rules. It fails on:

- a read of the viewer's zone: `getBrowserTimeZone()`, any `.resolvedOptions()` call, `viewerLocalTime()`;
- an `Intl.DateTimeFormat`, `toLocaleDateString` or `toLocaleTimeString` call with no `timeZone` option;
- a zone argument with a fallback other than UTC, such as `actorZone ?? eventZone`.

Its list of exceptions gives the reason for each finding that remains. An entry that no longer matches the code has to be lowered or removed. The scan reads the code as a syntax tree and sees the spellings that its self-test lists, so it guards against drift and is not a proof.

`apps/admin/test/locale/locale-coverage.test.ts` fails on a raw `toLocaleString`, `toLocaleDateString` or `toLocaleTimeString` call outside a short list of files.

To test a time, render it under two browser zones (mock `getBrowserTimeZone` to return each) and expect the same text, as the Wallet card test in `AttendeeDetailPage.walletActions.test.tsx` does. That catches a call of `getBrowserTimeZone`; the scan catches the other spellings. For a time built with `Intl.DateTimeFormat`, check the zone the formatter names, as the chart test in `WalletsReportsTab.test.tsx` does.
