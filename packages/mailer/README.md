# @admitto/mailer

One interface for sending email, four interchangeable transports. The rest of Admitto
calls `mailer.send(message)` without knowing which transport is active — the choice
is a configuration concern (ultimately from the UI Settings screen).

```text
            ┌─────────────────────────────┐
  Admitto → │  createMailer(config)        │ →  MailerAdapter.send(MailMessage)
            └─────────────────────────────┘
                 │ provider = ...
     ┌───────────┼─────────────┬──────────────────┬─────────────┐
     ▼           ▼             ▼                  ▼             ▼
  graph        smtp        powerautomate       export_only    (mock — tests)
```

## Transport status

| Provider | Status | Notes |
|---|---|---|
| `powerautomate` | ready | HTTP trigger is a premium licence |
| `smtp` | ready | Generic SMTP relay (DuoCircle, Postfix, etc.) with pooling + rate limits |
| `graph` | built, not live-tested | App-only `Mail.Send`; tests use mocked fetch |
| `export_only` | ready | No send — **requires** `exportSink` in `createMailer` deps for real persistence; without it, messages are only marked `accepted` |

## Usage

```ts
import { createMailer, sendBatch, type MailMessage } from "@admitto/mailer";

const mailer = createMailer({
  provider: "powerautomate",
  url: process.env.POWER_AUTOMATE_URL!,
  key: process.env.POWER_AUTOMATE_KEY,
  fromAddress: process.env.MAIL_FROM_ADDRESS!,
  fromName: process.env.MAIL_FROM_NAME,
});

const res = await mailer.send({
  to: "jan@example.com",
  subject: "Your ticket",
  html: "<p>Hi Jan, ...</p>",
});
// res: { status: "accepted"|"sent"|"failed"|"rejected", provider, retryable?, ... }

const summary = await sendBatch(mailer, messages, { concurrency: 3 });
```

Each adapter exposes `capabilities` so callers never assume Graph-like Sent Items behaviour.

## Configuration

`MailerConfig` is a zod discriminated union on `provider`. Build from env via `configFromEnv()`.
See `.env.example` for `EMAIL_PROVIDER`, `MAIL_FROM_*`, `SMTP_*`, `GRAPH_*`, `POWER_AUTOMATE_*`.

| provider | key fields |
|---|---|
| `graph` | `mailbox`, `tenantId`, `clientId`, `clientSecret`, sender fields, `saveToSentItems?` |
| `smtp` | `host`, `port`, `user`, `password`, sender fields, TLS + throughput options |
| `powerautomate` | `url`, `key?`, sender fields |
| `export_only` | sender fields only |

### SMTP rate limit

`rateLimitPerMinute` maps to nodemailer `rateLimit` + `rateDelta: 60000` (messages per minute).

## CLI (manual test send)

Copy `.env.example` → `.env`, set `EMAIL_PROVIDER` and transport fields. Then:

```bash
npm run send -- --to someone@example.com
npm run send -- --csv recipients.csv          # columns: email,first_name
```

## Tests

```bash
npm install      # from admitto/ root (workspaces)
npm test -w @admitto/mailer
```

All tests use mocked fetch / `jsonTransport` — no real network.

## Graph API references

- user: sendMail — https://learn.microsoft.com/en-us/graph/api/user-sendmail
- client credentials — https://learn.microsoft.com/en-us/entra/identity-platform/v2-oauth2-client-creds-grant-flow
- send from shared mailbox — https://learn.microsoft.com/en-us/graph/outlook-send-mail-from-other-user
