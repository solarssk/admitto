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

  it("inserts the slash a bare issuer is missing before appending .well-known, without storing it", async () => {
    // A bare issuer's own trailing slash is added only to build this request URL - it must not
    // replace the issuer's last path segment (what new URL(relative, base) would do without it).
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        issuer: "http://127.0.0.1:9999",
        authorization_endpoint: "http://127.0.0.1:9999/authorize",
        token_endpoint: "http://127.0.0.1:9999/token",
        jwks_uri: "http://127.0.0.1:9999/jwks",
      }),
    });
    vi.stubGlobal("fetch", fetchMock);

    await fetchOidcDiscovery("http://127.0.0.1:9999");

    expect(fetchMock).toHaveBeenCalledWith(
      "http://127.0.0.1:9999/.well-known/openid-configuration",
      expect.anything(),
    );
  });

  it("carries end_session_endpoint through when the document advertises one", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({
          issuer: "http://127.0.0.1:9999/",
          authorization_endpoint: "http://127.0.0.1:9999/authorize",
          token_endpoint: "http://127.0.0.1:9999/token",
          jwks_uri: "http://127.0.0.1:9999/jwks",
          userinfo_endpoint: "http://127.0.0.1:9999/userinfo",
          end_session_endpoint: "http://127.0.0.1:9999/end-session",
        }),
      }),
    );

    const doc = await fetchOidcDiscovery("http://127.0.0.1:9999/");
    expect(doc.end_session_endpoint).toBe("http://127.0.0.1:9999/end-session");
    expect(doc.userinfo_endpoint).toBe("http://127.0.0.1:9999/userinfo");
  });

  it("resolves end_session_endpoint to undefined when the document doesn't advertise one", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({
          issuer: "http://127.0.0.1:9999/",
          authorization_endpoint: "http://127.0.0.1:9999/authorize",
          token_endpoint: "http://127.0.0.1:9999/token",
          jwks_uri: "http://127.0.0.1:9999/jwks",
        }),
      }),
    );

    const doc = await fetchOidcDiscovery("http://127.0.0.1:9999/");
    expect(doc.end_session_endpoint).toBeUndefined();
  });
});

describe("fetchOidcDiscovery issuer validation (ASVS V10.5.3 / OIDC Discovery 1.0 §4.3)", () => {
  it("rejects a discovery document whose issuer doesn't match the URL it was fetched from", async () => {
    // The document claims to be a different issuer than the one actually requested - accepting
    // this would let Admitto end up trusting whichever issuer a discovery response happens to
    // claim, not the one an admin configured.
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({
          issuer: "http://127.0.0.1:9999/attacker-controlled",
          authorization_endpoint: "http://127.0.0.1:9999/authorize",
          token_endpoint: "http://127.0.0.1:9999/token",
          jwks_uri: "http://127.0.0.1:9999/jwks",
        }),
      }),
    );

    await expect(fetchOidcDiscovery("http://127.0.0.1:9999")).rejects.toThrow(/issuer mismatch/);
  });

  it("accepts a discovery document whose issuer matches the requested URL exactly", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({
          issuer: "http://127.0.0.1:9999",
          authorization_endpoint: "http://127.0.0.1:9999/authorize",
          token_endpoint: "http://127.0.0.1:9999/token",
          jwks_uri: "http://127.0.0.1:9999/jwks",
        }),
      }),
    );

    const doc = await fetchOidcDiscovery("http://127.0.0.1:9999");
    expect(doc.issuer).toBe("http://127.0.0.1:9999");
  });

  it("accepts a matching issuer that has a trailing slash the document reports but a pasted .well-known URL can't carry (bot review finding)", async () => {
    // An admin pasting the full .../.well-known/openid-configuration URL (the explicitly
    // supported paste-and-correct flow) always strips down to a no-trailing-slash base,
    // regardless of whether the IdP's real issuer has one - this must not be rejected as a
    // mismatch just because that ambiguity is inherent to the input, not a different issuer.
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({
          issuer: "http://127.0.0.1:9999/",
          authorization_endpoint: "http://127.0.0.1:9999/authorize",
          token_endpoint: "http://127.0.0.1:9999/token",
          jwks_uri: "http://127.0.0.1:9999/jwks",
        }),
      }),
    );

    const doc = await fetchOidcDiscovery("http://127.0.0.1:9999/.well-known/openid-configuration");
    // The document's own exact issuer is what gets stored, trailing slash and all - only the
    // validation comparison is slash-insensitive, not the returned value itself.
    expect(doc.issuer).toBe("http://127.0.0.1:9999/");
  });

  it("still rejects a genuinely different issuer even when only the trailing slash differs", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({
          issuer: "http://127.0.0.1:9999/attacker-controlled/",
          authorization_endpoint: "http://127.0.0.1:9999/authorize",
          token_endpoint: "http://127.0.0.1:9999/token",
          jwks_uri: "http://127.0.0.1:9999/jwks",
        }),
      }),
    );

    await expect(fetchOidcDiscovery("http://127.0.0.1:9999")).rejects.toThrow(/issuer mismatch/);
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
