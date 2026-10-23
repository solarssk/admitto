/**
 * placeRegistration and confirmRegistrationAddress against a real, fully migrated database: the state a submission
 * comes to for every mode and seat situation, the one mail of D-D2 in the same transaction, the unique address handled
 * without telling a new address from a known one, and the confirmation of an address.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { PrismaClient } from "@admitto/db";
import type { RegistrationAccessMethod } from "@admitto/db/status";
import { eraseAttendees } from "../src/erase-attendees.js";
import { RegistrantInputError } from "../src/registrant-input.js";
import { enqueueRegistrationMail, requeueMailForMoment } from "../src/registration-mail-queue.js";
import {
  CONFIRMATION_RESEND_COOLDOWN_MS,
  REGISTRATION_CONFIRM_WINDOW_MS,
  confirmRegistrationAddress,
  placeRegistration,
  type PlacementOptions,
  type RegistrantSubmission,
} from "../src/registration-placement.js";
import {
  createMigratedDb,
  failingAfterWork,
  fixtures,
  holdTransaction,
  lockWaiters,
  type EventOptions,
  type MigratedDb,
} from "./registration-fixtures.js";

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

const place = (eventId: string, registrant: RegistrantSubmission, method: RegistrationAccessMethod = "link", client = db) =>
  placeRegistration(client, { eventId, method, registrant });
const RECEIVED = { outcome: "received" };

describe("placeRegistration: where a guest goes, and the one mail that goes with it (D-B2 to D-B6, D-B16, D-D2)", () => {
  type Row = {
    name: string;
    event: EventOptions;
    method: RegistrationAccessMethod;
    /** Arranges the event before the guest submits. */
    before?: (eventId: string) => Promise<void>;
    status: string;
    mails: string[];
  };
  const rows: Row[] = [
    { name: "link, confirmation on, automatic: waits for the address", event: {}, method: "link", status: "awaiting_email", mails: ["registration-confirm"] },
    { name: "password behaves as the link: waits for the address", event: { mode: "approval" }, method: "password", status: "awaiting_email", mails: ["registration-confirm"] },
    { name: "confirmation on, event full: still waits for the address (the seat is decided at the click)", event: { capacity: 1 }, method: "link", before: (id) => make.attendees(id, 1), status: "awaiting_email", mails: ["registration-confirm"] },
    { name: "link, confirmation off, automatic, a seat: accepted, with the ticket", event: { verify: false }, method: "link", status: "accepted", mails: ["ticket"] },
    { name: "link, confirmation off, approval, a seat: pending, with 'received'", event: { verify: false, mode: "approval" }, method: "link", status: "pending", mails: ["registration-received"] },
    { name: "automatic, full: the waiting list", event: { verify: false, capacity: 1 }, method: "link", before: (id) => make.attendees(id, 1), status: "waitlist", mails: ["registration-waitlist"] },
    { name: "approval, full: the waiting list", event: { verify: false, capacity: 1, mode: "approval" }, method: "link", before: (id) => make.attendees(id, 1), status: "waitlist", mails: ["registration-waitlist"] },
    { name: "single sign-on, automatic: accepted, whatever the confirmation setting", event: { verify: true }, method: "sso", status: "accepted", mails: ["ticket"] },
    { name: "single sign-on, approval: pending, with 'received'", event: { verify: true, mode: "approval" }, method: "sso", status: "pending", mails: ["registration-received"] },
    {
      name: "D-B16: guests wait and a seat is free: the new guest queues behind them",
      event: { verify: false, capacity: 5 },
      method: "link",
      before: async (id) => {
        await make.registration(id, { status: "waitlist" });
      },
      status: "waitlist",
      mails: ["registration-waitlist"],
    },
    {
      name: "approval: guests wait and a seat is free: pending all the same",
      event: { verify: false, capacity: 5, mode: "approval" },
      method: "link",
      before: async (id) => {
        await make.registration(id, { status: "waitlist" });
      },
      status: "pending",
      mails: ["registration-received"],
    },
    { name: "an event without a limit: always a seat", event: { verify: false, capacity: null }, method: "link", before: (id) => make.attendees(id, 30), status: "accepted", mails: ["ticket"] },
    {
      name: "revoked and cancelled attendees hold no seat",
      event: { verify: false, capacity: 1 },
      method: "link",
      before: async (id) => {
        await make.attendees(id, 2, "revoked");
        await make.attendees(id, 1, "cancelled");
      },
      status: "accepted",
      mails: ["ticket"],
    },
    {
      name: "the last seat is a seat",
      event: { verify: false, capacity: 3 },
      method: "link",
      before: (id) => make.attendees(id, 2),
      status: "accepted",
      mails: ["ticket"],
    },
  ];

  it.each(rows)("$name", async ({ event, method, before, status, mails }) => {
    const eventId = await make.event(event);
    await before?.(eventId);
    const registrant = make.registrant();
    const now = new Date();

    expect(await placeRegistration(db, { eventId, method, registrant }, { now })).toEqual(RECEIVED);

    const row = await make.registrationByEmail(eventId, registrant.email);
    expect(row?.status).toBe(status);
    expect(await make.templatesOf(row!.id)).toEqual(mails);
    const attendee = await db.attendee.findFirst({ where: { event_id: eventId, email: registrant.email } });
    expect(attendee !== null).toBe(status === "accepted");
    expect(row?.attendee_id ?? null).toBe(attendee?.id ?? null);
    expect(row?.confirm_expires_at?.getTime() ?? null).toBe(status === "awaiting_email" ? now.getTime() + REGISTRATION_CONFIRM_WINDOW_MS : null);
    // The provider vouches for an address that came through single sign-on, and nobody has for the others.
    expect(row?.email_verified_at?.getTime() ?? null).toBe(method === "sso" ? now.getTime() : null);
    expect(row?.decided_by).toBeNull();
    expect(row?.decided_at?.getTime() ?? null).toBe(status === "accepted" ? now.getTime() : null);
  });

  it("stores no registration and no mail for a full event without a waiting list, and says so (D-B6)", async () => {
    for (const verify of [true, false]) {
      const eventId = await make.event({ capacity: 1, waitlist: false, verify });
      await make.attendees(eventId, 1);
      const before = await make.counts(eventId);

      expect(await place(eventId, make.registrant())).toEqual({ outcome: "full" });
      expect(await make.counts(eventId)).toEqual(before);
    }
  });

  it("answers a full event without a waiting list alike for every address, a known one included", async () => {
    const eventId = await make.event({ capacity: 1, waitlist: false, verify: true });
    const taken = await make.attendee(eventId, { email: make.address("taken") });
    const known = await make.registration(eventId, { status: "pending" });

    expect(await place(eventId, make.registrant({ email: taken.email }))).toEqual({ outcome: "full" });
    expect(await place(eventId, make.registrant({ email: known.email }))).toEqual({ outcome: "full" });
    expect(await place(eventId, make.registrant())).toEqual({ outcome: "full" });
  });

  it("makes the attendee of an accepted guest from the registration, as D-B9 and the staff create path do", async () => {
    const eventId = await make.event({ verify: false });
    await db.eventCustomField.createMany({
      data: [
        { event_id: eventId, source_field: "diet", label: "Diet", type: "select", options: ["vegan", "none"], show_on_form: true },
        { event_id: eventId, source_field: "plate", label: "Plate", type: "text", show_on_form: true },
      ],
    });
    const registrant = make.registrant({
      email: "Grace.Example@Example.com",
      first_name: "Grace",
      last_name: "Example",
      company: "Example Corp",
      department: "Operations",
      custom_data: { diet: "vegan", plate: "AB 123", removed_field: "x" },
      accepted_at: new Date("2026-10-01T10:00:00Z"),
      consents: { newsletter: "2026-10-01T10:00:00.000Z" },
      locale: "en",
    });
    const now = new Date();

    expect(await placeRegistration(db, { eventId, method: "link", registrant }, { now })).toEqual(RECEIVED);

    const row = await make.registrationByEmail(eventId, "grace.example@example.com");
    const attendee = await db.attendee.findFirstOrThrow({ where: { event_id: eventId } });
    expect(row).toMatchObject({
      status: "accepted",
      attendee_id: attendee.id,
      first_name: "Grace",
      last_name: "Example",
      name: "Grace Example",
      company: "Example Corp",
      department: "Operations",
      locale: "en",
      decided_by: null,
      consents: { newsletter: "2026-10-01T10:00:00.000Z" },
    });
    expect(row?.accepted_at?.toISOString()).toBe("2026-10-01T10:00:00.000Z");
    expect(row?.created_at.getTime()).toBe(now.getTime());
    expect(attendee).toMatchObject({
      email: "grace.example@example.com",
      name: "Grace Example",
      first_name: "Grace",
      last_name: "Example",
      company: "Example Corp",
      department: "Operations",
      status: "registered",
      rsvp_status: "none",
      rsvp_source: null,
      ticket_type: null,
      token_hash: null,
      token_enc: null,
      public_ref: null,
      client_timezone: null,
      erased_at: null,
      // Only what the event's fields take: the answer to a field that is not there is not kept.
      custom_data: { diet: "vegan", plate: "AB 123" },
    });
  });

  it("writes one event-level audit entry for an automatic acceptance: ids and counts, no operator, no address, no name", async () => {
    const eventId = await make.event({ verify: false });
    const registrant = make.registrant({ first_name: "Ada", last_name: "Lovelace-Example" });

    await place(eventId, registrant);

    const logs = await db.attendeeActionLog.findMany({ where: { event_id: eventId } });
    const row = await make.registrationByEmail(eventId, registrant.email);
    expect(logs).toHaveLength(1);
    expect(logs[0]).toMatchObject({ action_type: "registration_accepted", attendee_id: null, actor_user_id: null, ip: null, session_id: null });
    expect(logs[0]?.metadata).toEqual({ count: 1, registration_ids: [row?.id], attendee_ids: [row?.attendee_id], automatic: true });
    const text = JSON.stringify(logs[0]);
    expect(text).not.toContain(registrant.email);
    expect(text).not.toContain("Lovelace");
  });

  it("writes the state and its mail in one transaction: a rollback leaves neither", async () => {
    for (const options of [{ verify: false }, { verify: true }, { verify: false, mode: "approval" as const }]) {
      const eventId = await make.event(options);
      const before = await make.counts(eventId);

      await expect(place(eventId, make.registrant(), "link", failingAfterWork(migrated.connection()))).rejects.toThrow(
        "Synthetic rollback after the work",
      );

      expect(await make.counts(eventId)).toEqual(before);
    }
  });
});

describe("placeRegistration: an address that has a place already (D-B14)", () => {
  it("leaves an existing registration of any state as it is, writes nothing and answers as for a new address", async () => {
    const eventId = await make.event({ verify: false });
    const states = ["awaiting_email", "pending", "waitlist", "accepted", "rejected"];
    for (const status of states) {
      const attendee = status === "accepted" ? await make.attendee(eventId) : undefined;
      const existing = await make.registration(eventId, { status, attendeeId: attendee?.id });
      // A registration that waits for its address has the confirmation mail a submission queued for it just now, so a second
      // submission right away mails nothing (the cooldown; the re-send itself is tested below).
      if (status === "awaiting_email") {
        await db.registrationMail.create({ data: { registration_id: existing.id, event_id: eventId, template_name: "registration-confirm" } });
      }
      const before = { counts: await make.counts(eventId), row: await db.registration.findUnique({ where: { id: existing.id } }) };

      const answer = await place(eventId, make.registrant({ email: existing.email, first_name: "Somebody", last_name: "Else" }));

      expect(answer).toEqual(RECEIVED);
      expect(await make.counts(eventId)).toEqual(before.counts);
      // What the second guest typed did not replace what is there.
      expect(await db.registration.findUnique({ where: { id: existing.id } })).toEqual(before.row);
    }
  });

  it.each([["registered"], ["revoked"], ["cancelled"]])(
    "writes nothing for an address an attendee holds (status %s), whatever the spelling it was stored in",
    async (status) => {
      const eventId = await make.event({ verify: false });
      const held = await make.attendee(eventId, { email: `  ${make.address("Held").toUpperCase()} `, status });
      const before = { counts: await make.counts(eventId), row: await db.attendee.findUnique({ where: { id: held.id } }) };

      const answer = await place(eventId, make.registrant({ email: held.email.trim().toLowerCase() }));

      expect(answer).toEqual(RECEIVED);
      expect(await make.counts(eventId)).toEqual(before.counts);
      expect(await db.attendee.findUnique({ where: { id: held.id } })).toEqual(before.row);
    },
  );

  it("tells a guest who came through single sign-on that the address is registered already (D-B14): the provider vouches for it", async () => {
    const eventId = await make.event({ verify: false });
    const known = await make.registration(eventId, { status: "pending" });
    const held = await make.attendee(eventId, { status: "revoked" });
    const before = await make.counts(eventId);

    expect(await place(eventId, make.registrant({ email: known.email }), "sso")).toEqual({ outcome: "already_registered" });
    expect(await place(eventId, make.registrant({ email: held.email }), "sso")).toEqual({ outcome: "already_registered" });
    expect(await make.counts(eventId)).toEqual(before);
    // A new address is placed as usual, and the password method stays as neutral as the link: the password is shared by a group.
    expect(await place(eventId, make.registrant(), "sso")).toEqual(RECEIVED);
    expect(await place(eventId, make.registrant({ email: known.email }), "password")).toEqual(RECEIVED);
  });

  it("gives the same answer to a new address and to a known one, whatever it is known by", async () => {
    const eventId = await make.event({ verify: true });
    const answers = [
      await place(eventId, make.registrant()),
      await place(eventId, make.registrant({ email: (await make.registration(eventId, { status: "rejected" })).email })),
      await place(eventId, make.registrant({ email: (await make.attendee(eventId, { status: "revoked" })).email })),
    ];
    expect(answers).toEqual([RECEIVED, RECEIVED, RECEIVED]);
  });

  it("keeps one registration and one confirmation mail when the address is submitted again right away (the cooldown of the re-send)", async () => {
    const eventId = await make.event({ verify: true });
    const registrant = make.registrant();
    await place(eventId, registrant);
    const first = await make.registrationByEmail(eventId, registrant.email);

    await place(eventId, registrant);

    expect((await make.registrationByEmail(eventId, registrant.email))?.id).toBe(first?.id);
    expect(await make.templatesOf(first!.id)).toEqual(["registration-confirm"]);
    expect(await db.registration.count({ where: { event_id: eventId } })).toBe(1);
  });

  it("starts again with a new row and a new link when the one that waited for the address has expired", async () => {
    const eventId = await make.event({ verify: true });
    const registrant = make.registrant();
    await place(eventId, registrant);
    const old = (await make.registrationByEmail(eventId, registrant.email))!;
    await db.registration.update({ where: { id: old.id }, data: { confirm_expires_at: new Date(Date.now() - 1_000) } });
    const now = new Date();

    expect(await placeRegistration(db, { eventId, method: "link", registrant }, { now })).toEqual(RECEIVED);

    const fresh = (await make.registrationByEmail(eventId, registrant.email))!;
    expect(fresh.id).not.toBe(old.id);
    expect(fresh.confirm_expires_at?.getTime()).toBe(now.getTime() + REGISTRATION_CONFIRM_WINDOW_MS);
    expect(await db.registration.count({ where: { event_id: eventId } })).toBe(1);
    // The old row went with its mail; the new one has its own.
    expect(await db.registrationMail.count({ where: { event_id: eventId } })).toBe(1);
    expect(await make.templatesOf(fresh.id)).toEqual(["registration-confirm"]);
  });

  it("lets a guest register again when their old attendee row was erased: it holds a placeholder address now", async () => {
    const eventId = await make.event({ verify: false });
    const person = await make.attendee(eventId, { email: make.address("returning") });
    await db.$transaction((tx) => eraseAttendees(tx, { eventId, attendeeIds: [person.id] }));

    expect(await place(eventId, make.registrant({ email: person.email }))).toEqual(RECEIVED);

    const attendees = await db.attendee.findMany({ where: { event_id: eventId, erased_at: null } });
    expect(attendees.map((row) => row.email)).toEqual([person.email]);
  });
});

describe("placeRegistration: the guest sends the form again while the address waits for its confirmation (D-C5)", () => {
  /** A registration that waits for its address, made the way a submission makes it, and the row of its mail. */
  async function waiting(options: EventOptions = {}) {
    const eventId = await make.event(options);
    const registrant = make.registrant();
    await place(eventId, registrant);
    const row = (await make.registrationByEmail(eventId, registrant.email))!;
    const mail = await db.registrationMail.findFirstOrThrow({ where: { registration_id: row.id } });
    return { eventId, registrant, row, mail };
  }
  /** The worker sent the mail an hour ago. */
  const sentAnHourAgo = (mailId: string) =>
    db.registrationMail.update({
      where: { id: mailId },
      data: {
        status: "sent",
        attempts: 1,
        retryable: null,
        queued_at: new Date(Date.now() - 3_600_000),
        attempted_at: new Date(Date.now() - 3_600_000),
        sent_at: new Date(Date.now() - 3_600_000),
        provider_message_id: "provider-message-1",
      },
    });
  /** The same address again, with other names: what a stranger who typed it would send. */
  const again = (eventId: string, registrant: RegistrantSubmission, options: PlacementOptions = {}, method: RegistrationAccessMethod = "link") =>
    placeRegistration(db, { eventId, method, registrant: { ...registrant, first_name: "Somebody", last_name: "Else" } }, options);
  const mailRow = (id: string) => db.registrationMail.findUniqueOrThrow({ where: { id } });

  it.each([["link" as const], ["password" as const]])(
    "puts the mail with the link back in the queue as a new revision (%s), and changes nothing else",
    async (method) => {
      const { eventId, registrant, row, mail } = await waiting();
      await sentAnHourAgo(mail.id);
      const before = { registration: await db.registration.findUnique({ where: { id: row.id } }), counts: await make.counts(eventId) };

      expect(await again(eventId, registrant, {}, method)).toEqual(RECEIVED);

      // The registration is as it was, with the answers of the first submission and the time its link runs out. The row of the
      // mail is the same row: the link is made of the registration's id, so it is the same link.
      expect(await db.registration.findUnique({ where: { id: row.id } })).toEqual(before.registration);
      expect(await make.counts(eventId)).toEqual(before.counts);
      const queued = await mailRow(mail.id);
      expect(queued).toMatchObject({
        registration_id: row.id,
        template_name: "registration-confirm",
        status: "queued",
        attempts: 0,
        retryable: null,
        attempted_at: null,
        sent_at: null,
        error_code: null,
        error: null,
        provider_message_id: "provider-message-1",
      });
      expect(queued.queued_at.getTime()).toBeGreaterThan(Date.now() - 60_000);
    },
  );

  it("mails again only when the last mail was queued the cooldown ago, and asks the address's budget only then", async () => {
    const { eventId, registrant, mail } = await waiting();
    const queuedAt = (await mailRow(mail.id)).queued_at.getTime();
    const asked = vi.fn(async () => true);
    const options = (at: number): PlacementOptions => ({ now: new Date(at), mail: { addressAllowed: asked } });

    expect(await again(eventId, registrant, options(queuedAt + CONFIRMATION_RESEND_COOLDOWN_MS - 1))).toEqual(RECEIVED);
    expect(asked).not.toHaveBeenCalled();
    expect((await mailRow(mail.id)).queued_at.getTime()).toBe(queuedAt);

    expect(await again(eventId, registrant, options(queuedAt + CONFIRMATION_RESEND_COOLDOWN_MS))).toEqual(RECEIVED);
    expect(asked).toHaveBeenCalledTimes(1);
    expect((await mailRow(mail.id)).queued_at.getTime()).toBe(queuedAt + CONFIRMATION_RESEND_COOLDOWN_MS);
    // And that mail starts the cooldown again.
    expect(await again(eventId, registrant, options(queuedAt + CONFIRMATION_RESEND_COOLDOWN_MS + 1_000))).toEqual(RECEIVED);
    expect(asked).toHaveBeenCalledTimes(1);
  });

  it.each([["address" as const], ["event" as const]])(
    "leaves the mail as it was, answers the same and says which budget was spent, when the %s budget is spent",
    async (spent) => {
      const { eventId, registrant, mail } = await waiting({ capacity: null });
      await sentAnHourAgo(mail.id);
      const before = await mailRow(mail.id);
      const onWithheld = vi.fn();
      // An event without a limit has the base alone as its cap, and this registration's mail row already uses it.
      const mailLimits =
        spent === "address"
          ? { addressAllowed: async () => false, onWithheld }
          : { event: { base: 1, windowMs: 86_400_000 }, onWithheld };

      expect(await again(eventId, registrant, { mail: mailLimits })).toEqual(RECEIVED);

      expect(onWithheld).toHaveBeenCalledExactlyOnceWith(spent);
      expect(await mailRow(mail.id)).toEqual(before);
    },
  );

  it("queues the mail when the first one was withheld and there is no row to put back", async () => {
    const eventId = await make.event();
    const registrant = make.registrant();
    const refused = { addressAllowed: async () => false };
    await placeRegistration(db, { eventId, method: "link", registrant }, { mail: refused });
    const row = (await make.registrationByEmail(eventId, registrant.email))!;
    expect(await make.templatesOf(row.id)).toEqual([]);

    expect(await again(eventId, registrant, { mail: { addressAllowed: async () => true } })).toEqual(RECEIVED);

    expect(await make.templatesOf(row.id)).toEqual(["registration-confirm"]);
    expect((await mailRow((await db.registrationMail.findFirstOrThrow({ where: { registration_id: row.id } })).id)).status).toBe("queued");
  });

  it("mails nothing again for a registration that does not wait for its address, for an address an attendee holds, and for single sign-on", async () => {
    const eventId = await make.event({ verify: true });
    const asked = vi.fn(async () => true);
    const options: PlacementOptions = { mail: { addressAllowed: asked } };
    /** A registration of this status with a confirmation mail that was sent an hour ago. */
    const withOldMail = async (status: string, extra: { email?: string; attendeeId?: string } = {}) => {
      const row = await make.registration(eventId, { status, ...extra });
      const mail = await db.registrationMail.create({
        data: { registration_id: row.id, event_id: eventId, template_name: "registration-confirm" },
      });
      await sentAnHourAgo(mail.id);
      return { row, mail: await mailRow(mail.id) };
    };
    const held = await make.attendee(eventId);
    const accepted = await make.attendee(eventId);
    const cases = [
      await withOldMail("pending"),
      await withOldMail("waitlist"),
      await withOldMail("rejected"),
      await withOldMail("accepted", { attendeeId: accepted.id }),
      // The address is an attendee's (an import won): the confirmation could only end in "already registered".
      await withOldMail("awaiting_email", { email: held.email }),
    ];

    for (const { row } of cases) {
      expect(await again(eventId, { ...make.registrant(), email: row.email }, options)).toEqual(RECEIVED);
    }
    const waitingRow = await withOldMail("awaiting_email");
    expect(await again(eventId, { ...make.registrant(), email: waitingRow.row.email }, options, "sso")).toEqual({
      outcome: "already_registered",
    });

    expect(asked).not.toHaveBeenCalled();
    for (const { mail } of [...cases, waitingRow]) expect(await mailRow(mail.id)).toEqual(mail);
  });

  it("does not make the link last longer: it runs out when it would have", async () => {
    const { eventId, registrant, row, mail } = await waiting();
    await sentAnHourAgo(mail.id);

    await again(eventId, registrant);

    expect((await db.registration.findUniqueOrThrow({ where: { id: row.id } })).confirm_expires_at?.getTime()).toBe(row.confirm_expires_at?.getTime());
  });
});

describe("requeueMailForMoment", () => {
  it("does nothing for a moment that has no mail, and does not ask", async () => {
    const eventId = await make.event();
    const row = await make.registration(eventId, { status: "pending" });
    const allow = vi.fn(() => true);

    const queued = await db.$transaction((tx) =>
      requeueMailForMoment(tx, { eventId, registration: row, moment: { to: "pending", afterConfirmation: true } }, new Date(), allow),
    );

    expect(queued).toBe(false);
    expect(allow).not.toHaveBeenCalled();
    expect(await make.templatesOf(row.id)).toEqual([]);
  });

  it("queues no mail that the registration no longer fits, and does not ask: another state, or a link that ran out (registrationMailMisfit)", async () => {
    const eventId = await make.event();
    const pending = await make.registration(eventId, { status: "pending" });
    const ranOut = await make.registration(eventId, { status: "awaiting_email", expiresAt: new Date(Date.now() - 1_000) });
    const allow = vi.fn(() => true);

    for (const registration of [pending, ranOut]) {
      const queued = await db.$transaction((tx) =>
        requeueMailForMoment(tx, { eventId, registration, moment: { to: "awaiting_email" } }, new Date(), allow),
      );
      expect(queued).toBe(false);
      expect(await make.templatesOf(registration.id)).toEqual([]);
    }
    expect(allow).not.toHaveBeenCalled();
  });

  it("hands the row as it is, or null, to the decision, and writes only when it says yes", async () => {
    const eventId = await make.event();
    const row = await make.registration(eventId, { status: "awaiting_email" });
    const entry = { eventId, registration: row, moment: { to: "awaiting_email" } as const };
    const now = new Date();

    const refusedWithNoRow = vi.fn(() => false);
    expect(await db.$transaction((tx) => requeueMailForMoment(tx, entry, now, refusedWithNoRow))).toBe(false);
    expect(refusedWithNoRow).toHaveBeenCalledWith(null);
    expect(await make.templatesOf(row.id)).toEqual([]);

    expect(await db.$transaction((tx) => requeueMailForMoment(tx, entry, now, () => true))).toBe(true);
    const queued = await db.registrationMail.findFirstOrThrow({ where: { registration_id: row.id } });
    await db.registrationMail.update({ where: { id: queued.id }, data: { status: "failed", attempts: 3, retryable: false, error_code: "send_failed", error: "x" } });

    const refusedWithRow = vi.fn(() => false);
    expect(await db.$transaction((tx) => requeueMailForMoment(tx, entry, now, refusedWithRow))).toBe(false);
    expect(refusedWithRow).toHaveBeenCalledWith(expect.objectContaining({ id: queued.id, queued_at: queued.queued_at }));
    expect((await db.registrationMail.findUniqueOrThrow({ where: { id: queued.id } })).status).toBe("failed");

    expect(await db.$transaction((tx) => requeueMailForMoment(tx, entry, now, () => true))).toBe(true);
    expect(await db.registrationMail.findUniqueOrThrow({ where: { id: queued.id } })).toMatchObject({
      status: "queued",
      attempts: 0,
      retryable: null,
      error_code: null,
      error: null,
      queued_at: now,
    });
    expect(await db.registrationMail.count({ where: { registration_id: row.id } })).toBe(1);
  });
});

describe("placeRegistration: the form is closed, or the input is refused", () => {
  const closedCases: [string, () => Promise<string>][] = [
    ["no settings row", () => make.event({ settings: false })],
    ["registration off (mode null)", () => make.event({ mode: null })],
    ["an archived event", () => make.event({ archived: true })],
    ["an event that is over", () => make.event({ date: new Date(Date.now() - 30 * 86_400_000) })],
    ["an event that does not exist", () => Promise.resolve("no-such-event")],
  ];
  it.each(closedCases)("answers closed, and writes nothing: %s", async (_name, arrange) => {
    const eventId = await arrange();
    const before = await make.counts(eventId);

    expect(await place(eventId, make.registrant())).toEqual({ outcome: "closed" });
    expect(await make.counts(eventId)).toEqual(before);
  });

  it("refuses an address in the namespace of erased attendees, and one that is no address, before anything is written", async () => {
    const eventId = await make.event({ verify: false });
    for (const email of ["erased-someone@erased.invalid", "ERASED-someone@Erased.Invalid", "not an address", ""]) {
      await expect(place(eventId, make.registrant({ email }))).rejects.toBeInstanceOf(RegistrantInputError);
    }
    expect(await make.counts(eventId)).toEqual({ attendees: 0, registrations: 0, mails: 0, logs: 0 });
  });

  it("stores the address the way the database requires: trimmed and in lower case", async () => {
    const eventId = await make.event({ verify: true });

    await place(eventId, make.registrant({ email: "  Mixed.Case@Example.COM " }));

    expect((await db.registration.findFirstOrThrow({ where: { event_id: eventId } })).email).toBe("mixed.case@example.com");
  });
});

describe("confirmRegistrationAddress (D-C5, D-D2)", () => {
  /** A registration that waits for its address, made the way a submission makes it. */
  async function awaiting(options: EventOptions = {}, before?: (eventId: string) => Promise<void>) {
    const eventId = await make.event(options);
    await before?.(eventId);
    const registrant = make.registrant();
    await place(eventId, registrant);
    const row = (await make.registrationByEmail(eventId, registrant.email))!;
    return { eventId, registrant, row };
  }
  const confirm = (eventId: string, registrationId: string, now?: Date) =>
    confirmRegistrationAddress(db, { eventId, registrationId }, { now });

  it("accepts the guest of an automatic event with a seat: an attendee and the ticket after the confirmation mail", async () => {
    const { eventId, row, registrant } = await awaiting();
    const now = new Date();

    expect(await confirm(eventId, row.id, now)).toEqual({ outcome: "placed", status: "accepted" });

    const after = (await db.registration.findUnique({ where: { id: row.id } }))!;
    expect(after).toMatchObject({ status: "accepted", confirm_expires_at: null, decided_by: null });
    expect(after.email_verified_at?.getTime()).toBe(now.getTime());
    expect(after.decided_at?.getTime()).toBe(now.getTime());
    expect((await db.attendee.findFirstOrThrow({ where: { event_id: eventId } })).email).toBe(registrant.email);
    expect(after.attendee_id).not.toBeNull();
    expect(await make.templatesOf(row.id)).toEqual(["registration-confirm", "ticket"]);
    expect(await db.attendeeActionLog.count({ where: { event_id: eventId, action_type: "registration_accepted" } })).toBe(1);
  });

  it("puts the guest of an event with approval on 'pending' and queues nothing: the confirmation took the place of 'received'", async () => {
    const { eventId, row } = await awaiting({ mode: "approval" });

    expect(await confirm(eventId, row.id)).toEqual({ outcome: "placed", status: "pending" });

    expect(await make.templatesOf(row.id)).toEqual(["registration-confirm"]);
    expect(await db.attendee.count({ where: { event_id: eventId } })).toBe(0);
  });

  it.each([["automatic" as const], ["approval" as const]])(
    "puts the guest of a full %s event on the waiting list, with the waiting list mail after the confirmation",
    async (mode) => {
      const { eventId, row } = await awaiting({ mode, capacity: 1 }, (id) => make.attendees(id, 1));

      expect(await confirm(eventId, row.id)).toEqual({ outcome: "placed", status: "waitlist" });

      expect(await make.templatesOf(row.id)).toEqual(["registration-confirm", "registration-waitlist"]);
    },
  );

  it("queues the guest of an automatic event behind the guests that wait, although a seat is free (D-B16)", async () => {
    const { eventId, row } = await awaiting({ capacity: 5 }, async (id) => {
      await make.registration(id, { status: "waitlist" });
    });

    expect(await confirm(eventId, row.id)).toEqual({ outcome: "placed", status: "waitlist" });
  });

  it("needs a seat for each companion: one seat is not enough for a guest with one", async () => {
    const eventId = await make.event({ capacity: 2 });
    await make.attendees(eventId, 1);
    const withCompanion = await make.registration(eventId, { status: "awaiting_email", companions: [{ name: "Companion Example", custom_data: {} }] });

    expect(await confirm(eventId, withCompanion.id)).toEqual({ outcome: "placed", status: "waitlist" });
  });

  it("keeps a registration that finds no seat and no waiting list as it was, and its link valid: a seat that frees up can still be had", async () => {
    // The submission found a seat; by the click somebody else has it.
    const { eventId, row } = await awaiting({ capacity: 1, waitlist: false });
    await make.attendee(eventId);

    expect(await confirm(eventId, row.id)).toEqual({ outcome: "full" });
    const unchanged = (await db.registration.findUnique({ where: { id: row.id } }))!;
    expect(unchanged).toEqual(row);
    expect(await make.templatesOf(row.id)).toEqual(["registration-confirm"]);

    await db.attendee.updateMany({ where: { event_id: eventId }, data: { status: "cancelled" } });
    expect(await confirm(eventId, row.id)).toEqual({ outcome: "placed", status: "accepted" });
  });

  it("finds the registration placed on a second click and changes nothing", async () => {
    const { eventId, row } = await awaiting();
    await confirm(eventId, row.id);
    const before = await make.counts(eventId);

    expect(await confirm(eventId, row.id)).toEqual({ outcome: "already_placed", status: "accepted" });
    expect(await make.counts(eventId)).toEqual(before);
  });

  it("answers `already_placed` with the state an organiser decided meanwhile", async () => {
    const { eventId, row } = await awaiting({ mode: "approval" });
    await confirm(eventId, row.id);
    await db.registration.update({ where: { id: row.id }, data: { status: "rejected" } });

    expect(await confirm(eventId, row.id)).toEqual({ outcome: "already_placed", status: "rejected" });
  });

  it("refuses a link that has expired, before the clean-up has deleted the row, and changes nothing", async () => {
    const { eventId, row } = await awaiting();
    const afterTheWindow = new Date(row.confirm_expires_at!.getTime() + 1);
    const before = await make.counts(eventId);

    expect(await confirm(eventId, row.id, afterTheWindow)).toEqual({ outcome: "expired" });
    expect(await make.counts(eventId)).toEqual(before);
    expect((await db.registration.findUnique({ where: { id: row.id } }))?.status).toBe("awaiting_email");
    // And the last moment of the window still counts.
    expect(await confirm(eventId, row.id, new Date(row.confirm_expires_at!.getTime() - 1))).toMatchObject({ outcome: "placed" });
  });

  it("answers `gone` for a registration that is not there, and for one that belongs to another event", async () => {
    const { eventId, row } = await awaiting();
    const otherEvent = await make.event();

    expect(await confirm(eventId, "no-such-registration")).toEqual({ outcome: "gone" });
    expect(await confirm(otherEvent, row.id)).toEqual({ outcome: "gone" });
    expect((await db.registration.findUnique({ where: { id: row.id } }))?.status).toBe("awaiting_email");
  });

  it("deletes the registration of an address that became an attendee meanwhile, and says so", async () => {
    const { eventId, row, registrant } = await awaiting();
    await make.attendee(eventId, { email: registrant.email.toUpperCase() });

    expect(await confirm(eventId, row.id)).toEqual({ outcome: "already_registered" });

    expect(await db.registration.count({ where: { event_id: eventId } })).toBe(0);
    expect(await db.registrationMail.count({ where: { event_id: eventId } })).toBe(0);
    expect(await db.attendee.count({ where: { event_id: eventId } })).toBe(1);
  });

  it("answers `already_registered` when an uncommitted edit of an attendee takes the address while the click is placed", async () => {
    const { eventId, row, registrant } = await awaiting();
    const editor = await make.attendee(eventId);
    const editing = holdTransaction(migrated.connection(), (tx) =>
      tx.attendee.update({ where: { id: editor.id }, data: { email: registrant.email } }),
    );
    await editing.started;

    const confirming = confirm(eventId, row.id);
    await vi.waitFor(async () => expect(await lockWaiters(db)).toBeGreaterThan(0), { timeout: 5000, interval: 25 });
    await editing.commit();

    expect(await confirming).toEqual({ outcome: "already_registered" });
    expect(await db.registration.count({ where: { event_id: eventId } })).toBe(0);
    expect(await db.attendee.count({ where: { event_id: eventId } })).toBe(1);
  });

  it("answers closed, and keeps the row, when registration was switched off or the event is archived", async () => {
    const { eventId, row } = await awaiting();
    await db.eventRegistrationSettings.update({ where: { event_id: eventId }, data: { mode: null } });
    expect(await confirm(eventId, row.id)).toEqual({ outcome: "closed" });
    await db.eventRegistrationSettings.update({ where: { event_id: eventId }, data: { mode: "automatic" } });
    await db.event.update({ where: { id: eventId }, data: { archived_at: new Date() } });
    expect(await confirm(eventId, row.id)).toEqual({ outcome: "closed" });
    expect((await db.registration.findUnique({ where: { id: row.id } }))?.status).toBe("awaiting_email");
  });

  it("changes the state and queues the mail in one transaction: a rollback leaves the registration waiting", async () => {
    const { eventId, row } = await awaiting();
    const before = await make.counts(eventId);

    await expect(
      confirmRegistrationAddress(failingAfterWork(migrated.connection()), { eventId, registrationId: row.id }),
    ).rejects.toThrow("Synthetic rollback after the work");

    expect(await make.counts(eventId)).toEqual(before);
    expect((await db.registration.findUnique({ where: { id: row.id } }))?.status).toBe("awaiting_email");
  });
});

describe("enqueueRegistrationMail", () => {
  it("queues one row for a registration and a template, and leaves a row that exists as it is", async () => {
    const eventId = await make.event();
    const row = await make.registration(eventId, { status: "pending" });
    const entry = { registrationId: row.id, eventId, template: "registration-received" as const };

    await db.$transaction((tx) => enqueueRegistrationMail(tx, entry));
    await db.registrationMail.updateMany({ where: { registration_id: row.id }, data: { status: "sent", attempts: 1 } });
    await db.$transaction((tx) => enqueueRegistrationMail(tx, entry));

    const mails = await db.registrationMail.findMany({ where: { registration_id: row.id } });
    expect(mails).toHaveLength(1);
    expect(mails[0]).toMatchObject({ template_name: "registration-received", status: "sent", attempts: 1 });
  });

  it("refuses a template that is not one of the five (the database holds the list)", async () => {
    const eventId = await make.event();
    const row = await make.registration(eventId, { status: "pending" });

    await expect(
      db.$transaction((tx) => enqueueRegistrationMail(tx, { registrationId: row.id, eventId, template: "registration-other" as never })),
    ).rejects.toThrow();
  });

  it("queues a row for a registration of this event only: the composite key names the event", async () => {
    const eventId = await make.event();
    const otherEvent = await make.event();
    const row = await make.registration(eventId, { status: "pending" });

    await expect(
      db.$transaction((tx) => enqueueRegistrationMail(tx, { registrationId: row.id, eventId: otherEvent, template: "ticket" })),
    ).rejects.toThrow();
  });
});
