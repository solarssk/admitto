import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { execSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { PrismaClient } from "@prisma/client";
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
import { SESSION_STAGE } from "../src/constants.js";
import {
  canPerformCheckIn,
  canManageEvent,
  canManageInstance,
  canAccessAdminPanel,
  canAccessCheckInPanel,
  listCheckInEvents,
  listAdminEvents,
} from "../src/authorization.js";
import { login } from "../src/login.js";
import { bootstrapSuperadmin, superadminInstanceExists } from "../src/bootstrap.js";
import { generateTotpSecret, encryptTotpSecret } from "../src/mfa/totp.js";
import { purgeAuthRetention } from "../src/retention.js";
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

  prisma = new PrismaClient();

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
