import { describe, expect, it } from "vitest";
import { logoCropFromDb, parseLogoCrop } from "../src/logo-crop.js";

const valid = { unit: "%" as const, x: 5, y: 10, width: 80, height: 70, zoom: 1.5 };

describe("parseLogoCrop", () => {
  it("accepts a valid percent crop with zoom", () => {
    expect(parseLogoCrop(valid)).toEqual(valid);
  });

  it("returns null for null/undefined", () => {
    expect(parseLogoCrop(null)).toBeNull();
    expect(parseLogoCrop(undefined)).toBeNull();
  });

  it("throws TypeError when the value is not an object", () => {
    expect(() => parseLogoCrop("nope")).toThrow(TypeError);
    expect(() => parseLogoCrop(["%"])).toThrow(/object or null/);
  });

  it("rejects wrong unit and non-finite fields", () => {
    expect(() => parseLogoCrop({ ...valid, unit: "px" })).toThrow(/unit/);
    expect(() => parseLogoCrop({ ...valid, x: Number.NaN })).toThrow(/finite/);
    expect(() => parseLogoCrop({ ...valid, zoom: Infinity })).toThrow(/finite/);
  });

  it("rejects empty size, negative origin, out-of-bounds, and zoom outside 1–3", () => {
    expect(() => parseLogoCrop({ ...valid, width: 0 })).toThrow(/size/);
    expect(() => parseLogoCrop({ ...valid, x: -1 })).toThrow(/origin/);
    expect(() => parseLogoCrop({ ...valid, x: 40, width: 70 })).toThrow(/within/);
    expect(() => parseLogoCrop({ ...valid, zoom: 0.5 })).toThrow(/zoom/);
    expect(() => parseLogoCrop({ ...valid, zoom: 4 })).toThrow(/zoom/);
  });
});

describe("logoCropFromDb", () => {
  it("returns a valid stored crop", () => {
    expect(logoCropFromDb(valid)).toEqual(valid);
  });

  it("returns null for corrupt stored JSON instead of throwing", () => {
    expect(logoCropFromDb({ unit: "%", x: "nope" })).toBeNull();
    expect(logoCropFromDb([])).toBeNull();
  });
});
