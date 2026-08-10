# @admitto/storage

File storage for **branding assets** (org/event logos, headers, theme fonts). Implements ADR 0008: local filesystem first; S3-shaped adapter interface for a later cut.

## What lives here

| Piece | Role |
|-------|------|
| `StorageAdapter` | `put` / `get` / `delete` / `exists` / `list` |
| `createStorage` / `getDefaultStorage` | Wire the local adapter from env (`UPLOAD_DIR`, etc.) |
| GC helpers | Collect keys still referenced in the DB; sweep orphans (`admitto storage gc`) |

Paths are scoped per organisation (`org` / `event` / `theme`). Public HTTP serving of uploads is owned by `apps/web` (branding MIME types only).

## Not in this package

- Attendee CSV/PDF export files (job storage elsewhere)
- Mail attachments
- Geocoding / map tile bytes (`@admitto/location` + `apps/web` maps routes)

## Build / CLI

```bash
npm run build -w @admitto/storage
npm run cli -w @admitto/cli -- storage gc --operator-email you@example.com --dry-run
```

See also [apps/cli/README.md](../../apps/cli/README.md).
