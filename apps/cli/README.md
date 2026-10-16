# @admitto/cli

Unified `admitto` binary for ops that should not depend on the staff SPA being up: background **worker**, auth break-glass, check-in failover, retention, and branding storage GC.

## Run

```bash
# Build this package and its workspace dependencies first
npm run cli -w @admitto/cli -- <namespace> <command> …

# Examples
npm run cli -w @admitto/cli -- worker
npm run cli -w @admitto/cli -- auth reset-mfa --email admin@example.com
npm run cli -w @admitto/cli -- storage gc --operator-email admin@example.com --dry-run
```

In production Compose the worker is a separate service (`command: worker`). Locally: `npm run worker` from the monorepo root (same entry).

## Command groups

| Namespace | Typical use |
|-----------|-------------|
| `worker` | Long-running background jobs (see below) |
| `auth` | Bootstrap superadmin, reset MFA, emergency recovery codes |
| `checkin` / `attendees` / `mail` / `sessions` | Event-day failover when the UI is unreachable |
| `attendees find` | Read-only lookup of the ids a privacy request needs |
| `attendees erase` | Break-glass privacy request |
| `retention` | Manual retention run |
| `storage` | Orphan branding file GC |

**`worker`** is long-running. It drains the mail queue, import/export jobs, bounce ingest, wallet sync, the event-wide wallet jobs (push, message, refresh status, void and remove clean-up), wallet pass expiry, and retention.

**`attendees find`** (`attendees find --query "<name or email>" [--event <id>] [--format json]`)

- It looks up the ids that a privacy request needs.
- It lists up to 20 people, in every event unless `--event` is given, and not those already erased.
- It shows the event id and title and the attendee's id and address.
- Unlike `checkin lookup`, it also works for an archived event.

**`attendees erase`** (`attendees erase --event <id> --attendee-ids <id[,id...]> --operator-email <email> [--dry-run] [--yes]`)

- It is audit-logged and takes up to 500 ids.
- It erases the attendees' personal data like the erase API does. It also deletes the files that the event's exports and imports left in storage, and the attendees' wallet passes at the provider.
- It exits with 2 when a pass is still there (run it again).

**`retention`** (`retention run --operator-email <email> [--dry-run]`)

- It is audit-logged.
- It covers:
  - auth sessions and trusted devices
  - mail delivery snapshots
  - the security audit log
  - notifications
  - the files that export and import jobs leave in storage (a file that no job names too, once it is a day old)
  - the wallet passes of erased attendees that are still at the provider
- The worker runs the same pass on its own schedule (once at boot, then about every 24h).

Full usage text: `admitto --help` (see `src/lib/usage.ts`; running `admitto` with no arguments prints it too but exits with code 1). Production failover notes: [deploy/README.md](../../deploy/README.md#emergency-cli-event-day-failover).

## Build

```bash
npm run build -w @admitto/cli
# or: npm run precli -w @admitto/cli   # builds dependency workspaces + this package
```

Do not run via `tsx src/…` against unbuilt workspace packages; use the compiled `node dist/…` entry (same rule as other monorepo CLIs).
