# @admitto/mailer

One interface for sending email, three interchangeable transports. The rest of Admitto
calls `mailer.send(message)` without knowing which transport is active — the choice
is a configuration concern (ultimately from the UI Settings screen).

```text
            ┌─────────────────────────────┐
  Admitto → │  createMailer(config)        │ →  MailerAdapter.send(MailMessage)
            └─────────────────────────────┘
                 │ provider = ...
     ┌───────────┼─────────────┬──────────────────┐
     ▼           ▼             ▼                  ▼
  graph        smtp        powerautomate       (mock — tests/preview)
```

## Transport status

| Provider | Status | Notes |
|---|---|---|
| `powerautomate` | ready | HTTP trigger is a premium licence; a free-tier variant (OneDrive file-drop) is a separate adapter for later |
| `smtp` | ready | SMTP AUTH may be disabled by your organisation's M365 policy; works immediately with any standard mail server |
| `graph` | built, not live-tested | requires app registration (app-only `Mail.Send`); covered by tests with mocked fetch |

## Usage

```ts
import { createMailer, sendBatch, type MailMessage } from "@admitto/mailer";

const mailer = createMailer({
  provider: "powerautomate",
  url: process.env.MAILER_PA_URL!,
  key: process.env.MAILER_PA_KEY,
});

const res = await mailer.send({
  to: "jan@example.com",
  subject: "Your ticket",
  html: "<p>Hi Jan, ...</p>", // Admitto renders the final HTML (QR, Wallet) BEFORE sending
});
// res: { status: "sent" | "failed", provider, providerMessageId?, error? }

// Batch send with bounded concurrency and per-recipient status:
const summary = await sendBatch(mailer, messages, {
  concurrency: 3,
  onResult: (r, m) => console.log(m.to, r.status),
});
```

Dedup/idempotency is the caller's responsibility (send only messages without a `sent` status).
The `idempotencyKey` field in `MailMessage` is used for log correlation.

## Configuration

`MailerConfig` is a zod discriminated union on `provider` — the same schema validates
both the UI form and the backend. See `.env.example`. Build a config from env via `configFromEnv()`.

| provider | fields |
|---|---|
| `graph` | `tenantId, clientId, clientSecret, sender, saveToSentItems?` |
| `smtp` | `host, port?(587), secure?(false), user, password, from` |
| `powerautomate` | `url, key?` |

## CLI (manual test send)

Copy `.env.example` → `.env`, set `MAILER_PROVIDER` and the transport fields. Then:

```bash
npm run send -- --to someone@example.com
npm run send -- --csv recipients.csv          # columns: email,first_name
```

## Tests

```bash
npm install      # from admitto/ root (workspaces)
npm test
```

20 tests (config, factory, batch, 3 adapters) — all with mocked fetch / `jsonTransport`,
no real network. `graph` and `powerautomate` adapters accept injectable `fetchFn`; `smtp`
accepts an injectable transporter.

## Graph API references

- user: sendMail — https://learn.microsoft.com/en-us/graph/api/user-sendmail
- client credentials — https://learn.microsoft.com/en-us/entra/identity-platform/v2-oauth2-client-creds-grant-flow
- send from shared/delegated mailbox — https://learn.microsoft.com/en-us/graph/outlook-send-mail-from-other-user
