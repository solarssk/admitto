# @admitto/mailer-config

Resolves **which mail transport and fields** apply for a given org/event scope. Precedence: **env > event > org > default** (ADR 0002). Produces a `MailerConfig` consumed by `@admitto/mailer` and described for the admin UI.

## Exports

```ts
import {
  resolveMailConfig,
  describeMailConfig,
  setMailSettings,
  rawMailFieldsFromEnv,
} from "@admitto/mailer-config";
```

| Function | Purpose |
|----------|---------|
| `resolveMailConfig(scope, prisma, env?)` | Full config for sending — decrypts secrets via `ENCRYPTION_KEY` |
| `describeMailConfig(scope, prisma, env?)` | Masked read-only view for admin/settings (no plaintext secrets) |
| `setMailSettings(scope, input, prisma)` | Persist org/event overrides |
| `rawMailFieldsFromEnv(env?)` | Bootstrap fields from deployment env (`EMAIL_PROVIDER`, SMTP/Graph/PA vars) |

## Providers

Resolved `provider` is one of: `export_only`, `powerautomate`, `smtp`, `graph` — same set as `@admitto/mailer`.

## Tests

```bash
npm run db:test-setup   # from repo root
npm test -w @admitto/mailer-config
```

Higher-level send orchestration (ticket render, dedup, `EmailDelivery` rows) lives in `@admitto/mail-delivery`.
