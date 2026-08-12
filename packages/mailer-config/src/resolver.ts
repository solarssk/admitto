import { decryptFromString, CryptoDecryptionError } from "@admitto/crypto";
import { parseMailerConfig, safeParseMailerConfig, type MailerConfig } from "@admitto/mailer";
import type { PrismaClient, MailSettings } from "@admitto/db";
import { rawMailFieldsFromEnv } from "./envFields.js";
import { enforceAllowedFromDomain } from "./senderPolicy.js";

type Row = MailSettings | null;

export type MailConfigErrorCode = "mail_secret_decryption_failed";

/** Thrown when a stored mail secret (SMTP password, Graph client secret, Power Automate key)
 * cannot be decrypted - wrong/rotated ENCRYPTION_KEY or corrupted ciphertext. Wraps
 * {@link CryptoDecryptionError} so callers can branch on a mail-domain code without depending
 * on @admitto/crypto directly. */
export class MailConfigError extends Error {
  readonly code: MailConfigErrorCode;

  constructor(code: MailConfigErrorCode, message: string) {
    super(message);
    this.name = "MailConfigError";
    this.code = code;
  }
}

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
  try {
    return decryptFromString(enc);
  } catch (err) {
    if (err instanceof CryptoDecryptionError) {
      throw new MailConfigError(
        "mail_secret_decryption_failed",
        "A stored mail secret could not be decrypted. The encryption key may have changed, or the stored value is corrupted.",
      );
    }
    throw err;
  }
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
  const config = parseMailerConfig(raw);
  enforceAllowedFromDomain(
    first(eventRow?.allowed_from_domain, orgRow?.allowed_from_domain),
    config,
  );
  return config;
}

/**
 * Resolves effective MailerConfig for an organization (instance Settings).
 * Precedence: env > organization MailSettings > provider default (no event layer).
 */
export async function resolveMailConfigForOrg(
  organizationId: string,
  prisma: PrismaClient,
  env: NodeJS.ProcessEnv = process.env,
): Promise<MailerConfig> {
  const envFields = rawMailFieldsFromEnv(env);

  const orgRow = await prisma.mailSettings.findUnique({
    where: {
      scope_type_scope_id: {
        scope_type: "organization",
        scope_id: organizationId,
      },
    },
  });

  const provider = first<string>(envFields.provider, orgRow?.provider);

  if (!provider) {
    throw new Error(
      "Cannot resolve mail provider: not set in env (EMAIL_PROVIDER) or organization MailSettings.",
    );
  }

  const raw = buildRawConfig(provider, envFields, null, orgRow);
  const config = parseMailerConfig(raw);
  enforceAllowedFromDomain(orgRow?.allowed_from_domain, config);
  return config;
}

/** Shared by tryParseOrgMailConfigFromRow and tryParseEventMailConfigFromRow —
 * `ev` is null for the org-only case. */
function tryParseMailConfigFromRows(
  ev: Row,
  org: Row,
  env: NodeJS.ProcessEnv,
): { ok: true } | { ok: false; error: string } {
  try {
    const envFields = rawMailFieldsFromEnv(env);
    const provider = first<string>(envFields.provider, ev?.provider, org?.provider);
    if (!provider) {
      return { ok: true };
    }

    const raw = buildRawConfig(provider, envFields, ev, org);
    const parsed = safeParseMailerConfig(raw);
    if (parsed.success) {
      try {
        enforceAllowedFromDomain(first(ev?.allowed_from_domain, org?.allowed_from_domain), parsed.data);
      } catch (err) {
        const message = err instanceof Error ? err.message : "allowed from domain mismatch";
        return { ok: false, error: message };
      }
      return { ok: true };
    }

    const issue = parsed.error.issues[0];
    const field = issue?.path.length ? issue.path.join(".") : "configuration";
    return {
      ok: false,
      error: `${field}: ${issue?.message ?? "invalid"}`,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : "invalid mail environment configuration";
    return { ok: false, error: message };
  }
}

/** Safe org-scoped parse for pre-save validation (no throw). */
export function tryParseOrgMailConfigFromRow(
  orgRow: MailSettings | null,
  env: NodeJS.ProcessEnv = process.env,
): { ok: true } | { ok: false; error: string } {
  return tryParseMailConfigFromRows(null, orgRow, env);
}

/** Safe event-scoped parse for pre-save validation (no throw) — resolves against
 * the org row as fallback, mirroring resolveMailConfig's own env > event > org precedence. */
export function tryParseEventMailConfigFromRow(
  eventRow: MailSettings | null,
  orgRow: MailSettings | null,
  env: NodeJS.ProcessEnv = process.env,
): { ok: true } | { ok: false; error: string } {
  return tryParseMailConfigFromRows(eventRow, orgRow, env);
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
      // An event's own host is a fully event-admin-controlled connection target — never
      // let it authenticate with the organization's password. Without this, an event
      // override that sets only `host` (leaving its own smtpPassword unset) would silently
      // inherit the org's real SMTP credential and hand it to whatever server the event
      // admin chose, via either a normal send or the test-send preflight (security review
      // on #511/#512). The event's own password still wins first when it has one.
      const eventOwnsHost = ev?.host != null;
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
          () => (eventOwnsHost ? undefined : maybeDecrypt(org?.smtp_password_enc)),
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
      // Same reasoning as SMTP's host guard above: the URL is the connection target, so an
      // event that supplies its own URL must not receive the org's flow key.
      const eventOwnsUrl = ev?.power_automate_url_enc != null;
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
          () => (eventOwnsUrl ? undefined : maybeDecrypt(org?.power_automate_key_enc)),
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
