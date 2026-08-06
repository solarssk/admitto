import type { Context } from "hono";
import type { Prisma, PrismaClient } from "@admitto/db";
import { canManageInstance } from "@admitto/auth";
import { positiveIntQuery } from "./admin-helpers.js";

async function orgIdsForAdmin(db: PrismaClient, userId: string): Promise<string[]> {
  const rows = await db.roleAssignment.findMany({
    where: { user_id: userId, role: "admin", scope_type: "organization" },
    select: { scope_id: true },
  });
  return rows.map((r) => r.scope_id).filter((id): id is string => !!id);
}

/** GET /api/admin/role-assignments — paginated non-instance role grants. */
export async function handleGetRoleAssignments(c: Context, db: PrismaClient): Promise<Response> {
  const auth = c.get("auth");
  const actorIsSuperadmin = await canManageInstance(db, auth.userId);
  const orgIds = actorIsSuperadmin ? [] : await orgIdsForAdmin(db, auth.userId);

  if (!actorIsSuperadmin && orgIds.length === 0) {
    return c.json({ error: "forbidden" }, 403);
  }

  const page = positiveIntQuery(c.req.query("page"), 1);
  const pageSize = positiveIntQuery(c.req.query("pageSize"), 25, 50);
  const q = c.req.query("q")?.trim();
  const eventId = c.req.query("eventId")?.trim();

  let where: Prisma.RoleAssignmentWhereInput = { scope_type: { not: "instance" } };

  if (!actorIsSuperadmin) {
    const eventIds = (
      await db.event.findMany({
        where: { organization_id: { in: orgIds } },
        select: { id: true },
      })
    ).map((e) => e.id);

    where = {
      scope_type: { not: "instance" },
      OR: [
        { scope_type: "organization", scope_id: { in: orgIds } },
        { scope_type: "event", scope_id: { in: eventIds } },
      ],
    };
  }

  if (q) {
    where = {
      AND: [
        where,
        {
          user: {
            OR: [
              { email: { contains: q, mode: "insensitive" } },
              { display_name: { contains: q, mode: "insensitive" } },
            ],
          },
        },
      ],
    };
  }

  if (eventId) {
    where = { AND: [where, { scope_type: "event", scope_id: eventId }] };
  }

  const [total, rows] = await Promise.all([
    db.roleAssignment.count({ where }),
    db.roleAssignment.findMany({
      where,
      include: {
        user: { select: { email: true, display_name: true } },
        oidc_role_grants: { select: { id: true } },
      },
      orderBy: { created_at: "desc" },
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
  ]);

  const eventIds = rows
    .filter((r) => r.scope_type === "event" && r.scope_id)
    .map((r) => r.scope_id as string);
  const orgScopeIds = rows
    .filter((r) => r.scope_type === "organization" && r.scope_id)
    .map((r) => r.scope_id as string);

  const [events, orgs] = await Promise.all([
    eventIds.length
      ? db.event.findMany({
          where: { id: { in: eventIds } },
          select: { id: true, title: true, slug: true, organization_id: true },
        })
      : Promise.resolve([]),
    orgScopeIds.length
      ? db.organization.findMany({
          where: { id: { in: orgScopeIds } },
          select: { id: true, name: true },
        })
      : Promise.resolve([]),
  ]);

  const eventById = new Map(events.map((e) => [e.id, e]));
  const orgById = new Map(orgs.map((o) => [o.id, o]));

  const assignments = rows.map((row) => ({
    id: row.id,
    user_id: row.user_id,
    user_email: row.user.email,
    user_display_name: row.user.display_name,
    role: row.role,
    scope_type: row.scope_type,
    scope_id: row.scope_id,
    is_oidc: row.oidc_role_grants.length > 0,
    granted_at: row.created_at.toISOString(),
    event:
      row.scope_type === "event" && row.scope_id
        ? eventById.get(row.scope_id) ?? null
        : null,
    organization:
      row.scope_type === "organization" && row.scope_id
        ? orgById.get(row.scope_id) ?? null
        : null,
  }));

  return c.json({ assignments, total, page, pageSize });
}
