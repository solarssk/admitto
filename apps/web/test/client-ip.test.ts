import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { Hono } from "hono";
import { getConnInfo } from "@hono/node-server/conninfo";
import { clientIpFromHeaders, resolveClientIp } from "../src/rate-limit/client-ip.js";

vi.mock("@hono/node-server/conninfo", () => ({
  getConnInfo: vi.fn(),
}));

vi.mock("../src/config.js", () => ({
  resolveTrustProxy: vi.fn(() => false),
}));

import { resolveTrustProxy } from "../src/config.js";

const mockedGetConnInfo = vi.mocked(getConnInfo);
const mockedResolveTrustProxy = vi.mocked(resolveTrustProxy);

function appWithRequest(headers: Record<string, string> = {}) {
  const app = new Hono();
  app.get("/ip", (c) => c.json({ ip: resolveClientIp(c) }));
  return app.request("/ip", { headers });
}

describe("clientIpFromHeaders", () => {
  it("returns first valid IPv4 hop", () => {
    expect(clientIpFromHeaders("203.0.113.10, 10.0.0.1")).toBe("203.0.113.10");
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
    mockedResolveTrustProxy.mockReturnValue(false);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("ignores X-Forwarded-For when TRUST_PROXY is false", async () => {
    const res = await appWithRequest({ "X-Forwarded-For": "1.2.3.4" });
    expect(await res.json()).toEqual({ ip: "198.51.100.7" });
  });

  it("uses valid X-Forwarded-For when TRUST_PROXY is true", async () => {
    mockedResolveTrustProxy.mockReturnValue(true);
    const res = await appWithRequest({ "X-Forwarded-For": "203.0.113.55" });
    expect(await res.json()).toEqual({ ip: "203.0.113.55" });
  });

  it("falls back to socket when X-Forwarded-For is malformed and TRUST_PROXY is true", async () => {
    mockedResolveTrustProxy.mockReturnValue(true);
    const res = await appWithRequest({ "X-Forwarded-For": ",203.0.113.55" });
    expect(await res.json()).toEqual({ ip: "198.51.100.7" });
  });
});
