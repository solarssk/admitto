import type { PrismaClient, Prisma } from "@prisma/client";
import { BACKUP_RECOVERY_CODE_COUNT, EMERGENCY_RECOVERY_LABEL } from "../constants.js";
import {
  generateRecoveryCodePlaintext,
  hashRecoveryCode,
  normalizeRecoveryCode,
} from "./recovery-hash.js";
import { verifyAndConsumeRecoveryRow, findMatchingRecoveryRowId } from "./recovery-consume.js";

export interface BackupRecoveryCodesResult {
  /** Plaintext codes — return to client once only. */
  codes: string[];
}

/** Generate N backup recovery code rows (hashed) for a user. */
export async function generateBackupRecoveryCodes(
  prisma: PrismaClient | Prisma.TransactionClient,
  userId: string,
  count = BACKUP_RECOVERY_CODE_COUNT,
): Promise<BackupRecoveryCodesResult> {
  const codes: string[] = [];
  const rows: { user_id: string; type: string; credential_hash: string }[] = [];

  for (let i = 0; i < count; i++) {
    const plaintext = generateRecoveryCodePlaintext();
    codes.push(plaintext);
    rows.push({
      user_id: userId,
      type: "recovery",
      credential_hash: await hashRecoveryCode(plaintext),
    });
  }

  await prisma.userMfaMethod.createMany({ data: rows });
  return { codes };
}

/** Delete unused backup recovery rows and create new set. */
export async function regenerateBackupRecoveryCodes(
  prisma: PrismaClient | Prisma.TransactionClient,
  userId: string,
): Promise<BackupRecoveryCodesResult> {
  await prisma.userMfaMethod.deleteMany({
    where: {
      user_id: userId,
      type: "recovery",
      OR: [{ label: null }, { label: { not: EMERGENCY_RECOVERY_LABEL } }],
    },
  });
  return generateBackupRecoveryCodes(prisma, userId);
}

/** Verify and consume a backup recovery code (not emergency). */
export async function verifyBackupRecoveryCode(
  prisma: PrismaClient | Prisma.TransactionClient,
  userId: string,
  plaintext: string,
): Promise<boolean> {
  const normalized = normalizeRecoveryCode(plaintext);
  const candidates = await prisma.userMfaMethod.findMany({
    where: {
      user_id: userId,
      type: "recovery",
      last_used_at: null,
      OR: [{ label: null }, { label: { not: EMERGENCY_RECOVERY_LABEL } }],
    },
  });

  return verifyAndConsumeRecoveryRow(prisma, candidates, normalized);
}

/** Locate a matching unused backup recovery row without consuming it. */
export async function findBackupRecoveryRowId(
  prisma: PrismaClient | Prisma.TransactionClient,
  userId: string,
  plaintext: string,
): Promise<string | null> {
  const normalized = normalizeRecoveryCode(plaintext);
  const candidates = await prisma.userMfaMethod.findMany({
    where: {
      user_id: userId,
      type: "recovery",
      last_used_at: null,
      OR: [{ label: null }, { label: { not: EMERGENCY_RECOVERY_LABEL } }],
    },
  });
  return findMatchingRecoveryRowId(candidates, normalized);
}
