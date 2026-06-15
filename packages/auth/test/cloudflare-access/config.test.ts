import { describe, expect, it, afterEach } from "vitest";
import type { PrismaClient } from "@prisma/client";
import {
  getCfAccessConfig,
  normalizeCfAccessTeamDomain,
  resolveTeamDomainFromRaw,
  pathMatchesCfProtectedPrefix,
  validateCfAccessBootConfigFromResolved,
} from "../../src/cloudflare-access/config.js";

const mockPrisma = {
  systemSettings: { findUnique: async () => null },
} as unknown as PrismaClient;

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

describe("getCfAccessConfig env lock", () => {
  const prev = process.env.CF_ACCESS_ENABLED;

  afterEach(() => {
    if (prev === undefined) delete process.env.CF_ACCESS_ENABLED;
    else process.env.CF_ACCESS_ENABLED = prev;
  });

  it("treats CF_ACCESS_ENABLED=false as disabled", async () => {
    process.env.CF_ACCESS_ENABLED = "false";
    const config = await getCfAccessConfig(mockPrisma);
    expect(config.enabled).toBe(false);
  });
});

describe("resolveTeamDomainFromRaw", () => {
  const prevNodeEnv = process.env.NODE_ENV;

  afterEach(() => {
    if (prevNodeEnv === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = prevNodeEnv;
  });

  it("allows loopback only in test NODE_ENV", () => {
    process.env.NODE_ENV = "test";
    expect(resolveTeamDomainFromRaw("http://127.0.0.1:9999")).toBe("http://127.0.0.1:9999");
  });

  it("rejects loopback in development NODE_ENV", () => {
    process.env.NODE_ENV = "development";
    expect(() => resolveTeamDomainFromRaw("http://127.0.0.1:9999")).toThrow();
  });

  it("does not treat localhost substring in cloudflareaccess host as loopback", () => {
    process.env.NODE_ENV = "test";
    expect(resolveTeamDomainFromRaw("https://my-localhost-team.cloudflareaccess.com")).toBe(
      "https://my-localhost-team.cloudflareaccess.com",
    );
  });
});
