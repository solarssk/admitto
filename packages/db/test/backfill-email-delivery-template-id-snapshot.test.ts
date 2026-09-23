import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { execSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { PrismaClient } from "../src/generated/prisma/client.js";
import { createTestPrismaClient } from "../src/testing.js";
import { backfillEmailDeliveryTemplateIdSnapshot } from "../src/backfill-email-delivery-template-id-snapshot.js";
import { assertTestDatabaseUrl } from "../src/testDbGuard.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DB_ROOT = path.resolve(__dirname, "..");

const ORG_ID = "org-backfill-template-id";
const EVENT_ID = "evt-backfill-template-id";

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
    data: { id: ORG_ID, name: "Org", slug: "org-backfill-template-id" },
  });
  await prisma.event.create({
    data: {
      id: EVENT_ID,
      title: "Gala",
      slug: "gala-backfill-template-id",
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

describe("backfillEmailDeliveryTemplateIdSnapshot", () => {
  it("copies the row's own still-present template_id into the snapshot", async () => {
    const template = await makeTemplate("vip-backfill-id-recoverable", "VIP invite");
    const attendee = await makeAttendee("att-backfill-id-recoverable");
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
    expect(delivery.template_id_snapshot).toBeNull();

    const result = await backfillEmailDeliveryTemplateIdSnapshot(prisma);
    expect(result.updated).toBeGreaterThanOrEqual(1);

    const after = await prisma.emailDelivery.findUniqueOrThrow({ where: { id: delivery.id } });
    expect(after.template_id_snapshot).toBe(template.id);
  });

  it("leaves a genuine default-template delivery (template_id null) untouched", async () => {
    const attendee = await makeAttendee("att-backfill-id-default");
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

    await backfillEmailDeliveryTemplateIdSnapshot(prisma);

    const after = await prisma.emailDelivery.findUniqueOrThrow({ where: { id: delivery.id } });
    expect(after.template_id_snapshot).toBeNull();
  });

  it("cannot recover a delivery whose template was already deleted before this backfill ran", async () => {
    const template = await makeTemplate("vip-backfill-id-already-deleted", "VIP invite (deleted)");
    const attendee = await makeAttendee("att-backfill-id-already-deleted");
    const delivery = await prisma.emailDelivery.create({
      data: {
        organization_id: ORG_ID,
        event_id: EVENT_ID,
        attendee_id: attendee.id,
        purpose: "resend",
        provider: "export_only",
        status: "sent",
        template_id: template.id,
        template_label_snapshot: "VIP invite (deleted)",
      },
    });
    // SetNull's template_id, same as a real template deletion - nothing left to copy from.
    await prisma.mailTemplate.delete({ where: { id: template.id } });

    await backfillEmailDeliveryTemplateIdSnapshot(prisma);

    const after = await prisma.emailDelivery.findUniqueOrThrow({ where: { id: delivery.id } });
    expect(after.template_id).toBeNull();
    expect(after.template_id_snapshot).toBeNull();
  });

  it("does not overwrite a delivery that already has a snapshot", async () => {
    const template = await makeTemplate("reminder-backfill-id-already-set", "Reminder");
    const attendee = await makeAttendee("att-backfill-id-already-set");
    const delivery = await prisma.emailDelivery.create({
      data: {
        organization_id: ORG_ID,
        event_id: EVENT_ID,
        attendee_id: attendee.id,
        purpose: "resend",
        provider: "export_only",
        status: "sent",
        template_id: template.id,
        template_id_snapshot: "original-snapshot-id",
      },
    });

    await backfillEmailDeliveryTemplateIdSnapshot(prisma);

    const after = await prisma.emailDelivery.findUniqueOrThrow({ where: { id: delivery.id } });
    expect(after.template_id_snapshot).toBe("original-snapshot-id");
  });

  it("is idempotent on a second run", async () => {
    const first = await backfillEmailDeliveryTemplateIdSnapshot(prisma);
    expect(first.updated).toBe(0);
  });
});
