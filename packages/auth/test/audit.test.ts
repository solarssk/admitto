import { describe, expect, it, vi, afterEach, beforeEach } from "vitest";
import type { PrismaClient } from "@prisma/client";
import {
  emitAuditEvent,
  fingerprint,
  logAccessDenied,
  logLoginFailure,
  logLoginSuccess,
  logLogout,
  logMfaBreakGlass,
  logMfaFailure,
  logMfaRecoveryConsumed,
  logMfaSuccess,
  logOidcLoginSuccess,
  logOidcSuperadminRevokeBlocked,
  logRateLimitExceeded,
  redactEmail,
} from "../src/audit.js";
import { querySystemLogs, resetSystemLogBufferForTest } from "@admitto/shared/system-log";

/** Fake `db` implementing only `securityAuditLog.create`, matching the DI pattern used by
 * writeAdminAuditLog's own tests (e.g. settings/resolver.test.ts) - audit.ts never needs the
 * rest of PrismaClient. */
function fakeDb(create: ReturnType<typeof vi.fn> = vi.fn().mockResolvedValue({})): PrismaClient {
  return { securityAuditLog: { create } } as unknown as PrismaClient;
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
      await logLoginSuccess(fakeDb(create), {
        email: "bob@example.com",
        ip: "1.2.3.4",
        userAgent: "curl/8.0",
        userId: "user-1",
      });
      expect(create).toHaveBeenCalledWith({
        data: {
          event_type: "auth.login.success",
          user_id: "user-1",
          ip: "1.2.3.4",
          metadata: { email: "bob@example.com", userAgent: "curl/8.0" },
        },
      });
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
  });

  describe("logLoginFailure", () => {
    it("redacts the email in the stdout emit (unauthenticated input, unlike a successful login)", async () => {
      const spy = vi.spyOn(console, "info").mockImplementation(() => {});
      await logLoginFailure(fakeDb(), { email: "bob@example.com", ip: "1.2.3.4" });
      const payload = JSON.parse(String(spy.mock.calls[0]?.[0]));
      expect(payload.event).toBe("auth.login.fail");
      expect(payload.email).toBe("b***@example.com");

      const entries = querySystemLogs({ source: "security" });
      expect(
        entries.some((e) => e.message === "auth.login.fail" && e.fields?.email === "b***@example.com"),
      ).toBe(true);
    });

    it("persists a durable row with user_id null (enumeration-safe) and a redacted email in metadata", async () => {
      vi.spyOn(console, "info").mockImplementation(() => {});
      const create = vi.fn().mockResolvedValue({});
      await logLoginFailure(fakeDb(create), { email: "bob@example.com", ip: "1.2.3.4" });
      expect(create).toHaveBeenCalledWith({
        data: {
          event_type: "auth.login.fail",
          user_id: null,
          ip: "1.2.3.4",
          metadata: { email_redacted: "b***@example.com", userAgent: null },
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
          ip: "1.2.3.4",
          metadata: { sessionId: "sess-1", method: "totp", userAgent: null },
        },
      });
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
          ip: null,
          metadata: { sessionId: "sess-1", userAgent: null },
        },
      });
    });
  });

  describe("logMfaBreakGlass", () => {
    it("persists the target user id when the caller resolved one", async () => {
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
          ip: "1.2.3.4",
          metadata: { action: "reset_mfa", email: "admin@example.com" },
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
          ip: null,
          metadata: { method: "backup", sessionId: "sess-1" },
        },
      });
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
          ip: "1.2.3.4",
          metadata: { sessionId: "sess-1" },
        },
      });
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
          ip: "1.2.3.4",
          metadata: { providerId: "prov-1", subject: "sub-1" },
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
          ip: null,
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
          ip: "1.2.3.4",
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
});
