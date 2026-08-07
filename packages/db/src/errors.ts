/**
 * Prisma Serializable transaction conflict: direct P2034, bare DriverAdapterError
 * (`cause.kind === TransactionWriteConflict`), or the same Postgres 40001 /
 * TransactionWriteConflict wrapped under `meta.driverAdapterError.cause` by Prisma's
 * driver adapters (Prisma 7+) instead of surfacing as P2034 directly.
 */
export function isSerializationFailure(err: unknown): boolean {
  if (typeof err !== "object" || err === null) return false;

  if ("code" in err && (err as { code: unknown }).code === "P2034") return true;

  const metaCause = (
    err as { meta?: { driverAdapterError?: { cause?: { originalCode?: string; kind?: string } } } }
  ).meta?.driverAdapterError?.cause;
  if (metaCause?.originalCode === "40001" || metaCause?.kind === "TransactionWriteConflict") {
    return true;
  }

  // @prisma/adapter-pg may throw DriverAdapterError without a Prisma `code` field.
  const directCause = (err as { cause?: { originalCode?: string; kind?: string } }).cause;
  if (directCause?.originalCode === "40001" || directCause?.kind === "TransactionWriteConflict") {
    return true;
  }
  if ((err as { kind?: string }).kind === "TransactionWriteConflict") return true;

  return false;
}
