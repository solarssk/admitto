import type { PrismaClient, Prisma } from "@admitto/db";
import { BACKUP_RECOVERY_CODE_COUNT, EMERGENCY_RECOVERY_LABEL } from "../constants.js";
import { runInTransaction } from "../prisma-tx.js";
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
  return runInTransaction(prisma, async (tx) => {
    await tx.userMfaMethod.deleteMany({
      where: {
        user_id: userId,
        type: "recovery",
        OR: [{ label: null }, { label: { not: EMERGENCY_RECOVERY_LABEL } }],
      },
    });
    return generateBackupRecoveryCodes(tx, userId);
  });
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
  const candidates = await loadUnusedBackupRecoveryRows(prisma, userId);
  return findMatchingRecoveryRowId(candidates, normalized);
}

/** Verify a full backup-code set for download without consuming rows (single DB read). */
export async function verifyBackupRecoveryCodesSet(
  prisma: PrismaClient | Prisma.TransactionClient,
  userId: string,
  plaintexts: string[],
  expectedCount = BACKUP_RECOVERY_CODE_COUNT,
): Promise<boolean> {
  if (plaintexts.length !== expectedCount) return false;

  const candidates = await loadUnusedBackupRecoveryRows(prisma, userId);
  const matchedRowIds = new Set<string>();

  for (const plaintext of plaintexts) {
    const normalized = normalizeRecoveryCode(plaintext);
    const rowId = await findMatchingRecoveryRowId(candidates, normalized);
    if (!rowId || matchedRowIds.has(rowId)) return false;
    matchedRowIds.add(rowId);
  }

  return matchedRowIds.size === expectedCount;
}

async function loadUnusedBackupRecoveryRows(
  prisma: PrismaClient | Prisma.TransactionClient,
  userId: string,
): Promise<{ id: string; credential_hash: string | null }[]> {
  return prisma.userMfaMethod.findMany({
    where: {
      user_id: userId,
      type: "recovery",
      last_used_at: null,
      OR: [{ label: null }, { label: { not: EMERGENCY_RECOVERY_LABEL } }],
    },
    select: { id: true, credential_hash: true },
  });
}
