import type { RawMailFields } from "./types.js";

function parseBool(v: string | undefined): boolean | undefined {
  if (v === undefined || v.trim() === "") return undefined;
  const n = v.trim().toLowerCase();
  if (n === "true") return true;
  if (n === "false") return false;
  return undefined;
}

function parsePositiveInt(v: string | undefined): number | undefined {
  if (v === undefined || v.trim() === "") return undefined;
  const n = Number(v.trim());
  return Number.isInteger(n) && n > 0 ? n : undefined;
}

function str(v: string | undefined): string | undefined {
  if (v === undefined || v.trim() === "") return undefined;
  return v.trim();
}

/**
 * Reads individual mailer fields from env vars without validating the whole config.
 * Uses the same env var names as configFromEnv() but returns a flat partial object,
 * enabling per-field precedence (env > event > org > default) in the resolver.
 */
export function rawMailFieldsFromEnv(env: NodeJS.ProcessEnv): RawMailFields {
  const provider = str(env.EMAIL_PROVIDER)?.toLowerCase();

  return {
    provider,
    // smtp
    host: str(env.SMTP_HOST),
    port: parsePositiveInt(env.SMTP_PORT),
    secure: parseBool(env.SMTP_SECURE),
    user: str(env.SMTP_USER),
    requireTLS: parseBool(env.SMTP_REQUIRE_TLS),
    tlsRejectUnauthorized: parseBool(env.SMTP_TLS_REJECT_UNAUTHORIZED),
    heloName: str(env.SMTP_HELO_NAME),
    pool: parseBool(env.SMTP_POOL),
    maxConnections: parsePositiveInt(env.SMTP_MAX_CONNECTIONS),
    maxMessages: parsePositiveInt(env.SMTP_MAX_MESSAGES_PER_CONNECTION),
    rateLimitPerMinute: parsePositiveInt(env.SMTP_RATE_LIMIT_PER_MINUTE),
    connectionTimeout: parsePositiveInt(env.SMTP_CONNECTION_TIMEOUT),
    greetingTimeout: parsePositiveInt(env.SMTP_GREETING_TIMEOUT),
    socketTimeout: parsePositiveInt(env.SMTP_SOCKET_TIMEOUT),
    smtpPassword: str(env.SMTP_PASSWORD),
    // graph
    mailbox: str(env.GRAPH_MAILBOX) ?? str(env.MAIL_FROM_ADDRESS),
    tenantId: str(env.GRAPH_TENANT_ID),
    clientId: str(env.GRAPH_CLIENT_ID),
    saveToSentItems: parseBool(env.GRAPH_SAVE_TO_SENT),
    graphClientSecret: str(env.GRAPH_CLIENT_SECRET),
    // power automate
    powerAutomateUrl: str(env.POWER_AUTOMATE_URL),
    powerAutomateKey: str(env.POWER_AUTOMATE_KEY),
    // shared sender
    fromAddress: str(env.MAIL_FROM_ADDRESS),
    fromName: str(env.MAIL_FROM_NAME),
    replyTo: str(env.MAIL_REPLY_TO),
    envelopeFrom: str(env.MAIL_ENVELOPE_FROM),
    // allowedFromDomain has no env var equivalent — managed via DB only
  };
}
