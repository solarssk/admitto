# @admitto/import

Attendee import for Admitto — CSV parsing, validation, and safe DB commit.

## Two import modes

| Mode | When | Key fields |
|------|------|-----------|
| **A** — Admitto generates QR | You provide the attendee list | `first_name`, `last_name`, `email` |
| **B** — Agency provides QR | Agency supplies identifiers | `external_uuid`, `qr_payload` (preserved as-is) |

Both modes can coexist in a single file.

## CLI

On a clean checkout, build workspace packages first (`npm run build` from the repo root, or an
explicit sequence such as `npm run build -w @admitto/db -w @admitto/tickets -w @admitto/import`).
`npm run build -w @admitto/import` alone does **not** build its dependencies. Then:

```bash
# Dry-run (default — no writes)
npm run import -w @admitto/import -- --event <eventId> --file attendees.csv

# Commit to DB
npm run import -w @admitto/import -- --event <eventId> --file attendees.csv --commit

# Allow updating existing attendees (presentation fields only)
npm run import -w @admitto/import -- --event <eventId> --file attendees.csv --commit --overwrite
```

The `import` script runs `tsx` against source; if you see `ERR_MODULE_NOT_FOUND` or `TS2307`, the
dependency `dist` trees are missing — run the build step above again.

## Canonical CSV columns

| Column | Required | Notes |
|--------|----------|-------|
| `email` | Yes | Validated; used as match key (Mode A) |
| `first_name` | Yes | |
| `last_name` | Yes | |
| `external_uuid` | No | Match key for Mode B; never overwritten |
| `qr_payload` | No | Agency QR payload; never overwritten |
| `ticket_type` | No | |
| `company` | No | |
| `department` | No | |

Headers are case-insensitive and trimmed.

## Overwrite semantics

- `overwrite=false` (default) — existing attendees are always skipped.
- `overwrite=true` — updates `name`, `first_name`, `last_name`, `ticket_type`, `company`, `department` only.
- Fields **never** overwritten regardless of mode: `status`, `qr_payload`, `external_uuid`, `token`.

## Programmatic API

```typescript
import { parseAttendees, commitImport } from "@admitto/import";

const { validRows, invalidRows, warnings } = parseAttendees(csvString);

const summary = await commitImport(eventId, validRows, {
  overwrite: false,
  dryRun: true,
});
```

## Security

- All test and sample data uses `@example.com` addresses — no real personal data.
- The `token` field is a Step-1 compatibility placeholder only; it is not suitable for QR generation, ticket URLs, mail sending, or check-in. Step 2 replaces it with the real token model.
