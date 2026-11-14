/**
 * `POST /r/:slug` for an event whose way in is the password (D-C3, Q2, Q9, PR 111), against a real database. The
 * password is the one gate that is not the bot challenge, so the tests here are about what a stranger can learn from it:
 * that a wrong password is one answer whatever the address and whichever way it is wrong, that the right one does not
 * tell a guest who is on the list, that the tries are counted and cost little, and that neither the password nor its
 * hash is ever written down. The tests of the link are in ./registration-submit-route.test.ts.
 */
import { inspect } from "node:util";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { hashPassword } from "@admitto/auth";
import type { PrismaClient } from "@admitto/db";
import { createTestPrismaClient } from "@admitto/db/testing";
import { buildConfirmUrl } from "@admitto/mail-delivery";
import { REGISTRATION_PASSWORD_MAX } from "@admitto/shared";
import { querySystemLogs, resetSystemLogBufferForTest } from "@admitto/shared/system-log";
import { setEnabledAccessMethods } from "../../src/registration/access-methods.js";
import { clearEventPassword, setEventPassword } from "../../src/registration/event-password.js";
import { documentOf } from "../helpers/registration-form-fixtures.js";
import {
  ORIGIN,
  PAST,
  SelectiveStore,
  eventSeeder,
  harness,
  nextEmail,
  recordingPace,
  signature,
  type EventSeed,
  type HarnessOptions,
} from "../helpers/registration-submit-harness.js";

// The address of the client, which a test changes to be another office. A request made with `app.request` has no socket.
const peer = vi.hoisted(() => ({ address: "203.0.113.10" }));
vi.mock("@hono/node-server/conninfo", () => ({
  getConnInfo: vi.fn(() => ({ remote: { address: peer.address, port: 1234 } })),
}));

// The work of a check, counted, and a hook for a test to say how long it takes on its own clock. The real check runs.
const work = vi.hoisted(() => ({ hashes: 0, onHash: () => {} }));
vi.mock("@admitto/auth", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@admitto/auth")>();
  return {
    ...actual,
    verifyPasswordOrDummy: (candidate: string, hash: string | null) => {
      work.hashes += 1;
      work.onHash();
      return actual.verifyPasswordOrDummy(candidate, hash);
    },
  };
});

// The way in a registration is placed with. The real placement runs.
const placed = vi.hoisted(() => ({ methods: [] as string[] }));
vi.mock("@admitto/tickets", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@admitto/tickets")>();
  return {
    ...actual,
    placeRegistration: (...args: Parameters<typeof actual.placeRegistration>) => {
      placed.methods.push(args[1].method);
      return actual.placeRegistration(...args);
    },
  };
});

const ORG = "org-reg111-password";
const PASSWORD = "test-password";
const WRONG = "wrong-password";
const ACTOR = { operator: "reg111-staff", sessionId: "reg111-session", ip: "198.51.100.1", timezone: "UTC" };
const DENIED = '{"error":"access_denied"}';

let prisma: PrismaClient;
let seeder: ReturnType<typeof eventSeeder>;
let hash: string;
let slugCounter = 0;
const nextSlug = (label: string) => `reg111-${label}-${(slugCounter += 1)}`;

const consoleMethods = ["log", "info", "warn", "error", "debug"] as const;
const spies = new Map<(typeof consoleMethods)[number], { mock: { calls: unknown[][] } }>();

beforeAll(async () => {
  prisma = createTestPrismaClient();
  seeder = eventSeeder(prisma, ORG);
  await seeder.prepare();
  hash = await hashPassword(PASSWORD);
});

afterAll(async () => {
  await prisma?.adminAuditLog.deleteMany({ where: { organization_id: ORG } });
  await seeder?.wipe();
  await prisma?.$disconnect();
});

beforeEach(() => {
  peer.address = "203.0.113.10";
  work.hashes = 0;
  work.onHash = () => {};
  placed.methods = [];
  resetSystemLogBufferForTest();
  for (const method of consoleMethods) spies.set(method, vi.spyOn(console, method).mockImplementation(() => {}));
});

afterEach(() => {
  vi.restoreAllMocks();
  spies.clear();
});

/** An event whose way in is the password, with the password `PASSWORD` unless the test says otherwise. */
function addPasswordEvent(slug: string, seed: EventSeed = {}): Promise<string> {
  return seeder.addEvent(slug, {
    ...seed,
    settings: { mode: "automatic", verify_email: true, access_methods: ["password"], password_hash: hash, ...seed.settings },
  });
}

const countsOf = async (eventId: string) => ({
  registrations: await prisma.registration.count({ where: { event_id: eventId } }),
  mails: await prisma.registrationMail.count({ where: { event_id: eventId } }),
  attendees: await prisma.attendee.count({ where: { event_id: eventId } }),
});

/** What every console method and the system log were given since the test began, as one text. */
function written(): string {
  const lines = [...spies.values()].flatMap((spy) => spy.mock.calls.map((call) => call.map((arg) => inspect(arg, { depth: 6 })).join(" ")));
  return [...lines, ...querySystemLogs().map((entry) => JSON.stringify(entry))].join("\n");
}

/** One request to a password event on a store of its own, so that the count of tries of one test is not another's. */
async function tryOnce(slug: string, overrides: Record<string, unknown>, options: Partial<HarnessOptions> = {}) {
  const h = harness({ prisma, ...options });
  const res = await h.post(slug, h.body(slug, overrides));
  return { h, res, sig: await signature(res) };
}

describe("the page of an event whose way in is the password", () => {
  it("asks for the password first, with the form behind it, and holds neither the password nor its hash", async () => {
    const slug = nextSlug("page");
    await addPasswordEvent(slug);
    const h = harness({ prisma });

    const res = await h.get(`/r/${slug}`);

    expect(res.status).toBe(200);
    const html = await res.text();
    const doc = documentOf(html);
    expect(doc.getElementById("reg-password").hidden).toBe(false);
    expect(doc.getElementById("f-password").getAttribute("type")).toBe("password");
    for (const behind of ["reg-form", "reg-error"]) expect(doc.getElementById(behind).closest("[data-after-password]")?.hidden, behind).toBe(true);
    // The hero, the notices and the form; the contact line too for an event that has a contact.
    expect(doc.querySelectorAll("[data-after-password]")).toHaveLength(3);
    expect(html).not.toContain("$argon2");
    expect(html).not.toContain(hash);
    expect(html).not.toContain(PASSWORD);
    expect(res.headers.get("cache-control")).toContain("no-store");
  });

  it("is the page of the link, unchanged, for an event whose way in is the link", async () => {
    const slug = nextSlug("link-page");
    await seeder.addEvent(slug);
    const h = harness({ prisma });

    const doc = documentOf(await (await h.get(`/r/${slug}`)).text());

    expect(doc.getElementById("reg-password")).toBeNull();
    expect(doc.querySelectorAll("[data-after-password]")).toHaveLength(0);
    expect(doc.getElementById("reg-form").hidden).toBe(false);
  });

  it("is the one 404 of the registration routes for an event that has no password, over or not, and for a password that is not available", async () => {
    const h = harness({ prisma });
    const unknown = await signature(await h.get("/r/reg111-no-such-event"));
    expect(unknown.status).toBe(404);
    const none = nextSlug("none");
    const noneOver = nextSlug("none-over");
    const off = nextSlug("method-off");
    const nokeys = nextSlug("nokeys");
    const archived = nextSlug("archived");
    await addPasswordEvent(none, { settings: { password_hash: null } });
    await addPasswordEvent(noneOver, { date: PAST, settings: { password_hash: null } });
    await addPasswordEvent(off);
    await addPasswordEvent(nokeys);
    await addPasswordEvent(archived, { archived: true });

    expect(await signature(await h.get(`/r/${none}`))).toEqual(unknown);
    expect(await signature(await h.get(`/r/${noneOver}`))).toEqual(unknown);
    expect(await signature(await h.post(none, h.body(none, { password: PASSWORD })))).toEqual(unknown);
    expect(await signature(await h.post(archived, h.body(archived, { password: PASSWORD })))).toEqual(unknown);
    await setEnabledAccessMethods(prisma, ["link"]);
    try {
      expect(await signature(await h.get(`/r/${off}`))).toEqual(unknown);
      expect(await signature(await h.post(off, h.body(off, { password: PASSWORD })))).toEqual(unknown);
    } finally {
      await setEnabledAccessMethods(prisma, ["link", "password"]);
    }
    await seeder.setSystemKeys(false);
    try {
      expect(await signature(await h.get(`/r/${nokeys}`))).toEqual(unknown);
      expect(await signature(await h.post(nokeys, h.body(nokeys, { password: PASSWORD })))).toEqual(unknown);
    } finally {
      await seeder.setSystemKeys(true);
    }
  });

  it("says the event is closed once it is over, as it does for the link, when it has a password", async () => {
    const slug = nextSlug("over");
    await addPasswordEvent(slug, { date: PAST });
    const h = harness({ prisma });

    const res = await h.get(`/r/${slug}`);

    expect(res.status).toBe(200);
    expect(await res.text()).toContain("Registration is closed");
  });
});

describe("the right password", () => {
  it("is taken with the form: 200 { ok: true }, a registration that waits for its address (D-C5), its confirmation mail, and the password as the way in", async () => {
    const slug = nextSlug("right");
    const eventId = await addPasswordEvent(slug);
    const { res, sig } = await tryOnce(slug, { password: PASSWORD, email: "  Ada.Example@Example.COM " });

    expect(res.status).toBe(200);
    expect(sig.body).toBe('{"ok":true}');
    const row = await prisma.registration.findUniqueOrThrow({
      where: { event_id_email: { event_id: eventId, email: "ada.example@example.com" } },
      include: { mails: true },
    });
    expect(row.status).toBe("awaiting_email");
    expect(row.mails.map((mail) => mail.template_name)).toEqual(["registration-confirm"]);
    expect(placed.methods).toEqual(["password"]);
    expect(work.hashes).toBe(1);
  });

  it("registers the guest of an event with automatic admission and no confirmation of the address at once, like the link", async () => {
    const slug = nextSlug("right-auto");
    const eventId = await addPasswordEvent(slug, { capacity: 5, settings: { verify_email: false } });
    const email = nextEmail();

    expect((await tryOnce(slug, { password: PASSWORD, email })).res.status).toBe(200);

    expect(await prisma.registration.findUniqueOrThrow({ where: { event_id_email: { event_id: eventId, email } } })).toMatchObject({ status: "accepted" });
    expect(await prisma.attendee.count({ where: { event_id: eventId, email } })).toBe(1);
  });

  it("is answered alike, down to the bytes, for a new address, one that waits for its address, one that waits for a decision, a rejected one and an attendee's (Q9)", async () => {
    const slug = nextSlug("uniform");
    const eventId = await addPasswordEvent(slug, { capacity: 20 });
    const make = (email: string, status: string) =>
      prisma.registration.create({
        data: {
          event_id: eventId,
          email,
          first_name: "Known",
          last_name: "Guest",
          name: "Known Guest",
          status,
          confirm_expires_at: status === "awaiting_email" ? new Date(Date.now() + 3_600_000) : null,
        },
      });
    const waiting = await make(nextEmail("awaiting"), "awaiting_email");
    await prisma.registrationMail.create({ data: { registration_id: waiting.id, event_id: eventId, template_name: "registration-confirm" } });
    const pending = (await make(nextEmail("pending"), "pending")).email;
    const rejected = (await make(nextEmail("rejected"), "rejected")).email;
    const attendee = nextEmail("attendee");
    await prisma.attendee.create({ data: { event_id: eventId, email: attendee, name: "Held Attendee", status: "revoked" } });
    const { pace, sleep } = recordingPace(250);

    const answers = [];
    for (const email of [nextEmail("fresh"), waiting.email, pending, rejected, attendee]) {
      answers.push((await tryOnce(slug, { password: PASSWORD, email }, { pace })).sig);
    }

    expect(answers[0]!.status).toBe(200);
    expect(answers[0]!.body).toBe('{"ok":true}');
    for (const other of answers) expect(other).toEqual(answers[0]);
    // Each of them waited for the floor, whatever the address needed.
    expect(sleep.mock.calls).toEqual(answers.map(() => [250]));
  });

  it("is judged before the fields: with the right password, a field that is refused is refused as it is for the link", async () => {
    const slug = nextSlug("fields");
    const eventId = await addPasswordEvent(slug);

    const { res, sig } = await tryOnce(slug, { password: PASSWORD, email: "not an address", terms: false });

    expect(res.status).toBe(422);
    expect(Object.keys((JSON.parse(sig.body) as { errors: Record<string, string> }).errors).sort()).toEqual(["email", "terms"]);
    expect(await countsOf(eventId)).toEqual({ registrations: 0, mails: 0, attendees: 0 });
  });
});

describe("a password that does not open the event", () => {
  const WRONG_TRIES: ReadonlyArray<readonly [string, unknown]> = [
    ["a wrong password", WRONG],
    ["the right one with a letter more", `${PASSWORD}x`],
    ["the right one in capitals", PASSWORD.toUpperCase()],
    ["the right one with a space at the end", `${PASSWORD} `],
    ["an empty text", ""],
    ["no password at all", undefined],
    ["null", null],
    ["a number", 12_345_678],
    ["a list that holds the right one", [PASSWORD]],
    ["an object that holds the right one", { value: PASSWORD }],
    ["a text one character longer than the longest password", "x".repeat(REGISTRATION_PASSWORD_MAX + 1)],
    ["a text of 60 KB", "x".repeat(60 * 1024)],
  ];

  async function arrange() {
    const slug = nextSlug("denied");
    const eventId = await addPasswordEvent(slug, { capacity: 20 });
    const known = await prisma.registration.create({
      data: { event_id: eventId, email: nextEmail("known"), first_name: "K", last_name: "G", name: "K G", status: "pending" },
    });
    const attendee = nextEmail("attendee");
    await prisma.attendee.create({ data: { event_id: eventId, email: attendee, name: "Held Attendee" } });
    return { slug, eventId, emails: { fresh: nextEmail("fresh"), known: known.email, attendee } };
  }

  it("is one answer, byte for byte, whichever way it is wrong and whether the address is new, known, an attendee's or not an address at all", async () => {
    const { slug, eventId, emails } = await arrange();
    const before = await countsOf(eventId);

    const answers = [];
    for (const [name, wrong] of WRONG_TRIES) {
      for (const email of [...Object.values(emails), "not an address"]) {
        const { sig } = await tryOnce(slug, { password: wrong, email });
        answers.push({ name, email, sig });
      }
    }

    for (const { name, email, sig } of answers) {
      expect(sig.status, `${name} ${email}`).toBe(403);
      expect(sig.body, `${name} ${email}`).toBe(DENIED);
      expect(sig, `${name} ${email}`).toEqual(answers[0]!.sig);
    }
    expect(await countsOf(eventId)).toEqual(before);
    expect(placed.methods).toEqual([]);
  });

  it("is answered after the same floor of time, counted from the end of the challenge check, whichever way it is wrong", async () => {
    const { slug, emails } = await arrange();
    const { pace, sleep } = recordingPace(250);

    for (const [, wrong] of WRONG_TRIES) await tryOnce(slug, { password: wrong, email: emails.fresh }, { pace });

    expect(sleep.mock.calls).toEqual(WRONG_TRIES.map(() => [250]));
  });

  it("is answered after the floor in real time too, for a wrong password and for a missing one", async () => {
    const { slug, emails } = await arrange();
    const real = { floorMs: 150, now: () => performance.now(), sleep: (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)) };

    for (const password of [WRONG, undefined]) {
      const started = performance.now();
      expect((await tryOnce(slug, { password, email: emails.fresh }, { pace: real })).res.status).toBe(403);
      // Only a lower bound: a slow machine takes longer, never shorter.
      expect(performance.now() - started).toBeGreaterThanOrEqual(140);
    }
  });

  it("counts the floor from before the hash is computed, so that the work of the check is inside it, for a wrong password and for a right one", async () => {
    const { slug, emails } = await arrange();
    let now = 1000;
    const sleep = vi.fn(async (_ms: number) => {});
    work.onHash = () => {
      now += 90;
    };
    const pace = { floorMs: 250, now: () => now, sleep };

    expect((await tryOnce(slug, { password: WRONG, email: emails.fresh }, { pace })).res.status).toBe(403);
    expect((await tryOnce(slug, { password: PASSWORD, email: emails.fresh }, { pace })).res.status).toBe(200);

    expect(sleep.mock.calls).toEqual([[160], [160]]);
  });

  it("costs no hash when the try cannot be the password (missing, not a text, longer than a password can be), and one hash when it could", async () => {
    const { slug, emails } = await arrange();

    for (const password of [undefined, null, 12_345_678, [PASSWORD], "x".repeat(REGISTRATION_PASSWORD_MAX + 1), "x".repeat(60 * 1024)]) {
      await tryOnce(slug, { password, email: emails.fresh });
    }
    expect(work.hashes).toBe(0);

    await tryOnce(slug, { password: WRONG, email: emails.fresh });
    await tryOnce(slug, { password: "", email: emails.fresh });
    await tryOnce(slug, { password: PASSWORD, email: emails.fresh });
    expect(work.hashes).toBe(3);
  });

  it("is judged before the fields: a wrong password with a refused field, or without the terms, or with a consent the event does not show, is the same denial", async () => {
    const { slug, eventId, emails } = await arrange();
    const before = await countsOf(eventId);
    const plain = (await tryOnce(slug, { password: WRONG, email: emails.fresh })).sig;

    for (const overrides of [{ email: "not an address" }, { terms: false }, { consents: ["no-such-consent"] }, { first_name: "see https://evil.example" }]) {
      expect((await tryOnce(slug, { password: WRONG, ...overrides })).sig, JSON.stringify(overrides)).toEqual(plain);
    }
    // With the right password the same body is judged as it is for the link.
    expect((await tryOnce(slug, { password: PASSWORD, consents: ["no-such-consent"] })).res.status).toBe(400);
    expect(await countsOf(eventId)).toEqual(before);
  });

  it("is not looked at in a body of a shape the page never sends: that is the one malformed request, before anything about the password", async () => {
    const { slug } = await arrange();

    const { res, sig } = await tryOnce(slug, { password: WRONG, extra: "x" });

    expect(res.status).toBe(400);
    expect(sig.body).toBe('{"error":"invalid_request"}');
    expect(work.hashes).toBe(0);
  });

  it("spends the Turnstile token like any other answer: the page needs a new one to try again", async () => {
    const { slug, emails } = await arrange();
    const h = harness({ prisma });
    const body = h.body(slug, { password: WRONG, email: emails.fresh });

    expect((await h.post(slug, body)).status).toBe(403);
    const again = await h.post(slug, { ...body, password: PASSWORD });

    expect(again.status).toBe(400);
    expect(await again.json()).toEqual({ errors: { challenge: "The security check did not pass. Try again." } });
  });
});

describe("an event whose way in is the link", () => {
  it("ignores a password it is sent: no error, no hash, no budget of the password spent, no line in a log, the same answer", async () => {
    const slug = nextSlug("link-ignores");
    await seeder.addEvent(slug, { settings: { verify_email: true } });
    const store = new SelectiveStore();
    const h = harness({ prisma, store });
    const without = await signature(await h.post(slug, h.body(slug)));
    resetSystemLogBufferForTest();
    for (const spy of spies.values()) spy.mock.calls.length = 0;

    const withPassword = await signature(await h.post(slug, h.body(slug, { password: WRONG })));
    const hugeOne = await signature(await h.post(slug, h.body(slug, { password: "x".repeat(60 * 1024) })));
    const notText = await signature(await h.post(slug, h.body(slug, { password: { a: 1 } })));

    expect(withPassword).toEqual(without);
    expect(hugeOne).toEqual(without);
    expect(notText).toEqual(without);
    expect(work.hashes).toBe(0);
    expect(store.keys.filter((key) => key.startsWith("registration:password"))).toEqual([]);
    expect(placed.methods).toEqual(["link", "link", "link", "link"]);
    expect(querySystemLogs()).toEqual([]);
    expect(written()).not.toContain(WRONG);
  });
});

describe("the tries at the password", () => {
  it("counts every try that reaches the check, the right ones too: the 31st from one client is a 429, the right password or not", async () => {
    const slug = nextSlug("budget-client");
    const eventId = await addPasswordEvent(slug, { capacity: 100 });
    const h = harness({ prisma });

    for (let i = 0; i < 30; i += 1) {
      const password = i % 2 === 0 ? PASSWORD : WRONG;
      expect((await h.post(slug, h.body(slug, { password }))).status, `try ${i + 1}`).toBe(i % 2 === 0 ? 200 : 403);
    }
    const before = await countsOf(eventId);
    const refused = await h.post(slug, h.body(slug, { password: PASSWORD }));

    expect(refused.status).toBe(429);
    expect(await refused.json()).toEqual({ error: "too many requests" });
    expect(await countsOf(eventId)).toEqual(before);
    // Another office has its own tries.
    peer.address = "198.51.100.77";
    expect((await h.post(slug, h.body(slug, { password: PASSWORD }))).status).toBe(200);
  });

  it("answers the 429 of a spent budget exactly as it answers the ceiling of the event", async () => {
    const slug = nextSlug("budget-same");
    const eventId = await addPasswordEvent(slug);
    const ceiling = new SelectiveStore();
    ceiling.deny = (key) => key === `registration:event:${eventId}`;
    const password = new SelectiveStore();
    password.deny = (key) => key.startsWith("registration:password:ip:");
    const event = new SelectiveStore();
    event.deny = (key) => key.startsWith("registration:password-event:");

    const answers = [];
    for (const store of [ceiling, password, event]) {
      const h = harness({ prisma, store });
      answers.push(await signature(await h.post(slug, h.body(slug, { password: PASSWORD }))));
    }

    expect(answers[0]!.status).toBe(429);
    expect(answers[1]).toEqual(answers[0]);
    expect(answers[2]).toEqual(answers[0]);
    expect(await countsOf(eventId)).toEqual({ registrations: 0, mails: 0, attendees: 0 });
  });

  it("is spent only by a request that passed the challenge: a bot without a token cannot use up the tries of an office", async () => {
    const slug = nextSlug("budget-bot");
    await addPasswordEvent(slug);
    const store = new SelectiveStore();
    const h = harness({ prisma, store });

    for (let i = 0; i < 40; i += 1) expect((await h.post(slug, h.body(slug, { password: WRONG, challenge: "refused:x:1" }))).status).toBe(400);
    expect(store.keys.filter((key) => key.startsWith("registration:password"))).toEqual([]);

    expect((await h.post(slug, h.body(slug, { password: PASSWORD }))).status).toBe(200);
  });

  it("is not spent by a request that finds the event closed", async () => {
    const slug = nextSlug("budget-closed");
    await addPasswordEvent(slug, { archived: true });
    const store = new SelectiveStore();
    const h = harness({ prisma, store });

    expect((await h.post(slug, h.body(slug, { password: PASSWORD }))).status).toBe(404);

    expect(store.keys.filter((key) => key.startsWith("registration:password"))).toEqual([]);
  });

  it("asks the budget of the client first and the budget of the event second, with the id of the event and not the slug, after the ceiling of the event", async () => {
    const slug = nextSlug("budget-order");
    const eventId = await addPasswordEvent(slug);
    const store = new SelectiveStore();
    const h = harness({ prisma, store });

    expect((await h.post(slug, h.body(slug, { password: PASSWORD }))).status).toBe(200);

    const keys = store.keys.map((key) => key.split(":").slice(0, 2).join(":"));
    expect(keys.slice(0, 4)).toEqual(["registration:submit", "registration:event", "registration:password", "registration:password-event"]);
    expect(store.keys[3]).toBe(`registration:password-event:${eventId}`);
    expect(store.keys.some((key) => key.includes(slug))).toBe(false);
  });

  it("does not let a client that is out of tries spend the budget of the event, which the others share", async () => {
    const slug = nextSlug("budget-shared");
    await addPasswordEvent(slug);
    const store = new SelectiveStore();
    store.deny = (key) => key.startsWith("registration:password:ip:");
    const h = harness({ prisma, store });

    for (let i = 0; i < 5; i += 1) expect((await h.post(slug, h.body(slug, { password: WRONG }))).status).toBe(429);

    expect(store.keys.filter((key) => key.startsWith("registration:password-event:"))).toEqual([]);
  });

  it("writes one line for the operator when a budget is spent, with the id of the event and which budget, and never the address of the client, a guest or a password", async () => {
    const slug = nextSlug("budget-log");
    const eventId = await addPasswordEvent(slug);
    const store = new SelectiveStore();
    store.deny = (key) => key.startsWith("registration:password:ip:");
    const h = harness({ prisma, store });
    const address = nextEmail("guest-in-the-log");

    for (let i = 0; i < 4; i += 1) await h.post(slug, h.body(slug, { password: WRONG, email: address }));

    const lines = querySystemLogs({ search: "registration_password_tries_refused" });
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatchObject({ level: "warn", source: "security", fields: { event_id: eventId, budget: "client" } });
    const text = written();
    for (const secret of [peer.address, address, WRONG, PASSWORD, hash]) expect(text).not.toContain(secret);
    // The limiter writes no line of its own with the address of the client.
    expect(querySystemLogs({ search: "rate_limit" })).toEqual([]);
  });
});

describe("the budget of the event", () => {
  it("writes its own line when it is spent, which says it is the event's budget and not the client's, and the same nothing of anybody", async () => {
    const slug = nextSlug("budget-event-log");
    const eventId = await addPasswordEvent(slug);
    const store = new SelectiveStore();
    store.deny = (key) => key.startsWith("registration:password-event:");
    const h = harness({ prisma, store });
    const address = nextEmail("guest-in-the-event-log");

    for (let i = 0; i < 3; i += 1) expect((await h.post(slug, h.body(slug, { password: WRONG, email: address }))).status).toBe(429);

    const lines = querySystemLogs({ search: "registration_password_tries_refused" });
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatchObject({ level: "warn", source: "security", fields: { event_id: eventId, budget: "event" } });
    for (const secret of [peer.address, address, WRONG, PASSWORD, hash]) expect(written()).not.toContain(secret);
  });
});

describe("what the password and its hash never reach", () => {
  it("is not in an answer, a header, the console or the system log, for a right password, a wrong one, a refused field, a refused challenge, a spent budget or a failure", async () => {
    const slug = nextSlug("never");
    await addPasswordEvent(slug);
    const secrets = [PASSWORD, WRONG, hash, "$argon2"];
    const answers: string[] = [];
    const remember = async (res: Response) => {
      answers.push(`${res.status} ${[...res.headers.entries()].join(" ")} ${await res.text()}`);
    };
    const h = harness({ prisma });

    await remember(await h.post(slug, h.body(slug, { password: PASSWORD })));
    await remember(await h.post(slug, h.body(slug, { password: WRONG })));
    await remember(await h.post(slug, h.body(slug, { password: PASSWORD, email: "not an address" })));
    await remember(await h.post(slug, h.body(slug, { password: PASSWORD, challenge: "refused:x:1" })));
    await remember(await h.post(slug, h.body(slug, { password: PASSWORD }), { raw: `{"password":"${WRONG}",` }));
    const spent = new SelectiveStore();
    spent.deny = (key) => key.startsWith("registration:password:ip:");
    const limited = harness({ prisma, store: spent });
    await remember(await limited.post(slug, limited.body(slug, { password: PASSWORD })));
    // A failure whose message carries the password, as an exception of a library could.
    const failing = new Proxy(prisma, {
      get(target, key, receiver) {
        if (key === "$transaction") return () => Promise.reject(new Error(`insert failed with password ${PASSWORD} and ${WRONG}`));
        return Reflect.get(target, key, receiver);
      },
    });
    const broken = harness({ prisma: failing });
    const crashed = await broken.post(slug, broken.body(slug, { password: PASSWORD }));
    expect(crashed.status).toBe(500);
    await remember(crashed);

    for (const text of [...answers, written()]) {
      for (const secret of secrets) expect(text).not.toContain(secret);
    }
    expect(answers).toHaveLength(7);
  });
});

describe("the event changes while the request runs", () => {
  const setting = (eventId: string) => (data: Record<string, unknown>) => prisma.eventRegistrationSettings.update({ where: { event_id: eventId }, data });

  it("asks for the password when the event is switched to it between the two looks, and takes it from a guest who has it", async () => {
    const slug = nextSlug("switch-to");
    const eventId = await seeder.addEvent(slug, { settings: { verify_email: true } });
    const switchToPassword = () => setting(eventId)({ access_methods: ["password"], password_hash: hash }).then(() => undefined);
    const unprotected = harness({ prisma, whileChallenged: switchToPassword });

    // The page the guest has is the page of a link: no password in the body.
    const denied = await unprotected.post(slug, unprotected.body(slug));
    expect(denied.status).toBe(403);
    expect(await denied.text()).toBe(DENIED);
    expect(await countsOf(eventId)).toEqual({ registrations: 0, mails: 0, attendees: 0 });

    await setting(eventId)({ access_methods: ["link"], password_hash: null });
    const protectedNow = harness({ prisma, whileChallenged: switchToPassword });
    expect((await protectedNow.post(slug, protectedNow.body(slug, { password: PASSWORD }))).status).toBe(200);
    expect(placed.methods).toEqual(["password"]);
  });

  it("takes the guest in, with no word about the password they sent, when the event is switched away from it between the two looks", async () => {
    const slug = nextSlug("switch-from");
    const eventId = await addPasswordEvent(slug);
    const h = harness({ prisma, whileChallenged: () => setting(eventId)({ access_methods: ["link"] }).then(() => undefined) });

    const res = await h.post(slug, h.body(slug, { password: WRONG }));

    expect(res.status).toBe(200);
    expect(placed.methods).toEqual(["link"]);
    expect(await prisma.registration.count({ where: { event_id: eventId } })).toBe(1);
  });

  it("judges the password the event has after the challenge: the old one is refused and the new one taken, when it is changed meanwhile", async () => {
    const slug = nextSlug("changed");
    const eventId = await addPasswordEvent(slug);
    const newHash = await hashPassword("new-test-password");
    const change = () => setting(eventId)({ password_hash: newHash }).then(() => undefined);

    const old = harness({ prisma, whileChallenged: change });
    expect((await old.post(slug, old.body(slug, { password: PASSWORD }))).status).toBe(403);
    await setting(eventId)({ password_hash: hash });
    const current = harness({ prisma, whileChallenged: change });
    expect((await current.post(slug, current.body(slug, { password: "new-test-password" }))).status).toBe(200);
  });

  it("answers the 404 and stores nothing when the password is switched off meanwhile", async () => {
    const slug = nextSlug("cleared");
    const eventId = await addPasswordEvent(slug);
    const h = harness({ prisma, whileChallenged: () => clearEventPassword(prisma, { eventId, actor: ACTOR }).then(() => undefined) });
    const unknown = await signature(await h.post("reg111-cleared-no-such-event", h.body("reg111-cleared-no-such-event")));

    const res = await h.post(slug, h.body(slug, { password: PASSWORD }));

    expect(await signature(res)).toEqual(unknown);
    expect(await countsOf(eventId)).toEqual({ registrations: 0, mails: 0, attendees: 0 });
  });
});

describe("changing or switching off the password", () => {
  it("leaves the registrations that exist and their mail as they are, and the link in a confirmation mail still works", async () => {
    const slug = nextSlug("untouched");
    const eventId = await addPasswordEvent(slug);
    const first = nextEmail("before-change");
    expect((await tryOnce(slug, { password: PASSWORD, email: first })).res.status).toBe(200);
    const registration = await prisma.registration.findUniqueOrThrow({ where: { event_id_email: { event_id: eventId, email: first } } });
    const snapshot = async () => ({
      registrations: await prisma.registration.findMany({ where: { event_id: eventId }, orderBy: { id: "asc" } }),
      mails: await prisma.registrationMail.findMany({ where: { event_id: eventId }, orderBy: { id: "asc" } }),
    });
    const before = await snapshot();

    expect(await setEventPassword(prisma, { eventId, password: "new-test-password", actor: ACTOR })).toBe("ok");
    expect(await snapshot()).toEqual(before);
    expect(await clearEventPassword(prisma, { eventId, actor: ACTOR })).toBe("ok");
    expect(await snapshot()).toEqual(before);

    // The guest follows the link of the mail that was sent before any of this.
    const link = new URL(buildConfirmUrl(ORIGIN, slug, registration.id)).pathname;
    const h = harness({ prisma });
    expect((await h.get(link)).status).toBe(200);
    const confirmed = await h.app.request(`${ORIGIN}${link}`, { method: "POST", headers: { Origin: ORIGIN } });
    expect(confirmed.status).toBe(200);
    expect(await prisma.registration.findUniqueOrThrow({ where: { id: registration.id } })).toMatchObject({ status: "accepted" });
  });

  it("takes the new password and turns the old one away, and the guests are turned away at the 404 while there is none", async () => {
    const slug = nextSlug("rotate");
    const eventId = await addPasswordEvent(slug);
    await setEventPassword(prisma, { eventId, password: "new-test-password", actor: ACTOR });

    expect((await tryOnce(slug, { password: PASSWORD })).res.status).toBe(403);
    expect((await tryOnce(slug, { password: "new-test-password" })).res.status).toBe(200);
    await clearEventPassword(prisma, { eventId, actor: ACTOR });
    expect((await tryOnce(slug, { password: "new-test-password" })).res.status).toBe(404);
  });
});
