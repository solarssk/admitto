# Registration Requests

**Audience:** Event Managers · **Required role:** Administrator · **Feature status:** 🗺️ Planned · **Last verified:** Admitto 0.7.7

## What this page helps you do

Read the requests that guests sent through the registration form: who sent each one, what state it is in, and whether the last email to the guest went out. You do this on the **Requests** tab of the event's **Registration** page. That page is not in the event menu yet, so the tab cannot be reached from the menu.

Guests cannot open the form yet. It opens for an event only when registration is turned on for it.

## Before you start

- You must be the Administrator of the event's organisation, or a Superadmin. An Operator cannot open this page.
- A request is personal data of a guest who may never become an attendee. Admitto keeps it until a staff member deletes it. The one exception is a request that waits for the guest to confirm the address: it is deleted after 24 hours.
- This tab shows requests. It does not change them.

## Steps

**Read the list**

1. Open the event, then **Registration**. **Requests** is the first tab.
2. Read one request per row. On a narrow screen each request is a card.
3. Select **Next** and **Previous** to move between pages. **Rows per page** sets 10, 25, 50 or 100.

The list runs from the oldest request to the newest. A request does not move when it is decided, so a new one is at the end.

**Find a request**

1. Type in **Name or email**. The list narrows when you stop typing.
2. To narrow it more, select **Filters**.
3. In **Filter by status**, choose one state. The number beside each state is how many requests the event has in it.
4. In **Registered more than**, choose how old a request must be, from 1 hour to 1 year.
5. The number on the **Filters** button is how many filters are on. Select **Clear filters** in an empty list to turn them all off.

**Open the requests that wait for you from the Overview**

1. Open **Overview**. When registration is on, the **Setup checklist** has a **Registrations** row.
2. Select the row. The list opens with the state **Waiting for a decision**.

## Expected result

A page of requests with its guest, company, state, last email and the time it was sent. The number on the **Requests** tab is how many requests wait for a decision. It has no number when none does.

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
| **Clear filters** | The state, the age and the search are all turned off. |

## Common problems

| Problem | What to do |
|---|---|
| "Registration is off for this event" | Guests cannot send requests while registration is off. The requests listed were sent earlier. |
| "No requests yet" | Nobody has sent a request. Guests are listed here once they register through the form. |
| "No matches" | Try a different search, or select **Clear filters**. |
| "Could not load the requests" | Select **Retry**. If it keeps failing, check **System logs**. |
| "You do not have access" | Only the Administrator of the event's organisation and a Superadmin can read requests. |
| An email says **Failed** | Ask a Superadmin to check the mail settings of the event (**Event settings**, **Mailing**). |

## Related pages

- [Registration Form Fields](Registration-Form-Fields)
- [Legal Texts and Consents](Legal-Texts-and-Consents)
- [Event Overview and Settings](Event-Overview-and-Settings)
- [Email Delivery Statuses](Email-Delivery-Statuses)
- [Roles and Permissions](Roles-and-Permissions)
