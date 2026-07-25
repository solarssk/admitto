/**
 * Event-level mail transport override. Most events inherit the organization's
 * mail transport (Instance Settings -> Mail, see mail-settings-routes.ts) — this
 * lets a specific event send through its own dedicated transport instead
 * (co-branded event, separate mailbox/domain). See issue #511.
 *
 * Superadmin-only, same as the organization level: this configures live outbound
 * mail transport credentials (SMTP host/port, Power Automate webhook URL, Graph
 * tenant/client), not day-to-day event content — org-scoped admins manage the
 * event itself but do not touch transport config.
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
import {
  adminAuditFromContext,
  lockEventForMailSettingsWrite,
  requireEventId,
  requireSuperadmin,
} from "./admin-helpers.js";
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

/** Count of this event's deliveries still marked `retryable` after failing — mirrors
 * `ops/readyz.ts`'s `collectGauges()` instance-wide gauge, narrowed to one event. Not a
 * time-windowed "recent failures" count: nothing in this codebase auto-retries (only the
 * `admitto mail retry-failed` CLI does), so a row can sit here for weeks until the retention
 * job eventually flips `retryable` to `false` — a nonzero count means "needs manual attention
 * at some point," not "just happened." */
async function countFailedRetryableDeliveries(db: PrismaClient, eventId: string): Promise<number> {
  return db.emailDelivery.count({ where: { event_id: eventId, status: "failed", retryable: true } });
}

/** Thrown inside the PUT transaction when a concurrent deletion removed the event while
 * this request was validating — signals the route to return 404 instead of writing an
 * orphaned MailSettings row for an event that no longer exists. */
class EventGoneDuringWriteError extends Error {}

/** Thrown inside the PUT transaction when the request touches an env-locked field. */
class LockedFieldError extends Error {}

/** Thrown inside the PUT transaction when the merged transport would be incomplete. */
class IncompleteTransportError extends Error {
  constructor(public readonly detail: string) {
    super(detail);
  }
}

/** GET /api/admin/events/:eventId/mail-settings */
export async function handleGetEventMailSettings(c: Context, db: PrismaClient): Promise<Response> {
  const eventIdOrRes = requireEventId(c);
  if (eventIdOrRes instanceof Response) return eventIdOrRes;
  const eventId = eventIdOrRes;

  const forbidden = await requireSuperadmin(c, db);
  if (forbidden) return forbidden;

  const org = await loadEventOrg(db, eventId);
  if (!org) return c.json({ error: "not_found" }, 404);

  const [desc, hasOverride, failedDeliveries] = await Promise.all([
    describeMailConfig(eventId, db, process.env),
    hasEventMailOverride(db, eventId),
    countFailedRetryableDeliveries(db, eventId),
  ]);

  return c.json({
    eventId,
    organizationId: org.organizationId,
    isProduction: isProductionEnv(process.env),
    hasEventOverride: hasOverride,
    failedDeliveries,
    fields: serializeDescriptor(desc),
  });
}

/** PUT /api/admin/events/:eventId/mail-settings — creates or updates the event's dedicated transport. */
export async function handlePutEventMailSettings(c: Context, db: PrismaClient): Promise<Response> {
  const eventIdOrRes = requireEventId(c);
  if (eventIdOrRes instanceof Response) return eventIdOrRes;
  const eventId = eventIdOrRes;

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

  const org = await loadEventOrg(db, eventId);
  if (!org) return c.json({ error: "not_found" }, 404);

  try {
    await db.$transaction(async (tx) => {
      // Serializes with permanent event deletion (see event-deletion.ts) and with any
      // other concurrent PUT on this event — reads and validates below only run once
      // this request holds the lock, so two racing PUTs can no longer both validate
      // against stale pre-write state and then serialize into a merged configuration
      // that was never actually validated as a whole (CodeRabbit review, round 2).
      await lockEventForMailSettingsWrite(tx, eventId);
      const stillExists = await tx.event.findUnique({ where: { id: eventId }, select: { id: true } });
      if (!stillExists) throw new EventGoneDuringWriteError();

      const [current, eventRow, orgRow] = await Promise.all([
        describeMailConfig(eventId, tx, process.env),
        tx.mailSettings.findUnique({
          where: { scope_type_scope_id: { scope_type: "event", scope_id: eventId } },
        }),
        tx.mailSettings.findUnique({
          where: { scope_type_scope_id: { scope_type: "organization", scope_id: org.organizationId } },
        }),
      ]);

      for (const key of Object.keys(body) as Array<keyof typeof body>) {
        const fd = descriptorForKey(current, key as keyof MailSettingsInput);
        if (fd.locked) throw new LockedFieldError();
      }

      const transportCheck = validateEventMailSettingsUpdate(
        eventRow,
        orgRow,
        body as MailSettingsInput,
        process.env,
      );
      if (!transportCheck.ok) throw new IncompleteTransportError(transportCheck.error);

      const { fieldsChanged, secretsRotated, secretsCleared } = classifyMailSettingsFields(body);

      await setMailSettings({ scopeType: "event", scopeId: eventId }, body as MailSettingsInput, tx);

      const audit = adminAuditFromContext(c);
      await writeAdminAuditLog(tx, {
        organizationId: org.organizationId,
        actorUserId: audit.operator!,
        sessionId: audit.sessionId,
        ip: audit.ip,
        timezone: audit.timezone,
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
  } catch (err) {
    if (err instanceof EventGoneDuringWriteError) return c.json({ error: "not_found" }, 404);
    if (err instanceof LockedFieldError) return c.json({ error: "managed by environment" }, 400);
    if (err instanceof IncompleteTransportError) {
      return c.json({ error: "incomplete_transport", detail: err.detail }, 400);
    }
    throw err;
  }

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

  const forbidden = await requireSuperadmin(c, db);
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
      timezone: audit.timezone,
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

  const forbidden = await requireSuperadmin(c, db);
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
      timezone: audit.timezone,
      actionType: "event_mail_transport_tested",
      metadata: { eventId, result: outcome.resultStatus },
    });
  } catch (auditErr) {
    console.error("[audit] event_mail_transport_tested log failed", auditErr);
  }

  return transportTestResponse(c, outcome);
}
