import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { execSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { PrismaClient } from "@admitto/db";
import { createTestPrismaClient } from "@admitto/db/testing";
import { assertTestDatabaseUrl } from "@admitto/db/test-db-guard";
import {
  countFilteredAttendees,
  findFilteredAttendeesForList,
  buildAttendeeListWhere,
} from "../src/attendees-list-filters.js";

describe("latest mail-status attendee filters", () => {
  it.each(["not_sent", "sent", "pending", "failed"] as const)(
    "builds the query for the %s bucket",
    async (mail_status) => {
      const $queryRaw = vi.fn().mockResolvedValue([{ count: 0n }]);
      const db = { $queryRaw } as unknown as PrismaClient;

      await expect(
        countFilteredAttendees(db, "event-1", { status: "all", mail_status: [mail_status] }),
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
    await prisma.ticketType.createMany({
      data: ["vip", "standard", "staff"].map((key, i) => ({
        event_id: EVENT_ID,
        key,
        label: key,
        sort_order: i,
      })),
    });
    const ticketTypeAndRsvpById: Record<string, { ticket_type: string; rsvp_status: string }> = {
      [ATT_NEVER_SENT]: { ticket_type: "vip", rsvp_status: "confirmed" },
      [ATT_CANCELLED]: { ticket_type: "standard", rsvp_status: "declined" },
      [ATT_SENT]: { ticket_type: "vip", rsvp_status: "none" },
      [ATT_FAILED]: { ticket_type: "staff", rsvp_status: "tentative" },
    };
    await prisma.attendee.createMany({
      data: [ATT_NEVER_SENT, ATT_CANCELLED, ATT_SENT, ATT_FAILED].map((id) => ({
        id,
        event_id: EVENT_ID,
        email: `${id}@example.com`,
        name: id,
        ...ticketTypeAndRsvpById[id],
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
    const count = await countFilteredAttendees(prisma, EVENT_ID, { status: "all", mail_status: ["not_sent"] });
    expect(count).toBe(2);
  });

  it("lists the never-sent and cancelled attendees under not_sent, and neither under sent/pending/failed", async () => {
    const notSent = await findFilteredAttendeesForList(prisma, EVENT_ID, { status: "all", mail_status: ["not_sent"] }, 1, 10);
    expect(notSent.map((r) => r.id).sort()).toEqual([ATT_CANCELLED, ATT_NEVER_SENT].sort());

    const failed = await findFilteredAttendeesForList(prisma, EVENT_ID, { status: "all", mail_status: ["failed"] }, 1, 10);
    expect(failed.map((r) => r.id)).toEqual([ATT_FAILED]);
    // The point of this whole fix: a deliberately-stopped send must not read as a delivery
    // failure - it must not show up here just because it's also not "sent".
    expect(failed.map((r) => r.id)).not.toContain(ATT_CANCELLED);

    const sent = await findFilteredAttendeesForList(prisma, EVENT_ID, { status: "all", mail_status: ["sent"] }, 1, 10);
    expect(sent.map((r) => r.id)).toEqual([ATT_SENT]);
  });

  it("OR-combines multiple selected buckets (sent or failed, excluding pending/not_sent)", async () => {
    const rows = await findFilteredAttendeesForList(
      prisma,
      EVENT_ID,
      { status: "all", mail_status: ["sent", "failed"] },
      1,
      10,
    );
    expect(rows.map((r) => r.id).sort()).toEqual([ATT_FAILED, ATT_SENT].sort());
  });

  it("matches any of several selected ticket types (IN clause), on the raw-SQL path forced by mail_status", async () => {
    const rows = await findFilteredAttendeesForList(
      prisma,
      EVENT_ID,
      { status: "all", ticket_type: ["vip", "staff"], mail_status: ["not_sent", "sent", "failed"] },
      1,
      10,
    );
    expect(rows.map((r) => r.id).sort()).toEqual([ATT_FAILED, ATT_NEVER_SENT, ATT_SENT].sort());
  });

  it("matches any of several selected attendance statuses (IN clause), on the raw-SQL path forced by mail_status", async () => {
    const rows = await findFilteredAttendeesForList(
      prisma,
      EVENT_ID,
      { status: "all", rsvp_status: ["confirmed", "tentative"], mail_status: ["not_sent", "sent", "failed"] },
      1,
      10,
    );
    expect(rows.map((r) => r.id).sort()).toEqual([ATT_FAILED, ATT_NEVER_SENT].sort());
  });

  it("treats an empty ticket_type/rsvp_status array as no filter at all, same as omitting it", async () => {
    const withEmptyArrays = await findFilteredAttendeesForList(
      prisma,
      EVENT_ID,
      { status: "all", ticket_type: [], rsvp_status: [], mail_status: ["not_sent"] },
      1,
      10,
    );
    expect(withEmptyArrays.map((r) => r.id).sort()).toEqual([ATT_CANCELLED, ATT_NEVER_SENT].sort());
  });

  it("takes the fast Prisma-where path (no mail_status, no q) and still filters by multiple ticket types", async () => {
    const count = await countFilteredAttendees(prisma, EVENT_ID, {
      status: "all",
      ticket_type: ["vip", "staff"],
    });
    expect(count).toBe(3);
  });

  it("counts every attendee on the fast path when ticket_type/rsvp_status are empty arrays", async () => {
    const count = await countFilteredAttendees(prisma, EVENT_ID, {
      status: "all",
      ticket_type: [],
      rsvp_status: [],
    });
    expect(count).toBe(4);
  });

  it("an empty mail_status array is no filter at all, even on the always-raw-SQL list query", async () => {
    const rows = await findFilteredAttendeesForList(prisma, EVENT_ID, { status: "all", mail_status: [] }, 1, 10);
    expect(rows.map((r) => r.id).sort()).toEqual(
      [ATT_NEVER_SENT, ATT_CANCELLED, ATT_SENT, ATT_FAILED].sort(),
    );
  });
});

describe("buildAttendeeListWhere", () => {
  it("omits ticket_type/rsvp_status from the where clause when their arrays are empty", () => {
    expect(buildAttendeeListWhere("event-1", { status: "all", ticket_type: [], rsvp_status: [] })).toEqual({
      event_id: "event-1",
    });
  });

  it("builds an `in` clause for multi-value ticket_type and rsvp_status", () => {
    expect(
      buildAttendeeListWhere("event-1", {
        status: "admitted",
        ticket_type: ["vip", "staff"],
        rsvp_status: ["confirmed", "tentative"],
      }),
    ).toEqual({
      event_id: "event-1",
      admitted_at: { not: null },
      ticket_type: { in: ["vip", "staff"] },
      rsvp_status: { in: ["confirmed", "tentative"] },
    });
  });
});
