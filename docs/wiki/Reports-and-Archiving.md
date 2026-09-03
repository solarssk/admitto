# Reports and Archiving

**Audience:** Event Managers and Superadmins · **Required role:** Administrator for reports; Superadmin for archiving · **Feature status:** ✅ Available · **Last verified:** Admitto 0.6.7

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
8. Switch to the **Wallets** tab for wallet-adoption analytics. Pass adoption, adoption by ticket type, time to install, time to install after a reminder, and the with/without-wallet check-in comparison all use the same permanent definition of "installed": once a pass has been confirmed installed at least once, it stays counted even if the attendee later removes it from their device, so these figures don't drift downward after the event just because someone uninstalled a pass they no longer needed. Platform mix (Apple, Google, and Samsung Wallet - whichever platforms the event's Wallet settings offer) and how many devices or accounts each attendee's pass is registered on are different: both show who currently has an active registration right now, so they can be lower than pass adoption for an event reviewed well after it ended. Wallet lifecycle makes this split explicit - active (installed right now), removed (confirmed installed at some point, not any more), or never installed - and pass adoption always equals active plus removed. Cumulative passes issued over time is also shown here.
9. Switch to the **Custom fields** tab to see a chart for each custom field configured on the event's Requirements page: a selector or yes/no field shows a donut of how many attendees hold each value (plus how many haven't answered), and a free-text field shows a gauge for how many attendees have filled it in. A newly added custom field gets a chart here automatically, with no extra setup.
10. Switch to the **Mail** tab for email delivery analytics: delivery-attempt status (queued, accepted, failed, bounced, and so on), how many attendees email actually reached at least once (whether it took one attempt or a resend), the split between first tries and resends, success rate for each email template used, a cumulative chart of successful sends over time, how many reached attendees went on to open their ticket page online at least once, check-in rate compared between attendees email reached and attendees it didn't, and an event journey summary showing how many attendees reached each stage (got a ticket email, installed a wallet pass, attended). The wallet-installed stage uses the same permanent, ever-confirmed definition as the Wallets tab's pass adoption (see step 8), so it doesn't drop back down if an attendee later removes the pass from their device. The ticket-page-opened number reflects real ticket-page visits, not whether an email itself was opened - Admitto does not track email opens or link clicks. The event journey's stages aren't a strictly narrowing funnel - an attendee can install a wallet pass without email ever reaching them another way, so each stage is shown as its own share of every attendee.
11. **Export report** follows whichever tab is open: it exports one CSV row per attendee (wallet status, email delivery, or each custom field's own answer, depending on the tab), or a printable PDF summary of that tab's own cards.

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
