import type { PrismaClient } from "@admitto/db";
import { Prisma } from "@admitto/db";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { notify } from "../src/dispatcher.js";
import type { NotificationChannel } from "../src/channel.js";
import type { DispatchedNotification, NotificationEvent } from "../src/types.js";
import { createStubDb } from "./stubDb.js";

const TYPE = "auth.login.repeated_failures";
const ORG_ID = "org-1";

const EVENT: NotificationEvent = {
  organizationId: ORG_ID,
  title: "Repeated failed logins",
  body: "5 consecutive failed attempts on user@example.com.",
};

const STUB_OK_RESULT: { ok: boolean; error?: string; noop?: boolean } = { ok: true };

function stubChannel(result: { ok: boolean; error?: string; noop?: boolean } = STUB_OK_RESULT) {
  const send = vi.fn().mockResolvedValue(result);
  return { channel: "email" as const, send } satisfies NotificationChannel;
}

function p2002(): Prisma.PrismaClientKnownRequestError {
  return new Prisma.PrismaClientKnownRequestError("unique constraint", {
    code: "P2002",
    clientVersion: "test",
  });
}

/** Default happy-path stubbing: throttle claims on first try, one active org-staff candidate,
 * that candidate has every channel enabled. */
function stubHappyPath(db: ReturnType<typeof createStubDb>) {
  db.notificationSettings.findUnique.mockResolvedValue(null); // no disabled_types row
  db.notificationThrottle.create.mockResolvedValue({});
  db.roleAssignment.findMany.mockResolvedValue([{ user_id: "u-1", user: { is_active: true } }]);
  db.notificationPreference.findMany.mockResolvedValue([]);
  db.securityAuditLog.create.mockResolvedValue({});
}

describe("notify()", () => {
  let db: ReturnType<typeof createStubDb>;

  beforeEach(() => {
    db = createStubDb();
  });

  it("never throws for an unknown notification type, and touches nothing", async () => {
    await expect(
      notify(db as unknown as PrismaClient, "not.a.real.type", EVENT),
    ).resolves.toBeUndefined();
    expect(db.notificationSettings.findUnique).not.toHaveBeenCalled();
    expect(db.securityAuditLog.create).not.toHaveBeenCalled();
  });

  it("skips dispatch (but still calls no channel) when the org disabled this type", async () => {
    db.notificationSettings.findUnique.mockResolvedValue({ disabled_types: [TYPE] });
    const webhook = stubChannel();
    const inApp = stubChannel();
    const email = stubChannel();

    await notify(db as unknown as PrismaClient, TYPE, EVENT, {
      channels: { email, webhook, in_app: inApp },
    });

    expect(email.send).not.toHaveBeenCalled();
    expect(webhook.send).not.toHaveBeenCalled();
    expect(inApp.send).not.toHaveBeenCalled();
    expect(db.securityAuditLog.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ event_type: "notification.dispatch.skipped_org_disabled" }),
      }),
    );
  });

  it("skips when the throttle window has not elapsed (create races into P2002, updateMany finds no stale row)", async () => {
    db.notificationSettings.findUnique.mockResolvedValue(null);
    db.notificationThrottle.create.mockRejectedValue(p2002());
    db.notificationThrottle.updateMany.mockResolvedValue({ count: 0 });
    const email = stubChannel();

    await notify(db as unknown as PrismaClient, TYPE, EVENT, { channels: { email } });

    expect(email.send).not.toHaveBeenCalled();
    expect(db.securityAuditLog.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ event_type: "notification.dispatch.skipped_throttled" }),
      }),
    );
  });

  it("proceeds when a stale throttle row is reclaimed via updateMany", async () => {
    db.notificationSettings.findUnique.mockResolvedValue(null);
    db.notificationThrottle.create.mockRejectedValue(p2002());
    db.notificationThrottle.updateMany.mockResolvedValue({ count: 1 });
    db.roleAssignment.findMany.mockResolvedValue([{ user_id: "u-1", user: { is_active: true } }]);
    db.notificationPreference.findMany.mockResolvedValue([]);
    const email = stubChannel();

    await notify(db as unknown as PrismaClient, TYPE, EVENT, { channels: { email } });

    expect(email.send).toHaveBeenCalled();
  });

  it("builds the throttle dedupe key from organizationId + event.dedupeKey, not organizationId alone", async () => {
    stubHappyPath(db);

    await notify(db as unknown as PrismaClient, TYPE, { ...EVENT, dedupeKey: "attacked-user-42" }, {
      channels: { email: stubChannel() },
    });

    expect(db.notificationThrottle.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        event_type: TYPE,
        dedupe_key: `${ORG_ID}:attacked-user-42`,
      }),
    });
  });

  it("falls back to an org-only dedupe key when the call site supplies no dedupeKey", async () => {
    stubHappyPath(db);

    await notify(db as unknown as PrismaClient, TYPE, EVENT, { channels: { email: stubChannel() } });

    expect(db.notificationThrottle.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ dedupe_key: `${ORG_ID}:org` }),
    });
  });

  it("skips with skipped_empty_audience when org-staff resolves to zero active admins", async () => {
    db.notificationSettings.findUnique.mockResolvedValue(null);
    db.notificationThrottle.create.mockResolvedValue({});
    db.roleAssignment.findMany.mockResolvedValue([]);
    const email = stubChannel();

    await notify(db as unknown as PrismaClient, TYPE, EVENT, { channels: { email } });

    expect(email.send).not.toHaveBeenCalled();
    expect(db.securityAuditLog.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          event_type: "notification.dispatch.skipped_empty_audience",
        }),
      }),
    );
  });

  it("releases the throttle claim when the audience resolves to nobody, so a later real occurrence isn't silently suppressed", async () => {
    db.notificationSettings.findUnique.mockResolvedValue(null);
    db.notificationThrottle.create.mockResolvedValue({});
    db.roleAssignment.findMany.mockResolvedValue([]);

    await notify(db as unknown as PrismaClient, TYPE, EVENT, { channels: { email: stubChannel() } });

    expect(db.notificationThrottle.delete).toHaveBeenCalledWith({
      where: {
        event_type_dedupe_key: { event_type: TYPE, dedupe_key: `${ORG_ID}:org` },
      },
    });
  });

  it("sends through every applicable channel and writes a sent audit row on full success", async () => {
    stubHappyPath(db);
    const email = stubChannel();
    const webhook = stubChannel();
    const inApp = stubChannel();

    await notify(db as unknown as PrismaClient, TYPE, EVENT, {
      channels: { email, webhook, in_app: inApp },
    });

    expect(email.send).toHaveBeenCalledWith(expect.anything(), ["u-1"]);
    expect(webhook.send).toHaveBeenCalledWith(expect.anything(), []);
    expect(inApp.send).toHaveBeenCalledWith(expect.anything(), ["u-1"]);
    expect(db.securityAuditLog.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          event_type: "notification.dispatch.sent",
          metadata: expect.objectContaining({
            channels_sent: expect.arrayContaining(["webhook", "email", "in_app"]),
          }),
        }),
      }),
    );
    expect(db.notificationThrottle.delete).not.toHaveBeenCalled();
  });

  it("only sends to candidates whose per-user preference has that channel enabled", async () => {
    db.notificationSettings.findUnique.mockResolvedValue(null);
    db.notificationThrottle.create.mockResolvedValue({});
    db.roleAssignment.findMany.mockResolvedValue([
      { user_id: "u-1", user: { is_active: true } },
      { user_id: "u-2", user: { is_active: true } },
    ]);
    db.notificationPreference.findMany.mockResolvedValue([
      { user_id: "u-2", channel: "email", enabled: false },
    ]);
    const email = stubChannel();
    const inApp = stubChannel();

    await notify(db as unknown as PrismaClient, TYPE, EVENT, {
      channels: { email, in_app: inApp, webhook: stubChannel() },
    });

    expect(email.send).toHaveBeenCalledWith(expect.anything(), ["u-1"]);
    expect(inApp.send).toHaveBeenCalledWith(expect.anything(), ["u-1", "u-2"]);
  });

  it("still invokes the email channel (with zero user recipients) when every org-staff candidate opted out, so a configured team distro address still gets it", async () => {
    db.notificationSettings.findUnique.mockResolvedValue(null);
    db.notificationThrottle.create.mockResolvedValue({});
    db.roleAssignment.findMany.mockResolvedValue([{ user_id: "u-1", user: { is_active: true } }]);
    db.notificationPreference.findMany.mockResolvedValue([
      { user_id: "u-1", channel: "email", enabled: false },
    ]);
    const email = stubChannel();

    await notify(db as unknown as PrismaClient, TYPE, EVENT, {
      channels: { email, webhook: stubChannel(), in_app: stubChannel() },
    });

    expect(email.send).toHaveBeenCalledWith(expect.anything(), []);
  });

  it("does not report a noop channel (nothing configured, nothing to send) as having sent the alert", async () => {
    stubHappyPath(db);
    const webhook = stubChannel({ ok: true, noop: true }); // e.g. no webhook_url_enc configured
    const email = stubChannel();
    const inApp = stubChannel();

    await notify(db as unknown as PrismaClient, TYPE, EVENT, {
      channels: { webhook, email, in_app: inApp },
    });

    expect(db.securityAuditLog.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          event_type: "notification.dispatch.sent",
          metadata: expect.objectContaining({
            channels_sent: expect.not.arrayContaining(["webhook"]),
          }),
        }),
      }),
    );
    const call = db.securityAuditLog.create.mock.calls.at(-1)![0] as {
      data: { metadata: { channels_sent: string[] } };
    };
    expect(call.data.metadata.channels_sent.toSorted((a, b) => a.localeCompare(b))).toEqual([
      "email",
      "in_app",
    ]);
  });

  it("writes a failed audit row (not sent) when any channel reports failure, without throwing", async () => {
    stubHappyPath(db);
    const email = stubChannel({ ok: false, error: "Send failed." });

    await notify(db as unknown as PrismaClient, TYPE, EVENT, {
      channels: { email, webhook: stubChannel(), in_app: stubChannel() },
    });

    expect(db.securityAuditLog.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          event_type: "notification.dispatch.failed",
          metadata: expect.objectContaining({
            failures: [{ channel: "email", error: "Send failed." }],
          }),
        }),
      }),
    );
  });

  it("releases the throttle claim when a channel fails, so a real later occurrence can still alert", async () => {
    stubHappyPath(db);
    const email = stubChannel({ ok: false, error: "Send failed." });

    await notify(db as unknown as PrismaClient, TYPE, EVENT, {
      channels: { email, webhook: stubChannel(), in_app: stubChannel() },
    });

    expect(db.notificationThrottle.delete).toHaveBeenCalledWith({
      where: {
        event_type_dedupe_key: { event_type: TYPE, dedupe_key: `${ORG_ID}:org` },
      },
    });
  });

  it("releases the throttle claim when an unexpected exception happens after the claim succeeded", async () => {
    stubHappyPath(db);
    db.roleAssignment.findMany.mockRejectedValue(new Error("connection reset"));

    await expect(
      notify(db as unknown as PrismaClient, TYPE, EVENT, { channels: { email: stubChannel() } }),
    ).resolves.toBeUndefined();

    expect(db.notificationThrottle.delete).toHaveBeenCalledWith({
      where: {
        event_type_dedupe_key: { event_type: TYPE, dedupe_key: `${ORG_ID}:org` },
      },
    });
  });

  it("does not attempt to release the throttle when the exception happens before a claim was made", async () => {
    db.notificationSettings.findUnique.mockRejectedValue(new Error("connection reset"));

    await expect(
      notify(db as unknown as PrismaClient, TYPE, EVENT, { channels: { email: stubChannel() } }),
    ).resolves.toBeUndefined();

    expect(db.notificationThrottle.delete).not.toHaveBeenCalled();
  });

  it("does not throw when the release itself fails, and treats a concurrently-reclaimed row (P2025) as nothing to do", async () => {
    stubHappyPath(db);
    db.roleAssignment.findMany.mockResolvedValue([]); // -> empty audience -> attempts a release
    db.notificationThrottle.delete.mockRejectedValue(
      new Prisma.PrismaClientKnownRequestError("Record to delete does not exist.", {
        code: "P2025",
        clientVersion: "test",
      }),
    );

    await expect(
      notify(db as unknown as PrismaClient, TYPE, EVENT, { channels: { email: stubChannel() } }),
    ).resolves.toBeUndefined();
  });

  it("does not throw when the release fails with a real (non-P2025) error", async () => {
    stubHappyPath(db);
    db.roleAssignment.findMany.mockResolvedValue([]); // -> empty audience -> attempts a release
    db.notificationThrottle.delete.mockRejectedValue(new Error("connection reset"));

    await expect(
      notify(db as unknown as PrismaClient, TYPE, EVENT, { channels: { email: stubChannel() } }),
    ).resolves.toBeUndefined();
  });

  it("sanitizes title/body before any channel sees them", async () => {
    stubHappyPath(db);
    let captured: DispatchedNotification | undefined;
    const email: NotificationChannel = {
      channel: "email",
      send: vi.fn(async (event) => {
        captured = event;
        return { ok: true };
      }),
    };

    await notify(
      db as unknown as PrismaClient,
      TYPE,
      { ...EVENT, body: "Contact attacker-controlled-handle@example.com for details." },
      { channels: { email } },
    );

    expect(captured?.body).not.toContain("attacker-controlled-handle@example.com");
    expect(captured?.body).toContain("[redacted]");
  });

  it("never throws even when every DB call rejects", async () => {
    db.notificationSettings.findUnique.mockRejectedValue(new Error("connection reset"));

    await expect(notify(db as unknown as PrismaClient, TYPE, EVENT)).resolves.toBeUndefined();
  });

  it("never throws when a non-Error value is thrown", async () => {
    db.notificationSettings.findUnique.mockRejectedValue("connection reset");

    await expect(notify(db as unknown as PrismaClient, TYPE, EVENT)).resolves.toBeUndefined();
  });

  it("rethrows (into the outer catch, never to the caller) a throttle-claim error that isn't a unique-constraint race", async () => {
    db.notificationSettings.findUnique.mockResolvedValue(null);
    db.notificationThrottle.create.mockRejectedValue(new Error("connection reset"));
    const email = stubChannel();

    await expect(
      notify(db as unknown as PrismaClient, TYPE, EVENT, { channels: { email } }),
    ).resolves.toBeUndefined();

    expect(email.send).not.toHaveBeenCalled();
    expect(db.notificationThrottle.updateMany).not.toHaveBeenCalled();
  });

  it("does not throw when writing the audit log itself fails", async () => {
    stubHappyPath(db);
    db.securityAuditLog.create.mockRejectedValue(new Error("audit table unavailable"));

    await expect(
      notify(db as unknown as PrismaClient, TYPE, EVENT, { channels: { email: stubChannel() } }),
    ).resolves.toBeUndefined();
  });

  it("does not throw when writing the audit log fails with a non-Error value", async () => {
    stubHappyPath(db);
    db.securityAuditLog.create.mockRejectedValue("audit table unavailable");

    await expect(
      notify(db as unknown as PrismaClient, TYPE, EVENT, { channels: { email: stubChannel() } }),
    ).resolves.toBeUndefined();
  });

  it("constructs real channel instances (not stubs) when no channels override is supplied", async () => {
    stubHappyPath(db);

    // No `channels` deps at all - exercises EmailChannel/WebhookChannel/InAppChannel's real
    // default construction. The stub db has no mailSettings/user mocks wired up, so the real
    // channels are expected to fail internally and get recorded as failures - the point of this
    // test is only that notify() never throws and actually reaches that code path.
    await expect(notify(db as unknown as PrismaClient, TYPE, EVENT)).resolves.toBeUndefined();

    expect(db.securityAuditLog.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          event_type: expect.stringMatching(/^notification\.dispatch\.(sent|failed)$/),
        }),
      }),
    );
  });

  it("skips a candidate entirely when they opted out of every per-user channel", async () => {
    db.notificationSettings.findUnique.mockResolvedValue(null);
    db.notificationThrottle.create.mockResolvedValue({});
    db.roleAssignment.findMany.mockResolvedValue([
      { user_id: "u-1", user: { is_active: true } },
      { user_id: "u-2", user: { is_active: true } },
    ]);
    db.notificationPreference.findMany.mockResolvedValue([
      { user_id: "u-2", channel: "email", enabled: false },
      { user_id: "u-2", channel: "in_app", enabled: false },
    ]);
    const email = stubChannel();
    const inApp = stubChannel();

    await notify(db as unknown as PrismaClient, TYPE, EVENT, {
      channels: { email, in_app: inApp, webhook: stubChannel() },
    });

    expect(email.send).toHaveBeenCalledWith(expect.anything(), ["u-1"]);
    expect(inApp.send).toHaveBeenCalledWith(expect.anything(), ["u-1"]);
  });
});

describe("reportUnknownType() console output", () => {
  it("skips the extra dev-loud console.error in production (emitSystemLog's own logging still fires)", async () => {
    vi.stubEnv("NODE_ENV", "production");
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    const db = createStubDb();

    try {
      await notify(db as unknown as PrismaClient, "not.a.real.type", EVENT);
      const messages = consoleError.mock.calls.map((call) => String(call[0]));
      expect(messages.some((msg) => msg.includes("this is a bug"))).toBe(false);
    } finally {
      consoleError.mockRestore();
      vi.unstubAllEnvs();
    }
  });

  it("adds the extra dev-loud console.error outside production", async () => {
    vi.stubEnv("NODE_ENV", "test");
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    const db = createStubDb();

    try {
      await notify(db as unknown as PrismaClient, "not.a.real.type", EVENT);
      const messages = consoleError.mock.calls.map((call) => String(call[0]));
      expect(messages.some((msg) => msg.includes("this is a bug"))).toBe(true);
    } finally {
      consoleError.mockRestore();
      vi.unstubAllEnvs();
    }
  });
});
