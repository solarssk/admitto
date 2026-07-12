import type { Context } from "hono";
import { Prisma } from "@prisma/client";
import type { PrismaClient } from "@prisma/client";
import { z } from "zod";
import { ALLOWED_PLACEHOLDERS } from "@admitto/mail-templates";
import { writeBulkActionLog } from "@admitto/tickets";
import { adminAuditFromContext, assertEventManageAccess, requireEventId } from "./admin-helpers.js";
import { BrandingUploadError, saveEventUpload } from "./branding-upload.js";
import { logger } from "../logger.js";

/** Per-event cap on uploaded branding assets — generous for a sponsor-logo/photo library
 * while still bounding storage growth (mirrors MAX_TEMPLATES_PER_EVENT's precedent in
 * communication-api-routes.ts). */
export const MAX_IMAGE_ASSETS_PER_EVENT = 20;

/** Same {{snake_case}} shape as the mail-templates placeholder whitelist - an asset's token
 * becomes usable as {{token}} in email templates, so it must be a valid placeholder name. */
const tokenSchema = z
  .string()
  .trim()
  .min(1)
  .max(40)
  .regex(/^[a-z][a-z0-9_]*$/, "invalid token");

/** Admin API shape for a single uploaded event image asset. */
export type EventImageAssetDto = {
  id: string;
  token: string;
  filename: string;
  url: string;
  size_bytes: number;
  mime_type: string;
  created_at: string;
};

function serializeImageAsset(row: {
  id: string;
  token: string;
  filename: string;
  url: string;
  size_bytes: number;
  mime_type: string;
  created_at: Date;
}): EventImageAssetDto {
  return {
    id: row.id,
    token: row.token,
    filename: row.filename,
    url: row.url,
    size_bytes: row.size_bytes,
    mime_type: row.mime_type,
    created_at: row.created_at.toISOString(),
  };
}

/** GET /api/admin/events/:eventId/image-assets */
export async function handleListEventImageAssets(c: Context, db: PrismaClient): Promise<Response> {
  const eventIdOrRes = requireEventId(c);
  if (eventIdOrRes instanceof Response) return eventIdOrRes;
  const eventId = eventIdOrRes;

  const forbidden = await assertEventManageAccess(c, db, eventId);
  if (forbidden) return forbidden;

  const rows = await db.eventImageAsset.findMany({
    where: { event_id: eventId },
    orderBy: { created_at: "asc" },
    select: {
      id: true,
      token: true,
      filename: true,
      url: true,
      size_bytes: true,
      mime_type: true,
      created_at: true,
    },
  });

  return c.json({ items: rows.map(serializeImageAsset) });
}

/**
 * POST /api/admin/events/:eventId/image-assets — multipart upload (fields: `file`, `token`).
 * Archive guard applied by the caller (app.ts wraps with guardArchivedEvent).
 */
export async function handleCreateEventImageAsset(c: Context, db: PrismaClient): Promise<Response> {
  const eventIdOrRes = requireEventId(c);
  if (eventIdOrRes instanceof Response) return eventIdOrRes;
  const eventId = eventIdOrRes;

  const forbidden = await assertEventManageAccess(c, db, eventId);
  if (forbidden) return forbidden;

  // assertEventManageAccess short-circuits true for superadmin without checking the event
  // exists (see the identical guard in handlePostEventBrandingUpload) - confirm existence
  // explicitly so a superadmin can't write an orphaned file + DB row under a fake event id.
  const exists = await db.event.findUnique({ where: { id: eventId }, select: { id: true } });
  if (!exists) return c.json({ error: "not_found" }, 404);

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

  const tokenField = body.token;
  const tokenParsed = tokenSchema.safeParse(typeof tokenField === "string" ? tokenField : "");
  if (!tokenParsed.success) {
    return c.json({ error: "invalid_token" }, 400);
  }
  const token = tokenParsed.data;

  if (ALLOWED_PLACEHOLDERS.has(token)) {
    return c.json({ error: "reserved_token" }, 409);
  }

  const count = await db.eventImageAsset.count({ where: { event_id: eventId } });
  if (count >= MAX_IMAGE_ASSETS_PER_EVENT) {
    return c.json(
      { error: "asset_limit_reached", limit: MAX_IMAGE_ASSETS_PER_EVENT },
      422,
    );
  }

  // TODO(multi-org): same single-tenant assumption as handlePostEventBrandingUpload.
  const orgId = "default";

  try {
    const uploaded = await saveEventUpload(fileField, orgId, eventId);
    const created = await db.$transaction(async (tx) => {
      const row = await tx.eventImageAsset.create({
        data: {
          event_id: eventId,
          token,
          filename: fileField.name || "upload",
          url: uploaded.url,
          size_bytes: fileField.size,
          mime_type: fileField.type.split(";")[0]?.trim() || "application/octet-stream",
        },
        select: {
          id: true,
          token: true,
          filename: true,
          url: true,
          size_bytes: true,
          mime_type: true,
          created_at: true,
        },
      });
      await writeBulkActionLog(tx, {
        event_id: eventId,
        action_type: "event_image_asset_created",
        audit: adminAuditFromContext(c),
        metadata: { token: row.token },
      });
      return row;
    });
    return c.json(serializeImageAsset(created), 201);
  } catch (err) {
    if (err instanceof BrandingUploadError) {
      return c.json({ error: err.code, ...err.details }, err.status as 400 | 413 | 415);
    }
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
      return c.json({ error: "token_conflict" }, 409);
    }
    logger.error("handleCreateEventImageAsset failed", { err });
    return c.json({ error: "server error" }, 500);
  }
}

/** Load an image asset scoped to event; null when missing or cross-event (caller returns 403). */
async function loadImageAssetInEvent(db: PrismaClient, eventId: string, assetId: string) {
  const row = await db.eventImageAsset.findUnique({
    where: { id: assetId },
    select: { id: true, event_id: true, token: true },
  });
  if (!row || row.event_id !== eventId) return null;
  return row;
}

/**
 * DELETE /api/admin/events/:eventId/image-assets/:assetId — deletes only the DB row. The
 * uploaded file is intentionally left on disk (same precedent as removing a logo/header image
 * elsewhere in this app - nothing in this codebase deletes uploaded files from disk yet; a real
 * StorageAdapter cleanup pass is future work per ADR 0008, not introduced here). If the token is
 * still referenced by a saved template's {{token}}, that template fails loudly (as an unknown
 * placeholder) at its next save/render rather than silently breaking - no reference tracking.
 */
export async function handleDeleteEventImageAsset(c: Context, db: PrismaClient): Promise<Response> {
  const eventIdOrRes = requireEventId(c);
  if (eventIdOrRes instanceof Response) return eventIdOrRes;
  const eventId = eventIdOrRes;
  const assetId = c.req.param("assetId");
  if (!assetId) return c.json({ error: "assetId required" }, 400);

  const forbidden = await assertEventManageAccess(c, db, eventId);
  if (forbidden) return forbidden;

  const existing = await loadImageAssetInEvent(db, eventId, assetId);
  if (!existing) return c.json({ error: "forbidden" }, 403);

  await db.$transaction(async (tx) => {
    await tx.eventImageAsset.delete({ where: { id: assetId } });
    await writeBulkActionLog(tx, {
      event_id: eventId,
      action_type: "event_image_asset_deleted",
      audit: adminAuditFromContext(c),
      metadata: { token: existing.token },
    });
  });
  return c.json({ ok: true });
}
