# Reports and Archiving

**Audience:** Event Managers and Superadmins · **Required role:** Administrator for reports; Superadmin for archiving · **Feature status:** ✅ Available · **Last verified:** Admitto 0.6.7

## What this page helps you do

Review event attendance, export approved report data, and close an event safely when work is complete.

## Before you start

Open the correct event and confirm its time zone. Before archiving, finish check-in, corrections, reporting, and approved follow-up work.

## Steps

### Review and export reports

Open **Reports**. It has these tabs: Event day, Wallets (only when the event offers at least one wallet platform), Custom fields and Mail.

#### Event day

1. Review the compact KPI tiles, the hourly admissions chart, **Attendance confirmation**, **Check-in method**, **By device**, the ticket-type breakdowns, **By operator**, and the admission log (newest admission first).
2. **By operator** and the admission log show the authenticated operator who performed the check-in (a staff account), not only a self-declared device label.
3. The admission log and the CSV and PDF exports also show which event-day items were issued to each admitted attendee.
4. Apply filters when you need a narrower result.
5. Check the displayed times against the event time zone.
6. Use the export control only for an approved event purpose.

#### Wallets

This tab shows wallet-adoption analytics.

**What counts as "installed".** Once a pass has been confirmed installed at least once, it stays counted as installed, even if the attendee later removes it from their device. So these figures do not drift downward after the event just because someone uninstalled a pass they no longer needed. These cards use that rule:

- Pass adoption
- Adoption by ticket type
- Time to install, and time to install after a reminder
- The with and without wallet check-in comparison

**Cumulative passes issued over time** is separate. It shows every pass issued, whether or not installation was ever confirmed.

**Two metrics show who is registered right now.** They are platform mix (Apple, Google and Samsung Wallet, whichever platforms the event's Wallet settings offer) and how many devices or accounts each attendee's pass is registered on. For an event reviewed well after it ended, they can be lower than pass adoption. They use the same "registered" count as **Registration state (last known)** below.

**Three cards look at every issued pass from three independent angles.** They are not nested inside each other. A pass can be voided in Pass validity and still show as registered in Registration state (last known), because a void does not touch registration by itself.

| Card | What it counts |
|------|----------------|
| **Pass validity** | Active. Voided, whether an admin voided it or the wallet service reported it voided. Or permanently expired. A voided pass can be brought back with **Restore wallet pass**, but only while the event is still running, Wallet is on for this event, and the pass has not also been removed from the wallet service. A hover on the card title shows the most recently checked pass. That is not a guarantee that every pass counted here is that fresh. A wallet service that voided or expired a pass on its own after the event was archived is not noticed until someone runs **Refresh status** by hand |
| **Provider state** | Not yet removed by Admitto. Or permanently removed by it, through **Remove from provider** or **Remove inactive passes**. The record and history stay either way. A pass deleted directly at the wallet service, outside Admitto, still shows as not removed here |
| **Registration state (last known)** | Registered on a platform this event offers right now. Or no registration on an offered platform, despite real installation history (this can include one still active on a platform that has since been turned off). Or never installed at all |

Pass adoption always equals Registration state's registered plus previously registered.

#### Custom fields

A chart for each custom field configured on the event's Requirements page:

- A selector or yes/no field shows a donut: how many attendees hold each value, plus how many have not answered.
- A free-text field shows a gauge: how many attendees have filled it in.

A newly added custom field gets a chart here automatically, with no extra setup.

#### Mail

Email delivery analytics:

- **Delivery-attempt status:** queued, accepted, failed, bounced and so on.
- **Who email reached:** how many attendees email actually reached at least once, whether it took one attempt or a resend. This is split further into attendees who were never sent an email at all, and attendees who were sent one but every attempt failed to deliver.
- **First tries and resends:** the split between them.
- **Success rate** for each email template used.
- **A cumulative chart** of successful sends over time.
- **Ticket page visits:** how many reached attendees went on to open their ticket page online at least once. This reflects real ticket-page visits, not whether an email itself was opened. Admitto does not track email opens or link clicks.
- **Check-in rate** compared between attendees email reached and attendees it did not.
- **An event journey summary:** how many attendees reached each stage: got a ticket email, installed a wallet pass, attended.
  - The wallet-installed stage uses the same permanent, ever-confirmed definition as the Wallets tab's pass adoption. It does not drop back if an attendee later removes the pass from their device.
  - The stages are not a strictly narrowing funnel. An attendee can install a wallet pass without email ever reaching them another way. So each stage is shown as its own share of every attendee.

#### Export

**Export report** follows whichever tab is open. It exports one CSV row per attendee (wallet status, email delivery, or each custom field's own answer, depending on the tab), or a printable PDF summary of that tab's own cards.

### Archive the event

> [!CAUTION]
> Archiving makes the whole event read-only, including attendee changes, communication, settings, and check-in.

1. Ask a Superadmin to open **Event settings** → **Danger zone**.
2. Review the status and make sure no operator is still using check-in.
3. Select **Archive event**.
4. Read the confirmation message and confirm.
5. Check that the event is shown as archived and read-only. Its **Overview** page shows an amber archived notice.

Organisation settings → **Archiving** lists active and archived events (one toggle, paginated). It shows who created and who last archived each event, and when.

## Expected result

Reports reflect the recorded admissions and event data. An archived event remains available for review but cannot be changed or used for check-in.

## Important decisions

- Only a Superadmin can archive or restore an event.
- Archiving is not a substitute for correcting unfinished event data.
- Keep exported attendee data only for the approved purpose and retention period.
- Restoring an event makes supported work possible again. It should have a clear operational reason.

## What changes after this action

- An export creates a separate file outside Admitto. Handle it accordingly.
- Archiving changes the entire event to read-only, including attendee updates, communication actions, settings, and check-in.

## Common problems

| Problem | What it means and what to do |
|---------|------------------------------|
| **The archive control is disabled** | It is Superadmin-only |
| **A report time looks unexpected** | Check the event time zone and the active filters |
| **The report does not show an expected admission** | Review the attendee activity and the operator's scan result before editing data |
| **More work is needed after archiving** | Ask a Superadmin to verify the reason and restore the event. A Superadmin can select **Restore event** in the archived notice on the event's **Overview** page and confirm, or use **Restore event** in **Event settings** → **Danger zone**. Other roles see the notice without the button |
| **An error says you do not have access to the event** | Your role cannot see this event's reports |

**A tab shows grey cards, says "Taking longer than usual", or shows a "Could not load…" error**

The report is being read from the server. After 30 seconds, or when the read fails, the tab stops waiting and shows an error with a **Retry** button. The button stays on screen, busy, until the answer is in.

- **Event day** ("Could not load report"): the header, the tabs and **Export report** stay on screen, and **Export report** waits for the report. Once the report is there, live check-ins update it as they happen. **Export report** shows a spinner while a CSV file is being made, and its menu opens again when the file is in.
- **Wallets, Custom fields and Mail** ("Could not load wallet report", "custom field report" or "mail report"): each tab is read from the server the first time you open it, and its charts load together with its data. Grey cards of the tab's own shape show while it loads. They stay invisible for the first fraction of a second, so a quick answer shows no flash. When it works, the keyboard focus goes to the tab. Going back to a tab you have already opened does not read it again.

## Related pages

- [Event Overview and Settings](Event-Overview-and-Settings)
- [Managing Attendees](Managing-Attendees)
- [Scanning Tickets and Results](Scanning-Tickets-and-Results)
- [Organisation Settings](Organisation-Settings)
- [Superadmin Quick Start](Superadmin-Quick-Start)
