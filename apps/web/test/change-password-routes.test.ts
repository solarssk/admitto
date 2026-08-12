import { beforeEach, describe, expect, it, vi } from "vitest";
import { Hono } from "hono";
import type { PrismaClient } from "@admitto/db";
import { PASSWORD_MIN_LENGTH, SESSION_STAGE } from "@admitto/auth";

vi.mock("@admitto/auth", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@admitto/auth")>();
  return {
    ...actual,
    hashPassword: vi.fn(async () => "hashed"),
    isPasswordTooCommon: vi.fn(() => false),
    revokeOtherSessions: vi.fn(async () => 2),
    promoteSessionToFull: vi.fn(async () => actual.SESSION_STAGE.FULL),
  };
});

vi.mock("@admitto/tickets", () => ({
  writeAdminAuditLogBestEffort: vi.fn(async () => {}),
}));

vi.mock("../src/auth/post-login-redirect.js", () => ({
  resolvePostLoginRedirectForUser: vi.fn(async () => "/admin"),
}));

vi.mock("../src/auth/ensure-backup-codes.js", () => ({
  ensureEnrollmentBackupCodesStashed: vi.fn(async () => ["AAAA-BBBB"]),
}));

vi.mock("../src/admin/instance-org.js", () => ({
  resolveInstanceOrganizationId: vi.fn(async () => "org-1"),
}));

vi.mock("../src/admin/admin-helpers.js", () => ({
  resolveClientTimezone: vi.fn(() => "Europe/Warsaw"),
}));

vi.mock("../src/rate-limit/client-ip.js", () => ({
  resolveClientIp: vi.fn(() => "127.0.0.1"),
}));

import {
  hashPassword,
  isPasswordTooCommon,
  promoteSessionToFull,
  revokeOtherSessions,
} from "@admitto/auth";
import { writeAdminAuditLogBestEffort } from "@admitto/tickets";
import { resolvePostLoginRedirectForUser } from "../src/auth/post-login-redirect.js";
import { ensureEnrollmentBackupCodesStashed } from "../src/auth/ensure-backup-codes.js";
import {
  handleGetChangePassword,
  handlePostChangePassword,
} from "../src/auth/change-password-routes.js";

const hashPw = vi.mocked(hashPassword);
const tooCommon = vi.mocked(isPasswordTooCommon);
const revokeOthers = vi.mocked(revokeOtherSessions);
const promote = vi.mocked(promoteSessionToFull);
const audit = vi.mocked(writeAdminAuditLogBestEffort);
const resolveLanding = vi.mocked(resolvePostLoginRedirectForUser);
const stashBackup = vi.mocked(ensureEnrollmentBackupCodesStashed);

type Vars = {
  Variables: {
    partialAuth?: { userId: string; sessionId: string } | null;
  };
};

function makeDb(opts: {
  mustChangePassword?: boolean;
  transactionImpl?: (fn: (tx: unknown) => Promise<unknown>) => Promise<unknown>;
}): PrismaClient {
  return {
    user: {
      findUnique: vi.fn(async () =>
        opts.mustChangePassword === false
          ? { must_change_password: false }
          : { must_change_password: true },
      ),
      update: vi.fn(async () => ({})),
    },
    $transaction: vi.fn(async (fn: (tx: unknown) => Promise<unknown>) => {
      if (opts.transactionImpl) return opts.transactionImpl(fn);
      const tx = {
        user: { update: vi.fn(async () => ({})) },
      };
      return fn(tx);
    }),
  } as unknown as PrismaClient;
}

function makeApp(db: PrismaClient, partial?: Vars["Variables"]["partialAuth"]): Hono<Vars> {
  const app = new Hono<Vars>();
  app.use("*", async (c, next) => {
    if (partial !== undefined) c.set("partialAuth", partial);
    await next();
  });
  app.get("/change-password", (c) => handleGetChangePassword(c, db));
  app.post("/change-password", (c) => handlePostChangePassword(c, db));
  return app;
}

const strongPassword = "x".repeat(PASSWORD_MIN_LENGTH) + "Unique1!";

describe("change-password-routes", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    hashPw.mockResolvedValue("hashed");
    tooCommon.mockReturnValue(false);
    revokeOthers.mockResolvedValue(2);
    promote.mockResolvedValue(SESSION_STAGE.FULL);
    resolveLanding.mockResolvedValue("/admin");
    stashBackup.mockResolvedValue(["AAAA-BBBB"]);
  });

  it("redirects to /login when partial session is missing", async () => {
    const app = makeApp(makeDb({}), null);
    const res = await app.request("/change-password");
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe("/login");
  });

  it("redirects away when must_change_password is already cleared", async () => {
    resolveLanding.mockResolvedValue("/operator");
    const app = makeApp(makeDb({ mustChangePassword: false }), {
      userId: "u1",
      sessionId: "s1",
    });
    const res = await app.request("/change-password");
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe("/operator");
  });

  it("renders the change-password form for a forced-change session", async () => {
    const app = makeApp(makeDb({}), { userId: "u1", sessionId: "s1" });
    const res = await app.request("/change-password");
    expect(res.status).toBe(200);
    expect(await res.text()).toContain("password");
  });

  it("rejects passwords that are too short", async () => {
    const app = makeApp(makeDb({}), { userId: "u1", sessionId: "s1" });
    const res = await app.request("/change-password", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: "password=short&password_confirm=short",
    });
    expect(res.status).toBe(400);
    expect(await res.text()).toMatch(/at least/i);
  });

  it("rejects common passwords", async () => {
    tooCommon.mockReturnValue(true);
    const app = makeApp(makeDb({}), { userId: "u1", sessionId: "s1" });
    const res = await app.request("/change-password", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: `password=${encodeURIComponent(strongPassword)}&password_confirm=${encodeURIComponent(strongPassword)}`,
    });
    expect(res.status).toBe(400);
    expect(await res.text()).toMatch(/too common/i);
  });

  it("rejects mismatched confirmation", async () => {
    const app = makeApp(makeDb({}), { userId: "u1", sessionId: "s1" });
    const res = await app.request("/change-password", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: `password=${encodeURIComponent(strongPassword)}&password_confirm=${encodeURIComponent(strongPassword + "x")}`,
    });
    expect(res.status).toBe(400);
    expect(await res.text()).toMatch(/do not match/i);
  });

  it("updates password, audits, and redirects to landing on success", async () => {
    const app = makeApp(makeDb({}), { userId: "u1", sessionId: "s1" });
    const res = await app.request("/change-password", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: `password=${encodeURIComponent(strongPassword)}&password_confirm=${encodeURIComponent(strongPassword)}`,
      redirect: "manual",
    });
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe("/admin");
    expect(audit).toHaveBeenCalled();
    expect(hashPw).toHaveBeenCalled();
  });

  it("redirects to backup-codes when promotion lands on backup_codes_required", async () => {
    promote.mockResolvedValue(SESSION_STAGE.BACKUP_CODES_REQUIRED);
    const app = makeApp(makeDb({}), { userId: "u1", sessionId: "s1" });
    const res = await app.request("/change-password", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: `password=${encodeURIComponent(strongPassword)}&password_confirm=${encodeURIComponent(strongPassword)}`,
      redirect: "manual",
    });
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe("/mfa/enroll/backup-codes");
    expect(stashBackup).toHaveBeenCalled();
  });

  it("shows complete-failed when session promotion returns null", async () => {
    promote.mockResolvedValue(null);
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    const app = makeApp(makeDb({}), { userId: "u1", sessionId: "s1" });
    const res = await app.request("/change-password", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: `password=${encodeURIComponent(strongPassword)}&password_confirm=${encodeURIComponent(strongPassword)}`,
    });
    expect(res.status).toBe(400);
    expect(await res.text()).toMatch(/could not be completed|try logging in again/i);
    err.mockRestore();
  });

  it("treats empty body (non-form content-type) as empty passwords", async () => {
    const app = makeApp(makeDb({}), { userId: "u1", sessionId: "s1" });
    const res = await app.request("/change-password", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "{}",
    });
    expect(res.status).toBe(400);
  });
});
