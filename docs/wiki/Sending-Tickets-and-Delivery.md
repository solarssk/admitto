# Sending Tickets and Delivery

> **Audience:** Event Managers
> **Required role:** Organisation Admin
> **Feature status:** Available
> **Last verified:** Admitto 0.4.12

## What this page helps you do

Choose the intended recipients, count them before sending, and investigate delivery results.

## Before you start

Save and test the selected template. Review attendee pass status, email addresses, ticket types, and RSVP values used by the recipient filter.

## Steps

1. Open **Communication**, select the template, and choose **Send email**. A selected-attendee send can also start from **Attendees**.
2. Choose a recipient filter.
3. Select **Count recipients** and compare the count with your expectation.
4. If the count is wrong, cancel and correct the filter or attendee data.
5. Select **Send**.
6. Watch **Queued**, **Sent**, and **Failed** progress until the batch completes.
7. Open the delivery log and filter by status or purpose.

## Expected result

The batch completes with a recorded status for every attempted delivery. The delivery log identifies initial sends and resends.

## Important decisions

| Recipient option | Meaning |
|---|---|
| All attendees | Every attendee in the event. Use carefully because previous delivery does not exclude a person. |
| No delivery for this template | Attendees without a queued or successful delivery for the selected template. For the ticket template, this means no active initial ticket delivery. Failed, bounced, or rejected attempts do not count as successful delivery. |
| By RSVP status | Attendees whose current RSVP value matches the selected status. |
| By ticket type | Attendees whose stored ticket type matches the selected configured type. |

Custom-template bulk sends are recorded as resends. A recipient count is a dry run and sends nothing.

## What changes after this action

Sending creates delivery records and can issue the attendee's ticket when needed. Later resends create new delivery records; they do not erase earlier results.

## Common problems

- **The count is zero:** verify the selected template, filter, and attendee data.
- **Ticket types fail to load:** retry before sending; do not fall back to all attendees by guesswork.
- **Some deliveries fail:** review [Email Delivery Statuses](Email-Delivery-Statuses), correct the cause, then use the permitted resend.
- **The batch stays queued:** ask a Superadmin to review mail configuration and logs.

## Related pages

- [Email Templates](Email-Templates)
- [Email Delivery Statuses](Email-Delivery-Statuses)
- [Mail Delivery Administration](Mail-Delivery-Administration)
