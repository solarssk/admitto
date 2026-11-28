/**
 * The 24-hour clean-up of registrations that were never confirmed: what it deletes, in what units, under which locks.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { createTestPrismaClient } from "@admitto/db/testing";
import { lockRegistrationQueue } from "@admitto/tickets";
import { REGISTRATION_EXPIRY_BATCH_SIZE, sweepExpiredRegistrations } from "../src/index.js";
import { resetDb } from "./resetDb.js";
import { seedOrgAndEvent } from "./seedOrgAndEvent.js";
import {
  createRegistration,
  holdTransaction,
  queueMail,
  waitUntilWaitingForRegistrationQueue,
} from "./registrationMailFixtures.js";

const prisma = createTestPrismaClient();
const EVENT_A = "evt-regmail-sweep-a";
const EVENT_B = "evt-regmail-sweep-b";
const ORG_ID = "org-regmail-sweep";

beforeAll(async () => {
  await resetDb();
  await seedOrgAndEvent(prisma, {
    orgId: ORG_ID,
    orgName: "Registration Mail Sweep Org",
    orgSlug: "registration-mail-sweep-org",
    eventId: EVENT_A,
    eventTitle: "Sweep A",
    eventSlug: "sweep-a",
  });
  await prisma.event.create({
    data: { id: EVENT_B, organization_id: ORG_ID, title: "Sweep B", slug: "sweep-b", date: new Date("2026-09-02") },
  });
});

afterAll(async () => {
  await prisma.$disconnect();
});

beforeEach(async () => {
  vi.restoreAllMocks();
  await prisma.registration.deleteMany();
  await prisma.event.deleteMany({ where: { id: { notIn: [EVENT_A, EVENT_B] } } });
});

const MINUTE = 60_000;
const expired = (eventId = EVENT_A) => createRegistration(prisma, eventId, "awaiting_email", { expiresAt: new Date(Date.now() - MINUTE) });
const waiting = (eventId = EVENT_A) => createRegistration(prisma, eventId, "awaiting_email", { expiresAt: new Date(Date.now() + MINUTE) });
const exists = async (id: string) => (await prisma.registration.count({ where: { id } })) === 1;

describe("sweepExpiredRegistrations", () => {
  it("deletes the registrations whose link expired, with their queued mail, and nothing else", async () => {
    const gone = await expired();
    const goneMail = await queueMail(prisma, gone, "registration-confirm");
    const stillWaiting = await waiting();
    // Old, but not waiting for an address: the clean-up is the only automatic deletion and it is for these alone.
    const decided = await Promise.all(
      ["pending", "waitlist", "rejected"].map((status) => createRegistration(prisma, EVENT_A, status)),
    );
    await prisma.registration.updateMany({ where: { id: { in: decided.map((row) => row.id) } }, data: { created_at: new Date("2020-01-01") } });

    const result = await sweepExpiredRegistrations(prisma);

    expect(result).toEqual({ deleted: 1, eventIds: [EVENT_A], more: false });
    expect(await exists(gone.id)).toBe(false);
    expect(await prisma.registrationMail.count({ where: { id: goneMail.id } })).toBe(0);
    expect(await exists(stillWaiting.id)).toBe(true);
    for (const row of decided) expect(await exists(row.id)).toBe(true);
  });

  it("does nothing when nothing expired", async () => {
    await waiting();

    expect(await sweepExpiredRegistrations(prisma)).toEqual({ deleted: 0, eventIds: [], more: false });
  });

  it("works through every event that has expired registrations, one transaction per event", async () => {
    const [a, b] = await Promise.all([expired(EVENT_A), expired(EVENT_B)]);
    const transaction = vi.spyOn(prisma, "$transaction");

    const result = await sweepExpiredRegistrations(prisma);

    expect(result).toEqual({ deleted: 2, eventIds: [EVENT_A, EVENT_B], more: false });
    expect(await exists(a.id) || (await exists(b.id))).toBe(false);
    // One transaction for each event, which takes that event's queue alone: no transaction covers two events.
    expect(transaction).toHaveBeenCalledTimes(2);
  });

  it("deletes in batches, and says when it stopped before the end", async () => {
    await Promise.all(Array.from({ length: 5 }, () => expired()));

    expect(await sweepExpiredRegistrations(prisma, { batchSize: 2 })).toEqual({ deleted: 5, eventIds: [EVENT_A], more: false });
    expect(REGISTRATION_EXPIRY_BATCH_SIZE).toBe(500);

    // A run is cut short at 20 batches, so that it cannot hold up a worker tick; the next run goes on.
    await Promise.all(Array.from({ length: 25 }, () => expired()));
    expect(await sweepExpiredRegistrations(prisma, { batchSize: 1 })).toEqual({ deleted: 20, eventIds: [EVENT_A], more: true });
    expect(await sweepExpiredRegistrations(prisma, { batchSize: 1 })).toEqual({ deleted: 5, eventIds: [EVENT_A], more: false });
  });

  it("takes 20 events in one run, and says there may be more when it took that many", async () => {
    const events = Array.from({ length: 21 }, (_, index) => `evt-regmail-sweep-many-${String(index).padStart(2, "0")}`);
    await prisma.event.createMany({
      data: events.map((id) => ({ id, organization_id: ORG_ID, title: id, slug: id, date: new Date("2026-09-03") })),
    });
    await Promise.all(events.map((id) => expired(id)));

    expect(await sweepExpiredRegistrations(prisma)).toMatchObject({ deleted: 20, more: true });
    expect(await sweepExpiredRegistrations(prisma)).toMatchObject({ deleted: 1, more: false });
  });

  it("checks the expiry again under the lock: a registration confirmed after the events were read stays", async () => {
    const confirmed = await expired();
    const lapsed = await expired();
    const read = prisma.$queryRaw.bind(prisma);
    vi.spyOn(prisma, "$queryRaw").mockImplementationOnce((async (...args: Parameters<typeof read>) => {
      const events = await read(...args);
      // The guest clicks the link between the plain read of the events and the delete.
      await prisma.registration.update({ where: { id: confirmed.id }, data: { status: "pending", confirm_expires_at: null } });
      return events;
    }) as never);

    const result = await sweepExpiredRegistrations(prisma);

    expect(result.deleted).toBe(1);
    expect(await exists(confirmed.id)).toBe(true);
    expect(await exists(lapsed.id)).toBe(false);
  });
});

describe("sweepExpiredRegistrations and the registration queue", () => {
  it("waits for the queue of the event, and deletes once it is free", async () => {
    const row = await expired();
    const holder = holdTransaction(prisma, (tx) => lockRegistrationQueue(tx, EVENT_A));
    await holder.started;

    let finished = false;
    const sweeping = sweepExpiredRegistrations(prisma).then((result) => {
      finished = true;
      return result;
    });
    await waitUntilWaitingForRegistrationQueue(prisma, EVENT_A);
    expect(finished).toBe(false);
    expect(await exists(row.id)).toBe(true);

    await holder.commit();
    expect((await sweeping).deleted).toBe(1);
    expect(await exists(row.id)).toBe(false);
  });

  it("is not held up by the queue of another event", async () => {
    const row = await expired(EVENT_A);
    const holder = holdTransaction(prisma, (tx) => lockRegistrationQueue(tx, EVENT_B));
    await holder.started;

    expect((await sweepExpiredRegistrations(prisma)).deleted).toBe(1);

    await holder.commit();
    expect(await exists(row.id)).toBe(false);
  });

  it("does not deadlock with a transaction that holds the queue and then the registration's row, which is how a decision takes them", async () => {
    const row = await expired();
    const decision = holdTransaction(prisma, async (tx) => {
      await lockRegistrationQueue(tx, EVENT_A);
      await tx.$queryRaw`SELECT "id" FROM "Registration" WHERE "id" = ${row.id} FOR UPDATE`;
    });
    await decision.started;

    const sweeping = sweepExpiredRegistrations(prisma);
    await waitUntilWaitingForRegistrationQueue(prisma, EVENT_A);
    await decision.commit();

    expect((await sweeping).deleted).toBe(1);
  });
});

describe("sweepExpiredRegistrations in any time zone of the database session", () => {
  // The columns hold naive UTC. A bare NOW() is compared in the session's zone, which moves the comparison by its
  // offset, either way: a zone ahead of UTC deletes registrations that have not expired, one behind keeps some that have.
  it.each(["Pacific/Kiritimati", "Asia/Kolkata", "UTC", "America/Los_Angeles", "Pacific/Pago_Pago"])(
    "deletes what expired a minute ago and keeps what expires in a minute (session zone %s)",
    async (zone) => {
      const url = new URL(process.env.DATABASE_URL ?? "");
      url.searchParams.set("options", `-c TimeZone=${zone}`);
      const zoned = createTestPrismaClient(url.toString());
      try {
        const [{ TimeZone }] = await zoned.$queryRaw<{ TimeZone: string }[]>`SHOW TimeZone`;
        expect(TimeZone).toBe(zone);
        const gone = await expired();
        const kept = await waiting();

        expect((await sweepExpiredRegistrations(zoned)).deleted).toBe(1);

        expect(await exists(gone.id)).toBe(false);
        expect(await exists(kept.id)).toBe(true);
      } finally {
        await zoned.$disconnect();
      }
    },
  );
});
