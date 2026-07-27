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

/** Runtime controls for the durable security-audit-log retention purge (issue #473). */
export interface PurgeSecurityAuditLogOptions {
  now?: Date;
  dryRun?: boolean;
  batchSize?: number;
  /** Days to keep SecurityAuditLog rows. Default 30 (see DATA-PROTECTION.md). */
  retentionDays?: number;
}

/** Number of SecurityAuditLog rows matched or removed by retention cleanup. */
export interface PurgeSecurityAuditLogResult {
  deleted: number;
}

const DEFAULT_SECURITY_AUDIT_LOG_RETENTION_DAYS = 30;
// A misconfigured "keep forever" retentionDays (e.g. a fat-fingered extra zero) must not reach
// the cutoff Date arithmetic below: Postgres's timestamp type rejects values far enough outside
// its own range, so clamping the millisecond math afterward (as first tried) still crashes the
// query - capping the input days here, to a generous 100 years, keeps the whole computation in
// safely representable territory (CodeRabbit PR #611).
const MAX_SECURITY_AUDIT_LOG_RETENTION_DAYS = 36_500;

/** Clamp retention days to a positive integer within a sane range, defaulting to 30. */
function normalizeSecurityAuditLogRetentionDays(retentionDays: number | undefined): number {
  if (!Number.isFinite(retentionDays) || !retentionDays || retentionDays < 1) {
    return DEFAULT_SECURITY_AUDIT_LOG_RETENTION_DAYS;
  }
  return Math.min(Math.floor(retentionDays), MAX_SECURITY_AUDIT_LOG_RETENTION_DAYS);
}

/** Delete stale SecurityAuditLog rows in bounded batches to avoid one large startup delete. */
async function purgeSecurityAuditLogBatches(
  prisma: PrismaClient | Prisma.TransactionClient,
  where: Prisma.SecurityAuditLogWhereInput,
  batchSize: number,
): Promise<number> {
  let count = 0;
  for (;;) {
    const rows = await prisma.securityAuditLog.findMany({
      where,
      select: { id: true },
      orderBy: { created_at: "asc" },
      take: batchSize,
    });
    if (rows.length === 0) return count;

    const deleted = await prisma.securityAuditLog.deleteMany({
      where: { id: { in: rows.map((row) => row.id) } },
    });
    count += deleted.count;

    if (rows.length < batchSize) return count;
  }
}

/**
 * Remove SecurityAuditLog rows past the retention window (default 30 days). Unlike
 * AdminAuditLog (deliberate staff actions only), this table can grow quickly under a
 * brute-force/credential-stuffing attack, so it gets its own bounded, automatic purge -
 * separate from purgeAuthRetention, which never touches audit logs by design.
 */
export async function purgeSecurityAuditLog(
  prisma: PrismaClient | Prisma.TransactionClient,
  options: PurgeSecurityAuditLogOptions = {},
): Promise<PurgeSecurityAuditLogResult> {
  const now = options.now ?? new Date();
  const retentionDays = normalizeSecurityAuditLogRetentionDays(options.retentionDays);
  const cutoff = new Date(now.getTime() - retentionDays * 24 * 60 * 60 * 1000);
  const where: Prisma.SecurityAuditLogWhereInput = { created_at: { lte: cutoff } };
  const batchSize = normalizeBatchSize(options.batchSize);

  if (options.dryRun) {
    const deleted = await prisma.securityAuditLog.count({ where });
    return { deleted };
  }

  const deleted = await purgeSecurityAuditLogBatches(prisma, where, batchSize);
  return { deleted };
}

/** Resolve SecurityAuditLog retention days from an optional environment override. */
export function resolveSecurityAuditLogRetentionDays(env: NodeJS.ProcessEnv = process.env): number {
  const raw = env["SECURITY_AUDIT_LOG_RETENTION_DAYS"]?.trim();
  if (!raw) return DEFAULT_SECURITY_AUDIT_LOG_RETENTION_DAYS;
  if (!/^\d+$/.test(raw)) return DEFAULT_SECURITY_AUDIT_LOG_RETENTION_DAYS;
  return normalizeSecurityAuditLogRetentionDays(Number(raw));
}
