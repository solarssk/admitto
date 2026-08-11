import type { Context } from "hono";
import type { Prisma, PrismaClient } from "@admitto/db";
import { EXPORT_ROW_CAP, quoteCsvCell, sanitizeCsvCell } from "@admitto/tickets";
import {
  csvExportResponse,
  parseDateBound,
  positiveIntQuery,
  requireSuperadmin,
  resolveUserDisplayMap,
  selfAuditCsvExport,
  type UserDisplayRow,
} from "./admin-helpers.js";
import { resolveInstanceOrganizationId } from "./instance-org.js";
import { resolveIpLocation } from "../rate-limit/ip-location.js";

/** An event_id metadata match - writers split between an `eventId` and a legacy `event_id` key,
 * so both are checked rather than picking one and silently missing the other's rows. */
function eventScopeMatch(eventId: string): Prisma.AdminAuditLogWhereInput[] {
  return [
    { metadata: { path: ["eventId"], equals: eventId } },
    { metadata: { path: ["event_id"], equals: eventId } },
  ];
}

/** Free-text search over actor snapshot columns, live User rows, and event title. */
async function resolveSearchMatch(
  db: PrismaClient,
  orgId: string,
  search: string,
): Promise<Prisma.AdminAuditLogWhereInput> {
  const [actors, events] = await Promise.all([
    db.user.findMany({
      where: {
        OR: [
          { email: { contains: search, mode: "insensitive" } },
          { display_name: { contains: search, mode: "insensitive" } },
        ],
      },
      select: { id: true },
    }),
    db.event.findMany({
      where: { organization_id: orgId, title: { contains: search, mode: "insensitive" } },
      select: { id: true },
    }),
  ]);
  return {
    OR: [
      { actor_user_id: { in: actors.map((a) => a.id) } },
      { actor_email: { contains: search, mode: "insensitive" } },
      { actor_display_name: { contains: search, mode: "insensitive" } },
      ...events.flatMap((e) => eventScopeMatch(e.id)),
    ],
  };
}

/** Shared by the list (paginated) and export (all-matching) handlers. */
async function buildAuditLogWhere(c: Context, db: PrismaClient, orgId: string): Promise<Prisma.AdminAuditLogWhereInput> {
  const actionType = c.req.query("action_type")?.trim() || undefined;
  const eventId = c.req.query("event_id")?.trim() || undefined;
  const search = c.req.query("search")?.trim() || undefined;
  const start = parseDateBound(c.req.query("start"), "start");
  const end = parseDateBound(c.req.query("end"), "end");

  const and: Prisma.AdminAuditLogWhereInput[] = [];
  if (eventId) and.push({ OR: eventScopeMatch(eventId) });
  if (search) and.push(await resolveSearchMatch(db, orgId, search));

  return {
    organization_id: orgId,
    ...(actionType ? { action_type: actionType } : {}),
    ...(and.length ? { AND: and } : {}),
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

type ActorIdentityRow = {
  actor_user_id: string;
  actor_email: string | null;
  actor_display_name: string | null;
};

async function resolveLegacyActorMap(
  db: PrismaClient,
  rows: ActorIdentityRow[],
): Promise<Record<string, UserDisplayRow>> {
  const needsJoin = rows.some((r) => !r.actor_email);
  if (!needsJoin) return Object.create(null);
  const actorIds = [...new Set(rows.filter((r) => !r.actor_email).map((r) => r.actor_user_id))];
  return resolveUserDisplayMap(db, actorIds);
}

function resolveActorEmail(row: ActorIdentityRow, actorMap: Record<string, UserDisplayRow>): string | null {
  if (row.actor_email) return row.actor_email;
  return actorMap[row.actor_user_id]?.email ?? null;
}

function resolveActorDisplayName(
  row: ActorIdentityRow,
  actorMap: Record<string, UserDisplayRow>,
): string | null {
  if (row.actor_email) return row.actor_display_name;
  return actorMap[row.actor_user_id]?.display_name ?? null;
}

function actorCsvLabel(row: ActorIdentityRow, actorMap: Record<string, UserDisplayRow>): string {
  const email = resolveActorEmail(row, actorMap);
  const name = resolveActorDisplayName(row, actorMap);
  return name || email || row.actor_user_id;
}

/** GET /api/admin/audit-log — paginated org-scoped admin audit entries. Superadmin only. */
export async function handleGetAuditLog(c: Context, db: PrismaClient): Promise<Response> {
  const denied = await requireSuperadmin(c, db);
  if (denied) return denied;

  const orgId = await resolveInstanceOrganizationId(db, process.env);
  const page = positiveIntQuery(c.req.query("page"), 1);
  const pageSize = positiveIntQuery(c.req.query("pageSize"), 25, 100);
  const where = await buildAuditLogWhere(c, db, orgId);

  const [rows, total] = await Promise.all([
    db.adminAuditLog.findMany({
      where,
      orderBy: { created_at: "desc" },
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
    db.adminAuditLog.count({ where }),
  ]);

  const actorMap = await resolveLegacyActorMap(db, rows);

  const entries = rows.map((r) => ({
    id: r.id,
    action_type: r.action_type,
    actor_user_id: r.actor_user_id,
    actor_email: resolveActorEmail(r, actorMap),
    actor_display_name: resolveActorDisplayName(r, actorMap),
    actor_timezone: r.actor_timezone,
    ip: r.ip,
    country: resolveIpLocation(r.ip),
    metadata: r.metadata as Record<string, unknown> | null,
    created_at: r.created_at.toISOString(),
  }));

  return c.json({ entries, total, page, pageSize });
}

const CSV_COLUMNS = ["time", "action", "scope", "actor", "ip", "details"] as const;

/** Build CSV text for a page of audit log rows (CRLF, quoted, formula-injection-safe fields). */
function buildAuditLogCsv(
  rows: {
    created_at: Date;
    action_type: string;
    metadata: unknown;
    actor_user_id: string;
    actor_email: string | null;
    actor_display_name: string | null;
    ip: string | null;
  }[],
  actorMap: Record<string, UserDisplayRow>,
): string {
  const header = CSV_COLUMNS.map((col) => quoteCsvCell(col)).join(",");
  const csvRows = rows.map((r) => {
    const meta = r.metadata as Record<string, unknown> | null;
    const eventId = meta?.eventId ?? meta?.event_id;
    return [
      r.created_at.toISOString(),
      sanitizeCsvCell(r.action_type),
      typeof eventId === "string" ? sanitizeCsvCell(eventId) : "Instance",
      sanitizeCsvCell(actorCsvLabel(r, actorMap)),
      sanitizeCsvCell(r.ip),
      sanitizeCsvCell(meta ? JSON.stringify(meta) : ""),
    ]
      .map((cell) => quoteCsvCell(cell))
      .join(",");
  });
  return [header, ...csvRows].join("\r\n");
}

/** GET /api/admin/audit-log/export — CSV of every row matching the current filters (not just the
 * current page). Superadmin only; self-audits via the same table it's exporting from. */
export async function handleExportAuditLog(c: Context, db: PrismaClient): Promise<Response> {
  const denied = await requireSuperadmin(c, db);
  if (denied) return denied;

  if (c.req.query("format") !== "csv") {
    return c.json({ error: "format must be csv" }, 400);
  }

  const orgId = await resolveInstanceOrganizationId(db, process.env);
  const where = await buildAuditLogWhere(c, db, orgId);

  const total = await db.adminAuditLog.count({ where });
  if (total > EXPORT_ROW_CAP) {
    return c.json({ error: "export_too_large", count: total, cap: EXPORT_ROW_CAP }, 400);
  }

  // `take` is defense-in-depth, not the primary guard (the count() check above already rejects
  // an over-cap export) - matches findFilteredAttendeesForExport's own belt-and-suspenders cap.
  const rows = await db.adminAuditLog.findMany({ where, orderBy: { created_at: "desc" }, take: EXPORT_ROW_CAP });
  const actorMap = await resolveLegacyActorMap(db, rows);
  const csv = buildAuditLogCsv(rows, actorMap);

  await selfAuditCsvExport(db, c, { organizationId: orgId, actionType: "audit_log_exported", rowCount: rows.length });
  return csvExportResponse(csv, "audit-log");
}
