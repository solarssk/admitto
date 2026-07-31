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
  // Event has onDelete: Restrict against Organization - must go before organization.deleteMany.
  await client.event.deleteMany({
    where: { organization_id: { in: [ORG_AUDIT, ORG_OTHER] } },
  });
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

  await client.event.create({
    data: {
      id: "evt-searchable",
      organization_id: ORG_AUDIT,
      title: "Searchable Summit",
      slug: "audit-route-test-searchable-summit",
      date: new Date("2026-09-01T09:00:00.000Z"),
    },
  });

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
        organization_id: ORG_AUDIT,
        actor_user_id: superId,
        action_type: "event_updated",
        ip: "1.2.3.7",
        metadata: { eventId: "evt-2" },
        actor_timezone: "Europe/Warsaw",
        created_at: new Date("2026-07-02T09:00:00.000Z"),
      },
      {
        organization_id: ORG_AUDIT,
        actor_user_id: superId,
        action_type: "event_created",
        ip: "1.2.3.8",
        metadata: { eventId: "evt-searchable" },
        created_at: new Date("2026-07-03T09:00:00.000Z"),
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
        actor_timezone: string | null;
        metadata: Record<string, unknown> | null;
      }[];
      total: number;
      page: number;
      pageSize: number;
    };
    expect(body.page).toBe(1);
    expect(body.pageSize).toBe(25);
    expect(body.total).toBe(6);
    expect(body.entries).toHaveLength(6);
    expect(body.entries[0]?.actor_email).toBe(EMAIL_SUPER);
    for (const entry of body.entries) {
      assertNoPiiKeys(entry.metadata);
    }
    const withTimezone = body.entries.find((e) => e.action_type === "event_updated");
    expect(withTimezone?.actor_timezone).toBe("Europe/Warsaw");
    const withoutTimezone = body.entries.find((e) => e.action_type === "session_revoked");
    expect(withoutTimezone?.actor_timezone).toBeNull();
  });

  it("filters by event_id, matching either the eventId or legacy event_id metadata key", async () => {
    const legacyKeyRes = await app.request("/api/admin/audit-log?event_id=evt-1", {
      headers: { Cookie: superCookie },
    });
    expect(legacyKeyRes.status).toBe(200);
    const legacyKeyBody = (await legacyKeyRes.json()) as { entries: { action_type: string }[]; total: number };
    expect(legacyKeyBody.total).toBe(1);
    expect(legacyKeyBody.entries[0]?.action_type).toBe("event_archived");

    const camelKeyRes = await app.request("/api/admin/audit-log?event_id=evt-2", {
      headers: { Cookie: superCookie },
    });
    const camelKeyBody = (await camelKeyRes.json()) as { entries: { action_type: string }[]; total: number };
    expect(camelKeyBody.total).toBe(1);
    expect(camelKeyBody.entries[0]?.action_type).toBe("event_updated");

    const unknownRes = await app.request("/api/admin/audit-log?event_id=evt-does-not-exist", {
      headers: { Cookie: superCookie },
    });
    const unknownBody = (await unknownRes.json()) as { total: number };
    expect(unknownBody.total).toBe(0);
  });

  it("filters by search, matching actor email or event title", async () => {
    const actorRes = await app.request("/api/admin/audit-log?search=audit-super", {
      headers: { Cookie: superCookie },
    });
    expect(actorRes.status).toBe(200);
    const actorBody = (await actorRes.json()) as { total: number };
    expect(actorBody.total).toBe(6); // every ORG_AUDIT row is actor=superId

    const eventRes = await app.request("/api/admin/audit-log?search=Searchable", {
      headers: { Cookie: superCookie },
    });
    const eventBody = (await eventRes.json()) as { entries: { action_type: string }[]; total: number };
    expect(eventBody.total).toBe(1);
    expect(eventBody.entries[0]?.action_type).toBe("event_created");

    const noMatchRes = await app.request("/api/admin/audit-log?search=no-such-actor-or-event", {
      headers: { Cookie: superCookie },
    });
    const noMatchBody = (await noMatchRes.json()) as { total: number };
    expect(noMatchBody.total).toBe(0);
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

  it("filters by start alone (no end bound)", async () => {
    const res = await app.request("/api/admin/audit-log?start=2026-07-01", {
      headers: { Cookie: superCookie },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { entries: { action_type: string }[]; total: number };
    const types = body.entries.map((e) => e.action_type).sort();
    expect(types).toEqual(["event_archived", "event_created", "event_updated"]);
  });

  it("accepts a full ISO instant (with time) as a date bound, used as-is", async () => {
    const res = await app.request(
      "/api/admin/audit-log?start=2026-06-15T12:00:00.000Z&end=2026-06-15T12:00:00.000Z",
      { headers: { Cookie: superCookie } },
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { entries: { action_type: string }[]; total: number };
    expect(body.total).toBe(1);
    expect(body.entries[0]?.action_type).toBe("session_revoked");
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

  it.each([
    ["ignores an unparseable date bound", "start=not-a-real-date"],
    ["ignores invalid calendar date filters", "start=2026-02-30&end=2026-02-30"],
    ["ignores a date filter with a zero calendar component (e.g. month 00)", "start=2026-00-15"],
  ])("%s", async (_label, query) => {
    const res = await app.request(`/api/admin/audit-log?${query}`, {
      headers: { Cookie: superCookie },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { total: number };
    expect(body.total).toBe(6);
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

describe("GET /api/admin/audit-log/export", () => {
  it("returns 401 without auth", async () => {
    const res = await app.request("/api/admin/audit-log/export?format=csv");
    expect(res.status).toBe(401);
  });

  it("returns 403 for non-superadmin admin", async () => {
    const adminSession = await createSession(prisma, { userId: adminId, stage: SESSION_STAGE.FULL });
    const res = await app.request("/api/admin/audit-log/export?format=csv", {
      headers: { Cookie: `admitto_session=${adminSession.rawToken}` },
    });
    expect(res.status).toBe(403);
    await prisma.session.delete({ where: { id: adminSession.session.id } });
  });

  it("rejects a format other than csv", async () => {
    const res = await app.request("/api/admin/audit-log/export?format=xlsx", {
      headers: { Cookie: superCookie },
    });
    expect(res.status).toBe(400);
  });

  it("returns a filtered CSV and self-audits the export", async () => {
    const before = await app.request("/api/admin/audit-log?action_type=audit_log_exported", {
      headers: { Cookie: superCookie },
    });
    const beforeTotal = ((await before.json()) as { total: number }).total;

    const res = await app.request("/api/admin/audit-log/export?format=csv&action_type=session_revoked", {
      headers: { Cookie: superCookie },
    });
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toContain("text/csv");
    expect(res.headers.get("Content-Disposition")).toMatch(/^attachment; filename="audit-log-\d{4}-\d{2}-\d{2}\.csv"$/);

    const buf = await res.arrayBuffer();
    const bytes = new Uint8Array(buf);
    expect(bytes[0]).toBe(0xef);
    expect(bytes[1]).toBe(0xbb);
    expect(bytes[2]).toBe(0xbf);

    const csv = new TextDecoder("utf-8").decode(buf);
    const lines = csv.replace(/^\uFEFF/, "").split("\r\n");
    expect(lines[0]).toBe('"time","action","scope","actor","ip","details"');
    expect(lines).toHaveLength(2);
    expect(lines[1]).toContain('"session_revoked"');
    expect(lines[1]).toContain(`"${EMAIL_SUPER}"`);
    expect(lines[1]).toContain('"1.2.3.4"');
    expect(lines[1]).toContain('"Instance"');

    const after = await app.request("/api/admin/audit-log?action_type=audit_log_exported", {
      headers: { Cookie: superCookie },
    });
    const afterTotal = ((await after.json()) as { total: number }).total;
    expect(afterTotal).toBe(beforeTotal + 1);

    const logs = querySystemLogs({ source: "admin" });
    expect(logs.some((entry) => entry.message === "audit_log_exported")).toBe(true);
  });

  it("filters the export by event_id, matching the eventId metadata key", async () => {
    const res = await app.request("/api/admin/audit-log/export?format=csv&event_id=evt-2", {
      headers: { Cookie: superCookie },
    });
    expect(res.status).toBe(200);
    const csv = await res.text();
    const lines = csv.split("\r\n");
    expect(lines).toHaveLength(2);
    expect(lines[1]).toContain('"event_updated"');
    expect(lines[1]).toContain('"evt-2"');
  });

  it("exports a deleted actor's raw id and an empty details cell for null metadata", async () => {
    const ghostId = "ghost-actor-export-test";
    await prisma.user.create({
      data: { id: ghostId, email: "ghost-export@example.com", password_hash: await hashPassword(PASSWORD) },
    });
    await prisma.adminAuditLog.create({
      data: {
        organization_id: ORG_AUDIT,
        actor_user_id: ghostId,
        action_type: "emergency_session_purge",
        ip: "1.2.3.9",
        metadata: undefined,
      },
    });
    await prisma.user.delete({ where: { id: ghostId } });

    const res = await app.request("/api/admin/audit-log/export?format=csv&action_type=emergency_session_purge", {
      headers: { Cookie: superCookie },
    });
    expect(res.status).toBe(200);
    const lines = (await res.text()).split("\r\n");
    expect(lines).toHaveLength(2);
    // Row is [time, action, scope, actor, ip, details]; time is a fresh, non-deterministic
    // timestamp, so compare everything else positionally instead of the whole line.
    const cells = lines[1]!.split(",");
    expect(cells[1]).toBe('"emergency_session_purge"');
    expect(cells[2]).toBe('"Instance"');
    expect(cells[3]).toBe(`"${ghostId}"`);
    expect(cells[4]).toBe('"1.2.3.9"');
    expect(cells[5]).toBe('""');

    await prisma.adminAuditLog.deleteMany({
      where: { actor_user_id: ghostId, organization_id: ORG_AUDIT },
    });
  });
});
