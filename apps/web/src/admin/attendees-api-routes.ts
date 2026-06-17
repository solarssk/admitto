import type { Context } from "hono";
import { Prisma } from "@prisma/client";
import type { PrismaClient } from "@prisma/client";
import { z } from "zod";
import { canManageEvent } from "@admitto/auth";
import {
  listDeliveries,
  resendTicketEmail,
  toDeliveryDto,
  type DeliveryDto,
  type MailDeliveryDeps,
} from "@admitto/mail-delivery";
import {
  parseCustomData,
  shirtSizeFromCustomData,
  writeActionLog,
  type OpsAuditContext,
} from "@admitto/tickets";
import { resolveClientIp } from "../rate-limit/client-ip.js";

const ATTENDEE_LIST_SELECT = {
  id: true,
  name: true,
  email: true,
  company: true,
  ticket_type: true,
  admitted_at: true,
} as const;

const ATTENDEE_DETAIL_SELECT = {
  id: true,
  name: true,
  email: true,
  company: true,
  department: true,
  ticket_type: true,
  status: true,
  admitted_at: true,
  custom_data: true,
} as const;

const patchAttendeeSchema = z
  .object({
    name: z.string().trim().min(1).optional(),
    email: z.string().trim().email().optional(),
    company: z.string().trim().optional().nullable(),
    department: z.string().trim().optional().nullable(),
    ticket_type: z.string().trim().optional().nullable(),
    shirt_size: z.string().trim().optional().nullable(),
  })
  .strict();

const resendBodySchema = z
  .object({
    to: z.string().trim().email().optional(),
  })
  .strict();

export type AttendeeRowDto = {
  id: string;
  name: string;
  email: string;
  company: string | null;
  ticket_type: string | null;
  check_in_status: "admitted" | "not_admitted";
  last_mail_status: string | null;
};

export type AttendeeDetailDto = {
  id: string;
  name: string;
  email: string;
  company: string | null;
  department: string | null;
  ticket_type: string | null;
  status: string;
  check_in_status: "admitted" | "not_admitted";
  admitted_at: string | null;
  shirt_size: string | null;
  custom_data_safe: unknown;
  deliveries: DeliveryDto[];
};

function checkInStatus(admittedAt: Date | null): "admitted" | "not_admitted" {
  return admittedAt ? "admitted" : "not_admitted";
}

async function assertEventManageAccess(
  c: Context,
  db: PrismaClient,
  eventId: string,
): Promise<Response | null> {
  const auth = c.get("auth");
  if (!(await canManageEvent(db, auth.userId, eventId))) {
    return c.json({ error: "forbidden" }, 403);
  }
  return null;
}

function adminAuditFromContext(c: Context): OpsAuditContext {
  const auth = c.get("auth");
  return {
    operator: auth.userId,
    sessionId: auth.sessionId,
    ip: resolveClientIp(c),
  };
}

function requireEventId(c: Context): string | Response {
  const eventId = c.req.param("eventId");
  if (!eventId) return c.json({ error: "eventId required" }, 400);
  return eventId;
}

function requireAttendeeId(c: Context): string | Response {
  const id = c.req.param("id");
  if (!id) return c.json({ error: "id required" }, 400);
  return id;
}

async function loadAttendeeInEvent(
  db: PrismaClient,
  eventId: string,
  attendeeId: string,
) {
  const row = await db.attendee.findUnique({
    where: { id: attendeeId },
    select: { ...ATTENDEE_DETAIL_SELECT, event_id: true },
  });
  if (!row || row.event_id !== eventId) return null;
  return row;
}

function parseListQuery(c: Context): {
  page: number;
  pageSize: number;
  q?: string;
  status: "all" | "admitted" | "not_admitted";
  ticket_type?: string;
} {
  const page = Math.max(1, Number(c.req.query("page") ?? "1") || 1);
  const rawSize = Number(c.req.query("pageSize") ?? "25") || 25;
  const pageSize = Math.min(100, Math.max(1, rawSize));
  const qRaw = c.req.query("q")?.trim();
  const q = qRaw ? qRaw : undefined;
  const statusRaw = c.req.query("status") ?? "all";
  const status =
    statusRaw === "admitted" || statusRaw === "not_admitted" ? statusRaw : "all";
  const ticketTypeRaw = c.req.query("ticket_type")?.trim();
  const ticket_type = ticketTypeRaw ? ticketTypeRaw : undefined;
  return { page, pageSize, q, status, ticket_type };
}

async function lastMailStatusByAttendee(
  db: PrismaClient,
  attendeeIds: string[],
): Promise<Map<string, string>> {
  if (attendeeIds.length === 0) return new Map();

  const deliveries = await db.emailDelivery.findMany({
    where: { attendee_id: { in: attendeeIds } },
    select: { attendee_id: true, status: true },
    orderBy: { created_at: "desc" },
  });

  const map = new Map<string, string>();
  for (const row of deliveries) {
    if (!map.has(row.attendee_id)) {
      map.set(row.attendee_id, row.status);
    }
  }
  return map;
}

function serializeAttendeeRow(
  row: {
    id: string;
    name: string;
    email: string;
    company: string | null;
    ticket_type: string | null;
    admitted_at: Date | null;
  },
  lastMail: Map<string, string>,
): AttendeeRowDto {
  return {
    id: row.id,
    name: row.name,
    email: row.email,
    company: row.company,
    ticket_type: row.ticket_type,
    check_in_status: checkInStatus(row.admitted_at),
    last_mail_status: lastMail.get(row.id) ?? null,
  };
}

async function buildAttendeeDetailDto(
  db: PrismaClient,
  eventId: string,
  row: {
    id: string;
    name: string;
    email: string;
    company: string | null;
    department: string | null;
    ticket_type: string | null;
    status: string;
    admitted_at: Date | null;
    custom_data: unknown;
  },
): Promise<AttendeeDetailDto> {
  const deliveries = await listDeliveries(
    { eventId, filters: { attendeeId: row.id } },
    db,
  );

  return {
    id: row.id,
    name: row.name,
    email: row.email,
    company: row.company,
    department: row.department,
    ticket_type: row.ticket_type,
    status: row.status,
    check_in_status: checkInStatus(row.admitted_at),
    admitted_at: row.admitted_at ? row.admitted_at.toISOString() : null,
    shirt_size: shirtSizeFromCustomData(row.custom_data),
    custom_data_safe: row.custom_data ?? null,
    deliveries: deliveries.map(toDeliveryDto),
  };
}

/** GET /api/admin/events/:eventId/attendees */
export async function handleListEventAttendees(c: Context, db: PrismaClient): Promise<Response> {
  const eventIdOrRes = requireEventId(c);
  if (eventIdOrRes instanceof Response) return eventIdOrRes;
  const eventId = eventIdOrRes;
  const forbidden = await assertEventManageAccess(c, db, eventId);
  if (forbidden) return forbidden;

  const { page, pageSize, q, status, ticket_type } = parseListQuery(c);

  const where: Prisma.AttendeeWhereInput = {
    event_id: eventId,
    ...(status === "admitted" ? { admitted_at: { not: null } } : {}),
    ...(status === "not_admitted" ? { admitted_at: null } : {}),
    ...(ticket_type ? { ticket_type } : {}),
    ...(q
      ? {
          OR: [
            { name: { contains: q, mode: "insensitive" } },
            { email: { contains: q, mode: "insensitive" } },
            { company: { contains: q, mode: "insensitive" } },
          ],
        }
      : {}),
  };

  const [total, rows] = await Promise.all([
    db.attendee.count({ where }),
    db.attendee.findMany({
      where,
      select: ATTENDEE_LIST_SELECT,
      orderBy: { name: "asc" },
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
  ]);

  const lastMail = await lastMailStatusByAttendee(
    db,
    rows.map((r) => r.id),
  );

  return c.json({
    items: rows.map((r) => serializeAttendeeRow(r, lastMail)),
    total,
    page,
    pageSize,
  });
}

/** GET /api/admin/events/:eventId/attendees/:id */
export async function handleGetEventAttendee(c: Context, db: PrismaClient): Promise<Response> {
  const eventIdOrRes = requireEventId(c);
  if (eventIdOrRes instanceof Response) return eventIdOrRes;
  const eventId = eventIdOrRes;
  const attendeeIdOrRes = requireAttendeeId(c);
  if (attendeeIdOrRes instanceof Response) return attendeeIdOrRes;
  const attendeeId = attendeeIdOrRes;

  const forbidden = await assertEventManageAccess(c, db, eventId);
  if (forbidden) return forbidden;

  const row = await loadAttendeeInEvent(db, eventId, attendeeId);
  if (!row) return c.json({ error: "forbidden" }, 403);

  const dto = await buildAttendeeDetailDto(db, eventId, row);
  return c.json(dto);
}

type PatchInput = z.infer<typeof patchAttendeeSchema>;

function computePatchChanges(
  existing: {
    name: string;
    email: string;
    company: string | null;
    department: string | null;
    ticket_type: string | null;
    custom_data: unknown;
  },
  patch: PatchInput,
): { data: Prisma.AttendeeUpdateInput; fields: string[] } | null {
  const fields: string[] = [];
  const data: Prisma.AttendeeUpdateInput = {};

  if (patch.name !== undefined && patch.name !== existing.name) {
    data.name = patch.name;
    fields.push("name");
  }
  if (patch.email !== undefined && patch.email !== existing.email) {
    data.email = patch.email;
    fields.push("email");
  }
  if (patch.company !== undefined && patch.company !== existing.company) {
    data.company = patch.company;
    fields.push("company");
  }
  if (patch.department !== undefined && patch.department !== existing.department) {
    data.department = patch.department;
    fields.push("department");
  }
  if (patch.ticket_type !== undefined && patch.ticket_type !== existing.ticket_type) {
    data.ticket_type = patch.ticket_type;
    fields.push("ticket_type");
  }
  if (patch.shirt_size !== undefined) {
    const current = shirtSizeFromCustomData(existing.custom_data);
    const next = patch.shirt_size;
    if (next !== current) {
      const cd = parseCustomData(existing.custom_data);
      if (next === null || next === "") {
        delete cd.shirt_size;
      } else {
        cd.shirt_size = next;
      }
      data.custom_data = cd as Prisma.InputJsonValue;
      fields.push("shirt_size");
    }
  }

  if (fields.length === 0) return null;
  return { data, fields };
}

/** PATCH /api/admin/events/:eventId/attendees/:id */
export async function handlePatchEventAttendee(c: Context, db: PrismaClient): Promise<Response> {
  const eventIdOrRes = requireEventId(c);
  if (eventIdOrRes instanceof Response) return eventIdOrRes;
  const eventId = eventIdOrRes;
  const attendeeIdOrRes = requireAttendeeId(c);
  if (attendeeIdOrRes instanceof Response) return attendeeIdOrRes;
  const attendeeId = attendeeIdOrRes;

  const forbidden = await assertEventManageAccess(c, db, eventId);
  if (forbidden) return forbidden;

  const existing = await loadAttendeeInEvent(db, eventId, attendeeId);
  if (!existing) return c.json({ error: "forbidden" }, 403);

  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: "invalid json" }, 400);
  }

  const parsed = patchAttendeeSchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ error: "validation_failed" }, 400);
  }

  const changes = computePatchChanges(existing, parsed.data);
  if (!changes) {
    const dto = await buildAttendeeDetailDto(db, eventId, existing);
    return c.json(dto);
  }

  try {
    const updated = await db.$transaction(async (tx) => {
      const row = await tx.attendee.update({
        where: { id: attendeeId },
        data: changes.data,
        select: ATTENDEE_DETAIL_SELECT,
      });

      await writeActionLog(tx, {
        event_id: eventId,
        attendee_id: attendeeId,
        action_type: "attendee_edited",
        audit: adminAuditFromContext(c),
        metadata: { fields: changes.fields },
      });

      return row;
    });

    const dto = await buildAttendeeDetailDto(db, eventId, updated);
    return c.json(dto);
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
      return c.json({ error: "email_conflict" }, 409);
    }
    console.error("handlePatchEventAttendee failed:", err);
    return c.json({ error: "server error" }, 500);
  }
}

/** POST /api/admin/events/:eventId/attendees/:id/resend */
export async function handleResendEventAttendeeTicket(
  c: Context,
  db: PrismaClient,
  mailDeps: MailDeliveryDeps = {},
): Promise<Response> {
  const eventIdOrRes = requireEventId(c);
  if (eventIdOrRes instanceof Response) return eventIdOrRes;
  const eventId = eventIdOrRes;
  const attendeeIdOrRes = requireAttendeeId(c);
  if (attendeeIdOrRes instanceof Response) return attendeeIdOrRes;
  const attendeeId = attendeeIdOrRes;

  const forbidden = await assertEventManageAccess(c, db, eventId);
  if (forbidden) return forbidden;

  const existing = await loadAttendeeInEvent(db, eventId, attendeeId);
  if (!existing) return c.json({ error: "forbidden" }, 403);

  let body: unknown = {};
  try {
    const text = await c.req.text();
    if (text.trim()) body = JSON.parse(text);
  } catch {
    return c.json({ error: "invalid json" }, 400);
  }

  const parsed = resendBodySchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ error: "validation_failed" }, 400);
  }

  const to = parsed.data.to;
  const targetEmail = to ?? existing.email;
  const alternate = Boolean(to && to !== existing.email);

  await resendTicketEmail(attendeeId, db, process.env, mailDeps, { to });

  const deliveryRow = await db.emailDelivery.findFirst({
    where: { attendee_id: attendeeId, event_id: eventId, purpose: "resend" },
    orderBy: { created_at: "desc" },
  });

  if (!deliveryRow) {
    return c.json({ error: "delivery_not_created" }, 500);
  }

  const deliveries = await listDeliveries(
    { eventId, filters: { attendeeId } },
    db,
  );
  const latest = deliveries.find((d) => d.id === deliveryRow.id);
  if (!latest) {
    return c.json({ error: "delivery_not_found" }, 500);
  }

  await db.$transaction(async (tx) => {
    await writeActionLog(tx, {
      event_id: eventId,
      attendee_id: attendeeId,
      action_type: "ticket_resent",
      audit: adminAuditFromContext(c),
      metadata: { to: targetEmail, alternate },
    });
  });

  return c.json(toDeliveryDto(latest));
}
