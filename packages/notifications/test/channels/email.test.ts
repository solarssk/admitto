import type { PrismaClient } from "@admitto/db";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { EMAIL_SEND_CONCURRENCY, EmailChannel } from "../../src/channels/email.js";
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

    expect(result).toEqual({ ok: true, noop: true });
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
    expect(messages.map((m) => m.to).toSorted((a, b) => a.localeCompare(b))).toEqual([
      "a@example.com",
      "b@example.com",
    ]);
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

  it("reports ok:true with a sanitized error (not a clean failure) when some but not all recipients fail, so the throttle claim isn't released and re-sent to those who already got it", async () => {
    const db = createStubDb();
    db.user.findMany.mockResolvedValue([{ email: "a@example.com" }, { email: "b@example.com" }]);
    send
      .mockResolvedValueOnce({ status: "sent", provider: "smtp" })
      .mockResolvedValueOnce({
        status: "failed",
        provider: "smtp",
        error: "SMTP said no for secret@internal.example.com",
      });
    const channel = new EmailChannel(db as unknown as PrismaClient);

    const result = await channel.send(EVENT, ["u-a", "u-b"]);

    expect(result.ok).toBe(true);
    expect(result.error).toContain("1/2 recipients failed");
    expect(result.error).not.toContain("secret@internal.example.com");
    expect(result.error).not.toContain("a@example.com");
    expect(result.error).not.toContain("b@example.com");
  });

  it("preserves a sibling recipient's already-successful send when another recipient's mailer.send() rejects (e.g. SmtpAdapter's deliberate MailDestinationError rethrow), instead of Promise.all discarding it via fail-fast", async () => {
    const db = createStubDb();
    db.user.findMany.mockResolvedValue([{ email: "a@example.com" }, { email: "b@example.com" }]);
    send
      .mockResolvedValueOnce({ status: "sent", provider: "smtp" })
      .mockRejectedValueOnce(new Error("destination blocked: DNS rebind detected"));
    const channel = new EmailChannel(db as unknown as PrismaClient);

    const result = await channel.send(EVENT, ["u-a", "u-b"]);

    expect(result.ok).toBe(true);
    expect(result.error).toContain("1/2 recipients failed");
  });

  it("bounds concurrent sends to EMAIL_SEND_CONCURRENCY instead of firing every recipient at once", async () => {
    const db = createStubDb();
    const recipientCount = EMAIL_SEND_CONCURRENCY + 2; // more recipients than the concurrency cap
    db.user.findMany.mockResolvedValue(
      Array.from({ length: recipientCount }, (_, i) => ({ email: `u${i}@example.com` })),
    );
    let inFlight = 0;
    let maxInFlight = 0;
    let pending: Array<() => void> = [];
    send.mockImplementation(
      () =>
        new Promise((resolve) => {
          inFlight++;
          maxInFlight = Math.max(maxInFlight, inFlight);
          pending.push(() => {
            inFlight--;
            resolve({ status: "sent", provider: "smtp" });
          });
        }),
    );
    const channel = new EmailChannel(db as unknown as PrismaClient);
    const recipientIds = Array.from({ length: recipientCount }, (_, i) => `u-${i}`);

    const sendPromise = channel.send(EVENT, recipientIds);

    while (send.mock.calls.length < recipientCount) {
      await new Promise((resolve) => setTimeout(resolve, 0));
      const toResolve = pending;
      pending = [];
      toResolve.forEach((resolveOne) => resolveOne());
    }

    await sendPromise;
    expect(maxInFlight).toBe(EMAIL_SEND_CONCURRENCY);
    expect(send).toHaveBeenCalledTimes(recipientCount);
  });

  it("reports a clean failure (not partial) when every recipient's send rejects", async () => {
    const db = createStubDb();
    db.user.findMany.mockResolvedValue([{ email: "a@example.com" }, { email: "b@example.com" }]);
    send.mockRejectedValue(new Error("destination blocked: DNS rebind detected"));
    const channel = new EmailChannel(db as unknown as PrismaClient);

    const result = await channel.send(EVENT, ["u-a", "u-b"]);

    expect(result).toEqual({ ok: false, error: "destination blocked: DNS rebind detected" });
  });

  it("stringifies a non-Error rejection reason before sanitizing it", async () => {
    const db = createStubDb();
    db.user.findMany.mockResolvedValue([{ email: "a@example.com" }]);
    send.mockRejectedValue("not an Error instance");
    const channel = new EmailChannel(db as unknown as PrismaClient);

    const result = await channel.send(EVENT, ["u-1"]);

    expect(result).toEqual({ ok: false, error: "not an Error instance" });
  });

  it("bounds the mailer round-trip and returns a failure instead of hanging when the send itself never settles", async () => {
    const db = createStubDb();
    db.user.findMany.mockResolvedValue([{ email: "a@example.com" }]);
    send.mockImplementation(() => new Promise(() => undefined)); // never resolves/rejects
    const channel = new EmailChannel(db as unknown as PrismaClient, { timeoutMs: 20 });

    const result = await channel.send(EVENT, ["u-1"]);

    expect(result.ok).toBe(false);
    expect(result.error).toBeTruthy();
    // closeMailer is NOT asserted here: the timeout races the whole attempt rather than
    // cancelling it, so the abandoned attempt's own cleanup (including closeMailer) only runs
    // once/if the underlying mock ever actually settles - which this specific mock deliberately
    // never does. See EMAIL_SEND_TIMEOUT_MS's own doc comment for that tradeoff.
  });

  it("bounds createMailer() itself, not just the later send - e.g. SmtpAdapter resolving its destination at construction time", async () => {
    const db = createStubDb();
    db.user.findMany.mockResolvedValue([{ email: "a@example.com" }]);
    createMailer.mockImplementation(() => new Promise(() => undefined)); // never resolves/rejects
    const channel = new EmailChannel(db as unknown as PrismaClient, { timeoutMs: 20 });

    const result = await channel.send(EVENT, ["u-1"]);

    expect(result.ok).toBe(false);
    expect(result.error).toBeTruthy();
    expect(send).not.toHaveBeenCalled();
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

  it("renders with an empty metadata line when the event carries no metadata", async () => {
    const db = createStubDb();
    db.user.findMany.mockResolvedValue([{ email: "a@example.com" }]);
    const channel = new EmailChannel(db as unknown as PrismaClient);

    await channel.send({ ...EVENT, metadata: undefined }, ["u-1"]);

    expect(send).toHaveBeenCalledTimes(1);
    expect(send.mock.calls[0]![0].html).not.toContain("country:");
  });

  it("treats a non-array extra_email_recipients as none configured", async () => {
    const db = createStubDb();
    db.user.findMany.mockResolvedValue([]);
    db.notificationSettings.findUnique.mockResolvedValue({ extra_email_recipients: null });
    const channel = new EmailChannel(db as unknown as PrismaClient, { includeExtraRecipients: true });

    const result = await channel.send(EVENT, []);

    expect(result).toEqual({ ok: true, noop: true });
    expect(createMailer).not.toHaveBeenCalled();
  });

  it("falls back to a generic failure message when the mailer error has nothing to sanitize", async () => {
    const db = createStubDb();
    db.user.findMany.mockResolvedValue([{ email: "a@example.com" }]);
    send.mockResolvedValue({ status: "failed", provider: "smtp", error: "" });
    const channel = new EmailChannel(db as unknown as PrismaClient);

    const result = await channel.send(EVENT, ["u-1"]);

    expect(result).toEqual({ ok: false, error: "Send failed." });
  });

  it("stringifies a non-Error thrown value before sanitizing it", async () => {
    resolveMailConfigForOrg.mockRejectedValue("not an Error instance");
    const db = createStubDb();
    db.user.findMany.mockResolvedValue([{ email: "a@example.com" }]);
    const channel = new EmailChannel(db as unknown as PrismaClient);

    const result = await channel.send(EVENT, ["u-1"]);

    expect(result).toEqual({ ok: false, error: "not an Error instance" });
  });

  it("falls back to a generic failure message when an unexpected throw has nothing to sanitize", async () => {
    resolveMailConfigForOrg.mockRejectedValue(new Error("")); // NOSONAR - deliberately empty, exercises the "nothing to sanitize" fallback
    const db = createStubDb();
    db.user.findMany.mockResolvedValue([{ email: "a@example.com" }]);
    const channel = new EmailChannel(db as unknown as PrismaClient);

    const result = await channel.send(EVENT, ["u-1"]);

    expect(result).toEqual({ ok: false, error: "Send failed." });
  });
});
