# @admitto/tickets

Ticket domain logic - token generation, hashing, QR payloads, issuance, and check-in validation (ADR 0001).

## Two ticket modes

| Mode | Who provides the QR | Storage |
|------|---------------------|---------|
| **A** - Admitto-issued | Admitto generates token + URL | `token_hash` + encrypted `token_enc` |
| **B** - Agency | Agency supplies `external_uuid` + `qr_payload` | Payload preserved as-is; no Admitto token |

## Key exports

```ts
import {
  issueTicket,
  issueTicketsForEvent,
  resolveTicket,
  buildTicketUrl,
  generateQrPng,
  checkInScan,
  hashToken,
} from "@admitto/tickets";
```

- **`issueTicket` / `issueTicketsForEvent`** - create Mode A tokens for attendees missing them
- **`resolveTicket`** - lookup by full ticket URL or raw token (Mode A), or, when `context.eventId` is given, by agency `qr_payload` / `external_uuid` (Mode B) for check-in scans and the `/t/:token` page. Agency ticket pages and mail links use the `public_ref` routes `/t/<eventSlug>/a/<ref>` and `/q/<eventSlug>/a/<ref>.png`, resolved in `apps/web`
- **`buildTicketUrl`** - `BASE_URL` + `/t/<token>` (never derived from request `Host`)
- **`checkInScan(params, prisma)`** - resolve the scanned value and either record the check-in or, when the event requires confirmation on scan, return a preview. Returns `CheckInScanResult`: `VALID`, `ALREADY_CHECKED_IN`, `REVOKED`, `INVALID`, or `PREVIEW` (nothing is recorded until `admitAttendee` is called)

The package root also exports attendee list filtering and export (CSV / PDF / XLSX), notes, per-item states, undo / revoke, the ticket-type catalog, event custom fields, the ops and admin audit writers, and the worker's AdminJob drains (export, wallet push, wallet message, wallet refresh status, wallet cleanup). **Browser code (`apps/admin`) must not import the root**, which pulls in Prisma, `node:crypto` and `pdfkit`; use the browser-safe subpaths `@admitto/tickets/custom-data-reserved` and `@admitto/tickets/event-item-usability`. The three export subpaths, `@admitto/tickets/attendees-export`, `@admitto/tickets/attendees-export-pdf` and `@admitto/tickets/attendees-export-xlsx`, are for Node code only (the server and the worker): they pull in Prisma-backed modules, `node:module` with PDFKit and ExcelJS, so importing them from `apps/admin` puts server-only dependencies back into a Vite chunk.

## Security notes

- Raw tokens are never stored - only `token_hash` (SHA-256) and `token_enc` (AES via `@admitto/crypto`)
- QR must not embed PII unless explicitly required by the event

## Tests

```bash
npm run db:test-setup   # from repo root
npm test -w @admitto/tickets
```
