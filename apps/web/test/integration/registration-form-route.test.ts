import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { Prisma, PrismaClient } from "@admitto/db";
import { createTestPrismaClient } from "@admitto/db/testing";
import { createApp } from "../../src/app.js";
import { setEnabledAccessMethods } from "../../src/registration/access-methods.js";
import { patchTurnstileSettings, TURNSTILE_SETTINGS_KEY } from "../../src/registration/turnstile-settings.js";
import { ACCESS_METHODS_SETTINGS_KEY } from "../../src/registration/access-methods.js";
import { renderRegistrationNotFound } from "../../src/registration-page-security.js";
import { buildTestApp } from "../helpers/build-test-app.js";
import { documentOf, type Dom } from "../helpers/registration-form-fixtures.js";
import { directive, headersOf } from "../helpers/response-headers.js";

const adminDistRoot = join(dirname(fileURLToPath(import.meta.url)), "../fixtures/admin-dist");

const ORG = "org-reg94b-form";
const SITE_KEY = "1x00000000000000000000AA";
const FUTURE = new Date("2099-05-14T12:00:00Z");
const PAST = new Date("2020-05-14T12:00:00Z");
const PUBLISHED = new Date("2026-10-20T10:00:00Z");

const eventIds: string[] = [];
let counter = 0;
let prisma: PrismaClient;
let app: ReturnType<typeof buildTestApp>;

type LegalRows = { privacy?: boolean; terms?: boolean; consents?: string[]; draftPrivacy?: boolean };

/** An event with the pieces of a form that is open: the link, both required texts and nothing else. */
async function addEvent(
  slug: string,
  options: {
    date?: Date;
    archived?: boolean;
    title?: string;
    settings?: Partial<Prisma.EventRegistrationSettingsUncheckedCreateInput> | null;
    legal?: LegalRows;
    hours?: [string, string];
    location?: { venue_name?: string; formatted_address?: string };
    contact?: { name: string; email: string };
  } = {},
): Promise<string> {
  counter += 1;
  const id = `evt-reg94b-${counter}`;
  eventIds.push(id);
  await prisma.event.create({
    data: {
      id,
      organization_id: ORG,
      title: options.title ?? `Form Summit ${counter}`,
      slug,
      date: options.date ?? FUTURE,
      timezone: "Europe/Warsaw",
      event_hours_start: options.hours?.[0] ?? null,
      event_hours_end: options.hours?.[1] ?? null,
      archived_at: options.archived ? new Date("2026-10-01T00:00:00Z") : null,
    },
  });
  if (options.settings !== null) {
    await prisma.eventRegistrationSettings.create({
      data: { event_id: id, mode: "approval", access_methods: ["link"], consent_keys: [], ...options.settings },
    });
  }
  const legal = { privacy: true, terms: true, consents: [], ...options.legal } satisfies LegalRows;
  const rows: Prisma.LegalDocumentUncheckedCreateInput[] = [];
  if (legal.privacy) rows.push({ event_id: id, kind: "privacy_notice", title: "Privacy notice", content_html: "<p>P</p>", published_at: PUBLISHED });
  if (legal.draftPrivacy) rows.push({ event_id: id, kind: "privacy_notice", title: "Privacy notice", content_html: "<p>P</p>", published_at: null });
  if (legal.terms) rows.push({ event_id: id, kind: "event_terms", title: "Event terms", content_html: "<p>T</p>", published_at: PUBLISHED });
  for (const key of legal.consents ?? []) {
    rows.push({ event_id: id, kind: "consent", key, title: `Consent ${key}`, content_html: "<p>C</p>", published_at: PUBLISHED });
  }
  if (rows.length > 0) await prisma.legalDocument.createMany({ data: rows });
  if (options.location) await prisma.eventLocation.create({ data: { event_id: id, ...options.location } });
  if (options.contact) await prisma.eventContact.create({ data: { event_id: id, ...options.contact } });
  return id;
}

async function addField(eventId: string, data: Partial<Prisma.EventCustomFieldUncheckedCreateInput> & { source_field: string; label: string }) {
  await prisma.eventCustomField.create({ data: { event_id: eventId, type: "text", show_on_form: true, ...data } });
}

async function setSystemKeys(on: boolean) {
  if (on) {
    await patchTurnstileSettings(prisma, { siteKey: SITE_KEY, secretKey: "secret-key-for-tests" });
    await setEnabledAccessMethods(prisma, ["link"]);
  } else {
    await prisma.systemSettings.deleteMany({ where: { key: { in: [TURNSTILE_SETTINGS_KEY, ACCESS_METHODS_SETTINGS_KEY] } } });
  }
}

async function wipe() {
  await prisma.legalDocument.deleteMany({ where: { event_id: { in: eventIds } } });
  await prisma.eventCustomField.deleteMany({ where: { event_id: { in: eventIds } } });
  await prisma.eventContact.deleteMany({ where: { event_id: { in: eventIds } } });
  await prisma.eventLocation.deleteMany({ where: { event_id: { in: eventIds } } });
  await prisma.eventRegistrationSettings.deleteMany({ where: { event_id: { in: eventIds } } });
  await prisma.event.deleteMany({ where: { id: { in: eventIds } } });
  await prisma.organization.deleteMany({ where: { id: ORG } });
}

beforeAll(async () => {
  prisma = createTestPrismaClient();
  await prisma.event.deleteMany({ where: { organization_id: ORG } });
  await prisma.organization.deleteMany({ where: { id: ORG } });
  await prisma.organization.create({ data: { id: ORG, name: "Reg94b Org", slug: "reg94b-org" } });
  await setSystemKeys(true);
  app = buildTestApp({ prisma, checkinToken: "reg94b-form-checkin-token-32-chars", adminDistRoot });
});

afterAll(async () => {
  await wipe();
  await setSystemKeys(false);
  await prisma?.$disconnect();
});

const get = (path: string, init: RequestInit = {}) => app.request(path, init);

/** The page with the response's own nonce replaced, so two responses can be compared. */
async function bodyWithoutNonce(res: Response): Promise<string> {
  const nonce = /script-src 'nonce-([^']+)'/.exec(res.headers.get("content-security-policy") ?? "")?.[1];
  const text = await res.text();
  return nonce ? text.replaceAll(nonce, "NONCE") : text;
}

describe("an open form", () => {
  it("is served for an event with registration on, the link, the Turnstile keys and its texts published", async () => {
    await addEvent("reg94b-open", {
      title: "Northwind Partner Summit 2027",
      hours: ["09:00", "17:00"],
      location: { venue_name: "Expo Centre, Warsaw" },
      contact: { name: "Anna Kowalska", email: "events@northwind.example" },
      settings: { mode: "approval", ask_company: true, ask_department: true, consent_keys: ["photos"] },
      legal: { consents: ["photos"] },
    });
    const res = await get("/r/reg94b-open");
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toMatch(/^text\/html/);
    const doc = documentOf(await res.text());
    expect(doc.querySelector("h1.reg-hero__title").textContent).toBe("Northwind Partner Summit 2027");
    expect([...doc.querySelectorAll(".reg-meta span")].map((el: Dom) => el.textContent?.trim())[0]).toMatch(/^14 May 2099, 09:00 - 17:00/);
    expect([...doc.querySelectorAll(".reg-meta span")].map((el: Dom) => el.textContent?.trim())[1]).toBe("Expo Centre, Warsaw");
    expect(doc.querySelector(".reg-foot-line").textContent).toContain("Anna Kowalska");
    expect(doc.querySelector(".cf-turnstile").getAttribute("data-sitekey")).toBe(SITE_KEY);
    expect(doc.querySelector(".cf-turnstile").getAttribute("data-cdata")).toBe("reg-reg94b-open");
    expect(doc.querySelector("form#reg-form").getAttribute("action")).toBe("/r/reg94b-open");
    expect(doc.querySelector("a[href='/legal/reg94b-open/event-terms']")).not.toBeNull();
    expect(doc.querySelector("a[href='/legal/reg94b-open/privacy-notice']")).not.toBeNull();
    expect(doc.querySelector("input[data-consent=photos]").closest("label").textContent).toContain("Consent photos");
    expect(["company", "department"].every((key) => doc.querySelector(`[data-field=${key}]`) !== null)).toBe(true);
  });

  it("sends the page's own policy, a nonce that is new every time, and sets no cookie", async () => {
    const first = await get("/r/reg94b-open");
    const second = await get("/r/reg94b-open");
    const csp = first.headers.get("content-security-policy")!;
    expect(directive(csp, "default-src")).toBe("default-src 'none'");
    expect(directive(csp, "script-src")).toMatch(/^script-src 'nonce-[A-Za-z0-9+/]{22}==' https:\/\/challenges\.cloudflare\.com$/);
    expect(directive(csp, "frame-src")).toBe("frame-src https://challenges.cloudflare.com");
    expect(directive(csp, "connect-src")).toBe("connect-src 'self'");
    expect(directive(csp, "form-action")).toBe("form-action 'self'");
    expect(directive(csp, "frame-ancestors")).toBe("frame-ancestors 'none'");
    expect(csp).not.toContain("unsafe-eval");
    expect(directive(csp, "script-src")).not.toContain("unsafe-inline");
    expect(first.headers.get("cache-control")).toBe("private, no-store, max-age=0");
    expect(first.headers.get("referrer-policy")).toBe("same-origin");
    expect(first.headers.get("x-robots-tag")).toBe("noindex, nofollow");
    expect(first.headers.get("x-content-type-options")).toBe("nosniff");
    expect(first.headers.getSetCookie()).toEqual([]);

    const nonce = (res: Response) => /'nonce-([^']+)'/.exec(res.headers.get("content-security-policy")!)![1]!;
    const firstNonce = nonce(first);
    const secondNonce = nonce(second);
    expect(secondNonce).not.toBe(firstNonce);
    const doc = documentOf(await first.text());
    expect(doc.querySelectorAll("script")).toHaveLength(2);
    expect(doc.querySelector("script:not([src])").getAttribute("nonce")).toBe(firstNonce);
    expect(documentOf(await second.text()).querySelector("script:not([src])").getAttribute("nonce")).toBe(secondNonce);
  });

  it("is the same page for a stranger and for a signed-in cookie, because it reads no session", async () => {
    const stranger = await get("/r/reg94b-open");
    const withCookie = await get("/r/reg94b-open", { headers: { Cookie: "admitto_session=anything" } });
    expect(await bodyWithoutNonce(withCookie)).toBe(await bodyWithoutNonce(stranger));
    expect(withCookie.headers.getSetCookie()).toEqual([]);
  });

  it("ignores the query string: nothing of it is printed, so nothing reflected", async () => {
    const plain = await bodyWithoutNonce(await get("/r/reg94b-open"));
    const probed = await get("/r/reg94b-open?first_name=<script>alert(1)</script>&email=a@b.example&next=https://evil.example");
    expect(probed.status).toBe(200);
    const html = await bodyWithoutNonce(probed);
    expect(html).toBe(plain);
    expect(html).not.toContain("evil.example");
  });

  it("sends HSTS over HTTPS only", async () => {
    expect((await get("https://tickets.example.com/r/reg94b-open")).headers.get("strict-transport-security")).toBe(
      "max-age=31536000; includeSubDomains",
    );
    expect((await get("/r/reg94b-open")).headers.get("strict-transport-security")).toBeNull();
  });

  it("says what the mode and the address check mean", async () => {
    await addEvent("reg94b-auto", { settings: { mode: "automatic", verify_email: false } });
    const doc = documentOf(await (await get("/r/reg94b-auto")).text());
    expect(doc.querySelector(".at-notice--info .at-notice__body").textContent).toBe("We email your ticket as soon as you send this form.");
    expect(doc.querySelector("#reg-submit-label").textContent).toBe("Register");
    expect(doc.querySelector("[data-field=company]")).toBeNull();
    expect(doc.querySelector("[data-field=department]")).toBeNull();
  });
});

describe("the organiser's questions", () => {
  it("draws the fields that are on the form, in the saved order, and no other", async () => {
    const id = await addEvent("reg94b-fields", { settings: { mode: "approval" } });
    await addField(id, { source_field: "later", label: "Asked last", display_order: 2, type: "text" });
    await addField(id, { source_field: "first", label: "Asked first", display_order: 0, type: "select", options: ["One", "Two"], required: true });
    await addField(id, { source_field: "middle", label: "Asked second", display_order: 1, type: "boolean", description: "A short note." });
    await addField(id, { source_field: "hidden", label: "Not on the form", show_on_form: false, display_order: 3 });
    await addField(id, { source_field: "company", label: "A field called like a fixed one", display_order: 4 });
    await addField(id, { source_field: "unplaced", label: "No order yet", display_order: null });
    const doc = documentOf(await (await get("/r/reg94b-fields")).text());
    const keys = [...doc.querySelectorAll("[data-custom]")].map((el: Dom) => el.getAttribute("data-custom"));
    expect(keys).toEqual(["first", "middle", "later", "unplaced"]);
    expect(doc.querySelector("[data-custom=first] select").hasAttribute("required")).toBe(true);
    expect([...doc.querySelectorAll("[data-custom=first] option")].map((o: Dom) => o.textContent)).toEqual(["Choose one", "One", "Two"]);
    expect(doc.querySelector("[data-custom=middle] small").textContent).toBe("A short note.");
    expect(doc.querySelector("[data-field=company]")).toBeNull();
    expect(doc.body.textContent).not.toContain("Not on the form");
  });

  it("prints every word of the organiser's as text, never as markup", async () => {
    const payload = '<img src=x onerror=alert(1)>"\'</style></script><svg onload=alert(1)>';
    const id = await addEvent("reg94b-xss", {
      title: payload,
      settings: { mode: "approval", consent_keys: ["x-consent"] },
      location: { venue_name: payload },
      contact: { name: payload, email: payload },
      legal: { consents: ["x-consent"] },
    });
    await prisma.legalDocument.update({ where: { event_id_kind_key: { event_id: id, kind: "consent", key: "x-consent" } }, data: { title: payload } });
    await addField(id, { source_field: "q_select", label: payload, description: payload, type: "select", options: [payload, `${payload}2`], required: true, display_order: 0 });
    await addField(id, { source_field: "q_flag", label: payload, description: payload, type: "boolean", display_order: 1 });
    const res = await get("/r/reg94b-xss");
    const html = await res.text();
    const doc = documentOf(html);
    expect(res.status).toBe(200);
    expect(doc.querySelectorAll("script")).toHaveLength(2);
    expect(doc.querySelectorAll("[onerror], [onload], [onfocus], [onclick]")).toHaveLength(0);
    expect(html.split("<style").length - 1).toBe(1);
    expect(html.split("</style").length - 1).toBe(1);
    expect(html.split("</script").length - 1).toBe(2);
    expect(html).not.toContain("<img src=x onerror");
    expect(html).not.toContain("<svg onload");
    expect(doc.querySelector("h1.reg-hero__title").textContent).toBe(payload);
    expect(doc.querySelector("title").textContent).toBe(`Registration - ${payload}`);
    expect([...doc.querySelectorAll("[data-custom=q_select] option")].map((o: Dom) => o.textContent)).toEqual(["Choose one", payload, `${payload}2`]);
    expect(doc.querySelector("[data-custom=q_flag] .reg-opt__text").textContent).toBe(`${payload}${payload}`);
  });

  it("does not draw a question of a kind it cannot draw, and refuses the form when that question is required", async () => {
    const optional = await addEvent("reg94b-unknown-optional", { settings: { mode: "approval" } });
    await addField(optional, { source_field: "later", label: "A kind not built yet", type: "long_text" });
    await addField(optional, { source_field: "plain", label: "A plain question" });
    const doc = documentOf(await (await get("/r/reg94b-unknown-optional")).text());
    expect([...doc.querySelectorAll("[data-custom]")].map((el: Dom) => el.getAttribute("data-custom"))).toEqual(["plain"]);

    const required = await addEvent("reg94b-unknown-required", { settings: { mode: "approval" } });
    await addField(required, { source_field: "later", label: "A kind not built yet", type: "long_text", required: true });
    const res = await get("/r/reg94b-unknown-required");
    expect(res.status).toBe(404);
    expect(await res.text()).toBe(renderRegistrationNotFound(false).html);
  });

  it("refuses an event whose slug is not in the shape the create-event form allows, however ready it is", async () => {
    await addEvent("Reg94b-Upper", { settings: { mode: "approval" } });
    await addEvent("reg94b.dotted", { settings: { mode: "approval" } });
    await addEvent("reg94b_under-score-9", { settings: { mode: "approval" } });
    expect((await get("/r/Reg94b-Upper")).status).toBe(404);
    expect((await get("/r/reg94b.dotted")).status).toBe(404);
    const ok = await get("/r/reg94b_under-score-9");
    expect(ok.status).toBe(200);
    expect(documentOf(await ok.text()).querySelector(".cf-turnstile").getAttribute("data-cdata")).toBe("reg-reg94b_under-score-9");
  });

  it("refuses a form with a required choice that has no choices, which nobody could answer", async () => {
    const id = await addEvent("reg94b-empty-select", { settings: { mode: "approval" } });
    await addField(id, { source_field: "pick", label: "Pick", type: "select", required: true, options: [] });
    expect((await get("/r/reg94b-empty-select")).status).toBe(404);
  });
});

describe("an event that is over", () => {
  it("says registration is closed, with no form, no script and no widget", async () => {
    await addEvent("reg94b-over", {
      date: PAST,
      title: "Past Summit",
      settings: { mode: "approval" },
      contact: { name: "Anna", email: "events@past.example" },
    });
    const res = await get("/r/reg94b-over");
    const html = await res.text();
    expect(res.status).toBe(200);
    expect(html).toContain("Registration is closed");
    expect(html).toContain("Registration for Past Summit has ended.");
    expect(html).toContain("events@past.example");
    expect(html).not.toContain("<script");
    expect(html).not.toContain("<form");
    expect(res.headers.get("content-security-policy")).not.toContain("cloudflare");
    expect(res.headers.get("cache-control")).toBe("private, no-store, max-age=0");
    expect(res.headers.getSetCookie()).toEqual([]);
  });

  it("is closed, not open, from the end time of the day, and still closed without the Turnstile keys", async () => {
    await setSystemKeys(false);
    try {
      expect(await (await get("/r/reg94b-over")).text()).toContain("Registration is closed");
    } finally {
      await setSystemKeys(true);
    }
  });

  it("does not show the closed page for an event that had no registration, or an archived one", async () => {
    await addEvent("reg94b-over-off", { date: PAST, settings: { mode: null } });
    await addEvent("reg94b-over-none", { date: PAST, settings: null });
    await addEvent("reg94b-over-archived", { date: PAST, archived: true, settings: { mode: "approval" } });
    for (const slug of ["reg94b-over-off", "reg94b-over-none", "reg94b-over-archived"]) {
      const res = await get(`/r/${slug}`);
      expect(res.status, slug).toBe(404);
    }
  });
});

describe("the one 404", () => {
  const notFound = renderRegistrationNotFound(false);
  const unreachable: Array<[string, string]> = [];

  beforeAll(async () => {
    await addEvent("reg94b-n-no-settings", { settings: null });
    await addEvent("reg94b-n-off", { settings: { mode: null } });
    await addEvent("reg94b-n-archived", { archived: true });
    await addEvent("reg94b-n-password", { settings: { access_methods: ["password"] } });
    await addEvent("reg94b-n-sso", { settings: { access_methods: ["sso"] } });
    await addEvent("reg94b-n-no-method", { settings: { access_methods: [] } });
    await addEvent("reg94b-n-two-methods", { settings: { access_methods: ["link", "password"] } });
    await addEvent("reg94b-n-no-privacy", { legal: { privacy: false } });
    await addEvent("reg94b-n-draft-privacy", { legal: { privacy: false, draftPrivacy: true } });
    await addEvent("reg94b-n-no-terms", { legal: { terms: false } });
    await addEvent("reg94b-n-no-consent", { settings: { consent_keys: ["missing"] } });
    unreachable.push(
      ["an unknown slug", "/r/reg94b-no-such-event"],
      ["a slug in capitals", "/r/REG94B-OPEN"],
      ["a slug with a character that is not allowed", "/r/reg94b.open"],
      ["a slug that is too long", `/r/${"a".repeat(200)}`],
      ["an event with no registration settings", "/r/reg94b-n-no-settings"],
      ["an event with registration off", "/r/reg94b-n-off"],
      ["an archived event", "/r/reg94b-n-archived"],
      ["an event that wants a password", "/r/reg94b-n-password"],
      ["an event that wants a company sign-in", "/r/reg94b-n-sso"],
      ["an event with no method chosen", "/r/reg94b-n-no-method"],
      ["an event with two methods", "/r/reg94b-n-two-methods"],
      ["an event without a privacy notice", "/r/reg94b-n-no-privacy"],
      ["an event whose privacy notice is a draft", "/r/reg94b-n-draft-privacy"],
      ["an event without terms", "/r/reg94b-n-no-terms"],
      ["an event whose extra consent is not written", "/r/reg94b-n-no-consent"],
      ["a path with a trailing slash", "/r/reg94b-open/"],
      ["a path that is too deep", "/r/reg94b-open/extra"],
    );
  });

  it("is the same status, headers and bytes whatever the reason, as in the ticket page's 404", async () => {
    expect(unreachable.length).toBeGreaterThan(15);
    for (const [reason, path] of unreachable) {
      const res = await get(path);
      expect(res.status, reason).toBe(404);
      expect(await res.text(), reason).toBe(notFound.html);
      for (const [name, value] of Object.entries(notFound.headers)) expect(res.headers.get(name), `${reason} ${name}`).toBe(value);
      expect(res.headers.getSetCookie(), reason).toEqual([]);
    }
  });

  it("is identical for all of them, so nothing tells an unknown slug from an event that is not ready", async () => {
    const answers = await Promise.all(
      unreachable.map(async ([, path]) => {
        const res = await get(path);
        return { status: res.status, headers: headersOf(res), body: await res.text() };
      }),
    );
    for (const answer of answers) expect(answer).toEqual(answers[0]);
  });

  it("is also the answer when the event is open but the Turnstile keys are gone, or the method is switched off", async () => {
    try {
      await setSystemKeys(false);
      expect(await (await get("/r/reg94b-open")).text()).toBe(notFound.html);
      await patchTurnstileSettings(prisma, { siteKey: SITE_KEY, secretKey: "secret-key-for-tests" });
      expect(await (await get("/r/reg94b-open")).text()).toBe(notFound.html);
      await setEnabledAccessMethods(prisma, ["password", "sso"]);
      expect(await (await get("/r/reg94b-open")).text()).toBe(notFound.html);
    } finally {
      await setSystemKeys(true);
    }
    expect((await get("/r/reg94b-open")).status).toBe(200);
  });

  it("is also the answer when one half of the keys is missing", async () => {
    try {
      await prisma.systemSettings.update({ where: { key: TURNSTILE_SETTINGS_KEY }, data: { value_json: JSON.stringify({ siteKey: SITE_KEY, secretEnc: null }) } });
      expect(await (await get("/r/reg94b-open")).text()).toBe(notFound.html);
    } finally {
      await setSystemKeys(true);
    }
  });

  it("comes back the moment the event is archived, and goes away again when it is restored", async () => {
    const id = await addEvent("reg94b-archive-toggle", { settings: { mode: "automatic" } });
    expect((await get("/r/reg94b-archive-toggle")).status).toBe(200);
    await prisma.event.update({ where: { id }, data: { archived_at: new Date() } });
    expect(await (await get("/r/reg94b-archive-toggle")).text()).toBe(notFound.html);
    await prisma.event.update({ where: { id }, data: { archived_at: null } });
    expect((await get("/r/reg94b-archive-toggle")).status).toBe(200);
  });

  it("follows a text being withdrawn: the form closes instead of staying open", async () => {
    const id = await addEvent("reg94b-withdraw", { settings: { mode: "approval" } });
    expect((await get("/r/reg94b-withdraw")).status).toBe(200);
    await prisma.legalDocument.update({ where: { event_id_kind_key: { event_id: id, kind: "event_terms", key: "" } }, data: { published_at: null } });
    expect(await (await get("/r/reg94b-withdraw")).text()).toBe(notFound.html);
  });
});

describe("limits and failures", () => {
  it("limits the page to 300 a minute for one address, and says so without a cookie", async () => {
    const limited = buildTestApp({ prisma, checkinToken: "reg94b-form-limited-token-32-chars", adminDistRoot });
    for (let i = 0; i < 300; i += 1) {
      expect((await limited.request("/r/reg94b-no-such-event")).status).toBe(404);
    }
    const blocked = await limited.request("/r/reg94b-open");
    expect(blocked.status).toBe(429);
    expect(await blocked.json()).toEqual({ error: "too many requests" });
    expect(blocked.headers.getSetCookie()).toEqual([]);
  });

  it("answers a database failure with the standard error page, naming nothing", async () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const failing = new Proxy(prisma, {
      get(target, property, receiver) {
        if (property === "event") return { findUnique: () => Promise.reject(new Error("connection refused: secret-host.internal")) };
        return Reflect.get(target, property, receiver) as unknown;
      },
    });
    const brokenApp = createApp({
      prisma: failing,
      checkinToken: "reg94b-form-broken-token-32-chars!",
      allowCheckinBearer: true,
      baseUrl: "https://tickets.example.com",
      skipCheckinBootValidation: true,
      adminDistRoot,
    });
    const res = await brokenApp.request("/r/reg94b-open");
    const text = await res.text();
    expect(res.status).toBe(500);
    expect(text).not.toContain("secret-host");
    expect(text).not.toContain("connection refused");
    expect(JSON.stringify(consoleError.mock.calls)).not.toContain("secret-host");
    expect(res.headers.getSetCookie()).toEqual([]);
    consoleError.mockRestore();
  });
});
