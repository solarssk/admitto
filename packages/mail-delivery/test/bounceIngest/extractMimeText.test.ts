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
});
