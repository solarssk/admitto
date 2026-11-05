/**
 * revealSensitiveAnswers (the administrator's deliberate "Show", D-E6) against a real, fully migrated database: what it
 * returns, what it refuses, the order of its locks (the attendee's row first, the registration queue first for a
 * registration) and what it does against an erasure or a deletion that is open. The routes are tested in
 * `apps/web/test/integration/sensitive-reveal-routes.test.ts`: roles, the budget and the audit entries as the app writes them.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { Prisma, PrismaClient } from "@admitto/db";
import { eraseAttendees } from "../src/erase-attendees.js";
import { revealSensitiveAnswers, SENSITIVE_REVEAL_ACTION } from "../src/sensitive-reveal.js";
import {
  createMigratedDb,
  fixtures,
  holdTransaction,
  lockWaiters,
  waitUntilWaitingForRegistrationQueue,
  wrapTransactions,
  type MigratedDb,
} from "./registration-fixtures.js";

let migrated: MigratedDb;
let db: PrismaClient;
let make: ReturnType<typeof fixtures>;
const actor = { operator: "staff-user-1" };

beforeAll(() => {
  migrated = createMigratedDb();
  db = migrated.db;
  make = fixtures(db);
}, 60_000);
afterAll(async () => {
  await migrated?.drop();
});

/** An event with a sensitive and an ordinary question about the guest, and the same two about a companion. */
async function eventWithQuestions() {
  const eventId = await make.event();
  await db.eventCustomField.createMany({
    data: [
      { event_id: eventId, source_field: "allergy", label: "Allergy", type: "text", sensitive: true },
      { event_id: eventId, source_field: "shirt", label: "Shirt", type: "text" },
      { event_id: eventId, source_field: "access", label: "Access", type: "text", sensitive: true, applies_to: "companion" },
      { event_id: eventId, source_field: "diet", label: "Diet", type: "text", applies_to: "companion" },
    ],
  });
  return eventId;
}

const guestData = { allergy: "peanuts", shirt: "L" };
const companionData = { access: "step-free", diet: "vegan" };

/** An accepted guest with a companion, as an attendee and as a registration. */
async function guest(eventId: string) {
  const attendee = await make.attendee(eventId);
  await db.attendee.update({ where: { id: attendee.id }, data: { custom_data: guestData } });
  await make.companion(attendee.id, { customData: companionData });
  const registration = await make.registration(eventId, {
    status: "accepted",
    attendeeId: attendee.id,
    customData: guestData,
    companions: [{ name: "Companion", custom_data: companionData }],
  });
  return { attendeeId: attendee.id, registrationId: registration.id };
}

const reveal = (eventId: string, kind: "registration" | "attendee", id: string, client: PrismaClient = db) =>
  revealSensitiveAnswers(client, { eventId, subject: { kind, id }, actor });

/** A client whose transactions record what they run first: the raw statements (a registration-queue lock as "registration queue") and the models touched. */
function recordStatements(source: PrismaClient) {
  const statements: string[] = [];
  const recording = wrapTransactions(
    source,
    (tx) =>
      new Proxy(tx, {
        get(actual, property, receiver) {
          const value = Reflect.get(actual, property, receiver) as unknown;
          if (property === "$queryRaw") {
            return (strings: TemplateStringsArray, ...values: unknown[]) => {
              statements.push(strings.join("?"));
              return Reflect.apply(value as () => unknown, actual, [strings, ...values]) as unknown;
            };
          }
          if (property === "$executeRaw") {
            return (query: Prisma.Sql) => {
              const queue = query.values.some((part) => typeof part === "string" && part.startsWith("registration-queue:"));
              statements.push(queue ? "registration queue" : query.sql);
              return Reflect.apply(value as () => unknown, actual, [query]) as unknown;
            };
          }
          if (typeof property === "string" && !property.startsWith("$")) statements.push(property);
          return value;
        },
      }),
  );
  return { recording, statements };
}

describe("revealSensitiveAnswers", () => {
  it.each(["attendee", "registration"] as const)("returns only the sensitive answers of the %s and of the companion", async (kind) => {
    const eventId = await eventWithQuestions();
    const { attendeeId, registrationId } = await guest(eventId);

    const result = await reveal(eventId, kind, kind === "attendee" ? attendeeId : registrationId);

    expect(result).toEqual({
      outcome: "revealed",
      answers: { guest: { allergy: "peanuts" }, companions: [{ slot: 1, answers: { access: "step-free" } }] },
    });
  });

  it("refuses an attendee who is erased, who was removed or who is in another event, and a registration that is not there", async () => {
    const eventId = await eventWithQuestions();
    const otherEventId = await eventWithQuestions();
    const erased = await guest(eventId);
    await db.$transaction((tx) => eraseAttendees(tx, { eventId, attendeeIds: [erased.attendeeId] }));
    const elsewhere = await guest(otherEventId);

    for (const id of [erased.attendeeId, "no-such-attendee", elsewhere.attendeeId]) {
      expect(await reveal(eventId, "attendee", id)).toEqual({ outcome: "attendee_gone" });
    }
    for (const id of [erased.registrationId, "no-such-registration", elsewhere.registrationId]) {
      expect(await reveal(eventId, "registration", id)).toEqual({ outcome: "not_found" });
    }
    expect(await db.attendeeActionLog.count({ where: { event_id: eventId, action_type: SENSITIVE_REVEAL_ACTION } })).toBe(0);
    expect(await db.adminAuditLog.count({ where: { action_type: SENSITIVE_REVEAL_ACTION, metadata: { path: ["event_id"], equals: eventId } } })).toBe(0);
  });

  it("takes the attendee's row lock before it reads or writes anything else", async () => {
    const eventId = await eventWithQuestions();
    const { attendeeId } = await guest(eventId);
    const { recording, statements } = recordStatements(db);

    await reveal(eventId, "attendee", attendeeId, recording);

    expect(statements[0]).toMatch(/FROM "Attendee"[\s\S]*FOR KEY SHARE/);
    expect(statements.slice(1, 3)).toEqual(["eventCustomField", "attendee"]);
  });

  it("takes the registration queue before it reads or writes anything else, and no attendee lock before it", async () => {
    const eventId = await eventWithQuestions();
    const { registrationId } = await guest(eventId);
    const { recording, statements } = recordStatements(db);

    await reveal(eventId, "registration", registrationId, recording);

    expect(statements[0]).toBe("registration queue");
    expect(statements.slice(1, 3)).toEqual(["eventCustomField", "registration"]);
  });

  it("waits for an erasure that is open, and then finds the attendee erased", async () => {
    const eventId = await eventWithQuestions();
    const { attendeeId } = await guest(eventId);
    const erasure = holdTransaction(db, (tx) => eraseAttendees(tx, { eventId, attendeeIds: [attendeeId] }));
    await erasure.started;
    let finished = false;
    const request = reveal(eventId, "attendee", attendeeId).then((result) => {
      finished = true;
      return result;
    });
    await vi.waitFor(async () => expect(await lockWaiters(db)).toBeGreaterThan(0), { timeout: 5000, interval: 25 });
    expect(finished).toBe(false);

    await erasure.commit();

    expect(await request).toEqual({ outcome: "attendee_gone" });
  });

  it("waits for the registration queue, and then reads the registration as the transaction that held it left it", async () => {
    const eventId = await eventWithQuestions();
    const { registrationId } = await guest(eventId);
    const holder = holdTransaction(
      db,
      async (tx) => {
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`registration-queue:${eventId}`}, 0))`;
      },
      (tx) => tx.registration.delete({ where: { id: registrationId } }),
    );
    await holder.started;
    let finished = false;
    const request = reveal(eventId, "registration", registrationId).then((result) => {
      finished = true;
      return result;
    });
    await waitUntilWaitingForRegistrationQueue(db, eventId);
    expect(finished).toBe(false);

    await holder.commit();

    expect(await request).toEqual({ outcome: "not_found" });
  });
});
