import { describe, expect, it, vi, afterEach, beforeEach } from "vitest";
import type { PrismaClient } from "@admitto/db";

const { notify } = vi.hoisted(() => ({ notify: vi.fn(async () => undefined) }));
vi.mock("@admitto/notifications", () => ({ notify }));

import {
  emitAuditEvent,
  fingerprint,
  logAccessDenied,
  logAuthSettingsChanged,
  logLoginFailure,
  logLoginNewCountry,
  logLoginSuccess,
  logLogout,
  logMfaBreakGlass,
  logMfaBreakGlassCli,
  logMfaFailure,
  logMfaRecoveryConsumed,
  logMfaSuccess,
  notifyOwnAuthFactorChanged,
  logOidcLoginSuccess,
  logOidcSuperadminRevokeBlocked,
  logRateLimitExceeded,
  logRepeatedFailedLogins,
  logRepeatedFailedMfaAttempts,
  logRoleElevated,
  logSuperadminBootstrapCli,
  logTrustedDeviceCreated,
  logTrustedDeviceUsed,
  redactEmail,
} from "../src/audit.js";
import { querySystemLogs, resetSystemLogBufferForTest } from "@admitto/shared/system-log";

const STAFF_SNAPSHOT = { email: "staff@example.com", display_name: "Staff User" };

/** Fake `db` implementing `securityAuditLog.create`, optional `user.findUnique`, and enough of
 * `organization`/`$transaction` for the notify()-dispatch path (dispatchSecurityNotification's
 * resolveInstanceOrganizationId call + its isPlainPrismaClient check) to run for real rather than
 * silently skip - existing tests below never assert on `notify`, so this is a safe default. */
function fakeDb(
  create: ReturnType<typeof vi.fn> = vi.fn().mockResolvedValue({}),
  userSnapshot: { email: string; display_name: string | null } | null = STAFF_SNAPSHOT,
): PrismaClient {
  return {
    securityAuditLog: { create },
    user: { findUnique: vi.fn().mockResolvedValue(userSnapshot) },
    organization: { findUnique: vi.fn().mockResolvedValue({ id: "org_default" }), findFirst: vi.fn() },
    $transaction: vi.fn(),
  } as unknown as PrismaClient;
}

describe("audit", () => {
  beforeEach(() => {
    resetSystemLogBufferForTest();
    notify.mockClear();
    notify.mockResolvedValue(undefined);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("also records into the System logs buffer under the security source", () => {
    vi.spyOn(console, "info").mockImplementation(() => {});
    logRateLimitExceeded({ scope: "login_ip", ip: "10.0.0.1" });
    const entries = querySystemLogs({ source: "security" });
    expect(entries).toHaveLength(1);
    expect(entries[0]?.message).toBe("auth.rate_limit.exceeded");
    expect(entries[0]?.level).toBe("warn");
    expect(entries[0]?.fields).toMatchObject({ scope: "login_ip", ip: "10.0.0.1" });
  });

  it("redacts email local part", () => {
    expect(redactEmail("alice@example.com")).toBe("a***@example.com");
  });

  it("fingerprints values consistently", () => {
    expect(fingerprint("user-123")).toHaveLength(12);
    expect(fingerprint("user-123")).toBe(fingerprint("user-123"));
  });

  it("emitAuditEvent includes ts and event fields", () => {
    const spy = vi.spyOn(console, "info").mockImplementation(() => {});
    emitAuditEvent("test.event", { foo: "bar" });
    expect(spy).toHaveBeenCalledOnce();
    const payload = JSON.parse(String(spy.mock.calls[0]?.[0]));
    expect(payload.event).toBe("test.event");
    expect(payload.foo).toBe("bar");
    expect(payload.ts).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it("emitAuditEvent preserves canonical event and ts when fields collide", () => {
    const spy = vi.spyOn(console, "info").mockImplementation(() => {});
    emitAuditEvent("auth.real.event", {
      event: "auth.spoofed",
      ts: "1970-01-01T00:00:00.000Z",
      scope: "login_ip",
    });
    const payload = JSON.parse(String(spy.mock.calls[0]?.[0]));
    expect(payload.event).toBe("auth.real.event");
    expect(payload.ts).not.toBe("1970-01-01T00:00:00.000Z");
    expect(payload.scope).toBe("login_ip");
  });

  it("emitAuditEvent with quiet:true skips the stdout emit but still records into the System logs buffer", () => {
    const spy = vi.spyOn(console, "info").mockImplementation(() => {});
    emitAuditEvent("test.event", { foo: "bar" }, { quiet: true });
    expect(spy).not.toHaveBeenCalled();
    const entries = querySystemLogs({ source: "security" });
    expect(entries).toHaveLength(1);
    expect(entries[0]?.message).toBe("test.event");
    expect(entries[0]?.fields).toMatchObject({ foo: "bar" });
  });

  it("logRateLimitExceeded records scope and ip", () => {
    const spy = vi.spyOn(console, "info").mockImplementation(() => {});
    logRateLimitExceeded({ scope: "login_ip", ip: "10.0.0.1" });
    const payload = JSON.parse(String(spy.mock.calls[0]?.[0]));
    expect(payload.event).toBe("auth.rate_limit.exceeded");
    expect(payload.scope).toBe("login_ip");
    expect(payload.ip).toBe("10.0.0.1");
  });

  describe("logLoginSuccess", () => {
    it("records a successful event at info level in the System logs buffer", async () => {
      vi.spyOn(console, "info").mockImplementation(() => {});
      await logLoginSuccess(fakeDb(), { email: "bob@example.com", ip: "1.2.3.4", userId: "user-1" });
      const entries = querySystemLogs({ source: "security" });
      expect(entries).toHaveLength(1);
      expect(entries[0]?.level).toBe("info");
    });

    it("logs the full email to stdout and includes ts", async () => {
      const spy = vi.spyOn(console, "info").mockImplementation(() => {});
      await logLoginSuccess(fakeDb(), { email: "bob@example.com", ip: "1.2.3.4", userId: "user-1" });
      const payload = JSON.parse(String(spy.mock.calls[0]?.[0]));
      expect(payload.event).toBe("auth.login.success");
      expect(payload.email).toBe("bob@example.com");
      expect(payload.ip).toBe("1.2.3.4");
      expect(payload.ts).toBeDefined();
    });

    it("persists a durable SecurityAuditLog row with the resolved user id", async () => {
      vi.spyOn(console, "info").mockImplementation(() => {});
      const create = vi.fn().mockResolvedValue({});
      await logLoginSuccess(
        fakeDb(create, { email: "bob@example.com", display_name: null }),
        {
          email: "bob@example.com",
          ip: "1.2.3.4",
          userAgent: "curl/8.0",
          userId: "user-1",
        },
      );
      expect(create).toHaveBeenCalledWith({
        data: {
          event_type: "auth.login.success",
          user_id: "user-1",
          user_email: "bob@example.com",
          user_display_name: null,
          ip: "1.2.3.4",
          actor_timezone: null,
          metadata: { userAgent: "curl/8.0", method: "manual" },
        },
      });
    });

    it("defaults to method \"manual\" when the caller doesn't specify one, and records \"passkey\" when it does", async () => {
      vi.spyOn(console, "info").mockImplementation(() => {});
      const create = vi.fn().mockResolvedValue({});
      await logLoginSuccess(fakeDb(create, { email: "bob@example.com", display_name: null }), {
        email: "bob@example.com",
        userId: "user-1",
        method: "passkey",
      });
      expect(create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ metadata: expect.objectContaining({ method: "passkey" }) }),
        }),
      );
    });

    it("persists actor_timezone when the login context carries a browser zone", async () => {
      vi.spyOn(console, "info").mockImplementation(() => {});
      const create = vi.fn().mockResolvedValue({});
      await logLoginSuccess(
        fakeDb(create, { email: "bob@example.com", display_name: null }),
        {
          email: "bob@example.com",
          userId: "user-1",
          timezone: "Europe/Warsaw",
        },
      );
      expect(create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ actor_timezone: "Europe/Warsaw" }),
        }),
      );
    });

    it("persists null snapshot columns when the user lookup fails", async () => {
      vi.spyOn(console, "info").mockImplementation(() => {});
      const create = vi.fn().mockResolvedValue({});
      const findUnique = vi.fn().mockRejectedValue(new Error("db unavailable"));
      const db = {
        securityAuditLog: { create },
        user: { findUnique },
      } as unknown as PrismaClient;
      await logLoginSuccess(db, { email: "bob@example.com", userId: "user-1" });
      expect(create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            user_email: null,
            user_display_name: null,
          }),
        }),
      );
    });

    it("logs an error and does not throw when persistence fails (login must not be blocked)", async () => {
      vi.spyOn(console, "info").mockImplementation(() => {});
      const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
      const create = vi.fn().mockRejectedValue(new Error("connection lost"));
      await expect(
        logLoginSuccess(fakeDb(create), { email: "bob@example.com", userId: "user-1" }),
      ).resolves.toBeUndefined();
      expect(errorSpy).toHaveBeenCalledOnce();
      const payload = JSON.parse(String(errorSpy.mock.calls[0]?.[0]));
      expect(payload.event).toBe("auth.security_audit_log.write_failed");
      expect(payload.target_event).toBe("auth.login.success");
    });

    it("stringifies a non-Error rejection instead of reading .message off it", async () => {
      vi.spyOn(console, "info").mockImplementation(() => {});
      const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
      // Not every rejection is a real Error instance (e.g. some driver-level failures) -
      // the catch handler falls back to String(err) rather than assuming `.message` exists.
      const create = vi.fn().mockRejectedValue("connection reset");
      await expect(
        logLoginSuccess(fakeDb(create), { email: "bob@example.com", userId: "user-1" }),
      ).resolves.toBeUndefined();
      const payload = JSON.parse(String(errorSpy.mock.calls[0]?.[0]));
      expect(payload.error).toBe("connection reset");
    });
  });

  describe("logLoginFailure", () => {
    it("emits a redacted email in stdout / System-log (operational logs stay redacted)", async () => {
      const spy = vi.spyOn(console, "info").mockImplementation(() => {});
      await logLoginFailure(fakeDb(), { email: "bob@example.com", ip: "1.2.3.4" }, "invalid_credentials");
      const payload = JSON.parse(String(spy.mock.calls[0]?.[0]));
      expect(payload.event).toBe("auth.login.fail");
      expect(payload.email).toBe("b***@example.com");
      expect(JSON.stringify(payload)).not.toContain("bob@example.com");

      const entries = querySystemLogs({ source: "security" });
      expect(
        entries.some((e) => e.message === "auth.login.fail" && e.fields?.email === "b***@example.com"),
      ).toBe(true);
    });

    it("persists a durable row with user_id null (never resolved against a real account) and the full attempted email in metadata", async () => {
      vi.spyOn(console, "info").mockImplementation(() => {});
      const create = vi.fn().mockResolvedValue({});
      await logLoginFailure(fakeDb(create), { email: "bob@example.com", ip: "1.2.3.4" }, "invalid_credentials");
      expect(create).toHaveBeenCalledWith({
        data: {
          event_type: "auth.login.fail",
          user_id: null,
          user_email: null,
          user_display_name: null,
          ip: "1.2.3.4",
          actor_timezone: null,
          metadata: { email: "bob@example.com", reason: "invalid_credentials", userAgent: null },
        },
      });
    });

    it("distinguishes a deactivated account from invalid credentials via the reason field, without changing the event shape otherwise", async () => {
      vi.spyOn(console, "info").mockImplementation(() => {});
      const create = vi.fn().mockResolvedValue({});
      await logLoginFailure(fakeDb(create), { email: "bob@example.com", ip: "1.2.3.4" }, "inactive");
      expect(create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            event_type: "auth.login.fail",
            metadata: { email: "bob@example.com", reason: "inactive", userAgent: null },
          }),
        }),
      );
    });
  });

  describe("logMfaSuccess", () => {
    it("fingerprints user id without raw uuid in the stdout emit", async () => {
      const spy = vi.spyOn(console, "info").mockImplementation(() => {});
      const userId = "550e8400-e29b-41d4-a716-446655440000";
      await logMfaSuccess(fakeDb(), { userId, sessionId: "sess-1" }, "totp");
      const payload = JSON.parse(String(spy.mock.calls[0]?.[0]));
      expect(payload.event).toBe("auth.mfa.success");
      expect(payload.user_fingerprint).toBe(fingerprint(userId));
      expect(JSON.stringify(payload)).not.toContain(userId);
    });

    it("persists the raw user id (queryable/joinable, unlike the stdout fingerprint)", async () => {
      vi.spyOn(console, "info").mockImplementation(() => {});
      const create = vi.fn().mockResolvedValue({});
      const userId = "550e8400-e29b-41d4-a716-446655440000";
      await logMfaSuccess(fakeDb(create), { userId, sessionId: "sess-1", ip: "1.2.3.4" }, "totp");
      expect(create).toHaveBeenCalledWith({
        data: {
          event_type: "auth.mfa.success",
          user_id: userId,
          user_email: STAFF_SNAPSHOT.email,
          user_display_name: STAFF_SNAPSHOT.display_name,
          ip: "1.2.3.4",
          actor_timezone: null,
          metadata: { sessionId: "sess-1", method: "totp", userAgent: null },
        },
      });
    });

    it("persists sessionId null when the caller has no session id", async () => {
      vi.spyOn(console, "info").mockImplementation(() => {});
      const create = vi.fn().mockResolvedValue({});
      await logMfaSuccess(fakeDb(create), { userId: "user-1" }, "totp");
      expect(create).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ metadata: expect.objectContaining({ sessionId: null }) }) }),
      );
    });
  });

  describe("logMfaFailure", () => {
    it("persists the raw user id and session id in metadata", async () => {
      vi.spyOn(console, "info").mockImplementation(() => {});
      const create = vi.fn().mockResolvedValue({});
      await logMfaFailure(fakeDb(create), { userId: "user-1", sessionId: "sess-1" }, "invalid_code");
      expect(create).toHaveBeenCalledWith({
        data: {
          event_type: "auth.mfa.fail",
          user_id: "user-1",
          user_email: STAFF_SNAPSHOT.email,
          user_display_name: STAFF_SNAPSHOT.display_name,
          ip: null,
          actor_timezone: null,
          metadata: { sessionId: "sess-1", reason: "invalid_code", method: null, userAgent: null },
        },
      });
    });

    it("persists sessionId null when the caller has no session id", async () => {
      vi.spyOn(console, "info").mockImplementation(() => {});
      const create = vi.fn().mockResolvedValue({});
      await logMfaFailure(fakeDb(create), { userId: "user-1" }, "invalid_code");
      expect(create).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ metadata: expect.objectContaining({ sessionId: null }) }) }),
      );
    });

    it("distinguishes recovery-consume-conflict and session-not-promoted reasons, and records the method for the latter", async () => {
      vi.spyOn(console, "info").mockImplementation(() => {});
      const conflictCreate = vi.fn().mockResolvedValue({});
      await logMfaFailure(fakeDb(conflictCreate), { userId: "user-1" }, "recovery_consume_conflict");
      expect(conflictCreate).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            metadata: expect.objectContaining({ reason: "recovery_consume_conflict", method: null }),
          }),
        }),
      );

      const promotionCreate = vi.fn().mockResolvedValue({});
      await logMfaFailure(fakeDb(promotionCreate), { userId: "user-1" }, "session_not_promoted", "emergency");
      expect(promotionCreate).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            metadata: expect.objectContaining({ reason: "session_not_promoted", method: "emergency" }),
          }),
        }),
      );
    });
  });

  describe("logMfaBreakGlass", () => {
    it("persists the target user id when the caller resolved one, without the target's email", async () => {
      vi.spyOn(console, "info").mockImplementation(() => {});
      const create = vi.fn().mockResolvedValue({});
      await logMfaBreakGlass(fakeDb(create), {
        action: "reset_mfa",
        email: "admin@example.com",
        userId: "user-1",
        ip: "1.2.3.4",
      });
      expect(create).toHaveBeenCalledWith({
        data: {
          event_type: "auth.mfa.break_glass",
          user_id: "user-1",
          user_email: STAFF_SNAPSHOT.email,
          user_display_name: STAFF_SNAPSHOT.display_name,
          ip: "1.2.3.4",
          actor_timezone: null,
          metadata: { action: "reset_mfa" },
        },
      });
    });

    it("persists user_id null when no target user id is available", async () => {
      vi.spyOn(console, "info").mockImplementation(() => {});
      const create = vi.fn().mockResolvedValue({});
      await logMfaBreakGlass(fakeDb(create), { action: "reset_mfa", email: "admin@example.com" });
      expect(create).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ user_id: null }) }),
      );
    });

    it("emits the JSON payload to stdout by default (server runtime / log collector callers)", async () => {
      const spy = vi.spyOn(console, "info").mockImplementation(() => {});
      await logMfaBreakGlass(fakeDb(), { action: "reset_mfa", email: "admin@example.com", userId: "user-1" });
      expect(spy).toHaveBeenCalledOnce();
      const payload = JSON.parse(String(spy.mock.calls[0]?.[0]));
      expect(payload.event).toBe("auth.mfa.break_glass");
      expect(payload.action).toBe("reset_mfa");
      expect(payload.email).toBe("admin@example.com");
    });

    it("quiet:true skips the stdout JSON (break-glass CLI commands print their own result line) but still persists the durable row", async () => {
      const spy = vi.spyOn(console, "info").mockImplementation(() => {});
      const create = vi.fn().mockResolvedValue({});
      await logMfaBreakGlass(fakeDb(create), {
        action: "generate_emergency_recovery",
        email: "admin@example.com",
        userId: "user-1",
        quiet: true,
      });
      expect(spy).not.toHaveBeenCalled();
      expect(create).toHaveBeenCalledWith({
        data: {
          event_type: "auth.mfa.break_glass",
          user_id: "user-1",
          user_email: STAFF_SNAPSHOT.email,
          user_display_name: STAFF_SNAPSHOT.display_name,
          ip: null,
          actor_timezone: null,
          metadata: { action: "generate_emergency_recovery" },
        },
      });
    });

    it("dispatches a real notification, deduped on the admin who performed break-glass", async () => {
      vi.spyOn(console, "info").mockImplementation(() => {});
      const db = fakeDb();
      await logMfaBreakGlass(db, { action: "reset_mfa", email: "admin@example.com", userId: "user-1" });
      // Awaited by logMfaBreakGlass itself, unlike the other two dispatch call sites - its only
      // real caller runs inside a one-shot CLI process that disconnects right after it returns
      // (see dispatchSecurityNotification's own doc comment) - so the mock call has already
      // landed by the time the await above resolves; no vi.waitFor needed.
      expect(notify).toHaveBeenCalledWith(
        db,
        "auth.mfa.break_glass",
        expect.objectContaining({
          organizationId: "org_default",
          dedupeKey: "user-1",
          body: expect.stringContaining("Staff User"),
          metadata: { action: "reset_mfa" },
        }),
      );
    });

    it("falls back to a generic phrase naming the raw action for an unrecognized break-glass action", async () => {
      vi.spyOn(console, "info").mockImplementation(() => {});
      const db = fakeDb();
      await logMfaBreakGlass(db, { action: "some_future_action", email: "admin@example.com", userId: "user-1" });
      expect(notify).toHaveBeenCalledWith(
        db,
        "auth.mfa.break_glass",
        expect.objectContaining({ body: expect.stringContaining("some_future_action") }),
      );
    });

    it("falls back to the email as dedupeKey when no target user id was resolved", async () => {
      vi.spyOn(console, "info").mockImplementation(() => {});
      const db = fakeDb();
      await logMfaBreakGlass(db, { action: "reset_mfa", email: "admin@example.com" });
      expect(notify).toHaveBeenCalledWith(
        db,
        "auth.mfa.break_glass",
        expect.objectContaining({ dedupeKey: "admin@example.com" }),
      );
    });

    it("skips notify() (without throwing) when db is a transaction client, not a plain PrismaClient", async () => {
      vi.spyOn(console, "info").mockImplementation(() => {});
      const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
      const create = vi.fn().mockResolvedValue({});
      // A real Prisma.TransactionClient has no $transaction of its own (can't nest transactions).
      const tx = {
        securityAuditLog: { create },
        user: { findUnique: vi.fn().mockResolvedValue(STAFF_SNAPSHOT) },
      } as unknown as PrismaClient;
      await logMfaBreakGlass(tx, { action: "reset_mfa", email: "admin@example.com", userId: "user-1" });
      expect(create).toHaveBeenCalledOnce();
      expect(notify).not.toHaveBeenCalled();
      expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining("auth.notify_dispatch_skipped_transaction_client"));
    });
  });

  describe("logMfaBreakGlassCli", () => {
    it("never prints the stdout JSON, unlike logMfaBreakGlass's own default", async () => {
      const spy = vi.spyOn(console, "info").mockImplementation(() => {});
      await logMfaBreakGlassCli(fakeDb(), { action: "reset_mfa", email: "admin@example.com", userId: "user-1" });
      expect(spy).not.toHaveBeenCalled();
    });

    it("still persists the durable SecurityAuditLog row", async () => {
      vi.spyOn(console, "info").mockImplementation(() => {});
      const create = vi.fn().mockResolvedValue({});
      await logMfaBreakGlassCli(fakeDb(create), {
        action: "generate_emergency_recovery",
        email: "admin@example.com",
        userId: "user-1",
        ip: "1.2.3.4",
      });
      expect(create).toHaveBeenCalledWith({
        data: {
          event_type: "auth.mfa.break_glass",
          user_id: "user-1",
          user_email: STAFF_SNAPSHOT.email,
          user_display_name: STAFF_SNAPSHOT.display_name,
          ip: "1.2.3.4",
          actor_timezone: null,
          metadata: { action: "generate_emergency_recovery" },
        },
      });
    });

  });

  describe("notifyOwnAuthFactorChanged", () => {
    // Used by the CLI break-glass MFA reset commands (packages/auth/src/cli.ts,
    // apps/cli/src/commands/auth.ts), which bypass every HTTP route apps/web wires this
    // notification into (bot review finding, PR #1308) - see this function's own doc comment.
    it("dispatches account.auth_factor.changed targeting and deduped on the given user, not the acting operator", async () => {
      const db = fakeDb();
      await notifyOwnAuthFactorChanged(db, "user-1", "Your two-factor authentication was reset", "body text");
      expect(notify).toHaveBeenCalledWith(
        db,
        "account.auth_factor.changed",
        expect.objectContaining({
          organizationId: "org_default",
          title: "Your two-factor authentication was reset",
          body: "body text",
          targetUserId: "user-1",
          dedupeKey: "user-1",
        }),
      );
    });

    it("skips notify() (without throwing) when db is a transaction client, not a plain PrismaClient", async () => {
      const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
      const tx = { user: { findUnique: vi.fn() } } as unknown as PrismaClient;
      await notifyOwnAuthFactorChanged(tx, "user-1", "title", "body");
      expect(notify).not.toHaveBeenCalled();
      expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining("auth.notify_dispatch_skipped_transaction_client"));
    });
  });

  describe("logSuperadminBootstrapCli", () => {
    // Kept as its own event type, not folded into auth.mfa.break_glass like reset_mfa/
    // generate_emergency_recovery - see the doc comment on logSuperadminBootstrapCli for why
    // (AuditLogPanel.tsx labels/filters purely off event_type, and minting a brand-new
    // superadmin is materially different from an MFA break-glass action on an existing account).
    it("records auth.superadmin.bootstrap, distinct from auth.mfa.break_glass", async () => {
      vi.spyOn(console, "info").mockImplementation(() => {});
      const create = vi.fn().mockResolvedValue({});
      await logSuperadminBootstrapCli(fakeDb(create), {
        email: "admin@example.com",
        userId: "user-1",
      });
      expect(create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            event_type: "auth.superadmin.bootstrap",
            user_id: "user-1",
            metadata: {},
          }),
        }),
      );
    });

    it("is quiet (no raw stdout emit), matching every other break-glass CLI audit call", async () => {
      const infoSpy = vi.spyOn(console, "info").mockImplementation(() => {});
      await logSuperadminBootstrapCli(fakeDb(), { email: "admin@example.com", userId: "user-1" });
      expect(infoSpy).not.toHaveBeenCalled();
    });

    it("propagates a persistence failure instead of swallowing it like writeSecurityAuditLog", async () => {
      vi.spyOn(console, "info").mockImplementation(() => {});
      const create = vi.fn().mockRejectedValue(new Error("db down"));
      await expect(
        logSuperadminBootstrapCli(fakeDb(create), { email: "admin@example.com", userId: "user-1" }),
      ).rejects.toThrow("db down");
    });
  });

  describe("logMfaRecoveryConsumed", () => {
    it("persists the recovery method and session id in metadata", async () => {
      vi.spyOn(console, "info").mockImplementation(() => {});
      const create = vi.fn().mockResolvedValue({});
      await logMfaRecoveryConsumed(fakeDb(create), { userId: "user-1", sessionId: "sess-1" }, "backup");
      expect(create).toHaveBeenCalledWith({
        data: {
          event_type: "auth.mfa.recovery_consumed",
          user_id: "user-1",
          user_email: STAFF_SNAPSHOT.email,
          user_display_name: STAFF_SNAPSHOT.display_name,
          ip: null,
          actor_timezone: null,
          metadata: { method: "backup", sessionId: "sess-1" },
        },
      });
    });

    it("persists sessionId null when the caller has no session id", async () => {
      vi.spyOn(console, "info").mockImplementation(() => {});
      const create = vi.fn().mockResolvedValue({});
      await logMfaRecoveryConsumed(fakeDb(create), { userId: "user-1" }, "backup");
      expect(create).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ metadata: expect.objectContaining({ sessionId: null }) }) }),
      );
    });
  });

  describe("logLogout", () => {
    it("persists the user and session id", async () => {
      vi.spyOn(console, "info").mockImplementation(() => {});
      const create = vi.fn().mockResolvedValue({});
      await logLogout(fakeDb(create), { userId: "user-1", sessionId: "sess-1", ip: "1.2.3.4" });
      expect(create).toHaveBeenCalledWith({
        data: {
          event_type: "auth.logout",
          user_id: "user-1",
          user_email: STAFF_SNAPSHOT.email,
          user_display_name: STAFF_SNAPSHOT.display_name,
          ip: "1.2.3.4",
          actor_timezone: null,
          metadata: { sessionId: "sess-1" },
        },
      });
    });

    it("persists ip null when the caller has no ip", async () => {
      vi.spyOn(console, "info").mockImplementation(() => {});
      const create = vi.fn().mockResolvedValue({});
      await logLogout(fakeDb(create), { userId: "user-1", sessionId: "sess-1" });
      expect(create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ ip: null }) }));
    });
  });

  describe("logOidcLoginSuccess", () => {
    it("persists the provider id and subject in metadata", async () => {
      vi.spyOn(console, "info").mockImplementation(() => {});
      const create = vi.fn().mockResolvedValue({});
      await logOidcLoginSuccess(fakeDb(create), {
        providerId: "prov-1",
        userId: "user-1",
        subject: "sub-1",
        ip: "1.2.3.4",
      });
      expect(create).toHaveBeenCalledWith({
        data: {
          event_type: "auth.oidc.success",
          user_id: "user-1",
          user_email: STAFF_SNAPSHOT.email,
          user_display_name: STAFF_SNAPSHOT.display_name,
          ip: "1.2.3.4",
          actor_timezone: null,
          metadata: { providerId: "prov-1", subject: "sub-1" },
        },
      });
    });

    it("persists ip and subject null when the caller has neither", async () => {
      vi.spyOn(console, "info").mockImplementation(() => {});
      const create = vi.fn().mockResolvedValue({});
      await logOidcLoginSuccess(fakeDb(create), { providerId: "prov-1", userId: "user-1" });
      expect(create).toHaveBeenCalledWith({
        data: {
          event_type: "auth.oidc.success",
          user_id: "user-1",
          user_email: STAFF_SNAPSHOT.email,
          user_display_name: STAFF_SNAPSHOT.display_name,
          ip: null,
          actor_timezone: null,
          metadata: { providerId: "prov-1", subject: null },
        },
      });
    });
  });

  describe("logOidcSuperadminRevokeBlocked", () => {
    it("persists the provider id in metadata", async () => {
      vi.spyOn(console, "info").mockImplementation(() => {});
      const create = vi.fn().mockResolvedValue({});
      await logOidcSuperadminRevokeBlocked(fakeDb(create), { providerId: "prov-1", userId: "user-1" });
      expect(create).toHaveBeenCalledWith({
        data: {
          event_type: "auth.oidc.superadmin_revoke_blocked",
          user_id: "user-1",
          user_email: STAFF_SNAPSHOT.email,
          user_display_name: STAFF_SNAPSHOT.display_name,
          ip: null,
          actor_timezone: null,
          metadata: { providerId: "prov-1" },
        },
      });
    });
  });

  describe("logAccessDenied", () => {
    it("persists the resolved user id when a session is present", async () => {
      vi.spyOn(console, "info").mockImplementation(() => {});
      const create = vi.fn().mockResolvedValue({});
      await logAccessDenied(fakeDb(create), {
        path: "/api/admin/users",
        reason: "no_superadmin_role",
        authSource: "session",
        userId: "user-1",
        ip: "1.2.3.4",
      });
      expect(create).toHaveBeenCalledWith({
        data: {
          event_type: "auth.access.denied",
          user_id: "user-1",
          user_email: STAFF_SNAPSHOT.email,
          user_display_name: STAFF_SNAPSHOT.display_name,
          ip: "1.2.3.4",
          actor_timezone: null,
          metadata: { path: "/api/admin/users", reason: "no_superadmin_role", authSource: "session" },
        },
      });
    });

    it("persists user_id null when there is no resolvable session", async () => {
      vi.spyOn(console, "info").mockImplementation(() => {});
      const create = vi.fn().mockResolvedValue({});
      await logAccessDenied(fakeDb(create), { path: "/api/admin", reason: "no_session" });
      expect(create).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ user_id: null, ip: null }) }),
      );
    });
  });

  describe("logTrustedDeviceCreated", () => {
    it("fingerprints user and session ids in the stdout emit", async () => {
      const spy = vi.spyOn(console, "info").mockImplementation(() => {});
      const userId = "550e8400-e29b-41d4-a716-446655440000";
      await logTrustedDeviceCreated(fakeDb(), { userId, sessionId: "sess-1", ip: "1.2.3.4" });
      const payload = JSON.parse(String(spy.mock.calls[0]?.[0]));
      expect(payload.event).toBe("auth.trusted_device.created");
      expect(payload.user_fingerprint).toBe(fingerprint(userId));
      expect(JSON.stringify(payload)).not.toContain(userId);
    });

    it("persists the raw user id and session id in metadata", async () => {
      vi.spyOn(console, "info").mockImplementation(() => {});
      const create = vi.fn().mockResolvedValue({});
      await logTrustedDeviceCreated(fakeDb(create), { userId: "user-1", sessionId: "sess-1", ip: "1.2.3.4" });
      expect(create).toHaveBeenCalledWith({
        data: {
          event_type: "auth.trusted_device.created",
          user_id: "user-1",
          user_email: STAFF_SNAPSHOT.email,
          user_display_name: STAFF_SNAPSHOT.display_name,
          ip: "1.2.3.4",
          actor_timezone: null,
          metadata: { sessionId: "sess-1", userAgent: null },
        },
      });
    });

    it("records into the System logs buffer at info level (routine MFA outcome, not a warning)", async () => {
      vi.spyOn(console, "info").mockImplementation(() => {});
      await logTrustedDeviceCreated(fakeDb(), { userId: "user-1" });
      const entries = querySystemLogs({ source: "security" });
      expect(entries[0]?.level).toBe("info");
    });
  });

  describe("logTrustedDeviceUsed", () => {
    it("fingerprints user and session ids in the stdout emit", async () => {
      const spy = vi.spyOn(console, "info").mockImplementation(() => {});
      const userId = "550e8400-e29b-41d4-a716-446655440000";
      await logTrustedDeviceUsed(fakeDb(), { userId, sessionId: "sess-1", ip: "1.2.3.4" });
      const payload = JSON.parse(String(spy.mock.calls[0]?.[0]));
      expect(payload.event).toBe("auth.trusted_device.used");
      expect(payload.user_fingerprint).toBe(fingerprint(userId));
      expect(JSON.stringify(payload)).not.toContain(userId);
    });

    it("persists the raw user id and session id in metadata", async () => {
      vi.spyOn(console, "info").mockImplementation(() => {});
      const create = vi.fn().mockResolvedValue({});
      await logTrustedDeviceUsed(fakeDb(create), { userId: "user-1", sessionId: "sess-1", ip: "1.2.3.4" });
      expect(create).toHaveBeenCalledWith({
        data: {
          event_type: "auth.trusted_device.used",
          user_id: "user-1",
          user_email: STAFF_SNAPSHOT.email,
          user_display_name: STAFF_SNAPSHOT.display_name,
          ip: "1.2.3.4",
          actor_timezone: null,
          metadata: { sessionId: "sess-1", userAgent: null },
        },
      });
    });

    it("records into the System logs buffer at info level (routine MFA outcome, not a warning)", async () => {
      vi.spyOn(console, "info").mockImplementation(() => {});
      await logTrustedDeviceUsed(fakeDb(), { userId: "user-1" });
      const entries = querySystemLogs({ source: "security" });
      expect(entries[0]?.level).toBe("info");
    });
  });

  describe("logRepeatedFailedLogins", () => {
    it("persists the raw user id and streak in metadata (deliberate exception to enumeration-safety)", async () => {
      vi.spyOn(console, "info").mockImplementation(() => {});
      const create = vi.fn().mockResolvedValue({});
      await logRepeatedFailedLogins(
        fakeDb(create, { email: "admin@example.com", display_name: null }),
        {
          userId: "user-1",
          email: "admin@example.com",
          ip: "1.2.3.4",
          streak: 5,
        },
      );
      expect(create).toHaveBeenCalledWith({
        data: {
          event_type: "auth.login.repeated_failures",
          user_id: "user-1",
          user_email: "admin@example.com",
          user_display_name: null,
          ip: "1.2.3.4",
          actor_timezone: null,
          metadata: { streak: 5 },
        },
      });
    });

    it("records into the System logs buffer at warn level", async () => {
      vi.spyOn(console, "info").mockImplementation(() => {});
      await logRepeatedFailedLogins(fakeDb(), {
        userId: "user-1",
        email: "admin@example.com",
        streak: 5,
      });
      const entries = querySystemLogs({ source: "security" });
      expect(entries[0]?.level).toBe("warn");
      expect(entries[0]?.message).toBe("auth.login.repeated_failures");
    });

    it("dispatches a real notification, deduped on the attacked account's user id", async () => {
      vi.spyOn(console, "info").mockImplementation(() => {});
      const db = fakeDb();
      await logRepeatedFailedLogins(db, { userId: "user-1", email: "admin@example.com", streak: 5 });
      // Fire-and-forget (not awaited by logRepeatedFailedLogins itself, so the failed-login
      // response path never waits on notification delivery - see dispatchSecurityNotification's
      // own doc comment), so the mock call lands a microtask or two after the await above.
      await vi.waitFor(() => {
        expect(notify).toHaveBeenCalledWith(
          db,
          "auth.login.repeated_failures",
          expect.objectContaining({
            organizationId: "org_default",
            dedupeKey: "user-1",
            title: expect.any(String),
            body: expect.stringContaining("admin@example.com"),
            metadata: { streak: 5 },
          }),
        );
      });
    });

    it("does not throw and skips notify() when the instance organization can't be resolved (audit write already happened)", async () => {
      vi.spyOn(console, "info").mockImplementation(() => {});
      const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
      const create = vi.fn().mockResolvedValue({});
      const db = {
        securityAuditLog: { create },
        user: { findUnique: vi.fn().mockResolvedValue(null) },
        organization: { findUnique: vi.fn().mockResolvedValue(null), findFirst: vi.fn().mockResolvedValue(null) },
        $transaction: vi.fn(),
      } as unknown as PrismaClient;
      await expect(
        logRepeatedFailedLogins(db, { userId: "user-1", email: "admin@example.com", streak: 5 }),
      ).resolves.toBeUndefined();
      expect(create).toHaveBeenCalledOnce();
      await vi.waitFor(() => {
        expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining("auth.notify_dispatch_failed"));
      });
      expect(notify).not.toHaveBeenCalled();
    });

    it("stringifies a non-Error organization-resolution failure instead of reading .message off it", async () => {
      vi.spyOn(console, "info").mockImplementation(() => {});
      const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
      const create = vi.fn().mockResolvedValue({});
      const db = {
        securityAuditLog: { create },
        user: { findUnique: vi.fn().mockResolvedValue(null) },
        organization: {
          findUnique: vi.fn().mockRejectedValue("connection reset"),
          findFirst: vi.fn(),
        },
        $transaction: vi.fn(),
      } as unknown as PrismaClient;
      await logRepeatedFailedLogins(db, { userId: "user-1", email: "admin@example.com", streak: 5 });
      await vi.waitFor(() => {
        const payload = JSON.parse(String(errorSpy.mock.calls[0]?.[0]));
        expect(payload.error).toBe("connection reset");
      });
    });
  });

  describe("logRepeatedFailedMfaAttempts", () => {
    it("persists the raw user id and streak in metadata (same shape as logRepeatedFailedLogins)", async () => {
      vi.spyOn(console, "info").mockImplementation(() => {});
      const create = vi.fn().mockResolvedValue({});
      await logRepeatedFailedMfaAttempts(
        fakeDb(create, { email: "admin@example.com", display_name: null }),
        {
          userId: "user-1",
          email: "admin@example.com",
          ip: "1.2.3.4",
          streak: 5,
        },
      );
      expect(create).toHaveBeenCalledWith({
        data: {
          event_type: "auth.mfa.repeated_failures",
          user_id: "user-1",
          user_email: "admin@example.com",
          user_display_name: null,
          ip: "1.2.3.4",
          actor_timezone: null,
          metadata: { streak: 5 },
        },
      });
    });

    it("records into the System logs buffer at warn level", async () => {
      vi.spyOn(console, "info").mockImplementation(() => {});
      await logRepeatedFailedMfaAttempts(fakeDb(), {
        userId: "user-1",
        email: "admin@example.com",
        streak: 5,
      });
      const entries = querySystemLogs({ source: "security" });
      expect(entries[0]?.level).toBe("warn");
      expect(entries[0]?.message).toBe("auth.mfa.repeated_failures");
    });
  });

  describe("logAuthSettingsChanged", () => {
    it("emits the stdout/System-log event unchanged (still not a durable SecurityAuditLog row)", async () => {
      const spy = vi.spyOn(console, "info").mockImplementation(() => {});
      const create = vi.fn();
      await logAuthSettingsChanged(fakeDb(create), {
        actorUserId: "user-1",
        resource: "oidc_provider",
        action: "create",
        targetId: "prov-1",
      });
      expect(create).not.toHaveBeenCalled();
      const payload = JSON.parse(String(spy.mock.calls[0]?.[0]));
      expect(payload.event).toBe("auth.settings.changed");
      expect(payload.resource).toBe("oidc_provider");
      expect(payload.action).toBe("create");
      expect(payload.target_id).toBe("prov-1");
      expect(payload.actor_fingerprint).toBe(fingerprint("user-1"));
    });

    it("dispatches a real notification, deduped on the acting admin, naming them and the resource in the body", async () => {
      vi.spyOn(console, "info").mockImplementation(() => {});
      const db = fakeDb(vi.fn(), { email: "jane@example.com", display_name: "Jane Admin" });
      await logAuthSettingsChanged(db, {
        actorUserId: "user-1",
        resource: "oidc_provider",
        action: "update",
        targetId: "prov-1",
      });
      // Fire-and-forget (not awaited by logAuthSettingsChanged itself, so the PUT response commits
      // its durable AdminAuditLog row before waiting on notification delivery - see
      // dispatchSecurityNotification's own doc comment), so the mock call lands a microtask or two
      // after the await above.
      await vi.waitFor(() => {
        expect(notify).toHaveBeenCalledWith(
          db,
          "auth.settings.changed",
          expect.objectContaining({
            organizationId: "org_default",
            dedupeKey: "user-1",
            body: expect.stringContaining("Jane Admin"),
            metadata: { resource: "oidc_provider", action: "update", target_id: "prov-1", target_label: null },
          }),
        );
      });
    });

    it("falls back to the actor's real (unmasked) email, then a generic label, when no display name/snapshot is available", async () => {
      vi.spyOn(console, "info").mockImplementation(() => {});
      const dbWithEmail = fakeDb(vi.fn(), { email: "jane@example.com", display_name: null });
      await logAuthSettingsChanged(dbWithEmail, {
        actorUserId: "user-1",
        resource: "cf_access",
        action: "update",
      });
      await vi.waitFor(() => {
        expect(notify).toHaveBeenCalledWith(
          dbWithEmail,
          "auth.settings.changed",
          expect.objectContaining({ body: expect.stringContaining("jane@example.com") }),
        );
      });

      notify.mockClear();
      const dbNoSnapshot = fakeDb(vi.fn(), null);
      await logAuthSettingsChanged(dbNoSnapshot, {
        actorUserId: "user-1",
        resource: "cf_access",
        action: "update",
      });
      await vi.waitFor(() => {
        expect(notify).toHaveBeenCalledWith(
          dbNoSnapshot,
          "auth.settings.changed",
          expect.objectContaining({ body: expect.stringContaining("An admin") }),
        );
      });
    });

    it("labels the cf_access resource distinctly from oidc_provider in the notification body", async () => {
      vi.spyOn(console, "info").mockImplementation(() => {});
      const db = fakeDb(vi.fn(), { email: "jane@example.com", display_name: "Jane Admin" });
      await logAuthSettingsChanged(db, { actorUserId: "user-1", resource: "cf_access", action: "update" });
      await vi.waitFor(() => {
        expect(notify).toHaveBeenCalledWith(
          db,
          "auth.settings.changed",
          expect.objectContaining({ body: expect.stringContaining("Cloudflare Access") }),
        );
      });
    });

    it("names the target in both body and metadata when a human-readable targetLabel is given", async () => {
      vi.spyOn(console, "info").mockImplementation(() => {});
      const db = fakeDb(vi.fn(), { email: "jane@example.com", display_name: "Jane Admin" });
      await logAuthSettingsChanged(db, {
        actorUserId: "user-1",
        resource: "oidc_provider",
        action: "disable",
        targetId: "prov-1",
        targetLabel: "Company SSO (Okta)",
      });
      await vi.waitFor(() => {
        expect(notify).toHaveBeenCalledWith(
          db,
          "auth.settings.changed",
          expect.objectContaining({
            body: expect.stringContaining('"Company SSO (Okta)"'),
            metadata: {
              resource: "oidc_provider",
              action: "disable",
              target_id: "prov-1",
              target_label: "Company SSO (Okta)",
            },
          }),
        );
      });
    });

    it("omits the target suffix and stores a null target_label when none is given", async () => {
      vi.spyOn(console, "info").mockImplementation(() => {});
      const db = fakeDb(vi.fn(), { email: "jane@example.com", display_name: "Jane Admin" });
      await logAuthSettingsChanged(db, {
        actorUserId: "user-1",
        resource: "oidc_provider",
        action: "update",
        targetId: "prov-1",
      });
      await vi.waitFor(() => {
        expect(notify).toHaveBeenCalledWith(
          db,
          "auth.settings.changed",
          expect.objectContaining({
            body: "Jane Admin changed SSO provider settings (update).",
            metadata: { resource: "oidc_provider", action: "update", target_id: "prov-1", target_label: null },
          }),
        );
      });
    });
  });

  describe("logRoleElevated", () => {
    /** Distinct actor/target snapshots keyed by user id - fakeDb()'s single fixed snapshot can't
     * tell the two apart, and this function's whole point is naming both correctly. */
    function dbWithDistinctActorAndTarget(): PrismaClient {
      const snapshots: Record<string, { email: string; display_name: string | null }> = {
        "actor-1": { email: "admin@example.com", display_name: "Jane Admin" },
        "target-1": { email: "newadmin@example.com", display_name: "New Admin" },
      };
      return {
        securityAuditLog: { create: vi.fn() },
        user: {
          findUnique: vi.fn(({ where }: { where: { id: string } }) =>
            Promise.resolve(snapshots[where.id] ?? null),
          ),
        },
        organization: { findUnique: vi.fn().mockResolvedValue({ id: "org_default" }), findFirst: vi.fn() },
        $transaction: vi.fn(),
      } as unknown as PrismaClient;
    }

    it("does not write a durable SecurityAuditLog row - already covered by AdminAuditLog, same reasoning as logAuthSettingsChanged", async () => {
      const create = vi.fn();
      await logRoleElevated(fakeDb(create), {
        actorUserId: "user-1",
        targetUserId: "user-2",
        role: "admin",
        scopeType: "organization",
        scopeId: "org-1",
      });
      expect(create).not.toHaveBeenCalled();
    });

    it("dispatches a real notification, deduped on the TARGET account (not the actor), naming both correctly", async () => {
      const db = dbWithDistinctActorAndTarget();
      await logRoleElevated(db, {
        actorUserId: "actor-1",
        targetUserId: "target-1",
        role: "admin",
        scopeType: "organization",
        scopeId: "org-1",
      });
      await vi.waitFor(() => {
        expect(notify).toHaveBeenCalledWith(
          db,
          "auth.role.elevated",
          expect.objectContaining({
            organizationId: "org_default",
            dedupeKey: "target-1",
            body: "Jane Admin granted New Admin the administrator role.",
            metadata: {
              actor_user_id: "actor-1",
              target_user_id: "target-1",
              role: "admin",
              scope_type: "organization",
              scope_id: "org-1",
            },
          }),
        );
      });
    });

    it("labels a superadmin grant distinctly from an admin grant", async () => {
      const db = dbWithDistinctActorAndTarget();
      await logRoleElevated(db, {
        actorUserId: "actor-1",
        targetUserId: "target-1",
        role: "superadmin",
        scopeType: "instance",
        scopeId: null,
      });
      await vi.waitFor(() => {
        expect(notify).toHaveBeenCalledWith(
          db,
          "auth.role.elevated",
          expect.objectContaining({ body: expect.stringContaining("the superadmin role") }),
        );
      });
    });

    it("falls back to generic actor/target labels when no identity snapshot is available for either", async () => {
      const db = fakeDb(vi.fn(), null);
      await logRoleElevated(db, {
        actorUserId: "user-1",
        targetUserId: "user-2",
        role: "admin",
        scopeType: "organization",
        scopeId: "org-1",
      });
      await vi.waitFor(() => {
        expect(notify).toHaveBeenCalledWith(
          db,
          "auth.role.elevated",
          expect.objectContaining({ body: "An admin granted An account the administrator role." }),
        );
      });
    });
  });

  describe("logLoginNewCountry", () => {
    it("records into the System logs buffer at info level (not a failure/denial event)", async () => {
      vi.spyOn(console, "info").mockImplementation(() => {});
      await logLoginNewCountry(fakeDb(), { userId: "user-1", ip: "203.0.113.5", countryCode: "FR" });
      const entries = querySystemLogs({ source: "security" });
      expect(entries[0]?.level).toBe("info");
      expect(entries[0]?.message).toBe("auth.login.new_country");
    });

    it("writes a durable SecurityAuditLog row with the resolved country in metadata", async () => {
      const create = vi.fn().mockResolvedValue({});
      vi.spyOn(console, "info").mockImplementation(() => {});
      // Takes no email - resolves the account's own identity snapshot itself (same db.user.findUnique
      // fakeDb() already stubs for writeSecurityAuditLog's own internal resolution).
      await logLoginNewCountry(fakeDb(create), { userId: "user-1", ip: "203.0.113.5", countryCode: "FR" });
      expect(create).toHaveBeenCalledWith({
        data: {
          event_type: "auth.login.new_country",
          user_id: "user-1",
          user_email: STAFF_SNAPSHOT.email,
          user_display_name: STAFF_SNAPSHOT.display_name,
          ip: "203.0.113.5",
          actor_timezone: null,
          metadata: { country: "FR" },
        },
      });
    });

    it("dispatches a real notification, deduped on the user+country pair, naming the account by its real email", async () => {
      vi.spyOn(console, "info").mockImplementation(() => {});
      const db = fakeDb(vi.fn(), { email: "admin@example.com", display_name: null });
      await logLoginNewCountry(db, { userId: "user-1", ip: "203.0.113.5", countryCode: "FR" });
      await vi.waitFor(() => {
        expect(notify).toHaveBeenCalledWith(
          db,
          "auth.login.new_country",
          expect.objectContaining({
            organizationId: "org_default",
            dedupeKey: "user-1:FR",
            body: expect.stringContaining("admin@example.com"),
            metadata: { country: "FR" },
          }),
        );
      });
    });

    // The account owner already gets their own account.login.new_location alert below - without
    // this, an owner who is themselves an active admin/superadmin (guaranteed by
    // checkNewCountryLogin's hasElevatedRole gate) would also be a candidate for this org-staff
    // dispatch and get a second email/in-app alert about the same login (bot review finding, PR #1309).
    it("excludes the logging-in account itself from the org-staff dispatch's candidates", async () => {
      vi.spyOn(console, "info").mockImplementation(() => {});
      const db = fakeDb();
      await logLoginNewCountry(db, { userId: "user-1", ip: "203.0.113.5", countryCode: "FR" });
      await vi.waitFor(() => {
        expect(notify).toHaveBeenCalledWith(
          db,
          "auth.login.new_country",
          expect.objectContaining({ excludeUserId: "user-1" }),
        );
      });
    });

    it("prefers the account's display name over its email when both are known", async () => {
      vi.spyOn(console, "info").mockImplementation(() => {});
      const db = fakeDb(vi.fn(), { email: "admin@example.com", display_name: "Admin User" });
      await logLoginNewCountry(db, { userId: "user-1", ip: "203.0.113.5", countryCode: "FR" });
      await vi.waitFor(() => {
        expect(notify).toHaveBeenCalledWith(
          db,
          "auth.login.new_country",
          expect.objectContaining({ body: expect.stringContaining("Admin User") }),
        );
      });
    });

    it("falls back to a generic account label when no identity snapshot is available", async () => {
      vi.spyOn(console, "info").mockImplementation(() => {});
      const db = fakeDb(vi.fn(), null);
      await logLoginNewCountry(db, { userId: "user-1", ip: "203.0.113.5", countryCode: "FR" });
      await vi.waitFor(() => {
        expect(notify).toHaveBeenCalledWith(
          db,
          "auth.login.new_country",
          expect.objectContaining({ body: expect.stringContaining("An admin account") }),
        );
      });
    });

    it("does not throw when the instance organization can't be resolved (audit write already happened)", async () => {
      const create = vi.fn().mockResolvedValue({});
      const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
      vi.spyOn(console, "info").mockImplementation(() => {});
      const db = {
        securityAuditLog: { create },
        user: { findUnique: vi.fn().mockResolvedValue(null) },
        organization: { findUnique: vi.fn().mockResolvedValue(null), findFirst: vi.fn().mockResolvedValue(null) },
        $transaction: vi.fn(),
      } as unknown as PrismaClient;
      await expect(
        logLoginNewCountry(db, { userId: "user-1", ip: "203.0.113.5", countryCode: "FR" }),
      ).resolves.toBeUndefined();
      expect(create).toHaveBeenCalledOnce();
      await vi.waitFor(() => {
        expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining("auth.notify_dispatch_failed"));
      });
      expect(notify).not.toHaveBeenCalled();
    });

    // ASVS V2.2.3 self-audience counterpart, alongside the org-staff auth.login.new_country
    // dispatch above - the account OWNER learns their own account signed in somewhere new, not
    // just the rest of the admin team (PR5c, notifications-module-foundation plan's Luka A).
    it("also dispatches account.login.new_location targeting the account owner, deduped on the same user+country pair", async () => {
      vi.spyOn(console, "info").mockImplementation(() => {});
      const db = fakeDb();
      await logLoginNewCountry(db, { userId: "user-1", ip: "203.0.113.5", countryCode: "FR" });
      await vi.waitFor(() => {
        expect(notify).toHaveBeenCalledWith(
          db,
          "account.login.new_location",
          expect.objectContaining({
            organizationId: "org_default",
            targetUserId: "user-1",
            dedupeKey: "user-1:FR",
            body: expect.stringContaining("FR"),
            metadata: { country: "FR" },
          }),
        );
      });
      // Both dispatches happen from one call - not one OR the other.
      expect(notify).toHaveBeenCalledWith(db, "auth.login.new_country", expect.anything());
      // excludeUserId is an org-staff-only concept (dispatcher.ts's resolveCandidatesOrLogSkip
      // ignores it for "self") - this self dispatch never sets it, only the org-staff one above.
      const selfCall = notify.mock.calls.find(([, type]) => type === "account.login.new_location");
      expect(selfCall?.[2]).not.toHaveProperty("excludeUserId");
    });
  });
});
