/**
 * Prisma Serializable transaction conflict: direct P2034, or the same Postgres 40001 /
 * TransactionWriteConflict wrapped under `meta.driverAdapterError.cause` by Prisma's driver
 * adapters (Prisma 7+) instead of surfacing as P2034 directly.
 */
export function isSerializationFailure(err: unknown): boolean {
  if (typeof err !== "object" || err === null || !("code" in err)) return false;
  if ((err as { code: string }).code === "P2034") return true;
  const cause = (
    err as { meta?: { driverAdapterError?: { cause?: { originalCode?: string; kind?: string } } } }
  ).meta?.driverAdapterError?.cause;
  return cause?.originalCode === "40001" || cause?.kind === "TransactionWriteConflict";
}
