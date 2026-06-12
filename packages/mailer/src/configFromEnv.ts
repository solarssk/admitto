import { type MailerConfig, parseMailerConfig } from "./config.js";

function parseBool(v: string | undefined, def: boolean, name: string): boolean {
  if (v === undefined || v.trim() === "") return def;
  const normalized = v.trim().toLowerCase();
  if (normalized === "true") return true;
  if (normalized === "false") return false;
  throw new Error(`${name} must be "true" or "false" (got: "${v}")`);
}

function parseOptionalInt(v: string | undefined, name: string): number | undefined {
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

function mailSenderFromEnv(env: NodeJS.ProcessEnv) {
  return {
    fromAddress: env.MAIL_FROM_ADDRESS,
    fromName: env.MAIL_FROM_NAME || undefined,
    replyTo: env.MAIL_REPLY_TO || undefined,
    envelopeFrom: env.MAIL_ENVELOPE_FROM || undefined,
  };
}

/**
 * Builds a MailerConfig from environment variables. Temporary bridge until
 * configuration is managed by the UI Settings screen (which will use the same
 * zod schema). Provider selection: EMAIL_PROVIDER = graph | smtp | powerautomate | export_only.
 */
export function configFromEnv(env: NodeJS.ProcessEnv = process.env): MailerConfig {
  const provider = (env.EMAIL_PROVIDER ?? "").trim().toLowerCase();
  const sender = mailSenderFromEnv(env);

  switch (provider) {
    case "graph": {
      const graphMailbox = env.GRAPH_MAILBOX?.trim();
      const mailbox = graphMailbox || env.MAIL_FROM_ADDRESS?.trim() || "";
      return parseMailerConfig({
        provider: "graph",
        mailbox,
        tenantId: env.GRAPH_TENANT_ID,
        clientId: env.GRAPH_CLIENT_ID,
        clientSecret: env.GRAPH_CLIENT_SECRET,
        saveToSentItems: parseBool(env.GRAPH_SAVE_TO_SENT, true, "GRAPH_SAVE_TO_SENT"),
        fromAddress: sender.fromAddress,
        fromName: sender.fromName,
        replyTo: sender.replyTo,
        envelopeFrom: sender.envelopeFrom,
      });
    }
    case "smtp":
      return parseMailerConfig({
        provider: "smtp",
        host: env.SMTP_HOST,
        port: parseOptionalInt(env.SMTP_PORT, "SMTP_PORT") ?? 587,
        secure: parseBool(env.SMTP_SECURE, false, "SMTP_SECURE"),
        user: env.SMTP_USER,
        password: env.SMTP_PASSWORD,
        requireTLS: parseBool(env.SMTP_REQUIRE_TLS, true, "SMTP_REQUIRE_TLS"),
        tlsRejectUnauthorized: parseBool(
          env.SMTP_TLS_REJECT_UNAUTHORIZED,
          true,
          "SMTP_TLS_REJECT_UNAUTHORIZED",
        ),
        heloName: env.SMTP_HELO_NAME || undefined,
        pool: parseBool(env.SMTP_POOL, true, "SMTP_POOL"),
        maxConnections: parseOptionalInt(env.SMTP_MAX_CONNECTIONS, "SMTP_MAX_CONNECTIONS"),
        maxMessages: parseOptionalInt(
          env.SMTP_MAX_MESSAGES_PER_CONNECTION,
          "SMTP_MAX_MESSAGES_PER_CONNECTION",
        ),
        rateLimitPerMinute: parseOptionalInt(
          env.SMTP_RATE_LIMIT_PER_MINUTE,
          "SMTP_RATE_LIMIT_PER_MINUTE",
        ),
        connectionTimeout: parseOptionalInt(env.SMTP_CONNECTION_TIMEOUT, "SMTP_CONNECTION_TIMEOUT"),
        greetingTimeout: parseOptionalInt(env.SMTP_GREETING_TIMEOUT, "SMTP_GREETING_TIMEOUT"),
        socketTimeout: parseOptionalInt(env.SMTP_SOCKET_TIMEOUT, "SMTP_SOCKET_TIMEOUT"),
        ...sender,
      });
    case "powerautomate":
      return parseMailerConfig({
        provider: "powerautomate",
        url: env.POWER_AUTOMATE_URL,
        key: env.POWER_AUTOMATE_KEY || undefined,
        ...sender,
      });
    case "export_only":
      return parseMailerConfig({
        provider: "export_only",
        ...sender,
      });
    default:
      throw new Error(
        `EMAIL_PROVIDER must be one of: graph | smtp | powerautomate | export_only (got: "${provider}")`,
      );
  }
}
