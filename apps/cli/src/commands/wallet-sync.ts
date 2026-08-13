/**
 * Re-export wallet registration-status sync for the CLI worker entry.
 * Implementation lives in @admitto/wallet (shared with web integration tests).
 */
export {
  runWalletRegistrationSync,
  type WalletRegistrationSyncResult,
} from "@admitto/wallet";
