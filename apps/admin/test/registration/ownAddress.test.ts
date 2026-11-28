import { describe, expect, it } from "vitest";
import { CUSTOM_DOMAIN_CHECK_RESULTS, type CustomDomainCheckResult } from "@admitto/shared";
import type { CustomDomainDto, RegistrationOwnAddressDto } from "../../src/api/types.js";
import { addressStatusLine, checkAdvice, hasStopped, judgeAddressInput, ownAddressOf, stoppedWarning } from "../../src/registration/ownAddress.js";

const HOST = "tickets.example.com";

const address = (overrides: Partial<RegistrationOwnAddressDto> = {}): RegistrationOwnAddressDto => ({
  domain: "summit.acme.example",
  status: "unchecked",
  check_result: null,
  verified: false,
  checked_at: null,
  ...overrides,
});

describe("judgeAddressInput: what was typed, judged as the server judges it", () => {
  it("accepts a name, in lower case and without the spaces around it", () => {
    expect(judgeAddressInput("  Summit.ACME.example ", HOST)).toEqual({ ok: true, domain: "summit.acme.example" });
  });

  it.each([
    ["", "Enter an address."],
    ["https://summit.acme.example", "Enter the host name only, such as events.example.com: no https://, port, path or spaces."],
    ["summit.acme.example/path", "Enter the host name only, such as events.example.com: no https://, port, path or spaces."],
    ["1.2.3.4", "Enter a name, not an IP address."],
    ["summit.acme.example.", "Leave out the dot at the end."],
    ["summit", "The name needs a dot, such as events.example.com."],
    ["printer.local", "This name only works inside a network. Guests need a public name."],
    ["-a.example.com", "A part of the name between dots is not valid. Use letters, digits and hyphens, and do not start or end a part with a hyphen."],
    [`${"a".repeat(250)}.com`, "An address can have at most 253 characters."],
  ])("refuses %j with its own sentence", (typed, message) => {
    expect(judgeAddressInput(typed, HOST)).toEqual({ ok: false, message });
  });

  it("refuses the host of this instance, however it is written", () => {
    const refused = { ok: false, message: "This is the address of this instance. Guests need an address of their own for this event." };
    expect(judgeAddressInput("tickets.example.com", HOST)).toEqual(refused);
    expect(judgeAddressInput("TICKETS.Example.com", HOST)).toEqual(refused);
  });

  it("refuses no host for an instance with no address", () => {
    expect(judgeAddressInput("tickets.example.com", null)).toEqual({ ok: true, domain: "tickets.example.com" });
  });
});

describe("hasStopped: an address that worked and no longer does", () => {
  it.each([
    [null, false],
    [address({ status: "failing", verified: false }), false],
    [address({ status: "unchecked", verified: true }), false],
    [address({ status: "ok", verified: true }), false],
    [address({ status: "failing", verified: true }), true],
  ])("%j is %s", (value, expected) => {
    expect(hasStopped(value)).toBe(expected);
  });
});

const WORDS = (text: string) => text.split(" ").length;

describe("the sentences of a check", () => {
  it("has one short sentence of advice for every result, and names the host of the instance in the one about DNS", () => {
    for (const result of CUSTOM_DOMAIN_CHECK_RESULTS) {
      expect(checkAdvice(result, HOST).length).toBeGreaterThan(20);
      expect(WORDS(checkAdvice(result, HOST))).toBeLessThanOrEqual(15);
      expect(checkAdvice(result, HOST)).not.toMatch(/main address|still sent links/);
    }
    expect(checkAdvice("dns_failed", HOST)).toBe("The name does not resolve. Ask IT to add a CNAME to tickets.example.com.");
    expect(checkAdvice("dns_failed", null)).toContain("CNAME to the address of this instance.");
  });

  it("tells a private address from a fault, and a refused certificate from a name that answers as another event", () => {
    expect(checkAdvice("not_verifiable_from_server", HOST)).toBe("The name points to a private network. This server cannot check it.");
    expect(checkAdvice("tls_failed", HOST)).toBe("The name resolves, but its certificate is refused. Ask IT to fix it.");
    expect(checkAdvice("wrong_target", HOST)).toBe("The name answers, but not as this event. Ask IT to check the setup.");
    expect(checkAdvice("unreachable", HOST)).toBe("The address did not answer. Ask IT to check its HTTPS access.");
  });

});

describe("addressStatusLine: how the card words the state", () => {
  it("is working for an address that passed", () => {
    expect(addressStatusLine(address({ status: "ok", verified: true, check_result: "ok" }), HOST)).toEqual({
      tone: "ok",
      title: "Working",
      detail: "Guests get links on this address.",
    });
  });

  it("says stopped for one that worked, with what to ask IT", () => {
    const line = addressStatusLine(address({ status: "failing", verified: true, check_result: "tls_failed" }), HOST);
    expect(line).toEqual({ tone: "warn", title: "Stopped working", detail: "The name resolves, but its certificate is refused. Ask IT to fix it." });
  });

  it("says not working yet for one that never worked, with the CNAME to ask for", () => {
    const line = addressStatusLine(address({ status: "failing", check_result: "dns_failed" }), HOST);
    expect(line).toEqual({ tone: "warn", title: "Not working yet", detail: "The name does not resolve. Ask IT to add a CNAME to tickets.example.com." });
  });

  it("falls back to unreachable's advice for a failure with no recorded result", () => {
    expect(addressStatusLine(address({ status: "failing", verified: true, check_result: null }), HOST).detail).toContain("did not answer");
  });

  it("says the same short thing for a name that cannot be checked from the server, whether or not it worked before", () => {
    const text = "The name points to a private network. This server cannot check it.";
    expect(addressStatusLine(address({ check_result: "not_verifiable_from_server", verified: false }), HOST).detail).toBe(text);
    expect(addressStatusLine(address({ check_result: "not_verifiable_from_server", verified: true }), HOST).detail).toBe(text);
  });

  it("is neutral for a name that cannot be checked from the server, and for one not checked yet, in one short sentence", () => {
    expect(addressStatusLine(address({ check_result: "not_verifiable_from_server" }), HOST)).toMatchObject({ tone: "neutral", title: "Cannot be checked from this server" });
    expect(addressStatusLine(address(), HOST)).toEqual({ tone: "neutral", title: "Not checked yet", detail: "The first check runs soon after you set the address." });
  });
});
