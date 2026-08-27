import { PrismaClient } from "@admitto/db";
import { createTestPrismaClient } from "@admitto/db/testing";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
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

afterEach(() => {
  vi.restoreAllMocks();
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

  it("persists template_label_snapshot when templateLabel is provided", async () => {
    const template = await prisma.mailTemplate.create({
      data: {
        scope_type: "event",
        scope_id: EVENT_ID,
        name: "vip-claim",
        label: "VIP invite",
        subject_template: "Subject",
        body_template: "<p>Body</p>",
        template_format: "html",
        compiled_html_template: "<p>Body</p>",
      },
    });

    const result = await claimInitialDelivery(
      { ...claimInput, batchId: "fresh-batch", templateId: template.id, templateLabel: template.label },
      prisma,
    );

    expect(result.action).toBe("send");
    const row = await prisma.emailDelivery.findFirst({
      where: { attendee_id: ATT_ID, purpose: "initial" },
    });
    expect(row?.template_id).toBe(template.id);
    expect(row?.template_label_snapshot).toBe("VIP invite");
  });

  it("leaves template_label_snapshot null when no templateLabel is provided (builtin default)", async () => {
    const result = await claimInitialDelivery(
      { ...claimInput, batchId: "fresh-batch" },
      prisma,
    );

    expect(result.action).toBe("send");
    const row = await prisma.emailDelivery.findFirst({
      where: { attendee_id: ATT_ID, purpose: "initial" },
    });
    expect(row?.template_id).toBeNull();
    expect(row?.template_label_snapshot).toBeNull();
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

  it("reclaims a cancelled initial delivery with this request's fresh content, not the stale frozen message", async () => {
    await prisma.emailDelivery.create({
      data: {
        organization_id: ORG_ID,
        event_id: EVENT_ID,
        attendee_id: ATT_ID,
        purpose: "initial",
        batch_id: "old-cancelled-batch",
        provider: "export_only",
        status: "cancelled",
        attempts: 1,
        recipient_email: "claim@example.com",
        rendered_subject: "Stale subject from the stopped send",
        rendered_html: "<p>Stale body</p>",
        queued_at: new Date("2026-01-01T00:00:00.000Z"),
      },
    });

    const result = await claimInitialDelivery(
      {
        ...claimInput,
        batchId: "fresh-batch",
        renderedSubject: "Fresh subject",
        renderedHtml: "<p>Fresh body</p>",
        actorUserId: "user-reclaim-actor",
        sessionId: "session-reclaim-actor",
      },
      prisma,
    );

    // Reported as a fresh "send", not "retry_existing" - unlike a failed-row retry, this row's
    // content just changed underneath it, so it's not meaningfully "the same send, try again".
    expect(result.action).toBe("send");
    if (result.action !== "send") return;
    expect(result.message).toEqual({
      to: "claim@example.com",
      subject: "Fresh subject",
      html: "<p>Fresh body</p>",
    });

    const row = await prisma.emailDelivery.findFirst({
      where: { attendee_id: ATT_ID, purpose: "initial" },
    });
    expect(row?.id).toBe(result.deliveryId);
    expect(row?.batch_id).toBe("fresh-batch");
    expect(row?.status).toBe("queued");
    expect(row?.rendered_subject).toBe("Fresh subject");
    expect(row?.rendered_html).toBe("<p>Fresh body</p>");
    expect(row?.attempts).toBe(1);
    expect(row?.actor_user_id).toBe("user-reclaim-actor");
    expect(row?.session_id).toBe("session-reclaim-actor");
  });

  it("bumps created_at on reclaim so it outranks a delivery the attendee received between the cancel and the reclaim", async () => {
    // "Latest delivery for this attendee" (the Attendees mail-status filter/badge, the delivery
    // log, viewed.ts) is always created_at DESC, id DESC. A cancelled row can sit for a long
    // time before it's reclaimed - long enough for the attendee to get a genuinely later
    // delivery in between (a custom-template send, here) - so the reclaim has to move
    // created_at forward too, not just queued_at, or that older-by-the-clock-but-actually-
    // superseded row keeps outranking the freshly completed reclaim.
    const original = await prisma.emailDelivery.create({
      data: {
        organization_id: ORG_ID,
        event_id: EVENT_ID,
        attendee_id: ATT_ID,
        purpose: "initial",
        batch_id: "old-cancelled-batch",
        provider: "export_only",
        status: "cancelled",
        attempts: 1,
        recipient_email: "claim@example.com",
        rendered_subject: "Stale subject from the stopped send",
        rendered_html: "<p>Stale body</p>",
        queued_at: new Date("2026-01-01T00:00:00.000Z"),
        created_at: new Date("2026-01-01T00:00:00.000Z"),
      },
    });
    const inBetweenResend = await prisma.emailDelivery.create({
      data: {
        organization_id: ORG_ID,
        event_id: EVENT_ID,
        attendee_id: ATT_ID,
        purpose: "resend",
        batch_id: "custom-notice-batch",
        provider: "export_only",
        status: "sent",
        attempts: 1,
        recipient_email: "claim@example.com",
        rendered_subject: "A heads-up while the ticket send was stopped",
        rendered_html: "<p>Notice</p>",
        queued_at: new Date("2026-01-02T00:00:00.000Z"),
        created_at: new Date("2026-01-02T00:00:00.000Z"),
      },
    });

    const result = await claimInitialDelivery(
      { ...claimInput, batchId: "fresh-batch", renderedSubject: "Fresh subject", renderedHtml: "<p>Fresh body</p>" },
      prisma,
    );
    expect(result.action).toBe("send");

    const reclaimed = await prisma.emailDelivery.findUniqueOrThrow({ where: { id: original.id } });
    expect(reclaimed.created_at.getTime()).toBeGreaterThan(inBetweenResend.created_at.getTime());

    const [latest] = await prisma.emailDelivery.findMany({
      where: { attendee_id: ATT_ID },
      orderBy: [{ created_at: "desc" }, { id: "desc" }],
      take: 1,
    });
    expect(latest?.id).toBe(original.id);
  });

  it("returns skip in_flight when a concurrent claim wins the cancelled-row reclaim", async () => {
    // A genuine Promise.all race against a real DB doesn't reliably land both calls inside the
    // same narrow window (in practice the first call's whole claim/update cycle usually finishes
    // before the second one even reads the row, so the second one already sees "queued" via
    // classifyExisting rather than losing the guarded update itself) - this instead deterministically
    // injects the loss at the exact point it matters: right before this call's own guarded
    // updateMany runs, something else flips the row to "queued" first.
    const row = await prisma.emailDelivery.create({
      data: {
        organization_id: ORG_ID,
        event_id: EVENT_ID,
        attendee_id: ATT_ID,
        purpose: "initial",
        batch_id: "old-cancelled-batch",
        provider: "export_only",
        status: "cancelled",
        attempts: 1,
        recipient_email: "claim@example.com",
        rendered_subject: "Subject",
        rendered_html: "<p>Hi</p>",
        queued_at: new Date(),
      },
    });

    const realUpdateMany = prisma.emailDelivery.updateMany.bind(prisma.emailDelivery);
    vi.spyOn(prisma.emailDelivery, "updateMany").mockImplementationOnce(async (args) => {
      await realUpdateMany({ where: { id: row.id, status: "cancelled" }, data: { status: "queued" } });
      return realUpdateMany(args);
    });

    const result = await claimInitialDelivery({ ...claimInput, batchId: "batch-a" }, prisma);

    expect(result).toEqual({ action: "skip", reason: "in_flight" });
    const after = await prisma.emailDelivery.findUniqueOrThrow({ where: { id: row.id } });
    expect(after.status).toBe("queued");
    expect(after.batch_id).toBe("old-cancelled-batch");
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
