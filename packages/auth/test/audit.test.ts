import { describe, expect, it, vi, afterEach, beforeEach } from "vitest";
import type { PrismaClient } from "@admitto/db";
import {
  emitAuditEvent,
  fingerprint,
  logAccessDenied,
  logLoginFailure,
  logLoginSuccess,
  logLogout,
  logMfaBreakGlass,
  logMfaBreakGlassCli,
  logMfaFailure,
  logMfaRecoveryConsumed,
  logMfaSuccess,
  logOidcLoginSuccess,
  logOidcSuperadminRevokeBlocked,
  logRateLimitExceeded,
  logRepeatedFailedLogins,
  logSuperadminBootstrapCli,
  logTrustedDeviceCreated,
  redactEmail,
} from "../src/audit.js";
import { querySystemLogs, resetSystemLogBufferForTest } from "@admitto/shared/system-log";

const STAFF_SNAPSHOT = { email: "staff@example.com", display_name: "Staff User" };

/** Fake `db` implementing `securityAuditLog.create` and optional `user.findUnique`. */
function fakeDb(
  create: ReturnType<typeof vi.fn> = vi.fn().mockResolvedValue({}),
  userSnapshot: { email: string; display_name: string | null } | null = STAFF_SNAPSHOT,
): PrismaClient {
  return {
    securityAuditLog: { create },
    user: { findUnique: vi.fn().mockResolvedValue(userSnapshot) },
  } as unknown as PrismaClient;
}

describe("audit", () => {
  beforeEach(() => {
    resetSystemLogBufferForTest();
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
          metadata: { userAgent: "curl/8.0" },
        },
      });
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
      await logLoginFailure(fakeDb(), { email: "bob@example.com", ip: "1.2.3.4" });
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
      await logLoginFailure(fakeDb(create), { email: "bob@example.com", ip: "1.2.3.4" });
      expect(create).toHaveBeenCalledWith({
        data: {
          event_type: "auth.login.fail",
          user_id: null,
          user_email: null,
          user_display_name: null,
          ip: "1.2.3.4",
          actor_timezone: null,
          metadata: { email: "bob@example.com", userAgent: null },
        },
      });
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
      await logMfaFailure(fakeDb(create), { userId: "user-1", sessionId: "sess-1" });
      expect(create).toHaveBeenCalledWith({
        data: {
          event_type: "auth.mfa.fail",
          user_id: "user-1",
          user_email: STAFF_SNAPSHOT.email,
          user_display_name: STAFF_SNAPSHOT.display_name,
          ip: null,
          actor_timezone: null,
          metadata: { sessionId: "sess-1", userAgent: null },
        },
      });
    });

    it("persists sessionId null when the caller has no session id", async () => {
      vi.spyOn(console, "info").mockImplementation(() => {});
      const create = vi.fn().mockResolvedValue({});
      await logMfaFailure(fakeDb(create), { userId: "user-1" });
      expect(create).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ metadata: expect.objectContaining({ sessionId: null }) }) }),
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
  });
});
