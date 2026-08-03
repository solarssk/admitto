import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { execSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { PrismaClient } from "@admitto/db";
import { createTestPrismaClient } from "@admitto/db/testing";
import { hashPassword, verifyPassword } from "../src/password.js";
import { normalizeEmail, createUser, findUserByEmail } from "../src/user.js";
import {
  createSession,
  validateSession,
  revokeSession,
  revokeAllOperatorSessionsForEvent,
  validatePartialSession,
  promoteSessionToFull,
} from "../src/session.js";
import { SESSION_STAGE, SESSION_IDLE_TIMEOUT_OPERATOR_MS } from "../src/constants.js";
import {
  canPerformCheckIn,
  canManageEvent,
  canManageInstance,
  canAccessAdminPanel,
  canAccessCheckInPanel,
  listCheckInEvents,
  listAdminEvents,
} from "../src/authorization.js";
import { login, logout } from "../src/login.js";
import { bootstrapSuperadmin, superadminInstanceExists } from "../src/bootstrap.js";
import { generateTotpSecret, encryptTotpSecret } from "../src/mfa/totp.js";
import { purgeAuthRetention, purgeSecurityAuditLog, resolveSecurityAuditLogRetentionDays } from "../src/retention.js";
import { assertTestDatabaseUrl } from "@admitto/db/test-db-guard";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DB_ROOT = path.resolve(__dirname, "..", "..", "db");

const ORG_A = "org-a-auth";
const ORG_B = "org-b-auth";
const EVENT_A = "event-a-auth";
const EVENT_B = "event-b-auth";
const USER_SUPER = "user-super-auth";
const USER_ADMIN_A = "user-admin-a-auth";
const USER_OP_A = "user-op-a-auth";
const USER_INACTIVE = "user-inactive-auth";

let prisma: PrismaClient;

beforeAll(async () => {
  assertTestDatabaseUrl(process.env.DATABASE_URL ?? "");
  execSync("npx prisma db push --force-reset --accept-data-loss", {
    cwd: DB_ROOT,
    env: { ...process.env },
    stdio: "pipe",
  });

  prisma = createTestPrismaClient();

  await prisma.organization.createMany({
    data: [
      { id: ORG_A, name: "Org A", slug: "org-a-auth" },
      { id: ORG_B, name: "Org B", slug: "org-b-auth" },
    ],
  });

  await prisma.event.createMany({
    data: [
      {
        id: EVENT_A,
        title: "Event A",
        slug: "event-a-auth",
        date: new Date("2026-09-01T09:00:00Z"),
        organization_id: ORG_A,
      },
      {
        id: EVENT_B,
        title: "Event B",
        slug: "event-b-auth",
        date: new Date("2026-09-01T09:00:00Z"),
        organization_id: ORG_B,
      },
    ],
  });

  const password_hash = await hashPassword("test-password-123");
  await prisma.user.createMany({
    data: [
      { id: USER_SUPER, email: "super@example.com", password_hash },
      { id: USER_ADMIN_A, email: "admin-a@example.com", password_hash },
      { id: USER_OP_A, email: "operator-a@example.com", password_hash },
      {
        id: USER_INACTIVE,
        email: "inactive@example.com",
        password_hash,
        is_active: false,
      },
    ],
  });

  await prisma.roleAssignment.createMany({
    data: [
      { user_id: USER_SUPER, role: "superadmin", scope_type: "instance", scope_id: null },
      { user_id: USER_ADMIN_A, role: "admin", scope_type: "organization", scope_id: ORG_A },
      { user_id: USER_OP_A, role: "operator", scope_type: "event", scope_id: EVENT_A },
    ],
  });

  for (const userId of [USER_SUPER, USER_ADMIN_A]) {
    await prisma.userMfaMethod.create({
      data: {
        user_id: userId,
        type: "totp",
        secret_enc: encryptTotpSecret(generateTotpSecret()),
        confirmed_at: new Date(),
      },
    });
  }
});

afterAll(async () => {
  await prisma.$disconnect();
});

describe("password", () => {
  it("argon2id round-trip", async () => {
    const hash = await hashPassword("secret-pass");
    expect(hash).not.toBe("secret-pass");
    expect(await verifyPassword("secret-pass", hash)).toBe(true);
    expect(await verifyPassword("wrong", hash)).toBe(false);
  });
});

describe("user", () => {
  it("normalizes email to lowercase", async () => {
    const user = await createUser(prisma, {
      email: "Mixed.Case@Example.COM",
      password: "pw",
    });
    expect(user.email).toBe("mixed.case@example.com");
    const found = await findUserByEmail(prisma, "MIXED.CASE@EXAMPLE.COM");
    expect(found?.id).toBe(user.id);
  });
});

describe("login", () => {
  it("rejects inactive user with inactive reason", async () => {
    const result = await login(prisma, {
      email: "inactive@example.com",
      password: "test-password-123",
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe("inactive");
  });

  it("rejects a nonexistent email with invalid_credentials (enumeration-safe)", async () => {
    const result = await login(prisma, {
      email: "no-such-user@example.com",
      password: "irrelevant-password",
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe("invalid_credentials");
  });
});

describe("logout", () => {
  it("is a no-op when there is no validated session", async () => {
    await expect(logout(prisma, null)).resolves.toBeUndefined();
  });

  it("revokes an active session and logs the logout event", async () => {
    const { session, rawToken } = await createSession(prisma, { userId: USER_OP_A, stage: SESSION_STAGE.FULL });
    try {
      const validated = await validateSession(prisma, rawToken);
      expect(validated).not.toBeNull();

      await logout(prisma, validated, { ip: "203.0.113.9" });

      expect(await validateSession(prisma, rawToken)).toBeNull();
      const logged = await prisma.securityAuditLog.findFirst({
        where: { event_type: "auth.logout", user_id: USER_OP_A },
        orderBy: { created_at: "desc" },
      });
      expect(logged?.metadata).toMatchObject({ sessionId: session.id });
      expect(logged?.ip).toBe("203.0.113.9");
    } finally {
      // A revoked session left behind would otherwise be swept up by the "auth retention
      // purge" describe block below, which purges *any* revoked/expired session regardless
      // of which test created it (CodeRabbit PR #611).
      await prisma.session.deleteMany({ where: { id: session.id } });
    }
  });

  it("is idempotent when the session is already revoked (no duplicate audit log)", async () => {
    const { session, rawToken } = await createSession(prisma, { userId: USER_OP_A, stage: SESSION_STAGE.FULL });
    try {
      const validated = await validateSession(prisma, rawToken);
      expect(validated).not.toBeNull();
      if (!validated) throw new Error("unreachable");

      await revokeSession(prisma, validated.session.id);
      const countBefore = await prisma.securityAuditLog.count({
        where: { event_type: "auth.logout", metadata: { path: ["sessionId"], equals: validated.session.id } },
      });

      await logout(prisma, validated);

      const countAfter = await prisma.securityAuditLog.count({
        where: { event_type: "auth.logout", metadata: { path: ["sessionId"], equals: validated.session.id } },
      });
      expect(countAfter).toBe(countBefore);
    } finally {
      await prisma.session.deleteMany({ where: { id: session.id } });
    }
  });
});

describe("session", () => {
  it("create and validate", async () => {
    const { rawToken } = await createSession(prisma, { userId: USER_OP_A });
    const validated = await validateSession(prisma, rawToken);
    expect(validated?.userId).toBe(USER_OP_A);
  });

  it("rejects expired session", async () => {
    const { rawToken, session } = await createSession(prisma, { userId: USER_OP_A });
    await prisma.session.update({
      where: { id: session.id },
      data: { expires_at: new Date(Date.now() - 1000) },
    });
    expect(await validateSession(prisma, rawToken)).toBeNull();
  });

  it("rejects revoked session", async () => {
    const { rawToken, session } = await createSession(prisma, { userId: USER_OP_A });
    await revokeSession(prisma, session.id);
    expect(await validateSession(prisma, rawToken)).toBeNull();
  });

  it("rejects full session after idle timeout (last_seen_at beyond the idle window)", async () => {
    const { rawToken, session } = await createSession(prisma, { userId: USER_OP_A });
    await prisma.session.update({
      where: { id: session.id },
      data: {
        last_seen_at: new Date(Date.now() - SESSION_IDLE_TIMEOUT_OPERATOR_MS - 1000),
      },
    });
    expect(await validateSession(prisma, rawToken)).toBeNull();
    const revoked = await prisma.session.findUnique({ where: { id: session.id } });
    expect(revoked?.revoked_at).not.toBeNull();
  });

  it("does not resurrect an idle-expired session when the idle timeout is increased", async () => {
    const { rawToken, session } = await createSession(prisma, { userId: USER_OP_A });
    await prisma.session.update({
      where: { id: session.id },
      data: {
        last_seen_at: new Date(Date.now() - SESSION_IDLE_TIMEOUT_OPERATOR_MS - 1000),
      },
    });
    expect(await validateSession(prisma, rawToken)).toBeNull();

    await prisma.systemSettings.upsert({
      where: { key: "operator_session_idle_timeout" },
      create: { key: "operator_session_idle_timeout", value_json: String(24 * 60 * 60 * 1000) },
      update: { value_json: String(24 * 60 * 60 * 1000) },
    });

    expect(await validateSession(prisma, rawToken)).toBeNull();
    const stillRevoked = await prisma.session.findUnique({ where: { id: session.id } });
    expect(stillRevoked?.revoked_at).not.toBeNull();
  });

  it("keeps full session alive within the idle window", async () => {
    const { rawToken, session } = await createSession(prisma, { userId: USER_OP_A });
    await prisma.session.update({
      where: { id: session.id },
      data: {
        last_seen_at: new Date(Date.now() - SESSION_IDLE_TIMEOUT_OPERATOR_MS + 60_000),
      },
    });
    expect(await validateSession(prisma, rawToken)).not.toBeNull();
  });

  it("defaults MFA-required users to partial stage when stage omitted", async () => {
    const { rawToken, session } = await createSession(prisma, { userId: USER_ADMIN_A });
    expect(session.stage).toBe(SESSION_STAGE.MFA_PENDING);
    expect(await validateSession(prisma, rawToken)).toBeNull();
    expect(await validatePartialSession(prisma, rawToken)).not.toBeNull();
  });

  it("rejects session when user is inactive", async () => {
    const { rawToken } = await createSession(prisma, { userId: USER_OP_A });
    await prisma.user.update({ where: { id: USER_OP_A }, data: { is_active: false } });
    try {
      expect(await validateSession(prisma, rawToken)).toBeNull();
    } finally {
      await prisma.user.update({ where: { id: USER_OP_A }, data: { is_active: true } });
    }
  });

  it("revokeAllOperatorSessionsForEvent only affects operators on event", async () => {
    await prisma.session.deleteMany({
      where: { user_id: { in: [USER_OP_A, USER_ADMIN_A] } },
    });
    const op = await createSession(prisma, { userId: USER_OP_A });
    const admin = await createSession(prisma, { userId: USER_ADMIN_A, stage: SESSION_STAGE.FULL });
    const count = await revokeAllOperatorSessionsForEvent(prisma, EVENT_A);
    expect(count).toBe(1);
    expect(await validateSession(prisma, op.rawToken)).toBeNull();
    expect(await validateSession(prisma, admin.rawToken)).not.toBeNull();
  });

  it("revokeAllOperatorSessionsForEvent preserves sessions for mixed operator+admin users", async () => {
    const mixedId = "user-mixed-op-admin-auth";
    const password_hash = await hashPassword("x");
    await prisma.session.deleteMany({ where: { user: { id: mixedId } } });
    await prisma.userMfaMethod.deleteMany({ where: { user_id: mixedId } });
    await prisma.roleAssignment.deleteMany({ where: { user_id: mixedId } });
    await prisma.user.deleteMany({ where: { id: mixedId } });
    await prisma.session.deleteMany({ where: { user_id: USER_OP_A } });

    await prisma.user.create({
      data: { id: mixedId, email: "mixed@example.com", password_hash },
    });
    await prisma.roleAssignment.createMany({
      data: [
        { user_id: mixedId, role: "operator", scope_type: "event", scope_id: EVENT_A },
        { user_id: mixedId, role: "admin", scope_type: "organization", scope_id: ORG_A },
      ],
    });
    await prisma.userMfaMethod.create({
      data: {
        user_id: mixedId,
        type: "totp",
        secret_enc: encryptTotpSecret(generateTotpSecret()),
        confirmed_at: new Date(),
      },
    });
    try {
      const mixed = await createSession(prisma, { userId: mixedId, stage: SESSION_STAGE.FULL });
      const op = await createSession(prisma, { userId: USER_OP_A });
      const count = await revokeAllOperatorSessionsForEvent(prisma, EVENT_A);
      expect(count).toBe(1);
      expect(await validateSession(prisma, op.rawToken)).toBeNull();
      expect(await validateSession(prisma, mixed.rawToken)).not.toBeNull();
    } finally {
      await prisma.session.deleteMany({ where: { user: { id: mixedId } } });
      await prisma.userMfaMethod.deleteMany({ where: { user_id: mixedId } });
      await prisma.roleAssignment.deleteMany({ where: { user_id: mixedId } });
      await prisma.user.deleteMany({ where: { id: mixedId } });
    }
  });
});

describe("authorization", () => {
  it("canPerformCheckIn — superadmin all events", async () => {
    expect(await canPerformCheckIn(prisma, USER_SUPER, EVENT_A)).toBe(true);
    expect(await canPerformCheckIn(prisma, USER_SUPER, EVENT_B)).toBe(true);
  });

  it("canPerformCheckIn — admin in org only", async () => {
    expect(await canPerformCheckIn(prisma, USER_ADMIN_A, EVENT_A)).toBe(true);
    expect(await canPerformCheckIn(prisma, USER_ADMIN_A, EVENT_B)).toBe(false);
  });

  it("canPerformCheckIn — operator on assigned event only", async () => {
    expect(await canPerformCheckIn(prisma, USER_OP_A, EVENT_A)).toBe(true);
    expect(await canPerformCheckIn(prisma, USER_OP_A, EVENT_B)).toBe(false);
  });

  it("canManageEvent — admin yes, operator no", async () => {
    expect(await canManageEvent(prisma, USER_ADMIN_A, EVENT_A)).toBe(true);
    expect(await canManageEvent(prisma, USER_OP_A, EVENT_A)).toBe(false);
  });

  it("canManageInstance — superadmin only", async () => {
    expect(await canManageInstance(prisma, USER_SUPER)).toBe(true);
    expect(await canManageInstance(prisma, USER_ADMIN_A)).toBe(false);
  });

  it("canAccessAdminPanel — superadmin and org admin", async () => {
    expect(await canAccessAdminPanel(prisma, USER_SUPER)).toBe(true);
    expect(await canAccessAdminPanel(prisma, USER_ADMIN_A)).toBe(true);
    expect(await canAccessAdminPanel(prisma, USER_OP_A)).toBe(false);
  });

  it("canAccessCheckInPanel and listCheckInEvents", async () => {
    expect(await canAccessCheckInPanel(prisma, USER_OP_A)).toBe(true);
    expect(await canAccessCheckInPanel(prisma, USER_ADMIN_A)).toBe(true);
    const opEvents = await listCheckInEvents(prisma, USER_OP_A);
    expect(opEvents.some((e) => e.id === EVENT_A)).toBe(true);
    expect(opEvents.some((e) => e.id === EVENT_B)).toBe(false);
  });

  it("listCheckInEvents — excludes archived events", async () => {
    await prisma.event.update({
      where: { id: EVENT_A },
      data: { archived_at: new Date() },
    });
    try {
      expect((await listCheckInEvents(prisma, USER_OP_A)).some((e) => e.id === EVENT_A)).toBe(false);
      expect((await listCheckInEvents(prisma, USER_SUPER)).some((e) => e.id === EVENT_A)).toBe(false);
    } finally {
      await prisma.event.update({
        where: { id: EVENT_A },
        data: { archived_at: null },
      });
    }
  });

  it("listAdminEvents — scoped by org", async () => {
    const adminEvents = await listAdminEvents(prisma, USER_ADMIN_A);
    expect(adminEvents.length).toBeGreaterThan(0);
    expect(adminEvents.every((e) => e.id === EVENT_A)).toBe(true);
    expect(await listAdminEvents(prisma, USER_OP_A)).toEqual([]);
  });

  it("listAdminEvents — excludes archived by default", async () => {
    await prisma.event.update({
      where: { id: EVENT_A },
      data: { archived_at: new Date() },
    });
    try {
      const activeOnly = await listAdminEvents(prisma, USER_SUPER);
      expect(activeOnly.some((e) => e.id === EVENT_A)).toBe(false);

      const withArchived = await listAdminEvents(prisma, USER_SUPER, { includeArchived: true });
      const archived = withArchived.find((e) => e.id === EVENT_A);
      expect(archived?.archived_at).not.toBeNull();
    } finally {
      await prisma.event.update({
        where: { id: EVENT_A },
        data: { archived_at: null },
      });
    }
  });

  it("listAdminEvents — has_coordinates reflects EventLocation pin completeness", async () => {
    await prisma.eventLocation.deleteMany({ where: { event_id: EVENT_A } });
    const withoutPin = (await listAdminEvents(prisma, USER_SUPER)).find((e) => e.id === EVENT_A);
    expect(withoutPin?.has_coordinates).toBe(false);
    expect(withoutPin?.location).toBeNull();

    await prisma.eventLocation.create({
      data: {
        event_id: EVENT_A,
        venue_name: "Hall A",
        latitude: 52.23,
        longitude: null,
      },
    });
    const halfPin = (await listAdminEvents(prisma, USER_SUPER)).find((e) => e.id === EVENT_A);
    expect(halfPin?.has_coordinates).toBe(false);
    expect(halfPin?.location).toBe("Hall A");

    await prisma.eventLocation.update({
      where: { event_id: EVENT_A },
      data: { longitude: 21.01 },
    });
    const fullPin = (await listAdminEvents(prisma, USER_SUPER)).find((e) => e.id === EVENT_A);
    expect(fullPin?.has_coordinates).toBe(true);
    expect(fullPin?.location).toBe("Hall A");

    await prisma.eventLocation.deleteMany({ where: { event_id: EVENT_A } });
  });
});

describe("bootstrap", () => {
  it("creates superadmin user and assignment", async () => {
    expect(await superadminInstanceExists(prisma)).toBe(true);
    const email = "bootstrap-new@example.com";
    const before = await prisma.user.count({ where: { email } });
    expect(before).toBe(0);
    await bootstrapSuperadmin(prisma, email, "bootstrap-pass-xyz");
    const user = await prisma.user.findUnique({ where: { email } });
    expect(user).not.toBeNull();
    const assignment = await prisma.roleAssignment.findFirst({
      where: { user_id: user!.id, role: "superadmin", scope_type: "instance" },
    });
    expect(assignment).not.toBeNull();
  });

  it("rejects bootstrap passwords that fail shared policy checks", async () => {
    const email = "bootstrap-weak@example.com";
    await expect(bootstrapSuperadmin(prisma, email, "password123")).rejects.toThrow();
    await expect(bootstrapSuperadmin(prisma, email, "short")).rejects.toThrow();
    expect(await prisma.user.count({ where: { email } })).toBe(0);
  });
});

describe("auth retention purge", () => {
  it("deletes only expired or revoked sessions and trusted devices", async () => {
    const now = new Date("2026-09-10T12:00:00Z");
    const future = new Date("2026-09-10T13:00:00Z");
    const past = new Date("2026-09-10T11:00:00Z");
    await prisma.session.deleteMany({ where: { id: { startsWith: "session-retention-" } } });
    await prisma.trustedDevice.deleteMany({ where: { id: { startsWith: "trusted-retention-" } } });
    const baseline = await purgeAuthRetention(prisma, { now, dryRun: true });

    await prisma.session.createMany({
      data: [
        {
          id: "session-retention-active",
          user_id: USER_SUPER,
          token_hash: "session-retention-active-hash",
          expires_at: future,
        },
        {
          id: "session-retention-expired",
          user_id: USER_SUPER,
          token_hash: "session-retention-expired-hash",
          expires_at: past,
        },
        {
          id: "session-retention-revoked",
          user_id: USER_SUPER,
          token_hash: "session-retention-revoked-hash",
          expires_at: future,
          revoked_at: past,
        },
      ],
    });

    await prisma.trustedDevice.createMany({
      data: [
        {
          id: "trusted-retention-active",
          user_id: USER_SUPER,
          token_hash: "trusted-retention-active-hash",
          expires_at: future,
        },
        {
          id: "trusted-retention-expired",
          user_id: USER_SUPER,
          token_hash: "trusted-retention-expired-hash",
          expires_at: past,
        },
        {
          id: "trusted-retention-revoked",
          user_id: USER_SUPER,
          token_hash: "trusted-retention-revoked-hash",
          expires_at: future,
          revoked_at: past,
        },
      ],
    });

    const dryRun = await purgeAuthRetention(prisma, { now, dryRun: true });
    expect(dryRun).toEqual({
      sessions: baseline.sessions + 2,
      trustedDevices: baseline.trustedDevices + 2,
    });
    expect(await prisma.session.count({ where: { id: { startsWith: "session-retention-" } } })).toBe(3);

    const purged = await purgeAuthRetention(prisma, { now, batchSize: 1 });
    expect(purged).toEqual({
      sessions: baseline.sessions + 2,
      trustedDevices: baseline.trustedDevices + 2,
    });

    expect(
      await prisma.session.findMany({
        where: { id: { startsWith: "session-retention-" } },
        select: { id: true },
      }),
    ).toEqual([{ id: "session-retention-active" }]);
    expect(
      await prisma.trustedDevice.findMany({
        where: { id: { startsWith: "trusted-retention-" } },
        select: { id: true },
      }),
    ).toEqual([{ id: "trusted-retention-active" }]);

    await prisma.session.deleteMany({ where: { id: "session-retention-active" } });
    await prisma.trustedDevice.deleteMany({ where: { id: "trusted-retention-active" } });
  });
});

describe("security audit log retention", () => {
  it("deletes only SecurityAuditLog rows older than the retention window", async () => {
    // Real current time, not a fixed future date: this file's own tests (and other files
    // sharing this test DB) create real SecurityAuditLog rows with a real `created_at`. A fixed
    // "now" far enough in the future combined with the default 30-day retention would make the
    // non-dry-run purge calls below sweep up those unrelated, unprefixed rows too (CodeRabbit PR
    // #611) - anchoring "now" to the actual clock keeps the cutoff in the real past, where only
    // this test's own explicitly-backdated fixtures fall.
    const now = new Date();
    const stale = new Date(now.getTime() - 31 * 24 * 60 * 60 * 1000); // past the default 30-day window
    const fresh = new Date(now.getTime() - 1 * 24 * 60 * 60 * 1000); // well within the window

    await prisma.securityAuditLog.deleteMany({ where: { id: { startsWith: "sec-audit-retention-" } } });
    const baseline = await purgeSecurityAuditLog(prisma, { now, dryRun: true });

    await prisma.securityAuditLog.createMany({
      data: [
        { id: "sec-audit-retention-fresh", event_type: "auth.login.success", created_at: fresh },
        { id: "sec-audit-retention-stale", event_type: "auth.login.fail", created_at: stale },
      ],
    });

    const dryRun = await purgeSecurityAuditLog(prisma, { now, dryRun: true });
    expect(dryRun).toEqual({ deleted: baseline.deleted + 1 });
    expect(await prisma.securityAuditLog.count({ where: { id: { startsWith: "sec-audit-retention-" } } })).toBe(2);

    const purged = await purgeSecurityAuditLog(prisma, { now, batchSize: 1 });
    expect(purged).toEqual({ deleted: baseline.deleted + 1 });

    expect(
      await prisma.securityAuditLog.findMany({
        where: { id: { startsWith: "sec-audit-retention-" } },
        select: { id: true },
      }),
    ).toEqual([{ id: "sec-audit-retention-fresh" }]);

    await prisma.securityAuditLog.deleteMany({ where: { id: "sec-audit-retention-fresh" } });
  });

  it("honors a custom retentionDays override", async () => {
    const now = new Date(); // real clock - see the comment in the test above
    const eightDaysAgo = new Date(now.getTime() - 8 * 24 * 60 * 60 * 1000);

    await prisma.securityAuditLog.deleteMany({ where: { id: "sec-audit-retention-7d" } });
    await prisma.securityAuditLog.create({
      data: { id: "sec-audit-retention-7d", event_type: "auth.logout", created_at: eightDaysAgo },
    });

    // 8 days back survives the default 30-day window...
    await purgeSecurityAuditLog(prisma, { now, dryRun: false, retentionDays: 30 });
    expect(
      await prisma.securityAuditLog.findUnique({ where: { id: "sec-audit-retention-7d" } }),
    ).not.toBeNull();

    // ...but not a 7-day window.
    await purgeSecurityAuditLog(prisma, { now, dryRun: false, retentionDays: 7 });
    expect(await prisma.securityAuditLog.findUnique({ where: { id: "sec-audit-retention-7d" } })).toBeNull();
  });

  it("falls back to the 30-day default for a non-positive or non-finite retentionDays", async () => {
    const now = new Date(); // real clock - see the comment in the first test above
    const twentyDaysAgo = new Date(now.getTime() - 20 * 24 * 60 * 60 * 1000);

    await prisma.securityAuditLog.deleteMany({ where: { id: "sec-audit-retention-fallback" } });
    await prisma.securityAuditLog.create({
      data: { id: "sec-audit-retention-fallback", event_type: "auth.mfa.fail", created_at: twentyDaysAgo },
    });

    for (const invalid of [0, -5, Number.NaN]) {
      await purgeSecurityAuditLog(prisma, { now, dryRun: false, retentionDays: invalid });
      expect(
        await prisma.securityAuditLog.findUnique({ where: { id: "sec-audit-retention-fallback" } }),
      ).not.toBeNull();
    }

    await prisma.securityAuditLog.deleteMany({ where: { id: "sec-audit-retention-fallback" } });
  });

  it("clamps an absurdly large retentionDays instead of producing an Invalid Date cutoff", async () => {
    const now = new Date();
    await prisma.securityAuditLog.deleteMany({ where: { id: "sec-audit-retention-absurd" } });
    await prisma.securityAuditLog.create({
      data: { id: "sec-audit-retention-absurd", event_type: "auth.logout", created_at: now },
    });

    // A "keep forever" retentionDays this large would put the naive cutoff outside Date's
    // representable range; it must match nothing rather than throw or delete everything.
    const result = await purgeSecurityAuditLog(prisma, { now, dryRun: true, retentionDays: 1_000_000_000 });
    expect(result.deleted).toBe(0);
    expect(
      await prisma.securityAuditLog.findUnique({ where: { id: "sec-audit-retention-absurd" } }),
    ).not.toBeNull();

    await prisma.securityAuditLog.deleteMany({ where: { id: "sec-audit-retention-absurd" } });
  });

  it("resolves retention days from env with a safe fallback", () => {
    expect(resolveSecurityAuditLogRetentionDays({})).toBe(30);
    expect(
      resolveSecurityAuditLogRetentionDays({ SECURITY_AUDIT_LOG_RETENTION_DAYS: "90" }),
    ).toBe(90);
    expect(
      resolveSecurityAuditLogRetentionDays({ SECURITY_AUDIT_LOG_RETENTION_DAYS: "abc" }),
    ).toBe(30);
    expect(
      resolveSecurityAuditLogRetentionDays({ SECURITY_AUDIT_LOG_RETENTION_DAYS: "30days" }),
    ).toBe(30);
    expect(
      resolveSecurityAuditLogRetentionDays({ SECURITY_AUDIT_LOG_RETENTION_DAYS: "0" }),
    ).toBe(30);
  });
});
