import { describe, expect, it, vi } from "vitest";
import type { PrismaClient } from "@prisma/client";
import { setSetting } from "../../src/settings/resolver.js";

describe("setSetting", () => {
  it("rejects non-JSON-serializable values before writing", async () => {
    const upsert = vi.fn();
    const prisma = { systemSettings: { upsert } } as unknown as PrismaClient;

    await expect(setSetting(prisma, "cf_access_enabled", undefined)).rejects.toThrow(
      "setting_not_json_serializable:cf_access_enabled",
    );
    expect(upsert).not.toHaveBeenCalled();
  });

  it("serializes booleans and arrays", async () => {
    const upsert = vi.fn().mockResolvedValue({});
    const prisma = { systemSettings: { upsert } } as unknown as PrismaClient;

    await setSetting(prisma, "cf_access_enabled", true);
    expect(upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        create: { key: "cf_access_enabled", value_json: "true" },
        update: { value_json: "true" },
      }),
    );

    await setSetting(prisma, "cf_access_aud", ["/admin"]);
    expect(upsert).toHaveBeenLastCalledWith(
      expect.objectContaining({
        update: { value_json: '["/admin"]' },
      }),
    );
  });
});
