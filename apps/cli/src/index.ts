#!/usr/bin/env node
import { prisma } from "@admitto/db";
import { CliError as AuthCliError } from "@admitto/auth/cli-helpers";
import { loadDotEnv } from "./loadDotEnv.js";
import { CliError, hasFlag } from "./lib/args.js";
import { printUsage } from "./lib/usage.js";
import { runCheckinAdmit, runCheckinLookup } from "./commands/checkin.js";
import { runAttendeesExport } from "./commands/attendees.js";
import { runMailRetryFailed } from "./commands/mail.js";
import {
  runAuthBootstrapSuperadmin,
  runAuthGenerateEmergencyRecovery,
  runAuthResetMfa,
} from "./commands/auth.js";
import { runSessionsPurgeAll, runSessionsRevokeUser } from "./commands/sessions.js";
import { runRetention } from "./commands/retention.js";

function wantsHelp(argv: string[]): boolean {
  return argv.includes("--help") || argv.includes("-h");
}

/**
 * Resolves the async handler for a given namespace/command pair, or
 * `undefined` when the combination is not recognized. `sessions purge`
 * additionally requires the `--all` flag, so it is checked separately
 * before falling back to the plain namespace:command lookup table.
 */
function resolveCommandHandler(
  namespace: string | undefined,
  command: string | undefined,
  argv: string[],
): (() => Promise<void>) | undefined {
  if (namespace === "sessions" && command === "purge" && hasFlag("all", argv)) {
    return () => runSessionsPurgeAll(prisma);
  }

  const handlers: Record<string, () => Promise<void>> = {
    "checkin:lookup": () => runCheckinLookup(prisma),
    "checkin:admit": () => runCheckinAdmit(prisma),
    "attendees:export": () => runAttendeesExport(prisma),
    "mail:retry-failed": () => runMailRetryFailed(prisma),
    "auth:bootstrap-superadmin": () => runAuthBootstrapSuperadmin(prisma),
    "auth:reset-mfa": () => runAuthResetMfa(prisma),
    "auth:generate-emergency-recovery": () => runAuthGenerateEmergencyRecovery(prisma),
    "sessions:revoke": () => runSessionsRevokeUser(prisma),
    "retention:run": () => runRetention(prisma),
  };

  return handlers[`${namespace}:${command}`];
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2);

  if (wantsHelp(argv)) {
    printUsage();
    return;
  }

  if (argv.length === 0) {
    printUsage();
    throw new CliError("Invalid usage");
  }

  loadDotEnv();

  if (!process.env["DATABASE_URL"]) {
    throw new CliError("DATABASE_URL is required");
  }

  const namespace = argv[0];
  const command = argv[1];

  const handler = resolveCommandHandler(namespace, command, argv);
  if (!handler) {
    printUsage();
    throw new CliError("Invalid usage");
  }

  await handler();
}

try {
  await main();
} catch (err) {
  if (err instanceof CliError || err instanceof AuthCliError) {
    console.error(err.message);
    process.exitCode = err.exitCode;
  } else {
    console.error(err);
    process.exitCode = 1;
  }
} finally {
  try {
    await prisma.$disconnect();
  } catch {
    // Preserve exit code from the catch above; disconnect failures must not override it.
  }
}
