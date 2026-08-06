/**
 * Event-scoped mail operations CLI (test-send, config describe, delivery logs).
 *
 *   npm run cli -w @admitto/mail-delivery -- test-send --to you@example.com --event <id>
 *   npm run cli -w @admitto/mail-delivery -- config-describe --event <id>
 *   npm run cli -w @admitto/mail-delivery -- deliveries --event <id> [--status accepted]
 *   npm run cli -w @admitto/mail-delivery -- nullify-delivery-snapshots [--dry-run]
 *   npm run cli -w @admitto/mail-delivery -- ingest-bounces [--event-id <id>]
 */
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  prisma,
  EMAIL_DELIVERY_PURPOSE,
  EMAIL_DELIVERY_STATUS,
  type PrismaClient,
  type EmailDeliveryPurpose,
  type EmailDeliveryStatus,
} from "@admitto/db";
import { isSendSuccess } from "@admitto/mailer";
import {
  getMailConfigDescription,
  serializeConfigDescriptionForCli,
} from "./configDescribe.js";
import { loadEnvFile } from "@admitto/shared/load-env-file";
import { listDeliveries } from "./listDeliveries.js";
import { sendTestEmail } from "./testSend.js";
import {
  nullifyDeliverySnapshots,
  resolveDeliverySnapshotRetentionDays,
} from "./retention.js";
import { ingestBounces } from "./bounceIngest/index.js";
const __dirname = path.dirname(fileURLToPath(import.meta.url));

/** Load DATABASE_URL and other vars from monorepo, db, and package .env files. */
function loadDotEnv() {
  const monorepoRoot = path.join(__dirname, "..", "..", "..");
  // Merge all existing files (do not stop at first). Later files override earlier
  // only for keys not already in process.env. packages/db/.env is the documented
  // DATABASE_URL location after db setup.
  const candidates = [
    path.join(monorepoRoot, ".env"),
    path.join(monorepoRoot, "packages", "db", ".env"),
    path.join(__dirname, "..", ".env"),
  ];
  for (const envPath of candidates) {
    loadEnvFile(envPath);
  }
}

/** Read a `--name value` flag from process.argv. */
function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i !== -1 && process.argv[i + 1] ? process.argv[i + 1] : undefined;
}

/** Require a CLI flag or exit with a clear error. */
function requireArg(name: string): string {
  const value = arg(name);
  if (!value) {
    console.error(`Missing required --${name}`);
    process.exit(1);
  }
  return value;
}

/** Print CLI usage and exit with code 1. */
function hasFlag(name: string): boolean {
  return process.argv.includes(`--${name}`);
}

function usage(): never {
  console.error(`Usage:
  test-send --to <addr> --event <id>
  config-describe --event <id>
  deliveries --event <id> [--status <status>] [--purpose initial|resend] [--attendee <id>]
  nullify-delivery-snapshots [--dry-run]
  ingest-bounces [--event-id <id>]`);
  process.exit(1);
}

/** Type guard for a delivery status CLI filter value. */
function isEmailDeliveryStatus(value: string): value is EmailDeliveryStatus {
  return (EMAIL_DELIVERY_STATUS as readonly string[]).includes(value);
}

/** Type guard for a delivery purpose CLI filter value. */
function isEmailDeliveryPurpose(value: string): value is EmailDeliveryPurpose {
  return (EMAIL_DELIVERY_PURPOSE as readonly string[]).includes(value);
}

/** Run `test-send --to <addr> --event <id>`. */
async function cmdTestSend(prisma: PrismaClient): Promise<number> {
  const to = requireArg("to");
  const eventId = requireArg("event");

  const result = await sendTestEmail({ eventId, toAddress: to }, prisma);
  console.log(`provider = ${result.provider}`);
  console.log(`status   = ${result.status}`);
  if (result.providerMessageId) {
    console.log(`message  = ${result.providerMessageId}`);
  }
  if (result.error) {
    console.error(`error    = ${result.error}`);
  }
  return isSendSuccess(result.status) ? 0 : 1;
}

/** Run `config-describe --event <id>` with secret-safe JSON output. */
async function cmdConfigDescribe(prisma: PrismaClient): Promise<number> {
  const eventId = requireArg("event");
  const desc = await getMailConfigDescription(eventId, prisma);
  console.log(serializeConfigDescriptionForCli(desc));
  return 0;
}

/** Run `nullify-delivery-snapshots [--dry-run]`. */
async function cmdNullifyDeliverySnapshots(prisma: PrismaClient): Promise<number> {
  const dryRun = hasFlag("dry-run");
  const retentionDays = resolveDeliverySnapshotRetentionDays(process.env);
  const result = await nullifyDeliverySnapshots(prisma, { dryRun, retentionDays });
  const verb = dryRun ? "Would clear snapshots on" : "Cleared snapshots on";
  console.log(
    `${verb} ${result.deliveries} terminal email deliveries older than ${retentionDays} days.`,
  );
  return 0;
}

/** Run `ingest-bounces [--event-id <id>]`. Exit 1 only when an IMAP connect failed. */
async function cmdIngestBounces(prisma: PrismaClient): Promise<number> {
  const eventId = arg("event-id");
  const summary = await ingestBounces(prisma, { eventId });

  if (summary.noopReason === "not_configured") {
    console.log("not configured");
    return 0;
  }
  if (summary.noopReason === "disabled") {
    console.log("disabled");
    return 0;
  }
  if (summary.noopReason === "none_enabled") {
    console.log("none enabled");
    return 0;
  }
  if (summary.noopReason === "none_due") {
    console.log("none due");
    return 0;
  }

  console.log(
    JSON.stringify(
      {
        eventsProcessed: summary.eventsProcessed,
        messagesSeen: summary.messagesSeen,
        bouncesApplied: summary.bouncesApplied,
        softBouncesLogged: summary.softBouncesLogged,
        unparsed: summary.unparsed,
        noMatchingDelivery: summary.noMatchingDelivery,
        errors: summary.errors,
        connectFailed: summary.connectFailed,
      },
      null,
      2,
    ),
  );
  return summary.errors > 0 || summary.connectFailed ? 1 : 0;
}

/** Run `deliveries --event <id>` with optional status/purpose/attendee filters. */
async function cmdDeliveries(prisma: PrismaClient): Promise<number> {
  const eventId = requireArg("event");
  const status = arg("status");
  const purpose = arg("purpose");
  const attendeeId = arg("attendee");

  const filters: NonNullable<Parameters<typeof listDeliveries>[0]["filters"]> = {};
  if (status) {
    if (!isEmailDeliveryStatus(status)) {
      console.error(
        `Invalid --status: ${status}. Valid: ${EMAIL_DELIVERY_STATUS.join(", ")}`,
      );
      return 1;
    }
    filters.status = status;
  }
  if (purpose) {
    if (!isEmailDeliveryPurpose(purpose)) {
      console.error(
        `Invalid --purpose: ${purpose}. Valid: ${EMAIL_DELIVERY_PURPOSE.join(", ")}`,
      );
      return 1;
    }
    filters.purpose = purpose;
  }
  if (attendeeId) filters.attendeeId = attendeeId;

  const { items: rows } = await listDeliveries(
    {
      eventId,
      filters: Object.keys(filters).length > 0 ? filters : undefined,
    },
    prisma,
  );
  console.log(JSON.stringify(rows, null, 2));
  return 0;
}

/** CLI entry: parse subcommand, connect Prisma, dispatch, and exit. */
async function main() {
  loadDotEnv();

  if (!process.env.DATABASE_URL) {
    console.error("DATABASE_URL is required (set in .env or environment)");
    process.exit(1);
  }

  const sub = process.argv[2];
  if (!sub) usage();

  let exitCode = 0;

  try {
    switch (sub) {
      case "test-send":
        exitCode = await cmdTestSend(prisma);
        break;
      case "config-describe":
        exitCode = await cmdConfigDescribe(prisma);
        break;
      case "deliveries":
        exitCode = await cmdDeliveries(prisma);
        break;
      case "nullify-delivery-snapshots":
        exitCode = await cmdNullifyDeliverySnapshots(prisma);
        break;
      case "ingest-bounces":
        exitCode = await cmdIngestBounces(prisma);
        break;
      default:
        usage();
    }
  } finally {
    await prisma.$disconnect();
  }

  process.exit(exitCode);
}

try {
  await main();
} catch (e) {
  console.error(e instanceof Error ? e.message : String(e));
  process.exit(1);
}
