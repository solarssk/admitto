import { prisma } from "../index.js";
import { backfillJitPasswordHash } from "../backfill-jit-password-hash.js";

/** Deploy/CLI entrypoint: idempotent JIT-provisioned User.password_hash backfill after migrations. */
async function main(): Promise<void> {
  const result = await backfillJitPasswordHash(prisma);
  console.log(`backfill-jit-password-hash: nulled ${result.updated} placeholder password hash(es)`);
  await prisma.$disconnect();
}

try {
  await main();
} catch (err: unknown) {
  console.error(err);
  process.exit(1);
}
