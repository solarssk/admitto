import { afterEach, describe, expect, it, vi } from "vitest";
import type { PrismaClient } from "@admitto/db";
import {
  getSetting,
  getMfaRequiredRoles,
  getSessionTtlAdminMs,
  getSessionTtlOperatorMs,
  getSessionIdleTimeoutAdminMs,
  getSessionIdleTimeoutOperatorMs,
  getTrustedDeviceDays,
  getWebauthnEnabled,
  setSetting,
} from "../../src/settings/resolver.js";
import {
  DEFAULT_MFA_REQUIRED_ROLES,
  DEFAULT_TRUSTED_DEVICE_DAYS,
  SESSION_TTL_ADMIN_MS,
  SESSION_TTL_OPERATOR_MS,
  SESSION_IDLE_TIMEOUT_ADMIN_MS,
  SESSION_IDLE_TIMEOUT_OPERATOR_MS,
} from "../../src/constants.js";

const envOnlyMockPrisma = {
  systemSettings: { findUnique: async () => null },
} as unknown as PrismaClient;

function settingsMockPrisma(values: Record<string, unknown>): PrismaClient {
  return {
    systemSettings: {
      findUnique: async ({ where }: { where: { key: string } }) => {
        const value = values[where.key];
        return value === undefined ? null : { value_json: JSON.stringify(value) };
      },
    },
  } as unknown as PrismaClient;
}

describe("setSetting", () => {
  it("rejects non-JSON-serializable values before writing", async () => {
    const upsert = vi.fn();
    const prisma = { systemSettings: { upsert } } as unknown as PrismaClient;

    await expect(setSetting(prisma, "test_setting_serialization", undefined)).rejects.toThrow(
      "setting_not_json_serializable:test_setting_serialization",
    );
    expect(upsert).not.toHaveBeenCalled();
  });

  it("serializes booleans and arrays", async () => {
    const upsert = vi.fn().mockResolvedValue({});
    const prisma = { systemSettings: { upsert } } as unknown as PrismaClient;

    await setSetting(prisma, "test_setting_serialization", true);
    expect(upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        create: { key: "test_setting_serialization", value_json: "true" },
        update: { value_json: "true" },
      }),
    );

    await setSetting(prisma, "test_setting_serialization", ["/admin"]);
    expect(upsert).toHaveBeenLastCalledWith(
      expect.objectContaining({
        update: { value_json: '["/admin"]' },
      }),
    );
  });
});

describe("env lock parsing", () => {
  const prevTrusted = process.env.TRUSTED_DEVICE_DAYS;
  const prevCfEnabled = process.env.CF_ACCESS_ENABLED;

  afterEach(() => {
    if (prevTrusted === undefined) delete process.env.TRUSTED_DEVICE_DAYS;
    else process.env.TRUSTED_DEVICE_DAYS = prevTrusted;
    if (prevCfEnabled === undefined) delete process.env.CF_ACCESS_ENABLED;
    else process.env.CF_ACCESS_ENABLED = prevCfEnabled;
  });

  it("parses numeric env locks as numbers (TRUSTED_DEVICE_DAYS=1)", async () => {
    process.env.TRUSTED_DEVICE_DAYS = "1";
    await expect(getSetting<number>(envOnlyMockPrisma, "trusted_device_days")).resolves.toBe(1);
    await expect(getTrustedDeviceDays(envOnlyMockPrisma)).resolves.toBe(1);
  });

  it("parses boolean env locks with 0/1 aliases (CF_ACCESS_ENABLED)", async () => {
    process.env.CF_ACCESS_ENABLED = "1";
    await expect(getSetting<boolean>(envOnlyMockPrisma, "cf_access_enabled")).resolves.toBe(true);

    process.env.CF_ACCESS_ENABLED = "0";
    await expect(getSetting<boolean>(envOnlyMockPrisma, "cf_access_enabled")).resolves.toBe(false);
  });
});

describe("typed settings fallbacks", () => {
  it("falls back when persisted TTLs and trusted-device days are not valid positive numbers", async () => {
    const prisma = settingsMockPrisma({
      session_ttl: 0,
      operator_session_ttl: -1,
      trusted_device_days: -1,
    });

    await expect(getSessionTtlAdminMs(prisma)).resolves.toBe(SESSION_TTL_ADMIN_MS);
    await expect(getSessionTtlOperatorMs(prisma)).resolves.toBe(SESSION_TTL_OPERATOR_MS);
    await expect(getTrustedDeviceDays(prisma)).resolves.toBe(DEFAULT_TRUSTED_DEVICE_DAYS);
  });

  it("falls back when persisted idle timeouts are not valid positive numbers", async () => {
    const prisma = settingsMockPrisma({
      session_idle_timeout: 0,
      operator_session_idle_timeout: -1,
    });

    await expect(getSessionIdleTimeoutAdminMs(prisma)).resolves.toBe(
      SESSION_IDLE_TIMEOUT_ADMIN_MS,
    );
    await expect(getSessionIdleTimeoutOperatorMs(prisma)).resolves.toBe(
      SESSION_IDLE_TIMEOUT_OPERATOR_MS,
    );
  });

  it("resolves persisted idle timeouts when valid", async () => {
    const prisma = settingsMockPrisma({
      session_idle_timeout: 900_000,
      operator_session_idle_timeout: 1_800_000,
    });

    await expect(getSessionIdleTimeoutAdminMs(prisma)).resolves.toBe(900_000);
    await expect(getSessionIdleTimeoutOperatorMs(prisma)).resolves.toBe(1_800_000);
  });

  it("falls back to defaults for idle timeouts when nothing is persisted", async () => {
    await expect(getSessionIdleTimeoutAdminMs(envOnlyMockPrisma)).resolves.toBe(
      SESSION_IDLE_TIMEOUT_ADMIN_MS,
    );
    await expect(getSessionIdleTimeoutOperatorMs(envOnlyMockPrisma)).resolves.toBe(
      SESSION_IDLE_TIMEOUT_OPERATOR_MS,
    );
  });

  it("falls back when persisted setting types do not match their contracts", async () => {
    const prisma = settingsMockPrisma({
      session_ttl: "invalid",
      operator_session_ttl: "invalid",
      trusted_device_days: "invalid",
      mfa_required_roles: 123,
    });

    await expect(getSessionTtlAdminMs(prisma)).resolves.toBe(SESSION_TTL_ADMIN_MS);
    await expect(getSessionTtlOperatorMs(prisma)).resolves.toBe(SESSION_TTL_OPERATOR_MS);
    await expect(getTrustedDeviceDays(prisma)).resolves.toBe(DEFAULT_TRUSTED_DEVICE_DAYS);
    await expect(getMfaRequiredRoles(prisma)).resolves.toEqual(DEFAULT_MFA_REQUIRED_ROLES.split(","));
  });

  it("accepts a CSV value for the persisted MFA-role setting", async () => {
    const prisma = settingsMockPrisma({ mfa_required_roles: "admin, operator" });

    await expect(getMfaRequiredRoles(prisma)).resolves.toEqual(["admin", "operator"]);
  });

  it("resolves the persisted value for webauthn_enabled", async () => {
    const prisma = settingsMockPrisma({ webauthn_enabled: false });

    await expect(getWebauthnEnabled(prisma)).resolves.toBe(false);
  });

  it("falls back to the default (enabled) for webauthn_enabled when nothing is persisted", async () => {
    await expect(getWebauthnEnabled(envOnlyMockPrisma)).resolves.toBe(true);
  });
});
