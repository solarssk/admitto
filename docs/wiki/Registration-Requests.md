# Registration Requests

**Audience:** Event Managers · **Required role:** Administrator · **Feature status:** 🗺️ Planned · **Last verified:** Admitto 0.7.7

## What this page helps you do

Work through the requests that guests sent through the registration form: read each one, accept or reject it, send a failed email again, and delete the requests you no longer need. You do this on the **Requests** tab of the event's **Registration** page. That page is not in the event menu yet, so the tab cannot be reached from the menu.

Guests cannot open the form yet. It opens for an event only when registration is turned on for it.

## Before you start

- You must be the Administrator of the event's organisation, or a Superadmin. An Operator cannot open this page.
- A request is personal data of a guest who may never become an attendee. Admitto keeps it until a staff member deletes it. The one exception is a request that waits for the guest to confirm the address: it is deleted after 24 hours.
- Accepting a request makes the guest an attendee with a ticket. Deleting an accepted request erases that attendee as well.
- The event must not be archived to accept, reject or send an email again. Deleting works on an archived event too.

## Steps

**Read the list**

1. Open the event, then **Registration**. **Requests** is the first tab.
2. Read one request per row. On a narrow screen each request is a card.
3. Select **Next** and **Previous** to move between pages. **Rows per page** sets 10, 25, 50 or 100.

The list runs from the oldest request to the newest. A request does not move when it is decided, so a new one is at the end.

**Work through the requests that wait**

1. Open the **Requests** tab. When staff decide by hand and some requests wait, the list opens on **Waiting for a decision**. The two buttons above the list switch between that and **All**. The number beside each is how many requests it holds.
2. Select a guest's name to open the request. The window shows the answers, the consents, the person the guest brings and the emails the guest was sent.
3. Select **Accept** or **Reject**, and confirm.
4. The request leaves the list, and the keyboard focus moves to the next one. Press Enter to open it.

Another way to the same list is the **Registrations** row of the **Setup checklist** on the **Overview**. When requests wait, it opens the list on **Waiting for a decision**.

**Accept or reject several requests**

1. Tick the requests. The bar above the list shows how many are selected. The box in the heading selects the whole page.
2. Select **Accept** or **Reject**.
3. Read the dialog. When a request in the selection cannot take the action, for example an accepted one, the dialog says how many are left out.
4. To reject, decide whether to select **Send a message to the guest**. It is off by default.
5. Confirm.

**Send a failed email again**

1. Open the request. Under the email that failed, select **Send again**.
2. Or tick the requests, select **More actions**, then **Send email again**.

Only the last email of a request is sent again, and only when it failed for good. A failed ticket email is not sent from here: open the attendee, and send it from there.

**Delete requests**

1. Open the request and select **Delete**. Or tick the requests, select **More actions**, then **Delete requests**.
2. Read the dialog. It says what is removed. For an accepted request it says that the attendee is erased too.
3. Confirm.

**Delete everything a filter selects**

1. Choose a state, an age or a search, so that the list shows the requests you want to remove.
2. Select **Delete all matching**. The number on the button is how many it will delete, on every page.
3. Read the dialog, and confirm.

The button is shown only when the filter selects 500 requests or fewer.

**Find a request**

1. Type in **Name or email**. The list narrows when you stop typing.
2. To narrow it more, select **Filters**.
3. In **Filter by status**, choose one state. The number beside each state is how many requests the event has in it.
4. In **Registered more than**, choose how old a request must be, from 1 hour to 1 year.
5. The number on the **Filters** button is how many filters are on. Select **Clear filters** in an empty list to turn them all off.

## Expected result

A page of requests with its guest, company, state, last email and the time it was sent. The number on the **Requests** tab is how many requests wait for a decision. It has no number when none does.

After you accept, reject, send an email again or delete, a short message says what was done. The list and the numbers update at once, and you can go on with the next request without waiting.

## Important decisions

**What the search reads**

- It looks at the first name, the last name and the email address, and at nothing else. The answers to your questions, the company and the department are not searched.
- Every word you type must be found, in any order. Letters with accents count as different letters: `Lukasz` does not find `Łukasz`.
- Admitto reads the first 8 words and 254 characters. Characters that cannot be part of a name, such as zero-width ones, are treated as spaces.

**The states of a request**

| State | What it means |
|---|---|
| **Awaiting email** | The guest has not confirmed the email address yet. It takes no seat and is deleted after 24 hours if it stays unconfirmed. |
| **Waiting for a decision** | The event lets staff decide, and nobody has yet. |
| **Waiting list** | The event was full. Nothing moves on its own: staff choose who comes off the list. |
| **Accepted** | The guest is an attendee and has a ticket. |
| **Rejected** | Staff turned the request down. The guest cannot register again with the same address until the request is deleted. |

**What can be done to a request**

| State | Accept | Reject | Delete |
|---|---|---|---|
| **Awaiting email** | No | No | Yes |
| **Waiting for a decision** | Yes | Yes | Yes |
| **Waiting list** | Yes | Yes | Yes |
| **Accepted** | No | No | Yes, and the attendee is erased too |
| **Rejected** | Yes, later | No | Yes, and the guest can register again |

**Accepting and the seats**

- A guest takes one seat, and so does each person they bring. Seats are what the event's limit counts.
- Accepting is all or nothing. When the guests you chose need more seats than are free, nobody is accepted, and the dialog says how many seats are free and how many are needed. For example: "Only 2 seats are free, and the guests you chose need 10."
- Choose fewer guests, or raise the event's capacity first. An event without a limit never refuses.
- A request on the waiting list or a rejected one can be accepted too. Nothing is accepted on its own.

**Rejecting and the message to the guest**

- A rejected request stays on the list. The guest is not told, unless you select **Send a message to the guest**. That email is the decline notice.
- A guest who was rejected cannot register again with the same address. Delete the request to allow it.

**Deleting**

- A request and its emails are removed for good. This cannot be undone. The guest can register again with the same address.
- An accepted request is an attendee too. Deleting it erases the attendee, exactly as **Erase personal data** does: the ticket stops working, the wallet pass is deleted at the provider, the personal data is erased, and Reports keep an anonymous entry.
- The seat is freed, unless the guest was already checked in or the event is archived.
- If a wallet pass could not be deleted at the provider, a second dialog says so. Select **Try again** to repeat only that step.
- **Delete all matching** sends the filter, the number you saw and the name of the requests the list showed. If the list changed since, Admitto deletes nothing and says so. Read the list again, and check what it selects.

**Limits**

- One action takes up to 500 requests, and a page shows at most 100.
- Accepting, rejecting, sending an email again and deleting count toward the same limit as the bulk actions of the **Attendees** list: 20 a minute.
- When many accepted requests are deleted at once on an event that uses wallet passes, the limit is lower. Admitto then asks you to select fewer accepted guests.

**The last email**

The column shows the email the guest was sent last, and what happened to it.

| Shown | Meaning |
|---|---|
| **Pending** | The email waits in the queue. |
| **Sent** | The mail server took it. |
| **Retrying** | It failed, and Admitto tries again by itself. |
| **Failed** | It failed for good. |
| **Bounced** | The guest's mail server sent it back. |
| **Cancelled** | It was stopped because the request changed. |
| **None** | No email was queued. A request that was rejected without telling the guest has none. |

- A failed email does not change the request or free its seat.
- The name under the badge says which email it is: **Address confirmation**, **Request received**, **Waiting list notice**, **Decline notice** or **Ticket**.

**Other things on a row**

- **+1** after a name means the guest brings someone, who takes a seat too.
- The time under **Registered** is in UTC. A request has no time zone of its own, and every staff member reads the same time.
- An address or a name that is long wraps. It is never cut.

## What changes after this action

| Action | Result |
|---|---|
| Open the tab, search, filter, change the page | Admitto reads the list again. Nothing is changed. |
| Open a request | Admitto reads the request. Nothing is changed. |
| **Clear filters** | The state, the age and the search are all turned off. |
| **Accept** | Each guest becomes an attendee, and the ticket email is queued. The seats are taken. |
| **Reject** | The request becomes **Rejected**. The decline email is queued only if you chose to send it. |
| **Send again** | The last email goes back to the queue, as if it had never been tried. The request keeps its state. |
| **Delete** | The request and its queued emails are removed. An accepted request also erases its attendee and frees the seat. |
| **Delete all matching** | The same, for every request the filter selects. |

## Common problems

| Problem | What to do |
|---|---|
| "Registration is off for this event" | Guests cannot send requests while registration is off. The requests listed were sent earlier. |
| "No requests yet" | Nobody has sent a request. Guests are listed here once they register through the form. |
| "Nothing is waiting for a decision" | You have decided every request. Select **Show all requests** to see the others. |
| "No matches" | Try a different search, or select **Clear filters**. |
| "Could not load the requests" | Select **Retry**. If it keeps failing, check **System logs**. |
| "You do not have access" | Only the Administrator of the event's organisation and a Superadmin can read requests. |
| "Only 2 seats are free, and the guests you chose need 10" | Nobody was accepted. Choose fewer guests, or raise the event's capacity. |
| "This event is archived" | An archived event is read-only. You can still delete requests. |
| "The list changed since you looked at it, so nothing was deleted" | Someone else changed the requests. The list was read again: check the number in the dialog, and confirm again. |
| "Too many registrations match to delete them at once" | Narrow the filter, or select fewer requests. |
| "Too many requests. Wait a moment and try again" | You reached 20 actions in a minute. Wait, then go on. |
| An email says **Failed** | Open the request and select **Send again**. If it fails again, ask a Superadmin to check the mail settings of the event (**Event settings**, **Mailing**). |

## Related pages

- [Registration Form Fields](Registration-Form-Fields)
- [Legal Texts and Consents](Legal-Texts-and-Consents)
- [Event Overview and Settings](Event-Overview-and-Settings)
- [Email Delivery Statuses](Email-Delivery-Statuses)
- [Managing Attendees](Managing-Attendees)
- [Roles and Permissions](Roles-and-Permissions)
