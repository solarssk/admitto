import { randomBytes } from "node:crypto";
import type { IdentityProvider, Prisma, PrismaClient, User } from "@prisma/client";
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

  const password_hash = await hashPassword(randomBytes(32).toString("hex"));
  return tx.user.create({
    data: {
      email,
      password_hash,
      display_name: claims.name ?? null,
      is_active: true,
    },
  });
}

function groupsEqual(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false;
  const sortedA = [...a].sort();
  const sortedB = [...b].sort();
  return sortedA.every((value, index) => value === sortedB[index]);
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
      if (context?.currentUserId && existing.user_id !== context.currentUserId) {
        throw new ExternalIdentityLinkError("subject_already_linked");
      }
      if (!existing.user.is_active) {
        throw new ExternalIdentityLinkError("user_inactive");
      }
      const nextGroups = claims.groups ?? [];
      const groupsChanged = !groupsEqual(existing.groups ?? [], nextGroups);
      await tx.externalIdentity.update({
        where: { id: existing.id },
        data: {
          email: claims.email ?? existing.email,
          name: claims.name ?? existing.name,
          groups: nextGroups,
          last_login_at: new Date(),
        },
      });
      return { user: existing.user, isNew: false, linked: false, groupsChanged };
    }

    if (context?.currentUserId) {
      const user = await tx.user.findUnique({ where: { id: context.currentUserId } });
      if (!user || !user.is_active) {
        throw new ExternalIdentityLinkError("current_user_invalid");
      }
      await tx.externalIdentity.create({
        data: {
          provider_id: provider.id,
          subject,
          user_id: user.id,
          email: claims.email ?? null,
          name: claims.name ?? null,
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
        groups: claims.groups ?? [],
        last_login_at: new Date(),
      },
    });
    return { user, isNew: true, linked: false, groupsChanged: true };
  });
}
