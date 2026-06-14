import type { PrismaClient, Prisma } from "@prisma/client";
import { hasScope } from "@admitto/db";

/**
 * Add RoleAssignments from OIDC group rules — additive only; never removes existing roles.
 * Local instance superadmin invariant: bootstrap superadmins keep their role even without groups.
 */
export async function applyOidcGroupRoleMappings(
  prisma: PrismaClient | Prisma.TransactionClient,
  providerId: string,
  userId: string,
  groups: string[],
): Promise<number> {
  if (groups.length === 0) return 0;

  const rules = await prisma.oidcGroupRoleMapping.findMany({
    where: { provider_id: providerId, group: { in: groups } },
  });
  if (rules.length === 0) return 0;

  let added = 0;
  for (const rule of rules) {
    const existing = await prisma.roleAssignment.findFirst({
      where: {
        user_id: userId,
        role: rule.role,
        scope_type: rule.scope_type,
        scope_id: rule.scope_id,
      },
    });
    if (!existing) {
      await prisma.roleAssignment.create({
        data: {
          user_id: userId,
          role: rule.role,
          scope_type: rule.scope_type,
          scope_id: rule.scope_id,
        },
      });
      added++;
    }
  }

  return added;
}

/** Returns true if user is a bootstrap-style instance superadmin (invariant check). */
export async function preservesSuperadminInvariant(
  prisma: PrismaClient | Prisma.TransactionClient,
  userId: string,
): Promise<boolean> {
  return hasScope(prisma, userId, "superadmin", "instance");
}
