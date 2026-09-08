import type { PrismaClient } from "@admitto/db";
import { decryptFromString, encryptToString } from "@admitto/crypto";
import { describe, expect, it } from "vitest";
import { describeNotificationSettings, patchNotificationSettings } from "../src/settings.js";
import { createStubDb } from "./stubDb.js";

const ORG_ID = "org-1";

describe("describeNotificationSettings", () => {
  it("reports webhook.set:false and defaults when no row exists", async () => {
    const db = createStubDb();
    db.notificationSettings.findUnique.mockResolvedValue(null);

    const result = await describeNotificationSettings(db as unknown as PrismaClient, ORG_ID);

    expect(result).toEqual({
      webhook: { set: false, kind: "generic" },
      extra_email_recipients: [],
      disabled_types: [],
    });
  });

  it("reports webhook.set:true without ever returning the decrypted URL", async () => {
    const db = createStubDb();
    db.notificationSettings.findUnique.mockResolvedValue({
      webhook_url_enc: encryptToString("https://discord.com/api/webhooks/x/y"),
      webhook_kind: "discord",
      extra_email_recipients: ["ops@example.com"],
      disabled_types: ["auth.settings.changed"],
    });

    const result = await describeNotificationSettings(db as unknown as PrismaClient, ORG_ID);

    expect(result.webhook).toEqual({ set: true, kind: "discord" });
    expect(JSON.stringify(result)).not.toContain("discord.com/api/webhooks");
    expect(result.extra_email_recipients).toEqual(["ops@example.com"]);
    expect(result.disabled_types).toEqual(["auth.settings.changed"]);
  });

  it("filters non-string entries out of extra_email_recipients/disabled_types (corrupt/legacy data)", async () => {
    const db = createStubDb();
    db.notificationSettings.findUnique.mockResolvedValue({
      webhook_url_enc: null,
      webhook_kind: null,
      extra_email_recipients: ["ok@example.com", 5, null, "  "],
      disabled_types: ["auth.settings.changed", 42],
    });

    const result = await describeNotificationSettings(db as unknown as PrismaClient, ORG_ID);

    expect(result.extra_email_recipients).toEqual(["ok@example.com"]);
    expect(result.disabled_types).toEqual(["auth.settings.changed"]);
  });

  it("treats a non-array stored value as empty", async () => {
    const db = createStubDb();
    db.notificationSettings.findUnique.mockResolvedValue({
      webhook_url_enc: null,
      webhook_kind: null,
      extra_email_recipients: "not-an-array",
      disabled_types: null,
    });

    const result = await describeNotificationSettings(db as unknown as PrismaClient, ORG_ID);

    expect(result.extra_email_recipients).toEqual([]);
    expect(result.disabled_types).toEqual([]);
  });
});

describe("patchNotificationSettings", () => {
  it("creates a row with an encrypted webhook URL when none exists yet", async () => {
    const db = createStubDb();
    db.notificationSettings.upsert.mockImplementation(async ({ create }: { create: unknown }) => create);
    db.notificationSettings.findUnique.mockResolvedValue(null);

    await patchNotificationSettings(db as unknown as PrismaClient, ORG_ID, {
      webhookUrl: "https://discord.com/api/webhooks/x/y",
      webhookKind: "discord",
    });

    const call = db.notificationSettings.upsert.mock.calls[0]![0] as {
      create: { webhook_url_enc: string; webhook_kind: string; scope_type: string; scope_id: string };
    };
    expect(call.create.scope_type).toBe("organization");
    expect(call.create.scope_id).toBe(ORG_ID);
    expect(call.create.webhook_kind).toBe("discord");
    expect(call.create.webhook_url_enc).not.toContain("discord.com/api/webhooks");
    expect(decryptFromString(call.create.webhook_url_enc)).toBe("https://discord.com/api/webhooks/x/y");
  });

  it("clears the stored webhook URL when given an empty string", async () => {
    const db = createStubDb();
    db.notificationSettings.upsert.mockResolvedValue({});
    db.notificationSettings.findUnique.mockResolvedValue(null);

    await patchNotificationSettings(db as unknown as PrismaClient, ORG_ID, { webhookUrl: "" });

    const call = db.notificationSettings.upsert.mock.calls[0]![0] as {
      update: { webhook_url_enc: string | null };
    };
    expect(call.update.webhook_url_enc).toBeNull();
  });

  it("omits webhook_url_enc from the update entirely when webhookUrl is not supplied - omit must keep, not clear", async () => {
    const db = createStubDb();
    db.notificationSettings.upsert.mockResolvedValue({});
    db.notificationSettings.findUnique.mockResolvedValue(null);

    await patchNotificationSettings(db as unknown as PrismaClient, ORG_ID, { webhookKind: "slack" });

    const call = db.notificationSettings.upsert.mock.calls[0]![0] as {
      update: Record<string, unknown>;
    };
    expect("webhook_url_enc" in call.update).toBe(false);
    expect(call.update.webhook_kind).toBe("slack");
  });

  it("replaces the whole extra_email_recipients / disabled_types list when supplied, including an explicit empty array", async () => {
    const db = createStubDb();
    db.notificationSettings.upsert.mockResolvedValue({});
    db.notificationSettings.findUnique.mockResolvedValue(null);

    await patchNotificationSettings(db as unknown as PrismaClient, ORG_ID, {
      extraEmailRecipients: [],
      disabledTypes: ["auth.mfa.break_glass"],
    });

    const call = db.notificationSettings.upsert.mock.calls[0]![0] as {
      update: { extra_email_recipients: unknown; disabled_types: unknown };
    };
    expect(call.update.extra_email_recipients).toEqual([]);
    expect(call.update.disabled_types).toEqual(["auth.mfa.break_glass"]);
  });

  it("returns the freshly-described settings after the upsert", async () => {
    const db = createStubDb();
    db.notificationSettings.upsert.mockResolvedValue({});
    db.notificationSettings.findUnique.mockResolvedValue({
      webhook_url_enc: null,
      webhook_kind: "slack",
      extra_email_recipients: [],
      disabled_types: [],
    });

    const result = await patchNotificationSettings(db as unknown as PrismaClient, ORG_ID, {
      webhookKind: "slack",
    });

    expect(result.webhook.kind).toBe("slack");
  });
});
