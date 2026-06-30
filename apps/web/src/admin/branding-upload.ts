import { randomUUID } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { join, extname } from "node:path";

const MAX_UPLOAD_BYTES = 2 * 1024 * 1024;
const ALLOWED_MIME = new Set(["image/png", "image/jpeg", "image/webp"]);
const ALLOWED_EXT = new Map([
  ["image/png", ".png"],
  ["image/jpeg", ".jpg"],
  ["image/webp", ".webp"],
]);

export class BrandingUploadError extends Error {
  constructor(
    readonly code: string,
    readonly status: number,
    readonly details?: Record<string, unknown>,
  ) {
    super(code);
    this.name = "BrandingUploadError";
  }
}

export function resolveUploadDir(): string {
  return process.env.UPLOAD_DIR ?? join(process.cwd(), "uploads");
}

/** Local filesystem branding upload (ADR 0008 — future StorageAdapter swap). */
export async function saveBrandingUpload(file: File, orgId: string): Promise<{ url: string }> {
  if (file.size > MAX_UPLOAD_BYTES) {
    throw new BrandingUploadError("file_too_large", 413, { maxBytes: MAX_UPLOAD_BYTES });
  }

  const mime = file.type.split(";")[0]?.trim() ?? "";
  if (!ALLOWED_MIME.has(mime)) {
    throw new BrandingUploadError("unsupported_file_type", 415, {
      allowedTypes: [...ALLOWED_MIME],
    });
  }

  const ext = ALLOWED_EXT.get(mime) ?? extname(file.name);
  const filename = `${randomUUID()}${ext}`;
  const dir = join(resolveUploadDir(), orgId);
  mkdirSync(dir, { recursive: true });

  const buf = Buffer.from(await file.arrayBuffer());
  writeFileSync(join(dir, filename), buf);

  return { url: `/uploads/${orgId}/${filename}` };
}
