# Notifications and Messages Reference

**Audience:** Event Managers and Superadmins · **Required role:** Any staff role · **Feature status:** ✅ Available · **Last verified:** Admitto 0.6.4

Use this page to see, in one place, every message Admitto can send - what triggers it, what it says, and who receives it. If you were expecting a message that isn't listed here (a "forgot password" email, an automatic reminder before an event), it does not exist yet; the relevant row below explains the current, manual alternative.

## Attendee-facing messages

Every attendee-facing message is sent by an explicit staff action. Nothing below is sent automatically by a schedule, an event date, or an attendee's own action.

| Message | Trigger | Subject | Recipients |
|---|---|---|---|
| **Ticket email** | Staff sends or resends it (single, bulk, or from Communication → Send) | Editable per event; defaults to "Your ticket for {event name}" | The attendee's email, or a staff-supplied alternate address for a single resend |
| **Custom email** (up to 10 per event, including anything labelled "Reminder") | Same as ticket email - staff sends or resends it | Fully staff-authored, no default | Same recipient options as the ticket email |
| **Wallet message** | Staff composes and sends free text from Communication → Wallets | No subject - a single text field, up to 500 characters | Only attendees who currently have an active Apple or Google Wallet pass (Samsung Wallet has no working provider integration yet, so no attendee ever holds an active Samsung pass to message) |

### Ticket email

Sending is always a deliberate staff action - a per-attendee **Resend**, a **Bulk resend**, or a Communication → Send batch. Creating an event or importing attendees never sends anything by itself. The default subject is "Your ticket for {event name}", fully editable, and the default body includes the event name, a "View your ticket" button, the QR code, and the event date and location - see [Email Templates](Email-Templates) and [Template Variables](Template-Variables) for the full list of variables you can use, including optional Apple/Google Wallet buttons. Sending any template also issues a ticket for that attendee if they don't already have one, regardless of which template is used.

### "Reminder" and other custom templates

There is no dedicated, automatic reminder mechanism - "Reminder" is simply one of several icon and label choices offered when you create a custom template (alongside Announcement, Event day, Save the date, and others). A custom template behaves exactly like the ticket email: someone on staff has to send or resend it. There is no way, today, to schedule a message to go out automatically a fixed number of days before an event. You can create up to 10 custom templates per event.

### Resending

A resend always renders the message fresh at send time, using the template's **current** content - if you edited the template since the original send, a resend reflects the new wording, not what was originally delivered. The one exception is a row-level **Resend** from the Delivery log, which deliberately resends using the same template version that row originally used.

### Bounce handling

A bounce does **not** generate a message to anyone. When mail to an attendee bounces, Admitto marks that delivery "Bounced" in the Delivery log and shows a banner on the Communication page ("N emails bounced. These addresses will not receive future mail.") - but nobody is emailed, paged, or otherwise alerted. You find out by looking at the Communication page or the event's Overview readiness checklist. See [Email Delivery Statuses](Email-Delivery-Statuses).

### Wallet message

A short, staff-authored plain-text message (no template, no merge fields) pushed as a lock-screen notification to every attendee who currently has an active wallet pass - see [Sending Wallet Messages](Sending-Wallet-Messages). This is different from a routine wallet data refresh (for example after editing an attendee's name): that kind of update silently refreshes the pass and is not a visible message at all.

## Staff-facing and system messages

Most of the staff-facing account actions you might expect to send an email do not send one today. This is not a bug to report - it is the current, documented behaviour. Each row below says what actually happens instead.

| Situation | Is an email sent? | What actually happens |
|---|---|---|
| A staff member forgets their password | **No** - there is no self-service "forgot password" link | A Superadmin resets it from **Users and roles** and has to tell the person their new temporary password directly (chat, phone, in person) |
| A new staff account is created | **No** - there is no invitation or "activate your account" email | The Superadmin who creates the account sets its initial password directly and has to communicate it out of band |
| A Superadmin resets someone's two-factor, or force-ends their sessions | **No** | The action is recorded in the Audit log and Security audit log; the affected person is not notified automatically |
| A "remember this device" cookie is created or used to skip two-factor at sign-in | **No** | Recorded only in the Security audit log ([Logs and Audit](Logs-and-Audit)) - visible if a Superadmin looks, not pushed to anyone |
| An event's mail keeps bouncing or failing | **No email or push to anyone** | An in-app banner appears on the Communication page and on that event's Overview page while you have them open - see [Email Delivery Statuses](Email-Delivery-Statuses) |
| Repeated failed sign-in attempts against an admin/superadmin account | **Yes, by default** | Recorded in the Security audit log, and by default also raises an in-app notification and (once the organisation's mail transport is set up) an email to every admin/superadmin - Organisation Settings → Notifications is where a Superadmin turns a type or channel off, or adds a webhook URL to also receive it there |
| Repeated failed two-factor attempts against an admin/superadmin account (past the password step) | **No** | Recorded in the Security audit log only; no admin is alerted unless they go and look |
| A break-glass CLI command force-resets an account's two-factor or generates an emergency recovery code for it | **Yes, by default** | The one-time result is still shown only on the operator's own terminal, and the action is recorded in the Security audit log - it also raises an in-app notification and (once mail transport is set up) an email by default, the same as repeated failed sign-in attempts above |
| A break-glass CLI command bootstraps a new superadmin account | **No** | Recorded in the Security audit log only; not wired to an alert |
| An organisation's SSO provider or Cloudflare Access settings are changed | **Yes, by default** | Recorded in the Audit log; also raises the same alert by default, naming who made the change |

**In short:** everything above leaves a record in [Logs and Audit](Logs-and-Audit) for a Superadmin to review. The rows marked "Yes, by default" push a real-time alert the moment they happen, with no setup required first - in-app always, and email too once the organisation's mail transport is configured. Organisation Settings → Notifications is where a Superadmin turns a type or channel off, or adds a webhook URL to also receive these alerts there - it's an opt-out screen, not something that has to be visited first to start receiving them. Every other row leaves an audit trail only; if you need to know about one of those as it happens, someone has to be watching the log.

## Related pages

- [Email Templates](Email-Templates) and [Advanced Email Templates](Advanced-Email-Templates)
- [Template Variables](Template-Variables)
- [Sending Messages and Delivery](Sending-Tickets-and-Delivery)
- [Sending Wallet Messages](Sending-Wallet-Messages)
- [Email Delivery Statuses](Email-Delivery-Statuses)
- [Logs and Audit](Logs-and-Audit)
