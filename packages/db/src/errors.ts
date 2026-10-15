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

/**
 * True when a write failed because the row it points at does not exist: a foreign key violation
 * (Prisma P2003) raised while inserting or updating the referencing row. A delete that is blocked
 * by rows still pointing at the one being deleted is the same P2003 and the same SQLSTATE 23503,
 * so only Postgres's wording tells the two apart ("insert or update on table ..." against "update
 * or delete on table ... on table ..."); the driver adapter passes it on in
 * `meta.driverAdapterError.cause.originalMessage`. A message in another language reads as "not a
 * missing parent", which is the safe answer: the caller then maps nothing.
 */
export function isMissingParentViolation(err: unknown): boolean {
  if (typeof err !== "object" || err === null) return false;
  const cause = (
    err as { meta?: { driverAdapterError?: { cause?: { originalCode?: unknown; originalMessage?: unknown } } } }
  ).meta?.driverAdapterError?.cause;
  return (
    cause?.originalCode === "23503" &&
    typeof cause.originalMessage === "string" &&
    cause.originalMessage.startsWith("insert or update on table")
  );
}
