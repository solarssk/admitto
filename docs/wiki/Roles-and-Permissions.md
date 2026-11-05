# Roles and Permissions

**Audience:** Event Managers and Superadmins · **Required role:** Administrator or Superadmin · **Feature status:** ✅ Available · **Last verified:** Admitto 0.5.1

Your role decides which organisations, events, and actions are available. If a control is missing, ask a Superadmin to review your assignments rather than sharing an account.

**Legend:** ✅ full access · 🟡 scoped access (see note) · – no access

| Task | Administrator | Operator | Superadmin |
|---|:---:|:---:|:---:|
| Manage events in an assigned organisation | ✅ | – | ✅ |
| Add, import, and edit attendees | ✅ | – | ✅ |
| Prepare templates and send event messages | ✅ | – | ✅ |
| Run check-in | ✅ | 🟡¹ | ✅ |
| Change ticket types and requirements | ✅ | – | ✅ |
| Show the answers to sensitive questions (each click is logged) | ✅ | – | ✅ |
| Manage organisation-level settings | 🟡² | – | ✅ |
| Assign Operator access to events | 🟡³ | – | ✅ |
| Assign Administrator or Superadmin roles | – | – | ✅ |
| Manage staff users across the instance | – | – | ✅ |
| Change instance settings | – | – | ✅ |
| Archive or restore an event | – | – | ✅ |

¹ Only for events they're assigned to. ² Only for organisations they're assigned to. ³ Only the Operator role, and only for events in an organisation they administer.

## Administrator

An Administrator prepares and runs events belonging to an assigned organisation. This includes event settings, attendees, communication, check-in, reports, and supported organisation administration. Event-level Mailing, Wallet, and Integrations tabs and event archive actions remain Superadmin-only. This Wiki sometimes calls this role **Organisation Admin** to make clear it is scoped to one organisation, not the whole instance - it is the same role the app shows as Administrator.

### Sensitive answers

A question can be marked sensitive, for example one about health or accessibility. Its answers are hidden everywhere in Admitto. Only an Administrator of the organisation or a Superadmin can show the answers of one guest at a time, and an Operator never can.

Every time someone shows sensitive answers, Admitto writes an entry to the audit log: who did it, when, which guest or registration, and which questions. The entry never holds the answers themselves. It is written even when the guest gave no sensitive answer. Showing many guests in a short time is limited per person (20 a minute and 200 an hour), which slows a script down and leaves one audit entry for every guest it shows.

The **Show** button is on the attendee's page (one for the guest and one on the companion's card) and in the request window (one for the guest and one for each companion). It asks you to confirm that the click is recorded, and the answers disappear again after **Hide**, after two minutes, or when you leave the page. An Operator is not offered the button. See [Sensitive questions](Custom-Attendee-Fields#sensitive-questions).

An erased guest has no answers left to show. Showing is also allowed on an archived event.

## Operator

An Operator works on assigned events. Operators scan tickets, use manual lookup only when enabled, and follow the configured item process. They do not configure attendees, templates, requirements, or settings. Start with [Operator Quick Start](Operator-Quick-Start).

## Superadmin

A Superadmin manages the entire Admitto instance, staff users, instance configuration, cross-scope recovery, and event lifecycle actions reserved for the instance administrator. Start with [Superadmin Quick Start](Superadmin-Quick-Start).

## Attendee

An Attendee is not a staff role, so they do not appear in the permissions table above. They never sign in to Admitto and have no account, password, or dashboard.

They are still part of the process:

1. They receive a ticket by email: a QR code, and optionally an Apple or Google Wallet pass.
2. They show it at the door, to an Operator's scanner or, if the event allows it, by name at manual lookup.
3. They are checked in.

That is everything an Attendee does in the system. See [About Admitto](About-Admitto) and the [Glossary](Glossary) for how this fits into the wider event journey.

## Scope matters

Administrator and Operator access is created through role assignments. A person can have different access in different organisations or events. Removing one assignment should not be assumed to remove unrelated access.

## Good access practice

- Give each person their own account.
- Assign the smallest role and scope that supports the work.
- Review access before event day and remove it when no longer needed.
- Never solve a missing permission by using another person's account.

See [Users and Roles Administration](Users-and-Roles-Administration) for supported administration steps.
