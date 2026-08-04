import type { Context } from "hono";
import { Prisma } from "@admitto/db";
import type { PrismaClient } from "@admitto/db";
import { z } from "zod";
import { ALLOWED_PLACEHOLDERS } from "@admitto/mail-templates";
import { writeBulkActionLog } from "@admitto/tickets";
import {
  adminAuditFromContext,
  assertEventManageAccess,
  requireEventId,
  requireSuperadmin,
} from "./admin-helpers.js";
import { BrandingUploadError, bestEffortDeleteUploadUrl, saveEventUpload } from "./branding-upload.js";
import { logger } from "../logger.js";

/** Per-event cap on uploaded branding assets — generous for a sponsor-logo/photo library
 * while still bounding storage growth (mirrors MAX_TEMPLATES_PER_EVENT's precedent in
 * communication-api-routes.ts). */
export const MAX_IMAGE_ASSETS_PER_EVENT = 20;

/** Thrown when the per-event cap is still exceeded on the transaction-scoped recheck (bot
 * review: two concurrent uploads could otherwise both pass the earlier, non-transactional count
 * check before either insert committed). Caught below and mapped to the same 422 response. */
class AssetLimitReachedError extends Error {}

/** Thrown when a delete's in-use recheck (inside the lock) finds a template reference that
 * appeared after the initial check. Caught below and mapped to the same 409 response. */
class AssetInUseError extends Error {}

/** Serializes create/delete for one event's image asset library (same pattern as
 * event-capacity.ts's acquireEventCapacityLock): a transaction-scoped count/recheck is not
 * race-safe on its own since two concurrent transactions can both read the pre-write state
 * before either commits. Also used by communication-api-routes.ts's template-save handlers so a
 * delete can't slip between a template save's placeholder check and its commit. */
export async function acquireEventImageAssetsLock(
  tx: Prisma.TransactionClient,
  eventId: string,
): Promise<void> {
  const lockKey = `event-image-assets:${eventId}`;
  await tx.$executeRaw(Prisma.sql`SELECT pg_advisory_xact_lock(hashtext(${lockKey}))`);
}

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

/** GET /api/admin/events/:eventId/image-assets — superadmin only (this data flows into
 * attendee-facing email content, same posture as the sibling branding upload/revoke routes). */
export async function handleListEventImageAssets(c: Context, db: PrismaClient): Promise<Response> {
  const superadminDenied = await requireSuperadmin(c, db);
  if (superadminDenied) return superadminDenied;

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
 * Superadmin only (same posture as the sibling branding upload/revoke routes, since this data
 * flows into attendee-facing email content). Archive guard applied by the caller (app.ts wraps
 * with guardArchivedEvent).
 */
type CreateAssetValidation =
  | { ok: true; fileField: File; token: string }
  | { ok: false; response: Response };

/** Parses and validates the upload request (form fields, reserved/duplicate token, per-event
 * cap) ahead of the actual file write - split out of handleCreateEventImageAsset to keep that
 * function's own cognitive complexity down to its real job (upload + transaction + error
 * mapping) instead of also carrying this linear validation chain. */
async function validateCreateAssetRequest(
  c: Context,
  db: PrismaClient,
  eventId: string,
): Promise<CreateAssetValidation> {
  let body: Record<string, string | File>;
  try {
    body = await c.req.parseBody();
  } catch {
    return { ok: false, response: c.json({ error: "invalid_form_data" }, 400) };
  }

  const fileField = body.file;
  if (!(fileField instanceof File)) {
    return { ok: false, response: c.json({ error: "file_required" }, 400) };
  }

  const tokenField = body.token;
  const tokenParsed = tokenSchema.safeParse(typeof tokenField === "string" ? tokenField : "");
  if (!tokenParsed.success) {
    return { ok: false, response: c.json({ error: "invalid_token" }, 400) };
  }
  const token = tokenParsed.data;

  if (ALLOWED_PLACEHOLDERS.has(token)) {
    return { ok: false, response: c.json({ error: "reserved_token" }, 409) };
  }

  // Fast-path rejection only (avoids writing a file to disk when the library is obviously
  // already full); handleCreateEventImageAsset's transaction rechecks this for real.
  const count = await db.eventImageAsset.count({ where: { event_id: eventId } });
  if (count >= MAX_IMAGE_ASSETS_PER_EVENT) {
    return {
      ok: false,
      response: c.json({ error: "asset_limit_reached", limit: MAX_IMAGE_ASSETS_PER_EVENT }, 422),
    };
  }

  // saveEventUpload writes the file to disk before the unique (event_id, token) insert - check
  // for an existing token first so a duplicate upload fails cleanly instead of leaving an
  // orphaned file behind. The P2002 catch in handleCreateEventImageAsset stays as the guard for
  // concurrent uploads.
  const duplicate = await db.eventImageAsset.findUnique({
    where: { event_id_token: { event_id: eventId, token } },
    select: { id: true },
  });
  if (duplicate) {
    return { ok: false, response: c.json({ error: "token_conflict" }, 409) };
  }

  return { ok: true, fileField, token };
}

export async function handleCreateEventImageAsset(c: Context, db: PrismaClient): Promise<Response> {
  const superadminDenied = await requireSuperadmin(c, db);
  if (superadminDenied) return superadminDenied;

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

  const validation = await validateCreateAssetRequest(c, db, eventId);
  if (!validation.ok) return validation.response;
  const { fileField, token } = validation;

  // TODO(multi-org): same single-tenant assumption as handlePostEventBrandingUpload.
  const orgId = "default";

  try {
    const uploaded = await saveEventUpload(fileField, orgId, eventId);
    const created = await db.$transaction(async (tx) => {
      // Recheck the cap inside the transaction: the earlier count() above is a fast-path
      // rejection only (avoids writing a file to disk when the library is obviously already
      // full) and isn't race-safe on its own - two concurrent uploads could both read a count
      // under the cap before either insert commits. The advisory lock serializes concurrent
      // transactions for the same event so the recount below is accurate (default Postgres
      // isolation is READ COMMITTED, not Serializable).
      await acquireEventImageAssetsLock(tx, eventId);
      const recount = await tx.eventImageAsset.count({ where: { event_id: eventId } });
      if (recount >= MAX_IMAGE_ASSETS_PER_EVENT) {
        throw new AssetLimitReachedError();
      }
      const row = await tx.eventImageAsset.create({
        data: {
          event_id: eventId,
          token,
          filename: fileField.name || "upload",
          url: uploaded.url,
          size_bytes: uploaded.sizeBytes,
          mime_type: uploaded.mimeType,
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
    if (err instanceof AssetLimitReachedError) {
      return c.json(
        { error: "asset_limit_reached", limit: MAX_IMAGE_ASSETS_PER_EVENT },
        422,
      );
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
    select: { id: true, event_id: true, token: true, url: true },
  });
  if (row?.event_id !== eventId) return null;
  return row;
}

/**
 * DELETE /api/admin/events/:eventId/image-assets/:assetId: deletes the DB row and best-effort
 * removes the managed `/uploads/…` file (interim orphan cleanup; full StorageAdapter GC is ADR 0008).
 * If the token is still referenced by a saved event template's {{token}}, the delete is rejected
 * (409 asset_in_use) - the batch send path renders saved templates without whitelist re-validation
 * (renderTemplateTrustedForStorage), so after a delete the token would silently resolve to ""
 * and the image would just vanish from attendee emails. Superadmin only, same posture as the
 * sibling branding upload/revoke routes.
 */
export async function handleDeleteEventImageAsset(c: Context, db: PrismaClient): Promise<Response> {
  const superadminDenied = await requireSuperadmin(c, db);
  if (superadminDenied) return superadminDenied;

  const eventIdOrRes = requireEventId(c);
  if (eventIdOrRes instanceof Response) return eventIdOrRes;
  const eventId = eventIdOrRes;
  const assetId = c.req.param("assetId");
  if (!assetId) return c.json({ error: "assetId required" }, 400);

  const forbidden = await assertEventManageAccess(c, db, eventId);
  if (forbidden) return forbidden;

  const existing = await loadImageAssetInEvent(db, eventId, assetId);
  if (!existing) return c.json({ error: "forbidden" }, 403);

  try {
    await db.$transaction(async (tx) => {
      // The lock serializes against communication-api-routes.ts's template-save handlers,
      // which take the same lock before their own placeholder check + commit - without it, a
      // save could commit a new {{token}} reference between this check and the delete below
      // (Postgres default isolation is READ COMMITTED, not Serializable).
      await acquireEventImageAssetsLock(tx, eventId);

      // Only saved event-scoped templates count: org-scoped templates never get the widened
      // placeholder whitelist (resolveScopeCustomPlaceholders), so they cannot reference custom
      // tokens, and the builtin default has none. Placeholders are exact {{name}} with no
      // padding (VALID_PLACEHOLDER_RE), so a literal substring match is sufficient.
      const placeholder = `{{${existing.token}}}`;
      const referencing = await tx.mailTemplate.findFirst({
        where: {
          scope_type: "event",
          scope_id: eventId,
          OR: [
            { subject_template: { contains: placeholder } },
            { body_template: { contains: placeholder } },
          ],
        },
        select: { id: true },
      });
      if (referencing) {
        throw new AssetInUseError();
      }

      await tx.eventImageAsset.delete({ where: { id: assetId } });
      await writeBulkActionLog(tx, {
        event_id: eventId,
        action_type: "event_image_asset_deleted",
        audit: adminAuditFromContext(c),
        metadata: { token: existing.token },
      });
    });
  } catch (err) {
    if (err instanceof AssetInUseError) {
      return c.json({ error: "asset_in_use" }, 409);
    }
    throw err;
  }

  await bestEffortDeleteUploadUrl(existing.url, {
    expectedOrgId: "default",
    expectedKind: "event",
    expectedEventId: eventId,
  });
  return c.json({ ok: true });
}
