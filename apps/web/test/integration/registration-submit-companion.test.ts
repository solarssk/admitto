/**
 * `POST /r/:slug` for a guest who brings a companion (D-E5), against a real database: what is stored and where, the seats
 * of the guest and the companion, the one answer for every address and for a guest with or without a companion (D-B14), the
 * bodies the event cannot take, and that nothing of the companion is written to a log. The contract with the page is
 * ./registration-submit-contract.test.ts; the rest of the route, in ./registration-submit-route.test.ts.
 */
import { inspect } from "node:util";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { PrismaClient } from "@admitto/db";
import { createTestPrismaClient } from "@admitto/db/testing";
import { querySystemLogs, resetSystemLogBufferForTest } from "@admitto/shared/system-log";
import { countSeatsInUse } from "@admitto/tickets";
import { SUBMIT_MESSAGES } from "../../src/registration/submit-body.js";
import { documentOf } from "../helpers/registration-form-fixtures.js";
import {
  SelectiveStore,
  eventSeeder,
  harness,
  nextEmail,
  recordingPace,
  signature,
  watchedClient,
  type EventSeed,
  type FieldSeed,
} from "../helpers/registration-submit-harness.js";

const ORG = "org-reg115c1-submit";

let prisma: PrismaClient;
let seeder: ReturnType<typeof eventSeeder>;
let slugCounter = 0;
const nextSlug = (label: string) => `reg115c1-${label}-${(slugCounter += 1)}`;

beforeAll(async () => {
  prisma = createTestPrismaClient();
  seeder = eventSeeder(prisma, ORG);
  await seeder.prepare();
});
afterAll(async () => {
  await seeder?.wipe();
  await prisma?.$disconnect();
});

const consoleMethods = ["log", "info", "warn", "error", "debug"] as const;
const spies: Array<{ mock: { calls: unknown[][] } }> = [];
beforeEach(() => {
  resetSystemLogBufferForTest();
  for (const method of consoleMethods) spies.push(vi.spyOn(console, method).mockImplementation(() => {}));
});
afterEach(() => {
  vi.restoreAllMocks();
  spies.length = 0;
});

/** Everything written to the console or to the system log since the test began, as one lower-case text. */
function written(): string {
  const lines = spies.flatMap((spy) => spy.mock.calls.map((call) => call.map((arg) => inspect(arg, { depth: 6 })).join(" ")));
  return [...lines, ...querySystemLogs().map((entry) => JSON.stringify(entry))].join("\n").toLowerCase();
}

/** The questions about the guest and about the companion that most tests use. */
const FIELDS: FieldSeed[] = [
  { source_field: "diet", label: "Diet", type: "select", options: ["Vegan", "None"] },
  { source_field: "badge", label: "Badge name", applies_to: "companion", required: true },
  { source_field: "allergy", label: "Allergy", type: "select", options: ["Nuts", "None"], applies_to: "companion" },
  { source_field: "secret", label: "Secret", applies_to: "companion", show_on_form: false },
];

/** An event that takes one companion, and whose guests need no confirmation of their address, unless the seed says otherwise. */
function seedEvent(label: string, seed: EventSeed = {}) {
  const slug = nextSlug(label);
  return seeder
    .addEvent(slug, { fields: FIELDS, ...seed, settings: { mode: "automatic", verify_email: false, max_companions: 1, ...seed.settings } })
    .then((eventId) => ({ slug, eventId }));
}

const companionOf = (name = "Piotr Companion", answers: Record<string, unknown> = { badge: "P" }) => ({ name, answers });
const rowOf = (eventId: string, email: string) => prisma.registration.findUnique({ where: { event_id_email: { event_id: eventId, email } } });
const countsOf = async (eventId: string) => ({
  registrations: await prisma.registration.count({ where: { event_id: eventId } }),
  mails: await prisma.registrationMail.count({ where: { event_id: eventId } }),
  attendees: await prisma.attendee.count({ where: { event_id: eventId } }),
  companions: await prisma.attendeeCompanion.count({ where: { attendee: { event_id: eventId } } }),
  logs: await prisma.attendeeActionLog.count({ where: { event_id: eventId } }),
});

describe("a guest who brings a companion", () => {
  it("is stored with the companion in the registration: the name as the schema takes it, and the answers to the questions about a companion that are on the form, and only those", async () => {
    const { slug, eventId } = await seedEvent("stored", { settings: { verify_email: true } });
    const h = harness({ prisma });
    const payload = h.body(slug, {
      custom_data: { diet: "Vegan" },
      companions: [companionOf("  Piotr Companion ", { badge: "P", allergy: "Nuts", diet: "None", secret: "s", unknown: "u" })],
    });

    const res = await h.post(slug, payload);

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
    const row = await rowOf(eventId, payload.email);
    expect(row?.status).toBe("awaiting_email");
    expect(row?.companions).toEqual([{ name: "Piotr Companion", custom_data: { badge: "P", allergy: "Nuts" } }]);
    // The guest's own answers are the guest's: the companion's did not reach them, nor theirs the companion's.
    expect(row?.custom_data).toEqual({ diet: "Vegan" });
  });

  it("is accepted with the companion at once when the address needs no confirmation: an attendee, a companion of the attendee, and two seats", async () => {
    const { slug, eventId } = await seedEvent("auto", { capacity: 5 });
    const h = harness({ prisma });
    const payload = h.body(slug, { companions: [companionOf()] });

    expect((await h.post(slug, payload)).status).toBe(200);

    const attendee = await prisma.attendee.findFirstOrThrow({ where: { event_id: eventId, email: payload.email }, include: { companions: true } });
    expect(attendee.companions.map((row) => [row.slot, row.name, row.custom_data])).toEqual([[1, "Piotr Companion", { badge: "P" }]]);
    expect(await countSeatsInUse(prisma, eventId)).toBe(2);
    expect((await rowOf(eventId, payload.email))?.status).toBe("accepted");
  });

  it("holds the couple of an event with approval as pending, which takes no seat, and puts it on the waiting list when one seat is free", async () => {
    const roomy = await seedEvent("approval", { capacity: 4, settings: { mode: "approval" } });
    const tight = await seedEvent("approval-tight", { capacity: 4, settings: { mode: "approval" } });
    await prisma.attendee.createMany({ data: [1, 2, 3].map((n) => ({ event_id: tight.eventId, email: nextEmail("held"), name: `Held ${n}` })) });
    const h = harness({ prisma });

    const couple = h.body(roomy.slug, { companions: [companionOf()] });
    expect((await h.post(roomy.slug, couple)).status).toBe(200);
    expect((await rowOf(roomy.eventId, couple.email))?.status).toBe("pending");
    expect(await countSeatsInUse(prisma, roomy.eventId)).toBe(0);

    const tightCouple = h.body(tight.slug, { companions: [companionOf()] });
    expect((await h.post(tight.slug, tightCouple)).status).toBe(200);
    expect((await rowOf(tight.eventId, tightCouple.email))?.status).toBe("waitlist");
    expect(await countSeatsInUse(prisma, tight.eventId)).toBe(3);
  });

  it("goes on the waiting list when there is one seat for two, and a guest alone takes it: the same event, one seat free", async () => {
    const couple = await seedEvent("tight-couple", { capacity: 3 });
    const alone = await seedEvent("tight-alone", { capacity: 3 });
    for (const { eventId } of [couple, alone]) {
      await prisma.attendee.createMany({ data: [1, 2].map((n) => ({ event_id: eventId, email: nextEmail("held"), name: `Held ${n}` })) });
    }
    const h = harness({ prisma });

    const withCompanion = h.body(couple.slug, { companions: [companionOf()] });
    const without = h.body(alone.slug);
    expect((await h.post(couple.slug, withCompanion)).status).toBe(200);
    expect((await h.post(alone.slug, without)).status).toBe(200);

    expect((await rowOf(couple.eventId, withCompanion.email))?.status).toBe("waitlist");
    expect((await rowOf(alone.eventId, without.email))?.status).toBe("accepted");
  });

  it("is told the event is full (409), and nothing is stored, when one seat is left for two and there is no waiting list; a guest alone is taken", async () => {
    const { slug, eventId } = await seedEvent("full-couple", { capacity: 2, settings: { waitlist_enabled: false } });
    await prisma.attendee.create({ data: { event_id: eventId, email: nextEmail("held"), name: "Held" } });
    const h = harness({ prisma });
    const before = await countsOf(eventId);

    const refused = await h.post(slug, h.body(slug, { companions: [companionOf()] }));
    expect(refused.status).toBe(409);
    expect(await refused.text()).toBe('{"error":"full"}');
    expect(await countsOf(eventId)).toEqual(before);

    expect((await h.post(slug, h.body(slug))).status).toBe(200);
  });

  it("is not told how many seats are left: a couple and a guest alone get the one answer while the event has room for both", async () => {
    const { slug } = await seedEvent("room", { capacity: 50 });
    const h = harness({ prisma });
    const alone = await signature(await h.post(slug, h.body(slug)));
    const couple = await signature(await h.post(slug, h.body(slug, { companions: [companionOf()] })));
    expect(couple).toEqual(alone);
  });
});

describe("one answer for every address, with a companion or without (D-B14)", () => {
  /** An event with the addresses that have a place of their own, and a new one. */
  async function arrange(pace?: ReturnType<typeof recordingPace>["pace"]) {
    const { slug, eventId } = await seedEvent("uniform", { capacity: 20, settings: { verify_email: true } });
    const known = await prisma.registration.create({
      data: { event_id: eventId, email: nextEmail("known"), first_name: "Known", last_name: "Guest", name: "Known Guest", status: "pending" },
    });
    const attendeeEmail = nextEmail("attendee");
    await prisma.attendee.create({ data: { event_id: eventId, email: attendeeEmail, name: "Held Attendee", status: "revoked" } });
    const h = harness({ prisma, ...(pace ? { pace } : {}) });
    return { slug, eventId, h, emails: { fresh: nextEmail("fresh"), known: known.email, attendee: attendeeEmail } };
  }

  it("answers a new address, a registered one and an attendee's with the same status, headers and bytes, with a companion and without", async () => {
    const { slug, h, emails } = await arrange();

    const signatures = [];
    for (const email of Object.values(emails)) {
      signatures.push(await signature(await h.post(slug, h.body(slug, { email, companions: [companionOf()] }))));
      signatures.push(await signature(await h.post(slug, h.body(slug, { email }))));
    }

    expect(signatures[0]!.status).toBe(200);
    expect(signatures[0]!.body).toBe('{"ok":true}');
    for (const other of signatures) expect(other).toEqual(signatures[0]);
  });

  it("holds each of those answers for the same floor of time", async () => {
    const { pace, sleep } = recordingPace(250);
    const { slug, h, emails } = await arrange(pace);

    for (const email of Object.values(emails)) {
      expect((await h.post(slug, h.body(slug, { email, companions: [companionOf()] }))).status).toBe(200);
      expect((await h.post(slug, h.body(slug, { email }))).status).toBe(200);
    }

    expect(sleep.mock.calls).toEqual(Array.from({ length: 6 }, () => [250]));
  });

  it("changes nothing of a registration that exists, and writes only what a new address needs", async () => {
    const { slug, eventId, h, emails } = await arrange();
    const before = await prisma.registration.findUniqueOrThrow({ where: { event_id_email: { event_id: eventId, email: emails.known } } });

    expect((await h.post(slug, h.body(slug, { email: emails.known, companions: [companionOf("Other Companion")] }))).status).toBe(200);

    const after = await prisma.registration.findUniqueOrThrow({ where: { event_id_email: { event_id: eventId, email: emails.known } } });
    expect(after).toEqual(before);
    expect(after.companions).toEqual([]);
    expect(await prisma.registration.count({ where: { event_id: eventId } })).toBe(1);
  });

  it("refuses what is wrong about a companion the same to a new address and to a known one, under the same fields", async () => {
    const { slug, h, emails } = await arrange();
    const answers = [];
    for (const email of Object.values(emails)) {
      const res = await h.post(slug, h.body(slug, { email, companions: [{ name: "", answers: {} }] }));
      answers.push(await signature(res));
    }
    expect(answers[0]!.status).toBe(422);
    expect(JSON.parse(answers[0]!.body)).toEqual({
      errors: { companion_name: SUBMIT_MESSAGES.companionName, companion_badge: SUBMIT_MESSAGES.answerMissing },
    });
    for (const other of answers) expect(other).toEqual(answers[0]);
  });
});

describe("a body the event cannot take", () => {
  const UNKNOWN_SHAPE = { foo: "bar" };

  it("is the one answer of a body the page did not send, for an event that takes none: the setting is not told", async () => {
    const takesNone = await seedEvent("none", { settings: { max_companions: 0 } });
    const h = harness({ prisma });
    const unknown = await signature(await h.post(takesNone.slug, h.body(takesNone.slug, UNKNOWN_SHAPE)));
    expect(unknown.status).toBe(400);
    expect(unknown.body).toBe('{"error":"invalid_request"}');

    for (const companions of [[companionOf()], [], "Piotr", {}]) {
      const asked = await signature(await h.post(takesNone.slug, h.body(takesNone.slug, { companions })));
      expect(asked).toEqual(unknown);
    }
    expect(await countsOf(takesNone.eventId)).toMatchObject({ registrations: 0, attendees: 0, companions: 0 });
  });

  it("is the same answer for an event that takes one but whose section the page does not offer: a required question about the companion that it cannot draw", async () => {
    const stuck: FieldSeed = { source_field: "later", label: "Later", type: "multi_select", required: true, applies_to: "companion" };
    const { slug, eventId } = await seedEvent("stuck", { fields: [stuck] });
    const h = harness({ prisma });

    const asked = await signature(await h.post(slug, h.body(slug, { companions: [companionOf("Piotr", {})] })));

    expect(asked.status).toBe(400);
    expect(asked.body).toBe('{"error":"invalid_request"}');
    expect(await countsOf(eventId)).toMatchObject({ registrations: 0 });
    // The guest alone is not turned away because of it.
    expect((await h.post(slug, h.body(slug))).status).toBe(200);
  });

  it.each<[string, unknown, Record<string, string>]>([
    ["more than the event takes", [companionOf(), companionOf("Maria Companion")], { companions: SUBMIT_MESSAGES.tooManyCompanions }],
    ["a name that is a link", [companionOf("https://evil.example")], { companion_name: SUBMIT_MESSAGES.companionName }],
    ["no answer to a required question", [{ name: "Piotr Companion" }], { companion_badge: SUBMIT_MESSAGES.answerMissing }],
    ["an answer that is not one of the choices", [companionOf("Piotr", { badge: "P", allergy: "Dust" })], { companion_allergy: "Choose one of the options." }],
  ])("refuses %s with 422 under the field it is about, stores nothing and spends no budget of an address", async (_label, companions, errors) => {
    const { slug, eventId } = await seedEvent("refused");
    const store = new SelectiveStore();
    const watched = watchedClient(prisma);
    const h = harness({ prisma: watched.client, store });
    watched.forget();

    const res = await h.post(slug, h.body(slug, { companions }));

    expect(res.status).toBe(422);
    expect(await res.json()).toEqual({ errors });
    expect(watched.touched).not.toContain("$transaction");
    expect(store.keys.some((key) => key.startsWith("registration:mail-recipient:"))).toBe(false);
    expect(await countsOf(eventId)).toEqual({ registrations: 0, mails: 0, attendees: 0, companions: 0, logs: 0 });
  });

  it("refuses a body whose companion is not shaped as the page sends it, and says nothing of why", async () => {
    const { slug, eventId } = await seedEvent("shape");
    const h = harness({ prisma });
    for (const companions of ["Piotr", [null], [{ name: "Piotr", extra: 1 }], [{ name: "Piotr", answers: "badge" }]]) {
      const res = await h.post(slug, h.body(slug, { companions }));
      expect(res.status).toBe(400);
      expect(await res.text()).toBe('{"error":"invalid_request"}');
    }
    expect(await countsOf(eventId)).toMatchObject({ registrations: 0 });
  });

  it("judges the number again under the locks: a setting lowered while the request was on its way refuses the companion, with a sentence, and stores nothing", async () => {
    const { slug, eventId } = await seedEvent("lowered");
    // The setting changes after the route has read the event and before its write begins: the moment the transaction opens.
    let lowered = false;
    const racing = new Proxy(prisma, {
      get(target, key, receiver) {
        if (key !== "$transaction") return Reflect.get(target, key, receiver);
        return async (...args: unknown[]) => {
          if (!lowered) {
            lowered = true;
            await prisma.eventRegistrationSettings.update({ where: { event_id: eventId }, data: { max_companions: 0 } });
          }
          return (Reflect.get(target, key, receiver) as (...a: unknown[]) => unknown).apply(target, args);
        };
      },
    }) as PrismaClient;
    const h = harness({ prisma: racing });

    const res = await h.post(slug, h.body(slug, { companions: [companionOf()] }));

    expect(res.status).toBe(422);
    expect(await res.json()).toEqual({ errors: { companions: SUBMIT_MESSAGES.tooManyCompanions } });
    expect(await countsOf(eventId)).toMatchObject({ registrations: 0, mails: 0, attendees: 0, companions: 0 });
  });
});

describe("what the route writes down about a companion", () => {
  const NAME = "Zygmunt Companionmarker";
  const ANSWER = "Badgemarker42";
  const fragments = ["companionmarker", "badgemarker42", "zygmunt"];

  it("is nothing in a log, in the system log or in an answer: not for a guest who is registered, nor for a refusal", async () => {
    const { slug } = await seedEvent("quiet", { capacity: 10 });
    const h = harness({ prisma });
    const answers: string[] = [];

    for (const companions of [[companionOf(NAME, { badge: ANSWER })], [companionOf(NAME, { badge: ANSWER, allergy: "Dust" })], [companionOf(NAME, { badge: ANSWER }), companionOf("Second Companionmarker")]]) {
      answers.push(await (await h.post(slug, h.body(slug, { companions }))).text());
    }

    for (const text of [written(), ...answers.map((answer) => answer.toLowerCase())]) for (const fragment of fragments) expect(text).not.toContain(fragment);
  });

  it("is nothing in a log or an answer when the write fails with an error whose message carries what the guest typed", async () => {
    const { slug } = await seedEvent("failing");
    const failing = new Proxy(prisma, {
      get(target, key, receiver) {
        if (key === "$transaction") return () => Promise.reject(new Error(`insert failed for ${NAME} (${ANSWER})`));
        return Reflect.get(target, key, receiver);
      },
    }) as PrismaClient;
    const h = harness({ prisma: failing });

    const res = await h.post(slug, h.body(slug, { companions: [companionOf(NAME, { badge: ANSWER })] }));

    expect(res.status).toBe(500);
    expect(await res.text()).toBe('{"error":"internal_error"}');
    for (const fragment of fragments) expect(written()).not.toContain(fragment);
  });

  it("is not in the central audit log, nor in the activity log of an event: only ids and counts", async () => {
    const { slug, eventId } = await seedEvent("audited", { capacity: 10 });
    const h = harness({ prisma });
    await h.post(slug, h.body(slug, { companions: [companionOf(NAME, { badge: ANSWER })] }));

    const logs = JSON.stringify(await prisma.attendeeActionLog.findMany({ where: { event_id: eventId } })).toLowerCase();
    expect(logs).toContain("registration_accepted");
    for (const fragment of fragments) expect(logs).not.toContain(fragment);
  });
});

describe("the page and the route agree on the section of a companion", () => {
  const pageOf = async (slug: string) => documentOf(await (await harness({ prisma }).get(`/r/${slug}`)).text());
  // The script of the page names these attributes in its own text, so the page is read as a document, never as a string.
  const hasSection = (doc: ReturnType<typeof documentOf>) => doc.querySelector("[data-companion-panel]") !== null;

  it("draws the section, with the questions about the companion that are on the form, for an event that takes one", async () => {
    const { slug } = await seedEvent("page");

    const doc = await pageOf(slug);

    expect(hasSection(doc)).toBe(true);
    expect(doc.querySelector("#f-companion").closest("label").textContent).toContain("I am bringing a guest");
    expect([...doc.querySelectorAll("#f-companion-panel [data-field]")].map((el: Element) => el.getAttribute("data-field"))).toEqual([
      "companion_name",
      "companion_badge",
      "companion_allergy",
    ]);
  });

  it("draws nothing of a companion for an event that takes none, whatever questions about a companion it has", async () => {
    const { slug } = await seedEvent("page-none", { settings: { max_companions: 0 } });

    const doc = await pageOf(slug);

    expect(hasSection(doc)).toBe(false);
    expect(doc.querySelector("#f-companion, [data-companion-toggle]")).toBeNull();
    expect(doc.body.textContent).not.toContain("Badge name");
    expect(doc.body.textContent).not.toContain("bringing a guest");
  });

  it("draws one companion for an event whose setting says more, as the application allows", async () => {
    const { slug } = await seedEvent("page-many", { settings: { max_companions: 7 } });
    expect((await pageOf(slug)).querySelectorAll("[data-companion-toggle]")).toHaveLength(1);
  });
});

// The setting is read by the page, the route and the placement from the same column: lowering it closes all three at once.
describe("an event whose setting is lowered", () => {
  it("stops offering the section and refusing nothing else: a guest alone is registered as before", async () => {
    const { slug, eventId } = await seedEvent("lowered-page");
    const h = harness({ prisma });
    const hasSection = async () => documentOf(await (await h.get(`/r/${slug}`)).text()).querySelector("[data-companion-panel]") !== null;
    expect(await hasSection()).toBe(true);

    await prisma.eventRegistrationSettings.update({ where: { event_id: eventId }, data: { max_companions: 0 } });

    expect(await hasSection()).toBe(false);
    expect((await h.post(slug, h.body(slug))).status).toBe(200);
    expect((await h.post(slug, h.body(slug, { companions: [companionOf()] }))).status).toBe(400);
  });
});
