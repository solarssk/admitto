import type { PrismaClient } from "@admitto/db";
import { describe, expect, it, vi } from "vitest";
import { resolveEnabledChannels, resolveEnabledChannelsForUsers } from "../src/preferences.js";
import { createStubDb } from "./stubDb.js";

const TYPE = "auth.login.repeated_failures";

// vi.mock is hoisted above regular top-level consts - anything the factory below references must
// itself be declared via vi.hoisted() to avoid a temporal-dead-zone ReferenceError.
const { WEBHOOK_ONLY_TYPE, MANDATORY_TYPE } = vi.hoisted(() => ({
  WEBHOOK_ONLY_TYPE: "test.webhook_only",
  MANDATORY_TYPE: "test.mandatory",
}));

// Real registry types stay real for every existing test below; two synthetic entries are added
// for edge cases the real 4-type foundation registry can't exercise on its own (a type with only
// a webhook channel, and a non-userConfigurable type) - see notifications-module-foundation plan
// decision #6 for why userConfigurable:false exists at all.
vi.mock("../src/registry.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/registry.js")>();
  const synthetic = {
    ...actual.NOTIFICATION_TYPES,
    [WEBHOOK_ONLY_TYPE]: {
      category: "system",
      label: "Webhook-only test type",
      defaultSeverity: "info",
      availableChannels: ["webhook"],
      audience: "org-staff",
      userConfigurable: true,
      orgDisableable: true,
    },
    [MANDATORY_TYPE]: {
      category: "system",
      label: "Mandatory test type",
      defaultSeverity: "warn",
      availableChannels: ["email", "in_app"],
      audience: "self",
      userConfigurable: false,
      orgDisableable: false,
    },
  };
  return {
    ...actual,
    NOTIFICATION_TYPES: synthetic,
    getNotificationTypeDef: (type: string) =>
      Object.getOwnPropertyDescriptor(synthetic, type)?.value,
  };
});

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

  it("returns [] without querying for a type whose only channel is webhook", async () => {
    const db = createStubDb();
    const enabled = await resolveEnabledChannels(
      db as unknown as PrismaClient,
      "user-1",
      WEBHOOK_ONLY_TYPE,
    );
    expect(enabled).toEqual([]);
    expect(db.notificationPreference.findMany).not.toHaveBeenCalled();
  });

  it("returns the full channel set for a non-userConfigurable type, ignoring any stored row", async () => {
    const db = createStubDb();
    db.notificationPreference.findMany.mockResolvedValue([
      { user_id: "user-1", channel: "email", enabled: false },
    ]);

    const enabled = await resolveEnabledChannels(
      db as unknown as PrismaClient,
      "user-1",
      MANDATORY_TYPE,
    );

    expect(enabled.toSorted((a, b) => a.localeCompare(b))).toEqual(["email", "in_app"]);
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
