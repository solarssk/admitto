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
| `worker` | Drain mail queue, import/export jobs, bounce ingest, wallet sync, the event-wide wallet jobs (push, message, refresh status, void and remove clean-up), wallet pass expiry, retention (long-running) |
| `auth` | Bootstrap superadmin, reset MFA, emergency recovery codes |
| `checkin` / `attendees` / `mail` / `sessions` | Event-day failover when the UI is unreachable |
| `retention` | Manual retention run (`retention run --operator-email <email> [--dry-run]`, audit-logged): auth sessions and trusted devices, mail delivery snapshots, the security audit log, notifications, the files that export and import jobs leave in storage, and the wallet passes of erased attendees that are still at the provider. The worker runs the same pass on its own schedule (once at boot, then about every 24h) |
| `storage` | Orphan branding file GC |

Full usage text: `admitto --help` (see `src/lib/usage.ts`; running `admitto` with no arguments prints it too but exits with code 1). Production failover notes: [deploy/README.md](../../deploy/README.md#emergency-cli-event-day-failover).

## Build

```bash
npm run build -w @admitto/cli
# or: npm run precli -w @admitto/cli   # builds dependency workspaces + this package
```

Do not run via `tsx src/…` against unbuilt workspace packages; use the compiled `node dist/…` entry (same rule as other monorepo CLIs).
