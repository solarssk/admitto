import { describe, expect, it } from "vitest";
import { extractPlainTextFromSource } from "../../src/bounceIngest/extractMimeText.js";
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
