import type { PrismaClient } from "@prisma/client";
import { hasScope } from "@admitto/db";

export class LastSuperadminError extends Error {}

type PrismaTx = Omit<
  PrismaClient,
  "$connect" | "$disconnect" | "$on" | "$transaction" | "$extends" | "$use"
>;

export async function countSuperadminAssignments(db: PrismaClient | PrismaTx): Promise<number> {
  return db.roleAssignment.count({
    where: {
      role: "superadmin",
      scope_type: "instance",
      scope_id: null,
      user: { is_active: true },
    },
  });
}

async function targetIsSuperadmin(db: PrismaClient | PrismaTx, userId: string): Promise<boolean> {
  return hasScope(db, userId, "superadmin", "instance");
}

export async function assertLastSuperadminRemovalAllowed(
  tx: PrismaTx,
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

export async function assertLastSuperadminDeactivationAllowed(tx: PrismaTx, userId: string): Promise<void> {
  if (!(await targetIsSuperadmin(tx, userId))) return;
  const superadmins = await countSuperadminAssignments(tx);
  if (superadmins <= 1) throw new LastSuperadminError();
}
