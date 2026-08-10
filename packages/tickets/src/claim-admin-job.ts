/**
 * Atomically claim the oldest pending AdminJob of a given type.
 * Shared by import and export worker drains (avoids copy-paste Sonar duplication).
 */
import type { PrismaClient } from "@admitto/db";

export async function claimNextAdminJob(db: PrismaClient, type: string) {
  const pending = await db.adminJob.findFirst({
    where: { type, status: "pending" },
    orderBy: { created_at: "asc" },
  });
  if (!pending) return null;

  const updated = await db.adminJob.updateMany({
    where: { id: pending.id, status: "pending" },
    data: { status: "running", started_at: new Date() },
  });
  if (updated.count === 0) return null;
  return db.adminJob.findUniqueOrThrow({ where: { id: pending.id } });
}
