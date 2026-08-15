import type { PrismaClient } from "@admitto/db";
import { hasScope } from "@admitto/db";
import { assertPasswordMeetsPolicy } from "./password-policy.js";
import { createUser } from "./user.js";
import { logSuperadminBootstrapCli } from "./audit.js";

/** True when any `superadmin@instance` role assignment exists. */
export async function superadminInstanceExists(prisma: PrismaClient): Promise<boolean> {
  const row = await prisma.roleAssignment.findFirst({
    where: { role: "superadmin", scope_type: "instance", scope_id: null },
    select: { id: true },
  });
  return row !== null;
}

/**
 * Break-glass: create local user + `superadmin@instance` + its audit record in one transaction.
 * Intended for CLI/first-run only, not runtime HTTP. The audit write lives inside this same
 * transaction (not a separate call from the CLI layer after this resolves) so a persisted
 * superadmin is never left with no audit trail if that write fails.
 */
export async function bootstrapSuperadmin(
  prisma: PrismaClient,
  email: string,
  password: string,
): Promise<{ userId: string }> {
  assertPasswordMeetsPolicy(password);
  const { userId } = await prisma.$transaction(async (tx) => {
    const user = await createUser(tx, { email, password });
    await tx.roleAssignment.create({
      data: {
        user_id: user.id,
        role: "superadmin",
        scope_type: "instance",
        scope_id: null,
      },
    });
    await logSuperadminBootstrapCli(tx, { email, userId: user.id });
    return { userId: user.id };
  });
  return { userId };
}

/** Gate CLI bootstrap: allow when no superadmin exists, or when `force` is true. */
export async function assertCanBootstrap(
  prisma: PrismaClient,
  force: boolean,
): Promise<{ allowed: true } | { allowed: false; reason: "exists" }> {
  const exists = await superadminInstanceExists(prisma);
  if (exists && !force) {
    return { allowed: false, reason: "exists" };
  }
  return { allowed: true };
}

/** Check whether a user is the instance superadmin (for tests). */
export async function userIsInstanceSuperadmin(
  prisma: PrismaClient,
  userId: string,
): Promise<boolean> {
  return hasScope(prisma, userId, "superadmin", "instance");
}
