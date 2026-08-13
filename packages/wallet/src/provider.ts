import type { WalletPassInput, WalletPassRegistrationStatus, WalletPassResult } from "./types.js";

/**
 * Domain boundary for wallet pass delivery (ADR 0009). The rest of Admitto depends only on this
 * interface — never on a concrete provider (e.g. PassCreator, see ADR 0041).
 */
export interface WalletPassProvider {
  readonly provider: string;

  createPass(input: WalletPassInput): Promise<WalletPassResult>;
  updatePass(providerPassId: string, input: WalletPassInput): Promise<WalletPassResult>;
  voidPass(passUid: string): Promise<void>;
  restorePass(passUid: string): Promise<void>;
  /** Permanently removes the pass from the provider (e.g. GDPR/DSAR erasure) - idempotent, a
   * pass that's already gone (404) is treated as success. */
  deletePass(providerPassId: string): Promise<void>;
  findByUserProvidedId(userProvidedId: string): Promise<WalletPassResult | null>;
  /** Polled periodically by the wallet-sync worker job, not called inline on any request path -
   * null when no pass matches (deleted at the provider, or never created). */
  getRegistrationStatus(userProvidedId: string): Promise<WalletPassRegistrationStatus | null>;
}
