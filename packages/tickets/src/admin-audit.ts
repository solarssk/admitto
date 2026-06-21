import type { Prisma, PrismaClient } from "@prisma/client";

export type AdminAuditWriteInput = {
  organizationId?: string | null;
  actorUserId: string;
  sessionId?: string | null;
  ip?: string | null;
  actionType: string;
  metadata?: Record<string, unknown>;
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
    },
  });
}
