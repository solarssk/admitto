import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { PrismaClient } from "@admitto/db";
import { createTestPrismaClient } from "@admitto/db/testing";
import { hashPassword } from "@admitto/auth";
import { createApp } from "../../src/app.js";
import { renderRegistrationNotFound } from "../../src/registration-page-security.js";
import { buildTestApp } from "../helpers/build-test-app.js";
import { bootSingleOrgFixture } from "../helpers/boot-single-org-fixture.js";
import { enrollConfirmedTotp } from "../helpers/enroll-confirmed-totp.js";
import { createAdminAndOp } from "../helpers/seed-org-and-event.js";

const adminDistRoot = join(dirname(fileURLToPath(import.meta.url)), "../fixtures/admin-dist");
const sameOrigin = { Origin: "http://localhost" };

const ORG = "org-legal-public";
const EVENT = "evt-legal-public";
const EVENT_OTHER = "evt-legal-public-other";
const EVENT_LOGO = "evt-legal-public-logo";
const EVENT_IDS = [EVENT, EVENT_OTHER, EVENT_LOGO];
const SLUG = "legal-public";
const SLUG_OTHER = "legal-public-other";
const SLUG_LOGO = "legal-public-logo";
const EMAILS = ["legal-public-admin@example.com", "legal-public-op@example.com"];

const PRIVACY_HTML = '<h2>Who we are</h2><p>We keep <strong>your</strong> data. See <a href="https://example.com/policy">the policy</a>.</p>';

let prisma: PrismaClient;
let app: ReturnType<typeof buildTestApp>;
let adminCookie = "";

async function seed(client: PrismaClient): Promise<{ adminId: string; opId: string }> {
  await client.legalDocument.deleteMany({ where: { event_id: { in: EVENT_IDS } } });
  await client.eventRegistrationSettings.deleteMany({ where: { event_id: { in: EVENT_IDS } } });
  await client.adminAuditLog.deleteMany({ where: { organization_id: ORG } });
  await client.roleAssignment.deleteMany({ where: { scope_id: { in: [ORG, ...EVENT_IDS] } } });
  await client.session.deleteMany({ where: { user: { email: { in: EMAILS } } } });
  await client.userMfaMethod.deleteMany({ where: { user: { email: { in: EMAILS } } } });
  await client.user.deleteMany({ where: { email: { in: EMAILS } } });
  await client.event.deleteMany({ where: { id: { in: EVENT_IDS } } });
  await client.organization.deleteMany({ where: { id: ORG } });

  await client.organization.create({ data: { id: ORG, name: "Legal Public Org", slug: "legal-public-org" } });
  await client.event.createMany({
    data: [
      { id: EVENT, title: "Legal Public Summit", slug: SLUG, date: new Date("2026-10-01"), organization_id: ORG },
      { id: EVENT_OTHER, title: "Other Summit", slug: SLUG_OTHER, date: new Date("2026-10-02"), organization_id: ORG },
      {
        id: EVENT_LOGO,
        title: "Logo Summit",
        slug: SLUG_LOGO,
        date: new Date("2026-10-03"),
        organization_id: ORG,
        logo_url: "https://cdn.example.com/assets/logo.png",
      },
    ],
  });
  const published = new Date("2026-10-20T10:00:00Z");
  await client.legalDocument.createMany({
    data: [
      { event_id: EVENT, kind: "privacy_notice", title: "Privacy notice", content_html: PRIVACY_HTML, published_at: published },
      { event_id: EVENT, kind: "event_terms", title: "Event terms", content_html: "<p>Draft terms</p>" },
      { event_id: EVENT, kind: "consent", key: "photos", title: "I agree to be photographed", content_html: "<p>Photos</p>", published_at: published },
      { event_id: EVENT, kind: "consent", key: "news", title: "Newsletter", content_html: "<p>Draft</p>" },
      { event_id: EVENT_OTHER, kind: "privacy_notice", title: "Other notice", content_html: "<p>Other event text</p>", published_at: published },
      { event_id: EVENT_LOGO, kind: "event_terms", title: "Terms", content_html: "<p>Terms</p>", published_at: published },
    ],
  });

  const ids = await createAdminAndOp(client, {
    adminEmail: EMAILS[0]!,
    opEmail: EMAILS[1]!,
    passwordHash: await hashPassword("legal-public-pass-123"),
    orgId: ORG,
    eventId: EVENT,
  });
  await enrollConfirmedTotp(client, ids.adminId);
  return ids;
}

beforeAll(async () => {
  prisma = createTestPrismaClient();
  const { adminId, opId } = await seed(prisma);
  ({ app, adminCookie } = await bootSingleOrgFixture({
    prisma,
    adminId,
    opId,
    checkinToken: "legal-public-checkin-token-32-chr!",
    adminDistRoot,
  }));
});

afterAll(async () => {
  await prisma?.$disconnect();
});

const get = (path: string, init: RequestInit = {}) => app.request(path, init);

/** The headers of a response as a plain lower-case record, without the ones that vary per request. */
function headersOf(res: Response): Record<string, string> {
  const out: Record<string, string> = {};
  res.headers.forEach((value, name) => {
    if (name !== "date") out[name] = value;
  });
  return out;
}

function directive(csp: string, name: string): string | undefined {
  return csp
    .split(";")
    .map((part) => part.trim())
    .find((part) => part === name || part.startsWith(`${name} `));
}

describe("GET /legal/:eventSlug/:ref for a published text", () => {
  it("shows the text with its title and its event", async () => {
    const res = await get(`/legal/${SLUG}/privacy-notice`);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toMatch(/^text\/html/);
    const html = await res.text();
    expect(html).toContain("<title>Privacy notice - Legal Public Summit</title>");
    expect(html).toContain('<h1 class="legal__title">Privacy notice</h1>');
    expect(html).toContain(`<div class="legal__content">${PRIVACY_HTML}</div>`);
  });

  it("shows a consent under its key, and each event only its own texts", async () => {
    const consent = await (await get(`/legal/${SLUG}/consent-photos`)).text();
    expect(consent).toContain('<h1 class="legal__title">I agree to be photographed</h1>');
    expect(consent).toContain("<p>Photos</p>");

    const other = await (await get(`/legal/${SLUG_OTHER}/privacy-notice`)).text();
    expect(other).toContain("<p>Other event text</p>");
    expect(other).not.toContain("We keep");
  });

  it("carries the zero-script policy of the ticket page", async () => {
    const res = await get(`/legal/${SLUG}/privacy-notice`);
    const csp = res.headers.get("content-security-policy")!;
    for (const expected of [
      "default-src 'none'",
      "script-src 'none'",
      "connect-src 'none'",
      "form-action 'none'",
      "frame-ancestors 'none'",
      "base-uri 'none'",
      "object-src 'none'",
    ]) {
      expect(directive(csp, expected.split(" ")[0]!), expected).toBe(expected);
    }
    expect(csp).not.toContain("unsafe-eval");
    expect(csp).not.toContain("nonce");
    expect(directive(csp, "script-src")).toBe("script-src 'none'");
  });

  it("is never cached, never indexed, never framed and never sent with a referrer", async () => {
    const res = await get(`/legal/${SLUG}/privacy-notice`);
    expect(res.headers.get("cache-control")).toBe("private, no-store, max-age=0");
    expect(res.headers.get("referrer-policy")).toBe("no-referrer");
    expect(res.headers.get("x-content-type-options")).toBe("nosniff");
    expect(res.headers.get("x-robots-tag")).toBe("noindex, nofollow");
    expect(res.headers.get("permissions-policy")).toBe("camera=(), geolocation=(), microphone=(), payment=(), usb=()");
  });

  it("sends HSTS over HTTPS only", async () => {
    expect((await get(`https://tickets.example.com/legal/${SLUG}/privacy-notice`)).headers.get("strict-transport-security")).toBe(
      "max-age=31536000; includeSubDomains",
    );
    expect((await get(`/legal/${SLUG}/privacy-notice`)).headers.get("strict-transport-security")).toBeNull();
  });

  it("sets no cookie, and answers a signed-in staff member exactly as it answers a stranger", async () => {
    const stranger = await get(`/legal/${SLUG}/privacy-notice`);
    const staff = await get(`/legal/${SLUG}/privacy-notice`, { headers: { Cookie: adminCookie } });
    expect(stranger.headers.getSetCookie()).toEqual([]);
    expect(staff.headers.getSetCookie()).toEqual([]);
    expect(await staff.text()).toBe(await stranger.text());
    expect(headersOf(staff)).toEqual(headersOf(stranger));
  });

  it("allows the logo's origin to load, and no other", async () => {
    const res = await get(`/legal/${SLUG_LOGO}/event-terms`);
    expect(directive(res.headers.get("content-security-policy")!, "img-src")).toBe(
      "img-src 'self' data: https://cdn.example.com",
    );
    expect(await res.text()).toContain('<img class="ticket__brand-logo" src="https://cdn.example.com/assets/logo.png" alt="Logo Summit">');
    const plain = await get(`/legal/${SLUG}/privacy-notice`);
    expect(directive(plain.headers.get("content-security-policy")!, "img-src")).toBe("img-src 'self' data:");
  });

  it("escapes the titles it prints", async () => {
    await prisma.legalDocument.update({
      where: { event_id_kind_key: { event_id: EVENT_OTHER, kind: "privacy_notice", key: "" } },
      data: { title: '<img src=x onerror="alert(1)">' },
    });
    await prisma.event.update({ where: { id: EVENT_OTHER }, data: { title: "</title><script>alert(1)</script>" } });
    const html = await (await get(`/legal/${SLUG_OTHER}/privacy-notice`)).text();
    expect(html).not.toContain("<img src=x");
    expect(html).not.toContain("<script>alert(1)");
    expect(html).toContain("&lt;img src=x onerror=&quot;alert(1)&quot;&gt;");
  });

  it("still forbids every script when the stored markup did not come through the sanitiser", async () => {
    // The second layer: a row written by anything but the organiser API (a bug, a script, a restored
    // backup) is printed as it is, and the policy is what stops it.
    await prisma.legalDocument.create({
      data: {
        event_id: EVENT_LOGO,
        kind: "privacy_notice",
        title: "Unsafe",
        content_html: '<p>x</p><script>alert(1)</script><img src=x onerror=alert(1)>',
        published_at: new Date(),
      },
    });
    const res = await get(`/legal/${SLUG_LOGO}/privacy-notice`);
    expect(res.status).toBe(200);
    const csp = res.headers.get("content-security-policy")!;
    expect(directive(csp, "script-src")).toBe("script-src 'none'");
    expect(directive(csp, "default-src")).toBe("default-src 'none'");
    expect(res.headers.getSetCookie()).toEqual([]);
  });
});

describe("a published text is reachable whatever the event's registration setting", () => {
  it("is served when the event has no registration settings, when registration is off and when it is on", async () => {
    expect((await get(`/legal/${SLUG}/privacy-notice`)).status).toBe(200);
    await prisma.eventRegistrationSettings.create({ data: { event_id: EVENT, mode: null } });
    expect((await get(`/legal/${SLUG}/privacy-notice`)).status).toBe(200);
    await prisma.eventRegistrationSettings.update({ where: { event_id: EVENT }, data: { mode: "automatic" } });
    expect((await get(`/legal/${SLUG}/privacy-notice`)).status).toBe(200);
    await prisma.eventRegistrationSettings.delete({ where: { event_id: EVENT } });
  });

  it("is served for an archived event, so a guest can read again what they accepted", async () => {
    await prisma.event.update({ where: { id: EVENT_OTHER }, data: { archived_at: new Date() } });
    const res = await get(`/legal/${SLUG_OTHER}/privacy-notice`);
    expect(res.status).toBe(200);
    await prisma.event.update({ where: { id: EVENT_OTHER }, data: { archived_at: null } });
  });
});

describe("a text that is not there", () => {
  const UNREACHABLE = [
    ["a draft", `/legal/${SLUG}/event-terms`],
    ["a draft consent", `/legal/${SLUG}/consent-news`],
    ["a consent that does not exist", `/legal/${SLUG}/consent-nothing`],
    ["a text the event never wrote", `/legal/${SLUG_OTHER}/event-terms`],
    ["an event that does not exist", "/legal/no-such-event/privacy-notice"],
    ["an event slug in capitals", `/legal/${SLUG.toUpperCase()}/privacy-notice`],
    ["a ref that names no kind", `/legal/${SLUG}/privacy_notice`],
    ["a consent key that is not valid", `/legal/${SLUG}/consent-Bad`],
    ["an empty consent key", `/legal/${SLUG}/consent-`],
    ["a slug that is too long", `/legal/${"a".repeat(200)}/privacy-notice`],
    ["a path with no ref", `/legal/${SLUG}`],
    ["a path with no event", "/legal"],
    ["a path with a trailing slash only", "/legal/"],
    ["a path that is too deep", `/legal/${SLUG}/privacy-notice/extra`],
    ["a path that is not a legal route at all", "/nothing-here"],
  ] as const;

  it.each(UNREACHABLE)("answers %s with the one 404", async (_name, path) => {
    const res = await get(path);
    const expected = renderRegistrationNotFound(false);
    expect(res.status).toBe(404);
    expect(await res.text()).toBe(expected.html);
    for (const [name, value] of Object.entries(expected.headers)) {
      expect(res.headers.get(name), name).toBe(value);
    }
    expect(res.headers.getSetCookie()).toEqual([]);
  });

  it("gives the same headers and bytes for all of them, so nothing tells a draft from a missing event", async () => {
    const answers = await Promise.all(
      UNREACHABLE.map(async ([, path]) => {
        const res = await get(path);
        return { status: res.status, headers: headersOf(res), body: await res.text() };
      }),
    );
    for (const answer of answers) expect(answer).toEqual(answers[0]);
  });

  it("is the same 404 for a signed-in staff member: a draft cannot be read at its public address", async () => {
    const res = await get(`/legal/${SLUG}/event-terms`, { headers: { Cookie: adminCookie } });
    expect(res.status).toBe(404);
    expect(await res.text()).toBe(renderRegistrationNotFound(false).html);
  });

  it("is the 404 over HTTPS too, with HSTS like every other page", async () => {
    const res = await get(`https://tickets.example.com/legal/${SLUG}/event-terms`);
    expect(res.status).toBe(404);
    expect(res.headers.get("strict-transport-security")).toBe("max-age=31536000; includeSubDomains");
  });

  it("is not reachable by any method but GET", async () => {
    for (const method of ["POST", "PUT", "DELETE", "PATCH"]) {
      const res = await get(`/legal/${SLUG}/privacy-notice`, { method, headers: sameOrigin });
      expect(res.status, method).toBe(404);
    }
  });
});

describe("publishing and withdrawing change what a guest sees at once", () => {
  const admin = (method: string, path: string, body?: unknown) =>
    get(`/api/admin/events/${EVENT_LOGO}/legal-documents/${path}`, {
      method,
      headers: { Cookie: adminCookie, ...sameOrigin, "Content-Type": "application/json" },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });

  it("goes from 404 to the page to 404 again", async () => {
    expect((await get(`/legal/${SLUG_LOGO}/consent-roundtrip`)).status).toBe(404);
    expect((await admin("PUT", "consent-roundtrip", { title: "Round trip", content_html: "<p>Draft</p><script>alert(1)</script>" })).status).toBe(201);
    expect((await get(`/legal/${SLUG_LOGO}/consent-roundtrip`)).status).toBe(404);

    expect((await admin("POST", "consent-roundtrip/publish")).status).toBe(200);
    const page = await get(`/legal/${SLUG_LOGO}/consent-roundtrip`);
    expect(page.status).toBe(200);
    const html = await page.text();
    expect(html).toContain("<p>Draft</p>");
    expect(html).not.toContain("alert(1)");

    expect((await admin("PUT", "consent-roundtrip", { title: "Round trip", content_html: "<p>Edited</p>" })).status).toBe(200);
    expect(await (await get(`/legal/${SLUG_LOGO}/consent-roundtrip`)).text()).toContain("<p>Edited</p>");

    expect((await admin("POST", "consent-roundtrip/unpublish")).status).toBe(200);
    expect((await get(`/legal/${SLUG_LOGO}/consent-roundtrip`)).status).toBe(404);
    expect((await admin("DELETE", "consent-roundtrip")).status).toBe(200);
  });
});

describe("limits and failures", () => {
  it("limits reading to 300 pages a minute for one address, and says so without a cookie", async () => {
    const limited = buildTestApp({ prisma, checkinToken: "legal-public-limited-token-32-chr", adminDistRoot });
    for (let i = 0; i < 300; i += 1) {
      expect((await limited.request(`/legal/${SLUG}/bogus`)).status).not.toBe(429);
    }
    const blocked = await limited.request(`/legal/${SLUG}/privacy-notice`);
    expect(blocked.status).toBe(429);
    expect(await blocked.json()).toEqual({ error: "too many requests" });
    expect(blocked.headers.getSetCookie()).toEqual([]);
  });

  it("shows tabs between an event's published texts only, and none for an event with one text", async () => {
    const res = await get(`/legal/${SLUG}/privacy-notice`);
    expect(res.status).toBe(200);
    const html = await res.text();
    const nav = html.match(/<nav class="legal__tabs"[\s\S]*?<\/nav>/)?.[0] ?? "";
    expect(nav).toContain(`href="/legal/${SLUG}/privacy-notice" aria-current="page"`);
    expect(nav).toContain(`href="/legal/${SLUG}/consent-photos"`);
    expect(nav).toContain("I agree to be photographed");
    // The drafts of the same event are not there.
    expect(nav).not.toContain("event-terms");
    expect(nav).not.toContain("Newsletter");
    expect(nav.match(/class="legal__tab"/g)).toHaveLength(2);

    const single = await get(`/legal/${SLUG_OTHER}/privacy-notice`);
    expect(await single.text()).not.toContain("<nav");
    // Another event's texts never appear as tabs.
    expect(nav).not.toContain(SLUG_OTHER);
  });

  it("answers a database failure with the standard error page, naming nothing", async () => {
    const failing = new Proxy(prisma, {
      get(target, property, receiver) {
        if (property === "legalDocument") {
          return {
            findFirst: () => Promise.reject(new Error("connection refused: secret-host.internal")),
          };
        }
        return Reflect.get(target, property, receiver) as unknown;
      },
    });
    const brokenApp = createApp({
      prisma: failing,
      checkinToken: "legal-public-broken-token-32-chars",
      allowCheckinBearer: true,
      baseUrl: "https://tickets.example.com",
      skipCheckinBootValidation: true,
      adminDistRoot,
    });
    const logged = vi.spyOn(console, "error").mockImplementation(() => undefined);
    let res: Response;
    try {
      res = await brokenApp.request(`/legal/${SLUG}/privacy-notice`);
      // Nothing from the exception reaches the process log either, only its class.
      expect(logged).toHaveBeenCalled();
      expect(JSON.stringify(logged.mock.calls)).not.toContain("secret-host");
    } finally {
      logged.mockRestore();
    }
    expect(res.status).toBe(500);
    const html = await res.text();
    expect(html).toContain("Something went wrong");
    expect(html).not.toContain("secret-host");
    expect(directive(res.headers.get("content-security-policy")!, "script-src")).toBe("script-src 'none'");
  });
});
