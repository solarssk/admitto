import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { Hono } from "hono";
import { getConnInfo } from "@hono/node-server/conninfo";
import {
  parseTrustedProxyCidrs,
  resolveTrustedProxyCidrs,
  isTrustedProxyPeer,
  shouldTrustForwardedHeaders,
} from "../src/rate-limit/trust-proxy.js";

vi.mock("@hono/node-server/conninfo", () => ({
  getConnInfo: vi.fn(),
}));

const mockedGetConnInfo = vi.mocked(getConnInfo);

function probeWithPeer(peerAddress: string | undefined) {
  if (peerAddress === undefined) {
    mockedGetConnInfo.mockImplementation(() => {
      throw new Error("no connection info");
    });
  } else {
    mockedGetConnInfo.mockReturnValue({
      remote: { address: peerAddress, port: 1234 },
    } as ReturnType<typeof getConnInfo>);
  }
  const app = new Hono();
  app.get("/probe", (c) =>
    c.json({
      trustedPeer: isTrustedProxyPeer(c),
      trustForwarded: shouldTrustForwardedHeaders(c, { TRUST_PROXY: "true" }),
    }),
  );
  return app.request("/probe");
}

describe("parseTrustedProxyCidrs", () => {
  it("matches an address inside a bare /32 IPv4 entry", () => {
    const list = parseTrustedProxyCidrs("203.0.113.10");
    expect(list.check("203.0.113.10", "ipv4")).toBe(true);
    expect(list.check("203.0.113.11", "ipv4")).toBe(false);
  });

  it("matches an address inside an explicit IPv4 CIDR range", () => {
    const list = parseTrustedProxyCidrs("172.28.238.0/24");
    expect(list.check("172.28.238.55", "ipv4")).toBe(true);
    expect(list.check("172.28.239.1", "ipv4")).toBe(false);
  });

  it("matches a bare IPv6 entry as /128", () => {
    const list = parseTrustedProxyCidrs("::1");
    expect(list.check("::1", "ipv6")).toBe(true);
    expect(list.check("::2", "ipv6")).toBe(false);
  });

  it("parses multiple comma-separated entries", () => {
    const list = parseTrustedProxyCidrs("127.0.0.1/32, ::1/128");
    expect(list.check("127.0.0.1", "ipv4")).toBe(true);
    expect(list.check("::1", "ipv6")).toBe(true);
  });

  it("skips malformed entries but keeps valid ones", () => {
    const list = parseTrustedProxyCidrs("not-an-ip, 127.0.0.1/32, 10.0.0.0/99, /24");
    expect(list.check("127.0.0.1", "ipv4")).toBe(true);
  });

  it("throws when no entry is usable", () => {
    expect(() => parseTrustedProxyCidrs("not-an-ip, also-bad")).toThrow();
    expect(() => parseTrustedProxyCidrs("")).toThrow();
  });
});

describe("resolveTrustedProxyCidrs", () => {
  it("defaults to loopback-only when unset", () => {
    const list = resolveTrustedProxyCidrs({});
    expect(list.check("127.0.0.1", "ipv4")).toBe(true);
    expect(list.check("::1", "ipv6")).toBe(true);
    expect(list.check("203.0.113.10", "ipv4")).toBe(false);
  });

  it("uses TRUSTED_PROXY_CIDRS when set", () => {
    const list = resolveTrustedProxyCidrs({ TRUSTED_PROXY_CIDRS: "172.28.238.0/24" });
    expect(list.check("172.28.238.10", "ipv4")).toBe(true);
    expect(list.check("127.0.0.1", "ipv4")).toBe(false);
  });
});

describe("isTrustedProxyPeer / shouldTrustForwardedHeaders", () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it("trusts the default loopback peer", async () => {
    const res = await probeWithPeer("127.0.0.1");
    expect(await res.json()).toEqual({ trustedPeer: true, trustForwarded: true });
  });

  it("does not trust a non-loopback peer under the default allowlist", async () => {
    const res = await probeWithPeer("203.0.113.10");
    expect(await res.json()).toEqual({ trustedPeer: false, trustForwarded: false });
  });

  it("does not trust when the socket peer cannot be determined", async () => {
    const res = await probeWithPeer(undefined);
    expect(await res.json()).toEqual({ trustedPeer: false, trustForwarded: false });
  });

  it("does not trust when the reported peer address is not a valid IP", async () => {
    mockedGetConnInfo.mockReturnValue({
      remote: { address: "not-an-ip", port: 1234 },
    } as ReturnType<typeof getConnInfo>);
    const app = new Hono();
    app.get("/probe", (c) => c.json({ trustedPeer: isTrustedProxyPeer(c) }));
    const res = await app.request("/probe");
    expect(await res.json()).toEqual({ trustedPeer: false });
  });

  it("trusts an IPv6 loopback peer under the default allowlist", async () => {
    const res = await probeWithPeer("::1");
    expect(await res.json()).toEqual({ trustedPeer: true, trustForwarded: true });
  });
});

describe("shouldTrustForwardedHeaders — TRUST_PROXY gate", () => {
  beforeEach(() => {
    mockedGetConnInfo.mockReturnValue({
      remote: { address: "127.0.0.1", port: 1234 },
    } as ReturnType<typeof getConnInfo>);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("is false when TRUST_PROXY is false even from a trusted peer", async () => {
    const app = new Hono();
    app.get("/probe", (c) => c.json({ trust: shouldTrustForwardedHeaders(c, {}) }));
    const res = await app.request("/probe");
    expect(await res.json()).toEqual({ trust: false });
  });
});
