import { describe, expect, it } from "vitest";
import { parseAddressList, resolveReplyTo } from "../src/senderUtils.js";

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
