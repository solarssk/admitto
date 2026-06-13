import type { PrismaClient } from "@prisma/client";
import { hasScope } from "@admitto/db";
import { createUser } from "./user.js";

export async function superadminInstanceExists(prisma: PrismaClient): Promise<boolean> {
  const row = await prisma.roleAssignment.findFirst({
    where: { role: "superadmin", scope_type: "instance", scope_id: null },
    select: { id: true },
  });
  return row !== null;
}

export async function bootstrapSuperadmin(
  prisma: PrismaClient,
  email: string,
  password: string,
): Promise<{ userId: string }> {
  const user = await createUser(prisma, { email, password });
  await prisma.roleAssignment.create({
    data: {
      user_id: user.id,
      role: "superadmin",
      scope_type: "instance",
      scope_id: null,
    },
  });
  return { userId: user.id };
}

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
