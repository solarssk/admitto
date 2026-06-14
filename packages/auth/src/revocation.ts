import type { PrismaClient, Prisma } from "@prisma/client";
import { revokeAllTrustedDevicesForUser } from "./mfa/trusted-device.js";
import { runInTransaction } from "./prisma-tx.js";

/** Revoke all sessions and trusted devices for a user (password change, MFA reset, deactivation). */
export async function revokeUserAuthState(
  prisma: PrismaClient | Prisma.TransactionClient,
  userId: string,
): Promise<{ sessionsRevoked: number; trustedDevicesRevoked: number }> {
  return runInTransaction(prisma, async (tx) => {
    const sessions = await tx.session.updateMany({
      where: { user_id: userId, revoked_at: null },
      data: { revoked_at: new Date() },
    });
    const trustedDevicesRevoked = await revokeAllTrustedDevicesForUser(tx, userId);
    return { sessionsRevoked: sessions.count, trustedDevicesRevoked };
  });
}
