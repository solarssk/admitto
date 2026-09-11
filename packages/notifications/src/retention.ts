import type { Prisma, PrismaClient } from "@admitto/db";

/** Runtime controls for the Notification-table retention purge, mirroring
 * @admitto/auth's purgeSecurityAuditLog (same batching/dry-run/retentionDays shape). */
export interface PurgeNotificationsOptions {
  now?: Date;
  dryRun?: boolean;
  batchSize?: number;
  /** Days to keep Notification rows a user never manually cleared. Default 30 (see
   * DATA-PROTECTION.md). */
  retentionDays?: number;
}

/** Number of Notification rows matched or removed by retention cleanup. */
export interface PurgeNotificationsResult {
  deleted: number;
}

const DEFAULT_NOTIFICATION_RETENTION_DAYS = 30;
const DEFAULT_PURGE_BATCH_SIZE = 1000;
// Same reasoning as purgeSecurityAuditLog's own clamp: a fat-fingered "keep forever" value must
// not reach Postgres's timestamp range limits in the cutoff Date arithmetic below.
const MAX_NOTIFICATION_RETENTION_DAYS = 36_500;

function normalizeBatchSize(batchSize: number | undefined): number {
  if (!Number.isFinite(batchSize) || !batchSize || batchSize < 1) return DEFAULT_PURGE_BATCH_SIZE;
  return Math.floor(batchSize);
}

/** Clamp retention days to a positive integer within a sane range, defaulting to 30. */
function normalizeNotificationRetentionDays(retentionDays: number | undefined): number {
  if (!Number.isFinite(retentionDays) || !retentionDays || retentionDays < 1) {
    return DEFAULT_NOTIFICATION_RETENTION_DAYS;
  }
  return Math.min(Math.floor(retentionDays), MAX_NOTIFICATION_RETENTION_DAYS);
}

/** Delete stale Notification rows in bounded batches to avoid one large startup delete. */
async function purgeNotificationBatches(
  prisma: PrismaClient | Prisma.TransactionClient,
  where: Prisma.NotificationWhereInput,
  batchSize: number,
): Promise<number> {
  let count = 0;
  for (;;) {
    const rows = await prisma.notification.findMany({
      where,
      select: { id: true },
      orderBy: { created_at: "asc" },
      take: batchSize,
    });
    if (rows.length === 0) return count;

    const deleted = await prisma.notification.deleteMany({
      where: { id: { in: rows.map((row) => row.id) } },
    });
    count += deleted.count;

    if (rows.length < batchSize) return count;
  }
}

/**
 * Remove Notification rows past the retention window (default 30 days) - a safety net for
 * whoever never uses My Account's own "Clear all" action (packages/notifications/src/inbox.ts's
 * clearAllNotifications), not the primary way notifications are expected to go away. These rows
 * can carry real PII (a name or email in title/body, see PR #1301's own unmasking fix), so unlike
 * AdminAuditLog/SecurityAuditLog - the durable, compliance-relevant record of the underlying
 * security event, entirely unaffected by this purge - they should not accumulate forever.
 */
export async function purgeNotifications(
  prisma: PrismaClient | Prisma.TransactionClient,
  options: PurgeNotificationsOptions = {},
): Promise<PurgeNotificationsResult> {
  const now = options.now ?? new Date();
  const retentionDays = normalizeNotificationRetentionDays(options.retentionDays);
  const cutoff = new Date(now.getTime() - retentionDays * 24 * 60 * 60 * 1000);
  const where: Prisma.NotificationWhereInput = { created_at: { lte: cutoff } };
  const batchSize = normalizeBatchSize(options.batchSize);

  if (options.dryRun) {
    const deleted = await prisma.notification.count({ where });
    return { deleted };
  }

  const deleted = await purgeNotificationBatches(prisma, where, batchSize);
  return { deleted };
}

/** Resolve Notification retention days from an optional environment override. */
export function resolveNotificationRetentionDays(env: NodeJS.ProcessEnv = process.env): number {
  const raw = env["NOTIFICATION_RETENTION_DAYS"]?.trim();
  if (!raw) return DEFAULT_NOTIFICATION_RETENTION_DAYS;
  if (!/^\d+$/.test(raw)) return DEFAULT_NOTIFICATION_RETENTION_DAYS;
  return normalizeNotificationRetentionDays(Number(raw));
}
