import { describe, expect, it } from "vitest";
import { parseDeviceName } from "../../src/utils/parseDeviceName.js";

describe("parseDeviceName", () => {
  it("detects iPad with iOS version", () => {
    const ua =
      "Mozilla/5.0 (iPad; CPU OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1";
    expect(parseDeviceName(ua)).toBe("iPad (iOS 17.4) · Safari");
  });

  it("detects Android device model", () => {
    const ua =
      "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Mobile Safari/537.36";
    expect(parseDeviceName(ua)).toBe("Pixel 8");
  });

  it("returns Windows PC for Windows UA", () => {
    expect(parseDeviceName("Mozilla/5.0 (Windows NT 10.0; Win64; x64)")).toBe("Windows PC");
  });

  it("returns empty string for unknown UA", () => {
    expect(parseDeviceName("CustomScanner/1.0")).toBe("");
  });
});
