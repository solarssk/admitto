import type { Context } from "hono";
import { Prisma } from "@admitto/db";
import type { PrismaClient } from "@admitto/db";
import { z } from "zod";
import { recordSystemLog } from "@admitto/shared/system-log";
import {
  listDeliveries,
  resendTicketEmail,
  resolveAttendeeMailLinks,
  sendTicketEmails,
  toDeliveryDto,
  type DeliveryDto,
  type MailDeliveryDeps,
} from "@admitto/mail-delivery";
import { TemplateNotFoundError } from "@admitto/mail-templates";
import type { AttendeeStatus, WalletPassStatus } from "@admitto/db/status";
import { decryptFromString } from "@admitto/crypto";
import { WalletProviderError, resolveWalletProvider, type WalletPassProvider } from "@admitto/wallet";
import { resolveTicketPageDisplay, buildWalletPassInput } from "../wallet-pass-input.js";
import {
  loadEventCustomDataFields,
  buildCustomDataFromInput,
  validateCustomDataPatch,
  assertCustomDataMeetsRequirements,
  customDataValue,
  parseCustomData,
  writeActionLog,
  writeActionLogMany,
  writeAdminAuditLog,
  writeBulkActionLog,
  type EventItemContent,
  ATTENDEE_EXPORT_RSVP_STATUSES,
  ATTENDEE_MAIL_STATUS_FILTERS,
  ATTENDEE_SORT_COLUMNS,
  EXPORT_ROW_CAP,
  countFilteredAttendees,
  findFilteredAttendeesForList,
  findSelectedAttendeesForExport,
  isAdmittable,
  admitAttendee,
  revokeCheckIn,
  revokeCheckInMutation,
  revokeItemState,
  revokeItemsForAttendees,
  getAttendeeCard,
  UndoNotAllowedError,
  addAttendeeNote,
  updateAttendeeNote,
  deleteAttendeeNote,
  NoteTooLongError,
  NoteNotFoundError,
  NoteForbiddenError,
  type OpsAuditContext,
  ADMITTABLE_STATUS_LIST,
  IllegalItemTransitionError,
  loadEventTicketTypes,
  parseWalletFieldMapping,
  resolveTicket,
  assertTicketTypeInCatalog,
  UnknownTicketTypeError,
  acquireEventTicketTypesLock,
  REVOCABLE_ITEM_STATES,
  type AdmitResult,
  type AttendeeMailStatusFilter,
  type AttendeeSortBy,
  type AttendeeSortDir,
  type ExportAttendeeSqlRow,
  buildAttendeesExportArtifact,
} from "@admitto/tickets";
import { canManageInstance } from "@admitto/auth";
import { InstanceUrlRequiredError, resolveInstanceBaseUrl } from "../instance-base-url.js";
import {
  adminAuditFromContext,
  assertEventManageAccess,
  itemTransitionErrorResponse,
  positiveIntQuery,
  requireEventId,
  resolveClientTimezone,
  resolveMailInstanceBaseUrl,
} from "./admin-helpers.js";
import { loadEventAdminJob } from "./admin-job-http.js";
import { mailTransportSetupErrorResponse } from "./mail-settings-shared.js";
import { assertEventCapacityForIncoming, acquireEventCapacityLock, isCapacityReactivation } from "./event-capacity.js";
import { attachmentContentDisposition } from "./content-disposition.js";
import { randomUUID } from "node:crypto";
import { optimisticAttendeeUpdate, StaleWriteError, isStaleWrite } from "./optimistic-update.js";
import { resolveBulkSendAttendeeIds, BULK_SEND_LIMIT } from "./bulk-send-routes.js";
import { publishActivityChanged } from "./checkin-sse-publish.js";

const ATTENDEE_DETAIL_SELECT = {
  id: true,
  name: true,
  first_name: true,
  last_name: true,
  email: true,
  company: true,
  department: true,
  ticket_type: true,
  status: true,
  admitted_at: true,
  custom_data: true,
  created_at: true,
  client_timezone: true,
  updated_at: true,
  rsvp_status: true,
  rsvp_updated_at: true,
  rsvp_source: true,
  wallet_pass: {
    select: {
      status: true,
      issued_at: true,
      voided_at: true,
      apple_url: true,
      android_url: true,
      last_synced_at: true,
      last_error_code: true,
      apple_active_registrations: true,
      apple_inactive_registrations: true,
      google_active_registrations: true,
      google_inactive_registrations: true,
      first_downloaded_at: true,
      registration_checked_at: true,
    },
  },
} as const;

const RSVP_STATUSES = ATTENDEE_EXPORT_RSVP_STATUSES;
type RsvpStatus = (typeof RSVP_STATUSES)[number];
const rsvpStatusSchema = z.enum(RSVP_STATUSES);

const patchAttendeeFieldsSchema = z
  .object({
    first_name: z.string().trim().min(1).max(100).optional(),
    last_name: z.string().trim().min(1).max(100).optional(),
    email: z.string().trim().email().max(254).optional(),
    company: z.string().trim().max(200).optional().nullable(),
    department: z.string().trim().max(200).optional().nullable(),
    ticket_type: z.string().trim().max(100).optional().nullable(),
    custom_data_fields: z
      .record(
        z
          .string()
          .trim()
          .min(1)
          .max(60)
          .regex(/^[a-z0-9_]+$/),
        z.string().trim().max(100).nullable(),
      )
      .optional(),
    rsvp_status: rsvpStatusSchema.optional(),
    status: z.enum(["registered", "revoked"]).optional(),
  })
  .strict();

const patchAttendeeSchema = patchAttendeeFieldsSchema.extend({
  // Optional at parse time; required in handler when computePatchChanges finds a real delta (no-op exempt).
  expected_updated_at: z.string().datetime({ offset: true }).optional(),
});

const resendBodySchema = z
  .object({
    to: z.string().trim().email().optional(),
    // Resend this specific template instead of the event's current default - used by the
    // Delivery log row's "Resend", which resends what actually bounced/failed, not whatever
    // template is active today.
    templateId: z.string().trim().min(1).optional(),
  })
  .strict();

/** Empty or whitespace-only POST body parses as `{}`; malformed JSON returns 400. */
async function parseOptionalJsonBody(c: Context): Promise<unknown> {
  try {
    const text = await c.req.text();
    if (!text.trim()) return {};
    return JSON.parse(text);
  } catch {
    return c.json({ error: "invalid json" }, 400);
  }
}

/** Hard cap on attendees in one bulk-resend to avoid request timeout. */
const BULK_RESEND_LIMIT = BULK_SEND_LIMIT;

const bulkResendBodySchema = z
  .object({
    target: z.enum(["unsent", "all"]).default("unsent"),
  })
  .strict();

export type BulkResendDto = {
  /** Batch id for GET .../send/status/:batchId polling (null when nothing queued). */
  batchId: string | null;
  /** Delivery rows left in `queued` for the worker to drain. */
  queued: number;
  skipped: number;
  /** Always 0 at enqueue time; terminal failures appear on status poll. */
  failed: number;
};

const customDataFieldValueSchema = z.string().trim().max(100).nullable();

const customDataFieldsRecordSchema = z.record(
  z
    .string()
    .trim()
    .min(1)
    .max(60)
    .regex(/^[a-z0-9_]+$/),
  customDataFieldValueSchema,
);

const createAttendeeSchema = z
  .object({
    email: z.string().trim().email().max(254),
    first_name: z.string().trim().min(1).max(100),
    last_name: z.string().trim().min(1).max(100),
    company: z.string().trim().max(200).optional(),
    department: z.string().trim().max(200).optional(),
    ticket_type: z.string().trim().max(100).optional(),
    custom_data: customDataFieldsRecordSchema.optional(),
  })
  .strict();

/** Append bulk audit row after a successful filtered or explicit-selection export (no raw
 * search term, no attendee ids — `selected_count` is how many ids the operator requested,
 * while `count` above it is how many rows actually exported). */
async function auditAttendeesExported(
  db: PrismaClient,
  c: Context,
  eventId: string,
  format: "xlsx" | "csv" | "pdf",
  count: number,
  filters:
    | { status: string; ticket_type?: string; mail_status?: string; has_query: boolean }
    | { selected_count: number },
): Promise<void> {
  await db.$transaction(async (tx) => {
    await writeBulkActionLog(tx, {
      event_id: eventId,
      action_type: "attendees_exported",
      audit: adminAuditFromContext(c),
      metadata: {
        format,
        count,
        filters:
          "selected_count" in filters
            ? { selected_count: filters.selected_count }
            : {
                status: filters.status,
                ticket_type: filters.ticket_type ?? null,
                mail_status: filters.mail_status ?? null,
                has_query: filters.has_query,
              },
      },
    });
  });
}

export type AttendeeRowDto = {
  id: string;
  name: string;
  email: string;
  company: string | null;
  department: string | null;
  ticket_type: string | null;
  status: AttendeeStatus;
  check_in_status: "admitted" | "not_admitted";
  admitted_at: string | null;
  updated_at: string;
  last_mail_status: string | null;
  rsvp_status: RsvpStatus;
  /** Whether this attendee currently has at least one issued/returned item hand-out — lets the
   * Attendees list's bulk "Revoke items" action report how many of the selection it would
   * actually affect, not just the raw selection size. */
  has_issued_items: boolean;
  /** Same registration-status fields as WalletPassActionDto, shown compactly in the list's
   * Wallet column - null when no WalletPass row exists yet for this attendee (wallet not
   * configured for the event, or the attendee hasn't added it). */
  wallet_status: Pick<
    WalletPassActionDto,
    | "apple_active_registrations"
    | "apple_inactive_registrations"
    | "google_active_registrations"
    | "google_inactive_registrations"
  > | null;
};

export type AttendeeActionLogEntryDto = {
  id: string;
  action_type: string;
  actor_display: string | null;
  metadata: Record<string, unknown> | null;
  created_at: string;
  /** Acting admin's IANA timezone at write time, when known. */
  client_timezone: string | null;
};

export type AttendeeDetailItemDto = {
  key: string;
  label: string;
  icon: string | null;
  state: string;
};

/** A note author's effective role in this event's context, resolved the same way the Users page
 * shows role badges (see resolveNoteAuthorRoles) - null when the author has no role assignment
 * left (e.g. removed from staff since writing the note). */
export type NoteAuthorRole = "superadmin" | "admin" | "operator" | null;

export type AttendeeNoteDto = {
  id: string;
  body: string;
  author_display: string;
  /** Raw author id (not PII beyond what author_display already reveals) - the frontend compares
   * this against the signed-in user's own id to show Edit/Delete on their own notes. */
  author_user_id: string;
  author_role: NoteAuthorRole;
  created_at: string;
};

export type AttendeeDetailDto = {
  id: string;
  name: string;
  first_name: string | null;
  last_name: string | null;
  email: string;
  company: string | null;
  department: string | null;
  ticket_type: string | null;
  status: AttendeeStatus;
  check_in_status: "admitted" | "not_admitted";
  admitted_at: string | null;
  created_at: string;
  /** Acting admin's IANA timezone at attendee-creation time, when known (manual add / import). */
  client_timezone: string | null;
  updated_at: string;
  rsvp_status: RsvpStatus;
  rsvp_updated_at: string | null;
  rsvp_source: string | null;
  wallet_pass: WalletPassActionDto | null;
  /** Same on-demand /t/.../wallet/:platform redirect routes the ticket page's own buttons and
   * ticket emails use (create-or-reuse the pass, then 302 to the provider) - null when wallet
   * isn't configured/enabled for this event or platform, or the instance URL isn't set yet. Works
   * whether or not wallet_pass exists yet, unlike wallet_pass's own apple_url/android_url (only
   * populated after a pass has actually been created) - PO review, 2026-08-13. */
  wallet_apple_link: string | null;
  wallet_google_link: string | null;
  custom_data: unknown;
  deliveries: DeliveryDto[];
  action_log: AttendeeActionLogEntryDto[];
  event_items: AttendeeDetailItemDto[];
  notes: AttendeeNoteDto[];
  notes_total: number;
  notes_page: number;
  notes_page_size: number;
};

/** Read-only event-day item summary for the attendee detail page — same source data as the
 * check-in AttendeeCardDto (enabled EventItems + this attendee's AttendeeItemState rows), but
 * without getAttendeeCard's ensureAttendeeItemStates write-on-read side effect: a plain detail
 * view has no reason to create pending-state rows the operator card would lazily backfill.
 * Deliberately doesn't surface each item's configured content_fields (e.g. shirt size) inline -
 * with several fields configured that reads as clutter next to the item name and duplicates the
 * Additional information card, which already lists every custom_data field on its own (PO review). */
async function loadAttendeeItemsSummary(
  db: PrismaClient,
  eventId: string,
  attendeeId: string,
): Promise<AttendeeDetailItemDto[]> {
  const items = await db.eventItem.findMany({
    where: { event_id: eventId, enabled: true },
    orderBy: { key: "asc" },
  });
  if (items.length === 0) return [];

  const states = await db.attendeeItemState.findMany({
    where: { attendee_id: attendeeId, event_item_id: { in: items.map((item) => item.id) } },
  });
  const stateByItem = new Map(states.map((s) => [s.event_item_id, s.state]));

  return items.map((item) => ({
    key: item.key,
    label: item.label,
    icon: item.icon,
    state: stateByItem.get(item.id) ?? "pending",
  }));
}

/** Map admitted_at to API check-in status for list/detail DTOs. */
function checkInStatus(admittedAt: Date | null): "admitted" | "not_admitted" {
  return admittedAt ? "admitted" : "not_admitted";
}

/** Resolve company/department from custom_data with legacy column fallback (operator parity). */
function resolveCompanyDepartment(attendee: {
  custom_data: unknown;
  company: string | null;
  department: string | null;
}): { company: string | null; department: string | null } {
  const cd = parseCustomData(attendee.custom_data);
  return {
    company: cd.company ?? attendee.company,
    department: cd.department ?? attendee.department,
  };
}

/** Clone custom_data JSON for partial updates without dropping unknown keys. */
function cloneCustomData(raw: unknown): Record<string, unknown> {
  if (raw && typeof raw === "object" && !Array.isArray(raw)) {
    return { ...(raw as Record<string, unknown>) };
  }
  return {};
}

/** Require `:id` attendee route param or return 400. */
function requireAttendeeId(c: Context): string | Response {
  const id = c.req.param("id");
  if (!id) return c.json({ error: "id required" }, 400);
  return id;
}

function requireNoteId(c: Context): string {
  // `noteId` is a required segment on both registered note-mutation routes.
  return c.req.param("noteId")!;
}

async function requireNoteBody(c: Context): Promise<string | Response> {
  const body = await c.req.json().catch(() => null);
  const noteBody = body && typeof body === "object" ? (body as Record<string, unknown>).body : undefined;
  if (typeof noteBody !== "string" || !noteBody.trim()) {
    return c.json({ error: "body required" }, 400);
  }
  return noteBody;
}

/** Load attendee scoped to event; null when missing or cross-event (caller returns 403). */
async function loadAttendeeInEvent(
  db: PrismaClient,
  eventId: string,
  attendeeId: string,
) {
  const row = await db.attendee.findUnique({
    where: { id: attendeeId },
    select: { ...ATTENDEE_DETAIL_SELECT, event_id: true },
  });
  if (row?.event_id !== eventId) return null;
  return row;
}

type ManagedEventAttendee = {
  attendee: NonNullable<Awaited<ReturnType<typeof loadAttendeeInEvent>>>;
  attendeeId: string;
  eventId: string;
};

/** Resolve, authorize, and load an attendee scoped to the requested event. */
async function requireManagedEventAttendee(
  c: Context,
  db: PrismaClient,
): Promise<ManagedEventAttendee | Response> {
  const eventIdOrRes = requireEventId(c);
  if (eventIdOrRes instanceof Response) return eventIdOrRes;
  const eventId = eventIdOrRes;
  const attendeeIdOrRes = requireAttendeeId(c);
  if (attendeeIdOrRes instanceof Response) return attendeeIdOrRes;
  const attendeeId = attendeeIdOrRes;

  const forbidden = await assertEventManageAccess(c, db, eventId);
  if (forbidden) return forbidden;

  const attendee = await loadAttendeeInEvent(db, eventId, attendeeId);
  if (!attendee) return c.json({ error: "forbidden" }, 403);

  return { attendee, attendeeId, eventId };
}

/** Parse and clamp list query params (`page`, `pageSize`, `q`, `status`, `ticket_type`, `mail_status`, `sortBy`, `sortDir`). */
function parseListQuery(c: Context): {
  page: number;
  pageSize: number;
  q?: string;
  status: "all" | "admitted" | "not_admitted";
  ticket_type?: string;
  rsvp_status?: RsvpStatus;
  mail_status?: AttendeeMailStatusFilter;
  sortBy: AttendeeSortBy;
  sortDir: AttendeeSortDir;
} {
  const page = positiveIntQuery(c.req.query("page"), 1);
  const pageSize = positiveIntQuery(c.req.query("pageSize"), 25, 100);
  const qRaw = c.req.query("q")?.trim();
  const q = qRaw || undefined;
  const statusRaw = c.req.query("status") ?? "all";
  const status =
    statusRaw === "admitted" || statusRaw === "not_admitted" ? statusRaw : "all";
  const ticketTypeRaw = c.req.query("ticket_type")?.trim();
  const ticket_type = ticketTypeRaw || undefined;
  const rsvpRaw = c.req.query("rsvp_status")?.trim();
  const rsvp_status = RSVP_STATUSES.includes(rsvpRaw as RsvpStatus)
    ? (rsvpRaw as RsvpStatus)
    : undefined;
  const mailStatusRaw = c.req.query("mail_status")?.trim();
  const mail_status = ATTENDEE_MAIL_STATUS_FILTERS.includes(mailStatusRaw as AttendeeMailStatusFilter)
    ? (mailStatusRaw as AttendeeMailStatusFilter)
    : undefined;
  const sortByRaw = c.req.query("sortBy");
  const sortBy = ATTENDEE_SORT_COLUMNS.includes(sortByRaw as AttendeeSortBy)
    ? (sortByRaw as AttendeeSortBy)
    : "name";
  const sortDirRaw = c.req.query("sortDir");
  const sortDir: AttendeeSortDir = sortDirRaw === "desc" ? "desc" : "asc";
  return { page, pageSize, q, status, ticket_type, rsvp_status, mail_status, sortBy, sortDir };
}

/** Latest email delivery status per attendee id (one entry per id). Tiebreak on `id` desc
 * after `created_at` desc, not just created_at — two deliveries for the same attendee can
 * share a millisecond timestamp (e.g. a resend queued in the same request), and without a
 * deterministic tiebreak here this could disagree with attendeeMailStatusSql's `mail_status`
 * filter (packages/tickets/attendees-list-filters.ts), which already tiebreaks the same way
 * specifically so the Mail column badge and the filter always agree on "latest" (code
 * review). */
async function lastMailStatusByAttendee(
  db: PrismaClient,
  attendeeIds: string[],
): Promise<Map<string, string>> {
  if (attendeeIds.length === 0) return new Map();

  const deliveries = await db.emailDelivery.findMany({
    where: { attendee_id: { in: attendeeIds } },
    select: { attendee_id: true, status: true },
    orderBy: [{ created_at: "desc" }, { id: "desc" }],
  });

  const map = new Map<string, string>();
  for (const row of deliveries) {
    if (!map.has(row.attendee_id)) {
      map.set(row.attendee_id, row.status);
    }
  }
  return map;
}

/** Attendee ids (within the given set) that currently have at least one issued/returned item
 * hand-out — backs the Attendees list's `has_issued_items` row field. */
async function issuedItemsAttendeeIds(db: PrismaClient, attendeeIds: string[]): Promise<Set<string>> {
  if (attendeeIds.length === 0) return new Set();

  const states = await db.attendeeItemState.findMany({
    where: { attendee_id: { in: attendeeIds }, state: { in: REVOCABLE_ITEM_STATES } },
    select: { attendee_id: true },
    distinct: ["attendee_id"],
  });
  return new Set(states.map((s) => s.attendee_id));
}

type AttendeeWalletStatus = Pick<
  WalletPassActionDto,
  | "apple_active_registrations"
  | "apple_inactive_registrations"
  | "google_active_registrations"
  | "google_inactive_registrations"
>;

/** Registration status per attendee (within the given set) that has a WalletPass row at all -
 * backs the Attendees list's Wallet column. Attendees with no row (wallet never created for
 * them) are simply absent from the returned map. */
async function walletStatusByAttendee(
  db: PrismaClient,
  attendeeIds: string[],
): Promise<Map<string, AttendeeWalletStatus>> {
  if (attendeeIds.length === 0) return new Map();

  const rows = await db.walletPass.findMany({
    where: { attendee_id: { in: attendeeIds } },
    select: {
      attendee_id: true,
      apple_active_registrations: true,
      apple_inactive_registrations: true,
      google_active_registrations: true,
      google_inactive_registrations: true,
    },
  });
  return new Map(
    rows.map((row) => [
      row.attendee_id,
      {
        apple_active_registrations: row.apple_active_registrations,
        apple_inactive_registrations: row.apple_inactive_registrations,
        google_active_registrations: row.google_active_registrations,
        google_inactive_registrations: row.google_inactive_registrations,
      },
    ]),
  );
}

/** Shown in activity log when a human actor has no display_name (email is never exposed). */
const ACTION_LOG_ACTOR_FALLBACK = "Admin";

/** Page size for the detail page's notes list. The check-in card remains deliberately smaller
 * (CARD_NOTES_LIMIT = 5) for the operator scan flow; this endpoint exposes the full history
 * through explicit pages without an unbounded query. */
const ATTENDEE_NOTES_PAGE_SIZE = 50;
const ATTENDEE_NOTES_MAX_PAGE = 10_000;
const NOTE_AUTHOR_FALLBACK = "Staff member";

async function loadAttendeeActionLogEntries(
  db: PrismaClient,
  attendeeId: string,
): Promise<AttendeeActionLogEntryDto[]> {
  const logs = await db.attendeeActionLog.findMany({
    where: { attendee_id: attendeeId },
    orderBy: { created_at: "desc" },
    take: 50,
    select: {
      id: true,
      action_type: true,
      actor_user_id: true,
      metadata: true,
      created_at: true,
      client_timezone: true,
    },
  });

  const actorIds = [
    ...new Set(logs.map((log) => log.actor_user_id).filter((id): id is string => id != null)),
  ];
  const users =
    actorIds.length > 0
      ? await db.user.findMany({
          where: { id: { in: actorIds } },
          select: { id: true, display_name: true },
        })
      : [];
  const userById = new Map(users.map((user) => [user.id, user]));

  return logs.map((log) => {
    const actor = log.actor_user_id ? userById.get(log.actor_user_id) : undefined;
    return {
      id: log.id,
      action_type: log.action_type,
      actor_display: log.actor_user_id
        ? (actor?.display_name ?? ACTION_LOG_ACTOR_FALLBACK)
        : "System",
      metadata:
        log.metadata && typeof log.metadata === "object" && !Array.isArray(log.metadata)
          ? (log.metadata as Record<string, unknown>)
          : null,
      created_at: log.created_at.toISOString(),
      client_timezone: log.client_timezone,
    };
  });
}

/** Resolves each given user's effective role *in this event's context* - instance-wide
 * superadmin outranks an org admin (matching this event's organization), which outranks an
 * event-scoped operator (matching this event) - null when none apply. Same scope-per-role model
 * ADR 0010 assumes elsewhere (canManageEvent/canManageInstance): in practice a RoleAssignment row
 * only ever pairs superadmin with instance scope, admin with organization scope, and operator
 * with event scope, so a single query for "any row that could plausibly apply here" is enough. */
async function resolveNoteAuthorRoles(
  db: PrismaClient,
  eventId: string,
  organizationId: string,
  userIds: string[],
): Promise<Map<string, NoteAuthorRole>> {
  const roles = new Map<string, NoteAuthorRole>(userIds.map((id) => [id, null]));

  const assignments = await db.roleAssignment.findMany({
    where: {
      user_id: { in: userIds },
      OR: [
        { scope_type: "instance" },
        { scope_type: "organization", scope_id: organizationId },
        { scope_type: "event", scope_id: eventId },
      ],
    },
    select: { user_id: true, role: true },
  });

  const rolesByUser = new Map<string, Set<string>>();
  for (const a of assignments) {
    const set = rolesByUser.get(a.user_id) ?? new Set<string>();
    set.add(a.role);
    rolesByUser.set(a.user_id, set);
  }

  for (const id of userIds) {
    const userRoles = rolesByUser.get(id);
    if (!userRoles) continue;
    // Apply low to high so a broader role replaces a narrower one when a user has both.
    for (const role of ["operator", "admin", "superadmin"] as const) {
      if (userRoles.has(role)) roles.set(id, role);
    }
  }
  return roles;
}

/** Loads notes for the detail page's Notes tab — same AttendeeNote rows the check-in card
 * reads (attendee-card.ts), newest first, just without that card's small CARD_NOTES_LIMIT.
 * author_user_id is always a real staff User.id (admin session or check-in operator token),
 * so this resolves it the same way loadAttendeeActionLogEntries resolves actor_user_id. Also
 * resolves each author's role (see resolveNoteAuthorRoles) so the UI can show who added a note
 * in terms of their actual staff role, not just their name - distinguishes an operator's
 * check-in note from an admin's own. */
async function loadAttendeeNotes(
  db: PrismaClient,
  eventId: string,
  attendeeId: string,
  page: number,
): Promise<{ items: AttendeeNoteDto[]; total: number }> {
  const where = { attendee_id: attendeeId, event_id: eventId };
  const [notes, total] = await Promise.all([
    db.attendeeNote.findMany({
      where,
      orderBy: { created_at: "desc" },
      skip: (page - 1) * ATTENDEE_NOTES_PAGE_SIZE,
      take: ATTENDEE_NOTES_PAGE_SIZE,
      select: { id: true, body: true, author_user_id: true, created_at: true },
    }),
    db.attendeeNote.count({ where }),
  ]);
  if (notes.length === 0) return { items: [], total };

  const authorIds = [...new Set(notes.map((note) => note.author_user_id))];
  const authorsPromise = db.user.findMany({
    where: { id: { in: authorIds } },
    select: { id: true, display_name: true },
  });
  const rolesPromise = db.event
    .findUniqueOrThrow({ where: { id: eventId }, select: { organization_id: true } })
    .then((event) => resolveNoteAuthorRoles(db, eventId, event.organization_id, authorIds));
  const [authors, rolesByAuthor] = await Promise.all([authorsPromise, rolesPromise]);
  const authorById = new Map(authors.map((author) => [author.id, author]));

  return {
    items: notes.map((note) => ({
      id: note.id,
      body: note.body,
      author_display: authorById.get(note.author_user_id)?.display_name ?? NOTE_AUTHOR_FALLBACK,
      author_user_id: note.author_user_id,
      author_role: rolesByAuthor.get(note.author_user_id) ?? null,
      created_at: note.created_at.toISOString(),
    })),
    total,
  };
}

/** Serialize a list row with derived check-in and last-mail status. */
function serializeAttendeeRow(
  row: {
    id: string;
    name: string;
    email: string;
    company: string | null;
    department: string | null;
    custom_data: unknown;
    ticket_type: string | null;
    status: string;
    admitted_at: Date | null;
    updated_at: Date;
    rsvp_status: string;
  },
  lastMail: Map<string, string>,
  issuedItems: Set<string>,
  walletStatus: Map<string, AttendeeWalletStatus>,
): AttendeeRowDto {
  const { company, department } = resolveCompanyDepartment(row);
  return {
    id: row.id,
    name: row.name,
    email: row.email,
    company,
    department,
    ticket_type: row.ticket_type,
    status: row.status as AttendeeStatus,
    check_in_status: checkInStatus(row.admitted_at),
    admitted_at: row.admitted_at ? row.admitted_at.toISOString() : null,
    updated_at: row.updated_at.toISOString(),
    last_mail_status: lastMail.get(row.id) ?? null,
    rsvp_status: row.rsvp_status as RsvpStatus,
    has_issued_items: issuedItems.has(row.id),
    wallet_status: walletStatus.get(row.id) ?? null,
  };
}

/** Same on-demand wallet routes the ticket page's own buttons and ticket emails use
 * (buildAttendeeMailLinks) - works whether or not a WalletPass row exists yet, unlike
 * wallet_pass.apple_url/android_url which are only populated after a pass has actually been
 * created (PO review, 2026-08-13: admin had no way to copy a wallet link for an attendee who
 * hadn't added their pass yet). Null for either platform when wallet isn't configured/enabled
 * for this event, the instance URL isn't set yet, or the attendee is missing whatever identifier
 * (public_ref / plaintext token) that platform's route needs - never a hard failure, since these
 * links are a convenience on top of the rest of the attendee detail page, not a requirement of it. */
async function resolveAttendeeWalletLinksForDto(
  db: PrismaClient,
  attendeeId: string,
): Promise<{ apple: string | null; google: string | null }> {
  try {
    const baseUrl = await resolveInstanceBaseUrl(db, process.env);
    const links = await resolveAttendeeMailLinks(attendeeId, db, baseUrl);
    return { apple: links.apple_wallet_url || null, google: links.google_wallet_url || null };
  } catch (err) {
    if (err instanceof InstanceUrlRequiredError) return { apple: null, google: null };
    console.error("resolveAttendeeWalletLinksForDto failed:", err);
    return { apple: null, google: null };
  }
}

/** Build attendee detail DTO including delivery log and activity. */
async function buildAttendeeDetailDto(
  db: PrismaClient,
  eventId: string,
  row: {
    id: string;
    name: string;
    first_name: string | null;
    last_name: string | null;
    email: string;
    company: string | null;
    department: string | null;
    ticket_type: string | null;
    status: string;
    admitted_at: Date | null;
    custom_data: unknown;
    created_at: Date;
    client_timezone: string | null;
    updated_at: Date;
    rsvp_status: string;
    rsvp_updated_at: Date | null;
    rsvp_source: string | null;
    wallet_pass: {
      status: string;
      issued_at: Date | null;
      voided_at: Date | null;
      apple_url: string | null;
      android_url: string | null;
      last_synced_at: Date | null;
      last_error_code: string | null;
      apple_active_registrations: number | null;
      apple_inactive_registrations: number | null;
      google_active_registrations: number | null;
      google_inactive_registrations: number | null;
      first_downloaded_at: string | null;
      registration_checked_at: Date | null;
    } | null;
  },
  notesPage = 1,
): Promise<AttendeeDetailDto> {
  const [deliveriesResult, action_log, event_items, notes, walletLinks] = await Promise.all([
    listDeliveries({ eventId, filters: { attendeeId: row.id } }, db),
    loadAttendeeActionLogEntries(db, row.id),
    loadAttendeeItemsSummary(db, eventId, row.id),
    loadAttendeeNotes(db, eventId, row.id, notesPage),
    resolveAttendeeWalletLinksForDto(db, row.id),
  ]);
  const { company, department } = resolveCompanyDepartment(row);

  return {
    id: row.id,
    name: row.name,
    first_name: row.first_name,
    last_name: row.last_name,
    email: row.email,
    company,
    department,
    ticket_type: row.ticket_type,
    status: row.status as AttendeeStatus,
    check_in_status: checkInStatus(row.admitted_at),
    admitted_at: row.admitted_at ? row.admitted_at.toISOString() : null,
    created_at: row.created_at.toISOString(),
    client_timezone: row.client_timezone,
    updated_at: row.updated_at.toISOString(),
    rsvp_status: row.rsvp_status as RsvpStatus,
    rsvp_updated_at: row.rsvp_updated_at ? row.rsvp_updated_at.toISOString() : null,
    rsvp_source: row.rsvp_source,
    wallet_pass: row.wallet_pass ? serializeWalletPassAction(row.wallet_pass) : null,
    wallet_apple_link: walletLinks.apple,
    wallet_google_link: walletLinks.google,
    custom_data: row.custom_data ?? null,
    deliveries: deliveriesResult.items.map(toDeliveryDto),
    action_log,
    event_items,
    notes: notes.items,
    notes_total: notes.total,
    notes_page: notesPage,
    notes_page_size: ATTENDEE_NOTES_PAGE_SIZE,
  };
}

/** GET /api/admin/events/:eventId/attendees */
export async function handleListEventAttendees(c: Context, db: PrismaClient): Promise<Response> {
  const eventIdOrRes = requireEventId(c);
  if (eventIdOrRes instanceof Response) return eventIdOrRes;
  const eventId = eventIdOrRes;
  const forbidden = await assertEventManageAccess(c, db, eventId);
  if (forbidden) return forbidden;

  const { page, pageSize, q, status, ticket_type, rsvp_status, mail_status, sortBy, sortDir } = parseListQuery(c);

  const filterParams = { q, status, ticket_type, rsvp_status, mail_status };

  const [total, rows] = await Promise.all([
    countFilteredAttendees(db, eventId, filterParams),
    findFilteredAttendeesForList(db, eventId, filterParams, page, pageSize, sortBy, sortDir),
  ]);

  const attendeeIds = rows.map((r) => r.id);
  const [lastMail, issuedItems, walletStatus] = await Promise.all([
    lastMailStatusByAttendee(db, attendeeIds),
    issuedItemsAttendeeIds(db, attendeeIds),
    walletStatusByAttendee(db, attendeeIds),
  ]);

  c.header("Cache-Control", "no-store");
  return c.json({
    items: rows.map((r) => serializeAttendeeRow(r, lastMail, issuedItems, walletStatus)),
    total,
    page,
    pageSize,
  });
}

type ExportFormat = "xlsx" | "csv" | "pdf";

/** Shared by the filtered (GET) and explicit-selection (POST) export handlers: builds the
 * sanitized export rows, writes the bulk-action audit entry, and returns the file response for
 * whichever format was requested. */
async function buildExportFileResponse(
  db: PrismaClient,
  c: Context,
  eventId: string,
  rows: ExportAttendeeSqlRow[],
  format: ExportFormat,
  event: { title: string; date: Date; timezone: string },
  auditFilters:
    | { status: string; ticket_type?: string; mail_status?: string; has_query: boolean }
    | { selected_count: number },
): Promise<Response> {
  let artifact;
  try {
    artifact = await buildAttendeesExportArtifact(db, eventId, rows, format, event);
  } catch (err) {
    return c.json({ error: customDataErrorCode(err) }, 400);
  }

  await auditAttendeesExported(db, c, eventId, format, artifact.rowCount, auditFilters);
  return new Response(new Uint8Array(artifact.bytes), {
    headers: {
      "Content-Type": artifact.contentType,
      "Content-Disposition": attachmentContentDisposition(artifact.filename),
      "Cache-Control": "no-store",
      "Pragma": "no-cache",
    },
  });
}

/** GET /api/admin/events/:eventId/attendees/export — enqueue filtered export (202). */
export async function handleExportAttendees(c: Context, db: PrismaClient): Promise<Response> {
  const eventIdOrRes = requireEventId(c);
  if (eventIdOrRes instanceof Response) return eventIdOrRes;
  const eventId = eventIdOrRes;
  const forbidden = await assertEventManageAccess(c, db, eventId);
  if (forbidden) return forbidden;

  const formatRaw = c.req.query("format");
  if (formatRaw !== "xlsx" && formatRaw !== "csv" && formatRaw !== "pdf") {
    return c.json({ error: "format must be xlsx, csv, or pdf" }, 400);
  }
  const format = formatRaw;

  const { q, status, ticket_type, rsvp_status, mail_status } = parseListQuery(c);
  const filterParams = { q, status, ticket_type, rsvp_status, mail_status };

  const event = await db.event.findUnique({
    where: { id: eventId },
    select: { title: true, date: true, timezone: true, organization_id: true },
  });
  if (!event) {
    return c.json({ error: "not_found" }, 404);
  }

  const total = await countFilteredAttendees(db, eventId, filterParams);
  if (total > EXPORT_ROW_CAP) {
    return c.json({ error: "export_too_large", count: total, cap: EXPORT_ROW_CAP }, 400);
  }

  const audit = adminAuditFromContext(c);
  const job = await db.adminJob.create({
    data: {
      type: "export",
      status: "pending",
      organization_id: event.organization_id,
      event_id: eventId,
      actor_user_id: audit.operator ?? null,
      session_id: audit.sessionId ?? null,
      client_timezone: resolveClientTimezone(c),
      result_json: {
        request: {
          kind: "attendees_filtered",
          format,
          filters: filterParams,
        },
      },
    },
  });

  return c.json({ jobId: job.id, status: "pending", format, rowCount: total }, 202);
}

/** GET /api/admin/events/:eventId/export/jobs/:jobId */
export async function handleGetExportJob(c: Context, db: PrismaClient): Promise<Response> {
  const loaded = await loadEventAdminJob(c, db, "export");
  if (loaded instanceof Response) return loaded;
  const { job } = loaded;

  c.header("Cache-Control", "no-store");
  return c.json({
    jobId: job.id,
    status: job.status,
    error: job.error,
    filename: job.filename,
    rowCount: job.created_count,
    created_at: job.created_at.toISOString(),
    started_at: job.started_at ? job.started_at.toISOString() : null,
  });
}

/** GET /api/admin/events/:eventId/export/jobs/:jobId/download */
export async function handleDownloadExportJob(c: Context, db: PrismaClient): Promise<Response> {
  const loaded = await loadEventAdminJob(c, db, "export");
  if (loaded instanceof Response) return loaded;
  const { job } = loaded;
  if (job.status !== "succeeded" || !job.storage_key) return c.json({ error: "not_ready" }, 404);

  const { getDefaultStorage } = await import("@admitto/storage");
  const bytes = await getDefaultStorage().get(job.storage_key);
  const meta =
    job.result_json && typeof job.result_json === "object" && !Array.isArray(job.result_json)
      ? (job.result_json as Record<string, unknown>)
      : {};
  const contentType =
    typeof meta.contentType === "string" ? meta.contentType : "application/octet-stream";
  const filename = job.filename ?? "export.bin";

  return new Response(bytes, {
    headers: {
      "Content-Type": contentType,
      "Content-Disposition": attachmentContentDisposition(filename),
      "Cache-Control": "no-store",
      Pragma: "no-cache",
    },
  });
}

const exportSelectedBodySchema = z
  .object({
    attendee_ids: z.array(z.string()).min(1).max(BULK_SEND_LIMIT),
    format: z.enum(["xlsx", "csv", "pdf"]),
  })
  .strict();

/** POST /api/admin/events/:eventId/attendees/export-selected — CSV/XLSX/PDF of an explicit
 * subset of attendees (the bulk bar's "Export selected"), bypassing list filters entirely. A
 * POST with the ids in the JSON body, not a GET with them in the query string (Codex review,
 * #520): the default reverse-proxy access log records the full request URI, and this app's own
 * access log deliberately excludes query strings for exactly this reason (deploy/README.md) —
 * a GET here would have quietly reopened that same PII-adjacent leak one layer down. Capped at
 * the same BULK_SEND_LIMIT as every other bulk action now that the ids aren't URL-length
 * constrained. Ids that don't belong to this event are silently ignored (findSelectedAttendeesForExport),
 * same convention as bulk delete/check-in. */
export async function handleExportSelectedAttendees(c: Context, db: PrismaClient): Promise<Response> {
  const eventIdOrRes = requireEventId(c);
  if (eventIdOrRes instanceof Response) return eventIdOrRes;
  const eventId = eventIdOrRes;
  const forbidden = await assertEventManageAccess(c, db, eventId);
  if (forbidden) return forbidden;

  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: "invalid json" }, 400);
  }
  const parsed = exportSelectedBodySchema.safeParse(body);
  if (!parsed.success) return c.json({ error: "validation_failed" }, 400);
  const { attendee_ids: attendeeIds, format } = parsed.data;

  const event = await db.event.findUnique({
    where: { id: eventId },
    select: { title: true, date: true, timezone: true },
  });
  if (!event) {
    return c.json({ error: "not_found" }, 404);
  }

  const rows = await findSelectedAttendeesForExport(db, eventId, attendeeIds);
  return buildExportFileResponse(db, c, eventId, rows, format, event, {
    selected_count: attendeeIds.length,
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

  const notesPage = positiveIntQuery(c.req.query("notes_page"), 1, ATTENDEE_NOTES_MAX_PAGE);
  const dto = await buildAttendeeDetailDto(db, eventId, row, notesPage);
  c.header("Cache-Control", "no-store");
  return c.json(dto);
}

type PatchInput = z.infer<typeof patchAttendeeFieldsSchema>;

/** Fields whose before/after value is recorded verbatim in AttendeeActionLog.metadata -
 * see DATA-PROTECTION.md's "Admin audit trail" section for the full reasoning: this is a
 * deliberate accountability record (GDPR Art. 5(2)), not a routine log line, admin-only, and
 * cascade-deletes with the attendee (Prisma `onDelete: Cascade`) so erasure already covers it.
 * Deliberately excludes `name` and every custom_data field (dietary, accessibility, emergency
 * contact, and other free-text attributes an event might collect) - those can hold
 * special-category data (GDPR Art. 9) a guest typed into a form field, which this fixed list
 * is not meant to capture; an edit to any of those still shows only the field name (#364). */
const LOGGED_VALUE_FIELDS = new Set(["email", "company", "department", "ticket_type"]);

/** Diff a mirrored company/department field against custom_data and the legacy column, for
 * `computePatchChanges` below — pushes to `fields`/`valueChanges` (via `logValue`) and touches
 * custom_data only when the value actually changed. */
function applyMirroredScalarPatchField(
  field: "company" | "department",
  current: string | null,
  next: string | null | undefined,
  data: Prisma.AttendeeUncheckedUpdateInput,
  touchCustomData: () => Record<string, unknown>,
  fields: string[],
  logValue: (field: string, from: string | null, to: string | null) => void,
): void {
  if (next === undefined || next === current) return;
  if (field === "company") data.company = next;
  else data.department = next;
  const raw = touchCustomData();
  if (next === null || next === "") delete raw[field];
  else raw[field] = next;
  fields.push(field);
  logValue(field, current, next);
}

/** Diff each `custom_data_fields` entry in a PATCH against current custom_data, for
 * `computePatchChanges` below — mutates `fields` and lazily touches custom_data only for entries
 * that actually changed. */
function applyCustomDataFieldPatches(
  existingCustomData: unknown,
  patchFields: Record<string, string | null>,
  touchCustomData: () => Record<string, unknown>,
  fields: string[],
): void {
  for (const [sourceField, next] of Object.entries(patchFields)) {
    const current = customDataValue(existingCustomData, sourceField);
    const normalizedNext = next === null || next === "" ? null : next;
    if (normalizedNext === current) continue;
    const raw = touchCustomData();
    if (normalizedNext === null) {
      delete raw[sourceField];
    } else {
      raw[sourceField] = normalizedNext;
    }
    fields.push(sourceField);
  }
}

/** Diff first_name/last_name against existing values and rebuild `name` from the pair, for
 * `computePatchChanges` below — mutates `data`/`fields` only when a component actually changed
 * (SonarCloud S3776: keeps this out of computePatchChanges's cognitive-complexity count). */
function applyNamePatchFields(
  existing: { first_name: string | null; last_name: string | null },
  patch: { first_name?: string; last_name?: string },
  data: Prisma.AttendeeUncheckedUpdateInput,
  fields: string[],
): void {
  if (patch.first_name === undefined && patch.last_name === undefined) return;
  const nextFirstName = patch.first_name ?? existing.first_name;
  const nextLastName = patch.last_name ?? existing.last_name;
  const firstNameChanged = nextFirstName !== existing.first_name;
  const lastNameChanged = nextLastName !== existing.last_name;
  if (!firstNameChanged && !lastNameChanged) return;
  data.first_name = nextFirstName;
  data.last_name = nextLastName;
  data.name = [nextFirstName, nextLastName].filter(Boolean).join(" ");
  if (firstNameChanged) fields.push("first_name");
  if (lastNameChanged) fields.push("last_name");
}

/** Compute Prisma update payload, changed field names, and before/after values (for
 * LOGGED_VALUE_FIELDS only) from a PATCH body. */
function computePatchChanges(
  existing: {
    name: string;
    first_name: string | null;
    last_name: string | null;
    email: string;
    company: string | null;
    department: string | null;
    ticket_type: string | null;
    custom_data: unknown;
  },
  patch: PatchInput,
): {
  data: Prisma.AttendeeUncheckedUpdateInput;
  fields: string[];
  valueChanges: Record<string, { from: string | null; to: string | null }>;
} | null {
  const fields: string[] = [];
  const valueChanges: Record<string, { from: string | null; to: string | null }> = {};
  const logValue = (field: string, from: string | null, to: string | null) => {
    if (LOGGED_VALUE_FIELDS.has(field)) valueChanges[field] = { from, to };
  };
  // Unchecked: ticket_type is now also a scalar FK column for the (event_id, ticket_type)
  // relation to TicketType, so Prisma's relation-aware AttendeeUpdateInput no longer exposes it
  // as a plain settable field - this function only ever sets raw scalar columns directly (never
  // touches the relation object itself), matching the Unchecked variant's intended use.
  const data: Prisma.AttendeeUncheckedUpdateInput = {};
  const resolved = resolveCompanyDepartment(existing);
  let customData: Record<string, unknown> | null = null;

  const touchCustomData = (): Record<string, unknown> => {
    customData ??= cloneCustomData(existing.custom_data);
    return customData;
  };

  applyNamePatchFields(existing, patch, data, fields);
  if (patch.email !== undefined && patch.email !== existing.email) {
    data.email = patch.email;
    fields.push("email");
    logValue("email", existing.email, patch.email);
  }
  applyMirroredScalarPatchField(
    "company",
    resolved.company,
    patch.company,
    data,
    touchCustomData,
    fields,
    logValue,
  );
  applyMirroredScalarPatchField(
    "department",
    resolved.department,
    patch.department,
    data,
    touchCustomData,
    fields,
    logValue,
  );
  if (patch.ticket_type !== undefined && patch.ticket_type !== existing.ticket_type) {
    data.ticket_type = patch.ticket_type;
    fields.push("ticket_type");
    logValue("ticket_type", existing.ticket_type, patch.ticket_type);
  }
  if (patch.custom_data_fields) {
    applyCustomDataFieldPatches(existing.custom_data, patch.custom_data_fields, touchCustomData, fields);
  }

  if (customData) {
    data.custom_data = customData as Prisma.InputJsonValue;
  }

  if (fields.length === 0) return null;
  return { data, fields, valueChanges };
}


function computeRsvpChange(
  existingRsvp: string,
  patchRsvp: RsvpStatus | undefined,
): { data: Prisma.AttendeeUpdateInput; from: RsvpStatus; to: RsvpStatus } | null {
  if (patchRsvp === undefined || patchRsvp === existingRsvp) return null;
  return {
    data: {
      rsvp_status: patchRsvp,
      rsvp_updated_at: new Date(),
      rsvp_source: "admin",
    },
    from: existingRsvp as RsvpStatus,
    to: patchRsvp,
  };
}

function customDataErrorCode(err: unknown): string {
  const message = err instanceof Error ? err.message : "";
  if (message.startsWith("unknown_custom_data_field:")) return "unknown_custom_data_field";
  if (message.startsWith("required_custom_data_field_missing:")) {
    return "required_custom_data_field_missing";
  }
  return "validation_failed";
}

/** Validates ticket_type against the event's live catalog (batch 04 / #351) - shared by create
 * and patch. An empty/falsy value (including "" once normalized by the caller) is treated as "no
 * type" rather than an invalid catalog value. Accepts `tx` as well as the bare client so callers
 * can run this inside the same transaction that holds acquireEventTicketTypesLock (TOCTOU fix,
 * code review) - validating on the bare `db` before a transaction opened let a concurrent
 * ticket-type DELETE's in-use recheck pass (it couldn't see this write yet) and remove the type
 * this row was about to reference. */
async function validateTicketTypeCatalog(
  db: PrismaClient | Prisma.TransactionClient,
  eventId: string,
  ticketType: string | null | undefined,
): Promise<{ error: string } | null> {
  if (!ticketType) return null;
  try {
    assertTicketTypeInCatalog(await loadEventTicketTypes(db, eventId), ticketType);
    return null;
  } catch (err) {
    if (err instanceof UnknownTicketTypeError) return { error: "unknown_ticket_type" };
    throw err;
  }
}

/** Parses and validates the required `expected_updated_at` CAS token — extracted guard clause
 * from `handlePatchEventAttendee`. */
function parseExpectedUpdatedAt(raw: string | undefined): Date | { error: string } {
  if (!raw) return { error: "validation_failed" };
  const parsed = new Date(raw);
  if (Number.isNaN(parsed.getTime())) return { error: "validation_failed" };
  return parsed;
}

type PatchAttendeeStatusChange = "registered" | "revoked" | undefined;

function computeStatusChange(
  existingStatus: string,
  patchStatus: PatchAttendeeStatusChange,
): PatchAttendeeStatusChange {
  if (patchStatus === undefined || patchStatus === existingStatus) return undefined;
  return patchStatus;
}

/** Validates `profilePatch.custom_data_fields` against the event's configured fields and
 * normalizes an explicit "" ticket_type to null (clears the type instead of silently bypassing
 * catalog validation, CodeRabbit review) — extracted guard clause from
 * `handlePatchEventAttendee`. Mutates `profilePatch` in place; returns an error payload for the
 * caller to respond with, or null. The actual catalog-membership check (batch 04 / #351) happens
 * inside the PATCH transaction, under the same advisory lock ticket-type DELETE uses (TOCTOU
 * fix, code review) - see the comment there. */
async function validateAndNormalizeProfilePatch(
  existing: { custom_data: unknown; first_name: string | null; last_name: string | null },
  profilePatch: Omit<PatchInput, "rsvp_status" | "status">,
  loadAllowedFieldsOnce: () => Promise<EventItemContent[]>,
): Promise<{ error: string } | null> {
  // A legacy attendee (both split fields still null, pre-dating this migration) only has its
  // full name in `name`. Patching just one of first_name/last_name would derive the other half
  // from null and silently drop the rest of the name from `name` (Codex review, PR790) - require
  // both together until the record has been migrated to real split fields.
  const suppliesFirstName = profilePatch.first_name !== undefined;
  const suppliesLastName = profilePatch.last_name !== undefined;
  if (
    suppliesFirstName !== suppliesLastName &&
    (existing.first_name === null || existing.last_name === null)
  ) {
    return { error: "legacy_name_requires_both_fields" };
  }

  if (profilePatch.custom_data_fields) {
    try {
      profilePatch.custom_data_fields = validateCustomDataPatch(
        await loadAllowedFieldsOnce(),
        existing.custom_data,
        profilePatch.custom_data_fields,
      );
    } catch (err) {
      return { error: customDataErrorCode(err) };
    }
  }

  if (profilePatch.ticket_type === "") {
    profilePatch.ticket_type = null;
  }

  return null;
}

/** When profile fields or RSVP status changed, re-validates the resulting custom_data against
 * the event's required-field configuration — extracted guard clause from
 * `handlePatchEventAttendee`. No-ops when neither changed, or when the event has no configured
 * fields at all. */
async function assertPatchCustomDataRequirements(
  existing: { custom_data: unknown },
  profileChanges: ReturnType<typeof computePatchChanges>,
  rsvpChange: ReturnType<typeof computeRsvpChange>,
  loadAllowedFieldsOnce: () => Promise<EventItemContent[]>,
): Promise<{ error: string } | null> {
  if (!profileChanges && !rsvpChange) return null;

  let fields: EventItemContent[];
  try {
    fields = await loadAllowedFieldsOnce();
  } catch (err) {
    return { error: customDataErrorCode(err) };
  }
  if (fields.length === 0) return null;

  try {
    const nextCustomData =
      profileChanges?.data.custom_data !== undefined
        ? profileChanges.data.custom_data
        : existing.custom_data;
    assertCustomDataMeetsRequirements(fields, nextCustomData);
    return null;
  } catch (err) {
    return { error: customDataErrorCode(err) };
  }
}

/** Merges the resolved profile/RSVP/status changes into a single Prisma update payload. */
function buildPatchUpdateData(
  profileChanges: ReturnType<typeof computePatchChanges>,
  rsvpChange: ReturnType<typeof computeRsvpChange>,
  statusChange: PatchAttendeeStatusChange,
): Prisma.AttendeeUpdateInput {
  return {
    ...profileChanges?.data,
    ...rsvpChange?.data,
    ...(statusChange !== undefined ? { status: statusChange } : {}),
  };
}

/** Catalog membership check (batch 04 / #351), re-validated here (not on the bare `db` before
 * the transaction opened) and locked against a concurrent ticket-type DELETE (TOCTOU fix, code
 * review) - same rationale as handleCreateEventAttendee. Only taken when ticket_type is actually
 * changing to a new, non-empty value: computePatchChanges already excludes it from `fields` when
 * the patch leaves it untouched or resubmits the same value, and clearing it to null can't
 * orphan a reference, so neither case needs the lock. Throws the 400 Response for the
 * transaction's catch to surface. */
async function guardPatchTicketTypeChange(
  c: Context,
  tx: Prisma.TransactionClient,
  eventId: string,
  profileChanges: ReturnType<typeof computePatchChanges>,
  nextTicketType: string | null | undefined,
): Promise<void> {
  if (!profileChanges?.fields.includes("ticket_type") || !nextTicketType) return;
  await acquireEventTicketTypesLock(tx, eventId);
  const ticketTypeError = await validateTicketTypeCatalog(tx, eventId, nextTicketType);
  if (ticketTypeError) throw c.json(ticketTypeError, 400);
}

/** Re-checks event capacity when a PATCH restores a previously non-admittable attendee to an
 * admittable status (capacity_reactivation), under the same advisory lock the create/check-in
 * paths use — returns the forced-admit detail for the audit log, or undefined when nothing
 * needed forcing (or no restore happened at all). Throws the capacity Response for the
 * transaction's catch to surface. */
async function guardPatchCapacityRestore(
  c: Context,
  tx: Prisma.TransactionClient,
  eventId: string,
  existingStatus: string,
  statusChange: PatchAttendeeStatusChange,
): Promise<{ forced: true; capacity: number; current: number } | undefined> {
  if (!isCapacityReactivation(existingStatus, statusChange)) return undefined;
  await acquireEventCapacityLock(tx, eventId);
  const capacityResult = await assertEventCapacityForIncoming(c, tx, eventId, 1);
  if (capacityResult instanceof Response) throw capacityResult;
  if (capacityResult && "forced" in capacityResult) return capacityResult;
  return undefined;
}

/** Any transition to a non-admittable status must not leave a stale admission behind —
 * restoring the pass later would otherwise resurrect a "checked in" state from before the
 * revoke without a new scan ever happening (PO review). isAdmittable() rather than a literal
 * "revoked" check so this still holds if the status enum this route accepts ever widens to
 * include "cancelled" (already a first-class AttendeeStatus, just not settable here yet).
 * `existingAdmittedAt` was read before the transaction started, so a concurrent request
 * (operator undo, another admin's revoke-check-in) may have already cleared it —
 * revokeCheckInMutation throws in that case; that's fine, there's nothing left to revoke, but it
 * must not abort the status change itself (bugbot). Uses the mutation-only helper (not
 * revokeCheckInTx) since this side-effect path builds its own response DTO and would otherwise
 * pay for an unused AttendeeCardDto build (event items, item states, notes, authors). Mutates
 * `result.row` in place so the caller's response DTO reflects the fresh admitted_at/updated_at. */
async function clearAdmissionOnNonAdmittableTransition(
  c: Context,
  tx: Prisma.TransactionClient,
  eventId: string,
  attendeeId: string,
  statusChange: PatchAttendeeStatusChange,
  existingAdmittedAt: Date | null,
  result: { row: { admitted_at: Date | null; updated_at: Date } },
): Promise<void> {
  if (statusChange === undefined || isAdmittable(statusChange) || !existingAdmittedAt) return;
  try {
    await revokeCheckInMutation({ eventId, attendeeId, audit: adminAuditFromContext(c) }, tx);
    // result.row was read before the clear above, and the mutation's own attendee update bumps
    // updated_at again (Attendee.updated_at is @updatedAt) — re-read both so the response DTO's
    // expected_updated_at stays valid for the client's next edit.
    const fresh = await tx.attendee.findUniqueOrThrow({
      where: { id: attendeeId },
      select: { admitted_at: true, updated_at: true },
    });
    result.row.admitted_at = fresh.admitted_at;
    result.row.updated_at = fresh.updated_at;
  } catch (err) {
    if (!(err instanceof UndoNotAllowedError)) throw err;
  }
}

/** Core PATCH transaction body: re-validates ticket_type/capacity under their advisory locks,
 * applies the CAS update, clears a stale admission on a non-admittable transition, and writes
 * one action-log entry per kind of change that actually happened. Extracted out of
 * `handlePatchEventAttendee` (as a plain named function, not an inline callback) so its own
 * Cognitive Complexity stays within limits. */
async function runPatchAttendeeTransaction(
  tx: Prisma.TransactionClient,
  ctx: {
    c: Context;
    eventId: string;
    attendeeId: string;
    existing: { status: string; admitted_at: Date | null };
    profileChanges: ReturnType<typeof computePatchChanges>;
    profilePatchTicketType: string | null | undefined;
    rsvpChange: ReturnType<typeof computeRsvpChange>;
    statusChange: PatchAttendeeStatusChange;
    expectedUpdatedAt: Date;
    updateData: Prisma.AttendeeUpdateInput;
  },
): Promise<Prisma.AttendeeGetPayload<{ select: typeof ATTENDEE_DETAIL_SELECT }>> {
  const {
    c,
    eventId,
    attendeeId,
    existing,
    profileChanges,
    profilePatchTicketType,
    rsvpChange,
    statusChange,
    expectedUpdatedAt,
    updateData,
  } = ctx;

  await guardPatchTicketTypeChange(c, tx, eventId, profileChanges, profilePatchTicketType);

  const restoreCapacityForced = await guardPatchCapacityRestore(
    c,
    tx,
    eventId,
    existing.status,
    statusChange,
  );

  const result = await optimisticAttendeeUpdate(tx, {
    id: attendeeId,
    expectedUpdatedAt,
    data: updateData,
    select: ATTENDEE_DETAIL_SELECT,
  });

  if (isStaleWrite(result)) throw new StaleWriteError();

  await clearAdmissionOnNonAdmittableTransition(
    c,
    tx,
    eventId,
    attendeeId,
    statusChange,
    existing.admitted_at,
    result,
  );

  if (rsvpChange) {
    await writeActionLog(tx, {
      event_id: eventId,
      attendee_id: attendeeId,
      action_type: "rsvp_status_changed",
      audit: adminAuditFromContext(c),
      metadata: {
        from: rsvpChange.from,
        to: rsvpChange.to,
        source: "admin",
      },
    });
  }

  if (profileChanges) {
    await writeActionLog(tx, {
      event_id: eventId,
      attendee_id: attendeeId,
      action_type: "attendee_edited",
      audit: adminAuditFromContext(c),
      metadata: { fields: profileChanges.fields, field_changes: profileChanges.valueChanges },
    });
  }

  if (statusChange !== undefined) {
    await writeActionLog(tx, {
      event_id: eventId,
      attendee_id: attendeeId,
      action_type: statusChange === "revoked" ? "pass_revoked" : "pass_restored",
      audit: adminAuditFromContext(c),
      metadata: {
        previous_status: existing.status,
        ...(restoreCapacityForced
          ? {
              forced: true,
              capacity: restoreCapacityForced.capacity,
              current: restoreCapacityForced.current,
            }
          : {}),
      },
    });
  }

  return result.row;
}

/** Maps a thrown error from the PATCH transaction to its HTTP response — extracted from
 * `handlePatchEventAttendee`'s catch block. */
function patchAttendeeErrorResponse(c: Context, err: unknown): Response {
  if (err instanceof Response) return err;
  if (err instanceof StaleWriteError) {
    return c.json({ error: "stale_write" }, 409);
  }
  if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
    return c.json({ error: "email_conflict" }, 409);
  }
  console.error("handlePatchEventAttendee failed:", err);
  return c.json({ error: "server error" }, 500);
}

/** PATCH /api/admin/events/:eventId/attendees/:id */
export async function handlePatchEventAttendee(c: Context, db: PrismaClient): Promise<Response> {
  const attendeeContextOrRes = await requireManagedEventAttendee(c, db);
  if (attendeeContextOrRes instanceof Response) return attendeeContextOrRes;
  const { attendee: existing, attendeeId, eventId } = attendeeContextOrRes;

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

  const {
    expected_updated_at: expectedUpdatedAtRaw,
    rsvp_status: patchRsvp,
    status: patchStatus,
    ...profilePatch
  } = parsed.data;

  let allowedFields: EventItemContent[] | undefined;
  async function loadAllowedFieldsOnce(): Promise<EventItemContent[]> {
    allowedFields ??= await loadEventCustomDataFields(db, eventId);
    return allowedFields;
  }

  const profilePatchError = await validateAndNormalizeProfilePatch(existing, profilePatch, loadAllowedFieldsOnce);
  if (profilePatchError) return c.json(profilePatchError, 400);

  const profileChanges = computePatchChanges(existing, profilePatch);
  const rsvpChange = computeRsvpChange(existing.rsvp_status, patchRsvp);
  const statusChange = computeStatusChange(existing.status, patchStatus);

  if (!profileChanges && !rsvpChange && !statusChange) {
    const dto = await buildAttendeeDetailDto(db, eventId, existing);
    return c.json(dto);
  }

  const requirementsError = await assertPatchCustomDataRequirements(
    existing,
    profileChanges,
    rsvpChange,
    loadAllowedFieldsOnce,
  );
  if (requirementsError) return c.json(requirementsError, 400);

  const expectedUpdatedAtResult = parseExpectedUpdatedAt(expectedUpdatedAtRaw);
  if (!(expectedUpdatedAtResult instanceof Date)) return c.json(expectedUpdatedAtResult, 400);
  const expectedUpdatedAt = expectedUpdatedAtResult;

  const updateData = buildPatchUpdateData(profileChanges, rsvpChange, statusChange);

  try {
    const updated = await db.$transaction((tx) =>
      runPatchAttendeeTransaction(tx, {
        c,
        eventId,
        attendeeId,
        existing,
        profileChanges,
        profilePatchTicketType: profilePatch.ticket_type,
        rsvpChange,
        statusChange,
        expectedUpdatedAt,
        updateData,
      }),
    );

    if (statusChange !== undefined) {
      await syncWalletPassOnStatusChangeBestEffort(db, eventId, attendeeId, statusChange);
    }

    const dto = await buildAttendeeDetailDto(db, eventId, updated);
    return c.json(dto);
  } catch (err) {
    return patchAttendeeErrorResponse(c, err);
  }
}

/** Writes the central admin audit row (Instance Settings → Audit log) for an attendee lifecycle
 * event - factors out the actor/session/ip/timezone boilerplate shared by every call site below
 * (SonarCloud duplication). See the note on attendee_erased below for why these events need a
 * record outside the attendee's own (deletable) AttendeeActionLog trail. */
async function writeAttendeeLifecycleAuditLog(
  tx: Prisma.TransactionClient,
  c: Context,
  audit: OpsAuditContext,
  organizationId: string | null,
  actionType: string,
  metadata: Record<string, unknown>,
): Promise<void> {
  await writeAdminAuditLog(tx, {
    organizationId,
    actorUserId: audit.operator ?? c.get("auth").userId,
    sessionId: audit.sessionId,
    ip: audit.ip,
    timezone: audit.timezone,
    actionType,
    metadata,
  });
}

/** Best-effort GDPR erasure of the given attendees' wallet passes at the provider (e.g.
 * PassCreator). Runs ahead of the DB transaction below - an external network call has no place
 * inside a Prisma transaction - and never blocks attendee erasure: a provider failure here is
 * logged and local erasure proceeds regardless, same posture as the other best-effort external
 * calls in this file. The `attendee: { event_id: eventId }` relation filter keeps this correctly
 * scoped even before the caller's own event-ownership check has run - an id belonging to a
 * different event simply matches no row. No-op when wallet is unconfigured or none of the given
 * attendees has a WalletPass row with a known provider_pass_id yet. */
async function deleteWalletPassesBestEffort(
  db: PrismaClient,
  eventId: string,
  attendeeIds: readonly string[],
): Promise<void> {
  const [event, passes] = await Promise.all([
    db.event.findUnique({
      where: { id: eventId },
      select: {
        wallet_enabled: true,
        wallet_template_id: true,
        wallet_api_key_enc: true,
        wallet_field_mapping: true,
      },
    }),
    db.walletPass.findMany({
      where: {
        attendee_id: { in: attendeeIds as string[] },
        provider_pass_id: { not: null },
        attendee: { event_id: eventId },
      },
      select: { attendee_id: true, provider_pass_id: true },
    }),
  ]);
  if (!event || passes.length === 0) return;

  const provider = resolveWalletProvider({
    walletEnabled: event.wallet_enabled,
    walletTemplateId: event.wallet_template_id,
    walletApiKeyEnc: event.wallet_api_key_enc,
    walletFieldMapping: parseWalletFieldMapping(event.wallet_field_mapping),
  });
  if (!provider) return;

  for (const batch of chunk(passes, BULK_CHECKIN_CONCURRENCY)) {
    const settled = await Promise.allSettled(batch.map((pass) => provider.deletePass(pass.provider_pass_id!)));
    for (const [index, outcome] of settled.entries()) {
      if (outcome.status === "rejected") {
        console.error("wallet pass delete (erasure) failed:", outcome.reason);
        recordSystemLog({
          level: "error",
          source: "admin",
          message: "wallet_pass_erasure_delete_failed",
          fields: { eventId, attendeeId: batch[index]!.attendee_id },
        });
      }
    }
  }
}

/** Best-effort void/restore of an attendee's wallet pass at the provider to match a revoke/
 * restore of their Admitto pass status - previously these could drift apart (revoking someone's
 * pass on our side left their wallet pass showing as valid, PO review 2026-08-13). No-op when
 * wallet isn't configured, the attendee has no WalletPass row, or the pass is already in the
 * target state (a bulk selection can include attendees a previous action already touched). Runs
 * after the caller's own DB transaction has committed - an external network call has no place
 * inside one, same posture as deleteWalletPassesBestEffort above. */
async function syncWalletPassOnStatusChangeBestEffort(
  db: PrismaClient,
  eventId: string,
  attendeeId: string,
  statusChange: "revoked" | "registered",
): Promise<void> {
  const [event, walletPass] = await Promise.all([
    db.event.findUnique({
      where: { id: eventId },
      select: { wallet_enabled: true, wallet_template_id: true, wallet_api_key_enc: true },
    }),
    db.walletPass.findUnique({
      where: { attendee_id: attendeeId },
      select: { provider_pass_id: true, status: true },
    }),
  ]);
  if (!event || !walletPass?.provider_pass_id) return;
  if (statusChange === "revoked" && walletPass.status !== "active") return;
  if (statusChange === "registered" && walletPass.status !== "voided") return;

  const provider = resolveWalletProvider({
    walletEnabled: event.wallet_enabled,
    walletTemplateId: event.wallet_template_id,
    walletApiKeyEnc: event.wallet_api_key_enc,
    walletFieldMapping: null,
  });
  if (!provider) return;

  try {
    if (statusChange === "revoked") {
      await provider.voidPass(walletPass.provider_pass_id);
      await db.walletPass.update({
        where: { attendee_id: attendeeId },
        data: { status: "voided", voided_at: new Date(), last_error_code: null },
      });
    } else {
      await provider.restorePass(walletPass.provider_pass_id);
      await db.walletPass.update({
        where: { attendee_id: attendeeId },
        data: { status: "active", voided_at: null, last_error_code: null },
      });
    }
  } catch (err) {
    console.error(`wallet pass ${statusChange} cascade failed:`, err);
    recordSystemLog({
      level: "error",
      source: "admin",
      message: "wallet_pass_status_cascade_failed",
      fields: { eventId, attendeeId, statusChange },
    });
  }
}

/** DELETE /api/admin/events/:eventId/attendees/:id — GDPR erasure path. */
export async function handleDeleteEventAttendee(c: Context, db: PrismaClient): Promise<Response> {
  const eventIdOrRes = requireEventId(c);
  if (eventIdOrRes instanceof Response) return eventIdOrRes;
  const eventId = eventIdOrRes;
  const attendeeIdOrRes = requireAttendeeId(c);
  if (attendeeIdOrRes instanceof Response) return attendeeIdOrRes;
  const attendeeId = attendeeIdOrRes;

  const forbidden = await assertEventManageAccess(c, db, eventId);
  if (forbidden) return forbidden;

  await deleteWalletPassesBestEffort(db, eventId, [attendeeId]);

  const result = await db.$transaction(async (tx) => {
    const existing = await tx.attendee.findUnique({
      where: { id: attendeeId },
      select: {
        event_id: true,
        name: true,
        email: true,
        event: { select: { organization_id: true, title: true } },
      },
    });
    if (!existing || existing.event_id !== eventId) return "forbidden" as const;

    const [emailDeliveries, walletPasses, checkIns] = await Promise.all([
      tx.emailDelivery.deleteMany({ where: { event_id: eventId, attendee_id: attendeeId } }),
      tx.walletPass.deleteMany({ where: { attendee_id: attendeeId } }),
      tx.checkIn.deleteMany({ where: { event_id: eventId, attendee_id: attendeeId } }),
    ]);

    const attendeeDelete = await tx.attendee.deleteMany({ where: { id: attendeeId, event_id: eventId } });
    if (attendeeDelete.count === 0) return "gone" as const;

    const audit = adminAuditFromContext(c);
    await writeBulkActionLog(tx, {
      event_id: eventId,
      action_type: "attendee_erased",
      audit,
      metadata: {
        attendee_id: attendeeId,
        removed: {
          email_deliveries: emailDeliveries.count,
          wallet_passes: walletPasses.count,
          check_ins: checkIns.count,
        },
      },
    });
    // Also written to the central admin audit log (Instance Settings → Audit log) - the
    // attendee's own AttendeeActionLog trail disappears along with the row it's about (PO
    // review: no central record of who erased an attendee, unlike event/user/session actions).
    // Deliberately includes the erased attendee's name/email here, unlike
    // writeBulkActionLog's own erasure entry above - a superadmin-only security/incident
    // record needs to answer "who was deleted" (e.g. a compromised admin account mass-erasing
    // attendees) to meet GDPR Art. 33/34 breach-notification duties, which is impossible if
    // the identity is gone from every table. Lawful basis: Art. 6(1)(f) legitimate interest
    // (security monitoring), scoped to this one admin-only log - not the erasure action itself.
    await writeAttendeeLifecycleAuditLog(tx, c, audit, existing.event.organization_id, "attendee_erased", {
      event_id: eventId,
      event_title: existing.event.title,
      attendee_id: attendeeId,
      attendee_name: existing.name,
      attendee_email: existing.email,
    });
    return "deleted" as const;
  });

  if (result === "forbidden") return c.json({ error: "forbidden" }, 403);
  return c.body(null, 204);
}

const bulkDeleteAttendeesBodySchema = z
  .object({
    attendeeIds: z.array(z.string()).min(1).max(BULK_SEND_LIMIT),
  })
  .strict();

/** POST /api/admin/events/:eventId/attendees/bulk-delete — GDPR erasure for a selection of
 * attendees at once, from the Attendees list's row-selection bulk bar. Same per-attendee
 * cleanup and audit trail as the single-attendee DELETE above, just batched; ids that don't
 * belong to this event are silently ignored rather than failing the whole request (the UI can
 * only ever select rows already scoped to the current event's current page). */
export async function handleBulkDeleteEventAttendees(c: Context, db: PrismaClient): Promise<Response> {
  const eventIdOrRes = requireEventId(c);
  if (eventIdOrRes instanceof Response) return eventIdOrRes;
  const eventId = eventIdOrRes;

  const forbidden = await assertEventManageAccess(c, db, eventId);
  if (forbidden) return forbidden;

  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: "invalid json" }, 400);
  }
  const parsed = bulkDeleteAttendeesBodySchema.safeParse(body);
  if (!parsed.success) return c.json({ error: "validation_failed" }, 400);

  await deleteWalletPassesBestEffort(db, eventId, parsed.data.attendeeIds);

  const deletedCount = await db.$transaction(async (tx) => {
    const owned = await tx.attendee.findMany({
      where: { id: { in: parsed.data.attendeeIds }, event_id: eventId },
      select: { id: true, name: true, email: true },
    });
    if (owned.length === 0) return 0;
    const ids = owned.map((a) => a.id);

    const [emailDeliveries, walletPasses, checkIns] = await Promise.all([
      tx.emailDelivery.deleteMany({ where: { event_id: eventId, attendee_id: { in: ids } } }),
      tx.walletPass.deleteMany({ where: { attendee_id: { in: ids } } }),
      tx.checkIn.deleteMany({ where: { event_id: eventId, attendee_id: { in: ids } } }),
    ]);

    // Raw DELETE ... RETURNING instead of deleteMany: a concurrent request can erase an
    // overlapping attendee between the findMany above and this statement, and deleteMany only
    // reports a count, not which rows it actually removed. RETURNING captures exactly what this
    // statement deleted, so the audit entries below can't over-report who this request erased
    // (CodeRabbit review).
    const deleted = await tx.$queryRaw<{ id: string; name: string; email: string }[]>`
      DELETE FROM "Attendee" WHERE id IN (${Prisma.join(ids)}) AND event_id = ${eventId}
      RETURNING id, name, email
    `;
    if (deleted.length === 0) return 0;

    const audit = adminAuditFromContext(c);
    await writeBulkActionLog(tx, {
      event_id: eventId,
      action_type: "attendees_bulk_erased",
      audit,
      metadata: {
        attendee_ids: deleted.map((a) => a.id),
        removed: {
          email_deliveries: emailDeliveries.count,
          wallet_passes: walletPasses.count,
          check_ins: checkIns.count,
        },
      },
    });
    const event = await tx.event.findUnique({ where: { id: eventId }, select: { organization_id: true, title: true } });
    // See the matching note on attendee_erased above - name/email are deliberately included in
    // this one central, superadmin-only log (not the erasure action's own AttendeeActionLog
    // entry) so a security incident affecting multiple attendees at once is investigable.
    await writeAttendeeLifecycleAuditLog(
      tx,
      c,
      audit,
      event?.organization_id ?? null,
      "attendees_bulk_erased",
      {
        event_id: eventId,
        event_title: event?.title,
        count: deleted.length,
        attendees: deleted.map((a) => ({ id: a.id, name: a.name, email: a.email })),
      },
    );
    return deleted.length;
  });

  return c.json({ deletedCount });
}

/** One row's computed bulk write, shared by every "assign one field to every selected
 * attendee" endpoint below: the value this row held for the field being changed *before* this
 * request — the per-row CAS key `applyBulkAttendeeChanges` re-validates at write time, so a
 * concurrent edit (e.g. the single-attendee PATCH) that changes it first isn't silently
 * clobbered and doesn't get a log entry recording a "from" value the row no longer actually
 * held (code review, PR #569) — and the audit-log metadata to record for it. `null` means the
 * row is already at the target value. */
type BulkFieldChange = { oldValue: string | null; metadata: Record<string, unknown> };

function computeTicketTypeChange(existingTicketType: string | null, target: string): BulkFieldChange | null {
  if (existingTicketType === target) return null;
  return {
    oldValue: existingTicketType,
    metadata: { fields: ["ticket_type"], field_changes: { ticket_type: { from: existingTicketType, to: target } } },
  };
}

/** Diffs already-fetched owned rows against a target, writes only the ones that actually
 * change, logs one entry per changed row, and reports updated/already-set/conflict counts for
 * the bulk bar's toast — the part of a "plain bulk field write" endpoint that's genuinely
 * identical regardless of which field is being assigned (bot review: bulk-ticket-type and
 * bulk-rsvp had independently duplicated this whole tail end). The write itself is a single
 * per-row-conditional `UPDATE ... FROM (VALUES ...)` statement, not a blanket `id IN (...)`
 * updateMany: one round trip regardless of selection size (up to BULK_SEND_LIMIT), keyed on
 * each row's own `oldValue` above, so a row a concurrent write changes in the window between
 * the caller's findMany and this statement is left untouched instead of overwritten (code
 * review, PR #569) — mirrors handleBulkDeleteEventAttendees's raw DELETE ... RETURNING above for
 * the same "report exactly which rows this statement actually touched" reason. Each caller still
 * does its own findMany (own select) and any pre-transaction validation/locking (e.g. the
 * ticket-type catalog lock) before calling this, and supplies the SET clause and target column
 * for its own field (`write` below) since those genuinely differ per caller. */
async function applyBulkAttendeeChanges<Row extends { id: string }>(
  tx: Prisma.TransactionClient,
  eventId: string,
  owned: Row[],
  computeChange: (row: Row) => BulkFieldChange | null,
  actionType: string,
  audit: OpsAuditContext,
  write: {
    /** Quoted column identifier the per-row CAS re-validates, e.g. `Prisma.raw('"ticket_type"')`. */
    column: Prisma.Sql;
    setClause: Prisma.Sql;
  },
): Promise<{ updatedCount: number; alreadySetCount: number; conflictCount: number }> {
  const changes: Array<{ id: string; oldValue: string | null; metadata: Record<string, unknown> }> = [];
  for (const row of owned) {
    const change = computeChange(row);
    if (change) changes.push({ id: row.id, oldValue: change.oldValue, metadata: change.metadata });
  }
  if (changes.length === 0) {
    return { updatedCount: 0, alreadySetCount: owned.length, conflictCount: 0 };
  }

  const values = Prisma.join(changes.map((x) => Prisma.sql`(${x.id}::text, ${x.oldValue}::text)`));
  // IS NOT DISTINCT FROM (not =) — a null-safe equality that correlates a NULL oldValue
  // correctly (a plain `=` never matches NULL = NULL) and behaves identically to `=` for a
  // non-nullable column, so there's no separate flag to get wrong per caller (bot review: a
  // caller could otherwise pass the wrong nullability for its own column and silently miscount).
  const updated = await tx.$queryRaw<{ id: string }[]>`
    UPDATE "Attendee" AS t
    SET ${write.setClause}
    FROM (VALUES ${values}) AS v(id, old_value)
    WHERE t.id = v.id AND t.event_id = ${eventId} AND t.${write.column} IS NOT DISTINCT FROM v.old_value
    RETURNING t.id
  `;
  const updatedIds = new Set(updated.map((r) => r.id));
  const succeeded = changes.filter((x) => updatedIds.has(x.id));

  // Only for rows the CAS above actually touched — a row that lost the race never got this
  // write, so logging it here would fabricate a "from" value the row didn't hold at write time.
  if (succeeded.length > 0) {
    await writeActionLogMany(tx, {
      event_id: eventId,
      action_type: actionType,
      audit,
      entries: succeeded.map((x) => ({ attendee_id: x.id, metadata: x.metadata })),
    });
  }

  return {
    updatedCount: succeeded.length,
    alreadySetCount: owned.length - changes.length,
    conflictCount: changes.length - succeeded.length,
  };
}

const bulkTicketTypeBodySchema = z
  .object({
    attendeeIds: z.array(z.string()).min(1).max(BULK_SEND_LIMIT),
    ticket_type: z.string().trim().min(1).max(100),
  })
  .strict();

/** POST /api/admin/events/:eventId/attendees/bulk-ticket-type — assign one catalog ticket type
 * to every selected attendee at once, from the Attendees list's row-selection bulk bar. No
 * expected_updated_at from the client (unlike the single-attendee PATCH) — the list reloads
 * after the action and re-applying the same type is harmless — but `applyBulkAttendeeChanges`'s
 * write is still a per-row CAS on the exact ticket_type value read below, not a blanket write:
 * see its own doc comment. Ids that don't belong to this event are silently ignored, matching
 * bulk delete/check-in. Catalog membership is validated once inside the transaction, under the
 * same advisory lock ticket-type DELETE takes (TOCTOU — same rationale as the single-attendee
 * PATCH), so the picked type can't be deleted out from under the write between the picker
 * opening and submit. Rows that already have the target type are left untouched (no updated_at
 * bump, no log entry) and reported back as alreadySetCount; rows that lost the race against a
 * concurrent write are also left untouched and reported back as conflictCount, both for the
 * toast breakdown. */
export async function handleBulkTicketTypeEventAttendees(
  c: Context,
  db: PrismaClient,
): Promise<Response> {
  const eventIdOrRes = requireEventId(c);
  if (eventIdOrRes instanceof Response) return eventIdOrRes;
  const eventId = eventIdOrRes;

  const forbidden = await assertEventManageAccess(c, db, eventId);
  if (forbidden) return forbidden;

  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: "invalid json" }, 400);
  }
  const parsed = bulkTicketTypeBodySchema.safeParse(body);
  if (!parsed.success) return c.json({ error: "validation_failed" }, 400);
  const { attendeeIds, ticket_type } = parsed.data;

  try {
    const counts = await db.$transaction(async (tx) => {
      await acquireEventTicketTypesLock(tx, eventId);
      const ticketTypeError = await validateTicketTypeCatalog(tx, eventId, ticket_type);
      if (ticketTypeError) throw c.json(ticketTypeError, 400);

      const owned = await tx.attendee.findMany({
        where: { id: { in: attendeeIds }, event_id: eventId },
        select: { id: true, ticket_type: true },
      });
      return applyBulkAttendeeChanges(
        tx,
        eventId,
        owned,
        (a) => computeTicketTypeChange(a.ticket_type, ticket_type),
        "attendee_edited",
        adminAuditFromContext(c),
        {
          column: Prisma.raw('"ticket_type"'),
          setClause: Prisma.sql`ticket_type = ${ticket_type}, updated_at = NOW()`,
        },
      );
    });

    return c.json(counts);
  } catch (err) {
    if (err instanceof Response) return err;
    console.error("handleBulkTicketTypeEventAttendees failed:", err);
    return c.json({ error: "server error" }, 500);
  }
}

const bulkRsvpBodySchema = z
  .object({
    attendeeIds: z.array(z.string()).min(1).max(BULK_SEND_LIMIT),
    rsvp_status: rsvpStatusSchema,
  })
  .strict();

/** POST /api/admin/events/:eventId/attendees/bulk-rsvp — set the attendance (RSVP) status for
 * every selected attendee at once, from the Attendees list's row-selection bulk bar. Same
 * per-row-CAS write shape as bulk-ticket-type above (see `applyBulkAttendeeChanges`'s doc
 * comment for the full rationale), minus the catalog/advisory-lock step — RSVP status is a
 * fixed enum, not a per-event catalog, so there's nothing that can be deleted out from under the
 * write. Ids that don't belong to this event are silently ignored, matching every other bulk
 * action. Rows already at the target status are left untouched (no rsvp_updated_at bump, no log
 * entry) and reported back as alreadySetCount; rows that lost the race against a concurrent
 * write are also left untouched and reported back as conflictCount, both for the toast
 * breakdown. */
export async function handleBulkRsvpEventAttendees(
  c: Context,
  db: PrismaClient,
): Promise<Response> {
  const eventIdOrRes = requireEventId(c);
  if (eventIdOrRes instanceof Response) return eventIdOrRes;
  const eventId = eventIdOrRes;

  const forbidden = await assertEventManageAccess(c, db, eventId);
  if (forbidden) return forbidden;

  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: "invalid json" }, 400);
  }
  const parsed = bulkRsvpBodySchema.safeParse(body);
  if (!parsed.success) return c.json({ error: "validation_failed" }, 400);
  const { attendeeIds, rsvp_status } = parsed.data;

  try {
    const counts = await db.$transaction(async (tx) => {
      const owned = await tx.attendee.findMany({
        where: { id: { in: attendeeIds }, event_id: eventId },
        select: { id: true, rsvp_status: true },
      });
      // Reuses computeRsvpChange - the same "is this actually a change, what's the from/to for
      // the log entry" logic the single-attendee PATCH path uses - so the two paths can't
      // silently diverge (e.g. if rsvp_source is later derived per-actor there). Its own
      // `.data` isn't used here - the write below sets rsvp_updated_at/rsvp_source itself.
      return applyBulkAttendeeChanges(
        tx,
        eventId,
        owned,
        (a) => {
          const change = computeRsvpChange(a.rsvp_status, rsvp_status);
          return change && { oldValue: change.from, metadata: { from: change.from, to: change.to, source: "admin" } };
        },
        "rsvp_status_changed",
        adminAuditFromContext(c),
        {
          column: Prisma.raw('"rsvp_status"'),
          setClause: Prisma.sql`rsvp_status = ${rsvp_status}, rsvp_updated_at = NOW(), rsvp_source = 'admin', updated_at = NOW()`,
        },
      );
    });

    return c.json(counts);
  } catch (err) {
    if (err instanceof Response) return err;
    console.error("handleBulkRsvpEventAttendees failed:", err);
    recordBulkAttendeeActionFailure(c, eventId, "rsvp", { attendeeCount: attendeeIds.length });
    return c.json({ error: "server error" }, 500);
  }
}

const bulkCheckInAttendeesBodySchema = z
  .object({
    attendeeIds: z.array(z.string()).min(1).max(BULK_SEND_LIMIT),
  })
  .strict();

/**
 * How many attendees' own per-attendee transactions run concurrently within one chunk of a bulk
 * check-in *or* its bulk-revoke-checkin sibling below (shared, despite the name — the two bound
 * the same shape of per-attendee transaction fan-out, so a throughput change to one is a
 * throughput change to both; tune deliberately). Each attendee still gets its own
 * `admitAttendee`/`revokeCheckInMutation` transaction (unchanged); this only bounds how many of
 * those are in flight at once, matching `packages/tickets/src/bulk-revoke.ts`'s
 * BULK_REVOKE_CONCURRENCY for the same shape of per-attendee transaction fan-out.
 */
const BULK_CHECKIN_CONCURRENCY = 10;

type BulkAttendeeAction =
  | "rsvp"
  | "checkin"
  | "revoke_checkin"
  | "revoke_items"
  | "revoke_pass"
  | "wallet_void"
  | "wallet_reissue"
  | "wallet_delete";
type BulkFailureTarget = { attendeeId: string } | { attendeeCount: number };

/** Record a bounded failure signal for a staff-triggered bulk operation. The selected attendee
 * remains referable by its internal id, but arbitrary exception text and attendee PII do not. */
function recordBulkAttendeeActionFailure(
  c: Context,
  eventId: string,
  action: BulkAttendeeAction,
  target: BulkFailureTarget,
): void {
  const { userId: actorUserId, userEmail: actorEmail } = c.get("auth");
  recordSystemLog({
    level: "error",
    source: "admin",
    message: action === "rsvp" ? "bulk_rsvp_failed" : "bulk_attendee_action_failed",
    fields: {
      eventId,
      ...target,
      action,
      errorKind: "unexpected",
      actorUserId,
      ...(actorEmail ? { actorEmail } : {}),
    },
  });
}

/** Split an array into fixed-size chunks (last chunk may be smaller) — same helper as
 * `packages/tickets/src/bulk-revoke.ts`'s local `chunk`, duplicated here rather than shared
 * since it's a trivial, dependency-free six-liner and this file is in a different package. */
function chunk<T>(items: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < items.length; i += size) {
    chunks.push(items.slice(i, i + size));
  }
  return chunks;
}

/** Maps each admitAttendee outcome to its bulk check-in response counter. `satisfies` keeps the
 * map exhaustive: adding a new AdmitResult status fails the build here instead of silently
 * falling through. */
const BULK_CHECKIN_STATUS_COUNTER = {
  VALID: "checkedIn",
  ALREADY_CHECKED_IN: "alreadyCheckedIn",
  REVOKED: "revoked",
  INVALID: "invalid",
} as const satisfies Record<
  AdmitResult["status"],
  "checkedIn" | "alreadyCheckedIn" | "revoked" | "invalid"
>;

/** POST /api/admin/events/:eventId/attendees/bulk-checkin — manual check-in for a selection of
 * attendees at once, from the Attendees list's row-selection bulk bar. Reuses `admitAttendee`
 * (the same single-use CAS path scan check-in already goes through, ADR 0010 §4) once per
 * selected id rather than a bespoke bulk update, so every existing guarantee — CAS, per-attendee
 * AttendeeActionLog write, badge issuance — applies unchanged; ids that don't belong to this
 * event are silently ignored, same convention as bulk-delete. Attendees are processed in
 * bounded-concurrency chunks (BULK_CHECKIN_CONCURRENCY) rather than fully serially, for
 * throughput on large selections, while each attendee keeps its own independent CAS transaction —
 * same shape as `revokeAllCheckInsForEvent`. Uses Promise.allSettled (not Promise.all) per chunk:
 * admitAttendee has no analogous "expected race" exception to catch-and-skip like bulk-revoke's
 * UndoNotAllowedError (it already reports a losing race as ALREADY_CHECKED_IN/REVOKED via its
 * return value, not a throw), so any throw here represents a genuine, unexpected per-attendee
 * failure rather than a routine race — but discarding an entire chunk's already-committed
 * siblings over one such failure (Promise.all's behavior) would silently under-report a mostly-
 * successful bulk operation. Settling lets every attendee's own transaction outcome be counted
 * regardless of its neighbors. */
export async function handleBulkCheckInEventAttendees(c: Context, db: PrismaClient): Promise<Response> {
  const eventIdOrRes = requireEventId(c);
  if (eventIdOrRes instanceof Response) return eventIdOrRes;
  const eventId = eventIdOrRes;

  const forbidden = await assertEventManageAccess(c, db, eventId);
  if (forbidden) return forbidden;

  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: "invalid json" }, 400);
  }
  const parsed = bulkCheckInAttendeesBodySchema.safeParse(body);
  if (!parsed.success) return c.json({ error: "validation_failed" }, 400);

  const counts = { checkedIn: 0, alreadyCheckedIn: 0, revoked: 0, invalid: 0, errored: 0 };
  try {
    const owned = await db.attendee.findMany({
      where: { id: { in: parsed.data.attendeeIds }, event_id: eventId },
      select: { id: true },
    });

    const audit = adminAuditFromContext(c);
    for (const batch of chunk(owned, BULK_CHECKIN_CONCURRENCY)) {
      const settled = await Promise.allSettled(
        batch.map(({ id }) => admitAttendee({ attendeeId: id, eventId, method: "manual", audit }, db)),
      );
      for (const [index, outcome] of settled.entries()) {
        if (outcome.status === "rejected") {
          console.error("bulk check-in: admitAttendee failed:", outcome.reason);
          recordBulkAttendeeActionFailure(c, eventId, "checkin", {
            attendeeId: batch[index]!.id,
          });
          counts.errored += 1;
          continue;
        }
        counts[BULK_CHECKIN_STATUS_COUNTER[outcome.value.status]] += 1;
      }
    }

    return c.json(counts);
  } catch (err) {
    console.error("bulk check-in failed:", err);
    recordBulkAttendeeActionFailure(c, eventId, "checkin", {
      attendeeCount: parsed.data.attendeeIds.length,
    });
    return c.json({ error: "server error" }, 500);
  }
}

const bulkRevokeCheckInAttendeesBodySchema = z
  .object({
    attendeeIds: z.array(z.string()).min(1).max(BULK_SEND_LIMIT),
  })
  .strict();

const bulkRevokePassAttendeesBodySchema = z
  .object({
    attendeeIds: z.array(z.string()).min(1).max(BULK_SEND_LIMIT),
  })
  .strict();

type BulkRevokeCheckInCounts = {
  revoked: number;
  notAdmitted: number;
  blocked: number;
  errored: number;
};

/** Account for each settled revoke independently so one unexpected failure does not hide the
 * result of its neighbours in the same chunk. Kept outside the request handler to keep the
 * handler focused on request-level failures such as the initial owned-attendee lookup. */
function tallyBulkRevokeCheckInOutcomes(
  c: Context,
  eventId: string,
  batch: ReadonlyArray<{ id: string }>,
  settled: ReadonlyArray<PromiseSettledResult<unknown>>,
  counts: BulkRevokeCheckInCounts,
): void {
  for (const [index, outcome] of settled.entries()) {
    if (outcome.status === "fulfilled") {
      counts.revoked += 1;
      continue;
    }
    if (outcome.reason instanceof UndoNotAllowedError) {
      counts.notAdmitted += 1;
    } else if (outcome.reason instanceof IllegalItemTransitionError) {
      counts.blocked += 1;
    } else {
      console.error("bulk revoke check-in: revokeCheckInMutation failed:", outcome.reason);
      recordBulkAttendeeActionFailure(c, eventId, "revoke_checkin", {
        attendeeId: batch[index]!.id,
      });
      counts.errored += 1;
    }
  }
}

/** POST /api/admin/events/:eventId/attendees/bulk-revoke-checkin — undo check-in for a selection
 * of attendees at once, from the Attendees list's row-selection bulk bar. Mirrors bulk-checkin's
 * shape (owned-id lookup, chunked Promise.allSettled, per-attendee independent transaction) but
 * calls `revokeCheckInMutation` directly rather than `revokeCheckIn` — a bulk response only needs
 * counts, not each attendee's full AttendeeCardDto, so this skips the per-attendee
 * getAttendeeCard query that `revokeCheckIn`/`revokeCheckInTx` would otherwise pay for
 * needlessly. `resetItems: true` matches the single-attendee "Revoke check-in" action (not the
 * pass-status-change path's resetItems: false), so a bulk revoke also clears handed-out items,
 * same as revoking one attendee at a time.
 *
 * `UndoNotAllowedError` (not currently admitted, or lost a concurrent race) and
 * `IllegalItemTransitionError` (pass already revoked/cancelled, so the item-reset cascade
 * refuses) are both routine, expected per-attendee outcomes for a bulk selection that may mix
 * already-clean attendees in with ones to revoke — counted, not treated as failures. Only a
 * genuinely unexpected throw counts as `errored`. */
export async function handleBulkRevokeCheckInEventAttendees(c: Context, db: PrismaClient): Promise<Response> {
  const eventIdOrRes = requireEventId(c);
  if (eventIdOrRes instanceof Response) return eventIdOrRes;
  const eventId = eventIdOrRes;

  const forbidden = await assertEventManageAccess(c, db, eventId);
  if (forbidden) return forbidden;

  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: "invalid json" }, 400);
  }
  const parsed = bulkRevokeCheckInAttendeesBodySchema.safeParse(body);
  if (!parsed.success) return c.json({ error: "validation_failed" }, 400);

  const counts: BulkRevokeCheckInCounts = { revoked: 0, notAdmitted: 0, blocked: 0, errored: 0 };
  try {
    const owned = await db.attendee.findMany({
      where: { id: { in: parsed.data.attendeeIds }, event_id: eventId },
      select: { id: true },
    });

    const audit = adminAuditFromContext(c);
    for (const batch of chunk(owned, BULK_CHECKIN_CONCURRENCY)) {
      const settled = await Promise.allSettled(
        batch.map(({ id }) =>
          db.$transaction((tx) =>
            revokeCheckInMutation({ eventId, attendeeId: id, audit, resetItems: true }, tx),
          ),
        ),
      );
      tallyBulkRevokeCheckInOutcomes(c, eventId, batch, settled, counts);
    }

    return c.json(counts);
  } catch (err) {
    console.error("bulk revoke check-in failed:", err);
    recordBulkAttendeeActionFailure(c, eventId, "revoke_checkin", {
      attendeeCount: parsed.data.attendeeIds.length,
    });
    return c.json({ error: "server error" }, 500);
  }
}

const bulkRevokeItemsAttendeesBodySchema = z
  .object({
    attendeeIds: z.array(z.string()).min(1).max(BULK_SEND_LIMIT),
  })
  .strict();

/** POST /api/admin/events/:eventId/attendees/bulk-revoke-items — reset every issued/returned
 * item hand-out back to "pending" for a selection of attendees at once, from the Attendees
 * list's row-selection bulk bar. Independent of check-in status, like its Danger Zone sibling
 * (event-wide "Revoke all items issued") — this is the same per-attendee reset scoped to an
 * explicit selection instead of the whole event; `revokeItemsForAttendees` already owns the
 * id-scoping, chunking, and per-attendee blocked-pass tolerance, so this handler is just
 * validation + the call. Regular admin (not superadmin-only, unlike the Danger Zone version),
 * matching the other bulk-selection actions in this file. */
export async function handleBulkRevokeAttendeeItems(c: Context, db: PrismaClient): Promise<Response> {
  const eventIdOrRes = requireEventId(c);
  if (eventIdOrRes instanceof Response) return eventIdOrRes;
  const eventId = eventIdOrRes;

  const forbidden = await assertEventManageAccess(c, db, eventId);
  if (forbidden) return forbidden;

  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: "invalid json" }, 400);
  }
  const parsed = bulkRevokeItemsAttendeesBodySchema.safeParse(body);
  if (!parsed.success) return c.json({ error: "validation_failed" }, 400);

  try {
    const revokedCount = await revokeItemsForAttendees(db, {
      eventId,
      attendeeIds: parsed.data.attendeeIds,
      audit: adminAuditFromContext(c),
    });

    return c.json({ revokedCount });
  } catch (err) {
    console.error("bulk revoke items: revokeItemsForAttendees failed:", err);
    recordBulkAttendeeActionFailure(c, eventId, "revoke_items", {
      attendeeCount: parsed.data.attendeeIds.length,
    });
    return c.json({ error: "server error" }, 500);
  }
}

/** Revokes a single attendee's pass (status -> revoked), same effect as the single-attendee
 * PATCH's status-change branch but scoped to just that transition - no profile/RSVP fields, no
 * expected_updated_at optimistic-concurrency check (a bulk selection doesn't carry a per-row
 * version to compare against, so a plain CAS on status is the concurrency guard instead: only
 * attendees still in an admittable status get flipped - `ADMITTABLE_STATUS_LIST` rather than a
 * literal ["revoked","cancelled"] exclusion, so this stays correct if the status enum this route
 * accepts ever widens, matching the single-attendee PATCH handler's own isAdmittable() guard).
 * Skips (does not touch) an attendee whose status is already "revoked" or "cancelled" - matches
 * the single-attendee "Revoke pass" row button, which is hidden (not just disabled) in both
 * those cases, so a bulk selection that happens to include one is simply left alone rather than
 * treated as a failure.
 *
 * Mirrors the single-attendee route's cascade: an admitted attendee whose pass is revoked must
 * not keep a stale admission (restoring the pass later would otherwise resurrect a "checked in"
 * state without a new scan). Always attempts `revokeCheckInMutation` rather than gating on a
 * pre-batch `admitted_at` snapshot (code review) - attendeeIds can be up to BULK_SEND_LIMIT,
 * processed in sequential chunks, so a snapshot read before the batch started could be stale by
 * the time this specific attendee's own transaction runs (e.g. an operator scans them in mid-
 * batch); `revokeCheckInMutation` re-reads `admitted_at` fresh inside this same transaction and
 * throws `UndoNotAllowedError` (caught below, not a failure) if there's genuinely nothing to
 * clear. `resetItems` defaults to false - handed-out items stay handed out when only the pass is
 * revoked, same as the single-attendee path; only the explicit "Revoke check-in" action clears
 * items. */
async function revokeOneAttendeePass(
  eventId: string,
  attendeeId: string,
  previousStatus: AttendeeStatus,
  audit: OpsAuditContext,
  db: PrismaClient,
): Promise<"revoked" | "skipped"> {
  const result = await db.$transaction(async (tx) => {
    const updated = await tx.attendee.updateMany({
      where: { id: attendeeId, event_id: eventId, status: { in: ADMITTABLE_STATUS_LIST } },
      data: { status: "revoked" },
    });
    if (updated.count === 0) return "skipped";

    try {
      await revokeCheckInMutation({ eventId, attendeeId, audit }, tx);
    } catch (err) {
      if (!(err instanceof UndoNotAllowedError)) throw err;
    }

    await writeActionLog(tx, {
      event_id: eventId,
      attendee_id: attendeeId,
      action_type: "pass_revoked",
      audit,
      metadata: { previous_status: previousStatus },
    });

    return "revoked";
  });
  if (result === "revoked") {
    await syncWalletPassOnStatusChangeBestEffort(db, eventId, attendeeId, "revoked");
  }
  return result;
}

/** POST /api/admin/events/:eventId/attendees/bulk-revoke-pass — revoke the pass for a selection
 * of attendees at once, from the Attendees list's row-selection bulk bar. Same
 * owned-id/chunked-Promise.allSettled shape as the sibling bulk endpoints in this file. */
export async function handleBulkRevokeAttendeePass(c: Context, db: PrismaClient): Promise<Response> {
  const eventIdOrRes = requireEventId(c);
  if (eventIdOrRes instanceof Response) return eventIdOrRes;
  const eventId = eventIdOrRes;

  const forbidden = await assertEventManageAccess(c, db, eventId);
  if (forbidden) return forbidden;

  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: "invalid json" }, 400);
  }
  const parsed = bulkRevokePassAttendeesBodySchema.safeParse(body);
  if (!parsed.success) return c.json({ error: "validation_failed" }, 400);

  const counts = { revoked: 0, skipped: 0, errored: 0 };
  try {
    const owned = await db.attendee.findMany({
      where: { id: { in: parsed.data.attendeeIds }, event_id: eventId },
      select: { id: true, status: true },
    });

    const audit = adminAuditFromContext(c);
    for (const batch of chunk(owned, BULK_CHECKIN_CONCURRENCY)) {
      const settled = await Promise.allSettled(
        batch.map((a) =>
          revokeOneAttendeePass(eventId, a.id, a.status as AttendeeStatus, audit, db),
        ),
      );
      for (const [index, outcome] of settled.entries()) {
        if (outcome.status === "rejected") {
          console.error("bulk revoke pass: revokeOneAttendeePass failed:", outcome.reason);
          recordBulkAttendeeActionFailure(c, eventId, "revoke_pass", {
            attendeeId: batch[index]!.id,
          });
          counts.errored += 1;
          continue;
        }
        counts[outcome.value] += 1;
      }
    }

    return c.json(counts);
  } catch (err) {
    console.error("bulk revoke pass failed:", err);
    recordBulkAttendeeActionFailure(c, eventId, "revoke_pass", {
      attendeeCount: parsed.data.attendeeIds.length,
    });
    return c.json({ error: "server error" }, 500);
  }
}

const bulkWalletAttendeesBodySchema = z
  .object({
    attendeeIds: z.array(z.string()).min(1).max(BULK_SEND_LIMIT),
  })
  .strict();

/** Resolves the event's wallet provider once for a whole bulk request, rather than once per
 * attendee - same reasoning as deleteWalletPassesBestEffort's own single resolve+decrypt. */
async function resolveEventWalletProviderForBulk(
  db: PrismaClient,
  eventId: string,
): Promise<WalletPassProvider | null> {
  const event = await db.event.findUnique({
    where: { id: eventId },
    select: {
      wallet_enabled: true,
      wallet_template_id: true,
      wallet_api_key_enc: true,
      wallet_field_mapping: true,
    },
  });
  if (!event) return null;
  return resolveWalletProvider({
    walletEnabled: event.wallet_enabled,
    walletTemplateId: event.wallet_template_id,
    walletApiKeyEnc: event.wallet_api_key_enc,
    walletFieldMapping: parseWalletFieldMapping(event.wallet_field_mapping),
  });
}

/** Attendees (within the given, event-owned set) that have a WalletPass row with a known
 * provider_pass_id - the ones a bulk wallet action can actually touch. Attendees missing from
 * the returned array (never created a pass) count as skipped by the caller. */
async function loadBulkWalletTargets(
  db: PrismaClient,
  eventId: string,
  attendeeIds: string[],
): Promise<{ attendeeId: string; providerPassId: string; status: string }[]> {
  const rows = await db.walletPass.findMany({
    where: {
      attendee_id: { in: attendeeIds },
      provider_pass_id: { not: null },
      attendee: { event_id: eventId },
    },
    select: { attendee_id: true, provider_pass_id: true, status: true },
  });
  return rows.map((row) => ({
    attendeeId: row.attendee_id,
    providerPassId: row.provider_pass_id!,
    status: row.status,
  }));
}

async function voidOneWalletPass(
  db: PrismaClient,
  eventId: string,
  target: { attendeeId: string; providerPassId: string; status: string },
  provider: WalletPassProvider,
  audit: OpsAuditContext,
): Promise<"voided" | "skipped"> {
  if (target.status !== "active") return "skipped";
  await provider.voidPass(target.providerPassId);
  await db.$transaction(async (tx) => {
    await tx.walletPass.update({
      where: { attendee_id: target.attendeeId },
      data: { status: "voided", voided_at: new Date(), last_error_code: null },
    });
    await writeActionLog(tx, {
      event_id: eventId,
      attendee_id: target.attendeeId,
      action_type: "wallet_pass_voided",
      audit,
      metadata: { bulk: true },
    });
  });
  return "voided";
}

/** POST /api/admin/events/:eventId/attendees/bulk-wallet-void - void the wallet pass for a
 * selection of attendees at once, from the Attendees list's row-selection bulk bar. Same
 * owned-id/chunked-Promise.allSettled shape as the sibling bulk endpoints in this file; attendees
 * with no WalletPass row, or whose pass is already voided, count as skipped rather than errored. */
export async function handleBulkVoidAttendeeWalletPass(c: Context, db: PrismaClient): Promise<Response> {
  const eventIdOrRes = requireEventId(c);
  if (eventIdOrRes instanceof Response) return eventIdOrRes;
  const eventId = eventIdOrRes;

  const forbidden = await assertEventManageAccess(c, db, eventId);
  if (forbidden) return forbidden;

  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: "invalid json" }, 400);
  }
  const parsed = bulkWalletAttendeesBodySchema.safeParse(body);
  if (!parsed.success) return c.json({ error: "validation_failed" }, 400);

  const counts = { voided: 0, skipped: 0, errored: 0 };
  try {
    const provider = await resolveEventWalletProviderForBulk(db, eventId);
    if (!provider) return c.json({ error: "wallet_not_configured" }, 409);

    const targets = await loadBulkWalletTargets(db, eventId, parsed.data.attendeeIds);
    counts.skipped = parsed.data.attendeeIds.length - targets.length;

    const audit = adminAuditFromContext(c);
    for (const batch of chunk(targets, BULK_CHECKIN_CONCURRENCY)) {
      const settled = await Promise.allSettled(
        batch.map((target) => voidOneWalletPass(db, eventId, target, provider, audit)),
      );
      for (const [index, outcome] of settled.entries()) {
        if (outcome.status === "rejected") {
          console.error("bulk wallet void: voidOneWalletPass failed:", outcome.reason);
          recordBulkAttendeeActionFailure(c, eventId, "wallet_void", {
            attendeeId: batch[index]!.attendeeId,
          });
          counts.errored += 1;
          continue;
        }
        counts[outcome.value] += 1;
      }
    }

    return c.json(counts);
  } catch (err) {
    console.error("bulk wallet void failed:", err);
    recordBulkAttendeeActionFailure(c, eventId, "wallet_void", {
      attendeeCount: parsed.data.attendeeIds.length,
    });
    return c.json({ error: "server error" }, 500);
  }
}

/** Rebuilds one attendee's wallet pass from their current data, same core logic as
 * handleReissueAttendeeWalletPass's single-attendee path. Attendees with no resolvable ticket
 * (never issued) count as skipped, matching that route's 409. Exported for reuse by
 * event-settings-routes.ts's own best-effort push when an event's wallet-relevant fields change. */
export async function reissueOneWalletPass(
  db: PrismaClient,
  eventId: string,
  target: { attendeeId: string; providerPassId: string },
  provider: WalletPassProvider,
  audit: OpsAuditContext,
): Promise<"reissued" | "skipped"> {
  const attendee = await db.attendee.findUnique({
    where: { id: target.attendeeId },
    select: { qr_payload: true, external_uuid: true, token_enc: true },
  });
  if (!attendee) return "skipped";
  const scanned =
    attendee.qr_payload ?? attendee.external_uuid ?? (attendee.token_enc ? decryptFromString(attendee.token_enc) : null);
  if (!scanned) return "skipped";

  const resolved = await resolveTicket(scanned, db, { eventId });
  if (!resolved) return "skipped";

  const display = await resolveTicketPageDisplay(db, resolved);
  const input = buildWalletPassInput(display, scanned);

  let result;
  try {
    result = await provider.updatePass(target.providerPassId, input);
  } catch (err) {
    await db.walletPass.update({
      where: { attendee_id: target.attendeeId },
      data: { last_error_code: err instanceof WalletProviderError ? err.code : "wallet_provider_rejected" },
    });
    throw err;
  }

  await db.$transaction(async (tx) => {
    // updatePass only patches the provider's content, never its voided flag (that's Restore's
    // job, a separate explicit action) - status/voided_at are deliberately left untouched here so
    // an already-voided pass stays voided instead of falsely reporting "active" while the
    // installed pass is still invalid at the provider, which would also hide the Restore action.
    await tx.walletPass.update({
      where: { attendee_id: target.attendeeId },
      data: {
        download_url: result.downloadUrl,
        apple_url: result.appleUrl,
        android_url: result.androidUrl,
        last_error_code: null,
        last_synced_at: new Date(),
      },
    });
    await writeActionLog(tx, {
      event_id: eventId,
      attendee_id: target.attendeeId,
      action_type: "wallet_pass_reissued",
      audit,
      metadata: { bulk: true },
    });
  });
  return "reissued";
}

/** POST /api/admin/events/:eventId/attendees/bulk-wallet-reissue - push each selected attendee's
 * current name/ticket type/event details to their already-issued wallet pass at once, e.g. after
 * an Event Settings change. Same owned-id/chunked-Promise.allSettled shape as the sibling bulk
 * endpoints; attendees with no WalletPass row or no resolvable ticket count as skipped. */
export async function handleBulkReissueAttendeeWalletPass(c: Context, db: PrismaClient): Promise<Response> {
  const eventIdOrRes = requireEventId(c);
  if (eventIdOrRes instanceof Response) return eventIdOrRes;
  const eventId = eventIdOrRes;

  const forbidden = await assertEventManageAccess(c, db, eventId);
  if (forbidden) return forbidden;

  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: "invalid json" }, 400);
  }
  const parsed = bulkWalletAttendeesBodySchema.safeParse(body);
  if (!parsed.success) return c.json({ error: "validation_failed" }, 400);

  const counts = { reissued: 0, skipped: 0, errored: 0 };
  try {
    const provider = await resolveEventWalletProviderForBulk(db, eventId);
    if (!provider) return c.json({ error: "wallet_not_configured" }, 409);

    const targets = await loadBulkWalletTargets(db, eventId, parsed.data.attendeeIds);
    counts.skipped = parsed.data.attendeeIds.length - targets.length;

    const audit = adminAuditFromContext(c);
    for (const batch of chunk(targets, BULK_CHECKIN_CONCURRENCY)) {
      const settled = await Promise.allSettled(
        batch.map((target) => reissueOneWalletPass(db, eventId, target, provider, audit)),
      );
      for (const [index, outcome] of settled.entries()) {
        if (outcome.status === "rejected") {
          console.error("bulk wallet reissue: reissueOneWalletPass failed:", outcome.reason);
          recordBulkAttendeeActionFailure(c, eventId, "wallet_reissue", {
            attendeeId: batch[index]!.attendeeId,
          });
          counts.errored += 1;
          continue;
        }
        counts[outcome.value] += 1;
      }
    }

    return c.json(counts);
  } catch (err) {
    console.error("bulk wallet reissue failed:", err);
    recordBulkAttendeeActionFailure(c, eventId, "wallet_reissue", {
      attendeeCount: parsed.data.attendeeIds.length,
    });
    return c.json({ error: "server error" }, 500);
  }
}

/** Permanently removes one attendee's wallet pass at the provider and deletes the WalletPass row,
 * same core logic as handleDeleteAttendeeWalletPass's single-attendee path - the attendee reads as
 * never having added a pass afterward. */
async function deleteOneWalletPass(
  db: PrismaClient,
  eventId: string,
  target: { attendeeId: string; providerPassId: string },
  provider: WalletPassProvider,
  audit: OpsAuditContext,
): Promise<"deleted"> {
  await provider.deletePass(target.providerPassId);
  await db.$transaction(async (tx) => {
    await tx.walletPass.delete({ where: { attendee_id: target.attendeeId } });
    await writeActionLog(tx, {
      event_id: eventId,
      attendee_id: target.attendeeId,
      action_type: "wallet_pass_deleted",
      audit,
      metadata: { bulk: true },
    });
  });
  return "deleted";
}

/** POST /api/admin/events/:eventId/attendees/bulk-wallet-delete - permanently remove the wallet
 * pass for a selection of attendees at once, from the Attendees list's row-selection bulk bar.
 * Same owned-id/chunked-Promise.allSettled shape as the sibling bulk endpoints; attendees with no
 * WalletPass row count as skipped rather than errored. Irreversible, gated behind its own confirm
 * dialog on the frontend. */
export async function handleBulkDeleteAttendeeWalletPass(c: Context, db: PrismaClient): Promise<Response> {
  const eventIdOrRes = requireEventId(c);
  if (eventIdOrRes instanceof Response) return eventIdOrRes;
  const eventId = eventIdOrRes;

  const forbidden = await assertEventManageAccess(c, db, eventId);
  if (forbidden) return forbidden;

  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: "invalid json" }, 400);
  }
  const parsed = bulkWalletAttendeesBodySchema.safeParse(body);
  if (!parsed.success) return c.json({ error: "validation_failed" }, 400);

  const counts = { deleted: 0, skipped: 0, errored: 0 };
  try {
    const provider = await resolveEventWalletProviderForBulk(db, eventId);
    if (!provider) return c.json({ error: "wallet_not_configured" }, 409);

    const targets = await loadBulkWalletTargets(db, eventId, parsed.data.attendeeIds);
    counts.skipped = parsed.data.attendeeIds.length - targets.length;

    const audit = adminAuditFromContext(c);
    for (const batch of chunk(targets, BULK_CHECKIN_CONCURRENCY)) {
      const settled = await Promise.allSettled(
        batch.map((target) => deleteOneWalletPass(db, eventId, target, provider, audit)),
      );
      for (const [index, outcome] of settled.entries()) {
        if (outcome.status === "rejected") {
          console.error("bulk wallet delete: deleteOneWalletPass failed:", outcome.reason);
          recordBulkAttendeeActionFailure(c, eventId, "wallet_delete", {
            attendeeId: batch[index]!.attendeeId,
          });
          counts.errored += 1;
          continue;
        }
        counts[outcome.value] += 1;
      }
    }

    return c.json(counts);
  } catch (err) {
    console.error("bulk wallet delete failed:", err);
    recordBulkAttendeeActionFailure(c, eventId, "wallet_delete", {
      attendeeCount: parsed.data.attendeeIds.length,
    });
    return c.json({ error: "server error" }, 500);
  }
}

/** POST /api/admin/events/:eventId/attendees — manual attendee create (admin/superadmin). */
export async function handleCreateEventAttendee(c: Context, db: PrismaClient): Promise<Response> {
  const eventIdOrRes = requireEventId(c);
  if (eventIdOrRes instanceof Response) return eventIdOrRes;
  const eventId = eventIdOrRes;

  const forbidden = await assertEventManageAccess(c, db, eventId);
  if (forbidden) return forbidden;

  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: "invalid json" }, 400);
  }

  const parsed = createAttendeeSchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ error: "validation_failed" }, 400);
  }

  const { email, first_name, last_name, company, department, ticket_type, custom_data } = parsed.data;
  const name = [first_name, last_name].filter(Boolean).join(" ");

  const duplicate = await db.attendee.findFirst({
    where: { event_id: eventId, email: { equals: email, mode: "insensitive" } },
    select: { id: true },
  });
  if (duplicate) {
    return c.json(
      { code: "email_taken", error: "This email is already registered for this event." },
      409,
    );
  }

  let allowedFields: EventItemContent[];
  try {
    allowedFields = await loadEventCustomDataFields(db, eventId);
  } catch (err) {
    return c.json({ error: customDataErrorCode(err) }, 400);
  }
  let customData: Prisma.InputJsonValue | undefined;
  try {
    const built = buildCustomDataFromInput(allowedFields, custom_data);
    customData = built as Prisma.InputJsonValue | undefined;
  } catch (err) {
    return c.json({ error: customDataErrorCode(err) }, 400);
  }

  try {
    const created = await db.$transaction(async (tx) => {
      // Catalog membership check (batch 04 / #351) - moved inside the transaction and locked
      // against a concurrent ticket-type DELETE (TOCTOU fix, code review): validating on the bare
      // `db` before this transaction opened let a concurrent delete's in-use recheck pass (it
      // couldn't see this uncommitted row) and remove the type this attendee is about to
      // reference. Only taken when a type is actually being set, so attendees that don't
      // reference one at all never pay for the lock.
      if (ticket_type) {
        await acquireEventTicketTypesLock(tx, eventId);
        const ticketTypeError = await validateTicketTypeCatalog(tx, eventId, ticket_type);
        if (ticketTypeError) throw c.json(ticketTypeError, 400);
      }

      await acquireEventCapacityLock(tx, eventId);
      const capacityResult = await assertEventCapacityForIncoming(c, tx, eventId, 1);
      if (capacityResult instanceof Response) throw capacityResult;
      const capacityForced =
        capacityResult && "forced" in capacityResult ? capacityResult : undefined;

      const row = await tx.attendee.create({
        data: {
          id: randomUUID(),
          event_id: eventId,
          email,
          name,
          first_name,
          last_name,
          company: company?.trim() ? company.trim() : null,
          department: department?.trim() ? department.trim() : null,
          ticket_type: ticket_type?.trim() ? ticket_type.trim() : null,
          ...(customData !== undefined ? { custom_data: customData } : {}),
          rsvp_status: "none",
          rsvp_source: "admin",
          client_timezone: resolveClientTimezone(c),
        },
        select: ATTENDEE_DETAIL_SELECT,
      });

      const audit = adminAuditFromContext(c);
      await writeActionLog(tx, {
        event_id: eventId,
        attendee_id: row.id,
        action_type: "attendee_created_manual",
        audit,
        ...(capacityForced
          ? {
              metadata: {
                forced: true,
                capacity: capacityForced.capacity,
                current: capacityForced.current,
              },
            }
          : {}),
      });
      // Also written to the central admin audit log (Instance Settings → Audit log) - see
      // the matching note on attendee_erased above for why attendee lifecycle events need a
      // record outside the attendee's own (deletable) AttendeeActionLog trail.
      const event = await tx.event.findUnique({ where: { id: eventId }, select: { organization_id: true, title: true } });
      await writeAttendeeLifecycleAuditLog(tx, c, audit, event?.organization_id ?? null, "attendee_created_manual", {
        event_id: eventId,
        event_title: event?.title,
        attendee_id: row.id,
        attendee_name: row.name,
        attendee_email: row.email,
      });

      return row;
    });

    publishActivityChanged(eventId);
    const dto = await buildAttendeeDetailDto(db, eventId, created);
    return c.json(dto, 201);
  } catch (err) {
    if (err instanceof Response) return err;
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
      return c.json(
        { code: "email_taken", error: "This email is already registered for this event." },
        409,
      );
    }
    console.error("handleCreateEventAttendee failed:", err);
    return c.json({ error: "server error" }, 500);
  }
}

/** POST /api/admin/events/:eventId/attendees/:id/resend */
export async function handleResendEventAttendeeTicket(
  c: Context,
  db: PrismaClient,
  mailDeps: MailDeliveryDeps = {},
  injectedBaseUrl?: string,
): Promise<Response> {
  const attendeeContextOrRes = await requireManagedEventAttendee(c, db);
  if (attendeeContextOrRes instanceof Response) return attendeeContextOrRes;
  const { attendee: existing, attendeeId, eventId } = attendeeContextOrRes;

  let body: unknown;
  const parsedBody = await parseOptionalJsonBody(c);
  if (parsedBody instanceof Response) return parsedBody;
  body = parsedBody;

  const parsed = resendBodySchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ error: "validation_failed" }, 400);
  }

  const to = parsed.data.to;
  const alternate = Boolean(to && to !== existing.email);

  // SECURITY NOTE (ADR 0021): `to` is validated as email format only — no domain allowlist.
  // Per-attendee and global-per-user rate limits apply. All resends are audit-logged.
  // A domain allowlist per org/event is planned for v0.5 (see follow-up task).
  // Rationale: admins legitimately resend to corporate relay addresses outside the registrant's
  // personal domain; a hardcoded allowlist would break that use-case without org configuration.
  const baseUrlOrRes = await resolveMailInstanceBaseUrl(c, db, process.env, injectedBaseUrl);
  if (baseUrlOrRes instanceof Response) return baseUrlOrRes;
  const resendAudit = adminAuditFromContext(c);
  let sendResult;
  try {
    sendResult = await resendTicketEmail(attendeeId, db, process.env, mailDeps, {
      to,
      templateId: parsed.data.templateId,
      baseUrl: baseUrlOrRes,
      timezone: resolveClientTimezone(c) ?? undefined,
      actorUserId: resendAudit.operator,
      sessionId: resendAudit.sessionId,
    });
  } catch (err) {
    if (err instanceof TemplateNotFoundError) {
      return c.json({ error: "template_not_found" }, 404);
    }
    const mailErr = mailTransportSetupErrorResponse(c, err);
    if (mailErr) return mailErr;
    throw err;
  }

  const skipped = sendResult.skipped.find((s) => s.attendeeId === attendeeId);
  if (skipped) {
    return c.json({ error: "resend_skipped", reason: skipped.reason }, 422);
  }

  const created = sendResult.deliveries.find((d) => d.attendeeId === attendeeId);
  if (!created) {
    return c.json({ error: "delivery_not_created" }, 500);
  }

  const deliveryRow = await db.emailDelivery.findUnique({
    where: { id: created.deliveryId },
  });

  if (!deliveryRow || deliveryRow.event_id !== eventId) {
    return c.json({ error: "delivery_not_found" }, 500);
  }

  const { items: deliveries } = await listDeliveries(
    { eventId, filters: { attendeeId } },
    db,
  );
  const latest = deliveries.find((d) => d.id === created.deliveryId);
  if (!latest) {
    return c.json({ error: "delivery_not_found" }, 500);
  }

  await db.$transaction(async (tx) => {
    await writeActionLog(tx, {
      event_id: eventId,
      attendee_id: attendeeId,
      action_type: "ticket_resent",
      audit: resendAudit,
      metadata: { alternate },
    });
  });

  return c.json(toDeliveryDto(latest));
}

/**
 * POST /api/admin/events/:eventId/attendees/:id/dismiss-bounce
 * Acknowledges the Communication bounce notifier for this attendee (Delivery log row menu),
 * without resending anything. No "is this attendee actually bounced" guard - the UI only ever
 * shows this action for a bounced row, and the write is idempotent and harmless outside that
 * case (nothing else reads it besides the bounced-count query, which already compares the
 * timestamp against the attendee's latest delivery).
 */
export async function handleDismissAttendeeBounce(c: Context, db: PrismaClient): Promise<Response> {
  const attendeeContextOrRes = await requireManagedEventAttendee(c, db);
  if (attendeeContextOrRes instanceof Response) return attendeeContextOrRes;
  const { attendeeId, eventId } = attendeeContextOrRes;

  const dismissedAt = new Date();
  await db.$transaction(async (tx) => {
    await tx.attendee.update({
      where: { id: attendeeId },
      data: { email_bounce_dismissed_at: dismissedAt },
    });
    await writeActionLog(tx, {
      event_id: eventId,
      attendee_id: attendeeId,
      action_type: "bounce_dismissed",
      audit: adminAuditFromContext(c),
      metadata: {},
    });
  });

  return c.json({ email_bounce_dismissed_at: dismissedAt.toISOString() });
}

/**
 * POST /api/admin/events/:eventId/attendees/:id/revoke-checkin
 * Admin/superadmin only (assertEventManageAccess) — reverses this attendee's
 * current admission regardless of who checked them in or when, distinct from
 * the operator-facing device-scoped "undo my last scan" on the check-in page.
 */
export async function handleRevokeAttendeeCheckIn(c: Context, db: PrismaClient): Promise<Response> {
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

  try {
    const result = await revokeCheckIn(
      { eventId, attendeeId, audit: adminAuditFromContext(c) },
      db,
    );
    return c.json(result);
  } catch (err) {
    if (err instanceof UndoNotAllowedError) {
      // Distinct messages for "genuinely not admitted" vs "lost a
      // concurrent-revoke race" (review finding) — matches the sibling
      // handleCheckinUndo's err.message passthrough for the same error type.
      return c.json({ error: err.message }, 409);
    }
    // revokeCheckIn cascades into the same item-reset path as handleRevokeAttendeeItem
    // (resetItems: true), which can throw IllegalItemTransitionError for a blocked pass —
    // reuse the same 409 mapping instead of falling through to a raw 500.
    return itemTransitionErrorResponse(c, err, "handleRevokeAttendeeCheckIn");
  }
}

type WalletPassActionDto = {
  status: WalletPassStatus;
  issued_at: string | null;
  voided_at: string | null;
  apple_url: string | null;
  android_url: string | null;
  last_synced_at: string | null;
  last_error_code: string | null;
  apple_active_registrations: number | null;
  apple_inactive_registrations: number | null;
  google_active_registrations: number | null;
  google_inactive_registrations: number | null;
  /** Provider-reported string, deliberately not parsed to a Date - see the schema comment on
   * WalletPass.first_downloaded_at for why (unconfirmed timezone). */
  first_downloaded_at: string | null;
  registration_checked_at: string | null;
};

function serializeWalletPassAction(pass: {
  status: string;
  issued_at: Date | null;
  voided_at: Date | null;
  apple_url: string | null;
  android_url: string | null;
  last_synced_at: Date | null;
  last_error_code: string | null;
  apple_active_registrations: number | null;
  apple_inactive_registrations: number | null;
  google_active_registrations: number | null;
  google_inactive_registrations: number | null;
  first_downloaded_at: string | null;
  registration_checked_at: Date | null;
}): WalletPassActionDto {
  return {
    status: pass.status as WalletPassStatus,
    issued_at: pass.issued_at ? pass.issued_at.toISOString() : null,
    voided_at: pass.voided_at ? pass.voided_at.toISOString() : null,
    apple_url: pass.apple_url,
    android_url: pass.android_url,
    last_synced_at: pass.last_synced_at ? pass.last_synced_at.toISOString() : null,
    last_error_code: pass.last_error_code,
    apple_active_registrations: pass.apple_active_registrations,
    apple_inactive_registrations: pass.apple_inactive_registrations,
    google_active_registrations: pass.google_active_registrations,
    google_inactive_registrations: pass.google_inactive_registrations,
    first_downloaded_at: pass.first_downloaded_at,
    registration_checked_at: pass.registration_checked_at ? pass.registration_checked_at.toISOString() : null,
  };
}

/** A provider call failed (network, auth, rejected by PassCreator, ...) - surface the machine
 * code, same convention as the rest of the admin API (AGENTS.md "Admin API errors in the UI"),
 * for the frontend to map through operatorApiErrorMessage rather than showing a raw message. */
function walletProviderErrorResponse(c: Context, err: unknown, logContext: string): Response {
  const code = err instanceof WalletProviderError ? err.code : "wallet_provider_rejected";
  console.error(`${logContext} failed:`, err);
  return c.json({ error: code }, 502);
}

/** Shared preamble for the three wallet lifecycle actions below (void/restore/reissue): validates
 * params/access, loads the attendee's existing WalletPass id and the event's configured provider.
 * Every action requires an already-issued pass (created by the on-demand "Add to Wallet" flow) -
 * there is nothing to void/restore/reissue otherwise. */
async function loadWalletActionContext(
  c: Context,
  db: PrismaClient,
  eventId: string,
): Promise<
  | Response
  | {
      attendeeId: string;
      qrPayload: string | null;
      externalUuid: string | null;
      tokenEnc: string | null;
      providerPassId: string;
      previousStatus: string;
      provider: WalletPassProvider;
    }
> {
  const attendeeIdOrRes = requireAttendeeId(c);
  if (attendeeIdOrRes instanceof Response) return attendeeIdOrRes;
  const attendeeId = attendeeIdOrRes;

  const forbidden = await assertEventManageAccess(c, db, eventId);
  if (forbidden) return forbidden;

  const [attendee, event] = await Promise.all([
    db.attendee.findUnique({
      where: { id: attendeeId },
      select: {
        event_id: true,
        qr_payload: true,
        external_uuid: true,
        token_enc: true,
        wallet_pass: { select: { provider_pass_id: true, status: true } },
      },
    }),
    db.event.findUnique({
      where: { id: eventId },
      select: {
        wallet_enabled: true,
        wallet_template_id: true,
        wallet_api_key_enc: true,
        wallet_field_mapping: true,
      },
    }),
  ]);
  if (attendee?.event_id !== eventId) return c.json({ error: "forbidden" }, 403);
  if (!event) return c.json({ error: "forbidden" }, 403);
  if (!attendee.wallet_pass?.provider_pass_id) return c.json({ error: "no_wallet_pass" }, 404);

  const provider = resolveWalletProvider({
    walletEnabled: event.wallet_enabled,
    walletTemplateId: event.wallet_template_id,
    walletApiKeyEnc: event.wallet_api_key_enc,
    walletFieldMapping: parseWalletFieldMapping(event.wallet_field_mapping),
  });
  if (!provider) return c.json({ error: "wallet_not_configured" }, 409);

  return {
    attendeeId,
    qrPayload: attendee.qr_payload,
    externalUuid: attendee.external_uuid,
    tokenEnc: attendee.token_enc,
    providerPassId: attendee.wallet_pass.provider_pass_id,
    previousStatus: attendee.wallet_pass.status,
    provider,
  };
}

/** POST /api/admin/events/:eventId/attendees/:id/wallet/void */
export async function handleVoidAttendeeWalletPass(c: Context, db: PrismaClient): Promise<Response> {
  const eventIdOrRes = requireEventId(c);
  if (eventIdOrRes instanceof Response) return eventIdOrRes;
  const eventId = eventIdOrRes;

  const ctx = await loadWalletActionContext(c, db, eventId);
  if (ctx instanceof Response) return ctx;

  try {
    await ctx.provider.voidPass(ctx.providerPassId);
  } catch (err) {
    return walletProviderErrorResponse(c, err, "handleVoidAttendeeWalletPass");
  }

  const updated = await db.$transaction(async (tx) => {
    const row = await tx.walletPass.update({
      where: { attendee_id: ctx.attendeeId },
      data: { status: "voided", voided_at: new Date(), last_error_code: null },
    });
    await writeActionLog(tx, {
      event_id: eventId,
      attendee_id: ctx.attendeeId,
      action_type: "wallet_pass_voided",
      audit: adminAuditFromContext(c),
      metadata: { previous_status: ctx.previousStatus },
    });
    return row;
  });
  return c.json(serializeWalletPassAction(updated));
}

/** POST /api/admin/events/:eventId/attendees/:id/wallet/restore */
export async function handleRestoreAttendeeWalletPass(c: Context, db: PrismaClient): Promise<Response> {
  const eventIdOrRes = requireEventId(c);
  if (eventIdOrRes instanceof Response) return eventIdOrRes;
  const eventId = eventIdOrRes;

  const ctx = await loadWalletActionContext(c, db, eventId);
  if (ctx instanceof Response) return ctx;

  try {
    await ctx.provider.restorePass(ctx.providerPassId);
  } catch (err) {
    return walletProviderErrorResponse(c, err, "handleRestoreAttendeeWalletPass");
  }

  const updated = await db.$transaction(async (tx) => {
    const row = await tx.walletPass.update({
      where: { attendee_id: ctx.attendeeId },
      data: { status: "active", voided_at: null, last_error_code: null },
    });
    await writeActionLog(tx, {
      event_id: eventId,
      attendee_id: ctx.attendeeId,
      action_type: "wallet_pass_restored",
      audit: adminAuditFromContext(c),
      metadata: { previous_status: ctx.previousStatus },
    });
    return row;
  });
  return c.json(serializeWalletPassAction(updated));
}

/**
 * POST /api/admin/events/:eventId/attendees/:id/wallet/reissue - pushes the attendee's current
 * name/ticket type/event details to the provider via updatePass (PATCH, not delete+recreate,
 * which trips a known PassCreator 402 bug). The barcode value is recovered from the attendee's
 * own existing identifier (agency qr_payload/external_uuid, or the decrypted internal token) and
 * reused as-is - reissue must never mint a new one, or the pass's barcode stops matching the
 * attendee's actual ticket.
 */
export async function handleReissueAttendeeWalletPass(c: Context, db: PrismaClient): Promise<Response> {
  const eventIdOrRes = requireEventId(c);
  if (eventIdOrRes instanceof Response) return eventIdOrRes;
  const eventId = eventIdOrRes;

  const ctx = await loadWalletActionContext(c, db, eventId);
  if (ctx instanceof Response) return ctx;

  let scanned: string | null = ctx.qrPayload ?? ctx.externalUuid;
  if (!scanned && ctx.tokenEnc) {
    try {
      scanned = decryptFromString(ctx.tokenEnc);
    } catch (err) {
      // A malformed token_enc, or one written under an ENCRYPTION_KEY version no longer
      // available, must not escape as a bare 500 - same machine-readable response as the
      // "nothing to build a barcode from" case right below.
      console.error("handleReissueAttendeeWalletPass token decrypt failed:", err);
      return c.json({ error: "attendee_not_issued" }, 409);
    }
  }
  if (!scanned) return c.json({ error: "attendee_not_issued" }, 409);

  const resolved = await resolveTicket(scanned, db, { eventId });
  if (!resolved) return c.json({ error: "attendee_not_issued" }, 409);

  const display = await resolveTicketPageDisplay(db, resolved);
  const input = buildWalletPassInput(display, scanned);

  let result;
  try {
    result = await ctx.provider.updatePass(ctx.providerPassId, input);
  } catch (err) {
    await db.walletPass.update({
      where: { attendee_id: ctx.attendeeId },
      data: { last_error_code: err instanceof WalletProviderError ? err.code : "wallet_provider_rejected" },
    });
    return walletProviderErrorResponse(c, err, "handleReissueAttendeeWalletPass");
  }

  const updated = await db.$transaction(async (tx) => {
    // updatePass only patches the provider's content, never its voided flag (that's Restore's
    // job, a separate explicit action) - status/voided_at are deliberately left untouched here so
    // an already-voided pass stays voided instead of falsely reporting "active" while the
    // installed pass is still invalid at the provider, which would also hide the Restore action.
    const row = await tx.walletPass.update({
      where: { attendee_id: ctx.attendeeId },
      data: {
        download_url: result.downloadUrl,
        apple_url: result.appleUrl,
        android_url: result.androidUrl,
        last_error_code: null,
        last_synced_at: new Date(),
      },
    });
    await writeActionLog(tx, {
      event_id: eventId,
      attendee_id: ctx.attendeeId,
      action_type: "wallet_pass_reissued",
      audit: adminAuditFromContext(c),
      metadata: { previous_status: ctx.previousStatus },
    });
    return row;
  });
  return c.json(serializeWalletPassAction(updated));
}

/**
 * POST /api/admin/events/:eventId/attendees/:id/wallet/delete - permanently removes the pass at
 * the provider, distinct from void (which leaves the pass installed but marked invalid). The
 * WalletPass row itself is deleted rather than updated, so the attendee reads as never having
 * added a pass - a later "Add to Wallet" click creates a fresh one. Irreversible; the frontend
 * gates this behind its own confirm dialog.
 */
export async function handleDeleteAttendeeWalletPass(c: Context, db: PrismaClient): Promise<Response> {
  const eventIdOrRes = requireEventId(c);
  if (eventIdOrRes instanceof Response) return eventIdOrRes;
  const eventId = eventIdOrRes;

  const ctx = await loadWalletActionContext(c, db, eventId);
  if (ctx instanceof Response) return ctx;

  try {
    await ctx.provider.deletePass(ctx.providerPassId);
  } catch (err) {
    return walletProviderErrorResponse(c, err, "handleDeleteAttendeeWalletPass");
  }

  await db.$transaction(async (tx) => {
    await tx.walletPass.delete({ where: { attendee_id: ctx.attendeeId } });
    await writeActionLog(tx, {
      event_id: eventId,
      attendee_id: ctx.attendeeId,
      action_type: "wallet_pass_deleted",
      audit: adminAuditFromContext(c),
      metadata: { previous_status: ctx.previousStatus },
    });
  });
  return c.json({ deleted: true });
}

/**
 * POST /api/admin/events/:eventId/attendees/:id/items/:itemKey/revoke
 * Admin/superadmin only (assertEventManageAccess) — resets an already-handed-out
 * item back to "pending" so it can be issued again ("cofnąć to że się to
 * wydało"). A privileged corrective action, deliberately outside the operator's
 * forward-only item state machine. Returns the refreshed AttendeeCardDto so the
 * caller can replace its local card state, matching the sibling item-action and
 * revoke-checkin endpoints.
 */
export async function handleRevokeAttendeeItem(c: Context, db: PrismaClient): Promise<Response> {
  const eventIdOrRes = requireEventId(c);
  if (eventIdOrRes instanceof Response) return eventIdOrRes;
  const eventId = eventIdOrRes;
  const attendeeIdOrRes = requireAttendeeId(c);
  if (attendeeIdOrRes instanceof Response) return attendeeIdOrRes;
  const attendeeId = attendeeIdOrRes;
  const itemKey = c.req.param("itemKey");
  if (!itemKey) return c.json({ error: "itemKey required" }, 400);

  const forbidden = await assertEventManageAccess(c, db, eventId);
  if (forbidden) return forbidden;

  const existing = await loadAttendeeInEvent(db, eventId, attendeeId);
  if (!existing) return c.json({ error: "forbidden" }, 403);

  try {
    await revokeItemState({ attendeeId, eventId, itemKey, audit: adminAuditFromContext(c) }, db);
    publishActivityChanged(eventId);
    const card = await getAttendeeCard(eventId, attendeeId, db);
    return c.json({ card });
  } catch (err) {
    // e.g. unknown/disabled item key, blocked pass — mirrors the operator item-action route.
    return itemTransitionErrorResponse(c, err, "handleRevokeAttendeeItem");
  }
}

/**
 * POST /api/admin/events/:eventId/attendees/:id/notes
 * Admin/superadmin only (assertEventManageAccess) — adds a note shown on the attendee detail
 * page's Notes tab. Shares the same AttendeeNote model and addAttendeeNote() domain function
 * as the check-in operator note composer (POST /api/checkin/notes): a note added here also
 * appears on the check-in card, and vice versa.
 */
export async function handleAddAttendeeNote(c: Context, db: PrismaClient): Promise<Response> {
  const attendeeContextOrRes = await requireManagedEventAttendee(c, db);
  if (attendeeContextOrRes instanceof Response) return attendeeContextOrRes;
  const { attendee: existing, attendeeId, eventId } = attendeeContextOrRes;

  const noteBodyOrRes = await requireNoteBody(c);
  if (noteBodyOrRes instanceof Response) return noteBodyOrRes;
  const noteBody = noteBodyOrRes;

  try {
    await addAttendeeNote(
      { attendeeId, eventId, body: noteBody, audit: adminAuditFromContext(c) },
      db,
    );
  } catch (err) {
    if (err instanceof NoteTooLongError) return c.json({ error: "Note too long" }, 400);
    console.error("handleAddAttendeeNote failed:", err);
    return c.json({ error: "server error" }, 500);
  }

  const dto = await buildAttendeeDetailDto(db, eventId, existing);
  return c.json(dto);
}

/**
 * PATCH /api/admin/events/:eventId/attendees/:id/notes/:noteId
 * Admin/superadmin only (assertEventManageAccess), and only the note's own author may edit it,
 * regardless of role — updateAttendeeNote() enforces this authoritatively even though the
 * frontend already hides Edit on notes the signed-in user didn't write.
 */
export async function handlePatchAttendeeNote(c: Context, db: PrismaClient): Promise<Response> {
  const attendeeContextOrRes = await requireManagedEventAttendee(c, db);
  if (attendeeContextOrRes instanceof Response) return attendeeContextOrRes;
  const { attendee: existing, attendeeId, eventId } = attendeeContextOrRes;

  const noteIdOrRes = requireNoteId(c);
  const noteId = noteIdOrRes;

  const noteBodyOrRes = await requireNoteBody(c);
  if (noteBodyOrRes instanceof Response) return noteBodyOrRes;
  const noteBody = noteBodyOrRes;

  try {
    await updateAttendeeNote(
      { attendeeId, eventId, noteId, body: noteBody, audit: adminAuditFromContext(c) },
      db,
    );
  } catch (err) {
    if (err instanceof NoteTooLongError) return c.json({ error: "Note too long" }, 400);
    if (err instanceof NoteNotFoundError) return c.json({ error: "not found" }, 404);
    if (err instanceof NoteForbiddenError) return c.json({ error: "forbidden" }, 403);
    console.error("handlePatchAttendeeNote failed:", err);
    return c.json({ error: "server error" }, 500);
  }

  const dto = await buildAttendeeDetailDto(db, eventId, existing);
  return c.json(dto);
}

/** Resolve whether the actor may delete a note they did not author. Own-note deletion remains
 * the domain function's responsibility; this only grants the elevated paths: superadmin for any
 * author, or an event's admin for a current event-scoped operator author. */
async function canDeleteAnyAttendeeNote(
  db: PrismaClient,
  eventId: string,
  attendeeId: string,
  noteId: string,
  actorUserId: string,
): Promise<boolean> {
  if (await canManageInstance(db, actorUserId)) return true;

  const note = await db.attendeeNote.findFirst({
    where: { id: noteId, attendee_id: attendeeId, event_id: eventId },
    select: { author_user_id: true },
  });
  if (!note || note.author_user_id === actorUserId) return false;

  const event = await db.event.findUniqueOrThrow({
    where: { id: eventId },
    select: { organization_id: true },
  });
  const roles = await resolveNoteAuthorRoles(db, eventId, event.organization_id, [
    note.author_user_id,
  ]);
  return roles.get(note.author_user_id) === "operator";
}

/**
 * DELETE /api/admin/events/:eventId/attendees/:id/notes/:noteId
 * Admin/superadmin only (assertEventManageAccess). Within that: a superadmin may delete any
 * note; a plain (org-scoped) admin may delete their own note or one written by an operator, but
 * not another admin's or a superadmin's — resolved here via resolveNoteAuthorRoles before
 * calling deleteAttendeeNote(), which re-checks authoritatively (own note is always allowed
 * regardless of canDeleteAnyNote).
 */
export async function handleDeleteAttendeeNote(c: Context, db: PrismaClient): Promise<Response> {
  const attendeeContextOrRes = await requireManagedEventAttendee(c, db);
  if (attendeeContextOrRes instanceof Response) return attendeeContextOrRes;
  const { attendee: existing, attendeeId, eventId } = attendeeContextOrRes;

  const noteIdOrRes = requireNoteId(c);
  const noteId = noteIdOrRes;

  const auth = c.get("auth");
  const canDeleteAnyNote = await canDeleteAnyAttendeeNote(
    db,
    eventId,
    attendeeId,
    noteId,
    auth.userId,
  );

  try {
    await deleteAttendeeNote(
      { attendeeId, eventId, noteId, canDeleteAnyNote, audit: adminAuditFromContext(c) },
      db,
    );
  } catch (err) {
    if (err instanceof NoteNotFoundError) return c.json({ error: "not found" }, 404);
    if (err instanceof NoteForbiddenError) return c.json({ error: "forbidden" }, 403);
    console.error("handleDeleteAttendeeNote failed:", err);
    return c.json({ error: "server error" }, 500);
  }

  const dto = await buildAttendeeDetailDto(db, eventId, existing);
  return c.json(dto);
}

/** Best-effort bulk send audit — must not fail the HTTP response after mail is queued. */
async function auditBulkTicketSend(
  db: PrismaClient,
  c: Context,
  eventId: string,
  metadata: { target: "unsent" | "all"; queued: number; skipped: number; failed: number },
): Promise<void> {
  try {
    await writeBulkActionLog(db, {
      event_id: eventId,
      action_type: "mail_bulk_resend",
      audit: adminAuditFromContext(c),
      metadata,
    });
  } catch (err) {
    console.error("bulk resend audit log failed:", err);
  }
}

/**
 * Queue ticket emails for many attendees in one batch.
 *
 * `target: "unsent"` selects attendees without accepted/sent/delivered/queued delivery
 * and sends via `purpose: "initial"` (atomic claim). `target: "all"` resends to every
 * attendee up to {@link BULK_RESEND_LIMIT}. Audit metadata is counts only (no PII).
 */
export async function handleBulkResendTickets(
  c: Context,
  db: PrismaClient,
  mailDeps: MailDeliveryDeps = {},
  injectedBaseUrl?: string,
): Promise<Response> {
  const eventIdOrRes = requireEventId(c);
  if (eventIdOrRes instanceof Response) return eventIdOrRes;
  const eventId = eventIdOrRes;

  const forbidden = await assertEventManageAccess(c, db, eventId);
  if (forbidden) return forbidden;

  let body: unknown;
  const parsedBody = await parseOptionalJsonBody(c);
  if (parsedBody instanceof Response) return parsedBody;
  body = parsedBody;

  const parsed = bulkResendBodySchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ error: "validation_failed" }, 400);
  }

  const target = parsed.data.target;
  const filter =
    target === "unsent" ? ({ type: "no_delivery" } as const) : ({ type: "all" } as const);
  const noDeliveryScope = target === "unsent" ? ({ mode: "initial_ticket" } as const) : undefined;
  const { ids, overLimit } = await resolveBulkSendAttendeeIds(
    db,
    eventId,
    filter,
    noDeliveryScope,
  );

  if (overLimit) {
    return c.json({ error: "too_many_attendees", limit: BULK_RESEND_LIMIT }, 400);
  }

  if (ids.length === 0) {
    await auditBulkTicketSend(db, c, eventId, { target, queued: 0, skipped: 0, failed: 0 });
    return c.json({ batchId: null, queued: 0, skipped: 0, failed: 0 } satisfies BulkResendDto);
  }

  const attendeeIds = ids;
  const mailPurpose = target === "unsent" ? "initial" : "resend";
  const baseUrlOrRes = await resolveMailInstanceBaseUrl(c, db, process.env, injectedBaseUrl);
  if (baseUrlOrRes instanceof Response) return baseUrlOrRes;
  const audit = adminAuditFromContext(c);
  let sendResult;
  try {
    sendResult = await sendTicketEmails(
      eventId,
      {
        attendeeIds,
        purpose: mailPurpose,
        baseUrl: baseUrlOrRes,
        timezone: resolveClientTimezone(c) ?? undefined,
        actorUserId: audit.operator,
        sessionId: audit.sessionId,
      },
      db,
      process.env,
      mailDeps,
    );
  } catch (err) {
    const mailErr = mailTransportSetupErrorResponse(c, err);
    if (mailErr) return mailErr;
    throw err;
  }

  const skipped = sendResult.skipped.length;
  const queued = sendResult.queued;
  const failed = 0;

  await auditBulkTicketSend(db, c, eventId, { target, queued, skipped, failed });

  return c.json({
    batchId: queued > 0 ? sendResult.batchId : null,
    queued,
    skipped,
    failed,
  } satisfies BulkResendDto);
}
