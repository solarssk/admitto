import type { Context } from "hono";
import type { Prisma, PrismaClient } from "@prisma/client";
import { canManageInstance } from "@admitto/auth";
import { positiveIntQuery } from "./admin-helpers.js";
import { resolveInstanceOrganizationId } from "./instance-org.js";

/** Return 403 when the session user is not a superadmin; otherwise null. */
async function requireSuperadmin(c: Context, db: PrismaClient): Promise<Response | null> {
  const auth = c.get("auth");
  if (!(await canManageInstance(db, auth.userId))) return c.json({ error: "forbidden" }, 403);
  return null;
}

const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Parse a query date bound. Date-only values (`YYYY-MM-DD`) use UTC day bounds:
 * start → 00:00:00.000, end → 23:59:59.999 (inclusive through the selected day).
 * Invalid values are ignored (returns undefined).
 */
function parseDateBound(raw: string | undefined, bound: "start" | "end"): Date | undefined {
  if (!raw) return undefined;
  const trimmed = raw.trim();
  if (DATE_ONLY.test(trimmed)) {
    const [year, month, day] = trimmed.split("-").map(Number);
    if (bound === "start") return new Date(Date.UTC(year, month - 1, day, 0, 0, 0, 0));
    return new Date(Date.UTC(year, month - 1, day, 23, 59, 59, 999));
  }
  const parsed = new Date(trimmed);
  if (Number.isNaN(parsed.getTime())) return undefined;
  return parsed;
}

/** GET /api/admin/audit-log — paginated org-scoped admin audit entries. Superadmin only. */
export async function handleGetAuditLog(c: Context, db: PrismaClient): Promise<Response> {
  const denied = await requireSuperadmin(c, db);
  if (denied) return denied;

  const orgId = await resolveInstanceOrganizationId(db, process.env);

  const page = positiveIntQuery(c.req.query("page"), 1);
  const pageSize = positiveIntQuery(c.req.query("pageSize"), 25, 100);
  const actionType = c.req.query("action_type")?.trim() || undefined;
  const start = parseDateBound(c.req.query("start"), "start");
  const end = parseDateBound(c.req.query("end"), "end");

  const where: Prisma.AdminAuditLogWhereInput = {
    organization_id: orgId,
    ...(actionType ? { action_type: actionType } : {}),
    ...(start || end
      ? {
          created_at: {
            ...(start ? { gte: start } : {}),
            ...(end ? { lte: end } : {}),
          },
        }
      : {}),
  };

  const [rows, total] = await Promise.all([
    db.adminAuditLog.findMany({
      where,
      orderBy: { created_at: "desc" },
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
    db.adminAuditLog.count({ where }),
  ]);

  const actorIds = [...new Set(rows.map((r) => r.actor_user_id))];
  const actors =
    actorIds.length > 0
      ? await db.user.findMany({
          where: { id: { in: actorIds } },
          select: { id: true, email: true, display_name: true },
        })
      : [];
  const actorMap = Object.fromEntries(actors.map((a) => [a.id, a]));

  const entries = rows.map((r) => ({
    id: r.id,
    action_type: r.action_type,
    actor_user_id: r.actor_user_id,
    actor_email: actorMap[r.actor_user_id]?.email ?? null,
    actor_display_name: actorMap[r.actor_user_id]?.display_name ?? null,
    ip: r.ip,
    metadata: r.metadata as Record<string, unknown> | null,
    created_at: r.created_at.toISOString(),
  }));

  return c.json({ entries, total, page, pageSize });
}
