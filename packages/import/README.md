# @admitto/import

Attendee import for Admitto - CSV parsing, validation, and safe DB commit.

## Two import modes

| Mode | When | Key fields |
|------|------|-----------|
| **A** - Admitto generates QR | You provide the attendee list | `first_name`, `last_name`, `email` |
| **B** - Agency provides QR | Agency supplies identifiers | `external_uuid`, `qr_payload` (preserved as-is) |

Both modes can coexist in a single file.

## CLI

On a clean checkout, build workspace packages first (`npm run build` from the repo root, or an
explicit sequence such as `npm run build -w @admitto/shared -w @admitto/crypto -w @admitto/db -w @admitto/location -w @admitto/wallet -w @admitto/mail-templates -w @admitto/tickets`, then `npm run build -w @admitto/import`).
`npm run build -w @admitto/import` alone does **not** build its dependencies. Then:

```bash
# Dry-run (default - no writes)
npm run import -w @admitto/import -- --event <eventId> --file attendees.csv

# Commit to DB
npm run import -w @admitto/import -- --event <eventId> --file attendees.csv --commit

# Allow updating existing attendees (presentation fields only)
npm run import -w @admitto/import -- --event <eventId> --file attendees.csv --commit --overwrite
```

The `import` script runs `tsx` against source; if you see `ERR_MODULE_NOT_FOUND` or `TS2307`, the
dependency `dist` trees are missing - run the build step above again.

## Canonical CSV columns

| Column | Required | Notes |
|--------|----------|-------|
| `email` | Yes | Validated; also the fallback match key (after `external_uuid` / `qr_payload`) |
| `first_name` | Yes | |
| `last_name` | Yes | |
| `external_uuid` | No | Match key for Mode B; never overwritten |
| `qr_payload` | No | Agency QR payload; also a match key; never overwritten |
| `ticket_type` | No | Must match one of the event's ticket types (case-insensitive, stored as the canonical key); an unknown value makes the row invalid |
| `company` | No | |
| `department` | No | |

Headers are case-insensitive and trimmed. Existing attendees are matched by `external_uuid` / `qr_payload` first, then by email; a row whose identifiers point at different attendees is skipped as conflicting. A duplicate `email`, `external_uuid` or `qr_payload` within one file marks the later row invalid. Unknown columns are ignored with a warning. Event attribute (custom data) columns are recognised only when the caller passes `attributeFields` (the admin API does; the CLI does not, so they are ignored there).

## Overwrite semantics

- `overwrite=false` (default) - existing attendees are always skipped.
- `overwrite=true` - updates `name`, `first_name`, `last_name`, `ticket_type`, `company`, `department` and merges `custom_data` values only.
- Fields **never** overwritten regardless of mode: `status`, `qr_payload`, `external_uuid`, `token_hash`.

## Programmatic API

```typescript
import { parseAttendees, commitImport } from "@admitto/import";

const { validRows, invalidRows, warnings } = parseAttendees(csvString, { attributeFields, ticketTypes });

const summary = await commitImport(eventId, validRows, {
  overwrite: false,
  dryRun: true,
});
```

`parseAttendees(csv, { attributeFields?, ticketTypes? })` and `commitImport(eventId, rows, { overwrite?, dryRun?, ownedTransaction?, attributeFields?, ticketTypes?, timezone? }, db?)` take more options than the example shows. The package also exports what the admin API and the worker use: `executeImportCommit` / `dryRunImportCounts` (capacity-aware commit, throws `ImportCapacityExceededError`), `loadImportTicketTypes`, `drainImportJobs` (processes queued `import_commit` jobs whose CSV was staged through `@admitto/storage`) and `reclaimStaleImportJobs`.

## Security

- All test and sample data uses `@example.com` addresses - no real personal data.
- Import never creates or overwrites ticket tokens. Mode A attendees are created without a token and receive one (`token_hash` plus the encrypted `token_enc`) when their ticket is issued by `@admitto/tickets`; Mode B rows get a random `public_ref` at creation.
