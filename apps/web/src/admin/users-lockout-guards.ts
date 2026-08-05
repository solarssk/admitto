import type { PrismaClient, Prisma } from "@admitto/db";
import { hasScope } from "@admitto/db";

export class LastSuperadminError extends Error {}

export async function countSuperadminAssignments(
  db: PrismaClient | Prisma.TransactionClient,
): Promise<number> {
  return db.roleAssignment.count({
    where: {
      role: "superadmin",
      scope_type: "instance",
      scope_id: null,
      user: { is_active: true },
    },
  });
}

async function targetIsSuperadmin(db: PrismaClient | Prisma.TransactionClient, userId: string): Promise<boolean> {
  return hasScope(db, userId, "superadmin", "instance");
}

async function targetIsActive(db: PrismaClient | Prisma.TransactionClient, userId: string): Promise<boolean> {
  const user = await db.user.findUnique({ where: { id: userId }, select: { is_active: true } });
  return user?.is_active ?? false;
}

export async function assertLastSuperadminRemovalAllowed(
  tx: Prisma.TransactionClient,
  assignment: { id: string; role: string; scope_type: string; scope_id: string | null },
): Promise<void> {
  if (assignment.role !== "superadmin" || assignment.scope_type !== "instance" || assignment.scope_id !== null) {
    return;
  }
  const removesActiveSuperadmin = await tx.roleAssignment.count({
    where: { id: assignment.id, user: { is_active: true } },
  });
  if (removesActiveSuperadmin === 0) return;
  const superadmins = await countSuperadminAssignments(tx);
  if (superadmins <= 1) throw new LastSuperadminError();
}

/** Blocks an action (deactivate or delete) that would drop the active-superadmin count to
 * zero. Only relevant when the target is currently active and a superadmin - an already
 * inactive superadmin doesn't count toward that total either way, so deactivating (again) or
 * deleting one never reduces it, mirroring assertLastSuperadminRemovalAllowed's own
 * "does this actually remove an active superadmin" check. */
export async function assertLastSuperadminDeactivationAllowed(tx: Prisma.TransactionClient, userId: string): Promise<void> {
  if (!(await targetIsActive(tx, userId))) return;
  if (!(await targetIsSuperadmin(tx, userId))) return;
  const superadmins = await countSuperadminAssignments(tx);
  if (superadmins <= 1) throw new LastSuperadminError();
}
