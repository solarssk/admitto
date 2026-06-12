/**
 * Per-provider field defaults — mirrors the Zod schema defaults in
 * @admitto/mailer/src/config.ts. Must be kept in sync with that file.
 *
 * Used by describeMailConfig() so the UI sees the same effective values
 * as resolveMailConfig() after parseMailerConfig() applies Zod defaults.
 * Fields absent from a provider's defaults have no runtime default (null).
 */

export interface ProviderDefaults {
  port?: number;
  secure?: boolean;
  requireTls?: boolean;
  tlsRejectUnauthorized?: boolean;
  pool?: boolean;
  maxConnections?: number;
  maxMessages?: number;
  rateLimitPerMinute?: number;
  connectionTimeout?: number;
  greetingTimeout?: number;
  socketTimeout?: number;
  saveToSentItems?: boolean;
}

const SMTP_DEFAULTS: ProviderDefaults = {
  port: 587,
  secure: false,
  requireTls: true,
  tlsRejectUnauthorized: true,
  pool: true,
  maxConnections: 3,
  maxMessages: 100,
  rateLimitPerMinute: 30,
  connectionTimeout: 30_000,
  greetingTimeout: 30_000,
  socketTimeout: 60_000,
};

const GRAPH_DEFAULTS: ProviderDefaults = {
  saveToSentItems: true,
};

export function getProviderDefaults(provider: string | null | undefined): ProviderDefaults {
  switch (provider) {
    case "smtp":
      return SMTP_DEFAULTS;
    case "graph":
      return GRAPH_DEFAULTS;
    default:
      return {};
  }
}
