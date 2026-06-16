# @admitto/tickets

Ticket domain logic — token generation, hashing, QR payloads, issuance, and check-in validation (ADR 0001).

## Two ticket modes

| Mode | Who provides the QR | Storage |
|------|---------------------|---------|
| **A** — Admitto-issued | Admitto generates token + URL | `token_hash` + encrypted `token_enc` |
| **B** — Agency | Agency supplies `external_uuid` + `qr_payload` | Payload preserved as-is; no Admitto token |

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

- **`issueTicket` / `issueTicketsForEvent`** — create Mode A tokens for attendees missing them
- **`resolveTicket`** — lookup by raw token or agency payload for `/t` and mail links
- **`buildTicketUrl`** — `BASE_URL` + `/t/<token>` (never derived from request `Host`)
- **`checkInScan`** — validate scan, record check-in, return `CheckInStatus`

## Security notes

- Raw tokens are never stored — only `token_hash` (SHA-256) and `token_enc` (AES via `@admitto/crypto`)
- QR must not embed PII unless explicitly required by the event

## Tests

```bash
npm run db:test-setup   # from repo root
npm test -w @admitto/tickets
```
