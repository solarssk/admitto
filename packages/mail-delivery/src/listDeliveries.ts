import type { PrismaClient, EmailDeliveryPurpose, EmailDeliveryStatus } from "@admitto/db";
import { sanitizeDeliveryError } from "./sanitizeError.js";

export interface DeliveryLogEntry {
  id: string;
  attendee_id: string;
  /** Attendee's current display name (joined) — never dangling, GDPR erasure deletes deliveries
   * in the same transaction as the attendee (see attendees-api-routes.ts handleDeleteEventAttendee). */
  attendee_name: string;
  status: string;
  provider: string;
  provider_message_id: string | null;
  attempts: number;
  retryable: boolean | null;
  purpose: string;
  recipient_email: string | null;
  rendered_subject: string | null;
  template_id: string | null;
  /** Human-readable template label as of send time (template_label_snapshot), falling back to
   * the live MailTemplate join for rows predating that column. Null only for a genuine built-in
   * default send (no template was ever used) — callers should show a "Default ticket email"
   * fallback in that case. A deleted custom template still resolves here via the snapshot, so it
   * stays distinguishable from a true default send even after template_id is SetNull'd. */
  template_name: string | null;
  error_code: string | null;
  error: string | null;
  queued_at: Date;
  attempted_at: Date | null;
  accepted_at: Date | null;
  sent_at: Date | null;
  failed_at: Date | null;
  delivered_at: Date | null;
  created_at: Date;
  /** Triggering admin's IANA timezone at send time, when known. */
  client_timezone: string | null;
}

export interface ListDeliveriesParams {
  eventId: string;
  filters?: {
    status?: EmailDeliveryStatus | EmailDeliveryStatus[];
    purpose?: EmailDeliveryPurpose;
    attendeeId?: string;
    /** Case-insensitive match against the attendee's current name or email. */
    search?: string;
    /** Filter by template id. Pass `null` explicitly to match the built-in default ticket
     * template (rows with no custom MailTemplate override). */
    templateId?: string | null;
  };
  skip?: number;
  take?: number;
}

export interface ListDeliveriesResult {
  items: DeliveryLogEntry[];
  total: number;
}

const DELIVERY_LOG_SELECT = {
  id: true,
  attendee_id: true,
  attendee: { select: { name: true } },
  status: true,
  provider: true,
  provider_message_id: true,
  attempts: true,
  retryable: true,
  purpose: true,
  recipient_email: true,
  rendered_subject: true,
  template_id: true,
  template: { select: { label: true } },
  template_label_snapshot: true,
  error_code: true,
  error: true,
  queued_at: true,
  attempted_at: true,
  accepted_at: true,
  sent_at: true,
  failed_at: true,
  delivered_at: true,
  created_at: true,
  client_timezone: true,
} as const;

/** Normalize a single status or array for Prisma `{ in: [...] }` filters. */
function normalizeStatusFilter(
  status: EmailDeliveryStatus | EmailDeliveryStatus[],
): EmailDeliveryStatus[] {
  return Array.isArray(status) ? status : [status];
}

/** Build Prisma `where` clause for delivery log queries. */
function buildWhere(params: ListDeliveriesParams) {
  const { eventId, filters } = params;
  return {
    event_id: eventId,
    ...(filters?.status
      ? { status: { in: normalizeStatusFilter(filters.status) } }
      : {}),
    ...(filters?.purpose ? { purpose: filters.purpose } : {}),
    ...(filters?.attendeeId ? { attendee_id: filters.attendeeId } : {}),
    // `templateId: null` means "the default filter" - must also require no label snapshot, or a
    // deleted custom template's now-null template_id would wrongly match it too (see
    // template_label_snapshot on the schema).
    ...(filters?.templateId !== undefined
      ? filters.templateId === null
        ? { template_id: null, template_label_snapshot: null }
        : { template_id: filters.templateId }
      : {}),
    ...(filters?.search
      ? {
          OR: [
            { recipient_email: { contains: filters.search, mode: "insensitive" as const } },
            { attendee: { name: { contains: filters.search, mode: "insensitive" as const } } },
            { attendee: { email: { contains: filters.search, mode: "insensitive" as const } } },
          ],
        }
      : {}),
  };
}

/** Map a Prisma row (with attendee/template joins) to a delivery log entry with sanitized error
 * text and flattened join fields. */
function mapRow(row: {
  id: string;
  attendee_id: string;
  attendee: { name: string };
  status: string;
  provider: string;
  provider_message_id: string | null;
  attempts: number;
  retryable: boolean | null;
  purpose: string;
  recipient_email: string | null;
  rendered_subject: string | null;
  template_id: string | null;
  template: { label: string } | null;
  template_label_snapshot: string | null;
  error_code: string | null;
  error: string | null;
  queued_at: Date;
  attempted_at: Date | null;
  accepted_at: Date | null;
  sent_at: Date | null;
  failed_at: Date | null;
  delivered_at: Date | null;
  created_at: Date;
  client_timezone: string | null;
}): DeliveryLogEntry {
  const { attendee, template, template_label_snapshot, ...rest } = row;
  return {
    ...rest,
    attendee_name: attendee.name,
    // Prefer the send-time snapshot over the live join - it alone survives the template being
    // deleted later, and also stays accurate if the template is renamed afterward. Rows predating
    // this column (snapshot null) fall back to the live label, matching pre-existing behavior.
    template_name: template_label_snapshot ?? template?.label ?? null,
    error: sanitizeDeliveryError(row.error ?? undefined) ?? null,
  };
}

/**
 * Lists EmailDelivery rows for an event with a safe field projection (no rendered body).
 */
export async function listDeliveries(
  params: ListDeliveriesParams,
  prisma: PrismaClient,
): Promise<ListDeliveriesResult> {
  const where = buildWhere(params);

  const [total, rows] = await Promise.all([
    prisma.emailDelivery.count({ where }),
    prisma.emailDelivery.findMany({
      where,
      select: DELIVERY_LOG_SELECT,
      orderBy: [{ created_at: "desc" }, { id: "desc" }],
      ...(params.skip !== undefined ? { skip: params.skip } : {}),
      ...(params.take !== undefined ? { take: params.take } : {}),
    }),
  ]);

  return {
    items: rows.map(mapRow),
    total,
  };
}

export interface DeliveryDetailEntry extends DeliveryLogEntry {
  batch_id: string | null;
  actor_user_id: string | null;
  session_id: string | null;
}

export interface DeliveryTimelineResult {
  entry: DeliveryDetailEntry;
  /** Every delivery for the same attendee/event, oldest first (this entry included) — a genuine
   * multi-step history buildable with zero schema migration, since each resend creates a new row
   * rather than mutating the original (see attendees-api-routes.ts handleResendAttendeeTicket). */
  timeline: DeliveryLogEntry[];
}

/** Defensive upper bound on one attendee's delivery timeline - matches the delivery log's own
 * largest page size (DELIVERY_PAGE_SIZE_OPTIONS' 200 in apps/admin). A real attendee never
 * approaches this; it only guards against an unbounded response if a bulk-resend loop ever
 * malfunctions for one attendee. */
const DELIVERY_TIMELINE_CAP = 200;

const DELIVERY_DETAIL_SELECT = {
  ...DELIVERY_LOG_SELECT,
  batch_id: true,
  actor_user_id: true,
  session_id: true,
} as const;

/**
 * Fetch one delivery's full detail plus its attendee's whole delivery history (the "Delivery
 * Timeline"), ordered oldest-to-newest. Returns null when not found (wrong id/event, or a
 * cross-tenant id). `rendered_subject` is included (DELIVERY_LOG_SELECT) since it's the row's own
 * title everywhere it's shown — `rendered_html` deliberately is not; see `getRenderedDelivery` for
 * the privacy-redacted message preview, kept as a separate fetch so this detail view never carries
 * the (potentially large) HTML blob unless staff actually open it.
 */
export async function getDeliveryWithTimeline(
  params: { eventId: string; id: string },
  prisma: PrismaClient,
): Promise<DeliveryTimelineResult | null> {
  const row = await prisma.emailDelivery.findFirst({
    where: { id: params.id, event_id: params.eventId },
    select: DELIVERY_DETAIL_SELECT,
  });
  if (!row) return null;

  const { batch_id, actor_user_id, session_id, ...logRow } = row;
  const entry: DeliveryDetailEntry = {
    ...mapRow(logRow),
    batch_id,
    actor_user_id,
    session_id,
  };

  // Newest-first + take, then reversed below - if this attendee ever exceeds the cap, the
  // truncation drops their oldest history rather than the most recent ones (which must include
  // the very row this modal is open for).
  const timelineRows = await prisma.emailDelivery.findMany({
    where: { attendee_id: row.attendee_id, event_id: params.eventId },
    select: DELIVERY_LOG_SELECT,
    orderBy: [{ created_at: "desc" }, { id: "desc" }],
    take: DELIVERY_TIMELINE_CAP,
  });

  return { entry, timeline: timelineRows.map(mapRow).reverse() };
}

/**
 * Fetch a single delivery's frozen rendered snapshot for the "View sent message" preview.
 * Returns null when the delivery itself isn't found. The snapshot fields inside a found result
 * can independently be null once the retention window has passed (see retention.ts
 * nullifyDeliverySnapshots) — callers must render an explicit "message content no longer
 * available" state for that case, not treat it as a fetch error.
 */
export async function getRenderedDelivery(
  params: { eventId: string; id: string },
  prisma: PrismaClient,
): Promise<{ rendered_subject: string | null; rendered_html: string | null } | null> {
  return prisma.emailDelivery.findFirst({
    where: { id: params.id, event_id: params.eventId },
    select: { rendered_subject: true, rendered_html: true },
  });
}
