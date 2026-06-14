import type { PrismaClient, Prisma } from "@prisma/client";
import { verifyRecoveryCode } from "./recovery-hash.js";

/** Atomically mark a recovery row used; returns false if already consumed. */
export async function consumeRecoveryRow(
  prisma: PrismaClient | Prisma.TransactionClient,
  rowId: string,
): Promise<boolean> {
  const result = await prisma.userMfaMethod.updateMany({
    where: { id: rowId, last_used_at: null },
    data: { last_used_at: new Date() },
  });
  return result.count === 1;
}

/**
 * Find matching recovery row and consume once.
 * Scans all candidates sequentially (not in parallel) to avoid argon2 timing side-channels.
 */
export async function verifyAndConsumeRecoveryRow(
  prisma: PrismaClient | Prisma.TransactionClient,
  candidates: { id: string; credential_hash: string | null }[],
  normalizedCode: string,
): Promise<boolean> {
  let matchedId: string | null = null;
  for (const row of candidates) {
    if (!row.credential_hash) continue;
    const ok = await verifyRecoveryCode(normalizedCode, row.credential_hash);
    if (ok && matchedId === null) matchedId = row.id;
  }
  if (!matchedId) return false;
  return consumeRecoveryRow(prisma, matchedId);
}
