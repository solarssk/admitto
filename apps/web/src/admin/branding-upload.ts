import { randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

const MAX_UPLOAD_BYTES = 2 * 1024 * 1024;
const ALLOWED_MIME = new Set(["image/png", "image/jpeg", "image/webp"]);
const ALLOWED_EXT = new Map([
  ["image/png", ".png"],
  ["image/jpeg", ".jpg"],
  ["image/webp", ".webp"],
]);
const ORG_ID_PATTERN = /^[a-z0-9][a-z0-9_-]{0,63}$/;

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

/** Local filesystem branding upload (ADR 0008 — future StorageAdapter swap). */
export async function saveBrandingUpload(file: File, orgId: string): Promise<{ url: string }> {
  assertSafeOrgId(orgId);

  if (file.size > MAX_UPLOAD_BYTES) {
    throw new BrandingUploadError("file_too_large", 413, { maxBytes: MAX_UPLOAD_BYTES });
  }

  const buf = Buffer.from(await file.arrayBuffer());
  const detectedMime = detectImageMime(buf);
  if (!detectedMime || !ALLOWED_MIME.has(detectedMime)) {
    throw new BrandingUploadError("unsupported_file_type", 415, {
      allowedTypes: [...ALLOWED_MIME],
    });
  }

  const declaredMime = file.type.split(";")[0]?.trim() ?? "";
  if (declaredMime && declaredMime !== detectedMime) {
    throw new BrandingUploadError("unsupported_file_type", 415, {
      allowedTypes: [...ALLOWED_MIME],
    });
  }

  const ext = ALLOWED_EXT.get(detectedMime)!;
  const filename = `${randomUUID()}${ext}`;
  const dir = join(resolveUploadDir(), orgId);
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, filename), buf);

  return { url: `/uploads/${orgId}/${filename}` };
}
