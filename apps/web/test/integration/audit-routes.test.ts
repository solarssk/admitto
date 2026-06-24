import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PrismaClient } from "@prisma/client";
import { createSession, hashPassword, SESSION_STAGE } from "@admitto/auth";
import { encryptTotpSecret, generateTotpSecret } from "@admitto/auth/testing";
import { createApp } from "../../src/app.js";
import { InMemoryRateLimitStore } from "../../src/rate-limit/in-memory.js";

const adminDistRoot = join(dirname(fileURLToPath(import.meta.url)), "../fixtures/admin-dist");

const ORG_AUDIT = "org-audit-viewer-test";
const ORG_OTHER = "org-audit-viewer-other";
const EMAIL_SUPER = "audit-super@example.com";
const EMAIL_ADMIN = "audit-admin@example.com";
const PASSWORD = "audit-pass-123";

let prisma: PrismaClient;
let app: ReturnType<typeof createApp>;
let rateLimitStore: InMemoryRateLimitStore;

let superId: string;
let adminId: string;
let superCookie = "";
let prevInstanceOrgId: string | undefined;

const PII_FORBIDDEN = ["password", "secret", "hash"] as const;

/** Assert audit metadata keys do not contain PII-like field names. */
function assertNoPiiKeys(metadata: Record<string, unknown> | null): void {
  if (!metadata) return;
  for (const key of Object.keys(metadata)) {
    for (const forbidden of PII_FORBIDDEN) {
      expect(key.toLowerCase()).not.toContain(forbidden);
    }
  }
}

/** Seed orgs, users, and AdminAuditLog fixtures for audit-log route tests. */
async function seed(client: PrismaClient) {
  await client.adminAuditLog.deleteMany({
    where: { organization_id: { in: [ORG_AUDIT, ORG_OTHER] } },
  });
  await client.session.deleteMany({
    where: { user: { email: { in: [EMAIL_SUPER, EMAIL_ADMIN] } } },
  });
  await client.userMfaMethod.deleteMany({
    where: { user: { email: { in: [EMAIL_SUPER, EMAIL_ADMIN] } } },
  });
  await client.roleAssignment.deleteMany({
    where: { OR: [{ scope_id: ORG_AUDIT }, { scope_id: ORG_OTHER }] },
  });
  await client.user.deleteMany({
    where: { email: { in: [EMAIL_SUPER, EMAIL_ADMIN] } },
  });
  await client.organization.deleteMany({ where: { id: { in: [ORG_AUDIT, ORG_OTHER] } } });

  const password_hash = await hashPassword(PASSWORD);

  await client.organization.createMany({
    data: [
      { id: ORG_AUDIT, name: "Audit Test Org", slug: "audit-test" },
      { id: ORG_OTHER, name: "Audit Other Org", slug: "audit-other" },
    ],
  });

  const superUser = await client.user.create({ data: { email: EMAIL_SUPER, password_hash } });
  const adminUser = await client.user.create({ data: { email: EMAIL_ADMIN, password_hash } });
  superId = superUser.id;
  adminId = adminUser.id;

  await client.roleAssignment.createMany({
    data: [
      { user_id: superId, role: "superadmin", scope_type: "instance", scope_id: null },
      { user_id: adminId, role: "admin", scope_type: "organization", scope_id: ORG_AUDIT },
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

  await client.adminAuditLog.createMany({
    data: [
      {
        organization_id: ORG_AUDIT,
        actor_user_id: superId,
        action_type: "session_revoked",
        ip: "1.2.3.4",
        metadata: { session_id: "sess-1", target_user_id: adminId },
        created_at: new Date("2026-06-15T12:00:00.000Z"),
      },
      {
        organization_id: ORG_AUDIT,
        actor_user_id: superId,
        action_type: "mail_settings_updated",
        ip: "1.2.3.5",
        metadata: { fields: ["provider"] },
        created_at: new Date("2026-06-20T12:00:00.000Z"),
      },
      {
        organization_id: ORG_AUDIT,
        actor_user_id: superId,
        action_type: "event_archived",
        ip: null,
        metadata: { event_id: "evt-1" },
        created_at: new Date("2026-07-01T12:00:00.000Z"),
      },
      {
        organization_id: ORG_AUDIT,
        actor_user_id: superId,
        action_type: "system_settings_updated",
        ip: "1.2.3.6",
        metadata: { fields: ["session_ttl_ms"] },
        created_at: new Date("2026-06-30T23:45:00.000Z"),
      },
      {
        organization_id: ORG_OTHER,
        actor_user_id: superId,
        action_type: "session_revoked",
        ip: "9.9.9.9",
        metadata: { session_id: "other-sess" },
        created_at: new Date("2026-06-20T12:00:00.000Z"),
      },
    ],
  });
}

beforeAll(async () => {
  prevInstanceOrgId = process.env.INSTANCE_ORG_ID;
  process.env.INSTANCE_ORG_ID = ORG_AUDIT;

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
  if (prevInstanceOrgId !== undefined) process.env.INSTANCE_ORG_ID = prevInstanceOrgId;
  else delete process.env.INSTANCE_ORG_ID;
  await prisma?.$disconnect();
});

describe("GET /api/admin/audit-log", () => {
  it("returns 401 without auth", async () => {
    const res = await app.request("/api/admin/audit-log");
    expect(res.status).toBe(401);
  });

  it("returns 403 for non-superadmin admin", async () => {
    const adminSession = await createSession(prisma, {
      userId: adminId,
      stage: SESSION_STAGE.FULL,
    });
    const res = await app.request("/api/admin/audit-log", {
      headers: { Cookie: `admitto_session=${adminSession.rawToken}` },
    });
    expect(res.status).toBe(403);
    await prisma.session.delete({ where: { id: adminSession.session.id } });
  });

  it("returns 403 when superadmin must change password", async () => {
    await prisma.user.update({
      where: { id: superId },
      data: { must_change_password: true },
    });
    const res = await app.request("/api/admin/audit-log", {
      headers: { Cookie: superCookie },
    });
    expect(res.status).toBe(403);
    const body = (await res.json()) as { code?: string };
    expect(body.code).toBe("password_change_required");
    await prisma.user.update({
      where: { id: superId },
      data: { must_change_password: false },
    });
  });

  it("returns 200 with entries, total, page, pageSize for superadmin", async () => {
    const res = await app.request("/api/admin/audit-log", {
      headers: { Cookie: superCookie },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      entries: {
        id: string;
        action_type: string;
        actor_email: string | null;
        actor_display_name: string | null;
        metadata: Record<string, unknown> | null;
      }[];
      total: number;
      page: number;
      pageSize: number;
    };
    expect(body.page).toBe(1);
    expect(body.pageSize).toBe(25);
    expect(body.total).toBe(4);
    expect(body.entries).toHaveLength(4);
    expect(body.entries[0]?.actor_email).toBe(EMAIL_SUPER);
    for (const entry of body.entries) {
      assertNoPiiKeys(entry.metadata);
    }
  });

  it("filters by action_type", async () => {
    const res = await app.request("/api/admin/audit-log?action_type=session_revoked", {
      headers: { Cookie: superCookie },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { entries: { action_type: string }[]; total: number };
    expect(body.total).toBe(1);
    expect(body.entries.every((e) => e.action_type === "session_revoked")).toBe(true);
  });

  it("filters by start and end date", async () => {
    const res = await app.request(
      "/api/admin/audit-log?start=2026-06-16&end=2026-06-30",
      { headers: { Cookie: superCookie } },
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { entries: { action_type: string }[]; total: number };
    expect(body.total).toBe(2);
    const types = body.entries.map((e) => e.action_type).sort();
    expect(types).toEqual(["mail_settings_updated", "system_settings_updated"]);
  });

  it("includes midday entry when end equals that calendar day", async () => {
    const res = await app.request("/api/admin/audit-log?end=2026-06-20", {
      headers: { Cookie: superCookie },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { entries: { action_type: string; created_at: string }[] };
    const midday = body.entries.find((e) => e.action_type === "mail_settings_updated");
    expect(midday?.created_at).toBe("2026-06-20T12:00:00.000Z");
  });

  it("includes entries late on the inclusive end date", async () => {
    const res = await app.request("/api/admin/audit-log?end=2026-06-30", {
      headers: { Cookie: superCookie },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { entries: { action_type: string; created_at: string }[] };
    const lateEndDay = body.entries.find((e) => e.action_type === "system_settings_updated");
    expect(lateEndDay?.created_at).toBe("2026-06-30T23:45:00.000Z");
  });

  it("does not expose audit entries from other organizations", async () => {
    const res = await app.request("/api/admin/audit-log", {
      headers: { Cookie: superCookie },
    });
    const body = (await res.json()) as { entries: { ip: string | null }[] };
    const ips = body.entries.map((e) => e.ip);
    expect(ips).not.toContain("9.9.9.9");
  });

  it("returns actor_user_id when actor user is deleted", async () => {
    const ghostId = "ghost-actor-audit-test";
    await prisma.user.create({
      data: { id: ghostId, email: "ghost-audit@example.com", password_hash: await hashPassword(PASSWORD) },
    });
    await prisma.adminAuditLog.create({
      data: {
        organization_id: ORG_AUDIT,
        actor_user_id: ghostId,
        action_type: "system_settings_updated",
        metadata: { fields: ["session_ttl_ms"] },
      },
    });
    await prisma.user.delete({ where: { id: ghostId } });

    const res = await app.request("/api/admin/audit-log?action_type=system_settings_updated", {
      headers: { Cookie: superCookie },
    });
    const body = (await res.json()) as {
      entries: { actor_user_id: string; actor_email: string | null }[];
    };
    const ghostEntry = body.entries.find((e) => e.actor_user_id === ghostId);
    expect(ghostEntry?.actor_email).toBeNull();

    await prisma.adminAuditLog.deleteMany({
      where: { actor_user_id: ghostId, organization_id: ORG_AUDIT },
    });
  });

  it("clamps pageSize to 100", async () => {
    const res = await app.request("/api/admin/audit-log?pageSize=999", {
      headers: { Cookie: superCookie },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { pageSize: number };
    expect(body.pageSize).toBe(100);
  });

  it("ignores invalid calendar date filters", async () => {
    const res = await app.request("/api/admin/audit-log?start=2026-02-30&end=2026-02-30", {
      headers: { Cookie: superCookie },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { total: number };
    expect(body.total).toBe(4);
  });

  it("returns empty list for unknown action_type filter", async () => {
    const res = await app.request("/api/admin/audit-log?action_type=typo_action", {
      headers: { Cookie: superCookie },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { entries: unknown[]; total: number };
    expect(body.total).toBe(0);
    expect(body.entries).toHaveLength(0);
  });
});
