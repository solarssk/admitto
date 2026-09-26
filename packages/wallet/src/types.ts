/**
 * Domain types for a wallet pass, neutral to any concrete provider (ADR 0009). Field names are
 * Admitto's own - mapping to a provider's actual API field names happens in that provider's
 * adapter (its own admin-defined field mapping, no default vocabulary), never here.
 */
export interface WalletPassInput {
  attendeeName: string;
  attendeeFirstNameLabel?: string;
  attendeeLastNameLabel?: string;
  attendeeEmailLabel?: string;
  attendeeCompanyLabel?: string;
  attendeeDepartmentLabel?: string;
  eventNameLabel?: string;
  eventDateLabel: string;
  /** Same calendar day as `eventDateLabel`, abbreviated month (e.g. "24 Sep 2026") - for template
   * fields too narrow for the long form. A separate opt-in placeholder, not a replacement. */
  eventDateShortLabel: string;
  eventHoursLabel?: string;
  eventLocationLabel?: string;
  directionsTextLabel?: string;
  accessibilityTextLabel?: string;
  googleMapsUrlLabel?: string;
  appleMapsUrlLabel?: string;
  addressObjectNameLabel?: string;
  addressStreetLabel?: string;
  addressPostcodeLabel?: string;
  addressCityLabel?: string;
  addressRegionLabel?: string;
  addressCountryLabel?: string;
  ticketTypeLabel: string;
  /** Attendee-facing status word: "Valid" / "Checked in" / "Revoked" / "Cancelled" - derived from
   * Attendee.status + admitted_at, computed once at issue/reissue time like every other field
   * below. Nothing today automatically re-issues a pass on check-in or revoke, so a mapped pass
   * keeps showing the value from when it was last created/reissued, not a live state. */
  ticketStatusLabel: string;
  /** One entry per event custom field of type `select`/`boolean` the attendee has an answer for,
   * keyed by the already-namespaced placeholder id ("custom:<source_field>", see
   * packages/tickets/src/wallet-custom-fields.ts) - resolved separately before
   * buildWalletPassInput is called, same as ticketTypeLabel's own resolveTicketPageDisplay step,
   * so this stays a plain data bag rather than requiring db access here. Empty object when the
   * event has no mappable custom fields or the attendee answered none of them. */
  customFieldLabels: Record<string, string>;
  /** Stable idempotency key, e.g. "admitto:{eventId}:{attendeeId}". */
  userProvidedId: string;
  /** The exact same QR payload the ticket page's own QR code encodes (the raw internal token for
   * an internal attendee, the raw agency payload otherwise - never a full URL) - without this,
   * PassCreator's template default (its own auto-generated pass UID) ends up on the pass instead,
   * so scanning the wallet pass at check-in would not match the attendee's real ticket. */
  barcodeValue: string;
  /** PassCreator's top-level `relevantDate` ("Y-m-d H:i", local wall-clock digits, no offset) -
   * controls when the pass surfaces on the Lock Screen. Apple-only but always-on whenever the
   * event has a start time and Apple Wallet is enabled (ADR 0009 data minimization: omitted when
   * there's no start time). */
  relevantDate?: string;
  /** Apple PKEventType literal (e.g. "PKEventTypeSports") derived from Event.event_type - a
   * WALLET_MAPPING_PLACEHOLDERS entry like every field below, not sent automatically; PassCreator
   * only reads it once an admin maps this placeholder to a Custom Field bound in that template's
   * own Semantic Tags panel. */
  eventTypeLabel?: string;
  venueRoomLabel?: string;
  venueEntranceLabel?: string;
  venueEntranceDoorLabel?: string;
  venueEntranceGateLabel?: string;
  venueEntrancePortalLabel?: string;
  venuePhoneNumberLabel?: string;
  /** Apple Maps' own place identifier - admin-entered, Admitto cannot derive it automatically. */
  venuePlaceIdLabel?: string;
  /** Access-point opening times, resolved to offset-aware ISO 8601 instants (same treatment as
   * eventStartDate/eventEndDate previously received) via the event's own date + timezone. */
  venueOpenTimeLabel?: string;
  venueCloseTimeLabel?: string;
  doorsOpenTimeLabel?: string;
  gatesOpenTimeLabel?: string;
  boxOfficeOpenTimeLabel?: string;
  parkingLotsOpenTimeLabel?: string;
  fanZoneOpenTimeLabel?: string;
}

export interface WalletPassResult {
  providerPassId: string;
  downloadUrl?: string;
  appleUrl: string;
  androidUrl: string;
  /** Samsung Wallet install link, once PassCreator documents/returns one - no confirmed field name
   * exists yet (live check 2026-09-02: neither POST/PATCH /api/v3/pass nor the legacy
   * GET /api/pass/geturis/{uid} return anything Samsung-named, even on a template with
   * walletApps.android.samsung.active:true but templateCreated:false). No adapter sets this today. */
  samsungUrl?: string;
}

/** Provider-neutral reference to one already-created pass. Each adapter picks the lookup its own
 * API supports: PassCreator has to search by `userProvidedId` (query language), a native Google
 * Wallet provider would GET by its resource id, a native Apple provider would use its own pass
 * identity. The core never assumes "lookup = search by userProvidedId". */
export interface WalletProviderPassRef {
  providerPassId: string;
  userProvidedId?: string;
}

/** Device-registration counts as the provider itself reports them - not derived locally, and only
 * meaningful some time after createPass/updatePass (the attendee has to have actually opened the
 * install link on their device first). */
export interface WalletProviderRegistrations {
  appleActive: number;
  appleInactive: number;
  googleActive: number;
  googleInactive: number;
  /** Confirmed live 2026-09-02 (GET /api/v3/pass?query=... on a Samsung-enabled template):
   * noOfActiveRegistrationsSamsungWallet / noOfInactiveRegistrationsSamsungWallet are real,
   * already-populated fields (0 pre-launch), unlike samsungUrl above. */
  samsungActive: number;
  samsungInactive: number;
}

/** What the provider says about the pass's validity - an *observation*, never Admitto's own
 * lifecycle state: Admitto owns `WalletPass.status`, and interprets this (see
 * WalletProviderSnapshot). Nothing here is persisted as such. */
export interface WalletProviderValidity {
  /** The provider's own voided flag. null = the provider did not report one (leave Admitto's own
   * state alone rather than reading a missing field as "not voided"). PassCreator sets it for an
   * explicit void AND for an expired pass, and does not say which. */
  voided: boolean | null;
  /** The provider's expiration value exactly as sent on the wire, uninterpreted. PassCreator's is
   * "Y-m-d H:i" with no offset, in the timezone of the PassCreator company settings (its API v1
   * "Read a Pass" docs: "Dates are converted to the timezone that is set in your company
   * settings") - a per-account setting, not a protocol constant. */
  expirationRaw: string | null;
  /** `expirationRaw` as an instant, but ONLY when the wire value carries its own offset (or "Z"),
   * i.e. is unambiguous by itself. A naive "Y-m-d H:i" is never given a guessed timezone here -
   * interpreting it needs the account's configured timezone, which is a domain decision, not the
   * adapter's. */
  expiresAt: Date | null;
}

/** One read of a pass from the provider: what it says about validity, registrations, and first
 * download, taken together so a single lookup can feed every consumer. Returned by
 * WalletPassProvider.getPassSnapshot. */
export interface WalletProviderSnapshot {
  observedAt: Date;
  validity: WalletProviderValidity;
  /** null = the provider cannot report registrations (capabilities.registrationSnapshot false). */
  registrations: WalletProviderRegistrations | null;
  /** When the pass file was first downloaded - provider-reported, "YYYY-MM-DD HH:MM:SS" with no
   * offset in the wire payload. Not documented as UTC by PassCreator, but confirmed UTC by
   * cross-checking a live pass's raw value against PassCreator's own dashboard (PO review,
   * 2026-08-13) - parse with parseFirstDownloadedAtUtc (passcreator-webhook.ts), don't treat as an
   * opaque unparseable string. Kept as the provider's raw string, same as the DB column. */
  firstDownloadedAt: string | null;
}

/** What a provider can do at all - a fact about the provider, not about one pass. Callers gate
 * actions on this instead of assuming every provider matches PassCreator (Google Wallet's Event
 * Ticket API has no delete method for objects, and an issuer cannot remove a pass from a user's
 * Apple Wallet either). */
export interface WalletProviderCapabilities {
  /** Can report whether a pass is voided/expired (WalletProviderSnapshot.validity). */
  lifecycleObservation: boolean;
  /** Supports a per-pass expiration date. */
  expiration: boolean;
  /** Supports voiding and restoring a pass. */
  voidRestore: boolean;
  /** Can report device-registration counts (WalletProviderSnapshot.registrations). */
  registrationSnapshot: boolean;
  /** Can physically delete the remote resource. When false, "reset" means retiring the old remote
   * object (void/expire it) and issuing the next pass under a NEW provider identity (a generation
   * counter mixed into the identity), because today's stable `userProvidedId` idempotency key
   * would otherwise keep pointing at the retired object. Not implemented for any provider yet. */
  remoteDelete: boolean;
}

/** How consistent the provider's read side is after Admitto's own commands - a property of the
 * provider's consistency, not a capability. */
export interface WalletProviderConsistencyPolicy {
  /** How long after Admitto sent a validity-affecting command (void, restore) a read of the same
   * pass may still return the state from before it. PassCreator's search index lags behind (its
   * own search results can trail a status-affecting event); a provider with strongly consistent
   * reads uses 0. */
  observationStalenessWindowMs: number;
}

export type WalletProviderErrorCode =
  | "wallet_provider_unauthorized"
  | "wallet_provider_rate_limited"
  | "wallet_provider_duplicate"
  | "wallet_provider_not_found"
  | "wallet_provider_timeout"
  | "wallet_provider_rejected";

/** Thrown for wallet provider failures the caller must distinguish by `code`, never a bare Error. */
export class WalletProviderError extends Error {
  readonly code: WalletProviderErrorCode;

  constructor(code: WalletProviderErrorCode, message: string) {
    super(message);
    this.name = "WalletProviderError";
    this.code = code;
  }
}
