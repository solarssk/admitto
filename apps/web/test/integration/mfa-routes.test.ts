import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PrismaClient } from "@admitto/db";
import { createTestPrismaClient } from "@admitto/db/testing";
import {
  hashPassword,
  LOGIN_NEXT,
  TRUSTED_DEVICE_COOKIE_NAME,
  validateTrustedDevice,
  parseTotpSecretFromOtpauthUri,
  beginWebauthnRegistration,
  finishWebauthnRegistration,
  markBackupCodesAcknowledged,
  SETTING_WEBAUTHN_ENABLED,
} from "@admitto/auth";
import { encryptTotpSecret, generateTotpSecret, generateTotpCode } from "@admitto/auth/testing";
import { createVirtualAuthenticator } from "@admitto/auth/webauthn-testing";
import { createApp } from "../../src/app.js";
import { clearEnrollmentBackupCacheForTests } from "../../src/auth/enrollment-backup-cache.js";
import { InMemoryRateLimitStore } from "../../src/rate-limit/index.js";

const CHECKIN_TOKEN = "test-checkin-mfa-token-32chars!!";
const EVENT_ID = "event-mfa-web";
const ORG_ID = "org_mfa_web";
const adminEmail = "web-admin@example.com";
const adminPassword = "web-admin-pass-123";
const operatorEmail = "web-op@example.com";
const WEBAUTHN_RP = { rpName: "Admitto", rpID: "tickets.example.com", origin: "https://tickets.example.com" };
function extractBackupCodes(html: string): string[] {
  const section = html.match(/<div class="auth-backup">([\s\S]*?)<\/div>/);
  if (!section?.[1]) return [];
  return [...section[1].matchAll(/<code>([^<]+)<\/code>/g)]
    .map((m) => m[1])
    .filter((code): code is string => Boolean(code));
}

function extractOtpauthUri(html: string): string | null {
  const match = html.match(/href="(otpauth:\/\/totp\/[^"]+)"/);
  return match?.[1] ?? null;
}

async function confirmHtmlEnrollAndReachBackupCodes(
  loginRes: Response,
  startHtml: string,
): Promise<{ backupCodesRes: Response; backupHtml: string }> {
  const otpauth = extractOtpauthUri(startHtml);
  expect(otpauth).toBeTruthy();
  const secret = parseTotpSecretFromOtpauthUri(otpauth!);
  expect(secret).toBeTruthy();

  const confirmRes = await app.request("/mfa/enroll", {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      ...sameOrigin,
      ...cookieHeader(loginRes),
    },
    body: new URLSearchParams({ code: generateTotpCode(secret!) }).toString(),
    redirect: "manual",
  });
  expect(confirmRes.status).toBe(302);
  expect(confirmRes.headers.get("location")).toBe("/mfa/enroll/backup-codes");

  const backupCodesRes = await app.request("/mfa/enroll/backup-codes", {
    headers: { ...sameOrigin, ...cookieHeader(loginRes) },
  });
  expect(backupCodesRes.status).toBe(200);
  return { backupCodesRes, backupHtml: await backupCodesRes.text() };
}

const sameOrigin = { Origin: "http://localhost" };

let prisma: PrismaClient;
let app: ReturnType<typeof createApp>;
let rateLimitStore: InMemoryRateLimitStore;

async function seedMfaFixtures(client: PrismaClient): Promise<void> {
  const emails = [adminEmail, operatorEmail];
  const existingUsers = await client.user.findMany({
    where: { email: { in: emails } },
    select: { id: true },
  });
  const userIds = existingUsers.map((u) => u.id);
  if (userIds.length > 0) {
    await client.adminAuditLog.deleteMany({ where: { actor_user_id: { in: userIds } } });
    await client.securityAuditLog.deleteMany({ where: { user_id: { in: userIds } } });
  }
  await client.adminAuditLog.deleteMany({ where: { organization_id: ORG_ID } });
  await client.session.deleteMany({ where: { user: { email: { in: emails } } } });
  await client.trustedDevice.deleteMany({ where: { user: { email: { in: emails } } } });
  await client.userMfaMethod.deleteMany({ where: { user: { email: { in: emails } } } });
  await client.roleAssignment.deleteMany({
    where: { OR: [{ scope_id: ORG_ID }, { scope_id: EVENT_ID }, { user: { email: { in: emails } } }] },
  });
  await client.user.deleteMany({ where: { email: { in: emails } } });
  await client.event.deleteMany({ where: { id: EVENT_ID } });
  await client.organization.deleteMany({ where: { id: ORG_ID } });
}

function sessionCookie(res: Response): string | undefined {
  const setCookie = res.headers.getSetCookie?.() ?? [];
  const line = setCookie.find((c) => c.startsWith("admitto_session="));
  return line?.split(";")[0];
}

function cookieHeader(res: Response): Record<string, string> {
  const line = sessionCookie(res);
  return line ? { Cookie: line } : {};
}

async function resetAdminAuthLabState(userId: string): Promise<void> {
  rateLimitStore.reset();
  clearEnrollmentBackupCacheForTests();
  await prisma.userMfaMethod.deleteMany({ where: { user_id: userId } });
  await prisma.trustedDevice.updateMany({
    where: { user_id: userId, revoked_at: null },
    data: { revoked_at: new Date() },
  });
  await prisma.session.updateMany({
    where: { user_id: userId, revoked_at: null },
    data: { revoked_at: new Date() },
  });
}

/** Register + acknowledge a confirmed WebAuthn credential directly against `prisma` (bypassing
 * the HTTP ceremony), so a test can then sign this same file's own `WEBAUTHN_RP` challenges with
 * the returned virtual authenticator. Mirrors `registerConfirmedWebauthnCredential` in
 * account-routes.test.ts, but scoped to this file's `tickets.example.com` RP. Note:
 * `userMfaMethod` is shared with `type: "recovery"` backup-code rows auto-created alongside a
 * user's first-ever confirmed MFA method — filter by `type` in any row-count assertion. */
async function registerConfirmedWebauthnCredential(uid: string, label = "Seeded key") {
  const authenticator = createVirtualAuthenticator();
  const begin = await beginWebauthnRegistration(prisma, uid, "platform", WEBAUTHN_RP);
  if (!begin) throw new Error("beginWebauthnRegistration failed");
  const response = authenticator.register({ challenge: begin.challenge, rpID: WEBAUTHN_RP.rpID, origin: WEBAUTHN_RP.origin });
  const result = await finishWebauthnRegistration(prisma, uid, response, begin.challenge, "platform", label, WEBAUTHN_RP);
  if (!result) throw new Error("finishWebauthnRegistration failed");
  await markBackupCodesAcknowledged(prisma, uid);
  return { ...result, authenticator };
}

beforeAll(async () => {
  prisma = createTestPrismaClient();
  await seedMfaFixtures(prisma);

  const password_hash = await hashPassword(adminPassword);
  const op_hash = await hashPassword("web-op-pass-123");

  await prisma.organization.create({
    data: { id: ORG_ID, name: "MFA Org", slug: "mfa-org" },
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

  rateLimitStore = new InMemoryRateLimitStore();
  app = createApp({
    prisma,
    checkinToken: CHECKIN_TOKEN,
    allowCheckinBearer: false,
    baseUrl: "https://tickets.example.com",
    rateLimitStore,
    skipCheckinBootValidation: true,
  });
});

afterAll(async () => {
  await seedMfaFixtures(prisma);
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

describe("MFA enroll rate limit", () => {
  it("returns 429 after repeated enroll API calls", async () => {
    const admin = await prisma.user.findUnique({ where: { email: adminEmail } });
    await prisma.userMfaMethod.deleteMany({ where: { user_id: admin!.id } });

    const isolatedStore = new InMemoryRateLimitStore();
    const limitedApp = createApp({
      prisma,
      checkinToken: CHECKIN_TOKEN,
      allowCheckinBearer: false,
      baseUrl: "https://tickets.example.com",
      rateLimitStore: isolatedStore,
      skipCheckinBootValidation: true,
    });

    const loginRes = await limitedApp.request("/api/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json", ...sameOrigin },
      body: JSON.stringify({ email: adminEmail, password: adminPassword }),
    });

    let lastStatus = 0;
    for (let i = 0; i < 12; i++) {
      const res = await limitedApp.request("/api/auth/mfa/totp/enroll", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...sameOrigin, ...cookieHeader(loginRes) },
      });
      lastStatus = res.status;
      if (lastStatus === 429) break;
    }
    expect(lastStatus).toBe(429);
  });
});

describe("HTML /mfa/verify — passkey button", () => {
  it("shows the passkey button when the account has a confirmed WebAuthn credential", async () => {
    const admin = await prisma.user.findUnique({ where: { email: adminEmail } });
    await resetAdminAuthLabState(admin!.id);
    await registerConfirmedWebauthnCredential(admin!.id);

    const loginRes = await app.request("/api/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json", ...sameOrigin },
      body: JSON.stringify({ email: adminEmail, password: adminPassword }),
    });

    const verifyPage = await app.request("/mfa/verify", {
      headers: { ...sameOrigin, ...cookieHeader(loginRes) },
    });
    expect(verifyPage.status).toBe(200);
    const html = await verifyPage.text();
    expect(html).toContain('id="mfa-webauthn-btn"');
  });

  it("hides the passkey button when the account has no confirmed WebAuthn credential", async () => {
    const admin = await prisma.user.findUnique({ where: { email: adminEmail } });
    await resetAdminAuthLabState(admin!.id);
    const secret = generateTotpSecret();
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

    const verifyPage = await app.request("/mfa/verify", {
      headers: { ...sameOrigin, ...cookieHeader(loginRes) },
    });
    expect(verifyPage.status).toBe(200);
    expect(await verifyPage.text()).not.toContain('id="mfa-webauthn-btn"');
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

    // Enroll HTML ships nonce-gated CSP; every inline script carries the response nonce (#253).
    const csp = startRes.headers.get("content-security-policy") ?? "";
    expect(csp).not.toContain("script-src 'unsafe-inline'");
    const nonce = csp.match(/script-src 'nonce-([^']+)'/)?.[1];
    expect(nonce).toBeTruthy();

    const html = await startRes.text();
    const openTags = html.split("<script").length - 1;
    const noncedTags = html.split(`<script nonce="${nonce}">`).length - 1;
    expect(openTags).toBeGreaterThan(0);
    expect(noncedTags).toBe(openTags);

    expect(html).toContain("otpauth://totp/");
    expect(html).toContain('class="auth-qr"');
    expect(html).toContain("Copy setup key");
    expect(html).toContain("Try opening in your authenticator app");
    expect(html).toContain("auth-mfa-mobile-only");
    expect(html).toContain("auth-mfa-desktop-hint");
    expect(html).not.toContain("Open in password manager");
    expect(html).toContain('id="enroll-secret"');
    expect(html).not.toContain("Save your backup codes");
    expect(extractBackupCodes(html)).toEqual([]);
    expect(await prisma.userMfaMethod.count({ where: { user_id: admin!.id, type: "totp" } })).toBe(1);
  });

  it("POST /mfa/enroll/download-codes returns attachment on backup-codes step", async () => {
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
    const startHtml = await startRes.text();

    const { backupHtml } = await confirmHtmlEnrollAndReachBackupCodes(loginRes, startHtml);
    const codeMatches = extractBackupCodes(backupHtml);
    expect(codeMatches.length).toBeGreaterThan(0);

    const downloadRes = await app.request("/mfa/enroll/download-codes", {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        ...sameOrigin,
        ...cookieHeader(loginRes),
      },
      body: new URLSearchParams(
        codeMatches.map((code) => ["code", code] as [string, string]),
      ).toString(),
    });
    expect(downloadRes.status).toBe(200);
    expect(downloadRes.headers.get("content-disposition")).toContain("admitto-backup-codes.txt");
    const body = await downloadRes.text();
    for (const code of codeMatches) {
      expect(body).toContain(code);
    }
  });

  it("POST /mfa/enroll/download-codes redirects without enrollment session", async () => {
    const res = await app.request("/mfa/enroll/download-codes", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded", ...sameOrigin },
      body: "code=abc123",
      redirect: "manual",
    });
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe("/login");
  });

  it("POST /mfa/enroll/download-codes rejects tampered codes", async () => {
    const admin = await prisma.user.findUnique({ where: { email: adminEmail } });
    await prisma.userMfaMethod.deleteMany({ where: { user_id: admin!.id } });

    const loginRes = await app.request("/api/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json", ...sameOrigin },
      body: JSON.stringify({ email: adminEmail, password: adminPassword }),
    });

    await app.request("/mfa/enroll/start", {
      method: "POST",
      headers: { ...sameOrigin, ...cookieHeader(loginRes) },
    });

    const downloadRes = await app.request("/mfa/enroll/download-codes", {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        ...sameOrigin,
        ...cookieHeader(loginRes),
      },
      body: new URLSearchParams([["code", "FAKE-CODE-0001"]]).toString(),
    });
    expect(downloadRes.status).toBe(400);
  });

  it("POST /mfa/enroll keeps QR step after invalid confirmation code (no backup codes yet)", async () => {
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
    const startHtml = await startRes.text();
    expect(extractBackupCodes(startHtml)).toEqual([]);

    const failRes = await app.request("/mfa/enroll", {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        ...sameOrigin,
        ...cookieHeader(loginRes),
      },
      body: new URLSearchParams({ code: "000000" }).toString(),
    });
    expect(failRes.status).toBe(401);
    const retryHtml = await failRes.text();
    expect(retryHtml).toContain("Invalid code");
    expect(retryHtml).toContain('class="auth-qr"');
    expect(retryHtml).not.toContain("Download backup codes");
    expect(extractBackupCodes(retryHtml)).toEqual([]);
  });

  it("HTML enroll flow reaches app after backup-codes acknowledgment", async () => {
    const admin = await prisma.user.findUnique({ where: { email: adminEmail } });
    await resetAdminAuthLabState(admin!.id);

    const loginRes = await app.request("/api/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json", ...sameOrigin },
      body: JSON.stringify({ email: adminEmail, password: adminPassword }),
    });
    expect(loginRes.status).toBe(200);

    const startRes = await app.request("/mfa/enroll/start", {
      method: "POST",
      headers: { ...sameOrigin, ...cookieHeader(loginRes) },
    });
    expect(startRes.status).toBe(200);
    const startHtml = await startRes.text();
    await confirmHtmlEnrollAndReachBackupCodes(loginRes, startHtml);

    const finishRes = await app.request("/mfa/enroll/backup-codes", {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        ...sameOrigin,
        ...cookieHeader(loginRes),
      },
      redirect: "manual",
    });
    expect(finishRes.status).toBe(302);

    const me = await app.request("/api/auth/me", {
      headers: { ...sameOrigin, ...cookieHeader(loginRes) },
    });
    expect(me.status).toBe(200);
  });
});

describe("IAM-002 backup-code acknowledgment cannot be skipped via a fresh login", () => {
  it("verifying TOTP on a new login with unacknowledged codes yields backup_codes_required, not full", async () => {
    const admin = await prisma.user.findUnique({ where: { email: adminEmail } });
    await resetAdminAuthLabState(admin!.id);
    clearEnrollmentBackupCacheForTests();
    const secret = generateTotpSecret();
    // Simulate a TOTP that was just confirmed but whose backup codes were never acknowledged.
    await prisma.userMfaMethod.create({
      data: {
        user_id: admin!.id,
        type: "totp",
        secret_enc: encryptTotpSecret(secret),
        confirmed_at: new Date(),
        backup_codes_acknowledged_at: null,
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

    const verifyRes = await app.request("/api/auth/mfa/verify", {
      method: "POST",
      headers: { "Content-Type": "application/json", ...sameOrigin, ...cookieHeader(loginRes) },
      body: JSON.stringify({ code: generateTotpCode(secret) }),
    });
    expect(verifyRes.status).toBe(200);
    const verifyBody = (await verifyRes.json()) as { next: string; backup_codes?: string[] };
    // Must NOT be a full session — user still owes backup-code acknowledgment.
    expect(verifyBody.next).toBe(LOGIN_NEXT.BACKUP_CODES_REQUIRED);
    expect(Array.isArray(verifyBody.backup_codes)).toBe(true);
    expect(verifyBody.backup_codes!.length).toBeGreaterThan(0);

    const me = await app.request("/api/auth/me", {
      headers: { ...sameOrigin, ...cookieHeader(loginRes) },
    });
    expect(me.status).toBe(401);

    // Acknowledging the codes finally promotes the session to full.
    const finishRes = await app.request("/api/auth/mfa/totp/backup-codes/complete", {
      method: "POST",
      headers: { "Content-Type": "application/json", ...sameOrigin, ...cookieHeader(loginRes) },
    });
    expect(finishRes.status).toBe(200);

    const meFull = await app.request("/api/auth/me", {
      headers: { ...sameOrigin, ...cookieHeader(loginRes) },
    });
    expect(meFull.status).toBe(200);
  });
});

describe("IAM-001/IAM-003 forced password change is enforced at the session layer", () => {
  it("blocks protected APIs until the password is changed and requires the full-length policy", async () => {
    const op = await prisma.user.findUnique({ where: { email: operatorEmail } });
    await prisma.session.updateMany({
      where: { user_id: op!.id, revoked_at: null },
      data: { revoked_at: new Date() },
    });
    await prisma.user.update({ where: { id: op!.id }, data: { must_change_password: true } });

    try {
      const loginRes = await app.request("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...sameOrigin },
        body: JSON.stringify({ email: operatorEmail, password: "web-op-pass-123" }),
      });
      expect(loginRes.status).toBe(200);
      expect((await loginRes.json()) as { next: string }).toEqual(
        expect.objectContaining({ next: LOGIN_NEXT.CHANGE_PASSWORD }),
      );

      // Session is constrained: a protected route must reject it (IAM-001).
      const blocked = await app.request("/api/checkin/events", {
        headers: { ...sameOrigin, ...cookieHeader(loginRes) },
      });
      expect(blocked.status).toBe(401);

      // IAM-003: an 11-character password is below the 12-char policy.
      const tooShort = await app.request("/change-password", {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
          ...sameOrigin,
          ...cookieHeader(loginRes),
        },
        body: new URLSearchParams({ password: "elevenchar1", password_confirm: "elevenchar1" }).toString(),
        redirect: "manual",
      });
      expect(tooShort.status).toBe(400);

      const newPassword = "brand-new-password-123";
      const changed = await app.request("/change-password", {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
          ...sameOrigin,
          ...cookieHeader(loginRes),
        },
        body: new URLSearchParams({ password: newPassword, password_confirm: newPassword }).toString(),
        redirect: "manual",
      });
      expect(changed.status).toBe(302);

      const refreshed = await prisma.user.findUnique({
        where: { id: op!.id },
        select: { must_change_password: true },
      });
      expect(refreshed?.must_change_password).toBe(false);
      expect(
        await prisma.adminAuditLog.findFirst({
          where: { action_type: "account_password_changed", actor_user_id: op!.id },
          orderBy: { created_at: "desc" },
        }),
      ).toMatchObject({ metadata: { forced: true } });

      // The same session is now full and may reach protected routes.
      const allowed = await app.request("/api/checkin/events", {
        headers: { ...sameOrigin, ...cookieHeader(loginRes) },
      });
      expect(allowed.status).toBe(200);
    } finally {
      await prisma.user.update({
        where: { id: op!.id },
        data: { must_change_password: false, password_hash: await hashPassword("web-op-pass-123") },
      });
      await prisma.session.updateMany({
        where: { user_id: op!.id, revoked_at: null },
        data: { revoked_at: new Date() },
      });
    }
  });

  it("MFA user with must_change_password gets change_password after TOTP verify", async () => {
    const admin = await prisma.user.findUnique({ where: { email: adminEmail } });
    await resetAdminAuthLabState(admin!.id);
    const secret = generateTotpSecret();
    await prisma.userMfaMethod.create({
      data: {
        user_id: admin!.id,
        type: "totp",
        secret_enc: encryptTotpSecret(secret),
        confirmed_at: new Date(),
        backup_codes_acknowledged_at: new Date(),
      },
    });
    await prisma.user.update({
      where: { id: admin!.id },
      data: { must_change_password: true },
    });

    try {
      const loginRes = await app.request("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...sameOrigin },
        body: JSON.stringify({ email: adminEmail, password: adminPassword }),
      });
      expect(loginRes.status).toBe(200);
      expect((await loginRes.json()) as { next: string }).toEqual(
        expect.objectContaining({ next: LOGIN_NEXT.MFA_REQUIRED }),
      );

      const verifyRes = await app.request("/api/auth/mfa/verify", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...sameOrigin, ...cookieHeader(loginRes) },
        body: JSON.stringify({ code: generateTotpCode(secret) }),
      });
      expect(verifyRes.status).toBe(200);
      expect((await verifyRes.json()) as { next: string }).toEqual(
        expect.objectContaining({ next: LOGIN_NEXT.CHANGE_PASSWORD }),
      );

      const blocked = await app.request("/api/auth/me", {
        headers: { ...sameOrigin, ...cookieHeader(loginRes) },
      });
      expect(blocked.status).toBe(401);
    } finally {
      await prisma.user.update({
        where: { id: admin!.id },
        data: { must_change_password: false },
      });
      await resetAdminAuthLabState(admin!.id);
    }
  });
});

describe("logout revokes trusted device", () => {
  it("API logout invalidates remembered device token", async () => {
    const admin = await prisma.user.findUnique({ where: { email: adminEmail } });
    await resetAdminAuthLabState(admin!.id);
    const secret = generateTotpSecret();
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
    expect((await loginRes.clone().json()) as { next: string }).toEqual(
      expect.objectContaining({ next: LOGIN_NEXT.MFA_REQUIRED }),
    );

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

describe("POST /api/auth/mfa/webauthn — login-time WebAuthn", () => {
  it("completes login with a valid WebAuthn assertion, sets remember-device cookie, and lands on a working session", async () => {
    const admin = await prisma.user.findUnique({ where: { email: adminEmail } });
    await resetAdminAuthLabState(admin!.id);
    const credential = await registerConfirmedWebauthnCredential(admin!.id);

    const loginRes = await app.request("/api/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json", ...sameOrigin },
      body: JSON.stringify({ email: adminEmail, password: adminPassword }),
    });
    expect((await loginRes.json()) as { next: string }).toEqual(
      expect.objectContaining({ next: LOGIN_NEXT.MFA_REQUIRED }),
    );

    const beginRes = await app.request("/api/auth/mfa/webauthn/begin", {
      method: "POST",
      headers: { "Content-Type": "application/json", ...sameOrigin, ...cookieHeader(loginRes) },
      body: "{}",
    });
    expect(beginRes.status).toBe(200);
    const { options } = (await beginRes.json()) as { options: { challenge: string } };

    const response = credential.authenticator.authenticate({
      challenge: options.challenge,
      rpID: WEBAUTHN_RP.rpID,
      origin: WEBAUTHN_RP.origin,
    });

    const verifyRes = await app.request("/api/auth/mfa/webauthn/verify", {
      method: "POST",
      headers: { "Content-Type": "application/json", ...sameOrigin, ...cookieHeader(loginRes) },
      body: JSON.stringify({ response, remember_device: true }),
    });
    expect(verifyRes.status).toBe(200);
    const verifyBody = (await verifyRes.json()) as { ok: boolean; next: string };
    expect(verifyBody.ok).toBe(true);
    expect(verifyBody.next).toBeTruthy();

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

  it("returns 401 invalid_webauthn for a forged assertion and does not grant a session", async () => {
    const admin = await prisma.user.findUnique({ where: { email: adminEmail } });
    await resetAdminAuthLabState(admin!.id);
    await registerConfirmedWebauthnCredential(admin!.id);
    const wrongAuthenticator = createVirtualAuthenticator();

    const loginRes = await app.request("/api/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json", ...sameOrigin },
      body: JSON.stringify({ email: adminEmail, password: adminPassword }),
    });

    const beginRes = await app.request("/api/auth/mfa/webauthn/begin", {
      method: "POST",
      headers: { "Content-Type": "application/json", ...sameOrigin, ...cookieHeader(loginRes) },
      body: "{}",
    });
    const { options } = (await beginRes.json()) as { options: { challenge: string } };

    const response = wrongAuthenticator.authenticate({
      challenge: options.challenge,
      rpID: WEBAUTHN_RP.rpID,
      origin: WEBAUTHN_RP.origin,
    });

    const verifyRes = await app.request("/api/auth/mfa/webauthn/verify", {
      method: "POST",
      headers: { "Content-Type": "application/json", ...sameOrigin, ...cookieHeader(loginRes) },
      body: JSON.stringify({ response }),
    });
    expect(verifyRes.status).toBe(401);
    expect(((await verifyRes.json()) as { code: string }).code).toBe("invalid_webauthn");

    const me = await app.request("/api/auth/me", {
      headers: { ...sameOrigin, ...cookieHeader(loginRes) },
    });
    expect(me.status).toBe(401);
  });

  it("returns 400 no_credentials from begin when the user has none registered", async () => {
    const admin = await prisma.user.findUnique({ where: { email: adminEmail } });
    await resetAdminAuthLabState(admin!.id);
    const secret = generateTotpSecret();
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

    const beginRes = await app.request("/api/auth/mfa/webauthn/begin", {
      method: "POST",
      headers: { "Content-Type": "application/json", ...sameOrigin, ...cookieHeader(loginRes) },
      body: "{}",
    });
    expect(beginRes.status).toBe(400);
    expect(((await beginRes.json()) as { code: string }).code).toBe("no_credentials");
  });

  it("returns 400 challenge_expired when verify is called without a matching begin", async () => {
    const admin = await prisma.user.findUnique({ where: { email: adminEmail } });
    await resetAdminAuthLabState(admin!.id);
    await registerConfirmedWebauthnCredential(admin!.id);

    const loginRes = await app.request("/api/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json", ...sameOrigin },
      body: JSON.stringify({ email: adminEmail, password: adminPassword }),
    });

    const verifyRes = await app.request("/api/auth/mfa/webauthn/verify", {
      method: "POST",
      headers: { "Content-Type": "application/json", ...sameOrigin, ...cookieHeader(loginRes) },
      body: JSON.stringify({
        response: {
          id: "x",
          rawId: "x",
          type: "public-key",
          clientExtensionResults: {},
          response: { clientDataJSON: "x", authenticatorData: "x", signature: "x" },
        },
      }),
    });
    expect(verifyRes.status).toBe(400);
    expect(((await verifyRes.json()) as { code: string }).code).toBe("challenge_expired");
  });

  it("a valid assertion is rejected with 403 webauthn_disabled when the instance setting is off", async () => {
    const admin = await prisma.user.findUnique({ where: { email: adminEmail } });
    await resetAdminAuthLabState(admin!.id);
    await registerConfirmedWebauthnCredential(admin!.id);

    const loginRes = await app.request("/api/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json", ...sameOrigin },
      body: JSON.stringify({ email: adminEmail, password: adminPassword }),
    });

    try {
      await prisma.systemSettings.upsert({
        where: { key: SETTING_WEBAUTHN_ENABLED },
        create: { key: SETTING_WEBAUTHN_ENABLED, value_json: "false" },
        update: { value_json: "false" },
      });

      const beginRes = await app.request("/api/auth/mfa/webauthn/begin", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...sameOrigin, ...cookieHeader(loginRes) },
        body: "{}",
      });
      expect(beginRes.status).toBe(403);
      expect(((await beginRes.json()) as { code: string }).code).toBe("webauthn_disabled");
    } finally {
      await prisma.systemSettings.deleteMany({ where: { key: SETTING_WEBAUTHN_ENABLED } });
    }
  });

  it("lands on the backup-codes step when the freshly-confirmed credential's codes are unacknowledged", async () => {
    const admin = await prisma.user.findUnique({ where: { email: adminEmail } });
    await resetAdminAuthLabState(admin!.id);
    const authenticator = createVirtualAuthenticator();
    const begin = await beginWebauthnRegistration(prisma, admin!.id, "platform", WEBAUTHN_RP);
    const response = authenticator.register({ challenge: begin!.challenge, rpID: WEBAUTHN_RP.rpID, origin: WEBAUTHN_RP.origin });
    // Deliberately skip markBackupCodesAcknowledged, unlike registerConfirmedWebauthnCredential -
    // this is what promotes the completed session into BACKUP_CODES_REQUIRED instead of FULL.
    await finishWebauthnRegistration(prisma, admin!.id, response, begin!.challenge, "platform", "Seeded key", WEBAUTHN_RP);

    const loginRes = await app.request("/api/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json", ...sameOrigin },
      body: JSON.stringify({ email: adminEmail, password: adminPassword }),
    });

    const beginRes = await app.request("/api/auth/mfa/webauthn/begin", {
      method: "POST",
      headers: { "Content-Type": "application/json", ...sameOrigin, ...cookieHeader(loginRes) },
      body: "{}",
    });
    const { options } = (await beginRes.json()) as { options: { challenge: string } };
    const assertion = authenticator.authenticate({ challenge: options.challenge, rpID: WEBAUTHN_RP.rpID, origin: WEBAUTHN_RP.origin });

    const verifyRes = await app.request("/api/auth/mfa/webauthn/verify", {
      method: "POST",
      headers: { "Content-Type": "application/json", ...sameOrigin, ...cookieHeader(loginRes) },
      body: JSON.stringify({ response: assertion }),
    });
    expect(verifyRes.status).toBe(200);
    expect(((await verifyRes.json()) as { next: string }).next).toBe("/mfa/enroll/backup-codes");
  });

  it("lands on change-password when the account must change its password", async () => {
    const admin = await prisma.user.findUnique({ where: { email: adminEmail } });
    await resetAdminAuthLabState(admin!.id);
    const credential = await registerConfirmedWebauthnCredential(admin!.id);

    const loginRes = await app.request("/api/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json", ...sameOrigin },
      body: JSON.stringify({ email: adminEmail, password: adminPassword }),
    });

    try {
      await prisma.user.update({ where: { id: admin!.id }, data: { must_change_password: true } });

      const beginRes = await app.request("/api/auth/mfa/webauthn/begin", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...sameOrigin, ...cookieHeader(loginRes) },
        body: "{}",
      });
      const { options } = (await beginRes.json()) as { options: { challenge: string } };
      const response = credential.authenticator.authenticate({
        challenge: options.challenge,
        rpID: WEBAUTHN_RP.rpID,
        origin: WEBAUTHN_RP.origin,
      });

      const verifyRes = await app.request("/api/auth/mfa/webauthn/verify", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...sameOrigin, ...cookieHeader(loginRes) },
        body: JSON.stringify({ response }),
      });
      expect(verifyRes.status).toBe(200);
      expect(((await verifyRes.json()) as { next: string }).next).toBe("/change-password");
    } finally {
      await prisma.user.update({ where: { id: admin!.id }, data: { must_change_password: false } });
    }
  });

  it("returns 429 too many requests when the WebAuthn step-up rate limit is exceeded", async () => {
    const admin = await prisma.user.findUnique({ where: { email: adminEmail } });
    await resetAdminAuthLabState(admin!.id);
    await registerConfirmedWebauthnCredential(admin!.id);

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

    // The rate-limit check runs before the challenge is consumed, so repeating the same
    // (already-stale after the first attempt) verify call still exercises the limiter.
    let lastStatus = 0;
    for (let i = 0; i < 12; i++) {
      const res = await limitedApp.request("/api/auth/mfa/webauthn/verify", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...sameOrigin, ...cookieHeader(loginRes) },
        body: JSON.stringify({
          response: {
            id: "x",
            rawId: "x",
            type: "public-key",
            clientExtensionResults: {},
            response: { clientDataJSON: "x", authenticatorData: "x", signature: "x" },
          },
        }),
      });
      lastStatus = res.status;
      if (lastStatus === 429) break;
    }
    expect(lastStatus).toBe(429);
  });

  it("returns 401 from begin and verify when the session is partial but not MFA_PENDING", async () => {
    const admin = await prisma.user.findUnique({ where: { email: adminEmail } });
    await resetAdminAuthLabState(admin!.id);
    // No MFA method registered - the admin role requires MFA, so login lands the session in
    // ENROLLMENT_REQUIRED (allowed by the app-level requirePartialSession gate, which only
    // rejects a FULL session), letting these handlers' own narrower MFA_PENDING check be reached.

    const loginRes = await app.request("/api/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json", ...sameOrigin },
      body: JSON.stringify({ email: adminEmail, password: adminPassword }),
    });
    expect((await loginRes.json()) as { next: string }).toEqual(
      expect.objectContaining({ next: LOGIN_NEXT.ENROLLMENT_REQUIRED }),
    );

    const beginRes = await app.request("/api/auth/mfa/webauthn/begin", {
      method: "POST",
      headers: { "Content-Type": "application/json", ...sameOrigin, ...cookieHeader(loginRes) },
      body: "{}",
    });
    expect(beginRes.status).toBe(401);

    const verifyRes = await app.request("/api/auth/mfa/webauthn/verify", {
      method: "POST",
      headers: { "Content-Type": "application/json", ...sameOrigin, ...cookieHeader(loginRes) },
      body: JSON.stringify({
        response: {
          id: "x",
          rawId: "x",
          type: "public-key",
          clientExtensionResults: {},
          response: { clientDataJSON: "x", authenticatorData: "x", signature: "x" },
        },
      }),
    });
    expect(verifyRes.status).toBe(401);
  });

  it("returns 400 invalid JSON when verify's body cannot be parsed", async () => {
    const admin = await prisma.user.findUnique({ where: { email: adminEmail } });
    await resetAdminAuthLabState(admin!.id);
    await registerConfirmedWebauthnCredential(admin!.id);

    const loginRes = await app.request("/api/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json", ...sameOrigin },
      body: JSON.stringify({ email: adminEmail, password: adminPassword }),
    });

    const verifyRes = await app.request("/api/auth/mfa/webauthn/verify", {
      method: "POST",
      headers: { "Content-Type": "application/json", ...sameOrigin, ...cookieHeader(loginRes) },
      body: "not json",
    });
    expect(verifyRes.status).toBe(400);
    expect(((await verifyRes.json()) as { error: string }).error).toBe("invalid JSON");
  });

  it("returns 400 invalid body when verify's response field fails schema validation", async () => {
    const admin = await prisma.user.findUnique({ where: { email: adminEmail } });
    await resetAdminAuthLabState(admin!.id);
    await registerConfirmedWebauthnCredential(admin!.id);

    const loginRes = await app.request("/api/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json", ...sameOrigin },
      body: JSON.stringify({ email: adminEmail, password: adminPassword }),
    });

    const verifyRes = await app.request("/api/auth/mfa/webauthn/verify", {
      method: "POST",
      headers: { "Content-Type": "application/json", ...sameOrigin, ...cookieHeader(loginRes) },
      body: JSON.stringify({ response: { not: "a valid assertion" } }),
    });
    expect(verifyRes.status).toBe(400);
    expect(((await verifyRes.json()) as { error: string }).error).toBe("invalid body");
  });

  it("verify also rejects with 403 webauthn_disabled when the instance setting is off", async () => {
    const admin = await prisma.user.findUnique({ where: { email: adminEmail } });
    await resetAdminAuthLabState(admin!.id);
    await registerConfirmedWebauthnCredential(admin!.id);

    const loginRes = await app.request("/api/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json", ...sameOrigin },
      body: JSON.stringify({ email: adminEmail, password: adminPassword }),
    });

    try {
      await prisma.systemSettings.upsert({
        where: { key: SETTING_WEBAUTHN_ENABLED },
        create: { key: SETTING_WEBAUTHN_ENABLED, value_json: "false" },
        update: { value_json: "false" },
      });

      const verifyRes = await app.request("/api/auth/mfa/webauthn/verify", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...sameOrigin, ...cookieHeader(loginRes) },
        body: JSON.stringify({
          response: {
            id: "x",
            rawId: "x",
            type: "public-key",
            clientExtensionResults: {},
            response: { clientDataJSON: "x", authenticatorData: "x", signature: "x" },
          },
        }),
      });
      expect(verifyRes.status).toBe(403);
      expect(((await verifyRes.json()) as { code: string }).code).toBe("webauthn_disabled");
    } finally {
      await prisma.systemSettings.deleteMany({ where: { key: SETTING_WEBAUTHN_ENABLED } });
    }
  });
});
