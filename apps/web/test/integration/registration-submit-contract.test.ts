/**
 * The page and the route, together: the page that `GET /r/:slug` serves is booted in a window with its own script, its
 * `fetch` goes to the real app, and the guest fills it in and sends it. What is claimed is the contract of
 * apps/web/src/registration/form-contract.ts as it works in both directions: everything the page sends is accepted,
 * and every answer of the route is one the page knows what to do with.
 */
import { JSDOM } from "jsdom";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { PrismaClient } from "@admitto/db";
import { createTestPrismaClient } from "@admitto/db/testing";
import { ORIGIN, eventSeeder, harness, nextEmail, type FieldSeed } from "../helpers/registration-submit-harness.js";

const ORG = "org-reg95c-contract";

let prisma: PrismaClient;
let seeder: ReturnType<typeof eventSeeder>;
let slugCounter = 0;
const nextSlug = (label: string) => `reg95c-ct-${label}-${(slugCounter += 1)}`;

beforeAll(async () => {
  prisma = createTestPrismaClient();
  seeder = eventSeeder(prisma, ORG);
  await seeder.prepare();
});

afterAll(async () => {
  await seeder?.wipe();
  await prisma?.$disconnect();
});

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Dom = any;

const QUESTIONS: FieldSeed[] = [
  { source_field: "day", label: "Which days will you attend?", type: "select", options: ["Both days", "Day 1 only"], required: true },
  { source_field: "parking", label: "I will arrive by car and need parking", type: "boolean" },
  { source_field: "plate", label: "Car registration number", type: "text", required: true, rules: { show_when: { field: "parking", value: true }, max_length: 12 } },
  { source_field: "notes", label: "Anything else we should know?", type: "long_text" },
  { source_field: "arrival_date", label: "Arrival date", type: "date" },
  { source_field: "arrival_time", label: "Expected arrival", type: "datetime" },
  { source_field: "mobile", label: "Mobile phone", type: "phone" },
];

/**
 * The page of an event in a window, with its real script run and its `fetch` going to the app. The Turnstile widget is
 * not loaded (a test key cannot pass the host check): the callback it would call is called with a token the stand-in for
 * Cloudflare accepts.
 */
async function openPage(h: ReturnType<typeof harness>, slug: string) {
  const html = await (await h.get(`/r/${slug}`)).text();
  const dom = new JSDOM(html, { runScripts: "outside-only", pretendToBeVisual: true, url: `${ORIGIN}/r/${slug}` });
  const win = dom.window as Dom;
  const sent: { status: number; body: unknown }[] = [];
  win.fetch = async (input: string, init: RequestInit & { signal?: unknown }) => {
    const { signal: _signal, ...rest } = init;
    const res = await h.app.request(new URL(String(input), `${ORIGIN}/`).toString(), {
      ...rest,
      headers: { ...(rest.headers as Record<string, string>), Origin: ORIGIN },
    });
    sent.push({ status: res.status, body: JSON.parse(String(rest.body)) });
    return res;
  };
  const reset = vi.fn();
  win.turnstile = { reset };
  const script = win.document.querySelector("script:not([src])").textContent as string;
  win.eval(script);
  const doc = win.document as Dom;
  const box = (key: string): Dom => doc.querySelector(`[data-custom="${key}"]`);
  const control = (key: string): Dom => box(key).querySelector("[data-control]");
  const input = (el: Dom, value: string) => {
    el.value = value;
    el.dispatchEvent(new win.Event("input", { bubbles: true }));
    el.dispatchEvent(new win.Event("change", { bubbles: true }));
  };
  const tick = (el: Dom, checked = true) => {
    el.checked = checked;
    el.dispatchEvent(new win.Event("change", { bubbles: true }));
  };
  const fixed = (email: string) => {
    input(doc.getElementById("f-first_name"), "Ada");
    input(doc.getElementById("f-last_name"), "Example");
    input(doc.getElementById("f-email"), email);
    tick(doc.getElementById("f-terms"));
  };
  const send = (token: string) => {
    win.admittoTurnstileDone(token);
    doc.getElementById("reg-submit").click();
  };
  const until = (assertion: () => void) => vi.waitFor(assertion, { timeout: 4000, interval: 10 });
  const notice = () => (doc.getElementById("reg-error").hidden ? null : (doc.getElementById("reg-error-text").textContent as string));
  const errorOf = (errorKey: string) => doc.querySelector(`[data-field="${errorKey}"] [data-msg-text]`).textContent as string;
  return { win, doc, sent, reset, box, control, input, tick, fixed, send, until, notice, errorOf };
}

describe("the form as the page sends it", () => {
  it("is accepted for every kind of question, and the guest is shown 'Check your inbox' with the address they gave", async () => {
    const slug = nextSlug("full");
    const eventId = await seeder.addEvent(slug, { fields: QUESTIONS, legal: { consents: ["photos"] }, settings: { verify_email: true } });
    const h = harness({ prisma });
    const page = await openPage(h, slug);
    const email = nextEmail("page");

    page.fixed(email);
    page.input(page.control("day"), "Day 1 only");
    page.tick(page.control("parking"));
    page.input(page.control("plate"), "AB 12345");
    page.input(page.control("notes"), "Line one\nLine two");
    page.input(page.control("arrival_date"), "2099-05-13");
    page.input(page.control("arrival_time"), "2099-05-13T18:30");
    page.input(page.control("mobile"), "+48 600 100 200");
    page.tick(page.doc.querySelector("[data-consent=photos]"));
    page.send(h.cf.token(slug));

    await page.until(() => expect(page.doc.getElementById("reg-done").hidden).toBe(false));
    expect(page.doc.getElementById("reg-done-email").textContent).toBe(email);
    expect(page.sent).toHaveLength(1);
    expect(page.sent[0]!.status).toBe(200);
    const row = await prisma.registration.findUniqueOrThrow({ where: { event_id_email: { event_id: eventId, email } } });
    expect(row).toMatchObject({ status: "awaiting_email", first_name: "Ada", last_name: "Example" });
    expect(row.custom_data).toEqual({
      day: "Day 1 only",
      parking: "true",
      plate: "AB 12345",
      notes: "Line one\nLine two",
      arrival_date: "2099-05-13",
      arrival_time: "2099-05-13T18:30",
      mobile: "+48600100200",
    });
    expect(Object.keys(row.consents as object)).toEqual(["photos"]);
    expect(page.reset).toHaveBeenCalled();
  });

  it("leaves out a question that is not asked, and the route stores nothing for it", async () => {
    const slug = nextSlug("hidden");
    const eventId = await seeder.addEvent(slug, { fields: QUESTIONS });
    const h = harness({ prisma });
    const page = await openPage(h, slug);
    const email = nextEmail("hidden");

    page.fixed(email);
    page.input(page.control("day"), "Both days");
    // Typed while the question was asked, then the answer that asks it was taken back.
    page.tick(page.control("parking"));
    page.input(page.control("plate"), "AB 12345");
    page.tick(page.control("parking"), false);
    page.send(h.cf.token(slug));

    await page.until(() => expect(page.doc.getElementById("reg-done").hidden).toBe(false));
    expect(Object.keys((page.sent[0]!.body as { custom_data: object }).custom_data)).toEqual(["day"]);
    expect((await prisma.registration.findUniqueOrThrow({ where: { event_id_email: { event_id: eventId, email } } })).custom_data).toEqual({ day: "Both days" });
  });
});

describe("what the page does with each answer of the route", () => {
  it("puts the sentence of the route under a text question it refused, and the page's own sentence under a phone number", async () => {
    const slug = nextSlug("refused");
    const eventId = await seeder.addEvent(slug, { fields: QUESTIONS });
    const h = harness({ prisma });
    const page = await openPage(h, slug);

    page.fixed(nextEmail("refused"));
    page.input(page.control("day"), "Both days");
    page.tick(page.control("parking"));
    page.input(page.control("plate"), "AB 123456789012345");
    page.input(page.control("mobile"), "call me maybe");
    page.send(h.cf.token(slug));

    await page.until(() => expect(page.sent).toHaveLength(1));
    expect(page.sent[0]!.status).toBe(422);
    await page.until(() => expect(page.notice()).toBe("2 fields need your attention. They are marked in red."));
    // A text question shows what the route said; a phone number shows the sentence the page wrote for it.
    expect(page.errorOf("custom_data.plate")).toBe("Check this answer. It is too long or does not follow the rules shown.");
    expect(page.errorOf("custom_data.mobile")).toBe(page.box("mobile").getAttribute("data-invalid"));
    expect(await prisma.registration.count({ where: { event_id: eventId } })).toBe(0);
    expect(page.reset).toHaveBeenCalled();
  });

  it("puts the sentence of the route under the security check when the token is turned down", async () => {
    const slug = nextSlug("token");
    await seeder.addEvent(slug, { fields: QUESTIONS });
    const h = harness({ prisma });
    const page = await openPage(h, slug);

    page.fixed(nextEmail("token"));
    page.input(page.control("day"), "Both days");
    page.send(h.cf.token(slug, "refused"));

    await page.until(() => expect(page.sent).toHaveLength(1));
    expect(page.sent[0]!.status).toBe(400);
    await page.until(() => expect(page.errorOf("challenge")).toBe("The security check did not pass. Try again."));
  });

  it("says 'Try again in a moment.' when the route says 503, and nothing else", async () => {
    const slug = nextSlug("busy");
    await seeder.addEvent(slug, { fields: QUESTIONS });
    const h = harness({ prisma });
    const page = await openPage(h, slug);

    page.fixed(nextEmail("busy"));
    page.input(page.control("day"), "Both days");
    page.send(h.cf.token(slug, "down"));

    await page.until(() => expect(page.sent[0]?.status).toBe(503));
    await page.until(() => expect(page.notice()).toBe("Try again in a moment."));
  });

  it("says something went wrong for an answer it has no special words for: a form that closed (404) and one that is full (409)", async () => {
    const closed = nextSlug("closing");
    const closedId = await seeder.addEvent(closed, { fields: QUESTIONS });
    const full = nextSlug("full-event");
    const fullId = await seeder.addEvent(full, { capacity: 1, settings: { waitlist_enabled: false, verify_email: false }, fields: QUESTIONS });
    await prisma.attendee.create({ data: { event_id: fullId, email: nextEmail("taker"), name: "Seat Taker" } });
    const h = harness({ prisma });

    const closedPage = await openPage(h, closed);
    await prisma.event.update({ where: { id: closedId }, data: { archived_at: new Date() } });
    closedPage.fixed(nextEmail("closing"));
    closedPage.input(closedPage.control("day"), "Both days");
    closedPage.send(h.cf.token(closed));
    await closedPage.until(() => expect(closedPage.sent[0]?.status).toBe(404));
    await closedPage.until(() => expect(closedPage.notice()).toBe("Something went wrong. Check your details and try again."));

    const fullPage = await openPage(h, full);
    fullPage.fixed(nextEmail("full"));
    fullPage.input(fullPage.control("day"), "Both days");
    fullPage.send(h.cf.token(full));
    await fullPage.until(() => expect(fullPage.sent[0]?.status).toBe(409));
    await fullPage.until(() => expect(fullPage.notice()).toBe("Something went wrong. Check your details and try again."));
  });
});
