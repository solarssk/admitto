import { describe, expect, it } from "vitest";
import { REGISTRATION_PASSWORD_MAX, REGISTRATION_PASSWORD_MIN, registrationPasswordLength } from "../src/registrationPassword.js";

const EMOJI = String.fromCodePoint(0x1f600);

describe("the length of the event password", () => {
  it("is 8 to 128 characters, the numbers the panel and the guest route will quote", () => {
    expect([REGISTRATION_PASSWORD_MIN, REGISTRATION_PASSWORD_MAX]).toEqual([8, 128]);
  });

  it("counts characters and not the units a string is stored in: an emoji is one", () => {
    expect(registrationPasswordLength("")).toBe(0);
    expect(registrationPasswordLength("abc")).toBe(3);
    expect(registrationPasswordLength(`a${EMOJI}b`)).toBe(3);
    expect(registrationPasswordLength(EMOJI.repeat(128))).toBe(128);
    expect(EMOJI.repeat(128).length).toBe(256);
  });

  it("counts a space like any other character, at either end too", () => {
    expect(registrationPasswordLength("  a  ")).toBe(5);
  });

  it("counts a lone surrogate as one character, and does not stop at it", () => {
    const lone = String.fromCharCode(0xd83d);
    expect(registrationPasswordLength(`${lone}x`)).toBe(2);
    expect(registrationPasswordLength(`x${lone}`)).toBe(2);
  });
});
