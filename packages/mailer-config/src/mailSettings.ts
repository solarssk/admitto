import { encryptToString } from "@admitto/crypto";
import type { MailSettings, Prisma, PrismaClient } from "@prisma/client";
import type { MailScope, MailSettingsInput } from "./types.js";

function maybeEncrypt(value: string | undefined): string | undefined {
  if (value === undefined || value === "") return undefined;
  return encryptToString(value);
}

/** Treats blank strings the same as absent — stores null instead. */
const str = (v: string | undefined): string | null => (v === undefined || v === "" ? null : v);

function emptyMailSettingsRow(scopeId: string): MailSettings {
  return {
    id: "__merge_sim__",
    scope_type: "organization",
    scope_id: scopeId,
    provider: null,
    host: null,
    port: null,
    secure: null,
    user: null,
    require_tls: null,
    tls_reject_unauthorized: null,
    helo_name: null,
    pool: null,
    max_connections: null,
    max_messages: null,
    rate_limit_per_minute: null,
    connection_timeout: null,
    greeting_timeout: null,
    socket_timeout: null,
    mailbox: null,
    tenant_id: null,
    client_id: null,
    save_to_sent_items: null,
    from_address: null,
    from_name: null,
    reply_to: null,
    envelope_from: null,
    allowed_from_domain: null,
    smtp_password_enc: null,
    graph_client_secret_enc: null,
    power_automate_key_enc: null,
    power_automate_url_enc: null,
    created_at: new Date(0),
    updated_at: new Date(0),
  };
}

/** Non-secret fields whose merge is a straight passthrough (`??  null` for numbers/
 * booleans, `str()` for strings that treat "" as absent) — split from the secret
 * fields below to keep mergeMailSettingsRow's own cognitive complexity low. */
function applyIdentityAndSenderFields(row: MailSettings, input: MailSettingsInput): void {
  if ("provider" in input) row.provider = str(input.provider);
  if ("host" in input) row.host = str(input.host);
  if ("user" in input) row.user = str(input.user);
  if ("heloName" in input) row.helo_name = str(input.heloName);
  if ("mailbox" in input) row.mailbox = str(input.mailbox);
  if ("tenantId" in input) row.tenant_id = str(input.tenantId);
  if ("clientId" in input) row.client_id = str(input.clientId);
  if ("fromAddress" in input) row.from_address = str(input.fromAddress);
  if ("fromName" in input) row.from_name = str(input.fromName);
  if ("replyTo" in input) row.reply_to = str(input.replyTo);
  if ("envelopeFrom" in input) row.envelope_from = str(input.envelopeFrom);
  if ("allowedFromDomain" in input) row.allowed_from_domain = str(input.allowedFromDomain);
}

function applyNumericAndBooleanFields(row: MailSettings, input: MailSettingsInput): void {
  if ("port" in input) row.port = input.port ?? null;
  if ("secure" in input) row.secure = input.secure ?? null;
  if ("requireTls" in input) row.require_tls = input.requireTls ?? null;
  if ("tlsRejectUnauthorized" in input) row.tls_reject_unauthorized = input.tlsRejectUnauthorized ?? null;
  if ("pool" in input) row.pool = input.pool ?? null;
  if ("maxConnections" in input) row.max_connections = input.maxConnections ?? null;
  if ("maxMessages" in input) row.max_messages = input.maxMessages ?? null;
  if ("rateLimitPerMinute" in input) row.rate_limit_per_minute = input.rateLimitPerMinute ?? null;
  if ("connectionTimeout" in input) row.connection_timeout = input.connectionTimeout ?? null;
  if ("greetingTimeout" in input) row.greeting_timeout = input.greetingTimeout ?? null;
  if ("socketTimeout" in input) row.socket_timeout = input.socketTimeout ?? null;
  if ("saveToSentItems" in input) row.save_to_sent_items = input.saveToSentItems ?? null;
}

function applySecretFields(row: MailSettings, input: MailSettingsInput): void {
  if ("smtpPassword" in input) row.smtp_password_enc = maybeEncrypt(input.smtpPassword) ?? null;
  if ("graphClientSecret" in input) row.graph_client_secret_enc = maybeEncrypt(input.graphClientSecret) ?? null;
  if ("powerAutomateKey" in input) row.power_automate_key_enc = maybeEncrypt(input.powerAutomateKey) ?? null;
  if ("powerAutomateUrl" in input) row.power_automate_url_enc = maybeEncrypt(input.powerAutomateUrl) ?? null;
}

/** Applies a partial MailSettingsInput onto a row — org or event, the merge logic
 * doesn't read scope_type (same semantics as setMailSettings update). */
export function mergeMailSettingsRow(
  current: MailSettings | null,
  input: MailSettingsInput,
  scopeId = "",
): MailSettings {
  const row = { ...(current ?? emptyMailSettingsRow(scopeId)) };

  applyIdentityAndSenderFields(row, input);
  applyNumericAndBooleanFields(row, input);
  applySecretFields(row, input);

  return row;
}

/**
 * Upserts a MailSettings record for the given scope.
 * Secret fields are encrypted via @admitto/crypto before storage.
 *
 * Omitting a field in `input` means "leave existing value unchanged" — it does
 * NOT clear the column. This is critical for secrets: describeMailConfig masks
 * them so the UI cannot round-trip the plaintext, so a partial save must never
 * silently delete a stored credential.
 */
export async function setMailSettings(
  scope: MailScope,
  input: MailSettingsInput,
  prisma: PrismaClient | Prisma.TransactionClient,
): Promise<void> {
  // For create: all columns start at null; only supplied fields are set.
  // For update: only supplied fields are included — omitted fields are not touched.
  const supplied = <T>(key: keyof MailSettingsInput, value: T | null): Record<string, T | null> =>
    key in input ? { [key]: value } : {};

  const secretCol = (
    inputKey: keyof MailSettingsInput,
    dbCol: string,
    rawValue: string | undefined,
  ): Record<string, string | null> =>
    inputKey in input ? { [dbCol]: maybeEncrypt(rawValue) ?? null } : {};

  const updateData = {
    ...supplied("provider", str(input.provider)),
    // smtp non-secret
    ...supplied("host", str(input.host)),
    ...supplied("port", input.port ?? null),
    ...supplied("secure", input.secure ?? null),
    ...supplied("user", str(input.user)),
    ...(("requireTls" in input) ? { require_tls: input.requireTls ?? null } : {}),
    ...(("tlsRejectUnauthorized" in input) ? { tls_reject_unauthorized: input.tlsRejectUnauthorized ?? null } : {}),
    ...(("heloName" in input) ? { helo_name: str(input.heloName) } : {}),
    ...supplied("pool", input.pool ?? null),
    ...(("maxConnections" in input) ? { max_connections: input.maxConnections ?? null } : {}),
    ...(("maxMessages" in input) ? { max_messages: input.maxMessages ?? null } : {}),
    ...(("rateLimitPerMinute" in input) ? { rate_limit_per_minute: input.rateLimitPerMinute ?? null } : {}),
    ...(("connectionTimeout" in input) ? { connection_timeout: input.connectionTimeout ?? null } : {}),
    ...(("greetingTimeout" in input) ? { greeting_timeout: input.greetingTimeout ?? null } : {}),
    ...(("socketTimeout" in input) ? { socket_timeout: input.socketTimeout ?? null } : {}),
    // graph non-secret
    ...supplied("mailbox", str(input.mailbox)),
    ...(("tenantId" in input) ? { tenant_id: str(input.tenantId) } : {}),
    ...(("clientId" in input) ? { client_id: str(input.clientId) } : {}),
    ...(("saveToSentItems" in input) ? { save_to_sent_items: input.saveToSentItems ?? null } : {}),
    // shared sender
    ...(("fromAddress" in input) ? { from_address: str(input.fromAddress) } : {}),
    ...(("fromName" in input) ? { from_name: str(input.fromName) } : {}),
    ...(("replyTo" in input) ? { reply_to: str(input.replyTo) } : {}),
    ...(("envelopeFrom" in input) ? { envelope_from: str(input.envelopeFrom) } : {}),
    ...(("allowedFromDomain" in input) ? { allowed_from_domain: str(input.allowedFromDomain) } : {}),
    // encrypted secrets — only updated when explicitly supplied
    ...secretCol("smtpPassword", "smtp_password_enc", input.smtpPassword),
    ...secretCol("graphClientSecret", "graph_client_secret_enc", input.graphClientSecret),
    ...secretCol("powerAutomateKey", "power_automate_key_enc", input.powerAutomateKey),
    ...secretCol("powerAutomateUrl", "power_automate_url_enc", input.powerAutomateUrl),
  };

  // For create we need all columns explicitly — fields not in input default to null.
  const createData = {
    scope_type: scope.scopeType,
    scope_id: scope.scopeId,
    provider: str(input.provider),
    host: str(input.host),
    port: input.port ?? null,
    secure: input.secure ?? null,
    user: str(input.user),
    require_tls: input.requireTls ?? null,
    tls_reject_unauthorized: input.tlsRejectUnauthorized ?? null,
    helo_name: str(input.heloName),
    pool: input.pool ?? null,
    max_connections: input.maxConnections ?? null,
    max_messages: input.maxMessages ?? null,
    rate_limit_per_minute: input.rateLimitPerMinute ?? null,
    connection_timeout: input.connectionTimeout ?? null,
    greeting_timeout: input.greetingTimeout ?? null,
    socket_timeout: input.socketTimeout ?? null,
    mailbox: str(input.mailbox),
    tenant_id: str(input.tenantId),
    client_id: str(input.clientId),
    save_to_sent_items: input.saveToSentItems ?? null,
    from_address: str(input.fromAddress),
    from_name: str(input.fromName),
    reply_to: str(input.replyTo),
    envelope_from: str(input.envelopeFrom),
    allowed_from_domain: str(input.allowedFromDomain),
    smtp_password_enc: maybeEncrypt(input.smtpPassword) ?? null,
    graph_client_secret_enc: maybeEncrypt(input.graphClientSecret) ?? null,
    power_automate_key_enc: maybeEncrypt(input.powerAutomateKey) ?? null,
    power_automate_url_enc: maybeEncrypt(input.powerAutomateUrl) ?? null,
  };

  await prisma.mailSettings.upsert({
    where: { scope_type_scope_id: { scope_type: scope.scopeType, scope_id: scope.scopeId } },
    create: createData,
    update: updateData,
  });
}
