# @admitto/wallet

Wallet pass domain boundary (ADR 0009): the provider-neutral `WalletPassProvider` interface and
domain types, plus the PassCreator HTTP client (ADR 0041) that implements it today. The rest of
Admitto depends on `WalletPassProvider`, never on PassCreator specifics directly - a future second
provider would only need to implement this interface.

This README is the current technical reference for how the wallet integration works today.

- [Architecture](#architecture)
- [Key exports](#key-exports)
- [PassCreator API surface actually used](#passcreator-api-surface-actually-used)
- [Data flow: field mapping is the only mechanism (semantics API field does not exist)](#data-flow-field-mapping-is-the-only-mechanism-semantics-api-field-does-not-exist)
  - [Standard: every date/time placeholder sent to Apple is a real ISO 8601 instant](#standard-every-datetime-placeholder-sent-to-apple-is-a-real-iso-8601-instant)
  - [Visible field text: region-aware formatting](#visible-field-text-region-aware-formatting-packagesticketssrcregion-date-formatts)
- [Explicitly out of scope](#explicitly-out-of-scope)
- [Webhooks and background sync](#webhooks-and-background-sync)

## Architecture

```
apps/web (on-demand create/redirect routes, admin wallet action routes, webhook receiver)
apps/cli (background worker: registration-sync, wallet_push job drain)
        │
        ▼
packages/tickets  buildWalletPassInput()  - Event/Attendee → provider-neutral WalletPassInput
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
| Webhook unsubscribe | `POST /api/hook/unsubscribe` | Body is just `{target_url}` - no templateId, no event. Removes *every* event subscribed to that URL, not one |
| Webhook public key | `GET /api/hook/publickey` | EC (P-256), hex-encoded signature, SHA-1 hash (PassCreator's own `openssl_verify()` doc example omits the algorithm argument, which defaults to SHA-1 in PHP - confirmed 2026-08-19). Response is `{"publicKey": "<PEM>"}` at the top level - confirmed live 2026-08-19, not the usual `{success, data}` envelope |

**Webhook delivery has no event-type field or header** (confirmed 2026-08-19,
developer.passcreator.com/en/webhooks/pass-hooks): the POST body never names which of the 4
subscribed events fired, so the *target URL a delivery arrives on* is the only signal. The three
registration events (`first_pushnotification_registered`, `pushnotification_registered`,
`pushnotification_unregistered`) share one target URL because their handling doesn't depend on
telling them apart - `applyWebhookUpdate` just trusts whatever counts the delivery reports.
`pass_voided` gets its own `/voided`-suffixed target URL (`subscribeWalletWebhooksBestEffort` in
`apps/web/src/admin/event-settings-routes.ts`) because its payload has no `voided` field at all -
arriving on that URL is itself the only voided signal there is (`isVoidedRoute` in
`apps/web/src/wallet-webhook.ts`).

Auth: `Authorization: <api_key>` header, no `Bearer` prefix. Rate limit: 600 req/min, exponential
backoff on 429 (see `PassCreatorClient`'s retry logic). Config (API key, template ID, field
mapping) is stored per-event, not per-instance, so a leaked/rotated key's blast radius in Admitto's
own logs/audit trail is scoped to one event. **This does not limit the key itself**: PassCreator
API keys inherit the permissions of the account that created them, not a fixed scope to one
template - `PassCreatorClient.listWebhooks()` is explicitly account-wide, for example. If the same
PassCreator account backs multiple events, a leaked key can affect all of them at the provider; use
a dedicated PassCreator service user scoped to one template for real per-event isolation.

## Data flow: field mapping is the only mechanism (semantics API field does not exist)

Earlier revisions of this integration also built and sent a top-level `data.semantics` object,
believing PassCreator's API passed it straight through into the issued pass's Apple `semantics`
dictionary. **This was wrong and has been removed.** `semantics` is not a documented field of
`POST /api/v3/pass` (confirmed against `developer.passcreator.com/en/api/v3/pass`), and empirical
testing - diffing a real downloaded `.pkpass`/`pass.json` before and after editing the PassCreator
template - showed it never reached the output pass regardless of what was sent. PassCreator
silently ignores unknown request fields rather than rejecting them, so the request always looked
like it worked.

The only mechanism that actually works is the same one that already powers the pass's visible
fields (Name, Venue, Date, Hours): **field mapping** (`toPassCreatorData`'s `custom` object) - an
admin maps every field their template's Additional Properties expect (Event Settings → Wallet →
Field mapping); nothing beyond the QR barcode is sent until explicitly mapped. To get a value into
one of Apple's Semantic Tags (Siri Suggestions / Maps / Calendar smart surfacing), the admin must
do **two** things, on two different systems, both required:

1. In Admitto's Field mapping table, map a placeholder (e.g. `event_type`, `venue_room`,
   `doors_open_time` - see `WALLET_MAPPING_PLACEHOLDERS`) to a PassCreator Additional Property name.
2. In that PassCreator template's own Editor UI, register that Additional Property as a Custom
   Field (if it doesn't already exist), then bind the matching Semantic Tags panel field to
   `{thatCustomFieldName}`.

Admitto's job ends at step 1: it can supply the *data*, but the *binding* between an Apple semantic
key and a Custom Field lives entirely inside PassCreator's template editor, outside Admitto's
control - there is no API to configure that side.

`WALLET_MAPPING_PLACEHOLDERS` includes both general-purpose placeholders (name, date, address
fields, usable for any Additional Property) and ones added specifically because they match Apple's
Semantic Tags vocabulary: `event_type`, `venue_room`, `venue_entrance`(`_door`/`_gate`/`_portal`),
`venue_phone_number`, `venue_place_id`, and the seven access-point timing placeholders
(`venue_open_time`/`venue_close_time`/`doors_open_time`/`gates_open_time`/`box_office_open_time`/
`parking_lots_open_time`/`fan_zone_open_time`). `venue_place_id` (Apple Maps' own place identifier)
has no automatic source - Admitto's geocoding is Nominatim/OSM-based, not Apple MapKit, so an admin
must look it up manually in the Apple Maps app and enter it in Event Settings → Location.

### Standard: every date/time placeholder sent to Apple is a real ISO 8601 instant

The seven `*OpenTimeLabel` fields on `WalletPassInput` are built with `zonedDateTimeToIso` from the
event's stored UTC calendar day, an "HH:MM" field, and `event.timezone` - never a bare `"HH:MM"`,
never a date without a UTC offset. See the doc comments on `zonedDateTimeToIso`/`tzOffsetSuffix` in
`packages/tickets/src/wallet-pass-input.ts` for the exact day-boundary and DST-transition handling
(both were real bugs once; the comments explain why the current approach avoids them). This is
independent from the visible-text formatting in `region-date-format.ts` (below): these are
machine-readable values for a Semantic Tag, field-mapping labels elsewhere are human-readable text
- the two never need to agree, and a new date-typed placeholder should reuse `zonedDateTimeToIso`,
not a new conversion.

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
timezone, event type, or the Apple Wallet toggle) - see
`walletRelevantEventFieldsChanged` in `apps/web/src/admin/event-settings-routes.ts`. Two things this
job does *not* cover: it only targets `status: "active"` passes (`drain-wallet-push-jobs.ts`), so a
voided pass stays untouched until it's restored *and* separately reissued - `restorePass()` only
clears the void flag at the provider, it does not push fresh content; and a single-attendee edit
(name, email, company, department, ticket type) pushes synchronously in the same request instead of
going through this job queue, so it never appears in the admin UI's "Wallet push history" list.
