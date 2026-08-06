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

export async function assertLastSuperadminDeactivationAllowed(tx: Prisma.TransactionClient, userId: string): Promise<void> {
  if (!(await targetIsSuperadmin(tx, userId))) return;
  const superadmins = await countSuperadminAssignments(tx);
  if (superadmins <= 1) throw new LastSuperadminError();
}

/** Unlike deactivation, deleting an already-inactive superadmin can never reduce the active
 * count - they weren't counted by countSuperadminAssignments (which only counts assignments
 * whose user is_active) in the first place, so this only blocks deleting a currently-active
 * superadmin down to zero. */
export async function assertLastSuperadminDeleteAllowed(tx: Prisma.TransactionClient, userId: string): Promise<void> {
  const activeSuperadmin = await tx.roleAssignment.count({
    where: { user_id: userId, role: "superadmin", scope_type: "instance", scope_id: null, user: { is_active: true } },
  });
  if (activeSuperadmin === 0) return;
  const superadmins = await countSuperadminAssignments(tx);
  if (superadmins <= 1) throw new LastSuperadminError();
}
