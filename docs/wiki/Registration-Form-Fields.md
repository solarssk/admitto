# Registration Form Fields

**Audience:** Event Managers · **Required role:** Administrator · **Feature status:** 🗺️ Planned · **Last verified:** Admitto 0.7.7

## What this page helps you do

Know what a guest sees and can enter for each kind of question on the registration form, and how the rules of a field show up there. The questions on the form are the custom attendee fields of the event that are switched on for the form.

The form opens for an event only when registration is turned on for it, on the **Access** tab. Until then, every address answers "not found". See [Registration Access](Registration-Access).

## Before you start

- Create the fields on the **Fields** tab of the event's **Registration** page, and switch **On the form** on for each question a guest should answer. See [Custom Attendee Fields](Custom-Attendee-Fields).
- First name, last name and email are always asked. Company and department are asked only when the event is set up to ask for them.
- When the event takes a companion, the form also asks for the companion's name and for your questions about a companion. See [A guest's companion](#a-guests-companion).
- The limits and the format rules of every type are in the [Validation Reference](Validation-Reference). This page shows what a guest meets.

## What a guest sees

| Type | What the guest gets | What the guest can enter |
|---|---|---|
| Text | A one-line box. A list of suggestions opens under it when the field has some | A short answer, up to 100 characters |
| Long text | A box four lines tall that can be pulled taller | Up to 1000 characters, with line breaks |
| Date | The browser's date picker | One day |
| Date and time | The browser's date and time picker | One day and a time on the clock |
| Phone | A one-line box. A phone opens its number keypad | 3 to 15 digits, with an optional `+` at the start |
| Single choice | A button that opens a list, with a search box past six options, as in the admin | One of your options |
| Yes / No | A tick box. A required one is a list of Yes and No instead, drawn like a single choice | Yes or No |

- The label is the question, so write it as a question. A star marks a required one.
- A guest cannot send the form until every required question is answered. A box that holds only spaces or empty lines counts as empty.

## Icons

A question can carry an icon. The organiser picks it from a fixed list (see the [Validation Reference](Validation-Reference)). Where it shows depends on the control:

| Question | Where the icon shows |
|---|---|
| Yes / No as a tick box | After the box, before the words |
| Text, Date, Date and time and Phone | Inside the box, on the left |
| Single choice, Long text and a required Yes / No | Nowhere. These controls have no place for one |

A tick box with no icon is the box and its words. When some tick boxes in a block have an icon, the words of the others line up with theirs. A ticked box is highlighted, and so is its icon.

## Questions that wait for another answer

A question can be asked only after another answer is given. For example, "Car registration number" can wait for the tick box "I will arrive by car".

What a guest sees:

1. The question is not on the page at first. It opens in a panel right under the tick box or the list it waits for: when the box is ticked, or when the guest picks the option the organiser named.
2. Every question that waits for one answer sits in that panel, in the order of the fields. Under a list, each question appears for its own option.
3. A question that is not shown is not required. Nothing the guest typed in it is sent.
4. A guest who clears the answer and gives it again finds what they had typed.

Admitto decides this on its own side too. If a changed form sends an answer for a question that is not shown, the answer is ignored and the guest sees no error.

A question that waits for a question that is not on the form is never shown. It is never required either, so it does not keep the form from opening.

## Suggestions

A Text question can have a list of suggestions, for example the usual dietary needs. What a guest sees:

- The list opens under the box when the guest taps it or comes to it, with every suggestion. Typing keeps the suggestions that contain the typed text, in any letter case, and marks the match in bold.
- The last row, `Use "..." as written`, offers the text as it was typed. It is not there when the typed text is a suggestion already.
- The keys work as in any list: the arrows move, Enter picks the highlighted row, Escape closes the list, Tab moves on to the next field.
- The list only helps. A guest can write any text, and Admitto never checks an answer against the list.
- A guest who picks a suggestion sends it exactly as written in the list. Any other text is sent as typed, like the answer to any Text question.

## The hint under a box

The line under a box can hold three things, in this order:

1. Your description of the field.
2. What the rules of the field ask.
3. For a date and time, the time zone.

Rules apply to **Text**, **Long text** and **Phone** fields. This is how they read on the form:

| Rule | What the guest reads |
|---|---|
| Minimum and maximum length | `3 to 6 characters.`, `Exactly 6 characters.`, `At least 20 characters.` or `Up to 500 characters.` |
| Digits only | `Digits only.`, or `3 to 6 digits.` when there is a length. On a phone, the number keypad opens |
| Example | `For example: 1234` |

The rules on the form are hints. The form does not stop a guest from sending because of a rule. Admitto checks every answer when it arrives, and the guest sees a message under the box that did not pass.

## Date and time

A guest's time is read as the clock at the event, in the time zone saved for the event. The hint says so: `Time in the event's time zone (Europe/Warsaw).` Admitto saves no time zone with the answer. When the event has no time zone saved, the hint names UTC.

The form does not send a date or a time that is only half filled. The guest sees `Enter a valid date.` or `Enter a valid date and time.` under the box, also when the question is optional.

## What the guest reads when an answer is not accepted

For a long text, a date, a date and time and a phone number, the form uses its own sentences. They never repeat what the guest typed.

| Under | Message |
|---|---|
| A required long text, left empty | `Answer this question.` |
| A required date, left empty | `Enter a date.` |
| A required date and time, left empty | `Enter a date and time.` |
| A required phone number, left empty | `Enter a phone number.` |
| A long text that was refused | `Check your answer. Use up to 1000 characters.` When the field has a length rule, the rule replaces the limit, for example `Use 20 to 500 characters.` |
| A phone number that was refused | `Enter a valid phone number.` When the field has a length rule, the rule follows, for example `Use 3 to 6 digits.` |
| A date or a date and time that was refused | `Enter a valid date.` or `Enter a valid date and time.` |

What the guest typed stays in the form, so the guest can correct it.

## A guest's companion

When the event takes a companion, the form has one more part after the questions, called **Your guest**. A guest who ticks **I am bringing a guest** opens a panel with:

| What | What the guest can enter |
|---|---|
| Full name | One box, required once the guest brings someone. Up to 100 characters, with no link and no email address |
| Your questions about a companion | The questions of the event that are about the companion and are on the form. They look and work like the guest's own questions, in the order of the fields |

- An event takes one companion at most.
- The companion takes a place of their own, so a guest with a companion needs two places. When only one is free, the registration goes on the waiting list. When the event has no waiting list, the guest is told that the event is full. A guest who comes alone is not affected.
- The panel stays closed until the guest ticks the row. What is closed is not checked and not sent. A guest who unticks the row sends no companion, and what they typed stays in the boxes in case they tick it again.
- A question about the companion can wait for another answer about the same companion. A question about the guest cannot wait for a question about the companion, and the other way round.
- What the guest typed about the companion is kept only in the registration, and is deleted with it.

What the guest reads when something about the companion is not accepted:

| Under | Message |
|---|---|
| The name, when empty | `Enter your guest's full name.` |
| The name, when refused | `Enter your guest's full name, up to 100 characters and without links.` |
| A question about the companion | The same sentences as for a question about the guest |
| The row **I am bringing a guest** | `This event does not take that many guests.` |

## When a guest sends the form

The guest sees `Check your inbox` with the address they typed. The page says the same whether the address is new or already registered, so nobody can use the form to find out who is on the list. A second form for an address that is registered changes nothing: the answers already saved are not replaced.

What Admitto does, in this order:

1. It checks the security check on the page. If it fails, the guest sees a message under the check and can try again.
2. It checks every answer, the companion's included, and shows what is wrong under each box. The guest has to accept the event terms.
3. It saves the registration, with the time the terms were accepted and the extra consents that were ticked.
4. It queues the mail for the registration. The mail is sent a little later, not while the guest waits.

A guest who sends the form twice at the same moment is registered once. An address that is an attendee already, or was rejected, gets the same page and nothing changes.

| What the guest sees | Why |
|---|---|
| `Check your inbox` | The form was accepted, or the address was registered already |
| A message under a box | The answer was not accepted. See above for the sentences |
| `Try again in a moment.` | Many guests are sending at once, the security check could not be made, or an import is running for the event |
| `Something went wrong. Check your details and try again.` | The event is full and has no waiting list, or the form closed while the guest was typing. Open the form yourself to see whether it opens |

## Common problems

| Problem | What it means and what to do |
|---|---|
| A guest sees "Check your answer" under a long text that is short | Text pasted from another program can hold invisible characters, such as a soft hyphen. Admitto refuses them. Ask the guest to type the text again, or to paste it as plain text |
| A guest sees "Enter a valid date" with a date typed in | One part of the date is still empty. Every part must be filled |
| A guest's time is an hour out | The guest may have entered their own local time. The time is read as the clock at the event. Check the time zone saved for the event, and say in the description which clock to use |
| The form says "not found" although registration is on | A required question that the form cannot show keeps it closed, for example a required Single choice field with no options. Add the options, or clear **Required** |
| A question never appears under the tick box or the list it waits for | The question it waits for must be on the form, and must be a Yes / No or a Single choice field. For a list, the condition must name an option that exists, written exactly |
| A field has suggestions, but the guest sees no list | Suggestions fit Text fields only. Check that the field is a Text field, and that its own condition is met |
| A field has an icon, but the guest sees none | A Single choice, a Long text and a required Yes / No have no place for an icon |
| The form has no part for a companion | Only an event that takes a companion shows it. A required question about the companion that the form cannot show (for example a required single choice with no options) also leaves the part out. The rest of the form stays open |
| A guest registered but got no mail | Admitto sends at most 3 registration mails a day to one address, and a daily number of mails for one event (1000, or 3 per seat if that is more). Over the limit the registration is saved without its mail. Ask the administrator of the system to raise the limit |

## Related pages

- [Custom Attendee Fields](Custom-Attendee-Fields)
- [Validation Reference](Validation-Reference)
- [Legal Texts and Consents](Legal-Texts-and-Consents)
- [Event Overview and Settings](Event-Overview-and-Settings)
