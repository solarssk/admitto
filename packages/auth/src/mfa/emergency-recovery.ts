import type { PrismaClient, Prisma } from "@prisma/client";
import { EMERGENCY_RECOVERY_LABEL } from "../constants.js";
import {
  generateRecoveryCodePlaintext,
  hashRecoveryCode,
  normalizeRecoveryCode,
} from "./recovery-hash.js";
import { verifyAndConsumeRecoveryRow } from "./recovery-consume.js";

export interface EmergencyRecoveryResult {
  /** Plaintext code — show once on stdout for break-glass CLI. */
  code: string;
}

/**
 * Generate a single emergency break-glass recovery code for a locked-out superadmin.
 * Distinct from backup codes at enrollment (label = emergency).
 */
export async function generateEmergencyRecoveryCode(
  prisma: PrismaClient | Prisma.TransactionClient,
  userId: string,
): Promise<EmergencyRecoveryResult> {
  await prisma.userMfaMethod.deleteMany({
    where: {
      user_id: userId,
      type: "recovery",
      label: EMERGENCY_RECOVERY_LABEL,
      last_used_at: null,
    },
  });

  const code = generateRecoveryCodePlaintext();
  await prisma.userMfaMethod.create({
    data: {
      user_id: userId,
      type: "recovery",
      credential_hash: await hashRecoveryCode(code),
      label: EMERGENCY_RECOVERY_LABEL,
    },
  });

  return { code };
}

/** Verify and consume emergency recovery code. */
export async function verifyEmergencyRecoveryCode(
  prisma: PrismaClient | Prisma.TransactionClient,
  userId: string,
  plaintext: string,
): Promise<boolean> {
  const normalized = normalizeRecoveryCode(plaintext);
  const rows = await prisma.userMfaMethod.findMany({
    where: {
      user_id: userId,
      type: "recovery",
      label: EMERGENCY_RECOVERY_LABEL,
      last_used_at: null,
    },
  });

  return verifyAndConsumeRecoveryRow(prisma, rows, normalized);
}
