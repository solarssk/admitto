import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { lookup } from "node:dns/promises";
import { assertSafeOidcFetchUrl, assertSafeOidcFetchUrlResolved } from "../src/oidc/safe-url.js";
import { fetchOidcDiscovery } from "../src/oidc/discovery.js";

vi.mock("node:dns/promises", () => ({
  lookup: vi.fn(),
}));

const mockedLookup = vi.mocked(lookup);

const allowlistKey = "SSO_PRIVATE_DESTINATION_ALLOWLIST";
const initialNodeEnv = process.env["NODE_ENV"];
const initialAllowlist = process.env[allowlistKey];

beforeEach(() => {
  process.env["NODE_ENV"] = "test";
  delete process.env[allowlistKey];
  mockedLookup.mockResolvedValue([{ address: "93.184.216.34", family: 4 }] as Awaited<
    ReturnType<typeof lookup>
  >);
});

afterEach(() => {
  if (initialNodeEnv === undefined) delete process.env["NODE_ENV"];
  else process.env["NODE_ENV"] = initialNodeEnv;

  if (initialAllowlist === undefined) delete process.env[allowlistKey];
  else process.env[allowlistKey] = initialAllowlist;

  vi.unstubAllGlobals();
});

describe("assertSafeOidcFetchUrl", () => {
  it("allows public HTTPS URLs", () => {
    expect(() => assertSafeOidcFetchUrl("https://login.example.com/")).not.toThrow();
  });

  it("allows http loopback in non-production", () => {
    expect(() => assertSafeOidcFetchUrl("http://127.0.0.1:9999/")).not.toThrow();
  });

  it("rejects plain HTTP to public hosts", () => {
    expect(() => assertSafeOidcFetchUrl("http://login.example.com/")).toThrow(/HTTPS/);
  });

  it("rejects AWS IMDS link-local", () => {
    expect(() => assertSafeOidcFetchUrl("https://169.254.169.254/latest/meta-data/")).toThrow(
      /private or link-local/,
    );
  });

  it("rejects RFC1918 addresses", () => {
    expect(() => assertSafeOidcFetchUrl("https://10.0.0.1/admin")).toThrow(/private or link-local/);
    expect(() => assertSafeOidcFetchUrl("https://192.168.1.1/")).toThrow(/private or link-local/);
  });

  it("rejects private IPv6 literals", () => {
    expect(() => assertSafeOidcFetchUrl("https://[fd00::1]/")).toThrow(/private or link-local/);
    expect(() => assertSafeOidcFetchUrl("https://[fe80::1]/")).toThrow(/private or link-local/);
  });

  it("rejects http in production", () => {
    process.env["NODE_ENV"] = "production";
    expect(() => assertSafeOidcFetchUrl("http://127.0.0.1:9999/")).toThrow(/HTTPS/);
  });

  it("rejects https loopback in production", () => {
    process.env["NODE_ENV"] = "production";
    expect(() => assertSafeOidcFetchUrl("https://127.0.0.1/")).toThrow(/private or link-local/);
    expect(() => assertSafeOidcFetchUrl("https://[::1]/")).toThrow(/private or link-local/);
  });

  it("rejects IPv4-mapped private IPv6 literals", () => {
    process.env["NODE_ENV"] = "production";
    expect(() => assertSafeOidcFetchUrl("https://[::ffff:127.0.0.1]/")).toThrow(
      /private or link-local/,
    );
    expect(() => assertSafeOidcFetchUrl("https://[::ffff:169.254.169.254]/")).toThrow(
      /private or link-local/,
    );
    expect(() => assertSafeOidcFetchUrl("https://[::ffff:7f00:1]/")).toThrow(/private or link-local/);
  });

  it("rejects unspecified IPv4 and IPv6 addresses", () => {
    expect(() => assertSafeOidcFetchUrl("https://0.0.0.0/")).toThrow(/private or link-local/);
    expect(() => assertSafeOidcFetchUrl("https://[::]/")).toThrow(/private or link-local/);
  });

  it("honors SSO_PRIVATE_DESTINATION_ALLOWLIST for private hostnames in production", () => {
    process.env["NODE_ENV"] = "production";
    process.env[allowlistKey] = "auth.example.lan,192.168.1.50";
    expect(() => assertSafeOidcFetchUrl("https://auth.example.lan/")).not.toThrow();
    expect(() => assertSafeOidcFetchUrl("https://192.168.1.50/")).not.toThrow();
    // Sync check only sees IP/metadata literals; non-allowlisted private IPs stay blocked.
    expect(() => assertSafeOidcFetchUrl("https://192.168.1.51/")).toThrow(/private or link-local/);
  });

  it("still requires HTTPS for allowlisted hosts in production", () => {
    process.env["NODE_ENV"] = "production";
    process.env[allowlistKey] = "auth.example.lan";
    expect(() => assertSafeOidcFetchUrl("http://auth.example.lan/")).toThrow(/HTTPS/);
  });

  it("matches equivalent IPv6 allowlist forms after WHATWG canonicalization", () => {
    process.env["NODE_ENV"] = "production";
    process.env[allowlistKey] = "fd00:0:0:0:0:0:0:1";
    expect(() => assertSafeOidcFetchUrl("https://[fd00::1]/")).not.toThrow();
    expect(() => assertSafeOidcFetchUrl("https://[fd00:0:0:0:0:0:0:1]/")).not.toThrow();
  });
});

describe("fetchOidcDiscovery SSRF guard", () => {
  it("rejects metadata issuer before fetch", async () => {
    await expect(fetchOidcDiscovery("https://169.254.169.254/")).rejects.toThrow(/private or link-local/);
  });

  it("rejects a discovery document with missing required fields", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ issuer: "http://127.0.0.1:9999/" }),
    });
    vi.stubGlobal("fetch", fetchMock);

    await expect(fetchOidcDiscovery("http://127.0.0.1:9999/")).rejects.toBeInstanceOf(TypeError);
    expect(fetchMock).toHaveBeenCalledOnce();
  });
});

describe("assertSafeOidcFetchUrlResolved", () => {
  it("rejects hostnames that resolve to private addresses", async () => {
    mockedLookup.mockResolvedValue([{ address: "10.0.0.5", family: 4 }] as Awaited<
      ReturnType<typeof lookup>
    >);
    await expect(assertSafeOidcFetchUrlResolved("https://evil.example.com/")).rejects.toThrow(
      /private or link-local/,
    );
  });

  it("allows hostnames that resolve to public addresses", async () => {
    mockedLookup.mockResolvedValue([{ address: "93.184.216.34", family: 4 }] as Awaited<
      ReturnType<typeof lookup>
    >);
    await expect(assertSafeOidcFetchUrlResolved("https://login.example.com/")).resolves.toBeUndefined();
  });

  it("rejects hostnames that resolve to unspecified addresses", async () => {
    mockedLookup.mockResolvedValue([{ address: "0.0.0.0", family: 4 }] as Awaited<
      ReturnType<typeof lookup>
    >);
    await expect(assertSafeOidcFetchUrlResolved("https://evil.example.com/")).rejects.toThrow(
      /private or link-local/,
    );
  });

  it("skips DNS for http localhost mock IdPs in non-production", async () => {
    mockedLookup.mockClear();
    await expect(assertSafeOidcFetchUrlResolved("http://localhost:9999/")).resolves.toBeUndefined();
    expect(mockedLookup).not.toHaveBeenCalled();
  });

  it("allows allowlisted hostnames that resolve privately in production", async () => {
    process.env["NODE_ENV"] = "production";
    process.env[allowlistKey] = "auth.example.lan";
    mockedLookup.mockResolvedValue([{ address: "10.0.0.5", family: 4 }] as Awaited<
      ReturnType<typeof lookup>
    >);
    await expect(
      assertSafeOidcFetchUrlResolved("https://auth.example.lan/"),
    ).resolves.toBeUndefined();
  });
});
