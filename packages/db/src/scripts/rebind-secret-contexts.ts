import { createBackfillPrismaClient } from "./backfillClient.js";
import { rebindSecretContexts } from "../rebind-secret-contexts.js";

const prisma = createBackfillPrismaClient();
const dryRun = process.argv.includes("--dry-run");

/** Manual ops entrypoint (not in `db:migrate`): see rebindSecretContexts. */
async function main(): Promise<void> {
  const results = await rebindSecretContexts(prisma, { dryRun });
  for (const r of results) {
    console.log(`${r.column}: rewritten ${r.rewritten}, already bound ${r.alreadyBound}, failed ${r.failed}${dryRun ? " (dry run)" : ""}`);
  }
  await prisma.$disconnect();
  if (results.some((r) => r.failed > 0)) process.exit(1);
}

try {
  await main();
} catch (err: unknown) {
  console.error(err);
  process.exit(1);
}
