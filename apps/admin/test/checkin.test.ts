import { describe, expect, it } from "vitest";
import { normalizeScannedInput, CHECKIN_DUPLICATE_DEBOUNCE_MS } from "../src/checkin/normalize.js";
import { canMutateCheckin } from "../src/checkin/connection.js";

describe("normalizeScannedInput", () => {
  it("strips trailing wedge suffixes", () => {
    expect(normalizeScannedInput("TOKEN-ABC\r\n")).toBe("TOKEN-ABC");
  });

  it("extracts token from ticket URL with trailing slash or query", () => {
    const token = "a".repeat(43);
    expect(normalizeScannedInput(`https://localhost:8080/t/${token}`)).toBe(token);
    expect(normalizeScannedInput(`https://localhost:8080/t/${token}/`)).toBe(token);
    expect(normalizeScannedInput(`https://localhost:8080/t/${token}?ref=mail`)).toBe(token);
  });

  it("exports 2500ms debounce constant", () => {
    expect(CHECKIN_DUPLICATE_DEBOUNCE_MS).toBe(2500);
  });
});

describe("connection gate", () => {
  it("blocks mutations unless connected", () => {
    expect(canMutateCheckin("connected")).toBe(true);
    expect(canMutateCheckin("reconnecting")).toBe(false);
    expect(canMutateCheckin("offline")).toBe(false);
  });
});
