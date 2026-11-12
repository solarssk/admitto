import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import { signDomainCheck, verifyDomainCheck } from "../src/domainCheck.js";
import { getEncryptionKey } from "../src/key.js";

describe("signDomainCheck", () => {
  it("is a url-safe HMAC-SHA256 over the domain-separated event id and address", () => {
    const expected = createHmac("sha256", getEncryptionKey()).update("domain-check:evt_1:summit.acme.example").digest("base64url");
    expect(signDomainCheck("evt_1", "summit.acme.example")).toBe(expected);
    expect(signDomainCheck("evt_1", "summit.acme.example")).toMatch(/^[A-Za-z0-9_-]{43}$/);
  });

  it("is the same for the same event and address, and different for another event or another address", () => {
    const mac = signDomainCheck("evt_1", "summit.acme.example");
    expect(signDomainCheck("evt_1", "summit.acme.example")).toBe(mac);
    expect(signDomainCheck("evt_2", "summit.acme.example")).not.toBe(mac);
    expect(signDomainCheck("evt_1", "other.acme.example")).not.toBe(mac);
  });

  it("is not the confirmation mac of a registration with the same id", () => {
    const confirm = createHmac("sha256", getEncryptionKey()).update("registration-confirm:evt_1").digest("base64url");
    expect(signDomainCheck("evt_1", "")).not.toBe(confirm);
  });
});

describe("verifyDomainCheck", () => {
  it("accepts the mac it signed", () => {
    expect(verifyDomainCheck("evt_1", "summit.acme.example", signDomainCheck("evt_1", "summit.acme.example"))).toBe(true);
  });

  it("refuses a mac signed for another event or another address", () => {
    const mac = signDomainCheck("evt_1", "summit.acme.example");
    expect(verifyDomainCheck("evt_2", "summit.acme.example", mac)).toBe(false);
    expect(verifyDomainCheck("evt_1", "other.acme.example", mac)).toBe(false);
  });

  it("refuses a tampered, truncated, extended or empty mac", () => {
    const mac = signDomainCheck("evt_1", "summit.acme.example");
    const flipped = `${mac.slice(0, -1)}${mac.endsWith("A") ? "B" : "A"}`;
    expect(verifyDomainCheck("evt_1", "summit.acme.example", flipped)).toBe(false);
    expect(verifyDomainCheck("evt_1", "summit.acme.example", mac.slice(0, -1))).toBe(false);
    expect(verifyDomainCheck("evt_1", "summit.acme.example", `${mac}A`)).toBe(false);
    expect(verifyDomainCheck("evt_1", "summit.acme.example", "")).toBe(false);
  });
});
