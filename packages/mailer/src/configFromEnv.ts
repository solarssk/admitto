import { type MailerConfig, parseMailerConfig } from "./config.js";

/**
 * Builds a MailerConfig from environment variables. Temporary bridge until
 * configuration is managed by the UI Settings screen (which will use the same
 * zod schema). Provider selection: MAILER_PROVIDER = graph | smtp | powerautomate.
 */
export function configFromEnv(env: NodeJS.ProcessEnv = process.env): MailerConfig {
  const provider = (env.MAILER_PROVIDER ?? "").trim().toLowerCase();

  switch (provider) {
    case "graph":
      return parseMailerConfig({
        provider: "graph",
        tenantId: env.MAILER_GRAPH_TENANT_ID,
        clientId: env.MAILER_GRAPH_CLIENT_ID,
        clientSecret: env.MAILER_GRAPH_CLIENT_SECRET,
        sender: env.MAILER_GRAPH_SENDER,
        saveToSentItems: parseBool(env.MAILER_GRAPH_SAVE_TO_SENT, true),
      });
    case "smtp":
      return parseMailerConfig({
        provider: "smtp",
        host: env.MAILER_SMTP_HOST,
        port: env.MAILER_SMTP_PORT ? Number(env.MAILER_SMTP_PORT) : 587,
        secure: parseBool(env.MAILER_SMTP_SECURE, false),
        user: env.MAILER_SMTP_USER,
        password: env.MAILER_SMTP_PASSWORD,
        from: env.MAILER_SMTP_FROM,
      });
    case "powerautomate":
      return parseMailerConfig({
        provider: "powerautomate",
        url: env.MAILER_PA_URL,
        key: env.MAILER_PA_KEY || undefined,
      });
    default:
      throw new Error(
        `MAILER_PROVIDER must be one of: graph | smtp | powerautomate (got: "${provider}")`,
      );
  }
}

function parseBool(v: string | undefined, def: boolean): boolean {
  if (v === undefined || v === "") return def;
  return v.trim().toLowerCase() === "true";
}
