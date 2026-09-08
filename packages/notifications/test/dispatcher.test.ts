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

function stubChannel(result: { ok: boolean; error?: string } = { ok: true }) {
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
  });

  it("only sends to candidates whose per-user preference has that channel enabled", async () => {
    db.notificationSettings.findUnique.mockResolvedValue(null);
    db.notificationThrottle.create.mockResolvedValue({});
    db.roleAssignment.findMany.mockResolvedValue([
      { user_id: "u-1", user: { is_active: true } },
      { user_id: "u-2", user: { is_active: true } },
    ]);
    db.notificationPreference.findMany.mockImplementation(({ where }: { where: { user_id: string } }) =>
      Promise.resolve(
        where.user_id === "u-2" ? [{ channel: "email", enabled: false }] : [],
      ),
    );
    const email = stubChannel();
    const inApp = stubChannel();

    await notify(db as unknown as PrismaClient, TYPE, EVENT, {
      channels: { email, in_app: inApp, webhook: stubChannel() },
    });

    expect(email.send).toHaveBeenCalledWith(expect.anything(), ["u-1"]);
    expect(inApp.send).toHaveBeenCalledWith(expect.anything(), ["u-1", "u-2"]);
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
});
