import type { PrismaClient, MailSettings } from "@prisma/client";
import { rawMailFieldsFromEnv } from "./envFields.js";
import { getProviderDefaults } from "./providerDefaults.js";
import type { ConfigDescriptor, FieldDescriptor, FieldSource } from "./types.js";

type Row = MailSettings | null;

function field<T>(value: T, source: FieldSource): FieldDescriptor<T> {
  return { value, source, locked: source === "env" };
}

function resolveField<T>(
  envVal: T | undefined,
  evVal: T | null | undefined,
  orgVal: T | null | undefined,
  defaultVal: T = null as T,
): FieldDescriptor<T> {
  if (envVal !== undefined && envVal !== null) return field(envVal, "env");
  if (evVal !== null && evVal !== undefined) return field(evVal, "event");
  if (orgVal !== null && orgVal !== undefined) return field(orgVal, "organization");
  return field(defaultVal, "default");
}

function secretField(
  envPresent: boolean,
  evPresent: boolean,
  orgPresent: boolean,
): FieldDescriptor<"••••" | null> {
  if (envPresent) return field("••••" as const, "env");
  if (evPresent) return field("••••" as const, "event");
  if (orgPresent) return field("••••" as const, "organization");
  return field(null, "default");
}

function buildConfigDescriptor(
  envFields: ReturnType<typeof rawMailFieldsFromEnv>,
  ev: Row,
  org: Row,
): ConfigDescriptor {
  const providerDesc = resolveField(envFields.provider, ev?.provider, org?.provider, null);
  const d = getProviderDefaults(providerDesc.value);

  return {
    provider: providerDesc,
    fromAddress: resolveField(envFields.fromAddress, ev?.from_address, org?.from_address, null),
    fromName: resolveField(envFields.fromName, ev?.from_name, org?.from_name, null),
    replyTo: resolveField(envFields.replyTo, ev?.reply_to, org?.reply_to, null),
    envelopeFrom: resolveField(envFields.envelopeFrom, ev?.envelope_from, org?.envelope_from, null),
    allowedFromDomain: resolveField(undefined, ev?.allowed_from_domain, org?.allowed_from_domain, null),
    host: resolveField(envFields.host, ev?.host, org?.host, null),
    port: resolveField(envFields.port, ev?.port, org?.port, d.port ?? null),
    secure: resolveField(envFields.secure, ev?.secure, org?.secure, d.secure ?? null),
    user: resolveField(envFields.user, ev?.user, org?.user, null),
    requireTls: resolveField(envFields.requireTls, ev?.require_tls, org?.require_tls, d.requireTls ?? null),
    tlsRejectUnauthorized: resolveField(
      envFields.tlsRejectUnauthorized,
      ev?.tls_reject_unauthorized,
      org?.tls_reject_unauthorized,
      d.tlsRejectUnauthorized ?? null,
    ),
    heloName: resolveField(envFields.heloName, ev?.helo_name, org?.helo_name, null),
    pool: resolveField(envFields.pool, ev?.pool, org?.pool, d.pool ?? null),
    maxConnections: resolveField(envFields.maxConnections, ev?.max_connections, org?.max_connections, d.maxConnections ?? null),
    maxMessages: resolveField(envFields.maxMessages, ev?.max_messages, org?.max_messages, d.maxMessages ?? null),
    rateLimitPerMinute: resolveField(
      envFields.rateLimitPerMinute,
      ev?.rate_limit_per_minute,
      org?.rate_limit_per_minute,
      d.rateLimitPerMinute ?? null,
    ),
    connectionTimeout: resolveField(
      envFields.connectionTimeout,
      ev?.connection_timeout,
      org?.connection_timeout,
      d.connectionTimeout ?? null,
    ),
    greetingTimeout: resolveField(
      envFields.greetingTimeout,
      ev?.greeting_timeout,
      org?.greeting_timeout,
      d.greetingTimeout ?? null,
    ),
    socketTimeout: resolveField(envFields.socketTimeout, ev?.socket_timeout, org?.socket_timeout, d.socketTimeout ?? null),
    smtpPassword: secretField(
      envFields.smtpPassword !== undefined,
      !!ev?.smtp_password_enc,
      !!org?.smtp_password_enc,
    ),
    mailbox: resolveField(envFields.mailbox, ev?.mailbox, org?.mailbox, null),
    tenantId: resolveField(envFields.tenantId, ev?.tenant_id, org?.tenant_id, null),
    clientId: resolveField(envFields.clientId, ev?.client_id, org?.client_id, null),
    saveToSentItems: resolveField(
      envFields.saveToSentItems,
      ev?.save_to_sent_items,
      org?.save_to_sent_items,
      d.saveToSentItems ?? null,
    ),
    graphClientSecret: secretField(
      envFields.graphClientSecret !== undefined,
      !!ev?.graph_client_secret_enc,
      !!org?.graph_client_secret_enc,
    ),
    powerAutomateUrl: secretField(
      envFields.powerAutomateUrl !== undefined,
      !!ev?.power_automate_url_enc,
      !!org?.power_automate_url_enc,
    ),
    powerAutomateKey: secretField(
      envFields.powerAutomateKey !== undefined,
      !!ev?.power_automate_key_enc,
      !!org?.power_automate_key_enc,
    ),
  };
}

/**
 * Returns per-field descriptors for the UI Settings screen.
 * Secrets are always masked ("••••") — never decrypted.
 * locked=true means the field is set in env and cannot be edited from the UI.
 */
export async function describeMailConfig(
  eventId: string,
  prisma: PrismaClient,
  env: NodeJS.ProcessEnv = process.env,
): Promise<ConfigDescriptor> {
  const envFields = rawMailFieldsFromEnv(env);

  const event = await prisma.event.findUniqueOrThrow({ where: { id: eventId } });

  const [ev, org]: [Row, Row] = await Promise.all([
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

  return buildConfigDescriptor(envFields, ev, org);
}

/**
 * Org-scoped describe for instance Settings (ADR 0031).
 * Precedence: env > organization DB > default (no event layer).
 */
export async function describeMailConfigForOrg(
  organizationId: string,
  prisma: PrismaClient,
  env: NodeJS.ProcessEnv = process.env,
): Promise<ConfigDescriptor> {
  const envFields = rawMailFieldsFromEnv(env);

  const org = await prisma.mailSettings.findUnique({
    where: {
      scope_type_scope_id: {
        scope_type: "organization",
        scope_id: organizationId,
      },
    },
  });

  return buildConfigDescriptor(envFields, null, org);
}

/**
 * First-run setup wizard: org DB + defaults only — env placeholders must not lock the form.
 */
export async function describeMailConfigForOrgWizard(
  organizationId: string,
  prisma: PrismaClient,
): Promise<ConfigDescriptor> {
  const org = await prisma.mailSettings.findUnique({
    where: {
      scope_type_scope_id: {
        scope_type: "organization",
        scope_id: organizationId,
      },
    },
  });

  return buildConfigDescriptor({}, null, org);
}
