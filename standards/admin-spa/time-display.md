# Time display in the admin SPA

Read before a screen shows a time: a timestamp, a "last updated", a "Today 14:05".

---

Staff read these screens together, on calls and in screenshots. A time has to be the same text for everyone who looks at it, wherever each of them sits. So the viewer's own time zone never decides what a screen shows.

## Which time to show

| The time is | Show | Use |
|---|---|---|
| An action whose zone Admitto stored (an Activity entry, a delivery that an admin sent, who created or archived an event) | That zone, with its offset: "15:00 UTC+2" | `formatActorTime(iso, actorZone)` |
| Anything with no stored zone (a worker run, a provider's value, an attendee's action, a note, an import) | UTC: "13:00 UTC" | `formatActorTime(iso, null)` or `formatUtcDateTime(iso)` |
| A fact about the event or its venue: the event's date and hours, a check-in (admission) time, a report that lists admissions or groups by day | The event's zone, with its offset | `formatEventDateTime(iso, event.timezone)`, `formatEventTime`, `formatEventDate` |
| A table of logs, with a UTC time and a line under it | UTC on top. The line under it shows the actor's zone when stored, otherwise the viewer's, labelled "Your local time" | `formatUtcPrimaryTime(iso)` and `ActorOrViewerLocalTimeLine` |

A time with a clock part carries its offset or "UTC". A date alone (`formatEventDate`) has none.

An event can be far from the people who work on it, from its attendees and from the mail scanners that open their links. A time shown in the event's zone is a guess that looks like a fact, so the event's zone is used only for facts about the event itself: a check-in happens at the venue. UTC claims nothing.

## Where the viewer's own zone is still read

The scan in `time-zone-standard.test.ts` lists each such read it finds, with its reason. They are of four kinds:

- A screen read live by the person who just acted: a check-in screen read by the operator who is scanning, a test mail or a health check they have just run.
- The secondary "Your local time" line under a UTC time.
- A default or a unit, not a displayed time: the zone offered first for a new event, Fahrenheit or Celsius, a 12 or 24 hour clock.
- The Recent activity feed on the Overview, which reads "Today" and its day headings against the reader's own clock.

## What checks this

- `apps/admin/test/locale/time-zone-standard.test.ts` fails on a new read of the viewer's zone (`getBrowserTimeZone()` or any `.resolvedOptions()` call), a new `viewerLocalTime()` call, an `Intl.DateTimeFormat`, `toLocaleDateString` or `toLocaleTimeString` call with no `timeZone` option, and a zone argument with a fallback other than UTC (`actorZone ?? eventZone`). It is a ratchet: an entry that no longer matches the code has to be lowered or removed. It reads the code as a syntax tree and sees the spellings that its self-test lists, so it guards against drift and is not a proof.
- `apps/admin/test/locale/locale-coverage.test.ts` fails on a raw `toLocaleString`, `toLocaleDateString` or `toLocaleTimeString` call outside a short list of files.

To test a time, render it under two browser zones (mock `getBrowserTimeZone` to return each) and expect the same text. The Wallet card test in `AttendeeDetailPage.walletActions.test.tsx` does this. For a time that the code builds with `Intl.DateTimeFormat`, check the zone the formatter names, as the chart test in `WalletsReportsTab.test.tsx` does.
