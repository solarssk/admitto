import { randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

const MAX_UPLOAD_BYTES = 2 * 1024 * 1024;
const ALLOWED_EXT = new Map([
  ["image/png", ".png"],
  ["image/jpeg", ".jpg"],
  ["image/webp", ".webp"],
]);
const ORG_ID_PATTERN = /^[a-z0-9][a-z0-9_-]{0,63}$/;
const EVENT_ID_PATTERN = /^[a-z0-9][a-z0-9_-]{0,127}$/;

// Font files (full character sets, hinting) run larger than a small branding logo.
const MAX_FONT_UPLOAD_BYTES = 5 * 1024 * 1024;
const ALLOWED_FONT_EXT = new Map([
  ["font/woff2", ".woff2"],
  ["font/woff", ".woff"],
  ["font/ttf", ".ttf"],
  ["font/otf", ".otf"],
]);

/** Validation error for branding upload requests (maps to HTTP status). */
export class BrandingUploadError extends Error {
  /** @param code Machine-readable error code returned in the JSON body. */
  constructor(
    readonly code: string,
    readonly status: number,
    readonly details?: Record<string, unknown>,
  ) {
    super(code);
    this.name = "BrandingUploadError";
  }
}

/** Resolve local branding upload directory from `UPLOAD_DIR` or `./uploads`. */
export function resolveUploadDir(): string {
  return process.env.UPLOAD_DIR ?? join(process.cwd(), "uploads");
}

/** Reject org IDs that could escape the upload directory via path traversal. */
function assertSafeOrgId(orgId: string): void {
  if (!ORG_ID_PATTERN.test(orgId)) {
    throw new BrandingUploadError("invalid_org_id", 400);
  }
}

/** Reject event IDs that could escape the upload directory via path traversal. */
function assertSafeEventId(eventId: string): void {
  if (!EVENT_ID_PATTERN.test(eventId)) {
    throw new BrandingUploadError("invalid_event_id", 400);
  }
}

/** Detect raster image MIME from magic bytes (not client-declared Content-Type). */
function detectImageMime(buf: Buffer): string | null {
  if (
    buf.length >= 8 &&
    buf[0] === 0x89 &&
    buf[1] === 0x50 &&
    buf[2] === 0x4e &&
    buf[3] === 0x47
  ) {
    return "image/png";
  }
  if (buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) {
    return "image/jpeg";
  }
  if (
    buf.length >= 12 &&
    buf.subarray(0, 4).toString("ascii") === "RIFF" &&
    buf.subarray(8, 12).toString("ascii") === "WEBP"
  ) {
    return "image/webp";
  }
  return null;
}

/** Detect font MIME from magic bytes (not client-declared Content-Type) — WOFF2/WOFF/OTF/TTF. */
function detectFontMime(buf: Buffer): string | null {
  if (buf.length >= 4 && buf.subarray(0, 4).toString("ascii") === "wOF2") {
    return "font/woff2";
  }
  if (buf.length >= 4 && buf.subarray(0, 4).toString("ascii") === "wOFF") {
    return "font/woff";
  }
  if (buf.length >= 4 && buf.subarray(0, 4).toString("ascii") === "OTTO") {
    return "font/otf";
  }
  // TrueType sfnt version 1.0 — the standard .ttf signature.
  if (
    buf.length >= 4 &&
    buf[0] === 0x00 &&
    buf[1] === 0x01 &&
    buf[2] === 0x00 &&
    buf[3] === 0x00
  ) {
    return "font/ttf";
  }
  return null;
}

interface WriteValidatedUploadOptions {
  readonly maxBytes: number;
  readonly detectMime: (buf: Buffer) => string | null;
  readonly allowedExt: ReadonlyMap<string, string>;
  /** Also reject when the client-declared Content-Type disagrees with the detected MIME.
   * Image-only — see validateAndWriteFont for why fonts skip this. */
  readonly crossCheckDeclaredMime?: boolean;
}

/** Shared validate-then-write sequence for both branding image and font uploads: size limit,
 * magic-byte MIME detection (never the client-declared Content-Type alone), extension lookup, and
 * a UUID-named write. What differs between callers (size limit, detector, allowed types, and
 * whether the declared Content-Type is also cross-checked) is passed in, not duplicated. */
async function writeValidatedUpload(file: File, dir: string, opts: WriteValidatedUploadOptions): Promise<string> {
  if (file.size > opts.maxBytes) {
    throw new BrandingUploadError("file_too_large", 413, { maxBytes: opts.maxBytes });
  }

  const buf = Buffer.from(await file.arrayBuffer());
  const detectedMime = opts.detectMime(buf);
  if (!detectedMime || !opts.allowedExt.has(detectedMime)) {
    throw new BrandingUploadError("unsupported_file_type", 415, {
      allowedTypes: [...opts.allowedExt.keys()],
    });
  }

  if (opts.crossCheckDeclaredMime) {
    const declaredMime = file.type.split(";")[0]?.trim() ?? "";
    if (declaredMime && declaredMime !== detectedMime) {
      throw new BrandingUploadError("unsupported_file_type", 415, {
        allowedTypes: [...opts.allowedExt.keys()],
      });
    }
  }

  const ext = opts.allowedExt.get(detectedMime)!;
  const filename = `${randomUUID()}${ext}`;
  // eslint-disable-next-line security/detect-non-literal-fs-filename -- path joined from trusted repo root or upload dir
  await mkdir(dir, { recursive: true });
  // eslint-disable-next-line security/detect-non-literal-fs-filename -- path joined from trusted repo root or upload dir
  await writeFile(join(dir, filename), buf);
  return filename;
}

/** Validate image bytes and write to `dir`; returns generated filename with extension. */
async function validateAndWriteImage(file: File, dir: string): Promise<string> {
  return writeValidatedUpload(file, dir, {
    maxBytes: MAX_UPLOAD_BYTES,
    detectMime: detectImageMime,
    allowedExt: ALLOWED_EXT,
    crossCheckDeclaredMime: true,
  });
}

/** Local filesystem branding upload (ADR 0008 — future StorageAdapter swap). */
export async function saveBrandingUpload(file: File, orgId: string): Promise<{ url: string }> {
  assertSafeOrgId(orgId);
  const dir = join(resolveUploadDir(), orgId);
  const filename = await validateAndWriteImage(file, dir);
  return { url: `/uploads/${orgId}/${filename}` };
}

/**
 * Event-scoped image upload — same validation as org logo. Used both by
 * handlePostEventBrandingUpload (event logo/header) and handleCreateEventImageAsset (named
 * branding assets referenced as {{token}} in email templates).
 */
export async function saveEventUpload(
  file: File,
  orgId: string,
  eventId: string,
): Promise<{ url: string }> {
  assertSafeOrgId(orgId);
  assertSafeEventId(eventId);
  const dir = join(resolveUploadDir(), orgId, "events", eventId);
  const filename = await validateAndWriteImage(file, dir);
  return { url: `/uploads/${orgId}/events/${eventId}/${filename}` };
}

/** Validate font bytes and write to `dir`; returns generated filename with extension. Unlike
 * validateAndWriteImage, this does not cross-check the client-declared Content-Type against the
 * detected one - browsers report wildly inconsistent MIME types for font file inputs (empty
 * string, `application/font-woff2`, `application/octet-stream`, …), so the magic-byte check
 * alone is both the meaningful security boundary and the only reliable one here. */
async function validateAndWriteFont(file: File, dir: string): Promise<string> {
  return writeValidatedUpload(file, dir, {
    maxBytes: MAX_FONT_UPLOAD_BYTES,
    detectMime: detectFontMime,
    allowedExt: ALLOWED_FONT_EXT,
  });
}

/** Instance-wide theme font upload (superadmin only) — stored separately from per-org/per-event
 * branding images since it's a different asset type entirely (used for @font-face, not <img>). */
export async function saveThemeFontUpload(file: File, orgId: string): Promise<{ url: string }> {
  assertSafeOrgId(orgId);
  const dir = join(resolveUploadDir(), orgId, "theme");
  const filename = await validateAndWriteFont(file, dir);
  return { url: `/uploads/${orgId}/theme/${filename}` };
}
