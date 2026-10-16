# Notifications and Messages Reference

**Audience:** Event Managers and Superadmins · **Required role:** Any staff role · **Feature status:** ✅ Available · **Last verified:** Admitto 0.6.4

This page lists every message Admitto can send: what triggers it, what it says and who receives it.

If you expected a message that is not listed here, it does not exist yet. Examples are a "forgot password" email and an automatic reminder before an event. The relevant section explains the manual alternative.

- [Attendee-facing messages](#attendee-facing-messages)
- [Staff-facing and system messages](#staff-facing-and-system-messages)
- [Related pages](#related-pages)

## Attendee-facing messages

Every attendee-facing message is sent by an explicit staff action. Admitto never sends one on its own because of a schedule, an event date or something an attendee did.

| Message | Trigger | Subject | Recipients |
|---|---|---|---|
| **Ticket email** | Staff sends or resends it: for one attendee, in bulk, or from Communication → Send | Editable per event. The default is "Your ticket for {event name}" | The attendee's email, or an alternate address that staff enter for a single resend |
| **Custom email** (up to 10 per event, including anything labelled "Reminder") | The same as the ticket email: staff sends or resends it | Written entirely by staff, no default | The same recipient options as the ticket email |
| **Wallet message** | Staff writes free text in Communication → Wallets and sends it | No subject. One text field, up to 500 characters | Only attendees who currently have an active Apple or Google Wallet pass |

Samsung Wallet has no working provider integration yet, so no attendee holds an active Samsung pass that a wallet message could reach.

### Ticket email

- Sending is always a deliberate staff action: a per-attendee **Resend**, a **Bulk resend**, or a Communication → Send batch. Creating an event or importing attendees never sends anything by itself.
- The default subject is "Your ticket for {event name}". You can edit it.
- The default body has the event name, a "View your ticket" button, the QR code, and the event date and location.
- [Email Templates](Email-Templates) and [Template Variables](Template-Variables) list every variable you can use, including the optional Apple and Google Wallet buttons.
- Sending any template also issues a ticket for that attendee if they don't have one yet, whichever template you use.

### "Reminder" and other custom templates

- There is no dedicated, automatic reminder. "Reminder" is one of the icon and label choices you get when you create a custom template, next to Announcement, Event day, Save the date and others.
- A custom template behaves exactly like the ticket email: someone on staff has to send or resend it. You can create up to 10 custom templates per event.
- Today you can't schedule a message to go out a fixed number of days before an event.

### Resending

- A resend renders the message fresh when you send it, with the template's **current** content. If you edited the template after the first send, the resend uses the new wording.
- One exception: a row-level **Resend** in the Delivery log deliberately uses the same template version that this row used the first time.

### Bounces

- A bounce does **not** create a message to anyone.
- Admitto marks the delivery "Bounced" in the Delivery log. It also shows a banner on the Communication page: "N emails bounced. Check these addresses before sending again."
- Nobody is emailed, paged or otherwise alerted. You find out by looking at the Communication page or at the event's Overview readiness checklist.
- Admitto does not block later sends to a bounced address. Correct the address first.
- See [Email Delivery Statuses](Email-Delivery-Statuses).

### Wallet message

- A short plain-text message that staff write, with no template and no merge fields. Admitto pushes it as a lock-screen notification to every attendee who currently has an active wallet pass. See [Sending Wallet Messages](Sending-Wallet-Messages).
- It is different from a routine wallet data refresh, for example after you edit an attendee's name. That refresh updates the pass silently and is not a visible message at all.

## Staff-facing and system messages

Most account actions that you might expect to send an email do not send one today. That is not a bug to report. It is the current, documented behaviour. The sections below say what happens instead.

### No email: you have to tell the person

| Situation | What actually happens |
|---|---|
| A staff member forgets their password | There is no self-service "forgot password" link. A Superadmin resets the password from **Users and roles** and tells the person the new temporary password directly (chat, phone, in person) |
| A new staff account is created | There is no invitation or "activate your account" email. The Superadmin who creates the account sets its first password and passes it on out of band |

### Always sent to the account owner

These alerts go only to the account owner. They are personal and can't be turned off, not by the account owner and not by a Superadmin. The in-app alert always appears. The email follows once mail transport is set up.

| Situation | What actually happens |
|---|---|
| A Superadmin resets someone's password, two-factor method or SSO link, or the person changes one of them | The account owner gets an alert saying that their own login details changed. See [My Account](My-Account). It comes in addition to the Audit log and Security audit log entries |
| An authenticator-app code is submitted again after it already signed someone in | The account owner gets the same kind of alert. A genuine authenticator app never produces the same code twice, so this is a sign that someone else may have seen the code. It is recorded in the Security audit log with its own reason. That entry does not count toward the "repeated failed two-factor attempts" case further down |

### Sent to the admin team by default

By default, each of these raises an in-app notification. Once the organisation's mail transport is set up, it also sends an email. A Superadmin can turn a type or a channel off, or add a webhook URL to receive the alerts there too. See [Organisation Settings](Organisation-Settings) → Notifications.

| Situation | Who is told and what is recorded |
|---|---|
| Repeated failed sign-in attempts against an admin or superadmin account | Every admin and superadmin. Also recorded in the Security audit log |
| An admin or superadmin account signs in from a country that is not among its recent successful logins | Every admin and superadmin, and the signed-in account itself. Also recorded in the Security audit log. Details below |
| A user is granted the admin or superadmin role | The rest of the admin team. The alert names who granted the role and to whom. Also recorded in the Audit log. A move to the same or a lower rank, such as superadmin to admin, is a demotion and does not raise this alert |
| An organisation's SSO provider or Cloudflare Access settings are changed | The same alert and channels as in the rows above. It names who made the change. Also recorded in the Audit log |
| A break-glass CLI command force-resets an account's two-factor method or generates an emergency recovery code for it | The same people and channels as repeated failed sign-ins. The one-time result is still shown only on the operator's own terminal. Also recorded in the Security audit log |

**The new-country sign-in alert in detail**

- Admitto compares the country with that account's own last 5 successful logins, not its full history. Returning to a country that you used before those 5 logins still counts as "not seen".
- The very first login on an account is never flagged. Neither is an account with no reliable country history to compare against.
- The signed-in account also always gets its own personal version of this alert, and that version can't be turned off. So the account owner learns about it even if the rest of the admin team turned the shared alert off.
- The alert shows the full country name, the device and browser, the IP address and the exact time of the sign-in. It also names the city when Admitto can resolve it, for example "Mumbai, India" instead of just "India". That is enough to judge whether it was really you without leaving the email.

### Nothing is sent: the log or a banner only

Nobody is emailed or notified for these. You find out only if you look.

| Situation | What actually happens |
|---|---|
| A Superadmin force-ends someone's sessions | Recorded in the Audit log and the Security audit log. The affected person is not notified automatically |
| A "remember this device" cookie is created, or used to skip two-factor at sign-in | Recorded only in the Security audit log ([Logs and Audit](Logs-and-Audit)). A Superadmin sees it only if they look |
| Repeated failed two-factor attempts against an admin or superadmin account, past the password step | Recorded in the Security audit log only. No admin is alerted unless they go and look |
| A break-glass CLI command bootstraps a new superadmin account | Recorded in the Security audit log only. It is not wired to an alert |
| An event's mail keeps bouncing or failing | No email or push to anyone. An in-app banner appears on the Communication page and on that event's Overview page while you have them open. See [Email Delivery Statuses](Email-Delivery-Statuses) |

### In short

- Everything in the staff-facing sections above leaves a record in [Logs and Audit](Logs-and-Audit) for a Superadmin to review.
- The alerts under "Sent to the admin team by default" go out the moment they happen, with no setup first. In-app always, and email too once the organisation's mail transport is configured.
- Organisation Settings → Notifications is an opt-out screen. A Superadmin turns a type or a channel off there, or adds a webhook URL to receive the alerts there too. Nobody has to visit it first to start receiving them.
- Notification emails (security alerts) are sent without the organisation's configured Reply-To address. That way a self-alert never shows the same address as both reply target and recipient, which several spam filters flag. A reply goes to the From address instead.
- Everything else leaves an audit trail only. If you need to know about it as it happens, someone has to watch the log.

## Related pages

- [Email Templates](Email-Templates) and [Advanced Email Templates](Advanced-Email-Templates)
- [Template Variables](Template-Variables)
- [Sending Messages and Delivery](Sending-Tickets-and-Delivery)
- [Sending Wallet Messages](Sending-Wallet-Messages)
- [Email Delivery Statuses](Email-Delivery-Statuses)
- [Logs and Audit](Logs-and-Audit)
