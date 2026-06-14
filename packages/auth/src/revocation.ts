import type { PrismaClient, Prisma } from "@prisma/client";
import { revokeAllTrustedDevicesForUser } from "./mfa/trusted-device.js";

/** Revoke all sessions and trusted devices for a user (password change, MFA reset, deactivation). */
export async function revokeUserAuthState(
  prisma: PrismaClient | Prisma.TransactionClient,
  userId: string,
): Promise<{ sessionsRevoked: number; trustedDevicesRevoked: number }> {
  const [sessions, trustedDevicesRevoked] = await Promise.all([
    prisma.session.updateMany({
      where: { user_id: userId, revoked_at: null },
      data: { revoked_at: new Date() },
    }),
    revokeAllTrustedDevicesForUser(prisma, userId),
  ]);

  return { sessionsRevoked: sessions.count, trustedDevicesRevoked };
}
