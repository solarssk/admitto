import type { Context } from "hono";
import { Prisma } from "@admitto/db";
import type { PrismaClient } from "@admitto/db";
import { z } from "zod";
import { ALLOWED_PLACEHOLDERS, logoCropFromDb, parseLogoCrop, type LogoCropMeta } from "@admitto/mail-templates";
import { writeBulkActionLog } from "@admitto/tickets";
import {
  adminAuditFromContext,
  assertEventManageAccess,
  requireEventId,
} from "./admin-helpers.js";
import { BrandingUploadError, bestEffortDeleteUploadUrl, saveEventUpload } from "./branding-upload.js";
import { logger } from "../logger.js";

/** Per-event cap on uploaded branding assets - generous for a sponsor-logo/photo library
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

/** Maps a saveEventUpload failure to its response shape, falling back to a generic 500 for
 * anything else - shared by create/update's catch blocks, which each check their own additional
 * error types first and fall through to this for everything else. */
function uploadOrServerErrorResponse(c: Context, err: unknown, logContext: string): Response {
  if (err instanceof BrandingUploadError) {
    return c.json({ error: err.code, ...err.details }, err.status as 400 | 413 | 415 | 503);
  }
  logger.error(logContext, { err });
  return c.json({ error: "server error" }, 500);
}

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
  /** Full pre-crop file for re-Edit; null for assets created before this field existed. */
  original_url: string | null;
  /** Last crop framing applied - null if there's nothing to restore (e.g. no original stored). */
  crop: LogoCropMeta | null;
  size_bytes: number;
  mime_type: string;
  created_at: string;
};

/** Shared by every query that returns a full asset row (list, create, update) - avoids repeating
 * the same nine-field object three times. */
const IMAGE_ASSET_SELECT = {
  id: true,
  token: true,
  filename: true,
  url: true,
  original_url: true,
  crop: true,
  size_bytes: true,
  mime_type: true,
  created_at: true,
} as const;

function serializeImageAsset(row: {
  id: string;
  token: string;
  filename: string;
  url: string;
  original_url: string | null;
  crop: unknown;
  size_bytes: number;
  mime_type: string;
  created_at: Date;
}): EventImageAssetDto {
  return {
    id: row.id,
    token: row.token,
    filename: row.filename,
    url: row.url,
    original_url: row.original_url,
    crop: logoCropFromDb(row.crop),
    size_bytes: row.size_bytes,
    mime_type: row.mime_type,
    created_at: row.created_at.toISOString(),
  };
}

/** GET /api/admin/events/:eventId/image-assets - event managers (org admin / superadmin). */
export async function handleListEventImageAssets(c: Context, db: PrismaClient): Promise<Response> {
  const eventIdOrRes = requireEventId(c);
  if (eventIdOrRes instanceof Response) return eventIdOrRes;
  const eventId = eventIdOrRes;

  const forbidden = await assertEventManageAccess(c, db, eventId);
  if (forbidden) return forbidden;

  const rows = await db.eventImageAsset.findMany({
    where: { event_id: eventId },
    orderBy: { created_at: "asc" },
    select: IMAGE_ASSET_SELECT,
  });

  c.header("Cache-Control", "no-store");
  return c.json({ items: rows.map(serializeImageAsset) });
}

/**
 * POST /api/admin/events/:eventId/image-assets - multipart upload (fields: `file`, `name`).
 * Server slugifies `name` into a template token (auto-suffix on collision / reserved names).
 * Event managers (org admin / superadmin). Archive guard applied by the caller (app.ts wraps
 * with guardArchivedEvent).
 */
type CreateAssetValidation =
  | {
      ok: true;
      fileField: File;
      displayName: string;
      tokenBase: string;
      originalUrl: string | null;
      crop: LogoCropMeta | null;
    }
  | { ok: false; response: Response };

/** Same field length as `logo_original_url` (event-settings-routes.ts) - just a same-origin
 * `/uploads/…` path, never user-visible. */
const ORIGINAL_URL_MAX = 2000;

/** Parses the optional pre-crop original URL + crop framing sent alongside `file`/`name` at
 * create time (the admin UI always crops before submitting, but both are optional so a create
 * without a crop step - if one is ever added - doesn't break). Returns null for either field
 * when absent; throws a short machine-ish message on a malformed `crop` payload. */
function parseOriginalAndCrop(body: Record<string, string | File>): {
  originalUrl: string | null;
  crop: LogoCropMeta | null;
} {
  const originalUrlField = body.original_url;
  const originalUrl =
    typeof originalUrlField === "string" && originalUrlField.trim()
      ? originalUrlField.trim().slice(0, ORIGINAL_URL_MAX)
      : null;
  const cropField = body.crop;
  const crop =
    typeof cropField === "string" && cropField.trim()
      ? parseLogoCrop(JSON.parse(cropField))
      : null;
  return { originalUrl, crop };
}

const DISPLAY_NAME_MAX = 80;

/** Same shape as admin item/ticket-type slugify, capped at the asset token max (40). */
export function slugifyImageAssetToken(name: string): string {
  const slug = name
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_");
  let start = 0;
  while (start < slug.length) {
    const code = slug.codePointAt(start)!;
    if (code >= 97 && code <= 122) break;
    start += 1;
  }
  let end = slug.length;
  while (end > start && slug.codePointAt(end - 1) === 95) end -= 1;
  // Collapse runs of underscores without a backtracking regex (Sonar S8786).
  let out = "";
  let prevUnderscore = false;
  for (let i = start; i < end; i++) {
    const ch = slug[i]!;
    if (ch === "_") {
      if (prevUnderscore) continue;
      prevUnderscore = true;
      out += ch;
      continue;
    }
    prevUnderscore = false;
    out += ch;
  }
  return out.slice(0, 40);
}

/** Prefer `base`, then `base_2`… while skipping taken and reserved placeholder names. */
export function allocateImageAssetToken(base: string, taken: ReadonlySet<string>): string | null {
  for (let n = 1; n < 100; n++) {
    const suffix = n === 1 ? "" : `_${n}`;
    const candidate =
      n === 1 ? base : `${base.slice(0, Math.max(1, 40 - suffix.length))}${suffix}`;
    if (ALLOWED_PLACEHOLDERS.has(candidate) || taken.has(candidate)) continue;
    if (!tokenSchema.safeParse(candidate).success) continue;
    return candidate;
  }
  return null;
}

/** Parses and validates the upload request (form fields, name→token base, per-event
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

  const nameField = body.name;
  const displayName = typeof nameField === "string" ? nameField.trim() : "";
  if (!displayName || displayName.length > DISPLAY_NAME_MAX) {
    return { ok: false, response: c.json({ error: "invalid_name" }, 400) };
  }
  const tokenBase = slugifyImageAssetToken(displayName);
  if (!tokenBase) {
    return { ok: false, response: c.json({ error: "invalid_name" }, 400) };
  }

  let originalUrl: string | null;
  let crop: LogoCropMeta | null;
  try {
    ({ originalUrl, crop } = parseOriginalAndCrop(body));
  } catch {
    return { ok: false, response: c.json({ error: "invalid_crop" }, 400) };
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

  return { ok: true, fileField, displayName, tokenBase, originalUrl, crop };
}

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

  const validation = await validateCreateAssetRequest(c, db, eventId);
  if (!validation.ok) return validation.response;
  const { fileField, displayName, tokenBase, originalUrl, crop } = validation;

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
      const existing = await tx.eventImageAsset.findMany({
        where: { event_id: eventId },
        select: { token: true },
      });
      const taken = new Set(existing.map((row) => row.token));
      const token = allocateImageAssetToken(tokenBase, taken);
      if (!token) {
        throw new AssetLimitReachedError();
      }
      const row = await tx.eventImageAsset.create({
        data: {
          event_id: eventId,
          token,
          filename: displayName,
          url: uploaded.url,
          original_url: originalUrl,
          crop: crop ?? Prisma.JsonNull,
          size_bytes: uploaded.sizeBytes,
          mime_type: uploaded.mimeType,
        },
        select: IMAGE_ASSET_SELECT,
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
    if (err instanceof AssetLimitReachedError) {
      return c.json(
        { error: "asset_limit_reached", limit: MAX_IMAGE_ASSETS_PER_EVENT },
        422,
      );
    }
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
      return c.json({ error: "token_conflict" }, 409);
    }
    return uploadOrServerErrorResponse(c, err, "handleCreateEventImageAsset failed");
  }
}

/** Load an image asset scoped to event; null when missing or cross-event (caller returns 403). */
async function loadImageAssetInEvent(db: PrismaClient, eventId: string, assetId: string) {
  const row = await db.eventImageAsset.findUnique({
    where: { id: assetId },
    select: { id: true, event_id: true, token: true, url: true, original_url: true },
  });
  if (row?.event_id !== eventId) return null;
  return row;
}

/**
 * PATCH /api/admin/events/:eventId/image-assets/:assetId - multipart re-crop of an existing
 * asset (fields: `file` the newly-cropped image, optional `crop` framing). Re-crops the same
 * pre-crop original the asset already has - `token`/`filename`/`original_url` never change here;
 * to use a different source image, delete and re-add instead. Event managers (org admin /
 * superadmin). Archive guard applied by the caller (app.ts wraps with guardArchivedEvent).
 */
export async function handleUpdateEventImageAsset(c: Context, db: PrismaClient): Promise<Response> {
  const eventIdOrRes = requireEventId(c);
  if (eventIdOrRes instanceof Response) return eventIdOrRes;
  const eventId = eventIdOrRes;
  const assetId = c.req.param("assetId");
  if (!assetId) return c.json({ error: "assetId required" }, 400);

  const forbidden = await assertEventManageAccess(c, db, eventId);
  if (forbidden) return forbidden;

  const existing = await loadImageAssetInEvent(db, eventId, assetId);
  if (!existing) return c.json({ error: "forbidden" }, 403);

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
  let crop: LogoCropMeta | null;
  try {
    ({ crop } = parseOriginalAndCrop(body));
  } catch {
    return c.json({ error: "invalid_crop" }, 400);
  }

  // TODO(multi-org): same single-tenant assumption as handleCreateEventImageAsset.
  const orgId = "default";

  try {
    const uploaded = await saveEventUpload(fileField, orgId, eventId);
    const updated = await db.$transaction(async (tx) => {
      await acquireEventImageAssetsLock(tx, eventId);
      const row = await tx.eventImageAsset.update({
        where: { id: assetId },
        data: {
          url: uploaded.url,
          crop: crop ?? Prisma.JsonNull,
          size_bytes: uploaded.sizeBytes,
          mime_type: uploaded.mimeType,
        },
        select: IMAGE_ASSET_SELECT,
      });
      await writeBulkActionLog(tx, {
        event_id: eventId,
        action_type: "event_image_asset_updated",
        audit: adminAuditFromContext(c),
        metadata: { token: row.token },
      });
      return row;
    });
    // Best-effort: the previous cropped file is now unreferenced (interim orphan cleanup, same
    // as delete's cleanup below; full StorageAdapter GC is ADR 0008).
    await bestEffortDeleteUploadUrl(existing.url, {
      expectedOrgId: orgId,
      expectedKind: "event",
      expectedEventId: eventId,
    });
    return c.json(serializeImageAsset(updated));
  } catch (err) {
    return uploadOrServerErrorResponse(c, err, "handleUpdateEventImageAsset failed");
  }
}

/**
 * DELETE /api/admin/events/:eventId/image-assets/:assetId: deletes the DB row and best-effort
 * removes the managed `/uploads/…` file (interim orphan cleanup; full StorageAdapter GC is ADR 0008).
 * If the token is still referenced by a saved event template's {{token}}, the delete is rejected
 * (409 asset_in_use) - the batch send path renders saved templates without whitelist re-validation
 * (renderTemplateTrustedForStorage), so after a delete the token would silently resolve to ""
 * and the image would just vanish from attendee emails. Event managers (org admin / superadmin).
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
  if (existing.original_url) {
    await bestEffortDeleteUploadUrl(existing.original_url, {
      expectedOrgId: "default",
      expectedKind: "event",
      expectedEventId: eventId,
    });
  }
  return c.json({ ok: true });
}
