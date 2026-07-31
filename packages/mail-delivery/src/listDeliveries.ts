import type { PrismaClient, EmailDeliveryPurpose, EmailDeliveryStatus } from "@admitto/db";
import { sanitizeDeliveryError } from "./sanitizeError.js";

export interface DeliveryLogEntry {
  id: string;
  attendee_id: string;
  status: string;
  provider: string;
  provider_message_id: string | null;
  attempts: number;
  purpose: string;
  recipient_email: string | null;
  rendered_subject: string | null;
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
  status: true,
  provider: true,
  provider_message_id: true,
  attempts: true,
  purpose: true,
  recipient_email: true,
  rendered_subject: true,
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
  };
}

/** Map a Prisma row to a delivery log entry with sanitized error text. */
function mapRow(row: {
  id: string;
  attendee_id: string;
  status: string;
  provider: string;
  provider_message_id: string | null;
  attempts: number;
  purpose: string;
  recipient_email: string | null;
  rendered_subject: string | null;
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
  return {
    ...row,
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
