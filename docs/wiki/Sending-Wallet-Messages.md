# Sending Wallet Messages

> **Audience:** Event Managers
> **Required role:** Organisation Admin
> **Feature status:** Available
> **Last verified:** Admitto 0.5.1

## What this page helps you do

Push a short custom message to attendees' already-installed Apple Wallet or Google Wallet passes, so it appears as a lock-screen notification on their phone - useful for last-minute changes like a room swap or a doors-closing reminder.

## Before you start

The event's Wallet integration must be configured and working (see [Wallet Passes - PassCreator Template Setup](Wallet-Passes-PassCreator-Setup)), and at least some attendees must have an active wallet pass on this event - the recipient count is every attendee with an issued, non-voided pass, whether or not they've actually added it to a phone yet. Keep the Admitto **worker** running (`npm run worker` in development, or the compose `worker` service in deploy) so a queued send leaves the queue.

## Steps

1. Open **Communication**, then the **Wallets** tab.
2. Write the message in the **Message** field and check the live preview below it.
3. Choose a recipient filter.
4. Select **Count recipients** and compare the count with your expectation.
5. If the count is wrong, cancel and correct the filter, or check whether the attendees you expected have actually added their pass.
6. Select **Send**.
7. Watch the send complete, then review the reported sent/skipped/errored counts.

## Expected result

Recipients whose pass is still installed see a lock-screen notification with the message text. The send completes with counts for how many the wallet provider accepted - not a confirmation that every device actually displayed it.

## Important decisions

| Recipient option | Meaning |
|---|---|
| All attendees with a wallet | Every attendee on this event who currently has an active wallet pass - not literally everyone on the event, only those who have one. |
| By ticket type | Attendees holding the selected ticket type, among wallet holders. |
| Specific attendees | Search by name or email and pick individuals one at a time - only wallet holders are suggested. Use this for a small, named group. |

A recipient count is a dry run and sends nothing. Sending always goes through the background worker, even for a single recipient - there is no way to send instantly from the browser tab.

## What changes after this action

Nothing is stored on the attendee's own record; sending only pushes a transient notification to already-installed passes. It does not change the pass's own displayed data (name, ticket type, event details) - use the existing **Push updates** action for that.

## Common problems

- **The count is zero:** confirm the selected filter, and that the attendees you expected have an active wallet pass on this event (Attendee detail page → Wallet). The count does not check whether a pass was actually installed on a phone - an issued-but-never-installed pass is still counted.
- **Send completes but the "errored" count is above zero:** those attendees' passes were not reachable at send time (for example, the pass was later removed from the phone). Try again later, or check the event's Wallet integration is still connected.
- **The message never arrives on a real device even though the send reported success:** delivery to the wallet provider (Apple/Google) is outside Admitto's control once the send is accepted - allow a few minutes, and confirm the attendee's device has notifications enabled for Wallet.

## Related pages

- [Wallet Passes - PassCreator Template Setup](Wallet-Passes-PassCreator-Setup)
- [Sending Messages and Delivery](Sending-Tickets-and-Delivery)
