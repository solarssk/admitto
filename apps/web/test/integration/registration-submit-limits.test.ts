/**
 * The limits of `POST /r/:slug` (MN-05, SEC-03/04/05, CP-10): the guards in front of the handler as the real route has
 * them, the ceiling of one event, and the two budgets of registration mail, the address's and the event's. A budget
 * withholds the mail and nothing else: the registration is stored and the answer is the answer of any address.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { PrismaClient } from "@admitto/db";
import { createTestPrismaClient } from "@admitto/db/testing";
import { querySystemLogs, resetSystemLogBufferForTest } from "@admitto/shared/system-log";
import { applyRateLimitOverrides } from "../../src/rate-limit/overrides.js";
import { INLINE_RATE_LIMITS, checkRegistrationMailRecipientRateLimit } from "../../src/rate-limit/policies.js";
import { SelectiveStore, eventSeeder, harness, nextEmail, signature } from "../helpers/registration-submit-harness.js";

const ORG = "org-reg95c-limits";

let prisma: PrismaClient;
let seeder: ReturnType<typeof eventSeeder>;
let slugCounter = 0;
const nextSlug = (label: string) => `reg95c-lim-${label}-${(slugCounter += 1)}`;

beforeAll(async () => {
  prisma = createTestPrismaClient();
  seeder = eventSeeder(prisma, ORG);
  await seeder.prepare();
});

afterAll(async () => {
  await seeder?.wipe();
  await prisma?.$disconnect();
});

const mailsOf = (eventId: string, email: string) =>
  prisma.registrationMail.count({ where: { event_id: eventId, registration: { email } } });

describe("the guards in front of the handler, on the real route", () => {
  it("answers a cross-site POST with 403, before the limiter, the body or the database", async () => {
    const slug = nextSlug("csrf");
    await seeder.addEvent(slug);
    const store = new SelectiveStore();
    const h = harness({ prisma, store });

    const res = await h.post(slug, h.body(slug), { headers: { Origin: "https://evil.example" } });
    const noOrigin = await h.app.request(`https://tickets.example.com/r/${slug}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(h.body(slug)),
    });

    expect([res.status, noOrigin.status]).toEqual([403, 403]);
    expect(store.keys).toEqual([]);
    expect(h.cf.mock).not.toHaveBeenCalled();
  });

  it("answers a body over 64 KB with 413 before it reads it, and counts it in the IP limiter", async () => {
    const slug = nextSlug("big");
    await seeder.addEvent(slug);
    const store = new SelectiveStore();
    const h = harness({ prisma, store });

    const res = await h.post(slug, h.body(slug, { first_name: "x".repeat(70 * 1024) }));

    expect(res.status).toBe(413);
    expect(await res.json()).toEqual({ error: "request too large" });
    expect(store.keys).toHaveLength(1);
    expect(store.keys[0]).toMatch(/^registration:submit:ip:/);
    expect(h.cf.mock).not.toHaveBeenCalled();
  });

  it("answers a chunked body over 64 KB, which declares no length, with 413 as well, and writes nothing", async () => {
    const slug = nextSlug("chunked");
    const eventId = await seeder.addEvent(slug);
    const store = new SelectiveStore();
    const h = harness({ prisma, store });
    const bytes = new TextEncoder().encode(JSON.stringify(h.body(slug, { first_name: "x".repeat(70 * 1024) })));
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(bytes.slice(0, 1000));
        controller.enqueue(bytes.slice(1000));
        controller.close();
      },
    });

    const res = await h.app.request(`https://tickets.example.com/r/${slug}`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Origin: "https://tickets.example.com" },
      body: stream,
      duplex: "half",
    } as RequestInit);

    expect(res.status).toBe(413);
    expect(await res.json()).toEqual({ error: "request too large" });
    expect(h.cf.mock).not.toHaveBeenCalled();
    expect(await prisma.registration.count({ where: { event_id: eventId } })).toBe(0);
  });

  it("answers 429 once a client has sent 120 requests in a minute, whatever they were", async () => {
    const slug = nextSlug("ip");
    await seeder.addEvent(slug);
    const h = harness({ prisma });

    for (let i = 0; i < 120; i += 1) expect((await h.post(slug, null, { raw: "{" })).status).toBe(400);
    const res = await h.post(slug, null, { raw: "{" });

    expect(res.status).toBe(429);
    expect(await res.json()).toEqual({ error: "too many requests" });
  });
});

describe("the ceiling of an event", () => {
  it("answers 429 when the event's budget is spent, writes nothing, and keys the budget by the event id and not by the slug", async () => {
    const slug = nextSlug("ceiling");
    const eventId = await seeder.addEvent(slug);
    const store = new SelectiveStore();
    store.deny = (key) => key === `registration:event:${eventId}`;
    const h = harness({ prisma, store });

    const res = await h.post(slug, h.body(slug));

    expect(res.status).toBe(429);
    expect(await res.json()).toEqual({ error: "too many requests" });
    expect(await prisma.registration.count({ where: { event_id: eventId } })).toBe(0);
    expect(store.keys.some((key) => key.includes(slug))).toBe(false);
    // And it is the budget of this event only.
    const otherSlug = nextSlug("ceiling-other");
    await seeder.addEvent(otherSlug);
    expect((await h.post(otherSlug, h.body(otherSlug))).status).toBe(200);
  });

  it("is spent only by a request that passed the challenge: a stranger with no token cannot spend it", async () => {
    const slug = nextSlug("ceiling-stranger");
    const eventId = await seeder.addEvent(slug);
    const store = new SelectiveStore();
    const h = harness({ prisma, store });

    for (let i = 0; i < 5; i += 1) await h.post(slug, h.body(slug, { challenge: "refused:x:1" }));

    expect(store.keys.filter((key) => key === `registration:event:${eventId}`)).toEqual([]);
  });
});

describe("the mail budget of an address", () => {
  it("withholds the mail of the fourth event that would mail one address in a day, and answers exactly as for the first", async () => {
    const slugs = [nextSlug("addr-a"), nextSlug("addr-b"), nextSlug("addr-c"), nextSlug("addr-d")];
    const events = [];
    for (const slug of slugs) events.push(await seeder.addEvent(slug, { settings: { verify_email: true } }));
    const h = harness({ prisma });
    const email = nextEmail("budget");

    const answers = [];
    // The case of the address does not matter: the budget is kept for the lowercased address.
    for (const [i, slug] of slugs.entries()) {
      answers.push(await signature(await h.post(slug, h.body(slug, { email: i % 2 === 0 ? email : email.toUpperCase() }))));
    }

    expect(new Set(answers.map((answer) => JSON.stringify(answer))).size).toBe(1);
    expect(answers[0]!.status).toBe(200);
    expect(await Promise.all(events.map((eventId) => mailsOf(eventId, email)))).toEqual([1, 1, 1, 0]);
    // The registration of the fourth is stored all the same.
    expect(await prisma.registration.count({ where: { event_id: events[3]!, email } })).toBe(1);
  });

  it("keeps the budget of one address apart from another's", async () => {
    const slug = nextSlug("addr-apart");
    const eventId = await seeder.addEvent(slug);
    const h = harness({ prisma });
    const spent = nextEmail("spent");
    for (let i = 0; i < 4; i += 1) {
      const other = nextSlug("addr-apart-event");
      await seeder.addEvent(other);
      await h.post(other, h.body(other, { email: spent }));
    }
    const fresh = nextEmail("fresh");

    expect((await h.post(slug, h.body(slug, { email: fresh }))).status).toBe(200);

    expect(await mailsOf(eventId, fresh)).toBe(1);
  });

  it("never stores the address in the limiter, only a keyed hash", async () => {
    const slug = nextSlug("addr-hash");
    await seeder.addEvent(slug);
    const store = new SelectiveStore();
    const h = harness({ prisma, store });
    const email = nextEmail("hashed");

    await h.post(slug, h.body(slug, { email }));

    const key = store.keys.find((k) => k.startsWith("registration:mail-recipient:"));
    expect(key).toMatch(/^registration:mail-recipient:[0-9a-f]{64}$/);
    // Neither the address nor its domain is in any key. The domain is read from the address, so that no host name is
    // written into a substring check (CodeQL reads that as a URL check).
    const domain = email.slice(email.indexOf("@") + 1);
    expect(domain).not.toBe("");
    expect(store.keys.some((k) => k.includes(email) || k.includes(domain))).toBe(false);
  });

  it("is spent only by a registration that is stored and mailed: not by an address that has a place, a full event, a refused form or a closed one", async () => {
    const open = nextSlug("addr-spend");
    const full = nextSlug("addr-spend-full");
    const closed = nextSlug("addr-spend-closed");
    const openId = await seeder.addEvent(open);
    const fullId = await seeder.addEvent(full, { capacity: 1, settings: { waitlist_enabled: false, verify_email: false } });
    await seeder.addEvent(closed, { archived: true });
    await prisma.attendee.create({ data: { event_id: fullId, email: nextEmail("taker"), name: "Seat Taker" } });
    const store = new SelectiveStore();
    const h = harness({ prisma, store });
    const held = nextEmail("held");
    await prisma.attendee.create({ data: { event_id: openId, email: held, name: "Held Attendee" } });
    const spent = () => store.keys.filter((key) => key.startsWith("registration:mail-recipient:")).length;

    await h.post(open, h.body(open, { email: held }));
    await h.post(full, h.body(full));
    await h.post(closed, h.body(closed));
    await h.post(open, h.body(open, { email: "not an address" }));
    await h.post(open, h.body(open, { challenge: "refused:x:1" }));
    expect(spent()).toBe(0);

    await h.post(open, h.body(open));
    expect(spent()).toBe(1);
  });

  it("is spent once for a registration, however many times the same address is sent", async () => {
    const slug = nextSlug("addr-once");
    await seeder.addEvent(slug);
    const store = new SelectiveStore();
    const h = harness({ prisma, store });
    const email = nextEmail("once");

    for (let i = 0; i < 4; i += 1) await h.post(slug, h.body(slug, { email }));

    expect(store.keys.filter((key) => key.startsWith("registration:mail-recipient:"))).toHaveLength(1);
  });
});

describe("the mail budget of an event", () => {
  /** Retunes the limit the way an operator does, with RATE_LIMIT_OVERRIDES, and puts it back. */
  async function withBase<T>(max: number, run: () => Promise<T>): Promise<T> {
    const inline = INLINE_RATE_LIMITS as unknown as Record<string, { windowMs: number; max: number }>;
    const original = { ...inline["registration:mail-event"]! };
    applyRateLimitOverrides({}, inline, { RATE_LIMIT_OVERRIDES: JSON.stringify({ "registration:mail-event": { max } }) });
    try {
      return await run();
    } finally {
      inline["registration:mail-event"]!.max = original.max;
      inline["registration:mail-event"]!.windowMs = original.windowMs;
    }
  }

  it("starts at 1000 mails in a day, and an operator can retune it with RATE_LIMIT_OVERRIDES", async () => {
    expect(INLINE_RATE_LIMITS["registration:mail-event"]).toEqual({ windowMs: 86_400_000, max: 1000 });
    await withBase(7, async () => {
      expect(INLINE_RATE_LIMITS["registration:mail-event"].max).toBe(7);
    });
    expect(INLINE_RATE_LIMITS["registration:mail-event"].max).toBe(1000);
  });

  it("bounds the confirmations an event sends again by the cap of the event, apart from its rows", async () => {
    await withBase(5, async () => {
      const slug = nextSlug("resends");
      const eventId = await seeder.addEvent(slug, { settings: { verify_email: true } });
      const h = harness({ prisma });
      const guests = [nextEmail("resend"), nextEmail("resend"), nextEmail("resend")];
      for (const email of guests) expect((await h.post(slug, h.body(slug, { email }))).status).toBe(200);
      let requeued = 0;
      // Three registrations use three of the five rows, and each is sent again twice, as the address's budget (3 a day) allows:
      // six resends are asked for, and five are the cap.
      for (let round = 0; round < 2; round += 1) {
        for (const email of guests) {
          const row = await prisma.registration.findUniqueOrThrow({ where: { event_id_email: { event_id: eventId, email } } });
          const aged = new Date(Date.now() - 3_600_000);
          await prisma.registrationMail.updateMany({ where: { registration_id: row.id }, data: { queued_at: aged, status: "sent" } });

          expect((await h.post(slug, h.body(slug, { email }))).status).toBe(200);

          const after = await prisma.registrationMail.findFirstOrThrow({ where: { registration_id: row.id } });
          if (after.queued_at.getTime() !== aged.getTime()) requeued += 1;
        }
      }
      expect(requeued).toBe(5);
    });
  });

  it("withholds the mail of the registrations that come after the budget, stores them, and answers as before", async () => {
    const slug = nextSlug("evt-cap");
    const eventId = await seeder.addEvent(slug, { capacity: null, settings: { verify_email: true } });
    const h = harness({ prisma });
    const guests = Array.from({ length: 4 }, () => nextEmail("capped"));

    const answers = await withBase(2, async () => {
      const out = [];
      for (const email of guests) out.push(await signature(await h.post(slug, h.body(slug, { email }))));
      return out;
    });

    expect(new Set(answers.map((answer) => JSON.stringify(answer))).size).toBe(1);
    expect(await Promise.all(guests.map((email) => mailsOf(eventId, email)))).toEqual([1, 1, 0, 0]);
    expect(await prisma.registration.count({ where: { event_id: eventId } })).toBe(4);
  });

  it("says so in the system log, once an hour for an event, with the id of the event and nothing of a guest", async () => {
    resetSystemLogBufferForTest();
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const slug = nextSlug("evt-log");
    const eventId = await seeder.addEvent(slug, { capacity: null, settings: { verify_email: true } });
    const otherSlug = nextSlug("evt-log-other");
    const otherId = await seeder.addEvent(otherSlug, { capacity: null, settings: { verify_email: true } });
    const h = harness({ prisma });
    const guests = Array.from({ length: 4 }, () => nextEmail("noted"));

    await withBase(1, async () => {
      for (const email of guests) await h.post(slug, h.body(slug, { email }));
      await h.post(otherSlug, h.body(otherSlug));
      await h.post(otherSlug, h.body(otherSlug));
    });

    const lines = querySystemLogs({ search: "registration_mail_withheld" });
    expect(lines.map((line) => line.fields)).toEqual([
      { event_id: eventId, reason: "event_budget" },
      { event_id: otherId, reason: "event_budget" },
    ]);
    expect(lines.every((line) => line.level === "warn" && line.source === "api")).toBe(true);
    const text = JSON.stringify(lines);
    for (const email of guests) expect(text).not.toContain(email);
    vi.restoreAllMocks();
  });

  it("does not say so for an address whose own budget is spent: that is not the operator's to retune", async () => {
    resetSystemLogBufferForTest();
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const slug = nextSlug("addr-log");
    await seeder.addEvent(slug);
    const store = new SelectiveStore();
    const h = harness({ prisma, store });
    const spent = nextEmail("spent-log");
    for (let i = 0; i < 3; i += 1) await checkRegistrationMailRecipientRateLimit(store, spent);

    expect((await h.post(slug, h.body(slug, { email: spent }))).status).toBe(200);

    expect(querySystemLogs({ search: "registration_mail_withheld" })).toEqual([]);
    vi.restoreAllMocks();
  });

  it("allows three mails per seat when that is more than the base, so a big event is not cut short", async () => {
    const slug = nextSlug("evt-seats");
    const eventId = await seeder.addEvent(slug, { capacity: 1, settings: { verify_email: true } });
    const h = harness({ prisma });
    const guests = Array.from({ length: 5 }, () => nextEmail("seats"));

    await withBase(2, async () => {
      for (const email of guests) await h.post(slug, h.body(slug, { email }));
    });

    // max(2, 3 * 1) = 3
    expect(await prisma.registrationMail.count({ where: { event_id: eventId } })).toBe(3);
  });

  it("counts the mails of the last day only", async () => {
    const slug = nextSlug("evt-window");
    const eventId = await seeder.addEvent(slug, { capacity: null, settings: { verify_email: true } });
    const h = harness({ prisma });
    const [first, second] = [nextEmail("old"), nextEmail("new")];

    await withBase(1, async () => {
      await h.post(slug, h.body(slug, { email: first }));
      await prisma.registrationMail.updateMany({ where: { event_id: eventId }, data: { queued_at: new Date(Date.now() - 25 * 3_600_000) } });
      await h.post(slug, h.body(slug, { email: second }));
    });

    expect(await mailsOf(eventId, second)).toBe(1);
  });

  it("does not share the budget between events", async () => {
    const one = nextSlug("evt-one");
    const two = nextSlug("evt-two");
    await seeder.addEvent(one, { capacity: null });
    const twoId = await seeder.addEvent(two, { capacity: null });
    const h = harness({ prisma });
    const guest = nextEmail("second-event");

    await withBase(1, async () => {
      await h.post(one, h.body(one));
      await h.post(two, h.body(two, { email: guest }));
    });

    expect(await mailsOf(twoId, guest)).toBe(1);
  });
});
