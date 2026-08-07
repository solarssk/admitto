import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { PrismaClient } from "@admitto/db";
import { createTestPrismaClient } from "@admitto/db/testing";
import {
  beginWebauthnRegistration,
  bootstrapSuperadmin,
  createSession,
  finishWebauthnRegistration,
  hashPassword,
  markBackupCodesAcknowledged,
  SESSION_STAGE,
  SETTING_WEBAUTHN_ENABLED,
} from "@admitto/auth";
import { createVirtualAuthenticator } from "@admitto/auth/webauthn-testing";
import { createApp } from "../../src/app.js";
import { InMemoryRateLimitStore } from "../../src/rate-limit/in-memory.js";

const adminDistRoot = join(dirname(fileURLToPath(import.meta.url)), "../fixtures/admin-dist");
const sameOrigin = { Origin: "http://localhost" };
const BASE_URL = "https://admitto.example.com";
const RP_ID = "admitto.example.com";

const ORG_WEBAUTHN = "org-webauthn-account-test";
const EMAIL_USER = "webauthn-user@example.com";
const EMAIL_OTHER = "webauthn-other@example.com";
const EMAIL_OIDC = "webauthn-oidc@example.com";
const EMAIL_SUPERADMIN = "webauthn-superadmin@example.com";
const PASSWORD = "webauthn-account-pass-123";
const SUPERADMIN_PASSWORD = "webauthn-superadmin-pass-123";
const RP = { rpName: "Admitto", rpID: RP_ID, origin: BASE_URL };

let prisma: PrismaClient;
let app: ReturnType<typeof createApp>;
let rateLimitStore: InMemoryRateLimitStore;
let userId = "";
let otherUserId = "";
let oidcUserId = "";
let superadminUserId = "";
let userCookie = "";
let otherCookie = "";
let superadminCookie = "";
let prevInstanceOrgId: string | undefined;

async function seed(client: PrismaClient) {
  const emails = [EMAIL_USER, EMAIL_OTHER, EMAIL_OIDC, EMAIL_SUPERADMIN];
  await client.session.deleteMany({ where: { user: { email: { in: emails } } } });
  await client.userMfaMethod.deleteMany({ where: { user: { email: { in: emails } } } });
  await client.roleAssignment.deleteMany({ where: { OR: [{ scope_id: ORG_WEBAUTHN }, { user: { email: EMAIL_SUPERADMIN } }] } });
  await client.adminAuditLog.deleteMany({ where: { organization_id: ORG_WEBAUTHN } });
  await client.user.deleteMany({ where: { email: { in: emails } } });
  await client.organization.deleteMany({ where: { id: ORG_WEBAUTHN } });

  const password_hash = await hashPassword(PASSWORD);
  await client.organization.create({ data: { id: ORG_WEBAUTHN, name: "WebAuthn Account Test Org", slug: "webauthn-account-test" } });

  const user = await client.user.create({ data: { email: EMAIL_USER, password_hash } });
  userId = user.id;
  const otherUser = await client.user.create({ data: { email: EMAIL_OTHER, password_hash } });
  otherUserId = otherUser.id;
  const oidcUser = await client.user.create({ data: { email: EMAIL_OIDC, password_hash: null } });
  oidcUserId = oidcUser.id;

  await client.roleAssignment.createMany({
    data: [
      { user_id: userId, role: "operator", scope_type: "event", scope_id: "evt-webauthn-account" },
      { user_id: otherUserId, role: "operator", scope_type: "event", scope_id: "evt-webauthn-account" },
    ],
  });
}

beforeAll(async () => {
  prevInstanceOrgId = process.env.INSTANCE_ORG_ID;
  process.env.INSTANCE_ORG_ID = ORG_WEBAUTHN;
  prisma = createTestPrismaClient();
  await seed(prisma);
  rateLimitStore = new InMemoryRateLimitStore();
  app = createApp({
    prisma,
    baseUrl: BASE_URL,
    rateLimitStore,
    skipCheckinBootValidation: true,
    adminDistRoot,
    mailDeliveryDeps: { exportSink: () => {} },
  });

  const session = await createSession(prisma, { userId, stage: SESSION_STAGE.FULL, ip: "127.0.0.1" });
  userCookie = `admitto_session=${session.rawToken}`;
  const otherSession = await createSession(prisma, { userId: otherUserId, stage: SESSION_STAGE.FULL, ip: "127.0.0.1" });
  otherCookie = `admitto_session=${otherSession.rawToken}`;

  // MFA-required role (default `mfa_required_roles` includes superadmin). A `full` session for
  // an MFA-required user is only honored once they have a confirmed method (assertFullSessionMfaPolicy)
  // — same invariant a real login already enforces — so each test that needs this fixture's
  // session to actually work seeds one via `seedConfirmedWebauthnCredential` first.
  const superadmin = await bootstrapSuperadmin(prisma, EMAIL_SUPERADMIN, SUPERADMIN_PASSWORD);
  superadminUserId = superadmin.userId;
  const superadminSession = await createSession(prisma, { userId: superadminUserId, stage: SESSION_STAGE.FULL, ip: "127.0.0.1" });
  superadminCookie = `admitto_session=${superadminSession.rawToken}`;
});

afterEach(async () => {
  await prisma.userMfaMethod.deleteMany({ where: { user_id: userId } });
  await prisma.userMfaMethod.deleteMany({ where: { user_id: otherUserId } });
  await prisma.userMfaMethod.deleteMany({ where: { user_id: superadminUserId } });
  await prisma.systemSettings.deleteMany({ where: { key: SETTING_WEBAUTHN_ENABLED } });
  rateLimitStore.reset();
});

/** Register a confirmed WebAuthn credential directly against `prisma` (bypassing the HTTP
 * session gate) — simulates a user who already enrolled their first MFA method at login (the
 * only real way an MFA-required user reaches a `full` session at all), so tests can then drive
 * the Account API's own endpoints through a valid HTTP session. */
async function seedConfirmedWebauthnCredential(userId: string, label = "Seeded key") {
  const authenticator = createVirtualAuthenticator();
  const begin = await beginWebauthnRegistration(prisma, userId, "platform", RP);
  if (!begin) throw new Error("beginWebauthnRegistration failed");
  const response = authenticator.register({ challenge: begin.challenge, rpID: RP_ID, origin: BASE_URL });
  const result = await finishWebauthnRegistration(prisma, userId, response, begin.challenge, "platform", label, RP);
  if (!result) throw new Error("finishWebauthnRegistration failed");
  // A first-ever method leaves backup_codes_acknowledged_at null (IAM-002) — acknowledge here so
  // this fixture's session stays usable, mirroring what the self-service HTTP finish handler
  // does for a real logged-in user (see handlePostAccountWebauthnRegisterFinish).
  await markBackupCodesAcknowledged(prisma, userId);
  return result;
}

afterAll(async () => {
  if (prevInstanceOrgId !== undefined) process.env.INSTANCE_ORG_ID = prevInstanceOrgId;
  else delete process.env.INSTANCE_ORG_ID;
  await prisma?.$disconnect();
});

interface BeginResponseBody {
  options: { challenge: string; rp: { id: string; name: string }; authenticatorSelection?: { residentKey?: string; authenticatorAttachment?: string } };
}

async function beginRegistration(cookie: string, attachment: "platform" | "cross-platform") {
  const res = await app.request("/api/account/mfa/webauthn/register/begin", {
    method: "POST",
    headers: { Cookie: cookie, ...sameOrigin, "Content-Type": "application/json" },
    body: JSON.stringify({ attachment }),
  });
  return { res, body: (await res.json()) as BeginResponseBody };
}

/** Full begin → virtual-authenticator ceremony → finish round trip. `credentialId` is the raw
 * WebAuthn credential id (base64url, as it appears in `excludeCredentials`/`allowCredentials`) —
 * distinct from `finishBody.id`, which is this row's own DB id. */
async function registerCredential(
  cookie: string,
  attachment: "platform" | "cross-platform",
  label?: string,
) {
  const authenticator = createVirtualAuthenticator();
  const { body: begin } = await beginRegistration(cookie, attachment);
  const response = authenticator.register({ challenge: begin.options.challenge, rpID: RP_ID, origin: BASE_URL });

  const finishRes = await app.request("/api/account/mfa/webauthn/register/finish", {
    method: "POST",
    headers: { Cookie: cookie, ...sameOrigin, "Content-Type": "application/json" },
    body: JSON.stringify({ attachment, label, response }),
  });
  return { authenticator, credentialId: response.id, finishRes, finishBody: await finishRes.json() };
}

describe("POST /api/account/mfa/webauthn/register/begin", () => {
  it("returns registration options scoped to the instance's own RP ID", async () => {
    const { res, body } = await beginRegistration(userCookie, "platform");
    expect(res.status).toBe(200);
    expect(body.options.rp.id).toBe(RP_ID);
    expect(body.options.challenge).toBeTruthy();
  });

  it("requests a resident (discoverable) credential for a passkey", async () => {
    const { body } = await beginRegistration(userCookie, "platform");
    expect(body.options.authenticatorSelection?.residentKey).toBe("required");
    expect(body.options.authenticatorSelection?.authenticatorAttachment).toBe("platform");
  });

  it("discourages a resident credential for a security key", async () => {
    const { body } = await beginRegistration(userCookie, "cross-platform");
    expect(body.options.authenticatorSelection?.residentKey).toBe("discouraged");
    expect(body.options.authenticatorSelection?.authenticatorAttachment).toBe("cross-platform");
  });

  it("returns 400 no_local_password for an OIDC-only account", async () => {
    const oidcSession = await createSession(prisma, { userId: oidcUserId, stage: SESSION_STAGE.FULL });
    const res = await app.request("/api/account/mfa/webauthn/register/begin", {
      method: "POST",
      headers: { Cookie: `admitto_session=${oidcSession.rawToken}`, ...sameOrigin, "Content-Type": "application/json" },
      body: JSON.stringify({ attachment: "platform" }),
    });
    expect(res.status).toBe(400);
    expect(((await res.json()) as { code: string }).code).toBe("no_local_password");
    await prisma.session.delete({ where: { id: oidcSession.session.id } });
  });

  it("returns 403 webauthn_disabled when the instance setting is off", async () => {
    await prisma.systemSettings.upsert({
      where: { key: SETTING_WEBAUTHN_ENABLED },
      create: { key: SETTING_WEBAUTHN_ENABLED, value_json: "false" },
      update: { value_json: "false" },
    });
    const res = await app.request("/api/account/mfa/webauthn/register/begin", {
      method: "POST",
      headers: { Cookie: userCookie, ...sameOrigin, "Content-Type": "application/json" },
      body: JSON.stringify({ attachment: "platform" }),
    });
    expect(res.status).toBe(403);
    expect(((await res.json()) as { code: string }).code).toBe("webauthn_disabled");
  });

  it("excludes the user's own already-registered credentials", async () => {
    const first = await registerCredential(userCookie, "platform");
    const { body } = await beginRegistration(userCookie, "cross-platform");
    const excludeIds = (
      body.options as unknown as { excludeCredentials?: { id: string }[] }
    ).excludeCredentials?.map((c) => c.id);
    expect(excludeIds).toContain(first.credentialId);
  });
});

describe("POST /api/account/mfa/webauthn/register/finish", () => {
  it("registers a passkey end to end and lists it on GET /api/account", async () => {
    const { finishRes, finishBody } = await registerCredential(userCookie, "platform", "My laptop");
    expect(finishRes.status).toBe(200);
    expect((finishBody as { ok: boolean }).ok).toBe(true);
    expect((finishBody as { backupCodes: string[] }).backupCodes.length).toBeGreaterThan(0);

    const accountRes = await app.request("/api/account", { headers: { Cookie: userCookie } });
    const account = (await accountRes.json()) as {
      webauthn_enabled: boolean;
      mfa_methods: { type: string; confirmed: boolean; label?: string; attachment?: string }[];
    };
    expect(account.webauthn_enabled).toBe(true);
    const row = account.mfa_methods.find((m) => m.type === "webauthn");
    expect(row?.confirmed).toBe(true);
    expect(row?.label).toBe("My laptop");
    expect(row?.attachment).toBe("platform");
  });

  it("a second credential does not return fresh backup codes (already acknowledged from the first)", async () => {
    const first = await registerCredential(userCookie, "platform", "Key 1");
    expect((first.finishBody as { backupCodes: string[] }).backupCodes.length).toBeGreaterThan(0);

    const second = await registerCredential(userCookie, "cross-platform", "Key 2");
    expect((second.finishBody as { backupCodes: string[] }).backupCodes).toEqual([]);
  });

  it("returns 400 challenge_expired when finish is called without a matching begin", async () => {
    const authenticator = createVirtualAuthenticator();
    const response = authenticator.register({ challenge: "made-up-challenge", rpID: RP_ID, origin: BASE_URL });
    const res = await app.request("/api/account/mfa/webauthn/register/finish", {
      method: "POST",
      headers: { Cookie: userCookie, ...sameOrigin, "Content-Type": "application/json" },
      body: JSON.stringify({ attachment: "platform", response }),
    });
    expect(res.status).toBe(400);
    expect(((await res.json()) as { code: string }).code).toBe("challenge_expired");
  });

  it("returns 400 verification_failed for a response signed against a different origin", async () => {
    const authenticator = createVirtualAuthenticator();
    const { body: begin } = await beginRegistration(userCookie, "platform");
    const response = authenticator.register({
      challenge: begin.options.challenge,
      rpID: RP_ID,
      origin: "https://evil.example.com",
    });
    const res = await app.request("/api/account/mfa/webauthn/register/finish", {
      method: "POST",
      headers: { Cookie: userCookie, ...sameOrigin, "Content-Type": "application/json" },
      body: JSON.stringify({ attachment: "platform", response }),
    });
    expect(res.status).toBe(400);
    expect(((await res.json()) as { code: string }).code).toBe("verification_failed");
  });

  it("a challenge can only be used once (replay of the same begin fails)", async () => {
    const authenticator = createVirtualAuthenticator();
    const { body: begin } = await beginRegistration(userCookie, "platform");
    const response = authenticator.register({ challenge: begin.options.challenge, rpID: RP_ID, origin: BASE_URL });

    const first = await app.request("/api/account/mfa/webauthn/register/finish", {
      method: "POST",
      headers: { Cookie: userCookie, ...sameOrigin, "Content-Type": "application/json" },
      body: JSON.stringify({ attachment: "platform", response }),
    });
    expect(first.status).toBe(200);

    const replay = await app.request("/api/account/mfa/webauthn/register/finish", {
      method: "POST",
      headers: { Cookie: userCookie, ...sameOrigin, "Content-Type": "application/json" },
      body: JSON.stringify({ attachment: "platform", response }),
    });
    expect(replay.status).toBe(400);
    expect(((await replay.json()) as { code: string }).code).toBe("challenge_expired");
  });
});

describe("GET /api/account/mfa/webauthn", () => {
  it("lists registered credentials, newest last", async () => {
    await registerCredential(userCookie, "platform", "First");
    await registerCredential(userCookie, "cross-platform", "Second");

    const res = await app.request("/api/account/mfa/webauthn", { headers: { Cookie: userCookie } });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { credentials: { label: string; attachment: string }[] };
    expect(body.credentials.map((c) => c.label)).toEqual(["First", "Second"]);
    expect(body.credentials.map((c) => c.attachment)).toEqual(["platform", "cross-platform"]);
  });
});

describe("DELETE /api/account/mfa/webauthn/:credentialId", () => {
  it("removes a credential for the non-MFA-required operator fixture without a step-up code", async () => {
    const { finishBody } = await registerCredential(userCookie, "platform");
    const credentialId = (finishBody as { id: string }).id;

    const res = await app.request(`/api/account/mfa/webauthn/${credentialId}`, {
      method: "DELETE",
      headers: { Cookie: userCookie, ...sameOrigin, "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(200);
    expect(await prisma.userMfaMethod.count({ where: { id: credentialId } })).toBe(0);
  });

  it("returns 404 for another user's credential (no IDOR)", async () => {
    const { finishBody } = await registerCredential(userCookie, "platform");
    const credentialId = (finishBody as { id: string }).id;

    const res = await app.request(`/api/account/mfa/webauthn/${credentialId}`, {
      method: "DELETE",
      headers: { Cookie: otherCookie, ...sameOrigin, "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(404);
    expect(await prisma.userMfaMethod.count({ where: { id: credentialId } })).toBe(1);
  });

  it("requires a step-up code for the MFA-required superadmin fixture", async () => {
    const { credentialRowId } = await seedConfirmedWebauthnCredential(superadminUserId);

    const res = await app.request(`/api/account/mfa/webauthn/${credentialRowId}`, {
      method: "DELETE",
      headers: { Cookie: superadminCookie, ...sameOrigin, "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(400);
    expect(((await res.json()) as { code: string }).code).toBe("totp_required");
    expect(await prisma.userMfaMethod.count({ where: { id: credentialRowId } })).toBe(1);
  });

  it("removes a credential using a recovery code from its own first-enrollment backup codes (WebAuthn-only step-up)", async () => {
    const { credentialRowId, backupCodes } = await seedConfirmedWebauthnCredential(superadminUserId);
    expect(backupCodes.length).toBeGreaterThan(0);

    const res = await app.request(`/api/account/mfa/webauthn/${credentialRowId}`, {
      method: "DELETE",
      headers: { Cookie: superadminCookie, ...sameOrigin, "Content-Type": "application/json" },
      body: JSON.stringify({ code: backupCodes[0] }),
    });
    expect(res.status).toBe(200);
    expect(await prisma.userMfaMethod.count({ where: { id: credentialRowId } })).toBe(0);

    const audit = await prisma.adminAuditLog.findFirst({
      where: { organization_id: ORG_WEBAUTHN, action_type: "account_mfa_webauthn_removed" },
      orderBy: { created_at: "desc" },
    });
    expect(audit?.actor_user_id).toBe(superadminUserId);
  });
});
