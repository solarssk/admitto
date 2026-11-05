/**
 * The company sign-in in `placeRegistration` (D-C4), against a real, fully migrated database: the person (the provider and
 * the provider's id of them, `sub`) is stored with the registration, a person registers once per event whatever address
 * they hold, and the unique index and the CHECK constraints hold the same rule when two requests meet.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { PrismaClient } from "@admitto/db";
import { eraseAttendees } from "../src/erase-attendees.js";
import { placeRegistration } from "../src/registration-placement.js";
import { createMigratedDb, fixtures, type MigratedDb } from "./registration-fixtures.js";

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

const PROVIDER = "provider-a";
const signIn = (eventId: string, email: string, subject: string, providerId = PROVIDER, client = db) =>
  placeRegistration(client, { eventId, method: "sso", registrant: make.registrant({ email }), sso: { providerId, subject } });

const rowsOf = (eventId: string) => db.registration.findMany({ where: { event_id: eventId } });

describe("placeRegistration, method sso: the person is stored with the registration", () => {
  it("keeps the provider and the subject, marks the address as verified by the provider, and queues the mail of its state", async () => {
    const eventId = await make.event({ mode: "approval" });
    const email = make.address();

    expect(await signIn(eventId, email, "sub-1")).toEqual({ outcome: "received" });

    const [row] = await rowsOf(eventId);
    expect(row).toMatchObject({ email, status: "pending", sso_provider_id: PROVIDER, sso_subject: "sub-1" });
    expect(row?.email_verified_at).not.toBeNull();
    expect(row?.confirm_expires_at).toBeNull();
    expect(await make.templatesOf(row!.id)).toEqual(["registration-received"]);
  });

  it("does not write a person for any other way in", async () => {
    const eventId = await make.event({ mode: "approval", verify: false });
    await placeRegistration(db, { eventId, method: "link", registrant: make.registrant(), sso: { providerId: PROVIDER, subject: "ignored" } });
    await placeRegistration(db, { eventId, method: "password", registrant: make.registrant() });

    const rows = await rowsOf(eventId);
    expect(rows).toHaveLength(2);
    for (const row of rows) expect(row).toMatchObject({ sso_provider_id: null, sso_subject: null });
  });

  it("refuses to place a company sign-in without the person: such a registration could be made again and again", async () => {
    const eventId = await make.event();
    const attempt = (sso?: { providerId: string; subject: string }) =>
      placeRegistration(db, { eventId, method: "sso", registrant: make.registrant(), ...(sso ? { sso } : {}) });

    await expect(attempt()).rejects.toThrow("needs the provider and the subject");
    await expect(attempt({ providerId: "", subject: "x" })).rejects.toThrow("needs the provider and the subject");
    await expect(attempt({ providerId: PROVIDER, subject: "" })).rejects.toThrow("needs the provider and the subject");
    expect(await rowsOf(eventId)).toHaveLength(0);
  });
});

describe("placeRegistration, method sso: one place for a person (decision 7)", () => {
  it("the same person under another address gets no second registration, no change and no mail", async () => {
    const eventId = await make.event({ mode: "approval" });
    await signIn(eventId, make.address(), "sub-same");
    const before = { rows: await rowsOf(eventId), counts: await make.counts(eventId) };

    // The provider now holds a different address for the same person.
    expect(await signIn(eventId, make.address("moved"), "sub-same")).toEqual({ outcome: "already_registered" });

    expect(await rowsOf(eventId)).toEqual(before.rows);
    expect(await make.counts(eventId)).toEqual(before.counts);
  });

  it("the same person is told the same in every state their registration can be in", async () => {
    for (const status of ["pending", "waitlist", "rejected"] as const) {
      const eventId = await make.event({ mode: "approval" });
      const row = await make.registration(eventId, { status });
      await db.registration.update({ where: { id: row.id }, data: { sso_provider_id: PROVIDER, sso_subject: "sub-state" } });
      const before = await make.counts(eventId);

      expect(await signIn(eventId, make.address(), "sub-state")).toEqual({ outcome: "already_registered" });
      expect(await make.counts(eventId)).toEqual(before);
    }
  });

  it("an address that already has a registration is taken whoever signs in with it, and the first person keeps it", async () => {
    const eventId = await make.event({ mode: "approval" });
    const email = make.address();
    await signIn(eventId, email, "sub-first");
    const before = await rowsOf(eventId);

    expect(await signIn(eventId, email, "sub-second")).toEqual({ outcome: "already_registered" });

    expect(await rowsOf(eventId)).toEqual(before);
  });

  it("another provider's person with the same subject is another person; another event is another place", async () => {
    const eventId = await make.event({ mode: "approval" });
    const otherEvent = await make.event({ mode: "approval" });

    expect(await signIn(eventId, make.address(), "sub-x", "provider-a")).toEqual({ outcome: "received" });
    expect(await signIn(eventId, make.address(), "sub-x", "provider-b")).toEqual({ outcome: "received" });
    expect(await signIn(otherEvent, make.address(), "sub-x", "provider-a")).toEqual({ outcome: "received" });
    expect(await rowsOf(eventId)).toHaveLength(2);
    expect(await rowsOf(otherEvent)).toHaveLength(1);
  });

  it("two requests for one person at the same moment make one registration (two connections)", async () => {
    const eventId = await make.event({ mode: "approval" });
    const other = migrated.connection();

    const answers = await Promise.all([
      signIn(eventId, make.address("one"), "sub-race"),
      signIn(eventId, make.address("two"), "sub-race", PROVIDER, other),
      signIn(eventId, make.address("three"), "sub-race"),
    ]);

    expect(answers.filter((answer) => answer.outcome === "received")).toHaveLength(1);
    expect(answers.filter((answer) => answer.outcome === "already_registered")).toHaveLength(2);
    expect(await rowsOf(eventId)).toHaveLength(1);
    expect(await db.registrationMail.count({ where: { event_id: eventId } })).toBe(1);
  });
});

describe("Registration: what the database holds for the person", () => {
  const base = (eventId: string) => ({
    event_id: eventId,
    first_name: "Guest",
    last_name: "Row",
    name: "Guest Row",
    status: "pending",
  });

  it("refuses a second registration of one person in an event, but not in another, and lets any number have none", async () => {
    const eventId = await make.event();
    const otherEvent = await make.event();
    await db.registration.create({ data: { ...base(eventId), email: make.address(), sso_provider_id: PROVIDER, sso_subject: "u-1" } });

    await expect(
      db.registration.create({ data: { ...base(eventId), email: make.address(), sso_provider_id: PROVIDER, sso_subject: "u-1" } }),
    ).rejects.toMatchObject({ code: "P2002" });
    await db.registration.create({ data: { ...base(otherEvent), email: make.address(), sso_provider_id: PROVIDER, sso_subject: "u-1" } });
    // The ways in without a person collide on nothing (NULLs are distinct).
    await db.registration.create({ data: { ...base(eventId), email: make.address() } });
    await db.registration.create({ data: { ...base(eventId), email: make.address() } });
    expect(await db.registration.count({ where: { event_id: eventId } })).toBe(3);
  });

  it("holds the provider and the subject together or not at all, and a subject within the length OIDC allows", async () => {
    const eventId = await make.event();
    const create = (extra: Record<string, unknown>) => db.registration.create({ data: { ...base(eventId), email: make.address(), ...extra } });

    await expect(create({ sso_provider_id: PROVIDER })).rejects.toThrow("Registration_sso_pair_check");
    await expect(create({ sso_subject: "only-a-subject" })).rejects.toThrow("Registration_sso_pair_check");
    await expect(create({ sso_provider_id: PROVIDER, sso_subject: "" })).rejects.toThrow("Registration_sso_subject_length_check");
    await expect(create({ sso_provider_id: PROVIDER, sso_subject: "s".repeat(256) })).rejects.toThrow("Registration_sso_subject_length_check");
    await create({ sso_provider_id: PROVIDER, sso_subject: "s".repeat(255) });
  });
});

describe("Registration: the person goes with the registration (erasure)", () => {
  it("erasing the attendee a company sign-in was accepted as deletes the registration, subject and all", async () => {
    const eventId = await make.event({ mode: "automatic" });
    expect(await signIn(eventId, make.address(), "sub-erase")).toEqual({ outcome: "received" });
    const row = await db.registration.findFirstOrThrow({ where: { event_id: eventId } });
    expect(row.attendee_id).not.toBeNull();

    await db.$transaction((tx) => eraseAttendees(tx, { eventId, attendeeIds: [row.attendee_id!] }));

    expect(await rowsOf(eventId)).toHaveLength(0);
    // The person may sign in again: they are a new guest, not an erased one's row brought back.
    expect(await signIn(eventId, make.address(), "sub-erase")).toEqual({ outcome: "received" });
  });
});
