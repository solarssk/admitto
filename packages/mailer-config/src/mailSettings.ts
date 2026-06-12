import { encryptToString } from "@admitto/crypto";
import type { PrismaClient } from "@prisma/client";
import type { MailScope, MailSettingsInput } from "./types.js";

function maybeEncrypt(value: string | undefined): string | undefined {
  if (value === undefined || value === "") return undefined;
  return encryptToString(value);
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
  prisma: PrismaClient,
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
    ...supplied("provider", input.provider ?? null),
    // smtp non-secret
    ...supplied("host", input.host ?? null),
    ...supplied("port", input.port ?? null),
    ...supplied("secure", input.secure ?? null),
    ...supplied("user", input.user ?? null),
    ...(("requireTls" in input) ? { require_tls: input.requireTls ?? null } : {}),
    ...(("tlsRejectUnauthorized" in input) ? { tls_reject_unauthorized: input.tlsRejectUnauthorized ?? null } : {}),
    ...(("heloName" in input) ? { helo_name: input.heloName ?? null } : {}),
    ...supplied("pool", input.pool ?? null),
    ...(("maxConnections" in input) ? { max_connections: input.maxConnections ?? null } : {}),
    ...(("maxMessages" in input) ? { max_messages: input.maxMessages ?? null } : {}),
    ...(("rateLimitPerMinute" in input) ? { rate_limit_per_minute: input.rateLimitPerMinute ?? null } : {}),
    ...(("connectionTimeout" in input) ? { connection_timeout: input.connectionTimeout ?? null } : {}),
    ...(("greetingTimeout" in input) ? { greeting_timeout: input.greetingTimeout ?? null } : {}),
    ...(("socketTimeout" in input) ? { socket_timeout: input.socketTimeout ?? null } : {}),
    // graph non-secret
    ...supplied("mailbox", input.mailbox ?? null),
    ...(("tenantId" in input) ? { tenant_id: input.tenantId ?? null } : {}),
    ...(("clientId" in input) ? { client_id: input.clientId ?? null } : {}),
    ...(("saveToSentItems" in input) ? { save_to_sent_items: input.saveToSentItems ?? null } : {}),
    // shared sender
    ...(("fromAddress" in input) ? { from_address: input.fromAddress ?? null } : {}),
    ...(("fromName" in input) ? { from_name: input.fromName ?? null } : {}),
    ...(("replyTo" in input) ? { reply_to: input.replyTo ?? null } : {}),
    ...(("envelopeFrom" in input) ? { envelope_from: input.envelopeFrom ?? null } : {}),
    ...(("allowedFromDomain" in input) ? { allowed_from_domain: input.allowedFromDomain ?? null } : {}),
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
    provider: input.provider ?? null,
    host: input.host ?? null,
    port: input.port ?? null,
    secure: input.secure ?? null,
    user: input.user ?? null,
    require_tls: input.requireTls ?? null,
    tls_reject_unauthorized: input.tlsRejectUnauthorized ?? null,
    helo_name: input.heloName ?? null,
    pool: input.pool ?? null,
    max_connections: input.maxConnections ?? null,
    max_messages: input.maxMessages ?? null,
    rate_limit_per_minute: input.rateLimitPerMinute ?? null,
    connection_timeout: input.connectionTimeout ?? null,
    greeting_timeout: input.greetingTimeout ?? null,
    socket_timeout: input.socketTimeout ?? null,
    mailbox: input.mailbox ?? null,
    tenant_id: input.tenantId ?? null,
    client_id: input.clientId ?? null,
    save_to_sent_items: input.saveToSentItems ?? null,
    from_address: input.fromAddress ?? null,
    from_name: input.fromName ?? null,
    reply_to: input.replyTo ?? null,
    envelope_from: input.envelopeFrom ?? null,
    allowed_from_domain: input.allowedFromDomain ?? null,
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
