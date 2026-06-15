import { describe, expect, it } from "vitest";
import {
  normalizeCfAccessTeamDomain,
  pathMatchesCfProtectedPrefix,
  validateCfAccessBootConfigFromResolved,
} from "../../src/cloudflare-access/config.js";

describe("normalizeCfAccessTeamDomain", () => {
  it("accepts full https issuer URL", () => {
    expect(normalizeCfAccessTeamDomain("https://myteam.cloudflareaccess.com")).toBe(
      "https://myteam.cloudflareaccess.com",
    );
  });

  it("strips trailing slash", () => {
    expect(normalizeCfAccessTeamDomain("https://myteam.cloudflareaccess.com/")).toBe(
      "https://myteam.cloudflareaccess.com",
    );
  });

  it("rejects non-cloudflareaccess host", () => {
    expect(() => normalizeCfAccessTeamDomain("https://evil.example.com")).toThrow(
      "cloudflareaccess.com",
    );
  });
});

describe("pathMatchesCfProtectedPrefix", () => {
  it("matches admin collision prefixes", () => {
    expect(pathMatchesCfProtectedPrefix("/admin", ["/admin", "/api/admin"])).toBe(true);
    expect(pathMatchesCfProtectedPrefix("/admin/auth/providers", ["/admin"])).toBe(true);
    expect(pathMatchesCfProtectedPrefix("/api/admin/foo", ["/api/admin"])).toBe(true);
    expect(pathMatchesCfProtectedPrefix("/login", ["/admin"])).toBe(false);
  });
});

describe("validateCfAccessBootConfigFromResolved", () => {
  it("throws when enabled without team or aud", () => {
    expect(() =>
      validateCfAccessBootConfigFromResolved({
        enabled: true,
        teamDomain: "",
        audience: [],
        protectedPrefixes: ["/admin"],
        jwksUri: "",
      }),
    ).toThrow("CF_ACCESS_TEAM_DOMAIN");
  });
});
