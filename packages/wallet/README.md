# @admitto/wallet

Wallet pass domain boundary (ADR 0009): the provider-neutral `WalletPassProvider` interface and
domain types, plus the PassCreator HTTP client (ADR 0041) that implements it today. The rest of
Admitto depends on `WalletPassProvider`, never on PassCreator specifics directly - a future second
provider would only need to implement this interface.

This README is the current technical reference for how the wallet integration works today.

## Architecture

```
apps/web (on-demand create/redirect routes, admin wallet action routes, webhook receiver)
apps/cli (background worker: registration-sync, wallet_push job drain)
        │
        ▼
packages/tickets  buildWalletPassInput()  — Event/Attendee → provider-neutral WalletPassInput
        │
        ▼
packages/wallet    WalletPassProvider interface, PassCreatorClient, toPassCreatorData() mapper
        │
        ▼
PassCreator API (app.passcreator.com)
```

Admitto is always the source of truth for the QR/barcode payload, check-in state, and attendee
data. PassCreator is presentation and delivery only - it never gates check-in (ADR 0009).

## Key exports

```ts
import type {
  WalletPassProvider,
  WalletPassInput,
  WalletPassSemantics,
  WalletPassResult,
  WalletPassRegistrationStatus,
  WalletProviderErrorCode,
  PassCreatorConfig,
} from "@admitto/wallet";
import { WalletProviderError, PassCreatorClient, resolveWalletProvider } from "@admitto/wallet";
```

`WalletPassProvider` operations: `createPass`, `updatePass`, `voidPass`, `restorePass`,
`deletePass`, `findByUserProvidedId`, `getRegistrationStatus`. `WalletProviderError` carries a
stable `code` (`wallet_provider_unauthorized` / `_rate_limited` / `_duplicate` / `_not_found` /
`_timeout` / `_rejected`) - callers branch on `code`, never on `.message`.

## PassCreator API surface actually used

| Operation | Endpoint | Notes |
|---|---|---|
| Create pass | `POST /api/v3/pass?async=false` | `async=false` to get `iPhoneUri`/`androidUri` back immediately |
| Update pass | `PATCH /api/v3/pass/{id}` | Never `POST` - v3 `POST` replaces the whole record |
| Delete pass | `DELETE /api/v3/pass/{id}` | 404 on retry treated as success (idempotent) |
| Void / restore | `PUT /api/pass/{uid}` (no `/v3/`) | Body `{"voided": true\|false}`; this is the only endpoint that can write `voided` |
| Search | `GET /api/v3/pass?query=<base64url query-language>` | Used for idempotency reconciliation and registration-status polling |
| Describe template | `GET /api/v2/pass-template/{id}/describe` | v3 has no template-management endpoints; template read stays on v2 |
| Webhook subscribe | `POST /api/hook/subscribe/{templateId}` | Not idempotent - caller must check `listWebhooks()` first |
| Webhook public key | `GET /api/hook/publickey` | EC (P-256), hex-encoded signature |

Auth: `Authorization: <api_key>` header, no `Bearer` prefix. Rate limit: 600 req/min, exponential
backoff on 429 (see `PassCreatorClient`'s retry logic). Config (API key, template ID, field
mapping) is stored per-event, not per-instance, so a leaked/rotated key's blast radius in Admitto's
own logs/audit trail is scoped to one event. **This does not limit the key itself**: PassCreator
API keys inherit the permissions of the account that created them, not a fixed scope to one
template - `PassCreatorClient.listWebhooks()` is explicitly account-wide, for example. If the same
PassCreator account backs multiple events, a leaked key can affect all of them at the provider; use
a dedicated PassCreator service user scoped to one template for real per-event isolation.

## Data flow: field mapping (existing) vs semantics (new)

Two separate, independently-configured mechanisms both feed the same `POST`/`PATCH` body:

- **Field mapping** (`toPassCreatorData`'s `custom` object) - fully admin-configured, no default
  vocabulary. PassCreator templates don't share a common Additional Property naming convention, so
  Admitto never guesses; an admin maps every field their specific template expects (Event Settings
  → Wallet → Field mapping). Nothing beyond the QR barcode is sent until explicitly mapped.
- **Semantic tags** (`toPassCreatorData`'s `semantics` object, `WalletPassSemantics`) - Apple's own
  fixed-vocabulary PassKit `semantics` dictionary (`eventName`, `eventStartDate`, `eventEndDate`,
  `venueName`, `venueLocation`, `entranceDescription`, `attendeeName`, `duration`), populated
  automatically by `buildWalletPassInput()` from Event/Attendee data - no per-field admin
  configuration, just one event-level opt-in switch (`wallet_semantic_tags_enabled`, default off).
  Powers Siri Suggestions / Maps / Calendar smart surfacing on Apple Wallet. Requires no NFC, no
  PassCreator account approval, and has no effect on Google Wallet.

`eventStartDate`/`eventEndDate` are computed from the event's stored UTC calendar day plus its
"HH:MM" hours fields, resolved in the event's own IANA timezone - see the doc comments on
`zonedDateTimeToIso`/`tzOffsetSuffix` in `packages/tickets/src/wallet-pass-input.ts` for the exact
day-boundary and DST-transition handling (both were real bugs once; the comments explain why the
current approach avoids them).

### Standard: every date/time value sent to Apple is a real ISO 8601 instant

Every date/time field in `WalletPassSemantics` (and any future one) is built with
`zonedDateTimeToIso` - never a bare `"HH:MM"`, never a date without a UTC offset. This is
independent from the visible-text formatting in `region-date-format.ts` (below): semantics are
machine-readable metadata for Apple/Siri, field-mapping labels are human-readable text - the two
never need to agree, and a new date-typed semantic tag should reuse `zonedDateTimeToIso`, not a
new conversion.

### Semantic tag coverage (data minimization, ADR 0009)

A tag is only sent when Admitto's domain model actually has the data - never guessed or defaulted.

| Sent today | Source |
|---|---|
| `eventName` | `event.title` |
| `eventType` | fixed `"PKEventTypeGeneric"` (no event-category field in the model) |
| `eventStartDate` / `eventEndDate` | `event.date` + hours + `event.timezone`, via `zonedDateTimeToIso` |
| `duration` | computed from the resolved start/end instants (DST-safe, not wall-clock subtraction) |
| `venueName` | `event.location` |
| `venueLocation` | `event.latitude`/`longitude` |
| `entranceDescription` | `event.directionsText` |
| `attendeeName` | `attendee.name` |

| Available to add, not sent yet | Source |
|---|---|
| `admissionLevel` | `attendee.ticket_type` (already sent as a plain-text field via `ticketTypeLabel`) |
| `venueRegionName` | `event.addressComponents.city` / `.region` |

Deliberately not sent - no corresponding field in Admitto's domain model: `venueRoom`,
`venueEntrance`/`venueEntranceGate`/`venueEntranceDoor` (no separate "room"/"gate" field, only free
text), `venueDoorsOpenDate`/`venueGatesOpenDate` (no concept of a doors-open time distinct from
`eventHoursStart`), `seats` (no assigned seating), and the sports/performance-specific tags (no
matching event category).

### Visible field text: region-aware formatting (`packages/tickets/src/region-date-format.ts`)

`eventDateLabel`/`eventHoursLabel` and other `*Label` fields on `WalletPassInput` are the only way
to influence the *visible* text on the pass card, because PassCreator's Additional Properties have
no date type (`enum<'email','text','textarea','checkbox','select','radiobutton'>` - confirmed
against their API docs) - Apple's native `dateStyle`/`timeStyle` field rendering only applies to a
template's own `fields`, never to values injected through Additional Properties. `formatDate`/
`formatEventHour` resolve the event's `addressComponents.country` to a region (`en-<ISO region>`)
so the date order and 12h/24h convention match the event's own country while text stays English;
no match falls back to `en-GB`. Shared by the ticket page and the wallet pass - any new visible-text
variant (e.g. a shorter date) is a new field computed by this same module, not a parallel
implementation.

## Explicitly out of scope

- **Apple's "Enhanced"/poster event ticket style** (`preferredStyleScheme: "posterEventTicket"`,
  iOS 18+) - requires NFC hardware and PassCreator account approval, and Apple's own docs state
  poster tickets are incompatible with QR/barcode-only entry. Admitto's check-in model depends on
  scanning the ticket's QR/barcode, so this is architecturally excluded, not just deferred.
- **Samsung Wallet** - shown as a disabled placeholder in Event Settings → Wallet for layout
  parity with Apple/Google. No PassCreator API support exists for it today.

## Webhooks and background sync

`apps/web/src/wallet-webhook.ts` receives `first_pushnotification_registered`,
`pushnotification_registered`, `pushnotification_unregistered`, and `pass_voided`, verified via the
EC public key above. `apps/cli`'s `registration-sync` job polls `getRegistrationStatus()` as a
fallback for events the webhook may have missed. `wallet_push` (`AdminJob`) is the background job
that re-syncs already-issued passes when a wallet-relevant event field changes (title, date, hours,
timezone, the Apple Wallet toggle, or the semantic tags toggle) - see
`walletRelevantEventFieldsChanged` in `apps/web/src/admin/event-settings-routes.ts`. Two things this
job does *not* cover: it only targets `status: "active"` passes (`drain-wallet-push-jobs.ts`), so a
voided pass stays untouched until it's restored *and* separately reissued - `restorePass()` only
clears the void flag at the provider, it does not push fresh content; and a single-attendee edit
(name, email, company, department, ticket type) pushes synchronously in the same request instead of
going through this job queue, so it never appears in the admin UI's "Wallet push history" list.
