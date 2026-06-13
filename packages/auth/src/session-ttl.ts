import type { PrismaClient, Prisma } from "@prisma/client";
import { SESSION_TTL_ADMIN_MS, SESSION_TTL_OPERATOR_MS } from "./constants.js";

function parseEnvMs(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

export function operatorSessionTtlMs(): number {
  return parseEnvMs("SESSION_TTL_OPERATOR_MS", SESSION_TTL_OPERATOR_MS);
}

export function adminSessionTtlMs(): number {
  return parseEnvMs("SESSION_TTL_ADMIN_MS", SESSION_TTL_ADMIN_MS);
}

/**
 * Resolve session TTL from role assignments: admin/superadmin → longer TTL;
 * operator-only → shorter TTL. Uses longest applicable TTL when mixed roles.
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
  return hasElevated ? adminSessionTtlMs() : operatorSessionTtlMs();
}
