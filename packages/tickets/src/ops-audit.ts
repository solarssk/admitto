import type { Prisma } from "@prisma/client";

/** Audit context attached to every event-day mutation (ADR 0010). */
export type OpsAuditContext = {
  operator?: string;
  sessionId?: string;
  deviceId?: string;
  ip?: string;
};

/** Append an event-scoped audit row without a single attendee (e.g. bulk import). */
export async function writeBulkActionLog(
  tx: Prisma.TransactionClient,
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
      metadata: (data.metadata ?? undefined) as Prisma.InputJsonValue | undefined,
    },
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
  await tx.attendeeActionLog.create({
    data: {
      event_id: data.event_id,
      attendee_id: data.attendee_id,
      action_type: data.action_type,
      actor_user_id: data.audit.operator ?? null,
      session_id: data.audit.sessionId ?? null,
      device_id: data.audit.deviceId ?? null,
      ip: data.audit.ip ?? null,
      metadata: (data.metadata ?? undefined) as Prisma.InputJsonValue | undefined,
    },
  });
}
