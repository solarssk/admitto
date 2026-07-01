import type { Context } from "hono";
import type { Prisma, PrismaClient } from "@prisma/client";
import { z } from "zod";
import { EMAIL_DELIVERY_SUCCESS_STATUSES } from "@admitto/db";
import { sendTicketEmails, type MailDeliveryDeps } from "@admitto/mail-delivery";
import { resolveTemplateById, TemplateNotFoundError } from "@admitto/mail-templates";
import { writeBulkActionLog } from "@admitto/tickets";
import { adminAuditFromContext, assertEventManageAccess, requireEventId } from "./admin-helpers.js";

export const BULK_SEND_LIMIT = 500;

const RSVP_STATUSES = ["none", "confirmed", "declined", "tentative", "cancelled"] as const;

const bulkSendFilterSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("all") }).strict(),
  z.object({ type: z.literal("ticket_type"), value: z.string().trim().min(1).max(100) }).strict(),
  z.object({ type: z.literal("rsvp_status"), value: z.enum(RSVP_STATUSES) }).strict(),
  z.object({ type: z.literal("no_delivery") }).strict(),
  z
    .object({
      type: z.literal("attendee_ids"),
      ids: z.array(z.string().trim().min(1)).min(1).max(BULK_SEND_LIMIT),
    })
    .strict(),
]);

const bulkSendBodySchema = z
  .object({
    templateId: z.string().trim().min(1),
    filter: bulkSendFilterSchema,
    dryRun: z.boolean().optional(),
  })
  .strict();

export type BulkSendFilter = z.infer<typeof bulkSendFilterSchema>;

export type BulkSendDryRunDto = { recipientCount: number };

export type BulkSendQueuedDto = {
  batchId: string;
  queued: number;
  skipped: number;
  failed: number;
};

export type BulkSendStatusDto = {
  batchId: string;
  total: number;
  queued: number;
  sent: number;
  failed: number;
};

/** Resolve event/org ticket MailTemplate id when persisted; undefined for built-in fallback. */
export async function resolveDefaultTicketTemplateId(
  db: PrismaClient,
  eventId: string,
): Promise<string | undefined> {
  const event = await db.event.findUniqueOrThrow({
    where: { id: eventId },
    select: { organization_id: true },
  });

  const eventRow = await db.mailTemplate.findUnique({
    where: {
      scope_type_scope_id_name: { scope_type: "event", scope_id: eventId, name: "ticket" },
    },
    select: { id: true },
  });
  if (eventRow) return eventRow.id;

  const orgRow = await db.mailTemplate.findUnique({
    where: {
      scope_type_scope_id_name: {
        scope_type: "organization",
        scope_id: event.organization_id,
        name: "ticket",
      },
    },
    select: { id: true },
  });
  return orgRow?.id;
}

export async function resolveBulkSendAttendeeIds(
  db: PrismaClient,
  eventId: string,
  filter: BulkSendFilter,
): Promise<{ ids: string[]; overLimit: boolean }> {
  const baseWhere: Prisma.AttendeeWhereInput = { event_id: eventId };

  let where: Prisma.AttendeeWhereInput = baseWhere;

  switch (filter.type) {
    case "all":
      break;
    case "ticket_type":
      where = { ...baseWhere, ticket_type: filter.value };
      break;
    case "rsvp_status":
      where = { ...baseWhere, rsvp_status: filter.value };
      break;
    case "no_delivery":
      where = {
        ...baseWhere,
        email_deliveries: {
          none: {
            status: { in: [...EMAIL_DELIVERY_SUCCESS_STATUSES, "queued"] },
          },
        },
      };
      break;
    case "attendee_ids":
      where = { ...baseWhere, id: { in: filter.ids } };
      break;
  }

  const rows = await db.attendee.findMany({
    where,
    select: { id: true },
    take: BULK_SEND_LIMIT + 1,
  });

  if (rows.length > BULK_SEND_LIMIT) {
    return { ids: [], overLimit: true };
  }

  return { ids: rows.map((r) => r.id), overLimit: false };
}

async function assertTemplateForEvent(
  db: PrismaClient,
  eventId: string,
  templateId: string,
): Promise<Response | null> {
  try {
    await resolveTemplateById(templateId, eventId, db);
    return null;
  } catch (err) {
    if (err instanceof TemplateNotFoundError) {
      return new Response(JSON.stringify({ error: "template_not_found" }), {
        status: 404,
        headers: { "Content-Type": "application/json" },
      });
    }
    throw err;
  }
}

/** POST /api/admin/events/:eventId/send */
export async function handleBulkSend(
  c: Context,
  db: PrismaClient,
  mailDeps: MailDeliveryDeps = {},
): Promise<Response> {
  const eventIdOrRes = requireEventId(c);
  if (eventIdOrRes instanceof Response) return eventIdOrRes;
  const eventId = eventIdOrRes;

  const forbidden = await assertEventManageAccess(c, db, eventId);
  if (forbidden) return forbidden;

  let body: z.infer<typeof bulkSendBodySchema>;
  try {
    body = bulkSendBodySchema.parse(await c.req.json());
  } catch {
    return c.json({ error: "validation_failed" }, 400);
  }

  const templateError = await assertTemplateForEvent(db, eventId, body.templateId);
  if (templateError) return templateError;

  const { ids, overLimit } = await resolveBulkSendAttendeeIds(db, eventId, body.filter);
  if (overLimit) {
    return c.json({ error: "too_many_attendees", limit: BULK_SEND_LIMIT }, 400);
  }

  if (body.dryRun) {
    return c.json({ recipientCount: ids.length } satisfies BulkSendDryRunDto);
  }

  if (ids.length === 0) {
    await auditBulkSend(db, c, eventId, {
      templateId: body.templateId,
      filterType: body.filter.type,
      queued: 0,
      skipped: 0,
      failed: 0,
    });
    return c.json({
      batchId: "",
      queued: 0,
      skipped: 0,
      failed: 0,
    } satisfies BulkSendQueuedDto);
  }

  const purpose = body.filter.type === "no_delivery" ? "initial" : "resend";

  let sendResult;
  try {
    sendResult = await sendTicketEmails(
      eventId,
      { attendeeIds: ids, templateId: body.templateId, purpose },
      db,
      process.env,
      mailDeps,
    );
  } catch (err) {
    if (err instanceof TemplateNotFoundError) {
      return c.json({ error: "template_not_found" }, 404);
    }
    throw err;
  }

  const skipped = sendResult.skipped.length;
  const queued = sendResult.sent;
  const failed = sendResult.deliveries.length - sendResult.sent;

  await auditBulkSend(db, c, eventId, {
    templateId: body.templateId,
    filterType: body.filter.type,
    queued,
    skipped,
    failed,
  });

  return c.json({
    batchId: sendResult.batchId,
    queued,
    skipped,
    failed,
  } satisfies BulkSendQueuedDto);
}

/** GET /api/admin/events/:eventId/send/status/:batchId */
export async function handleBulkSendStatus(c: Context, db: PrismaClient): Promise<Response> {
  const eventIdOrRes = requireEventId(c);
  if (eventIdOrRes instanceof Response) return eventIdOrRes;
  const eventId = eventIdOrRes;

  const forbidden = await assertEventManageAccess(c, db, eventId);
  if (forbidden) return forbidden;

  const batchId = c.req.param("batchId")?.trim();
  if (!batchId) return c.json({ error: "batchId required" }, 400);

  const rows = await db.emailDelivery.findMany({
    where: { event_id: eventId, batch_id: batchId },
    select: { status: true },
  });

  if (rows.length === 0) {
    return c.json({ error: "not_found" }, 404);
  }

  let queued = 0;
  let sent = 0;
  let failed = 0;

  for (const row of rows) {
    if (row.status === "queued") queued += 1;
    else if (EMAIL_DELIVERY_SUCCESS_STATUSES.includes(row.status as (typeof EMAIL_DELIVERY_SUCCESS_STATUSES)[number])) {
      sent += 1;
    } else if (row.status === "failed" || row.status === "bounced" || row.status === "rejected") {
      failed += 1;
    }
  }

  return c.json({
    batchId,
    total: rows.length,
    queued,
    sent,
    failed,
  } satisfies BulkSendStatusDto);
}

async function auditBulkSend(
  db: PrismaClient,
  c: Context,
  eventId: string,
  meta: {
    templateId: string;
    filterType: string;
    queued: number;
    skipped: number;
    failed: number;
  },
): Promise<void> {
  try {
    await writeBulkActionLog(db, {
      event_id: eventId,
      action_type: "mail_bulk_resend",
      audit: adminAuditFromContext(c),
      metadata: {
        template_id: meta.templateId,
        filter: meta.filterType,
        queued: meta.queued,
        skipped: meta.skipped,
        failed: meta.failed,
      },
    });
  } catch (err) {
    console.error("bulk send audit log failed:", err);
  }
}
