# Time display in the admin SPA

Read before a screen shows a time: a timestamp, a "last updated", a "Today 14:05".

---

Staff read these screens together, on calls and in screenshots. A time has to be the same text for everyone who looks at it, wherever each of them sits. So the viewer's own time zone never decides what a screen shows.

## Which time to show

| The time is | Show | Use |
|---|---|---|
| An action whose zone Admitto stored (an Activity entry, a delivery that an admin sent) | That zone, with its offset: "15:00 UTC+2" | `formatEventDateTime(iso, actorZone)` |
| Anything with no stored zone (a worker run, a provider's value, an attendee's action, a note) | UTC: "13:00 UTC" | `formatUtcDateTime(iso)` |
| The event's own date or hours, or a report that groups by day | The event's zone, with its offset | `formatEventDateTime(iso, event.timezone)`, `formatEventDate` |
| A secondary line under a UTC time | The viewer's zone, labelled "Your local time" | `ActorOrViewerLocalTimeLine` |

Every time carries its offset or "UTC", so the reader never has to guess the zone.

An event can be far from the people who work on it, from its attendees and from the mail scanners that open their links. A time shown in the event's zone would be a guess that looks like a fact. UTC claims nothing.

## Where the viewer's zone is allowed

Only where the viewer is the one who did the thing and is looking at it live: a check-in screen read by the operator who is scanning, a test mail or a health check they have just run. Each such place is listed, with its reason, in `time-zone-standard.test.ts`.

## What checks this

- `apps/admin/test/locale/time-zone-standard.test.ts` fails on a new read of the viewer's zone (`getBrowserTimeZone()` or `Intl.DateTimeFormat().resolvedOptions().timeZone`) or a new `viewerLocalTime()` call outside its list. It is a ratchet: an entry that no longer matches the code has to be lowered or removed.
- `apps/admin/test/locale/locale-coverage.test.ts` fails on a raw `toLocale*` call outside `utils/event-dates.ts`. A time goes through a helper in that file, never through hand-made formatting.

To test a time, render it with two different browser zones (mock `getBrowserTimeZone` to return each) and expect the same text. The Wallet card test in `AttendeeDetailPage.walletActions.test.tsx` does this.
