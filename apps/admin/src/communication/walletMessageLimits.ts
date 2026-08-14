/** Must stay in sync with apps/web/src/admin/wallet-message-routes.ts's own
 * WALLET_MESSAGE_TEXT_MAX_LENGTH - not shared via an import since apps/admin and apps/web are
 * separately deployable, and the server independently enforces this regardless of what the
 * client shows. */
export const WALLET_MESSAGE_TEXT_MAX_LENGTH = 500;

/**
 * Soft warning threshold, not a hard cap: iOS lock-screen notifications commonly display ~3
 * lines at ~40-50 characters each before truncating, so text past roughly this length risks
 * being cut off on some devices. There is no single documented number - Apple doesn't publish
 * one, and independent sources vary (140-178 chars depending on device/OS version) - this picks
 * the low, more conservative end rather than a device-specific figure we can't verify.
 */
export const WALLET_MESSAGE_TRUNCATION_WARNING_LENGTH = 140;
