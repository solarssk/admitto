import { describe, expect, it } from "vitest";
import { formatFromHeader, parseAddressList, quoteDisplayName, resolveReplyTo } from "../src/senderUtils.js";

describe("formatFromHeader", () => {
  it("quotes display names for RFC5322 safety", () => {
    expect(formatFromHeader({ fromAddress: "a@example.com", fromName: "Admitto Events" })).toBe(
      '"Admitto Events" <a@example.com>',
    );
    expect(formatFromHeader({ fromAddress: "a@example.com", fromName: 'Acme "HQ"' })).toBe(
      '"Acme \\"HQ\\"" <a@example.com>',
    );
    expect(formatFromHeader({ fromAddress: "a@example.com", fromName: 'Acme \\ "HQ"' })).toBe(
      '"Acme \\\\ \\"HQ\\"" <a@example.com>',
    );
  });

  it("quoteDisplayName escapes embedded quotes", () => {
    expect(quoteDisplayName('Team, Inc.')).toBe('"Team, Inc."');
  });
});

describe("resolveReplyTo", () => {
  it("prefers non-empty message replyTo over config", () => {
    expect(resolveReplyTo("config@example.com", { to: "a@example.com", subject: "s", html: "", replyTo: "msg@example.com" })).toBe(
      "msg@example.com",
    );
  });

  it("falls back to config when message replyTo is empty", () => {
    expect(resolveReplyTo("config@example.com", { to: "a@example.com", subject: "s", html: "", replyTo: "" })).toBe(
      "config@example.com",
    );
  });
});

describe("parseAddressList", () => {
  it("splits plain comma-separated addresses", () => {
    expect(parseAddressList("a@example.com, b@example.com")).toEqual([
      "a@example.com",
      "b@example.com",
    ]);
  });

  it("handles quoted display names with commas (RFC5322)", () => {
    expect(parseAddressList('"Kowalski, Jan" <jan@example.com>, b@example.com')).toEqual([
      "jan@example.com",
      "b@example.com",
    ]);
  });

  it("extracts address from angle-addr form", () => {
    expect(parseAddressList("Admitto Events <events@example.com>")).toEqual(["events@example.com"]);
  });
});
