import type { Prisma, PrismaClient } from "@admitto/db";

function isRootPrismaClient(
  prisma: PrismaClient | Prisma.TransactionClient,
): prisma is PrismaClient {
  return typeof (prisma as PrismaClient).$transaction === "function";
}

/**
 * Run `fn` in a transaction when `prisma` is a root client; reuse `tx` when already nested.
 * Duck-types on `$transaction` (not `instanceof PrismaClient`) so barrel imports of
 * `@admitto/auth` do not require a generated Prisma client at module load time.
 */
export async function runInTransaction<T>(
  prisma: PrismaClient | Prisma.TransactionClient,
  fn: (tx: Prisma.TransactionClient) => Promise<T>,
): Promise<T> {
  if (isRootPrismaClient(prisma)) {
    return prisma.$transaction(fn);
  }
  return fn(prisma);
}
