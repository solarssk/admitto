import type { PrismaClient } from "@admitto/db";
import { describe, expect, it } from "vitest";
import { resolveEnabledChannels, resolveEnabledChannelsForUsers } from "../src/preferences.js";
import { createStubDb } from "./stubDb.js";

const TYPE = "auth.login.repeated_failures";

describe("resolveEnabledChannels", () => {
  it("returns every non-webhook channel when no preference rows exist (opt-out default)", async () => {
    const db = createStubDb();
    db.notificationPreference.findMany.mockResolvedValue([]);

    const enabled = await resolveEnabledChannels(db as unknown as PrismaClient, "user-1", TYPE);

    expect(enabled.toSorted((a, b) => a.localeCompare(b))).toEqual(["email", "in_app"]);
    expect(db.notificationPreference.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          user_id: { in: ["user-1"] },
          notification_type: TYPE,
        }),
      }),
    );
  });

  it("filters out a channel the user explicitly disabled", async () => {
    const db = createStubDb();
    db.notificationPreference.findMany.mockResolvedValue([
      { user_id: "user-1", channel: "email", enabled: false },
    ]);

    const enabled = await resolveEnabledChannels(db as unknown as PrismaClient, "user-1", TYPE);

    expect(enabled).toEqual(["in_app"]);
  });

  it("treats a channel with no explicit row as enabled even when another channel has a row", async () => {
    const db = createStubDb();
    db.notificationPreference.findMany.mockResolvedValue([
      { user_id: "user-1", channel: "in_app", enabled: false },
    ]);

    const enabled = await resolveEnabledChannels(db as unknown as PrismaClient, "user-1", TYPE);

    expect(enabled).toEqual(["email"]);
  });

  it("returns [] for an unregistered notification type", async () => {
    const db = createStubDb();
    const enabled = await resolveEnabledChannels(db as unknown as PrismaClient, "user-1", "not.real");
    expect(enabled).toEqual([]);
    expect(db.notificationPreference.findMany).not.toHaveBeenCalled();
  });
});

describe("resolveEnabledChannelsForUsers", () => {
  it("returns an empty map for an empty user list without querying", async () => {
    const db = createStubDb();
    const result = await resolveEnabledChannelsForUsers(db as unknown as PrismaClient, [], TYPE);
    expect(result.size).toBe(0);
    expect(db.notificationPreference.findMany).not.toHaveBeenCalled();
  });

  it("resolves each user independently from a single batched query", async () => {
    const db = createStubDb();
    db.notificationPreference.findMany.mockResolvedValue([
      { user_id: "user-2", channel: "email", enabled: false },
    ]);

    const result = await resolveEnabledChannelsForUsers(
      db as unknown as PrismaClient,
      ["user-1", "user-2"],
      TYPE,
    );

    expect(db.notificationPreference.findMany).toHaveBeenCalledTimes(1);
    expect(db.notificationPreference.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ user_id: { in: ["user-1", "user-2"] } }) }),
    );
    expect(result.get("user-1")!.toSorted((a, b) => a.localeCompare(b))).toEqual(["email", "in_app"]);
    expect(result.get("user-2")).toEqual(["in_app"]);
  });
});
