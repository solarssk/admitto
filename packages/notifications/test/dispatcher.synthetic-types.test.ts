import type { PrismaClient } from "@admitto/db";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { notify } from "../src/dispatcher.js";
import type { NotificationChannel } from "../src/channel.js";
import type { NotificationEvent } from "../src/types.js";
import { createStubDb } from "./stubDb.js";

// vi.mock is hoisted above regular top-level consts - anything the factory references must be
// declared via vi.hoisted() to avoid a temporal-dead-zone ReferenceError.
const { SELF_TYPE, EMPTY_CHANNELS_TYPE, WEBHOOK_INAPP_ONLY_TYPE } = vi.hoisted(() => ({
  SELF_TYPE: "test.self_audience",
  EMPTY_CHANNELS_TYPE: "test.no_channels",
  WEBHOOK_INAPP_ONLY_TYPE: "test.webhook_and_inapp_only",
}));

// Every real foundation type is org-staff-audience with all 3 channels and an explicit
// throttleWindowMinutes - a handful of dispatcher.ts branches (the "self" audience path, a type
// with no available channels at all, the DEFAULT_THROTTLE_WINDOW_MINUTES fallback) are only
// reachable with a type shape the real registry doesn't have yet. Real types stay real via
// importOriginal; only these two synthetic entries are added.
vi.mock("../src/registry.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/registry.js")>();
  const synthetic = {
    ...actual.NOTIFICATION_TYPES,
    [SELF_TYPE]: {
      category: "system",
      label: "Self-audience test type",
      defaultSeverity: "warn",
      availableChannels: ["email"],
      audience: "self",
      // Deliberately omitted - exercises DEFAULT_THROTTLE_WINDOW_MINUTES.
      userConfigurable: false,
      orgDisableable: false,
    },
    [EMPTY_CHANNELS_TYPE]: {
      category: "system",
      label: "Channel-less test type",
      defaultSeverity: "info",
      availableChannels: [],
      audience: "org-staff",
      throttleWindowMinutes: 15,
      userConfigurable: true,
      orgDisableable: true,
    },
    [WEBHOOK_INAPP_ONLY_TYPE]: {
      category: "system",
      label: "Webhook + in-app only test type (no email)",
      defaultSeverity: "info",
      availableChannels: ["webhook", "in_app"],
      audience: "org-staff",
      throttleWindowMinutes: 15,
      userConfigurable: true,
      orgDisableable: true,
    },
  };
  return {
    ...actual,
    NOTIFICATION_TYPES: synthetic,
    getNotificationTypeDef: (type: string) =>
      Object.getOwnPropertyDescriptor(synthetic, type)?.value,
  };
});

const ORG_ID = "org-1";
const EVENT: NotificationEvent = {
  organizationId: ORG_ID,
  title: "Test event",
  body: "Test body.",
};

function stubChannel() {
  const send = vi.fn().mockResolvedValue({ ok: true });
  return { channel: "email" as const, send } satisfies NotificationChannel;
}

describe("notify() with synthetic type shapes", () => {
  let db: ReturnType<typeof createStubDb>;

  beforeEach(() => {
    db = createStubDb();
    db.notificationSettings.findUnique.mockResolvedValue(null);
    db.$queryRaw.mockResolvedValue([{ id: "throttle-1" }]);
    db.securityAuditLog.create.mockResolvedValue({});
  });

  it('logs "self_target_invalid" (not skipped_empty_audience) when a self-audience type resolves no candidate, and falls back to the default throttle window', async () => {
    db.user.findUnique.mockResolvedValue(null); // no such user -> resolveSelf() returns []
    const email = stubChannel();

    await notify(
      db as unknown as PrismaClient,
      SELF_TYPE,
      { ...EVENT, targetUserId: "ghost-user" },
      { channels: { email } },
    );

    expect(email.send).not.toHaveBeenCalled();
    expect(db.$queryRaw).toHaveBeenCalled();
    expect(db.securityAuditLog.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          event_type: "notification.dispatch.failed",
          user_id: "ghost-user",
          metadata: expect.objectContaining({ reason: "self_target_invalid" }),
        }),
      }),
    );
    expect(db.notificationThrottle.deleteMany).toHaveBeenCalled();
  });

  it("sends to a valid self-audience target", async () => {
    db.user.findUnique.mockResolvedValue({ is_active: true });
    db.roleAssignment.findMany.mockResolvedValue([{ scope_type: "instance", scope_id: null }]);
    const email = stubChannel();

    await notify(
      db as unknown as PrismaClient,
      SELF_TYPE,
      { ...EVENT, targetUserId: "u-1" },
      { channels: { email } },
    );

    expect(email.send).toHaveBeenCalledWith(expect.anything(), ["u-1"]);
  });

  it("calls no channel at all for a type with an empty availableChannels list, records it as skipped (not sent), and releases the throttle claim", async () => {
    db.roleAssignment.findMany.mockResolvedValue([{ user_id: "u-1", user: { is_active: true } }]);
    const email = stubChannel();
    const webhook = stubChannel();
    const inApp = stubChannel();

    await notify(db as unknown as PrismaClient, EMPTY_CHANNELS_TYPE, EVENT, {
      channels: { email, webhook, in_app: inApp },
    });

    expect(email.send).not.toHaveBeenCalled();
    expect(webhook.send).not.toHaveBeenCalled();
    expect(inApp.send).not.toHaveBeenCalled();
    expect(db.securityAuditLog.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          event_type: "notification.dispatch.skipped_no_recipients",
        }),
      }),
    );
    expect(db.notificationThrottle.deleteMany).toHaveBeenCalled();
  });

  it("reports only in_app (not email) as a failure when resolving recipients throws for a type without an email channel, and keeps the already-successful webhook", async () => {
    db.roleAssignment.findMany.mockResolvedValue([{ user_id: "u-1", user: { is_active: true } }]);
    db.notificationPreference.findMany.mockRejectedValue(new Error("connection reset"));
    const webhook = stubChannel();

    await notify(db as unknown as PrismaClient, WEBHOOK_INAPP_ONLY_TYPE, EVENT, {
      channels: { webhook, email: stubChannel(), in_app: stubChannel() },
    });

    expect(webhook.send).toHaveBeenCalled();
    expect(db.notificationThrottle.deleteMany).not.toHaveBeenCalled();
    expect(db.securityAuditLog.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          event_type: "notification.dispatch.failed",
          metadata: expect.objectContaining({
            channels_sent: ["webhook"],
            failures: [{ channel: "in_app", error: expect.any(String) }],
          }),
        }),
      }),
    );
  });
});
