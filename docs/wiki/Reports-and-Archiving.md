# Reports and Archiving

**Audience:** Event Managers and Superadmins · **Required role:** Administrator for reports; Superadmin for archiving · **Feature status:** ✅ Available · **Last verified:** Admitto 0.6.4

## What this page helps you do

Review event attendance, export approved report data, and close an event safely when work is complete.

## Before you start

Open the correct event and confirm its time zone. Before archiving, finish check-in, corrections, reporting, and approved follow-up work.

## Steps

### Review and export reports

1. Open **Reports**.
2. Review compact KPI tiles, the hourly admissions chart, **Attendance confirmation**, **Check-in method**, **By device**, ticket-type breakdowns, **By operator**, and the admission log.
3. Treat **By operator** and the admission log as the authenticated operator who performed the check-in (staff account), not only a self-declared device label.
4. Admission log and CSV/PDF exports also show which event-day items were issued to each admitted attendee.
5. Apply filters when you need a narrower result.
6. Check displayed times against the event time zone.
7. Use the available export control only for an approved event purpose.
8. Switch to the **Wallets** tab for wallet-adoption analytics: pass adoption and platform mix (Apple/Google), adoption by ticket type, cumulative passes issued over time, how long attendees take to add their pass after the ticket email, and check-in rate compared between attendees with and without a wallet pass.
9. Switch to the **Custom fields** tab to see a chart for each custom field configured on the event's Requirements page: a selector or yes/no field shows a donut of how many attendees hold each value (plus how many haven't answered), and a free-text field shows a gauge for how many attendees have filled it in. A newly added custom field gets a chart here automatically, with no extra setup.
10. **Export report** follows whichever tab is open: on the Wallets tab it exports one CSV row per attendee's wallet status (issued/installed/voided, per-platform registration, check-in), or a printable PDF summary. The Custom fields tab has no export of its own yet.

### Archive the event

> [!CAUTION]
> Archiving makes the whole event read-only, including attendee changes, communication, settings, and check-in.

1. Ask a Superadmin to open **Event settings** → **Danger zone**.
2. Review the status and make sure no operator is still using check-in.
3. Select **Archive event**.
4. Read the confirmation message and confirm.
5. Check that the event is shown as archived and read-only.

Organisation settings → **Archiving** lists active and archived events (one toggle, paginated) and shows who created and who last archived each event, and when.

## Expected result

Reports reflect the recorded admissions and event data. An archived event remains available for review but cannot be changed or used for check-in.

## Important decisions

- Only a Superadmin can archive or unarchive an event.
- Archiving is not a substitute for correcting unfinished event data.
- Keep exported attendee data only for the approved purpose and retention period.
- Restoring an event makes supported work possible again; it should have a clear operational reason.

## What changes after this action

An export creates a separate file outside Admitto and must be handled accordingly. Archiving changes the entire event to read-only, including attendee updates, communication actions, settings, and check-in.

## Common problems

- **The archive control is disabled:** it is Superadmin-only.
- **A report time looks unexpected:** check the event time zone and active filters.
- **The report does not show an expected admission:** review the attendee activity and the operator's scan result before editing data.
- **More work is needed after archiving:** ask a Superadmin to verify the reason and restore the event.

## Related pages

- [Event Overview and Settings](Event-Overview-and-Settings)
- [Managing Attendees](Managing-Attendees)
- [Scanning Tickets and Results](Scanning-Tickets-and-Results)
- [Organisation Settings](Organisation-Settings)
- [Superadmin Quick Start](Superadmin-Quick-Start)
