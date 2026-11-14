# Registration Access

**Audience:** Event Managers · **Required role:** Administrator · **Feature status:** 🗺️ Planned · **Last verified:** Admitto 0.7.7

## What this page helps you do

Turn guest registration on or off for an event, choose how guests get in, set what the form asks, and copy the link you give to guests. You do this on the **Access** tab of the event's **Registration** page. The page is in the event menu, after **Overview**.

Registration is off for every event until you turn it on. Until then, the address of the form answers "not found".

## Before you start

- You must be the Administrator of the event's organisation, or a Superadmin. An Operator cannot open this page.
- Some things are set up for the whole instance, by a Superadmin: bot protection, which ways in are allowed, the identity provider for the company sign-in, email sending and the address of the instance. You cannot change them here, and the checklist tells you when one is missing.
- Only a Superadmin sets the address of the event for guests (see **Give the event an address of its own** below). Every Administrator of the event sees how it stands.
- You write the legal texts and the questions yourself. See [Legal Texts and Consents](Legal-Texts-and-Consents) and [Registration Form Fields](Registration-Form-Fields).
- An archived event keeps its settings. You can read them and copy the link, but you cannot change anything.

## Steps

**Check what registration needs**

1. Open the event, then **Registration**, then the **Access** tab.
2. Read the **Setup checklist**. Each row is one thing that registration needs. A row that is not done comes first, and it says what to do.
3. Put each missing row right. The table under **Important decisions** says where.
4. Come back to the tab. The checklist shows the settings that are saved, so save your changes first to see it update.

**Choose how guests get in**

1. Under **Way in**, choose **Link**, **Password** or **Company sign-in**. An event has one way in at a time.
2. For **Password**, select **Set password**, type a password of 8 to 128 characters and select **Save password**. This is saved at once, apart from the **Save** button of the page.
3. For **Company sign-in**, optionally limit the form to one company. See **Limit the company sign-in to one company** below.
4. Select **Save** at the bottom of the page.

**Limit the company sign-in to one company**

1. Under **Way in**, choose **Company sign-in**.
2. In **Claim name**, type the name of the claim that the identity provider puts in the sign-in. With Microsoft Entra ID it is usually `tid`.
3. In **Allowed values**, type one value on each line. With `tid`, the value is the tenant ID of the company, a GUID.
4. Select **Save**. Leave both fields empty for no limit.

**Choose what the form asks**

1. Under **Form**, switch on what you need: **Ask for the company**, **Ask for the department** or **Guests can bring one person**.
2. Switch **Waiting list** and **Confirm email addresses** off only when you do not need them.
3. Switch **Styled form boxes** on if you want the form to draw its own boxes instead of the browser's. See [Styled boxes](#styled-boxes).
4. Under **Extra consents**, tick each consent that guests must accept. The list holds the consents that you published on the **Legal** tab.
5. Select **Save**.

**Give the event an address of its own**

A Superadmin does this. By default guests get links on the address of the instance. An event can have an address of its own instead, such as `events.example.com`, and then every link a guest is sent points at it.

1. Open the **Access** tab. Under **Address for guests**, type the address in **Own address**. Type the host name only: no `https://`, port or path.
2. Select **Save address**. The card says the address is not checked yet. Guests still get links on the main address.
3. Ask your IT department to set it up. The card lists the steps: a CNAME record that points the address to the instance, HTTPS with a valid certificate, the `Host` header passed on to Admitto, and no sign-in gateway in front of the pages guests open. If the form uses the bot check (Turnstile), the address also has to be added to the hostnames of its widget, or guests on the address fail the check. Admitto does not issue certificates.
4. When IT says it is ready, select **Check now**. The card says what the check found.
5. When the card says **Working**, guests get links on the address.

Admitto also checks the address by itself soon after you save it, and again every day.

**Turn registration on**

1. Under **Guest registration**, choose **Automatic** or **With approval**. Both are off while the checklist has a row that is not done.
2. Select **Save**.
3. Copy the address under **Link for guests** with the copy button, and give it to your guests.

**Turn registration off**

1. Under **Guest registration**, choose **Off** and select **Save**.
2. Read what changes, then select **Turn off registration**.

## Expected result

- The toast says "Registration is on." or "Registration is off."
- The mode you chose is selected, and **Save** is off again.
- With registration on, the address under **Link for guests** opens the form.

## Important decisions

**Automatic or with approval**

| Mode | What happens to a guest who registers |
|---|---|
| **Automatic** | The guest is accepted without waiting for you, until the event is full |
| **With approval** | The request waits on the **Requests** tab until you accept or reject it |

When the event is full, a new request goes on the waiting list. You accept people from the list by hand, in either mode. Without the **Waiting list** switch, a full event says that no places are left and saves nothing.

**Link, password or company sign-in**

| Way in | Who can open the form |
|---|---|
| **Link** | Anyone who has the link |
| **Password** | Anyone who has the link and types the event password |
| **Company sign-in** | Anyone who has the link and signs in with the identity provider of your organisation |

- The link and the password are protected by a bot check, unless a Superadmin set the bot check to **Not used** for your organisation. Then the checklist shows **Bot protection** in grey, as information, and a script can send the form or guess an event password within the usual limits. Use the company sign-in or a strong password for an event that matters. The company sign-in needs no bot check, because the form opens only after the sign-in.
- You cannot read the password again after you save it. Keep a copy where you share it with guests.
- A new password does not change the requests that guests already sent.
- Choosing another way in and saving removes the password.

**Company sign-in**

- The guest signs in with the identity provider that a Superadmin chose. The form shows the email address from that sign-in, and the guest cannot change it. A sign-in without an email address cannot register.
- A guest who signs in does not get an Admitto account and cannot open the staff screens.
- The limit compares the value in the sign-in with your list. It must match exactly, with capital letters as they are, and a match with any one value is enough. A list holds up to 20 values.
- Use a claim that the identity provider vouches for, such as the tenant. Never use the end of an email address: it says where mail goes, not who the person is.
- A change of the limit counts at once, also for guests who have already signed in. A guest who does not match sees a message and cannot register.
- Moving the event to another way in removes the limit.

**Styled boxes**

By default the guest's browser draws the boxes of the form. With **Styled form boxes** on, the form draws its own, in the style of Admitto: a phone box with a list of countries, a calendar for a date, and a list of times for a time. The switch is for the whole event, not for one question.

| Box | Switch off | Switch on |
|---|---|---|
| Phone | A one-line box | A button with a flag and a country code, a list of countries with a search box, and the number beside it |
| Date | The browser's date box | A text box with a calendar button beside it. The calendar opens under the box |
| Date and time | The browser's date and time box | A date box and a time box side by side, one under the other on a phone. Each has its own button, for a calendar and for a list of times |

- A guest picks a country from the list, or types the number with a `+` and the country code. The answer is saved as the code and the digits, for example `+48500100200`.
- A phone question that asks for digits only, or sets a shortest or longest length, keeps the browser's box. A country code would break its rule. This suits a desk extension.
- A guest picks a day in the calendar, or types it as `2026-11-04` or as day, month and year in the order of their browser, for example `04.11.2026`. A guest picks a time from the lists of hours and minutes, or types it, for example `18:00`, `1800` or `6:30 PM`. The lists go from 00:00 to 23:59 a minute apart, and show AM and PM where the guest's region uses a 12-hour clock.
- A date, or a date and time, is saved as it is without the styled boxes: `2026-11-04`, or `2026-11-04T18:30`, the clock at the event. A date without a time, a time without a date, or a text that is no day of the calendar (31 April) is not an answer. The guest sees `Enter a valid date.` or `Enter a valid date and time.` under the box.
- No rule of a date or a date and time question changes what the calendar can pick, so every such question gets the boxes.
- The answers, the rules and the messages are the same with the switch on or off. Only the boxes differ.

**What each row of the checklist needs**

| Row | If it is not done |
|---|---|
| **Way in** | Choose **Link**, **Password** or **Company sign-in** on this tab |
| **Way in allowed** | Ask a Superadmin to turn that way in on: Organisation settings > External services > Ways in |
| **Bot protection** | Ask a Superadmin to set up bot protection. A form with the company sign-in does not have this row. If your organisation does not use a bot check, the row is grey, says "Not used for this organisation" and does not block anything |
| **Company sign-in** | Ask a Superadmin to choose the identity provider: Organisation settings > External services > Ways in. Only a form with the company sign-in has this row |
| **Event password** | Set the password on this tab |
| **Legal texts** | Publish the privacy notice, the terms and the consents you chose on the **Legal** tab |
| **Form questions** | A required question cannot be shown on the form. Open the **Fields** tab |
| **Required questions** | A required question is not on the form. Switch **On the form** on for it, or make it optional, on the **Fields** tab |
| **Email sending** | Ask a Superadmin to set up email sending |
| **Instance address** | Ask a Superadmin to set the address of the instance |
| **Event status** | The event is archived. Ask a Superadmin to restore it |
| **Event dates** | The event has ended. Check the date and hours in **Event settings** |

**Saving**

- **Save** sends only the settings you changed.
- **Reset** takes the page back to what is saved.
- If you leave the tab with changes that are not saved, the page asks whether to discard them.

**Confirm email addresses**

- Guests confirm their address with a link in an email. The link works for 24 hours.
- A request that is not confirmed in that time is deleted.
- The guest's confirmation email replaces the "received" email.
- With the company sign-in this switch has no effect: the identity provider has already verified the address, so no confirmation link is sent. The switch is greyed out and keeps its setting for the other ways in.

**The address for guests: what the check can find**

| The card says | What it means | What IT does |
|---|---|---|
| Working | The address answers as this event on this instance | Nothing |
| Not working yet | The check has not passed yet. Guests keep the main address | Fix what the card names |
| Stopped working | The address worked once, and its last check failed. Guests are still sent links on it | Fix what the card names. Then select **Check now** |
| Cannot be checked from this server | The name resolves to a private network address, as a name of an internal DNS does. This is no fault of the address, but Admitto cannot confirm it. An address that never passed a check keeps the main address for guests; one that passed earlier stays in use | Nothing, or use a public name |

When a check fails, the card names the reason:

| Reason | What IT does |
|---|---|
| The name does not resolve | Create a CNAME record that points the address to the instance |
| The HTTPS certificate was refused | Serve a valid certificate for exactly this name |
| The name answers, but not as this event on this instance | Point the name at the instance, and pass the `Host` header on |
| The address did not answer in time | Allow HTTPS connections from the internet to the address |

- An address that worked and then fails is never taken back by itself. Guests are not sent back to the main address, and links already sent keep pointing at the address. The tab warns every Administrator of the event, and **Organisation settings → Health check** shows the row **Event addresses**.
- A wrong address, or a change of it, starts again: the verification is cleared and guests get the main address until the check passes.
- With the company sign-in, the identity provider must also list `https://<address>/sso/callback` as an allowed redirect. See [Organisation Settings](Organisation-Settings).
- IT also keeps the guest pages public on the address. A gateway or Cloudflare Access needs a bypass for `/` (the root, exactly), `/r/*`, `/sso/callback`, `/legal/*`, `/t/*`, `/q/*`, `/m/*`, `/assets/*`, `/uploads/*`, `/vendor/*`, the icon files and `/.well-known/admitto-domain-check`. Everything else on the address answers a plain "not found", so the panel is not reachable there. IT finds the full checklist, including the proxy and HSTS notes, in the deployment guide (`deploy/README.md`, "An event's own address for guests").

## What changes after this action

| Action | Result |
|---|---|
| **Save** | Only the settings you changed are saved. Each save is recorded in the audit log as "Guest registration settings changed", with the names and the new values of what changed, and never a password |
| Turn registration on | The form opens at once. It is refused while a row of the checklist is not done |
| Change the way in or the consents of an event that is on | Refused while a row is not done, like turning on |
| Move between **Automatic** and **With approval** | The new mode applies to new requests |
| Switch **Styled form boxes** on or off | The next guest who opens the form gets the boxes you chose. A form that is already open keeps the boxes it has |
| Turn registration off | The form answers "not found" at once |
| Save, change or remove the address for guests | Saved at once, apart from the **Save** button of the page. The check starts again from "not checked yet", and the audit log records "Guest registration own address updated" |
| Check now | Asks the address and shows what it found. The first success switches the links to the address. At most five checks a minute |
| Save a limit to one company | The form accepts only guests whose sign-in matches. The change is recorded in the audit log as "Guest registration settings changed", with the claim and its values. They are settings, not guests' data |
| Set, change or remove the password | The password is saved or removed at once. Removing it closes the form until you set a new one |

When you turn registration off:

- The requests you already have stay. You can still accept, reject and delete them on the **Requests** tab.
- Confirmation links stop working. They work again if you turn registration on before they expire.
- Emails that are already queued are still sent.

## Common problems

| Problem | What to do |
|---|---|
| **Automatic** and **With approval** are off | The checklist has a row that is not done. Put it right, save, and try again |
| The page says "This change needs something that is not set up yet" | Nothing was saved. The rows it lists are what is missing. Put them right and select **Save** again |
| An extra consent is marked "(not published)" | Publish its text on the **Legal** tab, or take the consent off the list |
| "One of the extra consents you chose is not published" | Someone took a text back while you were editing. Publish it again or take it off the list |
| A phone question shows the browser's box although the styled boxes are on | The question asks for digits only, or sets a shortest or longest length. A country code would break that rule. Remove the rule if the question should take a country |
| A guest sees "This event is not open to your company account." | The sign-in does not hold one of your allowed values. Check the claim name and the values on this tab |
| A guest sees "Your company account did not give us a verified email address" | The identity provider sent no email address, or says the address is not verified. A Superadmin maps the email claim of the provider |
| The restriction says "The restriction to one company works with the company sign-in only" | Choose **Company sign-in** as the way in, or clear both fields |
| There is no link under **Link for guests** | The address of the instance is not set. Ask a Superadmin |
| The tab warns that the address of the event stopped working | Ask a Superadmin or your IT department. The card under **Address for guests** names the reason |
| **Check now** is off | The field holds an address that is not saved. Save it first |
| "Another event already uses this address" | One address belongs to one event. Remove it from the other event first |
| Registration is on, but the page warns that something is missing | A row of the checklist stopped being done, for example the bot protection keys. The form may be closed to guests until it is fixed |
| **Save** and the controls are off | The event is archived, or a save is still running |
| A message says you have no access | Your role does not let you manage this event. Ask a Superadmin |

## Related pages

- [Registration Requests](Registration-Requests)
- [Registration Form Fields](Registration-Form-Fields)
- [Legal Texts and Consents](Legal-Texts-and-Consents)
- [Email Templates](Email-Templates)
- [Organisation Settings](Organisation-Settings)
- [Roles and Permissions](Roles-and-Permissions)
