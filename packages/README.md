# Shared packages

Libraries used by `apps/web`, `apps/admin`, and `apps/cli`. Each package keeps `"version": "0.0.1"` and is linked via npm workspaces. Product version lives at the monorepo root (see [VERSIONING.md](../VERSIONING.md)).

Build a package (and usually its dependents) with:

```bash
npm run build -w @admitto/<name>
```

Consumers import from compiled `dist/` (`"@admitto/foo": "*"`), not from `src/`.

| Package | Role |
|---------|------|
| [`auth`](auth/README.md) | Sessions, MFA (TOTP), OIDC, Cloudflare Access, RBAC |
| [`crypto`](crypto/README.md) | AES-256-GCM for secrets and ticket tokens at rest |
| [`db`](db/README.md) | Prisma schema and PostgreSQL client |
| [`import`](import/README.md) | CSV/XLSX attendee import (parse, validate, commit) |
| [`location`](location/README.md) | Event venue types, validation, map deep links |
| [`mail-delivery`](mail-delivery/README.md) | Ticket send pipeline, delivery rows, bounce ingest |
| [`mail-templates`](mail-templates/README.md) | MJML/HTML compile and render for mail |
| [`mailer`](mailer/README.md) | Transports: Graph, SMTP, Power Automate |
| [`mailer-config`](mailer-config/README.md) | Which transport applies for org/event (env > event > org) |
| [`shared`](shared/README.md) | Tiny dependency-free helpers |
| [`storage`](storage/README.md) | Branding uploads (local FS today; S3 later) and orphan GC |
| [`tickets`](tickets/README.md) | QR tokens, issuance, check-in validation |
| [`ui`](ui/README.md) | Shared React components and Tabler-flavoured tokens |
