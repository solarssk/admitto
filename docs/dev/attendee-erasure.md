# Erasing an attendee's personal data

`eraseAttendees` ([`packages/tickets/src/erase-attendees.ts`](../../packages/tickets/src/erase-attendees.ts)) anonymises attendees in place. The row stays, so Reports, capacity and the admission log keep their numbers; nothing that identifies the person or opens their ticket is left. It is a different action from removing an attendee (hard delete, for mistakes), which changes Reports.

## What happens

Run inside the caller's transaction, once per attendee that is not erased yet.

| Where | What erasure does |
|---|---|
| Attendee | Name and email become placeholders (`Erased attendee`, `erased-<id>@erased.invalid`). Names, company, department, custom answers, ticket token, QR payload, agency ids and public ref are cleared. `erased_at` is set. Admission time is cut to the hour in the event timezone. |
| Attendee status | A person not admitted yet, on an event that is not archived, becomes `cancelled`, so their place is free. Otherwise the status stays. |
| Notes, activity log | Deleted. |
| Check-ins | Kept without notes, time cut to the hour. Because of that cut, "undo the last scan on this device" refuses when an erased scan on the device could have been the last one (it cannot tell), instead of undoing an older, live attendee. |
| Email deliveries | Kept as rows for the Mail report, without recipient, subject, body, provider message id and error text. Mail still waiting to go out is cancelled first. |
| Wallet pass | Links, device and tokens cleared. Provider ids stay until the pass is deleted at the provider. |
| Central audit log | The "created manually" entry loses the name and email it recorded. |

The database enforces the result: `Attendee_erased_carries_no_personal_data` rejects any row with `erased_at` set that still holds a name, email, credential or answer, and a trigger refuses to change or clear `erased_at` once it is set (a delete of the row is still allowed).

## Rules for code

- **New column or table on an attendee?** `packages/tickets/test/erasure-inventory.test.ts` fails until you decide what erasure does with it (cleared, kept, deleted). Add the behaviour to `eraseAttendees` and its test too.
- **Never reuse an erased row.** `erased_at` is the marker; `status` is not (it drives capacity and issuing). Code that sends, issues, edits or checks in an attendee must refuse an erased one. Ticket issuing and the event-day operations (check-in, undo and revoke, item hand-outs, notes, the activity log, the door search and card) already do.
- **Writing a row that belongs to an attendee?** Call `lockAttendeeRow` ([`attendee-lock.ts`](../../packages/tickets/src/attendee-lock.ts)) first in the same transaction. A check-in, note, item state, log entry, wallet pass or email delivery is inserted under the weakest row lock, so without it the insert can wait for a running erasure and land after it. A filter such as `attendee: { erased_at: null }` does not close that race. A write that updates the attendee row itself puts `erased_at: null` in its own `where` instead.
- **Only reading?** No lock. A plain read (the door search, the recent scans) is one statement, so it does not wait for an erasure that is still open: it sees the attendee as it was before that commit, or the placeholder after it. Both are fine, because what the operator was handed a moment before the commit cannot be taken back by any lock. Filter `erased_at: null` and leave it there. Take the row lock only when a read is followed by a write, as the card is (it inserts the pending item states).
- **Never log or audit names or emails** of the people erased. Ids and counts only.
- **`@erased.invalid` is reserved.** Import, manual add and edit reject such an address, and a second CHECK refuses it on a live row: a live attendee holding `erased-<id>@erased.invalid` would make the erasure of `<id>` fail on the unique (event, email) index. The migration moves any address already in that namespace to `<local part>+<attendee id>@legacy.erased.invalid` before the constraint is added, so the upgrade cannot fail on old data.

## Not done by the function

- The pass at the provider is not deleted (network call). The function returns `walletTargets`; the caller deletes them after commit and stamps `provider_removed_at`. Until then the row keeps its provider ids so the delete can be retried. The caller should re-read the attendee's wallet pass after the commit rather than trust `walletTargets` alone: a pass created by a request that started before the erasure (`markActive` in `apps/web/src/app.ts`, `reissue-wallet-pass.ts`) is not blocked by it.
- Event-level copies are not touched: import results that quote an email, wallet message job requests, export files, a staged import CSV.
- Code paths that read the attendee before the erasure and write after it still have to refuse an erased attendee, and until they do they can put data back: the ticket email claim (`claim.ts` inserts a queued delivery with the address and name it read earlier, and reclaiming a cancelled delivery refills it) and wallet pass creation (above). Event-day operations and ticket issuing are done.
- Outside Admitto: the mail provider's Sent Items and relay logs, proxy logs, database backups (14 days by default). A restore must re-run the erasures.
- A mail already handed to the sender when the erasure runs can still go out once, and its outcome (accepted, provider message id) is then written back onto the emptied row.
- Other timestamps the person caused stay exact: mail opened and clicked, RSVP update, first wallet confirmation. Only admission and check-in times are cut to the hour.
