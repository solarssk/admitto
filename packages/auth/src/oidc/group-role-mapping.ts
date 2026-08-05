import { randomInt } from "node:crypto";
import { Prisma, type PrismaClient } from "@admitto/db";
import { hasScope } from "@admitto/db";
import { logOidcSuperadminRevokeBlocked } from "../audit.js";

/** RoleAssignment requires NULL scope_id for instance scope (DB CHECK). */
export function roleAssignmentScopeId(scopeType: string, scopeId: string | null): string | null {
  if (scopeType === "instance") return null;
  const trimmed = scopeId?.trim();
  return trimmed || null;
}

/** True when `prisma` is a root client (can open nested transactions). */
function isPrismaClient(
  prisma: PrismaClient | Prisma.TransactionClient,
): prisma is PrismaClient {
  return "$transaction" in prisma;
}

/** Run `fn` in a nested transaction when the caller did not already pass a transaction client. */
async function runInOwnTransaction<T>(
  prisma: PrismaClient | Prisma.TransactionClient,
  fn: (tx: Prisma.TransactionClient) => Promise<T>,
  options?: { isolationLevel?: Prisma.TransactionIsolationLevel },
): Promise<T> {
  if (isPrismaClient(prisma)) {
    return prisma.$transaction(fn, options);
  }
  return fn(prisma);
}

/** Prisma unique-constraint violation (concurrent RoleAssignment / OidcRoleGrant insert). */
function isUniqueViolation(err: unknown): boolean {
  return (
    typeof err === "object" &&
    err !== null &&
    "code" in err &&
    (err as { code: string }).code === "P2002"
  );
}

/** Prisma Serializable transaction conflict (concurrent superadmin floor-guard revokes). */
export function isSerializationFailure(err: unknown): boolean {
  if (typeof err !== "object" || err === null || !("code" in err)) return false;
  if ((err as { code: string }).code === "P2034") return true;
  const cause = (err as {
    meta?: { driverAdapterError?: { cause?: { originalCode?: string; kind?: string } } };
  }).meta?.driverAdapterError?.cause;
  return cause?.originalCode === "40001" || cause?.kind === "TransactionWriteConflict";
}

/** Enough attempts for two concurrent Serializable revokes under CI load. */
const SERIALIZATION_RETRY_ATTEMPTS = 8;

function serializationRetryDelayMs(attempt: number): number {
  const base = Math.min(200, 25 * 2 ** attempt);
  return base + randomInt(25);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

/** Natural key for an OIDC-owned grant row. */
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

/** Lookup key for a RoleAssignment row (matches partial UNIQUE indexes). */
function assignmentWhere(
  userId: string,
  rule: { role: string; scope_type: string },
  scopeId: string | null,
) {
  return {
    user_id: userId,
    role: rule.role,
    scope_type: rule.scope_type,
    scope_id: scopeId,
  };
}

/** True when a current mapping rule + group membership still authorizes an existing grant. */
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

/** Count active users with instance-scoped superadmin RoleAssignment. */
export async function countActiveInstanceSuperadmins(
  prisma: PrismaClient | Prisma.TransactionClient,
): Promise<number> {
  return prisma.roleAssignment.count({
    where: {
      role: "superadmin",
      scope_type: "instance",
      scope_id: null,
      user: { is_active: true },
    },
  });
}

/** True for instance-scoped superadmin grants subject to the last-superadmin floor guard. */
function isInstanceSuperadminGrant(grant: {
  role: string;
  scope_type: string;
  scope_id: string | null;
}): boolean {
  return grant.role === "superadmin" && grant.scope_type === "instance" && grant.scope_id === null;
}

/** True when revoke would remove an active user's instance-superadmin assignment. */
async function removesActiveInstanceSuperadmin(
  prisma: PrismaClient | Prisma.TransactionClient,
  grant: { role_assignment_id: string },
  userId: string,
): Promise<boolean> {
  const count = await prisma.roleAssignment.count({
    where: {
      id: grant.role_assignment_id,
      user_id: userId,
      user: { is_active: true },
    },
  });
  return count > 0;
}

/** Remove one provider-owned grant and its linked assignment (grant cascades via FK). */
async function revokeOidcRoleGrant(
  prisma: PrismaClient | Prisma.TransactionClient,
  grant: {
    id: string;
    role_assignment_id: string;
    role: string;
    scope_type: string;
    scope_id: string | null;
  },
  userId: string,
  providerId: string,
): Promise<boolean> {
  const needsSerializableFloorGuard =
    isInstanceSuperadminGrant(grant) &&
    (await removesActiveInstanceSuperadmin(prisma, grant, userId));

  const transactionOptions = needsSerializableFloorGuard
    ? { isolationLevel: Prisma.TransactionIsolationLevel.Serializable }
    : undefined;

  for (let attempt = 0; attempt < SERIALIZATION_RETRY_ATTEMPTS; attempt++) {
    try {
      return await runInOwnTransaction(
        prisma,
        async (tx) => {
          if (isInstanceSuperadminGrant(grant)) {
            if (await removesActiveInstanceSuperadmin(tx, grant, userId)) {
              const remaining = await countActiveInstanceSuperadmins(tx);
              if (remaining <= 1) {
                await logOidcSuperadminRevokeBlocked(tx, { providerId, userId });
                return false;
              }
            }
          }
          await tx.roleAssignment.deleteMany({
            where: { id: grant.role_assignment_id, user_id: userId },
          });
          // OidcRoleGrant is removed via ON DELETE CASCADE on role_assignment_id FK.
          return true;
        },
        transactionOptions,
      );
    } catch (err) {
      if (isSerializationFailure(err) && attempt < SERIALIZATION_RETRY_ATTEMPTS - 1) {
        await sleep(serializationRetryDelayMs(attempt));
        continue;
      }
      throw err;
    }
  }

  throw new Error("unreachable: revokeOidcRoleGrant serialization retries exhausted");
}

/**
 * Create assignment + grant for one rule when missing.
 * All existence checks run inside one transaction; idempotent under P2002 races.
 * Returns true when this call created a new grant.
 */
async function ensureOidcGrantForRule(
  prisma: PrismaClient | Prisma.TransactionClient,
  userId: string,
  providerId: string,
  rule: { role: string; scope_type: string },
  scopeId: string | null,
  grantKey: ReturnType<typeof grantWhere>,
): Promise<boolean> {
  return runInOwnTransaction(prisma, async (tx) => {
    if (await tx.oidcRoleGrant.findFirst({ where: grantKey })) {
      return false;
    }

    if (await tx.roleAssignment.findFirst({ where: assignmentWhere(userId, rule, scopeId) })) {
      // Manual assignment or concurrent winner — never attach an OIDC grant here.
      return false;
    }

    let assignment;
    try {
      assignment = await tx.roleAssignment.create({
        data: {
          user_id: userId,
          role: rule.role,
          scope_type: rule.scope_type,
          scope_id: scopeId,
        },
      });
    } catch (err) {
      if (!isUniqueViolation(err)) throw err;
      // Concurrent winner committed the assignment first; it will also create the grant.
      return false;
    }

    try {
      await tx.oidcRoleGrant.create({
        data: {
          ...grantKey,
          role_assignment_id: assignment.id,
        },
      });
      return true;
    } catch (err) {
      if (isUniqueViolation(err)) {
        return false;
      }
      throw err;
    }
  });
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
    if (await revokeOidcRoleGrant(prisma, grant, userId, providerId)) {
      changed++;
    }
  }

  for (const rule of rules) {
    if (!groupSet.has(rule.group)) continue;

    const scopeId = roleAssignmentScopeId(rule.scope_type, rule.scope_id);
    const grantKey = grantWhere(userId, providerId, rule, scopeId);

    if (await ensureOidcGrantForRule(prisma, userId, providerId, rule, scopeId, grantKey)) {
      changed++;
    }
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
