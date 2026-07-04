import type { RawMailFields } from "./types.js";

function parseBool(v: string | undefined, name: string): boolean | undefined {
  if (v === undefined || v.trim() === "") return undefined;
  const n = v.trim().toLowerCase();
  if (n === "true") return true;
  if (n === "false") return false;
  throw new Error(`${name} must be "true" or "false" (got: "${v}")`);
}

function parsePositiveInt(v: string | undefined, name: string): number | undefined {
  if (v === undefined || v.trim() === "") return undefined;
  const trimmed = v.trim();
  if (!/^\d+$/.test(trimmed)) {
    throw new Error(`${name} must be a positive integer (got: "${v}")`);
  }
  const n = Number(trimmed);
  if (!Number.isSafeInteger(n) || n <= 0) {
    throw new Error(`${name} must be a positive integer (got: "${v}")`);
  }
  return n;
}

function str(v: string | undefined): string | undefined {
  if (v === undefined || v.trim() === "") return undefined;
  return v.trim();
}

/**
 * Literal defaults shipped in `deploy/.env.example`. An operator who copies the
 * template and configures mail from the admin UI instead of env — without
 * touching the mail section — ends up with these exact values in a real
 * deployment env. Treated as unset so they don't falsely report as "managed by
 * environment" (locked, read-only) in Settings, matching the intent already
 * applied to the first-run wizard (which ignores env entirely).
 *
 * Scoped to `host`/`fromAddress` only: `example.com` is IANA/RFC 2606
 * reserved and can never be a working production SMTP host or sender
 * domain, so treating this exact value as a placeholder carries no risk of
 * masking a genuine deployment's choice. Other example fields (ports,
 * booleans, from name) are common real-world values too and are left as-is.
 */
const SMTP_HOST_EXAMPLE_PLACEHOLDER = "smtp.example.com";
const MAIL_FROM_ADDRESS_EXAMPLE_PLACEHOLDER = "events@example.com";

function strIgnoringExamplePlaceholder(
  v: string | undefined,
  placeholder: string,
): string | undefined {
  const value = str(v);
  return value === placeholder ? undefined : value;
}

/**
 * Reads individual mailer fields from env vars without validating the whole config.
 * Uses the same env var names as configFromEnv() but returns a flat partial object,
 * enabling per-field precedence (env > event > org > default) in the resolver.
 *
 * Throws on malformed boolean/integer values so that a misconfigured env is
 * caught immediately rather than silently falling through to a lower-priority scope.
 *
 * Note: graph mailbox fallback (mailbox → fromAddress) is NOT applied here.
 * It lives in the resolver so that a DB-configured mailbox can still win when
 * only MAIL_FROM_ADDRESS is locked in env.
 */
export function rawMailFieldsFromEnv(env: NodeJS.ProcessEnv): RawMailFields {
  const provider = str(env.EMAIL_PROVIDER)?.toLowerCase();

  return {
    provider,
    // smtp
    host: strIgnoringExamplePlaceholder(env.SMTP_HOST, SMTP_HOST_EXAMPLE_PLACEHOLDER),
    port: parsePositiveInt(env.SMTP_PORT, "SMTP_PORT"),
    secure: parseBool(env.SMTP_SECURE, "SMTP_SECURE"),
    user: str(env.SMTP_USER),
    requireTls: parseBool(env.SMTP_REQUIRE_TLS, "SMTP_REQUIRE_TLS"),
    tlsRejectUnauthorized: parseBool(env.SMTP_TLS_REJECT_UNAUTHORIZED, "SMTP_TLS_REJECT_UNAUTHORIZED"),
    heloName: str(env.SMTP_HELO_NAME),
    pool: parseBool(env.SMTP_POOL, "SMTP_POOL"),
    maxConnections: parsePositiveInt(env.SMTP_MAX_CONNECTIONS, "SMTP_MAX_CONNECTIONS"),
    maxMessages: parsePositiveInt(env.SMTP_MAX_MESSAGES_PER_CONNECTION, "SMTP_MAX_MESSAGES_PER_CONNECTION"),
    rateLimitPerMinute: parsePositiveInt(env.SMTP_RATE_LIMIT_PER_MINUTE, "SMTP_RATE_LIMIT_PER_MINUTE"),
    connectionTimeout: parsePositiveInt(env.SMTP_CONNECTION_TIMEOUT, "SMTP_CONNECTION_TIMEOUT"),
    greetingTimeout: parsePositiveInt(env.SMTP_GREETING_TIMEOUT, "SMTP_GREETING_TIMEOUT"),
    socketTimeout: parsePositiveInt(env.SMTP_SOCKET_TIMEOUT, "SMTP_SOCKET_TIMEOUT"),
    smtpPassword: str(env.SMTP_PASSWORD),
    // graph — mailbox fallback to fromAddress happens in the resolver, not here
    mailbox: str(env.GRAPH_MAILBOX),
    tenantId: str(env.GRAPH_TENANT_ID),
    clientId: str(env.GRAPH_CLIENT_ID),
    saveToSentItems: parseBool(env.GRAPH_SAVE_TO_SENT, "GRAPH_SAVE_TO_SENT"),
    graphClientSecret: str(env.GRAPH_CLIENT_SECRET),
    // power automate
    powerAutomateUrl: str(env.POWER_AUTOMATE_URL),
    powerAutomateKey: str(env.POWER_AUTOMATE_KEY),
    // shared sender
    fromAddress: strIgnoringExamplePlaceholder(env.MAIL_FROM_ADDRESS, MAIL_FROM_ADDRESS_EXAMPLE_PLACEHOLDER),
    fromName: str(env.MAIL_FROM_NAME),
    replyTo: str(env.MAIL_REPLY_TO),
    envelopeFrom: str(env.MAIL_ENVELOPE_FROM),
    // allowedFromDomain has no env var equivalent — managed via DB only
  };
}
