import { createBackfillPrismaClient } from "./backfillClient.js";
import { rebindSecretContexts } from "../rebind-secret-contexts.js";

const args = process.argv.slice(2);
// Any other argument (a mistyped `--dryrun`, `--help`) must not fall through to the real, irreversible rewrite.
const USAGE = "Usage: rebind-secret-contexts [--dry-run | --help]";
if (args.length === 1 && args[0] === "--help") {
  console.log(USAGE);
  process.exit(0);
}
const unknown = args.filter((arg) => arg !== "--dry-run");
if (unknown.length > 0) {
  console.error(`Unknown argument(s): ${unknown.join(", ")}. ${USAGE}`);
  process.exit(2);
}
const dryRun = args.includes("--dry-run");
const prisma = createBackfillPrismaClient();

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
