import { describe, expect, it } from "vitest";
import { buildNotificationEmailBodyHtml } from "../../src/channels/emailContent.js";
import { SEVERITY_COLOR, SEVERITY_LABEL } from "../../src/channels/emailTemplate.js";

function baseParams(overrides: Partial<Parameters<typeof buildNotificationEmailBodyHtml>[0]> = {}) {
  return {
    severity: "warn" as const,
    title: "Something happened",
    body: "A description of what happened.",
    metadataLine: "",
    ctaUrl: "https://tickets.example.com/account",
    ctaLabel: "Manage notifications",
    badgeImageUrl: "https://tickets.example.com/assets/notification-badge-warn.png",
    ...overrides,
  };
}

describe("buildNotificationEmailBodyHtml", () => {
  it("escapes title and body", () => {
    const html = buildNotificationEmailBodyHtml(
      baseParams({ title: "<script>alert(1)</script>", body: "A & B" }),
    );
    expect(html).not.toContain("<script>alert(1)</script>");
    expect(html).toContain("&lt;script&gt;");
    expect(html).toContain("A &amp; B");
  });

  it("omits the Details box entirely when metadataLine is empty", () => {
    const html = buildNotificationEmailBodyHtml(baseParams({ metadataLine: "" }));
    expect(html).not.toContain("Details");
  });

  it("shows the Details box with each metadata entry on its own line", () => {
    const html = buildNotificationEmailBodyHtml(
      baseParams({ metadataLine: "ip: 203.0.113.7 · country: Poland" }),
    );
    expect(html).toContain("Details");
    expect(html).toContain("<div style=\"font-size:12px;line-height:20px;color:#111827;\">ip: 203.0.113.7</div>");
    expect(html).toContain("<div style=\"font-size:12px;line-height:20px;color:#111827;\">country: Poland</div>");
  });

  it("renders the CTA link, attribute-escaped, with the given label", () => {
    const html = buildNotificationEmailBodyHtml(
      baseParams({ ctaUrl: 'https://x.example.com/?a="b', ctaLabel: "Manage notifications" }),
    );
    expect(html).toContain("href=\"https://x.example.com/?a=&quot;b\"");
    expect(html).toContain(">Manage notifications<");
  });

  it.each(["info", "warn", "error"] as const)(
    "renders the %s severity's color and label",
    (severity) => {
      const html = buildNotificationEmailBodyHtml(baseParams({ severity }));
      expect(html).toContain(SEVERITY_COLOR[severity]);
      expect(html).toContain(SEVERITY_LABEL[severity]);
    },
  );

  it("renders the badge as an <img> at the given URL, not a CSS circle/glyph", () => {
    const html = buildNotificationEmailBodyHtml(
      baseParams({ badgeImageUrl: "https://tickets.example.com/assets/notification-badge-error.png" }),
    );
    expect(html).toContain('src="https://tickets.example.com/assets/notification-badge-error.png"');
    expect(html).not.toContain("border-radius:22px");
  });
});
