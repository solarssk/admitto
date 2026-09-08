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
      return { send: emailSend };
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
import { BlockedWebhookUrlError } from "@admitto/notifications";

function mockContext(body?: unknown): Context {
  return {
    get: () => ({ userId: "user-1" }),
    req: {
      json: async () => {
        if (body === undefined) throw new SyntaxError("bad json");
        return body;
      },
    },
    json: (payload: unknown, status?: number) => Response.json(payload, { status: status ?? 200 }),
  } as unknown as Context;
}

const db = {} as PrismaClient;

const settingsPublic = {
  webhook: { set: false, kind: "generic" as const },
  extra_email_recipients: [] as string[],
  disabled_types: [] as string[],
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

  it("returns settings plus the full org-disableable notification type list on GET", async () => {
    const res = await handleGetNotificationSettings(mockContext({}), db);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { notification_types: Array<{ id: string; label: string }> };
    expect(body.notification_types.length).toBe(4);
    expect(body.notification_types.map((t) => t.id)).toContain("auth.login.repeated_failures");
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
      mockContext({ extraEmailRecipients: ["not-an-email"] }),
      db,
    );
    expect(res.status).toBe(400);
    expect(patchNotificationSettings).not.toHaveBeenCalled();
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

  it("does not validate the webhook URL when it is empty (clearing, not setting)", async () => {
    const res = await handlePutNotificationSettings(mockContext({ webhookUrl: "" }), db);
    expect(res.status).toBe(200);
    expect(assertSafeWebhookUrl).not.toHaveBeenCalled();
  });

  it("silently drops a disabledTypes entry that is not a real org-disableable registry key", async () => {
    await handlePutNotificationSettings(
      mockContext({ disabledTypes: ["auth.settings.changed", "not.a.real.type"] }),
      db,
    );
    expect(patchNotificationSettings).toHaveBeenCalledWith(
      db,
      "org-1",
      expect.objectContaining({ disabledTypes: ["auth.settings.changed"] }),
    );
  });

  it("saves and writes an admin audit log entry on a valid PUT", async () => {
    const res = await handlePutNotificationSettings(
      mockContext({ webhookKind: "slack", disabledTypes: ["auth.mfa.break_glass"] }),
      db,
    );
    expect(res.status).toBe(200);
    expect(patchNotificationSettings).toHaveBeenCalledWith(db, "org-1", {
      webhookUrl: undefined,
      webhookKind: "slack",
      extraEmailRecipients: undefined,
      disabledTypes: ["auth.mfa.break_glass"],
    });
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
    inAppSend.mockResolvedValue({ ok: true });
  });

  it("forbids test-send for non-superadmins", async () => {
    canManageInstance.mockResolvedValueOnce(false);
    const res = await handlePostNotificationSettingsTest(mockContext({}), db);
    expect(res.status).toBe(403);
    expect(webhookSend).not.toHaveBeenCalled();
  });

  it("fires all three channels targeting only the requesting user for email/in-app, webhook with no recipient list", async () => {
    await handlePostNotificationSettingsTest(mockContext({}), db);
    expect(webhookSend).toHaveBeenCalledWith(expect.anything(), []);
    expect(emailSend).toHaveBeenCalledWith(expect.anything(), ["user-1"]);
    expect(inAppSend).toHaveBeenCalledWith(expect.anything(), ["user-1"]);
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

  it("writes an admin audit log entry with the per-channel results", async () => {
    await handlePostNotificationSettingsTest(mockContext({}), db);
    expect(writeAdminAuditLog).toHaveBeenCalledWith(
      db,
      expect.objectContaining({
        organizationId: "org-1",
        actionType: "notification_settings_tested",
        metadata: expect.objectContaining({ webhook: { ok: true }, email: { ok: true }, in_app: { ok: true } }),
      }),
    );
  });
});
