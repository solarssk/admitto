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
  /** When the pass file was first downloaded - provider-reported, timezone unconfirmed (not
   * documented as UTC or otherwise), so callers must treat this as an opaque instant rather than
   * converting it to a specific zone. */
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
