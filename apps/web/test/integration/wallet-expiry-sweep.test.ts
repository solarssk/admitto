import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { PrismaClient } from "@admitto/db";
import { createTestPrismaClient } from "@admitto/db/testing";
import { runWalletExpiry } from "@admitto/wallet";

// runWalletExpiry is the wallet_expire worker job. Its unit test mocks the database, so this file
// is what runs the sweep against a real one (the queries and the event relation filter).

const ORG_ID = "org-wallet-expiry-sweep";
const ENDED_EVENT = "evt-wallet-expiry-ended";
const MOVED_EVENT = "evt-wallet-expiry-moved";

// 2026-05-01 17:00 UTC: after an event on 2026-05-01 that ends 18:00 Europe/Warsaw (16:00 UTC).
const NOW = Date.parse("2026-05-01T17:00:00.000Z");
const PAST = new Date("2026-05-01T16:00:00.000Z");
const FUTURE = new Date("2026-05-02T16:00:00.000Z");

const ATTENDEES = {
  active: "att-wexp-active",
  voided: "att-wexp-voided",
  future: "att-wexp-future",
  alreadyExpired: "att-wexp-already-expired",
  moved: "att-wexp-moved",
};

let prisma: PrismaClient;

async function cleanup(): Promise<void> {
  await prisma.walletPass.deleteMany({ where: { attendee: { event_id: { in: [ENDED_EVENT, MOVED_EVENT] } } } });
  await prisma.attendee.deleteMany({ where: { event_id: { in: [ENDED_EVENT, MOVED_EVENT] } } });
  await prisma.event.deleteMany({ where: { id: { in: [ENDED_EVENT, MOVED_EVENT] } } });
  await prisma.organization.deleteMany({ where: { id: ORG_ID } });
}

function eventData(id: string, date: string) {
  return {
    id,
    title: `Wallet expiry ${id}`,
    slug: `${id}-slug`,
    date: new Date(date),
    timezone: "Europe/Warsaw",
    event_hours_start: "09:00",
    event_hours_end: "18:00",
    organization_id: ORG_ID,
    wallet_enabled: true,
    wallet_expiration_mode: "event_end",
  };
}

beforeAll(async () => {
  prisma = createTestPrismaClient();
  await cleanup();
  await prisma.organization.create({ data: { id: ORG_ID, name: "Org", slug: "wallet-expiry-sweep-org" } });
  await prisma.event.create({ data: eventData(ENDED_EVENT, "2026-05-01T12:00:00.000Z") });
  // The end time was moved to the next day after these passes were issued, so they still carry
  // the earlier date the event used to end on.
  await prisma.event.create({ data: eventData(MOVED_EVENT, "2026-05-02T12:00:00.000Z") });
  const attendee = (id: string, eventId: string) => ({
    id,
    event_id: eventId,
    email: `${id}@example.com`,
    name: id,
    status: "registered",
  });
  await prisma.attendee.createMany({
    data: [
      attendee(ATTENDEES.active, ENDED_EVENT),
      attendee(ATTENDEES.voided, ENDED_EVENT),
      attendee(ATTENDEES.future, ENDED_EVENT),
      attendee(ATTENDEES.alreadyExpired, ENDED_EVENT),
      attendee(ATTENDEES.moved, MOVED_EVENT),
    ],
  });
});

beforeEach(async () => {
  await prisma.walletPass.deleteMany({ where: { attendee: { event_id: { in: [ENDED_EVENT, MOVED_EVENT] } } } });
  const pass = (attendeeId: string, status: string, expiresAt: Date) => ({
    attendee_id: attendeeId,
    provider: "passcreator",
    user_provided_id: `admitto:test:${attendeeId}`,
    provider_pass_id: `pc-${attendeeId}`,
    status,
    expires_at: expiresAt,
  });
  await prisma.walletPass.createMany({
    data: [
      pass(ATTENDEES.active, "active", PAST),
      pass(ATTENDEES.voided, "voided", PAST),
      pass(ATTENDEES.future, "active", FUTURE),
      pass(ATTENDEES.alreadyExpired, "expired", PAST),
      pass(ATTENDEES.moved, "active", PAST),
    ],
  });
});

afterAll(async () => {
  await cleanup();
  await prisma?.$disconnect();
});

async function statusOf(attendeeId: string): Promise<string> {
  return (await prisma.walletPass.findUniqueOrThrow({ where: { attendee_id: attendeeId } })).status;
}

describe("runWalletExpiry against a real database", () => {
  it("expires due active and voided passes of an event that is over, and nothing else", async () => {
    const result = await runWalletExpiry(prisma, NOW);

    expect(await statusOf(ATTENDEES.active)).toBe("expired");
    expect(await statusOf(ATTENDEES.voided)).toBe("expired");
    expect(await statusOf(ATTENDEES.future)).toBe("active");
    expect(await statusOf(ATTENDEES.alreadyExpired)).toBe("expired");
    expect(result.expired).toBe(2);
  });

  it("leaves a due pass alone while its event, whose end was moved later, is still going", async () => {
    const result = await runWalletExpiry(prisma, NOW);

    // A stale expires_at from before the end time was moved must not close the pass mid-event.
    expect(await statusOf(ATTENDEES.moved)).toBe("active");
    expect(result.deferredEvents).toBe(1);
  });

  it("expires it once the moved end has really passed", async () => {
    const afterMovedEnd = Date.parse("2026-05-02T17:00:00.000Z");

    await runWalletExpiry(prisma, afterMovedEnd);

    expect(await statusOf(ATTENDEES.moved)).toBe("expired");
  });

  it("keeps voided_at history untouched when it expires a voided pass", async () => {
    const voidedAt = new Date("2026-04-30T10:00:00.000Z");
    await prisma.walletPass.update({ where: { attendee_id: ATTENDEES.voided }, data: { voided_at: voidedAt } });

    await runWalletExpiry(prisma, NOW);

    const row = await prisma.walletPass.findUniqueOrThrow({ where: { attendee_id: ATTENDEES.voided } });
    expect(row.status).toBe("expired");
    expect(row.voided_at?.toISOString()).toBe(voidedAt.toISOString());
  });
});
