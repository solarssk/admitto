import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { PrismaClient } from "@admitto/db";
import { createTestPrismaClient } from "@admitto/db/testing";
import {
  beginWebauthnRegistration,
  finishWebauthnRegistration,
  hashPassword,
  SETTING_WEBAUTHN_ENABLED,
  SETTING_PASSKEY_LOGIN_ENABLED,
} from "@admitto/auth";
import { createVirtualAuthenticator } from "@admitto/auth/webauthn-testing";
import { createApp } from "../../src/app.js";
import { InMemoryRateLimitStore } from "../../src/rate-limit/in-memory.js";

const adminDistRoot = join(dirname(fileURLToPath(import.meta.url)), "../fixtures/admin-dist");
const sameOrigin = { Origin: "http://localhost" };
const BASE_URL = "https://admitto.example.com";
const RP_ID = "admitto.example.com";
const RP = { rpName: "Admitto", rpID: RP_ID, origin: BASE_URL };

const ORG_PL = "org-passkey-login-test";
const EMAIL_USER = "passkey-login-user@example.com";
const EMAIL_INACTIVE = "passkey-login-inactive@example.com";
const PASSWORD = "passkey-login-pass-123";

let prisma: PrismaClient;
let app: ReturnType<typeof createApp>;
let rateLimitStore: InMemoryRateLimitStore;
let userId = "";
let inactiveUserId = "";

async function seed(client: PrismaClient) {
  const emails = [EMAIL_USER, EMAIL_INACTIVE];
  await client.userMfaMethod.deleteMany({ where: { user: { email: { in: emails } } } });
  await client.roleAssignment.deleteMany({ where: { scope_id: ORG_PL } });
  await client.user.deleteMany({ where: { email: { in: emails } } });
  await client.organization.deleteMany({ where: { id: ORG_PL } });

  const password_hash = await hashPassword(PASSWORD);
  await client.organization.create({ data: { id: ORG_PL, name: "Passkey Login Test Org", slug: "passkey-login-test" } });

  const user = await client.user.create({ data: { email: EMAIL_USER, password_hash } });
  userId = user.id;
  const inactiveUser = await client.user.create({ data: { email: EMAIL_INACTIVE, password_hash, is_active: false } });
  inactiveUserId = inactiveUser.id;

  await client.roleAssignment.createMany({
    data: [{ user_id: userId, role: "operator", scope_type: "event", scope_id: "evt-passkey-login" }],
  });
}

/** Registers a confirmed passkey directly via the package functions (not this suite's own
 * routes) and acknowledges its backup codes, so login tests exercise the FULL-session path. */
async function registerCredential(targetUserId: string, label = "Login key") {
  const authenticator = createVirtualAuthenticator();
  const begin = await beginWebauthnRegistration(prisma, targetUserId, "platform", RP);
  if (!begin) throw new Error("beginWebauthnRegistration returned null");
  const response = authenticator.register({ challenge: begin.challenge, rpID: RP_ID, origin: BASE_URL });
  const result = await finishWebauthnRegistration(prisma, targetUserId, response, begin.challenge, "platform", label, RP);
  if (!result) throw new Error("finishWebauthnRegistration returned null");
  await prisma.userMfaMethod.update({
    where: { id: result.credentialRowId },
    data: { backup_codes_acknowledged_at: new Date() },
  });
  return authenticator;
}

async function setPasskeyLoginEnabled(enabled: boolean) {
  await prisma.systemSettings.upsert({
    where: { key: SETTING_PASSKEY_LOGIN_ENABLED },
    create: { key: SETTING_PASSKEY_LOGIN_ENABLED, value_json: JSON.stringify(enabled) },
    update: { value_json: JSON.stringify(enabled) },
  });
}

interface BeginResponseBody {
  ceremony: string;
  options: { challenge: string; allowCredentials?: unknown[]; userVerification?: string };
}

async function begin() {
  const res = await app.request("/api/auth/login/webauthn/begin", {
    method: "POST",
    headers: { ...sameOrigin, "Content-Type": "application/json" },
  });
  return { res, body: (await res.json()) as BeginResponseBody };
}

let prevInstanceOrgId: string | undefined;

beforeAll(async () => {
  prevInstanceOrgId = process.env.INSTANCE_ORG_ID;
  process.env.INSTANCE_ORG_ID = ORG_PL;
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
});

afterEach(async () => {
  await prisma.userMfaMethod.deleteMany({ where: { user_id: { in: [userId, inactiveUserId] } } });
  await prisma.systemSettings.deleteMany({
    where: { key: { in: [SETTING_WEBAUTHN_ENABLED, SETTING_PASSKEY_LOGIN_ENABLED] } },
  });
  rateLimitStore.reset();
});

afterAll(async () => {
  if (prevInstanceOrgId === undefined) delete process.env.INSTANCE_ORG_ID;
  else process.env.INSTANCE_ORG_ID = prevInstanceOrgId;
  await prisma.$disconnect();
});

describe("POST /api/auth/login/webauthn/begin", () => {
  it("returns 403 passkey_login_disabled when the setting is off (default)", async () => {
    const { res, body } = await begin();
    expect(res.status).toBe(403);
    expect((body as unknown as { code: string }).code).toBe("passkey_login_disabled");
  });

  it("returns discoverable-credential options with no allowCredentials and required user verification", async () => {
    await setPasskeyLoginEnabled(true);
    const { res, body } = await begin();
    expect(res.status).toBe(200);
    expect(body.options.allowCredentials).toBeUndefined();
    expect(body.options.userVerification).toBe("required");
    expect(body.ceremony).toBeTruthy();
  });

  it("returns 403 when webauthn_enabled is off even if passkey_login_enabled is on", async () => {
    await setPasskeyLoginEnabled(true);
    await prisma.systemSettings.upsert({
      where: { key: SETTING_WEBAUTHN_ENABLED },
      create: { key: SETTING_WEBAUTHN_ENABLED, value_json: "false" },
      update: { value_json: "false" },
    });
    const { res } = await begin();
    expect(res.status).toBe(403);
  });

  it("rejects a cross-site POST (no matching Origin)", async () => {
    await setPasskeyLoginEnabled(true);
    const res = await app.request("/api/auth/login/webauthn/begin", {
      method: "POST",
      headers: { Origin: "https://evil.example.com", "Content-Type": "application/json" },
    });
    expect(res.status).toBe(403);
  });
});

describe("POST /api/auth/login/webauthn/finish", () => {
  it("logs in and sets a session cookie for a valid discoverable-credential assertion", async () => {
    await setPasskeyLoginEnabled(true);
    const authenticator = await registerCredential(userId);
    const { body: beginBody } = await begin();
    const response = authenticator.authenticate({ challenge: beginBody.options.challenge, rpID: RP_ID, origin: BASE_URL });

    const res = await app.request("/api/auth/login/webauthn/finish", {
      method: "POST",
      headers: { ...sameOrigin, "Content-Type": "application/json" },
      body: JSON.stringify({ ceremony: beginBody.ceremony, response }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok: boolean; next: string };
    expect(body.ok).toBe(true);
    expect(res.headers.get("set-cookie")).toMatch(/admitto_session=/);

    const row = await prisma.securityAuditLog.findFirst({
      where: { user_id: userId, event_type: "auth.login.success" },
      orderBy: { created_at: "desc" },
    });
    expect((row?.metadata as { method?: string } | null)?.method).toBe("passkey");
  });

  it("returns 400 challenge_expired when the ceremony token is unknown", async () => {
    await setPasskeyLoginEnabled(true);
    const authenticator = await registerCredential(userId);
    const response = authenticator.authenticate({ challenge: "irrelevant", rpID: RP_ID, origin: BASE_URL });

    const res = await app.request("/api/auth/login/webauthn/finish", {
      method: "POST",
      headers: { ...sameOrigin, "Content-Type": "application/json" },
      body: JSON.stringify({ ceremony: "unknown-ceremony-token", response }),
    });
    expect(res.status).toBe(400);
    expect((await res.json()) as { code: string }).toEqual({ code: "challenge_expired" });
  });

  it("returns the same generic 401 for an unknown credential and for an inactive account (no enumeration)", async () => {
    await setPasskeyLoginEnabled(true);

    const impostor = createVirtualAuthenticator();
    const { body: beginForImpostor } = await begin();
    const impostorResponse = impostor.authenticate({ challenge: beginForImpostor.options.challenge, rpID: RP_ID, origin: BASE_URL });
    const unknownRes = await app.request("/api/auth/login/webauthn/finish", {
      method: "POST",
      headers: { ...sameOrigin, "Content-Type": "application/json" },
      body: JSON.stringify({ ceremony: beginForImpostor.ceremony, response: impostorResponse }),
    });

    const inactiveAuthenticator = await registerCredential(inactiveUserId);
    const { body: beginForInactive } = await begin();
    const inactiveResponse = inactiveAuthenticator.authenticate({ challenge: beginForInactive.options.challenge, rpID: RP_ID, origin: BASE_URL });
    const inactiveRes = await app.request("/api/auth/login/webauthn/finish", {
      method: "POST",
      headers: { ...sameOrigin, "Content-Type": "application/json" },
      body: JSON.stringify({ ceremony: beginForInactive.ceremony, response: inactiveResponse }),
    });

    expect(unknownRes.status).toBe(401);
    expect(inactiveRes.status).toBe(401);
    expect(await unknownRes.json()).toEqual(await inactiveRes.json());
  });

  it("consumes the challenge - the same assertion cannot be replayed", async () => {
    await setPasskeyLoginEnabled(true);
    const authenticator = await registerCredential(userId);
    const { body: beginBody } = await begin();
    const response = authenticator.authenticate({ challenge: beginBody.options.challenge, rpID: RP_ID, origin: BASE_URL });

    const first = await app.request("/api/auth/login/webauthn/finish", {
      method: "POST",
      headers: { ...sameOrigin, "Content-Type": "application/json" },
      body: JSON.stringify({ ceremony: beginBody.ceremony, response }),
    });
    expect(first.status).toBe(200);

    const replay = await app.request("/api/auth/login/webauthn/finish", {
      method: "POST",
      headers: { ...sameOrigin, "Content-Type": "application/json" },
      body: JSON.stringify({ ceremony: beginBody.ceremony, response }),
    });
    expect(replay.status).toBe(400);
  });
});
