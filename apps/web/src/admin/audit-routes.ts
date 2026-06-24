import type { Context } from "hono";
import type { Prisma, PrismaClient } from "@prisma/client";
import { canManageInstance } from "@admitto/auth";
import { positiveIntQuery } from "./admin-helpers.js";
import { resolveInstanceOrganizationId } from "./instance-org.js";

async function requireSuperadmin(c: Context, db: PrismaClient): Promise<Response | null> {
  const auth = c.get("auth");
  if (!(await canManageInstance(db, auth.userId))) return c.json({ error: "forbidden" }, 403);
  return null;
}

function parseOptionalDate(raw: string | undefined): Date | undefined {
  if (!raw) return undefined;
  const d = new Date(raw);
  if (Number.isNaN(d.getTime())) return undefined;
  return d;
}

/** GET /api/admin/audit-log — paginated org-scoped admin audit entries. Superadmin only. */
export async function handleGetAuditLog(c: Context, db: PrismaClient): Promise<Response> {
  const denied = await requireSuperadmin(c, db);
  if (denied) return denied;

  const orgId = await resolveInstanceOrganizationId(db, process.env);

  const page = positiveIntQuery(c.req.query("page"), 1);
  const pageSize = positiveIntQuery(c.req.query("pageSize"), 25, 100);
  const actionType = c.req.query("action_type")?.trim() || undefined;
  const start = parseOptionalDate(c.req.query("start"));
  const end = parseOptionalDate(c.req.query("end"));

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
