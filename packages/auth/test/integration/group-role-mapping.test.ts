import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PrismaClient } from "@prisma/client";
import { hashPassword } from "../../src/password.js";
import { applyOidcGroupRoleMappings } from "../../src/oidc/group-role-mapping.js";
import { encryptClientSecret } from "../../src/oidc/provider-secret.js";
import { bootstrapSuperadmin } from "../../src/bootstrap.js";

const PROVIDER_ID = "oidc-prov-mapping-test";
const USER_ID = "oidc-user-mapping-test";

let prisma: PrismaClient;

beforeAll(async () => {
  prisma = new PrismaClient();
  await prisma.oidcGroupRoleMapping.deleteMany({ where: { provider_id: PROVIDER_ID } });
  await prisma.externalIdentity.deleteMany({ where: { provider_id: PROVIDER_ID } });
  await prisma.identityProvider.deleteMany({ where: { id: PROVIDER_ID } });
  await prisma.roleAssignment.deleteMany({ where: { user_id: USER_ID } });
  await prisma.user.deleteMany({ where: { id: USER_ID } });

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
  await prisma.identityProvider.deleteMany({ where: { id: PROVIDER_ID } });
  await prisma.roleAssignment.deleteMany({ where: { user_id: USER_ID } });
  await prisma.user.deleteMany({ where: { id: USER_ID } });
  await prisma.$disconnect();
});

describe("applyOidcGroupRoleMappings", () => {
  it("adds no roles when mapping empty", async () => {
    const added = await applyOidcGroupRoleMappings(prisma, PROVIDER_ID, USER_ID, ["admins"]);
    expect(added).toBe(0);
    const roles = await prisma.roleAssignment.findMany({ where: { user_id: USER_ID } });
    expect(roles).toHaveLength(0);
  });

  it("adds role from matching group rule", async () => {
    await prisma.oidcGroupRoleMapping.create({
      data: {
        provider_id: PROVIDER_ID,
        group: "admin-group",
        role: "superadmin",
        scope_type: "instance",
        scope_id: null,
      },
    });
    const added = await applyOidcGroupRoleMappings(prisma, PROVIDER_ID, USER_ID, ["admin-group"]);
    expect(added).toBe(1);
    const roles = await prisma.roleAssignment.findMany({ where: { user_id: USER_ID } });
    expect(roles.some((r) => r.role === "superadmin")).toBe(true);
  });

  it("does not remove superadmin when groups empty on re-apply", async () => {
    const { userId } = await bootstrapSuperadmin(prisma, "super-invariant@example.com", "pw");
    const added = await applyOidcGroupRoleMappings(prisma, PROVIDER_ID, userId, []);
    expect(added).toBe(0);
    const roles = await prisma.roleAssignment.findMany({ where: { user_id: userId } });
    expect(roles.some((r) => r.role === "superadmin")).toBe(true);
    await prisma.roleAssignment.deleteMany({ where: { user_id: userId } });
    await prisma.user.delete({ where: { id: userId } });
  });
});
