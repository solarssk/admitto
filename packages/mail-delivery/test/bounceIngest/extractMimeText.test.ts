import { describe, expect, it } from "vitest";
import {
  extractPlainTextFromSource,
  extractReferencedMessageIds,
  stripHtmlTagsSafely,
} from "../../src/bounceIngest/extractMimeText.js";
import { parseBounceLines } from "../../src/bounceIngest/parseBounceLine.js";
import {
  iso8859QpNdr,
  multipartReportDsn,
  utf8QpSoftWrapNdr,
  windows1252QpNdr,
} from "./fixtures/ndrSamples.js";

describe("extractPlainTextFromSource (libmime stack)", () => {
  it("decodes ISO-8859-1 quoted-printable diagnostics", () => {
    const text = extractPlainTextFromSource(iso8859QpNdr());
    expect(text).toContain("boîte");
    expect(text).toContain("user@example.com failed:");
  });

  it("joins soft-wrapped QP lines before bounce parsing", () => {
    const text = extractPlainTextFromSource(utf8QpSoftWrapNdr());
    expect(text).toMatch(/said:\s*550/);
    expect(text).not.toMatch(/=\nsaid/);
    const lines = parseBounceLines(text);
    expect(lines[0]).toMatchObject({
      recipientEmail: "user@example.com",
      smtpCode: "550",
    });
  });

  it("keeps message/delivery-status from multipart/report", () => {
    const text = extractPlainTextFromSource(multipartReportDsn());
    expect(text).toContain("Final-Recipient: rfc822; nobody@example.org");
    expect(text).toContain("Diagnostic-Code: smtp; 550 5.1.1 User unknown");
    const lines = parseBounceLines(text);
    expect(lines[0]?.recipientEmail).toBe("nobody@example.org");
  });

  it("decodes windows-1252 charset via iconv-lite", () => {
    const text = extractPlainTextFromSource(windows1252QpNdr());
    expect(text).toContain("boîte");
  });

  it("decodes RFC 2047 encoded-words in headers without corrupting the body", () => {
    const text = extractPlainTextFromSource(iso8859QpNdr());
    // Body remains parseable even when Subject is encoded.
    expect(parseBounceLines(text)[0]?.recipientEmail).toBe("user@example.com");
  });

  it("preserves UTF-8 non-ASCII when the source is a JS string (8bit body)", () => {
    const source = [
      "MIME-Version: 1.0",
      'Content-Type: text/plain; charset="utf-8"',
      "Content-Transfer-Encoding: 8bit",
      "",
      "user@example.com failed: host mx.example.com said: 550 5.1.1 boîte inconnue",
    ].join("\r\n");
    const text = extractPlainTextFromSource(source);
    expect(text).toContain("boîte");
    expect(text).not.toContain("\uFFFD");
  });

  it("decodes hex HTML entities in HTML-only bodies", () => {
    const source = [
      "Content-Type: text/html; charset=utf-8",
      "",
      "<p>550 5.1.1 bo&#xEE;te inconnue for user@example.com</p>",
    ].join("\r\n");
    expect(extractPlainTextFromSource(source)).toContain("boîte");
  });

  it("falls back to UTF-8 when Content-Type charset is unknown", () => {
    const plain = "user@example.com failed: host mx.example.com said: 550 5.1.1 User unknown";
    const source = [
      "Content-Type: text/plain; charset=x-no-such-charset",
      "Content-Transfer-Encoding: 8bit",
      "",
      plain,
    ].join("\r\n");
    expect(extractPlainTextFromSource(source)).toContain("550 5.1.1");
  });

  it("uses fallback body text when MIME leaves are empty", () => {
    const source = [
      "Content-Type: application/octet-stream",
      "",
      "user@example.com failed: host mx.example.com said: 550 5.1.1 User unknown",
    ].join("\r\n");
    expect(extractPlainTextFromSource(source)).toContain("user@example.com failed:");
  });

  it("strips HTML fallback when the body looks like HTML without a mime leaf", () => {
    const source = "<html><body><p>nobody@example.org failed: host mx said: 550 5.1.1</p></body></html>";
    const text = extractPlainTextFromSource(source);
    expect(text).toContain("nobody@example.org failed:");
    expect(text).not.toContain("<p>");
  });

  it("skips empty multipart segments and closing boundary markers", () => {
    const source = [
      'Content-Type: multipart/mixed; boundary="bnd"',
      "",
      "--bnd",
      "",
      "--bnd",
      "Content-Type: text/plain; charset=utf-8",
      "",
      "user@example.com failed: host mx.example.com said: 550 5.1.1 User unknown",
      "--bnd--",
      "",
    ].join("\r\n");
    expect(extractPlainTextFromSource(source)).toContain("550 5.1.1");
  });
});

describe("stripHtmlTagsSafely", () => {
  it("removes opening, closing, self-closing and attribute-carrying tags", () => {
    const html = '<div class="a"><p>Hello <b>there</b></p><img src="x.png" /><hr/><br>next</div>';

    expect(stripHtmlTagsSafely(html)).toBe("Hello there\nnext");
  });

  it("keeps a literal address in angle brackets, which is not tag syntax", () => {
    expect(stripHtmlTagsSafely("<p>Contact <user@example.com> now</p>")).toBe("Contact <user@example.com> now");
  });

  it("leaves malformed tags alone instead of guessing", () => {
    // No closing '>', a slash in the middle of the tag, and a digit where a name must start.
    expect(stripHtmlTagsSafely("<a href=x")).toBe("<a href=x");
    expect(stripHtmlTagsSafely("x <a/b> y")).toBe("x <a/b> y");
    expect(stripHtmlTagsSafely("1 < 2 and <3 and 4>")).toBe("1 < 2 and <3 and 4>");
  });

  it("stays fast on unclosed or repeated tag openings", () => {
    const started = performance.now();

    expect(stripHtmlTagsSafely(`<${"a".repeat(200_000)}`)).toHaveLength(200_001);
    expect(stripHtmlTagsSafely("<a ".repeat(100_000))).toBe("<a ".repeat(100_000).trim().replace(/[ \t]+/g, " "));
    expect(stripHtmlTagsSafely(`<a ${"x ".repeat(100_000)}`)).toContain("<a x x");
    expect(performance.now() - started).toBeLessThan(2000);
  });
});

describe("extractReferencedMessageIds", () => {
  it("collects ids from Message-ID, In-Reply-To and folded References headers, lower-cased", () => {
    const source = [
      "Message-ID: <Outer@bounce.example.com>",
      "Subject: Undelivered",
      "",
      "Original headers follow:",
      "Message-ID: <Orig123@mail.example.com>",
      "References: <a@x.test>",
      "\t<B@x.test>",
      "Subject: Message-ID: <not-a-header@x.test>",
      "X-Other: <ignored@x.test>",
    ].join("\r\n");
    expect(extractReferencedMessageIds(source)).toEqual([
      "<outer@bounce.example.com>",
      "<orig123@mail.example.com>",
      "<a@x.test>",
      "<b@x.test>",
    ]);
  });

  it("reads ids from a base64-encoded quoted original, which the raw scan cannot see", () => {
    const original = "Message-ID: <Encoded@mail.example.com>\r\nSubject: hi\r\n";
    const source = [
      "Message-ID: <outer@bounce.example.com>",
      'Content-Type: multipart/report; report-type=delivery-status; boundary="b1"',
      "",
      "--b1",
      "Content-Type: text/plain",
      "",
      "Undeliverable",
      "--b1",
      "Content-Type: text/rfc822-headers",
      "Content-Transfer-Encoding: base64",
      "",
      Buffer.from(original).toString("base64"),
      "--b1--",
    ].join("\r\n");
    expect(extractReferencedMessageIds(source)).toEqual([
      "<outer@bounce.example.com>",
      "<encoded@mail.example.com>",
    ]);
  });

  it("ignores folded lines of other headers and header lines without an id", () => {
    const source = ["Subject: x", "\t<folded@x.test>", "Message-ID: no-angle-brackets", "References:", "\t<ok@x.test>"].join("\r\n");
    expect(extractReferencedMessageIds(source)).toEqual(["<ok@x.test>"]);
  });

  it("returns an empty list for missing or header-free input and caps the count", () => {
    expect(extractReferencedMessageIds(undefined)).toEqual([]);
    expect(extractReferencedMessageIds("just text")).toEqual([]);
    const many = Array.from({ length: 80 }, (_, i) => `<${i}@x.test>`).join(" ");
    expect(extractReferencedMessageIds(`References: ${many}`)).toHaveLength(50);
  });
});
