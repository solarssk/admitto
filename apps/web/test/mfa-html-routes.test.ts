import { beforeEach, describe, expect, it, vi } from "vitest";
import { Hono } from "hono";
import type { PrismaClient } from "@admitto/db";
import { BACKUP_RECOVERY_CODE_COUNT, SESSION_STAGE } from "@admitto/auth";
import { InMemoryRateLimitStore } from "../src/rate-limit/in-memory.js";
import {
  clearEnrollmentBackupCacheForTests,
  stashEnrollmentBackupCodes,
} from "../src/auth/enrollment-backup-cache.js";

vi.mock("@admitto/tickets", () => ({
  generateQrPng: vi.fn(async () => Buffer.from("png")),
}));

vi.mock("@admitto/auth", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@admitto/auth")>();
  return {
    ...actual,
    resumePendingTotpEnrollment: vi.fn(),
    startTotpEnrollment: vi.fn(),
    confirmTotpEnrollment: vi.fn(),
    promoteSessionToFull: vi.fn(),
    promoteSessionToBackupCodesStep: vi.fn(),
    completeMfa: vi.fn(),
    revokeSession: vi.fn(async () => {}),
    verifyBackupRecoveryCodesSet: vi.fn(),
    regenerateBackupRecoveryCodes: vi.fn(),
    markBackupCodesAcknowledged: vi.fn(async () => {}),
    parseTotpSecretFromOtpauthUri: vi.fn(() => "SECRET"),
    // Short-circuits hasUsableWebauthnCredentials before it needs a real userMfaMethod query -
    // this file's `db` is a bare mock, not a real PrismaClient. None of these tests exercise the
    // WebAuthn button itself.
    getWebauthnEnabled: vi.fn(async () => false),
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

vi.mock("../src/auth/post-login-redirect.js", () => ({
  resolvePostLoginRedirectForUser: vi.fn(async () => "/admin"),
}));

vi.mock("../src/auth/ensure-backup-codes.js", () => ({
  ensureEnrollmentBackupCodesStashed: vi.fn(async () => ["AAAA-BBBB"]),
}));

vi.mock("../src/auth/routes.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/auth/routes.js")>();
  return {
    ...actual,
    setTrustedDeviceCookie: vi.fn(async () => {}),
  };
});

import {
  completeMfa,
  confirmTotpEnrollment,
  markBackupCodesAcknowledged,
  promoteSessionToBackupCodesStep,
  promoteSessionToFull,
  regenerateBackupRecoveryCodes,
  resumePendingTotpEnrollment,
  revokeSession,
  startTotpEnrollment,
  verifyBackupRecoveryCodesSet,
} from "@admitto/auth";
import { checkMfaVerifyRateLimit } from "../src/auth/mfa-rate-limit.js";
import { resolvePostLoginRedirectForUser } from "../src/auth/post-login-redirect.js";
import { ensureEnrollmentBackupCodesStashed } from "../src/auth/ensure-backup-codes.js";
import { setTrustedDeviceCookie } from "../src/auth/routes.js";
import {
  handleGetMfaEnroll,
  handleGetMfaEnrollBackupCodes,
  handleGetMfaVerify,
  handlePostMfaEnroll,
  handlePostMfaEnrollBackupCodes,
  handlePostMfaEnrollDownloadCodes,
  handlePostMfaEnrollStart,
  handlePostMfaVerify,
} from "../src/auth/mfa-html-routes.js";

const mockCompleteMfa = vi.mocked(completeMfa);
const mockConfirm = vi.mocked(confirmTotpEnrollment);
const mockResume = vi.mocked(resumePendingTotpEnrollment);
const mockStart = vi.mocked(startTotpEnrollment);
const mockPromoteBackup = vi.mocked(promoteSessionToBackupCodesStep);
const mockPromoteFull = vi.mocked(promoteSessionToFull);
const mockRegen = vi.mocked(regenerateBackupRecoveryCodes);
const mockVerifySet = vi.mocked(verifyBackupRecoveryCodesSet);
const mockRevoke = vi.mocked(revokeSession);
const mockCheckLimit = vi.mocked(checkMfaVerifyRateLimit);
const mockLanding = vi.mocked(resolvePostLoginRedirectForUser);
const mockStashEnsure = vi.mocked(ensureEnrollmentBackupCodesStashed);
const mockSetTrusted = vi.mocked(setTrustedDeviceCookie);
const mockMarkAck = vi.mocked(markBackupCodesAcknowledged);

type PartialAuth = {
  userId: string;
  sessionId: string;
  stage: string;
};

type Vars = { Variables: { partialAuth: PartialAuth } };

function makeDb(): PrismaClient {
  return {
    $transaction: vi.fn(async (fn: (tx: unknown) => Promise<unknown>) => fn({})),
  } as unknown as PrismaClient;
}

function makeApp(partial: PartialAuth, db: PrismaClient = makeDb()): {
  app: Hono<Vars>;
  store: InMemoryRateLimitStore;
} {
  const store = new InMemoryRateLimitStore();
  const app = new Hono<Vars>();
  app.use("*", async (c, next) => {
    c.set("partialAuth", partial);
    await next();
  });
  app.get("/mfa/verify", (c) => handleGetMfaVerify(c, db));
  app.post("/mfa/verify", (c) => handlePostMfaVerify(c, db, store));
  app.get("/mfa/enroll", (c) => handleGetMfaEnroll(c, db));
  app.post("/mfa/enroll/start", (c) => handlePostMfaEnrollStart(c, db));
  app.post("/mfa/enroll", (c) => handlePostMfaEnroll(c, db, store));
  app.get("/mfa/enroll/backup-codes", (c) => handleGetMfaEnrollBackupCodes(c, db));
  app.post("/mfa/enroll/backup-codes", (c) => handlePostMfaEnrollBackupCodes(c, db));
  app.post("/mfa/enroll/download-codes", (c) => handlePostMfaEnrollDownloadCodes(c, db));
  return { app, store };
}

const enrollment = {
  otpauthUri: "otpauth://totp/Admitto:ops@example.com?secret=SECRET",
  backupCodes: ["AAAA-BBBB-CCCC-DDDD"],
};

function tenCodes(): string[] {
  return Array.from({ length: BACKUP_RECOVERY_CODE_COUNT }, (_, i) => `CODE${i}AAAA`);
}

describe("mfa-html-routes", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    clearEnrollmentBackupCacheForTests();
    mockCheckLimit.mockResolvedValue(true);
    mockLanding.mockResolvedValue("/admin");
    mockStashEnsure.mockResolvedValue(["AAAA-BBBB"]);
    mockResume.mockResolvedValue(null);
    mockStart.mockResolvedValue(enrollment as never);
    mockConfirm.mockResolvedValue(true);
    mockPromoteBackup.mockResolvedValue({ rawToken: "rotated-token" });
    mockPromoteFull.mockResolvedValue({ stage: SESSION_STAGE.FULL, rawToken: "rotated-token" });
    mockRegen.mockResolvedValue({ codes: tenCodes() } as never);
    mockVerifySet.mockResolvedValue(true);
  });

  it("renders MFA verify form", async () => {
    const { app } = makeApp({
      userId: "u1",
      sessionId: "s1",
      stage: SESSION_STAGE.MFA_PENDING,
    });
    const res = await app.request("/mfa/verify");
    expect(res.status).toBe(200);
    expect(await res.text()).toMatch(/code|authenticator/i);
  });

  it("redirects MFA verify POST when stage is wrong", async () => {
    const { app } = makeApp({
      userId: "u1",
      sessionId: "s1",
      stage: SESSION_STAGE.FULL,
    });
    const res = await app.request("/mfa/verify", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: "code=123456",
      redirect: "manual",
    });
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe("/login");
  });

  it("rejects empty MFA code with 401", async () => {
    const { app } = makeApp({
      userId: "u1",
      sessionId: "s1",
      stage: SESSION_STAGE.MFA_PENDING,
    });
    const res = await app.request("/mfa/verify", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: "code=",
    });
    expect(res.status).toBe(401);
  });

  it("returns 429 when MFA verify is rate-limited", async () => {
    mockCheckLimit.mockResolvedValue(false);
    const { app } = makeApp({
      userId: "u1",
      sessionId: "s1",
      stage: SESSION_STAGE.MFA_PENDING,
    });
    const res = await app.request("/mfa/verify", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: "code=123456",
    });
    expect(res.status).toBe(429);
  });

  it("rejects invalid MFA codes", async () => {
    mockCompleteMfa.mockResolvedValue({ ok: false } as never);
    const { app } = makeApp({
      userId: "u1",
      sessionId: "s1",
      stage: SESSION_STAGE.MFA_PENDING,
    });
    const res = await app.request("/mfa/verify", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: "code=000000",
    });
    expect(res.status).toBe(401);
  });

  it("sets trusted device cookie and redirects to backup codes when required", async () => {
    mockCompleteMfa.mockResolvedValue({
      ok: true,
      stage: SESSION_STAGE.BACKUP_CODES_REQUIRED,
      trustedDeviceRawToken: "td-tok",
    } as never);
    const { app } = makeApp({
      userId: "u1",
      sessionId: "s1",
      stage: SESSION_STAGE.MFA_PENDING,
    });
    const res = await app.request("/mfa/verify", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: "code=123456&remember_device=1&next=%2Foperator",
      redirect: "manual",
    });
    expect(mockSetTrusted).toHaveBeenCalled();
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe("/mfa/enroll/backup-codes?next=%2Foperator");
  });

  it("redirects to change-password after MFA when required", async () => {
    mockCompleteMfa.mockResolvedValue({
      ok: true,
      stage: SESSION_STAGE.CHANGE_PASSWORD_REQUIRED,
    } as never);
    const { app } = makeApp({
      userId: "u1",
      sessionId: "s1",
      stage: SESSION_STAGE.MFA_PENDING,
    });
    const res = await app.request("/mfa/verify", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: "code=123456",
      redirect: "manual",
    });
    expect(res.headers.get("location")).toBe("/change-password");
  });

  it("redirects to landing after successful MFA", async () => {
    mockCompleteMfa.mockResolvedValue({
      ok: true,
      stage: SESSION_STAGE.FULL,
    } as never);
    const { app } = makeApp({
      userId: "u1",
      sessionId: "s1",
      stage: SESSION_STAGE.MFA_PENDING,
    });
    const res = await app.request("/mfa/verify", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: "code=123456",
      redirect: "manual",
    });
    expect(res.headers.get("location")).toBe("/admin");
  });

  it("clears session and returns to login when post-MFA landing fails", async () => {
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    mockCompleteMfa.mockResolvedValue({
      ok: true,
      stage: SESSION_STAGE.FULL,
    } as never);
    mockLanding.mockRejectedValue(new Error("no roles"));
    const { app } = makeApp({
      userId: "u1",
      sessionId: "s1",
      stage: SESSION_STAGE.MFA_PENDING,
    });
    const res = await app.request("/mfa/verify", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: "code=123456",
      redirect: "manual",
    });
    expect(res.headers.get("location")).toBe("/login");
    expect(mockRevoke).toHaveBeenCalled();
    // clearSessionCookie now runs inside resolvePostMfaLandingPath (routes.ts), a same-module
    // call ESM mocking can't intercept - assert its observable effect (an expired Set-Cookie for
    // the session cookie) instead of the mock being called.
    const clearedCookie = res.headers.getSetCookie().find((c) => c.startsWith("admitto_session="));
    expect(clearedCookie).toMatch(/Max-Age=0/i);
    err.mockRestore();
  });

  it("redirects GET enroll to backup-codes when stage requires acknowledgment", async () => {
    const { app } = makeApp({
      userId: "u1",
      sessionId: "s1",
      stage: SESSION_STAGE.BACKUP_CODES_REQUIRED,
    });
    const res = await app.request("/mfa/enroll?next=%2Fadmin", { redirect: "manual" });
    expect(res.headers.get("location")).toBe("/mfa/enroll/backup-codes?next=%2Fadmin");
  });

  it("redirects GET enroll to login for unexpected stages", async () => {
    const { app } = makeApp({
      userId: "u1",
      sessionId: "s1",
      stage: SESSION_STAGE.MFA_PENDING,
    });
    const res = await app.request("/mfa/enroll", { redirect: "manual" });
    expect(res.headers.get("location")).toBe("/login");
  });

  it("shows enroll start page when no pending enrollment exists", async () => {
    const { app } = makeApp({
      userId: "u1",
      sessionId: "s1",
      stage: SESSION_STAGE.ENROLLMENT_REQUIRED,
    });
    const res = await app.request("/mfa/enroll");
    expect(res.status).toBe(200);
  });

  it("shows QR page when pending enrollment exists (including empty otpauth)", async () => {
    mockResume.mockResolvedValue({ otpauthUri: "", backupCodes: [] } as never);
    const { app } = makeApp({
      userId: "u1",
      sessionId: "s1",
      stage: SESSION_STAGE.ENROLLMENT_REQUIRED,
    });
    const res = await app.request("/mfa/enroll");
    expect(res.status).toBe(200);
  });

  it("shows QR page with generated PNG when pending enrollment has otpauth", async () => {
    mockResume.mockResolvedValue(enrollment as never);
    const { app } = makeApp({
      userId: "u1",
      sessionId: "s1",
      stage: SESSION_STAGE.ENROLLMENT_REQUIRED,
    });
    const res = await app.request("/mfa/enroll");
    expect(res.status).toBe(200);
  });

  it("redirects enroll/start when stage is wrong", async () => {
    const { app } = makeApp({
      userId: "u1",
      sessionId: "s1",
      stage: SESSION_STAGE.MFA_PENDING,
    });
    const res = await app.request("/mfa/enroll/start", {
      method: "POST",
      redirect: "manual",
    });
    expect(res.headers.get("location")).toBe("/login");
  });

  it("reuses existing enrollment on enroll/start", async () => {
    mockResume.mockResolvedValue(enrollment as never);
    const { app } = makeApp({
      userId: "u1",
      sessionId: "s1",
      stage: SESSION_STAGE.ENROLLMENT_REQUIRED,
    });
    const res = await app.request("/mfa/enroll/start", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: "",
    });
    expect(res.status).toBe(200);
    expect(mockStart).not.toHaveBeenCalled();
  });

  it("starts enrollment and stashes backup codes", async () => {
    const { app } = makeApp({
      userId: "u1",
      sessionId: "s1",
      stage: SESSION_STAGE.ENROLLMENT_REQUIRED,
    });
    const res = await app.request("/mfa/enroll/start", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: "",
    });
    expect(res.status).toBe(200);
    expect(mockStart).toHaveBeenCalled();
  });

  it("redirects to login when startTotpEnrollment returns null", async () => {
    mockStart.mockResolvedValue(null);
    const { app } = makeApp({
      userId: "u1",
      sessionId: "s1",
      stage: SESSION_STAGE.ENROLLMENT_REQUIRED,
    });
    const res = await app.request("/mfa/enroll/start", {
      method: "POST",
      redirect: "manual",
    });
    expect(res.headers.get("location")).toBe("/login");
  });

  it("rejects empty enroll confirm when no pending enrollment", async () => {
    const { app } = makeApp({
      userId: "u1",
      sessionId: "s1",
      stage: SESSION_STAGE.ENROLLMENT_REQUIRED,
    });
    const res = await app.request("/mfa/enroll", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: "code=",
    });
    expect(res.status).toBe(401);
  });

  it("rejects empty enroll confirm with QR error when pending exists", async () => {
    mockResume.mockResolvedValue(enrollment as never);
    const { app } = makeApp({
      userId: "u1",
      sessionId: "s1",
      stage: SESSION_STAGE.ENROLLMENT_REQUIRED,
    });
    const res = await app.request("/mfa/enroll", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: "code=",
    });
    expect(res.status).toBe(401);
  });

  it("returns 429 when enroll confirm is rate-limited", async () => {
    mockCheckLimit.mockResolvedValue(false);
    const { app } = makeApp({
      userId: "u1",
      sessionId: "s1",
      stage: SESSION_STAGE.ENROLLMENT_REQUIRED,
    });
    const res = await app.request("/mfa/enroll", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: "code=123456",
    });
    expect(res.status).toBe(429);
  });

  it("shows start page when confirm fails and pending enrollment disappeared", async () => {
    mockConfirm.mockResolvedValue(false);
    mockResume.mockResolvedValue(null);
    const { app } = makeApp({
      userId: "u1",
      sessionId: "s1",
      stage: SESSION_STAGE.ENROLLMENT_REQUIRED,
    });
    const res = await app.request("/mfa/enroll", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: "code=123456",
    });
    expect(res.status).toBe(401);
  });

  it("shows QR error when confirm fails and pending enrollment remains", async () => {
    mockConfirm.mockResolvedValue(false);
    mockResume.mockResolvedValue(enrollment as never);
    const { app } = makeApp({
      userId: "u1",
      sessionId: "s1",
      stage: SESSION_STAGE.ENROLLMENT_REQUIRED,
    });
    const res = await app.request("/mfa/enroll", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: "code=123456",
    });
    expect(res.status).toBe(401);
  });

  it("regenerates backup codes when stash is empty, then redirects", async () => {
    const { app } = makeApp({
      userId: "u1",
      sessionId: "s1",
      stage: SESSION_STAGE.ENROLLMENT_REQUIRED,
    });
    const res = await app.request("/mfa/enroll", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: "code=123456&next=%2Fadmin",
      redirect: "manual",
    });
    expect(mockRegen).toHaveBeenCalled();
    expect(res.headers.get("location")).toBe("/mfa/enroll/backup-codes?next=%2Fadmin");
  });

  it("shows QR error when promotion to backup-codes step fails", async () => {
    stashEnrollmentBackupCodes("s1", tenCodes());
    mockPromoteBackup.mockResolvedValue(null);
    // After confirm succeeds, promotion fails and resume is called once for the error page.
    mockResume.mockResolvedValue(enrollment as never);
    const { app } = makeApp({
      userId: "u1",
      sessionId: "s1",
      stage: SESSION_STAGE.ENROLLMENT_REQUIRED,
    });
    const res = await app.request("/mfa/enroll", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: "code=123456",
    });
    expect(res.status).toBe(401);
    const html = await res.text();
    expect(html).toMatch(/Invalid code\. Try again\./);
    expect(html).toContain("otpauth://totp/");
  });

  it("shows start page when promotion fails and pending enrollment is gone", async () => {
    stashEnrollmentBackupCodes("s1", tenCodes());
    mockPromoteBackup.mockResolvedValue(null);
    mockResume.mockResolvedValue(null);
    const { app } = makeApp({
      userId: "u1",
      sessionId: "s1",
      stage: SESSION_STAGE.ENROLLMENT_REQUIRED,
    });
    const res = await app.request("/mfa/enroll", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: "code=123456",
    });
    expect(res.status).toBe(401);
  });

  it("redirects GET backup-codes when stage is wrong", async () => {
    const { app } = makeApp({
      userId: "u1",
      sessionId: "s1",
      stage: SESSION_STAGE.ENROLLMENT_REQUIRED,
    });
    const res = await app.request("/mfa/enroll/backup-codes", { redirect: "manual" });
    expect(res.headers.get("location")).toBe("/login");
  });

  it("renders backup-codes page", async () => {
    stashEnrollmentBackupCodes("s1", tenCodes());
    const { app } = makeApp({
      userId: "u1",
      sessionId: "s1",
      stage: SESSION_STAGE.BACKUP_CODES_REQUIRED,
    });
    const res = await app.request("/mfa/enroll/backup-codes");
    expect(res.status).toBe(200);
    expect(mockStashEnsure).toHaveBeenCalled();
  });

  it("refuses backup-codes completion when stash is empty", async () => {
    const { app } = makeApp({
      userId: "u1",
      sessionId: "s1",
      stage: SESSION_STAGE.BACKUP_CODES_REQUIRED,
    });
    const res = await app.request("/mfa/enroll/backup-codes", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: "",
    });
    expect(res.status).toBe(401);
    expect(await res.text()).toMatch(/no longer available/i);
  });

  it("shows error when backup-codes promotion fails", async () => {
    stashEnrollmentBackupCodes("s1", tenCodes());
    mockPromoteFull.mockResolvedValue(null);
    const { app } = makeApp({
      userId: "u1",
      sessionId: "s1",
      stage: SESSION_STAGE.BACKUP_CODES_REQUIRED,
    });
    const res = await app.request("/mfa/enroll/backup-codes", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: "",
    });
    expect(res.status).toBe(401);
    expect(mockMarkAck).toHaveBeenCalled();
  });

  it("redirects to change-password after backup-codes ack when required", async () => {
    stashEnrollmentBackupCodes("s1", tenCodes());
    mockPromoteFull.mockResolvedValue({ stage: SESSION_STAGE.CHANGE_PASSWORD_REQUIRED, rawToken: "rotated-token" });
    const { app } = makeApp({
      userId: "u1",
      sessionId: "s1",
      stage: SESSION_STAGE.BACKUP_CODES_REQUIRED,
    });
    const res = await app.request("/mfa/enroll/backup-codes", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: "",
      redirect: "manual",
    });
    expect(res.headers.get("location")).toBe("/change-password");
  });

  it("redirects to landing after backup-codes ack", async () => {
    stashEnrollmentBackupCodes("s1", tenCodes());
    const { app } = makeApp({
      userId: "u1",
      sessionId: "s1",
      stage: SESSION_STAGE.BACKUP_CODES_REQUIRED,
    });
    const res = await app.request("/mfa/enroll/backup-codes", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: "",
      redirect: "manual",
    });
    expect(res.headers.get("location")).toBe("/admin");
  });

  it("rejects download-codes for wrong stage", async () => {
    const { app } = makeApp({
      userId: "u1",
      sessionId: "s1",
      stage: SESSION_STAGE.MFA_PENDING,
    });
    const res = await app.request("/mfa/enroll/download-codes", {
      method: "POST",
      redirect: "manual",
    });
    expect(res.headers.get("location")).toBe("/login");
  });

  it("rejects download-codes with wrong code count", async () => {
    const { app } = makeApp({
      userId: "u1",
      sessionId: "s1",
      stage: SESSION_STAGE.BACKUP_CODES_REQUIRED,
    });
    const res = await app.request("/mfa/enroll/download-codes", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: "code=ONLY-ONE",
    });
    expect(res.status).toBe(400);
  });

  it("rejects download-codes that do not match the stash", async () => {
    stashEnrollmentBackupCodes("s1", tenCodes());
    const wrong = tenCodes().map((c) => `${c}X`);
    const { app } = makeApp({
      userId: "u1",
      sessionId: "s1",
      stage: SESSION_STAGE.BACKUP_CODES_REQUIRED,
    });
    const body = wrong.map((c) => `code=${encodeURIComponent(c)}`).join("&");
    const res = await app.request("/mfa/enroll/download-codes", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body,
    });
    expect(res.status).toBe(400);
  });

  it("downloads codes that match the stash", async () => {
    const codes = tenCodes();
    stashEnrollmentBackupCodes("s1", codes);
    const { app } = makeApp({
      userId: "u1",
      sessionId: "s1",
      stage: SESSION_STAGE.BACKUP_CODES_REQUIRED,
    });
    const body = codes.map((c) => `code=${encodeURIComponent(c)}`).join("&");
    const res = await app.request("/mfa/enroll/download-codes", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body,
    });
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toMatch(/text\/plain/);
    expect(await res.text()).toBe(`${codes.join("\n")}\n`);
  });

  it("verifies download codes against the DB when stash is missing", async () => {
    const codes = tenCodes();
    mockVerifySet.mockResolvedValue(true);
    const { app } = makeApp({
      userId: "u1",
      sessionId: "s1",
      stage: SESSION_STAGE.ENROLLMENT_REQUIRED,
    });
    const body = codes.map((c) => `code=${encodeURIComponent(c)}`).join("&");
    const res = await app.request("/mfa/enroll/download-codes", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body,
    });
    expect(res.status).toBe(200);
    expect(mockVerifySet).toHaveBeenCalled();
  });

  it("rejects download codes against the DB when verification fails", async () => {
    const codes = tenCodes();
    mockVerifySet.mockResolvedValue(false);
    const { app } = makeApp({
      userId: "u1",
      sessionId: "s1",
      stage: SESSION_STAGE.ENROLLMENT_REQUIRED,
    });
    const body = codes.map((c) => `code=${encodeURIComponent(c)}`).join("&");
    const res = await app.request("/mfa/enroll/download-codes", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body,
    });
    expect(res.status).toBe(400);
  });
});
