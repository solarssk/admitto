import type { Context } from "hono";
import type { Prisma, PrismaClient } from "@prisma/client";
import { canManageInstance } from "@admitto/auth";
import { EXPORT_ROW_CAP, sanitizeCsvCell, writeAdminAuditLog } from "@admitto/tickets";
import { adminAuditFromContext, positiveIntQuery } from "./admin-helpers.js";
import { attachmentContentDisposition } from "./content-disposition.js";
import { resolveInstanceOrganizationId } from "./instance-org.js";

/** Return 403 when the session user is not a superadmin; otherwise null. */
async function requireSuperadmin(c: Context, db: PrismaClient): Promise<Response | null> {
  const auth = c.get("auth");
  if (!(await canManageInstance(db, auth.userId))) return c.json({ error: "forbidden" }, 403);
  return null;
}

const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;

/** Reject impossible calendar dates such as 2026-02-30. */
function isValidCalendarDate(value: string): boolean {
  const parts = value.split("-").map(Number);
  if (parts.length !== 3) return false;
  const [year, month, day] = parts as [number, number, number];
  if (!year || !month || !day) return false;
  const parsed = new Date(Date.UTC(year, month - 1, day, 12, 0, 0));
  return (
    parsed.getUTCFullYear() === year &&
    parsed.getUTCMonth() === month - 1 &&
    parsed.getUTCDate() === day
  );
}

/**
 * Parse a query date bound. Date-only values (`YYYY-MM-DD`) use UTC day bounds:
 * start → 00:00:00.000, end → 23:59:59.999 (inclusive through the selected day).
 * Full ISO instants (with `T`) are used as-is — the UI sends local-day bounds this way.
 * Invalid calendar dates and unparseable values are ignored (returns undefined).
 */
function parseDateBound(raw: string | undefined, bound: "start" | "end"): Date | undefined {
  if (!raw) return undefined;
  const trimmed = raw.trim();
  if (DATE_ONLY.test(trimmed)) {
    if (!isValidCalendarDate(trimmed)) return undefined;
    const [year, month, day] = trimmed.split("-").map(Number) as [number, number, number];
    if (bound === "start") return new Date(Date.UTC(year, month - 1, day, 0, 0, 0, 0));
    return new Date(Date.UTC(year, month - 1, day, 23, 59, 59, 999));
  }
  const parsed = new Date(trimmed);
  if (Number.isNaN(parsed.getTime())) return undefined;
  return parsed;
}

/** Shared by the list (paginated) and export (all-matching) handlers. */
function buildAuditLogWhere(c: Context, orgId: string): Prisma.AdminAuditLogWhereInput {
  const actionType = c.req.query("action_type")?.trim() || undefined;
  const eventId = c.req.query("event_id")?.trim() || undefined;
  const start = parseDateBound(c.req.query("start"), "start");
  const end = parseDateBound(c.req.query("end"), "end");

  return {
    organization_id: orgId,
    ...(actionType ? { action_type: actionType } : {}),
    // Event scope lives only in metadata (no event_id column on this instance-wide table) -
    // writers are split between an `eventId` and a legacy `event_id` metadata key, so both are
    // matched here rather than picking one and silently missing the other's rows.
    ...(eventId
      ? {
          OR: [
            { metadata: { path: ["eventId"], equals: eventId } },
            { metadata: { path: ["event_id"], equals: eventId } },
          ],
        }
      : {}),
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

type ActorRow = { id: string; email: string; display_name: string | null };

/** Resolve each row's actor_user_id to its current email/display_name (deleted users resolve to
 * neither — callers fall back to a "Deleted user"-style label). Shared by the list and export
 * handlers so the two never drift on how an actor is displayed. */
async function resolveActorMap(
  db: PrismaClient,
  rows: { actor_user_id: string }[],
): Promise<Record<string, ActorRow>> {
  const actorIds = [...new Set(rows.map((r) => r.actor_user_id))];
  const actors =
    actorIds.length > 0
      ? await db.user.findMany({
          where: { id: { in: actorIds } },
          select: { id: true, email: true, display_name: true },
        })
      : [];
  const actorMap: Record<string, ActorRow> = Object.create(null);
  for (const a of actors) actorMap[a.id] = a;
  return actorMap;
}

/** GET /api/admin/audit-log — paginated org-scoped admin audit entries. Superadmin only. */
export async function handleGetAuditLog(c: Context, db: PrismaClient): Promise<Response> {
  const denied = await requireSuperadmin(c, db);
  if (denied) return denied;

  const orgId = await resolveInstanceOrganizationId(db, process.env);
  const page = positiveIntQuery(c.req.query("page"), 1);
  const pageSize = positiveIntQuery(c.req.query("pageSize"), 25, 100);
  const where = buildAuditLogWhere(c, orgId);

  const [rows, total] = await Promise.all([
    db.adminAuditLog.findMany({
      where,
      orderBy: { created_at: "desc" },
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
    db.adminAuditLog.count({ where }),
  ]);

  const actorMap = await resolveActorMap(db, rows);

  const entries = rows.map((r) => ({
    id: r.id,
    action_type: r.action_type,
    actor_user_id: r.actor_user_id,
    actor_email: actorMap[r.actor_user_id]?.email ?? null,
    actor_display_name: actorMap[r.actor_user_id]?.display_name ?? null,
    actor_timezone: r.actor_timezone,
    ip: r.ip,
    metadata: r.metadata as Record<string, unknown> | null,
    created_at: r.created_at.toISOString(),
  }));

  return c.json({ entries, total, page, pageSize });
}

/** RFC 4180 CSV field quoting (escape embedded double quotes). */
function quoteCsvCell(value: string): string {
  return `"${value.replaceAll('"', '""')}"`;
}

const CSV_COLUMNS = ["time", "action", "scope", "actor", "ip", "details"] as const;

/** Build CSV text for a page of audit log rows (CRLF, quoted, formula-injection-safe fields). */
function buildAuditLogCsv(
  rows: {
    created_at: Date;
    action_type: string;
    metadata: unknown;
    actor_user_id: string;
    ip: string | null;
  }[],
  actorMap: Record<string, ActorRow>,
): string {
  const header = CSV_COLUMNS.map(quoteCsvCell).join(",");
  const csvRows = rows.map((r) => {
    const actor = actorMap[r.actor_user_id];
    const meta = r.metadata as Record<string, unknown> | null;
    const eventId = meta?.eventId ?? meta?.event_id;
    return [
      r.created_at.toISOString(),
      sanitizeCsvCell(r.action_type),
      typeof eventId === "string" ? sanitizeCsvCell(eventId) : "Instance",
      sanitizeCsvCell(actor?.email ?? r.actor_user_id),
      sanitizeCsvCell(r.ip),
      sanitizeCsvCell(meta ? JSON.stringify(meta) : ""),
    ]
      .map(quoteCsvCell)
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
  const where = buildAuditLogWhere(c, orgId);

  const total = await db.adminAuditLog.count({ where });
  if (total > EXPORT_ROW_CAP) {
    return c.json({ error: "export_too_large", count: total, cap: EXPORT_ROW_CAP }, 400);
  }

  const rows = await db.adminAuditLog.findMany({ where, orderBy: { created_at: "desc" } });
  const actorMap = await resolveActorMap(db, rows);
  const csv = buildAuditLogCsv(rows, actorMap);

  const audit = adminAuditFromContext(c);
  await writeAdminAuditLog(db, {
    organizationId: orgId,
    actorUserId: audit.operator ?? c.get("auth").userId,
    sessionId: audit.sessionId,
    ip: audit.ip,
    timezone: audit.timezone,
    actionType: "audit_log_exported",
    metadata: { rowCount: rows.length },
  });

  const timestamp = new Date().toISOString().slice(0, 10);
  return new Response(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": attachmentContentDisposition(`audit-log-${timestamp}.csv`),
      "Cache-Control": "no-store",
      "Pragma": "no-cache",
    },
  });
}
