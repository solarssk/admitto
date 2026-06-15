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

function ruleStillAuthorizesGrant(
  grant: { role: string; scope_type: string; scope_id: string | null },
  rules: Array<{ group: string; role: string; scope_type: string; scope_id: string }>,
  groupSet: Set<string>,
): boolean {
  return rules.some((rule) => {
    const scopeId = roleAssignmentScopeId(rule.scope_type, rule.scope_id);
    return (
      groupSet.has(rule.group) &&
      rule.role === grant.role &&
      rule.scope_type === grant.scope_type &&
      scopeId === grant.scope_id
    );
  });
}

async function revokeOidcRoleGrant(
  prisma: PrismaClient | Prisma.TransactionClient,
  grant: { id: string; role_assignment_id: string },
  userId: string,
): Promise<void> {
  await prisma.roleAssignment.deleteMany({
    where: { id: grant.role_assignment_id, user_id: userId },
  });
  await prisma.oidcRoleGrant.delete({ where: { id: grant.id } });
}

/**
 * Sync RoleAssignments from OIDC group rules for one provider login.
 * Adds matching roles and removes provider grants that no longer match any current rule + group.
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
  const groupSet = new Set(groups);
  let changed = 0;

  const grants = await prisma.oidcRoleGrant.findMany({
    where: { user_id: userId, provider_id: providerId },
  });

  for (const grant of grants) {
    if (ruleStillAuthorizesGrant(grant, rules, groupSet)) continue;
    await revokeOidcRoleGrant(prisma, grant, userId);
    changed++;
  }

  for (const rule of rules) {
    if (!groupSet.has(rule.group)) continue;

    const scopeId = roleAssignmentScopeId(rule.scope_type, rule.scope_id);
    const grantKey = grantWhere(userId, providerId, rule, scopeId);
    const grant = await prisma.oidcRoleGrant.findFirst({ where: grantKey });

    if (grant) continue;

    const existing = await prisma.roleAssignment.findFirst({
      where: {
        user_id: userId,
        role: rule.role,
        scope_type: rule.scope_type,
        scope_id: scopeId,
      },
    });
    if (existing) continue;

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

  return changed;
}

/** Returns true if user is a bootstrap-style instance superadmin (invariant check). */
export async function preservesSuperadminInvariant(
  prisma: PrismaClient | Prisma.TransactionClient,
  userId: string,
): Promise<boolean> {
  return hasScope(prisma, userId, "superadmin", "instance");
}
