import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { execSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { PrismaClient } from "@prisma/client";
import {
  hashPassword,
  LOGIN_NEXT,
  TRUSTED_DEVICE_COOKIE_NAME,
  validateTrustedDevice,
} from "@admitto/auth";
import { encryptTotpSecret, generateTotpSecret, generateTotpCode } from "@admitto/auth/testing";
import { createApp } from "../src/app.js";
import { InMemoryRateLimitStore } from "../src/rate-limit/index.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DB_ROOT = path.resolve(__dirname, "..", "..", "..", "packages", "db");
const CHECKIN_TOKEN = "test-checkin-mfa-token-32chars!!";
const EVENT_ID = "event-mfa-web";
const ORG_ID = "org_mfa_web";
const sameOrigin = { Origin: "http://localhost" };

let prisma: PrismaClient;
let app: ReturnType<typeof createApp>;
let adminEmail = "web-admin@example.com";
let adminPassword = "web-admin-pass-123";
let operatorEmail = "web-op@example.com";

function sessionCookie(res: Response): string | undefined {
  const setCookie = res.headers.getSetCookie?.() ?? [];
  const line = setCookie.find((c) => c.startsWith("admitto_session="));
  return line?.split(";")[0];
}

function cookieHeader(res: Response): Record<string, string> {
  const line = sessionCookie(res);
  return line ? { Cookie: line } : {};
}

beforeAll(async () => {
  execSync("npx prisma db push --force-reset --accept-data-loss", {
    cwd: DB_ROOT,
    env: { ...process.env },
    stdio: "pipe",
  });

  prisma = new PrismaClient();
  const password_hash = await hashPassword(adminPassword);
  const op_hash = await hashPassword("web-op-pass-123");

  await prisma.organization.upsert({
    where: { id: ORG_ID },
    create: { id: ORG_ID, name: "MFA Org", slug: "mfa-org" },
    update: {},
  });

  await prisma.event.create({
    data: {
      id: EVENT_ID,
      title: "MFA Event",
      slug: "mfa-event",
      date: new Date("2026-09-01T09:00:00Z"),
      organization_id: ORG_ID,
    },
  });

  const admin = await prisma.user.create({
    data: { email: adminEmail, password_hash },
  });
  await prisma.roleAssignment.create({
    data: { user_id: admin.id, role: "admin", scope_type: "instance", scope_id: null },
  });

  const op = await prisma.user.create({
    data: { email: operatorEmail, password_hash: op_hash },
  });
  await prisma.roleAssignment.create({
    data: { user_id: op.id, role: "operator", scope_type: "event", scope_id: EVENT_ID },
  });

  app = createApp({
    prisma,
    checkinToken: CHECKIN_TOKEN,
    allowCheckinBearer: false,
    baseUrl: "https://tickets.example.com",
    rateLimitStore: new InMemoryRateLimitStore(),
    skipCheckinBootValidation: true,
  });
});

afterAll(async () => {
  await prisma.$disconnect();
});

describe("POST /api/auth/login MFA", () => {
  it("operator gets next=complete and /api/auth/me works", async () => {
    const res = await app.request("/api/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json", ...sameOrigin },
      body: JSON.stringify({ email: operatorEmail, password: "web-op-pass-123" }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { next: string };
    expect(body.next).toBe(LOGIN_NEXT.COMPLETE);

    const me = await app.request("/api/auth/me", {
      headers: { ...sameOrigin, ...cookieHeader(res) },
    });
    expect(me.status).toBe(200);
  });

  it("admin without MFA gets enrollment_required; /api/auth/me is 401", async () => {
    const res = await app.request("/api/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json", ...sameOrigin },
      body: JSON.stringify({ email: adminEmail, password: adminPassword }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { next: string };
    expect(body.next).toBe(LOGIN_NEXT.ENROLLMENT_REQUIRED);

    const me = await app.request("/api/auth/me", {
      headers: { ...sameOrigin, ...cookieHeader(res) },
    });
    expect(me.status).toBe(401);
  });

  it("admin full MFA flow via API", async () => {
    const admin = await prisma.user.findUnique({ where: { email: adminEmail } });
    const secret = generateTotpSecret();
    await prisma.userMfaMethod.deleteMany({ where: { user_id: admin!.id } });
    await prisma.userMfaMethod.create({
      data: {
        user_id: admin!.id,
        type: "totp",
        secret_enc: encryptTotpSecret(secret),
        confirmed_at: new Date(),
      },
    });

    const loginRes = await app.request("/api/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json", ...sameOrigin },
      body: JSON.stringify({ email: adminEmail, password: adminPassword }),
    });
    expect((await loginRes.json()) as { next: string }).toEqual(
      expect.objectContaining({ next: LOGIN_NEXT.MFA_REQUIRED }),
    );

    const badVerify = await app.request("/api/auth/mfa/verify", {
      method: "POST",
      headers: { "Content-Type": "application/json", ...sameOrigin, ...cookieHeader(loginRes) },
      body: JSON.stringify({ code: "000000" }),
    });
    expect(badVerify.status).toBe(401);

    const verifyRes = await app.request("/api/auth/mfa/verify", {
      method: "POST",
      headers: { "Content-Type": "application/json", ...sameOrigin, ...cookieHeader(loginRes) },
      body: JSON.stringify({ code: generateTotpCode(secret), remember_device: true }),
    });
    expect(verifyRes.status).toBe(200);

    const trustedCookie = verifyRes.headers.getSetCookie?.().find((c) =>
      c.startsWith(`${TRUSTED_DEVICE_COOKIE_NAME}=`),
    );
    expect(trustedCookie).toBeTruthy();
    expect(trustedCookie).toMatch(/Max-Age=\d+/i);

    const me = await app.request("/api/auth/me", {
      headers: { ...sameOrigin, ...cookieHeader(loginRes) },
    });
    expect(me.status).toBe(200);
  });

  it("mfa_pending cannot call totp enroll or confirm APIs", async () => {
    const admin = await prisma.user.findUnique({ where: { email: adminEmail } });
    const secret = generateTotpSecret();
    await prisma.userMfaMethod.deleteMany({ where: { user_id: admin!.id } });
    await prisma.userMfaMethod.create({
      data: {
        user_id: admin!.id,
        type: "totp",
        secret_enc: encryptTotpSecret(secret),
        confirmed_at: new Date(),
      },
    });

    const loginRes = await app.request("/api/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json", ...sameOrigin },
      body: JSON.stringify({ email: adminEmail, password: adminPassword }),
    });

    const enroll = await app.request("/api/auth/mfa/totp/enroll", {
      method: "POST",
      headers: { "Content-Type": "application/json", ...sameOrigin, ...cookieHeader(loginRes) },
    });
    expect(enroll.status).toBe(401);

    const confirm = await app.request("/api/auth/mfa/totp/confirm", {
      method: "POST",
      headers: { "Content-Type": "application/json", ...sameOrigin, ...cookieHeader(loginRes) },
      body: JSON.stringify({ code: generateTotpCode(secret) }),
    });
    expect(confirm.status).toBe(401);
  });
});

describe("pending session check-in gate", () => {
  it("admin mfa_pending cannot scan", async () => {
    const admin = await prisma.user.findUnique({ where: { email: adminEmail } });
    const secret = generateTotpSecret();
    await prisma.userMfaMethod.deleteMany({ where: { user_id: admin!.id } });
    await prisma.userMfaMethod.create({
      data: {
        user_id: admin!.id,
        type: "totp",
        secret_enc: encryptTotpSecret(secret),
        confirmed_at: new Date(),
      },
    });

    const loginRes = await app.request("/api/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json", ...sameOrigin },
      body: JSON.stringify({ email: adminEmail, password: adminPassword }),
    });

    const scan = await app.request("/api/checkin/scan", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...sameOrigin,
        ...cookieHeader(loginRes),
      },
      body: JSON.stringify({ event_id: EVENT_ID, token: "anything" }),
    });
    expect(scan.status).toBe(401);
  });
});

describe("MFA rate limit", () => {
  it("returns 429 after repeated bad codes", async () => {
    const admin = await prisma.user.findUnique({ where: { email: adminEmail } });
    const secret = generateTotpSecret();
    await prisma.userMfaMethod.deleteMany({ where: { user_id: admin!.id } });
    await prisma.userMfaMethod.create({
      data: {
        user_id: admin!.id,
        type: "totp",
        secret_enc: encryptTotpSecret(secret),
        confirmed_at: new Date(),
      },
    });

    const store = new InMemoryRateLimitStore();
    const limitedApp = createApp({
      prisma,
      checkinToken: CHECKIN_TOKEN,
      allowCheckinBearer: false,
      baseUrl: "https://tickets.example.com",
      rateLimitStore: store,
      skipCheckinBootValidation: true,
    });

    const loginRes = await limitedApp.request("/api/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json", ...sameOrigin },
      body: JSON.stringify({ email: adminEmail, password: adminPassword }),
    });

    let lastStatus = 0;
    for (let i = 0; i < 12; i++) {
      const res = await limitedApp.request("/api/auth/mfa/verify", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...sameOrigin, ...cookieHeader(loginRes) },
        body: JSON.stringify({ code: "000000" }),
      });
      lastStatus = res.status;
      if (lastStatus === 429) break;
    }
    expect(lastStatus).toBe(429);
  });
});

describe("HTML MFA enroll", () => {
  it("GET /mfa/enroll does not create pending enrollment", async () => {
    const admin = await prisma.user.findUnique({ where: { email: adminEmail } });
    await prisma.userMfaMethod.deleteMany({ where: { user_id: admin!.id } });

    const loginRes = await app.request("/api/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json", ...sameOrigin },
      body: JSON.stringify({ email: adminEmail, password: adminPassword }),
    });
    expect(((await loginRes.json()) as { next: string }).next).toBe(LOGIN_NEXT.ENROLLMENT_REQUIRED);

    const getRes = await app.request("/mfa/enroll", {
      headers: { ...sameOrigin, ...cookieHeader(loginRes) },
    });
    expect(getRes.status).toBe(200);
    const html = await getRes.text();
    expect(html).toContain("Begin setup");
    expect(await prisma.userMfaMethod.count({ where: { user_id: admin!.id } })).toBe(0);
  });

  it("POST /mfa/enroll/start creates pending enrollment", async () => {
    const admin = await prisma.user.findUnique({ where: { email: adminEmail } });
    await prisma.userMfaMethod.deleteMany({ where: { user_id: admin!.id } });

    const loginRes = await app.request("/api/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json", ...sameOrigin },
      body: JSON.stringify({ email: adminEmail, password: adminPassword }),
    });

    const startRes = await app.request("/mfa/enroll/start", {
      method: "POST",
      headers: { ...sameOrigin, ...cookieHeader(loginRes) },
    });
    expect(startRes.status).toBe(200);
    const html = await startRes.text();
    expect(html).toContain("otpauth://totp/");
    expect(await prisma.userMfaMethod.count({ where: { user_id: admin!.id, type: "totp" } })).toBe(1);
  });
});

describe("logout revokes trusted device", () => {
  it("API logout invalidates remembered device token", async () => {
    const admin = await prisma.user.findUnique({ where: { email: adminEmail } });
    const secret = generateTotpSecret();
    await prisma.userMfaMethod.deleteMany({ where: { user_id: admin!.id } });
    await prisma.userMfaMethod.create({
      data: {
        user_id: admin!.id,
        type: "totp",
        secret_enc: encryptTotpSecret(secret),
        confirmed_at: new Date(),
      },
    });

    const loginRes = await app.request("/api/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json", ...sameOrigin },
      body: JSON.stringify({ email: adminEmail, password: adminPassword }),
    });

    const verifyRes = await app.request("/api/auth/mfa/verify", {
      method: "POST",
      headers: { "Content-Type": "application/json", ...sameOrigin, ...cookieHeader(loginRes) },
      body: JSON.stringify({ code: generateTotpCode(secret), remember_device: true }),
    });
    expect(verifyRes.status).toBe(200);

    const trustedLine = verifyRes.headers.getSetCookie?.().find((c) =>
      c.startsWith(`${TRUSTED_DEVICE_COOKIE_NAME}=`),
    );
    expect(trustedLine).toBeTruthy();
    const trustedValue = trustedLine!.split(";")[0]!.split("=")[1]!;

    const logoutRes = await app.request("/api/auth/logout", {
      method: "POST",
      headers: {
        ...sameOrigin,
        Cookie: `${sessionCookie(loginRes)!}; ${TRUSTED_DEVICE_COOKIE_NAME}=${trustedValue}`,
      },
    });
    expect(logoutRes.status).toBe(200);

    expect(await validateTrustedDevice(prisma, admin!.id, trustedValue)).toBe(false);
  });
});
