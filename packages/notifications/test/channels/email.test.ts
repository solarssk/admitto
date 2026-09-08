import type { PrismaClient } from "@admitto/db";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { EmailChannel } from "../../src/channels/email.js";
import type { DispatchedNotification } from "../../src/types.js";
import { createStubDb } from "../stubDb.js";

const resolveMailConfigForOrg = vi.fn();
vi.mock("@admitto/mailer-config", () => ({
  resolveMailConfigForOrg: (...args: unknown[]) => resolveMailConfigForOrg(...args),
}));

const send = vi.fn();
const closeMailer = vi.fn();
const createMailer = vi.fn();
vi.mock("@admitto/mailer", () => ({
  createMailer: (...args: unknown[]) => createMailer(...args),
  closeMailer: (...args: unknown[]) => closeMailer(...args),
}));

const EVENT: DispatchedNotification = {
  type: "auth.login.new_country",
  severity: "warn",
  organizationId: "org-1",
  title: "Login from a new country",
  body: "admin@example.com logged in from a new country.",
  metadata: { country: "Poland" },
};

describe("EmailChannel", () => {
  beforeEach(() => {
    resolveMailConfigForOrg.mockReset().mockResolvedValue({ provider: "smtp" });
    createMailer.mockReset().mockResolvedValue({ send });
    closeMailer.mockReset().mockResolvedValue(undefined);
    send.mockReset().mockResolvedValue({ status: "sent", provider: "smtp" });
  });

  it("is a no-op success when there are no resolved recipients and no extra recipients", async () => {
    const db = createStubDb();
    db.user.findMany.mockResolvedValue([]);
    const channel = new EmailChannel(db as unknown as PrismaClient);

    const result = await channel.send(EVENT, []);

    expect(result).toEqual({ ok: true });
    expect(createMailer).not.toHaveBeenCalled();
  });

  it("sends one message per resolved recipient with a rendered, substituted body", async () => {
    const db = createStubDb();
    db.user.findMany.mockResolvedValue([{ email: "a@example.com" }, { email: "b@example.com" }]);
    const channel = new EmailChannel(db as unknown as PrismaClient);

    const result = await channel.send(EVENT, ["u-a", "u-b"]);

    expect(result).toEqual({ ok: true });
    expect(send).toHaveBeenCalledTimes(2);
    const messages = send.mock.calls.map(([message]) => message);
    expect(messages.map((m) => m.to).sort()).toEqual(["a@example.com", "b@example.com"]);
    expect(messages[0].subject).toBe(`[Admitto] ${EVENT.title}`);
    expect(messages[0].html).toContain(EVENT.title);
    expect(messages[0].html).toContain(EVENT.body);
    expect(messages[0].html).toContain("country: Poland");
    expect(closeMailer).toHaveBeenCalledTimes(1);
  });

  it("includes NotificationSettings.extra_email_recipients only when includeExtraRecipients is set", async () => {
    const db = createStubDb();
    db.user.findMany.mockResolvedValue([]);
    db.notificationSettings.findUnique.mockResolvedValue({
      extra_email_recipients: ["ops@example.com", "ops@example.com"],
    });
    const channel = new EmailChannel(db as unknown as PrismaClient, { includeExtraRecipients: true });

    const result = await channel.send(EVENT, []);

    expect(result).toEqual({ ok: true });
    expect(send).toHaveBeenCalledTimes(1);
    expect(send.mock.calls[0]![0].to).toBe("ops@example.com");
  });

  it("does not query extra recipients when includeExtraRecipients is not set (self-audience safety)", async () => {
    const db = createStubDb();
    db.user.findMany.mockResolvedValue([{ email: "u@example.com" }]);
    const channel = new EmailChannel(db as unknown as PrismaClient);

    await channel.send(EVENT, ["u-1"]);

    expect(db.notificationSettings.findUnique).not.toHaveBeenCalled();
  });

  it("returns a sanitized failure when the mailer reports a failed send, without throwing", async () => {
    const db = createStubDb();
    db.user.findMany.mockResolvedValue([{ email: "a@example.com" }]);
    send.mockResolvedValue({
      status: "failed",
      provider: "smtp",
      error: "SMTP said no for secret@internal.example.com https://leak.example.com/x",
    });
    const channel = new EmailChannel(db as unknown as PrismaClient);

    const result = await channel.send(EVENT, ["u-1"]);

    expect(result.ok).toBe(false);
    expect(result.error).not.toContain("secret@internal.example.com");
    expect(result.error).not.toContain("https://leak.example.com");
    expect(closeMailer).toHaveBeenCalledTimes(1);
  });

  it("catches an unexpected throw (e.g. mail config resolution failure) and returns a sanitized failure", async () => {
    resolveMailConfigForOrg.mockRejectedValue(new Error("Cannot resolve mail provider"));
    const db = createStubDb();
    db.user.findMany.mockResolvedValue([{ email: "a@example.com" }]);
    const channel = new EmailChannel(db as unknown as PrismaClient);

    const result = await channel.send(EVENT, ["u-1"]);

    expect(result.ok).toBe(false);
    expect(result.error).toBeTruthy();
  });
});
