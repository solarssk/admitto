# First Event Checklist

**Audience:** Event Managers · **Required role:** Administrator · **Feature status:** ✅ Available · **Last verified:** Admitto 0.5.1

Use this checklist before an event. It is a practical starting point, not a replacement for your organisation's event policy.

## Plan the event

- [ ] [Create the event](Create-an-Event) with the correct title, date, time zone, and optional location.
- [ ] Open [Event Overview and Settings](Event-Overview-and-Settings) and set capacity if the event has a limit.
- [ ] Add the [ticket types](Ticket-Types) and [custom attendee fields](Custom-Attendee-Fields) that attendee data needs.
- [ ] Configure [event items and check-in behaviour](Event-Items-and-Check-in-Behaviour) for operators.
- [ ] Confirm that managers and operators have the right organisation and event access.

## Prepare attendees and tickets

- [ ] Prepare a clean attendee file using the [Import File Reference](Import-File-Reference).
- [ ] Validate it with [Importing Attendees](Importing-Attendees) and resolve invalid, skipped, and unexpected warning rows before committing.
- [ ] Review the attendee list and correct important records.
- [ ] Create or review the [ticket email template](Email-Templates), including its required ticket variables.
- [ ] Send a test message to a synthetic or approved test address.
- [ ] [Send tickets](Sending-Tickets-and-Delivery), count the intended recipients, and monitor delivery status.

## Let guests register (only if the event takes registrations)

- [ ] A Superadmin has saved the Turnstile keys and the way guests sign in, and the mail sending works ([Organisation Settings](Organisation-Settings)).
- [ ] IT keeps the guest pages public at the gateway, and an event with an address of its own has it checked ([Registration Access](Registration-Access)).
- [ ] The event's questions and texts are ready ([Registration Form Fields](Registration-Form-Fields), [Legal Texts and Consents](Legal-Texts-and-Consents)).
- [ ] Turn the registration mode on for the event. Until it is on, the form answers "not found", so nobody can send a test.
- [ ] Open the form in a private window and send one test registration with a synthetic address. See it arrive in [Registration Requests](Registration-Requests), and watch the mail queue. Turn the mode off again if something is wrong: the form then answers "not found".

## Prepare event day

- [ ] Confirm who will operate check-in and which event they can access.
- [ ] Configure items and check-in behaviour, if your event uses them.
- [ ] Test one synthetic ticket from message delivery through [check-in result](Scanning-Tickets-and-Results).
- [ ] Prepare each device, power supply, and network connection according to your local event procedure.
- [ ] Give operators the [Operator Quick Start](Operator-Quick-Start) link.

## After the event

- [ ] Review attendance in [Reports and Archiving](Reports-and-Archiving).
- [ ] Export the data your team needs through the approved process.
- [ ] Ask a Superadmin to archive the event once no more changes are needed.
