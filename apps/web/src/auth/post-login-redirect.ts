import type { PrismaClient } from "@prisma/client";
import { resolvePostLoginRedirect } from "./safe-redirect.js";

export async function resolvePostLoginRedirectForUser(
  db: PrismaClient,
  userId: string,
  next?: string,
): Promise<string> {
  const user = await db.user.findUnique({
    where: { id: userId },
    select: { must_change_password: true },
  });
  if (user?.must_change_password) return "/change-password";

  const assignments = await db.roleAssignment.findMany({
    where: { user_id: userId },
    select: { role: true, scope_type: true, scope_id: true },
  });
  return resolvePostLoginRedirect(next, assignments);
}
