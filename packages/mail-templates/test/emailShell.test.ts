import { describe, expect, it } from "vitest";
import {
  absolutizeEmailShellLogo,
  buildBulletproofButtonHtml,
  buildEmailBoxedSectionHtml,
  buildEmailStatusBadgeHtml,
  buildEmailStatusBadgeImageHtml,
  buildSystemEmailHtml,
  buildSystemEmailSubject,
  EMAIL_ASSET_VERSION,
  resolveBundledEmailAssetUrl,
  resolveEmailShellHeaderLogo,
} from "../src/emailShell.js";

const ENV = { NODE_ENV: "test", BASE_URL: "https://tickets.example.com" };

describe("absolutizeEmailShellLogo", () => {
  it("absolutizes /uploads paths with BASE_URL", () => {
    expect(
      absolutizeEmailShellLogo("/uploads/default/aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee.png", ENV),
    ).toBe("https://tickets.example.com/uploads/default/aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee.png");
  });

  it("returns null for empty/invalid input", () => {
    expect(absolutizeEmailShellLogo(null, { NODE_ENV: "development" })).toBeNull();
    expect(absolutizeEmailShellLogo("not-a-url", { NODE_ENV: "development" })).toBeNull();
  });
});

describe("resolveEmailShellHeaderLogo", () => {
  it("prefers a branding logo when set", () => {
    expect(
      resolveEmailShellHeaderLogo("/uploads/default/aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee.png", ENV),
    ).toEqual({
      url: "https://tickets.example.com/uploads/default/aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee.png",
      kind: "branding",
    });
  });

  it("falls back to the bundled Admitto PNG logo when branding is missing - the SVG wordmark can't render as an <img> in classic Outlook", () => {
    expect(resolveEmailShellHeaderLogo(null, ENV)).toEqual({
      url: `https://tickets.example.com/assets/admitto-logo.png?v=${EMAIL_ASSET_VERSION}`,
      kind: "admitto",
    });
  });

  it("returns null (falls through to the plain text header) when BASE_URL cannot be resolved", () => {
    expect(resolveEmailShellHeaderLogo(null, {})).toBeNull();
  });
});

describe("resolveBundledEmailAssetUrl", () => {
  it("joins BASE_URL and the asset path, with a cache-busting version query", () => {
    expect(resolveBundledEmailAssetUrl("/assets/notification-badge-info.png", ENV)).toBe(
      `https://tickets.example.com/assets/notification-badge-info.png?v=${EMAIL_ASSET_VERSION}`,
    );
  });

  it("returns null when BASE_URL cannot be resolved", () => {
    expect(resolveBundledEmailAssetUrl("/assets/notification-badge-info.png", {})).toBeNull();
  });
});

describe("buildSystemEmailSubject", () => {
  it("wraps the prefix name in brackets ahead of the main text", () => {
    expect(buildSystemEmailSubject("Acme Corp", "Login from a new country")).toBe(
      "[Acme Corp] Login from a new country",
    );
  });
});

describe("buildSystemEmailHtml", () => {
  it("renders doctype/head/title and escapes titleText/footerText", () => {
    const html = buildSystemEmailHtml({
      titleText: "Test <title>",
      bodyHtml: "<tr><td>body</td></tr>",
      footerText: "Footer & text",
    });
    expect(html).toContain("<!DOCTYPE html>");
    expect(html).toContain("<title>Test &lt;title&gt;</title>");
    expect(html).toContain("Footer &amp; text");
  });

  it("opts out of client dark-mode remapping", () => {
    const html = buildSystemEmailHtml({ titleText: "Title", bodyHtml: "", footerText: "Footer" });
    expect(html).toContain('<meta name="color-scheme" content="light" />');
    expect(html).toContain('<meta name="supported-color-schemes" content="light" />');
    expect(html).toContain("color-scheme:light");
  });

  it("inserts bodyHtml verbatim between the header and footer rows", () => {
    const html = buildSystemEmailHtml({
      titleText: "Title",
      bodyHtml: "<tr><td>UNIQUE_BODY_MARKER</td></tr>",
      footerText: "Footer",
    });
    expect(html).toContain("UNIQUE_BODY_MARKER");
  });

  it("renders a plain-text 'Admitto' header when no logo URL is given", () => {
    const html = buildSystemEmailHtml({ titleText: "Title", bodyHtml: "", footerText: "Footer" });
    expect(html).toContain(">Admitto<");
    expect(html).not.toContain("<img ");
  });

  it("renders an <img> with width 118/alt Admitto for the admitto logoKind", () => {
    const html = buildSystemEmailHtml({
      titleText: "Title",
      logoUrl: "https://tickets.example.com/assets/admitto-logo.svg",
      logoKind: "admitto",
      bodyHtml: "",
      footerText: "Footer",
    });
    expect(html).toContain('src="https://tickets.example.com/assets/admitto-logo.svg"');
    expect(html).toContain('width="118"');
    expect(html).toContain('alt="Admitto"');
  });

  it("renders an <img> with width 140/alt from altFallbackName for the branding logoKind", () => {
    const html = buildSystemEmailHtml({
      titleText: "Title",
      logoUrl: "https://cdn.example.com/logo.png",
      logoKind: "branding",
      altFallbackName: "Acme Org",
      bodyHtml: "",
      footerText: "Footer",
    });
    expect(html).toContain('src="https://cdn.example.com/logo.png"');
    expect(html).toContain('width="140"');
    expect(html).toContain('alt="Acme Org"');
  });
});

describe("buildEmailStatusBadgeHtml", () => {
  it("renders the circle colors, glyph, and escaped label", () => {
    const html = buildEmailStatusBadgeHtml({
      circleBackground: "#dcfce7",
      circleColor: "#16a34a",
      glyphHtml: "&#10003;",
      labelColor: "#16a34a",
      labelText: "All good & done",
    });
    expect(html).toContain("background-color:#dcfce7");
    expect(html).toContain("color:#16a34a");
    expect(html).toContain("&#10003;");
    expect(html).toContain("All good &amp; done");
  });
});

describe("buildEmailStatusBadgeImageHtml", () => {
  it("renders the badge as an <img> at the given size, and the escaped label", () => {
    const html = buildEmailStatusBadgeImageHtml({
      imageUrl: "https://tickets.example.com/assets/notification-badge-info.png",
      labelColor: "#4299e1",
      labelText: "Info & more",
    });
    expect(html).toContain('src="https://tickets.example.com/assets/notification-badge-info.png"');
    expect(html).toContain('width="44"');
    expect(html).toContain('height="44"');
    expect(html).toContain("color:#4299e1");
    expect(html).toContain("Info &amp; more");
    expect(html).not.toContain("border-radius");
  });

  it("accepts a custom size", () => {
    const html = buildEmailStatusBadgeImageHtml({
      imageUrl: "https://tickets.example.com/assets/notification-badge-info.png",
      size: 88,
      labelColor: "#4299e1",
      labelText: "Info",
    });
    expect(html).toContain('width="88"');
    expect(html).toContain('height="88"');
  });
});

describe("buildEmailBoxedSectionHtml", () => {
  it("renders the escaped label and inner HTML verbatim", () => {
    const html = buildEmailBoxedSectionHtml({
      label: "Details & more",
      innerHtml: "<div>UNIQUE_INNER_MARKER</div>",
    });
    expect(html).toContain("Details &amp; more");
    expect(html).toContain("UNIQUE_INNER_MARKER");
  });
});

describe("buildBulletproofButtonHtml", () => {
  it("renders the ghost-table button (bgcolor + mso-padding-alt, no VML), attribute/text escaped", () => {
    const html = buildBulletproofButtonHtml({
      url: 'https://x.example.com/?a="b',
      label: "Go & See",
      backgroundColor: "#066fd1",
      textColor: "#ffffff",
    });
    expect(html).not.toContain("<!--[if mso]>");
    expect(html).not.toContain("<v:roundrect");
    expect(html).toContain('bgcolor="#066fd1"');
    expect(html).toContain("mso-padding-alt:12px 24px;");
    expect(html).toContain("<a ");
    expect(html).toContain('href="https://x.example.com/?a=&quot;b"');
    expect(html).toContain("Go &amp; See");
  });

  it("defaults padding to 12px 24px when not given", () => {
    const html = buildBulletproofButtonHtml({
      url: "https://x.example.com",
      label: "Go",
      backgroundColor: "#066fd1",
      textColor: "#ffffff",
    });
    expect(html).toContain("padding:12px 24px;mso-padding-alt:0px;");
  });

  it("accepts custom padding", () => {
    const html = buildBulletproofButtonHtml({
      url: "https://x.example.com",
      label: "Go",
      backgroundColor: "#066fd1",
      textColor: "#ffffff",
      paddingVertical: 11,
      paddingHorizontal: 30,
    });
    expect(html).toContain("mso-padding-alt:11px 30px;");
  });
});
