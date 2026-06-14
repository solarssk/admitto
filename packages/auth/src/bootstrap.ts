import type { PrismaClient } from "@prisma/client";
import { hasScope } from "@admitto/db";
import { createUser } from "./user.js";

/** True when any `superadmin@instance` role assignment exists. */
export async function superadminInstanceExists(prisma: PrismaClient): Promise<boolean> {
  const row = await prisma.roleAssignment.findFirst({
    where: { role: "superadmin", scope_type: "instance", scope_id: null },
    select: { id: true },
  });
  return row !== null;
}

/**
 * Break-glass: create local user + `superadmin@instance` in one transaction.
 * Intended for CLI/first-run only, not runtime HTTP.
 */
export async function bootstrapSuperadmin(
  prisma: PrismaClient,
  email: string,
  password: string,
): Promise<{ userId: string }> {
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
