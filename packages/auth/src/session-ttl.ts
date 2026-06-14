import type { PrismaClient, Prisma } from "@prisma/client";
import {
  SESSION_TTL_ADMIN_MS,
  SESSION_TTL_OPERATOR_MS,
} from "./constants.js";
import {
  getSessionTtlAdminMs,
  getSessionTtlOperatorMs,
} from "./settings/resolver.js";

/**
 * Resolve session TTL from role assignments via SystemSettings:
 * admin/superadmin → session_ttl; operator-only → operator_session_ttl.
 */
export async function resolveSessionTtlMs(
  prisma: PrismaClient | Prisma.TransactionClient,
  userId: string,
): Promise<number> {
  const assignments = await prisma.roleAssignment.findMany({
    where: { user_id: userId },
    select: { role: true },
  });

  const hasElevated = assignments.some((a) => a.role === "superadmin" || a.role === "admin");
  return hasElevated ? getSessionTtlAdminMs(prisma) : getSessionTtlOperatorMs(prisma);
}

/** @deprecated Use getSessionTtlOperatorMs — kept for tests referencing env directly. */
export function operatorSessionTtlMs(): number {
  const raw = process.env["SESSION_TTL_OPERATOR_MS"];
  if (!raw) return SESSION_TTL_OPERATOR_MS;
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? n : SESSION_TTL_OPERATOR_MS;
}

/** @deprecated Use getSessionTtlAdminMs — kept for tests referencing env directly. */
export function adminSessionTtlMs(): number {
  const raw = process.env["SESSION_TTL_ADMIN_MS"];
  if (!raw) return SESSION_TTL_ADMIN_MS;
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? n : SESSION_TTL_ADMIN_MS;
}
