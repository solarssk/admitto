import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { Hono } from "hono";
import { getConnInfo } from "@hono/node-server/conninfo";
import { clientIpFromHeaders, rateLimitIpKey, resolveClientIp } from "../src/rate-limit/client-ip.js";

vi.mock("@hono/node-server/conninfo", () => ({
  getConnInfo: vi.fn(),
}));

vi.mock("../src/rate-limit/trust-proxy.js", () => ({
  shouldTrustForwardedHeaders: vi.fn(() => false),
  isTrustedProxyAddress: vi.fn((address: string) => address === "10.0.0.5"),
}));

import { shouldTrustForwardedHeaders } from "../src/rate-limit/trust-proxy.js";

const mockedGetConnInfo = vi.mocked(getConnInfo);
const mockedShouldTrustForwardedHeaders = vi.mocked(shouldTrustForwardedHeaders);

function appWithRequest(headers: Record<string, string> = {}) {
  const app = new Hono();
  app.get("/ip", (c) => c.json({ ip: resolveClientIp(c) }));
  return app.request("/ip", { headers });
}

describe("clientIpFromHeaders", () => {
  it("returns the only hop of a single-hop header", () => {
    expect(clientIpFromHeaders("203.0.113.10")).toBe("203.0.113.10");
  });

  it("returns the rightmost hop that is not a trusted proxy, never a hop the client could have supplied", () => {
    const trusted = (ip: string) => ip === "10.0.0.1" || ip === "10.0.0.2";
    // client-forged "1.2.3.4" on the left, the real client as seen by the first trusted proxy next to it.
    expect(clientIpFromHeaders("1.2.3.4, 203.0.113.10, 10.0.0.1, 10.0.0.2", trusted)).toBe("203.0.113.10");
    // With no hop trusted, the last one is the nearest hop we can vouch for.
    expect(clientIpFromHeaders("203.0.113.10, 10.0.0.1")).toBe("10.0.0.1");
  });

  it("falls back to the leftmost hop when every hop is a trusted proxy", () => {
    expect(clientIpFromHeaders("10.0.0.1, 10.0.0.2", () => true)).toBe("10.0.0.1");
  });

  it("rejects the whole header when any hop is not a valid IP", () => {
    expect(clientIpFromHeaders("203.0.113.10, garbage")).toBeUndefined();
    expect(clientIpFromHeaders("garbage, 203.0.113.10")).toBeUndefined();
  });

  it("returns undefined for malformed leading hop", () => {
    expect(clientIpFromHeaders(",203.0.113.10")).toBeUndefined();
    expect(clientIpFromHeaders("not-an-ip")).toBeUndefined();
    expect(clientIpFromHeaders("")).toBeUndefined();
  });

  it("accepts bracketed IPv6", () => {
    expect(clientIpFromHeaders("[2001:db8::1]")).toBe("2001:db8::1");
  });
});

describe("resolveClientIp", () => {
  beforeEach(() => {
    mockedGetConnInfo.mockReturnValue({
      remote: { address: "198.51.100.7", port: 1234 },
    } as ReturnType<typeof getConnInfo>);
    mockedShouldTrustForwardedHeaders.mockReturnValue(false);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("ignores X-Forwarded-For when the request is not from a trusted proxy", async () => {
    const res = await appWithRequest({ "X-Forwarded-For": "1.2.3.4" });
    expect(await res.json()).toEqual({ ip: "198.51.100.7" });
  });

  it("uses valid X-Forwarded-For when the request is from a trusted proxy", async () => {
    mockedShouldTrustForwardedHeaders.mockReturnValue(true);
    const res = await appWithRequest({ "X-Forwarded-For": "203.0.113.55" });
    expect(await res.json()).toEqual({ ip: "203.0.113.55" });
  });

  it("ignores hops a client put in front of the proxy chain: takes the rightmost untrusted hop", async () => {
    mockedShouldTrustForwardedHeaders.mockReturnValue(true);
    // 10.0.0.5 is our proxy (mock above); 203.0.113.9 is what it saw; 1.2.3.4 was supplied by the client.
    const res = await appWithRequest({ "X-Forwarded-For": "1.2.3.4, 203.0.113.9, 10.0.0.5" });
    expect(await res.json()).toEqual({ ip: "203.0.113.9" });
  });

  it("falls back to socket when X-Forwarded-For is malformed even from a trusted proxy", async () => {
    mockedShouldTrustForwardedHeaders.mockReturnValue(true);
    const res = await appWithRequest({ "X-Forwarded-For": ",203.0.113.55" });
    expect(await res.json()).toEqual({ ip: "198.51.100.7" });
  });
});

describe("rateLimitIpKey", () => {
  it("keeps IPv4 addresses as-is", () => {
    expect(rateLimitIpKey("203.0.113.10")).toBe("203.0.113.10");
  });

  it("unwraps IPv4-mapped IPv6", () => {
    expect(rateLimitIpKey("::ffff:203.0.113.10")).toBe("203.0.113.10");
  });

  it("keys IPv4-mapped IPv6 addresses as IPv4 in dotted, hexadecimal and fully written forms", () => {
    expect(rateLimitIpKey("::ffff:c000:201")).toBe("192.0.2.1");
    expect(rateLimitIpKey("::FFFF:C000:201")).toBe("192.0.2.1");
    expect(rateLimitIpKey("0:0:0:0:0:ffff:192.0.2.1")).toBe("192.0.2.1");
    expect(rateLimitIpKey("::ffff:c000:202")).not.toBe(rateLimitIpKey("::ffff:c000:201"));
  });

  it("collapses IPv6 addresses to their /64", () => {
    expect(rateLimitIpKey("2001:db8:1:2::1")).toBe(rateLimitIpKey("2001:0db8:0001:0002:ffff:ffff:ffff:ffff"));
    expect(rateLimitIpKey("2001:db8:1:2::1")).toBe("2001:db8:1:2::/64");
    expect(rateLimitIpKey("2001:db8:1:3::1")).not.toBe(rateLimitIpKey("2001:db8:1:2::1"));
  });

  it("ignores an IPv6 zone index and keeps an address with an embedded IPv4 tail as-is", () => {
    expect(rateLimitIpKey("fe80::1%eth0")).toBe("fe80:0:0:0::/64");
    expect(rateLimitIpKey("64:ff9b::192.0.2.1")).toBe("64:ff9b:0:0::/64");
  });

  it("keys a full eight-group address without :: by its first four groups", () => {
    expect(rateLimitIpKey("2001:db8:1:2:3:4:5:6")).toBe("2001:db8:1:2::/64");
  });

  it("expands :: that sits inside the first four groups", () => {
    expect(rateLimitIpKey("2001:db8::1")).toBe("2001:db8:0:0::/64");
    expect(rateLimitIpKey("::1")).toBe("0:0:0:0::/64");
  });
});
