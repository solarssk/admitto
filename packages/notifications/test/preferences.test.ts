import type { PrismaClient } from "@admitto/db";
import { describe, expect, it, vi } from "vitest";
import {
  resolveEnabledChannels,
  resolveEnabledChannelsForUsers,
  resolvePersonalPreferences,
  setNotificationPreference,
} from "../src/preferences.js";
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

describe("resolvePersonalPreferences", () => {
  it("maps every userConfigurable type to its full non-webhook channel set when no rows exist", async () => {
    const db = createStubDb();
    db.notificationPreference.findMany.mockResolvedValue([]);

    const result = await resolvePersonalPreferences(db as unknown as PrismaClient, "user-1");

    expect(result.get(TYPE)!.toSorted((a, b) => a.localeCompare(b))).toEqual(["email", "in_app"]);
    expect(result.get("auth.mfa.break_glass")!.toSorted((a, b) => a.localeCompare(b))).toEqual([
      "email",
      "in_app",
    ]);
  });

  it("queries once across every userConfigurable type for the one user", async () => {
    const db = createStubDb();
    db.notificationPreference.findMany.mockResolvedValue([]);

    await resolvePersonalPreferences(db as unknown as PrismaClient, "user-1");

    expect(db.notificationPreference.findMany).toHaveBeenCalledTimes(1);
    const call = db.notificationPreference.findMany.mock.calls[0]![0] as {
      where: { user_id: string; notification_type: { in: string[] } };
    };
    expect(call.where.user_id).toBe("user-1");
    expect(call.where.notification_type.in.toSorted()).toEqual(
      [
        "auth.login.repeated_failures",
        "auth.mfa.break_glass",
        "auth.settings.changed",
        "auth.login.new_country",
        "auth.role.elevated",
        WEBHOOK_ONLY_TYPE,
      ].toSorted(),
    );
  });

  it("narrows just the explicitly-disabled channel for one type, leaving other types untouched", async () => {
    const db = createStubDb();
    db.notificationPreference.findMany.mockResolvedValue([
      { notification_type: TYPE, channel: "email", enabled: false },
    ]);

    const result = await resolvePersonalPreferences(db as unknown as PrismaClient, "user-1");

    expect(result.get(TYPE)).toEqual(["in_app"]);
    expect(result.get("auth.mfa.break_glass")!.toSorted((a, b) => a.localeCompare(b))).toEqual([
      "email",
      "in_app",
    ]);
  });

  it("omits a non-userConfigurable type from the map entirely - nothing for the grid to toggle", async () => {
    const db = createStubDb();
    db.notificationPreference.findMany.mockResolvedValue([]);

    const result = await resolvePersonalPreferences(db as unknown as PrismaClient, "user-1");

    expect(result.has(MANDATORY_TYPE)).toBe(false);
  });

  it("maps a webhook-only type to an empty personal channel list", async () => {
    const db = createStubDb();
    db.notificationPreference.findMany.mockResolvedValue([]);

    const result = await resolvePersonalPreferences(db as unknown as PrismaClient, "user-1");

    expect(result.get(WEBHOOK_ONLY_TYPE)).toEqual([]);
  });
});

describe("setNotificationPreference", () => {
  it("upserts the given cell with the composite unique key", async () => {
    const db = createStubDb();

    await setNotificationPreference(db as unknown as PrismaClient, "user-1", TYPE, "email", false);

    expect(db.notificationPreference.upsert).toHaveBeenCalledWith({
      where: {
        user_id_notification_type_channel: { user_id: "user-1", notification_type: TYPE, channel: "email" },
      },
      create: { user_id: "user-1", notification_type: TYPE, channel: "email", enabled: false },
      update: { enabled: false },
    });
  });
});
