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

  it("does not set had_wallet_cta from a token that only appears inside an HTML comment", async () => {
    // Regression coverage (CodeRabbit): templateHasWalletCta (send.ts) excludes a commented-out
    // reference for a live send via extractPlaceholderNamesFromHtml - this backfill must apply the
    // same rule to historical rows, not a bare substring/LIKE match that can't tell the two apart.
    const attendee = await makeAttendee("att-backfill-wallet-cta-comment-only");
    const delivery = await prisma.emailDelivery.create({
      data: {
        organization_id: ORG_ID,
        event_id: EVENT_ID,
        attendee_id: attendee.id,
        purpose: "resend",
        provider: "export_only",
        status: "sent",
        rendered_html: "<!-- {{apple_wallet_url}} --><p>Hi {{first_name}}</p>",
      },
    });
    expect(delivery.had_wallet_cta).toBe(false);

    await backfillEmailDeliveryHadWalletCta(prisma);

    const after = await prisma.emailDelivery.findUniqueOrThrow({ where: { id: delivery.id } });
    expect(after.had_wallet_cta).toBe(false);
  });

  it("still sets had_wallet_cta when a live token exists outside a comment, even alongside a commented-out one", async () => {
    const attendee = await makeAttendee("att-backfill-wallet-cta-mixed");
    const delivery = await prisma.emailDelivery.create({
      data: {
        organization_id: ORG_ID,
        event_id: EVENT_ID,
        attendee_id: attendee.id,
        purpose: "resend",
        provider: "export_only",
        status: "sent",
        rendered_html: '<!-- {{apple_wallet_url}} --><a href="{{google_wallet_url}}">Add</a>',
      },
    });

    await backfillEmailDeliveryHadWalletCta(prisma);

    const after = await prisma.emailDelivery.findUniqueOrThrow({ where: { id: delivery.id } });
    expect(after.had_wallet_cta).toBe(true);
  });

  it("processes an early live-html match followed by a subject-only row correctly in the same run", async () => {
    // Regression coverage for the token scanner's own g-flag regex: an implementation that reused
    // one module-level RegExp across candidate rows (instead of a fresh one per hasLiveWalletCtaToken
    // call) could leave a stale lastIndex behind after an early match, corrupting the very next
    // row's own check - exercised here by putting a matching html row (found immediately) right
    // before a subject-only row in the same backfill run.
    const firstAttendee = await makeAttendee("att-backfill-wallet-cta-order-1");
    const first = await prisma.emailDelivery.create({
      data: {
        organization_id: ORG_ID,
        event_id: EVENT_ID,
        attendee_id: firstAttendee.id,
        purpose: "resend",
        provider: "export_only",
        status: "sent",
        rendered_html: '<a href="{{apple_wallet_url}}">Add</a>',
      },
    });
    const secondAttendee = await makeAttendee("att-backfill-wallet-cta-order-2");
    const second = await prisma.emailDelivery.create({
      data: {
        organization_id: ORG_ID,
        event_id: EVENT_ID,
        attendee_id: secondAttendee.id,
        purpose: "resend",
        provider: "export_only",
        status: "sent",
        rendered_subject: "Don't forget: {{google_wallet_url}}",
      },
    });

    await backfillEmailDeliveryHadWalletCta(prisma);

    const afterFirst = await prisma.emailDelivery.findUniqueOrThrow({ where: { id: first.id } });
    const afterSecond = await prisma.emailDelivery.findUniqueOrThrow({ where: { id: second.id } });
    expect(afterFirst.had_wallet_cta).toBe(true);
    expect(afterSecond.had_wallet_cta).toBe(true);
  });

  it("sets had_wallet_cta from a raw token in rendered_subject alone, no rendered_html match needed", async () => {
    // Regression coverage (CodeRabbit): a live send checks both subjectTemplate and
    // compiledHtmlTemplate (templateHasWalletCta, send.ts) - the backfill for pre-existing rows
    // must recognize the same two fields, not just rendered_html, or a historical send whose only
    // wallet-CTA reference was in its subject line stays permanently misclassified.
    const attendee = await makeAttendee("att-backfill-wallet-cta-subject");
    const delivery = await prisma.emailDelivery.create({
      data: {
        organization_id: ORG_ID,
        event_id: EVENT_ID,
        attendee_id: attendee.id,
        purpose: "resend",
        provider: "export_only",
        status: "sent",
        rendered_subject: "Don't forget: {{apple_wallet_url}}",
        rendered_html: "<p>Hi {{first_name}}</p>",
      },
    });
    expect(delivery.had_wallet_cta).toBe(false);

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
