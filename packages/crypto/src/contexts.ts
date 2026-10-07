/**
 * AES-GCM additional data for each stored secret column (see `encrypt`'s `context`). A ciphertext
 * only decrypts as the column it was written for. TOTP secrets and IdP client secrets keep their
 * own constants next to their code (packages/auth).
 */
export const SECRET_CONTEXTS = {
  smtpPassword: "admitto:mail-smtp-password",
  graphClientSecret: "admitto:mail-graph-client-secret",
  powerAutomateKey: "admitto:mail-power-automate-key",
  powerAutomateUrl: "admitto:mail-power-automate-url",
  walletApiKey: "admitto:event-wallet-api-key",
  imapPassword: "admitto:bounce-imap-password",
  notificationWebhookUrl: "admitto:notification-webhook-url",
} as const;
