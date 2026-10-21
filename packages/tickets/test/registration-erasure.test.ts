/**
 * What an erasure and a removal of attendees do to guest registrations (the form submissions) and their queued mail,
 * and the registration queue lock that lets them run beside an admission, a deletion of a registration and the
 * sending of a registration mail without a deadlock. Runs against a db-push database with the CHECK constraints of the
 * registration migration applied on top, so every fixture is a row the database accepts.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { execSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { PrismaClient } from "@admitto/db";
import { Prisma } from "@admitto/db/client";
import { createTestPrismaClient } from "@admitto/db/testing";
import { assertTestDatabaseUrl } from "@admitto/db/test-db-guard";
import { lockAttendeeRow } from "../src/attendee-lock.js";
import { scrubAttendeeTraces } from "../src/attendee-traces.js";
import { eraseAttendees } from "../src/erase-attendees.js";
import { lockRegistrationQueue, tryLockRegistrationQueue } from "../src/registration-lock.js";
import { removeAttendees } from "../src/remove-attendees.js";
import { lockAttendeeJobQueue } from "../src/stop-open-jobs.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DB_ROOT = path.resolve(__dirname, "../../db");
const REGISTRATION_MIGRATION = path.join(
  DB_ROOT,
  "prisma/migrations/20261018100000_add_guest_registration_schema/migration.sql",
);
const ORG_ID = "org_reg_erasure";
const EVENT_ID = "evt-reg-erasure";
const OTHER_EVENT_ID = "evt-reg-erasure-other";

let prisma: PrismaClient;
let seq = 0;

beforeAll(async () => {
  assertTestDatabaseUrl(process.env.DATABASE_URL ?? "");
  execSync("npx prisma db push --force-reset --accept-data-loss", { cwd: DB_ROOT, env: { ...process.env }, stdio: "pipe" });
  prisma = createTestPrismaClient();
  // db push builds from schema.prisma only; the CHECK constraints of the two tables live in the migration SQL.
  const checks = readFileSync(REGISTRATION_MIGRATION, "utf8").match(/ALTER TABLE "Registration(?:Mail)?" ADD CONSTRAINT "\w+"\s+CHECK[\s\S]*?\);/g);
  if (!checks || checks.length < 9) throw new Error("registration CHECK constraints not found in the migration");
  for (const check of checks) await prisma.$executeRawUnsafe(check);
  await prisma.organization.create({ data: { id: ORG_ID, name: "Registration erasure", slug: "reg-erasure-org" } });
  for (const id of [EVENT_ID, OTHER_EVENT_ID]) {
    await prisma.event.create({ data: { id, title: id, slug: id, organization_id: ORG_ID, date: new Date("2026-09-01T09:00:00Z") } });
  }
});

afterAll(async () => {
  await prisma?.$disconnect();
});

type Act = "erasure" | "removal";
const ACTS: Act[] = ["erasure", "removal"];

/** What the tests read of either result. */
type ActResult = { counts: { registrations: number }; previousEmails: string[] };

const act = (tx: Prisma.TransactionClient, kind: Act, attendeeIds: string[], eventId = EVENT_ID): Promise<ActResult> =>
  kind === "erasure" ? eraseAttendees(tx, { eventId, attendeeIds }) : removeAttendees(tx, { eventId, attendeeIds });
const run = (kind: Act, attendeeIds: string[]) => prisma.$transaction((tx) => act(tx, kind, attendeeIds));

/** A unique, already normalised address for this test. */
const address = (label: string) => `${label}-${++seq}@example.com`;

const attendee = (email = address("person"), eventId = EVENT_ID) =>
  prisma.attendee.create({ data: { id: `reg-erasure-att-${++seq}`, event_id: eventId, email, name: `Person ${seq}` } });

const TEMPLATE_OF_STATUS = new Map([
  ["awaiting_email", "registration-confirm"],
  ["pending", "registration-received"],
  ["waitlist", "registration-waitlist"],
  ["rejected", "registration-rejected"],
  ["accepted", "ticket"],
]);

/** A registration with the rows the CHECK constraints require for its status, and one queued mail. */
async function registration(email: string, status: string, options: { attendeeId?: string; eventId?: string } = {}) {
  const row = await prisma.registration.create({
    data: {
      event_id: options.eventId ?? EVENT_ID,
      email,
      first_name: "Guest",
      last_name: "Example",
      name: "Guest Example",
      custom_data: { diet: "vegan" },
      companions: [{ name: "Companion Example", custom_data: {} }],
      status,
      attendee_id: options.attendeeId ?? null,
      confirm_expires_at: status === "awaiting_email" ? new Date(Date.now() + 86_400_000) : null,
    },
  });
  const mail = await prisma.registrationMail.create({
    data: { registration_id: row.id, event_id: row.event_id, template_name: TEMPLATE_OF_STATUS.get(status) ?? "ticket" },
  });
  return { id: row.id, mailId: mail.id };
}

const registrationExists = async (id: string) => (await prisma.registration.count({ where: { id } })) === 1;
const mailExists = async (id: string) => (await prisma.registrationMail.count({ where: { id } })) === 1;

/** The record of an edit of the attendee's address, the way the PATCH writes it into the activity log. */
const editedAddress = (attendeeId: string, from: string, to: string, eventId = EVENT_ID) =>
  prisma.attendeeActionLog.create({
    data: {
      event_id: eventId,
      attendee_id: attendeeId,
      action_type: "attendee_edited",
      metadata: { fields: ["email"], field_changes: { email: { from, to } } },
    },
  });

/** The attendee's first ticket mail, sent to `to`. */
const firstMail = (attendeeId: string, to: string) =>
  prisma.emailDelivery.create({
    data: {
      organization_id: ORG_ID,
      event_id: EVENT_ID,
      attendee_id: attendeeId,
      purpose: "initial",
      provider: "smtp",
      status: "sent",
      recipient_email: to,
      rendered_subject: "Your ticket",
      rendered_html: "<p>ticket</p>",
    },
  });

describe("an erasure or a removal deletes the person's registrations", () => {
  const cases = ACTS.flatMap((kind) => ["awaiting_email", "pending", "waitlist", "rejected"].map((status) => [kind, status] as const));

  it.each(cases)(
    "%s: the %s one with the person's address, whatever its case and padding, and the accepted one, each with its mail",
    async (kind, status) => {
      const plain = address("mixed.case");
      const person = await attendee(`  ${plain.toUpperCase()} `);
      // The address the guest registered with, before staff corrected the attendee's own (unique per event).
      const accepted = await registration(address("before-correction"), "accepted", { attendeeId: person.id });
      const sameAddress = await registration(plain, status);
      const otherEvent = await registration(plain, status, { eventId: OTHER_EVENT_ID });
      const stranger = await registration(address("stranger"), status);

      const result = await run(kind, [person.id]);

      expect(result.counts.registrations).toBe(2);
      for (const gone of [accepted, sameAddress]) {
        expect(await registrationExists(gone.id)).toBe(false);
        expect(await mailExists(gone.mailId)).toBe(false);
      }
      for (const kept of [otherEvent, stranger]) {
        expect(await registrationExists(kept.id)).toBe(true);
        expect(await mailExists(kept.mailId)).toBe(true);
      }
    },
  );

  it.each(ACTS)(
    "%s: not the one another attendee was accepted from, although it has the person's address in another spelling",
    async (kind) => {
      const plain = address("two.spellings");
      const person = await attendee(plain.replace("two", "Two"));
      const other = await attendee(plain);
      const theirs = await registration(plain, "accepted", { attendeeId: other.id });

      const result = await run(kind, [person.id]);

      expect(result.counts.registrations).toBe(0);
      expect(await registrationExists(theirs.id)).toBe(true);
      expect(await mailExists(theirs.mailId)).toBe(true);
    },
  );

  it.each(ACTS)(
    "%s: the ones with an address the person had before (their first ticket mail, an edit in their activity log)",
    async (kind) => {
      const person = await attendee(address("now"));
      const [toFirstMail, replaced, setThen, typo] = [address("first-mail"), address("replaced"), address("set-then"), address("typo")];
      await firstMail(person.id, toFirstMail.toUpperCase());
      // Two edits with one in between that the log does not hold: an address can be only a `from` or only a `to`.
      await editedAddress(person.id, replaced, setThen);
      await editedAddress(person.id, ` ${typo.toUpperCase()}`, person.email);
      const older = await Promise.all([toFirstMail, replaced, setThen, typo].map((email) => registration(email, "pending")));

      const result = await run(kind, [person.id]);

      expect([...result.previousEmails].sort((a, b) => a.localeCompare(b))).toEqual(
        [person.email, toFirstMail, replaced, setThen, typo].sort((a, b) => a.localeCompare(b)),
      );
      expect(result.counts.registrations).toBe(4);
      for (const gone of older) expect(await registrationExists(gone.id)).toBe(false);
    },
  );

  it.each(ACTS)(
    "%s: not one whose address another attendee holds now, or had before as well, because it may be theirs",
    async (kind) => {
      const person = await attendee(address("now"));
      const [heldNow, alsoTheirs] = [address("held-now"), address("also-theirs")];
      await editedAddress(person.id, heldNow, address("between"));
      await editedAddress(person.id, alsoTheirs, person.email);
      await attendee(heldNow);
      const other = await attendee(address("other-now"));
      await editedAddress(other.id, alsoTheirs, other.email);
      const kept = await Promise.all([heldNow, alsoTheirs].map((email) => registration(email, "waitlist")));

      const result = await run(kind, [person.id]);

      expect(result.previousEmails).not.toContain(heldNow);
      expect(result.previousEmails).not.toContain(alsoTheirs);
      for (const row of kept) expect(await registrationExists(row.id)).toBe(true);
    },
  );

  it.each(ACTS)("%s: still the one whose address an attendee of another event had: that event is not this one", async (kind) => {
    const person = await attendee(address("now"));
    const elsewhere = address("had-elsewhere");
    await editedAddress(person.id, elsewhere, person.email);
    const otherEventAttendee = await attendee(address("other-event-now"), OTHER_EVENT_ID);
    await editedAddress(otherEventAttendee.id, elsewhere, otherEventAttendee.email, OTHER_EVENT_ID);
    const sameAddress = await registration(elsewhere, "pending");

    const result = await run(kind, [person.id]);

    expect(result.previousEmails).toContain(elsewhere);
    expect(await registrationExists(sameAddress.id)).toBe(false);
  });

  it("counts nothing for an attendee erased before: their registrations went with the first erasure", async () => {
    const person = await attendee();
    await registration(person.email, "pending");
    expect((await run("erasure", [person.id])).counts.registrations).toBe(1);

    expect((await run("erasure", [person.id])).counts.registrations).toBe(0);
    // A removal of the erased attendee finds nothing left either.
    expect((await run("removal", [person.id])).counts.registrations).toBe(0);
  });
});

/** Waits until a statement whose text contains `text` waits for a row lock that another transaction holds. */
const waitUntilWaitingFor = (text: string) =>
  vi.waitFor(
    async () => {
      const rows = await prisma.$queryRaw<{ waiting: bigint }[]>`
        SELECT count(*)::bigint AS "waiting" FROM pg_stat_activity
        WHERE datname = current_database() AND wait_event_type = 'Lock' AND query LIKE ${`%${text}%`}
      `;
      expect(Number(rows[0]?.waiting ?? 0)).toBeGreaterThan(0);
    },
    { timeout: 5000, interval: 25 },
  );

/** Waits until a transaction waits for the advisory lock with this key (a bigint expression), in this database. */
const waitUntilWaitingForAdvisoryLock = (key: Prisma.Sql) =>
  vi.waitFor(
    async () => {
      const rows = await prisma.$queryRaw<{ waiting: bigint }[]>`
        SELECT count(*)::bigint AS "waiting"
        FROM pg_locks l, (SELECT (${key})::bigint AS "k") wanted
        WHERE l.locktype = 'advisory' AND NOT l.granted AND l.objsubid = 1
          AND l.database = (SELECT oid FROM pg_database WHERE datname = current_database())
          AND l.classid = ((wanted."k" >> 32) & 4294967295)::oid
          AND l.objid = (wanted."k" & 4294967295)::oid
      `;
      expect(Number(rows[0]?.waiting ?? 0)).toBeGreaterThan(0);
    },
    { timeout: 5000, interval: 25 },
  );

/** The registration queue of the event, by its key (registration-lock.ts). */
const waitUntilWaitingForRegistrationQueue = (eventId = EVENT_ID) =>
  waitUntilWaitingForAdvisoryLock(Prisma.sql`hashtextextended(${`registration-queue:${eventId}`}, 0)`);

/** The attendee job queue of the event, by its key (stop-open-jobs.ts). */
const waitUntilWaitingForJobQueue = (eventId = EVENT_ID) =>
  waitUntilWaitingForAdvisoryLock(Prisma.sql`hashtext(${`attendee-job-queue:${eventId}`})`);

/**
 * A transaction that runs `work`, reports what it returned, and stays open until `commit` is called; `then` runs in
 * the same transaction after that, before it commits.
 */
function holdTransaction<T>(
  work: (tx: Prisma.TransactionClient) => Promise<T>,
  then?: (tx: Prisma.TransactionClient) => Promise<unknown>,
) {
  let release!: () => void;
  const released = new Promise<void>((resolve) => {
    release = resolve;
  });
  let started!: (value: T) => void;
  const hasStarted = new Promise<T>((resolve) => {
    started = resolve;
  });
  const transaction = prisma.$transaction(
    async (tx) => {
      started(await work(tx));
      await released;
      await then?.(tx);
    },
    { timeout: 30_000 },
  );
  return {
    started: hasStarted,
    commit: async () => {
      release();
      await transaction;
    },
  };
}

/** True when nothing holds the attendee's row: a probe that fails at once instead of waiting if somebody does. */
const attendeeRowIsFree = async (id: string) => {
  try {
    await prisma.$queryRaw`SELECT "id" FROM "Attendee" WHERE "id" = ${id} FOR UPDATE NOWAIT`;
    return true;
  } catch {
    return false;
  }
};

const lockRegistration = (tx: Prisma.TransactionClient, id: string) =>
  tx.$queryRaw<{ id: string; status: string }[]>`SELECT "id", "status" FROM "Registration" WHERE "id" = ${id} FOR UPDATE`;

describe("lockRegistrationQueue", () => {
  it.each([true, false])("makes a second holder wait only when it is the same event (same event: %s)", async (sameEvent) => {
    const holder = holdTransaction((tx) => lockRegistrationQueue(tx, EVENT_ID));
    await holder.started;
    let done = false;
    const second = prisma
      .$transaction((tx) => lockRegistrationQueue(tx, sameEvent ? EVENT_ID : OTHER_EVENT_ID))
      .then(() => {
        done = true;
      });

    if (sameEvent) {
      await waitUntilWaitingForRegistrationQueue();
      expect(done).toBe(false);
    } else {
      await second;
    }
    await holder.commit();
    await second;
    expect(done).toBe(true);
  });

  it("is the lock that tryLockRegistrationQueue takes without waiting: refused while held, granted once free", async () => {
    const holder = holdTransaction((tx) => lockRegistrationQueue(tx, EVENT_ID));
    await holder.started;
    expect(await prisma.$transaction((tx) => tryLockRegistrationQueue(tx, EVENT_ID))).toBe(false);
    expect(await prisma.$transaction((tx) => tryLockRegistrationQueue(tx, OTHER_EVENT_ID))).toBe(true);
    await holder.commit();

    const trying = holdTransaction((tx) => tryLockRegistrationQueue(tx, EVENT_ID));
    expect(await trying.started).toBe(true);
    // Held by the try: a transaction that waits for the lock waits for it.
    const waiting = prisma.$transaction((tx) => lockRegistrationQueue(tx, EVENT_ID));
    await waitUntilWaitingForRegistrationQueue();
    await trying.commit();
    await waiting;
  });

  const admissionSteps = [
    // Its next step takes the person's row.
    ["locks the person's row", (tx: Prisma.TransactionClient, personId: string) => lockAttendeeRow(tx, personId, EVENT_ID)],
    // Its next step inserts an attendee with the person's address, the step of the deadlock the audit described. In this
    // order the erasure has not touched the person yet, so the insert meets a committed row and does not wait.
    [
      "inserts an attendee with the person's address",
      async (tx: Prisma.TransactionClient, personId: string) => {
        const person = await tx.attendee.findUniqueOrThrow({ where: { id: personId }, select: { email: true } });
        return tx.attendee.createMany({ data: [{ event_id: EVENT_ID, email: person.email, name: "Guest Example" }], skipDuplicates: true });
      },
    ],
  ] as const;
  const orderCases = ACTS.flatMap((kind) => admissionSteps.map(([step, next]) => [kind, step, next] as const));

  it.each(orderCases)(
    "a %s waits for a transaction that holds a registration (and then %s) before it locks the person, so the two cannot deadlock",
    async (kind, _step, next) => {
      const person = await attendee();
      const sameAddress = await registration(person.email, "pending");
      // What an admission does: the queue, the registration, and then a row of an attendee. An erasure that took the
      // person's row first and the registration last (when it deletes it) would wait for this one, and this one for it.
      const admission = holdTransaction(
        async (tx) => {
          await lockRegistrationQueue(tx, EVENT_ID);
          return lockRegistration(tx, sameAddress.id);
        },
        (tx) => next(tx, person.id),
      );
      await admission.started;

      const acting = prisma.$transaction((tx) => act(tx, kind, [person.id]));
      await waitUntilWaitingForRegistrationQueue();
      expect(await attendeeRowIsFree(person.id)).toBe(true);
      await admission.commit();
      const result = await acting;

      expect(result.counts.registrations).toBe(1);
      expect(await registrationExists(sameAddress.id)).toBe(false);
    },
  );

  it.each(ACTS)(
    "a %s takes it after the job locks, the order an event deletion takes them in: it holds nothing of it while it waits for the job queue",
    async (kind) => {
      const person = await attendee();
      // A request that creates an export or an import holds the job queue (shared) while it inserts the job.
      const creating = holdTransaction((tx) => lockAttendeeJobQueue(tx, EVENT_ID, "shared"));
      await creating.started;

      const acting = prisma.$transaction((tx) => act(tx, kind, [person.id]));
      await waitUntilWaitingForJobQueue();
      // Taken before the job queue, it would be held here, and an event deletion (job queue, then this lock) would
      // wait for it while this transaction waited for the job queue that the deletion holds.
      expect(await prisma.$transaction((tx) => tryLockRegistrationQueue(tx, EVENT_ID))).toBe(true);
      await creating.commit();
      await acting;
    },
  );

  it.each(ACTS)(
    "a transaction that would change a registration waits for an open %s, and then finds the person's registration gone",
    async (kind) => {
      const person = await attendee();
      const sameAddress = await registration(person.email, "waitlist");
      const acting = holdTransaction((tx) => act(tx, kind, [person.id]));
      await acting.started;

      const admitting = prisma.$transaction(async (tx) => {
        await lockRegistrationQueue(tx, EVENT_ID);
        return lockRegistration(tx, sameAddress.id);
      });
      await waitUntilWaitingForRegistrationQueue();
      // The registration is still there for a plain read: the erasure has not committed.
      expect(await registrationExists(sameAddress.id)).toBe(true);
      await acting.commit();

      expect(await admitting).toEqual([]);
    },
  );

  it("is never missing from the delete in scrubAttendeeTraces: it waits for a holder first", async () => {
    const person = await attendee();
    const sameAddress = await registration(person.email, "pending");
    const holder = holdTransaction((tx) => lockRegistrationQueue(tx, EVENT_ID));
    await holder.started;

    const scrubbing = prisma.$transaction((tx) =>
      scrubAttendeeTraces(tx, { eventId: EVENT_ID, attendeeIds: [person.id], emails: [person.email] }),
    );
    await waitUntilWaitingForRegistrationQueue();
    expect(await registrationExists(sameAddress.id)).toBe(true);
    await holder.commit();

    expect(await scrubbing).toEqual({ registrations: 1 });
    expect(await registrationExists(sameAddress.id)).toBe(false);
  });
});

describe("an erasure while a registration mail is being sent", () => {
  /** The last check before the mail goes to the mailer: the queue lock, then the mail and its registration as they are now. */
  const lastCheck = (tx: Prisma.TransactionClient, mailId: string) =>
    lockRegistrationQueue(tx, EVENT_ID).then(
      () => tx.$queryRaw<{ id: string; email: string }[]>`
        SELECT m."id", r."email" FROM "RegistrationMail" m
        JOIN "Registration" r ON r."id" = m."registration_id" AND r."event_id" = m."event_id"
        WHERE m."id" = ${mailId} AND m."status" = 'queued'
      `,
    );

  /** The write of the send's result: one conditional update of the mail's own row, with no other lock. */
  const recordSent = (db: PrismaClient | Prisma.TransactionClient, mailId: string) =>
    db.registrationMail.updateMany({
      where: { id: mailId, status: "queued", attempts: 0 },
      data: { status: "sent", attempts: 1, sent_at: new Date() },
    });

  it("makes the last check wait for the open erasure, which then leaves nothing to send", async () => {
    const person = await attendee();
    const pending = await registration(person.email, "pending");
    const erasing = holdTransaction((tx) => act(tx, "erasure", [person.id]));
    await erasing.started;

    const checking = prisma.$transaction((tx) => lastCheck(tx, pending.mailId));
    await waitUntilWaitingForRegistrationQueue();
    await erasing.commit();

    expect(await checking).toEqual([]);
  });

  it("makes the erasure wait for a last check that is open, before it locks the person, and then deletes the mail", async () => {
    const person = await attendee();
    const pending = await registration(person.email, "pending");
    const checking = holdTransaction((tx) => lastCheck(tx, pending.mailId));
    expect(await checking.started).toEqual([{ id: pending.mailId, email: person.email }]);

    const erasing = prisma.$transaction((tx) => act(tx, "erasure", [person.id]));
    await waitUntilWaitingForRegistrationQueue();
    expect(await attendeeRowIsFree(person.id)).toBe(true);
    await checking.commit();
    await erasing;

    expect(await mailExists(pending.mailId)).toBe(false);
    expect(await registrationExists(pending.id)).toBe(false);
  });

  it("writes no result for a mail the erasure deleted while it was being sent, and puts no row back", async () => {
    const person = await attendee();
    const pending = await registration(person.email, "pending");
    // The last check passed before the erasure began, and the mail is with the mailer when the erasure runs.
    expect(await prisma.$transaction((tx) => lastCheck(tx, pending.mailId))).toHaveLength(1);
    const erasing = holdTransaction((tx) => act(tx, "erasure", [person.id]));
    await erasing.started;

    // A Prisma query only starts when something waits for it, so `.then` starts it now.
    const recording = recordSent(prisma, pending.mailId).then((result) => result);
    await waitUntilWaitingFor("UPDATE%RegistrationMail");
    await erasing.commit();

    expect((await recording).count).toBe(0);
    expect(await mailExists(pending.mailId)).toBe(false);
  });

  it("deletes a mail whose result is being written when the erasure starts, once that write has committed", async () => {
    const person = await attendee();
    const pending = await registration(person.email, "pending");
    const recording = holdTransaction((tx) => recordSent(tx, pending.mailId));
    expect((await recording.started).count).toBe(1);

    // It waits in the delete of the registration, whose cascade needs the row of the mail.
    const erasing = prisma.$transaction((tx) => act(tx, "erasure", [person.id]));
    await waitUntilWaitingFor("DELETE%Registration");
    await recording.commit();
    const result = await erasing;

    expect(result.counts.registrations).toBe(1);
    expect(await mailExists(pending.mailId)).toBe(false);
  });
});
