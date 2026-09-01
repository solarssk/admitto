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
| Manage organisation-level settings | 🟡² | – | ✅ |
| Assign organisation and event roles | 🟡³ | – | ✅ |
| Manage staff users across the instance | – | – | ✅ |
| Change instance settings | – | – | ✅ |
| Archive or restore an event | – | – | ✅ |

¹ Only for events they're assigned to. ² Only for organisations they're assigned to. ³ Within the scope they've been granted.

## Administrator

An Administrator prepares and runs events belonging to an assigned organisation. This includes event settings, attendees, communication, check-in, reports, and supported organisation administration. Event-level Mailing, Wallet, and Integrations tabs and event archive actions remain Superadmin-only. This Wiki sometimes calls this role **Organisation Admin** to make clear it is scoped to one organisation, not the whole instance - it is the same role the app shows as Administrator.

## Operator

An Operator works on assigned events. Operators scan tickets, use manual lookup only when enabled, and follow the configured item process. They do not configure attendees, templates, requirements, or settings. Start with [Operator Quick Start](Operator-Quick-Start).

## Superadmin

A Superadmin manages the entire Admitto instance, staff users, instance configuration, cross-scope recovery, and event lifecycle actions reserved for the instance administrator. Start with [Superadmin Quick Start](Superadmin-Quick-Start).

## Attendee

An Attendee is not a staff role and does not appear in the permissions table above - they never sign in to Admitto and have no account, password, or dashboard. They are still very much part of the process: they receive a ticket by email (a QR code, and optionally an Apple/Google/Samsung Wallet pass), and present it at the door - to an Operator's scanner or, if the event allows it, by name at manual lookup. That single interaction (receive a ticket, show up, get checked in) is the entirety of what an Attendee does in the system. See [About Admitto](About-Admitto) and the [Glossary](Glossary) for how this fits into the wider event journey.

## Scope matters

Administrator and Operator access is created through role assignments. A person can have different access in different organisations or events. Removing one assignment should not be assumed to remove unrelated access.

## Good access practice

- Give each person their own account.
- Assign the smallest role and scope that supports the work.
- Review access before event day and remove it when no longer needed.
- Never solve a missing permission by using another person's account.

See [Users and Roles Administration](Users-and-Roles-Administration) for supported administration steps.
