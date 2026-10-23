/**
 * Staff API that reads the guest registrations of one event: the list behind the Registration page,
 * the counts for its tab and for the Overview row, and one registration in full. Deciding on a
 * registration and deleting it are other routes.
 *
 * Every route is under `/api/admin/events/:eventId/registrations`. Each one checks on the server that
 * the caller manages that event (an organisation admin or a superadmin, like the other event routes):
 * an operator gets 403, and so does an admin of another organisation. Every query is limited to the
 * event of the address, so the id of a registration of another event answers 404, as an id that does
 * not exist does. An archived event can be read.
 *
 * A registration is personal data of a guest who may never become an attendee. So a read writes no log
 * line and no audit entry, the list leaves out the answers (`custom_data`) and the companions, and the
 * search looks only at the names and the address (see registration-list.ts in `@admitto/tickets`).
 */
import type { Context } from "hono";
import {
  REGISTRATION_STATUS,
  type EmailDeliveryStatus,
  type Prisma,
  type PrismaClient,
  type RegistrationMailTemplateName,
  type RegistrationMode,
  type RegistrationStatus,
} from "@admitto/db";
import {
  canRetryRegistrationMail,
  parseRegistrationFilter,
  registrationListWhere,
  type RegistrationListFilter,
} from "@admitto/tickets";
import {
  assertEventManageAccess,
  positiveIntQuery,
  requireEventId,
  resolveUserDisplayMap,
} from "./admin-helpers.js";

const DEFAULT_PAGE_SIZE = 25;
const MAX_PAGE_SIZE = 100;
/** Named when the user who decided has no account any more. */
const STAFF_FALLBACK_NAME = "Staff member";

/** Mail the guest was sent, or is waiting for: what a list row says about it. */
export type RegistrationMailBriefDto = {
  template_name: RegistrationMailTemplateName;
  status: EmailDeliveryStatus;
  /** True while the worker still tries a failed mail again by itself. */
  retryable: boolean | null;
  /** True when staff may send it again (D-B15). */
  can_retry: boolean;
};

export type RegistrationListItemDto = {
  id: string;
  first_name: string;
  last_name: string;
  email: string;
  company: string | null;
  department: string | null;
  status: RegistrationStatus;
  created_at: string;
  companions_count: number;
  /** The mail queued last for this registration; null when none was queued. */
  last_mail: RegistrationMailBriefDto | null;
};

export type RegistrationListDto = {
  items: RegistrationListItemDto[];
  /** Registrations that match the filter, over all pages. */
  total: number;
  page: number;
  pageSize: number;
};

/** What the Registration tab and the Overview row show. */
export type RegistrationCountsDto = {
  /** The event's registration mode; null while registration is off. */
  mode: RegistrationMode | null;
  by_status: Record<RegistrationStatus, number>;
  /** The number on the tab (D-B11): registrations that wait for a decision. The waiting list is counted apart. */
  needs_decision: number;
};

export type RegistrationMailDto = RegistrationMailBriefDto & {
  id: string;
  attempts: number;
  queued_at: string;
  attempted_at: string | null;
  sent_at: string | null;
  /** A short code for why the mail did not go out, never the text of an exception. */
  error_code: string | null;
  /** The sanitised sentence for that code that the worker stored, never an exception message. */
  error: string | null;
};

export type RegistrationCompanionDto = {
  name: string;
  custom_data: Record<string, unknown> | null;
};

export type RegistrationDetailDto = {
  id: string;
  status: RegistrationStatus;
  email: string;
  first_name: string;
  last_name: string;
  company: string | null;
  department: string | null;
  /** The answers as they were stored. Fields marked sensitive are not treated differently yet (D-E6, stage 2). */
  custom_data: Record<string, unknown> | null;
  companions: RegistrationCompanionDto[];
  created_at: string;
  email_verified_at: string | null;
  /** Set while the registration waits for the guest to confirm the address. */
  confirm_expires_at: string | null;
  /** When the terms were accepted (D-F3). */
  accepted_at: string | null;
  /** Consent key to the time it was given. */
  consents: Record<string, string>;
  decided_at: string | null;
  /** The staff member who decided; null for an automatic decision or none yet. */
  decided_by: { id: string; name: string } | null;
  locale: string | null;
  /** The attendee this registration was accepted as; null for any other state. */
  attendee_id: string | null;
  /** Oldest first. */
  mails: RegistrationMailDto[];
};

const LIST_SELECT = {
  id: true,
  first_name: true,
  last_name: true,
  email: true,
  company: true,
  department: true,
  status: true,
  confirm_expires_at: true,
  created_at: true,
  companions: true,
} as const satisfies Prisma.RegistrationSelect;

const DETAIL_SELECT = {
  id: true,
  status: true,
  email: true,
  first_name: true,
  last_name: true,
  company: true,
  department: true,
  custom_data: true,
  companions: true,
  created_at: true,
  email_verified_at: true,
  confirm_expires_at: true,
  accepted_at: true,
  consents: true,
  decided_at: true,
  decided_by: true,
  locale: true,
  attendee_id: true,
} as const satisfies Prisma.RegistrationSelect;

const LAST_MAIL_SELECT = {
  registration_id: true,
  template_name: true,
  status: true,
  retryable: true,
} as const satisfies Prisma.RegistrationMailSelect;

const MAIL_SELECT = {
  id: true,
  template_name: true,
  status: true,
  attempts: true,
  retryable: true,
  queued_at: true,
  attempted_at: true,
  sent_at: true,
  error_code: true,
  error: true,
} as const satisfies Prisma.RegistrationMailSelect;

type ListRow = Prisma.RegistrationGetPayload<{ select: typeof LIST_SELECT }>;
type DetailRow = Prisma.RegistrationGetPayload<{ select: typeof DETAIL_SELECT }>;
type MailRow = Prisma.RegistrationMailGetPayload<{ select: typeof MAIL_SELECT }>;

function isoOrNull(date: Date | null): string | null {
  return date ? date.toISOString() : null;
}

/** A JSON column that holds an object, or null for anything else. */
function plainObjectOrNull(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function mailBrief(
  mail: { template_name: string; status: string; retryable: boolean | null },
  registration: { status: string; confirm_expires_at: Date | null },
  nowMs: number,
): RegistrationMailBriefDto {
  return {
    template_name: mail.template_name as RegistrationMailTemplateName,
    status: mail.status as EmailDeliveryStatus,
    retryable: mail.retryable,
    can_retry: canRetryRegistrationMail(mail, registration, nowMs),
  };
}

function serializeListItem(row: ListRow, lastMail: RegistrationMailBriefDto | undefined): RegistrationListItemDto {
  return {
    id: row.id,
    first_name: row.first_name,
    last_name: row.last_name,
    email: row.email,
    company: row.company,
    department: row.department,
    status: row.status as RegistrationStatus,
    created_at: row.created_at.toISOString(),
    companions_count: Array.isArray(row.companions) ? row.companions.length : 0,
    last_mail: lastMail ?? null,
  };
}

function serializeCompanions(value: unknown): RegistrationCompanionDto[] {
  if (!Array.isArray(value)) return [];
  const companions: RegistrationCompanionDto[] = [];
  for (const entry of value as unknown[]) {
    const companion = plainObjectOrNull(entry);
    if (typeof companion?.name === "string") {
      companions.push({ name: companion.name, custom_data: plainObjectOrNull(companion.custom_data) });
    }
  }
  return companions;
}

function serializeConsents(value: unknown): Record<string, string> {
  const consents = plainObjectOrNull(value) ?? {};
  const given = Object.entries(consents).filter((entry): entry is [string, string] => typeof entry[1] === "string");
  return Object.fromEntries(given);
}

function serializeMail(
  row: MailRow,
  registration: { status: string; confirm_expires_at: Date | null },
  nowMs: number,
): RegistrationMailDto {
  return {
    ...mailBrief(row, registration, nowMs),
    id: row.id,
    attempts: row.attempts,
    queued_at: row.queued_at.toISOString(),
    attempted_at: isoOrNull(row.attempted_at),
    sent_at: isoOrNull(row.sent_at),
    error_code: row.error_code,
    error: row.error,
  };
}

async function decidedByOf(db: PrismaClient, userId: string | null): Promise<RegistrationDetailDto["decided_by"]> {
  if (userId === null) return null;
  const user = (await resolveUserDisplayMap(db, [userId]))[userId];
  return { id: userId, name: user?.display_name ?? user?.email ?? STAFF_FALLBACK_NAME };
}

function serializeDetail(
  row: DetailRow,
  decidedBy: RegistrationDetailDto["decided_by"],
  mails: MailRow[],
  nowMs: number,
): RegistrationDetailDto {
  return {
    id: row.id,
    status: row.status as RegistrationStatus,
    email: row.email,
    first_name: row.first_name,
    last_name: row.last_name,
    company: row.company,
    department: row.department,
    custom_data: plainObjectOrNull(row.custom_data),
    companions: serializeCompanions(row.companions),
    created_at: row.created_at.toISOString(),
    email_verified_at: isoOrNull(row.email_verified_at),
    confirm_expires_at: isoOrNull(row.confirm_expires_at),
    accepted_at: isoOrNull(row.accepted_at),
    consents: serializeConsents(row.consents),
    decided_at: isoOrNull(row.decided_at),
    decided_by: decidedBy,
    locale: row.locale,
    attendee_id: row.attendee_id,
    mails: mails.map((mail) => serializeMail(mail, row, nowMs)),
  };
}

/** The event of the address, once the caller is known to manage it; or the answer to send. */
async function resolveEvent(
  c: Context,
  db: PrismaClient,
): Promise<{ id: string; mode: RegistrationMode | null } | Response> {
  const eventId = requireEventId(c);
  if (eventId instanceof Response) return eventId;
  const forbidden = await assertEventManageAccess(c, db, eventId);
  if (forbidden) return forbidden;
  const event = await db.event.findUnique({
    where: { id: eventId },
    select: { id: true, registration_settings: { select: { mode: true } } },
  });
  if (!event) return c.json({ error: "not_found" }, 404);
  return { id: event.id, mode: (event.registration_settings?.mode ?? null) as RegistrationMode | null };
}

/** The filter of a request, or a 400 that names the parameters that were refused (never their values). */
function readFilter(c: Context): RegistrationListFilter | Response {
  const parsed = parseRegistrationFilter({
    status: c.req.query("status"),
    olderThan: c.req.query("older_than"),
    q: c.req.query("q"),
  });
  if (!parsed.ok) return c.json({ error: "validation_failed", fields: parsed.invalid }, 400);
  return parsed.filter;
}

/** The newest queued mail of each of the registrations: one query for the page, never one per row. */
async function lastMailByRegistration(
  db: PrismaClient,
  eventId: string,
  rows: readonly ListRow[],
  nowMs: number,
): Promise<Map<string, RegistrationMailBriefDto>> {
  const last = new Map<string, RegistrationMailBriefDto>();
  if (rows.length === 0) return last;
  const registrations = new Map(rows.map((row) => [row.id, row]));
  const mails = await db.registrationMail.findMany({
    where: { event_id: eventId, registration_id: { in: [...registrations.keys()] } },
    select: LAST_MAIL_SELECT,
    orderBy: [{ queued_at: "desc" }, { id: "desc" }],
  });
  for (const mail of mails) {
    const registration = registrations.get(mail.registration_id);
    if (registration && !last.has(mail.registration_id)) last.set(mail.registration_id, mailBrief(mail, registration, nowMs));
  }
  return last;
}

/**
 * GET /api/admin/events/:eventId/registrations
 * Query: `status` (one of the five states), `older_than` (REGISTRATION_AGE_FILTERS), `q` (words of a name
 * or an address), `page`, `pageSize` (at most 100). The oldest registration comes first, and one that
 * shares its time with another comes by id, so a page is the same each time it is read. A filter value
 * that is not valid answers 400 `validation_failed` with the names of the parameters, not their values.
 */
export async function handleListEventRegistrations(c: Context, db: PrismaClient): Promise<Response> {
  const event = await resolveEvent(c, db);
  if (event instanceof Response) return event;
  const filter = readFilter(c);
  if (filter instanceof Response) return filter;

  const page = positiveIntQuery(c.req.query("page"), 1);
  const pageSize = positiveIntQuery(c.req.query("pageSize"), DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE);
  const now = new Date();
  const where = registrationListWhere(event.id, filter, now);

  const [total, rows] = await Promise.all([
    db.registration.count({ where }),
    db.registration.findMany({
      where,
      orderBy: [{ created_at: "asc" }, { id: "asc" }],
      skip: (page - 1) * pageSize,
      take: pageSize,
      select: LIST_SELECT,
    }),
  ]);
  const lastMails = await lastMailByRegistration(db, event.id, rows, now.getTime());

  const body: RegistrationListDto = {
    items: rows.map((row) => serializeListItem(row, lastMails.get(row.id))),
    total,
    page,
    pageSize,
  };
  return c.json(body);
}

/** GET /api/admin/events/:eventId/registrations/counts */
export async function handleCountEventRegistrations(c: Context, db: PrismaClient): Promise<Response> {
  const event = await resolveEvent(c, db);
  if (event instanceof Response) return event;

  const groups = await db.registration.groupBy({
    by: ["status"],
    where: { event_id: event.id },
    _count: { _all: true },
  });
  const counted = new Map(groups.map((group) => [group.status, group._count._all]));
  const byStatus = Object.fromEntries(
    REGISTRATION_STATUS.map((status) => [status, counted.get(status) ?? 0]),
  ) as Record<RegistrationStatus, number>;

  const body: RegistrationCountsDto = { mode: event.mode, by_status: byStatus, needs_decision: byStatus.pending };
  return c.json(body);
}

/** GET /api/admin/events/:eventId/registrations/:id */
export async function handleGetEventRegistration(c: Context, db: PrismaClient): Promise<Response> {
  const event = await resolveEvent(c, db);
  if (event instanceof Response) return event;
  const id = c.req.param("id");
  if (!id) return c.json({ error: "not_found" }, 404);

  const row = await db.registration.findFirst({ where: { id, event_id: event.id }, select: DETAIL_SELECT });
  if (!row) return c.json({ error: "not_found" }, 404);

  const [mails, decidedBy] = await Promise.all([
    db.registrationMail.findMany({
      where: { registration_id: row.id, event_id: event.id },
      select: MAIL_SELECT,
      orderBy: [{ queued_at: "asc" }, { id: "asc" }],
    }),
    decidedByOf(db, row.decided_by),
  ]);
  return c.json(serializeDetail(row, decidedBy, mails, Date.now()));
}
