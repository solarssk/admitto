# Mail Delivery Administration

> **Audience:** Superadmins
> **Required role:** Superadmin for organisation transport; Superadmin for event Mailing settings
> **Feature status:** Available
> **Last verified:** Admitto 0.4.12

## What this page helps you do

Select, test, and troubleshoot the supported mail transport used by event messages.

## Before you start

Obtain approved provider details through your organisation's secure process. Do not paste secrets into issues, screenshots, or this Wiki.

## How Admitto chooses a transport

```mermaid
flowchart TD
    start[Send an event message] --> override{Dedicated event transport configured?}
    override -- Yes --> event[Use event transport]
    override -- No --> organisation[Use organisation transport]
    event --> provider{Selected provider}
    organisation --> provider
    provider -- SMTP --> smtp[SMTP delivery]
    provider -- Microsoft Graph --> graph[Microsoft Graph delivery]
    provider -- Power Automate --> automate[Power Automate delivery]
    smtp --> record[Create delivery record]
    graph --> record
    automate --> record
```

An event uses its dedicated transport only when one is configured. Otherwise, it uses the organisation transport. Every send creates a delivery record.

| Transport | Connection model | Important configuration |
|---|---|---|
| SMTP | Direct mail server connection | Host, port, credentials, and sender |
| Microsoft Graph | Microsoft 365 application-only sending | Application credentials and mailbox |
| Power Automate | Webhook-based delivery | Flow URL and secret key |

## Steps

1. Open **Organisation settings**, then **Mail**.
2. Select the supported transport: **SMTP**, **Microsoft Graph**, or **Power Automate**.
3. Enter the fields required by the selected transport. Secret fields show only whether a value is configured.
4. Save the transport.
5. Send a transport test to an approved test address.
6. For an event that must use a different transport, open **Event settings**, then **Mailing**, and choose a dedicated configuration.
7. Test the event transport before sending an event template.

## Expected result

The test reports the selected provider and a successful send. Event templates then use the event transport when configured, otherwise the organisation transport.

## Important decisions

- SMTP is offered as the recommended general transport in the UI.
- Microsoft Graph uses application-only sending and a configured mailbox.
- Power Automate uses a configured webhook. Its URL and key are secrets.
- Returning an event to organisation settings removes its dedicated override.
- A successful transport test does not validate an event template; send a template test too.

## What changes after this action

Future test and attendee messages use the newly effective transport. Existing delivery records keep their recorded status and provider result.

## Common problems

- **Test failed:** recheck required fields and use the safe error shown by Admitto; do not publish raw provider responses.
- **The wrong sender is used:** verify organisation versus event scope and the provider's mailbox/from settings.
- **Event mail fails while the organisation test works:** inspect the event's dedicated override.

## Related pages

- [Email Templates](Email-Templates)
- [Email Delivery Statuses](Email-Delivery-Statuses)
- [Logs and Audit](Logs-and-Audit)
