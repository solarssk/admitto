import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { PrismaClient } from "@prisma/client";
import { hashPassword } from "../../src/password.js";
import * as audit from "../../src/audit.js";
import {
  applyOidcGroupRoleMappings,
  countActiveInstanceSuperadmins,
  roleAssignmentScopeId,
} from "../../src/oidc/group-role-mapping.js";
import { encryptClientSecret } from "../../src/oidc/provider-secret.js";
import { bootstrapSuperadmin } from "../../src/bootstrap.js";

const PROVIDER_ID = "oidc-prov-mapping-test";
const USER_ID = "oidc-user-mapping-test";
const EVENT_ID = "oidc-event-mapping-test";

let prisma: PrismaClient;

beforeAll(async () => {
  prisma = new PrismaClient();
  await prisma.oidcGroupRoleMapping.deleteMany({ where: { provider_id: PROVIDER_ID } });
  await prisma.oidcRoleGrant.deleteMany({ where: { provider_id: PROVIDER_ID } });
  await prisma.externalIdentity.deleteMany({ where: { provider_id: PROVIDER_ID } });
  await prisma.identityProvider.deleteMany({ where: { id: PROVIDER_ID } });
  await prisma.roleAssignment.deleteMany({ where: { user_id: USER_ID } });
  await prisma.user.deleteMany({ where: { id: USER_ID } });
  await prisma.event.deleteMany({ where: { id: EVENT_ID } });

  await prisma.identityProvider.create({
    data: {
      id: PROVIDER_ID,
      provider_type: "oidc",
      issuer: "https://mapping.example.com/",
      client_id: "c",
      client_secret_enc: encryptClientSecret("s"),
      authorization_endpoint: "https://mapping.example.com/a",
      token_endpoint: "https://mapping.example.com/t",
      jwks_uri: "https://mapping.example.com/j",
      display_name: "Mapping Test",
    },
  });

  await prisma.user.create({
    data: { id: USER_ID, email: "mapping-user@example.com", password_hash: await hashPassword("x") },
  });
});

afterAll(async () => {
  await prisma.oidcGroupRoleMapping.deleteMany({ where: { provider_id: PROVIDER_ID } });
  await prisma.oidcRoleGrant.deleteMany({ where: { provider_id: PROVIDER_ID } });
  await prisma.externalIdentity.deleteMany({ where: { provider_id: PROVIDER_ID } });
  await prisma.identityProvider.deleteMany({ where: { id: PROVIDER_ID } });
  await prisma.roleAssignment.deleteMany({ where: { user_id: USER_ID } });
  await prisma.user.deleteMany({ where: { id: USER_ID } });
  await prisma.event.deleteMany({ where: { id: EVENT_ID } });
  await prisma.$disconnect();
});

describe("roleAssignmentScopeId", () => {
  it("maps instance scope to null", () => {
    expect(roleAssignmentScopeId("instance", "")).toBeNull();
    expect(roleAssignmentScopeId("instance", "x")).toBeNull();
  });

  it("trims org/event scope ids", () => {
    expect(roleAssignmentScopeId("event", "  evt  ")).toBe("evt");
    expect(roleAssignmentScopeId("event", "")).toBeNull();
  });
});

describe("applyOidcGroupRoleMappings", () => {
  it("adds no roles when mapping empty", async () => {
    const changed = await applyOidcGroupRoleMappings(prisma, PROVIDER_ID, USER_ID, ["admins"]);
    expect(changed).toBe(0);
    const roles = await prisma.roleAssignment.findMany({ where: { user_id: USER_ID } });
    expect(roles).toHaveLength(0);
  });

  it("adds role from matching group rule with null instance scope_id", async () => {
    await prisma.oidcGroupRoleMapping.create({
      data: {
        provider_id: PROVIDER_ID,
        group: "admin-group",
        role: "superadmin",
        scope_type: "instance",
        scope_id: "",
      },
    });
    const changed = await applyOidcGroupRoleMappings(prisma, PROVIDER_ID, USER_ID, ["admin-group"]);
    expect(changed).toBe(1);
    const roles = await prisma.roleAssignment.findMany({ where: { user_id: USER_ID } });
    expect(roles.some((r) => r.role === "superadmin" && r.scope_id === null)).toBe(true);
  });

  it("removes OIDC-granted role when group no longer matches", async () => {
    await prisma.oidcGroupRoleMapping.deleteMany({ where: { provider_id: PROVIDER_ID } });
    await prisma.oidcRoleGrant.deleteMany({ where: { provider_id: PROVIDER_ID } });
    await prisma.roleAssignment.deleteMany({ where: { user_id: USER_ID } });
    await prisma.externalIdentity.deleteMany({ where: { provider_id: PROVIDER_ID } });

    await prisma.oidcGroupRoleMapping.create({
      data: {
        provider_id: PROVIDER_ID,
        group: "operators",
        role: "operator",
        scope_type: "event",
        scope_id: EVENT_ID,
      },
    });
    await prisma.externalIdentity.create({
      data: {
        provider_id: PROVIDER_ID,
        subject: "sub-op",
        user_id: USER_ID,
        linked_at: new Date("2026-01-01T00:00:00Z"),
      },
    });

    await applyOidcGroupRoleMappings(prisma, PROVIDER_ID, USER_ID, ["operators"]);
    let roles = await prisma.roleAssignment.findMany({ where: { user_id: USER_ID } });
    expect(roles).toHaveLength(1);

    await applyOidcGroupRoleMappings(prisma, PROVIDER_ID, USER_ID, []);
    roles = await prisma.roleAssignment.findMany({ where: { user_id: USER_ID } });
    expect(roles).toHaveLength(0);
    const grants = await prisma.oidcRoleGrant.findMany({ where: { user_id: USER_ID } });
    expect(grants).toHaveLength(0);
  });

  it("does not remove manual role when OIDC group no longer matches", async () => {
    await prisma.oidcGroupRoleMapping.deleteMany({ where: { provider_id: PROVIDER_ID } });
    await prisma.oidcRoleGrant.deleteMany({ where: { provider_id: PROVIDER_ID } });
    await prisma.roleAssignment.deleteMany({ where: { user_id: USER_ID } });

    await prisma.oidcGroupRoleMapping.create({
      data: {
        provider_id: PROVIDER_ID,
        group: "operators",
        role: "operator",
        scope_type: "event",
        scope_id: EVENT_ID,
      },
    });
    await prisma.roleAssignment.create({
      data: {
        user_id: USER_ID,
        role: "operator",
        scope_type: "event",
        scope_id: EVENT_ID,
      },
    });

    await applyOidcGroupRoleMappings(prisma, PROVIDER_ID, USER_ID, []);
    const roles = await prisma.roleAssignment.findMany({ where: { user_id: USER_ID } });
    expect(roles).toHaveLength(1);
    expect(await prisma.oidcRoleGrant.count({ where: { user_id: USER_ID } })).toBe(0);
  });

  it("revokes grant when mapping rule is removed", async () => {
    await prisma.oidcGroupRoleMapping.deleteMany({ where: { provider_id: PROVIDER_ID } });
    await prisma.oidcRoleGrant.deleteMany({ where: { provider_id: PROVIDER_ID } });
    await prisma.roleAssignment.deleteMany({ where: { user_id: USER_ID } });

    await prisma.oidcGroupRoleMapping.create({
      data: {
        provider_id: PROVIDER_ID,
        group: "admins",
        role: "operator",
        scope_type: "event",
        scope_id: EVENT_ID,
      },
    });
    await applyOidcGroupRoleMappings(prisma, PROVIDER_ID, USER_ID, ["admins"]);
    expect(await prisma.roleAssignment.count({ where: { user_id: USER_ID } })).toBe(1);

    await prisma.oidcGroupRoleMapping.deleteMany({ where: { provider_id: PROVIDER_ID } });
    await applyOidcGroupRoleMappings(prisma, PROVIDER_ID, USER_ID, ["admins"]);
    expect(await prisma.roleAssignment.count({ where: { user_id: USER_ID } })).toBe(0);
    expect(await prisma.oidcRoleGrant.count({ where: { user_id: USER_ID } })).toBe(0);
  });

  it("does not remove superadmin when groups empty on re-apply", async () => {
    const { userId } = await bootstrapSuperadmin(prisma, "super-invariant@example.com", "pw");
    const changed = await applyOidcGroupRoleMappings(prisma, PROVIDER_ID, userId, []);
    expect(changed).toBe(0);
    const roles = await prisma.roleAssignment.findMany({ where: { user_id: userId } });
    expect(roles.some((r) => r.role === "superadmin")).toBe(true);
    await prisma.roleAssignment.deleteMany({ where: { user_id: userId } });
    await prisma.user.delete({ where: { id: userId } });
  });
});

describe("OIDC instance superadmin revoke floor-guard", () => {
  const FLOOR_PROVIDER_ID = "oidc-prov-floor-guard";
  const FLOOR_USER_ID = "oidc-user-floor-guard";
  const FLOOR_SUPER_GROUP = "floor-super-group";
  const SECOND_SUPER_EMAIL = "floor-guard-second-super@example.com";

  async function removeOtherInstanceSuperadmins(keepUserIds: string[]) {
    await prisma.roleAssignment.deleteMany({
      where: {
        role: "superadmin",
        scope_type: "instance",
        scope_id: null,
        user_id: { notIn: keepUserIds },
      },
    });
  }

  async function grantOidcInstanceSuperadmin(userId: string) {
    await prisma.oidcGroupRoleMapping.deleteMany({ where: { provider_id: FLOOR_PROVIDER_ID } });
    await prisma.oidcRoleGrant.deleteMany({
      where: { user_id: userId, provider_id: FLOOR_PROVIDER_ID },
    });
    await prisma.roleAssignment.deleteMany({
      where: { user_id: userId, role: "superadmin", scope_type: "instance", scope_id: null },
    });
    await prisma.oidcGroupRoleMapping.create({
      data: {
        provider_id: FLOOR_PROVIDER_ID,
        group: FLOOR_SUPER_GROUP,
        role: "superadmin",
        scope_type: "instance",
        scope_id: "",
      },
    });
    await applyOidcGroupRoleMappings(prisma, FLOOR_PROVIDER_ID, userId, [FLOOR_SUPER_GROUP]);
  }

  beforeAll(async () => {
    await prisma.oidcGroupRoleMapping.deleteMany({ where: { provider_id: FLOOR_PROVIDER_ID } });
    await prisma.oidcRoleGrant.deleteMany({ where: { provider_id: FLOOR_PROVIDER_ID } });
    await prisma.externalIdentity.deleteMany({ where: { provider_id: FLOOR_PROVIDER_ID } });
    await prisma.identityProvider.deleteMany({ where: { id: FLOOR_PROVIDER_ID } });
    await prisma.roleAssignment.deleteMany({ where: { user_id: FLOOR_USER_ID } });
    await prisma.user.deleteMany({ where: { id: FLOOR_USER_ID } });

    await prisma.identityProvider.create({
      data: {
        id: FLOOR_PROVIDER_ID,
        provider_type: "oidc",
        issuer: "https://floor-guard.example.com/",
        client_id: "c",
        client_secret_enc: encryptClientSecret("s"),
        authorization_endpoint: "https://floor-guard.example.com/a",
        token_endpoint: "https://floor-guard.example.com/t",
        jwks_uri: "https://floor-guard.example.com/j",
        display_name: "Floor Guard Test",
      },
    });

    await prisma.user.create({
      data: {
        id: FLOOR_USER_ID,
        email: "floor-guard-user@example.com",
        password_hash: await hashPassword("x"),
      },
    });
  });

  afterAll(async () => {
    await prisma.oidcGroupRoleMapping.deleteMany({ where: { provider_id: FLOOR_PROVIDER_ID } });
    await prisma.oidcRoleGrant.deleteMany({ where: { provider_id: FLOOR_PROVIDER_ID } });
    await prisma.externalIdentity.deleteMany({ where: { provider_id: FLOOR_PROVIDER_ID } });
    await prisma.identityProvider.deleteMany({ where: { id: FLOOR_PROVIDER_ID } });
    await prisma.roleAssignment.deleteMany({ where: { user_id: FLOOR_USER_ID } });
    await prisma.user.deleteMany({ where: { id: FLOOR_USER_ID } });
    await prisma.user.deleteMany({ where: { email: SECOND_SUPER_EMAIL } });
  });

  beforeEach(async () => {
    await prisma.oidcGroupRoleMapping.deleteMany({ where: { provider_id: FLOOR_PROVIDER_ID } });
    await prisma.oidcRoleGrant.deleteMany({
      where: { provider_id: FLOOR_PROVIDER_ID, user_id: FLOOR_USER_ID },
    });
    await prisma.roleAssignment.deleteMany({ where: { user_id: FLOOR_USER_ID } });
    await prisma.user.deleteMany({ where: { email: SECOND_SUPER_EMAIL } });

    const activeSuperadmins = await countActiveInstanceSuperadmins(prisma);
    if (activeSuperadmins > 1) {
      await removeOtherInstanceSuperadmins([FLOOR_USER_ID]);
    }
  });

  it("blocks revoke when only one active instance superadmin remains", async () => {
    await removeOtherInstanceSuperadmins([]);
    await grantOidcInstanceSuperadmin(FLOOR_USER_ID);

    const beforeCount = await countActiveInstanceSuperadmins(prisma);
    expect(beforeCount, "expected exactly one active instance superadmin before revoke").toBe(1);

    const auditSpy = vi.spyOn(audit, "logOidcSuperadminRevokeBlocked");
    try {
      await prisma.oidcGroupRoleMapping.deleteMany({ where: { provider_id: FLOOR_PROVIDER_ID } });
      await applyOidcGroupRoleMappings(prisma, FLOOR_PROVIDER_ID, FLOOR_USER_ID, []);

      const roles = await prisma.roleAssignment.findMany({ where: { user_id: FLOOR_USER_ID } });
      expect(roles.some((r) => r.role === "superadmin" && r.scope_id === null)).toBe(true);
      expect(auditSpy).toHaveBeenCalledWith({
        providerId: FLOOR_PROVIDER_ID,
        userId: FLOOR_USER_ID,
      });
    } finally {
      auditSpy.mockRestore();
    }
  });

  it("allows revoke when two active instance superadmins exist", async () => {
    const { userId: secondSuperId } = await bootstrapSuperadmin(prisma, SECOND_SUPER_EMAIL, "pw");
    try {
      await removeOtherInstanceSuperadmins([FLOOR_USER_ID, secondSuperId]);
      await grantOidcInstanceSuperadmin(FLOOR_USER_ID);

      const beforeCount = await countActiveInstanceSuperadmins(prisma);
      expect(beforeCount).toBe(2);

      await prisma.oidcGroupRoleMapping.deleteMany({ where: { provider_id: FLOOR_PROVIDER_ID } });
      await applyOidcGroupRoleMappings(prisma, FLOOR_PROVIDER_ID, FLOOR_USER_ID, []);

      const roles = await prisma.roleAssignment.findMany({ where: { user_id: FLOOR_USER_ID } });
      expect(roles.some((r) => r.role === "superadmin")).toBe(false);
      expect(await countActiveInstanceSuperadmins(prisma)).toBe(1);
    } finally {
      await prisma.roleAssignment.deleteMany({ where: { user_id: secondSuperId } });
      await prisma.user.delete({ where: { id: secondSuperId } });
    }
  });
});

describe("RoleAssignment integrity", () => {
  afterEach(async () => {
    await prisma.oidcRoleGrant.deleteMany({ where: { user_id: USER_ID } });
    await prisma.roleAssignment.deleteMany({ where: { user_id: USER_ID } });
  });

  it("rejects duplicate scoped RoleAssignment", async () => {
    await prisma.roleAssignment.create({
      data: { user_id: USER_ID, role: "operator", scope_type: "event", scope_id: EVENT_ID },
    });
    await expect(
      prisma.roleAssignment.create({
        data: { user_id: USER_ID, role: "operator", scope_type: "event", scope_id: EVENT_ID },
      }),
    ).rejects.toMatchObject({ code: "P2002" });
  });

  it("rejects duplicate instance RoleAssignment (scope_id IS NULL)", async () => {
    await prisma.roleAssignment.create({
      data: { user_id: USER_ID, role: "superadmin", scope_type: "instance", scope_id: null },
    });
    await expect(
      prisma.roleAssignment.create({
        data: { user_id: USER_ID, role: "superadmin", scope_type: "instance", scope_id: null },
      }),
    ).rejects.toMatchObject({ code: "P2002" });
  });

  it("rejects OidcRoleGrant with nonexistent role_assignment_id", async () => {
    await expect(
      prisma.oidcRoleGrant.create({
        data: {
          user_id: USER_ID,
          provider_id: PROVIDER_ID,
          role: "operator",
          scope_type: "event",
          scope_id: EVENT_ID,
          role_assignment_id: "nonexistent-assignment-id",
        },
      }),
    ).rejects.toMatchObject({ code: "P2003" });
  });

  it("cascades OidcRoleGrant delete when RoleAssignment is removed", async () => {
    const assignment = await prisma.roleAssignment.create({
      data: { user_id: USER_ID, role: "operator", scope_type: "event", scope_id: EVENT_ID },
    });
    await prisma.oidcRoleGrant.create({
      data: {
        user_id: USER_ID,
        provider_id: PROVIDER_ID,
        role: "operator",
        scope_type: "event",
        scope_id: EVENT_ID,
        role_assignment_id: assignment.id,
      },
    });
    await prisma.roleAssignment.delete({ where: { id: assignment.id } });
    expect(await prisma.oidcRoleGrant.count({ where: { user_id: USER_ID } })).toBe(0);
  });
});

describe("applyOidcGroupRoleMappings idempotency", () => {
  afterEach(async () => {
    await prisma.oidcGroupRoleMapping.deleteMany({ where: { provider_id: PROVIDER_ID } });
    await prisma.oidcRoleGrant.deleteMany({ where: { user_id: USER_ID } });
    await prisma.roleAssignment.deleteMany({ where: { user_id: USER_ID } });
  });

  it("re-applying the same group mappings does not throw and adds no duplicate rows", async () => {
    await prisma.oidcGroupRoleMapping.create({
      data: {
        provider_id: PROVIDER_ID,
        group: "operators",
        role: "operator",
        scope_type: "event",
        scope_id: EVENT_ID,
      },
    });

    const first = await applyOidcGroupRoleMappings(prisma, PROVIDER_ID, USER_ID, ["operators"]);
    expect(first).toBe(1);

    const second = await applyOidcGroupRoleMappings(prisma, PROVIDER_ID, USER_ID, ["operators"]);
    expect(second).toBe(0);
    expect(await prisma.roleAssignment.count({ where: { user_id: USER_ID } })).toBe(1);
    expect(await prisma.oidcRoleGrant.count({ where: { user_id: USER_ID } })).toBe(1);
  });
});
