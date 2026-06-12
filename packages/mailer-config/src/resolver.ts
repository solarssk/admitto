import { decryptFromString } from "@admitto/crypto";
import { parseMailerConfig, type MailerConfig } from "@admitto/mailer";
import type { PrismaClient, MailSettings } from "@prisma/client";
import { rawMailFieldsFromEnv } from "./envFields.js";

type Row = MailSettings | null;

/** Pick first non-null/undefined value from a list. */
function first<T>(...values: (T | null | undefined)[]): T | undefined {
  for (const v of values) {
    if (v !== null && v !== undefined) return v;
  }
  return undefined;
}

/**
 * Lazy variant: evaluates thunks in order and returns the first non-null result.
 * Used for secrets so that lower-priority decryption is skipped when a
 * higher-priority value already wins — avoids throwing due to a missing
 * ENCRYPTION_KEY when env already supplies the secret.
 */
function firstLazy<T>(...loaders: Array<() => T | null | undefined>): T | undefined {
  for (const load of loaders) {
    const value = load();
    if (value !== null && value !== undefined) return value;
  }
  return undefined;
}

function maybeDecrypt(enc: string | null | undefined): string | undefined {
  if (!enc) return undefined;
  return decryptFromString(enc);
}

/**
 * Resolves the effective MailerConfig for an event.
 * Precedence per field: env (locked) > event MailSettings > org MailSettings > provider default.
 * Provider is resolved first; only fields valid for the resolved provider are merged.
 * Throws if no provider can be resolved, or if decryption fails (missing ENCRYPTION_KEY).
 */
export async function resolveMailConfig(
  eventId: string,
  prisma: PrismaClient,
  env: NodeJS.ProcessEnv = process.env,
): Promise<MailerConfig> {
  const envFields = rawMailFieldsFromEnv(env);

  const event = await prisma.event.findUniqueOrThrow({ where: { id: eventId } });

  const [eventRow, orgRow] = await Promise.all([
    prisma.mailSettings.findUnique({
      where: { scope_type_scope_id: { scope_type: "event", scope_id: eventId } },
    }),
    prisma.mailSettings.findUnique({
      where: {
        scope_type_scope_id: {
          scope_type: "organization",
          scope_id: event.organization_id,
        },
      },
    }),
  ]);

  const provider = first<string>(
    envFields.provider,
    eventRow?.provider,
    orgRow?.provider,
  );

  if (!provider) {
    throw new Error(
      "Cannot resolve mail provider: not set in env (EMAIL_PROVIDER), event MailSettings, or organization MailSettings.",
    );
  }

  const raw = buildRawConfig(provider, envFields, eventRow, orgRow);
  return parseMailerConfig(raw);
}

function buildRawConfig(
  provider: string,
  env: ReturnType<typeof rawMailFieldsFromEnv>,
  ev: Row,
  org: Row,
): Record<string, unknown> {
  // Shared sender fields (all providers)
  const fromAddress = first(env.fromAddress, ev?.from_address, org?.from_address);
  const fromName = first(env.fromName, ev?.from_name, org?.from_name);
  const replyTo = first(env.replyTo, ev?.reply_to, org?.reply_to);
  const envelopeFrom = first(env.envelopeFrom, ev?.envelope_from, org?.envelope_from);

  const base = { provider, fromAddress, fromName, replyTo, envelopeFrom };

  switch (provider) {
    case "smtp": {
      return {
        ...base,
        host: first(env.host, ev?.host, org?.host),
        port: first(env.port, ev?.port, org?.port),
        secure: first(env.secure, ev?.secure, org?.secure),
        user: first(env.user, ev?.user, org?.user),
        // firstLazy: skip lower-priority decryptions when env secret already wins
        password: firstLazy(
          () => env.smtpPassword,
          () => maybeDecrypt(ev?.smtp_password_enc),
          () => maybeDecrypt(org?.smtp_password_enc),
        ),
        requireTLS: first(env.requireTls, ev?.require_tls, org?.require_tls),
        tlsRejectUnauthorized: first(
          env.tlsRejectUnauthorized,
          ev?.tls_reject_unauthorized,
          org?.tls_reject_unauthorized,
        ),
        heloName: first(env.heloName, ev?.helo_name, org?.helo_name),
        pool: first(env.pool, ev?.pool, org?.pool),
        maxConnections: first(env.maxConnections, ev?.max_connections, org?.max_connections),
        maxMessages: first(env.maxMessages, ev?.max_messages, org?.max_messages),
        rateLimitPerMinute: first(
          env.rateLimitPerMinute,
          ev?.rate_limit_per_minute,
          org?.rate_limit_per_minute,
        ),
        connectionTimeout: first(
          env.connectionTimeout,
          ev?.connection_timeout,
          org?.connection_timeout,
        ),
        greetingTimeout: first(
          env.greetingTimeout,
          ev?.greeting_timeout,
          org?.greeting_timeout,
        ),
        socketTimeout: first(env.socketTimeout, ev?.socket_timeout, org?.socket_timeout),
      };
    }
    case "graph": {
      // mailbox fallback to fromAddress happens here, not in rawMailFieldsFromEnv,
      // so that a DB-configured mailbox can still win when only MAIL_FROM_ADDRESS is in env.
      const mailbox = first(env.mailbox, ev?.mailbox, org?.mailbox);
      return {
        ...base,
        mailbox: mailbox ?? fromAddress,
        tenantId: first(env.tenantId, ev?.tenant_id, org?.tenant_id),
        clientId: first(env.clientId, ev?.client_id, org?.client_id),
        clientSecret: firstLazy(
          () => env.graphClientSecret,
          () => maybeDecrypt(ev?.graph_client_secret_enc),
          () => maybeDecrypt(org?.graph_client_secret_enc),
        ),
        saveToSentItems: first(
          env.saveToSentItems,
          ev?.save_to_sent_items,
          org?.save_to_sent_items,
        ),
      };
    }
    case "powerautomate": {
      return {
        ...base,
        url: firstLazy(
          () => env.powerAutomateUrl,
          () => maybeDecrypt(ev?.power_automate_url_enc),
          () => maybeDecrypt(org?.power_automate_url_enc),
        ),
        key: firstLazy(
          () => env.powerAutomateKey,
          () => maybeDecrypt(ev?.power_automate_key_enc),
          () => maybeDecrypt(org?.power_automate_key_enc),
        ),
      };
    }
    case "export_only": {
      return base;
    }
    default: {
      throw new Error(`Unknown provider: "${provider}"`);
    }
  }
}
