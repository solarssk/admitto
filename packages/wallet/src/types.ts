/**
 * Domain types for a wallet pass, neutral to any concrete provider (ADR 0009). Field names are
 * Admitto's own — mapping to a provider's actual API field names (e.g. PassCreator's
 * `name`/`eventDate`/`eventHours`/`eventPlace`/`ticketType`) happens in that provider's adapter,
 * never here.
 */
export interface WalletPassInput {
  attendeeName: string;
  eventDateLabel: string;
  eventHoursLabel?: string;
  eventLocationLabel?: string;
  ticketTypeLabel: string;
  /** Stable idempotency key, e.g. "admitto:{eventId}:{attendeeId}". */
  userProvidedId: string;
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
