import type { PrismaClient } from "@prisma/client";
import { runInTransaction } from "./prisma-tx.js";

export interface PurgeAllSessionsOptions {
  dryRun?: boolean;
}

export interface PurgeAllSessionsResult {
  sessionsRevoked: number;
  trustedDevicesRevoked: number;
}

/**
 * Emergency break-glass: revoke all active sessions and trusted devices instance-wide.
 * Unlike {@link purgeAuthRetention}, this targets live (non-revoked) rows, not expired cleanup.
 */
export async function purgeAllSessions(
  prisma: PrismaClient,
  options: PurgeAllSessionsOptions = {},
): Promise<PurgeAllSessionsResult> {
  const sessionWhere = { revoked_at: null };
  const deviceWhere = { revoked_at: null };

  if (options.dryRun) {
    const [sessionsRevoked, trustedDevicesRevoked] = await Promise.all([
      prisma.session.count({ where: sessionWhere }),
      prisma.trustedDevice.count({ where: deviceWhere }),
    ]);
    return { sessionsRevoked, trustedDevicesRevoked };
  }

  return runInTransaction(prisma, async (tx) => {
    const sessions = await tx.session.updateMany({
      where: sessionWhere,
      data: { revoked_at: new Date() },
    });
    const devices = await tx.trustedDevice.updateMany({
      where: deviceWhere,
      data: { revoked_at: new Date() },
    });
    return {
      sessionsRevoked: sessions.count,
      trustedDevicesRevoked: devices.count,
    };
  });
}
