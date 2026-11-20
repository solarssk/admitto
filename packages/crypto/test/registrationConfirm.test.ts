import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import { getEncryptionKey } from "../src/key.js";
import { signRegistrationConfirm, verifyRegistrationConfirm } from "../src/registrationConfirm.js";

describe("signRegistrationConfirm", () => {
  it("gives the same mac for the same registration id", () => {
    expect(signRegistrationConfirm("reg_1")).toBe(signRegistrationConfirm("reg_1"));
  });

  it("gives a different mac for a different registration id", () => {
    expect(signRegistrationConfirm("reg_1")).not.toBe(signRegistrationConfirm("reg_2"));
  });

  it("is a url-safe HMAC-SHA256 over the domain-separated id", () => {
    const expected = createHmac("sha256", getEncryptionKey())
      .update("registration-confirm:reg_1")
      .digest("base64url");
    expect(signRegistrationConfirm("reg_1")).toBe(expected);
    expect(signRegistrationConfirm("reg_1")).toMatch(/^[A-Za-z0-9_-]{43}$/);
  });
});

describe("verifyRegistrationConfirm", () => {
  it("accepts the mac it signed", () => {
    expect(verifyRegistrationConfirm("reg_1", signRegistrationConfirm("reg_1"))).toBe(true);
  });

  it("refuses a mac signed for another registration", () => {
    expect(verifyRegistrationConfirm("reg_1", signRegistrationConfirm("reg_2"))).toBe(false);
  });

  it("refuses a tampered, truncated, extended or empty mac", () => {
    const mac = signRegistrationConfirm("reg_1");
    const flipped = `${mac.slice(0, -1)}${mac.endsWith("A") ? "B" : "A"}`;
    expect(verifyRegistrationConfirm("reg_1", flipped)).toBe(false);
    expect(verifyRegistrationConfirm("reg_1", mac.slice(0, -1))).toBe(false);
    expect(verifyRegistrationConfirm("reg_1", `${mac}A`)).toBe(false);
    expect(verifyRegistrationConfirm("reg_1", "")).toBe(false);
  });

  it("does not accept a mac across the id/mac boundary", () => {
    expect(verifyRegistrationConfirm("reg_1.", signRegistrationConfirm("reg_1"))).toBe(false);
  });
});
