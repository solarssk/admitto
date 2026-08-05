import { describe, expect, it, vi } from "vitest";
import { assertEditableServiceUrl } from "../../src/admin/external-services-url.js";

vi.mock("@admitto/shared/ssrf-guard", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@admitto/shared/ssrf-guard")>();
  return {
    ...actual,
    resolveSafeHostname: vi.fn(async (hostname: string) => {
      const host = actual.unbracketHostname(hostname);
      if (host === "evil.internal.example") {
        throw new actual.SafeHostnameError(
          "hostname_blocked",
          "hostname must not resolve to a private or link-local address",
        );
      }
      if (host === "missing.example") {
        throw new actual.SafeHostnameError("hostname_unresolved", "hostname could not be resolved");
      }
      if (actual.isLoopbackHost(host) || actual.isBlockedPrivateOrMetadataHost(host)) {
        throw new actual.SafeHostnameError(
          "hostname_blocked",
          "hostname must not resolve to a private or link-local address",
        );
      }
      return [{ address: "203.0.113.10", family: 4 as const }];
    }),
  };
});

describe("assertEditableServiceUrl", () => {
  it("accepts a public https URL after DNS recheck", async () => {
    await expect(assertEditableServiceUrl("https://api.open-meteo.com/")).resolves.toMatchObject({
      ok: true,
    });
  });

  it("rejects non-http(s), credentials, and unparseable input", async () => {
    await expect(assertEditableServiceUrl("ftp://api.open-meteo.com")).resolves.toEqual({
      ok: false,
      code: "invalid_url",
    });
    await expect(assertEditableServiceUrl("https://user:pass@api.open-meteo.com")).resolves.toEqual(
      {
        ok: false,
        code: "invalid_url",
      },
    );
    await expect(assertEditableServiceUrl("not a url")).resolves.toEqual({
      ok: false,
      code: "invalid_url",
    });
  });

  it.each([
    "http://169.254.169.254/",
    "http://127.0.0.1:8080/",
    "http://10.0.0.1/",
    "http://192.168.1.1/",
    "http://[::1]/",
  ])("rejects private/loopback/metadata literal %s", async (raw) => {
    await expect(assertEditableServiceUrl(raw)).resolves.toEqual({
      ok: false,
      code: "url_host_blocked",
    });
  });

  it("rejects hostnames that resolve privately or do not resolve", async () => {
    await expect(assertEditableServiceUrl("https://evil.internal.example")).resolves.toEqual({
      ok: false,
      code: "url_host_blocked",
    });
    await expect(assertEditableServiceUrl("https://missing.example")).resolves.toEqual({
      ok: false,
      code: "url_host_unresolved",
    });
  });

  it("rejects empty hostname URLs", async () => {
    // Some parsers normalise weird forms; an empty host string must still be blocked.
    const result = await assertEditableServiceUrl("https://");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(["invalid_url", "url_host_blocked"]).toContain(result.code);
  });

  it("treats unexpected DNS errors as unresolved", async () => {
    const { resolveSafeHostname } = await import("@admitto/shared/ssrf-guard");
    vi.mocked(resolveSafeHostname).mockRejectedValueOnce(new Error("ECONNREFUSED"));
    await expect(assertEditableServiceUrl("https://api.open-meteo.com")).resolves.toEqual({
      ok: false,
      code: "url_host_unresolved",
    });
  });
});
