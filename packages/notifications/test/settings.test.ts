import type { PrismaClient } from "@admitto/db";
import { decryptFromString, encryptToString } from "@admitto/crypto";
import { describe, expect, it } from "vitest";
import { describeNotificationSettings, patchNotificationSettings } from "../src/settings.js";
import { createStubDb } from "./stubDb.js";

const ORG_ID = "org-1";
const ACTOR_ID = "user-1";

describe("describeNotificationSettings", () => {
  it("reports webhook.set:false and defaults when no row exists", async () => {
    const db = createStubDb();
    db.notificationSettings.findUnique.mockResolvedValue(null);

    const result = await describeNotificationSettings(db as unknown as PrismaClient, ORG_ID);

    expect(result).toEqual({
      webhook: { set: false, kind: "generic" },
      extra_email_recipients: [],
      disabled_channels: {},
    });
  });

  it("reports webhook.set:true without ever returning the decrypted URL", async () => {
    const db = createStubDb();
    db.notificationSettings.findUnique.mockResolvedValue({
      webhook_url_enc: encryptToString("https://discord.com/api/webhooks/x/y"),
      webhook_kind: "discord",
      extra_email_recipients: [
        {
          email: "ops@example.com",
          description: "Ops team",
          added_at: "2026-09-01T00:00:00.000Z",
          added_by_email: "admin@example.com",
          added_by_display_name: "Admin",
          added_by_timezone: "Europe/Warsaw",
        },
      ],
      disabled_channels: { "auth.settings.changed": ["webhook"] },
    });

    const result = await describeNotificationSettings(db as unknown as PrismaClient, ORG_ID);

    expect(result.webhook).toEqual({ set: true, kind: "discord" });
    expect(JSON.stringify(result)).not.toContain("discord.com/api/webhooks");
    expect(result.extra_email_recipients).toEqual([
      {
        email: "ops@example.com",
        description: "Ops team",
        added_at: "2026-09-01T00:00:00.000Z",
        added_by_email: "admin@example.com",
        added_by_display_name: "Admin",
        added_by_timezone: "Europe/Warsaw",
      },
    ]);
    expect(result.disabled_channels).toEqual({ "auth.settings.changed": ["webhook"] });
  });

  it("filters non-string entries out of disabled_channels values (corrupt/legacy data)", async () => {
    const db = createStubDb();
    db.notificationSettings.findUnique.mockResolvedValue({
      webhook_url_enc: null,
      webhook_kind: null,
      extra_email_recipients: [],
      disabled_channels: { "auth.settings.changed": ["webhook", 42, null] },
    });

    const result = await describeNotificationSettings(db as unknown as PrismaClient, ORG_ID);

    expect(result.disabled_channels).toEqual({ "auth.settings.changed": ["webhook"] });
  });

  it("drops a recipient entry with no usable email, and defaults a missing description to empty", async () => {
    const db = createStubDb();
    db.notificationSettings.findUnique.mockResolvedValue({
      webhook_url_enc: null,
      webhook_kind: null,
      extra_email_recipients: [
        { email: "ok@example.com" },
        { email: "  " },
        { email: 5 },
        "not-an-object",
        null,
      ],
      disabled_channels: {},
    });

    const result = await describeNotificationSettings(db as unknown as PrismaClient, ORG_ID);

    expect(result.extra_email_recipients).toEqual([
      {
        email: "ok@example.com",
        description: "",
        added_at: null,
        added_by_email: null,
        added_by_display_name: null,
        added_by_timezone: null,
      },
    ]);
  });

  it("dedupes recipients by email, the last occurrence winning", async () => {
    const db = createStubDb();
    db.notificationSettings.findUnique.mockResolvedValue({
      webhook_url_enc: null,
      webhook_kind: null,
      extra_email_recipients: [
        { email: "ops@example.com", description: "First" },
        { email: "ops@example.com", description: "Second" },
      ],
      disabled_channels: {},
    });

    const result = await describeNotificationSettings(db as unknown as PrismaClient, ORG_ID);

    expect(result.extra_email_recipients).toHaveLength(1);
    expect(result.extra_email_recipients[0]?.description).toBe("Second");
  });

  it("drops a type entry whose channel list normalizes to empty - equivalent to the type being absent", async () => {
    const db = createStubDb();
    db.notificationSettings.findUnique.mockResolvedValue({
      webhook_url_enc: null,
      webhook_kind: null,
      extra_email_recipients: [],
      disabled_channels: { "auth.settings.changed": [], "auth.mfa.break_glass": ["email"] },
    });

    const result = await describeNotificationSettings(db as unknown as PrismaClient, ORG_ID);

    expect(result.disabled_channels).toEqual({ "auth.mfa.break_glass": ["email"] });
  });

  it("treats a non-array/non-object stored value as empty", async () => {
    const db = createStubDb();
    db.notificationSettings.findUnique.mockResolvedValue({
      webhook_url_enc: null,
      webhook_kind: null,
      extra_email_recipients: "not-an-array",
      disabled_channels: "not-an-object",
    });

    const result = await describeNotificationSettings(db as unknown as PrismaClient, ORG_ID);

    expect(result.extra_email_recipients).toEqual([]);
    expect(result.disabled_channels).toEqual({});
  });

  it("ignores a type entry whose channel value isn't an array (malformed per-type shape)", async () => {
    const db = createStubDb();
    db.notificationSettings.findUnique.mockResolvedValue({
      webhook_url_enc: null,
      webhook_kind: null,
      extra_email_recipients: [],
      disabled_channels: { "auth.settings.changed": "webhook", "auth.mfa.break_glass": ["email"] },
    });

    const result = await describeNotificationSettings(db as unknown as PrismaClient, ORG_ID);

    expect(result.disabled_channels).toEqual({ "auth.mfa.break_glass": ["email"] });
  });

  it("treats a stored array (legacy disabled_types shape) as empty, not crashing", async () => {
    const db = createStubDb();
    db.notificationSettings.findUnique.mockResolvedValue({
      webhook_url_enc: null,
      webhook_kind: null,
      extra_email_recipients: [],
      disabled_channels: ["auth.settings.changed"],
    });

    const result = await describeNotificationSettings(db as unknown as PrismaClient, ORG_ID);

    expect(result.disabled_channels).toEqual({});
  });

  it("treats a legacy plain string[] extra_email_recipients shape as empty, not crashing", async () => {
    const db = createStubDb();
    db.notificationSettings.findUnique.mockResolvedValue({
      webhook_url_enc: null,
      webhook_kind: null,
      extra_email_recipients: ["ops@example.com"],
      disabled_channels: {},
    });

    const result = await describeNotificationSettings(db as unknown as PrismaClient, ORG_ID);

    expect(result.extra_email_recipients).toEqual([]);
  });
});

describe("patchNotificationSettings", () => {
  it("creates a row with an encrypted webhook URL when none exists yet", async () => {
    const db = createStubDb();
    db.notificationSettings.upsert.mockImplementation(async ({ create }: { create: unknown }) => create);
    db.notificationSettings.findUnique.mockResolvedValue(null);

    await patchNotificationSettings(
      db as unknown as PrismaClient,
      ORG_ID,
      { webhookUrl: "https://discord.com/api/webhooks/x/y", webhookKind: "discord" },
      ACTOR_ID,
    );

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

    await patchNotificationSettings(db as unknown as PrismaClient, ORG_ID, { webhookUrl: "" }, ACTOR_ID);

    const call = db.notificationSettings.upsert.mock.calls[0]![0] as {
      update: { webhook_url_enc: string | null };
    };
    expect(call.update.webhook_url_enc).toBeNull();
  });

  it("omits webhook_url_enc from the update entirely when webhookUrl is not supplied - omit must keep, not clear", async () => {
    const db = createStubDb();
    db.notificationSettings.upsert.mockResolvedValue({});
    db.notificationSettings.findUnique.mockResolvedValue(null);

    await patchNotificationSettings(db as unknown as PrismaClient, ORG_ID, { webhookKind: "slack" }, ACTOR_ID);

    const call = db.notificationSettings.upsert.mock.calls[0]![0] as {
      update: Record<string, unknown>;
    };
    expect("webhook_url_enc" in call.update).toBe(false);
    expect(call.update.webhook_kind).toBe("slack");
  });

  it("stamps a fresh added_at/added_by (resolved from actorUserId) for a genuinely new recipient", async () => {
    const db = createStubDb();
    db.notificationSettings.upsert.mockResolvedValue({});
    db.notificationSettings.findUnique.mockResolvedValue(null); // no existing row -> no existing recipients
    db.user.findUnique.mockResolvedValue({ email: "admin@example.com", display_name: "Admin User" });

    await patchNotificationSettings(
      db as unknown as PrismaClient,
      ORG_ID,
      { extraEmailRecipients: [{ email: "ops@example.com", description: "Ops team" }] },
      ACTOR_ID,
    );

    expect(db.user.findUnique).toHaveBeenCalledWith({
      where: { id: ACTOR_ID },
      select: { email: true, display_name: true },
    });
    const call = db.notificationSettings.upsert.mock.calls[0]![0] as {
      update: { extra_email_recipients: Array<Record<string, unknown>> };
    };
    expect(call.update.extra_email_recipients).toEqual([
      {
        email: "ops@example.com",
        description: "Ops team",
        added_at: expect.any(String),
        added_by_email: "admin@example.com",
        added_by_display_name: "Admin User",
        added_by_timezone: null,
      },
    ]);
  });

  it("drops a patch entry whose email is blank/whitespace-only, without touching the actor lookup", async () => {
    const db = createStubDb();
    db.notificationSettings.upsert.mockResolvedValue({});
    db.notificationSettings.findUnique.mockResolvedValue(null);

    await patchNotificationSettings(
      db as unknown as PrismaClient,
      ORG_ID,
      { extraEmailRecipients: [{ email: "   ", description: "Ghost" }] },
      ACTOR_ID,
    );

    expect(db.user.findUnique).not.toHaveBeenCalled();
    const call = db.notificationSettings.upsert.mock.calls[0]![0] as {
      update: { extra_email_recipients: unknown[] };
    };
    expect(call.update.extra_email_recipients).toEqual([]);
  });

  it("stamps the acting user's timezone onto a genuinely new recipient when supplied", async () => {
    const db = createStubDb();
    db.notificationSettings.upsert.mockResolvedValue({});
    db.notificationSettings.findUnique.mockResolvedValue(null);
    db.user.findUnique.mockResolvedValue({ email: "admin@example.com", display_name: "Admin User" });

    await patchNotificationSettings(
      db as unknown as PrismaClient,
      ORG_ID,
      { extraEmailRecipients: [{ email: "ops@example.com", description: "Ops team" }] },
      ACTOR_ID,
      "Europe/Warsaw",
    );

    const call = db.notificationSettings.upsert.mock.calls[0]![0] as {
      update: { extra_email_recipients: Array<Record<string, unknown>> };
    };
    expect(call.update.extra_email_recipients[0]).toMatchObject({ added_by_timezone: "Europe/Warsaw" });
  });

  it("keeps an existing recipient's added_at/added_by/added_by_timezone stamp when only its description changes", async () => {
    const db = createStubDb();
    db.notificationSettings.upsert.mockResolvedValue({});
    db.notificationSettings.findUnique.mockResolvedValue({
      webhook_url_enc: null,
      webhook_kind: null,
      extra_email_recipients: [
        {
          email: "ops@example.com",
          description: "Old description",
          added_at: "2026-01-01T00:00:00.000Z",
          added_by_email: "someone-else@example.com",
          added_by_display_name: "Someone Else",
          added_by_timezone: "America/New_York",
        },
      ],
      disabled_channels: {},
    });

    await patchNotificationSettings(
      db as unknown as PrismaClient,
      ORG_ID,
      { extraEmailRecipients: [{ email: "ops@example.com", description: "New description" }] },
      ACTOR_ID,
      "Europe/Warsaw",
    );

    expect(db.user.findUnique).not.toHaveBeenCalled();
    const call = db.notificationSettings.upsert.mock.calls[0]![0] as {
      update: { extra_email_recipients: Array<Record<string, unknown>> };
    };
    expect(call.update.extra_email_recipients).toEqual([
      {
        email: "ops@example.com",
        description: "New description",
        added_at: "2026-01-01T00:00:00.000Z",
        added_by_email: "someone-else@example.com",
        added_by_display_name: "Someone Else",
        added_by_timezone: "America/New_York",
      },
    ]);
  });

  it("recognizes a mixed-case stored email as the same recipient a lowercase patch entry refers to, keeping its stamp", async () => {
    const db = createStubDb();
    db.notificationSettings.upsert.mockResolvedValue({});
    db.notificationSettings.findUnique.mockResolvedValue({
      webhook_url_enc: null,
      webhook_kind: null,
      extra_email_recipients: [
        {
          email: "Ops@Example.com",
          description: "Old description",
          added_at: "2026-01-01T00:00:00.000Z",
          added_by_email: "someone-else@example.com",
          added_by_display_name: "Someone Else",
          added_by_timezone: "America/New_York",
        },
      ],
      disabled_channels: {},
    });

    await patchNotificationSettings(
      db as unknown as PrismaClient,
      ORG_ID,
      { extraEmailRecipients: [{ email: "ops@example.com", description: "New description" }] },
      ACTOR_ID,
      "Europe/Warsaw",
    );

    // Recognized as the SAME recipient (case-insensitive match) - no actor lookup for a "new"
    // entry, and the original added_at/added_by stamp survives instead of being replaced.
    expect(db.user.findUnique).not.toHaveBeenCalled();
    const call = db.notificationSettings.upsert.mock.calls[0]![0] as {
      update: { extra_email_recipients: Array<Record<string, unknown>> };
    };
    expect(call.update.extra_email_recipients).toEqual([
      {
        email: "ops@example.com",
        description: "New description",
        added_at: "2026-01-01T00:00:00.000Z",
        added_by_email: "someone-else@example.com",
        added_by_display_name: "Someone Else",
        added_by_timezone: "America/New_York",
      },
    ]);
  });

  it("resolves the acting user at most once even when several new recipients are added in one call", async () => {
    const db = createStubDb();
    db.notificationSettings.upsert.mockResolvedValue({});
    db.notificationSettings.findUnique.mockResolvedValue(null);
    db.user.findUnique.mockResolvedValue({ email: "admin@example.com", display_name: null });

    await patchNotificationSettings(
      db as unknown as PrismaClient,
      ORG_ID,
      {
        extraEmailRecipients: [
          { email: "a@example.com" },
          { email: "b@example.com" },
        ],
      },
      ACTOR_ID,
    );

    expect(db.user.findUnique).toHaveBeenCalledTimes(1);
  });

  it("does not throw and stores a null actor snapshot when the actor lookup fails", async () => {
    const db = createStubDb();
    db.notificationSettings.upsert.mockResolvedValue({});
    db.notificationSettings.findUnique.mockResolvedValue(null);
    db.user.findUnique.mockRejectedValue(new Error("connection reset"));

    await patchNotificationSettings(
      db as unknown as PrismaClient,
      ORG_ID,
      { extraEmailRecipients: [{ email: "ops@example.com" }] },
      ACTOR_ID,
    );

    const call = db.notificationSettings.upsert.mock.calls[0]![0] as {
      update: { extra_email_recipients: Array<Record<string, unknown>> };
    };
    expect(call.update.extra_email_recipients[0]).toMatchObject({
      added_by_email: null,
      added_by_display_name: null,
    });
  });

  it("replaces the whole extra_email_recipients / disabled_channels map when supplied, including explicit empties", async () => {
    const db = createStubDb();
    db.notificationSettings.upsert.mockResolvedValue({});
    db.notificationSettings.findUnique.mockResolvedValue(null);

    await patchNotificationSettings(
      db as unknown as PrismaClient,
      ORG_ID,
      { extraEmailRecipients: [], disabledChannels: { "auth.mfa.break_glass": ["webhook", "email"] } },
      ACTOR_ID,
    );

    const call = db.notificationSettings.upsert.mock.calls[0]![0] as {
      update: { extra_email_recipients: unknown; disabled_channels: unknown };
    };
    expect(call.update.extra_email_recipients).toEqual([]);
    expect(call.update.disabled_channels).toEqual({ "auth.mfa.break_glass": ["webhook", "email"] });
  });

  it("omits extra_email_recipients and disabled_channels from the update entirely when not supplied - omit must keep, not clear", async () => {
    const db = createStubDb();
    db.notificationSettings.upsert.mockResolvedValue({});
    db.notificationSettings.findUnique.mockResolvedValue(null);

    await patchNotificationSettings(db as unknown as PrismaClient, ORG_ID, { webhookKind: "slack" }, ACTOR_ID);

    const call = db.notificationSettings.upsert.mock.calls[0]![0] as {
      update: Record<string, unknown>;
    };
    expect("extra_email_recipients" in call.update).toBe(false);
    expect("disabled_channels" in call.update).toBe(false);
    // findUnique is still called once, for the final describeNotificationSettings() re-read -
    // just never for a "current recipients" lookup, since extraEmailRecipients wasn't touched.
    expect(db.notificationSettings.findUnique).toHaveBeenCalledTimes(1);
  });

  it("returns the freshly-described settings after the upsert", async () => {
    const db = createStubDb();
    db.notificationSettings.upsert.mockResolvedValue({});
    db.notificationSettings.findUnique.mockResolvedValue({
      webhook_url_enc: null,
      webhook_kind: "slack",
      extra_email_recipients: [],
      disabled_channels: {},
    });

    const result = await patchNotificationSettings(
      db as unknown as PrismaClient,
      ORG_ID,
      { webhookKind: "slack" },
      ACTOR_ID,
    );

    expect(result.webhook.kind).toBe("slack");
  });
});
