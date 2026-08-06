import { describe, expect, it } from "vitest";
import { isValidEmailFormat } from "../../src/utils/email.js";

describe("isValidEmailFormat", () => {
  it("accepts a plain address", () => {
    expect(isValidEmailFormat("staff@example.com")).toBe(true);
  });

  it("rejects a missing @", () => {
    expect(isValidEmailFormat("staffexample.com")).toBe(false);
  });

  it("rejects an @ at the very start", () => {
    expect(isValidEmailFormat("@example.com")).toBe(false);
  });

  it("rejects a second @", () => {
    expect(isValidEmailFormat("staff@ex@ample.com")).toBe(false);
  });

  it("rejects whitespace in the local part", () => {
    expect(isValidEmailFormat("staff person@example.com")).toBe(false);
  });

  it("rejects whitespace in the domain part", () => {
    expect(isValidEmailFormat("staff@exa mple.com")).toBe(false);
  });

  it("rejects a domain with no dot", () => {
    expect(isValidEmailFormat("staff@examplecom")).toBe(false);
  });

  it("rejects a domain that's too short", () => {
    expect(isValidEmailFormat("staff@ab")).toBe(false);
  });
});
