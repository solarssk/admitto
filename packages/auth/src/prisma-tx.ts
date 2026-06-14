import { PrismaClient, type Prisma } from "@prisma/client";

/**
 * Run `fn` in a transaction when `prisma` is a root client; reuse `tx` when already nested.
 * Uses `instanceof PrismaClient` (not `$transaction` duck-typing) so nested tx clients stay
 * identifiable if Prisma ever exposes `$transaction` on `TransactionClient`.
 */
export async function runInTransaction<T>(
  prisma: PrismaClient | Prisma.TransactionClient,
  fn: (tx: Prisma.TransactionClient) => Promise<T>,
): Promise<T> {
  if (prisma instanceof PrismaClient) {
    return prisma.$transaction(fn);
  }
  return fn(prisma);
}
