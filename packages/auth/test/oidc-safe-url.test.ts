import { afterEach, describe, expect, it } from "vitest";
import { assertSafeOidcFetchUrl } from "../src/oidc/safe-url.js";
import { fetchOidcDiscovery } from "../src/oidc/discovery.js";

afterEach(() => {
  process.env["NODE_ENV"] = "test";
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

  it("rejects http in production", () => {
    process.env["NODE_ENV"] = "production";
    expect(() => assertSafeOidcFetchUrl("http://127.0.0.1:9999/")).toThrow(/HTTPS/);
  });
});

describe("fetchOidcDiscovery SSRF guard", () => {
  it("rejects metadata issuer before fetch", async () => {
    await expect(fetchOidcDiscovery("https://169.254.169.254/")).rejects.toThrow(/private or link-local/);
  });
});
