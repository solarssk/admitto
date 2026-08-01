import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { execSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { PrismaClient } from "../src/generated/prisma/client.js";
import { createTestPrismaClient } from "../src/testing.js";
import { backfillEmailDeliveryTemplateLabelSnapshot } from "../src/backfill-email-delivery-template-label-snapshot.js";
import { assertTestDatabaseUrl } from "../src/testDbGuard.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DB_ROOT = path.resolve(__dirname, "..");

const ORG_ID = "org-backfill-template-label";
const EVENT_ID = "evt-backfill-template-label";

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
    data: { id: ORG_ID, name: "Org", slug: "org-backfill-template-label" },
  });
  await prisma.event.create({
    data: {
      id: EVENT_ID,
      title: "Gala",
      slug: "gala-backfill-template-label",
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

async function makeTemplate(name: string, label: string) {
  return prisma.mailTemplate.create({
    data: {
      scope_type: "event",
      scope_id: EVENT_ID,
      name,
      label,
      subject_template: "Subject",
      body_template: "<p>Body</p>",
      template_format: "html",
      compiled_html_template: "<p>Body</p>",
    },
  });
}

describe("backfillEmailDeliveryTemplateLabelSnapshot", () => {
  it("recovers the snapshot from the still-live MailTemplate join", async () => {
    const template = await makeTemplate("vip-backfill-recoverable", "VIP invite");
    const attendee = await makeAttendee("att-backfill-recoverable");
    const delivery = await prisma.emailDelivery.create({
      data: {
        organization_id: ORG_ID,
        event_id: EVENT_ID,
        attendee_id: attendee.id,
        purpose: "resend",
        provider: "export_only",
        status: "sent",
        template_id: template.id,
      },
    });
    expect(delivery.template_label_snapshot).toBeNull();

    const result = await backfillEmailDeliveryTemplateLabelSnapshot(prisma);
    expect(result.updated).toBeGreaterThanOrEqual(1);

    const after = await prisma.emailDelivery.findUniqueOrThrow({ where: { id: delivery.id } });
    expect(after.template_label_snapshot).toBe("VIP invite");
  });

  it("leaves a genuine default-template delivery (template_id null) untouched", async () => {
    const attendee = await makeAttendee("att-backfill-default");
    const delivery = await prisma.emailDelivery.create({
      data: {
        organization_id: ORG_ID,
        event_id: EVENT_ID,
        attendee_id: attendee.id,
        purpose: "resend",
        provider: "export_only",
        status: "sent",
      },
    });

    await backfillEmailDeliveryTemplateLabelSnapshot(prisma);

    const after = await prisma.emailDelivery.findUniqueOrThrow({ where: { id: delivery.id } });
    expect(after.template_label_snapshot).toBeNull();
  });

  it("does not overwrite a delivery that already has a snapshot", async () => {
    const template = await makeTemplate("reminder-backfill-already-set", "Reminder");
    const attendee = await makeAttendee("att-backfill-already-set");
    const delivery = await prisma.emailDelivery.create({
      data: {
        organization_id: ORG_ID,
        event_id: EVENT_ID,
        attendee_id: attendee.id,
        purpose: "resend",
        provider: "export_only",
        status: "sent",
        template_id: template.id,
        template_label_snapshot: "Original snapshot",
      },
    });

    await backfillEmailDeliveryTemplateLabelSnapshot(prisma);

    const after = await prisma.emailDelivery.findUniqueOrThrow({ where: { id: delivery.id } });
    expect(after.template_label_snapshot).toBe("Original snapshot");
  });

  it("is idempotent on a second run", async () => {
    const first = await backfillEmailDeliveryTemplateLabelSnapshot(prisma);
    expect(first.updated).toBe(0);
  });
});
