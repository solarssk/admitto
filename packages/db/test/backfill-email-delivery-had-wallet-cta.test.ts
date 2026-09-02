import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { execSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { PrismaClient } from "../src/generated/prisma/client.js";
import { createTestPrismaClient } from "../src/testing.js";
import { backfillEmailDeliveryHadWalletCta } from "../src/backfill-email-delivery-had-wallet-cta.js";
import { assertTestDatabaseUrl } from "../src/testDbGuard.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DB_ROOT = path.resolve(__dirname, "..");

const ORG_ID = "org-backfill-wallet-cta";
const EVENT_ID = "evt-backfill-wallet-cta";

let prisma: PrismaClient;

beforeAll(async () => {
  assertTestDatabaseUrl(process.env.DATABASE_URL ?? "");
  execSync("npx prisma db push --force-reset --accept-data-loss", {
    cwd: DB_ROOT,
    env: { ...process.env },
    stdio: "pipe",
  });
  prisma = createTestPrismaClient();
  await prisma.organization.create({
    data: { id: ORG_ID, name: "Org", slug: "org-backfill-wallet-cta" },
  });
  await prisma.event.create({
    data: {
      id: EVENT_ID,
      title: "Gala",
      slug: "gala-backfill-wallet-cta",
      date: new Date("2026-09-01"),
      organization_id: ORG_ID,
    },
  });
});

afterAll(async () => {
  await prisma.$disconnect();
});

async function makeAttendee(id: string) {
  return prisma.attendee.create({
    data: { id, event_id: EVENT_ID, email: `${id}@example.com`, name: id },
  });
}

describe("backfillEmailDeliveryHadWalletCta", () => {
  it("sets had_wallet_cta from a raw {{apple_wallet_url}} token still in rendered_html", async () => {
    const attendee = await makeAttendee("att-backfill-wallet-cta-apple");
    const delivery = await prisma.emailDelivery.create({
      data: {
        organization_id: ORG_ID,
        event_id: EVENT_ID,
        attendee_id: attendee.id,
        purpose: "resend",
        provider: "export_only",
        status: "sent",
        rendered_html: '<a href="{{apple_wallet_url}}">Add to Apple Wallet</a>',
      },
    });
    expect(delivery.had_wallet_cta).toBe(false);

    const result = await backfillEmailDeliveryHadWalletCta(prisma);
    expect(result.updated).toBeGreaterThanOrEqual(1);

    const after = await prisma.emailDelivery.findUniqueOrThrow({ where: { id: delivery.id } });
    expect(after.had_wallet_cta).toBe(true);
  });

  it("sets had_wallet_cta from a raw {{google_wallet_url}} token too", async () => {
    const attendee = await makeAttendee("att-backfill-wallet-cta-google");
    const delivery = await prisma.emailDelivery.create({
      data: {
        organization_id: ORG_ID,
        event_id: EVENT_ID,
        attendee_id: attendee.id,
        purpose: "resend",
        provider: "export_only",
        status: "sent",
        rendered_html: '<a href="{{google_wallet_url}}">Add to Google Wallet</a>',
      },
    });

    await backfillEmailDeliveryHadWalletCta(prisma);

    const after = await prisma.emailDelivery.findUniqueOrThrow({ where: { id: delivery.id } });
    expect(after.had_wallet_cta).toBe(true);
  });

  it("leaves a delivery with no wallet placeholder untouched", async () => {
    const attendee = await makeAttendee("att-backfill-wallet-cta-none");
    const delivery = await prisma.emailDelivery.create({
      data: {
        organization_id: ORG_ID,
        event_id: EVENT_ID,
        attendee_id: attendee.id,
        purpose: "resend",
        provider: "export_only",
        status: "sent",
        rendered_html: "<p>Hi {{first_name}}</p>",
      },
    });

    await backfillEmailDeliveryHadWalletCta(prisma);

    const after = await prisma.emailDelivery.findUniqueOrThrow({ where: { id: delivery.id } });
    expect(after.had_wallet_cta).toBe(false);
  });

  it("leaves a delivery with no rendered_html at all untouched", async () => {
    const attendee = await makeAttendee("att-backfill-wallet-cta-no-html");
    const delivery = await prisma.emailDelivery.create({
      data: {
        organization_id: ORG_ID,
        event_id: EVENT_ID,
        attendee_id: attendee.id,
        purpose: "resend",
        provider: "export_only",
        status: "queued",
      },
    });

    await backfillEmailDeliveryHadWalletCta(prisma);

    const after = await prisma.emailDelivery.findUniqueOrThrow({ where: { id: delivery.id } });
    expect(after.had_wallet_cta).toBe(false);
  });

  it("is idempotent on a second run", async () => {
    const first = await backfillEmailDeliveryHadWalletCta(prisma);
    expect(first.updated).toBe(0);
  });
});
