import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { execSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { PrismaClient } from "../src/generated/prisma/client.js";
import { createTestPrismaClient } from "../src/testing.js";
import { hasScope } from "../src/roles.js";
import { assertTestDatabaseUrl } from "../src/testDbGuard.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DB_ROOT = path.resolve(__dirname, "..");

let prisma: PrismaClient;
const ORG_ID = "org_default";
const EVENT_ID = "test-event-roles-001";
const USER_SUPER = "user-superadmin";
const USER_ADMIN = "user-admin";
const USER_OP = "user-operator";
const USER_NONE = "user-no-roles";

beforeAll(async () => {
  assertTestDatabaseUrl(process.env.DATABASE_URL ?? "");
  execSync("npx prisma db push --force-reset --accept-data-loss", {
    cwd: DB_ROOT,
    env: { ...process.env },
    stdio: "pipe",
  });

  prisma = createTestPrismaClient();

  await prisma.organization.create({
    data: { id: ORG_ID, name: "Default", slug: "default" },
  });
  await prisma.event.create({
    data: {
      id: EVENT_ID,
      title: "Roles Test Event",
      slug: "roles-test-event",
      date: new Date("2026-09-01T09:00:00Z"),
      organization_id: ORG_ID,
    },
  });

  const users = [USER_SUPER, USER_ADMIN, USER_OP, USER_NONE];
  for (const id of users) {
    await prisma.user.create({
      data: {
        id,
        email: `${id}@example.com`,
        password_hash: "unused",
      },
    });
  }

  await prisma.roleAssignment.createMany({
    data: [
      { user_id: USER_SUPER, role: "superadmin", scope_type: "instance", scope_id: null },
      { user_id: USER_ADMIN, role: "admin", scope_type: "organization", scope_id: ORG_ID },
      { user_id: USER_OP, role: "operator", scope_type: "event", scope_id: EVENT_ID },
    ],
  });
});

afterAll(async () => {
  await prisma.$disconnect();
});

describe("hasScope — instance", () => {
  it("returns true for superadmin@instance when assignment exists", async () => {
    expect(await hasScope(prisma, USER_SUPER, "superadmin", "instance")).toBe(true);
  });

  it("returns false for user with no assignments", async () => {
    expect(await hasScope(prisma, USER_NONE, "superadmin", "instance")).toBe(false);
  });
});

describe("hasScope — organization", () => {
  it("returns true for admin@organization when assignment matches scopeId", async () => {
    expect(await hasScope(prisma, USER_ADMIN, "admin", "organization", ORG_ID)).toBe(true);
  });

  it("returns false for wrong scopeId", async () => {
    expect(await hasScope(prisma, USER_ADMIN, "admin", "organization", "other-org")).toBe(false);
  });

  it("returns false when scopeId omitted but assignment has scopeId", async () => {
    expect(await hasScope(prisma, USER_ADMIN, "admin", "organization")).toBe(false);
  });
});

describe("hasScope — event", () => {
  it("returns true for operator@event when assignment matches scopeId", async () => {
    expect(await hasScope(prisma, USER_OP, "operator", "event", EVENT_ID)).toBe(true);
  });

  it("returns false for wrong eventId", async () => {
    expect(await hasScope(prisma, USER_OP, "operator", "event", "other-event")).toBe(false);
  });
});

describe("hasScope — exact-match, no hierarchy", () => {
  it("superadmin@instance does NOT implicitly grant admin@organization", async () => {
    expect(await hasScope(prisma, USER_SUPER, "admin", "organization", ORG_ID)).toBe(false);
  });

  it("superadmin@instance does NOT implicitly grant operator@event", async () => {
    expect(await hasScope(prisma, USER_SUPER, "operator", "event", EVENT_ID)).toBe(false);
  });

  it("admin@org does NOT implicitly grant operator@event in that org", async () => {
    expect(await hasScope(prisma, USER_ADMIN, "operator", "event", EVENT_ID)).toBe(false);
  });
});
