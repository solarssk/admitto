#!/usr/bin/env node
import { prisma } from "@admitto/db";
import { loadDotEnv } from "./loadDotEnv.js";
import { CliError } from "./lib/args.js";
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

function usage(): never {
  console.error(`Admitto emergency ops CLI — for use when the admin UI is unreachable during an event.

Usage: admitto <namespace> <command> [options]

Namespaces:
  checkin      Manual attendee admission when the SPA/scanner is down
  attendees    Emergency CSV export (paper backup list)
  mail         Retry failed email deliveries
  auth         Superadmin bootstrap / MFA break-glass
  sessions     Emergency session purge
  retention    Manual retention run (same logic as the nightly cron)

Options:
  --format     Output format: table (default), json
  --dry-run    Preview changes without writing
  --yes, -y    Skip interactive confirmations
  --operator-email  Attribute this CLI invocation to a specific admin in audit logs

Examples:
  admitto checkin lookup --event evt_123 --query "jan kowal"
  admitto checkin admit --event evt_123 --attendee-id att_456
  admitto attendees export --event evt_123 --format csv --out backup.csv
  admitto mail retry-failed --event evt_123
  admitto sessions revoke --user admin@example.com
  admitto sessions purge --all --yes
  admitto retention run`);
  throw new CliError("Invalid usage");
}

async function main(): Promise<void> {
  loadDotEnv();

  if (!process.env["DATABASE_URL"]) {
    throw new CliError("DATABASE_URL is required");
  }

  const argv = process.argv.slice(2);
  if (argv.length === 0 || argv.includes("--help") || argv.includes("-h")) {
    usage();
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
  } else if (namespace === "sessions" && command === "purge" && argv[2] === "--all") {
    await runSessionsPurgeAll(prisma);
  } else if (namespace === "retention" && command === "run") {
    await runRetention(prisma);
  } else {
    usage();
  }
}

main()
  .catch((err) => {
    if (err instanceof CliError) {
      console.error(err.message);
      process.exitCode = err.exitCode;
      return;
    }
    console.error(err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
