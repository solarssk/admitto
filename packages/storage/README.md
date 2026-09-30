# @admitto/storage

File storage for **branding assets** (org/event logos, headers, theme fonts) and for the transient files of import and export jobs. Implements ADR 0008: local filesystem first; S3-shaped adapter interface for a later cut.

## What lives here

| Piece | Role |
|-------|------|
| `StorageAdapter` | `put` / `get` / `delete` / `exists` / `list` |
| `createStorage` / `getDefaultStorage` | Build the local adapter from env: `STORAGE_PROVIDER` (default `local`; `s3` is reserved and throws at startup, as does any unknown value) and `UPLOAD_DIR` (default `./uploads` relative to the process working directory; `/app/uploads` in the compose files) |
| GC helpers | Collect the branding keys still referenced in the DB (org / event logos and headers, event image assets, theme fonts, mail template bodies) and sweep the rest (`admitto storage gc`). Objects younger than 48 hours are never deleted, and each key is re-checked just before it is deleted |

Paths are scoped per organisation (`org` / `event` / `theme`). Public HTTP serving of uploads is owned by `apps/web` (branding MIME types only).

Import CSV uploads and attendee export files (CSV / PDF / XLSX) are also written through this adapter, in the event scope under the same `UPLOAD_DIR`, by the import and export job drains. They are not managed branding keys, so `list()` and `storage gc` skip them and the public `/uploads` route never serves them. Keep that in mind when sizing or backing up `UPLOAD_DIR`.

## Not in this package

- Mail attachments
- Geocoding / map tile bytes (`@admitto/location` + `apps/web` maps routes)

## Build / CLI

```bash
npm run build -w @admitto/storage
npm run cli -w @admitto/cli -- storage gc --dry-run
npm run cli -w @admitto/cli -- storage gc --operator-email you@example.com   # real run; the operator is recorded in the audit log
```

See also [apps/cli/README.md](../../apps/cli/README.md).
