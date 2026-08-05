import type { Context } from "hono";
import type { PrismaClient } from "@admitto/db";
import type { z } from "zod";
import { resolveSetupComplete } from "@admitto/auth";
import {
  describeMailConfigForOrg,
  describeMailConfigForOrgWizard,
  resolveMailConfigForOrg,
  setMailSettings,
  validateOrgMailSettingsUpdate,
  type ConfigDescriptor,
  type MailSettingsInput,
} from "@admitto/mailer-config";
import { sendTransportTestEmail, type MailDeliveryDeps } from "@admitto/mail-delivery";
import { writeAdminAuditLog } from "@admitto/tickets";
import { adminAuditFromContext, requireSuperadmin } from "./admin-helpers.js";
import { resolveInstanceOrganizationId } from "./instance-org.js";
import {
  putMailSettingsBodySchema,
  testMailTransportBodySchema,
  parseTestMailTransportBody,
  serializeDescriptor,
  descriptorForKey,
  isProductionEnv,
  classifyMailSettingsFields,
  runTransportTest,
  transportTestResponse,
  runSmtpConnectionProbe,
  SMTP_PROBE_NOT_SMTP_MESSAGE,
  MAIL_PROVIDER_UNCONFIGURED,
  type MailSmtpProbeDeps,
} from "./mail-settings-shared.js";

export { MAX_MAIL_SETTINGS_BODY_BYTES } from "./mail-settings-shared.js";

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

  const { fieldsChanged, secretsRotated, secretsCleared } = classifyMailSettingsFields(body);

  await db.$transaction(async (tx) => {
    await setMailSettings({ scopeType: "organization", scopeId: orgId }, body as MailSettingsInput, tx);

    const audit = adminAuditFromContext(c);
    await writeAdminAuditLog(tx, {
      organizationId: orgId,
      actorUserId: audit.operator!,
      sessionId: audit.sessionId,
      ip: audit.ip,
      timezone: audit.timezone,
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

  let rawBody: unknown;
  try {
    rawBody = await c.req.json();
  } catch {
    return c.json({ error: "validation_failed" }, 400);
  }

  let body: z.infer<typeof testMailTransportBodySchema>;
  {
    const parsed = parseTestMailTransportBody(rawBody);
    if (!parsed.ok) {
      return c.json({ error: "validation_failed", detail: parsed.detail }, 400);
    }
    body = parsed.data;
  }

  const orgId = await resolveInstanceOrganizationId(db, process.env);
  const audit = adminAuditFromContext(c);
  const mailEnv = (await isFirstRunWizard(db)) ? ({} as NodeJS.ProcessEnv) : process.env;

  const outcome = await runTransportTest(
    () => sendTransportTestEmail({ organizationId: orgId, toAddress: body.to }, db, mailEnv, mailDeliveryDeps),
    "[admin] mail transport test",
  );

  try {
    await writeAdminAuditLog(db, {
      organizationId: orgId,
      actorUserId: audit.operator!,
      sessionId: audit.sessionId,
      ip: audit.ip,
      timezone: audit.timezone,
      actionType: "mail_transport_tested",
      metadata: { result: outcome.resultStatus },
    });
  } catch (auditErr) {
    console.error("[audit] mail_transport_tested log failed", auditErr);
  }

  return transportTestResponse(c, outcome);
}

/** POST /api/admin/mail-settings/probe — SMTP verify only (no message send). */
export async function handlePostMailSettingsProbe(
  c: Context,
  db: PrismaClient,
  probeDeps: MailSmtpProbeDeps = {},
): Promise<Response> {
  const forbidden = await requireSuperadmin(c, db);
  if (forbidden) return forbidden;

  const orgId = await resolveInstanceOrganizationId(db, process.env);
  const audit = adminAuditFromContext(c);
  const mailEnv = (await isFirstRunWizard(db)) ? ({} as NodeJS.ProcessEnv) : process.env;

  let config;
  try {
    config = await resolveMailConfigForOrg(orgId, db, mailEnv);
  } catch (err) {
    const message = err instanceof Error ? err.message : undefined;
    if (message?.includes(MAIL_PROVIDER_UNCONFIGURED)) {
      return c.json({ ok: false, error: "mail transport not configured" }, 400);
    }
    throw err;
  }

  if (config.provider !== "smtp") {
    return c.json({ ok: false, error: SMTP_PROBE_NOT_SMTP_MESSAGE }, 400);
  }

  const outcome = await runSmtpConnectionProbe(config, "[admin] mail smtp probe", probeDeps);

  try {
    await writeAdminAuditLog(db, {
      organizationId: orgId,
      actorUserId: audit.operator!,
      sessionId: audit.sessionId,
      ip: audit.ip,
      timezone: audit.timezone,
      actionType: "mail_smtp_probed",
      metadata: { result: outcome.ok ? "ok" : "failed" },
    });
  } catch (auditErr) {
    console.error("[audit] mail_smtp_probed log failed", auditErr);
  }

  if (outcome.ok) {
    return c.json({ ok: true, message: outcome.message });
  }
  return c.json({ ok: false, error: outcome.error });
}
