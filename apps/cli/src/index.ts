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

  if (namespace === "checkin" && command === "lookup") {
    await runCheckinLookup(prisma);
  } else if (namespace === "checkin" && command === "admit") {
    await runCheckinAdmit(prisma);
  } else if (namespace === "attendees" && command === "export") {
    await runAttendeesExport(prisma);
  } else if (namespace === "mail" && command === "retry-failed") {
    await runMailRetryFailed(prisma);
  } else if (namespace === "auth" && command === "bootstrap-superadmin") {
    await runAuthBootstrapSuperadmin(prisma);
  } else if (namespace === "auth" && command === "reset-mfa") {
    await runAuthResetMfa(prisma);
  } else if (namespace === "auth" && command === "generate-emergency-recovery") {
    await runAuthGenerateEmergencyRecovery(prisma);
  } else if (namespace === "sessions" && command === "revoke") {
    await runSessionsRevokeUser(prisma);
  } else if (namespace === "sessions" && command === "purge" && hasFlag("all", argv)) {
    await runSessionsPurgeAll(prisma);
  } else if (namespace === "retention" && command === "run") {
    await runRetention(prisma);
  } else {
    printUsage();
    throw new CliError("Invalid usage");
  }
}

main()
  .catch((err) => {
    if (err instanceof CliError || err instanceof AuthCliError) {
      console.error(err.message);
      process.exitCode = err.exitCode;
      return;
    }
    console.error(err);
    process.exitCode = 1;
  })
  .finally(async () => {
    try {
      await prisma.$disconnect();
    } catch {
      // Preserve exit code from .catch(); disconnect failures must not override it.
    }
  });
