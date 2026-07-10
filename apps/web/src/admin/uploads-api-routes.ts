import type { Context } from "hono";
import type { PrismaClient } from "@prisma/client";
import { canManageInstance } from "@admitto/auth";
import { BrandingUploadError, saveBrandingUpload, saveEventUpload } from "./branding-upload.js";
import { assertEventManageAccess, requireEventId } from "./admin-helpers.js";
import { logger } from "../logger.js";

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
    return c.json(result, 201);
  } catch (err) {
    if (err instanceof BrandingUploadError) {
      return c.json({ error: err.code, ...err.details }, err.status as 400 | 413 | 415);
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
    return c.json(result, 201);
  } catch (err) {
    if (err instanceof BrandingUploadError) {
      return c.json({ error: err.code, ...err.details }, err.status as 400 | 413 | 415);
    }
    logger.error("handlePostEventBrandingUpload failed", { err });
    return c.json({ error: "server error" }, 500);
  }
}
