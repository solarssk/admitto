import { randomUUID } from "node:crypto";
import { mkdir, unlink, writeFile } from "node:fs/promises";
import { join, resolve, sep } from "node:path";
import sharp from "sharp";

const MAX_UPLOAD_BYTES = 2 * 1024 * 1024;
/** Reject absurd decoded dimensions before re-encode (DoS / decoder abuse). */
const MAX_DECODED_EDGE = 8192;
/**
 * Cap total decoded pixels (width × height) before Sharp allocates RGBA.
 * 16 MP ≈ 64 MiB at 4 bytes/pixel - well under a typical container memory budget
 * even with a few concurrent uploads, while still allowing sharp logos/headers.
 */
const MAX_DECODED_PIXELS = 16_777_216;

/** Reject decoded width/height that exceed edge or total-pixel budgets. */
export function assertDecodedImageWithinLimits(width: number, height: number): void {
  if (width > MAX_DECODED_EDGE || height > MAX_DECODED_EDGE) {
    throw new BrandingUploadError("invalid_image", 400);
  }
  if (width > 0 && height > 0 && width * height > MAX_DECODED_PIXELS) {
    throw new BrandingUploadError("invalid_image", 400);
  }
}
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

/** Detect font MIME from magic bytes (not client-declared Content-Type) - WOFF2/WOFF/OTF/TTF. */
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
  // TrueType sfnt version 1.0 - the standard .ttf signature.
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
   * Image-only - see validateAndWriteFont for why fonts skip this. */
  readonly crossCheckDeclaredMime?: boolean;
  /**
   * Optional transform after MIME detection (branding images: sharp re-encode strips EXIF/IPTC
   * and rejects undecodable polyglots). Fonts pass through raw bytes.
   */
  readonly transformBytes?: (buf: Buffer, mime: string) => Promise<Buffer>;
}

/**
 * Re-encode a branding raster through sharp: auto-orient, drop metadata, keep alpha for PNG/WebP.
 * ADR 0008 "strip metadata" - do not persist the client-supplied byte stream as-is.
 * Exported for unit tests covering dimension / MIME edge paths.
 */
export async function reencodeBrandingImage(buf: Buffer, mime: string): Promise<Buffer> {
  try {
    const meta = await sharp(buf, {
      failOn: "error",
      limitInputPixels: MAX_DECODED_PIXELS,
    }).metadata();
    const width = meta.width ?? 0;
    const height = meta.height ?? 0;
    assertDecodedImageWithinLimits(width, height);

    const pipeline = sharp(buf, {
      failOn: "error",
      limitInputPixels: MAX_DECODED_PIXELS,
    }).rotate();

    if (mime === "image/png") {
      return await pipeline.png().toBuffer();
    }
    if (mime === "image/jpeg") {
      return await pipeline.jpeg({ quality: 90, mozjpeg: true }).toBuffer();
    }
    if (mime === "image/webp") {
      return await pipeline.webp({ quality: 90 }).toBuffer();
    }
  } catch (err) {
    if (err instanceof BrandingUploadError) throw err;
    throw new BrandingUploadError("invalid_image", 400);
  }
  throw new BrandingUploadError("unsupported_file_type", 415, {
    allowedTypes: [...ALLOWED_EXT.keys()],
  });
}

/** Shared validate-then-write sequence for both branding image and font uploads: size limit,
 * magic-byte MIME detection (never the client-declared Content-Type alone), extension lookup, and
 * a UUID-named write. What differs between callers (size limit, detector, allowed types, and
 * whether the declared Content-Type is also cross-checked) is passed in, not duplicated. */
async function writeValidatedUpload(
  file: File,
  dir: string,
  opts: WriteValidatedUploadOptions,
): Promise<{ filename: string; sizeBytes: number; mime: string }> {
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

  const outBuf = opts.transformBytes ? await opts.transformBytes(buf, detectedMime) : buf;
  if (outBuf.length > opts.maxBytes) {
    throw new BrandingUploadError("file_too_large", 413, { maxBytes: opts.maxBytes });
  }

  const ext = opts.allowedExt.get(detectedMime)!;
  const filename = `${randomUUID()}${ext}`;
  // Path is join(trusted upload root, validated org/event segments, UUID filename).
  // eslint-disable-next-line security/detect-non-literal-fs-filename
  await mkdir(dir, { recursive: true });
  // Same trusted join as mkdir above.
  // eslint-disable-next-line security/detect-non-literal-fs-filename
  await writeFile(join(dir, filename), outBuf);
  return { filename, sizeBytes: outBuf.length, mime: detectedMime };
}

/** Validate image bytes and write to `dir`; returns generated filename, size, and MIME. */
async function validateAndWriteImage(
  file: File,
  dir: string,
): Promise<{ filename: string; sizeBytes: number; mime: string }> {
  return writeValidatedUpload(file, dir, {
    maxBytes: MAX_UPLOAD_BYTES,
    detectMime: detectImageMime,
    allowedExt: ALLOWED_EXT,
    crossCheckDeclaredMime: true,
    transformBytes: reencodeBrandingImage,
  });
}

/** UUID filename written by save* helpers (images + theme fonts). */
const UPLOAD_FILENAME_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(png|jpg|webp|woff2|woff|ttf|otf)$/;

export type ParsedUploadsUrl = {
  orgId: string;
  kind: "org" | "event" | "theme";
  eventId?: string;
  filename: string;
  /** Path relative to the upload root (no leading slash). */
  relativePath: string;
};

/** Parse a public `/uploads/…` URL into confined org/event/theme segments. */
export function parseUploadsUrl(url: string): ParsedUploadsUrl {
  if (typeof url !== "string" || !url.startsWith("/uploads/")) {
    throw new BrandingUploadError("invalid_upload_url", 400);
  }
  if (url.includes("?") || url.includes("#") || url.includes("\\") || url.includes("..")) {
    throw new BrandingUploadError("invalid_upload_url", 400);
  }

  const rest = url.slice("/uploads/".length);
  if (!rest || rest.startsWith("/") || rest.endsWith("/")) {
    throw new BrandingUploadError("invalid_upload_url", 400);
  }
  const parts = rest.split("/");
  if (parts.some((p) => p === "" || p === "." || p === "..")) {
    throw new BrandingUploadError("invalid_upload_url", 400);
  }

  if (parts.length === 2) {
    const [orgId, filename] = parts as [string, string];
    assertSafeOrgId(orgId);
    if (!UPLOAD_FILENAME_PATTERN.test(filename)) {
      throw new BrandingUploadError("invalid_upload_url", 400);
    }
    return { orgId, kind: "org", filename, relativePath: `${orgId}/${filename}` };
  }

  if (parts.length === 3 && parts[1] === "theme") {
    const [orgId, , filename] = parts as [string, string, string];
    assertSafeOrgId(orgId);
    if (!UPLOAD_FILENAME_PATTERN.test(filename)) {
      throw new BrandingUploadError("invalid_upload_url", 400);
    }
    return { orgId, kind: "theme", filename, relativePath: `${orgId}/theme/${filename}` };
  }

  if (parts.length === 4 && parts[1] === "events") {
    const [orgId, , eventId, filename] = parts as [string, string, string, string];
    assertSafeOrgId(orgId);
    assertSafeEventId(eventId);
    if (!UPLOAD_FILENAME_PATTERN.test(filename)) {
      throw new BrandingUploadError("invalid_upload_url", 400);
    }
    return {
      orgId,
      kind: "event",
      eventId,
      filename,
      relativePath: `${orgId}/events/${eventId}/${filename}`,
    };
  }

  throw new BrandingUploadError("invalid_upload_url", 400);
}

/** Resolve `relativePath` under the upload root; rejects escape attempts. */
export function absolutePathUnderUploadRoot(relativePath: string): string {
  const root = resolve(resolveUploadDir());
  const abs = resolve(join(root, relativePath));
  const rootWithSep = root.endsWith(sep) ? root : root + sep;
  if (abs !== root && !abs.startsWith(rootWithSep)) {
    throw new BrandingUploadError("invalid_upload_url", 400);
  }
  return abs;
}

/**
 * Delete a branding upload by its public `/uploads/…` URL.
 * Missing file is success (idempotent). Caller must authorize ownership first.
 */
export async function deleteBrandingUploadByUrl(
  url: string,
  opts: { expectedOrgId: string; expectedEventId?: string },
): Promise<void> {
  const parsed = parseUploadsUrl(url);
  if (parsed.orgId !== opts.expectedOrgId) {
    throw new BrandingUploadError("invalid_upload_url", 400);
  }
  if (opts.expectedEventId !== undefined) {
    if (parsed.kind !== "event" || parsed.eventId !== opts.expectedEventId) {
      throw new BrandingUploadError("invalid_upload_url", 400);
    }
  }

  const abs = absolutePathUnderUploadRoot(parsed.relativePath);
  try {
    // Path confined by parseUploadsUrl + resolve-under-root check above.
    // eslint-disable-next-line security/detect-non-literal-fs-filename
    await unlink(abs);
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === "ENOENT") return;
    throw err;
  }
}

/** Trusted owner context for best-effort disk cleanup (never derive solely from the URL). */
export type UploadDeleteTrust = {
  expectedOrgId: string;
  expectedKind: ParsedUploadsUrl["kind"];
  expectedEventId?: string;
};

/** Best-effort disk delete for a single managed upload URL (never throws). */
export async function bestEffortDeleteUploadUrl(
  url: string | null | undefined,
  trust: UploadDeleteTrust,
): Promise<void> {
  if (typeof url !== "string" || !url.startsWith("/uploads/")) return;
  try {
    const parsed = parseUploadsUrl(url);
    if (parsed.orgId !== trust.expectedOrgId || parsed.kind !== trust.expectedKind) return;
    if (trust.expectedKind === "event" && parsed.eventId !== trust.expectedEventId) return;
    await deleteBrandingUploadByUrl(url, {
      expectedOrgId: trust.expectedOrgId,
      expectedEventId: trust.expectedKind === "event" ? trust.expectedEventId : undefined,
    });
  } catch {
    // Cancel/replace must not fail the operator action if disk cleanup races or fails.
  }
}

/** Delete previous `/uploads/…` values that were replaced or cleared. */
export async function bestEffortDeleteReplacedUploadUrls(
  previous: Array<string | null | undefined>,
  next: Array<string | null | undefined>,
  trust: UploadDeleteTrust,
  opts?: {
    /**
     * Re-check immediately before unlink. Concurrent saves can restore a URL after this
     * caller's snapshot of `next` was taken; skip delete when the URL is live again.
     */
    isStillReferenced?: (url: string) => Promise<boolean>;
  },
): Promise<void> {
  const kept = new Set(next.filter((u): u is string => typeof u === "string" && u.startsWith("/uploads/")));
  for (const url of previous) {
    if (typeof url !== "string" || !url.startsWith("/uploads/")) continue;
    if (kept.has(url)) continue;
    if (opts?.isStillReferenced && (await opts.isStillReferenced(url))) continue;
    await bestEffortDeleteUploadUrl(url, trust);
  }
}

/** Local filesystem branding upload (ADR 0008 - future StorageAdapter swap). */
export async function saveBrandingUpload(
  file: File,
  orgId: string,
): Promise<{ url: string; sizeBytes: number; mimeType: string }> {
  assertSafeOrgId(orgId);
  const dir = join(resolveUploadDir(), orgId);
  const written = await validateAndWriteImage(file, dir);
  return {
    url: `/uploads/${orgId}/${written.filename}`,
    sizeBytes: written.sizeBytes,
    mimeType: written.mime,
  };
}

/**
 * Event-scoped image upload - same validation as org logo. Used both by
 * handlePostEventBrandingUpload (event logo/header) and handleCreateEventImageAsset (named
 * branding assets referenced as {{token}} in email templates).
 */
export async function saveEventUpload(
  file: File,
  orgId: string,
  eventId: string,
): Promise<{ url: string; sizeBytes: number; mimeType: string }> {
  assertSafeOrgId(orgId);
  assertSafeEventId(eventId);
  const dir = join(resolveUploadDir(), orgId, "events", eventId);
  const written = await validateAndWriteImage(file, dir);
  return {
    url: `/uploads/${orgId}/events/${eventId}/${written.filename}`,
    sizeBytes: written.sizeBytes,
    mimeType: written.mime,
  };
}

/** Validate font bytes and write to `dir`; returns generated filename with extension. Unlike
 * validateAndWriteImage, this does not cross-check the client-declared Content-Type against the
 * detected one - browsers report wildly inconsistent MIME types for font file inputs (empty
 * string, `application/font-woff2`, `application/octet-stream`, …), so the magic-byte check
 * alone is both the meaningful security boundary and the only reliable one here. */
async function validateAndWriteFont(file: File, dir: string): Promise<string> {
  const written = await writeValidatedUpload(file, dir, {
    maxBytes: MAX_FONT_UPLOAD_BYTES,
    detectMime: detectFontMime,
    allowedExt: ALLOWED_FONT_EXT,
  });
  return written.filename;
}

/** Instance-wide theme font upload (superadmin only) - stored separately from per-org/per-event
 * branding images since it's a different asset type entirely (used for @font-face, not <img>). */
export async function saveThemeFontUpload(file: File, orgId: string): Promise<{ url: string }> {
  assertSafeOrgId(orgId);
  const dir = join(resolveUploadDir(), orgId, "theme");
  const filename = await validateAndWriteFont(file, dir);
  return { url: `/uploads/${orgId}/theme/${filename}` };
}
