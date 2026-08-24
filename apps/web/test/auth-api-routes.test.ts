import { beforeEach, describe, expect, it, vi } from "vitest";
import { Hono } from "hono";
import type { PrismaClient } from "@admitto/db";
import { LOGIN_NEXT, SESSION_STAGE } from "@admitto/auth";
import { InMemoryRateLimitStore } from "../src/rate-limit/in-memory.js";
import {
  clearEnrollmentBackupCacheForTests,
  stashEnrollmentBackupCodes,
} from "../src/auth/enrollment-backup-cache.js";

vi.mock("@admitto/mailer-config", () => ({
  describeMailConfigForOrg: vi.fn(async () => ({
    provider: { value: "smtp" },
  })),
}));

vi.mock("@admitto/auth", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@admitto/auth")>();
  return {
    ...actual,
    login: vi.fn(),
    logout: vi.fn(async () => {}),
    validatePartialSession: vi.fn(),
    completeMfa: vi.fn(),
    getOrStartTotpEnrollment: vi.fn(),
    confirmTotpEnrollment: vi.fn(),
    promoteSessionToFull: vi.fn(),
    promoteSessionToBackupCodesStep: vi.fn(),
    loginNextAfterFullSession: vi.fn(async () => actual.LOGIN_NEXT.COMPLETE),
    getTrustedDeviceDays: vi.fn(async () => 30),
    revokeTrustedDeviceByToken: vi.fn(async () => {}),
    updateSessionDeviceLabel: vi.fn(async () => true),
    regenerateBackupRecoveryCodes: vi.fn(),
    markBackupCodesAcknowledged: vi.fn(async () => {}),
    resolveSetupComplete: vi.fn(async () => true),
  };
});

vi.mock("../src/auth/login-rate-limit.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/auth/login-rate-limit.js")>();
  return {
    ...actual,
    checkLoginEmailRateLimit: vi.fn(async () => true),
  };
});

vi.mock("../src/auth/mfa-rate-limit.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/auth/mfa-rate-limit.js")>();
  return {
    ...actual,
    checkMfaVerifyRateLimit: vi.fn(async () => true),
    resolveMfaClientIp: vi.fn(() => "127.0.0.1"),
  };
});

vi.mock("../src/auth/ensure-backup-codes.js", () => ({
  ensureEnrollmentBackupCodesStashed: vi.fn(async () => ["AAAA-BBBB"]),
}));

vi.mock("../src/admin/instance-org.js", () => ({
  resolveInstanceOrganizationId: vi.fn(async () => "org-1"),
}));

vi.mock("../src/rate-limit/client-ip.js", () => ({
  resolveClientIp: vi.fn(() => "127.0.0.1"),
}));

import {
  completeMfa,
  confirmTotpEnrollment,
  getOrStartTotpEnrollment,
  getTrustedDeviceDays,
  login,
  loginNextAfterFullSession,
  logout,
  markBackupCodesAcknowledged,
  promoteSessionToBackupCodesStep,
  promoteSessionToFull,
  regenerateBackupRecoveryCodes,
  resolveSetupComplete,
  revokeTrustedDeviceByToken,
  updateSessionDeviceLabel,
  validatePartialSession,
} from "@admitto/auth";
import { checkLoginEmailRateLimit } from "../src/auth/login-rate-limit.js";
import { checkMfaVerifyRateLimit } from "../src/auth/mfa-rate-limit.js";
import { ensureEnrollmentBackupCodesStashed } from "../src/auth/ensure-backup-codes.js";
import {
  clearSessionCookie,
  handleLogin,
  handleLogout,
  handleMe,
  handleMfaVerify,
  handlePostSessionDeviceLabel,
  handleTotpBackupCodesComplete,
  handleTotpConfirm,
  handleTotpEnroll,
  setSessionCookie,
  setTrustedDeviceCookie,
} from "../src/auth/routes.js";

const mockLogin = vi.mocked(login);
const mockLogout = vi.mocked(logout);
const mockValidatePartial = vi.mocked(validatePartialSession);
const mockCompleteMfa = vi.mocked(completeMfa);
const mockGetOrStart = vi.mocked(getOrStartTotpEnrollment);
const mockConfirm = vi.mocked(confirmTotpEnrollment);
const mockPromoteBackup = vi.mocked(promoteSessionToBackupCodesStep);
const mockPromoteFull = vi.mocked(promoteSessionToFull);
const mockLoginNext = vi.mocked(loginNextAfterFullSession);
const mockTrustedDays = vi.mocked(getTrustedDeviceDays);
const mockRevokeTrusted = vi.mocked(revokeTrustedDeviceByToken);
const mockUpdateLabel = vi.mocked(updateSessionDeviceLabel);
const mockRegen = vi.mocked(regenerateBackupRecoveryCodes);
const mockMarkAck = vi.mocked(markBackupCodesAcknowledged);
const mockSetupComplete = vi.mocked(resolveSetupComplete);
const mockEmailLimit = vi.mocked(checkLoginEmailRateLimit);
const mockMfaLimit = vi.mocked(checkMfaVerifyRateLimit);
const mockStashEnsure = vi.mocked(ensureEnrollmentBackupCodesStashed);

type Vars = {
  Variables: {
    auth?: { userId: string; sessionId?: string };
    partialAuth?: { userId: string; sessionId: string; stage: string };
  };
};

function makeDb(user?: Record<string, unknown> | null): PrismaClient {
  return {
    user: {
      findUnique: vi.fn(async () =>
        user === undefined
          ? {
              id: "u1",
              email: "ops@example.com",
              display_name: null,
              preferred_locale: "en",
              preferred_time_format: null,
              is_active: true,
              created_at: new Date("2026-01-01T00:00:00Z"),
            }
          : user,
      ),
    },
    roleAssignment: {
      findMany: vi.fn(async () => [
        { role: "superadmin", scope_type: "instance", scope_id: null },
      ]),
    },
    session: {
      findUnique: vi.fn(async () => ({ device_label: "Gate A" })),
    },
    $transaction: vi.fn(async (fn: (tx: unknown) => Promise<unknown>) => fn({})),
  } as unknown as PrismaClient;
}

describe("auth API routes (routes.ts)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    clearEnrollmentBackupCacheForTests();
    mockEmailLimit.mockResolvedValue(true);
    mockMfaLimit.mockResolvedValue(true);
    mockTrustedDays.mockResolvedValue(30);
    mockLoginNext.mockResolvedValue(LOGIN_NEXT.COMPLETE);
    mockSetupComplete.mockResolvedValue(true);
    mockStashEnsure.mockResolvedValue(["AAAA-BBBB"]);
    mockPromoteBackup.mockResolvedValue({ rawToken: "rotated-token" });
    mockPromoteFull.mockResolvedValue({ stage: SESSION_STAGE.FULL, rawToken: "rotated-token" });
    mockUpdateLabel.mockResolvedValue(true);
    mockRegen.mockResolvedValue({ codes: ["A", "B"] } as never);
  });

  describe("cookie helpers", () => {
    it("sets and clears session / trusted-device cookies", async () => {
      const app = new Hono();
      app.get("/set", (c) => {
        setSessionCookie(c, "sess-tok");
        return c.text("ok");
      });
      app.get("/clear", (c) => {
        clearSessionCookie(c);
        return c.text("ok");
      });
      app.get("/trusted", async (c) => {
        await setTrustedDeviceCookie(c, makeDb(), "td-tok");
        return c.text("ok");
      });
      app.get("/trusted-off", async (c) => {
        mockTrustedDays.mockResolvedValueOnce(0);
        await setTrustedDeviceCookie(c, makeDb(), "td-tok");
        return c.text("ok");
      });

      const setRes = await app.request("https://tickets.example.com/set");
      expect(setRes.headers.getSetCookie?.().some((c) => c.startsWith("admitto_session="))).toBe(
        true,
      );

      const trusted = await app.request("https://tickets.example.com/trusted");
      expect(trusted.headers.getSetCookie?.().some((c) => c.includes("admitto_trusted_device"))).toBe(
        true,
      );

      const trustedOff = await app.request("https://tickets.example.com/trusted-off");
      expect(
        trustedOff.headers.getSetCookie?.().some((c) => c.includes("admitto_trusted_device")),
      ).toBe(false);

      await app.request("https://tickets.example.com/clear");
    });
  });

  describe("handleLogin", () => {
    function app(db = makeDb()) {
      const store = new InMemoryRateLimitStore();
      const h = new Hono();
      h.post("/api/auth/login", (c) => handleLogin(c, db, store));
      return h;
    }

    it("rejects invalid JSON", async () => {
      const res = await app().request("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "{",
      });
      expect(res.status).toBe(400);
    });

    it("rejects non-object JSON bodies", async () => {
      const res = await app().request("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "null",
      });
      expect(res.status).toBe(401);
    });

    it("rejects missing credentials", async () => {
      const res = await app().request("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: "", password: "" }),
      });
      expect(res.status).toBe(401);
    });

    it("returns 429 when failed login hits email rate limit", async () => {
      mockLogin.mockResolvedValue({ ok: false } as never);
      mockEmailLimit.mockResolvedValue(false);
      const res = await app().request("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: "ops@example.com", password: "bad" }),
      });
      expect(res.status).toBe(429);
    });

    it("returns 401 on failed login under rate limit", async () => {
      mockLogin.mockResolvedValue({ ok: false } as never);
      const res = await app().request("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: "ops@example.com", password: "bad" }),
      });
      expect(res.status).toBe(401);
    });

    it("returns backup codes when login lands on backup_codes_required", async () => {
      mockLogin.mockResolvedValue({
        ok: true,
        next: LOGIN_NEXT.BACKUP_CODES_REQUIRED,
        rawToken: "tok",
        sessionId: "s1",
        userId: "u1",
      } as never);
      const res = await app().request("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: "ops@example.com", password: "good" }),
      });
      expect(res.status).toBe(200);
      expect(await res.json()).toMatchObject({
        ok: true,
        next: LOGIN_NEXT.BACKUP_CODES_REQUIRED,
        backup_codes: ["AAAA-BBBB"],
      });
    });

    it("returns next step on successful login", async () => {
      mockLogin.mockResolvedValue({
        ok: true,
        next: LOGIN_NEXT.MFA_REQUIRED,
        rawToken: "tok",
        sessionId: "s1",
        userId: "u1",
      } as never);
      const res = await app().request("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: "ops@example.com", password: "good" }),
      });
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ ok: true, next: LOGIN_NEXT.MFA_REQUIRED });
    });
  });

  describe("handleLogout", () => {
    it("revokes the session but leaves the trusted-device cookie/token untouched", async () => {
      mockValidatePartial.mockResolvedValue({
        userId: "u1",
        sessionId: "s1",
      } as never);
      const app = new Hono();
      app.post("/api/auth/logout", (c) => handleLogout(c, makeDb()));
      const res = await app.request("/api/auth/logout", {
        method: "POST",
        headers: { Cookie: "admitto_session=tok; admitto_trusted_device=td" },
      });
      expect(res.status).toBe(200);
      expect(mockRevokeTrusted).not.toHaveBeenCalled();
      expect(mockLogout).toHaveBeenCalled();
      expect(
        res.headers.getSetCookie?.().some((c) => c.includes("admitto_trusted_device")),
      ).toBe(false);
    });
  });

  describe("handleMe", () => {
    it("returns 401 when the user row is missing", async () => {
      const app = new Hono<Vars>();
      app.use("*", async (c, next) => {
        c.set("auth", { userId: "missing", sessionId: "s1" });
        await next();
      });
      app.get("/api/auth/me", (c) => handleMe(c, makeDb(null)));
      const res = await app.request("/api/auth/me");
      expect(res.status).toBe(401);
    });

    it("includes mailer status and setup_complete for superadmins", async () => {
      const app = new Hono<Vars>();
      app.use("*", async (c, next) => {
        c.set("auth", { userId: "u1", sessionId: "s1" });
        await next();
      });
      app.get("/api/admin/me", (c) =>
        handleMe(c, makeDb(), { includeMailerStatus: true, includeSetupComplete: true }),
      );
      const res = await app.request("/api/admin/me");
      expect(res.status).toBe(200);
      const body = (await res.json()) as {
        mailer_status?: { configured: boolean; provider: string | null };
        setup_complete?: boolean;
        device_label: string | null;
      };
      expect(body.mailer_status).toEqual({ configured: true, provider: "smtp" });
      expect(body.setup_complete).toBe(true);
      expect(body.device_label).toBe("Gate A");
    });
  });

  describe("handlePostSessionDeviceLabel", () => {
    function app(auth: Vars["Variables"]["auth"]) {
      const h = new Hono<Vars>();
      h.use("*", async (c, next) => {
        c.set("auth", auth);
        await next();
      });
      h.post("/api/auth/session/device-label", (c) => handlePostSessionDeviceLabel(c, makeDb()));
      return h;
    }

    it("returns 401 without a session id", async () => {
      const res = await app({ userId: "u1" }).request("/api/auth/session/device-label", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ device_label: "A" }),
      });
      expect(res.status).toBe(401);
    });

    it("rejects invalid JSON", async () => {
      const res = await app({ userId: "u1", sessionId: "s1" }).request(
        "/api/auth/session/device-label",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: "{",
        },
      );
      expect(res.status).toBe(400);
    });

    it("rejects non-string device labels", async () => {
      const res = await app({ userId: "u1", sessionId: "s1" }).request(
        "/api/auth/session/device-label",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ device_label: 12 }),
        },
      );
      expect(res.status).toBe(400);
    });

    it("rejects labels that are too long", async () => {
      const res = await app({ userId: "u1", sessionId: "s1" }).request(
        "/api/auth/session/device-label",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ device_label: "x".repeat(200) }),
        },
      );
      expect(res.status).toBe(400);
    });

    it("clears the label when blank and returns null", async () => {
      const res = await app({ userId: "u1", sessionId: "s1" }).request(
        "/api/auth/session/device-label",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ device_label: "   " }),
        },
      );
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ device_label: null });
    });

    it("returns 401 when updateSessionDeviceLabel fails", async () => {
      mockUpdateLabel.mockResolvedValue(false);
      const res = await app({ userId: "u1", sessionId: "s1" }).request(
        "/api/auth/session/device-label",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ device_label: "Gate B" }),
        },
      );
      expect(res.status).toBe(401);
    });
  });

  describe("handleMfaVerify", () => {
    function app(stage: string) {
      const store = new InMemoryRateLimitStore();
      const h = new Hono<Vars>();
      h.use("*", async (c, next) => {
        c.set("partialAuth", { userId: "u1", sessionId: "s1", stage });
        await next();
      });
      h.post("/api/auth/mfa/verify", (c) => handleMfaVerify(c, makeDb(), store));
      return h;
    }

    it("rejects wrong stage", async () => {
      const res = await app(SESSION_STAGE.FULL).request("/api/auth/mfa/verify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code: "123456" }),
      });
      expect(res.status).toBe(401);
    });

    it("rejects invalid JSON / body / empty code", async () => {
      expect(
        (
          await app(SESSION_STAGE.MFA_PENDING).request("/api/auth/mfa/verify", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: "{",
          })
        ).status,
      ).toBe(400);
      expect(
        (
          await app(SESSION_STAGE.MFA_PENDING).request("/api/auth/mfa/verify", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: "null",
          })
        ).status,
      ).toBe(401);
      expect(
        (
          await app(SESSION_STAGE.MFA_PENDING).request("/api/auth/mfa/verify", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ code: "" }),
          })
        ).status,
      ).toBe(401);
    });

    it("returns 429 when rate-limited", async () => {
      mockMfaLimit.mockResolvedValue(false);
      const res = await app(SESSION_STAGE.MFA_PENDING).request("/api/auth/mfa/verify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code: "123456" }),
      });
      expect(res.status).toBe(429);
    });

    it("returns 401 on failed MFA", async () => {
      mockCompleteMfa.mockResolvedValue({ ok: false } as never);
      const res = await app(SESSION_STAGE.MFA_PENDING).request("/api/auth/mfa/verify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code: "123456" }),
      });
      expect(res.status).toBe(401);
    });

    it("returns backup codes when MFA completes to backup_codes_required", async () => {
      mockCompleteMfa.mockResolvedValue({
        ok: true,
        stage: SESSION_STAGE.BACKUP_CODES_REQUIRED,
        trustedDeviceRawToken: "td",
      } as never);
      const res = await app(SESSION_STAGE.MFA_PENDING).request("/api/auth/mfa/verify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code: "123456", remember_device: true }),
      });
      expect(res.status).toBe(200);
      expect(await res.json()).toMatchObject({
        ok: true,
        next: LOGIN_NEXT.BACKUP_CODES_REQUIRED,
      });
    });

    it("returns change_password next when required", async () => {
      mockCompleteMfa.mockResolvedValue({
        ok: true,
        stage: SESSION_STAGE.CHANGE_PASSWORD_REQUIRED,
      } as never);
      const res = await app(SESSION_STAGE.MFA_PENDING).request("/api/auth/mfa/verify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code: "123456" }),
      });
      expect(await res.json()).toEqual({ ok: true, next: LOGIN_NEXT.CHANGE_PASSWORD });
    });

    it("returns loginNextAfterFullSession on full MFA", async () => {
      mockCompleteMfa.mockResolvedValue({
        ok: true,
        stage: SESSION_STAGE.FULL,
      } as never);
      const res = await app(SESSION_STAGE.MFA_PENDING).request("/api/auth/mfa/verify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code: "123456" }),
      });
      expect(await res.json()).toEqual({ ok: true, next: LOGIN_NEXT.COMPLETE });
    });
  });

  describe("TOTP enroll/confirm/complete", () => {
    it("handleTotpEnroll rejects wrong stage and null enrollment", async () => {
      const storeStage = (stage: string) => {
        const h = new Hono<Vars>();
        h.use("*", async (c, next) => {
          c.set("partialAuth", { userId: "u1", sessionId: "s1", stage });
          await next();
        });
        h.post("/api/auth/mfa/totp/enroll", (c) => handleTotpEnroll(c, makeDb()));
        return h;
      };
      expect(
        (
          await storeStage(SESSION_STAGE.MFA_PENDING).request("/api/auth/mfa/totp/enroll", {
            method: "POST",
          })
        ).status,
      ).toBe(401);

      mockGetOrStart.mockResolvedValue(null);
      expect(
        (
          await storeStage(SESSION_STAGE.ENROLLMENT_REQUIRED).request(
            "/api/auth/mfa/totp/enroll",
            { method: "POST" },
          )
        ).status,
      ).toBe(401);
    });

    it("handleTotpEnroll stashes backup codes and returns otpauth uri", async () => {
      mockGetOrStart.mockResolvedValue({
        otpauthUri: "otpauth://totp/x",
        backupCodes: ["AAAA"],
      } as never);
      const h = new Hono<Vars>();
      h.use("*", async (c, next) => {
        c.set("partialAuth", {
          userId: "u1",
          sessionId: "s1",
          stage: SESSION_STAGE.ENROLLMENT_REQUIRED,
        });
        await next();
      });
      h.post("/api/auth/mfa/totp/enroll", (c) => handleTotpEnroll(c, makeDb()));
      const res = await h.request("/api/auth/mfa/totp/enroll", { method: "POST" });
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ ok: true, otpauth_uri: "otpauth://totp/x" });
    });

    it("handleTotpConfirm covers validation, regenerate, and promotion failure", async () => {
      const store = new InMemoryRateLimitStore();
      const h = new Hono<Vars>();
      h.use("*", async (c, next) => {
        c.set("partialAuth", {
          userId: "u1",
          sessionId: "s1",
          stage: SESSION_STAGE.ENROLLMENT_REQUIRED,
        });
        await next();
      });
      h.post("/api/auth/mfa/totp/confirm", (c) => handleTotpConfirm(c, makeDb(), store));

      expect(
        (
          await h.request("/api/auth/mfa/totp/confirm", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: "{",
          })
        ).status,
      ).toBe(400);

      mockConfirm.mockResolvedValue(false);
      expect(
        (
          await h.request("/api/auth/mfa/totp/confirm", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ code: "123456" }),
          })
        ).status,
      ).toBe(401);

      mockConfirm.mockResolvedValue(true);
      mockPromoteBackup.mockResolvedValue(null);
      expect(
        (
          await h.request("/api/auth/mfa/totp/confirm", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ code: "123456" }),
          })
        ).status,
      ).toBe(401);
      expect(mockRegen).toHaveBeenCalled();

      mockPromoteBackup.mockResolvedValue({ rawToken: "rotated-token" });
      stashEnrollmentBackupCodes("s1", ["KEEP"]);
      const ok = await h.request("/api/auth/mfa/totp/confirm", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code: "123456" }),
      });
      expect(ok.status).toBe(200);
      expect(await ok.json()).toMatchObject({
        ok: true,
        next: LOGIN_NEXT.BACKUP_CODES_REQUIRED,
      });
    });

    it("handleTotpBackupCodesComplete covers missing stash, failure, and change-password", async () => {
      const h = (stage: string = SESSION_STAGE.BACKUP_CODES_REQUIRED) => {
        const app = new Hono<Vars>();
        app.use("*", async (c, next) => {
          c.set("partialAuth", { userId: "u1", sessionId: "s1", stage });
          await next();
        });
        app.post("/api/auth/mfa/totp/backup-codes/complete", (c) =>
          handleTotpBackupCodesComplete(c, makeDb()),
        );
        return app;
      };

      expect(
        (
          await h(SESSION_STAGE.FULL).request("/api/auth/mfa/totp/backup-codes/complete", {
            method: "POST",
          })
        ).status,
      ).toBe(401);

      expect(
        (
          await h().request("/api/auth/mfa/totp/backup-codes/complete", { method: "POST" })
        ).status,
      ).toBe(401);

      stashEnrollmentBackupCodes("s1", ["AAAA"]);
      mockPromoteFull.mockResolvedValue(null);
      expect(
        (
          await h().request("/api/auth/mfa/totp/backup-codes/complete", { method: "POST" })
        ).status,
      ).toBe(401);
      expect(mockMarkAck).toHaveBeenCalled();

      stashEnrollmentBackupCodes("s1", ["AAAA"]);
      mockPromoteFull.mockResolvedValue({ stage: SESSION_STAGE.CHANGE_PASSWORD_REQUIRED, rawToken: "rotated-token" });
      expect(
        await (
          await h().request("/api/auth/mfa/totp/backup-codes/complete", { method: "POST" })
        ).json(),
      ).toEqual({ ok: true, next: LOGIN_NEXT.CHANGE_PASSWORD });

      stashEnrollmentBackupCodes("s1", ["AAAA"]);
      mockPromoteFull.mockResolvedValue({ stage: SESSION_STAGE.FULL, rawToken: "rotated-token" });
      expect(
        await (
          await h().request("/api/auth/mfa/totp/backup-codes/complete", { method: "POST" })
        ).json(),
      ).toEqual({ ok: true, next: LOGIN_NEXT.COMPLETE });
    });
  });
});
