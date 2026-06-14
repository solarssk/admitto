import type { PrismaClient, Prisma } from "@prisma/client";
import { hasScope } from "@admitto/db";

/** RoleAssignment requires NULL scope_id for instance scope (DB CHECK). */
export function roleAssignmentScopeId(scopeType: string, scopeId: string | null): string | null {
  if (scopeType === "instance") return null;
  const trimmed = scopeId?.trim();
  return trimmed || null;
}

/**
 * Sync RoleAssignments from OIDC group rules for one provider login.
 * Adds matching roles and removes roles from this provider's rules when groups no longer match.
 * Bootstrap instance superadmin (assigned before OIDC link, or local-only) is preserved on demotion.
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

    const existing = await prisma.roleAssignment.findFirst({
      where: {
        user_id: userId,
        role: rule.role,
        scope_type: rule.scope_type,
        scope_id: scopeId,
      },
    });

    if (matches && !existing) {
      await prisma.roleAssignment.create({
        data: {
          user_id: userId,
          role: rule.role,
          scope_type: rule.scope_type,
          scope_id: scopeId,
        },
      });
      changed++;
      continue;
    }

    if (!matches && existing) {
      if (await shouldPreserveInstanceSuperadminOnDemotion(prisma, providerId, userId, rule)) {
        continue;
      }
      await prisma.roleAssignment.delete({ where: { id: existing.id } });
      changed++;
    }
  }

  return changed;
}

async function shouldPreserveInstanceSuperadminOnDemotion(
  prisma: PrismaClient | Prisma.TransactionClient,
  providerId: string,
  userId: string,
  rule: { role: string; scope_type: string },
): Promise<boolean> {
  if (rule.role !== "superadmin" || rule.scope_type !== "instance") return false;

  const assignment = await prisma.roleAssignment.findFirst({
    where: {
      user_id: userId,
      role: "superadmin",
      scope_type: "instance",
      scope_id: null,
    },
    select: { created_at: true },
  });
  if (!assignment) return false;

  const identity = await prisma.externalIdentity.findFirst({
    where: { provider_id: providerId, user_id: userId },
    select: { linked_at: true },
  });
  if (!identity) return true;

  return assignment.created_at < identity.linked_at;
}

/** Returns true if user is a bootstrap-style instance superadmin (invariant check). */
export async function preservesSuperadminInvariant(
  prisma: PrismaClient | Prisma.TransactionClient,
  userId: string,
): Promise<boolean> {
  return hasScope(prisma, userId, "superadmin", "instance");
}
