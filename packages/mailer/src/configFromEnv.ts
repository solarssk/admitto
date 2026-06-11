import { type MailerConfig, parseMailerConfig } from "./config.js";

function parseBool(v: string | undefined, def: boolean): boolean {
  if (v === undefined || v === "") return def;
  return v.trim().toLowerCase() === "true";
}

function parseOptionalInt(v: string | undefined): number | undefined {
  if (v === undefined || v.trim() === "") return undefined;
  const n = Number(v);
  return Number.isFinite(n) ? n : undefined;
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
      const mailbox = (env.GRAPH_MAILBOX ?? env.MAIL_FROM_ADDRESS ?? "").trim();
      return parseMailerConfig({
        provider: "graph",
        mailbox,
        tenantId: env.GRAPH_TENANT_ID,
        clientId: env.GRAPH_CLIENT_ID,
        clientSecret: env.GRAPH_CLIENT_SECRET,
        saveToSentItems: parseBool(env.GRAPH_SAVE_TO_SENT, true),
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
        port: parseOptionalInt(env.SMTP_PORT) ?? 587,
        secure: parseBool(env.SMTP_SECURE, false),
        user: env.SMTP_USER,
        password: env.SMTP_PASSWORD,
        requireTLS: parseBool(env.SMTP_REQUIRE_TLS, true),
        tlsRejectUnauthorized: parseBool(env.SMTP_TLS_REJECT_UNAUTHORIZED, true),
        heloName: env.SMTP_HELO_NAME || undefined,
        pool: parseBool(env.SMTP_POOL, true),
        maxConnections: parseOptionalInt(env.SMTP_MAX_CONNECTIONS),
        maxMessages: parseOptionalInt(env.SMTP_MAX_MESSAGES_PER_CONNECTION),
        rateLimitPerMinute: parseOptionalInt(env.SMTP_RATE_LIMIT_PER_MINUTE),
        connectionTimeout: parseOptionalInt(env.SMTP_CONNECTION_TIMEOUT),
        greetingTimeout: parseOptionalInt(env.SMTP_GREETING_TIMEOUT),
        socketTimeout: parseOptionalInt(env.SMTP_SOCKET_TIMEOUT),
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
