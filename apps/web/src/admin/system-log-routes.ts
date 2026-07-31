import type { Context } from "hono";
import type { PrismaClient } from "@admitto/db";
import {
  currentSystemLogCursor,
  querySystemLogs,
  type SystemLogLevel,
  type SystemLogSource,
} from "@admitto/shared/system-log";
import { positiveIntQuery, requireSuperadmin } from "./admin-helpers.js";

const VALID_LEVELS = new Set<SystemLogLevel>(["info", "warn", "error"]);
const VALID_SOURCES = new Set<SystemLogSource>(["api", "db", "cache", "mail", "admin", "security"]);

/**
 * GET /api/admin/system-logs — live tail of the in-memory system-log buffer (see
 * @admitto/shared/system-log). Instance-wide (not org-scoped, unlike the audit log): this covers
 * process-level API/DB/cache/mail/admin activity, which has no per-org meaning. Superadmin only.
 * Unrecognized level/source values are ignored (treated as "no filter"), matching audit-log's
 * own permissive filter style.
 */
export async function handleGetSystemLogs(c: Context, db: PrismaClient): Promise<Response> {
  const denied = await requireSuperadmin(c, db);
  if (denied) return denied;

  const sinceId = positiveIntQuery(c.req.query("since"), 0);
  const levelRaw = c.req.query("level");
  const sourceRaw = c.req.query("source");
  const search = c.req.query("search")?.trim() || undefined;

  const entries = querySystemLogs({
    sinceId,
    level: levelRaw && VALID_LEVELS.has(levelRaw as SystemLogLevel) ? (levelRaw as SystemLogLevel) : undefined,
    source: sourceRaw && VALID_SOURCES.has(sourceRaw as SystemLogSource) ? (sourceRaw as SystemLogSource) : undefined,
    search,
  });

  return c.json({ entries, cursor: currentSystemLogCursor() });
}
