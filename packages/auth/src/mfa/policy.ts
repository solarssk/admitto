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

/**
 * True when a sensitive re-auth action (OIDC link, MFA reset, ...) must require a TOTP/recovery
 * step-up code, not just a password: the user's role requires MFA and they have TOTP confirmed.
 */
export async function userRequiresMfaStepUp(
  prisma: PrismaClient | Prisma.TransactionClient,
  userId: string,
): Promise<boolean> {
  return (await userRequiresMfa(prisma, userId)) && (await userHasConfirmedTotp(prisma, userId));
}

/**
 * True when the user has a confirmed TOTP method whose backup recovery codes
 * were never acknowledged. Persisted server-side so the acknowledgment gate
 * survives a fresh login and works across multiple processes (IAM-002).
 */
export async function userHasUnacknowledgedBackupCodes(
  prisma: PrismaClient | Prisma.TransactionClient,
  userId: string,
): Promise<boolean> {
  const row = await prisma.userMfaMethod.findFirst({
    where: {
      user_id: userId,
      type: "totp",
      confirmed_at: { not: null },
      backup_codes_acknowledged_at: null,
    },
    select: { id: true },
  });
  return row !== null;
}

/** Record that the user acknowledged their backup recovery codes (idempotent). */
export async function markBackupCodesAcknowledged(
  prisma: PrismaClient | Prisma.TransactionClient,
  userId: string,
): Promise<void> {
  await prisma.userMfaMethod.updateMany({
    where: {
      user_id: userId,
      type: "totp",
      confirmed_at: { not: null },
      backup_codes_acknowledged_at: null,
    },
    data: { backup_codes_acknowledged_at: new Date() },
  });
}
