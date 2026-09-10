import type { PrismaClient } from "@admitto/db";
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

/** claimThrottleSlot's `db.$queryRaw` returns one row on a successful claim (fresh insert or
 * stale-row reclaim - both indistinguishable to the caller by design), zero rows when another
 * claimant already holds this window. */
function queryRawClaims(db: ReturnType<typeof createStubDb>, claimed: boolean): void {
  db.$queryRaw.mockResolvedValue(claimed ? [{ id: "throttle-1" }] : []);
}

/** Default happy-path stubbing: throttle claims on first try, one active org-staff candidate,
 * that candidate has every channel enabled. */
function stubHappyPath(db: ReturnType<typeof createStubDb>) {
  db.notificationSettings.findUnique.mockResolvedValue(null); // no disabled_channels row
  queryRawClaims(db, true);
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

  it("skips dispatch entirely (no channel, no throttle claim) when the org disabled every channel this type has", async () => {
    db.notificationSettings.findUnique.mockResolvedValue({
      disabled_channels: { [TYPE]: ["webhook", "email", "in_app"] },
    });
    const webhook = stubChannel();
    const inApp = stubChannel();
    const email = stubChannel();

    await notify(db as unknown as PrismaClient, TYPE, EVENT, {
      channels: { email, webhook, in_app: inApp },
    });

    expect(email.send).not.toHaveBeenCalled();
    expect(webhook.send).not.toHaveBeenCalled();
    expect(inApp.send).not.toHaveBeenCalled();
    expect(db.$queryRaw).not.toHaveBeenCalled();
    expect(db.securityAuditLog.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ event_type: "notification.dispatch.skipped_org_disabled" }),
      }),
    );
  });

  it("skips only the channel(s) the org disabled for this type, still sending on every other channel and still claiming the throttle", async () => {
    db.notificationSettings.findUnique.mockResolvedValue({ disabled_channels: { [TYPE]: ["webhook"] } });
    queryRawClaims(db, true);
    db.roleAssignment.findMany.mockResolvedValue([{ user_id: "u-1", user: { is_active: true } }]);
    db.notificationPreference.findMany.mockResolvedValue([]);
    const webhook = stubChannel();
    const email = stubChannel();
    const inApp = stubChannel();

    await notify(db as unknown as PrismaClient, TYPE, EVENT, {
      channels: { email, webhook, in_app: inApp },
    });

    expect(webhook.send).not.toHaveBeenCalled();
    expect(email.send).toHaveBeenCalledWith(expect.anything(), ["u-1"]);
    expect(inApp.send).toHaveBeenCalledWith(expect.anything(), ["u-1"]);
    expect(db.securityAuditLog.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          event_type: "notification.dispatch.sent",
          metadata: expect.objectContaining({
            channels_sent: expect.arrayContaining(["email", "in_app"]),
            disabled_channels: ["webhook"],
          }),
        }),
      }),
    );
    expect(db.notificationThrottle.deleteMany).not.toHaveBeenCalled();
  });


  it("ignores malformed disabled_channels entries (non-array value, or array that filters to empty) - treated as fully enabled", async () => {
    db.notificationSettings.findUnique.mockResolvedValue({
      disabled_channels: { [TYPE]: [123, null, true], "some.other.type": "webhook" },
    });
    queryRawClaims(db, true);
    db.roleAssignment.findMany.mockResolvedValue([{ user_id: "u-1", user: { is_active: true } }]);
    db.notificationPreference.findMany.mockResolvedValue([]);
    const webhook = stubChannel();
    const email = stubChannel();
    const inApp = stubChannel();

    await notify(db as unknown as PrismaClient, TYPE, EVENT, {
      channels: { email, webhook, in_app: inApp },
    });

    expect(webhook.send).toHaveBeenCalled();
    expect(email.send).toHaveBeenCalledWith(expect.anything(), ["u-1"]);
    expect(inApp.send).toHaveBeenCalledWith(expect.anything(), ["u-1"]);
  });

  it("skips when the throttle window has not elapsed (claim query returns no row)", async () => {
    db.notificationSettings.findUnique.mockResolvedValue(null);
    queryRawClaims(db, false);
    const email = stubChannel();

    await notify(db as unknown as PrismaClient, TYPE, EVENT, { channels: { email } });

    expect(email.send).not.toHaveBeenCalled();
    expect(db.securityAuditLog.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ event_type: "notification.dispatch.skipped_throttled" }),
      }),
    );
  });

  it("proceeds when the claim query returns a row (fresh insert or stale-row reclaim)", async () => {
    db.notificationSettings.findUnique.mockResolvedValue(null);
    queryRawClaims(db, true);
    db.roleAssignment.findMany.mockResolvedValue([{ user_id: "u-1", user: { is_active: true } }]);
    db.notificationPreference.findMany.mockResolvedValue([]);
    const email = stubChannel();

    await notify(db as unknown as PrismaClient, TYPE, EVENT, { channels: { email } });

    expect(email.send).toHaveBeenCalled();
  });

  it("assigns a fresh id on every successful claim, including a stale-row reclaim - a unit test can't exercise real Postgres ON CONFLICT semantics, so this guards the SQL text itself against an accidental regression of the id = EXCLUDED.id fix", async () => {
    stubHappyPath(db);

    await notify(db as unknown as PrismaClient, TYPE, EVENT, { channels: { email: stubChannel() } });

    const [strings] = db.$queryRaw.mock.calls[0] as [TemplateStringsArray];
    const sql = strings.join("");
    expect(sql).toContain("id = EXCLUDED.id");
  });

  it("builds the throttle dedupe key from organizationId + event.dedupeKey, not organizationId alone", async () => {
    stubHappyPath(db);

    await notify(db as unknown as PrismaClient, TYPE, { ...EVENT, dedupeKey: "attacked-user-42" }, {
      channels: { email: stubChannel() },
    });

    // db.$queryRaw is called as a tagged template - mock.calls[0] is [strings, ...interpolated
    // values] in source order: eventType, dedupeKey, now, now, cutoff (see claimThrottleSlot).
    const [, calledEventType, calledDedupeKey] = db.$queryRaw.mock.calls[0] as unknown[];
    expect(calledEventType).toBe(TYPE);
    expect(calledDedupeKey).toBe(`${ORG_ID}:attacked-user-42`);
  });

  it("falls back to an org-only dedupe key when the call site supplies no dedupeKey", async () => {
    stubHappyPath(db);

    await notify(db as unknown as PrismaClient, TYPE, EVENT, { channels: { email: stubChannel() } });

    const [, , calledDedupeKey] = db.$queryRaw.mock.calls[0] as unknown[];
    expect(calledDedupeKey).toBe(`${ORG_ID}:org`);
  });

  it("still attempts the audience-independent webhook (and a configured team distro email) even when org-staff resolves to zero active admins", async () => {
    db.notificationSettings.findUnique.mockResolvedValue(null);
    queryRawClaims(db, true);
    db.roleAssignment.findMany.mockResolvedValue([]);
    // Mirrors the real EmailChannel/WebhookChannel's own noop-on-nothing-to-send behavior -
    // recipientUserIds is empty (no candidates), but both are still attempted.
    const email: NotificationChannel = {
      channel: "email",
      send: vi.fn(async (_event, recipientUserIds: string[]) =>
        recipientUserIds.length === 0 ? { ok: true, noop: true } : { ok: true },
      ),
    };
    const webhook = stubChannel();

    await notify(db as unknown as PrismaClient, TYPE, EVENT, { channels: { email, webhook } });

    expect(email.send).toHaveBeenCalledWith(expect.anything(), []);
    expect(webhook.send).toHaveBeenCalled();
    expect(db.securityAuditLog.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          event_type: "notification.dispatch.sent",
          metadata: expect.objectContaining({ channels_sent: ["webhook"] }),
        }),
      }),
    );
    expect(db.notificationThrottle.deleteMany).not.toHaveBeenCalled();
  });

  it("releases the throttle claim when the audience resolves to nobody AND every channel is a legitimate no-op, so a later real occurrence isn't silently suppressed", async () => {
    db.notificationSettings.findUnique.mockResolvedValue(null);
    queryRawClaims(db, true);
    db.roleAssignment.findMany.mockResolvedValue([]);

    await notify(db as unknown as PrismaClient, TYPE, EVENT, {
      channels: { email: stubChannel({ ok: true, noop: true }), webhook: stubChannel({ ok: true, noop: true }) },
    });

    expect(db.notificationThrottle.deleteMany).toHaveBeenCalledWith({
      where: { event_type: TYPE, dedupe_key: `${ORG_ID}:org`, id: "throttle-1" },
    });
    expect(db.securityAuditLog.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ event_type: "notification.dispatch.skipped_no_recipients" }),
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
    expect(db.notificationThrottle.deleteMany).not.toHaveBeenCalled();
  });

  it("includes the organization in every dispatch outcome's audit metadata, not just the notification type - required for a superadmin to tell which tenant a given row is about", async () => {
    stubHappyPath(db);

    await notify(db as unknown as PrismaClient, TYPE, EVENT, {
      channels: { email: stubChannel(), webhook: stubChannel(), in_app: stubChannel() },
    });

    expect(db.securityAuditLog.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          metadata: expect.objectContaining({ organization_id: ORG_ID }),
        }),
      }),
    );
  });

  it("only sends to candidates whose per-user preference has that channel enabled", async () => {
    db.notificationSettings.findUnique.mockResolvedValue(null);
    queryRawClaims(db, true);
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
    queryRawClaims(db, true);
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

  it("releases the throttle claim when every channel fails, so a real later occurrence can still alert", async () => {
    stubHappyPath(db);
    const email = stubChannel({ ok: false, error: "Send failed." });
    const webhook = stubChannel({ ok: false, error: "Send failed." });
    const inApp = stubChannel({ ok: false, error: "Send failed." });

    await notify(db as unknown as PrismaClient, TYPE, EVENT, {
      channels: { email, webhook, in_app: inApp },
    });

    expect(db.notificationThrottle.deleteMany).toHaveBeenCalledWith({
      where: { event_type: TYPE, dedupe_key: `${ORG_ID}:org`, id: "throttle-1" },
    });
  });

  it("keeps the throttle claim when at least one channel succeeded despite another failing, so already-delivered channels don't resend/spam next occurrence", async () => {
    stubHappyPath(db);
    const email = stubChannel({ ok: false, error: "Send failed." });

    await notify(db as unknown as PrismaClient, TYPE, EVENT, {
      channels: { email, webhook: stubChannel(), in_app: stubChannel() },
    });

    expect(db.notificationThrottle.deleteMany).not.toHaveBeenCalled();
  });

  it("keeps the throttle claim AND records the failure for a channel that reports a partial delivery (ok:true with error set)", async () => {
    stubHappyPath(db);
    // A channel fanning out to multiple recipients (EmailChannel) reports this shape when some,
    // but not all, recipients received it - a real delivery, not a clean success.
    const email = stubChannel({ ok: true, error: "1/2 recipients failed: Send failed." });

    await notify(db as unknown as PrismaClient, TYPE, EVENT, {
      channels: { email, webhook: stubChannel(), in_app: stubChannel() },
    });

    expect(db.notificationThrottle.deleteMany).not.toHaveBeenCalled();
    expect(db.securityAuditLog.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          event_type: "notification.dispatch.failed",
          metadata: expect.objectContaining({
            channels_sent: expect.arrayContaining(["email"]),
            failures: [{ channel: "email", error: "1/2 recipients failed: Send failed." }],
          }),
        }),
      }),
    );
  });

  it("preserves an already-successful webhook delivery when resolving per-user channel preferences fails afterward", async () => {
    stubHappyPath(db);
    db.notificationPreference.findMany.mockRejectedValue(new Error("connection reset"));
    const webhook = stubChannel();

    await notify(db as unknown as PrismaClient, TYPE, EVENT, {
      channels: { webhook, email: stubChannel(), in_app: stubChannel() },
    });

    expect(webhook.send).toHaveBeenCalled();
    // The webhook's own success must not be lost just because a later, unrelated step
    // (resolving per-user email/in_app preferences) threw - releasing here would let the
    // already-delivered webhook resend/spam on the next occurrence.
    expect(db.notificationThrottle.deleteMany).not.toHaveBeenCalled();
    expect(db.securityAuditLog.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          event_type: "notification.dispatch.failed",
          metadata: expect.objectContaining({
            channels_sent: expect.arrayContaining(["webhook"]),
            failures: expect.arrayContaining([
              { channel: "email", error: expect.any(String) },
              { channel: "in_app", error: expect.any(String) },
            ]),
          }),
        }),
      }),
    );
  });

  it("does not report an org-disabled channel as failed when resolving per-user channel preferences fails", async () => {
    stubHappyPath(db);
    db.notificationSettings.findUnique.mockResolvedValue({ disabled_channels: { [TYPE]: ["in_app"] } });
    db.notificationPreference.findMany.mockRejectedValue(new Error("connection reset"));
    const webhook = stubChannel();

    await notify(db as unknown as PrismaClient, TYPE, EVENT, {
      channels: { webhook, email: stubChannel(), in_app: stubChannel() },
    });

    expect(db.securityAuditLog.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          event_type: "notification.dispatch.failed",
          // in_app was never going to be attempted (org-disabled) - only email, which genuinely
          // couldn't be resolved, is reported. Reporting in_app too would misleadingly suggest a
          // real delivery attempt failed on a channel the organization intentionally turned off.
          metadata: expect.objectContaining({
            failures: [{ channel: "email", error: expect.any(String) }],
          }),
        }),
      }),
    );
  });

  it("still attempts the email channel for a configured team distro when resolving per-user preferences fails, since extra_email_recipients doesn't depend on them", async () => {
    stubHappyPath(db);
    db.notificationPreference.findMany.mockRejectedValue(new Error("connection reset"));
    const email = stubChannel(); // includeExtraRecipients is true for org-staff types (TYPE)

    await notify(db as unknown as PrismaClient, TYPE, EVENT, {
      channels: { email, webhook: stubChannel({ ok: true, noop: true }), in_app: stubChannel() },
    });

    // Called with an empty recipient list (personal preferences couldn't be resolved), not
    // skipped outright - EmailChannel itself still queries extra_email_recipients internally.
    expect(email.send).toHaveBeenCalledWith(expect.anything(), []);
  });

  it("dispatches channels concurrently - the in-app write completes without waiting for a slow email provider", async () => {
    stubHappyPath(db);
    let resolveEmail: (value: { ok: boolean }) => void = () => undefined;
    const emailPromise = new Promise<{ ok: boolean }>((resolve) => {
      resolveEmail = resolve;
    });
    const email: NotificationChannel = { channel: "email", send: vi.fn(() => emailPromise) };
    let inAppSettled = false;
    const inApp: NotificationChannel = {
      channel: "in_app",
      send: vi.fn(async () => {
        inAppSettled = true;
        return { ok: true };
      }),
    };

    const notifyPromise = notify(db as unknown as PrismaClient, TYPE, EVENT, {
      channels: { email, webhook: stubChannel(), in_app: inApp },
    });

    // Flush the microtask/macrotask queue without ever resolving email - if channels were
    // still dispatched sequentially, in-app would never get a chance to run at this point.
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(inAppSettled).toBe(true);

    resolveEmail({ ok: true });
    await notifyPromise;
  });

  it("keeps a sibling channel's already-recorded success even when another channel rejects instead of resolving (violating its own 'never throws' contract)", async () => {
    stubHappyPath(db);
    const webhook = stubChannel(); // resolves fine, should still count as delivered
    const email: NotificationChannel = {
      channel: "email",
      send: vi.fn().mockRejectedValue(new Error("adapter bug: rejected instead of resolving")),
    };

    await expect(
      notify(db as unknown as PrismaClient, TYPE, EVENT, {
        channels: { webhook, email, in_app: stubChannel() },
      }),
    ).resolves.toBeUndefined();

    expect(db.notificationThrottle.deleteMany).not.toHaveBeenCalled();
    expect(db.securityAuditLog.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          event_type: "notification.dispatch.failed",
          metadata: expect.objectContaining({
            channels_sent: expect.arrayContaining(["webhook"]),
            failures: expect.arrayContaining([{ channel: "email", error: expect.any(String) }]),
          }),
        }),
      }),
    );
  });

  it("releases exactly the throttle row this attempt claimed, threading claimThrottleSlot's returned id through to the delete filter", async () => {
    stubHappyPath(db);
    db.$queryRaw.mockResolvedValue([{ id: "row-xyz-42" }]);
    db.roleAssignment.findMany.mockResolvedValue([]); // -> empty audience, and every channel noops -> a release

    await notify(db as unknown as PrismaClient, TYPE, EVENT, {
      channels: { email: stubChannel({ ok: true, noop: true }) },
    });

    expect(db.notificationThrottle.deleteMany).toHaveBeenCalledWith({
      where: { event_type: TYPE, dedupe_key: `${ORG_ID}:org`, id: "row-xyz-42" },
    });
  });

  it("records a fully-empty dispatch (every channel a legitimate noop) as skipped, not sent, and releases the throttle claim", async () => {
    stubHappyPath(db);
    const email = stubChannel({ ok: true, noop: true });
    const webhook = stubChannel({ ok: true, noop: true });
    const inApp = stubChannel({ ok: true, noop: true });

    await notify(db as unknown as PrismaClient, TYPE, EVENT, {
      channels: { email, webhook, in_app: inApp },
    });

    expect(db.securityAuditLog.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          event_type: "notification.dispatch.skipped_no_recipients",
        }),
      }),
    );
    expect(db.securityAuditLog.create).not.toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ event_type: "notification.dispatch.sent" }),
      }),
    );
    expect(db.notificationThrottle.deleteMany).toHaveBeenCalledWith({
      where: { event_type: TYPE, dedupe_key: `${ORG_ID}:org`, id: "throttle-1" },
    });
  });

  it("releases the throttle claim when an unexpected exception happens after the claim succeeded", async () => {
    stubHappyPath(db);
    db.roleAssignment.findMany.mockRejectedValue(new Error("connection reset"));

    await expect(
      notify(db as unknown as PrismaClient, TYPE, EVENT, { channels: { email: stubChannel() } }),
    ).resolves.toBeUndefined();

    expect(db.notificationThrottle.deleteMany).toHaveBeenCalledWith({
      where: { event_type: TYPE, dedupe_key: `${ORG_ID}:org`, id: "throttle-1" },
    });
  });

  it("does not attempt to release the throttle when the exception happens before a claim was made", async () => {
    db.notificationSettings.findUnique.mockRejectedValue(new Error("connection reset"));

    await expect(
      notify(db as unknown as PrismaClient, TYPE, EVENT, { channels: { email: stubChannel() } }),
    ).resolves.toBeUndefined();

    expect(db.notificationThrottle.deleteMany).not.toHaveBeenCalled();
  });

  it("does not throw when the release matches nothing (deleteMany resolves count: 0, e.g. a later claim already superseded this row)", async () => {
    stubHappyPath(db);
    db.roleAssignment.findMany.mockResolvedValue([]); // -> empty audience, every channel noops -> a release
    db.notificationThrottle.deleteMany.mockResolvedValue({ count: 0 });

    await expect(
      notify(db as unknown as PrismaClient, TYPE, EVENT, {
        channels: { email: stubChannel({ ok: true, noop: true }) },
      }),
    ).resolves.toBeUndefined();
    expect(db.notificationThrottle.deleteMany).toHaveBeenCalled();
  });

  it("does not throw when the release fails with a real (non-P2025) error", async () => {
    stubHappyPath(db);
    db.roleAssignment.findMany.mockResolvedValue([]); // -> empty audience, every channel noops -> a release
    db.notificationThrottle.deleteMany.mockRejectedValue(new Error("connection reset"));

    await expect(
      notify(db as unknown as PrismaClient, TYPE, EVENT, {
        channels: { email: stubChannel({ ok: true, noop: true }) },
      }),
    ).resolves.toBeUndefined();
    expect(db.notificationThrottle.deleteMany).toHaveBeenCalled();
  });

  it("passes title/body/metadata through unchanged - notify()'s only real caller is our own developer-authored templates, not free-form text", async () => {
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
      { ...EVENT, body: "admin@example.com signed in from FR.", metadata: { country: "FR" } },
      { channels: { email } },
    );

    expect(captured?.body).toBe("admin@example.com signed in from FR.");
    expect(captured?.metadata).toEqual({ country: "FR" });
  });

  it("never throws even when every DB call rejects", async () => {
    db.notificationSettings.findUnique.mockRejectedValue(new Error("connection reset"));

    await expect(notify(db as unknown as PrismaClient, TYPE, EVENT)).resolves.toBeUndefined();
  });

  it("never throws when a non-Error value is thrown", async () => {
    db.notificationSettings.findUnique.mockRejectedValue("connection reset");

    await expect(notify(db as unknown as PrismaClient, TYPE, EVENT)).resolves.toBeUndefined();
  });

  it("propagates a throttle-claim query failure into the outer catch, never to the caller", async () => {
    db.notificationSettings.findUnique.mockResolvedValue(null);
    db.$queryRaw.mockRejectedValue(new Error("connection reset"));
    const email = stubChannel();

    await expect(
      notify(db as unknown as PrismaClient, TYPE, EVENT, { channels: { email } }),
    ).resolves.toBeUndefined();

    expect(email.send).not.toHaveBeenCalled();
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
    queryRawClaims(db, true);
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
