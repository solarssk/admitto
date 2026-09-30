# @admitto/mailer-config

Resolves **which mail transport and fields** apply for a given org/event scope. Precedence is per field: **env > event > org > default** (ADR 0002); the provider is resolved first and only fields valid for it are merged. Stored secrets are decrypted lazily (a secret supplied by env does not need `ENCRYPTION_KEY`). If an `allowed_from_domain` is set (database only, no env var), the resolved from address (Graph: the mailbox) must be in that domain or resolution throws. Produces a `MailerConfig` consumed by `@admitto/mailer` and described for the admin UI.

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
| `resolveMailConfig(eventId, prisma, env?)` | Full config for sending - decrypts secrets via `ENCRYPTION_KEY` |
| `resolveMailConfigForOrg(organizationId, prisma, env?)` | Org-scoped resolve for instance Settings (no event layer) |
| `describeMailConfig(eventId, prisma, env?)` | Masked read-only view for admin/settings (no plaintext secrets) |
| `describeMailConfigForOrg(organizationId, prisma, env?)` | Org-scoped masked describe for instance Settings |
| `setMailSettings(scope, input, prisma)` | Persist org/event overrides |
| `rawMailFieldsFromEnv(env)` | Bootstrap fields from deployment env (`EMAIL_PROVIDER`, SMTP/Graph/PA vars); `env` is required |
| `describeMailConfigForOrgWizard(organizationId, prisma)` | First-run wizard describe: database and defaults only, env placeholders do not lock the form |
| `validateOrgMailSettingsUpdate` / `validateEventMailSettingsUpdate` | Pre-save validation of an update |
| `tryParseOrgMailConfigFromRow` / `tryParseEventMailConfigFromRow` | Non-throwing pre-save parse of the effective config |
| `MailConfigError` | Thrown by `resolveMailConfig*`; code `mail_secret_decryption_failed` when a stored secret cannot be decrypted (a wrong or rotated `ENCRYPTION_KEY`) |

## Providers

Resolved `provider` is one of: `export_only`, `powerautomate`, `smtp`, `graph` - same set as `@admitto/mailer`.

## Tests

```bash
npm run db:test-setup   # from repo root
npm test -w @admitto/mailer-config
```

Higher-level send orchestration (ticket render, dedup, `EmailDelivery` rows) lives in `@admitto/mail-delivery`.
