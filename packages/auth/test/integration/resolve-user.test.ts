import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PrismaClient } from "@admitto/db";
import { createTestPrismaClient } from "@admitto/db/testing";
import { hashPassword } from "../../src/password.js";
import {
  resolveOrCreateUserFromExternalIdentity,
  ExternalIdentityLinkError,
} from "../../src/external-identity/resolve-user.js";
import { resolveCfAccessIdentityFromValidatedJwt } from "../../src/cloudflare-access/resolve-identity.js";
import { encryptClientSecret } from "../../src/oidc/provider-secret.js";
import { canManageInstance } from "../../src/authorization.js";

const PROVIDER_ID = "oidc-prov-resolve-test";
const CF_PROVIDER_ID = "cloudflare-access-resolve-test";
const USER_EXISTING = "oidc-user-existing-resolve";
const USER_LINK = "oidc-user-link-resolve";

let prisma: PrismaClient;
let provider: Awaited<ReturnType<typeof prisma.identityProvider.create>>;
let cloudflareProvider: Awaited<ReturnType<typeof prisma.identityProvider.create>>;

beforeAll(async () => {
  prisma = createTestPrismaClient();

  await prisma.oidcRoleGrant.deleteMany({ where: { provider_id: PROVIDER_ID } });
  await prisma.externalIdentity.deleteMany({ where: { provider_id: { in: [PROVIDER_ID, CF_PROVIDER_ID] } } });
  await prisma.identityProvider.deleteMany({ where: { id: { in: [PROVIDER_ID, CF_PROVIDER_ID] } } });
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
      claim_groups: "admitto_groups",
    },
  });

  cloudflareProvider = await prisma.identityProvider.create({
    data: {
      id: CF_PROVIDER_ID,
      provider_type: "cloudflare_access",
      issuer: "https://team.cloudflareaccess.test",
      client_id: "__cloudflare_access__",
      authorization_endpoint: "https://team.cloudflareaccess.test/cdn-cgi/access/login",
      token_endpoint: "https://team.cloudflareaccess.test/cdn-cgi/access/login",
      jwks_uri: "https://team.cloudflareaccess.test/cdn-cgi/access/certs",
      display_name: "Cloudflare Access",
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
  await prisma.externalIdentity.deleteMany({ where: { provider_id: { in: [PROVIDER_ID, CF_PROVIDER_ID] } } });
  await prisma.identityProvider.deleteMany({ where: { id: { in: [PROVIDER_ID, CF_PROVIDER_ID] } } });
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

  it("JIT creates user with no local password, at essentially the same instant its identity is linked", async () => {
    const result = await resolveOrCreateUserFromExternalIdentity(
      prisma,
      provider,
      "jit-subject-no-password",
      { email: "jit-no-password@example.com" },
    );
    expect(result.user.password_hash).toBeNull();

    const identity = await prisma.externalIdentity.findUniqueOrThrow({
      where: { provider_id_subject: { provider_id: provider.id, subject: "jit-subject-no-password" } },
    });
    // Same transaction, back to back, no I/O in between - well within the backfill script's
    // 5s tolerance (see packages/db/src/backfill-jit-password-hash.ts), but not necessarily
    // byte-identical (Prisma's driver-adapter engine doesn't freeze `now()` per-transaction).
    expect(Math.abs(identity.linked_at.getTime() - result.user.created_at.getTime())).toBeLessThan(5_000);
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

    // A missing group claim is not the same assertion as an explicit empty group list. OIDC
    // gateways can omit optional claims, so preserving the prior snapshot avoids revoking every
    // role grant on a partial token.
    const withoutGroups = await resolveOrCreateUserFromExternalIdentity(prisma, provider, subject, {
      email: "known@example.com",
    });
    expect(withoutGroups.groupsChanged).toBe(false);
    const identity = await prisma.externalIdentity.findUniqueOrThrow({
      where: { provider_id_subject: { provider_id: provider.id, subject } },
    });
    expect(identity.groups).toEqual(["a"]);

    const explicitEmptyGroups = await resolveOrCreateUserFromExternalIdentity(
      prisma,
      provider,
      subject,
      { email: "known@example.com", groups: [] },
    );
    expect(explicitEmptyGroups.groupsChanged).toBe(true);
    expect(
      (await prisma.externalIdentity.findUniqueOrThrow({
        where: { provider_id_subject: { provider_id: provider.id, subject } },
      })).groups,
    ).toEqual([]);
  });

  it("re-syncs User.display_name from fresh IdP claims on a later login", async () => {
    const subject = "name-resync-subject";
    const first = await resolveOrCreateUserFromExternalIdentity(prisma, provider, subject, {
      email: "name-resync@example.com",
      name: "Original Name",
    });
    expect(first.user.display_name).toBe("Original Name");

    const second = await resolveOrCreateUserFromExternalIdentity(prisma, provider, subject, {
      email: "name-resync@example.com",
      name: "Updated Name",
    });
    expect(second.user.display_name).toBe("Updated Name");

    const stored = await prisma.user.findUniqueOrThrow({ where: { id: first.user.id } });
    expect(stored.display_name).toBe("Updated Name");
  });

  it("preserves a superadmin's manual display_name edit instead of overwriting it from the IdP", async () => {
    const subject = "name-override-subject";
    const first = await resolveOrCreateUserFromExternalIdentity(prisma, provider, subject, {
      email: "name-override@example.com",
      name: "IdP Name",
    });

    // Simulate a superadmin manually editing the profile (UserEditModal.tsx -> PATCH /users/:id).
    await prisma.user.update({
      where: { id: first.user.id },
      data: { display_name: "Manually Overridden Name" },
    });

    const second = await resolveOrCreateUserFromExternalIdentity(prisma, provider, subject, {
      email: "name-override@example.com",
      name: "New IdP Name",
    });
    expect(second.user.display_name).toBe("Manually Overridden Name");

    const stored = await prisma.user.findUniqueOrThrow({ where: { id: first.user.id } });
    expect(stored.display_name).toBe("Manually Overridden Name");
  });

  it("re-syncs User.phone_number from fresh IdP claims on a later login", async () => {
    const subject = "phone-resync-subject";
    const first = await resolveOrCreateUserFromExternalIdentity(prisma, provider, subject, {
      email: "phone-resync@example.com",
      phone: "+15550000001",
    });
    expect(first.user.phone_number).toBe("+15550000001");

    const second = await resolveOrCreateUserFromExternalIdentity(prisma, provider, subject, {
      email: "phone-resync@example.com",
      phone: "+15550000002",
    });
    expect(second.user.phone_number).toBe("+15550000002");

    const stored = await prisma.user.findUniqueOrThrow({ where: { id: first.user.id } });
    expect(stored.phone_number).toBe("+15550000002");
  });

  it("preserves a superadmin's manual phone_number edit instead of overwriting it from the IdP", async () => {
    const subject = "phone-override-subject";
    const first = await resolveOrCreateUserFromExternalIdentity(prisma, provider, subject, {
      email: "phone-override@example.com",
      phone: "+15550000003",
    });

    // Simulate a superadmin manually editing the profile (UserEditModal.tsx -> PATCH /users/:id).
    await prisma.user.update({
      where: { id: first.user.id },
      data: { phone_number: "+15559999999" },
    });

    const second = await resolveOrCreateUserFromExternalIdentity(prisma, provider, subject, {
      email: "phone-override@example.com",
      phone: "+15550000004",
    });
    expect(second.user.phone_number).toBe("+15559999999");

    const stored = await prisma.user.findUniqueOrThrow({ where: { id: first.user.id } });
    expect(stored.phone_number).toBe("+15559999999");
  });

  it("reconciles direct-provider role grants through a pre-linked Cloudflare Access identity", async () => {
    const sourceSubject = "cf-edge-linked-source-subject";
    const cloudflareSubject = "cf-edge-linked-subject";
    const group = "cf-edge-operators";
    await prisma.externalIdentity.create({
      data: {
        provider_id: provider.id,
        subject: sourceSubject,
        user_id: USER_LINK,
        email: "linker@example.com",
      },
    });
    await prisma.oidcGroupRoleMapping.create({
      data: {
        provider_id: provider.id,
        group,
        role: "operator",
        scope_type: "instance",
        scope_id: "",
      },
    });

    try {
      const granted = await resolveCfAccessIdentityFromValidatedJwt(prisma, {
        config: { enabled: true, sourceProviderId: provider.id },
        cloudflareProvider,
        cloudflareSubject,
        payload: {
          sub: cloudflareSubject,
          custom: { admitto_identity: sourceSubject, admitto_groups: [group] },
        },
        claims: { email: "linker@example.com" },
      });
      expect(granted).toEqual({ userId: USER_LINK });
      expect(
        await prisma.oidcRoleGrant.count({ where: { provider_id: provider.id, user_id: USER_LINK } }),
      ).toBe(1);

      const revoked = await resolveCfAccessIdentityFromValidatedJwt(prisma, {
        config: { enabled: true, sourceProviderId: provider.id },
        cloudflareProvider,
        cloudflareSubject,
        payload: {
          sub: cloudflareSubject,
          custom: { admitto_identity: sourceSubject, admitto_groups: [] },
        },
        claims: { email: "linker@example.com" },
      });
      expect(revoked).toEqual({ userId: USER_LINK });
      expect(
        await prisma.oidcRoleGrant.count({ where: { provider_id: provider.id, user_id: USER_LINK } }),
      ).toBe(0);
      await expect(
        prisma.externalIdentity.findUniqueOrThrow({
          where: { provider_id_subject: { provider_id: provider.id, subject: sourceSubject } },
          select: { groups: true },
        }),
      ).resolves.toEqual({ groups: [] });
    } finally {
      await prisma.oidcGroupRoleMapping.deleteMany({ where: { provider_id: provider.id, group } });
      await prisma.oidcRoleGrant.deleteMany({ where: { provider_id: provider.id, user_id: USER_LINK } });
      await prisma.roleAssignment.deleteMany({ where: { user_id: USER_LINK, role: "operator" } });
      await prisma.externalIdentity.deleteMany({
        where: {
          OR: [
            { provider_id: provider.id, subject: sourceSubject },
            { provider_id: cloudflareProvider.id, subject: cloudflareSubject },
          ],
        },
      });
    }
  });

  it("fails closed when a mapped direct-provider group assertion is absent at the edge", async () => {
    const sourceSubject = "cf-edge-missing-groups-source-subject";
    const group = "cf-edge-required-group";
    await prisma.externalIdentity.create({
      data: {
        provider_id: provider.id,
        subject: sourceSubject,
        user_id: USER_LINK,
        email: "linker@example.com",
      },
    });
    await prisma.oidcGroupRoleMapping.create({
      data: {
        provider_id: provider.id,
        group,
        role: "operator",
        scope_type: "instance",
        scope_id: "",
      },
    });

    try {
      await expect(
        resolveCfAccessIdentityFromValidatedJwt(prisma, {
          config: { enabled: true, sourceProviderId: provider.id },
          cloudflareProvider,
          cloudflareSubject: "cf-edge-missing-groups",
          payload: { sub: "cf-edge-missing-groups", custom: { admitto_identity: sourceSubject } },
          claims: { email: "linker@example.com" },
        }),
      ).rejects.toMatchObject({
        name: "ExternalIdentityLinkError",
        message: "source_groups_unavailable",
      });
    } finally {
      await prisma.oidcGroupRoleMapping.deleteMany({ where: { provider_id: provider.id, group } });
      await prisma.externalIdentity.deleteMany({
        where: { provider_id: provider.id, subject: sourceSubject },
      });
    }
  });

  it("rejects an inactive linked direct-provider account before binding Cloudflare Access", async () => {
    const sourceSubject = "cf-edge-inactive-source-subject";
    await prisma.externalIdentity.create({
      data: {
        provider_id: provider.id,
        subject: sourceSubject,
        user_id: USER_LINK,
        email: "linker@example.com",
      },
    });
    await prisma.user.update({ where: { id: USER_LINK }, data: { is_active: false } });

    try {
      await expect(
        resolveCfAccessIdentityFromValidatedJwt(prisma, {
          config: { enabled: true, sourceProviderId: provider.id },
          cloudflareProvider,
          cloudflareSubject: "cf-edge-inactive-user",
          payload: { sub: "cf-edge-inactive-user", custom: { admitto_identity: sourceSubject } },
          claims: { email: "linker@example.com" },
        }),
      ).rejects.toMatchObject({
        name: "ExternalIdentityLinkError",
        message: "source_user_inactive",
      });
    } finally {
      await prisma.user.update({ where: { id: USER_LINK }, data: { is_active: true } });
      await prisma.externalIdentity.deleteMany({
        where: { provider_id: provider.id, subject: sourceSubject },
      });
    }
  });
});
