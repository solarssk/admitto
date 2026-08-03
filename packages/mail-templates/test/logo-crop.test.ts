import { describe, expect, it } from "vitest";
import { logoCropFromDb, parseLogoCrop } from "../src/logo-crop.js";

describe("parseLogoCrop", () => {
  it("accepts a valid percent crop with zoom", () => {
    expect(
      parseLogoCrop({ unit: "%", x: 5, y: 10, width: 80, height: 70, zoom: 1.5 }),
    ).toEqual({ unit: "%", x: 5, y: 10, width: 80, height: 70, zoom: 1.5 });
  });

  it("returns null for null/undefined", () => {
    expect(parseLogoCrop(null)).toBeNull();
    expect(parseLogoCrop(undefined)).toBeNull();
  });

  it("rejects malformed payloads", () => {
    expect(() => parseLogoCrop({ unit: "%", x: 0, y: 0, width: 0, height: 50, zoom: 1 })).toThrow(
      /size/,
    );
    expect(() => parseLogoCrop({ unit: "%", x: 0, y: 0, width: 50, height: 50, zoom: 4 })).toThrow(
      /zoom/,
    );
  });
});

describe("logoCropFromDb", () => {
  it("returns null for corrupt stored JSON instead of throwing", () => {
    expect(logoCropFromDb({ unit: "%", x: "nope" })).toBeNull();
  });
});
