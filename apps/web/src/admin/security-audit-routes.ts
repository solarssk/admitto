import type { Context } from "hono";
import type { Prisma, PrismaClient } from "@admitto/db";
import { EXPORT_ROW_CAP, quoteCsvCell, sanitizeCsvCell } from "@admitto/tickets";
import {
  csvExportResponse,
  parseDateBound,
  positiveIntQuery,
  requireSuperadmin,
  selfAuditCsvExport,
} from "./admin-helpers.js";
import { resolveInstanceOrganizationId } from "./instance-org.js";

/** Free-text search over the resolved user (email/display name) - resolved to concrete ids up
 * front since it isn't directly queryable on SecurityAuditLog itself (requires a User join).
 * Mirrors resolveSearchMatch in audit-routes.ts but simpler: no event-title equivalent to also
 * match, since these rows aren't event-scoped. An empty match list is a valid "no rows" result
 * (a search matching zero users should show zero rows, not fall back to "no filter"). */
async function resolveSecuritySearchMatch(
  db: PrismaClient,
  search: string,
): Promise<Prisma.SecurityAuditLogWhereInput> {
  const users = await db.user.findMany({
    where: {
      OR: [
        { email: { contains: search, mode: "insensitive" } },
        { display_name: { contains: search, mode: "insensitive" } },
      ],
    },
    select: { id: true },
  });
  return { user_id: { in: users.map((u) => u.id) } };
}

/** Shared by the count and list queries below. */
async function buildSecurityAuditLogWhere(c: Context, db: PrismaClient): Promise<Prisma.SecurityAuditLogWhereInput> {
  const eventType = c.req.query("event_type")?.trim() || undefined;
  const search = c.req.query("search")?.trim() || undefined;
  const start = parseDateBound(c.req.query("start"), "start");
  const end = parseDateBound(c.req.query("end"), "end");

  return {
    ...(eventType ? { event_type: eventType } : {}),
    ...(search ? await resolveSecuritySearchMatch(db, search) : {}),
    ...(start || end
      ? {
          created_at: {
            ...(start ? { gte: start } : {}),
            ...(end ? { lte: end } : {}),
          },
        }
      : {}),
  };
}

type UserRow = { id: string; email: string; display_name: string | null };

/** Resolve each row's `user_id` (when set) to its current email/display_name. Rows with a null
 * `user_id` (failed logins, access-denied with no session — enumeration-safe by design, see
 * audit.ts) resolve to neither; deleted users likewise fall back to "Unknown" client-side. */
async function resolveUserMap(
  db: PrismaClient,
  rows: { user_id: string | null }[],
): Promise<Record<string, UserRow>> {
  const userIds = [...new Set(rows.map((r) => r.user_id).filter((id): id is string => id !== null))];
  const users =
    userIds.length > 0
      ? await db.user.findMany({
          where: { id: { in: userIds } },
          select: { id: true, email: true, display_name: true },
        })
      : [];
  const userMap: Record<string, UserRow> = Object.create(null);
  for (const u of users) userMap[u.id] = u;
  return userMap;
}

/**
 * GET /api/admin/security-audit-log — paginated durable auth/security event trail (issue #473:
 * logins, MFA, logout, OIDC, access-denied). Superadmin only. Deliberately narrower than
 * `/api/admin/audit-log`: no organization scoping (the underlying table has none - these are
 * instance-wide auth events, not per-org admin mutations). Supports the same
 * event-type/search/date-range filters as the audit log so the admin UI can present both as one
 * toggled view (see AuditLogPanel.tsx) with equivalent filtering.
 */
export async function handleGetSecurityAuditLog(c: Context, db: PrismaClient): Promise<Response> {
  const denied = await requireSuperadmin(c, db);
  if (denied) return denied;

  const page = positiveIntQuery(c.req.query("page"), 1);
  const pageSize = positiveIntQuery(c.req.query("pageSize"), 25, 100);
  const where = await buildSecurityAuditLogWhere(c, db);

  const [rows, total] = await Promise.all([
    db.securityAuditLog.findMany({
      where,
      orderBy: { created_at: "desc" },
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
    db.securityAuditLog.count({ where }),
  ]);

  const userMap = await resolveUserMap(db, rows);

  const entries = rows.map((r) => ({
    id: r.id,
    event_type: r.event_type,
    user_id: r.user_id,
    user_email: r.user_id ? (userMap[r.user_id]?.email ?? null) : null,
    user_display_name: r.user_id ? (userMap[r.user_id]?.display_name ?? null) : null,
    ip: r.ip,
    metadata: r.metadata as Record<string, unknown> | null,
    created_at: r.created_at.toISOString(),
  }));

  return c.json({ entries, total, page, pageSize });
}

const SECURITY_CSV_COLUMNS = ["time", "event", "user", "ip", "details"] as const;

/** Build CSV text for a page of security audit log rows (CRLF, quoted, formula-injection-safe
 * fields). Mirrors buildAuditLogCsv in audit-routes.ts, minus the "scope" column - these rows
 * aren't event-scoped. */
function buildSecurityAuditLogCsv(
  rows: {
    created_at: Date;
    event_type: string;
    user_id: string | null;
    ip: string | null;
    metadata: unknown;
  }[],
  userMap: Record<string, UserRow>,
): string {
  const header = SECURITY_CSV_COLUMNS.map((col) => quoteCsvCell(col)).join(",");
  const csvRows = rows.map((r) => {
    const user = r.user_id ? userMap[r.user_id] : undefined;
    const meta = r.metadata as Record<string, unknown> | null;
    return [
      r.created_at.toISOString(),
      sanitizeCsvCell(r.event_type),
      sanitizeCsvCell(user?.email ?? r.user_id ?? "Unknown"),
      sanitizeCsvCell(r.ip),
      sanitizeCsvCell(meta ? JSON.stringify(meta) : ""),
    ]
      .map((cell) => quoteCsvCell(cell))
      .join(",");
  });
  return [header, ...csvRows].join("\r\n");
}

/** GET /api/admin/security-audit-log/export — CSV of every row matching the current filters (not
 * just the current page). Superadmin only. The underlying SecurityAuditLog table has no
 * organization scoping (see handleGetSecurityAuditLog's doc comment), but the export action
 * itself is still an admin action worth recording - self-audits into the instance org's
 * AdminAuditLog, matching handleExportAuditLog in audit-routes.ts. */
export async function handleExportSecurityAuditLog(c: Context, db: PrismaClient): Promise<Response> {
  const denied = await requireSuperadmin(c, db);
  if (denied) return denied;

  if (c.req.query("format") !== "csv") {
    return c.json({ error: "format must be csv" }, 400);
  }

  const where = await buildSecurityAuditLogWhere(c, db);

  const total = await db.securityAuditLog.count({ where });
  if (total > EXPORT_ROW_CAP) {
    return c.json({ error: "export_too_large", count: total, cap: EXPORT_ROW_CAP }, 400);
  }

  // `take` is defense-in-depth, not the primary guard (the count() check above already rejects
  // an over-cap export) - matches handleExportAuditLog's own belt-and-suspenders cap.
  const rows = await db.securityAuditLog.findMany({ where, orderBy: { created_at: "desc" }, take: EXPORT_ROW_CAP });
  const userMap = await resolveUserMap(db, rows);
  const csv = buildSecurityAuditLogCsv(rows, userMap);

  const orgId = await resolveInstanceOrganizationId(db, process.env);
  await selfAuditCsvExport(db, c, {
    organizationId: orgId,
    actionType: "security_audit_log_exported",
    rowCount: rows.length,
  });
  return csvExportResponse(csv, "security-audit-log");
}
