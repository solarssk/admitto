import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PrismaClient } from "@prisma/client";
import { createSession, hashPassword, SESSION_STAGE } from "@admitto/auth";
import { encryptTotpSecret, generateTotpSecret } from "@admitto/auth/testing";
import { createApp } from "../../src/app.js";
import { InMemoryRateLimitStore } from "../../src/rate-limit/in-memory.js";

const adminDistRoot = join(dirname(fileURLToPath(import.meta.url)), "../fixtures/admin-dist");

const EMAIL_SUPER = "security-audit-super@example.com";
const EMAIL_ADMIN = "security-audit-admin@example.com";
const EMAIL_TARGET = "security-audit-target@example.com";
const PASSWORD = "security-audit-pass-123";

let prisma: PrismaClient;
let app: ReturnType<typeof createApp>;
let rateLimitStore: InMemoryRateLimitStore;

let superId: string;
let adminId: string;
let targetId: string;
let superCookie = "";

/** Seed a superadmin, a non-superadmin admin, and a third "target" user referenced by some
 * SecurityAuditLog rows - no organization/event fixtures needed, this table has no org scoping
 * (see security-audit-routes.ts doc comment). */
async function seed(client: PrismaClient) {
  await client.securityAuditLog.deleteMany({});
  await client.session.deleteMany({
    where: { user: { email: { in: [EMAIL_SUPER, EMAIL_ADMIN, EMAIL_TARGET] } } },
  });
  await client.userMfaMethod.deleteMany({
    where: { user: { email: { in: [EMAIL_SUPER, EMAIL_ADMIN, EMAIL_TARGET] } } },
  });
  await client.roleAssignment.deleteMany({
    where: { user: { email: { in: [EMAIL_SUPER, EMAIL_ADMIN, EMAIL_TARGET] } } },
  });
  await client.user.deleteMany({ where: { email: { in: [EMAIL_SUPER, EMAIL_ADMIN, EMAIL_TARGET] } } });

  const password_hash = await hashPassword(PASSWORD);
  const superUser = await client.user.create({ data: { email: EMAIL_SUPER, password_hash } });
  const adminUser = await client.user.create({ data: { email: EMAIL_ADMIN, password_hash } });
  const targetUser = await client.user.create({
    data: { email: EMAIL_TARGET, password_hash, display_name: "Target User" },
  });
  superId = superUser.id;
  adminId = adminUser.id;
  targetId = targetUser.id;

  await client.roleAssignment.createMany({
    data: [
      { user_id: superId, role: "superadmin", scope_type: "instance", scope_id: null },
      // Org-scoped admin (not superadmin) - passes staffAdminGate's canAccessAdminPanel check
      // (scope_id has no real FK to Organization, see schema.prisma) so the 403 below comes
      // cleanly from this route's own requireSuperadmin check, not the gate's
      // forbiddenNoAdminAccess (which would otherwise durably log a no_admin_access row and
      // pollute the SecurityAuditLog fixture counts asserted further down).
      { user_id: adminId, role: "admin", scope_type: "organization", scope_id: "org-security-audit-test" },
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

  await client.securityAuditLog.createMany({
    data: [
      {
        event_type: "auth.login.success",
        user_id: targetId,
        ip: "1.2.3.4",
        metadata: { email: EMAIL_TARGET, userAgent: "curl/8.0" },
        created_at: new Date("2026-06-15T12:00:00.000Z"),
      },
      {
        event_type: "auth.login.fail",
        user_id: null,
        ip: "1.2.3.5",
        metadata: { email_redacted: "t***@example.com", userAgent: null },
        created_at: new Date("2026-06-16T12:00:00.000Z"),
      },
      {
        event_type: "auth.mfa.fail",
        user_id: targetId,
        ip: "1.2.3.6",
        metadata: { sessionId: "sess-1", userAgent: null },
        created_at: new Date("2026-06-17T12:00:00.000Z"),
      },
      {
        event_type: "auth.access.denied",
        user_id: null,
        ip: "1.2.3.7",
        metadata: { path: "/api/admin/users", reason: "no_session" },
        created_at: new Date("2026-07-01T09:00:00.000Z"),
      },
    ],
  });
}

beforeAll(async () => {
  prisma = new PrismaClient();
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

  const superSession = await createSession(prisma, {
    userId: superId,
    stage: SESSION_STAGE.FULL,
    ip: "127.0.0.1",
  });
  superCookie = `admitto_session=${superSession.rawToken}`;
});

afterAll(async () => {
  await prisma?.$disconnect();
});

describe("GET /api/admin/security-audit-log", () => {
  it("returns 401 without auth", async () => {
    const res = await app.request("/api/admin/security-audit-log");
    expect(res.status).toBe(401);
  });

  it("returns 403 for non-superadmin admin", async () => {
    const adminSession = await createSession(prisma, {
      userId: adminId,
      stage: SESSION_STAGE.FULL,
    });
    const res = await app.request("/api/admin/security-audit-log", {
      headers: { Cookie: `admitto_session=${adminSession.rawToken}` },
    });
    expect(res.status).toBe(403);
    await prisma.session.delete({ where: { id: adminSession.session.id } });
  });

  it("returns 200 with entries, total, page, pageSize for superadmin, newest first", async () => {
    const res = await app.request("/api/admin/security-audit-log", {
      headers: { Cookie: superCookie },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      entries: {
        id: string;
        event_type: string;
        user_id: string | null;
        user_email: string | null;
        user_display_name: string | null;
        ip: string | null;
        metadata: Record<string, unknown> | null;
        created_at: string;
      }[];
      total: number;
      page: number;
      pageSize: number;
    };
    expect(body.page).toBe(1);
    expect(body.pageSize).toBe(25);
    expect(body.total).toBe(4);
    expect(body.entries).toHaveLength(4);
    // Newest first.
    expect(body.entries[0]?.event_type).toBe("auth.access.denied");
    expect(body.entries.at(-1)?.event_type).toBe("auth.login.success");
  });

  it("resolves user_email/user_display_name for rows with a user_id", async () => {
    const res = await app.request("/api/admin/security-audit-log?event_type=auth.login.success", {
      headers: { Cookie: superCookie },
    });
    const body = (await res.json()) as {
      entries: { user_id: string | null; user_email: string | null; user_display_name: string | null }[];
    };
    expect(body.entries).toHaveLength(1);
    expect(body.entries[0]?.user_id).toBe(targetId);
    expect(body.entries[0]?.user_email).toBe(EMAIL_TARGET);
    expect(body.entries[0]?.user_display_name).toBe("Target User");
  });

  it("resolves user_id/user_email/user_display_name to null for enumeration-safe rows", async () => {
    const res = await app.request("/api/admin/security-audit-log?event_type=auth.login.fail", {
      headers: { Cookie: superCookie },
    });
    const body = (await res.json()) as {
      entries: { user_id: string | null; user_email: string | null; user_display_name: string | null }[];
    };
    expect(body.entries).toHaveLength(1);
    expect(body.entries[0]?.user_id).toBeNull();
    expect(body.entries[0]?.user_email).toBeNull();
    expect(body.entries[0]?.user_display_name).toBeNull();
  });

  it("falls back to null email/display_name for a user_id whose User row is gone", async () => {
    await prisma.securityAuditLog.create({
      data: {
        event_type: "auth.oidc.success",
        user_id: "deleted-user-does-not-exist",
        ip: "1.2.3.8",
        metadata: { providerId: "provider-1" },
        created_at: new Date("2026-07-02T09:00:00.000Z"),
      },
    });
    try {
      const res = await app.request("/api/admin/security-audit-log?event_type=auth.oidc.success", {
        headers: { Cookie: superCookie },
      });
      const body = (await res.json()) as {
        entries: { user_id: string | null; user_email: string | null; user_display_name: string | null }[];
      };
      expect(body.entries).toHaveLength(1);
      expect(body.entries[0]?.user_id).toBe("deleted-user-does-not-exist");
      expect(body.entries[0]?.user_email).toBeNull();
      expect(body.entries[0]?.user_display_name).toBeNull();
    } finally {
      await prisma.securityAuditLog.deleteMany({ where: { event_type: "auth.oidc.success" } });
    }
  });

  it("filters by event_type", async () => {
    const res = await app.request("/api/admin/security-audit-log?event_type=auth.mfa.fail", {
      headers: { Cookie: superCookie },
    });
    const body = (await res.json()) as { entries: { event_type: string }[]; total: number };
    expect(body.total).toBe(1);
    expect(body.entries[0]?.event_type).toBe("auth.mfa.fail");
  });

  it("filters by start/end date bounds (inclusive UTC day range)", async () => {
    const res = await app.request(
      "/api/admin/security-audit-log?start=2026-06-16&end=2026-06-17",
      { headers: { Cookie: superCookie } },
    );
    const body = (await res.json()) as { entries: { event_type: string }[]; total: number };
    expect(body.total).toBe(2);
    expect(body.entries.map((e) => e.event_type).sort()).toEqual(["auth.login.fail", "auth.mfa.fail"]);
  });

  it("filters by start only (open-ended upper bound)", async () => {
    const res = await app.request("/api/admin/security-audit-log?start=2026-06-17", {
      headers: { Cookie: superCookie },
    });
    const body = (await res.json()) as { entries: { event_type: string }[]; total: number };
    expect(body.total).toBe(2);
    expect(body.entries.map((e) => e.event_type).sort()).toEqual(["auth.access.denied", "auth.mfa.fail"]);
  });

  it("filters by end only (open-ended lower bound)", async () => {
    const res = await app.request("/api/admin/security-audit-log?end=2026-06-16", {
      headers: { Cookie: superCookie },
    });
    const body = (await res.json()) as { entries: { event_type: string }[]; total: number };
    expect(body.total).toBe(2);
    expect(body.entries.map((e) => e.event_type).sort()).toEqual(["auth.login.fail", "auth.login.success"]);
  });

  it("paginates with page/pageSize", async () => {
    const res = await app.request("/api/admin/security-audit-log?page=2&pageSize=2", {
      headers: { Cookie: superCookie },
    });
    const body = (await res.json()) as { entries: unknown[]; total: number; page: number; pageSize: number };
    expect(body.page).toBe(2);
    expect(body.pageSize).toBe(2);
    expect(body.total).toBe(4);
    expect(body.entries).toHaveLength(2);
  });

  it("includes ip and metadata verbatim", async () => {
    const res = await app.request("/api/admin/security-audit-log?event_type=auth.access.denied", {
      headers: { Cookie: superCookie },
    });
    const body = (await res.json()) as {
      entries: { ip: string | null; metadata: Record<string, unknown> | null }[];
    };
    expect(body.entries[0]?.ip).toBe("1.2.3.7");
    expect(body.entries[0]?.metadata).toEqual({ path: "/api/admin/users", reason: "no_session" });
  });

  it("durably records a real access-denied event end-to-end, proving the audit.ts -> DB wiring (not just hand-seeded fixtures)", async () => {
    // targetUser has no role assignment at all, so hitting an admin route with its session
    // exercises staffAdminGate's forbiddenNoAdminAccess path, which durably calls
    // logAccessDenied (packages/auth/src/audit.ts) - the same production code path this
    // change wired up. Kept as the last test in this file since it intentionally adds a row.
    const targetSession = await createSession(prisma, { userId: targetId, stage: SESSION_STAGE.FULL });
    const denied = await app.request("/api/admin/security-audit-log", {
      headers: { Cookie: `admitto_session=${targetSession.rawToken}` },
    });
    expect(denied.status).toBe(403);
    await prisma.session.delete({ where: { id: targetSession.session.id } });

    const res = await app.request("/api/admin/security-audit-log?event_type=auth.access.denied", {
      headers: { Cookie: superCookie },
    });
    const body = (await res.json()) as {
      entries: {
        user_id: string | null;
        user_email: string | null;
        ip: string | null;
        metadata: Record<string, unknown> | null;
      }[];
      total: number;
    };
    // The seeded "no_session" row plus this newly-written "no_admin_access" row.
    expect(body.total).toBe(2);
    const live = body.entries.find((e) => e.user_id === targetId);
    expect(live).toBeDefined();
    expect(live?.user_email).toBe(EMAIL_TARGET);
    expect(typeof live?.ip).toBe("string");
    expect(live?.metadata).toMatchObject({
      reason: "no_admin_access",
      path: "/api/admin/security-audit-log",
    });
  });
});
