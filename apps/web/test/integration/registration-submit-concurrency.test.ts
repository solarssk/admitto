/**
 * `POST /r/:slug` when several writers want the same event at once (family C of the plan; CP-10): guests who send the
 * same address together, and an import that holds the capacity lock for as long as it runs. What is claimed: one
 * address makes one registration however many requests carry it, a held lock is answered with `503 try_again` and
 * nothing written, and a crowd of guests behind a long import holds none of the connection pool the panel needs.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { PrismaClient } from "@admitto/db";
import { Prisma } from "@admitto/db";
import { createTestPrismaClient } from "@admitto/db/testing";
import { SelectiveStore, eventSeeder, harness, holdCapacityLock as holdLock, nextEmail, signature } from "../helpers/registration-submit-harness.js";

const ORG = "org-reg95c-concurrency";

let prisma: PrismaClient;
let holderClient: PrismaClient;
let seeder: ReturnType<typeof eventSeeder>;
let slugCounter = 0;
const nextSlug = (label: string) => `reg95c-con-${label}-${(slugCounter += 1)}`;

beforeAll(async () => {
  prisma = createTestPrismaClient();
  // Another pool: the writer that holds the lock is another process as far as connections go.
  holderClient = createTestPrismaClient();
  seeder = eventSeeder(prisma, ORG);
  await seeder.prepare();
});

afterAll(async () => {
  await seeder?.wipe();
  await prisma?.$disconnect();
  await holderClient?.$disconnect();
});

/** What an import does to the event: takes the capacity lock and keeps it until `release` is called. */
const holdCapacityLock = (eventId: string) => holdLock(holderClient, eventId);

/** How many transactions of this database wait for the capacity lock of this event right now. */
async function waitingForCapacityLock(eventId: string): Promise<number> {
  const rows = await prisma.$queryRaw<{ waiting: bigint }[]>(Prisma.sql`
    SELECT count(*)::bigint AS "waiting"
    FROM pg_locks l, (SELECT (hashtext(${`event-capacity:${eventId}`}))::bigint AS "k") wanted
    WHERE l.locktype = 'advisory' AND NOT l.granted
      AND l.database = (SELECT oid FROM pg_database WHERE datname = current_database())
      AND l.classid = ((wanted."k" >> 32) & 4294967295)::oid
      AND l.objid = (wanted."k" & 4294967295)::oid
  `);
  return Number(rows[0]?.waiting ?? 0);
}

const countsOf = async (eventId: string) => ({
  registrations: await prisma.registration.count({ where: { event_id: eventId } }),
  mails: await prisma.registrationMail.count({ where: { event_id: eventId } }),
  attendees: await prisma.attendee.count({ where: { event_id: eventId } }),
});

describe("guests who send at the same moment", () => {
  it("make one registration and one mail from one address sent twice at once, and both are told the same", async () => {
    const slug = nextSlug("twice");
    const eventId = await seeder.addEvent(slug, { settings: { verify_email: true } });
    const h = harness({ prisma });
    const email = nextEmail("twice");

    const answers = await Promise.all([
      h.post(slug, h.body(slug, { email, first_name: "First" })),
      h.post(slug, h.body(slug, { email, first_name: "Second" })),
    ]);

    const signatures = await Promise.all(answers.map((res) => signature(res)));
    expect(signatures[0]!.status).toBe(200);
    expect(signatures[1]).toEqual(signatures[0]);
    expect(await countsOf(eventId)).toEqual({ registrations: 1, mails: 1, attendees: 0 });
  });

  it("make one registration from one address sent many times at once, with the answers of any other address", async () => {
    const slug = nextSlug("many");
    const eventId = await seeder.addEvent(slug, { settings: { verify_email: false, mode: "approval" } });
    const h = harness({ prisma });
    const email = nextEmail("many");

    const answers = await Promise.all(Array.from({ length: 6 }, () => h.post(slug, h.body(slug, { email }))));

    expect((await Promise.all(answers.map((res) => res.status))).every((status) => status === 200)).toBe(true);
    expect(await countsOf(eventId)).toEqual({ registrations: 1, mails: 1, attendees: 0 });
  });

  it("make a registration each from different addresses sent at once", async () => {
    const slug = nextSlug("different");
    const eventId = await seeder.addEvent(slug, { settings: { verify_email: true } });
    const h = harness({ prisma });

    const answers = await Promise.all(Array.from({ length: 6 }, () => h.post(slug, h.body(slug))));

    expect(answers.map((res) => res.status)).toEqual([200, 200, 200, 200, 200, 200]);
    expect(await countsOf(eventId)).toEqual({ registrations: 6, mails: 6, attendees: 0 });
  });

  it("give the last seat to one of two guests at once, and the waiting list to the other", async () => {
    const slug = nextSlug("last-seat");
    const eventId = await seeder.addEvent(slug, { capacity: 1, settings: { verify_email: false, mode: "automatic" } });
    const h = harness({ prisma });

    await Promise.all([h.post(slug, h.body(slug)), h.post(slug, h.body(slug))]);

    const statuses = (await prisma.registration.findMany({ where: { event_id: eventId } })).map((row) => row.status).sort();
    expect(statuses).toEqual(["accepted", "waitlist"]);
    expect(await prisma.attendee.count({ where: { event_id: eventId } })).toBe(1);
  });
});

describe("an import holds the capacity lock", () => {
  it("is answered with 503 try_again and a Retry-After, with nothing written, for a new address and a known one alike", async () => {
    const slug = nextSlug("busy");
    const eventId = await seeder.addEvent(slug, { settings: { verify_email: true } });
    const known = await prisma.registration.create({
      data: { event_id: eventId, email: nextEmail("known"), first_name: "K", last_name: "N", name: "K N", status: "pending" },
    });
    const held = nextEmail("held");
    await prisma.attendee.create({ data: { event_id: eventId, email: held, name: "Held Attendee" } });
    const h = harness({ prisma, placement: { retryMs: 300, pauseMs: [10, 20] } });
    const importing = holdCapacityLock(eventId);
    await importing.started;
    const before = await countsOf(eventId);

    const answers = [];
    for (const email of [nextEmail("new"), known.email, held]) answers.push(await signature(await h.post(slug, h.body(slug, { email }))));

    expect(answers[0]!.status).toBe(503);
    expect(answers[0]!.body).toBe('{"error":"try_again"}');
    expect(answers[0]!.headers["retry-after"]).toBe("5");
    for (const other of answers) expect(other).toEqual(answers[0]);
    expect(await countsOf(eventId)).toEqual(before);

    await importing.release();
    expect((await h.post(slug, h.body(slug))).status).toBe(200);
  });

  it("does not use up the budget of the guest's own address by telling them to try again", async () => {
    const slug = nextSlug("busy-budget");
    const eventId = await seeder.addEvent(slug, { settings: { verify_email: true } });
    const store = new SelectiveStore();
    const h = harness({ prisma, store, placement: { retryMs: 150, pauseMs: [10, 20] } });
    const email = nextEmail("patient");
    const importing = holdCapacityLock(eventId);
    await importing.started;

    // More tries than the budget of an address allows in a day (3).
    for (let i = 0; i < 5; i += 1) expect((await h.post(slug, h.body(slug, { email }))).status).toBe(503);
    expect(store.keys.some((key) => key.startsWith("registration:mail-recipient:"))).toBe(false);
    await importing.release();
    expect((await h.post(slug, h.body(slug, { email }))).status).toBe(200);

    // The mail is queued: the budget was still whole.
    expect(await prisma.registrationMail.count({ where: { event_id: eventId, registration: { email } } })).toBe(1);
  });

  it("keeps trying while the import works, and succeeds when it ends before the guest's patience does", async () => {
    const slug = nextSlug("patient");
    const eventId = await seeder.addEvent(slug, { settings: { verify_email: true } });
    const h = harness({ prisma, placement: { retryMs: 4_000, pauseMs: [20, 40] } });
    const importing = holdCapacityLock(eventId);
    await importing.started;

    const sending = h.post(slug, h.body(slug));
    await new Promise((resolve) => setTimeout(resolve, 200));
    await importing.release();

    expect((await sending).status).toBe(200);
    expect((await countsOf(eventId)).registrations).toBe(1);
  });

  it("holds none of the pool for twenty guests at once: no connection waits for the lock, and the panel keeps answering", async () => {
    const slug = nextSlug("crowd");
    const eventId = await seeder.addEvent(slug, { capacity: 100, settings: { verify_email: true } });
    const h = harness({ prisma, placement: { retryMs: 1_200 } });
    const importing = holdCapacityLock(eventId);
    await importing.started;

    const sending = Array.from({ length: 20 }, () => h.post(slug, h.body(slug)));
    const waiters: number[] = [];
    const panel: number[] = [];
    for (let i = 0; i < 12; i += 1) {
      waiters.push(await waitingForCapacityLock(eventId));
      const started = performance.now();
      await prisma.event.count();
      panel.push(performance.now() - started);
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    const answers = await Promise.all(sending);

    expect(answers.map((res) => res.status)).toEqual(Array.from({ length: 20 }, () => 503));
    expect(Math.max(...waiters)).toBe(0);
    // No limit on how fast; only that the panel is never left waiting for a connection that a guest holds.
    expect(Math.max(...panel)).toBeLessThan(5_000);
    expect((await countsOf(eventId)).registrations).toBe(0);

    await importing.release();
    expect((await h.post(slug, h.body(slug))).status).toBe(200);
  });
});
