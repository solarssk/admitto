# Registration Access

**Audience:** Event Managers · **Required role:** Administrator · **Feature status:** 🗺️ Planned · **Last verified:** Admitto 0.7.7

## What this page helps you do

Turn guest registration on or off for an event, choose how guests get in, set what the form asks, and copy the link you give to guests. You do this on the **Access** tab of the event's **Registration** page. The page is in the event menu, after **Overview**.

Registration is off for every event until you turn it on. Until then, the address of the form answers "not found".

## Before you start

- You must be the Administrator of the event's organisation, or a Superadmin. An Operator cannot open this page.
- Some things are set up for the whole instance, by a Superadmin: bot protection, which ways in are allowed, email sending and the address of the instance. You cannot change them here, and the checklist tells you when one is missing.
- You write the legal texts and the questions yourself. See [Legal Texts and Consents](Legal-Texts-and-Consents) and [Registration Form Fields](Registration-Form-Fields).
- An archived event keeps its settings. You can read them and copy the link, but you cannot change anything.

## Steps

**Check what registration needs**

1. Open the event, then **Registration**, then the **Access** tab.
2. Read the **Setup checklist**. Each row is one thing that registration needs. A row that is not done comes first, and it says what to do.
3. Put each missing row right. The table under **Important decisions** says where.
4. Come back to the tab. The checklist shows the settings that are saved, so save your changes first to see it update.

**Choose how guests get in**

1. Under **Way in**, choose **Link** or **Password**. An event has one way in at a time.
2. For **Password**, select **Set password**, type a password of 8 to 128 characters and select **Save password**. This is saved at once, apart from the **Save** button of the page.
3. Select **Save** at the bottom of the page.

**Choose what the form asks**

1. Under **Form**, switch on what you need: **Ask for the company**, **Ask for the department** or **Guests can bring one person**.
2. Switch **Waiting list** and **Confirm email addresses** off only when you do not need them.
3. Switch **Styled form boxes** on if you want the form to draw its own boxes instead of the browser's. See [Styled boxes](#styled-boxes).
4. Under **Extra consents**, tick each consent that guests must accept. The list holds the consents that you published on the **Legal** tab.
5. Select **Save**.

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

**Link or password**

| Way in | Who can open the form |
|---|---|
| **Link** | Anyone who has the link |
| **Password** | Anyone who has the link and types the event password |

- Both ways are protected by a bot check.
- You cannot read the password again after you save it. Keep a copy where you share it with guests.
- A new password does not change the requests that guests already sent.
- Choosing another way in and saving removes the password.

**Styled boxes**

By default the guest's browser draws the boxes of the form. With **Styled form boxes** on, the form draws its own, in the style of Admitto. For now that is the phone box, with a list of countries beside the number; date and time boxes stay the browser's. The switch is for the whole event, not for one question.

| Box | Switch off | Switch on |
|---|---|---|
| Phone | A one-line box | A button with a flag and a country code, a list of countries with a search box, and the number beside it |
| Date and time | The browser's boxes | The browser's boxes |

- A guest picks a country from the list, or types the number with a `+` and the country code. The answer is saved as the code and the digits, for example `+48500100200`.
- A phone question that asks for digits only, or sets a shortest or longest length, keeps the browser's box. A country code would break its rule. This suits a desk extension.
- The answers, the rules and the messages are the same with the switch on or off. Only the boxes differ.

**What each row of the checklist needs**

| Row | If it is not done |
|---|---|
| **Way in** | Choose **Link** or **Password** on this tab |
| **Way in allowed** | Ask a Superadmin to turn that way in on: Organisation settings > External services > Ways in |
| **Bot protection** | Ask a Superadmin to set up bot protection |
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

## What changes after this action

| Action | Result |
|---|---|
| **Save** | Only the settings you changed are saved. Each save is recorded in the audit log as "Guest registration settings changed", with the names of what changed and never a password |
| Turn registration on | The form opens at once. It is refused while a row of the checklist is not done |
| Change the way in or the consents of an event that is on | Refused while a row is not done, like turning on |
| Move between **Automatic** and **With approval** | The new mode applies to new requests |
| Switch **Styled form boxes** on or off | The next guest who opens the form gets the boxes you chose. A form that is already open keeps the boxes it has |
| Turn registration off | The form answers "not found" at once |
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
| There is no link under **Link for guests** | The address of the instance is not set. Ask a Superadmin |
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
