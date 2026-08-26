import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { execSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { PrismaClient } from "@admitto/db";
import { createTestPrismaClient } from "@admitto/db/testing";
import { assertTestDatabaseUrl } from "@admitto/db/test-db-guard";
import { countFilteredAttendees, findFilteredAttendeesForList } from "../src/attendees-list-filters.js";

describe("latest mail-status attendee filters", () => {
  it.each(["not_sent", "sent", "pending", "failed"] as const)(
    "builds the query for the %s bucket",
    async (mail_status) => {
      const $queryRaw = vi.fn().mockResolvedValue([{ count: 0n }]);
      const db = { $queryRaw } as unknown as PrismaClient;

      await expect(
        countFilteredAttendees(db, "event-1", { status: "all", mail_status }),
      ).resolves.toBe(0);
      expect($queryRaw).toHaveBeenCalledOnce();
    },
  );
});

describe("not_sent bucket real behavior (bulk-send-cancel)", () => {
  const __dirname = path.dirname(fileURLToPath(import.meta.url));
  const DB_ROOT = path.resolve(__dirname, "../../db");
  let prisma: PrismaClient;
  const EVENT_ID = "test-event-mail-status-filters";
  const ATT_NEVER_SENT = "att-mail-status-never-sent";
  const ATT_CANCELLED = "att-mail-status-cancelled";
  const ATT_SENT = "att-mail-status-actually-sent";
  const ATT_FAILED = "att-mail-status-failed";

  beforeAll(async () => {
    assertTestDatabaseUrl(process.env.DATABASE_URL ?? "");
    execSync("npx prisma db push --force-reset --accept-data-loss", {
      cwd: DB_ROOT,
      env: { ...process.env },
      stdio: "pipe",
    });
    prisma = createTestPrismaClient();

    await prisma.organization.create({
      data: { id: "org_default", name: "Default", slug: "default" },
    });
    await prisma.event.create({
      data: {
        id: EVENT_ID,
        title: "Mail Status Filters",
        slug: "mail-status-filters",
        date: new Date("2026-09-01T09:00:00Z"),
        organization_id: "org_default",
      },
    });
    await prisma.attendee.createMany({
      data: [ATT_NEVER_SENT, ATT_CANCELLED, ATT_SENT, ATT_FAILED].map((id) => ({
        id,
        event_id: EVENT_ID,
        email: `${id}@example.com`,
        name: id,
      })),
    });
    await prisma.emailDelivery.createMany({
      data: [
        {
          id: `${ATT_CANCELLED}-delivery`,
          organization_id: "org_default",
          event_id: EVENT_ID,
          attendee_id: ATT_CANCELLED,
          purpose: "initial",
          provider: "export_only",
          status: "cancelled",
        },
        {
          id: `${ATT_SENT}-delivery`,
          organization_id: "org_default",
          event_id: EVENT_ID,
          attendee_id: ATT_SENT,
          purpose: "initial",
          provider: "export_only",
          status: "sent",
          sent_at: new Date(),
        },
        {
          id: `${ATT_FAILED}-delivery`,
          organization_id: "org_default",
          event_id: EVENT_ID,
          attendee_id: ATT_FAILED,
          purpose: "initial",
          provider: "export_only",
          status: "failed",
          failed_at: new Date(),
        },
      ],
    });
  });

  afterAll(async () => {
    await prisma.emailDelivery.deleteMany({ where: { event_id: EVENT_ID } });
    await prisma.attendee.deleteMany({ where: { event_id: EVENT_ID } });
    await prisma.event.delete({ where: { id: EVENT_ID } });
    await prisma.organization.delete({ where: { id: "org_default" } });
    await prisma.$disconnect();
  });

  it("counts an attendee whose only delivery was cancelled the same as one with no delivery at all", async () => {
    const count = await countFilteredAttendees(prisma, EVENT_ID, { status: "all", mail_status: "not_sent" });
    expect(count).toBe(2);
  });

  it("lists the never-sent and cancelled attendees under not_sent, and neither under sent/pending/failed", async () => {
    const notSent = await findFilteredAttendeesForList(prisma, EVENT_ID, { status: "all", mail_status: "not_sent" }, 1, 10);
    expect(notSent.map((r) => r.id).sort()).toEqual([ATT_CANCELLED, ATT_NEVER_SENT].sort());

    const failed = await findFilteredAttendeesForList(prisma, EVENT_ID, { status: "all", mail_status: "failed" }, 1, 10);
    expect(failed.map((r) => r.id)).toEqual([ATT_FAILED]);
    // The point of this whole fix: a deliberately-stopped send must not read as a delivery
    // failure - it must not show up here just because it's also not "sent".
    expect(failed.map((r) => r.id)).not.toContain(ATT_CANCELLED);

    const sent = await findFilteredAttendeesForList(prisma, EVENT_ID, { status: "all", mail_status: "sent" }, 1, 10);
    expect(sent.map((r) => r.id)).toEqual([ATT_SENT]);
  });
});
