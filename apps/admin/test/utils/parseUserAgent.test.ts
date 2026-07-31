import { describe, expect, it } from "vitest";
import { parseUserAgent } from "../../src/utils/parseUserAgent.js";

describe("parseUserAgent", () => {
  it("returns Unknown for null", () => {
    expect(parseUserAgent(null)).toBe("Unknown");
  });

  it("labels desktop browsers and operating systems", () => {
    expect(parseUserAgent("Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/120.0.0.0 Safari/537.36")).toBe(
      "Chrome / Windows",
    );
    expect(parseUserAgent("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) Safari/605.1.15")).toBe(
      "Safari / macOS",
    );
    expect(parseUserAgent("Mozilla/5.0 (X11; Linux x86_64) Firefox/123.0")).toBe("Firefox / Linux");
  });

  it("labels a real Android Chrome user agent as Android, not Linux", () => {
    const ua = "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Mobile Safari/537.36";
    expect(parseUserAgent(ua)).toBe("Chrome / Android");
  });

  it("labels a real iPhone Safari user agent as iOS, not macOS", () => {
    const ua = "Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1";
    expect(parseUserAgent(ua)).toBe("Safari / iOS");
  });

  it("labels a real iPad Safari user agent as iOS, not macOS", () => {
    const ua = "Mozilla/5.0 (iPad; CPU OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1";
    expect(parseUserAgent(ua)).toBe("Safari / iOS");
  });

  it("falls back to a truncated raw string when nothing matches", () => {
    expect(parseUserAgent("curl/8.7.1")).toBe("curl/8.7.1");
  });
});
