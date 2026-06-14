import type { PrismaClient, Prisma } from "@prisma/client";
import { EMERGENCY_RECOVERY_LABEL } from "../constants.js";
import { findUserById } from "../user.js";
import { userHasConfirmedTotp } from "./policy.js";
import {
  buildTotpOtpauthUri,
  decryptTotpSecret,
  encryptTotpSecret,
  generateTotpSecret,
  verifyTotpCode,
} from "./totp.js";
import { generateBackupRecoveryCodes } from "./backup-recovery.js";
import { runInTransaction } from "../prisma-tx.js";

export interface StartTotpEnrollmentResult {
  /** otpauth:// URI for authenticator app setup (shown once). */
  otpauthUri: string;
  /** Plaintext backup codes (shown once at fresh enrollment). */
  backupCodes: string[];
  /** True when resuming in-progress enrollment (backup codes were already shown). */
  backupCodesAlreadyShown?: boolean;
}

const BACKUP_RECOVERY_DELETE_FILTER = {
  type: "recovery" as const,
  OR: [{ label: null }, { label: { not: EMERGENCY_RECOVERY_LABEL } }],
};

/**
 * Start TOTP enrollment: create unconfirmed totp row + backup codes (transactional).
 * Refuses when user already has confirmed TOTP.
 */
export async function startTotpEnrollment(
  prisma: PrismaClient,
  userId: string,
): Promise<StartTotpEnrollmentResult | null> {
  const user = await findUserById(prisma, userId);
  if (!user) return null;
  if (await userHasConfirmedTotp(prisma, userId)) return null;

  const secret = generateTotpSecret();
  const secret_enc = encryptTotpSecret(secret);
  const otpauthUri = buildTotpOtpauthUri(secret, user.email);

  return prisma.$transaction(async (tx) => {
    if (await userHasConfirmedTotp(tx, userId)) return null;

    await tx.userMfaMethod.deleteMany({
      where: { user_id: userId, type: "totp" },
    });
    await tx.userMfaMethod.deleteMany({
      where: { user_id: userId, ...BACKUP_RECOVERY_DELETE_FILTER },
    });

    await tx.userMfaMethod.create({
      data: {
        user_id: userId,
        type: "totp",
        secret_enc,
        confirmed_at: null,
      },
    });

    const { codes: backupCodes } = await generateBackupRecoveryCodes(tx, userId);
    return { otpauthUri, backupCodes };
  });
}

/**
 * Resume pending enrollment without creating or rotating secrets (read-only).
 * Returns null when no unconfirmed TOTP row exists.
 */
export async function resumePendingTotpEnrollment(
  prisma: PrismaClient | Prisma.TransactionClient,
  userId: string,
): Promise<StartTotpEnrollmentResult | null> {
  if (await userHasConfirmedTotp(prisma, userId)) return null;

  const pending = await prisma.userMfaMethod.findFirst({
    where: { user_id: userId, type: "totp", confirmed_at: null },
  });

  if (!pending?.secret_enc) return null;

  const user = await findUserById(prisma, userId);
  if (!user) return null;

  try {
    const secret = decryptTotpSecret(pending.secret_enc);
    return {
      otpauthUri: buildTotpOtpauthUri(secret, user.email),
      backupCodes: [],
      backupCodesAlreadyShown: true,
    };
  } catch {
    await prisma.userMfaMethod.deleteMany({
      where: { user_id: userId, type: "totp", confirmed_at: null },
    });
    await prisma.userMfaMethod.deleteMany({
      where: { user_id: userId, ...BACKUP_RECOVERY_DELETE_FILTER },
    });
    return null;
  }
}

/**
 * Resume pending enrollment without rotating secret/codes, or start fresh if none pending.
 */
export async function getOrStartTotpEnrollment(
  prisma: PrismaClient,
  userId: string,
): Promise<StartTotpEnrollmentResult | null> {
  if (await userHasConfirmedTotp(prisma, userId)) return null;

  const resumed = await resumePendingTotpEnrollment(prisma, userId);
  if (resumed) return resumed;

  return startTotpEnrollment(prisma, userId);
}

/** Confirm TOTP enrollment with a valid code. */
export async function confirmTotpEnrollment(
  prisma: PrismaClient | Prisma.TransactionClient,
  userId: string,
  code: string,
): Promise<boolean> {
  const row = await prisma.userMfaMethod.findFirst({
    where: { user_id: userId, type: "totp", confirmed_at: null },
  });
  if (!row?.secret_enc) return false;
  if (!verifyTotpCode(row.secret_enc, code)) return false;

  await prisma.userMfaMethod.update({
    where: { id: row.id },
    data: { confirmed_at: new Date() },
  });
  return true;
}

/** Verify TOTP for login step (confirmed method only). */
export async function verifyUserTotpCode(
  prisma: PrismaClient | Prisma.TransactionClient,
  userId: string,
  code: string,
): Promise<boolean> {
  const row = await prisma.userMfaMethod.findFirst({
    where: {
      user_id: userId,
      type: "totp",
      confirmed_at: { not: null },
    },
  });
  if (!row?.secret_enc) return false;
  const ok = verifyTotpCode(row.secret_enc, code);
  if (ok) {
    await prisma.userMfaMethod.update({
      where: { id: row.id },
      data: { last_used_at: new Date() },
    });
  }
  return ok;
}

/** Remove all MFA methods, revoke sessions and trusted devices (break-glass). */
export async function resetUserMfa(
  prisma: PrismaClient | Prisma.TransactionClient,
  userId: string,
): Promise<void> {
  await runInTransaction(prisma, async (tx) => {
    await tx.userMfaMethod.deleteMany({ where: { user_id: userId } });
    await tx.session.updateMany({
      where: { user_id: userId, revoked_at: null },
      data: { revoked_at: new Date() },
    });
    await tx.trustedDevice.updateMany({
      where: { user_id: userId, revoked_at: null },
      data: { revoked_at: new Date() },
    });
  });
}
