/**
 * Wallet message HTTP routes: resolve a recipient filter to attendees who currently have an
 * active wallet pass, enqueue the wallet_message AdminJob (drained by packages/tickets'
 * drain-wallet-message-jobs.ts), poll its status, and list send history. Mirrors the
 * wallet_push routes' job status/history shape and the mail bulk-send routes' filter/dry-run
 * shape, but is its own file - the recipient set (only attendees with an active wallet pass)
 * and the job type are both specific to this feature.
 */
import type { Context } from "hono";
import type { Prisma, PrismaClient } from "@admitto/db";
import { z } from "zod";
import {
  assertTicketTypeInCatalog,
  loadEventTicketTypes,
  UnknownTicketTypeError,
  writeBulkActionLog,
} from "@admitto/tickets";
import {
  adminAuditFromContext,
  assertEventManageAccess,
  requireEventId,
  resolveClientTimezone,
} from "./admin-helpers.js";
import { loadEventAdminJob } from "./admin-job-http.js";

export const WALLET_MESSAGE_RECIPIENT_LIMIT = 2000;
export const WALLET_MESSAGE_TEXT_MAX_LENGTH = 500;
const WALLET_MESSAGE_HISTORY_LIMIT = 20;
const WALLET_MESSAGE_ATTENDEE_SEARCH_MIN_LENGTH = 2;
const WALLET_MESSAGE_ATTENDEE_SEARCH_MAX_PAGE_SIZE = 20;

const walletMessageFilterSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("all") }).strict(),
  z.object({ type: z.literal("ticket_type"), value: z.string().trim().min(1).max(100) }).strict(),
  z
    .object({
      type: z.literal("attendee_ids"),
      ids: z.array(z.string().trim().min(1)).min(1).max(WALLET_MESSAGE_RECIPIENT_LIMIT),
    })
    .strict(),
]);

export type WalletMessageFilter = z.infer<typeof walletMessageFilterSchema>;

/** `text` is optional at the schema level and checked for real content only in the handler
 * (below, gated on `!dryRun`) - a dry run only counts recipients from `filter` and never reads
 * `text` at all, so requiring non-empty text here would reject a legitimate "count before I've
 * written the message yet" request with no real reason. */
const walletMessageSendBodySchema = z
  .object({
    filter: walletMessageFilterSchema,
    text: z.string().trim().max(WALLET_MESSAGE_TEXT_MAX_LENGTH).optional(),
    dryRun: z.boolean().optional(),
  })
  .strict();

/** Only attendees with a currently active, provider-issued wallet pass are ever valid
 * recipients - the picker/filters on the client already narrow to this set, but the server
 * re-applies it rather than trusting client-supplied ids blindly. */
const HAS_ACTIVE_WALLET_PASS: Prisma.AttendeeWhereInput = {
  wallet_pass: { status: "active", provider_pass_id: { not: null } },
};

export type WalletMessageDryRunDto = { recipientCount: number };
export type WalletMessageQueuedDto = { jobId: string | null; recipientCount: number };

/** Resolves a recipient filter to attendee ids, always intersected with "has an active wallet
 * pass" - "all" means all such attendees, not literally every attendee on the event. */
export async function resolveWalletMessageAttendeeIds(
  db: PrismaClient,
  eventId: string,
  filter: WalletMessageFilter,
): Promise<{ ids: string[]; overLimit: boolean }> {
  const baseWhere: Prisma.AttendeeWhereInput = { event_id: eventId, ...HAS_ACTIVE_WALLET_PASS };
  let where: Prisma.AttendeeWhereInput = baseWhere;

  switch (filter.type) {
    case "all":
      break;
    case "ticket_type":
      where = { ...baseWhere, ticket_type: filter.value };
      break;
    case "attendee_ids":
      where = { ...baseWhere, id: { in: filter.ids } };
      break;
  }

  const rows = await db.attendee.findMany({
    where,
    select: { id: true },
    take: WALLET_MESSAGE_RECIPIENT_LIMIT + 1,
  });

  if (rows.length > WALLET_MESSAGE_RECIPIENT_LIMIT) {
    return { ids: [], overLimit: true };
  }
  return { ids: rows.map((r) => r.id), overLimit: false };
}

async function assertTicketTypeFilterValid(
  db: PrismaClient,
  eventId: string,
  filter: WalletMessageFilter,
): Promise<"unknown_ticket_type" | null> {
  if (filter.type !== "ticket_type") return null;
  try {
    assertTicketTypeInCatalog(await loadEventTicketTypes(db, eventId), filter.value);
    return null;
  } catch (err) {
    if (err instanceof UnknownTicketTypeError) return "unknown_ticket_type";
    throw err;
  }
}

async function auditWalletMessageSend(
  db: PrismaClient,
  c: Context,
  eventId: string,
  meta: { filterType: string; recipientCount: number },
): Promise<void> {
  try {
    await writeBulkActionLog(db, {
      event_id: eventId,
      action_type: "wallet_message_sent",
      audit: adminAuditFromContext(c),
      metadata: { filter: meta.filterType, recipient_count: meta.recipientCount },
    });
  } catch (err) {
    console.error("wallet message send audit log failed:", err);
  }
}

/** POST /api/admin/events/:eventId/wallet-message/send - dry-run (recipientCount only) or
 * enqueues a wallet_message AdminJob, drained asynchronously by the worker. Never sends
 * synchronously from this request, even for a single recipient. */
export async function handleWalletMessageSend(c: Context, db: PrismaClient): Promise<Response> {
  const eventIdOrRes = requireEventId(c);
  if (eventIdOrRes instanceof Response) return eventIdOrRes;
  const eventId = eventIdOrRes;

  const forbidden = await assertEventManageAccess(c, db, eventId);
  if (forbidden) return forbidden;

  let body: z.infer<typeof walletMessageSendBodySchema>;
  try {
    body = walletMessageSendBodySchema.parse(await c.req.json());
  } catch {
    return c.json({ error: "validation_failed" }, 400);
  }

  const ticketTypeError = await assertTicketTypeFilterValid(db, eventId, body.filter);
  if (ticketTypeError) return c.json({ error: ticketTypeError }, 400);

  const { ids, overLimit } = await resolveWalletMessageAttendeeIds(db, eventId, body.filter);
  if (overLimit) {
    return c.json({ error: "too_many_attendees", limit: WALLET_MESSAGE_RECIPIENT_LIMIT }, 400);
  }

  if (body.dryRun) {
    return c.json({ recipientCount: ids.length } satisfies WalletMessageDryRunDto);
  }

  const text = body.text?.trim();
  if (!text) return c.json({ error: "validation_failed" }, 400);

  if (ids.length === 0) {
    return c.json({ jobId: null, recipientCount: 0 } satisfies WalletMessageQueuedDto);
  }

  const event = await db.event.findUnique({ where: { id: eventId }, select: { organization_id: true } });
  if (!event) return c.json({ error: "not_found" }, 404);

  const audit = adminAuditFromContext(c);
  const job = await db.adminJob.create({
    data: {
      type: "wallet_message",
      status: "pending",
      organization_id: event.organization_id,
      event_id: eventId,
      actor_user_id: audit.operator ?? null,
      session_id: audit.sessionId ?? null,
      client_timezone: resolveClientTimezone(c),
      result_json: { request: { eventId, attendeeIds: ids, text } },
    },
  });

  await auditWalletMessageSend(db, c, eventId, { filterType: body.filter.type, recipientCount: ids.length });

  return c.json({ jobId: job.id, recipientCount: ids.length } satisfies WalletMessageQueuedDto);
}

/** Shape written by drainWalletMessageJobs (packages/tickets/src/drain-wallet-message-jobs.ts)
 * into AdminJob.result_json once a job finishes. */
type WalletMessageResultJson = { sent?: number; skipped?: number; errored?: number } | null;

/** GET /api/admin/events/:eventId/wallet-message/jobs/:jobId */
export async function handleGetWalletMessageJob(c: Context, db: PrismaClient): Promise<Response> {
  const loaded = await loadEventAdminJob(c, db, "wallet_message");
  if (loaded instanceof Response) return loaded;
  const { job } = loaded;

  const result = (job.result_json ?? null) as WalletMessageResultJson;

  c.header("Cache-Control", "no-store");
  return c.json({
    jobId: job.id,
    status: job.status,
    error: job.error,
    progressTotal: job.progress_total,
    progressDone: job.progress_done,
    sent: result?.sent ?? null,
    skipped: result?.skipped ?? null,
    errored: result?.errored ?? null,
    created_at: job.created_at.toISOString(),
    started_at: job.started_at ? job.started_at.toISOString() : null,
  });
}

/** GET /api/admin/events/:eventId/wallet-message/history - recent terminal wallet_message jobs. */
export async function handleGetWalletMessageHistory(c: Context, db: PrismaClient): Promise<Response> {
  const eventIdOrRes = requireEventId(c);
  if (eventIdOrRes instanceof Response) return eventIdOrRes;
  const eventId = eventIdOrRes;
  const forbidden = await assertEventManageAccess(c, db, eventId);
  if (forbidden) return forbidden;

  const jobs = await db.adminJob.findMany({
    where: { event_id: eventId, type: "wallet_message", status: { in: ["succeeded", "failed"] } },
    orderBy: { finished_at: "desc" },
    take: WALLET_MESSAGE_HISTORY_LIMIT,
    select: { id: true, created_at: true, finished_at: true, status: true, error: true, result_json: true },
  });

  const items = jobs.map((job) => {
    const result = (job.result_json ?? null) as WalletMessageResultJson;
    const when = job.finished_at ?? job.created_at;
    return {
      id: job.id,
      created_at: when.toISOString(),
      sent: result?.sent ?? 0,
      skipped: result?.skipped ?? 0,
      errored: result?.errored ?? 0,
      status: job.status === "failed" ? ("failed" as const) : ("succeeded" as const),
      error: job.status === "failed" ? job.error : null,
    };
  });

  c.header("Cache-Control", "no-store");
  return c.json({ items });
}

/** GET /api/admin/events/:eventId/wallet-message/attendees?q=... - type-to-search attendee
 * picker for the "Specific attendees" recipient filter, scoped to attendees who currently have
 * an active wallet pass (unlike the general attendee search, which lists everyone). Small,
 * dedicated query rather than threading a wallet filter through the shared paginated Attendees
 * list machinery (packages/tickets/src/attendees-list-filters.ts) - that module backs the main
 * Attendees table's raw-SQL sort/search/pagination and this picker needs none of that, only a
 * short name/email match. */
export async function handleSearchWalletMessageAttendees(c: Context, db: PrismaClient): Promise<Response> {
  const eventIdOrRes = requireEventId(c);
  if (eventIdOrRes instanceof Response) return eventIdOrRes;
  const eventId = eventIdOrRes;
  const forbidden = await assertEventManageAccess(c, db, eventId);
  if (forbidden) return forbidden;

  const q = (c.req.query("q") ?? "").trim();
  if (q.length < WALLET_MESSAGE_ATTENDEE_SEARCH_MIN_LENGTH) {
    c.header("Cache-Control", "no-store");
    return c.json({ items: [] });
  }

  const rows = await db.attendee.findMany({
    where: {
      event_id: eventId,
      ...HAS_ACTIVE_WALLET_PASS,
      OR: [{ name: { contains: q, mode: "insensitive" } }, { email: { contains: q, mode: "insensitive" } }],
    },
    select: { id: true, name: true, email: true },
    orderBy: { name: "asc" },
    take: WALLET_MESSAGE_ATTENDEE_SEARCH_MAX_PAGE_SIZE,
  });

  c.header("Cache-Control", "no-store");
  return c.json({ items: rows });
}
