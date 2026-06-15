import { afterEach, describe, expect, it, vi } from "vitest";
import type { PrismaClient } from "@prisma/client";
import {
  getSetting,
  getTrustedDeviceDays,
  setSetting,
} from "../../src/settings/resolver.js";

const envOnlyMockPrisma = {
  systemSettings: { findUnique: async () => null },
} as unknown as PrismaClient;

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
