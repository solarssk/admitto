/**
 * `GET` and `POST /r/:slug/confirm/:token` against a real database: the link in the confirmation mail of a guest
 * registration (D-C5). What is claimed: opening the link confirms nothing (a mail scanner opens it), only the button does,
 * and a second click, or two at once, is told so without an error and without a second mail; a link older than 24 hours is
 * refused with a way back to the form; a token that is not signed for its registration is the one 404, byte for byte,
 * before anything is read; the pages say where the registration stands and nothing else; the POST is guarded against
 * cross-site requests and limited per IP; a held lock is answered with a page that tries again; and the link does not
 * reach the access log. The service underneath (`confirmRegistrationAddress`) has its own tests in `packages/tickets`.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { PrismaClient } from "@admitto/db";
import { Prisma } from "@admitto/db";
import { createTestPrismaClient } from "@admitto/db/testing";
import { signRegistrationConfirm } from "@admitto/crypto";
import { buildConfirmUrl } from "@admitto/mail-delivery";
import { querySystemLogs, resetSystemLogBufferForTest } from "@admitto/shared/system-log";
import { eraseAttendees } from "@admitto/tickets";
import {
  ORIGIN,
  PAST,
  SelectiveStore,
  eventSeeder,
  harness,
  holdCapacityLock,
  nextEmail,
  recordingPace,
  signature,
  watchedClient,
  type EventSeed,
} from "../helpers/registration-submit-harness.js";
import { documentOf } from "../helpers/registration-form-fixtures.js";

const ORG = "org-reg110-confirm";

let prisma: PrismaClient;
let holderClient: PrismaClient;
let seeder: ReturnType<typeof eventSeeder>;
let slugCounter = 0;
const nextSlug = (label: string) => `reg110-${label}-${(slugCounter += 1)}`;

beforeAll(async () => {
  prisma = createTestPrismaClient();
  holderClient = createTestPrismaClient();
  seeder = eventSeeder(prisma, ORG);
  await seeder.prepare();
});

afterAll(async () => {
  await seeder?.wipe();
  await prisma?.$disconnect();
  await holderClient?.$disconnect();
});

/** A patient app: a guest's write waits for the lock for as long as a test needs. */
const patient = { retryMs: 20_000, permitWaitMs: 20_000 };

/** A registration that waits for its address, as a submission leaves it: with the confirmation mail that was sent. */
async function awaiting(eventId: string, overrides: Partial<Prisma.RegistrationUncheckedCreateInput> = {}) {
  const row = await prisma.registration.create({
    data: {
      event_id: eventId,
      email: nextEmail("waiting"),
      first_name: "Ada",
      last_name: "Example",
      name: "Ada Example",
      status: "awaiting_email",
      confirm_expires_at: new Date(Date.now() + 3_600_000),
      ...overrides,
    },
  });
  await prisma.registrationMail.create({
    data: { registration_id: row.id, event_id: eventId, template_name: "registration-confirm", status: "sent", attempts: 1, sent_at: new Date() },
  });
  return row;
}

/** The path of the link the mail carries (the function of the mail, not a copy of it). */
const linkOf = (slug: string, row: { id: string }) => new URL(buildConfirmUrl(ORIGIN, slug, row.id)).pathname;

/** Everything the registrations of the event are, for "nothing changed". */
const snapshot = async (eventId: string) => ({
  registrations: await prisma.registration.findMany({ where: { event_id: eventId }, orderBy: { id: "asc" } }),
  mails: await prisma.registrationMail.findMany({ where: { event_id: eventId }, orderBy: { id: "asc" } }),
  attendees: await prisma.attendee.count({ where: { event_id: eventId } }),
  logs: await prisma.attendeeActionLog.count({ where: { event_id: eventId } }),
});

type Harness = ReturnType<typeof harness>;
const open = (h: Harness, path: string, headers: Record<string, string> = {}) => h.app.request(`${ORIGIN}${path}`, { headers });
const press = (h: Harness, path: string, init: { headers?: Record<string, string>; body?: string } = {}) =>
  h.app.request(`${ORIGIN}${path}`, {
    method: "POST",
    headers: { Origin: ORIGIN, ...init.headers },
    ...(init.body === undefined ? {} : { body: init.body }),
  });

/** A page as it reads: its heading, its text, its markup. */
async function read(res: Response) {
  const html = await res.text();
  const doc = documentOf(html);
  const text = (selector: string) => doc.querySelector(selector)?.textContent?.replaceAll(/\s+/g, " ").trim() ?? null;
  return { html, doc, heading: text(".reg-center h1"), lead: text(".reg-center > p"), button: text("form button") };
}

async function arrange(seed: EventSeed = {}, label = "confirm") {
  const slug = nextSlug(label);
  const eventId = await seeder.addEvent(slug, seed);
  const row = await awaiting(eventId);
  return { slug, eventId, row, link: linkOf(slug, row) };
}

describe("the link opens a page and confirms nothing", () => {
  it("shows the event and a button, and changes nothing: not the registration, not its mail, nobody is registered", async () => {
    const { eventId, link, row } = await arrange();
    const h = harness({ prisma });
    const before = await snapshot(eventId);

    const res = await open(h, link);
    const page = await read(res);

    expect(res.status).toBe(200);
    expect(page.heading).toBe("Confirm your email address");
    expect(page.button).toBe("Confirm my address");
    expect(page.lead).toContain("Submit Summit");
    expect(await snapshot(eventId)).toEqual(before);
    // The page holds none of the link, and none of the guest.
    for (const secret of [row.id, signRegistrationConfirm(row.id), row.email, "Ada", "Example"]) expect(page.html).not.toContain(secret);
  });

  it("is not changed by a mail scanner that follows the link again and again, with a HEAD or a prefetch", async () => {
    const { eventId, link } = await arrange();
    const h = harness({ prisma });
    const before = await snapshot(eventId);
    const scanners: Array<Record<string, string>> = [
      { "User-Agent": "Mozilla/5.0 (compatible; MicrosoftPreview/2.0)" },
      { "User-Agent": "Mimecast URL Protect", "Sec-Purpose": "prefetch" },
      { Accept: "*/*", Range: "bytes=0-1023" },
      {},
    ];

    for (const headers of scanners) {
      expect((await open(h, link, headers)).status).toBe(200);
      expect((await h.app.request(`${ORIGIN}${link}`, { method: "HEAD", headers })).status).toBe(200);
    }

    expect(await snapshot(eventId)).toEqual(before);
    // Only the button confirms.
    expect((await read(await press(h, link))).heading).toBe("You are registered");
  });

  it("has the headers of a page of the registration form, with no script and no way to send anything but its own form", async () => {
    const { link } = await arrange();
    const h = harness({ prisma });

    const res = await open(h, link);
    const csp = res.headers.get("content-security-policy") ?? "";

    expect(res.headers.get("cache-control")).toBe("private, no-store, max-age=0");
    expect(res.headers.get("x-content-type-options")).toBe("nosniff");
    expect(res.headers.get("referrer-policy")).toBe("same-origin");
    expect(res.headers.get("x-robots-tag")).toBe("noindex, nofollow");
    expect(res.headers.get("content-type")).toContain("text/html");
    expect(csp).toContain("default-src 'none'");
    expect(csp).toContain("form-action 'self'");
    expect(csp).toContain("frame-ancestors 'none'");
    expect(csp).toContain("base-uri 'none'");
    expect(csp).not.toContain("unsafe-inline'; script");
    expect(csp).not.toContain("challenges.cloudflare.com");
    expect(csp).not.toContain("frame-src");
    expect(res.headers.get("set-cookie")).toBeNull();
    expect((await read(res)).doc.querySelectorAll("script")).toHaveLength(0);
  });

  it("says nothing about the registration: the page of a link whose registration is gone has the same bytes", async () => {
    const { slug, eventId, row, link } = await arrange();
    const gone = linkOf(slug, { id: "cm0registration0goneabcdef" });
    const h = harness({ prisma });
    const existing = await (await open(h, link)).text();

    const missing = await (await open(h, gone)).text();

    expect(missing).toBe(existing);
    await prisma.registration.update({ where: { id: row.id }, data: { confirm_expires_at: new Date(Date.now() - 1_000) } });
    expect(await (await open(h, link)).text()).toBe(existing);
    expect(await prisma.registration.count({ where: { event_id: eventId } })).toBe(1);
  });

  it("shows the page of an event that has registration on whatever the form needs: the keys of the bot check and a text may be gone", async () => {
    const { slug, link, eventId } = await arrange({ legal: { terms: false } });
    const h = harness({ prisma });
    await seeder.setSystemKeys(false);
    try {
      // The form itself is the one 404 now; the guest who holds a link is not turned away.
      expect((await open(h, `/r/${slug}`)).status).toBe(404);
      expect((await read(await open(h, link))).heading).toBe("Confirm your email address");
      expect((await read(await press(h, link))).heading).toBe("You are registered");
      expect(await prisma.attendee.count({ where: { event_id: eventId } })).toBe(1);
    } finally {
      await seeder.setSystemKeys(true);
    }
  });
});

describe("a token that is not signed for its registration is the one 404, and reads nothing", () => {
  const MAC = "A".repeat(43);

  it.each([
    ["a wrong signature", (id: string) => `${id}.${MAC}`],
    ["the signature of another registration", (id: string) => `${id}.${signRegistrationConfirm("cm0anotherregistration0abcd")}`],
    ["a signature cut short", (id: string) => `${id}.${signRegistrationConfirm(id).slice(0, -1)}`],
    ["a signature with a character added", (id: string) => `${id}.${signRegistrationConfirm(id)}A`],
    ["a signature in capitals", (id: string) => `${id}.${signRegistrationConfirm(id).toUpperCase()}`],
    ["no dot", (id: string) => `${id}${signRegistrationConfirm(id)}`],
    ["two dots", (id: string) => `${id}.${signRegistrationConfirm(id)}.x`],
    ["no signature", (id: string) => `${id}.`],
    ["no id", (id: string) => `.${signRegistrationConfirm(id)}`],
    ["a signature of another shape", (id: string) => `${id}.%3Cscript%3E`],
    ["an id of another shape", (_id: string) => `x%20y.${MAC}`],
    ["a long token", (id: string) => `${id}.${"A".repeat(5_000)}`],
    ["the id alone", (id: string) => id],
  ])("answers %s with the 404 of an unknown event, for the page and the button, before anything is read", async (_name, make) => {
    const { slug, eventId, row } = await arrange();
    const watched = watchedClient(prisma);
    const h = harness({ prisma: watched.client });
    watched.forget();
    const unknown = await signature(await open(h, "/r/reg110-no-such-event"));
    expect(unknown.status).toBe(404);
    watched.forget();
    const before = await snapshot(eventId);

    const page = await open(h, `/r/${slug}/confirm/${make(row.id)}`);
    const button = await press(h, `/r/${slug}/confirm/${make(row.id)}`);

    expect(await signature(page)).toEqual(unknown);
    expect(await signature(button)).toEqual(unknown);
    expect(watched.touched).toEqual([]);
    expect(await snapshot(eventId)).toEqual(before);
  });

  it("answers a signed link of an unknown event, one with registration off, an archived one and one without settings with the same 404", async () => {
    const h = harness({ prisma });
    const unknown = await signature(await open(h, "/r/reg110-no-such-event"));
    const cases: Array<[string, EventSeed]> = [
      ["off", { settings: { mode: null } }],
      ["archived", { archived: true }],
      ["without settings", { settings: null }],
    ];

    for (const [label, seed] of cases) {
      const slug = nextSlug(label.replaceAll(" ", "-"));
      const eventId = await seeder.addEvent(slug, seed);
      const row = await awaiting(eventId);
      const before = await snapshot(eventId);
      expect(await signature(await open(h, linkOf(slug, row))), label).toEqual(unknown);
      expect(await signature(await press(h, linkOf(slug, row))), label).toEqual(unknown);
      expect(await snapshot(eventId), label).toEqual(before);
    }
    expect(await signature(await open(h, linkOf("reg110-nobody-here", { id: "cm0registration0goneabcdef" })))).toEqual(unknown);
  });

  it("finds nothing for a link of another event's registration, whose signature is good: the button does nothing there, and that registration waits as it did", async () => {
    const first = await arrange({}, "one");
    const second = await arrange({}, "two");
    const h = harness({ prisma });
    const before = await snapshot(second.eventId);

    // The signature is valid (it is made of the registration's id), but the registration is not this event's.
    const res = await press(h, `/r/${first.slug}/confirm/${second.row.id}.${signRegistrationConfirm(second.row.id)}`);

    expect((await read(res)).heading).toBe("This link has expired");
    expect(await snapshot(second.eventId)).toEqual(before);
    expect((await prisma.registration.findUniqueOrThrow({ where: { id: second.row.id } })).status).toBe("awaiting_email");
  });
});

describe("the button", () => {
  async function confirmed(seed: EventSeed, prepare?: (eventId: string) => Promise<void>) {
    const { slug, eventId, row, link } = await arrange(seed);
    await prepare?.(eventId);
    const h = harness({ prisma });
    const res = await press(h, link);
    return { slug, eventId, row, link, h, res, page: await read(res) };
  }
  const reload = (id: string) => prisma.registration.findUniqueOrThrow({ where: { id }, include: { mails: { orderBy: { template_name: "asc" } } } });

  it("registers the guest of an automatic event that has a seat: the ticket is queued, and the page says so", async () => {
    const { eventId, row, res, page } = await confirmed({ capacity: 10 });

    expect(res.status).toBe(200);
    expect(page.heading).toBe("You are registered");
    expect(page.lead).toBe("Thank you. Your address is confirmed. Your ticket is on its way to your inbox.");
    const after = await reload(row.id);
    expect(after).toMatchObject({ status: "accepted", confirm_expires_at: null });
    expect(after.email_verified_at).not.toBeNull();
    expect(after.mails.map((mail) => mail.template_name)).toEqual(["registration-confirm", "ticket"]);
    expect(await prisma.attendee.count({ where: { event_id: eventId } })).toBe(1);
    // Nothing of the guest is on the page.
    for (const secret of [row.email, "Ada", "Example"]) expect(page.html).not.toContain(secret);
  });

  it("holds the guest of an event with approval for the organisers, and queues no 'received' mail: the confirmation took its place", async () => {
    const { row, page, eventId } = await confirmed({ settings: { mode: "approval" } });

    expect(page.heading).toBe("Registration received");
    const after = await reload(row.id);
    expect(after.status).toBe("pending");
    expect(after.mails.map((mail) => mail.template_name)).toEqual(["registration-confirm"]);
    expect(await prisma.attendee.count({ where: { event_id: eventId } })).toBe(0);
  });

  it("puts the guest of a full event on the waiting list, with its mail", async () => {
    const { row, page } = await confirmed({ capacity: 1 }, async (eventId) => {
      await prisma.attendee.create({ data: { event_id: eventId, email: nextEmail("holder"), name: "Holder", status: "registered" } });
    });

    expect(page.heading).toBe("You are on the waiting list");
    const after = await reload(row.id);
    expect(after.status).toBe("waitlist");
    expect(after.mails.map((mail) => mail.template_name)).toEqual(["registration-confirm", "registration-waitlist"]);
  });

  it("tells the guest of a full event without a waiting list so, keeps the registration and its link, and registers them when a place is free", async () => {
    const { eventId, row, link, h, page } = await confirmed({ capacity: 1, settings: { waitlist_enabled: false } }, async (id) => {
      await prisma.attendee.create({ data: { event_id: id, email: nextEmail("holder"), name: "Holder", status: "registered" } });
    });

    expect(page.heading).toBe("This event is full");
    expect(page.button).toBe("Try again");
    expect((await reload(row.id)).status).toBe("awaiting_email");

    await prisma.attendee.updateMany({ where: { event_id: eventId }, data: { status: "cancelled" } });
    expect((await read(await press(h, link))).heading).toBe("You are registered");
  });

  it("answers a second click with 'already confirmed', without an error and without a second mail or a second place", async () => {
    const { eventId, row, link, h } = await confirmed({});
    const before = await snapshot(eventId);

    const second = await press(h, link);
    const third = await press(h, link);
    const [secondPage, thirdPage] = [await read(second), await read(third)];

    expect([second.status, third.status]).toEqual([200, 200]);
    expect(secondPage.heading).toBe("Your address is already confirmed");
    expect(thirdPage.html).toBe(secondPage.html);
    expect(await snapshot(eventId)).toEqual(before);
    expect((await reload(row.id)).mails.map((mail) => mail.template_name)).toEqual(["registration-confirm", "ticket"]);
  });

  it("tells a guest the organisers turned down the same as any guest who confirmed twice: 'already confirmed', and nothing of the decision", async () => {
    const { row, link, h } = await confirmed({ settings: { mode: "approval" } });
    await prisma.registration.update({ where: { id: row.id }, data: { status: "rejected", decided_at: new Date() } });

    const page = await read(await press(h, link));

    expect(page.heading).toBe("Your address is already confirmed");
    for (const word of ["reject", "declin", "turned down", "waiting list"]) expect(page.html.toLowerCase()).not.toContain(word);
  });

  it("refuses a link older than 24 hours with a way back to the form, and changes nothing", async () => {
    const { slug, eventId, row, link } = await arrange();
    await prisma.registration.update({ where: { id: row.id }, data: { confirm_expires_at: new Date(Date.now() - 1_000) } });
    const h = harness({ prisma });
    const before = await snapshot(eventId);

    const res = await press(h, link);
    const page = await read(res);

    expect(res.status).toBe(200);
    expect(page.heading).toBe("This link has expired");
    expect(page.lead).toBe("Confirmation links work for 24 hours. Register again and we will send you a new one.");
    expect(page.doc.querySelector("a.at-btn")?.getAttribute("href")).toBe(`/r/${slug}`);
    expect(await snapshot(eventId)).toEqual(before);
  });

  it("says 'expired' for a registration the clean-up deleted, or staff deleted, as it does for one that ran out: which it is depends on when the clean-up ran", async () => {
    const { eventId, row, link } = await arrange();
    const h = harness({ prisma });
    await prisma.registration.delete({ where: { id: row.id } });

    const page = await read(await press(h, link));

    expect(page.heading).toBe("This link has expired");
    expect(await prisma.registration.count({ where: { event_id: eventId } })).toBe(0);
    expect(await prisma.attendee.count({ where: { event_id: eventId } })).toBe(0);
  });

  it("registers nobody whose personal data was erased: the registration went with the erasure, and the link finds nothing", async () => {
    const { slug, eventId } = await arrange();
    const h = harness({ prisma });
    const person = await prisma.attendee.create({ data: { event_id: eventId, email: nextEmail("erased"), name: "Erased Person", status: "registered" } });
    const mine = await awaiting(eventId, { email: person.email });
    await prisma.$transaction((tx) => eraseAttendees(tx, { eventId, attendeeIds: [person.id] }));

    const page = await read(await press(h, linkOf(slug, mine)));

    expect(page.heading).toBe("This link has expired");
    expect(await prisma.registration.count({ where: { id: mine.id } })).toBe(0);
    expect(await prisma.attendee.count({ where: { event_id: eventId, erased_at: null } })).toBe(0);
  });

  it("tells a guest whose address became an attendee's meanwhile (an import won) and deletes the registration that could never be confirmed", async () => {
    const slug = nextSlug("imported");
    const eventId = await seeder.addEvent(slug);
    const waiting = await awaiting(eventId);
    await prisma.attendee.create({ data: { event_id: eventId, email: waiting.email, name: "Imported", status: "registered" } });
    const h = harness({ prisma });

    const page = await read(await press(h, linkOf(slug, waiting)));

    expect(page.heading).toBe("You are already registered");
    expect(await prisma.registration.count({ where: { event_id: eventId } })).toBe(0);
    expect(await prisma.attendee.count({ where: { event_id: eventId } })).toBe(1);
  });

  it("is the 404 when the event was archived or switched off after the page was shown, and the registration waits as it did", async () => {
    for (const close of [
      (eventId: string) => prisma.event.update({ where: { id: eventId }, data: { archived_at: new Date() } }),
      (eventId: string) => prisma.eventRegistrationSettings.update({ where: { event_id: eventId }, data: { mode: null } }),
    ]) {
      const { eventId, link } = await arrange();
      const h = harness({ prisma });
      expect((await open(h, link)).status).toBe(200);
      await close(eventId);
      const before = await snapshot(eventId);

      const res = await press(h, link);

      expect(await signature(res)).toEqual(await signature(await open(h, "/r/reg110-no-such-event")));
      expect(await snapshot(eventId)).toEqual(before);
    }
  });

  it("shows the closed page, on the page and on the button, once the event is over, and registers nobody", async () => {
    const { eventId, link } = await arrange({ date: PAST });
    const h = harness({ prisma });
    const before = await snapshot(eventId);

    for (const res of [await open(h, link), await press(h, link)]) {
      expect(res.status).toBe(200);
      expect((await read(res)).heading).toBe("Registration is closed");
    }

    expect(await snapshot(eventId)).toEqual(before);
  });

  it("is also the page of a guest who can still confirm after the keys of the bot check were cleared", async () => {
    const { link } = await arrange();
    const h = harness({ prisma });
    await seeder.setSystemKeys(false);
    try {
      expect((await read(await press(h, link))).heading).toBe("You are registered");
    } finally {
      await seeder.setSystemKeys(true);
    }
  });

  it("has the headers of the page on its answer too, and sets no cookie", async () => {
    const { res } = await confirmed({});

    expect(res.headers.get("cache-control")).toBe("private, no-store, max-age=0");
    expect(res.headers.get("x-content-type-options")).toBe("nosniff");
    expect(res.headers.get("referrer-policy")).toBe("same-origin");
    expect(res.headers.get("content-security-policy")).toContain("form-action 'self'");
    expect(res.headers.get("set-cookie")).toBeNull();
  });
});

describe("the same link followed at the same time", () => {
  it("registers the guest once and tells the others 'already confirmed': one place, one ticket, no error", async () => {
    const { eventId, row, link } = await arrange({ capacity: 5 });
    const h = harness({ prisma, placement: patient });

    const answers = await Promise.all(Array.from({ length: 5 }, () => press(h, link)));
    const headings = await Promise.all(answers.map(async (res) => (await read(res)).heading));

    expect(answers.map((res) => res.status)).toEqual([200, 200, 200, 200, 200]);
    expect(headings.filter((heading) => heading === "You are registered")).toHaveLength(1);
    expect(headings.filter((heading) => heading === "Your address is already confirmed")).toHaveLength(4);
    expect(await prisma.attendee.count({ where: { event_id: eventId } })).toBe(1);
    expect((await prisma.registrationMail.findMany({ where: { registration_id: row.id }, orderBy: { template_name: "asc" } })).map((mail) => mail.template_name)).toEqual([
      "registration-confirm",
      "ticket",
    ]);
    expect(await prisma.attendeeActionLog.count({ where: { event_id: eventId, action_type: "registration_accepted" } })).toBe(1);
  });

  it("answers with a page that tries again, and writes nothing, while an import holds the event's lock; the link works once it lets go", async () => {
    const { eventId, link } = await arrange();
    const h = harness({ prisma, placement: { retryMs: 250, pauseMs: [20, 40] } });
    const importing = holdCapacityLock(holderClient, eventId);
    await importing.started;
    const before = await snapshot(eventId);

    const busy = await press(h, link);
    const page = await read(busy);

    expect(busy.status).toBe(503);
    expect(busy.headers.get("retry-after")).toBe("5");
    expect(page.heading).toBe("Please try again in a moment");
    expect(page.button).toBe("Try again");
    expect(await snapshot(eventId)).toEqual(before);
    await importing.release();
    expect((await read(await press(h, link))).heading).toBe("You are registered");
  });
});

describe("the button is guarded like the form's send", () => {
  it("refuses a request from another site with a 403 before it can use up the IP's budget, and confirms nothing", async () => {
    const { eventId, link } = await arrange();
    const store = new SelectiveStore();
    const h = harness({ prisma, store });
    const before = await snapshot(eventId);

    for (const headers of [{ Origin: "https://evil.example" }, { Origin: "null" }, { Referer: "https://evil.example/page" }, { Origin: "" }]) {
      const res = await h.app.request(`${ORIGIN}${link}`, { method: "POST", headers });
      expect(res.status).toBe(403);
    }

    expect(store.keys.filter((key) => key.startsWith("registration:confirm:"))).toEqual([]);
    expect(await snapshot(eventId)).toEqual(before);
  });

  it("takes a request that says it came from this site by its Origin, its Referer or the browser's own metadata, and from no other", async () => {
    const { link } = await arrange({ capacity: 50 });
    const h = harness({ prisma });

    for (const headers of [{ Origin: ORIGIN }, { Referer: `${ORIGIN}/r/anything` }, { "Sec-Fetch-Site": "same-origin" }]) {
      const res = await h.app.request(`${ORIGIN}${link}`, { method: "POST", headers });
      expect(res.status, JSON.stringify(headers)).toBe(200);
    }
    // No header at all, or a different site in the metadata: not this site.
    expect((await h.app.request(`${ORIGIN}${link}`, { method: "POST" })).status).toBe(403);
    expect((await h.app.request(`${ORIGIN}${link}`, { method: "POST", headers: { "Sec-Fetch-Site": "cross-site" } })).status).toBe(403);
  });

  it("limits the page and the button together per IP (120 a minute), with a key that holds neither the slug nor the token", async () => {
    const store = new SelectiveStore();
    const h = harness({ prisma, store });
    const path = `/r/reg110-limits/confirm/${"A".repeat(30)}.${"B".repeat(43)}`;

    let last = 0;
    for (let i = 0; i < 121; i += 1) last = (i % 2 === 0 ? await open(h, path) : await press(h, path)).status;

    expect(last).toBe(429);
    const keys = [...new Set(store.keys.filter((key) => key.startsWith("registration:")))];
    expect(keys).toHaveLength(1);
    expect(keys[0]).toMatch(/^registration:confirm:ip:/);
    expect(keys[0]).not.toContain("reg110");
    // And it is quiet: nothing is added to the system log for a stranger's request.
    expect(querySystemLogs({ source: "security" }).filter((entry) => entry.message === "auth.rate_limit.exceeded")).toEqual([]);
  });

  it("caps the body it never reads at 1 KB", async () => {
    const { eventId, link } = await arrange();
    const h = harness({ prisma });
    const before = await snapshot(eventId);

    const res = await press(h, link, { headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: "x=".padEnd(2_000, "y") });

    expect(res.status).toBe(413);
    expect(await res.json()).toEqual({ error: "request too large" });
    expect(await snapshot(eventId)).toEqual(before);
  });

  it("does not read the body at all: a body that is a lie about the guest changes nothing", async () => {
    const { eventId, row, link } = await arrange();
    const h = harness({ prisma });

    const res = await press(h, link, {
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: `email=${encodeURIComponent("other@example.com")}&status=accepted&first_name=Eve`,
    });

    expect((await read(res)).heading).toBe("You are registered");
    const after = await prisma.registration.findUniqueOrThrow({ where: { id: row.id } });
    expect(after).toMatchObject({ email: row.email, first_name: "Ada", last_name: "Example" });
    expect(await prisma.attendee.count({ where: { event_id: eventId, email: "other@example.com" } })).toBe(0);
  });
});

describe("a failure", () => {
  function failingTransactions(client: PrismaClient, error: Error): PrismaClient {
    return new Proxy(client, {
      get(target, key, receiver) {
        if (key === "$transaction") {
          return () => {
            throw error;
          };
        }
        return Reflect.get(target, key, receiver);
      },
    });
  }

  it("is a plain error page, with nothing of the guest or of the error in the answer, in the log or in the system log", async () => {
    resetSystemLogBufferForTest();
    const errorLog = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const { link, row } = await arrange();
    const h = harness({ prisma: failingTransactions(prisma, new Error(`boom ${row.email} ${link}`)) });

    const res = await press(h, link);
    const body = await res.text();

    expect(res.status).toBe(500);
    for (const leak of [row.email, row.id, "boom"]) expect(body).not.toContain(leak);
    expect(errorLog).toHaveBeenCalledWith("registration confirm failed:", { reason: "Error", code: undefined });
    expect(JSON.stringify(errorLog.mock.calls)).not.toContain(row.email);
    expect(JSON.stringify(errorLog.mock.calls)).not.toContain(row.id);
    expect(querySystemLogs({ source: "api" })).toContainEqual(
      expect.objectContaining({ level: "error", message: "registration_confirm_failed", fields: { route: "/r/:slug/confirm/:token" } }),
    );
    expect(JSON.stringify(querySystemLogs())).not.toContain(row.email);
    errorLog.mockRestore();
  });

  it("is the one 404 when the event is deleted while the request runs (a foreign key refuses)", async () => {
    const { link, eventId } = await arrange();
    const refusal = new Prisma.PrismaClientKnownRequestError("Foreign key constraint failed", { code: "P2003", clientVersion: "test" });
    const h = harness({ prisma: failingTransactions(prisma, refusal) });
    const before = await snapshot(eventId);

    const res = await press(h, link);

    expect(await signature(res)).toEqual(await signature(await open(h, "/r/reg110-no-such-event")));
    expect(await snapshot(eventId)).toEqual(before);
  });
});

describe("the access log", () => {
  it("holds the slug and no part of the link for the page and for the button, and a ref that tells them apart from other links", async () => {
    const lines: string[] = [];
    const info = vi.spyOn(console, "info").mockImplementation((line: string) => {
      lines.push(line);
    });
    const { slug, row, link } = await arrange();
    const h = harness({ prisma, logHttpRequests: true });

    await open(h, link);
    await press(h, link);
    await open(h, linkOf(slug, { id: "cm0registration0goneabcdef" }));
    info.mockRestore();

    const entries = lines.map((line) => JSON.parse(line) as { msg: string; method: string; path: string; ref?: string });
    const requests = entries.filter((entry) => entry.msg === "http_request");
    expect(requests.map((entry) => `${entry.method} ${entry.path}`)).toEqual([
      `GET /r/${slug}/confirm/[redacted]`,
      `POST /r/${slug}/confirm/[redacted]`,
      `GET /r/${slug}/confirm/[redacted]`,
    ]);
    const joined = lines.join("\n");
    for (const secret of [row.id, signRegistrationConfirm(row.id), "cm0registration0goneabcdef"]) expect(joined).not.toContain(secret);
    expect(requests[0]?.ref).toMatch(/^[0-9a-f]{8}$/);
    expect(requests[1]?.ref).toBe(requests[0]?.ref);
    expect(requests[2]?.ref).not.toBe(requests[0]?.ref);
  });
});

describe("from the form to the confirmation", () => {
  it("sends the same link again when the form is sent again, answers it as the first time, and the link then confirms", async () => {
    const slug = nextSlug("e2e");
    const eventId = await seeder.addEvent(slug, { settings: { verify_email: true, mode: "automatic" }, capacity: 10 });
    const { pace, sleep } = recordingPace(250);
    const h = harness({ prisma, pace });
    const email = nextEmail("e2e");

    const first = await h.post(slug, h.body(slug, { email }));
    const registration = await prisma.registration.findUniqueOrThrow({ where: { event_id_email: { event_id: eventId, email } }, include: { mails: true } });
    expect(registration.status).toBe("awaiting_email");
    expect(registration.mails.map((mail) => mail.template_name)).toEqual(["registration-confirm"]);
    const linkBefore = linkOf(slug, registration);
    // The worker sent the mail an hour ago; the guest did not find it and sends the form again, as somebody else might too.
    const anHourAgo = new Date(Date.now() - 3_600_000);
    await prisma.registrationMail.update({
      where: { id: registration.mails[0]!.id },
      data: { status: "sent", attempts: 1, queued_at: anHourAgo, sent_at: anHourAgo },
    });

    const second = await h.post(slug, h.body(slug, { email, first_name: "Somebody", last_name: "Else" }));

    expect(await signature(second)).toEqual(await signature(first));
    expect(sleep.mock.calls).toEqual([[250], [250]]);
    const after = await prisma.registration.findUniqueOrThrow({ where: { id: registration.id }, include: { mails: true } });
    expect(after).toMatchObject({ first_name: "Ada", last_name: "Example", status: "awaiting_email" });
    expect(after.confirm_expires_at).toEqual(registration.confirm_expires_at);
    expect(after.mails).toHaveLength(1);
    expect(after.mails[0]).toMatchObject({ id: registration.mails[0]!.id, status: "queued", attempts: 0, sent_at: null });
    // The mail the worker builds now carries the link the first one did: it is made of the registration's id.
    expect(linkOf(slug, after)).toBe(linkBefore);

    expect((await read(await open(h, linkBefore))).heading).toBe("Confirm your email address");
    expect((await read(await press(h, linkBefore))).heading).toBe("You are registered");
    expect((await prisma.registration.findUniqueOrThrow({ where: { id: registration.id } })).status).toBe("accepted");
  });
});
