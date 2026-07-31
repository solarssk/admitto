import type { Context } from "hono";
import type { PrismaClient } from "@admitto/db";
import { canManageInstance } from "@admitto/auth";
import { writeAdminAuditLogBestEffort } from "@admitto/tickets";
import {
  BrandingUploadError,
  saveBrandingUpload,
  saveEventUpload,
  saveThemeFontUpload,
} from "./branding-upload.js";
import { assertEventManageAccess, adminAuditFromContext, requireEventId } from "./admin-helpers.js";
import { resolveInstanceOrganizationId } from "./instance-org.js";
import { logger } from "../logger.js";

/** The only HTTP statuses BrandingUploadError ever carries - narrows its `number` field for
 * Hono's c.json overload, which needs a literal status rather than a plain number. */
type BrandingUploadStatus = 400 | 413 | 415;

/** Parses the multipart body and extracts the uploaded file, shared by all three upload routes
 * below. Returns the file, or an error Response to return directly - same `T | Response` pattern
 * as requireEventId in admin-helpers.js. */
async function parseUploadedFile(c: Context): Promise<File | Response> {
  let body: Record<string, string | File>;
  try {
    body = await c.req.parseBody();
  } catch {
    return c.json({ error: "invalid_form_data" }, 400);
  }
  const fileField = body.file;
  if (!(fileField instanceof File)) {
    return c.json({ error: "file_required" }, 400);
  }
  return fileField;
}

/** Runs `attempt` (the upload plus its own audit log write) and returns its result as 201 JSON,
 * mapping a thrown BrandingUploadError (or anything else) to the right response - the common
 * try/catch tail shared by all three upload routes below. */
async function respondToUpload(
  c: Context,
  handlerName: string,
  attempt: () => Promise<{ url: string }>,
): Promise<Response> {
  try {
    const result = await attempt();
    return c.json(result, 201);
  } catch (err) {
    if (err instanceof BrandingUploadError) {
      return c.json({ error: err.code, ...err.details }, err.status as BrandingUploadStatus);
    }
    logger.error(`${handlerName} failed`, { err });
    return c.json({ error: "server error" }, 500);
  }
}

/** POST /api/admin/uploads — superadmin only, multipart branding image. */
export async function handlePostUpload(c: Context, db: PrismaClient): Promise<Response> {
  const auth = c.get("auth");
  if (!(await canManageInstance(db, auth.userId))) {
    return c.json({ error: "forbidden" }, 403);
  }

  // TODO(multi-org): hardcoded until organization context is threaded through the upload
  // handler (see ROADMAP v0.5+). Safe today — single-tenant deployment, only one Organization
  // row exists. MUST be replaced before enabling multi-org (would leak uploads cross-tenant).
  const orgId = "default";

  const fileOrRes = await parseUploadedFile(c);
  if (fileOrRes instanceof Response) return fileOrRes;

  return respondToUpload(c, "handlePostUpload", async () => {
    const result = await saveBrandingUpload(fileOrRes, orgId);
    const realOrgId = await resolveInstanceOrganizationId(db);
    const audit = adminAuditFromContext(c);
    await writeAdminAuditLogBestEffort(db, {
      organizationId: realOrgId,
      actorUserId: auth.userId,
      sessionId: audit.sessionId,
      ip: audit.ip,
      timezone: audit.timezone,
      actionType: "org_branding_logo_uploaded",
    });
    return result;
  });
}

/**
 * POST /api/admin/events/:eventId/branding-upload — event managers (not superadmin-only,
 * matches the rest of Event settings' editable fields), multipart branding image scoped to
 * this event. Archive guard is applied by the caller (app.ts wraps with guardArchivedEvent).
 */
export async function handlePostEventBrandingUpload(c: Context, db: PrismaClient): Promise<Response> {
  const eventIdOrRes = requireEventId(c);
  if (eventIdOrRes instanceof Response) return eventIdOrRes;
  const eventId = eventIdOrRes;

  const forbidden = await assertEventManageAccess(c, db, eventId);
  if (forbidden) return forbidden;

  // assertEventManageAccess short-circuits true for superadmin without checking the event
  // exists (org admins already get a 403 "no leak" via canManageEvent's org lookup) — confirm
  // existence explicitly so a superadmin can't write orphaned files under a fake event id.
  const exists = await db.event.findUnique({ where: { id: eventId }, select: { id: true } });
  if (!exists) return c.json({ error: "not_found" }, 404);

  // TODO(multi-org): same single-tenant assumption as handlePostUpload above.
  const orgId = "default";

  const fileOrRes = await parseUploadedFile(c);
  if (fileOrRes instanceof Response) return fileOrRes;

  return respondToUpload(c, "handlePostEventBrandingUpload", async () => {
    const result = await saveEventUpload(fileOrRes, orgId, eventId);
    const realOrgId = await resolveInstanceOrganizationId(db);
    const audit = adminAuditFromContext(c);
    await writeAdminAuditLogBestEffort(db, {
      organizationId: realOrgId,
      actorUserId: c.get("auth").userId,
      sessionId: audit.sessionId,
      ip: audit.ip,
      timezone: audit.timezone,
      actionType: "event_branding_uploaded",
      metadata: { eventId },
    });
    return result;
  });
}

/** POST /api/admin/theme-font-upload — superadmin only, multipart custom brand font. */
export async function handlePostThemeFontUpload(c: Context, db: PrismaClient): Promise<Response> {
  const auth = c.get("auth");
  if (!(await canManageInstance(db, auth.userId))) {
    return c.json({ error: "forbidden" }, 403);
  }

  // NOSONAR — TODO(multi-org): same single-tenant assumption as handlePostUpload above. Tracked on the v0.5+ roadmap, not a forgotten task; safe today since only one Organization row exists.
  const orgId = "default";

  const fileOrRes = await parseUploadedFile(c);
  if (fileOrRes instanceof Response) return fileOrRes;

  return respondToUpload(c, "handlePostThemeFontUpload", async () => {
    const result = await saveThemeFontUpload(fileOrRes, orgId);
    const realOrgId = await resolveInstanceOrganizationId(db);
    const audit = adminAuditFromContext(c);
    await writeAdminAuditLogBestEffort(db, {
      organizationId: realOrgId,
      actorUserId: auth.userId,
      sessionId: audit.sessionId,
      ip: audit.ip,
      timezone: audit.timezone,
      actionType: "branding_font_uploaded",
    });
    return result;
  });
}
