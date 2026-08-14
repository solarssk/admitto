/** Must stay in sync with apps/web/src/admin/wallet-message-routes.ts's own
 * WALLET_MESSAGE_TEXT_MAX_LENGTH - not shared via an import since apps/admin and apps/web are
 * separately deployable, and the server independently enforces this regardless of what the
 * client shows. */
export const WALLET_MESSAGE_TEXT_MAX_LENGTH = 500;
