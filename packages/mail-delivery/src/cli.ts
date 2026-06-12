/**
 * Event-scoped mail operations CLI (test-send, config describe, delivery logs).
 *
 *   npm run cli -w @admitto/mail-delivery -- test-send --to you@example.com --event <id>
 *   npm run cli -w @admitto/mail-delivery -- config-describe --event <id>
 *   npm run cli -w @admitto/mail-delivery -- deliveries --event <id> [--status accepted]
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { PrismaClient } from "@prisma/client";
import {
  prisma,
  EMAIL_DELIVERY_PURPOSE,
  EMAIL_DELIVERY_STATUS,
  type EmailDeliveryPurpose,
  type EmailDeliveryStatus,
} from "@admitto/db";
import { isSendSuccess } from "@admitto/mailer";
import {
  getMailConfigDescription,
  serializeConfigDescriptionForCli,
} from "./configDescribe.js";
import { listDeliveries } from "./listDeliveries.js";
import { sendTestEmail } from "./testSend.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function loadDotEnv() {
  const candidates = [
    path.join(__dirname, "..", ".env"),
    path.join(__dirname, "..", "..", "..", ".env"),
  ];
  for (const envPath of candidates) {
    if (!fs.existsSync(envPath)) continue;
    for (const line of fs.readFileSync(envPath, "utf8").split("\n")) {
      const t = line.trim();
      if (!t || t.startsWith("#")) continue;
      const eq = t.indexOf("=");
      if (eq === -1) continue;
      const k = t.slice(0, eq).trim();
      let v = t.slice(eq + 1).trim();
      if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
        v = v.slice(1, -1);
      }
      if (!(k in process.env)) process.env[k] = v;
    }
    break;
  }
}

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i !== -1 && process.argv[i + 1] ? process.argv[i + 1] : undefined;
}

function requireArg(name: string): string {
  const value = arg(name);
  if (!value) {
    console.error(`Missing required --${name}`);
    process.exit(1);
  }
  return value;
}

function usage(): never {
  console.error(`Usage:
  test-send --to <addr> --event <id>
  config-describe --event <id>
  deliveries --event <id> [--status <status>] [--purpose initial|resend] [--attendee <id>]`);
  process.exit(1);
}

function isEmailDeliveryStatus(value: string): value is EmailDeliveryStatus {
  return (EMAIL_DELIVERY_STATUS as readonly string[]).includes(value);
}

function isEmailDeliveryPurpose(value: string): value is EmailDeliveryPurpose {
  return (EMAIL_DELIVERY_PURPOSE as readonly string[]).includes(value);
}

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

async function cmdConfigDescribe(prisma: PrismaClient): Promise<number> {
  const eventId = requireArg("event");
  const desc = await getMailConfigDescription(eventId, prisma);
  console.log(serializeConfigDescriptionForCli(desc));
  return 0;
}

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

  const rows = await listDeliveries(
    {
      eventId,
      filters: Object.keys(filters).length > 0 ? filters : undefined,
    },
    prisma,
  );
  console.log(JSON.stringify(rows, null, 2));
  return 0;
}

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
      default:
        usage();
    }
  } finally {
    await prisma.$disconnect();
  }

  process.exit(exitCode);
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : String(e));
  process.exit(1);
});
