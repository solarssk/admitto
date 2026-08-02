import { PrismaClient } from "@admitto/db";
import { createTestPrismaClient } from "@admitto/db/testing";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  nullifyDeliverySnapshots,
  resolveDeliverySnapshotRetentionDays,
} from "../src/retention.js";
import { resetDb } from "./resetDb.js";

const prisma = createTestPrismaClient();
const EVENT_ID = "evt-mail-retention";
const NOW = new Date("2026-06-27T12:00:00.000Z");
const RETENTION_DAYS = 60;

function daysAgo(days: number): Date {
  return new Date(NOW.getTime() - days * 24 * 60 * 60 * 1000);
}

async function seedDelivery(input: {
  id: string;
  attendeeId?: string;
  purpose?: "initial" | "resend";
  status: string;
  sentAt?: Date | null;
  deliveredAt?: Date | null;
  acceptedAt?: Date | null;
  failedAt?: Date | null;
  retryable?: boolean | null;
  renderedHtml?: string | null;
  renderedSubject?: string | null;
}) {
  await prisma.emailDelivery.create({
    data: {
      id: input.id,
      organization_id: "org-mail-retention",
      event_id: EVENT_ID,
      attendee_id: input.attendeeId ?? "att-retention",
      purpose: input.purpose ?? "resend",
      provider: "export_only",
      status: input.status,
      recipient_email: "guest@example.com",
      rendered_html: input.renderedHtml ?? "<p>Hello Guest</p>",
      rendered_subject: input.renderedSubject ?? "Your ticket",
      sent_at: input.sentAt ?? null,
      delivered_at: input.deliveredAt ?? null,
      accepted_at: input.acceptedAt ?? null,
      failed_at: input.failedAt ?? null,
      retryable: input.retryable ?? null,
    },
  });
}

beforeAll(async () => {
  await resetDb();
  await prisma.organization.create({
    data: { id: "org-mail-retention", name: "Retention Org", slug: "retention-org" },
  });
  await prisma.event.create({
    data: {
      id: EVENT_ID,
      organization_id: "org-mail-retention",
      title: "Retention Event",
      slug: "retention-event",
      date: new Date("2026-05-01"),
    },
  });
  await prisma.attendee.create({
    data: {
      id: "att-retention",
      event_id: EVENT_ID,
      email: "guest@example.com",
      name: "Guest Example",
    },
  });
});

afterAll(async () => {
  await prisma.$disconnect();
});

describe("nullifyDeliverySnapshots", () => {
  it("dry-run counts stale snapshots without clearing them", async () => {
    await prisma.emailDelivery.deleteMany({ where: { id: { startsWith: "delivery-retention-" } } });

    await seedDelivery({
      id: "delivery-retention-stale-sent",
      status: "sent",
      sentAt: daysAgo(90),
    });
    await seedDelivery({
      id: "delivery-retention-recent-sent",
      status: "sent",
      sentAt: daysAgo(10),
    });
    await seedDelivery({
      id: "delivery-retention-queued",
      status: "queued",
      sentAt: null,
    });

    const dryRun = await nullifyDeliverySnapshots(prisma, {
      now: NOW,
      dryRun: true,
      retentionDays: RETENTION_DAYS,
    });
    expect(dryRun.deliveries).toBe(1);

    const stale = await prisma.emailDelivery.findUniqueOrThrow({
      where: { id: "delivery-retention-stale-sent" },
    });
    expect(stale.rendered_html).toBe("<p>Hello Guest</p>");
    expect(stale.rendered_subject).toBe("Your ticket");
  });

  it("clears snapshots on terminal deliveries past the retention window", async () => {
    await prisma.emailDelivery.deleteMany({ where: { id: { startsWith: "delivery-retention-" } } });

    await seedDelivery({
      id: "delivery-retention-stale-sent",
      status: "sent",
      sentAt: daysAgo(90),
    });
    await seedDelivery({
      id: "delivery-retention-stale-delivered",
      status: "delivered",
      sentAt: null,
      deliveredAt: daysAgo(90),
    });
    await seedDelivery({
      id: "delivery-retention-stale-accepted",
      status: "accepted",
      sentAt: null,
      acceptedAt: daysAgo(90),
    });
    await seedDelivery({
      id: "delivery-retention-stale-failed",
      status: "failed",
      failedAt: daysAgo(75),
      retryable: true,
    });
    await seedDelivery({
      id: "delivery-retention-recent-failed",
      status: "failed",
      failedAt: daysAgo(5),
      retryable: true,
    });
    await seedDelivery({
      id: "delivery-retention-queued",
      status: "queued",
    });

    const result = await nullifyDeliverySnapshots(prisma, {
      now: NOW,
      retentionDays: RETENTION_DAYS,
      batchSize: 1,
    });
    expect(result.deliveries).toBe(4);

    const staleSent = await prisma.emailDelivery.findUniqueOrThrow({
      where: { id: "delivery-retention-stale-sent" },
    });
    expect(staleSent.rendered_html).toBeNull();
    expect(staleSent.rendered_subject).toBeNull();
    expect(staleSent.recipient_email).toBe("guest@example.com");

    const staleDelivered = await prisma.emailDelivery.findUniqueOrThrow({
      where: { id: "delivery-retention-stale-delivered" },
    });
    expect(staleDelivered.rendered_html).toBeNull();
    expect(staleDelivered.rendered_subject).toBeNull();

    const staleAccepted = await prisma.emailDelivery.findUniqueOrThrow({
      where: { id: "delivery-retention-stale-accepted" },
    });
    expect(staleAccepted.rendered_html).toBeNull();
    expect(staleAccepted.rendered_subject).toBeNull();

    const staleFailed = await prisma.emailDelivery.findUniqueOrThrow({
      where: { id: "delivery-retention-stale-failed" },
    });
    expect(staleFailed.rendered_html).toBeNull();
    expect(staleFailed.rendered_subject).toBeNull();
    expect(staleFailed.retryable).toBe(false);

    const recentFailed = await prisma.emailDelivery.findUniqueOrThrow({
      where: { id: "delivery-retention-recent-failed" },
    });
    expect(recentFailed.rendered_html).toBe("<p>Hello Guest</p>");

    const queued = await prisma.emailDelivery.findUniqueOrThrow({
      where: { id: "delivery-retention-queued" },
    });
    expect(queued.rendered_html).toBe("<p>Hello Guest</p>");

    const secondRun = await nullifyDeliverySnapshots(prisma, {
      now: NOW,
      retentionDays: RETENTION_DAYS,
    });
    expect(secondRun.deliveries).toBe(0);
  });

  it("resolves retention days from env with safe fallback", () => {
    expect(resolveDeliverySnapshotRetentionDays({})).toBe(60);
    expect(
      resolveDeliverySnapshotRetentionDays({
        EMAIL_DELIVERY_SNAPSHOT_RETENTION_DAYS: "90",
      }),
    ).toBe(90);
    expect(
      resolveDeliverySnapshotRetentionDays({
        EMAIL_DELIVERY_SNAPSHOT_RETENTION_DAYS: "abc",
      }),
    ).toBe(60);
    expect(
      resolveDeliverySnapshotRetentionDays({
        EMAIL_DELIVERY_SNAPSHOT_RETENTION_DAYS: "30days",
      }),
    ).toBe(60);
    expect(
      resolveDeliverySnapshotRetentionDays({
        EMAIL_DELIVERY_SNAPSHOT_RETENTION_DAYS: "0",
      }),
    ).toBe(60);
  });
});
