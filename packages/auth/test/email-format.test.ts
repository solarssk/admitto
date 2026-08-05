import { describe, expect, it } from "vitest";
import { isValidEmailFormat } from "../src/user.js";

describe("isValidEmailFormat", () => {
  it("accepts a plain address", () => {
    expect(isValidEmailFormat("a@b.c")).toBe(true);
  });

  it("accepts a dot appearing anywhere inside the domain, not just before the last segment", () => {
    expect(isValidEmailFormat("x@a.b.")).toBe(true);
    expect(isValidEmailFormat("a@b..c")).toBe(true);
  });

  it("rejects a domain with no interior dot", () => {
    expect(isValidEmailFormat("a@bc")).toBe(false);
    expect(isValidEmailFormat("a@.c")).toBe(false);
    expect(isValidEmailFormat("a@b.")).toBe(false);
  });

  it("rejects a missing or empty local part", () => {
    expect(isValidEmailFormat("@b.c")).toBe(false);
    expect(isValidEmailFormat("b.c")).toBe(false);
  });

  it("rejects a second @ anywhere in the address", () => {
    expect(isValidEmailFormat("a@b@c.d")).toBe(false);
  });

  it("rejects whitespace in either part", () => {
    expect(isValidEmailFormat("a b@c.d")).toBe(false);
    expect(isValidEmailFormat("a@c .d")).toBe(false);
  });

  it("does not hang on a long adversarial domain (ReDoS regression)", () => {
    const start = performance.now();
    expect(isValidEmailFormat(`a@${"a".repeat(50_000)}!`)).toBe(false);
    expect(performance.now() - start).toBeLessThan(100);
  });
});
