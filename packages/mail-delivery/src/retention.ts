import type { Prisma, PrismaClient } from "@prisma/client";

/** Runtime controls for email delivery snapshot retention cleanup. */
export interface NullifyDeliverySnapshotOptions {
  now?: Date;
  dryRun?: boolean;
  batchSize?: number;
  /** Days to keep frozen rendered bodies after terminal delivery. Default 60. */
  retentionDays?: number;
}

/** Number of delivery rows matched or cleared by snapshot retention cleanup. */
export interface NullifyDeliverySnapshotResult {
  deliveries: number;
}

const DEFAULT_RETENTION_DAYS = 60;
const DEFAULT_PURGE_BATCH_SIZE = 1000;

// "accepted" means the provider acknowledged the delivery. After the retention
// window, a row stuck there is treated as terminal for data-minimisation purposes.
const SUCCESS_TERMINAL_STATUSES = ["accepted", "sent", "delivered"] as const;
const FAILURE_TERMINAL_STATUSES = ["failed", "bounced", "rejected"] as const;

/** Clamp an optional caller-provided batch size to a safe positive integer. */
function normalizeBatchSize(batchSize: number | undefined): number {
  if (!Number.isFinite(batchSize) || !batchSize || batchSize < 1) return DEFAULT_PURGE_BATCH_SIZE;
  return Math.floor(batchSize);
}

/** Clamp retention days to a positive integer with a sensible default. */
function normalizeRetentionDays(retentionDays: number | undefined): number {
  if (!Number.isFinite(retentionDays) || !retentionDays || retentionDays < 1) {
    return DEFAULT_RETENTION_DAYS;
  }
  return Math.floor(retentionDays);
}

/** Build the cutoff timestamp for rows older than the configured retention window. */
function retentionCutoff(now: Date, retentionDays: number): Date {
  return new Date(now.getTime() - retentionDays * 24 * 60 * 60 * 1000);
}

/** Selector for terminal deliveries whose frozen HTML/subject can be dropped. */
function staleSnapshotWhere(cutoff: Date): Prisma.EmailDeliveryWhereInput {
  return {
    AND: [
      {
        OR: [{ rendered_html: { not: null } }, { rendered_subject: { not: null } }],
      },
      { status: { not: "queued" } },
      {
        OR: [
          {
            status: { in: [...SUCCESS_TERMINAL_STATUSES] },
            OR: [
              { sent_at: { lte: cutoff } },
              { delivered_at: { lte: cutoff } },
              {
                sent_at: null,
                delivered_at: null,
                accepted_at: { lte: cutoff },
              },
            ],
          },
          {
            status: { in: [...FAILURE_TERMINAL_STATUSES] },
            failed_at: { lte: cutoff },
          },
        ],
      },
    ],
  };
}

/** Transaction clients are already atomic; full Prisma clients need an explicit transaction. */
function canOpenTransaction(
  prisma: PrismaClient | Prisma.TransactionClient,
): prisma is PrismaClient {
  return "$transaction" in prisma;
}

/** Clear snapshots and retryability together so interruption cannot orphan retryable rows. */
async function nullifyDeliverySnapshotBatch(
  prisma: PrismaClient | Prisma.TransactionClient,
  ids: string[],
): Promise<number> {
  const updated = await prisma.emailDelivery.updateMany({
    where: { id: { in: ids } },
    data: { rendered_html: null, rendered_subject: null },
  });
  await prisma.emailDelivery.updateMany({
    where: {
      id: { in: ids },
      status: { in: [...FAILURE_TERMINAL_STATUSES] },
      retryable: true,
    },
    data: { retryable: false },
  });
  return updated.count;
}

/** Null rendered bodies in bounded batches to avoid one large startup update. */
async function nullifyDeliverySnapshotBatches(
  prisma: PrismaClient | Prisma.TransactionClient,
  where: Prisma.EmailDeliveryWhereInput,
  batchSize: number,
): Promise<number> {
  let count = 0;
  for (;;) {
    const rows = await prisma.emailDelivery.findMany({
      where,
      select: { id: true },
      orderBy: { created_at: "asc" },
      take: batchSize,
    });
    if (rows.length === 0) return count;

    const ids = rows.map((row) => row.id);
    const updated = canOpenTransaction(prisma)
      ? await prisma.$transaction((tx) => nullifyDeliverySnapshotBatch(tx, ids))
      : await nullifyDeliverySnapshotBatch(prisma, ids);
    count += updated;

    if (rows.length < batchSize) return count;
  }
}

/**
 * Drop frozen email HTML/subject snapshots once a delivery is terminal and past the
 * retention window. Delivery log metadata (status, timestamps, recipient) remains.
 */
export async function nullifyDeliverySnapshots(
  prisma: PrismaClient | Prisma.TransactionClient,
  options: NullifyDeliverySnapshotOptions = {},
): Promise<NullifyDeliverySnapshotResult> {
  const now = options.now ?? new Date();
  const retentionDays = normalizeRetentionDays(options.retentionDays);
  const cutoff = retentionCutoff(now, retentionDays);
  const where = staleSnapshotWhere(cutoff);
  const batchSize = normalizeBatchSize(options.batchSize);

  if (options.dryRun) {
    const deliveries = await prisma.emailDelivery.count({ where });
    return { deliveries };
  }

  const deliveries = await nullifyDeliverySnapshotBatches(prisma, where, batchSize);
  return { deliveries };
}

/** Resolve retention days from an optional environment override. */
export function resolveDeliverySnapshotRetentionDays(
  env: NodeJS.ProcessEnv = process.env,
): number {
  const raw = env["EMAIL_DELIVERY_SNAPSHOT_RETENTION_DAYS"];
  if (!raw) return DEFAULT_RETENTION_DAYS;
  const parsed = Number.parseInt(raw, 10);
  return normalizeRetentionDays(parsed);
}
