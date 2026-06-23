import { beforeEach, describe, expect, it, vi } from "vitest";
import { lookup } from "node:dns/promises";
import { assertSafeOidcFetchUrl, assertSafeOidcFetchUrlResolved } from "../src/oidc/safe-url.js";
import { fetchOidcDiscovery } from "../src/oidc/discovery.js";

vi.mock("node:dns/promises", () => ({
  lookup: vi.fn(),
}));

const mockedLookup = vi.mocked(lookup);

beforeEach(() => {
  process.env["NODE_ENV"] = "test";
  mockedLookup.mockResolvedValue([{ address: "93.184.216.34", family: 4 }] as Awaited<
    ReturnType<typeof lookup>
  >);
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
});

describe("fetchOidcDiscovery SSRF guard", () => {
  it("rejects metadata issuer before fetch", async () => {
    await expect(fetchOidcDiscovery("https://169.254.169.254/")).rejects.toThrow(/private or link-local/);
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
});
