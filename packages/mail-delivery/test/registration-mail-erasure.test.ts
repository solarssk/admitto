/**
 * The registration mail drain against an erasure or a removal of the person it would mail, and against a decision
 * that is still open: the last check waits for them and sees their result, and a send never holds a lock, so it
 * never makes one wait. Two real transactions, each side first, as in packages/tickets/test/registration-erasure.test.ts.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { Prisma } from "@admitto/db";
import { createTestPrismaClient } from "@admitto/db/testing";
import { eraseAttendees, lockRegistrationQueue, removeAttendees, tryLockRegistrationQueue } from "@admitto/tickets";
import { drainRegistrationMails } from "../src/index.js";
import { resetDb } from "./resetDb.js";
import { seedOrgAndEvent } from "./seedOrgAndEvent.js";
import {
  BASE_URL,
  TEST_ENV,
  collectMail,
  createRegistration,
  holdTransaction,
  queueMail,
  uniqueEmail,
  waitUntilWaitingForRegistrationQueue,
} from "./registrationMailFixtures.js";

const prisma = createTestPrismaClient();
const EVENT_ID = "evt-regmail-erasure";

beforeAll(async () => {
  await resetDb();
  await seedOrgAndEvent(prisma, {
    orgId: "org-regmail-erasure",
    orgName: "Registration Mail Erasure Org",
    orgSlug: "registration-mail-erasure-org",
    eventId: EVENT_ID,
    eventTitle: "Erasure Event",
    eventSlug: "erasure-event",
  });
});

afterAll(async () => {
  await prisma.$disconnect();
});

beforeEach(async () => {
  await prisma.registration.deleteMany();
  await prisma.attendee.deleteMany();
});

type Act = "erasure" | "removal";
const ACTS: Act[] = ["erasure", "removal"];

const act = (tx: Prisma.TransactionClient, kind: Act, attendeeId: string) =>
  kind === "erasure"
    ? eraseAttendees(tx, { eventId: EVENT_ID, attendeeIds: [attendeeId] })
    : removeAttendees(tx, { eventId: EVENT_ID, attendeeIds: [attendeeId] });

/** A person who is an attendee, and the registration with their address that has a mail waiting. */
async function personWithQueuedMail(template = "registration-received") {
  const email = uniqueEmail("person");
  const attendee = await prisma.attendee.create({ data: { event_id: EVENT_ID, email, name: "Pat Person" } });
  const registration = await createRegistration(prisma, EVENT_ID, "pending", { email });
  const mail = await queueMail(prisma, registration, template);
  return { attendee, registration, mail, email };
}

const drain = (deps = {}) => drainRegistrationMails(prisma, TEST_ENV, deps, { baseUrl: BASE_URL });

const mailExists = async (id: string) => (await prisma.registrationMail.count({ where: { id } })) === 1;

/** True when nothing holds the attendee's row: a probe that fails at once instead of waiting if somebody does. */
const attendeeRowIsFree = async (id: string) => {
  try {
    await prisma.$queryRaw`SELECT "id" FROM "Attendee" WHERE "id" = ${id} FOR UPDATE NOWAIT`;
    return true;
  } catch {
    return false;
  }
};

describe("a registration mail and an erasure or a removal of the person", () => {
  it.each(ACTS)("waits for an open %s, and then finds nothing to send", async (kind) => {
    const { attendee, mail } = await personWithQueuedMail();
    const { messages, deps } = collectMail();
    const open = holdTransaction(prisma, (tx) => act(tx, kind, attendee.id));
    await open.started;

    let finished = false;
    const draining = drain(deps).then((result) => {
      finished = true;
      return result;
    });
    // The last check is waiting for the registration queue, which the open transaction holds.
    await waitUntilWaitingForRegistrationQueue(prisma, EVENT_ID);
    expect(finished).toBe(false);
    expect(messages).toHaveLength(0);

    await open.commit();
    expect(await draining).toMatchObject({ claimed: 1, sent: 0, skipped: 1 });

    expect(messages).toHaveLength(0);
    expect(await mailExists(mail.id)).toBe(false);
  });

  it.each(ACTS)("does not make an %s wait while the mail is being sent, and the mail goes out once", async (kind) => {
    const { attendee, registration, mail, email } = await personWithQueuedMail();
    const sent: string[] = [];
    let releaseSend!: () => void;
    const sendHeld = new Promise<void>((resolve) => {
      releaseSend = resolve;
    });
    const deps = {
      exportSink: async ({ message }: { message: { to: string } }) => {
        sent.push(message.to);
        await sendHeld;
      },
    };

    const draining = drain(deps);
    await vi.waitFor(() => expect(sent).toEqual([email]), { timeout: 10_000, interval: 25 });

    // The mail is with the provider. Nothing of the drain is held: not the queue, not a row of the person.
    expect(await prisma.$transaction((tx) => tryLockRegistrationQueue(tx, EVENT_ID))).toBe(true);
    expect(await attendeeRowIsFree(attendee.id)).toBe(true);
    // So the erasure runs to its end at once, deleting the registration and its mail.
    const result = await prisma.$transaction((tx) => act(tx, kind, attendee.id), { timeout: 10_000 });
    expect(result.counts.registrations).toBe(1);
    expect(await prisma.registration.count({ where: { id: registration.id } })).toBe(0);

    releaseSend();
    // The result finds no row to write on: nothing is put back.
    expect(await draining).toMatchObject({ claimed: 1, sent: 0, skipped: 1 });
    expect(sent).toEqual([email]);
    expect(await mailExists(mail.id)).toBe(false);
  });

  it("waits for a decision that is still open and sees it: a mail for a state the registration left is not sent", async () => {
    const { registration, mail } = await personWithQueuedMail();
    const { messages, deps } = collectMail();
    // What staff turning the guest down does: the queue first, then the registration.
    const open = holdTransaction(prisma, async (tx) => {
      await lockRegistrationQueue(tx, EVENT_ID);
      await tx.registration.update({ where: { id: registration.id }, data: { status: "rejected", decided_by: "staff-1" } });
    });
    await open.started;

    const draining = drain(deps);
    await waitUntilWaitingForRegistrationQueue(prisma, EVENT_ID);
    await open.commit();

    expect(await draining).toMatchObject({ claimed: 1, sent: 0, cancelled: 1 });
    expect(messages).toHaveLength(0);
    expect((await prisma.registrationMail.findUniqueOrThrow({ where: { id: mail.id } })).error_code).toBe("registration_changed");
  });

  it("does not deadlock with erasures that run while it sends, and sends no mail twice", async () => {
    const people = await Promise.all(Array.from({ length: 10 }, () => personWithQueuedMail()));
    const erased = people.slice(0, 5);
    const kept = people.slice(5);
    const { messages, deps } = collectMail();

    // Two drains and five erasures at once: a lock order that is wrong shows as a deadlock error here.
    const outcomes = await Promise.allSettled([
      drain(deps),
      drain(deps),
      ...erased.map((person, index) =>
        prisma.$transaction((tx) => act(tx, ACTS[index % 2]!, person.attendee.id), { timeout: 30_000 }),
      ),
    ]);

    expect(outcomes.filter((outcome) => outcome.status === "rejected")).toEqual([]);
    const recipients = messages.map((message) => message.to);
    expect(new Set(recipients).size).toBe(recipients.length);
    for (const person of kept) expect(recipients).toContain(person.email);
    for (const person of erased) {
      expect(await prisma.registration.count({ where: { id: person.registration.id } })).toBe(0);
      expect(recipients.filter((to) => to === person.email).length).toBeLessThanOrEqual(1);
    }
  });
});
