import type { PrismaClient, Prisma } from "@prisma/client";
import { getMfaRequiredRoles } from "../settings/resolver.js";

/** True when user has any role assignment in the MFA-required set. */
export async function userRequiresMfa(
  prisma: PrismaClient | Prisma.TransactionClient,
  userId: string,
): Promise<boolean> {
  const requiredRoles = await getMfaRequiredRoles(prisma);
  if (requiredRoles.length === 0) return false;

  const assignments = await prisma.roleAssignment.findMany({
    where: { user_id: userId },
    select: { role: true },
  });

  return assignments.some((a) => requiredRoles.includes(a.role));
}

/** True when user has a confirmed TOTP method. */
export async function userHasConfirmedTotp(
  prisma: PrismaClient | Prisma.TransactionClient,
  userId: string,
): Promise<boolean> {
  const row = await prisma.userMfaMethod.findFirst({
    where: {
      user_id: userId,
      type: "totp",
      confirmed_at: { not: null },
    },
    select: { id: true },
  });
  return row !== null;
}
