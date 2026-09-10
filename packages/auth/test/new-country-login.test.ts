import { describe, expect, it, vi, beforeEach } from "vitest";
import type { PrismaClient } from "@admitto/db";

const mocks = vi.hoisted(() => ({
  resolveIpLocation: vi.fn(),
  logLoginNewCountry: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("@admitto/shared/ip-location", () => ({
  resolveIpLocation: mocks.resolveIpLocation,
}));

vi.mock("../src/audit.js", () => ({
  logLoginNewCountry: mocks.logLoginNewCountry,
}));

import { checkNewCountryLogin } from "../src/new-country-login.js";

/** Fake `db` covering exactly what this module touches. */
function fakeDb(opts: {
  roles?: Array<{ role: string }>;
  priorLoginIps?: Array<string | null>;
} = {}): PrismaClient {
  return {
    roleAssignment: { findMany: vi.fn().mockResolvedValue(opts.roles ?? [{ role: "admin" }]) },
    securityAuditLog: {
      findMany: vi.fn().mockResolvedValue((opts.priorLoginIps ?? []).map((ip) => ({ ip }))),
    },
  } as unknown as PrismaClient;
}

const ctx = { userId: "user-1", ip: "203.0.113.5" };

describe("checkNewCountryLogin", () => {
  beforeEach(() => {
    mocks.resolveIpLocation.mockReset();
    mocks.logLoginNewCountry.mockClear();
  });

  it("no-ops without querying anything when no ip is given", async () => {
    const db = fakeDb();
    await checkNewCountryLogin(db, { userId: "user-1" });
    expect(mocks.resolveIpLocation).not.toHaveBeenCalled();
    expect(db.roleAssignment.findMany).not.toHaveBeenCalled();
    expect(mocks.logLoginNewCountry).not.toHaveBeenCalled();
  });

  it("no-ops when the current login's ip doesn't resolve to a country (unknown)", async () => {
    mocks.resolveIpLocation.mockReturnValue({ kind: "unknown" });
    const db = fakeDb();
    await checkNewCountryLogin(db, ctx);
    expect(db.roleAssignment.findMany).not.toHaveBeenCalled();
    expect(mocks.logLoginNewCountry).not.toHaveBeenCalled();
  });

  it("no-ops when the current login's ip is internal/private", async () => {
    mocks.resolveIpLocation.mockReturnValue({ kind: "internal" });
    const db = fakeDb();
    await checkNewCountryLogin(db, ctx);
    expect(db.roleAssignment.findMany).not.toHaveBeenCalled();
    expect(mocks.logLoginNewCountry).not.toHaveBeenCalled();
  });

  it("no-ops for an account with no admin/superadmin role, without querying login history", async () => {
    mocks.resolveIpLocation.mockReturnValue({ kind: "resolved", countryCode: "FR" });
    const db = fakeDb({ roles: [{ role: "operator" }] });
    await checkNewCountryLogin(db, ctx);
    expect(db.securityAuditLog.findMany).not.toHaveBeenCalled();
    expect(mocks.logLoginNewCountry).not.toHaveBeenCalled();
  });

  it("queries the last 5 successful logins for this user (both local and OIDC event types), most recent first", async () => {
    mocks.resolveIpLocation.mockReturnValue({ kind: "resolved", countryCode: "FR" });
    const db = fakeDb({ priorLoginIps: ["1.2.3.4"] });
    await checkNewCountryLogin(db, ctx);
    expect(db.securityAuditLog.findMany).toHaveBeenCalledWith({
      where: { user_id: "user-1", event_type: { in: ["auth.login.success", "auth.oidc.success"] } },
      orderBy: { created_at: "desc" },
      take: 5,
      select: { ip: true },
    });
  });

  it("no-ops on the very first successful login ever (no history to compare against)", async () => {
    mocks.resolveIpLocation.mockReturnValue({ kind: "resolved", countryCode: "FR" });
    const db = fakeDb({ priorLoginIps: [] });
    await checkNewCountryLogin(db, ctx);
    expect(mocks.logLoginNewCountry).not.toHaveBeenCalled();
  });

  it("no-ops when none of the recent history resolves to a known country (no reliable baseline)", async () => {
    const db = fakeDb({ priorLoginIps: ["10.0.0.1", "10.0.0.2"] });
    mocks.resolveIpLocation
      .mockReturnValueOnce({ kind: "resolved", countryCode: "FR" }) // current login
      .mockReturnValueOnce({ kind: "internal" }) // prior #1
      .mockReturnValueOnce({ kind: "internal" }); // prior #2
    await checkNewCountryLogin(db, ctx);
    expect(mocks.logLoginNewCountry).not.toHaveBeenCalled();
  });

  it("no-ops when the current country is already among the recent history", async () => {
    const db = fakeDb({ priorLoginIps: ["1.2.3.4", "5.6.7.8"] });
    mocks.resolveIpLocation
      .mockReturnValueOnce({ kind: "resolved", countryCode: "FR" }) // current login
      .mockReturnValueOnce({ kind: "resolved", countryCode: "DE" }) // prior #1
      .mockReturnValueOnce({ kind: "resolved", countryCode: "FR" }); // prior #2 - same as current
    await checkNewCountryLogin(db, ctx);
    expect(mocks.logLoginNewCountry).not.toHaveBeenCalled();
  });

  it("fires logLoginNewCountry when the current country isn't among the recent, resolved history", async () => {
    const db = fakeDb({ priorLoginIps: ["1.2.3.4", "5.6.7.8"] });
    mocks.resolveIpLocation
      .mockReturnValueOnce({ kind: "resolved", countryCode: "FR" }) // current login
      .mockReturnValueOnce({ kind: "resolved", countryCode: "DE" }) // prior #1
      .mockReturnValueOnce({ kind: "internal" }); // prior #2 - no baseline value, but DE alone is enough
    await checkNewCountryLogin(db, ctx);
    expect(mocks.logLoginNewCountry).toHaveBeenCalledWith(db, {
      userId: "user-1",
      ip: "203.0.113.5",
      countryCode: "FR",
    });
  });

  it("swallows and logs a role-query failure instead of propagating it (the caller's session already exists)", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    mocks.resolveIpLocation.mockReturnValue({ kind: "resolved", countryCode: "FR" });
    const db = {
      roleAssignment: { findMany: vi.fn().mockRejectedValue(new Error("connection reset")) },
      securityAuditLog: { findMany: vi.fn() },
    } as unknown as PrismaClient;

    await expect(checkNewCountryLogin(db, ctx)).resolves.toBeUndefined();
    expect(mocks.logLoginNewCountry).not.toHaveBeenCalled();
    expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining("auth.new_country_check_failed"));
  });

  it("swallows and logs a history-query failure instead of propagating it", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    mocks.resolveIpLocation.mockReturnValue({ kind: "resolved", countryCode: "FR" });
    const db = {
      roleAssignment: { findMany: vi.fn().mockResolvedValue([{ role: "admin" }]) },
      securityAuditLog: { findMany: vi.fn().mockRejectedValue(new Error("query timeout")) },
    } as unknown as PrismaClient;

    await expect(checkNewCountryLogin(db, ctx)).resolves.toBeUndefined();
    expect(mocks.logLoginNewCountry).not.toHaveBeenCalled();
    expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining("auth.new_country_check_failed"));
  });
});
