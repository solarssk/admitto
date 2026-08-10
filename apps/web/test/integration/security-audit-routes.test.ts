import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { PrismaClient } from "@admitto/db";
import { createTestPrismaClient } from "@admitto/db/testing";
import { createSession, hashPassword, SESSION_STAGE } from "@admitto/auth";
import { encryptTotpSecret, generateTotpSecret } from "@admitto/auth/testing";
import { querySystemLogs, resetSystemLogBufferForTest } from "@admitto/shared/system-log";
import { createApp } from "../../src/app.js";
import { InMemoryRateLimitStore } from "../../src/rate-limit/in-memory.js";

const adminDistRoot = join(dirname(fileURLToPath(import.meta.url)), "../fixtures/admin-dist");

const ORG_SECURITY = "org-security-audit-test";
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
let prevInstanceOrgId: string | undefined;

/** Seed a superadmin, a non-superadmin admin, and a third "target" user referenced by some
 * SecurityAuditLog rows - no organization/event fixtures needed for the table itself (no org
 * scoping, see security-audit-routes.ts doc comment). A real Organization row is still seeded so
 * the export route's self-audit write (resolveInstanceOrganizationId, via INSTANCE_ORG_ID set in
 * beforeAll below) has something to resolve to, matching audit-routes.test.ts's own setup. */
async function seed(client: PrismaClient) {
  await client.securityAuditLog.deleteMany({});
  await client.adminAuditLog.deleteMany({ where: { organization_id: ORG_SECURITY } });
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
  await client.organization.deleteMany({ where: { id: ORG_SECURITY } });

  await client.organization.create({
    data: { id: ORG_SECURITY, name: "Security Audit Test Org", slug: "security-audit-test" },
  });

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
      { user_id: adminId, role: "admin", scope_type: "organization", scope_id: ORG_SECURITY },
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
        user_email: EMAIL_TARGET,
        user_display_name: "Target User",
        ip: "1.2.3.4",
        metadata: { userAgent: "curl/8.0" },
        created_at: new Date("2026-06-15T12:00:00.000Z"),
      },
      {
        event_type: "auth.login.fail",
        user_id: null,
        user_email: null,
        user_display_name: null,
        ip: "1.2.3.5",
        metadata: { email_redacted: "t***@example.com", userAgent: null },
        created_at: new Date("2026-06-16T12:00:00.000Z"),
      },
      {
        event_type: "auth.mfa.fail",
        user_id: targetId,
        user_email: EMAIL_TARGET,
        user_display_name: "Target User",
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
  prevInstanceOrgId = process.env.INSTANCE_ORG_ID;
  process.env.INSTANCE_ORG_ID = ORG_SECURITY;

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

  const superSession = await createSession(prisma, {
    userId: superId,
    stage: SESSION_STAGE.FULL,
    ip: "127.0.0.1",
  });
  superCookie = `admitto_session=${superSession.rawToken}`;
});

beforeEach(() => {
  resetSystemLogBufferForTest();
});

afterAll(async () => {
  if (prevInstanceOrgId !== undefined) process.env.INSTANCE_ORG_ID = prevInstanceOrgId;
  else delete process.env.INSTANCE_ORG_ID;
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
        country: { kind: string; countryCode?: string };
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
    // Every seeded row uses a public-looking IP (1.2.3.x) - never misclassified as internal.
    expect(body.entries.every((e) => e.country.kind !== "internal")).toBe(true);
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

  it("returns snapshot email/display_name when the User row is gone", async () => {
    await prisma.securityAuditLog.create({
      data: {
        event_type: "auth.oidc.success",
        user_id: "deleted-user-does-not-exist",
        user_email: "gone@example.com",
        user_display_name: "Gone User",
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
      expect(body.entries[0]?.user_email).toBe("gone@example.com");
      expect(body.entries[0]?.user_display_name).toBe("Gone User");
    } finally {
      await prisma.securityAuditLog.deleteMany({ where: { event_type: "auth.oidc.success" } });
    }
  });

  it("falls back to the live User row for legacy rows without snapshot columns", async () => {
    await prisma.securityAuditLog.create({
      data: {
        event_type: "auth.trusted_device.created",
        user_id: targetId,
        user_email: null,
        user_display_name: null,
        ip: "1.2.3.21",
        metadata: { sessionId: "sess-legacy" },
      },
    });
    try {
      const res = await app.request("/api/admin/security-audit-log?event_type=auth.trusted_device.created", {
        headers: { Cookie: superCookie },
      });
      const body = (await res.json()) as {
        entries: { user_email: string | null; user_display_name: string | null }[];
      };
      expect(body.entries).toHaveLength(1);
      expect(body.entries[0]?.user_email).toBe(EMAIL_TARGET);
      expect(body.entries[0]?.user_display_name).toBe("Target User");
    } finally {
      await prisma.securityAuditLog.deleteMany({ where: { event_type: "auth.trusted_device.created" } });
    }
  });

  it("finds deleted users by snapshot email via search", async () => {
    await prisma.securityAuditLog.create({
      data: {
        event_type: "auth.logout",
        user_id: "deleted-search-user",
        user_email: "deleted-search@example.com",
        user_display_name: "Deleted Search",
        ip: "1.2.3.20",
        metadata: { sessionId: "sess-x" },
      },
    });
    try {
      const res = await app.request(
        `/api/admin/security-audit-log?search=${encodeURIComponent("deleted-search@example.com")}`,
        { headers: { Cookie: superCookie } },
      );
      const body = (await res.json()) as { total: number; entries: { user_id: string | null }[] };
      expect(body.total).toBeGreaterThanOrEqual(1);
      expect(body.entries.some((e) => e.user_id === "deleted-search-user")).toBe(true);
    } finally {
      await prisma.securityAuditLog.deleteMany({ where: { user_id: "deleted-search-user" } });
    }
  });

  it("finds failed-login attempts by metadata.email via search", async () => {
    await prisma.securityAuditLog.create({
      data: {
        event_type: "auth.login.fail",
        user_id: null,
        user_email: null,
        user_display_name: null,
        ip: "1.2.3.21",
        metadata: { email: "attempted-fail@example.com", userAgent: null },
        created_at: new Date("2026-07-03T09:00:00.000Z"),
      },
    });
    try {
      const res = await app.request(
        `/api/admin/security-audit-log?event_type=auth.login.fail&search=${encodeURIComponent("Attempted-Fail@example.com")}`,
        { headers: { Cookie: superCookie } },
      );
      const body = (await res.json()) as {
        total: number;
        entries: { event_type: string; metadata: Record<string, unknown> | null }[];
      };
      expect(body.total).toBeGreaterThanOrEqual(1);
      expect(
        body.entries.some((e) => e.metadata?.email === "attempted-fail@example.com"),
      ).toBe(true);
    } finally {
      await prisma.securityAuditLog.deleteMany({
        where: {
          event_type: "auth.login.fail",
          metadata: { path: ["email"], equals: "attempted-fail@example.com" },
        },
      });
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

  it("filters by exact user_id, unlike search's fuzzy email match which can cross-match a second account", async () => {
    // A second account whose email contains the target's email as a literal substring - exactly
    // the shape of address a real attacker (or an innocent typo/subdomain trick) could register.
    const decoyEmail = `decoy+${EMAIL_TARGET}`;
    const decoy = await prisma.user.create({
      data: { email: decoyEmail, password_hash: await hashPassword(PASSWORD) },
    });
    await prisma.securityAuditLog.create({
      data: {
        event_type: "auth.login.success",
        user_id: decoy.id,
        user_email: decoyEmail,
        user_display_name: null,
        ip: "9.9.9.9",
        metadata: { userAgent: "curl/8.0" },
        created_at: new Date("2026-06-20T12:00:00.000Z"),
      },
    });

    try {
      const bySearch = await app.request(
        `/api/admin/security-audit-log?event_type=auth.login.success&search=${encodeURIComponent(EMAIL_TARGET)}`,
        { headers: { Cookie: superCookie } },
      );
      const searchBody = (await bySearch.json()) as { entries: { user_id: string | null }[]; total: number };
      // Demonstrates why the Edit user modal's Recent logins must not use `search`: the fuzzy
      // match also returns the decoy account's own login, not just the target's.
      expect(searchBody.total).toBe(2);
      expect(new Set(searchBody.entries.map((e) => e.user_id))).toEqual(new Set([targetId, decoy.id]));

      const byUserId = await app.request(
        `/api/admin/security-audit-log?event_type=auth.login.success&user_id=${targetId}`,
        { headers: { Cookie: superCookie } },
      );
      const userIdBody = (await byUserId.json()) as { entries: { user_id: string | null }[]; total: number };
      expect(userIdBody.total).toBe(1);
      expect(userIdBody.entries[0]?.user_id).toBe(targetId);
    } finally {
      await prisma.securityAuditLog.deleteMany({ where: { user_id: decoy.id } });
      await prisma.user.deleteMany({ where: { id: decoy.id } });
    }
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

describe("GET /api/admin/security-audit-log/export", () => {
  it("returns 401 without auth", async () => {
    const res = await app.request("/api/admin/security-audit-log/export?format=csv");
    expect(res.status).toBe(401);
  });

  it("returns 403 for non-superadmin admin", async () => {
    const adminSession = await createSession(prisma, { userId: adminId, stage: SESSION_STAGE.FULL });
    const res = await app.request("/api/admin/security-audit-log/export?format=csv", {
      headers: { Cookie: `admitto_session=${adminSession.rawToken}` },
    });
    expect(res.status).toBe(403);
    await prisma.session.delete({ where: { id: adminSession.session.id } });
  });

  it("rejects a format other than csv", async () => {
    const res = await app.request("/api/admin/security-audit-log/export?format=xlsx", {
      headers: { Cookie: superCookie },
    });
    expect(res.status).toBe(400);
  });

  it("returns a filtered CSV and self-audits the export into the instance org's admin audit log", async () => {
    const before = await app.request("/api/admin/audit-log?action_type=security_audit_log_exported", {
      headers: { Cookie: superCookie },
    });
    const beforeTotal = ((await before.json()) as { total: number }).total;

    const res = await app.request("/api/admin/security-audit-log/export?format=csv&event_type=auth.mfa.fail", {
      headers: { Cookie: superCookie },
    });
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toContain("text/csv");
    expect(res.headers.get("Content-Disposition")).toMatch(
      /^attachment; filename="security-audit-log-\d{4}-\d{2}-\d{2}\.csv"$/,
    );

    const buf = await res.arrayBuffer();
    const bytes = new Uint8Array(buf);
    expect(bytes[0]).toBe(0xef);
    expect(bytes[1]).toBe(0xbb);
    expect(bytes[2]).toBe(0xbf);

    const csv = new TextDecoder("utf-8").decode(buf);
    const lines = csv.replace(/^\uFEFF/, "").split("\r\n");
    expect(lines[0]).toBe('"time","event","user","ip","details"');
    expect(lines).toHaveLength(2);
    expect(lines[1]).toContain('"auth.mfa.fail"');
    expect(lines[1]).toContain('"Target User"');
    expect(lines[1]).toContain('"1.2.3.6"');

    const after = await app.request("/api/admin/audit-log?action_type=security_audit_log_exported", {
      headers: { Cookie: superCookie },
    });
    const afterTotal = ((await after.json()) as { total: number }).total;
    expect(afterTotal).toBe(beforeTotal + 1);

    const logs = querySystemLogs({ source: "admin" });
    expect(logs.some((entry) => entry.message === "security_audit_log_exported")).toBe(true);
  });

  it("exports \"Unknown\" for a null user_id and an empty details cell for null metadata", async () => {
    await prisma.securityAuditLog.create({
      data: {
        event_type: "auth.oidc.success",
        user_id: null,
        ip: "1.2.3.99",
        metadata: undefined,
        created_at: new Date("2026-08-01T00:00:00.000Z"),
      },
    });
    try {
      const res = await app.request(
        "/api/admin/security-audit-log/export?format=csv&event_type=auth.oidc.success",
        { headers: { Cookie: superCookie } },
      );
      expect(res.status).toBe(200);
      const lines = (await res.text()).split("\r\n");
      expect(lines).toHaveLength(2);
      // Row is [time, event, user, ip, details]; time is a fresh, non-deterministic timestamp,
      // so compare everything else positionally instead of the whole line.
      const cells = lines[1]!.split(",");
      expect(cells[1]).toBe('"auth.oidc.success"');
      expect(cells[2]).toBe('"Unknown"');
      expect(cells[3]).toBe('"1.2.3.99"');
      expect(cells[4]).toBe('""');
    } finally {
      await prisma.securityAuditLog.deleteMany({ where: { event_type: "auth.oidc.success" } });
    }
  });
});
