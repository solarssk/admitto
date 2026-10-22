/**
 * retryRegistrationMails (D-B15) against a real, fully migrated database: which mail staff may send again, what the
 * reset leaves in the row, that it takes the registration queue, and that it records ids and counts only.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { PrismaClient } from "@admitto/db";
import type { Prisma } from "@admitto/db/client";
import { retryRegistrationMails } from "../src/registration-mail-retry.js";
import { lockRegistrationQueue } from "../src/registration-lock.js";
import {
  createMigratedDb,
  failingAfterWork,
  fixtures,
  holdTransaction,
  waitUntilWaitingForRegistrationQueue,
  type EventOptions,
  type MigratedDb,
} from "./registration-fixtures.js";

// Tests that make transactions wait for each other are bound by waits, not by work: a slow machine needs more than 5 s.
vi.setConfig({ testTimeout: 30_000 });

let migrated: MigratedDb;
let db: PrismaClient;
let make: ReturnType<typeof fixtures>;

beforeAll(() => {
  migrated = createMigratedDb();
  db = migrated.db;
  make = fixtures(db);
}, 60_000);
afterAll(async () => {
  await migrated?.drop();
});

const actor = { operator: "staff-user-1", sessionId: "session-1", timezone: "Europe/Warsaw", ip: "203.0.113.7" };
const retry = (eventId: string, ids: string[], now?: Date) => retryRegistrationMails(db, { eventId, ids, actor, now });

const LONG_AGO = new Date("2026-01-01T10:00:00Z");

/** By default a mail that failed for good: the attempts are used up and the worker will not try it again. */
async function addMail(
  registrationId: string,
  eventId: string,
  template: string,
  extra: Partial<Prisma.RegistrationMailUncheckedCreateInput> = {},
) {
  return db.registrationMail.create({
    data: {
      registration_id: registrationId,
      event_id: eventId,
      template_name: template,
      status: "failed",
      attempts: 8,
      retryable: false,
      queued_at: LONG_AGO,
      attempted_at: LONG_AGO,
      error_code: "send_rejected",
      error: "The mail provider refused the message.",
      ...extra,
    },
  });
}

async function pendingWithFailedMail(options: EventOptions = {}, extra: Partial<Prisma.RegistrationMailUncheckedCreateInput> = {}) {
  const eventId = await make.event({ mode: "approval", ...options });
  const registration = await make.registration(eventId, { status: "pending" });
  const mail = await addMail(registration.id, eventId, "registration-received", extra);
  return { eventId, registration, mail };
}

const mailRow = (id: string) => db.registrationMail.findUniqueOrThrow({ where: { id } });

describe("retryRegistrationMails", () => {
  it("puts a mail that failed for good back in the queue as if it had never been tried, and logs ids and a count", async () => {
    const { eventId, registration, mail } = await pendingWithFailedMail();
    const now = new Date();

    const result = await retry(eventId, [registration.id], now);

    expect(result).toEqual({ outcomes: [{ id: registration.id, outcome: "retried" }] });
    const after = await mailRow(mail.id);
    expect(after).toMatchObject({
      status: "queued",
      attempts: 0,
      retryable: null,
      attempted_at: null,
      sent_at: null,
      error_code: null,
      error: null,
    });
    // A new revision: a send that was in progress cannot write its result over the reset.
    expect(after.queued_at.getTime()).toBe(now.getTime());
    // The state of the registration is the guest's, and a failed mail never changes it.
    expect((await db.registration.findUniqueOrThrow({ where: { id: registration.id } })).status).toBe("pending");

    const logs = await db.attendeeActionLog.findMany({ where: { event_id: eventId } });
    expect(logs).toHaveLength(1);
    expect(logs[0]).toMatchObject({
      action_type: "registration_mail_retried",
      attendee_id: null,
      actor_user_id: actor.operator,
      session_id: actor.sessionId,
      ip: actor.ip,
    });
    expect(logs[0]?.metadata).toEqual({ count: 1, registration_ids: [registration.id] });
    expect(JSON.stringify(logs[0])).not.toContain(registration.email);
  });

  it("takes a failed mail whose `retryable` was never set, as well as one that is false", async () => {
    const { eventId, registration, mail } = await pendingWithFailedMail({}, { retryable: null });

    expect((await retry(eventId, [registration.id])).outcomes[0]?.outcome).toBe("retried");

    expect((await mailRow(mail.id)).status).toBe("queued");
  });

  it.each([
    ["queued", { status: "queued", attempts: 0, retryable: null, error_code: null, error: null, attempted_at: null }],
    ["sent", { status: "sent", retryable: null, error_code: null, error: null, sent_at: LONG_AGO }],
    ["accepted", { status: "accepted", retryable: null, error_code: null, error: null, sent_at: LONG_AGO }],
    ["cancelled", { status: "cancelled", retryable: false, error_code: "registration_changed" }],
    ["failed but still tried by the worker", { status: "failed", attempts: 2, retryable: true }],
  ] as const)("leaves a mail that is %s as it is", async (_name, extra) => {
    const { eventId, registration, mail } = await pendingWithFailedMail({}, extra);
    const before = await mailRow(mail.id);

    const result = await retry(eventId, [registration.id]);

    expect(result.outcomes).toEqual([{ id: registration.id, outcome: "not_retryable" }]);
    expect(await mailRow(mail.id)).toEqual(before);
    expect(await db.attendeeActionLog.count({ where: { event_id: eventId } })).toBe(0);
  });

  it("sends again only the last mail of a registration, the one the list shows", async () => {
    const eventId = await make.event({ mode: "approval" });
    const stale = await make.registration(eventId, { status: "accepted", attendeeId: (await make.attendee(eventId)).id });
    // An older mail failed for good, and a newer one went out: nothing to retry, and the old one stays as it was.
    const olderFailed = await addMail(stale.id, eventId, "registration-received");
    await addMail(stale.id, eventId, "ticket", { status: "sent", attempts: 1, retryable: null, error_code: null, error: null, queued_at: new Date() });

    const fresh = await make.registration(eventId, { status: "pending" });
    // An older mail went out, and the newer one failed for good: only the newer one is reset.
    const olderSent = await addMail(fresh.id, eventId, "registration-confirm", { status: "sent", retryable: null, error_code: null, error: null });
    const newerFailed = await addMail(fresh.id, eventId, "registration-received", { queued_at: new Date(LONG_AGO.getTime() + 3_600_000) });

    const result = await retry(eventId, [stale.id, fresh.id]);

    expect(result.outcomes).toEqual([
      { id: stale.id, outcome: "not_retryable" },
      { id: fresh.id, outcome: "retried" },
    ]);
    expect((await mailRow(olderFailed.id)).status).toBe("failed");
    expect((await mailRow(olderSent.id)).status).toBe("sent");
    expect((await mailRow(newerFailed.id)).status).toBe("queued");
  });

  it("answers for each id in the order asked, once for a repeated id, and `not_retryable` for a registration with no mail", async () => {
    const { eventId, registration, mail } = await pendingWithFailedMail();
    const silent = await make.registration(eventId, { status: "pending" });

    const result = await retry(eventId, [silent.id, registration.id, "no-such-registration", registration.id]);

    expect(result.outcomes).toEqual([
      { id: silent.id, outcome: "not_retryable" },
      { id: registration.id, outcome: "retried" },
      { id: "no-such-registration", outcome: "gone" },
    ]);
    expect((await mailRow(mail.id)).status).toBe("queued");
    expect((await db.attendeeActionLog.findFirstOrThrow({ where: { event_id: eventId } })).metadata).toEqual({
      count: 1,
      registration_ids: [registration.id],
    });
  });

  it("answers an empty request with nothing, and changes nothing", async () => {
    const { eventId } = await pendingWithFailedMail();
    const before = await make.counts(eventId);

    expect(await retry(eventId, [])).toEqual({ outcomes: [] });

    expect(await make.counts(eventId)).toEqual(before);
  });

  it("does not reach a registration of another event, whatever the caller names", async () => {
    const mine = await pendingWithFailedMail();
    const other = await pendingWithFailedMail();

    const result = await retry(mine.eventId, [other.registration.id]);

    expect(result.outcomes).toEqual([{ id: other.registration.id, outcome: "gone" }]);
    expect((await mailRow(other.mail.id)).status).toBe("failed");
  });

  it("changes nothing in an archived event, or one that does not exist", async () => {
    const archived = await pendingWithFailedMail({ archived: true });
    const before = await mailRow(archived.mail.id);

    expect(await retry(archived.eventId, [archived.registration.id])).toEqual({
      outcomes: [{ id: archived.registration.id, outcome: "closed" }],
    });
    expect(await mailRow(archived.mail.id)).toEqual(before);

    expect(await retry("no-such-event", [archived.registration.id])).toEqual({
      outcomes: [{ id: archived.registration.id, outcome: "closed" }],
    });
    expect(await db.attendeeActionLog.count({ where: { event_id: archived.eventId } })).toBe(0);
  });

  it("changes the row and logs it in one transaction: a rollback leaves the mail failed and writes no log", async () => {
    const { eventId, registration, mail } = await pendingWithFailedMail();
    const before = await mailRow(mail.id);

    await expect(
      retryRegistrationMails(failingAfterWork(migrated.connection()), { eventId, ids: [registration.id], actor }),
    ).rejects.toThrow("Synthetic rollback after the work");

    expect(await mailRow(mail.id)).toEqual(before);
    expect(await db.attendeeActionLog.count({ where: { event_id: eventId } })).toBe(0);
  });
});

describe("retryRegistrationMails at the same time as others", () => {
  it("resets a mail once when two organisers click at the same time, and logs it once", async () => {
    const { eventId, registration, mail } = await pendingWithFailedMail();

    const results = await Promise.all([retry(eventId, [registration.id]), retry(eventId, [registration.id])]);

    expect(results.map((result) => result.outcomes[0]?.outcome).sort()).toEqual(["not_retryable", "retried"]);
    expect((await mailRow(mail.id)).status).toBe("queued");
    expect(await db.attendeeActionLog.count({ where: { event_id: eventId, action_type: "registration_mail_retried" } })).toBe(1);
  });

  it("waits for the registration queue, and finds the registration gone when a deletion came first", async () => {
    const { eventId, registration, mail } = await pendingWithFailedMail();
    // What an erasure or a deletion by staff does: it holds the queue and deletes the registration with its mail.
    const holder = holdTransaction(
      migrated.connection(),
      (tx) => lockRegistrationQueue(tx, eventId),
      (tx) => tx.registration.delete({ where: { id: registration.id } }),
    );
    await holder.started;

    const retrying = retry(eventId, [registration.id]);
    await waitUntilWaitingForRegistrationQueue(db, eventId);
    await holder.commit();

    expect(await retrying).toEqual({ outcomes: [{ id: registration.id, outcome: "gone" }] });
    expect(await db.registrationMail.count({ where: { id: mail.id } })).toBe(0);
    expect(await db.attendeeActionLog.count({ where: { event_id: eventId } })).toBe(0);
  });

  it("makes a deletion that comes after it wait, and then remove the registration with the reset mail", async () => {
    const { eventId, registration, mail } = await pendingWithFailedMail();
    const holder = holdTransaction(migrated.connection(), (tx) => lockRegistrationQueue(tx, eventId));
    await holder.started;

    const retrying = retry(eventId, [registration.id]);
    await waitUntilWaitingForRegistrationQueue(db, eventId);
    await holder.commit();
    expect((await retrying).outcomes[0]?.outcome).toBe("retried");

    await db.registration.delete({ where: { id: registration.id } });
    expect(await db.registrationMail.count({ where: { id: mail.id } })).toBe(0);
  });
});
