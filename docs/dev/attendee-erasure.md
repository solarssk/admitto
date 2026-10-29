# Erasing an attendee's personal data

`eraseAttendees` ([`packages/tickets/src/erase-attendees.ts`](../../packages/tickets/src/erase-attendees.ts)) anonymises attendees in place.

- The row stays, so the Reports totals and the admission log keep their numbers.
- Capacity is the one thing that moves. A person who is not admitted yet, on an event that is not archived, becomes `cancelled`, and their places are free again: their own and their companion's (a companion holds a place only while the attendee is active).
- Nothing that identifies the person or opens their ticket is left.
- It is a different action from removing an attendee (a hard delete, for mistakes), which changes Reports.

On this page:

- [What happens](#what-happens)
- [The API](#the-api)
- [The CLI](#the-cli)
- [The screens](#the-screens)
- [Removing an attendee](#removing-an-attendee)
- [Deleting a guest registration](#deleting-a-guest-registration)
- [Job failure privacy](#job-failure-privacy)
- [Files left in storage](#files-left-in-storage)
- [Passes still at the provider](#passes-still-at-the-provider)
- [Rules for code](#rules-for-code)
- [Not done by the function](#not-done-by-the-function)

## What happens

`eraseAttendees` runs inside the caller's transaction, once per attendee that is not erased yet.

| Where | What erasure does |
|---|---|
| Attendee | Name and email become placeholders (`Erased attendee`, `erased-<id>@erased.invalid`). Names, company, department, custom answers, ticket token, QR payload, agency ids and public ref are cleared. `erased_at` is set. Admission time is cut to the hour in the event timezone. |
| Attendee status | A person not admitted yet, on an event that is not archived, becomes `cancelled`, so their places are free (theirs and their companion's). Otherwise the status stays. |
| Companion | The row of each companion stays: the name becomes a placeholder (`Erased companion`) and the answers are cleared. A companion holds a place only while the attendee is active, so the places of an attendee who was cancelled by the erasure are free, and the places of one who was admitted (or whose event is archived) stay taken. |
| Notes, activity log | Deleted. |
| Check-ins | Kept without notes, with the time cut to the hour. Because of that cut, "undo the last scan on this device" refuses when an erased scan on the device could have been the last one (it cannot tell). It does not undo an older, live attendee instead. |
| Email deliveries | Kept as rows for the Mail report, without recipient, subject, body, provider message id and error text. Mail still waiting to go out is cancelled first. |
| Wallet pass | Links, device and tokens cleared. Provider ids stay until the pass is deleted at the provider. A row that holds only the id reserved for a pass (its provider id was never saved) also stays, until the provider has answered for that id ([Passes still at the provider](#passes-still-at-the-provider)). |
| Central audit log | The "created manually" entry loses the name and email it recorded. |
| Guest registrations | Deleted with their queued mail: the one the person was accepted from, and every one in the event with one of their addresses that no other attendee was accepted from. |

## The API

### Endpoints

- `POST /api/admin/events/:eventId/attendees/:id/erase`
- `POST …/attendees/bulk-erase`

Both are open to the Administrator and Superadmin of the event. Both are allowed on an archived event.

### What a request does

In one transaction, the request:

1. runs `eraseAttendees`
2. blanks the erased addresses in the saved results of the event's imports (`scrubImportJobResults`)
3. writes the audit entries: the event's activity log and the central audit log, **ids and counts only**, with `method: "erase"`

After the commit, it:

1. deletes each erased attendee's wallet pass at the provider (`deleteErasedWalletPasses`, from the event's credentials alone, whatever the Wallet switch says) and marks the pass removed
2. deletes the files that the event's exports and imports left in storage ([Files left in storage](#files-left-in-storage))

### The answer

The answer is `{ erased, already_erased, not_found, wallet_pending, wallet_removed_ids }`.

- **`wallet_pending`** counts erased attendees whose pass is still to be deleted at the provider. That happens when the delete failed, when the event has no credentials, or when the 90 s budget of one request ran out. In database terms, it is a pass row whose `left_behind_pass_id` is set, or that is not marked removed and either holds the provider's id, or holds only the id reserved for the pass, or says that a creation failed ([Passes still at the provider](#passes-still-at-the-provider)).
- **`wallet_removed_ids`** lists the attendees whose pass was still to be deleted when the follow-up started and no longer is. The pass was deleted by this request, or by one running at the same moment. The list is read from the database before and after the follow-up.
  - A pass that never reached the provider (no id of any kind on its row), or that was removed before, is not in the list. So a screen can say "deleted" only for a pass that was.
  - A row that held only the reserved id is in the list once the provider has answered for that id. Either the provider deleted a pass, or it has none and the erasure is old enough to rely on that (10 minutes, see [A pass whose provider id was never saved](#a-pass-whose-provider-id-was-never-saved)).

### Budgets

Both endpoints spend the attendee-mutation budget of the user and event (20 a minute). When the event has wallet credentials, they spend a second budget too:

- the single endpoint: the wallet-action budget that it shares with the other single-attendee wallet actions (10 a minute)
- the bulk endpoint: the wallet-action-bulk budget (10 in 10 minutes), as bulk remove does

One follow-up runs per user and event at a time.

### Retrying and its limits

- **Repeating the request is the retry.** Attendees already erased change nothing in the database. Only their pending passes are tried again.
- The retention run retries them too, about once a day ([Passes still at the provider](#passes-still-at-the-provider)).
- A provider that answers 404 counts as "deleted". So a pass issued under an API key or account that was changed later is marked removed while it may still exist.

### What the database enforces

- `Attendee_erased_carries_no_personal_data` rejects any row with `erased_at` set that still holds a name, email, credential or answer.
- A trigger refuses to change or clear `erased_at` once it is set. (A delete of the row is still allowed.)

## The CLI

`admitto attendees erase --event <id> --attendee-ids <id[,id...]> --operator-email <email> [--dry-run] [--yes]` ([`attendees-erase.ts`](../../apps/cli/src/commands/attendees-erase.ts)) is the break-glass path for a privacy request when the admin UI and API are not reachable.

**Finding the ids.** `admitto attendees find --query "<name or email>" [--event <id>]` ([`attendees-find.ts`](../../apps/cli/src/commands/attendees-find.ts)) is a read-only lookup.

- It lists up to 20 people (not those already erased), in every event unless `--event` is given.
- For each person it shows the event's id and title and the attendee's id and address. So a request that names only a person finds the event id too.
- It has no archived-event guard, unlike `checkin lookup`, because an archived event's attendees can still be erased.

**What `erase` runs.** The same domain functions as the API, in the same order: `eraseAttendees`, `scrubImportJobResults`, the two audit writers, `purgeEventJobFiles` and `deleteErasedWalletPasses`. The audit metadata carries `source: "cli"` (`attendee_erased` for one id, `attendees_bulk_erased` for several, ids and counts only).

**How it differs from the API**

- It asks for a typed `yes` (not for the attendee's name).
- It takes up to 500 ids.
- It gives the provider up to 10 minutes (nothing else waits for it).
- It does not announce the change to open admin screens. They catch up on their 30 second poll.
- It exits with code 2 when a pass is still at the provider after the follow-up.
- It prints one line when the follow-up found passes that Admitto had no record of (see [Passes still at the provider](#passes-still-at-the-provider)).

`--dry-run` needs no operator and changes nothing.

**Remove from event** has no CLI command on purpose. It is for mistakes, it changes Reports, and its best-effort wallet delete before the transaction lives in the web app.

## The screens

Where an Administrator or Superadmin reaches the erasure (`apps/admin`). Erase is not behind the archived-event guard, like the API.

### Attendees list: bulk bar

In the bulk bar, **More actions** has **Erase personal data** for the selection (`BulkEraseDialog`, `bulkEraseAttendees`).

- No typed name is needed.
- The dialog says how many of the selected people are not checked in yet, so that their places become free (`placesFreedBy`, `freedPlacesLine`). It is the same rule as the one-person dialog, and it never applies on an archived event.
- When the server confirms, the list redacts those rows in place at once (`redactedRowsAfterErasure`), and then reads the server's version. So nothing of the people stays on screen while that read waits.
- What the redaction does to a row:
  - personal data out
  - the check-in time cut to the hour of the event's zone, like the server does (`truncatedToEventHour`)
  - the status that the server sets
  - mail that was waiting to go out cancelled (a list row carries `last_mail_retryable`, so it can tell a failed mail that was to be retried from one that was not)
  - the pass marked as removed at the provider, for the people the answer lists in `wallet_removed_ids`
- If the read finds its page empty (the erasure took the last rows of the last page), the list steps back to the last page that exists instead of saying "No matches".

### Attendee page: More actions

**More actions** has **Erase personal data** for one person (`EraseAttendeeDialog`, `eraseAttendee`). The attendee's name has to be typed.

- When the server confirms, the page swaps its local copy for a redacted one at once (`redactedAfterErasure`), and then reads the server's version. So nothing of the person stays on screen while that read waits, or if it fails.
- The redacted copy has:
  - personal data out
  - the check-in time cut to the hour of the event's zone
  - the status that the server sets
  - mail that was waiting to go out cancelled
  - the pass as the answer left it: still at the provider when `wallet_pending` says so (which keeps the Try again there), and deleted now only when `wallet_removed_ids` lists the person
- The page never turns an erased attendee back into one that is not (`isOlderThanErasure`, checked in `applyDetail`, the one place every answer goes through). So a read, or a change (a note, say), that was already on its way cannot bring the person back when its answer arrives late.
- A read that answers after a newer one is dropped (`loadSeqRef`). So an older answer cannot put back what the newer one changed (a pass deleted by Try again, say).
- The line "Not checked in yet, so their place becomes free" shows only when the erasure will cancel the attendee (`erasureFreesPlace`, the same rule as the function).

### Attendees list: Filters

- Erased entries are left out of the list (`include_erased` is not sent).
- **Erased entries** (**Hide** or **Show**) lists them. It is in Filters only when the event has any. The Filters button counts the switch when it is on.
- Its hint says how many there are (`erased_count`, event-wide, however the list is filtered, so no number is needed under the table) and that Reports count them either way. Nothing is said under the table.
- Shown, they are muted rows:
  - "Erased attendee" (no second mark, the name says it) and "Erased on <date>" stand in place of the name and address. The placeholders that the server sends are never shown.
  - The checkbox stays off. **Select all** skips them.

### Attendee page of an erased attendee

`ErasedAttendeeView` is read-only. It has the same header, status chips and tabs as every attendee's page. The page builds the strip and owns `?tab=`, so a link opens the tab it names.

- **Overview:** every field that held personal data reads **Erased**. The check-in time reads "Around HH:MM".
- **Notes:** one line saying that the notes were erased, and no way to add a note.
- **Activity log:** one entry of the erasure itself (the staff member, the time in the zone they were in, through what, and where from for a Superadmin), and then a line saying that the rest of the history was erased. With no such entry, one line saying that the history was erased.
- **The notice above the page** names the staff member too ("Personal data erased on 10 Oct 2026 by Admin Example.").
- All of that comes from `erasure` in the detail response (see "Who erased the person" below).
- **The Wallet card** says what became of the pass: deleted on a date, or still to be deleted, with a **Try again** button. "Still to be deleted" is `wallet_pass_delete_pending` in the detail response. It is true for an erased attendee whose pass row is still to be deleted by the same question as `wallet_pending` ([Passes still at the provider](#passes-still-at-the-provider)).

### The Personal data erased dialog

The dialog is shown after an erasure when `wallet_pending` is above zero (`useEraseWalletResult`).

- **Try again** sends the same request again. For people who are already erased, that only retries the wallet delete.
- It is a Retry of a dialog. The failure of the earlier try stays on screen, with the busy button, until the answer is in. The button stays busy for 400ms at least. A failure that repeats is announced again.
- What the answer says about the pass is applied at once, before the page reads the server's version. So a read that fails cannot make a deletion that worked look lost. It is applied to the attendee page (`withWalletOutcome`), and to the rows of the Attendees list for the people the answer lists in `wallet_removed_ids`, a partial retry included (`rowsWithPassesRemoved`).

### Who erased the person

The detail response of an erased attendee carries `erasure` ([`attendee-erasure-record.ts`](../../apps/web/src/admin/attendee-erasure-record.ts)). It comes from the first entry of the central audit log that names the attendee. That entry must match all of these:

- the same organisation
- the action `attendee_erased` or `attendees_bulk_erased`
- `metadata.method` is `erase`
- the event
- the attendee's id in `attendee_id` or `attendee_ids`
- written within an hour of `erased_at`

`erasure` holds:

- the staff member as the entry snapshotted them (`by.display_name` and `by.email`). `by` is null when the entry kept neither.
- `via`: `cli` when `metadata.source` says so, else `admin` (which the screens and a script of the staff API share).
- `timezone`: the zone the staff member was in, in which the Activity log tells its times.
- only for a Superadmin, who is the one role that can read that log: the address of the request (`ip`) and where it is (`location`, as in the audit log).

More about what is sent:

- The address of the command line in the log is a placeholder, and a request with no socket is logged as `unknown`. Neither is sent.
- Everyone who can open the page gets `by`, `via` and `timezone`. The address leaves the server for no one else.
- `erasure` is null for an attendee who is not erased, and when the log has no entry of the erasure (an operator cleared it). The page then says only that the history was erased.
- The erased person is not in the lookup. It uses their id and nothing else about them.

## Removing an attendee

`removeAttendees` ([`packages/tickets/src/remove-attendees.ts`](../../packages/tickets/src/remove-attendees.ts)) deletes attendees from an event for good. It is the hard delete, for mistakes (a duplicate, a test person, a wrong import file). Reports change with it. It is a different action from erasing (above), which keeps the entry.

### The removal API

`POST /api/admin/events/:eventId/attendees/:id/remove` and `POST …/attendees/bulk-remove` (Administrator and Superadmin of the event).

- The body carries a `reason` from a fixed list (`ATTENDEE_REMOVAL_REASONS` in `@admitto/shared`: `duplicate`, `test_person`, `wrong_import`, `added_by_mistake`, `other`).
- For a selection, the body also carries `attendeeIds` (the same cap as the other bulk wallet routes when the event has wallet credentials).
- There is no free-text note, because it would be personal data in the audit trail.
- The answer is `{ removed, not_found }`. An id that is not an attendee of the event answers 403 for one attendee, like every single-attendee route.
- An archived event refuses it (`403 { code: "event_archived" }`), because its numbers are final.
- An erased attendee can be removed.

### What happens, in order

1. **The wallet pass of each attendee is deleted at the provider first, best effort.** The local row is the only place that knows the pass's id. A failure is logged as `wallet_pass_erasure_delete_failed` and the removal goes ahead, so check the System logs.
   - A pass whose row has the provider's id is deleted by that id.
   - A pass whose row has no provider id is deleted by the id reserved for it ([A pass with no provider id on its row](#a-pass-with-no-provider-id-on-its-row), below).
2. **Then, in one transaction:**
   - The attendee rows are locked in id order.
   - Their deliveries, wallet pass, check-ins and the registration they were accepted from are deleted.
   - The attendee rows are deleted. Notes, the per-attendee activity log, item hand-outs and companions go by cascade.
   - The copies of the identity elsewhere are scrubbed (`scrubAttendeeTraces`, shared with the erasure). That means the address on other attendees' deliveries that staff addressed to this person, the name and address in the creation entry of the central audit log, and the registrations of the event with one of the person's addresses that no other attendee was accepted from. The saved import results are scrubbed too (`scrubImportJobResults`).
   - The audit entries are written, in the event's activity log and in the central admin audit log.
3. **After the commit,** the files that the event's exports and imports left in storage are deleted ([Files left in storage](#files-left-in-storage)).

The audit entries use the action names of an erasure (`attendee_erased`, `attendees_bulk_erased`). They are told apart by `metadata.method` (`"remove"`). They carry the reason code, the ids and the counts (`removed: { emailDeliveries, walletPasses, checkIns, registrations }`), never a name, an address or a note.

### Passes the first delete could not see or reach

These are dealt with after the commit.

- The statement that deletes the wallet pass rows returns what it deleted (`walletTargets`): the passes that still had a provider id and no `provider_removed_at`, read under the attendee locks.
- The route deletes at the provider the passes that the first delete did not (`deleteProviderPassesBestEffort`):
  - a pass that an Add to Wallet request saved after the first delete had read the passes
  - a pass that the provider refused the first time (a second try, with the same log line when it fails again)
- A pass that an Add to Wallet request is still creating when the removal commits is deleted by that request. `handleWalletRedirect` finds the attendee gone (`isAttendeeGone`: no row, the same answer as for an erased attendee) and deletes the new pass at the provider, with no row to keep its ids on. When that delete fails, the pass stays at the provider and the failure is logged as `wallet_pass_erased_delete_failed` (System logs).

### A pass with no provider id on its row

Such a pass can still be at the provider. There are two ways to get one:

- Its creating request wrote only the id reserved for it (`user_provided_id`, `admitto:<event id>:<attendee id>`) and then could not record the pass. The save failed, the event's template changed, or the process died.
- Its creation failed with no id of any kind ([A pass whose provider id was never saved](#a-pass-whose-provider-id-was-never-saved)).

Once the row is deleted, nothing could find such a pass. So the removal asks about it first:

- It asks with the erasure's own question (`PASS_ROW_STILL_AT_PROVIDER` and no provider id). `deleteUntrackedWalletPassesBestEffort` reads it, after `deleteWalletPassesBestEffort` has done the rows that have a provider id.
- It deletes the pass by the id reserved for it (`deletePassByUserProvidedId`). `reservedPassId` takes the id off the row, or builds the one it would have been sent under for a failed creation that has none.

How the answer counts:

- The provider answers from its own record of the id, so "there is none" is an answer, like a pass deleted.
- An erasure keeps its row and does not believe a "none" until it is 10 minutes old ([A pass whose provider id was never saved](#a-pass-whose-provider-id-was-never-saved)). A removal keeps no row to ask again from, so the first "none" is final.

Cost and limits:

- It is best effort, exactly like the delete by the provider's id, and it spends the same budget. That is batches of `BULK_CHECKIN_CONCURRENCY` (10), one after the other, for no more attendees than the selection holds (at most 100 when the event has wallet credentials, as before).
- More than one pass can sit under one id, because two creations at once can both succeed. So an id is asked about until the provider has none (`deletePassesUnder`, the loop of the erasure's follow-up, at most 5 deletions, and then the id counts as failed).
- A pass that the provider holds costs three calls: the read of the id, the delete of the pass it found (only when that pass's own user provided ID is the id), and a read that finds none. No pass costs one call.
- An id that PassCreator also resolves to another pass (as its barcode value) is never deleted. The call fails with `wallet_provider_rejected`, and the attendee is named in the log line described next.
- Nothing is sent when the event has no usable credentials. The Wallet switch plays no part.
- An attendee with no such row costs no provider call. That covers no row at all, a `pending` row with no id, and a pass already marked removed.

### What is still at the provider after a removal

The statement that deletes the rows returns these passes too (`untrackedWalletTargets`). They are the rows that had no provider id and are still to be deleted by `passIsStillToDelete`, each with the id to delete it by.

After the commit, the route asks again (`deleteUntrackedPassesAfterRemoval`) for the passes it had no answer for:

- a delete that failed
- a pass whose id was reserved or rewritten after the first read (it is the id that counts as answered, not the attendee)

An id that the first delete failed for is asked about again even when a creating request has put another id on the row meanwhile, as long as this removal deleted that attendee.

What is still at the provider after that is said in **one line per request**, never one per pass (a bulk removal carries up to 100 attendees):

- The line is `wallet_pass_erasure_delete_failed`.
- It carries the event id, how many (`failed`), the failure codes (`codes`) and every attendee id (`attendeeIds`).
- For a row that held an id other than `admitto:<event id>:<attendee id>`, it also carries the id itself (`reservedIds`). The attendee id already gives the standard one.

Other points:

- A removed attendee leaves no row, so that line is the only record of whose pass stands. Delete the pass in the provider's own console, by its User provided ID.
- The line names only what is still there after the second try.
- When the second try itself breaks (the database cannot be read after the commit), the line names every pass that the first delete had no answer for, with the failure code `unknown`.
- The removal answers the same whatever the provider does.

### The old routes

The old `DELETE …/attendees/:id` and `POST …/attendees/bulk-delete` are gone (they answer 404). They were not behind the archived-event guard, asked for no reason and kept the name and address in the central audit entry. Audit entries that they wrote before the split still hold that identity (see [DATA-PROTECTION.md](../../DATA-PROTECTION.md#central-admin-audit-log-adminauditlog) for blanking them).

### The removal screens

Where an Administrator or Superadmin reaches the removal (`apps/admin`).

**Attendees list, bulk bar, More actions.** **Remove from event** for the selection (`BulkRemoveDialog`, `bulkRemoveAttendees`).

- A reason from the fixed list is chosen. Duplicate entry is the default each time the dialog opens. No typed name.
- The dialog says how many of the selected people have checked in, so that it is clear their check-ins leave Reports too (`checkedInAmong`, from the rows of the page, because the selection is cleared when the page changes).
- When the server confirms, the list is read again and the selection is cleared. The toast says how many were removed and, when someone else removed a person a moment before, how many were gone already (`removedToast`, from `not_found`).

**Attendee page, More actions.** **Remove from event** for one person (`RemoveAttendeeDialog`, `removeAttendee`). The reason and the attendee's name have to be typed.

- When it succeeds, the page goes back to the Attendees list.
- The same item is on the read-only page of an erased attendee (`ErasedAttendeeView`), where the dialog has no link to Erase.

**Both dialogs, and the two Erase dialogs.** A muted line crosses to the other action, for someone who picked the wrong one (`DialogCrossLink`).

- In Remove it reads "A privacy request? **Use Erase personal data**". In Erase it reads "A duplicate or a mistake? **Use Remove from event**".
- The current dialog closes and the other opens clean (its typed name and errors reset).
- A busy link keeps its focus and does nothing.
- The Erase side of a link is left out on an archived event, and Remove's side on an erased attendee, because there is nowhere to go.

**Archived event.** **Remove from event** is off in every menu, with the tooltip "This event is archived, so its numbers are final. To erase someone's personal data, use Erase personal data." (`REMOVE_ARCHIVED_TOOLTIP`; the generic archived tooltip would not say what to do instead). **Erase personal data** stays available, like the API.

**Admin audit log (Organisation settings → Logs → Audit).** An entry's label follows `metadata.method`.

- "Attendee removed (mistake)" or "Attendees bulk removed (mistake)" for a removal.
- "Attendee erased (GDPR)" or "Attendees bulk erased (GDPR)" for an erasure, and for an entry from before the split.
- The Details show the reason in words (`Reason: Duplicate entry`).
- The Action filter has one option for both, "Attendee erased or removed", because both are written under the same action types.

## Deleting a guest registration

`deleteRegistrations` ([`packages/tickets/src/registration-deletion.ts`](../../packages/tickets/src/registration-deletion.ts)) deletes the registrations that guests made through the event form. Staff use it to answer a request to delete a person's data, and to clear out rejected and old registrations by hand. It runs in the caller's transaction and mails no one.

### The API

- `POST /api/admin/events/:eventId/registrations/delete` with `{ "ids": [...] }`. One registration is a list of one. At most 500 ids.
- `POST /api/admin/events/:eventId/registrations/delete-by-filter` with `{ "status", "older_than", "q", "expected", "selection_digest" }`. The filter is the one of the list, `expected` is the `total` the list showed for it, and `selection_digest` is the name the list gave the registrations it showed (the list answers it for a filter that selects at most 500, read in the same snapshot as its page and its total, so it names the registrations those were read from).

Both are open to the Administrator and Superadmin of the event, and both are allowed on an archived event, like Erase: a request to delete data does not expire with the event. They spend the attendee bulk-mutation budget (20 a minute), and the wallet bulk budget as well when the event has wallet credentials.

The answer is `{ results, deleted, attendees_erased, wallet_pending }`. A result is `deleted` (with the erased attendee's id for an accepted registration) or `gone`. An id that is not a registration of this event is `gone`, whoever it belongs to.

The admin app calls both from the Requests tab of the Registration page (`apps/admin/src/registration/`). A deletion by filter sends the filter, `total` and `selection_digest` of the newest answer of the list, never ones it kept from an earlier read: the page drops the digest as soon as an action has changed what the filter selects, and offers the button again with the next answer. A `wallet_pending` above zero opens the same dialog as an erasure, whose Try again calls the erasure of the erased attendees (the `attendee_id`s of the answer).

### What happens to a registration

| State | What the deletion does |
|---|---|
| Waiting for the address, waiting for a decision, on the waiting list, rejected | The registration is deleted with its queued mail. The guest can register again with the address. The link they were mailed finds nothing |
| Accepted | The attendee is erased by `eraseAttendees`, the one path of every erasure, which deletes the registration with it |

An accepted registration is erased exactly like **Erase personal data** does it, so Reports keep their numbers:

- The ticket stops working, and the pass at the wallet provider is deleted after the commit.
- The place is free again, unless the person was admitted or the event is archived. An admitted guest keeps their place, because they came.
- The same two audit entries are written (`attendee_erased` or `attendees_bulk_erased`, `method: "erase"`). The page of the erased attendee says who erased them, and a restore from a backup can repeat the erasure.
- Open exports and imports of the event are stopped, as in every erasure.

Nothing else erases an attendee in this path. A bare `registration.delete` of an accepted registration would leave the attendee behind with their data, so the delete statement for registrations without an attendee carries `attendee_id IS NULL`.

### Which registrations a filter takes

A deletion cannot be undone, so a filter never takes what the staff member did not see:

- The filter is read again under the registration queue with the rule of the list (`registrationListWhere`). When the count is not `expected`, nothing is deleted: `409 registration_count_changed` with `expected` and `matched`. A registration that grew old enough to join an "older than" filter since the list was read changes the count too.
- The same count is not the same registrations: one that left the filter and one that joined it since the list was read leave the number where it was. So the ids that the filter selects now are named (`registrationSelectionDigest`, the SHA-256 of the ids in order) and must have the `selection_digest` the list gave. Otherwise nothing is deleted: `409 registration_selection_changed` with `matched`. The name is no secret and guards against a stale list, not against anyone.
- A filter selects at most 500 registrations (`MAX_REGISTRATION_BULK_IDS`), or `422 too_many_registrations` with `matched` and `limit`. The staff member narrows it.
- When the event has wallet credentials, at most 100 of them may be accepted, because each erased attendee is a call to the provider after the commit (`WALLET_BULK_SEND_LIMIT`). Over that, `422 too_many_accepted` with `accepted` and `limit`.
- A filter must have a status, an age or a search. One that selects everything is refused with `400 validation_failed`, and so is a value outside the lists.

### The audit entries

One `registrations_deleted` entry in the event's activity log and one in the central audit log, in the transaction of the deletion. They hold the registration ids, the attendee ids of the accepted ones, the count, `reason: "staff"` and `by` (`ids` or `filter`). For a filter they also hold its closed values (`status`, `older_than`) and `search: true` when a search was used, never the words, which are a name or an address. A request that deleted nothing writes none.

### Locks

The deletion takes the locks of an erasure, in the order of [Rules for code](#rules-for-code): the jobs of the event, the registration queue, the registration rows in id order, and the attendees inside `eraseAttendees`. It takes the jobs first even when no registration turns out to be accepted. It cannot know before it holds the queue, and taking them afterwards could deadlock with an erasure. The price is that a deletion waits for an import that is running, like an erasure.

It takes no capacity lock. It takes no seat, and a seat it frees is freed under the attendee's row.

### What is left

A registration mail that was already handed to the mail provider when the deletion runs can still go out once, as for an erasure ([Not done by the function](#not-done-by-the-function)). What the guest already received stays in their mailbox and in the provider's Sent Items.

### Tests

- `registration-deletion.test.ts` in `packages/tickets/test`: each state, an accepted registration (ticket, place, an admitted guest, an archived event), the filter, the caps, the audit entries, the rollback, and the deletion against an admission, an erasure, a writer that holds the capacity lock, a guest, and another deletion, each side first.
- `registration-delete-routes.test.ts` in `apps/web/test/integration`: access, the shape of a request, the answers, the wallet pass, and the filter against the list.
- `RegistrationRequestsTab.delete.test.tsx` in `apps/admin/test/registration`: the dialogs, what they say of an accepted request, the filter with its total and digest against a stand-in server that refuses a stale one, and the wallet dialog.

## Job failure privacy

What is protected:

- Import and export workers persist only fixed error categories, never arbitrary exception messages.
- Import capacity errors use fixed copy, even if an exception carries identifying text.
- The job-status APIs and import history accept only recognized fixed messages. Unknown historical errors receive a generic failure message, and non-failed job responses carry no error.
- Existing stopped-by-erasure and stale-worker messages remain distinct.
- Import preview and enqueue failure logs use fixed categories.
- Export cleanup logs allow only recognized filesystem codes, plus the opaque file, job and event identifiers needed for cleanup.

What is not covered:

- This protects new failures and application responses, without rewriting historical rows.
- Older rows may still hold raw exception text in `AdminJob.error`, and so may backups. Erasure does not scrub that historical column.
- An operator must assess those records under their data-minimization and DSAR policy before making a separately reviewed cleanup. There is no automatic history deletion, and no retroactive claim that all stored copies are erased.
- Successful import row feedback continues to use the existing import-result scrubbing described below.

## Files left in storage

### Exports are invalidated first

- Erasure and removal logically invalidate every existing export of the event inside their database transaction (`invalidateEventExports`, called by `scrubAttendeeTraces`).
- The `result_json.invalidated` marker blocks download with `404 not_ready`, independently of physical deletion.
- Completed jobs keep their status, counts and file key. The key is cleared only after deletion succeeds, so cleanup remains retryable.
- A download checks again after storage IO, to detect invalidation during the read. A response that was already handed out cannot be recalled.
- API, bulk actions and CLI share this contract.
- Jobs created after the commit remain available. A repeated erasure that changes nobody leaves them alone.

### Which files are left

Two kinds of job leave a file in storage that holds attendees:

- An **export**: the CSV, XLSX or PDF of the attendee list (`AdminJob` of type `export`, the file at `storage_key`).
- An **import**: the staged CSV of an `import_commit` job. A commit that works deletes it at once, so what stays is the CSV of a job that failed or whose cleanup failed.

Both are copies of personal data that nothing reads once the job is done. The job row itself (counts, filename) is history. So only the file goes, and `storage_key` is cleared ([`purgeJobFiles.ts`](../../packages/storage/src/gc/purgeJobFiles.ts)).

A file has a life: it is written, then named on its job row (`storage_key`), then deleted. Everything below is about the three moments where it can be left with nobody who knows it:

- written but not yet named
- named by a row that is then deleted
- deleted by a step that fails

### Writing: a file is never left unnamed

**The export worker** (`drain-export-jobs.ts`) stores the file first and names it on the job afterwards. What makes sure of it:

- It records the key only on a job that is **still running** (`status: "running"` is in the `where` of the update).
- If recording fails, the worker takes the file back (`takeBackStoredFile`). Recording can fail because the row is gone (the event was deleted meanwhile), because the row was closed meanwhile (an erasure stopped the job, or it was reclaimed as stale), or because the write failed.
- If even that delete fails, nothing else knows of the file. So its key goes to stdout (`export_file_left_in_storage`, which is what Docker keeps; the System logs buffer lives in memory). When the row is still there, the key goes onto the row too, where the retention run of finished jobs tries again.
- The export is requested under the queue lock of the event (below).
- Marking a job failed does the same check. So a job that something else closed keeps its own error, and a row that is gone no longer aborts the rest of the queue.

**The import enqueue** (`import-api-routes.ts`) stages the CSV first and creates the job afterwards. What makes sure of it:

- The job is created under the queue lock of the event (below). So a job that is queued while an erasure is open waits for it, and starts from the list as it is afterwards.
- If the job cannot be created, the staged file is deleted at once. If that delete fails too, its key goes to stdout (`Import staged file left in storage`).

**The local storage adapter** also removes the partial file of a write that fails half way (a full disk). So `put` never leaves a truncated file at a key nobody received.

**A process killed between writing a file and recording it** still leaves a file that no row names. That covers an export file before its key is on the job, and the staged CSV of an import before its job exists.

- The export's job is failed as stale, and nothing in storage points at the file.
- A delete that failed after its row was gone leaves such a file too (`export_file_left_in_storage` with no row left, `Import staged file left in storage`, `event_job_files_purge_incomplete`).
- The purge of finished jobs, the purge after an erasure and the event deletion all find a file through a row, so none of them can reach it. The sweep of unnamed files does (the fourth step in the list below).
- The sweep deletes such a file once it is a day old. So a person who is erased while it exists stays in it until that run, at most about two days after the process was killed (a day of grace, then the next daily run).
- The erasure cannot do better: an unnamed file can be the staged CSV of an import that is queued behind the erasure and still needs it.

### Deleting: who removes a file, and when

Five steps delete job files.

#### 1. After an erasure or a removal commits

`purgeEventJobFilesBestEffort` ([`purge-export-files.ts`](../../apps/web/src/admin/purge-export-files.ts)) runs when at least one attendee was erased or removed. The CLI's `attendees erase` does the same.

What goes:

- The export files of the jobs the erasure saw, whatever their age.
- The staged CSV of those imports that have **finished**.
- The function is `purgeEventJobFiles`. It is given the ids of the jobs that held a file. `eraseAttendees` and `removeAttendees` read those ids at the end of their transaction, under the queue lock (`attendeeJobIdsWithFiles`). So an export that is requested a moment after the erasure, and finishes before the purge runs, keeps its file.
- Why: an export is cheap to run again, and the CSV of a finished import has no use.
- An import that was waiting or running is stopped by the erasure itself (step 2), which finishes its job, so its file goes too.
- An import queued after the erasure committed keeps its file, because it still needs it.

How it fails:

- It is best effort, like the wallet follow-up. The erasure never fails because of it.
- A file that cannot be deleted keeps its key. It is reported in the System logs (`job_file_purge_incomplete`, or `job_file_purge_failed` when the purge itself broke). The retention run (step 3) picks it up.
- A request that erased nobody new (a repeat, unknown ids) leaves the files alone.

#### 2. The erasure's own transaction

For the exports and imports that have not finished, `stopOpenAttendeeJobs` runs inside the erasure's own transaction. `scrubAttendeeTraces` calls it, so `eraseAttendees`, `removeAttendees` and every caller of them get it.

Why it is needed:

- Both kinds of job work from the list as it was before the erasure.
- An export that is being built has read its rows and is making a file that no job names yet, so the purge in step 1 cannot see it.
- An import creates people from a file that was uploaded before the erasure. Once the erasure has committed, the address of an erased person matches nobody, so the import would create the person again, with the same data.
- A job that is still waiting is no safer than one that runs. The worker can claim it and read while the erasure's transaction is open, and a read does not see what an open transaction has changed.

What it does:

- The erasure closes all of them in its own transaction: status `failed`, the reason in `error`, and the search text of an export scrubbed like for any failed export.
- The worker claims a job only while it is `pending`. An export records its file only while it is `running`. An import takes the row of its job as the first statement of the transaction in which it writes its people, and it writes nothing when the job is not `running` (`ImportStoppedError`).
- Each of these is one conditional update or one locked read. A statement that has to wait for the row the erasure holds checks the row again once the erasure commits, and finds it closed.

Lock order:

- The erasure takes the rows of the open jobs before it locks an attendee (`lockOpenAttendeeJobs`, as the first statement of `eraseAttendees` and `removeAttendees`, after the queue lock).
- So an import that is running is waited for (an erasure can wait as long as the import runs, within the statement limit of the database). Nothing is written by an import while an erasure of the event works. An import that would create somebody from an address the person had before cannot finish unseen.
- Every transaction takes these locks in the same order (the queue, the job rows, then the attendees, with the other locks of [Rules for code](#rules-for-code) in between), so the waits cannot end in a cycle.

A job that finished before:

- What it wrote is already committed, before the erasure began.
- An export has a key that the purge after the commit finds.
- An import has its people and its result, which the erasure then sees. An address that an import created is another attendee's address, and it is left alone like any other. The result is blanked by `scrubImportJobResults`, called after this step.
- The staged CSV of a stopped import is deleted by the same purge.

The queue lock covers a job that is being created:

- `lockAttendeeJobQueue` is taken exclusively as the first statement of `eraseAttendees` and `removeAttendees`. That is before any row is locked, so two erasures of one event run one after the other and cannot deadlock over rows they share, such as a resend delivery addressed to someone else's address.
- It is taken shared by the requests that create an export or an import job, in the transaction that inserts the job (`createUnderAttendeeJobQueueLock`, which allows it to wait for an open erasure for as long as the database allows a statement to run).
- A job that is being created is therefore either committed before the erasure looks (and stopped by it), or created after the erasure has committed.

A job created after the erasure:

- It is a new job. An export reads the list as it is then. An import adds back whoever its file lists, because nothing that identifies an erased person is kept.
- That includes an import whose upload began before the erasure and whose job was queued after it, and `import-attendees` on the command line, which has no job.
- The DSAR procedure says to remove the person from files that are still to be imported.

The scope and the price:

- The stop is for the whole event, whether or not the file of an import lists the person, because telling would mean reading every staged file inside the transaction. An import that was queued meanwhile for another reason is stopped too. An example is a removal with the reason `wrong_import` while the corrected file waits.
- The price: an export or an import that had not finished when someone was erased or removed fails, and has to be started again (an import without that person, if its file lists them).

Tests:

- The integration tests hold an erasure open and check the waits: the claim, the recording of an export's file, the end of an import, and both requests that create a job (`attendee-erase-api.test.ts`, `admin-import.test.ts`).

#### 3. The retention job

It runs in the worker at boot and about every 24 hours, and as `admitto retention run` (`--dry-run` only counts). The function is `purgeJobFilesForRetention` ([`retention-job-files.ts`](../../apps/cli/src/lib/retention-job-files.ts)).

What goes:

- The file of a finished export, 7 days after it finished (`EXPORT_FILE_RETENTION_DAYS`).
- The staged CSV of a finished import job, 7 days after it finished (`IMPORT_STAGED_FILE_RETENTION_DAYS`).
- A job that has not finished is never touched.

What it reports:

- The worker logs `export_files`, `staged_import_files`, `orphaned_job_files` (step 4) and `failed`. A non-zero `failed` raises the line to a warning.
- `retention run` writes the counts into its audit entry.

#### 4. The sweep of unnamed files

It runs right after the purge in step 3, by the same retention job and by `admitto retention run` (`--dry-run` only counts). The function is `sweepOrphanedJobFiles` ([`sweepOrphanedJobFiles.ts`](../../packages/storage/src/gc/sweepOrphanedJobFiles.ts)), called by `purgeJobFilesForRetention`.

What goes: every file that meets both conditions.

- It is in the job layout: `{org}/events/{event}/{uuid}` with `.csv`, `.xlsx` or `.pdf`, listed by `StorageAdapter.listJobFiles`. So a branding upload or any other file is never a candidate.
- **No job row names it** (`AdminJob.storage_key`, of any status, type or age), and it is **older than a day** (`ORPHANED_JOB_FILE_GRACE_HOURS`).

Why it is safe:

- A file is named a moment after it is written (the worker's update, the enqueue's insert, each cut off by the database after 30 seconds). So an unnamed file that is a day old has no live writer.
- It fails closed. The keys that jobs name are read before the listing, so a file written later is younger than the grace. The key is looked up again right before each delete, so a job that was given it meanwhile keeps its file.
- A file deleted here that was about to be named after all ends as a job whose file is gone. A download answers that with `404 not_ready`, an import fails on it, and the purge counts it as deleted (a missing file is not an error).
- It never touches a file that a job names, so the file of a job created after an erasure stays.
- It writes no job row and takes no lock, so the erasure's lock order ([Rules for code](#rules-for-code)) is unchanged.
- The erasure does not run it, for the reason given under "Writing" above.

Reporting:

- One line a run. The worker logs `orphaned_job_files` in its retention line, and `retention run` writes `orphanedJobFiles` into its audit entry. There is never one line per file (the worker's relay to the System logs takes 120 a minute).
- A file that cannot be deleted, or a sweep that breaks (the upload directory cannot be read), counts in `failed`, so the line becomes a warning. The other retention steps still run.

The assumption:

- The sweep assumes that the upload directory belongs to this database alone. Another instance with its own database on the same directory, or a restore of an older database next to newer files, would show it files that nobody names.

#### 5. An event is deleted for good

`deleteEvent` ([`event-deletion.ts`](../../apps/web/src/admin/event-deletion.ts), Superadmin only) deletes every file that the event's jobs left, whatever the job's type or status (`deleteEventJobFilesBestEffort`, then `deleteStoredFiles`).

Why it needs care: jobs are not a deletion blocker, and they cascade away with the event. With them goes the only record of the keys, which the retention run reads.

So the transaction does this, in order:

1. It takes the queue lock exclusively. No job can be created until it ends, so none appears behind the read of the rows.
2. It locks the rows of the event's jobs. An import holds its job row for the whole of its transaction and then needs the event row for the people it inserts. So the deletion takes the two in the same order and waits for a running import, whose people then make the event undeletable.
3. It takes the registration queue of the event (`lockRegistrationQueue`). A transaction that is changing a registration (an admission) holds the registration and then needs a share of the event row for the attendee it inserts. So the deletion waits for it before the event row, and that attendee then makes the event undeletable.
4. It locks the event row. A job that is being created for the event holds a share of it through its foreign key. So the deletion waits for that job and deletes it with the rest, and a job that starts later finds the event gone and deletes its own file.
5. It deletes the jobs with `RETURNING "storage_key"` (exactly the rows that went, as of the moment they went).
6. It writes those keys into its audit entry (`jobFileKeys`: a key is organisation, event and a random name, no personal data).

The guest registrations of the event and their queued mail go with it (cascade). They do not keep an event from being deleted. The audit entry says how many went (`registrationsDeleted`, `registrationMailsDeleted`, counts only, and only when there were any).

After the commit, the files are deleted.

Failures:

- It is best effort. A failure never undoes the deletion.
- Every key that could not be deleted is logged, all of them with no cap, on stdout as well as in the System logs: `event_job_files_purge_incomplete`, or `event_job_files_purge_failed` when the cleanup itself broke.
- No row is left to retry from. So the log line and the audit entry are the only records of a file that stays. A process killed between the commit and the deletes loses nothing, because the audit entry holds every key.
- A refused deletion (409) leaves the files alone.
- An export that is running when its event is deleted is the writer's case above.

### Downloads and what is not covered

A download that has read the job just before its file is deleted (an erasure, the retention run, an event deletion) answers `404 not_ready`, the same as a job whose file is already gone. `handleDownloadExportJob` maps the storage's `not_found` and nothing else, so any other storage error is still a server error.

What this does not cover:

- The time a file that nobody names stays (a day of grace, then the next retention run), which nothing shortens.
- A file outside the job layout, which the sweep never touches on purpose. The managed-upload sweep (`admitto storage gc`) ignores `.csv`, `.xlsx` and `.pdf` for the same reason: they are not branding uploads.

## Passes still at the provider

`sweepErasedWalletPasses` ([`retention-erased-wallet-passes.ts`](../../apps/cli/src/lib/retention-erased-wallet-passes.ts)) retries what the erase API could not finish.

**Which passes it retries.** A pass of an erased attendee in either of these cases:

- Its `left_behind_pass_id` is set. That counts whatever else is on the row, even when the recorded pass was removed ([A pass whose provider id was never saved](#a-pass-whose-provider-id-was-never-saved)).
- It is not marked removed (`provider_removed_at`) and it has one of these:
  - the provider's id on its row;
  - only the id reserved for it;
  - a failed creation.

One question says which (`erasedPassToDeleteWhere`, and `passIsStillToDelete` for a row already read, in [`erase-wallet-passes.ts`](../../packages/tickets/src/erase-wallet-passes.ts)). The erase API, the command and the sweep all share it.

**When it runs.** In the worker's retention job (at boot and about every 24 hours) and in `admitto retention run` (`--dry-run` only counts).

**What it does.**

- It finds the events that have such passes.
- It resolves each event's provider from its credentials alone (whatever the Wallet switch says).
- It hands the passes to `deleteErasedWalletPasses`, a page of 100 at a time in attendee id order.
- That function only touches passes of erased attendees of the event it is given. A pass that is already gone at the provider counts as deleted.
- It goes by attendee id, which is what lets a run know exactly which passes it got to.

**The time budget.**

- One run spends at most 60 seconds at the provider.
- The walk over the pending passes may use only five sixths of that. The rest, and whatever the walk leaves, is the second look's (see below).

**The cursor.** When the budget is not enough, the run keeps the place where it stopped (the last pass it tried, in `SystemSettings`, key `retention.erased_wallet_sweep_cursor`).

- The next run goes on after it, to the end and then from the beginning up to that place. So a pass that keeps failing, or a long run of passes at the start, cannot keep the rest, and the events after them, from ever being tried.
- A run that gets through everything forgets the place.
- A dry run neither reads nor writes it.

**The counts of a run**

| Count | Meaning |
|---|---|
| `deleted` | Deleted at the provider (or already gone) and marked as removed. |
| `failed` | The provider refused or could not be reached. The log line is described below the table. |
| `noProvider` | The event has no usable wallet credentials (none, or the key cannot be read), so nothing was tried. Each such event is logged as `wallet_pass_erasure_no_provider` with its id and the number of passes that wait, which is how an operator finds the event whose credentials need fixing. |
| `undecided` | The provider has none under the reserved id, but a creation may still be on its way: the erasure is younger than 10 minutes, or (a recorded pass) so is the creation that recorded it. The row stays marked "still to delete" and the next sweep asks again. |
| `notTried` | The time budget ran out first. |

**The `failed` log line.** One line per event and run is logged as `wallet_pass_erasure_delete_failed`.

- It carries the event id, how many failed (`failed`), the failure codes and the first 15 attendee ids (`attendeeIds`, pseudonyms once the person is erased). `more` says how many are not named.
- It is not one line per pass. The worker relays every line to the app in a request of its own, and that endpoint takes 120 a minute. So a revoked key with hundreds of passes would push the later lines and the summary of the run out.

**Reporting**

- The worker's retention line carries `erased_wallet_passes` (the deleted ones) and counts the others in `failed=`. So any pass that stays raises the line to a warning, every day until it is dealt with (fix the credentials, or delete the pass in the provider's own console).
- `retention run` writes `erasedWalletPassesDeleted` and `erasedWalletPassesLeft` into its audit entry.
- The command is not the worker. So the lines of the failures (`wallet_pass_erasure_delete_failed`, `wallet_pass_erasure_no_provider`) are printed by the command itself, above its summary. They do not reach the System logs panel (only the worker relays its lines there).

### A pass whose provider id was never saved

#### The problem

A request that creates a pass at the provider can fail to save its row afterwards. The causes:

- the database failed
- the event's Template ID changed meanwhile (`markActive` refuses to keep the result)
- the process died

For an erased attendee, the failure marker is skipped as well. So nothing in the database said that a pass existed, and no retry above looked for it. The pass stayed at the provider with the person's name on it.

The provider can also hold a second pass beside the recorded one. Its uniqueness check on the id is not strict under concurrent creations (two taps at once can both succeed, observed live), and the row has room for one provider id.

#### Reserving the id first

`handleWalletRedirect` therefore writes the id that the pass will get at the provider (`user_provided_id`, `admitto:<event id>:<attendee id>`, built by `walletUserProvidedId`) on the attendee's pass row **before** it calls the provider.

- That is `reservePassId`. It works under the attendee's row lock, and it creates a `pending` row when there is none.
- Nothing is sent for an attendee who is erased or removed, or when the row cannot be written.

An erasure keeps the row. So a row that holds that id and no provider id is the marker: a pass may exist that its request could not record.

A `failed` row with no id at all counts too. It was written before ids were reserved, by a request whose pass may still have been made (a timeout, or a result that request dropped).

#### How the follow-up finds the pass

The follow-up (`deleteErasedWalletPasses`) does two things for each row:

1. It deletes a recorded pass by its own id.
2. It then asks the provider, for **every** row, for the id reserved for it, and deletes whatever the provider holds under that id (`deletePassesUnder`), until it has none. At most 5 passes are deleted. After that the row fails with `wallet_provider_rejected` and stays still to delete.

That is how an unrecorded pass is found, and a second pass beside a recorded one.

How the client reads the id:

- PassCreator's v3 delete takes the provider's id only, and it would answer 404 (which counts as deleted) for anything else.
- So the client reads the id through the v1 path `GET /api/pass/{id}`. That path takes a UID, a userProvidedId or a barcode value, and it answers from the provider's own record of the id. A 404 ("there is none") is an answer, and a pass is found.
- That path also matches a pass that merely has the string as its barcode value (an agency's `qr_payload` is kept as it was sent). So a pass is deleted only when its own `userProvidedId` is the id asked for, and then by its UID with the v3 delete.
- Any other pass that the id resolves to is left alone, and the call fails with `wallet_provider_rejected`. The row stays "still to delete" until someone deals with that pass in the provider's console.

Why not a search by the id: it is scoped to the event's current template (a pass made under the old one is not in it), it can lag, and a miss proves nothing.

The cost is one read for every pass that is deleted. A creation that really started is the only thing that makes a row an unrecorded one, so a bulk erase of 500 people who never tapped Add to Wallet makes no call for them.

#### When "none" is not final

A "none" is not final right after an erasure or a creation. The reasons:

- A request that was creating the pass when the person was erased does not stop when the erasure commits. So the provider can still finish that pass after the follow-up asked.
- When the request dies or times out, nothing on its side clears anything.

The rule: the follow-up marks a row removed on "none" only when nothing can still be on its way. That means:

- the erasure is at least `CREATION_SETTLE_WINDOW_MS` old, or
- for a recorded pass, the creation that recorded it is at least that old too (`issued_at`). A creation that overlapped it and was given up on lands within the same window after it. So a person who is erased long after they got their pass is settled at once.

The window is 10 minutes. It is a bound that has to cover:

- the erasure's own transaction (`ERASE_TRANSACTION_TIMEOUT_MS`, 60 s: `erased_at` is Postgres's `NOW()`, the moment it started)
- the 2 minutes `CREATE_PASS_DEADLINE_MS` that a creation may still send in after the check that the attendee was not erased (`reservePassId` hands that moment to `createPass`, and to the `updatePass` of a duplicate recovery, as `checkedAt`, whatever the request waited for in the pacing gate or the retry backoff and however long the process was paused)
- the client's 15 s request timeout
- five more minutes for the provider's own lag and for clocks

A test adds them up.

Before the window ends:

- The row is left as it is (`undecided`). It still counts as "still to delete" in `wallet_pending`, the **Personal data erased** dialog and exit code 2.
- The next run (**Try again**, the command again, or the daily sweep) asks again.
- An unrecorded pass that was found is deleted and its row marked at once, at any age (the second look below asks again).

A request that finishes late:

- Should a request finish after the follow-up settled its row, it finds the attendee erased. It gives the row the provider's id **and clears `provider_removed_at`**, and it deletes the pass (`deleteOrphanPassOfGoneAttendee`).
- It leaves the row for the follow-up, which settles it by the rule above, because another creation of the same attendee may still be on its way.

#### A pass made under other credentials

The case: an admin changes the Template ID (and may replace the API key with one of another PassCreator account) while a pass is being made.

- The follow-up asks the account the event uses now. So it could not find that pass, and a "none" from there would say nothing about the account the pass is in.

What the creating request does:

- It still holds the client it made the pass with. So `markActive` in `handleWalletRedirect` deletes the pass there at once (`dropPassMadeUnderChangedCredentials`) and keeps nothing on the row.
- Only when that delete fails does it write the pass's provider id into `left_behind_pass_id` on the row. It also writes `wallet_credential_changed` into `last_error_code`, which is what the attendee's page shows.
- It also writes `wallet_pass_changed_credentials_delete_failed`, with the ids, to stdout and the System logs.
- When even the column cannot be written, it writes `wallet_pass_left_behind_not_recorded`. That line is then the only record of the pass id, so it is worth keeping (the System logs alone are memory only).

The column is the durable marker:

- The next tap, which makes a pass under the new credentials, clears the code (`markActive` writes `last_error_code: null`).
- Nothing in Admitto clears the column: not a creation, a failure, a sync, an erasure or the removal of the recorded pass.
- The request whose attendee was erased meanwhile (`deleteOrphanPassOfGoneAttendee`) writes the column the same way when its delete fails and the event's Template ID or API key is no longer the one it made the pass under. (The settings guard checks a new key against the template only once a pass is issued, so the key alone can move an event to another account until then.)

How other actions treat the mark:

- **Delete wallet pass**, single and bulk, replaces the row it deletes by one that holds the column alone (status `pending`, no ids) when the column is set, so that the mark outlives it. The attendee then reads **Pending** until they add the pass again.
- **Remove from event** deletes the row with the attendee, and with it the mark. So do not use it for such a person before the pass is dealt with. The stdout line above is then all that is left, and nothing at all for a row that the migration marked `unknown`.

The migration:

- The migration `20261015100000_backfill_wallet_pass_left_behind_pass_id` gave the column the value `unknown` for every row that was marked `wallet_credential_changed` before the column existed. Such a pass was left where it was made.
- A row whose code a later tap had cleared or overwritten already cannot be recognised.

What the follow-up does while the column is set:

- It never marks the row removed, whatever the age of the erasure and whatever the account it asks answers (found or none). Nothing it can see says which account a pass is in.
- The row stays "still to delete" even if something else (the admin action that removes a voided pass from the provider) marks the recorded pass removed.
- It still deletes what the account the event uses now holds under the reserved id.
- It reports the row as failed with `wallet_credential_changed`, so the person stays "still to delete" in `wallet_pending`, the dialog and the exit code.

To close such a row:

1. Delete any pass with that User provided ID (`admitto:<event id>:<attendee id>`) in the PassCreator account the event used before.
2. Clear the marker with `UPDATE "WalletPass" SET left_behind_pass_id = NULL WHERE attendee_id = '<attendee id>'`. This is for a person who runs the database, and only after the pass is gone: nothing else will look.
3. Run the erasure again. The follow-up then settles the row by the usual rule.

Putting the earlier Template ID and API key back does not close the row by itself, because Admitto cannot tell that the pass it finds is the one that was left.

#### A second look

"There is none" is an answer about one moment. Nothing inside one process can rule out that a creation reaches the provider after it. Examples: a process paused after its last check and before its send, a provider that lags behind its own record, a clock that is off.

So an unrecorded pass whose row was marked removed is not forgotten.

- For `SETTLED_RECHECK_HORIZON_MS` (7 days) after it was marked, the daily sweep asks the provider for its reserved id again, and it deletes what has turned up since.
- The functions are `recheckSettledWalletPassesOfEvents` in `apps/cli/src/lib/retention-settled-wallet-passes.ts`, over `recheckSettledWalletPasses`.
- The order is event id and attendee id, with up to 1000 rows per event and call.
- It runs after the walk over the pending passes. It gets the sixth of the time that the walk leaves alone for it, and whatever the walk does not use. So a backlog of passes that keep failing (a pass left in another account among them) cannot starve it.

The cursor:

- A run that is cut short, by the time or by a full page, keeps the place where it stopped (the SystemSettings row `retention.settled_wallet_recheck_cursor`).
- The next run goes on after it and wraps round, the way the walk over the pending passes does. So a big erasure is covered over several days, and its first rows are not asked about again and again while the rest of the week passes.
- A run that gets through everything forgets the place.

What it changes: nothing is written. The dialog, the command and the counts do not change. The row stays marked removed.

What it logs, all in **System logs**:

- `wallet_pass_found_after_settling` (a warning, with the event id and how many): a pass was found this way. It means that an earlier answer of "none" came too early.
- `wallet_pass_recheck_failed`: a provider that could not answer.
- `wallet_pass_recheck_no_provider`: an event whose credentials are missing or cannot be read. It carries the event id and how many settled rows it leaves unasked, once per run, until the credentials are back or the rows leave the week. The walk over pending passes reports only events that have pending passes, so nothing else says it.
- `wallet_pass_recheck_incomplete`: a call that was cut short. The next run goes on after the place it kept.
- Events that a run did not reach for lack of time are not named. The next run goes on after the place it kept.

A recorded pass is not looked at again. It relies on the rule above (asking about every person that was ever erased would cost a call a day for a week for each of them).

#### Passes that Admitto had no record of

The follow-up says when it found a pass that Admitto had no record of.

- The line is `wallet_pass_untracked_deleted` (a warning with the event id and how many).
- It is one line per event and run of the sweep, and one per erase request. The command prints one line.
- It is a warning because it means a request could not record its pass, or that a second pass was made.

#### What this design relies on, and cannot enforce inside one process

Check these before a release and when the provider changes:

- **PassCreator's v1 read `GET /api/pass/{id}`:**
  - It resolves a userProvidedId from the provider's own record (not a lagging index).
  - It answers 404 only when there is no such pass.
  - It returns the same `identifier` that the v3 delete takes.
  - This is taken from PassCreator's documentation and has not been confirmed on a live account (the two `curl` checks are in the pull request).
  - If it does not match the id at all, or answers 404 for the route itself (a proxy that only forwards `/api/v3`), the follow-up reports success without having looked.
  - `PASSCREATOR_BASE_URL` has to be the same for every service that talks to the provider (the app, the worker and the command all read it).
- **Clocks.** The hosts' clocks agree with Postgres to within the margin above, and the web host's wall clock does not stall or jump back between the check and the send.
- **No pause.** Nothing pauses the process between its last deadline check and the write to the socket. (A late send then is found by the second look, for an unrecorded pass.)
- **The right account.** The event's credentials point at the account each pass was made in.
  - A pass made by a request that died, or lost the provider's answer, in an account the event no longer uses is not found.
  - The row says so (`left_behind_pass_id`) only when the request noticed the change and could not delete the pass.
  - A Template ID change is refused once a pass is issued, and a new API key is checked against the template once a pass is issued. So this needs the account to be replaced before the first pass is.
  - A request notices a changed Template ID in `markActive`, and a changed key only in the case of an attendee erased meanwhile.

#### How Remove from event differs

**Remove from event** deletes the row together with the attendee. So it asks about these rows before it does, and again after the commit ([Removing an attendee](#removing-an-attendee)). What it still could not delete is in the one line it logs.

- It cannot do what needs a row to come back to.
- Its "none" is final at once. A request that was creating the pass deletes its own pass when it finds the attendee gone (`deleteOrphanPassOfGoneAttendee`). One that dies in that gap leaves the pass at the provider. Only a request that began less than 2 minutes ago can still send one: `createPass` sends nothing later than `CREATE_PASS_DEADLINE_MS` after the check that the attendee was not erased.
- That holds also for a row with `left_behind_pass_id` set, whose pass may be in an account the event no longer uses. An erasure keeps such a person as still to delete for good. A removal deletes the row and the mark with it, and asks only the account the event uses now (which has none), so that pass is not found.
- It does not look for a second pass under the reserved id beside a recorded one, which the follow-up of an erasure does (two creations at once can both succeed). For an unrecorded pass it empties the id. For a recorded one, that would be a second provider call for every recorded pass, which the budget of a removal does not allow.

#### Not covered

A pass whose request left no trace on the row at all. Only a request from before ids were reserved can: its process died, or its database failed, with nothing written. This holds for an erased attendee and for a removed one alike. Delete such a pass in the provider's own console, by its User provided ID.

## Rules for code

- **New column or table on an attendee?**
  - `packages/tickets/test/erasure-inventory.test.ts` fails until you decide what erasure does with it (cleared, kept, deleted).
  - Add the behaviour to `eraseAttendees` and its test too.
- **A guest's registration is personal data too.**
  - A `Registration` (the form submission) holds the name, address, answers and a companion of a person who may never become an attendee, and of an accepted one it keeps a copy after the attendee is erased.
  - The inventory records `deleted` for every column, and `attendee_id` is a real relation so that the test finds the table. Whatever erases or removes an attendee must delete the registration as well: the one linked by `attendee_id`, and the ones in the same event with one of the person's addresses (`collectAttendeeAddresses`, see "How an address is matched" below).
  - A registration that another attendee was accepted from is that attendee's, even with the same address (two attendees can hold one address in two spellings). It goes when that attendee is erased or removed.
  - `RegistrationMail` has no address or text of its own and goes with its registration (cascade).
  - Staff delete a registration with `deleteRegistrations` ([Deleting a guest registration](#deleting-a-guest-registration)). An accepted one erases its attendee with `eraseAttendees`. Never delete an accepted registration on its own: the attendee would keep the person's data.
  - A new column on `Registration` gets its decision in the same pull request.
- **A companion (+1) is attendee data too.**
  - An `AttendeeCompanion` is a guest's companion: a third party with no ticket, who holds a name and the answers to the event's companion questions. The inventory records `placeholder` for the name and `cleared` for the answers. The row **stays**: `eraseAttendees` empties it (`ERASED_COMPANION_NAME`, no answers) and never deletes it, and Remove from event deletes the rows by cascade.
  - **The seat goes with the attendee.** A companion holds a seat only while its attendee is active (`activeAttendeeWhere`: status outside `revoked` and `cancelled`). So erasing someone who was not admitted cancels them and frees both seats, and erasing someone who was admitted frees none, because the status and the row stay. `countSeatsInUse` is the one count of seats (the active attendees plus their companions, in one statement), and `countActiveAttendees` the one count of heads. The rule of "active" is written twice, as the Prisma where-clause and as the SQL of the seat count, from one list of statuses (`CAPACITY_EXCLUDED_STATUSES`); `attendee-companion-seats.test.ts` pins the two to each other for every status.
  - **Three functions write the table, and the erasure empties it; no other code touches it.**
    - `createAttendeeFromRegistration` writes the companions of a registration when it makes the attendee, in the transaction that counted the seats for them under the capacity lock and the registration queue. `seatsNeeded` and the rows it writes both come from `readRegistrationCompanions`, so the seats a guest was given are the rows they get.
    - `writeAttendeeCompanion` and `removeAttendeeCompanion` are for staff (the routes are in "The staff routes of a companion" below). Both refuse an attendee who is gone (`isAttendeeGone`), so a write that waits for an erasure finds the attendee erased and writes nothing, and an erasure that waits for a write empties what the write wrote.
      - `writeAttendeeCompanion` takes `lockAttendeeRow` as its first statement and no other lock. It leaves the registration alone.
      - `removeAttendeeCompanion` takes the registration queue first and `lockAttendeeRow` second, because it also clears the copy in the registration (below). The queue is step 5 of the order and the row is step 6, and a transaction that holds an attendee row must never wait for the queue. The attendee row is still the first statement that reads or writes anything of the attendee. It takes no capacity lock: it takes no seat, and the seat it frees is freed under the attendee's row, as in an erasure.
    - They never add a companion, because a companion takes a seat. To add one, take the capacity lock and count the seats first, in the order of locks below.
  - **The registration keeps what the guest submitted.** The accepted registration holds the companion as the form sent it (`Registration.companions`), as it holds the guest's own answers, and an edit by staff does not change that copy: it changes the attendee's companion only. The copy goes with the registration, when an erasure or a removal of the attendee deletes it, or when staff delete the registration. It also goes when staff remove the companion (next point).
  - **Removing the companion clears the copy.** Removing a companion is a privacy action: the person's name and answers are to be gone, and the request window would otherwise go on showing a person the guest no longer brings. `removeAttendeeCompanion` deletes the row and, in the same transaction and under the registration queue, drops from `Registration.companions` of the registration the attendee was accepted from (`attendee_id`) the entry the row was written from. Slot n is the n-th entry that `readRegistrationCompanions` reads, so `withoutSlot` counts the entries shaped like a companion and keeps any other entry as it is. An attendee with no registration (added by hand or imported) has no copy to clear. A removal that finds no row (`no_companion`) clears nothing.
  - **Who writes the copy.** A guest's submission does: `placeRegistration` stores `RegistrantSubmission.companions` as `Registration.companions`, after the route's boundary (`registrantNameSchema` for the name, `buildRegistrantCustomData(..., "companion")` for the answers) and only after it has counted the seats of the guest and each companion and has refused more than the event takes, under the capacity lock and the registration queue. It stores what `readRegistrationCompanions` reads of the list, so the seats are the rows. Only `removeAttendeeCompanion` takes an entry out of it. No other code writes the column; a new writer goes through the same boundary and the same count.
  - **The staff routes of a companion.** `PATCH` and `DELETE /api/admin/events/:eventId/attendees/:id/companion` (`attendee-companion-routes.ts`) are for an Administrator of the organisation and a Superadmin, behind the cross-site check and the archived-event guard (403 `event_archived`; unlike an erasure, they do not work on an archived event). `PATCH` takes exactly `{ name, custom_data }` and passes both to `writeAttendeeCompanion`, so the rules are the ones of the registration form; `DELETE` takes no body. An erased attendee answers 409 `attendee_erased`, a guest with no companion 404 `companion_not_found`, and neither route ever adds one. Each writes `attendee_companion_updated` or `attendee_companion_removed` to the attendee's activity log and to the central audit log in the same transaction, with the event, the attendee's id, the slot and, for a removal, `seats_freed: 1`; the name and the answers are in no entry, no log line and no answer, also when the request fails. The budget is the one of editing the attendee (`admin:attendee-patch`).
  - **How many companions** is `MAX_COMPANION_SLOTS` in `@admitto/tickets` (1 in 0.8) and nothing else: not the table, not the registration. What an event takes is its `max_companions` read through `allowedCompanions`, which never gives more than that number; the page, the route and the placement all read it there.
  - **A question about a companion** is an `EventCustomField` with `applies_to = 'companion'`. Its answer goes to `AttendeeCompanion.custom_data`, never to `Attendee.custom_data`, so every reader of an attendee's own answers reads the guest's fields only. `loadEventCustomDataFields(db, eventId)` defaults to `guest`. The readers that query the registry themselves (the Attendees list's filters, the custom fields report and its export) filter on `applies_to: "guest"`. A new reader of an attendee's answers does the same.
  - **Restoring an attendee** to an active status needs a seat for each (`countSeatsOfAttendee` in `guardPatchCapacityRestore`, under the capacity lock), and says so in places.
  - **The operator's card shows the companion's name.** The check-in card (`getAttendeeCard`) puts it first in the hint of an item for guests with a companion, because an operator has to know whom they welcome. The card of an erased attendee is refused, as it is for any item, so the placeholder (`ERASED_COMPANION_NAME`) never reaches the door; the attendee page, the Reports log and the exports do not carry the name.
  - **Which items a guest is offered** depends on whether they have a companion row (`itemAppliesToAttendee` in [`item-audience.ts`](../../packages/tickets/src/item-audience.ts)), which an erased attendee keeps. Every reader of an attendee's items applies that one rule; `item-audience.test.ts` fails for a new reader of the item tables that does not.
  - **People on site** are the admitted heads plus `countCompanionsIssued`: the "companion" item issued, to an active and admitted attendee who still has a companion row. A companion staff removed, and one of an attendee who was cancelled or whose check-in was undone, are not counted.
  - Never put a companion's name or answer in a log, an error or an audit entry. Ids and counts only.
  - Tests: `companion-item.test.ts` (the item, who is offered it, and the count of the companions let in), `registration-placement-companions.test.ts` (what a submission stores, the seats of a couple in every mode, the refusal under the locks, and couples racing for the last seats), `apps/web/test/integration/registration-submit-companion.test.ts` (the route: the one answer for every address with or without a companion, the bodies it refuses, and a scan of the logs for the companion's name), `attendee-companion-erasure.test.ts` (the seats of an erasure, a removal and a deleted registration, a scan of the whole database for the companion's name, and the copy cleared when staff remove only the companion), `attendee-companion-write.test.ts` (the boundary, the order of the locks of an edit and of a removal, and each side first against an open erasure, removal or deletion of the registration), `apps/web/test/integration/attendee-companion-routes.test.ts` (the staff routes: roles, the cross-site check, the archived event, an erased attendee, the bodies they refuse, an erasure that is open, the audit entries, and a scan of the logs and the answers for the companion's name, also when a request fails), `attendee-companion-seats.test.ts`, `registration-concurrency.test.ts` and `apps/web/test/integration/shared-event-capacity.test.ts` (the last seats).
- **Taking locks: one order.**
  - A transaction that takes several of these locks takes them in this order. A step it does not need is skipped, never taken later.
    1. The attendee job queue of the event (`lockAttendeeJobQueue`). An event deletion takes `lockEventForScopedWrite` before it.
    2. The rows of the event's open export and import jobs (`lockOpenAttendeeJobs`). An import holds its own job row.
    3. The ticket-type catalog of the event (`acquireEventTicketTypesLock`).
    4. The capacity of the event (`acquireEventCapacityLock`). In `runEventCapacityTransaction`, take the registration queue at the start of `work`, never in `prepare`: `prepare` runs before the capacity lock.
    5. The registration queue of the event (`lockRegistrationQueue`, [`registration-lock.ts`](../../packages/tickets/src/registration-lock.ts)).
    6. Rows: the event row (an event deletion), registrations before their mail, attendees in id order, and then what belongs to an attendee (deliveries, the wallet pass, check-ins).
  - One known exception, which cannot close a cycle: at its end an erasure or a removal updates the rows of finished exports and imports (`invalidateEventExports`, `scrubImportJobResults`), after its attendees. Their other writers are single statements, or an event deletion, which takes the job queue exclusively first, as the erasure does.
  - Who takes the registration queue:
    - an erasure and a removal, right after the job locks (`scrubAttendeeTraces` takes it again before it deletes registrations, only so that the delete never runs without it)
    - the deletion of an event, before the event row
    - every transaction that inserts, changes or deletes a `Registration` or `RegistrationMail` row: a submission (`placeRegistration`), a confirmation (`confirmRegistrationAddress`), an admission (`admitRegistrations`) or a rejection (`rejectRegistrations`), staff sending a failed mail again (`retryRegistrationMails`), a deletion by staff, the removal of a companion by staff (`removeAttendeeCompanion`, which clears the companion's copy in the registration), the clean-up of expired ones
    - the last check before a registration mail is sent, in a short transaction of its own, never held across the send (`checkRegistrationMailBeforeSend`, called by `drainRegistrationMails` in `@admitto/mail-delivery`)
  - The write of a send's result does not take it. It is one conditional update of the mail's own row, waits for nothing else, and finds no row when the registration went meanwhile.
  - A request that must not wait with a pooled connection (a guest's submission) uses `tryLockRegistrationQueue`, the same key without waiting, in the same place of the order. On `false` it ends its transaction and tries again later.
  - Where the writers of registrations in `packages/tickets` stand in that order:
    - `admitRegistrations` (staff, may wait): the capacity lock (`runEventCapacityTransaction`), the registration queue at the start of `work`, the registration rows in id order (`lockRegistrationsForUpdate`), then the attendees it inserts. It takes the capacity lock because it takes seats; the state of each row and the seats are read again under both, and a request that needs more seats than are free changes nothing.
    - `deleteRegistrations` (staff, may wait): the jobs of the event, the registration queue, the registration rows in id order, then the attendees of the accepted ones, in `eraseAttendees`. The jobs come first although most deletions erase nobody, because a row can turn out to be accepted only under the queue. No capacity lock: it takes no seat.
    - `placeRegistration` and `confirmRegistrationAddress` (a guest, never waits): the same order with both locks taken by trying (`runEventCapacityTransaction` with `tryLock`, `tryAcquireEventCapacityLock`, then `tryLockRegistrationQueue`) inside `runPublicWrite`. It ends the transaction when a lock is held, pauses without a connection, lets only a few writes try at once in a process, and answers busy after about two seconds, with nothing written. A submission takes the capacity lock even when it only stores a registration that waits for its address: one path, and the room for the guest is read under it. A submission for an address whose registration still waits for its address also puts the row of the confirmation mail back in the queue (`requeueMailForMoment`, with `queuedAgain`, the reset that staff's retry uses too), under the same two locks: it writes a `RegistrationMail` row, and nothing of the registration.
    - `rejectRegistrations` (staff, may wait): the registration queue, then the rows. No capacity lock: it neither takes nor frees a seat.
    - `removeAttendeeCompanion` (staff, may wait): the registration queue, then the attendee's row (`lockAttendeeRow`), then the companion's row and the registration row it clears. No capacity lock: it takes no seat.
    - `retryRegistrationMails` (staff, may wait): the registration queue, then the `RegistrationMail` rows it resets to `queued`. No capacity lock, and no `Registration` row: it neither takes a seat nor changes a state. An erasure or a deletion that came first has deleted the registration with its mail, and the retry answers `gone`.
  - **Read the clock under the locks.** A rule that depends on the time (a link that runs out, the end of the event) is judged by the clock read inside the transaction once the locks are held, on every try, and again after a call over the network. A guest's write may wait for a permit and, between tries, for a lock, so the time the request came in is not the time it is judged. `placeRegistration` and `confirmRegistrationAddress` do it; the tests hold the capacity lock, fake only `Date`, move it past the expiry or the end of the event, and let go (`registration-concurrency.test.ts`).
  - **The save of an event's registration settings** (`updateEventRegistrationSettings`, staff, may wait) takes neither the capacity lock nor the registration queue: it takes no seat and changes no registration, so it neither waits for an import or an erasure nor holds one up.
    - It takes two locks of its own, in this order: the questions of the event (`acquireEventCustomFieldsLock`) and then its legal texts (`acquireEventLegalDocumentsLock`, through `lockAndLoadLegalGateRows`). Then it reads the event, the settings row, the texts and the questions, and writes the row. The clock that judges the end of the event is read after both locks are held.
    - No other transaction takes both, and none takes either together with one of the six above, so they cannot close a cycle with them. Two saves wait for each other on them, so each reads what the other left (a save that turns registration on and one that changes the way in cannot both pass the gate on an event that is off).
    - The writers of the other side wait for the save and then find what it left: a question saved after registration is on is refused when the form would not ask it (`assertRequiredFieldStaysOnForm` reads the mode under the questions lock), and a text that registration needs is not withdrawn (`registrationNeedsLegalDocument` reads the mode and the consents under the texts lock).
    - The password routes (`.../registration/password`) take no lock. They write one column of the same row. The save clears that column, when the way in moves away from the password, in the one statement that writes the other columns, and reads whether it is set with a count, never the hash itself.
  - Why one lock for the whole event: an erasure finds a person's registrations by the addresses on their attendee row, which it can trust only once it holds that row (an edit can change an address until then). An admission locks a registration first and writes the attendee afterwards. Rows taken in those two orders deadlock, and for an action under the GDPR that is a server error. Under the lock, one such transaction of the event runs at a time.
  - Never take it while you hold an event, attendee or registration row (step 6). It would wait for an erasure that waits for that row.
  - So the clean-up of expired registrations (`sweepExpiredRegistrations`, run by the worker job `registration_mail`) locks no row before the lock (not even with `FOR UPDATE SKIP LOCKED`). It reads the events that have expired ones with a plain query. Then, one transaction per event and batch, it takes the lock and deletes them with the expiry checked again. A transaction that covers several events takes their locks in the order of their ids.
  - Tests: `registration-erasure.test.ts` (two transactions, each side first, and the send of a mail), `registration-concurrency.test.ts` (an admission and an erasure of one address, each side first; an admission and a writer that holds the capacity lock, as an import does; the try of the locks, and twenty guests behind a long import; the clock of a confirmation; the same link followed several times at once; a confirmation and a re-send of its link, each side first, and a rejection), `registration-mail-retry.test.ts` (a retry against a deletion, each side first, and two retries at once), `event-deletion.test.ts` for the deletion of an event, `apps/web/test/integration/registration-submit-concurrency.test.ts` for the route a guest sends the form to (the same address sent at once, and an import that holds the lock), and `apps/web/test/integration/registration-confirm-route.test.ts` for the link in the confirmation mail (a double click, an import that holds the lock, an erased guest). In `packages/mail-delivery/test`: `registration-mail-erasure.test.ts` (the drain against an open erasure or removal, and a send that holds no lock) and `registration-mail-sweep.test.ts` (the clean-up and the queue). For the save of the registration settings, `apps/web/test/integration/event-registration-settings-concurrency.test.ts` (a second save, a text withdrawn, a question saved, an import, an erasure, the clock, and a guest on the way when registration is turned off).
- **A legal text is not attendee data.**
  - A `LegalDocument` (an event's privacy notice, terms and extra consents) has no `attendee_id`, so the inventory test does not list it and erasure does not touch it.
  - Keep it that way. A text is written once for the event, never per guest, and holds no guest's name or address (no placeholders are filled in). A registration records only when the terms were accepted, not which text.
  - It goes with its event (cascade). `updated_by` is a staff user id, like `AdminAuditLog.actor_user_id`.
- **Never reuse an erased row.**
  - `erased_at` is the marker. `status` is not (it drives capacity and issuing).
  - Code that sends, issues, edits or checks in an attendee must refuse an erased one.
  - Ticket issuing and the event-day operations already do: check-in, undo and revoke, item hand-outs, notes, the activity log, the door search and card.
- **Writing a row that belongs to an attendee?**
  - Call `lockAttendeeRow` ([`attendee-lock.ts`](../../packages/tickets/src/attendee-lock.ts)) first, in the same transaction.
  - Why: a check-in, note, item state, log entry, wallet pass, email delivery or companion is written under the weakest row lock. Without the lock, the insert can wait for a running erasure and land after it.
  - A filter such as `attendee: { erased_at: null }` does not close that race.
  - A write that updates the attendee row itself puts `erased_at: null` in its own `where` instead.
  - A transaction that deletes an attendee and its children calls `lockAttendeesForUpdate` first. So it takes the attendee row before the children, like everything else (the other order can deadlock).
  - `lockAttendeeRow` answers null for an attendee that was removed. `isAttendeeGone` is true for that and for an erased one. A request that has already sent the person's data somewhere (a wallet pass created at the provider) uses it to decide that it must not keep what it made. `?.erased` alone would read a removed attendee as still there.
- **Only reading?** No lock.
  - A plain read (the door search, the recent scans) is one statement. So it does not wait for an erasure that is still open. It sees the attendee as it was before that commit, or the placeholder after it.
  - Both are fine, because what the operator was handed a moment before the commit cannot be taken back by any lock.
  - Filter `erased_at: null` and leave it there.
  - Take the row lock only when a read is followed by a write, as the card is (it inserts the pending item states).
- **Storing a file of your own under an event's upload folder?**
  - The sweep of unnamed files deletes any `.csv`, `.xlsx` or `.pdf` in `{org}/events/{event}/{uuid}` that no `AdminJob.storage_key` names, a day after it was written.
  - A new feature that stores such a file must name it on a job row, or use another extension or folder.
  - Nothing else guards this: the tests pass and the file is gone a day later (`isJobFileKey`, [`sweepOrphanedJobFiles.test.ts`](../../packages/storage/test/sweepOrphanedJobFiles.test.ts)).
- **Creating a pass at the provider?**
  - Write the id it will get on the attendee's pass row first (`reservePassId` in `handleWalletRedirect`, under the attendee's row lock), and only then call the provider.
  - A row that holds the id and not the provider's is how an erasure and its follow-up know that a pass may exist which the request could not record. Without it, the pass stays at the provider with the person's name on it and nothing looks for it.
  - `createPass` has one call site. Keep it that way, or give the new one the same step.
  - A provider's `createPass` must also stop sending after `CREATE_PASS_DEADLINE_MS`. The 10-minute window of the follow-up is only sound because of that.
  - A pass that is made and then not kept (the template changed meanwhile) is deleted by the request that made it, with its own client. When that delete fails, it is recorded in `left_behind_pass_id`, which only a person clears.
- **Never log or audit names or emails** of the people erased. Ids and counts only.
- **The admin API marks and refuses.**
  - `erased_at` is in the attendee list rows and the detail DTO. A list row also carries `last_mail_retryable`. The detail also carries `erasure` (who erased the person, read from the central audit log).
  - The list hides erased attendees unless `include_erased=1`, and it returns `erased_count` (event-wide) for the "N hidden" note.
  - Every single-attendee action answers `409 { error: "attendee_erased" }`. Bulk actions skip erased attendees. Exports and the personal data export leave them out.
  - **Remove from event** is the one action that keeps working on an erased attendee (not on an archived event).
  - An erasure that commits after the route's plain read is told apart too. The domain functions that lock the attendee (revoking a check-in or an item, editing or deleting a note) mark the error they throw with `erased`. The route answers `attendee_erased` (`attendeeErasedAnswer`) instead of the words of that error, or a 404 for a note the erasure deleted.
  - Counts that are acted on (the bounced count, the revoke counts, the installed-pass counts of the Danger Zone) and the activity feeds leave erased attendees out.
  - The Overview tiles keep counting them, like Reports and capacity do, so a tile and its total stay consistent.
- **The last check before something leaves.**
  - The context a route loads and the rows an export reads come from plain queries, which do not wait for an erasure that is still open.
  - So the last step before each of these reads the attendee under their row lock, in a short transaction of its own (`attendeeIsLive`, `requireAttendeeStillLive`, `refreshWalletPassStatusUnlessErased`, `keepLiveRows`):
    - a wallet pass is changed at the provider: void (also in bulk and for the whole event), restore, push the content, delete, the bulk delete, and the void or restore that follows a status change or a bulk pass revoke
    - a pass is read there for a status refresh (single, bulk and event-wide)
    - an export file is built
  - An erasure that is still open is waited for. A wallet action then answers `attendee_erased` (a bulk action counts the attendee as skipped), and an export leaves the attendee out.
  - What it cannot do: the lock ends with that transaction, before the provider call or the build of the file. So an erasure that commits in the gap does not stop a call or a file that is already under way. The provider voids, restores, updates or deletes a pass that the erasure is about to delete anyway, and the file holds the person as they were when it started.
  - What follows is detected, not undone. The write back onto the pass row takes the attendee's row lock again and leaves the row as the erasure kept it (`updateWalletPassUnlessRemoved` answers `attendee_erased` or `wallet_pass_removed`, not one `null`). Delete does not touch the pass row an erasure keeps.
  - A ticket link that an admin copies, and the preview of a sent message that puts the same link into the stored text, check the attendee before the link is put together. They log the retrieval under the lock (`logTicketLinkRetrieved`, which uses that `writeActionLog` returns false for an erased attendee). An erasure that commits in between answers `attendee_erased` (the preview answers the empty message it gives once the erasure is done), and no link is handed out.
  - The status refresh is the exception to that write back. It records registration counts, the first download and the lifecycle the provider reports. Those are retained facts about the pass and not personal data. The periodic sync and the webhook write the same columns without any attendee lock, so only its read is guarded.
- **`@erased.invalid` is reserved.**
  - Import, manual add and edit reject such an address. A second CHECK refuses it on a live row.
  - Why: a live attendee holding `erased-<id>@erased.invalid` would make the erasure of `<id>` fail on the unique (event, email) index.
  - The migration moves any address already in that namespace to `<local part>+<attendee id>@legacy.erased.invalid` before the constraint is added, so the upgrade cannot fail on old data.

## Not done by the function

- **The pass at the provider is not deleted** (a network call).
  - The function returns `walletTargets`. The caller deletes them after the commit and stamps `provider_removed_at`.
  - Until then, the row keeps its provider ids so the delete can be retried. A pass with provider ids and no `provider_removed_at` on an erased attendee means "still to delete at the provider".
  - The caller should re-read the attendee's wallet pass after the commit, rather than trust `walletTargets` alone.
  - A pass created by a request that started before the erasure ends up as exactly such a row. Its install links are not saved. The request deletes it at the provider right away and leaves the row for the follow-up, which settles it ([A pass whose provider id was never saved](#a-pass-whose-provider-id-was-never-saved)).
  - The retry is the erase API repeating its provider deletes. Calling it once more for the same attendees tries every pending pass of theirs.
  - The worker's retention job retries them on its own too ([Passes still at the provider](#passes-still-at-the-provider)).
  - A failed delete is logged as `wallet_pass_erasure_delete_failed` (System logs).
- **Event-level copies still left.**
  - Wallet message job requests keep the pseudonymous attendee ids. (The files that exports and imports leave in storage are covered by [Files left in storage](#files-left-in-storage).)
  - Saved import results are blanked by the API (see above). An import that is still running when the erasure starts is waited for or stopped, so it never writes its list afterwards.
  - How an address is matched in saved import results and on mails:
    - An entry counts as mentioning the address when it holds it as a whole (`containsAddress` in `erase-job-results.ts`).
    - A full stop at the end of a sentence, brackets, double quotes and quote marks (`'a@x.com'`) around it do not hide it.
    - A longer address that merely ends or starts with it is another address and is left alone. Examples: `banana@x.com`, `_a@x.com`, `=a@x.com`, `o'brien@x.com` for `brien@x.com`, and `a@x.com.au` for `a@x.com`.
    - The one judgement call is a quote mark right before it. It is a valid character of a local part, but it is read as a quote, because an erased address left behind in quotes is the worse mistake.
    - A mail that staff sent to the person's address on behalf of another attendee (the resend override) loses that address in the erasure itself.
    - The addresses that are matched, in saved import results, on those mails and on guest registrations, are these (`collectAttendeeAddresses` in `attendee-traces.ts`, read before the deliveries and the activity log are emptied or deleted):
      - the one the person has now
      - the one their first ticket mail went to
      - the ones an edit of their profile replaced or set, as their activity log records it
    - An address that was edited earlier survives only in those places.
    - Only the first mail counts, since it always goes to the profile address while a resend can go to an address that staff typed in.
    - An older address is left out when it is not safely the person's alone. That is when another attendee of the event holds it now, or had it before (their first mail went to it, or their activity log records an edit from or to it). So mail that is theirs is never blanked or cancelled, and a registration with that address is kept.
    - An address that was on the profile only by mistake (a typo that staff corrected) counts as the person's too, unless another attendee had it. A registration of another guest, who is not an attendee, with that address is deleted with the erasure or the removal.
    - The current address is the person's without that check. When two attendees of the event hold one address in two spellings (one with capitals), the other attendee's own mail to it is blanked too, and cancelled while it waits. Their registration stays.
    - An address seen only in a resend is not found, and nor is an edit that the activity log does not record.
- **Reports, the delivery log and Custom fields do not know about erased attendees yet.**
  - The Reports tabs and their CSV exports, the delivery log and the Custom fields tab show the placeholder name and no address for them.
  - The custom-field answers (deleted at erasure) land in "not answered".
  - Their rows are read with plain queries and no last check. So a report or a CSV read while an erasure is still open carries that person's name and address. It is the one place the check described above does not reach yet.
- **Outside Admitto:** the mail provider's Sent Items (registration mails too) and relay logs, proxy logs, and database backups (14 days by default). A restore must re-run the erasures.
- **What the registration form's request leaves in Redis and in logs.**
  - The client's address is in the access log (when it is on) and in a rate-limit key for one minute (the /64 network for IPv6). The registration row itself holds no IP address.
  - A keyed hash of the guest's address is in Redis for up to 24 hours, as the mail budget of the address. It is not the address: only someone who holds the encryption key can check a guess against it. An erasure does not clear it.
- **A registration mail already handed to the provider** when the erasure runs can still go out once too. The last check takes the registration queue and ends with its transaction, before the send, and the result is one conditional update that finds no row once the registration is gone. A registration mail row stores a code and a fixed sentence, never the provider's text.
- **A mail already handed to the sender** when the erasure runs can still go out once.
  - Its outcome is not written back. An emptied delivery (no recipient) is skipped by every write-back, so it stays cancelled.
  - The last check before a message goes to the mailer (`readDeliveriesBeforeSend`: a retry, the worker, a synchronous send) reads the delivery under the attendee's row lock. So an erasure that is still open is waited for, and a message never starts for someone it is erasing.
  - That holds for a message that staff sent to another attendee's address (the resend override) as well. The delivery belongs to an attendee who is not being erased, but erasing the person who holds that address cancels and empties it. So the check also locks that person's row (found by the address in the delivery's event, whatever its case or padding), in the same statement and in id order, which cannot deadlock with an erasure.
  - One case stays open: a resend that staff address to this person's email while the erasure is still running. It is created after the erasure has cancelled the waiting ones, and once the erasure commits nothing links the address to the person any more. So that mail goes to an address staff typed.
  - A second, narrower one: the check waits for whoever holds the address now, not for an erasure of somebody who only had it before (their first mail, an edit). So a resend to such an older address can leave while that erasure runs.
  - Apart from those, the gap between the check and the mailer call is the only one left.
- **A pass update or a push message already with the wallet provider** when the erasure runs still arrives, and the pass is deleted right after.
  - The last check before one is sent reads the attendee under their row lock (`attendeeIsLive` and `liveAttendeeIds` in [`lock-check.ts`](../../packages/tickets/src/lock-check.ts): the pass update, and each batch of a message to many passes).
  - So an erasure that is still open is waited for, and nothing starts for someone it is erasing.
- **An Add to Wallet request has the same last check at the end.**
  - `handleWalletRedirect` takes the attendee's row lock in the transaction that records the device.
  - A visitor whose attendee is erased (or removed: the row is gone) by then is sent back to the ticket page. That holds whichever way the URL was obtained: a stored active pass, a pass just created, or one another request is creating.
  - It fails closed. If the check cannot be made (the lock gave up waiting behind an erasure, and a second try with the lock alone gave up too), the visitor gets the try-again notice, not the pass. A failure of the device write alone does not block the pass.
  - Before it calls the provider, the request takes the same lock to write the id on the pass row (`reservePassId`). It sends nothing for an attendee who is erased or removed by then, or when the row cannot be written (the try-again notice).
  - The transaction that saves a new pass, and the check that follows a failed save, wait behind an erasure of the same attendee with a limit of 65 s (`ERASURE_WAIT_TX_TIMEOUT_MS`). Prisma's default 5 s does not cut a statement that waits for the row lock, but it expires the transaction, and its commit then fails and loses the work.
  - The check after a failed save takes the row lock. So it waits for an erasure that is still open, and the pass just created at the provider is deleted when the attendee turns out to be erased.
- **Other timestamps** the person caused stay exact: mail opened and clicked, RSVP update, first wallet confirmation. Only admission and check-in times are cut to the hour.
