import type { PrismaClient, Prisma } from "@prisma/client";
import { verifyUserTotpCode } from "./enrollment.js";
import { findBackupRecoveryRowId } from "./backup-recovery.js";
import { findEmergencyRecoveryRowId } from "./emergency-recovery.js";
import { consumeRecoveryRow } from "./recovery-consume.js";

/** Verify a TOTP code, or consume a backup/emergency recovery code, for step-up re-auth. */
export async function verifyTotpOrRecoveryCode(
  prisma: PrismaClient | Prisma.TransactionClient,
  userId: string,
  code: string,
): Promise<boolean> {
  const trimmed = code.trim();
  if (!trimmed) return false;

  if (await verifyUserTotpCode(prisma, userId, trimmed)) {
    return true;
  }

  let recoveryRowId = await findBackupRecoveryRowId(prisma, userId, trimmed);
  if (!recoveryRowId) {
    recoveryRowId = await findEmergencyRecoveryRowId(prisma, userId, trimmed);
  }
  if (!recoveryRowId) return false;

  return consumeRecoveryRow(prisma, recoveryRowId);
}
