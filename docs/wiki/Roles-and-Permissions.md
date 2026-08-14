# Roles and Permissions

| Field | Value |
|---|---|
| **Audience** | Event Managers and Superadmins |
| **Required role** | Administrator or Superadmin |
| **Feature status** | Available |
| **Last verified** | Admitto 0.5.1 |

Your role decides which organisations, events, and actions are available. If a control is missing, ask a Superadmin to review your assignments rather than sharing an account.

| Task | Organisation Admin | Operator | Superadmin |
|---|---:|---:|---:|
| Manage events in an assigned organisation | Yes | No | Yes |
| Add, import, and edit attendees | Yes | No | Yes |
| Prepare templates and send event messages | Yes | No | Yes |
| Run check-in | Yes | Yes, for assigned events | Yes |
| Change ticket types and requirements | Yes | No | Yes |
| Manage organisation-level settings | Yes, for assigned organisations | No | Yes |
| Assign organisation and event roles | Yes, within permitted scope | No | Yes |
| Manage staff users across the instance | No | No | Yes |
| Change instance settings | No | No | Yes |
| Archive or restore an event | No | No | Yes |

## Organisation Admin

An Organisation Admin prepares and runs events belonging to an assigned organisation. This includes event settings, attendees, communication, check-in, reports, and supported organisation administration. Event-level Mailing, Wallet, and Integrations tabs and event archive actions remain Superadmin-only.

## Operator

An Operator works on assigned events. Operators scan tickets, use manual lookup only when enabled, and follow the configured item process. They do not configure attendees, templates, requirements, or settings. Start with [Operator Quick Start](Operator-Quick-Start).

## Superadmin

A Superadmin manages the entire Admitto instance, staff users, instance configuration, cross-scope recovery, and event lifecycle actions reserved for the instance administrator. Start with [Superadmin Quick Start](Superadmin-Quick-Start).

## Scope matters

Organisation Admin and Operator access is created through role assignments. A person can have different access in different organisations or events. Removing one assignment should not be assumed to remove unrelated access.

## Good access practice

- Give each person their own account.
- Assign the smallest role and scope that supports the work.
- Review access before event day and remove it when no longer needed.
- Never solve a missing permission by using another person's account.

See [Users and Roles Administration](Users-and-Roles-Administration) for supported administration steps.
