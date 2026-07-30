import type { Context } from "hono";
import type { PrismaClient } from "@prisma/client";
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

  try {
    const result = await saveBrandingUpload(fileField, orgId);
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
    return c.json(result, 201);
  } catch (err) {
    if (err instanceof BrandingUploadError) {
      return c.json({ error: err.code, ...err.details }, err.status as BrandingUploadStatus);
    }
    logger.error("handlePostUpload failed", { err });
    return c.json({ error: "server error" }, 500);
  }
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

  try {
    const result = await saveEventUpload(fileField, orgId, eventId);
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
    return c.json(result, 201);
  } catch (err) {
    if (err instanceof BrandingUploadError) {
      return c.json({ error: err.code, ...err.details }, err.status as BrandingUploadStatus);
    }
    logger.error("handlePostEventBrandingUpload failed", { err });
    return c.json({ error: "server error" }, 500);
  }
}

/** POST /api/admin/theme-font-upload — superadmin only, multipart custom brand font. */
export async function handlePostThemeFontUpload(c: Context, db: PrismaClient): Promise<Response> {
  const auth = c.get("auth");
  if (!(await canManageInstance(db, auth.userId))) {
    return c.json({ error: "forbidden" }, 403);
  }

  // TODO(multi-org): same single-tenant assumption as handlePostUpload above.
  const orgId = "default";

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

  try {
    const result = await saveThemeFontUpload(fileField, orgId);
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
    return c.json(result, 201);
  } catch (err) {
    if (err instanceof BrandingUploadError) {
      return c.json({ error: err.code, ...err.details }, err.status as BrandingUploadStatus);
    }
    logger.error("handlePostThemeFontUpload failed", { err });
    return c.json({ error: "server error" }, 500);
  }
}
