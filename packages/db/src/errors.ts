/**
 * Prisma Serializable transaction conflict: direct P2034, bare DriverAdapterError
 * (`cause.kind === TransactionWriteConflict`), or the same Postgres 40001 /
 * TransactionWriteConflict wrapped under `meta.driverAdapterError.cause` by Prisma's
 * driver adapters (Prisma 7+) instead of surfacing as P2034 directly.
 */
export function isSerializationFailure(err: unknown): boolean {
  if (typeof err !== "object" || err === null) return false;

  if ("code" in err && (err).code === "P2034") return true;

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

/**
 * True when Postgres refused to store a value because it is malformed (SQLSTATE class 22, "data
 * exception"): U+0000 in text, U+0000 or a lone surrogate inside JSON, a string too long for its
 * column, a number out of range. Prisma 7's driver adapters report these under several Prisma
 * codes (P2039 for a query, P2010 for a raw query, P2000 and P2007 for validation), but all of
 * them carry the SQLSTATE at `meta.driverAdapterError.cause.originalCode`.
 */
export function isUnstorableValueError(err: unknown): boolean {
  if (typeof err !== "object" || err === null) return false;
  const cause = (
    err as { meta?: { driverAdapterError?: { cause?: { originalCode?: unknown } } } }
  ).meta?.driverAdapterError?.cause;
  return typeof cause?.originalCode === "string" && cause.originalCode.startsWith("22");
}
