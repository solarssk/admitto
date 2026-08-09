import { beforeEach, describe, expect, it, vi } from "vitest";
import { Hono } from "hono";
import type { PrismaClient } from "@admitto/db";
import { LOGIN_NEXT } from "@admitto/auth";
import { InMemoryRateLimitStore } from "../src/rate-limit/in-memory.js";

vi.mock("@admitto/auth", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@admitto/auth")>();
  return {
    ...actual,
    login: vi.fn(),
    logout: vi.fn(async () => {}),
    revokeSession: vi.fn(async () => {}),
    revokeTrustedDeviceByToken: vi.fn(async () => {}),
    validateSession: vi.fn(),
    validatePartialSession: vi.fn(),
  };
});

vi.mock("../src/setup-routes.js", () => ({
  resolveStaffEntryPath: vi.fn(async () => "/login"),
}));

vi.mock("../src/auth/login-sso.js", () => ({
  loadLoginSsoProviders: vi.fn(async () => []),
}));

vi.mock("../src/auth/post-login-redirect.js", () => ({
  resolvePostLoginRedirectForUser: vi.fn(async () => "/admin"),
}));

vi.mock("../src/auth/login-rate-limit.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/auth/login-rate-limit.js")>();
  return {
    ...actual,
    checkLoginEmailRateLimit: vi.fn(async () => true),
  };
});

vi.mock("../src/rate-limit/client-ip.js", () => ({
  resolveClientIp: vi.fn(() => "127.0.0.1"),
}));

import {
  login,
  logout,
  revokeSession,
  revokeTrustedDeviceByToken,
  validatePartialSession,
  validateSession,
} from "@admitto/auth";
import { resolveStaffEntryPath } from "../src/setup-routes.js";
import { resolvePostLoginRedirectForUser } from "../src/auth/post-login-redirect.js";
import { checkLoginEmailRateLimit } from "../src/auth/login-rate-limit.js";
import {
  handleGetLogin,
  handlePostLogin,
  handlePostLogout,
} from "../src/auth/html-routes.js";

const mockLogin = vi.mocked(login);
const mockLogout = vi.mocked(logout);
const mockValidateSession = vi.mocked(validateSession);
const mockValidatePartial = vi.mocked(validatePartialSession);
const mockRevokeSession = vi.mocked(revokeSession);
const mockRevokeTrusted = vi.mocked(revokeTrustedDeviceByToken);
const resolveEntry = vi.mocked(resolveStaffEntryPath);
const resolveLanding = vi.mocked(resolvePostLoginRedirectForUser);
const checkEmailLimit = vi.mocked(checkLoginEmailRateLimit);

function makeApp(db: PrismaClient = {} as PrismaClient): Hono {
  const store = new InMemoryRateLimitStore();
  const app = new Hono();
  app.get("/login", (c) => handleGetLogin(c, db));
  app.post("/login", (c) => handlePostLogin(c, db, store));
  app.post("/logout", (c) => handlePostLogout(c, db));
  return app;
}

describe("html-routes", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resolveEntry.mockResolvedValue("/login");
    resolveLanding.mockResolvedValue("/admin");
    checkEmailLimit.mockResolvedValue(true);
    mockValidateSession.mockResolvedValue(null);
    mockValidatePartial.mockResolvedValue(null);
  });

  it("redirects GET /login to /setup when staff entry is setup", async () => {
    resolveEntry.mockResolvedValue("/setup");
    const res = await makeApp().request("/login");
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe("/setup");
  });

  it("redirects authenticated users away from the login form", async () => {
    mockValidateSession.mockResolvedValue({
      userId: "u1",
      session: { id: "s1" },
    } as Awaited<ReturnType<typeof validateSession>>);
    resolveLanding.mockResolvedValue("/operator");
    const res = await makeApp().request("/login", {
      headers: { Cookie: "admitto_session=tok" },
    });
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe("/operator");
  });

  it("does not redirect when landing resolves back to /login", async () => {
    mockValidateSession.mockResolvedValue({
      userId: "u1",
      session: { id: "s1" },
    } as Awaited<ReturnType<typeof validateSession>>);
    resolveLanding.mockResolvedValue("/login?error=oidc_failed");
    const res = await makeApp().request("/login?next=/login", {
      headers: { Cookie: "admitto_session=tok" },
    });
    expect(res.status).toBe(200);
    expect(await res.text()).toContain("email");
  });

  it("falls through to the form when post-login redirect throws", async () => {
    mockValidateSession.mockResolvedValue({
      userId: "u1",
      session: { id: "s1" },
    } as Awaited<ReturnType<typeof validateSession>>);
    resolveLanding.mockRejectedValue(new Error("boom"));
    const res = await makeApp().request("/login", {
      headers: { Cookie: "admitto_session=tok" },
    });
    expect(res.status).toBe(200);
  });

  it("renders the login form for anonymous visitors", async () => {
    const res = await makeApp().request("/login");
    expect(res.status).toBe(200);
    expect(await res.text()).toContain("email");
  });

  it("redirects POST /login to /setup when staff entry is setup", async () => {
    resolveEntry.mockResolvedValue("/setup");
    const res = await makeApp().request("/login", { method: "POST" });
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe("/setup");
  });

  it("rejects empty credentials with 401", async () => {
    const res = await makeApp().request("/login", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: "email=&password=",
    });
    expect(res.status).toBe(401);
  });

  it("returns 429 when failed login hits the email rate limit", async () => {
    mockLogin.mockResolvedValue({ ok: false } as Awaited<ReturnType<typeof login>>);
    checkEmailLimit.mockResolvedValue(false);
    const res = await makeApp().request("/login", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: "email=ops%40example.com&password=bad-password",
    });
    expect(res.status).toBe(429);
  });

  it("returns 401 HTML when credentials are wrong but under rate limit", async () => {
    mockLogin.mockResolvedValue({ ok: false } as Awaited<ReturnType<typeof login>>);
    const res = await makeApp().request("/login", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: "email=ops%40example.com&password=bad-password",
    });
    expect(res.status).toBe(401);
  });

  it("redirects to MFA verify when login requires MFA", async () => {
    mockLogin.mockResolvedValue({
      ok: true,
      next: LOGIN_NEXT.MFA_REQUIRED,
      rawToken: "tok",
      userId: "u1",
      sessionId: "s1",
    } as Awaited<ReturnType<typeof login>>);
    const res = await makeApp().request("/login", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: "email=ops%40example.com&password=good-password&next=%2Foperator",
      redirect: "manual",
    });
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe("/mfa/verify?next=%2Foperator");
  });

  it("redirects to MFA enroll when enrollment is required", async () => {
    mockLogin.mockResolvedValue({
      ok: true,
      next: LOGIN_NEXT.ENROLLMENT_REQUIRED,
      rawToken: "tok",
      userId: "u1",
      sessionId: "s1",
    } as Awaited<ReturnType<typeof login>>);
    const res = await makeApp().request("/login", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: "email=ops%40example.com&password=good-password",
      redirect: "manual",
    });
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe("/mfa/enroll");
  });

  it("redirects to change-password when forced", async () => {
    mockLogin.mockResolvedValue({
      ok: true,
      next: LOGIN_NEXT.CHANGE_PASSWORD,
      rawToken: "tok",
      userId: "u1",
      sessionId: "s1",
    } as Awaited<ReturnType<typeof login>>);
    const res = await makeApp().request("/login", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: "email=ops%40example.com&password=good-password",
      redirect: "manual",
    });
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe("/change-password");
  });

  it("redirects to landing on complete login", async () => {
    mockLogin.mockResolvedValue({
      ok: true,
      next: LOGIN_NEXT.COMPLETE,
      rawToken: "tok",
      userId: "u1",
      sessionId: "s1",
    } as Awaited<ReturnType<typeof login>>);
    const res = await makeApp().request("/login", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: "email=ops%40example.com&password=good-password",
      redirect: "manual",
    });
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe("/admin");
  });

  it("revokes the session and returns to /login when landing resolution fails", async () => {
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    mockLogin.mockResolvedValue({
      ok: true,
      next: LOGIN_NEXT.COMPLETE,
      rawToken: "tok",
      userId: "u1",
      sessionId: "s1",
    } as Awaited<ReturnType<typeof login>>);
    resolveLanding.mockRejectedValue(new Error("no roles"));
    const res = await makeApp().request("/login", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: "email=ops%40example.com&password=good-password",
      redirect: "manual",
    });
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe("/login");
    expect(mockRevokeSession).toHaveBeenCalledWith(expect.anything(), "s1");
    err.mockRestore();
  });

  it("logs out a partial session and clears cookies", async () => {
    mockValidatePartial.mockResolvedValue({
      userId: "u1",
      sessionId: "s1",
    } as Awaited<ReturnType<typeof validatePartialSession>>);
    const res = await makeApp().request("/logout", {
      method: "POST",
      headers: { Cookie: "admitto_session=tok; admitto_trusted_device=td" },
      redirect: "manual",
    });
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe("/login");
    expect(mockRevokeTrusted).toHaveBeenCalled();
    expect(mockLogout).toHaveBeenCalled();
  });

  it("logs out cleanly when there is no session cookie", async () => {
    const res = await makeApp().request("/logout", {
      method: "POST",
      redirect: "manual",
    });
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe("/login");
    expect(mockLogout).toHaveBeenCalled();
  });
});
