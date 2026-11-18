# Registration Access

**Audience:** Event Managers · **Required role:** Administrator · **Feature status:** 🗺️ Planned · **Last verified:** Admitto 0.7.7

## What this page helps you do

Turn guest registration on or off for an event, copy the link you give to guests, and set what the form asks. You turn registration on and off, and copy the link, with the buttons in the header of the event's **Registration** page, which is in the event menu after **Overview**. The same header is on every tab, with a badge next to the title that says **Open**, **Closed** or **Not ready**. What the form asks is on the **Registration** tab of the event's **Event settings**, in two cards: **Requests and limits** and **Questions and consents**. What registration still needs is on the **Checklist** tab of the **Registration** page.

Registration is off for every event until you turn it on. Until then, the address of the form answers "not found".

## Before you start

- You must be the Administrator of the event's organisation, or a Superadmin. An Operator cannot open this page.
- Some things are set up for the whole instance, by a Superadmin: bot protection, the list of identity providers for Company SSO (under **Identity**), email sending and the address of the instance. You cannot change them here, and the **Checklist** tab tells you when one is missing.
- Only a Superadmin sets the access method (with the event password and the identity provider), the bot protection of the event and the restriction to one company, on the **Registration** tab of **Event settings**, and the address of the event for guests, on its **General** tab (see **Set the access method**, **Give the event an address of its own** and **Restrict Company SSO to one company** below). An Administrator sees the same cards, with the controls grey and the line "Only a superadmin can change this." The address card shows how the address stands. Every Administrator of the event is warned on the **Registration** tab when the address stops working.
- You write the legal texts and the questions yourself. See [Legal Texts and Consents](Legal-Texts-and-Consents) and [Registration Form Fields](Registration-Form-Fields).
- An archived event keeps its settings. You can read them and copy the link, but you cannot change anything.

## Steps

**Check what registration needs**

1. Open the event, then **Registration**, then the **Checklist** tab. The tab has the number of steps that are still open next to its name. The number is the same for everybody.
2. Read the card **Registration checklist** at the top. The bar and the pill "N of M done" at the right of the header say how far you are. Every card on the tab shows its status as a pill at the right of its header. The message under the bar says what state registration is in: "Ready. Registration can be turned on." (with a **Turn registration on**

1. Open the event's **Registration** page. The badge next to the title says **Closed**, and the main button is **Turn registration on**. While the **Checklist** tab has a row that is not done, the badge says **Not ready** with the number of open steps, and the main button is **See the Checklist**.
2. Select **Turn registration on**. Registration starts with the mode that holds every request for you to accept or reject. To accept guests by themselves, go to **Event settings → Registration** and switch **Approve requests by hand** off, then select **Save**. That switch is grey while registration is off.
3. Select **Copy link** in the header, and give the link to your guests. When registration is on, **Copy link** is the main button. **Open the form**, in **More actions**, opens the form in a new tab.

On the **Checklist** tab, when every step is done, the green message has the button **Turn registration on**. It does the same as the main button in the header.

**Turn registration off**

1. In the header of the **Registration** page, open **More actions** and select **Turn registration off**. On the **Checklist** tab, the message "Registration is open." has the button **Turn off**.
2. Read what changes, then select **Turn off registration**.

## Expected result

- The toast says "Registration is on." or "Registration is off."
- The badge in the header shows **Open** or **Closed**, and the number on the **Checklist** tab follows it.
- With registration on, the link that **Copy link** copies opens the form.

## Important decisions

**Accept by hand or automatically**

| Mode | What happens to a guest who registers |
|---|---|
| **Approve requests by hand** off | The guest is accepted without waiting for you, until the event is full |
| **Approve requests by hand** on (the mode when you turn registration on) | The request waits on the **Requests** tab until you accept or reject it |

When the event is full, a new request goes on the waiting list. You accept people from the list by hand, in either mode. Without the **Waiting list** switch, a full event says that no places are left and saves nothing.

**Link, password or company SSO**

| Access method | Who can open the form |
|---|---|
| **Link** | Anyone who has the link |
| **Password** | Anyone who has the link and types the event password |
| **Company SSO** | Anyone who has the link and signs in with the identity provider chosen for the event |

- The link and the password are protected by a bot check, unless a Superadmin turned bot protection **Off** for your organisation. Then the **Checklist** tab shows **Bot protection** in grey, as information, and a script can send the form or guess an event password within the usual limits. Use the company SSO or a strong password for an event that matters. The company SSO needs no bot check, because the form opens only after the sign-in.
- A Superadmin can switch the bot check off for one event, in **Event settings → Registration**, as the **Bot protection** row at the bottom of the **Access method** card. While the check is **Off** for the organisation, the switch shows **Off**, is greyed and says so in its tooltip, and nothing is saved for it. Turning it **Off** asks first, and it is saved with the **Save** of the tab. That event's link and password forms then need no Turnstile keys and have no check, and the limits stay the same. The switch is greyed for an event that uses Company SSO, which never has the check. An Administrator cannot change it; the checklist row says "Off for this event" or "Off for this organisation". Turning it on again for an event that has registration on needs the keys to be saved.
- You cannot read the password again after you save it. Keep a copy where you share it with guests.
- A new password does not change the requests that guests already sent.
- Choosing another method while a password is set asks "Remove the event password?" first. Cancel keeps the password; Remove changes the choice, and the password is removed when a Superadmin selects **Save** at the bottom of **Event settings → Registration**.

**Company SSO**

- The guest signs in with the identity provider chosen for the event. The form shows the email address from that sign-in, and the guest cannot change it. A sign-in without an email address cannot register.
- A guest who signs in does not get an Admitto account and cannot open the staff screens.
- The restriction compares the value in the sign-in with your list. It must match exactly, with capital letters as they are, and a match with any one value is enough. A list holds up to 20 values.
- A claim that holds a list, such as `groups`, works too: a guest who is in any of the groups you list can register. If the provider sends no such claim for a guest (Microsoft Entra ID sends no group list for a person in too many groups), that guest cannot register.
- Example: claim `tid` with the tenant ID of your company lets only people of that company register. Claim `groups` with two group IDs lets only members of those groups register.
- Use a claim that the identity provider vouches for, such as the tenant. Never use the end of an email address: it says where mail goes, not who the person is.
- A change of the restriction counts at once, also for guests who have already signed in. A guest who does not match sees a message and cannot register.
- Moving the event to another way removes the restriction.
- Company SSO is grey while no identity provider is turned on. An event that already has it keeps it, and the **Identity provider** row of the **Checklist** tab warns that guests cannot open the form.

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

**What each row of the checklist needs, and who does it**

| Row | If it is not done |
|---|---|
| **Access method** | A Superadmin chooses **Link**, **Password** or **Company SSO** in **Event settings → Registration** |
| **Bot protection** | Ask a Superadmin to set up bot protection. A Superadmin is sent to **Organisation settings → External services**. A form with the company SSO does not have this row. If bot protection is **Off** for your organisation, the row is grey, says "Off for this organisation" and does not block anything |
| **Identity provider** | A Superadmin chooses it in **Event settings → Registration**. If the list is empty, one is set up under **Identity** first. Only a form with the company SSO has this row |
| **Event password** | A Superadmin sets it in **Event settings → Registration** |
| **Legal texts** | Publish the privacy notice, the terms and the consents you chose on the **Legal** tab |
| **Form questions** | A required question cannot be shown on the form. Open the **Fields** tab. When it is done, the row says how many of your questions are on the form |
| **Required questions** | A required question is not on the form. Switch **On the form** on for it, or make it optional, on the **Fields** tab |
| **Email sending** | Ask a Superadmin to set up email sending. A Superadmin is sent to **Organisation settings → Mail** |
| **Instance address** | Ask a Superadmin to set the address of the instance. A Superadmin is sent to **Organisation settings → General** |
| **Event status** | The event is archived. Ask a Superadmin to restore it |
| **Address for guests** | Only when the event has an address of its own that was found working once. If the last check fails, ask a Superadmin to look at it. A Superadmin is sent to **Event settings → General** |
| **Event dates** | The event has ended. Check the date and hours in **Event settings** |

**Saving**

- **Save** sends only the settings you changed.
- **Reset** takes the page back to what is saved.
- If you leave the tab with changes that are not saved, the page asks whether to discard them.

**Confirm email addresses**

- Guests confirm their address with a link in an email. The link works for 24 hours.
- A request that is not confirmed in that time is deleted.
- The guest's confirmation email replaces the "received" email.
- With the company SSO this switch has no effect: the address comes from the identity provider, so no confirmation link is sent. The switch is greyed out and keeps its setting for the other access methods.

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

- An address that worked and then fails is never taken back by itself. Guests are not sent back to the main address, and links already sent keep pointing at the address. The **Registration** tab of **Event settings** warns every Administrator of the event, and **Organisation settings → Health check** shows the row **Event addresses**.
- A wrong address, or a change of it, starts again: the verification is cleared and guests get the main address until the check passes.
- With the company SSO, the identity provider must also list `https://<address>/sso/callback` as an allowed redirect. See [Organisation Settings](Organisation-Settings).
- IT also keeps the guest pages public on the address. A gateway or Cloudflare Access needs a bypass for `/` (the root, exactly), `/r/*`, `/sso/callback`, `/legal/*`, `/t/*`, `/q/*`, `/m/*`, `/assets/*`, `/uploads/*`, `/vendor/*`, the icon files and `/.well-known/admitto-domain-check`. Everything else on the address answers a plain "not found", so the panel is not reachable there. IT finds the full checklist, including the proxy and HSTS notes, in the deployment guide (`deploy/README.md`, "An event's own address for guests").

## What changes after this action

| Action | Result |
|---|---|
| **Save** | Only the settings you changed are saved. Each save is recorded in the audit log as "Guest registration settings changed", with the names and the new values of what changed, and never a password |
| Turn registration on (the button in the header or the one on the **Checklist** tab) | The form opens at once. It is refused while a row of the checklist is not done |
| Change the access method or the consents of an event that is on | Refused while a row is not done, like turning on |
| Switch **Approve requests by hand** | The new mode applies to new requests. **Save** it in **Event settings → Registration** |
| Switch **Styled form boxes** on or off | The next guest who opens the form gets the boxes you chose. A form that is already open keeps the boxes it has |
| Turn registration off | The form answers "not found" at once |
| Save, change or remove the address for guests | Saved at once, apart from the **Save** button of the page. Found on **Event settings → General**. The check starts again from "not checked yet", and the audit log records "Guest registration own address updated" |
| Check now | Asks the address and shows what it found. The first success switches the links to the address. At most five checks a minute |
| Save a restriction to one company | The form accepts only guests whose sign-in matches. The change is recorded in the audit log as "Guest registration settings changed", with the claim and its values. They are settings, not guests' data |
| Set, change or remove the password | The password is saved or removed at once. Removing it closes the form until you set a new one |

When you turn registration off, guests can no longer open the form, and confirmation links stop working until you turn registration on again. The requests you already have stay on the **Requests** tab, where you can still accept, reject and delete them. Emails that are already queued are still sent.

## Common problems

| Problem | What to do |
|---|---|
| The badge in the header says **Not ready**, and **Turn registration on** in **More actions** is grey | The **Checklist** tab has a row that is not done. The badge says how many. Select **See the Checklist**, put it right, and try again |
| The page says "This change needs something that is not set up yet" | Nothing was saved. The rows it lists are what is missing. Put them right and select **Save** again |
| An extra consent is marked "(not published)" | Publish its text on the **Legal** tab, or take the consent off the list |
| "One of the extra consents you chose is not published" | Someone took a text back while you were editing. Publish it again or take it off the list |
| A phone question shows the browser's box although the styled boxes are on | The question asks for digits only, or sets a shortest or longest length. A country code would break that rule. Remove the rule if the question should take a country |
| A guest sees "This event is not open to your company account." | The sign-in does not hold one of your allowed values. Ask a Superadmin to check the claim and the values in **Event settings**, **Registration** |
| A guest sees "Your company account did not give us a verified email address" | The identity provider sent no email address, or says the address is not verified. A Superadmin maps the email claim of the provider |
| Saving says "Only a superadmin can change the access method" or "Only a superadmin can change the restriction to one company" | The access method and the restriction to one company are a Superadmin's to set, in **Event settings → Registration**. Ask a Superadmin to change it |
| The restriction says "The restriction to one company works with Company SSO only" | Choose **Company SSO** under **Access method** in **Event settings → Registration**, or clear both fields |
| **Copy link** is grey while registration is on | The address of the instance is not set. Ask a Superadmin |
| The Registration tab warns that the address of the event stopped working | Ask a Superadmin or your IT team. The card under **Address for guests** names the reason |
| **Check now** is off | The field holds an address that is not set. Select **Set address** first |
| "Another event already uses this address" | One address belongs to one event. Remove it from the other event first |
| Registration is on, but the page warns that something is missing | A row of the **Checklist** tab stopped being done, for example the bot protection keys. The form may be closed to guests until it is fixed |
| **Save** and the controls are off | The event is archived, or a save is still running |
| A message says you have no access | Your role does not let you manage this event. Ask a Superadmin |

## Related pages

- [Registration Requests](Registration-Requests)
- [Registration Form Fields](Registration-Form-Fields)
- [Legal Texts and Consents](Legal-Texts-and-Consents)
- [Email Templates](Email-Templates)
- [Organisation Settings](Organisation-Settings)
- [Roles and Permissions](Roles-and-Permissions)
