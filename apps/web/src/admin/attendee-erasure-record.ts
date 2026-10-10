import { isIP } from "node:net";
import { canManageInstance } from "@admitto/auth";
import type { PrismaClient } from "@admitto/db";
import type { Context } from "hono";
import { resolveIpLocation, type IpLocation } from "../rate-limit/ip-location.js";

/**
 * Who erased an attendee's personal data, and how: read from the central admin audit log, where the erasure wrote
 * the staff member's identity as it was at the time (it survives the deletion of that user), and the attendee's id
 * and nothing else about them. The staff member's name, the way in and the address are the staff member's data,
 * kept for accountability; the erased person's data is not in it.
 */
export type AttendeeErasureRecord = {
  /** The staff member as the entry snapshotted them. Null when it kept neither a name nor an address. */
  by: { display_name: string | null; email: string | null } | null;
  /** Through what: the staff API (the admin screens use it too), or the emergency command line. */
  via: "admin" | "cli";
  /** The zone the staff member was in, which the Activity log of every attendee tells their times in. */
  timezone: string | null;
  /**
   * Where from: the address of the request and where it is. Only for a viewer who may read the audit log (a
   * Superadmin), who finds the same two there, and never for the command line, whose address in the log is a placeholder.
   */
  ip: string | null;
  location: IpLocation | null;
};

type ErasureAuditRow = {
  actor_display_name: string | null;
  actor_email: string | null;
  actor_timezone: string | null;
  ip: string | null;
  source: string | null;
};

/** The audit row is written in the erasure's own transaction, so this is generous: it only keeps the search small. */
const WINDOW_MS = 60 * 60 * 1000;

/**
 * The first erasure entry of the audit log that names this attendee (a repeat of the request writes none), or null
 * when there is none (an operator cleared the log).
 */
export async function loadAttendeeErasureRecord(
  db: PrismaClient,
  input: { organizationId: string; eventId: string; attendeeId: string; erasedAt: Date; includeLocation: boolean },
): Promise<AttendeeErasureRecord | null> {
  const { organizationId, eventId, attendeeId, erasedAt, includeLocation } = input;
  const from = new Date(erasedAt.getTime() - WINDOW_MS);
  const to = new Date(erasedAt.getTime() + WINDOW_MS);
  const rows = await db.$queryRaw<ErasureAuditRow[]>`
    SELECT "actor_display_name", "actor_email", "actor_timezone", "ip", "metadata"->>'source' AS "source"
    FROM "AdminAuditLog"
    WHERE "organization_id" = ${organizationId}
      AND "action_type" IN ('attendee_erased', 'attendees_bulk_erased')
      AND "created_at" BETWEEN ${from} AND ${to}
      AND "metadata"->>'method' = 'erase'
      AND "metadata"->>'event_id' = ${eventId}
      AND ("metadata"->>'attendee_id' = ${attendeeId} OR "metadata"->'attendee_ids' @> to_jsonb(${attendeeId}::text))
    ORDER BY "created_at" ASC
    LIMIT 1`;
  const row = rows[0];
  if (!row) return null;
  const hasIdentity = row.actor_display_name !== null || row.actor_email !== null;
  const via = row.source === "cli" ? "cli" : "admin";
  // The command line writes a placeholder address and a request without a socket "unknown": neither is a place.
  const ip = includeLocation && via === "admin" && row.ip !== null && isIP(row.ip) !== 0 ? row.ip : null;
  return {
    by: hasIdentity ? { display_name: row.actor_display_name, email: row.actor_email } : null,
    via,
    timezone: row.actor_timezone,
    ip,
    location: ip === null ? null : resolveIpLocation(ip),
  };
}

/**
 * The record for the page of an erased attendee, as this viewer may read it: the address and its location only for a
 * Superadmin, the only role that can read the audit log they come from. Null for an attendee that is not erased.
 */
export async function loadAttendeeErasureRecordForViewer(
  c: Context,
  db: PrismaClient,
  input: { eventId: string; attendeeId: string; erasedAt: Date | null },
): Promise<AttendeeErasureRecord | null> {
  if (!input.erasedAt) return null;
  const event = await db.event.findUnique({ where: { id: input.eventId }, select: { organization_id: true } });
  if (!event) return null;
  return loadAttendeeErasureRecord(db, {
    organizationId: event.organization_id,
    eventId: input.eventId,
    attendeeId: input.attendeeId,
    erasedAt: input.erasedAt,
    includeLocation: await canManageInstance(db, c.get("auth").userId),
  });
}
