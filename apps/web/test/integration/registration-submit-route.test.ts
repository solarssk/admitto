/**
 * `POST /r/:slug` against a real database: what a guest's submission becomes, and that nothing a stranger can observe
 * (status, headers, bytes, the order in which work is done and the time it takes) tells a new address from one that
 * has a place already (D-B14). The contract with the page is ./registration-submit-contract.test.ts; the
 * concurrency with an import, in ./registration-submit-concurrency.test.ts; the limits, in
 * ./registration-submit-limits.test.ts.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { PrismaClient } from "@admitto/db";
import { createTestPrismaClient } from "@admitto/db/testing";
import { checkRegistrationMailRecipientRateLimit } from "../../src/rate-limit/policies.js";
import type { AnswerPace } from "../../src/registration/submit-route.js";
import {
  HOST,
  PAST,
  SelectiveStore,
  eventSeeder,
  harness,
  nextEmail,
  recordingPace,
  signature,
  watchedClient,
  type HarnessOptions,
} from "../helpers/registration-submit-harness.js";

const ORG = "org-reg95c-submit";

let prisma: PrismaClient;
const seed = () => eventSeeder(prisma, ORG);
let seeder: ReturnType<typeof seed>;
let slugCounter = 0;
const nextSlug = (label: string) => `reg95c-${label}-${(slugCounter += 1)}`;

beforeAll(async () => {
  prisma = createTestPrismaClient();
  seeder = seed();
  await seeder.prepare();
});

afterAll(async () => {
  await seeder?.wipe();
  await prisma?.$disconnect();
});

/** The registration of an address with its mails, or null. */
async function stateOf(eventId: string, email: string) {
  const row = await prisma.registration.findUnique({
    where: { event_id_email: { event_id: eventId, email } },
    include: { mails: { orderBy: { template_name: "asc" } } },
  });
  return row && { ...row, templates: row.mails.map((mail) => mail.template_name) };
}

const countsOf = async (eventId: string) => ({
  registrations: await prisma.registration.count({ where: { event_id: eventId } }),
  mails: await prisma.registrationMail.count({ where: { event_id: eventId } }),
  attendees: await prisma.attendee.count({ where: { event_id: eventId } }),
  logs: await prisma.attendeeActionLog.count({ where: { event_id: eventId } }),
});

describe("what a submission becomes", () => {
  it("stores a registration that waits for its address, with its confirmation mail, and answers 200 { ok: true }", async () => {
    const slug = nextSlug("confirm");
    const eventId = await seeder.addEvent(slug, { settings: { mode: "automatic", verify_email: true } });
    const h = harness({ prisma });
    const payload = h.body(slug, { first_name: "  Ada ", last_name: "Example-Lovelace", email: "  Ada.Example@Example.COM " });
    const before = Date.now();

    const res = await h.post(slug, payload);

    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toMatch(/^application\/json/);
    expect(await res.json()).toEqual({ ok: true });
    const row = await stateOf(eventId, "ada.example@example.com");
    expect(row).toMatchObject({
      status: "awaiting_email",
      first_name: "Ada",
      last_name: "Example-Lovelace",
      name: "Ada Example-Lovelace",
      attendee_id: null,
      email_verified_at: null,
      decided_by: null,
      locale: null,
    });
    expect(row?.templates).toEqual(["registration-confirm"]);
    expect(row?.confirm_expires_at?.getTime()).toBeGreaterThanOrEqual(before + 24 * 3_600_000);
    expect(row?.confirm_expires_at?.getTime()).toBeLessThanOrEqual(Date.now() + 24 * 3_600_000);
    // The terms were accepted when the form was sent (D-F3).
    expect(Math.abs((row?.accepted_at?.getTime() ?? 0) - before)).toBeLessThan(60_000);
    expect(row?.consents).toEqual({});
  });

  it("accepts the guest of an automatic event at once when the address needs no confirmation: an attendee, and the ticket queued", async () => {
    const slug = nextSlug("auto");
    const eventId = await seeder.addEvent(slug, { capacity: 5, settings: { mode: "automatic", verify_email: false } });
    const h = harness({ prisma });
    const payload = h.body(slug);

    expect((await h.post(slug, payload)).status).toBe(200);

    const row = await stateOf(eventId, payload.email);
    expect(row).toMatchObject({ status: "accepted", email_verified_at: null });
    expect(row?.templates).toEqual(["ticket"]);
    const attendee = await prisma.attendee.findFirstOrThrow({ where: { event_id: eventId } });
    expect(attendee).toMatchObject({ email: payload.email, name: "Ada Example", status: "registered", ticket_type: null });
    expect(row?.attendee_id).toBe(attendee.id);
  });

  it("holds the guest of an event with approval as 'pending', with the 'received' mail", async () => {
    const slug = nextSlug("approval");
    const eventId = await seeder.addEvent(slug, { settings: { mode: "approval", verify_email: false } });
    const h = harness({ prisma });
    const payload = h.body(slug);

    expect((await h.post(slug, payload)).status).toBe(200);

    const row = await stateOf(eventId, payload.email);
    expect(row).toMatchObject({ status: "pending" });
    expect(row?.templates).toEqual(["registration-received"]);
    expect(await prisma.attendee.count({ where: { event_id: eventId } })).toBe(0);
  });

  it("puts the guest of a full event on the waiting list, with its mail", async () => {
    const slug = nextSlug("waitlist");
    const eventId = await seeder.addEvent(slug, { capacity: 1, settings: { mode: "automatic", verify_email: false } });
    await prisma.attendee.create({ data: { event_id: eventId, email: nextEmail("taker"), name: "Seat Taker" } });
    const h = harness({ prisma });
    const payload = h.body(slug);

    expect((await h.post(slug, payload)).status).toBe(200);

    const row = await stateOf(eventId, payload.email);
    expect(row).toMatchObject({ status: "waitlist" });
    expect(row?.templates).toEqual(["registration-waitlist"]);
  });

  it("tells a guest of a full event without a waiting list so (409 full), whatever the address, and stores nothing (D-B6)", async () => {
    const slug = nextSlug("full");
    const eventId = await seeder.addEvent(slug, { capacity: 1, settings: { verify_email: true, waitlist_enabled: false } });
    const taken = nextEmail("taker");
    await prisma.attendee.create({ data: { event_id: eventId, email: taken, name: "Seat Taker" } });
    const known = await prisma.registration.create({
      data: { event_id: eventId, email: nextEmail("known"), first_name: "K", last_name: "N", name: "K N", status: "pending" },
    });
    const h = harness({ prisma });
    const before = await countsOf(eventId);

    const answers = [];
    for (const email of [nextEmail(), taken, known.email]) {
      const res = await h.post(slug, h.body(slug, { email }));
      answers.push(await signature(res));
    }

    expect(answers.map((a) => a.status)).toEqual([409, 409, 409]);
    expect(answers[0]!.body).toBe('{"error":"full"}');
    expect(new Set(answers.map((a) => a.body + JSON.stringify(a.headers))).size).toBe(1);
    expect(await countsOf(eventId)).toEqual(before);
  });

  it("stores company and department only when the event asks for them, and ignores a value sent for one it does not", async () => {
    const asking = nextSlug("asks");
    const notAsking = nextSlug("asks-not");
    const askingId = await seeder.addEvent(asking, { settings: { ask_company: true, ask_department: false } });
    const notAskingId = await seeder.addEvent(notAsking, { settings: { ask_company: false, ask_department: false } });
    const h = harness({ prisma });
    const first = h.body(asking, { company: "  Example Corp ", department: "Hostile <b>department</b>" });
    const second = h.body(notAsking, { company: "Example Corp", department: "Operations" });

    expect((await h.post(asking, first)).status).toBe(200);
    expect((await h.post(notAsking, second)).status).toBe(200);

    expect(await stateOf(askingId, first.email)).toMatchObject({ company: "Example Corp", department: null });
    expect(await stateOf(notAskingId, second.email)).toMatchObject({ company: null, department: null });
  });

  it("stores the answers to the questions on the form as the boundary normalises them, and only those", async () => {
    const slug = nextSlug("answers");
    const eventId = await seeder.addEvent(slug, {
      fields: [
        { source_field: "diet", label: "Diet", type: "select", options: ["vegan", "none"], required: true },
        { source_field: "mobile", label: "Mobile", type: "phone" },
        { source_field: "arrival", label: "Arrival", type: "datetime" },
        { source_field: "hidden_import_only", label: "Import only", show_on_form: false },
      ],
    });
    const h = harness({ prisma });
    // JSON.parse makes `__proto__` an ordinary key of the object, as a request body would.
    const customData = JSON.parse(
      '{"diet":"vegan","mobile":" +48 600 100 200 ","arrival":"2099-05-13T18:30","hidden_import_only":"set by the guest","unknown_key":"x","__proto__":"y"}',
    ) as Record<string, string>;
    const payload = h.body(slug, { custom_data: customData });

    expect((await h.post(slug, payload)).status).toBe(200);

    const row = await stateOf(eventId, payload.email);
    expect(row?.custom_data).toEqual({ diet: "vegan", mobile: "+48600100200", arrival: "2099-05-13T18:30" });
  });
});

describe("one answer for every address (D-B14)", () => {
  /** An event, and an address of each kind: a new one, and five that have a place or had their mail withheld. */
  async function arrange(extra: Partial<HarnessOptions> = {}) {
    const slug = nextSlug("uniform");
    const eventId = await seeder.addEvent(slug, { capacity: 20, settings: { mode: "automatic", verify_email: true } });
    const store = new SelectiveStore();
    const h = harness({ prisma, store, ...extra });
    const make = (email: string, status: string, extra: Record<string, unknown> = {}) =>
      prisma.registration.create({
        data: {
          event_id: eventId,
          email,
          first_name: "Known",
          last_name: "Guest",
          name: "Known Guest",
          status,
          confirm_expires_at: status === "awaiting_email" ? new Date(Date.now() + 3_600_000) : null,
          ...extra,
        },
      });
    const awaiting = (await make(nextEmail("awaiting"), "awaiting_email")).email;
    const pending = (await make(nextEmail("pending"), "pending")).email;
    const rejected = (await make(nextEmail("rejected"), "rejected")).email;
    const attendeeEmail = nextEmail("attendee");
    await prisma.attendee.create({ data: { event_id: eventId, email: attendeeEmail, name: "Held Attendee", status: "revoked" } });
    const spent = nextEmail("spent");
    for (let i = 0; i < 3; i += 1) await checkRegistrationMailRecipientRateLimit(store, spent);
    return { slug, eventId, store, h, emails: { fresh: nextEmail("fresh"), awaiting, pending, rejected, attendee: attendeeEmail, spent } };
  }

  it("answers a new address, one that waits for its address, one that waits for a decision, a rejected one, an attendee's and one whose mail was withheld with the same status, headers and bytes", async () => {
    const { slug, h, emails } = await arrange();

    const signatures = [];
    for (const email of Object.values(emails)) signatures.push(await signature(await h.post(slug, h.body(slug, { email }))));

    expect(signatures[0]!.status).toBe(200);
    expect(signatures[0]!.body).toBe('{"ok":true}');
    for (const other of signatures) expect(other).toEqual(signatures[0]);
  });

  it("writes only what the new address needs: the others change nothing, and a rejected or decided guest stays as they are", async () => {
    const { slug, eventId, h, emails } = await arrange();
    const rows = await prisma.registration.findMany({ where: { event_id: eventId }, orderBy: { email: "asc" } });
    const before = { rows, counts: await countsOf(eventId) };

    for (const email of [emails.awaiting, emails.pending, emails.rejected, emails.attendee]) {
      expect((await h.post(slug, h.body(slug, { email, first_name: "Somebody", last_name: "Else" }))).status).toBe(200);
    }

    expect(await countsOf(eventId)).toEqual(before.counts);
    expect(await prisma.registration.findMany({ where: { event_id: eventId }, orderBy: { email: "asc" } })).toEqual(before.rows);
  });

  it("holds every one of those answers for the same floor of time, counted from the end of the challenge check", async () => {
    const { pace, sleep } = recordingPace(250);
    const { slug, h, emails } = await arrange({ pace });

    for (const email of Object.values(emails)) expect((await h.post(slug, h.body(slug, { email }))).status).toBe(200);

    expect(sleep.mock.calls).toEqual(Object.values(emails).map(() => [250]));
  });

  it("holds the answer for at least the floor in real time, for a new address and for a known one", async () => {
    const real: AnswerPace = { floorMs: 150, now: () => performance.now(), sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)) };
    const { slug, h, emails } = await arrange({ pace: real });

    for (const email of [emails.fresh, emails.pending, emails.attendee]) {
      const started = performance.now();
      expect((await h.post(slug, h.body(slug, { email }))).status).toBe(200);
      // Only a lower bound: a slow machine takes longer, never shorter.
      expect(performance.now() - started).toBeGreaterThanOrEqual(140);
    }
  });

  it("holds the answer for 250 ms when nothing says otherwise", async () => {
    const slug = nextSlug("default-floor");
    await seeder.addEvent(slug);
    const h = harness({ prisma, pace: "real" });
    const started = performance.now();

    expect((await h.post(slug, h.body(slug))).status).toBe(200);

    expect(performance.now() - started).toBeGreaterThanOrEqual(240);
  });

  it("does not hold an answer that does not depend on the address: a refused field, a refused challenge", async () => {
    const { pace, sleep } = recordingPace(250);
    const { slug, h } = await arrange({ pace });

    expect((await h.post(slug, h.body(slug, { email: "not an address" }))).status).toBe(422);
    expect((await h.post(slug, h.body(slug, { challenge: "refused:x:1" }))).status).toBe(400);

    expect(sleep).not.toHaveBeenCalled();
  });
});

describe("a form that is not open answers the one 404 of the registration routes, byte for byte", () => {
  it("is the same for an unknown slug and for every way an event can be closed", async () => {
    const h = harness({ prisma });
    const closed: Record<string, string> = {
      "registration off": nextSlug("off"),
      "archived": nextSlug("archived"),
      "over": nextSlug("over"),
      "terms not published": nextSlug("draft"),
      "privacy not published": nextSlug("nopriv"),
      "a consent not published": nextSlug("noconsent"),
      "password method": nextSlug("password"),
      "no settings row": nextSlug("nosettings"),
    };
    await seeder.addEvent(closed["registration off"]!, { settings: { mode: null } });
    await seeder.addEvent(closed["archived"]!, { archived: true });
    await seeder.addEvent(closed["over"]!, { date: PAST });
    await seeder.addEvent(closed["terms not published"]!, { legal: { terms: false, draftTerms: true } });
    await seeder.addEvent(closed["privacy not published"]!, { legal: { privacy: false } });
    await seeder.addEvent(closed["a consent not published"]!, { settings: { consent_keys: ["photos"] } });
    await seeder.addEvent(closed["password method"]!, { settings: { access_methods: ["password"] } });
    await seeder.addEvent(closed["no settings row"]!, { settings: null });

    const unknown = await signature(await h.post("reg95c-no-such-event", h.body("reg95c-no-such-event")));
    expect(unknown.status).toBe(404);
    for (const [name, slug] of Object.entries(closed)) {
      expect(await signature(await h.post(slug, h.body(slug))), name).toEqual(unknown);
    }
    // And the page answers the same 404 to a visitor.
    expect(await signature(await h.get("/r/reg95c-no-such-event"))).toEqual(unknown);
  });

  it("stores nothing for an event that is closed, and does not spend the challenge or the event's budget on it", async () => {
    const slug = nextSlug("closed-quiet");
    const eventId = await seeder.addEvent(slug, { archived: true });
    const store = new SelectiveStore();
    const h = harness({ prisma, store });

    expect((await h.post(slug, h.body(slug))).status).toBe(404);

    expect(h.cf.mock).not.toHaveBeenCalled();
    expect(store.keys.filter((key) => !key.startsWith("registration:submit:"))).toEqual([]);
    expect(await countsOf(eventId)).toEqual({ registrations: 0, mails: 0, attendees: 0, logs: 0 });
  });

  it.each([
    ["archived", (id: string) => prisma.event.update({ where: { id }, data: { archived_at: new Date() } })],
    ["switched off", (id: string) => prisma.eventRegistrationSettings.update({ where: { event_id: id }, data: { mode: null } })],
    ["over", (id: string) => prisma.event.update({ where: { id }, data: { date: PAST } })],
    ["deleted", async (id: string) => {
      await prisma.legalDocument.deleteMany({ where: { event_id: id } });
      await prisma.eventRegistrationSettings.deleteMany({ where: { event_id: id } });
      await prisma.event.delete({ where: { id } });
    }],
  ])("answers the 404 too when the event is %s after the form was found open and before the registration is written", async (_name, close) => {
    const slug = nextSlug("race");
    const eventId = await seeder.addEvent(slug, { settings: { verify_email: true } });
    const h = harness({ prisma });
    const unknown = await signature(await h.post("reg95c-race-unknown", h.body("reg95c-race-unknown")));
    // The challenge is checked between reading the event and writing the registration: the event closes meanwhile.
    h.cf.mock.mockImplementationOnce(async () => {
      await close(eventId);
      return new Response(JSON.stringify({ success: true, hostname: HOST, cdata: `reg-${slug}` }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    });

    const res = await h.post(slug, h.body(slug));

    expect(await signature(res)).toEqual(unknown);
    expect(h.cf.mock).toHaveBeenCalledTimes(1);
    expect(await prisma.registration.count({ where: { event_id: eventId } })).toBe(0);
    expect(await prisma.registrationMail.count({ where: { event_id: eventId } })).toBe(0);
  });

  it("is also the answer when the keys of the bot challenge have been removed", async () => {
    const slug = nextSlug("nokeys");
    await seeder.addEvent(slug);
    const h = harness({ prisma });
    const unknown = await signature(await h.post("reg95c-still-no-such-event", h.body("reg95c-still-no-such-event")));
    await seeder.setSystemKeys(false);
    try {
      expect(await signature(await h.post(slug, h.body(slug)))).toEqual(unknown);
    } finally {
      await seeder.setSystemKeys(true);
    }
  });

  it("answers an event that is still open after the keys are back", async () => {
    const slug = nextSlug("keys-back");
    await seeder.addEvent(slug, { settings: { verify_email: false } });
    const h = harness({ prisma });
    expect((await h.post(slug, h.body(slug))).status).toBe(200);
  });
});

describe("the order of the checks", () => {
  const FUTURE_SLUG_OPTIONS = { settings: { mode: "automatic" as const, verify_email: true } };

  it("checks the challenge, then the event's ceiling, then the address's mail budget, and writes last", async () => {
    const slug = nextSlug("order");
    const eventId = await seeder.addEvent(slug, FUTURE_SLUG_OPTIONS);
    const store = new SelectiveStore();
    const hit = vi.spyOn(store, "hit");
    const h = harness({ prisma, store });

    expect((await h.post(slug, h.body(slug))).status).toBe(200);

    const calls = hit.mock.calls.map(([key]) => key);
    expect(calls.map((key) => key.split(":").slice(0, 2).join(":"))).toEqual([
      "registration:submit",
      "registration:event",
      "registration:mail-recipient",
    ]);
    expect(calls[1]).toBe(`registration:event:${eventId}`);
    const challengeAt = h.cf.mock.mock.invocationCallOrder[0]!;
    const orders = hit.mock.invocationCallOrder;
    expect(challengeAt).toBeGreaterThan(orders[0]!);
    expect(challengeAt).toBeLessThan(orders[1]!);
    expect(h.cf.mock).toHaveBeenCalledTimes(1);
  });

  it("refuses a request that is not JSON before it reads the database or checks the challenge", async () => {
    const slug = nextSlug("not-json");
    await seeder.addEvent(slug);
    const watched = watchedClient(prisma);
    const h = harness({ prisma: watched.client });
    watched.forget();

    const wrongType = await h.post(slug, null, { headers: { "Content-Type": "text/plain" }, raw: JSON.stringify(h.body(slug)) });
    const noType = await h.post(slug, null, { headers: { "Content-Type": "" }, raw: JSON.stringify(h.body(slug)) });

    expect([wrongType.status, noType.status]).toEqual([415, 415]);
    expect(await wrongType.json()).toEqual({ error: "unsupported_media_type" });
    expect(watched.touched).toEqual([]);
    expect(h.cf.mock).not.toHaveBeenCalled();
  });

  it.each([
    ["not JSON", { raw: "{not json" }],
    ["an array", { raw: "[]" }],
    ["a string", { raw: '"text"' }],
    ["null", { raw: "null" }],
    ["a key the page never sends", { raw: JSON.stringify({ first_name: "A", extra: "x" }) }],
    ["__proto__ as a key", { raw: '{"__proto__":{"polluted":true},"first_name":"A"}' }],
    ["custom_data that is a list", { raw: JSON.stringify({ custom_data: ["x"] }) }],
    ["custom_data that is a string", { raw: JSON.stringify({ custom_data: "x" }) }],
    ["a deeply nested array", { raw: "[".repeat(30_000) + "]".repeat(30_000) }],
  ])("answers a body that is %s with the one 400, and reads nothing else", async (_name, init) => {
    const slug = nextSlug("malformed");
    await seeder.addEvent(slug);
    const watched = watchedClient(prisma);
    const h = harness({ prisma: watched.client });
    watched.forget();

    const res = await h.post(slug, null, init);

    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "invalid_request" });
    expect(watched.touched).toEqual([]);
    expect(h.cf.mock).not.toHaveBeenCalled();
    expect(({} as Record<string, unknown>)["polluted"]).toBeUndefined();
  });

  it("does not touch the database for a guest when the challenge is refused, and spends neither budget", async () => {
    const slug = nextSlug("challenge-first");
    const eventId = await seeder.addEvent(slug);
    const store = new SelectiveStore();
    const watched = watchedClient(prisma);
    const h = harness({ prisma: watched.client, store });
    watched.forget();

    const res = await h.post(slug, h.body(slug, { challenge: "refused:x:1" }));

    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ errors: { challenge: "The security check did not pass. Try again." } });
    expect(watched.touched).not.toContain("$transaction");
    expect(store.keys.filter((key) => !key.startsWith("registration:submit:"))).toEqual([]);
    expect(await countsOf(eventId)).toEqual({ registrations: 0, mails: 0, attendees: 0, logs: 0 });
  });

  it("does not touch the database for a guest when a field is refused, and does not spend the address's mail budget", async () => {
    const slug = nextSlug("validate-first");
    const eventId = await seeder.addEvent(slug);
    const store = new SelectiveStore();
    const watched = watchedClient(prisma);
    const h = harness({ prisma: watched.client, store });
    watched.forget();

    const res = await h.post(slug, h.body(slug, { email: "no-at-sign.example.com", terms: false }));

    expect(res.status).toBe(422);
    expect(watched.touched).not.toContain("$transaction");
    expect(store.keys.some((key) => key.startsWith("registration:mail-recipient:"))).toBe(false);
    // The event's ceiling is spent: the challenge was solved, and what was sent was a form.
    expect(store.keys.filter((key) => key.startsWith("registration:event:"))).toEqual([`registration:event:${eventId}`]);
    expect(await countsOf(eventId)).toEqual({ registrations: 0, mails: 0, attendees: 0, logs: 0 });
  });

  it("consumes the single-use token on every answer: the same token a second time is refused", async () => {
    const slug = nextSlug("single-use");
    const eventId = await seeder.addEvent(slug);
    const h = harness({ prisma });
    const payload = h.body(slug);

    expect((await h.post(slug, payload)).status).toBe(200);
    const again = await h.post(slug, { ...payload, email: nextEmail() });

    expect(again.status).toBe(400);
    expect(await prisma.registration.count({ where: { event_id: eventId } })).toBe(1);
  });
});

describe("every JSON answer of the route", () => {
  it("is not kept by a browser or a proxy and cannot be sniffed as another type", async () => {
    const slug = nextSlug("headers");
    const eventId = await seeder.addEvent(slug, { capacity: 1, settings: { waitlist_enabled: false, verify_email: false } });
    const store = new SelectiveStore();
    const h = harness({ prisma, store, placement: { retryMs: 100, pauseMs: [5, 10] } });

    const answers: Record<string, Response> = {
      "200 received": await h.post(slug, h.body(slug)),
      "400 challenge": await h.post(slug, h.body(slug, { challenge: "refused:x:1" })),
      "400 malformed": await h.post(slug, null, { raw: "{" }),
      "415 media type": await h.post(slug, null, { headers: { "Content-Type": "text/plain" }, raw: "{}" }),
      "422 field": await h.post(slug, h.body(slug, { email: "x" })),
      "503 challenge unavailable": await h.post(slug, h.body(slug, { challenge: h.cf.token(slug, "down") })),
    };
    await prisma.attendee.create({ data: { event_id: eventId, email: nextEmail("taker"), name: "Seat Taker" } });
    answers["409 full"] = await h.post(slug, h.body(slug));
    store.deny = (key) => key.startsWith("registration:event:");
    answers["429 ceiling"] = await h.post(slug, h.body(slug));

    for (const [name, res] of Object.entries(answers)) {
      expect(res.headers.get("cache-control"), name).toBe("private, no-store, max-age=0");
      expect(res.headers.get("x-content-type-options"), name).toBe("nosniff");
      expect(res.headers.get("content-type"), name).toMatch(/^application\/json/);
      expect(res.headers.getSetCookie(), name).toEqual([]);
    }
    expect(Object.values(answers).map((res) => res.status)).toEqual([200, 400, 400, 415, 422, 503, 409, 429]);
  });
});

describe("the terms and the extra consents (D-F2, D-F3)", () => {
  it("refuses a form whose terms were not accepted with 422 under the terms, and stores nothing", async () => {
    const slug = nextSlug("terms");
    const eventId = await seeder.addEvent(slug);
    const h = harness({ prisma });

    for (const terms of [false, undefined, "true", 1, null]) {
      const res = await h.post(slug, h.body(slug, { terms }));
      expect(res.status).toBe(422);
      expect(await res.json()).toEqual({ errors: { terms: "Accept the event terms to continue." } });
    }
    expect(await countsOf(eventId)).toEqual({ registrations: 0, mails: 0, attendees: 0, logs: 0 });
  });

  it("records the time the terms were accepted and the time of each extra consent that was ticked", async () => {
    const slug = nextSlug("consents");
    const eventId = await seeder.addEvent(slug, { legal: { consents: ["photos", "newsletter"] } });
    const h = harness({ prisma });
    const payload = h.body(slug, { consents: ["photos"] });
    const before = Date.now();

    expect((await h.post(slug, payload)).status).toBe(200);

    const row = await stateOf(eventId, payload.email);
    expect(Object.keys(row?.consents as object)).toEqual(["photos"]);
    const given = new Date((row?.consents as Record<string, string>)["photos"]!).getTime();
    expect(given).toBe(row?.accepted_at?.getTime());
    expect(Math.abs(given - before)).toBeLessThan(60_000);
  });

  it("records no consent that was not ticked, and none when the page sends no list", async () => {
    const slug = nextSlug("consents-none");
    const eventId = await seeder.addEvent(slug, { legal: { consents: ["photos"] } });
    const h = harness({ prisma });
    const ticked = h.body(slug, { consents: [] });
    const absent = h.body(slug);
    delete (absent as Record<string, unknown>)["consents"];

    expect((await h.post(slug, ticked)).status).toBe(200);
    expect((await h.post(slug, absent)).status).toBe(200);

    expect((await stateOf(eventId, ticked.email))?.consents).toEqual({});
    expect((await stateOf(eventId, absent.email))?.consents).toEqual({});
  });

  it("refuses a consent that is not one of the texts this event shows: of another event, one it does not ask for, an unknown one", async () => {
    const slug = nextSlug("consents-own");
    const other = nextSlug("consents-other");
    const eventId = await seeder.addEvent(slug, { legal: { consents: ["photos"] } });
    await seeder.addEvent(other, { legal: { consents: ["partners"] } });
    // A published text this event does not ask for.
    const unaskedSlug = nextSlug("consents-unasked");
    const unaskedId = await seeder.addEvent(unaskedSlug, { settings: { consent_keys: [] }, legal: { consents: ["extra"] } });
    const h = harness({ prisma });

    for (const [target, consents] of [
      [slug, ["partners"]],
      [slug, ["photos", "partners"]],
      [slug, ["no-such-consent"]],
      [slug, ["__proto__"]],
      [unaskedSlug, ["extra"]],
    ] as const) {
      const res = await h.post(target, h.body(target, { consents: [...consents] }));
      expect(res.status, JSON.stringify(consents)).toBe(400);
      expect(await res.json()).toEqual({ error: "invalid_request" });
    }
    expect(await countsOf(eventId)).toEqual({ registrations: 0, mails: 0, attendees: 0, logs: 0 });
    expect(await countsOf(unaskedId)).toEqual({ registrations: 0, mails: 0, attendees: 0, logs: 0 });
  });
});

describe("the bot challenge", () => {
  const cases: [string, string, number][] = [
    ["a token Cloudflare turns down", "refused", 400],
    ["a token solved on another host", "host", 400],
    ["a token made for another event", "bound", 400],
    ["no answer from Cloudflare", "down", 503],
    ["an answer that is not JSON", "broken", 503],
    ["an error of Cloudflare", "server", 503],
  ];

  it.each(cases)("refuses %s, and stores nothing", async (_name, kind, status) => {
    const slug = nextSlug(`cf-${kind}`);
    const eventId = await seeder.addEvent(slug, { settings: { verify_email: false } });
    const h = harness({ prisma });

    const res = await h.post(slug, h.body(slug, { challenge: h.cf.token(slug, kind) }));

    expect(res.status).toBe(status);
    if (status === 503) {
      expect(res.headers.get("retry-after")).toBe("5");
      expect(await res.json()).toEqual({ error: "try_again" });
    } else {
      expect(res.headers.get("retry-after")).toBeNull();
      expect(await res.json()).toEqual({ errors: { challenge: "The security check did not pass. Try again." } });
    }
    expect(await countsOf(eventId)).toEqual({ registrations: 0, mails: 0, attendees: 0, logs: 0 });
  });

  it.each([
    ["no challenge at all", undefined],
    ["an empty one", ""],
    ["a number", 7],
    ["an object", { token: "x" }],
    ["a token longer than Cloudflare issues", "x".repeat(2049)],
  ])("refuses %s with 400 and does not ask Cloudflare", async (_name, challenge) => {
    const slug = nextSlug("cf-shape");
    await seeder.addEvent(slug);
    const h = harness({ prisma });

    const res = await h.post(slug, h.body(slug, { challenge }));

    expect(res.status).toBe(400);
    expect(h.cf.mock).not.toHaveBeenCalled();
  });

  it("gives the same answer for every reason the token is refused, so the reason cannot be probed", async () => {
    const slug = nextSlug("cf-same");
    await seeder.addEvent(slug);
    const h = harness({ prisma });

    const answers = [];
    for (const kind of ["refused", "host", "bound"]) {
      answers.push(await signature(await h.post(slug, h.body(slug, { challenge: h.cf.token(slug, kind) }))));
    }

    expect(new Set(answers.map((a) => JSON.stringify(a))).size).toBe(1);
  });
});
