import type { PrismaClient, Prisma } from "@prisma/client";

export type Role = "superadmin" | "admin" | "operator";
export type ScopeType = "instance" | "organization" | "event";

export const ROLES = ["superadmin", "admin", "operator"] as const satisfies Role[];
export const SCOPE_TYPES = ["instance", "organization", "event"] as const satisfies ScopeType[];

/**
 * Check whether a user has a specific role at a given scope.
 *
 * Exact-match only — no scope hierarchy or inheritance.
 * superadmin@instance does NOT implicitly grant admin@organization.
 * Hierarchy-aware checking is deferred to v1.0 (full RBAC enforcement).
 *
 * @param scopeId - null/undefined for instance scope; org or event id otherwise.
 */
export async function hasScope(
  prisma: PrismaClient | Prisma.TransactionClient,
  userRef: string,
  role: Role,
  scopeType: ScopeType,
  scopeId?: string,
): Promise<boolean> {
  const count = await prisma.roleAssignment.count({
    where: {
      user_ref: userRef,
      role,
      scope_type: scopeType,
      scope_id: scopeId ?? null,
    },
  });
  return count > 0;
}
