import type { Context } from "hono";
import type { PrismaClient } from "@prisma/client";
import type { z } from "zod";
import { canManageInstance, resolveSetupComplete } from "@admitto/auth";
import {
  describeMailConfigForOrg,
  describeMailConfigForOrgWizard,
  setMailSettings,
  validateOrgMailSettingsUpdate,
  type ConfigDescriptor,
  type MailSettingsInput,
} from "@admitto/mailer-config";
import {
  sendTransportTestEmail,
  transportTestErrorForAdmin,
  type MailDeliveryDeps,
} from "@admitto/mail-delivery";
import { isSendSuccess, type MailerProvider } from "@admitto/mailer";
import { writeAdminAuditLog } from "@admitto/tickets";
import { adminAuditFromContext } from "./admin-helpers.js";
import { resolveInstanceOrganizationId } from "./instance-org.js";
import {
  putMailSettingsBodySchema,
  testMailTransportBodySchema,
  serializeDescriptor,
  descriptorForKey,
  isSecretKey,
  isProductionEnv,
  MAIL_PROVIDER_UNCONFIGURED,
  MAX_MAIL_SETTINGS_BODY_BYTES,
} from "./mail-settings-shared.js";

export { MAX_MAIL_SETTINGS_BODY_BYTES };

async function requireSuperadmin(c: Context, db: PrismaClient): Promise<Response | null> {
  const auth = c.get("auth");
  if (!(await canManageInstance(db, auth.userId))) {
    return c.json({ error: "forbidden" }, 403);
  }
  return null;
}

async function isFirstRunWizard(db: PrismaClient): Promise<boolean> {
  return !(await resolveSetupComplete(db));
}

async function describeOrgMailForAdmin(
  orgId: string,
  db: PrismaClient,
  env: NodeJS.ProcessEnv,
): Promise<ConfigDescriptor> {
  if (await isFirstRunWizard(db)) {
    return describeMailConfigForOrgWizard(orgId, db);
  }
  return describeMailConfigForOrg(orgId, db, env);
}

/** GET /api/admin/mail-settings */
export async function handleGetMailSettings(c: Context, db: PrismaClient): Promise<Response> {
  const forbidden = await requireSuperadmin(c, db);
  if (forbidden) return forbidden;

  const orgId = await resolveInstanceOrganizationId(db, process.env);
  const desc = await describeOrgMailForAdmin(orgId, db, process.env);

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
  const firstRun = await isFirstRunWizard(db);
  const current = await describeOrgMailForAdmin(orgId, db, process.env);
  const orgRow = await db.mailSettings.findUnique({
    where: { scope_type_scope_id: { scope_type: "organization", scope_id: orgId } },
  });

  if (!firstRun) {
    for (const key of Object.keys(body) as Array<keyof typeof body>) {
      const fd = descriptorForKey(current, key as keyof MailSettingsInput);
      if (fd.locked) {
        return c.json({ error: "managed by environment" }, 400);
      }
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

  await db.$transaction(async (tx) => {
    await setMailSettings({ scopeType: "organization", scopeId: orgId }, body as MailSettingsInput, tx);

    const audit = adminAuditFromContext(c);
    await writeAdminAuditLog(tx, {
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
  });

  const desc = await describeOrgMailForAdmin(orgId, db, process.env);
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
  const mailEnv = (await isFirstRunWizard(db)) ? ({} as NodeJS.ProcessEnv) : process.env;

  let resultStatus: "sent" | "failed" = "failed";
  let errorMessage: string | undefined;
  let resultProvider: MailerProvider | undefined;
  let resultProviderMessageId: string | undefined;
  let resultRetryable: boolean | undefined;

  try {
    const result = await sendTransportTestEmail(
      { organizationId: orgId, toAddress: body.to },
      db,
      mailEnv,
      mailDeliveryDeps,
    );
    resultProvider = result.provider;

    if (!isSendSuccess(result.status) || result.error) {
      if (result.error) {
        console.error("[admin] mail transport test failed:", result.error);
      }
      errorMessage = transportTestErrorForAdmin(result.error);
      resultRetryable = result.retryable;
    } else {
      resultStatus = "sent";
      resultProviderMessageId = result.providerMessageId;
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : undefined;
    if (message) {
      console.error("[admin] mail transport test failed:", message);
    }
    if (message?.includes(MAIL_PROVIDER_UNCONFIGURED)) {
      errorMessage = "mail transport not configured";
    } else {
      errorMessage = transportTestErrorForAdmin(message);
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
    // resultProvider is always set alongside resultStatus = "sent" above.
    return c.json({
      status: "sent",
      provider: resultProvider!,
      ...(resultProviderMessageId ? { providerMessageId: resultProviderMessageId } : {}),
    } satisfies { status: "sent"; provider: MailerProvider; providerMessageId?: string });
  }

  return c.json({
    status: "failed",
    error: errorMessage ?? "send failed",
    ...(resultProvider ? { provider: resultProvider } : {}),
    ...(resultRetryable !== undefined ? { retryable: resultRetryable } : {}),
  } satisfies { status: "failed"; error: string; provider?: MailerProvider; retryable?: boolean });
}
