/**
 * Re-export the canonical wallet-pass-expiry sweep for the CLI worker entry.
 * Implementation lives in @admitto/wallet (shared with web integration tests).
 */
export { runWalletExpiry, type WalletExpiryResult } from "@admitto/wallet";
