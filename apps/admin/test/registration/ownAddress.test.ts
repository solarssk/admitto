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

describe("the sentences of a check", () => {
  it("has advice for every result, and names the host of the instance in the one about DNS", () => {
    for (const result of CUSTOM_DOMAIN_CHECK_RESULTS) expect(checkAdvice(result, HOST).length).toBeGreaterThan(20);
    expect(checkAdvice("dns_failed", HOST)).toBe("The name does not resolve. Ask IT to create a CNAME record that points it to tickets.example.com.");
    expect(checkAdvice("dns_failed", null)).toContain("points it to the address of this instance.");
  });

  it("tells a private address from a fault", () => {
    expect(checkAdvice("not_verifiable_from_server", HOST)).toContain("This is no fault of the address.");
    expect(checkAdvice("tls_failed", HOST)).toContain("does not issue certificates");
  });

  it.each<[CustomDomainCheckResult | null, string]>([
    ["dns_failed", "the name does not resolve any more"],
    ["tls_failed", "its HTTPS certificate is refused"],
    ["wrong_target", "it no longer reaches this instance"],
    ["unreachable", "it did not answer"],
    ["ok", "the last check failed"],
    ["not_verifiable_from_server", "the last check failed"],
    [null, "the last check failed"],
  ])("the warning for %s says %s", (result, reason) => {
    const warning = stoppedWarning(address({ status: "failing", verified: true, check_result: result }));
    expect(warning).toBe(
      `The address of this event for guests, summit.acme.example, stopped working: ${reason}. Guests are still sent links on it, so they may not open. Ask a superadmin or your IT department to look at it.`,
    );
  });
});

describe("addressStatusLine: how the card words the state", () => {
  it("is working for an address that passed", () => {
    expect(addressStatusLine(address({ status: "ok", verified: true, check_result: "ok" }), HOST)).toEqual({
      tone: "ok",
      title: "Working",
      detail: "Guests are sent links on this address.",
    });
  });

  it("says stopped for one that worked, with what to ask IT, and that guests are still sent there", () => {
    const line = addressStatusLine(address({ status: "failing", verified: true, check_result: "tls_failed" }), HOST);
    expect(line.tone).toBe("warn");
    expect(line.title).toBe("Stopped working");
    expect(line.detail).toContain("certificate was refused");
    expect(line.detail).toContain("Guests are still sent links on this address.");
  });

  it("says not working yet for one that never worked, and that guests keep the main address", () => {
    const line = addressStatusLine(address({ status: "failing", check_result: "dns_failed" }), HOST);
    expect(line).toMatchObject({ tone: "warn", title: "Not working yet" });
    expect(line.detail).toContain("CNAME record");
    expect(line.detail).toContain("Guests keep getting links on the main address.");
  });

  it("falls back to unreachable's advice for a failure with no recorded result", () => {
    expect(addressStatusLine(address({ status: "failing", verified: true, check_result: null }), HOST).detail).toContain("did not answer in time");
  });

  it("is neutral for a name that cannot be checked from the server, and for one not checked yet", () => {
    expect(addressStatusLine(address({ check_result: "not_verifiable_from_server" }), HOST)).toMatchObject({ tone: "neutral", title: "Cannot be checked from this server" });
    expect(addressStatusLine(address(), HOST)).toMatchObject({ tone: "neutral", title: "Not checked yet" });
  });
});

describe("ownAddressOf: the answer of the address routes, as the settings read it", () => {
  const state = (overrides: Partial<CustomDomainDto> = {}): CustomDomainDto => ({
    custom_domain: "summit.acme.example",
    custom_domain_status: "ok",
    custom_domain_check_result: "ok",
    custom_domain_verified_at: "2026-11-12T10:00:00.000Z",
    custom_domain_checked_at: "2026-11-12T10:00:00.000Z",
    ...overrides,
  });

  it("is no address when there is none", () => {
    expect(ownAddressOf(state({ custom_domain: null, custom_domain_status: "unchecked", custom_domain_check_result: null, custom_domain_verified_at: null, custom_domain_checked_at: null }))).toBeNull();
  });

  it("turns the time of the verification into a yes or a no", () => {
    expect(ownAddressOf(state())).toEqual({ domain: "summit.acme.example", status: "ok", check_result: "ok", verified: true, checked_at: "2026-11-12T10:00:00.000Z" });
    expect(ownAddressOf(state({ custom_domain_verified_at: null }))?.verified).toBe(false);
  });
});
