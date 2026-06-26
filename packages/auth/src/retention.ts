import type { Prisma, PrismaClient } from "@prisma/client";

/** Runtime controls for auth-state retention cleanup. */
export interface PurgeAuthRetentionOptions {
  now?: Date;
  dryRun?: boolean;
  batchSize?: number;
}

/** Number of stale auth-state rows matched or removed by retention cleanup. */
export interface PurgeAuthRetentionResult {
  sessions: number;
  trustedDevices: number;
}

/** Build the shared selector for auth rows that can no longer grant access. */
function expiredOrRevokedWhere(now: Date) {
  return {
    OR: [{ expires_at: { lte: now } }, { revoked_at: { lte: now } }],
  };
}

const DEFAULT_PURGE_BATCH_SIZE = 1000;

/** Clamp an optional caller-provided batch size to a safe positive integer. */
function normalizeBatchSize(batchSize: number | undefined): number {
  if (!Number.isFinite(batchSize) || !batchSize || batchSize < 1) return DEFAULT_PURGE_BATCH_SIZE;
  return Math.floor(batchSize);
}

/** Delete stale session rows in bounded batches to avoid one large startup delete. */
async function purgeSessionBatches(
  prisma: PrismaClient | Prisma.TransactionClient,
  where: ReturnType<typeof expiredOrRevokedWhere>,
  batchSize: number,
): Promise<number> {
  let count = 0;
  for (;;) {
    const rows = await prisma.session.findMany({
      where,
      select: { id: true },
      orderBy: { expires_at: "asc" },
      take: batchSize,
    });
    if (rows.length === 0) return count;

    const deleted = await prisma.session.deleteMany({
      where: { id: { in: rows.map((row) => row.id) } },
    });
    count += deleted.count;

    if (rows.length < batchSize) return count;
  }
}

/** Delete stale trusted-device rows in bounded batches to avoid one large startup delete. */
async function purgeTrustedDeviceBatches(
  prisma: PrismaClient | Prisma.TransactionClient,
  where: ReturnType<typeof expiredOrRevokedWhere>,
  batchSize: number,
): Promise<number> {
  let count = 0;
  for (;;) {
    const rows = await prisma.trustedDevice.findMany({
      where,
      select: { id: true },
      orderBy: { expires_at: "asc" },
      take: batchSize,
    });
    if (rows.length === 0) return count;

    const deleted = await prisma.trustedDevice.deleteMany({
      where: { id: { in: rows.map((row) => row.id) } },
    });
    count += deleted.count;

    if (rows.length < batchSize) return count;
  }
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
  const batchSize = normalizeBatchSize(options.batchSize);

  if (options.dryRun) {
    const sessions = await prisma.session.count({ where });
    const trustedDevices = await prisma.trustedDevice.count({ where });
    return { sessions, trustedDevices };
  }

  const sessions = await purgeSessionBatches(prisma, where, batchSize);
  const trustedDevices = await purgeTrustedDeviceBatches(prisma, where, batchSize);

  return { sessions, trustedDevices };
}
