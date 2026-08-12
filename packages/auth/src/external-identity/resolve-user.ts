import { randomBytes } from "node:crypto";
import type { IdentityProvider, Prisma, PrismaClient, User } from "@admitto/db";
import { hashPassword } from "../password.js";
import { normalizeEmail } from "../user.js";
import { runInTransaction } from "../prisma-tx.js";
import type { ExternalIdentityClaims } from "../oidc/claims.js";

export type { ExternalIdentityClaims };

export interface ResolveExternalIdentityContext {
  /** Logged-in user — explicit link instead of JIT. */
  currentUserId?: string;
}

export interface ResolveExternalIdentityResult {
  user: User;
  isNew: boolean;
  linked: boolean;
  /** True when incoming groups differ from stored ExternalIdentity.groups (existing subject only). */
  groupsChanged: boolean;
}

export class ExternalIdentityLinkError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ExternalIdentityLinkError";
  }
}

function jitPlaceholderEmail(providerId: string, subject: string): string {
  const safeSubject = subject.replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 120);
  return `oidc+${providerId}+${safeSubject}@oidc.local`;
}

async function createJitUser(
  tx: Prisma.TransactionClient,
  claims: ExternalIdentityClaims,
  providerId: string,
  subject: string,
): Promise<User> {
  let email = claims.email ? normalizeEmail(claims.email) : jitPlaceholderEmail(providerId, subject);

  for (let attempt = 0; attempt < 5; attempt++) {
    const existing = await tx.user.findUnique({ where: { email } });
    if (!existing) break;
    if (claims.email) {
      throw new ExternalIdentityLinkError("email_already_exists");
    }
    email = jitPlaceholderEmail(`${providerId}-${randomBytes(4).toString("hex")}`, subject);
    if (attempt === 4) {
      throw new ExternalIdentityLinkError("jit_email_collision");
    }
  }

  return tx.user.create({
    data: {
      email,
      // No local password to speak of yet - this account signs in via the identity provider.
      // verifyPasswordOrDummy already runs constant-time dummy work for a null hash, so this
      // costs nothing on the login-timing front that the old random-value hash was buying.
      password_hash: null,
      display_name: claims.name ?? null,
      // Raw IdP value as-is (e.g. E.164 "+14155552671") - no attempt to split it into
      // phone_country_code + phone_number, same "no library for an internal-only field"
      // call already made for this field in apps/admin/src/utils/countryCallingCodes.ts.
      phone_number: claims.phone ?? null,
      is_active: true,
    },
  });
}

function groupsEqual(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false;
  const sortedA = [...a].sort((x, y) => x.localeCompare(y));
  const sortedB = [...b].sort((x, y) => x.localeCompare(y));
  return sortedA.every((value, index) => value === sortedB.at(index));
}

/**
 * Whether a User field re-synced from a fresh IdP claim should overwrite the current value:
 * only when the claim actually changed AND the current value still matches what we synced last
 * time (i.e. nobody has manually overridden it since, e.g. via UserEditModal.tsx - that override
 * wins over the IdP on every later login).
 */
function shouldResyncField(
  nextValue: string | null,
  lastSyncedValue: string | null,
  currentValue: string | null,
): boolean {
  return nextValue !== lastSyncedValue && currentValue === lastSyncedValue;
}

/** Re-syncs an already-linked identity's ExternalIdentity/User rows from fresh IdP claims. */
async function resyncExistingIdentity(
  tx: Prisma.TransactionClient,
  existing: Prisma.ExternalIdentityGetPayload<{ include: { user: true } }>,
  claims: ExternalIdentityClaims,
  context: ResolveExternalIdentityContext | undefined,
): Promise<ResolveExternalIdentityResult> {
  if (context?.currentUserId && existing.user_id !== context.currentUserId) {
    throw new ExternalIdentityLinkError("subject_already_linked");
  }
  if (!existing.user.is_active) {
    throw new ExternalIdentityLinkError("user_inactive");
  }
  const nextGroups = claims.groups ?? [];
  const groupsChanged = !groupsEqual(existing.groups ?? [], nextGroups);
  const nextName = claims.name ?? existing.name;
  const nextPhone = claims.phone ?? existing.phone;
  const userUpdate: Prisma.UserUpdateInput = {};
  if (shouldResyncField(nextName, existing.name, existing.user.display_name)) {
    userUpdate.display_name = nextName;
  }
  if (shouldResyncField(nextPhone, existing.phone, existing.user.phone_number)) {
    userUpdate.phone_number = nextPhone;
  }
  await tx.externalIdentity.update({
    where: { id: existing.id },
    data: {
      email: claims.email ?? existing.email,
      name: nextName,
      phone: nextPhone,
      groups: nextGroups,
      last_login_at: new Date(),
    },
  });
  const user =
    Object.keys(userUpdate).length > 0
      ? await tx.user.update({ where: { id: existing.user_id }, data: userUpdate })
      : existing.user;
  return { user, isNew: false, linked: false, groupsChanged };
}

/**
 * Resolve or create a local User from an external OIDC subject (shared seam for 16b/16c).
 */
export async function resolveOrCreateUserFromExternalIdentity(
  prisma: PrismaClient | Prisma.TransactionClient,
  provider: IdentityProvider,
  subject: string,
  claims: ExternalIdentityClaims,
  context?: ResolveExternalIdentityContext,
): Promise<ResolveExternalIdentityResult> {
  return runInTransaction(prisma, async (tx) => {
    const existing = await tx.externalIdentity.findUnique({
      where: { provider_id_subject: { provider_id: provider.id, subject } },
      include: { user: true },
    });

    if (existing) {
      return resyncExistingIdentity(tx, existing, claims, context);
    }

    if (context?.currentUserId) {
      const user = await tx.user.findUnique({ where: { id: context.currentUserId } });
      if (!user?.is_active) {
        throw new ExternalIdentityLinkError("current_user_invalid");
      }
      await tx.externalIdentity.create({
        data: {
          provider_id: provider.id,
          subject,
          user_id: user.id,
          email: claims.email ?? null,
          name: claims.name ?? null,
          phone: claims.phone ?? null,
          groups: claims.groups ?? [],
          last_login_at: new Date(),
        },
      });
      return { user, isNew: false, linked: true, groupsChanged: true };
    }

    if (claims.email) {
      const emailOwner = await tx.user.findUnique({
        where: { email: normalizeEmail(claims.email) },
      });
      if (emailOwner) {
        throw new ExternalIdentityLinkError("email_already_exists");
      }
    }

    const user = await createJitUser(tx, claims, provider.id, subject);
    await tx.externalIdentity.create({
      data: {
        provider_id: provider.id,
        subject,
        user_id: user.id,
        email: claims.email ?? null,
        name: claims.name ?? null,
        phone: claims.phone ?? null,
        groups: claims.groups ?? [],
        last_login_at: new Date(),
      },
    });
    return { user, isNew: true, linked: false, groupsChanged: true };
  });
}
