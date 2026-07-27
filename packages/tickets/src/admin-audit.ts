import type { Prisma, PrismaClient } from "@prisma/client";

export type AdminAuditWriteInput = {
  organizationId?: string | null;
  actorUserId: string;
  sessionId?: string | null;
  ip?: string | null;
  actionType: string;
  metadata?: Record<string, unknown>;
  timezone?: string | null;
};

/** Append an instance/org-scoped admin audit row (ADR 0031). */
export async function writeAdminAuditLog(
  db: PrismaClient | Prisma.TransactionClient,
  data: AdminAuditWriteInput,
): Promise<void> {
  await db.adminAuditLog.create({
    data: {
      organization_id: data.organizationId ?? null,
      actor_user_id: data.actorUserId,
      action_type: data.actionType,
      session_id: data.sessionId ?? null,
      ip: data.ip ?? null,
      metadata: (data.metadata ?? undefined) as Prisma.InputJsonValue | undefined,
      actor_timezone: data.timezone ?? null,
    },
  });
}

/** Same as `writeAdminAuditLog`, but never throws. For call sites where the audited
 * action (a file save, a completed mutation run outside the same transaction) has
 * already succeeded, so a transient audit-write failure must not turn that success
 * into a client-visible error. Logs to stdout on failure instead of rethrowing. */
export async function writeAdminAuditLogBestEffort(
  db: PrismaClient | Prisma.TransactionClient,
  data: AdminAuditWriteInput,
): Promise<void> {
  try {
    await writeAdminAuditLog(db, data);
  } catch (err) {
    console.error(
      JSON.stringify({
        event: "admin_audit_log.write_failed",
        action_type: data.actionType,
        error: err instanceof Error ? err.message : String(err),
        ts: new Date().toISOString(),
      }),
    );
  }
}
