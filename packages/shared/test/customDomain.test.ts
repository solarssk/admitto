import { describe, expect, it } from "vitest";
import { CUSTOM_DOMAIN_MAX, CUSTOM_DOMAIN_STATUSES, parseCustomDomain, type CustomDomainProblem } from "../src/customDomain.js";

const LONG_LABEL = "a".repeat(64);
const LABEL_63 = "a".repeat(63);
// 4 labels of 61 characters and 3 dots = 247, plus ".com" = 251: under the limit; one more label character over it.
const NAME_OF_251 = [..."abcd"].map(() => "a".repeat(61)).join(".") + ".com";

describe("the limits of an address of an event", () => {
  it("are the ones the server and the panel both keep to", () => {
    expect(CUSTOM_DOMAIN_MAX).toBe(253);
    expect([...CUSTOM_DOMAIN_STATUSES]).toEqual(["unchecked", "ok", "failing"]);
  });
});

describe("parseCustomDomain: what is accepted, and the form it is stored in", () => {
  it.each([
    ["a plain name", "events.example.com", "events.example.com"],
    ["a name in capitals (stored in lower case)", "EXAMPLE.com", "example.com"],
    ["a mixed-case subdomain", "Event1.Example.COM", "event1.example.com"],
    ["a name outside ASCII (stored as punycode)", "münchen.de", "xn--mnchen-3ya.de"],
    ["a name that is punycode already", "xn--mnchen-3ya.de", "xn--mnchen-3ya.de"],
    ["a full-width name (the browser's own mapping)", "ｅｘａｍｐｌｅ.com", "example.com"],
    ["two labels, the shortest", "a.b", "a.b"],
    ["a label of 63 characters", `${LABEL_63}.com`, `${LABEL_63}.com`],
    ["a name of 251 characters", NAME_OF_251, NAME_OF_251],
    ["a hyphen inside a label", "my-event.example.com", "my-event.example.com"],
    ["digits in a label", "2027.example.com", "2027.example.com"],
    ["a top-level label with a digit that starts with a letter", "a.c0m", "a.c0m"],
  ])("%s", (_what, raw, stored) => {
    expect(parseCustomDomain(raw)).toEqual({ ok: true, domain: stored });
  });
});

describe("parseCustomDomain: what is refused, and why", () => {
  const refused: [string, string, CustomDomainProblem][] = [
    ["nothing", "", "empty"],
    ["a scheme", "https://x.com", "bad_characters"],
    ["a scheme without the slashes", "https:x.com", "bad_characters"],
    ["a port", "x.com:8080", "bad_characters"],
    ["a path", "x.com/path", "bad_characters"],
    ["a trailing slash", "x.com/", "bad_characters"],
    ["a query", "x.com?q=1", "bad_characters"],
    ["a fragment", "x.com#f", "bad_characters"],
    ["user information", "user@x.com", "bad_characters"],
    ["user information with a password", "user:secret@x.com", "bad_characters"],
    ["a space inside", "ex ample.com", "bad_characters"],
    ["a space around", " x.com", "bad_characters"],
    ["a line break", "x.com\n", "bad_characters"],
    ["a null character", "x.com\u0000", "bad_characters"],
    ["a tab", "x.\tcom", "bad_characters"],
    ["a backslash", "x\\y.com", "bad_characters"],
    ["an escaped dot", "x%2e.com", "bad_characters"],
    ["a protocol-relative address", "//x.com", "bad_characters"],
    ["an underscore", "a_b.com", "bad_characters"],
    ["a soft hyphen", "ex­ample.com", "bad_characters"],
    ["a right-to-left override", "‮evil.com", "bad_characters"],
    ["an ideographic full stop", "x。com", "bad_characters"],
    ["an IPv6 address", "[::1]", "bad_characters"],
    ["an IPv6 address without brackets", "::1", "bad_characters"],
    ["an IPv4 address", "1.2.3.4", "ip_address"],
    ["a short IPv4 address", "127.1", "ip_address"],
    ["an IPv4 address in hex", "0x7f.1", "ip_address"],
    ["a number", "2130706433", "ip_address"],
    ["a name that ends in a number", "x.123", "bad_label"],
    ["a name that ends in a hex number", "a.0x1", "bad_label"],
    ["a trailing dot", "x.com.", "trailing_dot"],
    ["only a dot", ".", "trailing_dot"],
    ["a leading dot", ".x.com", "bad_label"],
    ["an empty label inside", "x..com", "bad_label"],
    ["a label that starts with a hyphen", "-x.com", "bad_label"],
    ["a label that ends with a hyphen", "x-.com", "bad_label"],
    ["a top-level label that ends with a hyphen", "a.com-", "bad_label"],
    ["a label of 64 characters", `${LONG_LABEL}.com`, "bad_label"],
    ["punycode that is not valid", "xn--a.com", "bad_label"],
    ["a punycode label of nothing", "xn--.com", "bad_label"],
    ["a name of 254 characters", "a".repeat(250) + ".com", "too_long"],
    ["a very long value", "a".repeat(5000), "too_long"],
    ["a single label", "example", "no_dot"],
    ["localhost", "localhost", "reserved"],
    ["localhost in capitals", "LOCALHOST", "reserved"],
    ["a name under localhost", "app.localhost", "reserved"],
    ["a name under .local", "printer.local", "reserved"],
    ["a name under .internal", "tickets.corp.internal", "reserved"],
  ];

  it.each(refused)("%s", (_what, raw, problem) => {
    expect(parseCustomDomain(raw)).toEqual({ ok: false, problem });
  });

  it("does not read a path or an authority that follows a name the parser would cut off", () => {
    // Every one of these is a name with something after it that a URL parser would drop: none may come back as `x.com`.
    for (const raw of ["x.com/a", "x.com\\a", "x.com?a", "x.com#a", "x.com@evil.com", "evil.com@x.com", "x.com:80", "x.com%00"]) {
      expect(parseCustomDomain(raw).ok, raw).toBe(false);
    }
  });

  it("gives the same answer to a name in capitals as to the one in lower case", () => {
    expect(parseCustomDomain("EVENTS.EXAMPLE.COM")).toEqual(parseCustomDomain("events.example.com"));
    expect(parseCustomDomain("APP.LOCALHOST")).toEqual(parseCustomDomain("app.localhost"));
  });
});
