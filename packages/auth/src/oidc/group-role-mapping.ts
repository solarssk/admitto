import type { PrismaClient, Prisma } from "@prisma/client";
import { hasScope } from "@admitto/db";

/** RoleAssignment requires NULL scope_id for instance scope (DB CHECK). */
export function roleAssignmentScopeId(scopeType: string, scopeId: string | null): string | null {
  if (scopeType === "instance") return null;
  const trimmed = scopeId?.trim();
  return trimmed || null;
}

function grantWhere(
  userId: string,
  providerId: string,
  rule: { role: string; scope_type: string },
  scopeId: string | null,
) {
  return {
    user_id: userId,
    provider_id: providerId,
    role: rule.role,
    scope_type: rule.scope_type,
    scope_id: scopeId,
  };
}

/**
 * Sync RoleAssignments from OIDC group rules for one provider login.
 * Adds matching roles and removes only grants previously issued by this provider.
 * Pre-existing manual (or other-source) assignments are never deleted.
 */
export async function applyOidcGroupRoleMappings(
  prisma: PrismaClient | Prisma.TransactionClient,
  providerId: string,
  userId: string,
  groups: string[],
): Promise<number> {
  const rules = await prisma.oidcGroupRoleMapping.findMany({
    where: { provider_id: providerId },
  });
  if (rules.length === 0) return 0;

  const groupSet = new Set(groups);
  let changed = 0;

  for (const rule of rules) {
    const scopeId = roleAssignmentScopeId(rule.scope_type, rule.scope_id);
    const matches = groupSet.has(rule.group);
    const grantKey = grantWhere(userId, providerId, rule, scopeId);

    const grant = await prisma.oidcRoleGrant.findFirst({ where: grantKey });

    if (matches) {
      const existing = await prisma.roleAssignment.findFirst({
        where: {
          user_id: userId,
          role: rule.role,
          scope_type: rule.scope_type,
          scope_id: scopeId,
        },
      });
      if (!existing) {
        const assignment = await prisma.roleAssignment.create({
          data: {
            user_id: userId,
            role: rule.role,
            scope_type: rule.scope_type,
            scope_id: scopeId,
          },
        });
        await prisma.oidcRoleGrant.create({
          data: {
            ...grantKey,
            role_assignment_id: assignment.id,
          },
        });
        changed++;
      }
      continue;
    }

    if (!grant) continue;

    await prisma.roleAssignment.deleteMany({
      where: { id: grant.role_assignment_id, user_id: userId },
    });
    await prisma.oidcRoleGrant.delete({ where: { id: grant.id } });
    changed++;
  }

  return changed;
}

/** Returns true if user is a bootstrap-style instance superadmin (invariant check). */
export async function preservesSuperadminInvariant(
  prisma: PrismaClient | Prisma.TransactionClient,
  userId: string,
): Promise<boolean> {
  return hasScope(prisma, userId, "superadmin", "instance");
}
