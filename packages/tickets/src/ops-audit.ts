import type { PrismaClient } from "@admitto/db";
import { Prisma } from "@admitto/db/client";
import { lockAttendeeRow } from "./attendee-lock.js";

/** Prisma client or an active transaction — both support `attendeeActionLog.create`. */
type OpsAuditDb = PrismaClient | Prisma.TransactionClient;

/** Audit context attached to every event-day mutation (ADR 0010). */
export type OpsAuditContext = {
  operator?: string;
  sessionId?: string;
  deviceId?: string;
  ip?: string;
  /** Acting client's IANA timezone at write time, when known (browser-triggered writes only). */
  timezone?: string;
};

/** Append an event-scoped audit row without a single attendee (e.g. bulk import). */
export async function writeBulkActionLog(
  tx: OpsAuditDb,
  data: {
    event_id: string;
    action_type: string;
    audit: OpsAuditContext;
    metadata?: Record<string, unknown>;
  },
): Promise<void> {
  await tx.attendeeActionLog.create({
    data: {
      event_id: data.event_id,
      attendee_id: null,
      action_type: data.action_type,
      actor_user_id: data.audit.operator ?? null,
      session_id: data.audit.sessionId ?? null,
      device_id: data.audit.deviceId ?? null,
      ip: data.audit.ip ?? null,
      client_timezone: data.audit.timezone ?? null,
      metadata: (data.metadata ?? undefined) as Prisma.InputJsonValue | undefined,
    },
  });
}

/** Append one per-attendee audit row for each entry in a single statement — the bulk-mutation
 * counterpart of writeActionLog below (same audit-context field mapping, one createMany
 * instead of N inserts). */
export async function writeActionLogMany(
  tx: Prisma.TransactionClient,
  data: {
    event_id: string;
    action_type: string;
    audit: OpsAuditContext;
    entries: { attendee_id: string; metadata?: Record<string, unknown> }[];
  },
): Promise<void> {
  if (data.entries.length === 0) return;
  // An erased attendee has no activity trail: a log entry written after the erasure (by a request
  // that started before it) would bring one back. Locked in id order, like the erasure itself.
  const states = await tx.$queryRaw<{ id: string; erased_at: Date | null }[]>`
    SELECT "id", "erased_at" FROM "Attendee"
    WHERE "id" IN (${Prisma.join([...new Set(data.entries.map((entry) => entry.attendee_id))])})
    ORDER BY "id" FOR KEY SHARE
  `;
  const erased = new Set(states.filter((state) => state.erased_at !== null).map((state) => state.id));
  const entries = data.entries.filter((entry) => !erased.has(entry.attendee_id));
  if (entries.length === 0) return;
  await tx.attendeeActionLog.createMany({
    data: entries.map((entry) => ({
      event_id: data.event_id,
      attendee_id: entry.attendee_id,
      action_type: data.action_type,
      actor_user_id: data.audit.operator ?? null,
      session_id: data.audit.sessionId ?? null,
      device_id: data.audit.deviceId ?? null,
      ip: data.audit.ip ?? null,
      client_timezone: data.audit.timezone ?? null,
      metadata: (entry.metadata ?? undefined) as Prisma.InputJsonValue | undefined,
    })),
  });
}

export async function writeActionLog(
  tx: Prisma.TransactionClient,
  data: {
    event_id: string;
    attendee_id: string;
    action_type: string;
    audit: OpsAuditContext;
    metadata?: Record<string, unknown>;
  },
): Promise<void> {
  // See writeActionLogMany: nothing is logged for an erased attendee. A missing attendee falls
  // through to the insert, which fails on the foreign key as before.
  // This lock comes late in a transaction that has already written something. One that updated or
  // deleted a row an erasure also writes (wallet pass, check-in, email delivery, note) calls
  // lockAttendeeRow before that write, or it can deadlock with an erasure that holds the attendee
  // and waits for that row. (The insert below would take the same lock through its foreign key.)
  if ((await lockAttendeeRow(tx, data.attendee_id))?.erased) return;
  await tx.attendeeActionLog.create({
    data: {
      event_id: data.event_id,
      attendee_id: data.attendee_id,
      action_type: data.action_type,
      actor_user_id: data.audit.operator ?? null,
      session_id: data.audit.sessionId ?? null,
      device_id: data.audit.deviceId ?? null,
      ip: data.audit.ip ?? null,
      client_timezone: data.audit.timezone ?? null,
      metadata: (data.metadata ?? undefined) as Prisma.InputJsonValue | undefined,
    },
  });
}
