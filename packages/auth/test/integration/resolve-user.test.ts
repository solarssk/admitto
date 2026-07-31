import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PrismaClient } from "@admitto/db";
import { createTestPrismaClient } from "@admitto/db/testing";
import { hashPassword } from "../../src/password.js";
import {
  resolveOrCreateUserFromExternalIdentity,
  ExternalIdentityLinkError,
} from "../../src/external-identity/resolve-user.js";
import { encryptClientSecret } from "../../src/oidc/provider-secret.js";
import { canManageInstance } from "../../src/authorization.js";

const PROVIDER_ID = "oidc-prov-resolve-test";
const USER_EXISTING = "oidc-user-existing-resolve";
const USER_LINK = "oidc-user-link-resolve";

let prisma: PrismaClient;
let provider: Awaited<ReturnType<typeof prisma.identityProvider.create>>;

beforeAll(async () => {
  prisma = createTestPrismaClient();

  await prisma.oidcRoleGrant.deleteMany({ where: { provider_id: PROVIDER_ID } });
  await prisma.externalIdentity.deleteMany({ where: { provider_id: PROVIDER_ID } });
  await prisma.identityProvider.deleteMany({ where: { id: PROVIDER_ID } });
  await prisma.roleAssignment.deleteMany({
    where: { user_id: { in: [USER_EXISTING, USER_LINK] } },
  });
  await prisma.user.deleteMany({
    where: { id: { in: [USER_EXISTING, USER_LINK] } },
  });

  provider = await prisma.identityProvider.create({
    data: {
      id: PROVIDER_ID,
      provider_type: "oidc",
      issuer: "https://idp.example.com/",
      client_id: "test-client",
      client_secret_enc: encryptClientSecret("secret"),
      authorization_endpoint: "https://idp.example.com/authorize",
      token_endpoint: "https://idp.example.com/token",
      jwks_uri: "https://idp.example.com/jwks",
      display_name: "Test IdP",
      enabled: true,
    },
  });

  await prisma.user.create({
    data: {
      id: USER_EXISTING,
      email: "existing@example.com",
      password_hash: await hashPassword("pass"),
    },
  });

  await prisma.user.create({
    data: {
      id: USER_LINK,
      email: "linker@example.com",
      password_hash: await hashPassword("pass"),
    },
  });
});

afterAll(async () => {
  // Provider-scoped teardown — never delete by email domain (parallel tests / shared DB).
  const linked = await prisma.externalIdentity.findMany({
    where: { provider_id: PROVIDER_ID },
    select: { user_id: true },
  });
  const userIds = [...new Set([USER_EXISTING, USER_LINK, ...linked.map((x) => x.user_id)])];

  await prisma.oidcRoleGrant.deleteMany({ where: { provider_id: PROVIDER_ID } });
  await prisma.externalIdentity.deleteMany({ where: { provider_id: PROVIDER_ID } });
  await prisma.identityProvider.deleteMany({ where: { id: PROVIDER_ID } });
  await prisma.roleAssignment.deleteMany({ where: { user_id: { in: userIds } } });
  await prisma.user.deleteMany({ where: { id: { in: userIds } } });
  await prisma.$disconnect();
});

describe("resolveOrCreateUserFromExternalIdentity", () => {
  it("JIT creates user with zero roles", async () => {
    const subject = "jit-subject-1";
    const result = await resolveOrCreateUserFromExternalIdentity(
      prisma,
      provider,
      subject,
      { email: "jit1@example.com", name: "JIT User", groups: ["staff"] },
    );
    expect(result.isNew).toBe(true);
    expect(result.linked).toBe(false);
    expect(await canManageInstance(prisma, result.user.id)).toBe(false);
    const roles = await prisma.roleAssignment.findMany({ where: { user_id: result.user.id } });
    expect(roles).toHaveLength(0);
  });

  it("rejects anonymous email match to existing account", async () => {
    await expect(
      resolveOrCreateUserFromExternalIdentity(prisma, provider, "takeover-subject", {
        email: "existing@example.com",
      }),
    ).rejects.toBeInstanceOf(ExternalIdentityLinkError);
  });

  it("explicit link when logged in", async () => {
    const subject = "link-subject-1";
    const result = await resolveOrCreateUserFromExternalIdentity(
      prisma,
      provider,
      subject,
      { email: "linked@example.com" },
      { currentUserId: USER_LINK },
    );
    expect(result.linked).toBe(true);
    expect(result.user.id).toBe(USER_LINK);
  });

  it("rejects explicit link when the current user no longer exists", async () => {
    await expect(
      resolveOrCreateUserFromExternalIdentity(
        prisma,
        provider,
        "missing-current-user-subject",
        { email: "linked@example.com" },
        { currentUserId: "oidc-user-missing-resolve" },
      ),
    ).rejects.toMatchObject({ name: "ExternalIdentityLinkError", message: "current_user_invalid" });
  });

  it("rejects explicit link when subject belongs to another user", async () => {
    const subject = "taken-subject";
    await resolveOrCreateUserFromExternalIdentity(prisma, provider, subject, {
      email: "owner@example.com",
    });

    await expect(
      resolveOrCreateUserFromExternalIdentity(
        prisma,
        provider,
        subject,
        { email: "linked@example.com" },
        { currentUserId: USER_LINK },
      ),
    ).rejects.toMatchObject({ name: "ExternalIdentityLinkError", message: "subject_already_linked" });
  });

  it("known subject returns linked user", async () => {
    const subject = "known-subject-1";
    const first = await resolveOrCreateUserFromExternalIdentity(prisma, provider, subject, {
      email: "known@example.com",
    });
    const second = await resolveOrCreateUserFromExternalIdentity(prisma, provider, subject, {
      email: "known@example.com",
      groups: ["a"],
    });
    expect(second.isNew).toBe(false);
    expect(second.groupsChanged).toBe(true);
    expect(second.user.id).toBe(first.user.id);

    const third = await resolveOrCreateUserFromExternalIdentity(prisma, provider, subject, {
      email: "known@example.com",
      groups: ["a"],
    });
    expect(third.groupsChanged).toBe(false);
  });
});
