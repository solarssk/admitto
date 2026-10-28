# Legal Texts and Consents

**Audience:** Event Managers · **Required role:** Administrator · **Feature status:** 🗺️ Planned · **Last verified:** Admitto 0.7.7

## What this page helps you do

Write, publish and copy the texts that guests read before they register for an event: the privacy notice, the event terms and any extra consents. You do this on the **Legal** tab of the event's **Registration** page, which is in the event menu.

## Before you start

- Every event has its own texts. Nothing is shared between events, so each event can say something different.
- You write the words. Admitto does not provide texts and does not check what they say.
- Guests can read a text only after you publish it. Registration cannot be turned on until the privacy notice and the event terms are published.

## Steps

**Write the privacy notice or the event terms**

1. Open the event, then **Registration**, then the **Legal** tab.
2. Select **Write** next to **Privacy notice** or **Event terms**. Select **Edit** for a text that already exists.
3. Check the title. It is the heading of the page that guests read.
4. Write the text. The toolbar has a heading, a subheading, bold, a bulleted list, a numbered list and a link.
5. To add a link, select the words, choose the link button, type the address and select **Apply**. A link can be a web address (`https://example.com`) or an email address.
6. Select **Save**.
7. Select **Publish** when the text is ready. Select **View the public page** to see what guests see.

**Add an extra consent**

1. Select **Add consent**.
2. Enter a key, such as `photo-consent`. It is part of the page address and cannot be changed later.
3. Enter the checkbox label. Guests read it next to the checkbox.
4. Write the text, select **Save**, then **Publish**.
5. To make the form ask for the consent, choose it under **Extra consents** on the **Access** tab. See [Registration Access](Registration-Access).

**Copy the texts of another event**

1. Select **Copy from another event**.
2. Choose the event. You must be able to manage it.
3. Read what will happen to each text.
4. Select **Copy texts**.

## Expected result

Each text has its own public page, and the list shows whether it is **Published**, a **Draft** or **Not written**. A published text can be opened from the **Public page** link in its row.

## Important decisions

**There is one version of each text**

- Saving a published text changes the page that guests read at once.
- Admitto keeps no earlier versions. If you need an old version, keep it in a document of your own and link to it from the text.

**The editor keeps only four things**

- Headings, bold, lists and links are kept. When you paste from a document or a web page, other formatting (italics, quotes, tables, images) is dropped and the words stay.
- Admitto cleans the text again when you save it. If it changes something, a notice says so and the editor shows the text as it was saved.
- If a saved text has formatting the editor cannot show, a notice says so when you open it. Saving removes that formatting.

**Copying replaces texts**

- A text in the other event replaces the text with the same name here. A new text starts as a draft.
- A text that is published here stays published, with the copied words, so guests read the copy at once.
- Texts that only exist here are not touched. The consents that the form asks for are not copied.

**Some texts cannot be taken away**

- While registration is on, a text it needs cannot be unpublished or deleted. Turn registration off first.
- An archived event keeps its texts, and you can read them, but you cannot change them.

## What changes after this action

| Action | Result |
|---|---|
| **Save** | The text replaces the one that was saved before. A published text changes on its public page. |
| **Publish** | Guests can open the public page. |
| **Unpublish** | The public page stops working. The text stays in the list as a draft. |
| **Delete** | The text is removed for good, and its page stops working. |
| **Copy texts** | The texts are saved here one after another, like your own saves. |

## Common problems

| Problem | What to do |
|---|---|
| **Publish** is grey | The text has unsaved changes. Save it first. |
| "There is no text left to save once unsupported formatting is removed" | Write some words before you save. |
| A link is refused | Use an address that starts with `http://` or `https://`, or an email address. Other kinds of link, such as phone numbers, are not allowed. |
| "Registration is on for this event and needs this text" | Turn registration off, then unpublish or delete the text. |
| "This event has reached its limit of extra consents" | Delete a consent you do not use, or reuse one. |
| "Copied 1 of 3 texts, then it stopped" | Run the copy again. Copying the same texts twice does no harm. |
| The texts could not be loaded | Select **Retry**. If it keeps failing, check **System logs**. |

## Related pages

- [Custom Attendee Fields](Custom-Attendee-Fields)
- [Event Overview and Settings](Event-Overview-and-Settings)
- [Roles and Permissions](Roles-and-Permissions)
- [Reports and Archiving](Reports-and-Archiving)
