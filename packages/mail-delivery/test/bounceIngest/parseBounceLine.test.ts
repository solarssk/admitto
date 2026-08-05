import { describe, expect, it } from "vitest";
import { parseBounceLines, parseRfc3464DsnBlocks } from "../../src/bounceIngest/parseBounceLine.js";
import { extractPlainTextFromSource } from "../../src/bounceIngest/imapProvider.js";

const ADR_SAMPLE =
  "user.unknown@example.com failed: host outbound.example.com (203.0.113.10) said: 550 5.1.1 user.unknown@example.com: Recipient address rejected: User unknown (in reply to RCPT TO command)";

/** Synthetic RFC 3464 multipart/report (no real personal data). */
const MULTIPART_DSN = [
  "Return-Path: <>",
  "From: Mail Delivery Subsystem <mailer-daemon@example.net>",
  "Subject: Undelivered Mail Returned to Sender",
  "MIME-Version: 1.0",
  'Content-Type: multipart/report; report-type=delivery-status; boundary="DSN-BOUNDARY"',
  "",
  "--DSN-BOUNDARY",
  "Content-Type: text/plain; charset=utf-8",
  "",
  "I'm sorry to have to inform you that your message could not be delivered.",
  "",
  "--DSN-BOUNDARY",
  "Content-Type: message/delivery-status",
  "",
  "Reporting-MTA: dns; mx.example.net",
  "",
  "Final-Recipient: rfc822; nobody@example.org",
  "Original-Recipient: rfc822; nobody@example.org",
  "Action: failed",
  "Status: 5.1.1",
  "Diagnostic-Code: smtp; 550 5.1.1 User unknown",
  "",
  "--DSN-BOUNDARY",
  "Content-Type: text/rfc822-headers",
  "",
  "To: nobody@example.org",
  "Subject: Admitto mail transport test",
  "",
  "--DSN-BOUNDARY--",
].join("\r\n");

describe("parseBounceLines", () => {
  it("parses the ADR Postfix-style diagnostic line", () => {
    const lines = parseBounceLines(`Some forward preface\n${ADR_SAMPLE}\n`);
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatchObject({
      recipientEmail: "user.unknown@example.com",
      smtpCode: "550",
      enhancedCode: "5.1.1",
    });
    expect(lines[0]!.reason.toLowerCase()).toContain("user unknown");
  });

  it("parses without an enhanced status code", () => {
    const body =
      "a@example.com failed: host mx.example.com (198.51.100.1) said: 550 a@example.com: mailbox unavailable (in reply to RCPT TO command)";
    const lines = parseBounceLines(body);
    expect(lines).toHaveLength(1);
    expect(lines[0]!.smtpCode).toBe("550");
    expect(lines[0]!.enhancedCode).toBeUndefined();
  });

  it("returns multiple recipients from one body", () => {
    const body = `${ADR_SAMPLE}\nother@example.com failed: host mx.example.com (198.51.100.2) said: 552 5.2.2 other@example.com: Mailbox full (in reply to RCPT TO command)`;
    const lines = parseBounceLines(body);
    expect(lines.length).toBeGreaterThanOrEqual(2);
    const emails = lines.map((l) => l.recipientEmail);
    expect(emails).toContain("user.unknown@example.com");
    expect(emails).toContain("other@example.com");
  });

  it("accepts CRLF line endings", () => {
    const lines = parseBounceLines(`intro\r\n${ADR_SAMPLE}\r\n`);
    expect(lines).toHaveLength(1);
  });

  it("returns empty list when nothing matches", () => {
    expect(parseBounceLines("Hello, your package shipped.")).toEqual([]);
    expect(parseBounceLines("")).toEqual([]);
  });

  it("parses mailhop orphan failed: line with Final-Recipient", () => {
    const body = [
      "Final-Recipient: rfc822; nobody@example.org",
      "Action: failed",
      "Status: 5.1.1",
      "",
      "failed: host mx.example.org (203.0.113.10) said: 550 5.1.1 : Recipient address rejected: User unknown in local recipient table (in reply to RCPT command)",
    ].join("\n");
    const lines = parseBounceLines(body);
    expect(lines.length).toBeGreaterThanOrEqual(1);
    expect(lines.some((l) => l.recipientEmail === "nobody@example.org" && l.smtpCode === "550")).toBe(
      true,
    );
  });

  it("parses Postfix angle-bracket diagnostic", () => {
    const body =
      "<nobody@example.org>: host mx.example.org[203.0.113.10] said: 550 5.1.1 <nobody@example.org>: Recipient address rejected: User unknown in local recipient table";
    const lines = parseBounceLines(body);
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatchObject({
      recipientEmail: "nobody@example.org",
      smtpCode: "550",
      enhancedCode: "5.1.1",
    });
  });

  it("parses orphan failed: when the address is a few lines above", () => {
    const body = [
      "The following address failed:",
      "nobody@example.org",
      "",
      "failed: host mx.example.org (203.0.113.10) said: 550 5.1.1 : Recipient address rejected: User unknown in local recipient table (in reply to RCPT command)",
    ].join("\n");
    const lines = parseBounceLines(body);
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatchObject({
      recipientEmail: "nobody@example.org",
      smtpCode: "550",
      enhancedCode: "5.1.1",
    });
  });

  it("parses RFC 3464 DSN fields including Original-Recipient preference", () => {
    const body = [
      "Reporting-MTA: dns; mx.example.net",
      "",
      "Final-Recipient: rfc822; alias@example.org",
      "Original-Recipient: rfc822; nobody@example.org",
      "Action: failed",
      "Status: 5.1.1",
      "Diagnostic-Code: smtp; 550 5.1.1 User unknown",
    ].join("\n");
    const lines = parseRfc3464DsnBlocks(body);
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatchObject({
      recipientEmail: "nobody@example.org",
      smtpCode: "550",
      enhancedCode: "5.1.1",
    });
    expect(lines[0]!.reason.toLowerCase()).toContain("user unknown");
  });

  it("treats Action delayed as soft (4xx) for applyBounceResult", () => {
    const body = [
      "Final-Recipient: rfc822; full@example.org",
      "Action: delayed",
      "Status: 4.2.2",
      "Diagnostic-Code: smtp; 452 4.2.2 Mailbox full",
    ].join("\n");
    const lines = parseRfc3464DsnBlocks(body);
    expect(lines).toHaveLength(1);
    expect(lines[0]!.smtpCode.startsWith("4")).toBe(true);
  });

  it("ignores delivered Action blocks", () => {
    const body = [
      "Final-Recipient: rfc822; ok@example.org",
      "Action: delivered",
      "Status: 2.0.0",
    ].join("\n");
    expect(parseRfc3464DsnBlocks(body)).toEqual([]);
  });

  it("treats Action delayed with a 5xx diagnostic as soft (4xx class)", () => {
    const body = [
      "Final-Recipient: rfc822; full@example.org",
      "Action: delayed",
      "Status: 5.2.2",
      "Diagnostic-Code: smtp; 552 5.2.2 Mailbox full",
    ].join("\n");
    const lines = parseRfc3464DsnBlocks(body);
    expect(lines).toHaveLength(1);
    expect(lines[0]!.smtpCode).toBe("452");
    expect(lines[0]!.smtpCode.startsWith("4")).toBe(true);
  });

  it("accepts a 5.x Status when Action is missing", () => {
    const body = [
      "Final-Recipient: rfc822; user@example.org",
      "Status: 5.1.1",
      "Diagnostic-Code: smtp; 550 5.1.1 User unknown",
    ].join("\n");
    const lines = parseRfc3464DsnBlocks(body);
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatchObject({
      recipientEmail: "user@example.org",
      smtpCode: "550",
      enhancedCode: "5.1.1",
    });
  });

  it("parses an angled Final-Recipient address", () => {
    const body = [
      "Final-Recipient: rfc822; <angle@example.org>",
      "Action: failed",
      "Status: 5.1.1",
      "Diagnostic-Code: smtp; 550 5.1.1 User unknown",
    ].join("\n");
    const lines = parseRfc3464DsnBlocks(body);
    expect(lines).toHaveLength(1);
    expect(lines[0]!.recipientEmail).toBe("angle@example.org");
  });

  it("deduplicates identical parsed lines", () => {
    const duplicate = `${ADR_SAMPLE}\n${ADR_SAMPLE}`;
    expect(parseBounceLines(duplicate)).toHaveLength(1);
  });

  it("skips postmaster and mailhop.org when inferring a recipient from angle brackets", () => {
    const body = [
      "failed: host mx.example.org (203.0.113.10) said: 550 5.1.1 : Recipient address rejected (in reply to RCPT command)",
      "",
      "<postmaster@example.org>",
      "<relay@something.mailhop.org>",
    ].join("\n");
    const lines = parseBounceLines(body);
    expect(lines).toHaveLength(0);
  });

  it("ignores relayed and expanded DSN actions", () => {
    const relayed = [
      "Final-Recipient: rfc822; ok@example.org",
      "Action: relayed",
      "Status: 2.0.0",
    ].join("\n");
    const expanded = [
      "Final-Recipient: rfc822; list@example.org",
      "Action: expanded",
      "Status: 2.0.0",
    ].join("\n");
    expect(parseRfc3464DsnBlocks(relayed)).toEqual([]);
    expect(parseRfc3464DsnBlocks(expanded)).toEqual([]);
  });

  it("accepts a 4.x Status when Action is missing", () => {
    const body = [
      "Final-Recipient: rfc822; grey@example.org",
      "Status: 4.2.1",
      "Diagnostic-Code: smtp; 451 4.2.1 Greylisted",
    ].join("\n");
    const lines = parseRfc3464DsnBlocks(body);
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatchObject({
      recipientEmail: "grey@example.org",
      smtpCode: "451",
      enhancedCode: "4.2.1",
    });
  });

  it("derives smtp code from Status when Diagnostic-Code has no 3-digit SMTP code", () => {
    const body = [
      "Final-Recipient: rfc822; user@example.org",
      "Action: failed",
      "Status: 5.1.1",
      "Diagnostic-Code: smtp; User unknown",
    ].join("\n");
    const lines = parseRfc3464DsnBlocks(body);
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatchObject({
      recipientEmail: "user@example.org",
      smtpCode: "500",
      enhancedCode: "5.1.1",
    });
    expect(lines[0]!.reason).toMatch(/User unknown|DSN status 5\.1\.1/);
  });

  it("returns empty list for empty DSN input", () => {
    expect(parseRfc3464DsnBlocks("")).toEqual([]);
  });
});

/**
 * Synthetic mailhop/Synology-style bounce: multipart/alternative, both parts
 * quoted-printable with soft line breaks mid-diagnostic-line, and the
 * recipient address present only in the HTML part as an unescaped
 * `<address>failed:` run (no colon, no space). Reproduces a real NDR shape
 * without any real personal data.
 */
const QP_MAILHOP_ALTERNATIVE = [
  "Return-Path: <>",
  "From: Mail Delivery Subsystem <postmaster@mailhop.example>",
  "Subject: Undeliverable: Admitto mail transport test",
  "MIME-Version: 1.0",
  'Content-Type: multipart/alternative; boundary="QP-BOUNDARY"',
  "",
  "--QP-BOUNDARY",
  'Content-Type: text/plain; charset="us-ascii"',
  "Content-Transfer-Encoding: quoted-printable",
  "",
  "This is the mail system at host outbound.mailhop.example. I'm sorry to ha=",
  "ve to inform you that your message could not be delivered. It's attached=",
  " below. failed: host mx.example.org (203.0.113.10) =",
  "said: 550 5.7.1 Error: exceeded unknown recipient count limit=",
  " (in reply to RCPT command)",
  "",
  "",
  "-------------- CONFIDENTIALITY NOTICE: this message may contain confident=",
  "ial information. If you received it in error, please delete it.",
  "-----------------",
  "",
  "--QP-BOUNDARY",
  'Content-Type: text/html; charset="us-ascii"',
  "Content-Transfer-Encoding: quoted-printable",
  "",
  "<html><body><p>This is the mail system. It's attached below.",
  "<nobody@example.org>failed: host mx.example.org (203.0.113.10)=",
  " said: 550 5.7.1 Error: exceeded unknown recipient count limi=",
  "t (in reply to RCPT command)</p>",
  "<br><br>",
  "<em><font size=3D\"1\">-------------- CONFIDENTIALITY NOTICE: this messag=",
  "e may contain confidential informacj&#347;a. If you received it in error,=",
  " please delete it.<br>",
  "-----------------</font></em>",
  "</body></html>",
  "",
  "--QP-BOUNDARY--",
].join("\r\n");

describe("extractPlainTextFromSource", () => {
  it("includes message/delivery-status from a multipart/report DSN", () => {
    const text = extractPlainTextFromSource(MULTIPART_DSN);
    expect(text).toContain("Final-Recipient: rfc822; nobody@example.org");
    expect(text).toContain("Diagnostic-Code: smtp; 550 5.1.1 User unknown");
    const lines = parseBounceLines(text);
    expect(lines.some((l) => l.recipientEmail === "nobody@example.org" && l.smtpCode === "550")).toBe(
      true,
    );
  });

  it("decodes quoted-printable soft line breaks and keeps a bracketed address from HTML", () => {
    const text = extractPlainTextFromSource(QP_MAILHOP_ALTERNATIVE);
    // Soft line breaks must be gone (no stray "=" left mid diagnostic line).
    expect(text).not.toContain("=\n");
    expect(text).toContain("said: 550 5.7.1 Error: exceeded unknown recipient count limit");
    // The HTML part's <address> survives tag-stripping (it is not a real tag).
    expect(text).toContain("<nobody@example.org>failed:");
    // A confidentiality disclaimer's HTML entity (e.g. "&#347;" for "ś") is decoded, not
    // left as a literal numeric reference.
    expect(text).not.toContain("&#347;");

    const lines = parseBounceLines(text);
    expect(
      lines.some(
        (l) =>
          l.recipientEmail === "nobody@example.org" &&
          l.smtpCode === "550" &&
          l.enhancedCode === "5.7.1",
      ),
    ).toBe(true);
    // Regression: a confidentiality disclaimer/other paragraph after the diagnostic line
    // (common in real NDRs, e.g. Outlook/Exchange auto-replies) must not leak into `reason` -
    // collapsing HTML line breaks to spaces removed the newline `parseBounceLine`'s `$`-anchored
    // reason capture needs to stop at, and the whole disclaimer became part of the reason.
    for (const line of lines) {
      expect(line.reason).not.toMatch(/confidentiality notice/i);
    }
  });
});
