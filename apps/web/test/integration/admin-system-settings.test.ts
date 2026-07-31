import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { PrismaClient } from "@admitto/db";
import { createTestPrismaClient } from "@admitto/db/testing";
import { createSession, hashPassword, SESSION_STAGE } from "@admitto/auth";
import { encryptTotpSecret, generateTotpSecret } from "@admitto/auth/testing";
import { createApp } from "../../src/app.js";
import { InMemoryRateLimitStore } from "../../src/rate-limit/in-memory.js";
import { querySystemLogs, resetSystemLogBufferForTest } from "@admitto/shared/system-log";

const adminDistRoot = join(dirname(fileURLToPath(import.meta.url)), "../fixtures/admin-dist");
const sameOrigin = { Origin: "http://localhost" };

const ORG_SYSSETTINGS = "org-sys-settings-test";
const EMAIL_SUPER = "syssettings-super@example.com";
const EMAIL_ADMIN = "syssettings-admin@example.com";
const PASSWORD = "syssettings-pass-123";

let prisma: PrismaClient;
let app: ReturnType<typeof createApp>;
let rateLimitStore: InMemoryRateLimitStore;
let superId: string;
let adminId: string;
let superCookie = "";
let adminCookie = "";
let prevInstanceOrgId: string | undefined;
let prevBaseUrlForSuite: string | undefined;

async function seed(client: PrismaClient) {
  await client.adminAuditLog.deleteMany({ where: { organization_id: ORG_SYSSETTINGS } });
  await client.systemSettings.deleteMany();
  await client.session.deleteMany({
    where: { user: { email: { in: [EMAIL_SUPER, EMAIL_ADMIN] } } },
  });
  await client.userMfaMethod.deleteMany({
    where: { user: { email: { in: [EMAIL_SUPER, EMAIL_ADMIN] } } },
  });
  await client.roleAssignment.deleteMany({ where: { scope_id: ORG_SYSSETTINGS } });
  await client.user.deleteMany({ where: { email: { in: [EMAIL_SUPER, EMAIL_ADMIN] } } });
  await client.organization.deleteMany({ where: { id: ORG_SYSSETTINGS } });

  const password_hash = await hashPassword(PASSWORD);

  await client.organization.create({
    data: { id: ORG_SYSSETTINGS, name: "SysSettings Test Org", slug: "sys-settings-test" },
  });

  const superUser = await client.user.create({ data: { email: EMAIL_SUPER, password_hash } });
  const adminUser = await client.user.create({ data: { email: EMAIL_ADMIN, password_hash } });
  superId = superUser.id;
  adminId = adminUser.id;

  await client.roleAssignment.createMany({
    data: [
      { user_id: superId, role: "superadmin", scope_type: "instance", scope_id: null },
      {
        user_id: adminId,
        role: "admin",
        scope_type: "organization",
        scope_id: ORG_SYSSETTINGS,
      },
    ],
  });

  for (const userId of [superId, adminId]) {
    await client.userMfaMethod.create({
      data: {
        user_id: userId,
        type: "totp",
        secret_enc: encryptTotpSecret(generateTotpSecret()),
        confirmed_at: new Date(),
      },
    });
  }
}

beforeAll(async () => {
  prevInstanceOrgId = process.env.INSTANCE_ORG_ID;
  prevBaseUrlForSuite = process.env.BASE_URL;
  delete process.env.BASE_URL;
  process.env.INSTANCE_ORG_ID = ORG_SYSSETTINGS;

  prisma = createTestPrismaClient();
  await seed(prisma);

  rateLimitStore = new InMemoryRateLimitStore();
  app = createApp({
    prisma,
    baseUrl: "https://admitto.example.com",
    rateLimitStore,
    skipCheckinBootValidation: true,
    adminDistRoot,
    mailDeliveryDeps: { exportSink: () => {} },
  });

  const superSession = await createSession(prisma, { userId: superId, stage: SESSION_STAGE.FULL });
  const adminSession = await createSession(prisma, { userId: adminId, stage: SESSION_STAGE.FULL });
  superCookie = `admitto_session=${superSession.rawToken}`;
  adminCookie = `admitto_session=${adminSession.rawToken}`;
});

afterEach(async () => {
  await prisma.adminAuditLog.deleteMany({ where: { organization_id: ORG_SYSSETTINGS } });
  await prisma.systemSettings.deleteMany();
  // Restore any env var changes
});

afterAll(async () => {
  if (prevInstanceOrgId !== undefined) process.env.INSTANCE_ORG_ID = prevInstanceOrgId;
  else delete process.env.INSTANCE_ORG_ID;
  if (prevBaseUrlForSuite === undefined) delete process.env.BASE_URL;
  else process.env.BASE_URL = prevBaseUrlForSuite;
  await prisma?.$disconnect();
});

type SettingField<T> = { value: T; source: "env" | "db" | "default" };
type SecurityDto = {
  session_ttl_ms: SettingField<number>;
  operator_session_ttl_ms: SettingField<number>;
  session_idle_timeout_ms: SettingField<number>;
  operator_session_idle_timeout_ms: SettingField<number>;
  trusted_device_days: SettingField<number>;
  mfa_required_roles: SettingField<string[]>;
  instance_url: SettingField<string | null>;
};

describe("GET /api/admin/system-settings", () => {
  it("returns all 7 keys with source=default on fresh DB", async () => {
    const res = await app.request("/api/admin/system-settings", {
      headers: { Cookie: superCookie },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as SecurityDto;
    expect(body.session_ttl_ms.source).toBe("default");
    expect(body.operator_session_ttl_ms.source).toBe("default");
    expect(body.session_idle_timeout_ms.source).toBe("default");
    expect(body.operator_session_idle_timeout_ms.source).toBe("default");
    expect(body.trusted_device_days.source).toBe("default");
    expect(body.mfa_required_roles.source).toBe("default");
    expect(body.instance_url.source).toBe("default");
    expect(body.instance_url.value).toBeNull();
    expect(typeof body.session_ttl_ms.value).toBe("number");
    expect(typeof body.session_idle_timeout_ms.value).toBe("number");
    expect(typeof body.operator_session_idle_timeout_ms.value).toBe("number");
    expect(Array.isArray(body.mfa_required_roles.value)).toBe(true);
  });

  it("returns mfa_required_roles.value as string[] (not CSV string)", async () => {
    const res = await app.request("/api/admin/system-settings", {
      headers: { Cookie: superCookie },
    });
    const body = (await res.json()) as SecurityDto;
    expect(Array.isArray(body.mfa_required_roles.value)).toBe(true);
    for (const role of body.mfa_required_roles.value) {
      expect(typeof role).toBe("string");
    }
  });

  it("rejects admin (non-superadmin) with 403", async () => {
    const res = await app.request("/api/admin/system-settings", {
      headers: { Cookie: adminCookie },
    });
    expect(res.status).toBe(403);
  });
});

describe("PATCH /api/admin/system-settings", () => {
  it("updates session_ttl_ms and source becomes db", async () => {
    resetSystemLogBufferForTest();
    const newTtl = 7_200_000; // 2h
    const res = await app.request("/api/admin/system-settings", {
      method: "PATCH",
      headers: {
        Cookie: superCookie,
        "Content-Type": "application/json",
        ...sameOrigin,
      },
      body: JSON.stringify({ session_ttl_ms: newTtl }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as SecurityDto;
    expect(body.session_ttl_ms.value).toBe(newTtl);
    expect(body.session_ttl_ms.source).toBe("db");

    const [entry] = querySystemLogs({ source: "security", search: "system_settings_updated" });
    expect(entry).toMatchObject({
      level: "info",
      source: "security",
      message: "system_settings_updated",
      fields: { fields: ["session_ttl_ms"], actorUserId: superId, actorEmail: EMAIL_SUPER },
    });
    expect(JSON.stringify(entry)).not.toContain(String(newTtl));
  });

  it("updates session_idle_timeout_ms and source becomes db", async () => {
    const newIdle = 900_000; // 15 min
    const res = await app.request("/api/admin/system-settings", {
      method: "PATCH",
      headers: {
        Cookie: superCookie,
        "Content-Type": "application/json",
        ...sameOrigin,
      },
      body: JSON.stringify({ session_idle_timeout_ms: newIdle }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as SecurityDto;
    expect(body.session_idle_timeout_ms.value).toBe(newIdle);
    expect(body.session_idle_timeout_ms.source).toBe("db");
  });

  it("updates operator_session_idle_timeout_ms and source becomes db", async () => {
    const newIdle = 3_600_000; // 1h
    const res = await app.request("/api/admin/system-settings", {
      method: "PATCH",
      headers: {
        Cookie: superCookie,
        "Content-Type": "application/json",
        ...sameOrigin,
      },
      body: JSON.stringify({ operator_session_idle_timeout_ms: newIdle }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as SecurityDto;
    expect(body.operator_session_idle_timeout_ms.value).toBe(newIdle);
    expect(body.operator_session_idle_timeout_ms.source).toBe("db");
  });

  it("rejects session_idle_timeout_ms below the 5-minute minimum", async () => {
    const res = await app.request("/api/admin/system-settings", {
      method: "PATCH",
      headers: {
        Cookie: superCookie,
        "Content-Type": "application/json",
        ...sameOrigin,
      },
      body: JSON.stringify({ session_idle_timeout_ms: 60_000 }), // 1 min, below 5 min minimum
    });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe("validation_error");
  });

  it("rejects session_idle_timeout_ms above the 4-hour admin maximum", async () => {
    const res = await app.request("/api/admin/system-settings", {
      method: "PATCH",
      headers: {
        Cookie: superCookie,
        "Content-Type": "application/json",
        ...sameOrigin,
      },
      body: JSON.stringify({ session_idle_timeout_ms: 14_400_001 }), // 1ms above 4h maximum
    });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe("validation_error");
  });

  it("rejects operator_session_idle_timeout_ms above the 8-hour operator maximum", async () => {
    const res = await app.request("/api/admin/system-settings", {
      method: "PATCH",
      headers: {
        Cookie: superCookie,
        "Content-Type": "application/json",
        ...sameOrigin,
      },
      body: JSON.stringify({ operator_session_idle_timeout_ms: 28_800_001 }), // 1ms above 8h maximum
    });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe("validation_error");
  });

  it("rejects (atomically) an admin idle timeout that would exceed the absolute lifetime", async () => {
    const res = await app.request("/api/admin/system-settings", {
      method: "PATCH",
      headers: {
        Cookie: superCookie,
        "Content-Type": "application/json",
        ...sameOrigin,
      },
      // absolute lifetime 1h, idle timeout 2h — idle would never trigger.
      body: JSON.stringify({ session_ttl_ms: 3_600_000, session_idle_timeout_ms: 7_200_000 }),
    });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string; field: string };
    expect(body.error).toBe("idle_timeout_exceeds_absolute_lifetime");
    expect(body.field).toBe("session_idle_timeout_ms");

    // Rejected atomically: neither field should have been persisted.
    const getRes = await app.request("/api/admin/system-settings", {
      headers: { Cookie: superCookie },
    });
    const getBody = (await getRes.json()) as SecurityDto;
    expect(getBody.session_ttl_ms.source).toBe("default");
    expect(getBody.session_idle_timeout_ms.source).toBe("default");
  });

  it("rejects (atomically) an operator idle timeout that would exceed the absolute lifetime", async () => {
    const res = await app.request("/api/admin/system-settings", {
      method: "PATCH",
      headers: {
        Cookie: superCookie,
        "Content-Type": "application/json",
        ...sameOrigin,
      },
      // absolute lifetime 1h, idle timeout 2h — idle would never trigger.
      body: JSON.stringify({
        operator_session_ttl_ms: 3_600_000,
        operator_session_idle_timeout_ms: 7_200_000,
      }),
    });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string; field: string };
    expect(body.error).toBe("idle_timeout_exceeds_absolute_lifetime");
    expect(body.field).toBe("operator_session_idle_timeout_ms");
  });

  it("allows an idle timeout equal to the absolute lifetime", async () => {
    const res = await app.request("/api/admin/system-settings", {
      method: "PATCH",
      headers: {
        Cookie: superCookie,
        "Content-Type": "application/json",
        ...sameOrigin,
      },
      body: JSON.stringify({ session_ttl_ms: 3_600_000, session_idle_timeout_ms: 3_600_000 }),
    });
    expect(res.status).toBe(200);
  });

  it("env-locked idle-timeout key returns 400 'managed by environment'", async () => {
    const prev = process.env.SESSION_IDLE_TIMEOUT_ADMIN_MS;
    process.env.SESSION_IDLE_TIMEOUT_ADMIN_MS = "600000";
    try {
      const res = await app.request("/api/admin/system-settings", {
        method: "PATCH",
        headers: {
          Cookie: superCookie,
          "Content-Type": "application/json",
          ...sameOrigin,
        },
        body: JSON.stringify({ session_idle_timeout_ms: 900_000 }),
      });
      expect(res.status).toBe(400);
      const body = (await res.json()) as { error: string; field: string };
      expect(body.error).toBe("managed by environment");
      expect(body.field).toBe("session_idle_timeout_ms");
    } finally {
      if (prev === undefined) delete process.env.SESSION_IDLE_TIMEOUT_ADMIN_MS;
      else process.env.SESSION_IDLE_TIMEOUT_ADMIN_MS = prev;
    }
  });

  it("writes AdminAuditLog with fields list when changing a value", async () => {
    await app.request("/api/admin/system-settings", {
      method: "PATCH",
      headers: {
        Cookie: superCookie,
        "Content-Type": "application/json",
        ...sameOrigin,
      },
      body: JSON.stringify({ trusted_device_days: 7 }),
    });

    const log = await prisma.adminAuditLog.findFirst({
      where: { organization_id: ORG_SYSSETTINGS, action_type: "system_settings_updated" },
    });
    expect(log).not.toBeNull();
    const meta = log?.metadata as Record<string, unknown>;
    expect(meta?.fields).toEqual(expect.arrayContaining(["trusted_device_days"]));
  });

  it("empty body returns 200 and does NOT write audit log", async () => {
    const res = await app.request("/api/admin/system-settings", {
      method: "PATCH",
      headers: {
        Cookie: superCookie,
        "Content-Type": "application/json",
        ...sameOrigin,
      },
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(200);

    const log = await prisma.adminAuditLog.findFirst({
      where: { organization_id: ORG_SYSSETTINGS, action_type: "system_settings_updated" },
    });
    expect(log).toBeNull();
  });

  it("out-of-range value returns 400 Zod error", async () => {
    const res = await app.request("/api/admin/system-settings", {
      method: "PATCH",
      headers: {
        Cookie: superCookie,
        "Content-Type": "application/json",
        ...sameOrigin,
      },
      body: JSON.stringify({ session_ttl_ms: 1000 }), // below 1h minimum
    });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe("validation_error");
  });

  it("rejects missing CSRF header", async () => {
    const res = await app.request("/api/admin/system-settings", {
      method: "PATCH",
      headers: { Cookie: superCookie, "Content-Type": "application/json" },
      body: JSON.stringify({ trusted_device_days: 5 }),
    });
    expect(res.status).toBeGreaterThanOrEqual(400);
  });

  it("rejects admin (non-superadmin) with 403", async () => {
    const res = await app.request("/api/admin/system-settings", {
      method: "PATCH",
      headers: {
        Cookie: adminCookie,
        "Content-Type": "application/json",
        ...sameOrigin,
      },
      body: JSON.stringify({ trusted_device_days: 5 }),
    });
    expect(res.status).toBe(403);
  });

  it("accepts trusted_device_days=0 (feature: disabled)", async () => {
    const res = await app.request("/api/admin/system-settings", {
      method: "PATCH",
      headers: {
        Cookie: superCookie,
        "Content-Type": "application/json",
        ...sameOrigin,
      },
      body: JSON.stringify({ trusted_device_days: 0 }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as SecurityDto;
    expect(body.trusted_device_days.value).toBe(0);
    expect(body.trusted_device_days.source).toBe("db");
  });

  it("null value clears DB override and source reverts to default", async () => {
    // first set a value
    await app.request("/api/admin/system-settings", {
      method: "PATCH",
      headers: {
        Cookie: superCookie,
        "Content-Type": "application/json",
        ...sameOrigin,
      },
      body: JSON.stringify({ trusted_device_days: 14 }),
    });

    // then clear it
    const res = await app.request("/api/admin/system-settings", {
      method: "PATCH",
      headers: {
        Cookie: superCookie,
        "Content-Type": "application/json",
        ...sameOrigin,
      },
      body: JSON.stringify({ trusted_device_days: null }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as SecurityDto;
    expect(body.trusted_device_days.source).toBe("default");
  });

  it("env-locked key returns 400 'managed by environment'", async () => {
    const prev = process.env.SESSION_TTL_ADMIN_MS;
    process.env.SESSION_TTL_ADMIN_MS = "86400000";
    try {
      const res = await app.request("/api/admin/system-settings", {
        method: "PATCH",
        headers: {
          Cookie: superCookie,
          "Content-Type": "application/json",
          ...sameOrigin,
        },
        body: JSON.stringify({ session_ttl_ms: 7_200_000 }),
      });
      expect(res.status).toBe(400);
      const body = (await res.json()) as { error: string; field: string };
      expect(body.error).toBe("managed by environment");
      expect(body.field).toBe("session_ttl_ms");
    } finally {
      if (prev === undefined) delete process.env.SESSION_TTL_ADMIN_MS;
      else process.env.SESSION_TTL_ADMIN_MS = prev;
    }
  });

  it("env-locked GET shows source=env for that field", async () => {
    const prev = process.env.SESSION_TTL_ADMIN_MS;
    process.env.SESSION_TTL_ADMIN_MS = "86400000";
    try {
      const res = await app.request("/api/admin/system-settings", {
        headers: { Cookie: superCookie },
      });
      const body = (await res.json()) as SecurityDto;
      expect(body.session_ttl_ms.source).toBe("env");
    } finally {
      if (prev === undefined) delete process.env.SESSION_TTL_ADMIN_MS;
      else process.env.SESSION_TTL_ADMIN_MS = prev;
    }
  });

  it("only env-locked key in body rejected; unlocked keys are not blocked", async () => {
    const prev = process.env.SESSION_TTL_ADMIN_MS;
    process.env.SESSION_TTL_ADMIN_MS = "86400000";
    try {
      // patch only unlocked key — should succeed
      const res = await app.request("/api/admin/system-settings", {
        method: "PATCH",
        headers: {
          Cookie: superCookie,
          "Content-Type": "application/json",
          ...sameOrigin,
        },
        body: JSON.stringify({ trusted_device_days: 10 }),
      });
      expect(res.status).toBe(200);
    } finally {
      if (prev === undefined) delete process.env.SESSION_TTL_ADMIN_MS;
      else process.env.SESSION_TTL_ADMIN_MS = prev;
    }
  });

  it("all-null body reverts all non-locked keys to default", async () => {
    // Set some values first
    await app.request("/api/admin/system-settings", {
      method: "PATCH",
      headers: {
        Cookie: superCookie,
        "Content-Type": "application/json",
        ...sameOrigin,
      },
      body: JSON.stringify({ trusted_device_days: 60, operator_session_ttl_ms: 14_400_000 }),
    });

    const res = await app.request("/api/admin/system-settings", {
      method: "PATCH",
      headers: {
        Cookie: superCookie,
        "Content-Type": "application/json",
        ...sameOrigin,
      },
      body: JSON.stringify({
        session_ttl_ms: null,
        operator_session_ttl_ms: null,
        trusted_device_days: null,
        mfa_required_roles: null,
      }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as SecurityDto;
    expect(body.session_ttl_ms.source).toBe("default");
    expect(body.operator_session_ttl_ms.source).toBe("default");
    expect(body.trusted_device_days.source).toBe("default");
    expect(body.mfa_required_roles.source).toBe("default");
  });

  it("updates instance_url and source becomes db", async () => {
    const url = "https://tickets-db.example.com";
    const res = await app.request("/api/admin/system-settings", {
      method: "PATCH",
      headers: {
        Cookie: superCookie,
        "Content-Type": "application/json",
        ...sameOrigin,
      },
      body: JSON.stringify({ instance_url: url }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as SecurityDto;
    expect(body.instance_url.value).toBe(url);
    expect(body.instance_url.source).toBe("db");
  });

  it.each([
    ["trailing slash", "https://tickets.example.com/"],
    ["non-HTTPS", "http://tickets.example.com"],
    ["query string", "https://tickets.example.com?preview=1"],
    ["fragment", "https://tickets.example.com#section"],
    ["embedded credentials", "https://user:pass@tickets.example.com"],
  ])("rejects instance_url with %s", async (_label, instanceUrl) => {
    const res = await app.request("/api/admin/system-settings", {
      method: "PATCH",
      headers: {
        Cookie: superCookie,
        "Content-Type": "application/json",
        ...sameOrigin,
      },
      body: JSON.stringify({ instance_url: instanceUrl }),
    });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe("validation_error");
  });

  it("env-locked instance_url returns 400 when BASE_URL is set", async () => {
    const prev = process.env.BASE_URL;
    process.env.BASE_URL = "https://env.example.com";
    try {
      const res = await app.request("/api/admin/system-settings", {
        method: "PATCH",
        headers: {
          Cookie: superCookie,
          "Content-Type": "application/json",
          ...sameOrigin,
        },
        body: JSON.stringify({ instance_url: "https://db.example.com" }),
      });
      expect(res.status).toBe(400);
      const body = (await res.json()) as { error: string; field: string };
      expect(body.error).toBe("managed by environment");
      expect(body.field).toBe("instance_url");
    } finally {
      if (prev === undefined) delete process.env.BASE_URL;
      else process.env.BASE_URL = prev;
    }
  });

  it("GET shows source=env for instance_url when BASE_URL is set", async () => {
    const prev = process.env.BASE_URL;
    process.env.BASE_URL = "https://env.example.com";
    try {
      const res = await app.request("/api/admin/system-settings", {
        headers: { Cookie: superCookie },
      });
      const body = (await res.json()) as SecurityDto;
      expect(body.instance_url.source).toBe("env");
      expect(body.instance_url.value).toBe("https://env.example.com");
    } finally {
      if (prev === undefined) delete process.env.BASE_URL;
      else process.env.BASE_URL = prev;
    }
  });
});
