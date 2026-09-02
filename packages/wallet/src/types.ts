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
}

/** Device-registration status as the provider itself reports it - not derived locally, and only
 * meaningful some time after createPass/updatePass (the attendee has to have actually opened the
 * install link on their device first). */
export interface WalletPassRegistrationStatus {
  appleActiveRegistrations: number;
  appleInactiveRegistrations: number;
  googleActiveRegistrations: number;
  googleInactiveRegistrations: number;
  /** When the pass file was first downloaded - provider-reported, "YYYY-MM-DD HH:MM:SS" with no
   * offset in the wire payload. Not documented as UTC by PassCreator, but confirmed UTC by
   * cross-checking a live pass's raw value against PassCreator's own dashboard (PO review,
   * 2026-08-13) - parse with parseFirstDownloadedAtUtc (passcreator-webhook.ts), don't treat as an
   * opaque unparseable string. */
  firstDownloadedAt: string | null;
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
