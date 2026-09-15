import { describe, expect, it } from "vitest";
import { parseUserAgent, parseUserAgentWithVersion } from "../../src/utils/parseUserAgent.js";

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

describe("parseUserAgentWithVersion", () => {
  it("returns Unknown for null", () => {
    expect(parseUserAgentWithVersion(null)).toBe("Unknown");
  });

  it("includes each side's real version number, even when they differ (iPhone Safari)", () => {
    const ua = "Mozilla/5.0 (iPhone; CPU iPhone OS 18_7 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.6 Mobile/15E148 Safari/604.1";
    expect(parseUserAgentWithVersion(ua)).toBe("Safari 18.6 / iOS 18.7");
  });

  it("includes the Android and Chrome versions", () => {
    const ua = "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.6261.64 Mobile Safari/537.36";
    expect(parseUserAgentWithVersion(ua)).toBe("Chrome 122.0.6261.64 / Android 14");
  });

  it("includes the macOS Safari version", () => {
    const ua = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Safari/605.1.15";
    expect(parseUserAgentWithVersion(ua)).toBe("Safari 17.4 / macOS 10.15.7");
  });

  it("falls back to the unversioned label for a browser/OS this can't extract a version from (Windows Chrome)", () => {
    const ua = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";
    expect(parseUserAgentWithVersion(ua)).toBe("Chrome 120.0.0.0 / Windows");
  });

  it("falls back to a truncated raw string when nothing matches", () => {
    expect(parseUserAgentWithVersion("curl/8.7.1")).toBe("curl/8.7.1");
  });
});
