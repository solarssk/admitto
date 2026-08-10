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
import { resolveIpLocation } from "../rate-limit/ip-location.js";

/** Free-text search over snapshot columns and live User rows. Snapshot columns cover deleted
 * accounts; the User lookup keeps matching current staff who have not yet triggered a new audit
 * row since the migration. */
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
  return {
    OR: [
      { user_id: { in: users.map((u) => u.id) } },
      { user_email: { contains: search, mode: "insensitive" } },
      { user_display_name: { contains: search, mode: "insensitive" } },
    ],
  };
}

/** Resolves the `user_id`/`search` query params to a where-clause fragment. Exact `user_id`
 * (e.g. the Edit user modal's own Recent logins list) takes priority over the fuzzy
 * email/display_name `search` below - contains-matching on free text can otherwise cross-match
 * a second account whose email or name happens to contain this one's, showing one user's
 * sign-in history to whoever's editing a completely different account. */
async function resolveSecurityIdentityMatch(
  db: PrismaClient,
  userId: string | undefined,
  search: string | undefined,
): Promise<Prisma.SecurityAuditLogWhereInput> {
  if (userId) return { user_id: userId };
  if (search) return resolveSecuritySearchMatch(db, search);
  return {};
}

/** Shared by the count and list queries below. */
async function buildSecurityAuditLogWhere(c: Context, db: PrismaClient): Promise<Prisma.SecurityAuditLogWhereInput> {
  const eventType = c.req.query("event_type")?.trim() || undefined;
  const userId = c.req.query("user_id")?.trim() || undefined;
  const search = c.req.query("search")?.trim() || undefined;
  const start = parseDateBound(c.req.query("start"), "start");
  const end = parseDateBound(c.req.query("end"), "end");

  return {
    ...(eventType ? { event_type: eventType } : {}),
    ...(await resolveSecurityIdentityMatch(db, userId, search)),
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

type SecurityIdentityRow = {
  user_id: string | null;
  user_email: string | null;
  user_display_name: string | null;
};

/** Legacy rows without snapshot columns still join to User; new rows use immutable columns. */
async function resolveUserMap(
  db: PrismaClient,
  rows: SecurityIdentityRow[],
): Promise<Record<string, UserRow>> {
  const needsJoin = rows.some((r) => r.user_id && !r.user_email);
  if (!needsJoin) return Object.create(null);

  const userIds = [
    ...new Set(rows.filter((r) => r.user_id && !r.user_email).map((r) => r.user_id as string)),
  ];
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

function resolveSecurityUserEmail(row: SecurityIdentityRow, userMap: Record<string, UserRow>): string | null {
  if (!row.user_id) return null;
  if (row.user_email) return row.user_email;
  return userMap[row.user_id]?.email ?? null;
}

function resolveSecurityUserDisplayName(
  row: SecurityIdentityRow,
  userMap: Record<string, UserRow>,
): string | null {
  if (!row.user_id) return null;
  if (row.user_email) return row.user_display_name;
  return userMap[row.user_id]?.display_name ?? null;
}

function securityUserCsvLabel(row: SecurityIdentityRow, userMap: Record<string, UserRow>): string {
  if (!row.user_id) return "Unknown";
  const email = resolveSecurityUserEmail(row, userMap);
  const name = resolveSecurityUserDisplayName(row, userMap);
  return name || email || row.user_id;
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
    user_email: resolveSecurityUserEmail(r, userMap),
    user_display_name: resolveSecurityUserDisplayName(r, userMap),
    ip: r.ip,
    country: resolveIpLocation(r.ip),
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
    user_email: string | null;
    user_display_name: string | null;
    ip: string | null;
    metadata: unknown;
  }[],
  userMap: Record<string, UserRow>,
): string {
  const header = SECURITY_CSV_COLUMNS.map((col) => quoteCsvCell(col)).join(",");
  const csvRows = rows.map((r) => {
    const meta = r.metadata as Record<string, unknown> | null;
    return [
      r.created_at.toISOString(),
      sanitizeCsvCell(r.event_type),
      sanitizeCsvCell(securityUserCsvLabel(r, userMap)),
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
