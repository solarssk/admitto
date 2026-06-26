import type { Prisma, PrismaClient } from "@prisma/client";

export interface PurgeAuthRetentionOptions {
  now?: Date;
  dryRun?: boolean;
}

export interface PurgeAuthRetentionResult {
  sessions: number;
  trustedDevices: number;
}

function expiredOrRevokedWhere(now: Date) {
  return {
    OR: [{ expires_at: { lte: now } }, { revoked_at: { lte: now } }],
  };
}

/**
 * Remove auth state that can no longer grant access. This keeps the live-session
 * and trusted-device tables bounded without touching users, roles, or audit logs.
 */
export async function purgeAuthRetention(
  prisma: PrismaClient | Prisma.TransactionClient,
  options: PurgeAuthRetentionOptions = {},
): Promise<PurgeAuthRetentionResult> {
  const now = options.now ?? new Date();
  const where = expiredOrRevokedWhere(now);

  if (options.dryRun) {
    const sessions = await prisma.session.count({ where });
    const trustedDevices = await prisma.trustedDevice.count({ where });
    return { sessions, trustedDevices };
  }

  const sessions = await prisma.session.deleteMany({ where });
  const trustedDevices = await prisma.trustedDevice.deleteMany({ where });

  return { sessions: sessions.count, trustedDevices: trustedDevices.count };
}
