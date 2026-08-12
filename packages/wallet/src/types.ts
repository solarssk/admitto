/**
 * Domain types for a wallet pass, neutral to any concrete provider (ADR 0009). Field names are
 * Admitto's own — mapping to a provider's actual API field names (e.g. PassCreator's
 * `name`/`eventDate`/`eventHours`/`eventPlace`/`ticketType`) happens in that provider's adapter,
 * never here.
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
  /** The exact same QR payload the ticket page's own QR code encodes (ticket URL for an internal
   * attendee, the raw agency payload otherwise) - without this, PassCreator's template default
   * (its own auto-generated pass UID) ends up on the pass instead, so scanning the wallet pass at
   * check-in would not match the attendee's real ticket. */
  barcodeValue: string;
}

export interface WalletPassResult {
  providerPassId: string;
  downloadUrl?: string;
  appleUrl: string;
  androidUrl: string;
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
