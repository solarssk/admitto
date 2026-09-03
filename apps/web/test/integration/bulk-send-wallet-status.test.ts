import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PrismaClient } from "@admitto/db";
import { createTestPrismaClient } from "@admitto/db/testing";
import { resolveBulkSendAttendeeIds } from "../../src/admin/bulk-send-routes.js";

const ORG = "org-bulk-wallet-status";
const EVENT = "evt-bulk-wallet-status";

let prisma: PrismaClient;
let activeId: string;
let removedByRemovalId: string;
let removedByDisabledPlatformId: string;
let neverInstalledNoRowId: string;
let neverInstalledEmptyRowId: string;

describe("resolveBulkSendAttendeeIds - wallet_status filter", () => {
  beforeAll(async () => {
    prisma = createTestPrismaClient();
    await prisma.walletPass.deleteMany({ where: { attendee: { event_id: EVENT } } });
    await prisma.attendee.deleteMany({ where: { event_id: EVENT } });
    await prisma.event.deleteMany({ where: { id: EVENT } });
    await prisma.organization.deleteMany({ where: { id: ORG } });

    await prisma.organization.create({ data: { id: ORG, name: "Org", slug: "bulk-wallet-status-org" } });
    // Apple enabled, Google/Samsung disabled - exercises the edge case where a real Google
    // registration must not count as "active" for this event, but must still count as "removed"
    // (real install history the event's current settings can't retroactively erase).
    await prisma.event.create({
      data: {
        id: EVENT,
        title: "Event",
        slug: "bulk-wallet-status-event",
        date: new Date("2026-10-01"),
        organization_id: ORG,
        wallet_enabled: true,
        wallet_apple_enabled: true,
        wallet_google_enabled: false,
        wallet_samsung_enabled: false,
      },
    });

    const makeAttendee = async (id: string, email: string) =>
      prisma.attendee.create({ data: { id, event_id: EVENT, email, name: id } });

    await makeAttendee("att-active", "active@example.com");
    await makeAttendee("att-removed-by-removal", "removed-by-removal@example.com");
    await makeAttendee("att-removed-by-disabled-platform", "removed-by-disabled-platform@example.com");
    await makeAttendee("att-never-no-row", "never-no-row@example.com");
    await makeAttendee("att-never-empty-row", "never-empty-row@example.com");
    activeId = "att-active";
    removedByRemovalId = "att-removed-by-removal";
    removedByDisabledPlatformId = "att-removed-by-disabled-platform";
    neverInstalledNoRowId = "att-never-no-row";
    neverInstalledEmptyRowId = "att-never-empty-row";

    // Active on the event's one enabled platform (Apple).
    await prisma.walletPass.create({
      data: { attendee_id: activeId, apple_active_registrations: 1 },
    });
    // Installed, then removed (first_confirmed_at set, no active registrations anywhere).
    await prisma.walletPass.create({
      data: { attendee_id: removedByRemovalId, first_confirmed_at: new Date("2026-08-01") },
    });
    // Live registration, but on Google - disabled for this event, so not "active"; the raw
    // registration count still makes this attendee "ever installed", so it must read as
    // "removed", not "never_installed".
    await prisma.walletPass.create({
      data: { attendee_id: removedByDisabledPlatformId, google_active_registrations: 1 },
    });
    // att-never-no-row has no WalletPass row at all.
    // Row exists but carries no install history whatsoever.
    await prisma.walletPass.create({ data: { attendee_id: neverInstalledEmptyRowId } });
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("'active' matches only attendees with a live registration on a currently-enabled platform", async () => {
    const result = await resolveBulkSendAttendeeIds(prisma, EVENT, { type: "wallet_status", value: "active" });
    expect(result).toEqual({ ids: [activeId], overLimit: false });
  });

  it("'removed' matches ever-installed attendees who aren't currently active, including a real registration on a since-disabled platform", async () => {
    const result = await resolveBulkSendAttendeeIds(prisma, EVENT, { type: "wallet_status", value: "removed" });
    expect(result.overLimit).toBe(false);
    expect(result.ids.sort()).toEqual([removedByDisabledPlatformId, removedByRemovalId].sort());
  });

  it("'never_installed' matches attendees with no install history at all", async () => {
    const result = await resolveBulkSendAttendeeIds(prisma, EVENT, {
      type: "wallet_status",
      value: "never_installed",
    });
    expect(result.overLimit).toBe(false);
    expect(result.ids.sort()).toEqual([neverInstalledEmptyRowId, neverInstalledNoRowId].sort());
  });
});
