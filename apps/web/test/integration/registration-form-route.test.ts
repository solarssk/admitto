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
    await addField(optional, { source_field: "later", label: "A kind not built yet", type: "multi_select" });
    await addField(optional, { source_field: "plain", label: "A plain question" });
    const doc = documentOf(await (await get("/r/reg94b-unknown-optional")).text());
    expect([...doc.querySelectorAll("[data-custom]")].map((el: Dom) => el.getAttribute("data-custom"))).toEqual(["plain"]);

    const required = await addEvent("reg94b-unknown-required", { settings: { mode: "approval" } });
    await addField(required, { source_field: "later", label: "A kind not built yet", type: "multi_select", required: true });
    const res = await get("/r/reg94b-unknown-required");
    expect(res.status).toBe(404);
    expect(await res.text()).toBe(renderRegistrationNotFound(false).html);
  });

  it("opens a form whose required questions are a long text, a date, a date and time and a phone number, and draws them in the saved order", async () => {
    const id = await addEvent("reg113c-kinds", { settings: { mode: "approval" } });
    await addField(id, { source_field: "extension", label: "Desk extension", type: "phone", required: true, display_order: 3, rules: { digits_only: true, min_length: 3, max_length: 6, example: "1234" } });
    await addField(id, { source_field: "why", label: "Why do you attend?", type: "long_text", required: true, display_order: 0, description: "A few lines.", rules: { min_length: 20, max_length: 500 } });
    await addField(id, { source_field: "flight", label: "Departure flight", type: "datetime", required: true, display_order: 2 });
    await addField(id, { source_field: "checkin", label: "Check-in date", type: "date", required: true, display_order: 1 });
    const res = await get("/r/reg113c-kinds");
    expect(res.status).toBe(200);
    const doc = documentOf(await res.text());
    expect([...doc.querySelectorAll("[data-custom]")].map((el: Dom) => el.getAttribute("data-custom"))).toEqual(["why", "checkin", "flight", "extension"]);
    const control = (key: string) => doc.querySelector(`[data-custom=${key}] [data-control]`);
    expect(control("why").tagName).toBe("TEXTAREA");
    expect(control("checkin").getAttribute("type")).toBe("date");
    expect(control("flight").getAttribute("type")).toBe("datetime-local");
    expect(control("extension").getAttribute("type")).toBe("tel");
    expect(control("extension").getAttribute("inputmode")).toBe("numeric");
    for (const key of ["why", "checkin", "flight", "extension"]) expect(control(key).hasAttribute("required"), key).toBe(true);
    const hint = (key: string) => doc.querySelector(`[data-custom=${key}] .reg-slot__hint`)?.textContent;
    expect(hint("why")).toBe("A few lines.\n20 to 500 characters.");
    expect(hint("flight")).toBe("Time in the event's time zone (Europe/Warsaw).");
    expect(hint("checkin")).toBeUndefined();
    expect(hint("extension")).toBe("3 to 6 digits. For example: 1234");
    expect(doc.querySelector("[data-custom=extension]").getAttribute("data-invalid")).toBe("Enter a valid phone number. Use 3 to 6 digits.");
  });

  it("shows no rule a type does not take, and none that cannot be read, and still draws the question", async () => {
    const id = await addEvent("reg113c-rules", { settings: { mode: "approval" } });
    await addField(id, { source_field: "day", label: "A date", type: "date", display_order: 0, rules: { digits_only: true, example: "never shown" } });
    await addField(id, { source_field: "broken", label: "A phone", type: "phone", display_order: 1, rules: { nothing_like_a_rule: 5 } });
    await addField(id, { source_field: "none", label: "A long text", type: "long_text", display_order: 2 });
    const doc = documentOf(await (await get("/r/reg113c-rules")).text());
    expect([...doc.querySelectorAll("[data-custom]")].map((el: Dom) => el.getAttribute("data-custom"))).toEqual(["day", "broken", "none"]);
    expect(doc.body.textContent).not.toContain("never shown");
    expect(doc.querySelectorAll("[data-custom] .reg-slot__hint")).toHaveLength(0);
    expect(doc.querySelectorAll("[data-custom] [inputmode]")).toHaveLength(0);
  });

  it("prints the organiser's note and example as text, never as markup", async () => {
    const payload = '<img src=x onerror=alert(1)>"\'</style></script>';
    const id = await addEvent("reg113c-xss", { settings: { mode: "approval" } });
    await addField(id, { source_field: "mobile", label: payload, type: "phone", display_order: 0, description: payload, rules: { example: payload } });
    await addField(id, { source_field: "when", label: payload, type: "datetime", display_order: 1 });
    const res = await get("/r/reg113c-xss");
    const html = await res.text();
    const doc = documentOf(html);
    expect(res.status).toBe(200);
    expect(doc.querySelectorAll("script")).toHaveLength(2);
    expect(doc.querySelectorAll("[onerror], [onload]")).toHaveLength(0);
    expect(html).not.toContain("<img src=x onerror");
    expect(doc.querySelector("[data-custom=mobile] .reg-slot__hint").textContent).toBe(`${payload}\nFor example: ${payload}`);
    expect(doc.querySelector("[data-custom=when] .reg-slot__hint").textContent).toBe("Time in the event's time zone (Europe/Warsaw).");
    expect(doc.querySelector("[data-custom=when] .at-label").textContent).toBe(payload);
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

describe("questions with an icon, a condition and suggestions", { timeout: 30_000 }, () => {
  /** An event whose questions are the mockup's: a row with an icon and a field that waits for it, twice. */
  async function addPanelEvent(slug: string) {
    const id = await addEvent(slug, { settings: { mode: "approval" } });
    await addField(id, { source_field: "parking", label: "I will arrive by car", type: "boolean", display_order: 0, rules: { icon: "parking" } });
    await addField(id, {
      source_field: "plate",
      label: "Car registration number",
      type: "text",
      display_order: 1,
      rules: { icon: "car", max_length: 9, example: "WA 12345", show_when: { field: "parking", value: true } },
    });
    await addField(id, { source_field: "diet", label: "Dietary requirements", type: "boolean", display_order: 2, rules: { icon: "food" } });
    await addField(id, {
      source_field: "diet_details",
      label: "What should we know?",
      type: "text",
      display_order: 3,
      required: true,
      rules: { icon: "food", suggestions: ["No pork", "Vegetarian", "Vegan"], show_when: { field: "diet", value: true } },
    });
    await addField(id, { source_field: "notes", label: "Anything else?", type: "long_text", display_order: 4 });
    return id;
  }

  it("draws the icon of a row, the panel that follows it and the list of suggestions, from the rules the organiser saved", async () => {
    await addPanelEvent("reg113f-panels");
    const res = await get("/r/reg113f-panels");
    expect(res.status).toBe(200);
    const doc = documentOf(await res.text());
    const href = (selector: string) => doc.querySelector(`${selector} use`)?.getAttribute("href");
    expect(href("[data-custom=parking] svg.ic")).toBe("#i-parking");
    expect(href("[data-custom=plate] .at-inputgroup__icon")).toBe("#i-car");
    const rows = doc.querySelector(".reg-opts");
    expect([...rows.children].map((el: Dom) => el.getAttribute("data-custom") ?? el.id)).toEqual(["parking", "f-q0-reveal", "diet", "f-q2-reveal"]);
    const plate = doc.querySelector("[data-custom=plate]");
    expect([plate.hasAttribute("hidden"), plate.getAttribute("data-show-when-field"), plate.getAttribute("data-show-when-value")]).toEqual([true, "parking", "true"]);
    expect(plate.querySelector("[data-control]").hasAttribute("disabled")).toBe(true);
    expect(doc.querySelector("[data-custom=plate] .reg-slot__hint").textContent).toBe("Up to 9 characters. For example: WA 12345");
    const details = doc.querySelector("[data-custom=diet_details]");
    expect(details.hasAttribute("data-required")).toBe(true);
    expect(details.querySelector("[data-control]").hasAttribute("required")).toBe(false);
    expect([...details.querySelectorAll("[role=option][data-value]")].map((el: Dom) => el.getAttribute("data-value"))).toEqual(["No pork", "Vegetarian", "Vegan"]);
    expect(details.querySelector("[data-control]").getAttribute("role")).toBe("combobox");
  });

  it("sends the same headers as any other open form: nothing the panels need changes the policy, the cache rule or the cookies", async () => {
    await addPanelEvent("reg113f-headers");
    await addEvent("reg113f-plain", { settings: { mode: "approval" } });
    const [panels, plain] = [await get("/r/reg113f-headers"), await get("/r/reg113f-plain")];
    expect([panels.status, plain.status]).toEqual([200, 200]);
    const comparable = (res: Response) => {
      const headers = headersOf(res);
      return {
        policy: headers["content-security-policy"]?.replace(/'nonce-[^']+'/, "'nonce-N'"),
        rest: Object.fromEntries(Object.entries(headers).filter(([name]) => name !== "content-security-policy" && name !== "content-length")),
      };
    };
    expect(comparable(panels)).toEqual(comparable(plain));
    expect(directive(panels.headers.get("content-security-policy") ?? "", "style-src")).toBe("style-src 'unsafe-inline'");
    expect(panels.headers.getSetCookie()).toEqual([]);
    const doc = documentOf(await panels.text());
    expect(doc.querySelectorAll("script:not([src])[nonce]")).toHaveLength(1);
    expect(doc.querySelectorAll("script:not([nonce])")).toHaveLength(1);
  });

  it("is the same page whatever the query string says, so that nothing of it can change what the panels show", async () => {
    await addPanelEvent("reg113f-query");
    const [one, two] = await Promise.all([get("/r/reg113f-query"), get("/r/reg113f-query?parking=true&diet=1&q=%3Cb%3E")]);
    expect(await bodyWithoutNonce(two)).toBe(await bodyWithoutNonce(one));
  });

  it("asks a question always, with no icon and no condition, when its rules cannot be read, and it keeps its Required", async () => {
    const id = await addEvent("reg113f-unreadable", { settings: { mode: "approval" } });
    await addField(id, { source_field: "parking", label: "Parking", type: "boolean", display_order: 0 });
    await addField(id, {
      source_field: "plate",
      label: "Plate",
      type: "text",
      required: true,
      display_order: 1,
      rules: { icon: "not-an-icon", show_when: { field: "parking", value: true }, suggestions: ["A"] },
    });
    await addField(id, {
      source_field: "other",
      label: "Other",
      type: "text",
      display_order: 2,
      rules: { show_when: { field: "parking", value: true }, extra_key: 1 },
    });
    const doc = documentOf(await (await get("/r/reg113f-unreadable")).text());
    expect([...doc.querySelectorAll("[data-custom]")].map((el: Dom) => el.getAttribute("data-custom"))).toEqual(["parking", "plate", "other"]);
    expect(doc.querySelectorAll("[data-show-when-field], [data-reveal], [data-combo]")).toHaveLength(0);
    const plate = doc.querySelector("[data-custom=plate]");
    expect(plate.hasAttribute("hidden")).toBe(false);
    expect(plate.querySelector("[data-control]").hasAttribute("required")).toBe(true);
    expect(plate.querySelector(".at-inputgroup__icon")).toBeNull();
    expect(plate.querySelector("[data-control]").getAttribute("role")).toBeNull();
  });

  it("does not draw a question whose controlling question is not on the form, and stays open though it is required", async () => {
    const id = await addEvent("reg113f-orphan", { settings: { mode: "approval" } });
    await addField(id, { source_field: "parking", label: "Parking", type: "boolean", display_order: 0, show_on_form: false });
    await addField(id, {
      source_field: "plate",
      label: "Plate",
      type: "text",
      required: true,
      display_order: 1,
      rules: { show_when: { field: "parking", value: true } },
    });
    await addField(id, { source_field: "nickname", label: "Nickname", type: "text", display_order: 2 });
    const res = await get("/r/reg113f-orphan");
    expect(res.status).toBe(200);
    const doc = documentOf(await res.text());
    expect([...doc.querySelectorAll("[data-custom]")].map((el: Dom) => el.getAttribute("data-custom"))).toEqual(["nickname"]);
    expect(doc.body.textContent).not.toContain("Plate");
  });

  it("prints every word of a suggestion, a condition and an icon as text or as an attribute value, never as markup", async () => {
    const payload = '<img src=x onerror=alert(1)>"\'</style></script><svg onload=alert(1)>';
    const short = '<img src=x onerror=alert(1)>"\'';
    const id = await addEvent("reg113f-xss", { settings: { mode: "approval" } });
    await addField(id, { source_field: "pick", label: payload, type: "select", options: [short, "Other"], display_order: 0, description: payload, rules: { icon: "pin" } });
    await addField(id, { source_field: "row", label: payload, type: "boolean", display_order: 1, description: payload, rules: { icon: "shirt" } });
    await addField(id, {
      source_field: "details",
      label: payload,
      type: "text",
      display_order: 2,
      description: payload,
      rules: { example: payload, suggestions: [payload, `${payload} 2`], show_when: { field: "pick", value: short } },
    });
    await addField(id, { source_field: "more", label: payload, type: "text", display_order: 3, rules: { show_when: { field: "row", value: true }, suggestions: [short] } });
    const res = await get("/r/reg113f-xss");
    const html = await res.text();
    const doc = documentOf(html);
    expect(res.status).toBe(200);
    expect(doc.querySelectorAll("script")).toHaveLength(2);
    expect(doc.querySelectorAll("[onerror], [onload], [onfocus], [onclick]")).toHaveLength(0);
    expect(html.split("<style").length - 1).toBe(1);
    expect(html.split("</script").length - 1).toBe(2);
    expect(html).not.toContain("<img src=x onerror");
    expect(html).not.toContain("<svg onload");
    const details = doc.querySelector("[data-custom=details]");
    expect(details.getAttribute("data-show-when-field")).toBe("pick");
    expect(details.getAttribute("data-show-when-value")).toBe(short);
    const rows = [...details.querySelectorAll("[role=option][data-value]")];
    expect(rows.map((el: Dom) => el.getAttribute("data-value"))).toEqual([payload, `${payload} 2`]);
    expect(rows.map((el: Dom) => el.textContent)).toEqual([payload, `${payload} 2`]);
    expect(details.querySelector(".reg-slot__hint").textContent).toBe(`${payload}\nFor example: ${payload}`);
    expect(doc.querySelector("[data-custom=pick] .at-label").textContent).toBe(payload);
    expect(doc.querySelector("[data-custom=more]").getAttribute("data-show-when-field")).toBe("row");
    expect([...doc.querySelectorAll("[data-custom=pick] option")].map((o: Dom) => o.textContent)).toEqual(["Choose one", short, "Other"]);
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
