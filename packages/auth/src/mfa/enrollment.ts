import type { PrismaClient, Prisma } from "@prisma/client";
import { findUserById } from "../user.js";
import {
  buildTotpOtpauthUri,
  encryptTotpSecret,
  generateTotpSecret,
  verifyTotpCode,
} from "./totp.js";
import { generateBackupRecoveryCodes } from "./backup-recovery.js";

export interface StartTotpEnrollmentResult {
  otpauthUri: string;
  backupCodes: string[];
}

/**
 * Start TOTP enrollment: create unconfirmed totp row + backup codes.
 * Returns otpauth URI and backup codes once — never log or persist plaintext secret.
 */
export async function startTotpEnrollment(
  prisma: PrismaClient | Prisma.TransactionClient,
  userId: string,
): Promise<StartTotpEnrollmentResult | null> {
  const user = await findUserById(prisma, userId);
  if (!user) return null;

  const secret = generateTotpSecret();
  const secret_enc = encryptTotpSecret(secret);

  await prisma.userMfaMethod.deleteMany({
    where: { user_id: userId, type: "totp" },
  });
  await prisma.userMfaMethod.deleteMany({
    where: {
      user_id: userId,
      type: "recovery",
      label: null,
    },
  });

  await prisma.userMfaMethod.create({
    data: {
      user_id: userId,
      type: "totp",
      secret_enc,
      confirmed_at: null,
    },
  });

  const { codes: backupCodes } = await generateBackupRecoveryCodes(prisma, userId);
  const otpauthUri = buildTotpOtpauthUri(secret, user.email);

  return { otpauthUri, backupCodes };
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
  await prisma.userMfaMethod.deleteMany({ where: { user_id: userId } });
  await prisma.session.updateMany({
    where: { user_id: userId, revoked_at: null },
    data: { revoked_at: new Date() },
  });
  await prisma.trustedDevice.updateMany({
    where: { user_id: userId, revoked_at: null },
    data: { revoked_at: new Date() },
  });
}
