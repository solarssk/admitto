import type { PrismaClient, Prisma } from "@admitto/db";
import { verifyUserTotpCodeDetailed } from "./enrollment.js";
import { findBackupRecoveryRowId } from "./backup-recovery.js";
import { findEmergencyRecoveryRowId } from "./emergency-recovery.js";
import { consumeRecoveryRow } from "./recovery-consume.js";

/**
 * Result of a step-up code check: which method matched, or why it didn't.
 * `no_match` is a code that never matched any method; `consume_conflict` is a
 * recovery code that matched but lost a race to consume the row (already used).
 * `method` is narrower than the full `MfaMethod` union (from `../audit.js`) - a code check can
 * only ever match "totp", "backup", or "emergency", never "webauthn".
 * `totpReplay` is only ever true alongside `reason: "no_match"` - a `code` that matched neither
 * a fresh TOTP window nor a recovery code, specifically because it was a cryptographically valid
 * TOTP code that had already been used (see `verifyUserTotpCodeDetailed`'s own doc comment).
 */
export type StepUpCodeResult =
  | { ok: true; method: "totp" | "backup" | "emergency" }
  | { ok: false; reason: "no_match"; totpReplay: boolean }
  | { ok: false; reason: "consume_conflict" };

/** Verify a TOTP code, or consume a backup/emergency recovery code, for step-up re-auth. */
export async function verifyTotpOrRecoveryCodeDetailed(
  prisma: PrismaClient | Prisma.TransactionClient,
  userId: string,
  code: string,
): Promise<StepUpCodeResult> {
  const trimmed = code.trim();
  if (!trimmed) return { ok: false, reason: "no_match", totpReplay: false };

  const totpResult = await verifyUserTotpCodeDetailed(prisma, userId, trimmed);
  if (totpResult.ok) {
    return { ok: true, method: "totp" };
  }

  let recoveryRowId = await findBackupRecoveryRowId(prisma, userId, trimmed);
  let recoveryMethod: "backup" | "emergency" = "backup";
  if (!recoveryRowId) {
    recoveryRowId = await findEmergencyRecoveryRowId(prisma, userId, trimmed);
    recoveryMethod = "emergency";
  }
  if (!recoveryRowId) return { ok: false, reason: "no_match", totpReplay: totpResult.replay };

  const consumed = await consumeRecoveryRow(prisma, recoveryRowId);
  if (!consumed) return { ok: false, reason: "consume_conflict" };

  return { ok: true, method: recoveryMethod };
}

/** Boolean-only convenience wrapper around {@link verifyTotpOrRecoveryCodeDetailed}. */
export async function verifyTotpOrRecoveryCode(
  prisma: PrismaClient | Prisma.TransactionClient,
  userId: string,
  code: string,
): Promise<boolean> {
  return (await verifyTotpOrRecoveryCodeDetailed(prisma, userId, code)).ok;
}
