/**
 * Event-level mail transport override. Most events inherit the organization's
 * mail transport (Instance Settings -> Mail, see mail-settings-routes.ts) — this
 * lets a specific event send through its own dedicated transport instead
 * (co-branded event, separate mailbox/domain). See issue #511.
 *
 * "Dedicated" vs "inherits from org" is not a stored flag — it's simply whether
 * an event-scoped MailSettings row exists. GET always returns the *effective*
 * (resolved) values via describeMailConfig, plus hasEventOverride so the admin
 * UI knows which mode to show. DELETE removes the row entirely, reverting the
 * event to pure inheritance — a partial PUT can't express "clear everything"
 * the way it can for a single field, since this is a whole separate scoped row.
 */
import type { Context } from "hono";
import type { PrismaClient } from "@prisma/client";
import type { z } from "zod";
import {
  describeMailConfig,
  setMailSettings,
  validateEventMailSettingsUpdate,
  type MailSettingsInput,
} from "@admitto/mailer-config";
import { sendEventTransportTestEmail, type MailDeliveryDeps } from "@admitto/mail-delivery";
import { writeAdminAuditLog } from "@admitto/tickets";
import { adminAuditFromContext, assertEventManageAccess, requireEventId } from "./admin-helpers.js";
import {
  putMailSettingsBodySchema,
  testMailTransportBodySchema,
  serializeDescriptor,
  descriptorForKey,
  isProductionEnv,
  classifyMailSettingsFields,
  runTransportTest,
  transportTestResponse,
} from "./mail-settings-shared.js";

async function loadEventOrg(
  db: PrismaClient,
  eventId: string,
): Promise<{ organizationId: string } | null> {
  const event = await db.event.findUnique({
    where: { id: eventId },
    select: { organization_id: true },
  });
  return event ? { organizationId: event.organization_id } : null;
}

async function hasEventMailOverride(db: PrismaClient, eventId: string): Promise<boolean> {
  const row = await db.mailSettings.findUnique({
    where: { scope_type_scope_id: { scope_type: "event", scope_id: eventId } },
    select: { id: true },
  });
  return row !== null;
}

/** GET /api/admin/events/:eventId/mail-settings */
export async function handleGetEventMailSettings(c: Context, db: PrismaClient): Promise<Response> {
  const eventIdOrRes = requireEventId(c);
  if (eventIdOrRes instanceof Response) return eventIdOrRes;
  const eventId = eventIdOrRes;

  const forbidden = await assertEventManageAccess(c, db, eventId);
  if (forbidden) return forbidden;

  const org = await loadEventOrg(db, eventId);
  if (!org) return c.json({ error: "not_found" }, 404);

  const [desc, hasOverride] = await Promise.all([
    describeMailConfig(eventId, db, process.env),
    hasEventMailOverride(db, eventId),
  ]);

  return c.json({
    eventId,
    organizationId: org.organizationId,
    isProduction: isProductionEnv(process.env),
    hasEventOverride: hasOverride,
    fields: serializeDescriptor(desc),
  });
}

/** PUT /api/admin/events/:eventId/mail-settings — creates or updates the event's dedicated transport. */
export async function handlePutEventMailSettings(c: Context, db: PrismaClient): Promise<Response> {
  const eventIdOrRes = requireEventId(c);
  if (eventIdOrRes instanceof Response) return eventIdOrRes;
  const eventId = eventIdOrRes;

  const forbidden = await assertEventManageAccess(c, db, eventId);
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

  const org = await loadEventOrg(db, eventId);
  if (!org) return c.json({ error: "not_found" }, 404);

  const [current, eventRow, orgRow] = await Promise.all([
    describeMailConfig(eventId, db, process.env),
    db.mailSettings.findUnique({
      where: { scope_type_scope_id: { scope_type: "event", scope_id: eventId } },
    }),
    db.mailSettings.findUnique({
      where: { scope_type_scope_id: { scope_type: "organization", scope_id: org.organizationId } },
    }),
  ]);

  for (const key of Object.keys(body) as Array<keyof typeof body>) {
    const fd = descriptorForKey(current, key as keyof MailSettingsInput);
    if (fd.locked) {
      return c.json({ error: "managed by environment" }, 400);
    }
  }

  const transportCheck = validateEventMailSettingsUpdate(
    eventRow,
    orgRow,
    body as MailSettingsInput,
    process.env,
  );
  if (!transportCheck.ok) {
    return c.json({ error: "incomplete_transport", detail: transportCheck.error }, 400);
  }

  const { fieldsChanged, secretsRotated, secretsCleared } = classifyMailSettingsFields(body);

  await db.$transaction(async (tx) => {
    await setMailSettings({ scopeType: "event", scopeId: eventId }, body as MailSettingsInput, tx);

    const audit = adminAuditFromContext(c);
    await writeAdminAuditLog(tx, {
      organizationId: org.organizationId,
      actorUserId: audit.operator!,
      sessionId: audit.sessionId,
      ip: audit.ip,
      actionType: "event_mail_settings_updated",
      metadata: {
        eventId,
        provider: body.provider ?? current.provider.value,
        fields_changed: fieldsChanged,
        secrets_rotated: secretsRotated,
        secrets_cleared: secretsCleared,
      },
    });
  });

  const desc = await describeMailConfig(eventId, db, process.env);
  return c.json({
    eventId,
    organizationId: org.organizationId,
    isProduction: isProductionEnv(process.env),
    hasEventOverride: true,
    fields: serializeDescriptor(desc),
  });
}

/** DELETE /api/admin/events/:eventId/mail-settings — reverts the event to inheriting the org transport. */
export async function handleDeleteEventMailSettings(c: Context, db: PrismaClient): Promise<Response> {
  const eventIdOrRes = requireEventId(c);
  if (eventIdOrRes instanceof Response) return eventIdOrRes;
  const eventId = eventIdOrRes;

  const forbidden = await assertEventManageAccess(c, db, eventId);
  if (forbidden) return forbidden;

  const org = await loadEventOrg(db, eventId);
  if (!org) return c.json({ error: "not_found" }, 404);

  await db.$transaction(async (tx) => {
    await tx.mailSettings.deleteMany({ where: { scope_type: "event", scope_id: eventId } });

    const audit = adminAuditFromContext(c);
    await writeAdminAuditLog(tx, {
      organizationId: org.organizationId,
      actorUserId: audit.operator!,
      sessionId: audit.sessionId,
      ip: audit.ip,
      actionType: "event_mail_settings_cleared",
      metadata: { eventId },
    });
  });

  const desc = await describeMailConfig(eventId, db, process.env);
  return c.json({
    eventId,
    organizationId: org.organizationId,
    isProduction: isProductionEnv(process.env),
    hasEventOverride: false,
    fields: serializeDescriptor(desc),
  });
}

/** POST /api/admin/events/:eventId/mail-settings/test — tests whatever transport actually resolves for this event (dedicated or inherited). */
export async function handlePostEventMailSettingsTest(
  c: Context,
  db: PrismaClient,
  mailDeliveryDeps: MailDeliveryDeps = {},
): Promise<Response> {
  const eventIdOrRes = requireEventId(c);
  if (eventIdOrRes instanceof Response) return eventIdOrRes;
  const eventId = eventIdOrRes;

  const forbidden = await assertEventManageAccess(c, db, eventId);
  if (forbidden) return forbidden;

  const org = await loadEventOrg(db, eventId);
  if (!org) return c.json({ error: "not_found" }, 404);

  let body: z.infer<typeof testMailTransportBodySchema>;
  try {
    body = testMailTransportBodySchema.parse(await c.req.json());
  } catch {
    return c.json({ error: "validation_failed" }, 400);
  }

  const audit = adminAuditFromContext(c);

  const outcome = await runTransportTest(
    () => sendEventTransportTestEmail({ eventId, toAddress: body.to }, db, process.env, mailDeliveryDeps),
    "[admin] event mail transport test",
  );

  try {
    await writeAdminAuditLog(db, {
      organizationId: org.organizationId,
      actorUserId: audit.operator!,
      sessionId: audit.sessionId,
      ip: audit.ip,
      actionType: "event_mail_transport_tested",
      metadata: { eventId, result: outcome.resultStatus },
    });
  } catch (auditErr) {
    console.error("[audit] event_mail_transport_tested log failed", auditErr);
  }

  return transportTestResponse(c, outcome);
}
