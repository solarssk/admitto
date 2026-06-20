import type { Context } from "hono";
import type { PrismaClient } from "@prisma/client";
import { z } from "zod";
import { canManageInstance } from "@admitto/auth";
import {
  describeMailConfigForOrg,
  setMailSettings,
  validateOrgMailSettingsUpdate,
  type ConfigDescriptor,
  type FieldDescriptor,
  type FieldSource,
  type MailSettingsInput,
} from "@admitto/mailer-config";
import {
  clientSafeDeliveryError,
  sendTransportTestEmail,
  type MailDeliveryDeps,
} from "@admitto/mail-delivery";
import { isSendSuccess } from "@admitto/mailer";
import { writeAdminAuditLog } from "@admitto/tickets";
import { adminAuditFromContext } from "./admin-helpers.js";
import { resolveInstanceOrganizationId } from "./instance-org.js";

/** Max JSON body for PUT /api/admin/mail-settings (includes secret fields). */
export const MAX_MAIL_SETTINGS_BODY_BYTES = 65_536;

const MAIL_PROVIDER = z.enum(["graph", "smtp", "powerautomate", "export_only"]);

const optionalEmail = z
  .union([z.string().trim().email().max(254), z.literal("")])
  .optional();

const optionalPositiveInt = z.union([z.number().int().min(1), z.null()]).optional();

const putMailSettingsBodySchema = z
  .object({
    provider: z.union([MAIL_PROVIDER, z.literal("")]).optional(),
    fromAddress: optionalEmail,
    fromName: z.string().max(200).optional(),
    replyTo: optionalEmail,
    envelopeFrom: optionalEmail,
    allowedFromDomain: z.string().max(253).optional(),
    host: z.string().max(253).optional(),
    port: z.union([z.number().int().min(1).max(65535), z.null()]).optional(),
    secure: z.boolean().optional(),
    user: z.string().max(254).optional(),
    requireTls: z.boolean().optional(),
    tlsRejectUnauthorized: z.boolean().optional(),
    heloName: z.string().max(253).optional(),
    pool: z.boolean().optional(),
    maxConnections: optionalPositiveInt,
    maxMessages: optionalPositiveInt,
    rateLimitPerMinute: optionalPositiveInt,
    connectionTimeout: optionalPositiveInt,
    greetingTimeout: optionalPositiveInt,
    socketTimeout: optionalPositiveInt,
    mailbox: optionalEmail,
    tenantId: z.string().max(64).optional(),
    clientId: z.string().max(64).optional(),
    saveToSentItems: z.boolean().optional(),
    smtpPassword: z.string().optional(),
    graphClientSecret: z.string().optional(),
    powerAutomateKey: z.string().optional(),
    powerAutomateUrl: z.string().optional(),
  })
  .strict();

const testMailTransportBodySchema = z
  .object({
    to: z
      .string()
      .trim()
      .email()
      .max(254)
      .refine((v) => !/[\r\n]/.test(v), "invalid email"),
  })
  .strict();

const SECRET_KEYS = [
  "smtpPassword",
  "graphClientSecret",
  "powerAutomateKey",
  "powerAutomateUrl",
] as const;

type SecretKey = (typeof SECRET_KEYS)[number];

type ApiFieldSource = "env" | "db" | "default";

function toApiSource(source: FieldSource): ApiFieldSource {
  if (source === "organization" || source === "event") return "db";
  return source;
}

function serializePlainField<T>(fd: FieldDescriptor<T>) {
  return {
    value: fd.value,
    source: toApiSource(fd.source),
    locked: fd.locked,
  };
}

function serializeSecretField(fd: FieldDescriptor<"••••" | null>) {
  return {
    set: fd.value === "••••",
    masked: fd.value,
    source: toApiSource(fd.source),
    locked: fd.locked,
  };
}

function serializeDescriptor(desc: ConfigDescriptor) {
  return {
    provider: serializePlainField(desc.provider),
    fromAddress: serializePlainField(desc.fromAddress),
    fromName: serializePlainField(desc.fromName),
    replyTo: serializePlainField(desc.replyTo),
    envelopeFrom: serializePlainField(desc.envelopeFrom),
    allowedFromDomain: serializePlainField(desc.allowedFromDomain),
    host: serializePlainField(desc.host),
    port: serializePlainField(desc.port),
    secure: serializePlainField(desc.secure),
    user: serializePlainField(desc.user),
    requireTls: serializePlainField(desc.requireTls),
    tlsRejectUnauthorized: serializePlainField(desc.tlsRejectUnauthorized),
    heloName: serializePlainField(desc.heloName),
    pool: serializePlainField(desc.pool),
    maxConnections: serializePlainField(desc.maxConnections),
    maxMessages: serializePlainField(desc.maxMessages),
    rateLimitPerMinute: serializePlainField(desc.rateLimitPerMinute),
    connectionTimeout: serializePlainField(desc.connectionTimeout),
    greetingTimeout: serializePlainField(desc.greetingTimeout),
    socketTimeout: serializePlainField(desc.socketTimeout),
    smtpPassword: serializeSecretField(desc.smtpPassword),
    mailbox: serializePlainField(desc.mailbox),
    tenantId: serializePlainField(desc.tenantId),
    clientId: serializePlainField(desc.clientId),
    saveToSentItems: serializePlainField(desc.saveToSentItems),
    graphClientSecret: serializeSecretField(desc.graphClientSecret),
    powerAutomateUrl: serializeSecretField(desc.powerAutomateUrl),
    powerAutomateKey: serializeSecretField(desc.powerAutomateKey),
  };
}

function isSecretKey(key: string): key is SecretKey {
  return (SECRET_KEYS as readonly string[]).includes(key);
}

function descriptorForKey(
  desc: ConfigDescriptor,
  key: keyof MailSettingsInput,
): FieldDescriptor<unknown> {
  return desc[key as keyof ConfigDescriptor] as FieldDescriptor<unknown>;
}

function isProductionEnv(env: NodeJS.ProcessEnv): boolean {
  return env.NODE_ENV === "production";
}

async function requireSuperadmin(c: Context, db: PrismaClient): Promise<Response | null> {
  const auth = c.get("auth");
  if (!(await canManageInstance(db, auth.userId))) {
    return c.json({ error: "forbidden" }, 403);
  }
  return null;
}

const MAIL_PROVIDER_UNCONFIGURED = "Cannot resolve mail provider";

/** GET /api/admin/mail-settings */
export async function handleGetMailSettings(c: Context, db: PrismaClient): Promise<Response> {
  const forbidden = await requireSuperadmin(c, db);
  if (forbidden) return forbidden;

  const orgId = await resolveInstanceOrganizationId(db, process.env);
  const desc = await describeMailConfigForOrg(orgId, db, process.env);

  return c.json({
    organizationId: orgId,
    isProduction: isProductionEnv(process.env),
    fields: serializeDescriptor(desc),
  });
}

/** PUT /api/admin/mail-settings */
export async function handlePutMailSettings(c: Context, db: PrismaClient): Promise<Response> {
  const forbidden = await requireSuperadmin(c, db);
  if (forbidden) return forbidden;

  let body: z.infer<typeof putMailSettingsBodySchema>;
  try {
    body = putMailSettingsBodySchema.parse(await c.req.json());
  } catch {
    return c.json({ error: "validation_failed" }, 400);
  }

  if (body.provider === "export_only" && isProductionEnv(process.env)) {
    return c.json({ error: "export_only is not allowed in production" }, 400);
  }

  const orgId = await resolveInstanceOrganizationId(db, process.env);
  const current = await describeMailConfigForOrg(orgId, db, process.env);
  const orgRow = await db.mailSettings.findUnique({
    where: { scope_type_scope_id: { scope_type: "organization", scope_id: orgId } },
  });

  for (const key of Object.keys(body) as Array<keyof typeof body>) {
    const fd = descriptorForKey(current, key as keyof MailSettingsInput);
    if (fd.locked) {
      return c.json({ error: "managed by environment" }, 400);
    }
  }

  const transportCheck = validateOrgMailSettingsUpdate(orgRow, body as MailSettingsInput, process.env);
  if (!transportCheck.ok) {
    return c.json({ error: "incomplete_transport", detail: transportCheck.error }, 400);
  }

  const fieldsChanged: string[] = [];
  const secretsRotated: string[] = [];
  const secretsCleared: string[] = [];

  for (const [key, value] of Object.entries(body)) {
    if (isSecretKey(key)) {
      if (value === "") secretsCleared.push(key);
      else if (typeof value === "string" && value.length > 0) secretsRotated.push(key);
    } else {
      fieldsChanged.push(key);
    }
  }

  await setMailSettings({ scopeType: "organization", scopeId: orgId }, body as MailSettingsInput, db);

  const audit = adminAuditFromContext(c);
  try {
    await writeAdminAuditLog(db, {
      organizationId: orgId,
      actorUserId: audit.operator!,
      sessionId: audit.sessionId,
      ip: audit.ip,
      actionType: "mail_settings_updated",
      metadata: {
        provider: body.provider ?? current.provider.value,
        fields_changed: fieldsChanged,
        secrets_rotated: secretsRotated,
        secrets_cleared: secretsCleared,
      },
    });
  } catch (auditErr) {
    console.error("[audit] mail_settings_updated log failed", auditErr);
  }

  const desc = await describeMailConfigForOrg(orgId, db, process.env);
  return c.json({
    organizationId: orgId,
    isProduction: isProductionEnv(process.env),
    fields: serializeDescriptor(desc),
  });
}

/** POST /api/admin/mail-settings/test */
export async function handlePostMailSettingsTest(
  c: Context,
  db: PrismaClient,
  mailDeliveryDeps: MailDeliveryDeps = {},
): Promise<Response> {
  const forbidden = await requireSuperadmin(c, db);
  if (forbidden) return forbidden;

  let body: z.infer<typeof testMailTransportBodySchema>;
  try {
    body = testMailTransportBodySchema.parse(await c.req.json());
  } catch {
    return c.json({ error: "validation_failed" }, 400);
  }

  const orgId = await resolveInstanceOrganizationId(db, process.env);
  const audit = adminAuditFromContext(c);

  let resultStatus: "sent" | "failed" = "failed";
  let errorMessage: string | undefined;

  try {
    const result = await sendTransportTestEmail(
      { organizationId: orgId, toAddress: body.to },
      db,
      process.env,
      mailDeliveryDeps,
    );

    if (!isSendSuccess(result.status) || result.error) {
      errorMessage = clientSafeDeliveryError(result.error);
    } else {
      resultStatus = "sent";
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : undefined;
    if (message?.includes(MAIL_PROVIDER_UNCONFIGURED)) {
      errorMessage = "mail transport not configured";
    } else {
      console.error("[admin] mail transport test failed", err);
      errorMessage = clientSafeDeliveryError(message);
    }
  }

  try {
    await writeAdminAuditLog(db, {
      organizationId: orgId,
      actorUserId: audit.operator!,
      sessionId: audit.sessionId,
      ip: audit.ip,
      actionType: "mail_transport_tested",
      metadata: { result: resultStatus },
    });
  } catch (auditErr) {
    console.error("[audit] mail_transport_tested log failed", auditErr);
  }

  if (resultStatus === "sent") {
    return c.json({ status: "sent" } satisfies { status: "sent" });
  }

  return c.json({
    status: "failed",
    error: errorMessage ?? "send failed",
  } satisfies { status: "failed"; error: string });
}
