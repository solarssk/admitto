import { describe, expect, it, vi } from "vitest";
import type { PrismaClient } from "@admitto/db";

vi.mock("../src/auth/safe-redirect.js", () => ({
  resolvePostLoginRedirect: vi.fn((_next: string | undefined, _assignments: unknown[]) => "/admin"),
}));

vi.mock("@admitto/auth", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@admitto/auth")>();
  return {
    ...actual,
    getCfAccessConfigCached: vi.fn(),
    canAccessCheckInPanel: vi.fn(),
  };
});

import { canAccessCheckInPanel, getCfAccessConfigCached } from "@admitto/auth";
import { resolvePostLoginRedirect } from "../src/auth/safe-redirect.js";
import { resolvePostLoginRedirectForUser } from "../src/auth/post-login-redirect.js";

const resolveRedirect = vi.mocked(resolvePostLoginRedirect);
const cfConfigCached = vi.mocked(getCfAccessConfigCached);
const canCheckIn = vi.mocked(canAccessCheckInPanel);

function makeDb(assignments: unknown[] = []): PrismaClient {
  return {
    user: { findUnique: vi.fn(async () => ({ must_change_password: false })) },
    roleAssignment: { findMany: vi.fn(async () => assignments) },
  } as unknown as PrismaClient;
}

describe("resolvePostLoginRedirectForUser", () => {
  it("returns /change-password when the user must change password", async () => {
    const db = {
      user: {
        findUnique: vi.fn(async () => ({ must_change_password: true })),
      },
      roleAssignment: {
        findMany: vi.fn(),
      },
    } as unknown as PrismaClient;

    await expect(resolvePostLoginRedirectForUser(db, "u1", "/operator")).resolves.toBe(
      "/change-password",
    );
    expect(db.roleAssignment.findMany).not.toHaveBeenCalled();
  });

  it("delegates to resolvePostLoginRedirect with role assignments", async () => {
    resolveRedirect.mockReturnValue("/operator");
    const assignments = [{ role: "operator", scope_type: "event", scope_id: "e1" }];
    const db = {
      user: {
        findUnique: vi.fn(async () => ({ must_change_password: false })),
      },
      roleAssignment: {
        findMany: vi.fn(async () => assignments),
      },
    } as unknown as PrismaClient;

    await expect(resolvePostLoginRedirectForUser(db, "u1", "/operator")).resolves.toBe(
      "/operator",
    );
    expect(resolveRedirect).toHaveBeenCalledWith("/operator", assignments);
  });
});

describe("resolvePostLoginRedirectForUser — /admin unreachable via a session-only login", () => {
  it("lands on /admin as normal when Cloudflare Access is disabled", async () => {
    resolveRedirect.mockReturnValue("/admin");
    cfConfigCached.mockResolvedValue({
      enabled: false,
      teamDomain: "",
      audience: [],
      protectedPrefixes: ["/admin", "/api/admin"],
      sourceProviderId: "",
      jwksUri: "",
    });

    await expect(resolvePostLoginRedirectForUser(makeDb(), "u1")).resolves.toBe("/admin");
    expect(canCheckIn).not.toHaveBeenCalled();
  });

  it("lands on /admin as normal when Cloudflare Access does not protect that path", async () => {
    resolveRedirect.mockReturnValue("/admin");
    cfConfigCached.mockResolvedValue({
      enabled: true,
      teamDomain: "https://team.cloudflareaccess.com",
      audience: ["aud"],
      protectedPrefixes: ["/some-other-path"],
      sourceProviderId: "provider-1",
      jwksUri: "https://team.cloudflareaccess.com/cdn-cgi/access/certs",
    });

    await expect(resolvePostLoginRedirectForUser(makeDb(), "u1")).resolves.toBe("/admin");
    expect(canCheckIn).not.toHaveBeenCalled();
  });

  it("redirects to /operator when /admin is Cloudflare-protected but the account can check in", async () => {
    resolveRedirect.mockReturnValue("/admin");
    cfConfigCached.mockResolvedValue({
      enabled: true,
      teamDomain: "https://team.cloudflareaccess.com",
      audience: ["aud"],
      protectedPrefixes: ["/admin", "/api/admin"],
      sourceProviderId: "provider-1",
      jwksUri: "https://team.cloudflareaccess.com/cdn-cgi/access/certs",
    });
    canCheckIn.mockResolvedValue(true);

    await expect(resolvePostLoginRedirectForUser(makeDb(), "u1")).resolves.toBe("/operator");
  });

  it("falls back to /account when /admin is Cloudflare-protected and there is no check-in fallback either", async () => {
    resolveRedirect.mockReturnValue("/admin");
    cfConfigCached.mockResolvedValue({
      enabled: true,
      teamDomain: "https://team.cloudflareaccess.com",
      audience: ["aud"],
      protectedPrefixes: ["/admin"],
      sourceProviderId: "provider-1",
      jwksUri: "https://team.cloudflareaccess.com/cdn-cgi/access/certs",
    });
    canCheckIn.mockResolvedValue(false);

    await expect(resolvePostLoginRedirectForUser(makeDb(), "u1")).resolves.toBe("/account");
  });
});
