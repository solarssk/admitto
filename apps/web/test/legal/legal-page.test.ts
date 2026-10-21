import { describe, expect, it, vi } from "vitest";
import { Hono } from "hono";
import type { PrismaClient } from "@admitto/db";
import {
  getLegalPageSecurityHeaders,
  loadPublishedLegalPage,
  renderLegalDocumentPage,
  respondLegalPage,
  type PublishedLegalPage,
} from "../../src/legal/legal-page.js";
import { getTicketPageSecurityHeaders } from "../../src/ticket-page.js";

const PAGE: PublishedLegalPage = {
  title: "Privacy notice",
  contentHtml: '<h2>Who we are</h2><p>Text with <a href="https://example.com/p">a link</a>.</p>',
  eventTitle: "Summit 2026",
  logoUrl: null,
  tabs: [],
};

describe("renderLegalDocumentPage", () => {
  it("prints the title as the one h1, the event and the stored HTML as it is", () => {
    const html = renderLegalDocumentPage(PAGE);
    expect(html).toContain("<title>Privacy notice - Summit 2026</title>");
    expect(html.match(/<h1\b/g)).toHaveLength(1);
    expect(html).toContain('<h1 class="legal__title">Privacy notice</h1>');
    expect(html).toContain('<p class="legal__event">Summit 2026</p>');
    expect(html).toContain(`<div class="legal__content">${PAGE.contentHtml}</div>`);
  });

  it("is a page with no script of its own and nothing that loads from elsewhere", () => {
    const html = renderLegalDocumentPage(PAGE);
    expect(html).not.toMatch(/<script/i);
    expect(html).not.toMatch(/<(iframe|form|object|embed|link rel="stylesheet")/i);
    expect(html).toContain('<meta name="viewport"');
  });

  it("escapes the title and the event name", () => {
    const html = renderLegalDocumentPage({
      ...PAGE,
      title: '<img src=x onerror="alert(1)">',
      eventTitle: "</title><script>alert(1)</script>",
    });
    expect(html).not.toContain("<img src=x");
    expect(html).not.toContain("<script>alert(1)");
    expect(html).toContain("&lt;img src=x onerror=&quot;alert(1)&quot;&gt;");
    expect(html).toContain("&lt;/title&gt;&lt;script&gt;alert(1)&lt;/script&gt;");
  });

  it("shows the Admitto mark when the event has no logo, and the event's logo when it has one", () => {
    expect(renderLegalDocumentPage(PAGE)).toContain('src="/assets/admitto-mark.svg"');
    const withLogo = renderLegalDocumentPage({ ...PAGE, logoUrl: 'https://cdn.example.com/logo.png?a=1&b="2"' });
    expect(withLogo).toContain('<img class="ticket__brand-logo" src="https://cdn.example.com/logo.png?a=1&amp;b=&quot;2&quot;" alt="Summit 2026">');
    expect(withLogo).not.toContain("admitto-mark.svg");
  });

  it("shows tabs between the event's published texts, with the open one marked", () => {
    const html = renderLegalDocumentPage({
      ...PAGE,
      tabs: [
        { kind: "privacy_notice", title: "Privacy notice", path: "/legal/summit-2026/privacy-notice", current: true },
        { kind: "event_terms", title: "Event terms", path: "/legal/summit-2026/event-terms", current: false },
        { kind: "consent", title: "Photo consent", path: "/legal/summit-2026/consent-photos", current: false },
      ],
    });
    expect(html).toContain('<nav class="legal__tabs" aria-label="Legal texts of this event">');
    const nav = html.match(/<nav[\s\S]*?<\/nav>/)?.[0] ?? "";
    expect(nav.match(/class="legal__tab"/g)).toHaveLength(3);
    expect(nav.match(/aria-current="page"/g)).toHaveLength(1);
    expect(html).toContain('<a class="legal__tab" href="/legal/summit-2026/privacy-notice" aria-current="page">');
    expect(html).toContain('href="/legal/summit-2026/consent-photos"><svg');
    expect(html.indexOf("<nav")).toBeGreaterThan(html.indexOf("</header>"));
    expect(html.indexOf("<nav")).toBeLessThan(html.indexOf('class="legal__event"'));
  });

  it("prints no tabs for a single text, and escapes a tab's title", () => {
    expect(renderLegalDocumentPage(PAGE)).not.toContain("<nav");
    const one = { kind: "privacy_notice" as const, title: "Only", path: "/legal/s/privacy-notice", current: true };
    expect(renderLegalDocumentPage({ ...PAGE, tabs: [one] })).not.toContain("<nav");
    const html = renderLegalDocumentPage({
      ...PAGE,
      tabs: [one, { kind: "consent", title: '<img src=x onerror="1">', path: "/legal/s/consent-a", current: false }],
    });
    expect(html).not.toContain("<img src=x");
    expect(html).toContain("&lt;img src=x onerror=&quot;1&quot;&gt;");
  });

  it("is the same page for the same text", () => {
    expect(renderLegalDocumentPage(PAGE)).toBe(renderLegalDocumentPage({ ...PAGE }));
  });
});

type FindFirst = (args: unknown) => Promise<unknown>;

function fakeDb(row: unknown): { db: PrismaClient; findFirst: ReturnType<typeof vi.fn<FindFirst>> } {
  const findFirst = vi.fn<FindFirst>(async () => row);
  return { db: { legalDocument: { findFirst } } as unknown as PrismaClient, findFirst };
}

const STORED = {
  title: "Event terms",
  content_html: "<p>Terms</p>",
  event: {
    title: "Summit 2026",
    logo_url: null,
    header_image_url: null,
    organization: { logo_url: "https://cdn.example.com/org.png", header_image_url: null },
    legal_documents: [{ kind: "event_terms", key: "", title: "Event terms" }],
  },
};

describe("loadPublishedLegalPage", () => {
  it("asks for a published text of the event with that slug, by kind and key", async () => {
    const { db, findFirst } = fakeDb(STORED);
    await loadPublishedLegalPage(db, "summit-2026", "consent-photos");
    expect(findFirst).toHaveBeenCalledTimes(1);
    expect(findFirst.mock.calls[0]![0]).toMatchObject({
      where: { kind: "consent", key: "photos", published_at: { not: null }, event: { slug: "summit-2026" } },
    });
  });

  it("returns what the page needs, with the logo falling back to the organisation's", async () => {
    const { db } = fakeDb(STORED);
    await expect(loadPublishedLegalPage(db, "summit-2026", "event-terms")).resolves.toEqual({
      title: "Event terms",
      contentHtml: "<p>Terms</p>",
      eventTitle: "Summit 2026",
      logoUrl: "https://cdn.example.com/org.png",
      tabs: [],
    });
  });

  it("builds the tabs in reading order from the event's published texts, the page's own marked", async () => {
    const { db, findFirst } = fakeDb({
      ...STORED,
      event: {
        ...STORED.event,
        legal_documents: [
          { kind: "consent", key: "photos", title: "Photo consent" },
          { kind: "event_terms", key: "", title: "Event terms" },
          { kind: "consent", key: "news", title: "Newsletter" },
          { kind: "privacy_notice", key: "", title: "Privacy notice" },
        ],
      },
    });
    const page = await loadPublishedLegalPage(db, "summit-2026", "event-terms");
    expect(page?.tabs).toEqual([
      { kind: "privacy_notice", title: "Privacy notice", path: "/legal/summit-2026/privacy-notice", current: false },
      { kind: "event_terms", title: "Event terms", path: "/legal/summit-2026/event-terms", current: true },
      { kind: "consent", title: "Newsletter", path: "/legal/summit-2026/consent-news", current: false },
      { kind: "consent", title: "Photo consent", path: "/legal/summit-2026/consent-photos", current: false },
    ]);
    expect(findFirst.mock.calls[0]![0]).toMatchObject({
      select: { event: { select: { legal_documents: { where: { published_at: { not: null } } } } } },
    });
  });

  it("ignores a text of a kind it does not know when it builds the tabs", async () => {
    const { db } = fakeDb({
      ...STORED,
      event: {
        ...STORED.event,
        legal_documents: [
          { kind: "event_terms", key: "", title: "Event terms" },
          { kind: "something_else", key: "", title: "Unknown" },
        ],
      },
    });
    await expect(loadPublishedLegalPage(db, "summit-2026", "event-terms")).resolves.toMatchObject({ tabs: [] });
  });

  it("returns null when there is no such published text", async () => {
    const { db } = fakeDb(null);
    await expect(loadPublishedLegalPage(db, "summit-2026", "privacy-notice")).resolves.toBeNull();
  });

  it.each([
    ["a ref that names nothing", "summit-2026", "privacy_notice"],
    ["a consent without a valid key", "summit-2026", "consent-Photos"],
    ["an empty slug", "", "privacy-notice"],
    ["a slug longer than any event has", "a".repeat(81), "privacy-notice"],
  ])("does not touch the database for %s", async (_name, slug, ref) => {
    const { db, findFirst } = fakeDb(STORED);
    await expect(loadPublishedLegalPage(db, slug, ref)).resolves.toBeNull();
    expect(findFirst).not.toHaveBeenCalled();
  });
});

describe("getLegalPageSecurityHeaders", () => {
  const directive = (csp: string, name: string) =>
    csp
      .split(";")
      .map((part) => part.trim())
      .find((part) => part === name || part.startsWith(`${name} `));

  it("is the ticket page's policy with objects forbidden", () => {
    const ticket = getTicketPageSecurityHeaders(null, "https://cdn.example.com/logo.png", true);
    const legal = getLegalPageSecurityHeaders(null, "https://cdn.example.com/logo.png", true);
    expect(directive(ticket["Content-Security-Policy"]!, "object-src")).toBe("object-src 'self'");
    expect(directive(legal["Content-Security-Policy"]!, "object-src")).toBe("object-src 'none'");
    expect(legal["Content-Security-Policy"]).toBe(ticket["Content-Security-Policy"]!.replace("object-src 'self'", "object-src 'none'"));
    expect({ ...legal, "Content-Security-Policy": "" }).toEqual({ ...ticket, "Content-Security-Policy": "" });
  });

  it("allows no script, fetch, form, frame, base or object", () => {
    const csp = getLegalPageSecurityHeaders()["Content-Security-Policy"]!;
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
  });

  it("sends HSTS over HTTPS only", () => {
    expect(getLegalPageSecurityHeaders(null, null, true)["Strict-Transport-Security"]).toBeDefined();
    expect(getLegalPageSecurityHeaders(null, null, false)["Strict-Transport-Security"]).toBeUndefined();
  });
});

describe("respondLegalPage", () => {
  const app = new Hono();
  app.get("/page", (c) => respondLegalPage(c, PAGE, null));

  it("answers 200 with the page and the legal headers, and no cookie", async () => {
    const res = await app.request("/page");
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toMatch(/^text\/html/);
    expect(await res.text()).toBe(renderLegalDocumentPage(PAGE, null));
    expect(res.headers.get("content-security-policy")).toBe(getLegalPageSecurityHeaders(null, null, false)["Content-Security-Policy"]);
    expect(res.headers.get("cache-control")).toBe("private, no-store, max-age=0");
    expect(res.headers.getSetCookie()).toEqual([]);
  });

  it("adds HSTS when the request is over HTTPS", async () => {
    const res = await app.request("https://tickets.example.com/page");
    expect(res.headers.get("strict-transport-security")).toBe("max-age=31536000; includeSubDomains");
  });
});
