import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Context } from "hono";
import type { PrismaClient } from "@admitto/db";

const {
  canManageInstance,
  writeAdminAuditLog,
  adminAuditFromContext,
  resolveInstanceOrganizationId,
  describeNotificationSettings,
  patchNotificationSettings,
  assertSafeWebhookUrl,
  webhookSend,
  emailSend,
  emailSendToAddress,
  inAppSend,
} = vi.hoisted(() => ({
  canManageInstance: vi.fn(async () => true),
  writeAdminAuditLog: vi.fn(async () => undefined),
  adminAuditFromContext: vi.fn(() => ({
    operator: "user-1",
    sessionId: "sess-1",
    ip: "127.0.0.1",
    timezone: "UTC",
  })),
  resolveInstanceOrganizationId: vi.fn(async () => "org-1"),
  describeNotificationSettings: vi.fn(),
  patchNotificationSettings: vi.fn(),
  assertSafeWebhookUrl: vi.fn(),
  webhookSend: vi.fn(async (): Promise<{ ok: boolean; error?: string; noop?: boolean }> => ({ ok: true })),
  emailSend: vi.fn(async (): Promise<{ ok: boolean; error?: string; noop?: boolean }> => ({ ok: true })),
  emailSendToAddress: vi.fn(async (): Promise<{ ok: boolean; error?: string; noop?: boolean }> => ({ ok: true })),
  inAppSend: vi.fn(async () => ({ ok: true })),
}));

vi.mock("@admitto/auth", () => ({ canManageInstance }));
vi.mock("@admitto/tickets", () => ({ writeAdminAuditLog }));

vi.mock("../../src/admin/admin-helpers.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../src/admin/admin-helpers.js")>();
  return { ...actual, adminAuditFromContext };
});

vi.mock("../../src/admin/instance-org.js", () => ({ resolveInstanceOrganizationId }));

vi.mock("@admitto/notifications", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@admitto/notifications")>();
  return {
    ...actual,
    describeNotificationSettings,
    patchNotificationSettings,
    assertSafeWebhookUrl,
    WebhookChannel: vi.fn().mockImplementation(function WebhookChannel() {
      return { send: webhookSend };
    }),
    EmailChannel: vi.fn().mockImplementation(function EmailChannel() {
      return { send: emailSend, sendToAddress: emailSendToAddress };
    }),
    InAppChannel: vi.fn().mockImplementation(function InAppChannel() {
      return { send: inAppSend };
    }),
  };
});

import {
  handleGetNotificationSettings,
  handlePostNotificationSettingsTest,
  handlePutNotificationSettings,
} from "../../src/admin/notification-settings-routes.js";
import { BlockedWebhookUrlError, EmailChannel } from "@admitto/notifications";

/** `body === undefined` simulates a genuinely malformed request: `req.json()` (used by the PUT
 * handler) throws SyntaxError, and `req.text()` (used by the test-send handler's
 * parseOptionalTestBody) returns a non-empty, non-JSON string that fails to parse the same way. */
function mockContext(body?: unknown): Context {
  return {
    get: () => ({ userId: "user-1" }),
    req: {
      json: async () => {
        if (body === undefined) throw new SyntaxError("bad json");
        return body;
      },
      text: async () => (body === undefined ? "not json" : JSON.stringify(body)),
    },
    json: (payload: unknown, status?: number) => Response.json(payload, { status: status ?? 200 }),
  } as unknown as Context;
}

const db = {} as PrismaClient;

const settingsPublic = {
  webhook: { set: false, kind: "generic" as const },
  extra_email_recipients: [] as Array<{
    email: string;
    description: string;
    added_at: string | null;
    added_by_email: string | null;
    added_by_display_name: string | null;
  }>,
  disabled_channels: {} as Record<string, string[]>,
};

describe("notification-settings GET/PUT routes", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    canManageInstance.mockResolvedValue(true);
    resolveInstanceOrganizationId.mockResolvedValue("org-1");
    describeNotificationSettings.mockResolvedValue(settingsPublic);
    patchNotificationSettings.mockResolvedValue(settingsPublic);
  });

  it("forbids GET for non-superadmins", async () => {
    canManageInstance.mockResolvedValueOnce(false);
    const res = await handleGetNotificationSettings(mockContext({}), db);
    expect(res.status).toBe(403);
    expect(describeNotificationSettings).not.toHaveBeenCalled();
  });

  it("returns settings plus the full org-disableable notification type list on GET, each with its available channels", async () => {
    const res = await handleGetNotificationSettings(mockContext({}), db);
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      notification_types: Array<{ id: string; label: string; available_channels: string[] }>;
    };
    expect(body.notification_types).toHaveLength(4);
    expect(body.notification_types.map((t) => t.id)).toContain("auth.login.repeated_failures");
    const repeatedFailures = body.notification_types.find((t) => t.id === "auth.login.repeated_failures");
    expect(repeatedFailures?.available_channels).toEqual(
      expect.arrayContaining(["webhook", "email", "in_app"]),
    );
    expect(describeNotificationSettings).toHaveBeenCalledWith(db, "org-1");
  });

  it("rejects invalid JSON on PUT", async () => {
    const res = await handlePutNotificationSettings(mockContext(undefined), db);
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "invalid_json" });
  });

  it("rejects a body with an unknown field (strict schema)", async () => {
    const res = await handlePutNotificationSettings(mockContext({ notAField: true }), db);
    expect(res.status).toBe(400);
    expect(patchNotificationSettings).not.toHaveBeenCalled();
  });

  it("rejects an invalid extra_email_recipients entry", async () => {
    const res = await handlePutNotificationSettings(
      mockContext({ extraEmailRecipients: [{ email: "not-an-email" }] }),
      db,
    );
    expect(res.status).toBe(400);
    expect(patchNotificationSettings).not.toHaveBeenCalled();
  });

  it("saves extra_email_recipients with a description and passes the acting user's id as the actor", async () => {
    await handlePutNotificationSettings(
      mockContext({ extraEmailRecipients: [{ email: "ops@example.com", description: "Ops team" }] }),
      db,
    );
    expect(patchNotificationSettings).toHaveBeenCalledWith(
      db,
      "org-1",
      expect.objectContaining({
        extraEmailRecipients: [{ email: "ops@example.com", description: "Ops team" }],
      }),
      "user-1",
      "UTC",
    );
  });

  it("rejects a webhook URL assertSafeWebhookUrl blocks, without persisting anything", async () => {
    assertSafeWebhookUrl.mockImplementation(() => {
      throw new BlockedWebhookUrlError("Webhook URL must not target a private or link-local address.");
    });
    const res = await handlePutNotificationSettings(
      mockContext({ webhookUrl: "http://10.0.0.5/hook" }),
      db,
    );
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: "invalid_webhook_url" });
    expect(patchNotificationSettings).not.toHaveBeenCalled();
  });

  it("rethrows an unexpected (non-BlockedWebhookUrlError) failure from assertSafeWebhookUrl", async () => {
    assertSafeWebhookUrl.mockImplementation(() => {
      throw new Error("dns lookup failed");
    });
    await expect(
      handlePutNotificationSettings(mockContext({ webhookUrl: "https://hooks.example.com/x" }), db),
    ).rejects.toThrow("dns lookup failed");
    expect(patchNotificationSettings).not.toHaveBeenCalled();
  });

  it("does not validate the webhook URL when it is empty (clearing, not setting)", async () => {
    const res = await handlePutNotificationSettings(mockContext({ webhookUrl: "" }), db);
    expect(res.status).toBe(200);
    expect(assertSafeWebhookUrl).not.toHaveBeenCalled();
  });

  it("rejects an unknown channel name inside disabledChannels (enum-validated)", async () => {
    const res = await handlePutNotificationSettings(
      mockContext({ disabledChannels: { "auth.settings.changed": ["carrier_pigeon"] } }),
      db,
    );
    expect(res.status).toBe(400);
    expect(patchNotificationSettings).not.toHaveBeenCalled();
  });

  it("silently drops a disabledChannels key that is not a real org-disableable registry type id", async () => {
    await handlePutNotificationSettings(
      mockContext({
        disabledChannels: { "auth.settings.changed": ["webhook"], "not.a.real.type": ["email"] },
      }),
      db,
    );
    expect(patchNotificationSettings).toHaveBeenCalledWith(
      db,
      "org-1",
      expect.objectContaining({ disabledChannels: { "auth.settings.changed": ["webhook"] } }),
      "user-1",
      "UTC",
    );
  });

  it("saves and writes an admin audit log entry on a valid PUT with per-channel disables", async () => {
    const res = await handlePutNotificationSettings(
      mockContext({
        webhookKind: "slack",
        disabledChannels: { "auth.mfa.break_glass": ["webhook", "email"] },
      }),
      db,
    );
    expect(res.status).toBe(200);
    expect(patchNotificationSettings).toHaveBeenCalledWith(
      db,
      "org-1",
      {
        webhookUrl: undefined,
        webhookKind: "slack",
        extraEmailRecipients: undefined,
        disabledChannels: { "auth.mfa.break_glass": ["webhook", "email"] },
      },
      "user-1",
      "UTC",
    );
    expect(writeAdminAuditLog).toHaveBeenCalledWith(
      db,
      expect.objectContaining({ organizationId: "org-1", actionType: "notification_settings_updated" }),
    );
  });
});

describe("notification-settings test-send route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    canManageInstance.mockResolvedValue(true);
    resolveInstanceOrganizationId.mockResolvedValue("org-1");
    webhookSend.mockResolvedValue({ ok: true });
    emailSend.mockResolvedValue({ ok: true });
    emailSendToAddress.mockResolvedValue({ ok: true });
    inAppSend.mockResolvedValue({ ok: true });
  });

  it("forbids test-send for non-superadmins", async () => {
    canManageInstance.mockResolvedValueOnce(false);
    const res = await handlePostNotificationSettingsTest(mockContext({}), db);
    expect(res.status).toBe(403);
    expect(webhookSend).not.toHaveBeenCalled();
  });

  it("fires webhook + in-app (targeting the requesting user) when tested with no testEmail, but skips email entirely", async () => {
    const res = await handlePostNotificationSettingsTest(mockContext({}), db);
    expect(webhookSend).toHaveBeenCalledWith(expect.anything(), []);
    expect(inAppSend).toHaveBeenCalledWith(expect.anything(), ["user-1"]);
    expect(emailSend).not.toHaveBeenCalled();
    expect(emailSendToAddress).not.toHaveBeenCalled();
    const body = (await res.json()) as { email: { ok: boolean; skipped?: boolean } };
    expect(body.email).toEqual({ ok: true, skipped: true });
  });

  it("passes the mail delivery deps' exportSink through to EmailChannel, so an export_only org can test-send", async () => {
    const exportSink = vi.fn();
    await handlePostNotificationSettingsTest(mockContext({}), db, { exportSink });
    expect(EmailChannel).toHaveBeenCalledWith(
      db,
      expect.objectContaining({ includeExtraRecipients: false, exportSink }),
    );
  });

  it("sends only to the given testEmail address, never touching the shared webhook or this admin's own in-app notification", async () => {
    const res = await handlePostNotificationSettingsTest(mockContext({ testEmail: "ops@example.com" }), db);
    expect(emailSendToAddress).toHaveBeenCalledWith(expect.anything(), "ops@example.com");
    expect(emailSend).not.toHaveBeenCalled();
    // A recipient row's own test-send button must never fire a real message into the team's
    // shared Discord/Slack webhook, or into this admin's own in-app notifications - PO report.
    expect(webhookSend).not.toHaveBeenCalled();
    expect(inAppSend).not.toHaveBeenCalled();
    const body = (await res.json()) as {
      webhook: { ok: boolean; skipped?: boolean };
      in_app: { ok: boolean; skipped?: boolean };
    };
    expect(body.webhook).toEqual({ ok: true, skipped: true });
    expect(body.in_app).toEqual({ ok: true, skipped: true });
  });

  it("rejects a genuinely malformed JSON test-send body, instead of silently defaulting to {}", async () => {
    const res = await handlePostNotificationSettingsTest(mockContext(undefined), db);
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "invalid_json" });
    expect(webhookSend).not.toHaveBeenCalled();
    expect(emailSend).not.toHaveBeenCalled();
    expect(emailSendToAddress).not.toHaveBeenCalled();
  });

  it("treats a whitespace-only body the same as no body at all", async () => {
    const ctx = {
      get: () => ({ userId: "user-1" }),
      req: { text: async () => "   " },
      json: (payload: unknown, status?: number) => Response.json(payload, { status: status ?? 200 }),
    } as unknown as Parameters<typeof handlePostNotificationSettingsTest>[0];
    const res = await handlePostNotificationSettingsTest(ctx, db);
    expect(res.status).toBe(200);
    expect(webhookSend).toHaveBeenCalledWith(expect.anything(), []);
  });

  it("rejects an invalid testEmail without sending anything", async () => {
    const res = await handlePostNotificationSettingsTest(mockContext({ testEmail: "not-an-email" }), db);
    expect(res.status).toBe(400);
    expect(webhookSend).not.toHaveBeenCalled();
    expect(emailSend).not.toHaveBeenCalled();
    expect(emailSendToAddress).not.toHaveBeenCalled();
  });

  it("reports a noop channel as a failure with a 'not configured' message, not as ok", async () => {
    webhookSend.mockResolvedValue({ ok: true, noop: true });
    const res = await handlePostNotificationSettingsTest(mockContext({}), db);
    const body = (await res.json()) as { webhook: { ok: boolean; error?: string } };
    expect(body.webhook).toEqual({ ok: false, error: "Not configured." });
  });

  it("reports per-channel results independently on partial failure", async () => {
    webhookSend.mockResolvedValue({ ok: false, error: "Webhook target responded with HTTP 500." });
    const res = await handlePostNotificationSettingsTest(mockContext({}), db);
    const body = (await res.json()) as {
      webhook: { ok: boolean; error?: string };
      email: { ok: boolean };
      in_app: { ok: boolean };
    };
    expect(body.webhook).toEqual({ ok: false, error: "Webhook target responded with HTTP 500." });
    expect(body.email.ok).toBe(true);
    expect(body.in_app.ok).toBe(true);
  });

  it("writes an admin audit log entry with the per-channel results, marking the untested channel as skipped", async () => {
    await handlePostNotificationSettingsTest(mockContext({}), db);
    expect(writeAdminAuditLog).toHaveBeenCalledWith(
      db,
      expect.objectContaining({
        organizationId: "org-1",
        actionType: "notification_settings_tested",
        metadata: expect.objectContaining({
          webhook: { ok: true },
          email: { ok: true, skipped: true },
          in_app: { ok: true },
        }),
      }),
    );
  });
});
