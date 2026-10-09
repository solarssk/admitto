import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PrismaClient } from "@admitto/db";
import { createTestPrismaClient } from "@admitto/db/testing";
import { eraseAttendees } from "@admitto/tickets";
import { resolveBulkSendAttendeeIds } from "../../src/admin/bulk-send-routes.js";

const ORG = "org-bulk-erased";
const EVENT = "evt-bulk-erased";

let prisma: PrismaClient;

describe("resolveBulkSendAttendeeIds and erased attendees", () => {
  beforeAll(async () => {
    prisma = createTestPrismaClient();
    await prisma.attendee.deleteMany({ where: { event_id: EVENT } });
    await prisma.event.deleteMany({ where: { id: EVENT } });
    await prisma.organization.deleteMany({ where: { id: ORG } });
    await prisma.organization.create({ data: { id: ORG, name: "Org", slug: "bulk-erased-org" } });
    await prisma.event.create({
      data: { id: EVENT, title: "Event", slug: "bulk-erased-event", date: new Date("2026-10-01"), organization_id: ORG },
    });
    for (const id of ["att-bulk-live", "att-bulk-erased"]) {
      await prisma.attendee.create({
        data: { id, event_id: EVENT, email: `${id}@example.com`, name: id, rsvp_status: "confirmed" },
      });
    }
    await prisma.$transaction((tx) => eraseAttendees(tx, { eventId: EVENT, attendeeIds: ["att-bulk-erased"] }));
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it.each([
    ["all", { type: "all" as const }],
    ["no_delivery", { type: "no_delivery" as const }],
    ["rsvp_status", { type: "rsvp_status" as const, value: "confirmed" as const }],
  ])("leaves an erased attendee out of the %s audience", async (_name, filter) => {
    const { ids } = await resolveBulkSendAttendeeIds(prisma, EVENT, filter);
    expect(ids).toEqual(["att-bulk-live"]);
  });

  it("keeps an explicitly selected id, so the send reports it as skipped", async () => {
    const { ids } = await resolveBulkSendAttendeeIds(prisma, EVENT, {
      type: "attendee_ids",
      ids: ["att-bulk-live", "att-bulk-erased"],
    });
    expect(ids.sort()).toEqual(["att-bulk-erased", "att-bulk-live"]);
  });
});
