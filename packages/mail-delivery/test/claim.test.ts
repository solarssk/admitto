import { PrismaClient } from "@admitto/db";
import { createTestPrismaClient } from "@admitto/db/testing";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { claimInitialDelivery } from "../src/claim.js";
import { resetDb } from "./resetDb.js";

const prisma = createTestPrismaClient();
const EVENT_ID = "evt-claim-batch";
const ATT_ID = "att-claim-batch";
const ORG_ID = "org-claim-batch";

const claimInput = {
  organizationId: ORG_ID,
  eventId: EVENT_ID,
  attendeeId: ATT_ID,
  provider: "export_only",
  recipientEmail: "claim@example.com",
  renderedSubject: "Subject",
  renderedHtml: "<p>Hi</p>",
};

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

beforeEach(async () => {
  await prisma.emailDelivery.deleteMany({ where: { attendee_id: ATT_ID } });
});

afterAll(async () => {
  await prisma.$disconnect();
});

describe("claimInitialDelivery", () => {
  it("creates a new queued initial delivery", async () => {
    const result = await claimInitialDelivery(
      { ...claimInput, batchId: "fresh-batch" },
      prisma,
    );

    expect(result.action).toBe("send");
    if (result.action !== "send") return;
    const row = await prisma.emailDelivery.findFirst({
      where: { attendee_id: ATT_ID, purpose: "initial" },
    });
    expect(row?.id).toBe(result.deliveryId);
    expect(row?.batch_id).toBe("fresh-batch");
    expect(row?.status).toBe("queued");
    expect(row?.actor_user_id).toBeNull();
    expect(row?.session_id).toBeNull();
  });

  it("persists actor_user_id and session_id when provided", async () => {
    const result = await claimInitialDelivery(
      { ...claimInput, batchId: "fresh-batch", actorUserId: "user-claim-actor", sessionId: "session-claim-actor" },
      prisma,
    );

    expect(result.action).toBe("send");
    const row = await prisma.emailDelivery.findFirst({
      where: { attendee_id: ATT_ID, purpose: "initial" },
    });
    expect(row?.actor_user_id).toBe("user-claim-actor");
    expect(row?.session_id).toBe("session-claim-actor");
  });

  it("skips when initial delivery is already sent", async () => {
    await prisma.emailDelivery.create({
      data: {
        organization_id: ORG_ID,
        event_id: EVENT_ID,
        attendee_id: ATT_ID,
        purpose: "initial",
        batch_id: "sent-batch",
        provider: "export_only",
        status: "sent",
        recipient_email: "claim@example.com",
        rendered_subject: "Subject",
        rendered_html: "<p>Hi</p>",
        queued_at: new Date(),
      },
    });

    const result = await claimInitialDelivery(
      { ...claimInput, batchId: "new-batch" },
      prisma,
    );

    expect(result).toEqual({ action: "skip", reason: "already_sent" });
  });

  it("skips when initial delivery is queued", async () => {
    await prisma.emailDelivery.create({
      data: {
        organization_id: ORG_ID,
        event_id: EVENT_ID,
        attendee_id: ATT_ID,
        purpose: "initial",
        batch_id: "queued-batch",
        provider: "export_only",
        status: "queued",
        recipient_email: "claim@example.com",
        rendered_subject: "Subject",
        rendered_html: "<p>Hi</p>",
        queued_at: new Date(),
      },
    });

    const result = await claimInitialDelivery(
      { ...claimInput, batchId: "new-batch" },
      prisma,
    );

    expect(result).toEqual({ action: "skip", reason: "in_flight" });
  });

  it("updates batch_id when reclaiming a failed retryable initial delivery", async () => {
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
      { ...claimInput, batchId: "new-batch", actorUserId: "user-retry-actor", sessionId: "session-retry-actor" },
      prisma,
    );

    expect(result.action).toBe("retry_existing");
    const row = await prisma.emailDelivery.findFirst({
      where: { attendee_id: ATT_ID, purpose: "initial" },
    });
    expect(row?.batch_id).toBe("new-batch");
    expect(row?.status).toBe("queued");
    expect(row?.actor_user_id).toBe("user-retry-actor");
    expect(row?.session_id).toBe("session-retry-actor");
  });

  it("returns skip when a concurrent retry claim wins the update", async () => {
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

    const [first, second] = await Promise.all([
      claimInitialDelivery({ ...claimInput, batchId: "batch-a" }, prisma),
      claimInitialDelivery({ ...claimInput, batchId: "batch-b" }, prisma),
    ]);

    const results = [first, second];
    expect(results.filter((r) => r.action === "retry_existing")).toHaveLength(1);
    expect(results.filter((r) => r.action === "skip" && r.reason === "in_flight")).toHaveLength(1);
  });
});
