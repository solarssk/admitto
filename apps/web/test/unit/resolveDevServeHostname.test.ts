import { describe, expect, it } from "vitest";
import { resolveDevServeHostname } from "../../src/index.js";

describe("resolveDevServeHostname", () => {
  it("binds to localhost in dev with no local HTTPS cert (the unsafe default this fix closes)", () => {
    expect(resolveDevServeHostname(true, false)).toBe("127.0.0.1");
  });

  it("leaves the hostname unset in dev when a local cert is present, for phone-over-LAN testing", () => {
    expect(resolveDevServeHostname(true, true)).toBeUndefined();
  });

  it("leaves the hostname unset in production regardless of HTTPS, for the reverse proxy/container network", () => {
    expect(resolveDevServeHostname(false, false)).toBeUndefined();
    expect(resolveDevServeHostname(false, true)).toBeUndefined();
  });
});
