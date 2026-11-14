// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import {
  LINK_NOT_ALLOWED_MESSAGE,
  legalLinkFromInput,
  legalTextIsBlank,
  normalizeLegalHtml,
  safeLegalHref,
} from "../../src/registration/legalHtml.js";

describe("safeLegalHref", () => {
  it.each([
    ["https://example.com/page", "https://example.com/page"],
    ["http://example.com", "http://example.com/"],
    ["HTTPS://EXAMPLE.COM", "https://example.com/"],
    ["  https://example.com/a b  ", "https://example.com/a%20b"],
    ["mailto:privacy@example.com", "mailto:privacy@example.com"],
    ["https://example.com/?a=1&b=2#top", "https://example.com/?a=1&b=2#top"],
  ])("keeps %j as %j", (raw, href) => {
    expect(safeLegalHref(raw)).toBe(href);
  });

  it.each([
    "javascript:alert(1)",
    "JaVaScRiPt:alert(1)",
    "java\tscript:alert(1)",
    "data:text/html,<script>alert(1)</script>",
    "vbscript:msgbox(1)",
    "tel:+48123456789",
    "ftp://example.com/file",
    "//example.com/path",
    "/relative/path",
    "example.com",
    "https://trusted.example@evil.example/",
    "https://user:secret@example.com/",
    "",
    "   ",
  ])("refuses %j", (raw) => {
    expect(safeLegalHref(raw)).toBeNull();
  });
});

describe("legalLinkFromInput", () => {
  it.each([
    ["https://example.com", "https://example.com/"],
    ["example.com", "https://example.com/"],
    ["www.example.com/privacy", "https://www.example.com/privacy"],
    ["privacy@example.com", "mailto:privacy@example.com"],
    ["mailto:privacy@example.com", "mailto:privacy@example.com"],
    ["  http://example.com/a  ", "http://example.com/a"],
  ])("turns %j into %j", (input, href) => {
    expect(legalLinkFromInput(input)).toEqual({ href });
  });

  it("asks for an address when there is none", () => {
    expect(legalLinkFromInput("   ")).toEqual({ error: "Enter a link address." });
  });

  it.each(["javascript:alert(1)", "data:text/html,hello", "vbscript:msgbox(1)", "tel:+48123456789", "ftp://example.com", "https://user:secret@example.com"])(
    "refuses %j with the message about allowed links",
    (input) => {
      expect(legalLinkFromInput(input)).toEqual({ error: LINK_NOT_ALLOWED_MESSAGE });
    },
  );

  it("does not take an address with spaces in it for an email address", () => {
    expect(legalLinkFromInput("not an@email.com")).toEqual({ error: LINK_NOT_ALLOWED_MESSAGE });
  });
});

describe("normalizeLegalHtml", () => {
  it("writes a link the way the server stores it", () => {
    expect(normalizeLegalHtml('<p><a href="https://example.com">site</a></p>')).toBe('<p><a href="https://example.com/">site</a></p>');
  });

  it("keeps the words of a link that is not allowed and drops the link", () => {
    expect(normalizeLegalHtml('<p>See <a href="javascript:alert(1)">this <strong>page</strong></a> and <a href="tel:+48123">call</a>.</p>')).toBe(
      "<p>See this <strong>page</strong> and call.</p>",
    );
    expect(normalizeLegalHtml('<p><a href="">nothing</a><a>none</a></p>')).toBe("<p>nothingnone</p>");
  });

  it("puts the words of a list item that holds one paragraph straight in the item", () => {
    expect(normalizeLegalHtml("<ul><li><p>One</p></li><li><p>Two</p></li></ul>")).toBe("<ul><li>One</li><li>Two</li></ul>");
    expect(normalizeLegalHtml("<ul><li><p>Parent</p><ul><li><p>Child</p></li></ul></li></ul>")).toBe(
      "<ul><li>Parent<ul><li>Child</li></ul></li></ul>",
    );
  });

  it("leaves an item with several paragraphs as it is", () => {
    const html = "<ul><li><p>One</p><p>Two</p></li></ul>";
    expect(normalizeLegalHtml(html)).toBe(html);
  });

  it("gives the same text when it is applied again", () => {
    const once = normalizeLegalHtml('<h2>T</h2><ul><li><p>a <a href="http://example.com">b</a></p></li></ul>');
    expect(normalizeLegalHtml(once)).toBe(once);
  });

  it("reads the text without running anything in it", () => {
    let ran = false;
    (window as unknown as { __ran: () => void }).__ran = () => {
      ran = true;
    };
    normalizeLegalHtml('<img src="x" onerror="window.__ran()"><script>window.__ran()</script><p>text</p>');
    expect(ran).toBe(false);
  });
});

describe("legalTextIsBlank", () => {
  it.each(["", "   ", "\n\t", "\u00a0", "\u200b\u2060\ufeff", " \u200d "])("treats %j as no text", (text) => {
    expect(legalTextIsBlank(text)).toBe(true);
  });

  it.each(["a", " a ", "\u200bx", "0", "😀"])("treats %j as text", (text) => {
    expect(legalTextIsBlank(text)).toBe(false);
  });
});
