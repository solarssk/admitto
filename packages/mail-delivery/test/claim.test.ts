import { PrismaClient } from "@prisma/client";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { claimInitialDelivery } from "../src/claim.js";
import { resetDb } from "./resetDb.js";

const prisma = new PrismaClient();
const EVENT_ID = "evt-claim-batch";
const ATT_ID = "att-claim-batch";
const ORG_ID = "org-claim-batch";

beforeAll(async () => {
  await resetDb();
  await prisma.organization.create({
    data: { id: ORG_ID, name: "Claim Org", slug: "claim-org" },
  });
  await prisma.event.create({
    data: {
      id: EVENT_ID,
      organization_id: ORG_ID,
      title: "Claim Event",
      slug: "claim-event",
      date: new Date("2026-09-01"),
    },
  });
  await prisma.attendee.create({
    data: {
      id: ATT_ID,
      event_id: EVENT_ID,
      email: "claim@example.com",
      name: "Claim Attendee",
    },
  });
});

afterAll(async () => {
  await prisma.$disconnect();
});

describe("claimInitialDelivery", () => {
  it("updates batch_id when reclaiming a failed retryable initial delivery", async () => {
    await prisma.emailDelivery.deleteMany({ where: { attendee_id: ATT_ID } });
    await prisma.emailDelivery.create({
      data: {
        organization_id: ORG_ID,
        event_id: EVENT_ID,
        attendee_id: ATT_ID,
        purpose: "initial",
        batch_id: "old-batch",
        provider: "export_only",
        status: "failed",
        retryable: true,
        attempts: 1,
        recipient_email: "claim@example.com",
        rendered_subject: "Subject",
        rendered_html: "<p>Hi</p>",
        queued_at: new Date(),
      },
    });

    const result = await claimInitialDelivery(
      {
        organizationId: ORG_ID,
        eventId: EVENT_ID,
        attendeeId: ATT_ID,
        batchId: "new-batch",
        provider: "export_only",
        recipientEmail: "claim@example.com",
        renderedSubject: "Subject",
        renderedHtml: "<p>Hi</p>",
      },
      prisma,
    );

    expect(result.action).toBe("retry_existing");
    const row = await prisma.emailDelivery.findFirst({
      where: { attendee_id: ATT_ID, purpose: "initial" },
    });
    expect(row?.batch_id).toBe("new-batch");
    expect(row?.status).toBe("queued");
  });
});
