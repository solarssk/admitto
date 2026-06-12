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
 * Non-secret fields are stored plain.
 */
export async function setMailSettings(
  scope: MailScope,
  input: MailSettingsInput,
  prisma: PrismaClient,
): Promise<void> {
  const data = {
    provider: input.provider ?? null,
    // smtp non-secret
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
    // graph non-secret
    mailbox: input.mailbox ?? null,
    tenant_id: input.tenantId ?? null,
    client_id: input.clientId ?? null,
    save_to_sent_items: input.saveToSentItems ?? null,
    // shared sender
    from_address: input.fromAddress ?? null,
    from_name: input.fromName ?? null,
    reply_to: input.replyTo ?? null,
    envelope_from: input.envelopeFrom ?? null,
    allowed_from_domain: input.allowedFromDomain ?? null,
    // encrypted secrets
    smtp_password_enc: maybeEncrypt(input.smtpPassword) ?? null,
    graph_client_secret_enc: maybeEncrypt(input.graphClientSecret) ?? null,
    power_automate_key_enc: maybeEncrypt(input.powerAutomateKey) ?? null,
    power_automate_url_enc: maybeEncrypt(input.powerAutomateUrl) ?? null,
  };

  await prisma.mailSettings.upsert({
    where: { scope_type_scope_id: { scope_type: scope.scopeType, scope_id: scope.scopeId } },
    create: { scope_type: scope.scopeType, scope_id: scope.scopeId, ...data },
    update: data,
  });
}
