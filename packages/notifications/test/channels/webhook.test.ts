import type { PrismaClient } from "@admitto/db";
import { encryptToString } from "@admitto/crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { WebhookChannel } from "../../src/channels/webhook.js";
import type { DispatchedNotification } from "../../src/types.js";
import { createStubDb } from "../stubDb.js";

const withPinnedFetch = vi.fn();
vi.mock("@admitto/mailer", () => ({
  withPinnedFetch: (...args: unknown[]) => withPinnedFetch(...args),
}));

// Real SSRF blocking logic stays real (that's what several tests below verify) - only the actual
// DNS lookup is stubbed, so a public hostname like "discord.com" doesn't need real network access
// in CI and can't flake on it.
vi.mock("@admitto/shared/ssrf-guard", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@admitto/shared/ssrf-guard")>();
  return {
    ...actual,
    resolveSafeHostname: vi.fn().mockResolvedValue([{ address: "203.0.113.10", family: 4 }]),
  };
});

const EVENT: DispatchedNotification = {
  type: "auth.mfa.break_glass",
  severity: "error",
  organizationId: "org-1",
  title: "MFA break-glass used",
  body: "admin@example.com used the emergency bypass.",
  metadata: { user: "admin@example.com" },
};

function settingsWith(url: string, kind: string | null = "generic") {
  return { webhook_url_enc: encryptToString(url), webhook_kind: kind };
}

/** Minimal fetch Response stand-in - includes `text()` since withPinnedFetch's handler contract
 * requires the body be consumed before returning (see the regression test below). */
function mockResponse(status: number) {
  return { status, text: vi.fn().mockResolvedValue("") };
}

describe("WebhookChannel", () => {
  beforeEach(() => {
    withPinnedFetch.mockReset();
  });

  it("is a silent no-op success when no webhook URL is configured", async () => {
    const db = createStubDb();
    db.notificationSettings.findUnique.mockResolvedValue(null);
    const channel = new WebhookChannel(db as unknown as PrismaClient);

    const result = await channel.send(EVENT, []);

    expect(result).toEqual({ ok: true });
    expect(withPinnedFetch).not.toHaveBeenCalled();
  });

  it("blocks a webhook URL pointing at a private address", async () => {
    const db = createStubDb();
    db.notificationSettings.findUnique.mockResolvedValue(settingsWith("https://10.0.0.5/webhook"));
    const channel = new WebhookChannel(db as unknown as PrismaClient);

    const result = await channel.send(EVENT, []);

    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/private or link-local/);
    expect(withPinnedFetch).not.toHaveBeenCalled();
  });

  it("requires HTTPS outside a loopback/non-production exception", async () => {
    const db = createStubDb();
    db.notificationSettings.findUnique.mockResolvedValue(
      settingsWith("http://webhook.example.com/hook"),
    );
    const channel = new WebhookChannel(db as unknown as PrismaClient, {
      env: { NODE_ENV: "production" },
    });

    const result = await channel.send(EVENT, []);

    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/HTTPS/);
  });

  it("sends a Discord embed payload with the severity color and metadata fields", async () => {
    const db = createStubDb();
    db.notificationSettings.findUnique.mockResolvedValue(
      settingsWith("https://discord.com/api/webhooks/x/y", "discord"),
    );
    withPinnedFetch.mockImplementation(async (_url, _hostname, _records, _init, handler) =>
      handler(mockResponse(204)),
    );
    const channel = new WebhookChannel(db as unknown as PrismaClient);

    const result = await channel.send(EVENT, []);

    expect(result).toEqual({ ok: true });
    const [, , , init] = withPinnedFetch.mock.calls[0]!;
    const payload = JSON.parse((init as { body: string }).body);
    expect(payload.embeds[0].title).toBe(EVENT.title);
    expect(payload.embeds[0].color).toBe(0xd63939);
    expect(payload.embeds[0].fields).toEqual([{ name: "user", value: "admin@example.com", inline: true }]);
  });

  it("sends a flat generic JSON payload for webhook_kind generic", async () => {
    const db = createStubDb();
    db.notificationSettings.findUnique.mockResolvedValue(
      settingsWith("https://hooks.example.com/x", "generic"),
    );
    withPinnedFetch.mockImplementation(async (_url, _hostname, _records, _init, handler) =>
      handler(mockResponse(200)),
    );
    const channel = new WebhookChannel(db as unknown as PrismaClient);

    await channel.send(EVENT, []);

    const [, , , init] = withPinnedFetch.mock.calls[0]!;
    const payload = JSON.parse((init as { body: string }).body);
    expect(payload).toEqual({
      type: EVENT.type,
      severity: EVENT.severity,
      title: EVENT.title,
      body: EVENT.body,
      metadata: EVENT.metadata,
    });
  });

  it("reports failure on a non-2xx response without throwing", async () => {
    const db = createStubDb();
    db.notificationSettings.findUnique.mockResolvedValue(
      settingsWith("https://hooks.example.com/x"),
    );
    withPinnedFetch.mockImplementation(async (_url, _hostname, _records, _init, handler) =>
      handler(mockResponse(500)),
    );
    const channel = new WebhookChannel(db as unknown as PrismaClient);

    const result = await channel.send(EVENT, []);

    expect(result.ok).toBe(false);
    expect(result.error).toContain("500");
  });

  it("consumes the response body before returning (withPinnedFetch hangs on an unread body)", async () => {
    const db = createStubDb();
    db.notificationSettings.findUnique.mockResolvedValue(
      settingsWith("https://hooks.example.com/x"),
    );
    const response = mockResponse(200);
    withPinnedFetch.mockImplementation(async (_url, _hostname, _records, _init, handler) =>
      handler(response),
    );
    const channel = new WebhookChannel(db as unknown as PrismaClient);

    await channel.send(EVENT, []);

    expect(response.text).toHaveBeenCalled();
  });
});
