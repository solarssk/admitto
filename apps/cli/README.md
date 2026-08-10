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
| `worker` | Drain mail queue, import/export jobs, bounce ingest, retention (long-running) |
| `auth` | Bootstrap superadmin, reset MFA, emergency recovery codes |
| `checkin` / `attendees` / `mail` / `sessions` | Event-day failover when the UI is unreachable |
| `retention` | Scheduled data retention pass |
| `storage` | Orphan branding file GC |

Full usage text: `admitto` with no args (see `src/lib/usage.ts`). Production failover notes: [deploy/README.md](../../deploy/README.md#emergency-cli-event-day-failover).

## Build

```bash
npm run build -w @admitto/cli
# or: npm run precli -w @admitto/cli   # builds dependency workspaces + this package
```

Do not run via `tsx src/…` against unbuilt workspace packages; use the compiled `node dist/…` entry (same rule as other monorepo CLIs).
