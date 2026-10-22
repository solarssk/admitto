# Registration Form Fields

**Audience:** Event Managers · **Required role:** Administrator · **Feature status:** 🗺️ Planned · **Last verified:** Admitto 0.7.7

## What this page helps you do

Know what a guest sees and can enter for each kind of question on the registration form, and how the rules of a field show up there. The questions on the form are the custom attendee fields of the event that are switched on for the form.

Guests cannot open the form yet. It opens for an event only when registration is turned on for it. Until then, every address answers "not found".

## Before you start

- Create the fields on the **Fields** tab of the event's **Registration** page, and switch **On the form** on for each question a guest should answer. See [Custom Attendee Fields](Custom-Attendee-Fields).
- First name, last name and email are always asked. Company and department are asked only when the event is set up to ask for them.
- The limits and the format rules of every type are in the [Validation Reference](Validation-Reference). This page shows what a guest meets.

## What a guest sees

| Type | What the guest gets | What the guest can enter |
|---|---|---|
| Text | A one-line box | A short answer, up to 100 characters |
| Long text | A box four lines tall that can be pulled taller | Up to 1000 characters, with line breaks |
| Date | The browser's date picker | One day |
| Date and time | The browser's date and time picker | One day and a time on the clock |
| Phone | A one-line box. A phone opens its number keypad | 3 to 15 digits, with an optional `+` at the start |
| Single choice | A list | One of your options |
| Yes / No | A tick box. A required one is a list of Yes and No instead | Yes or No |

- The label is the question, so write it as a question. A star marks a required one.
- A guest cannot send the form until every required question is answered. A box that holds only spaces or empty lines counts as empty.

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

## Common problems

| Problem | What it means and what to do |
|---|---|
| A guest sees "Check your answer" under a long text that is short | Text pasted from another program can hold invisible characters, such as a soft hyphen. Admitto refuses them. Ask the guest to type the text again, or to paste it as plain text |
| A guest sees "Enter a valid date" with a date typed in | One part of the date is still empty. Every part must be filled |
| A guest's time is an hour out | The guest may have entered their own local time. The time is read as the clock at the event. Check the time zone saved for the event, and say in the description which clock to use |
| The form says "not found" although registration is on | A required question that the form cannot show keeps it closed, for example a required Single choice field with no options. Add the options, or clear **Required** |

## Related pages

- [Custom Attendee Fields](Custom-Attendee-Fields)
- [Validation Reference](Validation-Reference)
- [Legal Texts and Consents](Legal-Texts-and-Consents)
- [Event Overview and Settings](Event-Overview-and-Settings)
