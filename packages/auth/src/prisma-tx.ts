import type { PrismaClient, Prisma } from "@prisma/client";

/** Run `fn` in a transaction when `prisma` is a root client; reuse tx when already nested. */
export async function runInTransaction<T>(
  prisma: PrismaClient | Prisma.TransactionClient,
  fn: (tx: Prisma.TransactionClient) => Promise<T>,
): Promise<T> {
  if ("$transaction" in prisma && typeof prisma.$transaction === "function") {
    return (prisma as PrismaClient).$transaction(fn);
  }
  return fn(prisma);
}
